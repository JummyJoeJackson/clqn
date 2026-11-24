import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { database, skip } from './postgres.js';

test('PostgreSQL: logout and agent token revocation and rotation', {
  skip,
}, async (t) => {
  const { sql, connection, user } = await database(t);
  const alice = await user();
  const bob = await user();
  const carol = await user();
  const app = createApp(connection.store, connection.db);
  const post = (token: string, path: string, body: object = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const me = (token: string) => app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
  const clan = await (await post(alice.token, '/v1/clans', { name: 'Credentials' })).json();
  for (const user of [bob, carol]) {
    const invitation = await (
      await post(alice.token, `/v1/clans/${clan.id}/invitations`, { email: user.user.email })
    ).json();
    assert.equal((await post(user.token, '/v1/invitations/join', { code: invitation.code })).status, 200);
  }
  const agents = `/v1/clans/${clan.id}/agents`;
  const codex = await (await post(bob.token, agents, { name: 'Codex', alias: 'codex' })).json();
  // Only the owner can rotate; another member cannot revoke; agents cannot manage credentials.
  assert.equal((await post(alice.token, `${agents}/codex/token`)).status, 403);
  assert.equal((await post(carol.token, `${agents}/codex/revoke`)).status, 403);
  assert.equal((await post(codex.token, `${agents}/codex/revoke`)).status, 403);
  assert.equal((await post(bob.token, `${agents}/codex/token`, { extra: true })).status, 400);
  assert.equal((await post(bob.token, `${agents}/missing/token`)).status, 404);
  const rotated = await post(bob.token, `${agents}/codex/token`);
  assert.equal(rotated.status, 200);
  const { token: next, agent } = await rotated.json();
  assert.equal(agent.id, codex.agent.id);
  assert.equal((await me(codex.token)).status, 401);
  assert.equal((await me(next)).status, 200);
  // The leader can revoke any agent in the clan.
  const revoked = await post(alice.token, `${agents}/${codex.agent.id}/revoke`);
  assert.deepEqual(await revoked.json(), { agent: codex.agent, revoked: true });
  assert.equal((await me(next)).status, 401);
  // Revoked agents stay listed, marked inactive, until the owner issues a new token.
  const listed = async () =>
    (await (await app.request(agents, { headers: { authorization: `Bearer ${carol.token}` } })).json()).agents[0];
  assert.equal((await listed()).active, false);
  const revived = await (await post(bob.token, `${agents}/codex/token`)).json();
  assert.equal((await listed()).active, true);
  assert.equal((await post(alice.token, `${agents}/codex/revoke`)).status, 200);
  assert.equal((await me(revived.token)).status, 401);
  const events =
    await sql`select type from events where clan_id = ${clan.id} and resource_id = ${codex.agent.id} order by sequence`;
  assert.deepEqual(
    events.map((event) => event.type),
    ['agent.registered', 'agent.token_rotated', 'agent.revoked', 'agent.token_rotated', 'agent.revoked'],
  );
  // Logout revokes only the presented credential.
  const other = await user(alice.user.email);
  assert.deepEqual(await (await post(alice.token, '/v1/logout')).json(), { revoked: true });
  assert.equal((await me(alice.token)).status, 401);
  assert.equal((await me(other.token)).status, 200);
});
