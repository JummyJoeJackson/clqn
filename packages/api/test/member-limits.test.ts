import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chatSettingsSchema, defaultChatSettings } from '@clqn/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createApp } from '../src/app.js';
import { createStore } from '../src/db/store.js';

const skip = !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests';
const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));

test('chat settings hold every member limit and default to full access', () => {
  assert.deepEqual(defaultChatSettings, {
    approval: 'manual',
    tokenLimit: null,
    agentLimit: null,
    allowedModels: null,
  });
  for (const settings of [
    { ...defaultChatSettings, tokenLimit: -1 },
    { ...defaultChatSettings, agentLimit: 1.5 },
    { ...defaultChatSettings, allowedModels: [] },
    { ...defaultChatSettings, allowedModels: ['two words'] },
    { ...defaultChatSettings, allowedModels: ['a', 'a'] },
    { ...defaultChatSettings, userId: randomUUID() },
  ])
    assert.equal(chatSettingsSchema.safeParse(settings).success, false, JSON.stringify(settings));
});

test('PostgreSQL: members set only their own limits before a session, and edits stay whole', { skip }, async (t) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 5 });
  const connection = createStore(process.env.TEST_DATABASE_URL!);
  const users: string[] = [];
  const clans: string[] = [];
  t.after(async () => {
    try {
      if (clans.length) {
        await sql`delete from chats where clan_id in ${sql(clans)}`;
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
  await migrate(drizzle(sql), { migrationsFolder: migrations });
  const [leader, member, outsider] = await Promise.all(
    ['leader', 'member', 'outsider'].map(async (name) => {
      const person = await connection.provisionUser(`${name}-${randomUUID()}@example.com`);
      users.push(person.user.id);
      return person;
    }),
  );
  const clan = await connection.store.createClan(leader!.user.id, 'Limits');
  clans.push(clan.id);
  await sql`insert into memberships (clan_id, user_id) values (${clan.id}, ${member!.user.id})`;
  const worker = await connection.store.registerAgent(member!.user, clan.id, 'Worker');
  const app = createApp(connection.store, connection.db);
  const chat = (token: string, suffix = '', body?: object) =>
    app.request(`/v1/clans/${clan.id}/chat${suffix}`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });

  // A new member sees full access until they choose otherwise.
  assert.deepEqual((await (await chat(member!.token)).json()).settings, defaultChatSettings);
  const custom = { approval: 'manual', tokenLimit: 1000, agentLimit: 2, allowedModels: ['model-a'] };
  // Saved before any session exists, and only by the member themselves.
  assert.equal((await chat(outsider!.token, '/settings', custom)).status, 404);
  assert.equal((await chat(worker.token, '/settings', custom)).status, 403);
  assert.equal((await chat(member!.token, '/settings', { ...custom, userId: leader!.user.id })).status, 400);
  const saved = await chat(member!.token, '/settings', custom);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), custom);
  assert.deepEqual((await (await chat(member!.token)).json()).settings, custom);
  assert.deepEqual((await (await chat(leader!.token)).json()).settings, defaultChatSettings);
  // Saving limits is not a session: the chat stays closed until the leader starts it.
  assert.equal((await chat(member!.token, '/state')).status, 403);
  assert.equal((await chat(member!.token, '/join', custom)).status, 404);
  const agents = await connection.store.listAgents(leader!.user, clan.id);
  assert.deepEqual(agents.find(({ id }) => id === worker.agent.id)?.allowedModels, ['model-a']);

  assert.equal((await chat(leader!.token, '/join', defaultChatSettings)).status, 200);
  assert.equal((await chat(member!.token, '/state')).status, 200);
  assert.deepEqual((await (await chat(member!.token, '/state')).json()).settings, custom);

  // Concurrent edits each replace the whole row, so the result is exactly one of them.
  const edits = [
    { approval: 'automatic', tokenLimit: 5, agentLimit: null, allowedModels: null },
    { approval: 'manual', tokenLimit: null, agentLimit: 9, allowedModels: ['model-b'] },
  ];
  const results = await Promise.all([
    chat(member!.token, '/settings', edits[0]),
    chat(member!.token, '/join', edits[1]),
  ]);
  assert.deepEqual(
    results.map(({ status }) => status),
    [200, 200],
  );
  const final = (await (await chat(member!.token, '/state')).json()).settings;
  assert.ok(
    edits.some((edit) => {
      try {
        assert.deepEqual(final, edit);
        return true;
      } catch {
        return false;
      }
    }),
    JSON.stringify(final),
  );
  const [rows] = await sql`select count(*)::integer as n from chat_members where clan_id = ${clan.id}`;
  assert.equal(rows?.n, 2);
});

test('PostgreSQL: the member limits migration copies saved model and token limits', { skip }, async (t) => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const name = `clqn_migration_${randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1 });
  // Migrations before 0017, then the full folder, as a deployed database would see them.
  const before = await mkdtemp(join(tmpdir(), 'clqn-migrations-'));
  t.after(async () => {
    await sql.end();
    await admin.unsafe(`drop database if exists ${name}`);
    await admin.end();
    await rm(before, { recursive: true, force: true });
  });
  await cp(migrations, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 17);
  await writeFile(journalPath, JSON.stringify(journal));
  await migrate(drizzle(sql), { migrationsFolder: before });

  const [leader, joined, notJoined, plain] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const id of [leader, joined, notJoined, plain])
    await sql`insert into users (id, email) values (${id}, ${`${id}@example.com`})`;
  const [clan] = await sql`insert into clans (name, created_by) values ('Old', ${leader}) returning id`;
  const policy = (models: string[] | null, tokens: number | null) =>
    JSON.stringify({ tokenLimit: tokens, allowedModels: models, control: 'automatic' });
  await sql`insert into memberships (clan_id, user_id, role) values (${clan!.id}, ${leader}, 'leader')`;
  await sql`insert into memberships (clan_id, user_id, agent_policy) values
    (${clan!.id}, ${joined}, ${policy(['model-a'], 10)}::jsonb),
    (${clan!.id}, ${notJoined}, ${policy(['model-b'], 20)}::jsonb)`;
  await sql`insert into memberships (clan_id, user_id) values (${clan!.id}, ${plain})`;
  await sql`insert into chats (clan_id, host_id) values (${clan!.id}, ${leader})`;
  const old = JSON.stringify({ approval: 'automatic', tokenLimit: 50000, agentLimit: 3 });
  await sql`insert into chat_members (clan_id, user_id, settings) values (${clan!.id}, ${leader}, ${old}::jsonb), (${clan!.id}, ${joined}, ${old}::jsonb)`;

  await migrate(drizzle(sql), { migrationsFolder: migrations });
  const rows = await sql`select user_id, settings from chat_members where clan_id = ${clan!.id}`;
  const settings = Object.fromEntries(rows.map((row) => [row.user_id, row.settings]));
  assert.deepEqual(settings, {
    [leader]: { approval: 'automatic', tokenLimit: 50000, agentLimit: 3, allowedModels: null },
    // Saved chat settings are kept; the policy adds only its enforced model limits.
    [joined]: { approval: 'automatic', tokenLimit: 50000, agentLimit: 3, allowedModels: ['model-a'] },
    // A saved policy without a chat row keeps its limits, with manual approval.
    [notJoined]: { approval: 'manual', tokenLimit: 20, agentLimit: null, allowedModels: ['model-b'] },
  });
  const columns =
    await sql`select column_name from information_schema.columns where table_name = 'memberships' and column_name in ('agent_policy', 'policy_revision')`;
  assert.equal(columns.length, 0);
});
