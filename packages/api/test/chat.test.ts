import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chatMessagesSchema } from '@clqn/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createApp } from '../src/app.js';
import { createStore } from '../src/db/store.js';

test('PostgreSQL: clan chat is shared by members and agents, isolated by clan, and pages in commit order', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests',
}, async (t) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 2 });
  const connection = createStore(process.env.TEST_DATABASE_URL!);
  const users: string[] = [];
  const clans: string[] = [];
  t.after(async () => {
    try {
      if (clans.length) {
        await sql`delete from chat_messages where clan_id in ${sql(clans)}`;
        await sql`delete from events where clan_id in ${sql(clans)}`;
        await sql`delete from credentials where user_id in ${sql(users)}`;
        await sql`delete from agents where clan_id in ${sql(clans)}`;
        await sql`delete from memberships where clan_id in ${sql(clans)}`;
        await sql`delete from clans where id in ${sql(clans)}`;
      }
      if (users.length) await sql`delete from users where id in ${sql(users)}`;
    } finally {
      await connection.close();
      await sql.end();
    }
  });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  const user = async (name: string) => {
    const person = await connection.provisionUser(`${name}-${randomUUID()}@example.com`);
    users.push(person.user.id);
    return person;
  };
  const [leader, member, outsider] = await Promise.all([user('leader'), user('member'), user('outsider')]);
  const clan = await connection.store.createClan(leader.user.id, 'Chat');
  const other = await connection.store.createClan(outsider.user.id, 'Elsewhere');
  clans.push(clan.id, other.id);
  await sql`insert into memberships (clan_id, user_id) values (${clan.id}, ${member.user.id})`;
  const worker = await connection.store.registerAgent(member.user, clan.id, 'Docs worker');
  const stranger = await connection.store.registerAgent(outsider.user, other.id, 'Stranger');
  const app = createApp(connection.store, connection.db);
  const chat = (token: string, query = '', body?: unknown, clanId = clan.id) =>
    app.request(`/v1/clans/${clanId}/chat${query}`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
  const read = async (token: string, query = '') => {
    const response = await chat(token, query);
    assert.equal(response.status, 200);
    return chatMessagesSchema.parse(await response.json()).messages;
  };

  const first = await chat(leader.token, '', { text: '  Ship the docs refresh  ' });
  assert.equal(first.status, 201);
  const sent = await first.json();
  assert.equal(sent.text, 'Ship the docs refresh');
  assert.equal(sent.author, leader.user.email);
  assert.equal(sent.agentId, null);
  const fromAgent = await (await chat(worker.token, '', { text: 'On it' })).json();
  assert.equal(fromAgent.author, 'Docs worker');
  assert.equal(fromAgent.agentId, worker.agent.id);
  assert.equal(fromAgent.authorId, member.user.id);

  // Concurrent writers each get a distinct, increasing sequence.
  await Promise.all(['a', 'b', 'c', 'd'].map((text) => chat(member.token, '', { text })));
  const all = await read(member.token);
  assert.equal(all.length, 6);
  assert.deepEqual(
    all.map((message) => message.sequence),
    [...all.map((message) => message.sequence)].sort((a, b) => a - b),
  );
  assert.deepEqual(
    (await read(leader.token, '?limit=2')).map((m) => m.id),
    all.slice(-2).map((m) => m.id),
  );
  assert.deepEqual(
    (await read(worker.token, `?after=${all[1]!.sequence}&limit=3`)).map((m) => m.id),
    all.slice(2, 5).map((m) => m.id),
  );
  assert.deepEqual(await read(leader.token, `?after=${all.at(-1)!.sequence}`), []);

  // Other clans, their agents, and bad input are rejected.
  assert.equal((await chat(outsider.token)).status, 404);
  assert.equal((await chat(outsider.token, '', { text: 'hi' })).status, 404);
  assert.equal((await chat(stranger.token)).status, 404);
  assert.equal((await chat(worker.token, '', undefined, other.id)).status, 404);
  for (const body of [{}, { text: '   ' }, { text: 'x'.repeat(4001) }, { text: 'hi', author: 'spoof' }]) {
    assert.equal((await chat(member.token, '', body)).status, 400);
  }
  assert.equal((await chat(member.token, '?limit=0')).status, 400);
  assert.equal((await read(member.token)).length, 6);
});
