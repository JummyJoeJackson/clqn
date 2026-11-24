import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chatMetricsSchema, defaultChatSettings, type SendChat } from '@clqn/shared';
import { createApp } from '../src/app.js';
import { database, skip } from './postgres.js';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test('PostgreSQL: chat metrics aggregate tokens, agents, members, tasks, and queue wait', {
  skip,
}, async (t) => {
  const { sql, connection, user: provision } = await database(t);
  const user = (name: string) => provision(`${name}-${randomUUID()}@example.com`);
  const [host, member, outsider] = await Promise.all([user('host'), user('member'), user('outsider')]);
  const clan = await connection.store.createClan(host.user.id, 'Metrics');
  await sql`insert into memberships (clan_id, user_id) values (${clan.id}, ${member.user.id})`;
  const coordinator = await connection.store.registerAgent(host.user, clan.id, 'Coordinator', 'orchestrator');
  const worker = await connection.store.registerAgent(member.user, clan.id, 'Docs worker');
  const app = createApp(connection.store, connection.db);
  const request = (token: string, suffix: string, body?: object) =>
    app.request(`/v1/clans/${clan.id}${suffix}`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
  const chat = (token: string, suffix: string, body?: object) => request(token, `/chat${suffix}`, body);
  const metrics = async (window: string) => {
    const response = await chat(member.token, `/metrics?window=${window}`);
    assert.equal(response.status, 200, await response.clone().text());
    return chatMetricsSchema.parse(await response.json());
  };
  async function send(token: string, text: string) {
    const message: SendChat = { id: randomUUID(), text };
    assert.equal((await chat(token, '/messages', message)).status, 201);
    return message;
  }

  assert.equal((await chat(host.token, '/join', defaultChatSettings)).status, 200);
  assert.equal((await chat(outsider.token, '/metrics')).status, 404);
  assert.equal((await chat(member.token, '/metrics')).status, 403);
  assert.equal((await chat(coordinator.token, '/metrics')).status, 403);
  assert.equal((await chat(member.token, '/join', { ...defaultChatSettings, tokenLimit: 100 })).status, 200);
  assert.equal((await chat(member.token, '/metrics?window=30d')).status, 400);

  const empty = await metrics('24h');
  assert.equal(empty.tokens.length, 24);
  assert.equal(sum(empty.tokens), 0);
  assert.deepEqual(empty.queue, { averageSeconds: null, longestSeconds: null, waiting: 0, oldestSeconds: null });

  const work = await send(member.token, 'Refresh the guide');
  await send(host.token, 'Still in the queue');
  const delegated = await chat(coordinator.token, `/messages/${work.id}/decision`, {
    action: 'delegate',
    title: 'Refresh the guide',
    description: 'Refresh the guide',
    workerId: worker.agent.id,
    estimatedTokens: 50,
  });
  assert.equal(delegated.status, 200, await delegated.clone().text());
  // Pretend the message waited 30 seconds in the queue.
  await sql`update chat_messages set created_at = decided_at - interval '30 seconds' where id = ${work.id}`;
  assert.equal((await chat(member.token, `/messages/${work.id}/approval`, { approve: true })).status, 200);
  const [task] = await sql<{ id: string }[]>`select task_id as id from chat_messages where id = ${work.id}`;
  assert.equal((await request(worker.token, `/tasks/${task!.id}/claim`, {})).status, 200);
  const running = await metrics('24h');
  assert.equal(running.agents.at(-1), 1);
  assert.equal(running.tasks[0]?.status, 'running');
  assert.equal((await chat(worker.token, `/tasks/${task!.id}/usage`, { tokens: 20 })).status, 200);
  assert.equal((await request(worker.token, `/tasks/${task!.id}/complete`, {})).status, 200);
  // Older reports count only in the 7-day window.
  await sql`insert into chat_token_hours values (${clan.id}, date_trunc('hour', now(), 'UTC') - interval '30 hours', 5)`;

  const day = await metrics('24h');
  assert.equal(day.window, '24h');
  assert.equal(day.bucketHours, 1);
  assert.equal(sum(day.tokens), 20);
  // The run spans the last bucket or two if the UTC hour turns during the test.
  assert.equal(Math.max(...day.agents.slice(-2)), 1);
  assert.equal(sum(day.agents.slice(0, -2)), 0);
  assert.equal(day.queueWait.filter((value) => value !== null).length, 1);
  assert.ok(Math.abs(day.queue.averageSeconds! - 30) < 1);
  assert.ok(Math.abs(day.queue.longestSeconds! - 30) < 1);
  assert.equal(day.queue.waiting, 1);
  assert.ok(day.queue.oldestSeconds! >= 0);
  const memberRow = day.members.find(({ name }) => name === member.user.email);
  assert.deepEqual(memberRow, { name: member.user.email, tokens: 20, reserved: 0, tokenLimit: 100 });
  assert.equal(day.members.find(({ name }) => name === host.user.email)?.tokens, 0);
  assert.deepEqual(day.tasks, [
    { title: 'Refresh the guide', worker: 'Docs worker', estimatedTokens: 50, status: 'done', tokens: 20 },
  ]);

  const week = await metrics('7d');
  assert.equal(week.bucketHours, 6);
  assert.equal(week.tokens.length, 28);
  assert.equal(week.agents.length, 28);
  assert.equal(sum(week.tokens), 25);
  assert.ok(Date.now() - Date.parse(week.start) < 7 * 24 * 3600 * 1000);
  assert.ok(Date.now() - Date.parse(week.start) > (7 * 24 - 1) * 3600 * 1000);
});
