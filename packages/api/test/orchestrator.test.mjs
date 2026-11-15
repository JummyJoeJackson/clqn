import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { agentSchema, registerAgentSchema } from '@clqn/shared';
import { createStore } from '../dist/store.js';
import { createApp } from '../dist/app.js';

test('agent contracts preserve worker defaults and restrict orchestrator role values', () => {
  assert.deepEqual(registerAgentSchema.parse({ name: 'Codex' }), { name: 'Codex', role: 'worker' });
  assert.deepEqual(registerAgentSchema.parse({ name: 'Coordinator', role: 'orchestrator' }), { name: 'Coordinator', role: 'orchestrator' });
  assert.equal(registerAgentSchema.safeParse({ name: 'Escalated', role: 'leader' }).success, false);
  assert.equal(agentSchema.parse({ id: randomUUID(), clanId: randomUUID(), ownerId: randomUUID(), name: 'Legacy', createdAt: new Date().toISOString() }).role, 'worker');
});

test('PostgreSQL: only a personal leader registers one orchestrator per clan under concurrent requests', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests',
}, async (t) => {
  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 5 });
  const connection = createStore(process.env.TEST_DATABASE_URL);
  const userIds = [];
  const clanIds = [];
  t.after(async () => {
    try {
      if (clanIds.length) {
        await sql`delete from events where clan_id in ${sql(clanIds)}`;
        await sql`delete from credentials where user_id in ${sql(userIds)}`;
        await sql`delete from agents where clan_id in ${sql(clanIds)}`;
        await sql`delete from memberships where clan_id in ${sql(clanIds)}`;
        await sql`delete from clans where id in ${sql(clanIds)}`;
      }
      if (userIds.length) await sql`delete from users where id in ${sql(userIds)}`;
    } finally { await connection.close(); await sql.end(); }
  });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  const alice = await connection.provisionUser(`${randomUUID()}@example.com`);
  const bob = await connection.provisionUser(`${randomUUID()}@example.com`);
  userIds.push(alice.user.id, bob.user.id);
  const clan = await connection.store.createClan(alice.user.id, 'Orchestrator');
  const other = await connection.store.createClan(alice.user.id, 'Another orchestrator');
  clanIds.push(clan.id, other.id);
  await sql`insert into memberships (clan_id, user_id) values (${clan.id}, ${bob.user.id})`;
  const app = createApp(connection.store, connection.db);
  const post = (token, path, body) => app.request(path, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const path = `/v1/clans/${clan.id}/agents`;
  assert.equal((await post(bob.token, path, { name: 'Not leader', role: 'orchestrator' })).status, 403);
  const worker = await (await post(bob.token, path, { name: 'Worker' })).json();
  assert.equal(worker.agent.role, 'worker');
  const responses = await Promise.all([
    post(alice.token, path, { name: 'First', role: 'orchestrator' }),
    post(alice.token, path, { name: 'Second', role: 'orchestrator' }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const orchestrator = await responses.find((r) => r.status === 201).json();
  assert.equal(orchestrator.agent.role, 'orchestrator');
  assert.equal(orchestrator.agent.ownerId, alice.user.id);
  assert.equal((await responses.find((r) => r.status === 409).json()).error.code, 'ORCHESTRATOR_EXISTS');
  const [counts] = await sql`select count(*)::integer as n from agents where clan_id = ${clan.id} and role = 'orchestrator'`;
  assert.equal(counts.n, 1);
  const [credentials] = await sql`select count(*)::integer as n from credentials c join agents a on a.id = c.agent_id where a.clan_id = ${clan.id}`;
  assert.equal(credentials.n, 2);
  const [events] = await sql`select count(*)::integer as n from events where clan_id = ${clan.id} and type = 'agent.registered'`;
  assert.equal(events.n, 2);
  assert.equal((await post(alice.token, `/v1/clans/${other.id}/agents`, { name: 'Other', role: 'orchestrator' })).status, 201);
  // The designated agent does not inherit the leader's administrative credential.
  for (const [adminPath, body] of [
    [path, { name: 'Child', role: 'worker' }],
    [`/v1/clans/${clan.id}/invitations`, { email: bob.user.email }],
    [`/v1/clans/${clan.id}/policy`, { expectedRevision: 0, control: 'automatic' }],
  ]) assert.equal((await post(orchestrator.token, adminPath, body)).status, 403);
  const list = await connection.store.listAgents(alice.user, clan.id);
  assert.equal(list.find((a) => a.id === orchestrator.agent.id).role, 'orchestrator');
  const registration = await app.request('/v1/agent', { headers: { authorization: `Bearer ${orchestrator.token}` } });
  assert.equal((await registration.json()).role, 'orchestrator');
  await assert.rejects(sql`insert into agents (clan_id, owner_id, name, role) values (${other.id}, ${alice.user.id}, 'Bad role', 'leader')`, { code: '23514' });
});
