import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createStore, hashToken } from '../dist/store.js';
import { createApp } from '../dist/app.js';
import { serve } from '@hono/node-server';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use a dedicated database: migrations are applied, and only this test's users/clans are deleted.
test('PostgreSQL: identity, clan isolation, concurrent creation, and credential revocation', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests',
}, async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  const sql = postgres(url, { max: 2 });
  const connection = createStore(url);
  const userIds = [];
  t.after(async () => {
    try {
      if (userIds.length) {
        await sql`delete from memberships where user_id in ${sql(userIds)}`;
        await sql`delete from clans where created_by in ${sql(userIds)}`;
        await sql`delete from credentials where user_id in ${sql(userIds)}`;
        await sql`delete from users where id in ${sql(userIds)}`;
      }
    } finally { await connection.close(); await sql.end(); }
  });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  const email = `${randomUUID()}@example.com`;
  const alice = await connection.provisionUser(email);
  userIds.push(alice.user.id);
  const bob = await connection.provisionUser(`${randomUUID()}@example.com`);
  userIds.push(bob.user.id);
  const second = await connection.provisionUser(email);
  assert.equal(second.user.id, alice.user.id);
  const [stored] = await sql`select token_hash from credentials where id = ${alice.credentialId}`;
  assert.equal(stored.token_hash, hashToken(alice.token));
  assert.notEqual(stored.token_hash, alice.token);
  const app = createApp(connection.store);
  const auth = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const create = (token, name) => app.request('/v1/clans', { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) });
  const responses = await Promise.all([create(alice.token, 'Alice one'), create(alice.token, 'Alice two'), create(bob.token, 'Bob')]);
  assert.deepEqual(responses.map((r) => r.status), [201, 201, 201]);
  const [one, two, other] = await Promise.all(responses.map((r) => r.json()));
  assert.notEqual(one.id, two.id);
  assert.equal(one.createdBy, alice.user.id);
  const list = await app.request('/v1/clans', { headers: auth(alice.token) });
  assert.deepEqual(new Set((await list.json()).clans.map((c) => c.id)), new Set([one.id, two.id]));
  const members = await app.request(`/v1/clans/${one.id}/members`, { headers: auth(alice.token) });
  const [{ createdAt, ...leader }] = (await members.json()).members;
  assert.ok(Date.parse(createdAt));
  assert.deepEqual(leader, { userId: alice.user.id, email, role: 'leader' });
  for (const clanId of [other.id, randomUUID()]) {
    const response = await app.request(`/v1/clans/${clanId}/members`, { headers: auth(alice.token) });
    assert.equal(response.status, 404);
  }
  await assert.rejects(sql`insert into memberships (clan_id, user_id) values (${one.id}, ${alice.user.id})`, { code: '23505' });
  // A failed write must not leave a clan behind.
  const rollbackName = `rollback-${randomUUID()}`;
  await assert.rejects(connection.store.createClan(randomUUID(), rollbackName), (error) => error.cause?.code === '23503');
  const [count] = await sql`select count(*)::integer as n from clans where name = ${rollbackName}`;
  assert.equal(count.n, 0);
  // Exercise the built CLI against a real HTTP server and migrated PostgreSQL.
  const directory = await mkdtemp(join(tmpdir(), 'clqn-postgres-'));
  const server = await new Promise((resolve) => {
    const listener = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const env = { ...process.env, CLQN_CONFIG_DIR: directory };
  delete env.CLQN_TOKEN;
  const runCli = (args, input) => {
    const command = promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)),
      '--api-url', `http://127.0.0.1:${server.address().port}`, '--json', ...args,
    ], { env });
    command.child.stdin.end(input);
    return command.then(({ stdout }) => JSON.parse(stdout));
  };
  assert.deepEqual(await runCli(['login', '--token-stdin'], alice.token), alice.user);
  const cliClan = await runCli(['init', 'CLI project']);
  assert.equal(cliClan.createdBy, alice.user.id);
  assert.equal((await runCli(['members'])).members[0].role, 'leader');
  assert.equal((await runCli(['logout'])).credentialsRemoved, true);
  assert.equal(await connection.revokeCredential(alice.credentialId), true);
  assert.equal(await connection.revokeCredential(alice.credentialId), false);
  const denied = await app.request('/v1/me', { headers: auth(alice.token) });
  assert.equal(denied.status, 401);
  const allowed = await app.request('/v1/me', { headers: auth(second.token) });
  assert.equal(allowed.status, 200);
});
