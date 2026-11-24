import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/db/store.js';
import { database, skip } from './postgres.js';

test('PostgreSQL: identity, clan isolation, concurrent creation, and credential revocation', {
  skip,
}, async (t) => {
  const { sql, connection, user } = await database(t);
  const email = `${randomUUID()}@example.com`;
  const alice = await user(email);
  const bob = await user();
  const second = await user(email);
  assert.equal(second.user.id, alice.user.id);
  const [stored] = await sql`select token_hash from credentials where id = ${alice.credentialId}`;
  assert.equal(stored?.token_hash, hashToken(alice.token));
  assert.notEqual(stored?.token_hash, alice.token);
  const app = createApp(connection.store, connection.db);
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const create = (token: string, name: string) =>
    app.request('/v1/clans', { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) });
  const responses = await Promise.all([
    create(alice.token, 'Alice one'),
    create(alice.token, 'Alice two'),
    create(bob.token, 'Bob'),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201, 201],
  );
  const [one, two, other] = await Promise.all(responses.map((r) => r.json()));
  assert.notEqual(one.id, two.id);
  assert.equal(one.createdBy, alice.user.id);
  const list = await app.request('/v1/clans', { headers: auth(alice.token) });
  assert.deepEqual(new Set((await list.json()).clans.map((c: { id: string }) => c.id)), new Set([one.id, two.id]));
  const members = await app.request(`/v1/clans/${one.id}/members`, { headers: auth(alice.token) });
  const [{ createdAt, ...leader }] = (await members.json()).members;
  assert.ok(Date.parse(createdAt));
  assert.deepEqual(leader, { userId: alice.user.id, email, role: 'leader' });
  for (const clanId of [other.id, randomUUID()]) {
    const response = await app.request(`/v1/clans/${clanId}/members`, { headers: auth(alice.token) });
    assert.equal(response.status, 404);
  }
  await assert.rejects(sql`insert into memberships (clan_id, user_id) values (${one.id}, ${alice.user.id})`, {
    code: '23505',
  });
  // A failed write must not leave a clan behind.
  const rollbackName = `rollback-${randomUUID()}`;
  await assert.rejects(
    connection.store.createClan(randomUUID(), rollbackName),
    (error) => (error as { cause?: { code?: string } }).cause?.code === '23503',
  );
  const [count] = await sql`select count(*)::integer as n from clans where name = ${rollbackName}`;
  assert.equal(count?.n, 0);
  // Invitations must be leader-only, email-bound, expiring, and single-use under contention.
  const invite = (token: string, clanId: string, email: string) =>
    app.request(`/v1/clans/${clanId}/invitations`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ email }),
    });
  const joinClan = (token: string, code: string) =>
    app.request('/v1/invitations/join', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ code }),
    });
  assert.equal((await invite(bob.token, one.id, bob.user.email)).status, 404);
  const invitationResponse = await invite(alice.token, one.id, ` ${bob.user.email.toUpperCase()} `);
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  assert.equal(invitation.email, bob.user.email);
  const [storedInvite] = await sql`select code_hash from invitations where code_hash = ${hashToken(invitation.code)}`;
  assert.equal(storedInvite?.code_hash, hashToken(invitation.code));
  assert.equal((await joinClan(alice.token, invitation.code)).status, 404);
  const joins = await Promise.all([joinClan(bob.token, invitation.code), joinClan(bob.token, invitation.code)]);
  assert.deepEqual(joins.map((r) => r.status).sort(), [200, 404]);
  const joinedMembers = await app.request(`/v1/clans/${one.id}/members`, { headers: auth(bob.token) });
  assert.equal((await joinedMembers.json()).members.length, 2);
  assert.equal((await invite(bob.token, one.id, alice.user.email)).status, 404);
  const duplicate = await (await invite(alice.token, one.id, bob.user.email)).json();
  assert.equal((await joinClan(bob.token, duplicate.code)).status, 409);
  const [unconsumed] = await sql`select consumed_at from invitations where code_hash = ${hashToken(duplicate.code)}`;
  assert.equal(unconsumed?.consumed_at, null);
  const expired = await (await invite(alice.token, two.id, bob.user.email)).json();
  await sql`update invitations set expires_at = now() - interval '1 second' where code_hash = ${hashToken(expired.code)}`;
  assert.equal((await joinClan(bob.token, expired.code)).status, 404);
  const [joinedEvents] =
    await sql`select count(*)::integer as n from events where clan_id = ${one.id} and type = 'member.joined'`;
  assert.equal(joinedEvents?.n, 1);
  // Agents inherit the human identity but have an independent, clan-scoped credential.
  const register = (token: string, clanId: string, name: string) =>
    app.request(`/v1/clans/${clanId}/agents`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name }),
    });
  assert.equal((await register(bob.token, two.id, 'Outsider')).status, 404);
  const registrationResponse = await register(alice.token, one.id, 'Codex');
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  assert.equal(registration.agent.ownerId, alice.user.id);
  const [agentCredential] = await sql`select id, token_hash from credentials where agent_id = ${registration.agent.id}`;
  assert.equal(agentCredential?.token_hash, hashToken(registration.token));
  const actor = await connection.store.authenticate(hashToken(registration.token));
  assert.deepEqual(actor, { ...alice.user, agentId: registration.agent.id, clanId: one.id });
  const current = await app.request('/v1/agent', { headers: auth(registration.token) });
  assert.deepEqual(await current.json(), registration.agent);
  assert.equal((await app.request(`/v1/clans/${one.id}/members`, { headers: auth(registration.token) })).status, 200);
  assert.equal((await app.request(`/v1/clans/${two.id}/members`, { headers: auth(registration.token) })).status, 404);
  const agentClans = await app.request('/v1/clans', { headers: auth(registration.token) });
  assert.deepEqual(
    (await agentClans.json()).clans.map((c: { id: string }) => c.id),
    [one.id],
  );
  assert.equal(await connection.revokeCredential(agentCredential?.id), true);
  assert.equal((await app.request('/v1/agent', { headers: auth(registration.token) })).status, 401);
});
