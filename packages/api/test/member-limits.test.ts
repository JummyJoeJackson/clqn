import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chatSettingsSchema, defaultChatSettings } from '@clqn/shared';
import { createApp } from '../src/app.js';
import { database, skip } from './postgres.js';

test('chat settings hold every member limit and default to full access', () => {
  assert.deepEqual(defaultChatSettings, {
    approval: 'manual',
    tokenLimit: null,
    agentLimit: null,
    allowedModels: null,
    commands: 'sandboxed',
  });
  for (const settings of [
    { ...defaultChatSettings, tokenLimit: -1 },
    { ...defaultChatSettings, agentLimit: 1.5 },
    { ...defaultChatSettings, allowedModels: [] },
    { ...defaultChatSettings, allowedModels: ['two words'] },
    { ...defaultChatSettings, allowedModels: ['a', 'a'] },
    { ...defaultChatSettings, commands: 'everything' },
    { ...defaultChatSettings, userId: randomUUID() },
  ])
    assert.equal(chatSettingsSchema.safeParse(settings).success, false, JSON.stringify(settings));
});

test('PostgreSQL: members set only their own limits before a session, and edits stay whole', { skip }, async (t) => {
  const { sql, connection, user } = await database(t);
  const [leader, member, outsider] = await Promise.all(
    ['leader', 'member', 'outsider'].map((name) => user(`${name}-${randomUUID()}@example.com`)),
  );
  const clan = await connection.store.createClan(leader!.user.id, 'Limits');
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
  const custom = { approval: 'manual', tokenLimit: 1000, agentLimit: 2, allowedModels: ['model-a'], commands: 'off' };
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
    { approval: 'automatic', tokenLimit: 5, agentLimit: null, allowedModels: null, commands: 'sandboxed' },
    { approval: 'manual', tokenLimit: null, agentLimit: 9, allowedModels: ['model-b'], commands: 'unrestricted' },
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
