import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { chatStateSchema, defaultChatSettings, linkedRepositorySetupSchema, taskSchema } from '@clqn/shared';
import { createApp } from '../src/app.js';
import { database, skip } from './postgres.js';

test('PostgreSQL: a chat claimant publishes a linked branch and the leader approves its exact head', {
  skip,
}, async (t) => {
  const { sql, connection, user } = await database(t);
  const [leader, member] = await Promise.all([user(), user()]);
  const clan = await connection.store.createClan(leader.user.id, 'Ship chat work');
  await sql`insert into memberships (clan_id, user_id) values (${clan.id}, ${member.user.id})`;
  const orchestrator = await connection.store.registerAgent(leader.user, clan.id, 'Orchestrator', 'orchestrator');
  const worker = await connection.store.registerAgent(member.user, clan.id, 'Worker');
  const app = createApp(connection.store, connection.db, { githubWebhookSecret: 'm'.repeat(32) });
  const request = (token: string, path: string, body?: object) =>
    app.request(`/v1/clans/${clan.id}${path}`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
  const state = async (token = member.token) =>
    chatStateSchema.parse(await (await request(token, '/chat/state')).json());
  const slug = 'example/ship';
  const link = linkedRepositorySetupSchema.parse(await (await request(leader.token, '/repositories', { slug })).json());
  assert.equal((await request(leader.token, '/chat/join', defaultChatSettings)).status, 200);
  assert.equal(
    (await request(member.token, '/chat/join', { ...defaultChatSettings, approval: 'automatic', agentLimit: 1 }))
      .status,
    200,
  );
  async function delegate(title: string) {
    const id = randomUUID();
    assert.equal((await request(member.token, '/chat/messages', { id, text: title })).status, 201);
    const response = await request(orchestrator.token, `/chat/messages/${id}/decision`, {
      action: 'delegate',
      title,
      description: title,
      workerId: worker.agent.id,
      estimatedTokens: 12,
    });
    assert.deepEqual(await response.json(), { status: 'handled', blocker: null });
    return (await state()).runs.find(({ messageId }) => messageId === id)!.taskId;
  }
  const id = await delegate('Ship the fix');
  const task = `/tasks/${id}`;
  const bind = (token: string, body: object) => request(token, `${task}/chat-repository`, body);
  const branch = `clqn/task-${id}`;
  const repository = { slug, branch, baseBranch: 'trunk', baseSha: 'a'.repeat(40) };
  assert.equal((await bind(worker.token, repository)).status, 409);
  assert.equal((await request(worker.token, `${task}/claim`, {})).status, 200);
  assert.equal((await bind(member.token, repository)).status, 409);
  assert.equal((await bind(worker.token, { ...repository, slug: 'example/unlinked' })).status, 409);
  assert.equal((await bind(worker.token, { ...repository, branch: 'work/other' })).status, 400);
  const bindings = await Promise.all([bind(worker.token, repository), bind(worker.token, repository)]);
  assert.deepEqual(
    bindings.map(({ status }) => status),
    [200, 200],
  );
  assert.equal((await state()).runs[0]?.repository?.state, 'pending');
  assert.deepEqual((await state()).usage, { agents: 0, tokens: 0, reserved: 12 });
  const nextTaskId = await delegate('Next assigned work');
  const prNumber = 42;
  const prUrl = `https://github.com/${slug}/pull/${prNumber}`;
  const publish = (headSha: string, expectedHeadSha: string | null) =>
    request(worker.token, `${task}/repository`, { headSha, expectedHeadSha, prNumber, prUrl });
  const firstHead = 'b'.repeat(40);
  const headSha = 'c'.repeat(40);
  assert.equal((await publish(firstHead, null)).status, 200);
  const decide = (token: string, head: string, approved = true) =>
    request(token, `${task}/merge-approval`, { headSha: head, approved });
  const mergeCommitSha = 'd'.repeat(40);
  const integrate = (token = leader.token) => request(token, `${task}/integration`, { headSha, mergeCommitSha });
  assert.equal((await decide(member.token, firstHead)).status, 403);
  assert.equal((await decide(orchestrator.token, firstHead)).status, 403);
  assert.equal((await decide(leader.token, firstHead, false)).status, 200);
  assert.equal((await decide(leader.token, firstHead)).status, 409);
  assert.deepEqual((await state(leader.token)).mergeQueue, []);
  assert.equal((await publish(headSha, firstHead)).status, 200);
  assert.equal((await decide(leader.token, firstHead)).status, 409);
  assert.equal((await integrate()).status, 409);
  assert.equal((await state()).mergeQueue, undefined);
  assert.equal((await state()).runs.find((run) => run.taskId === id)?.repository?.prUrl, prUrl);
  const approval = await Promise.all([decide(leader.token, headSha), decide(leader.token, headSha)]);
  assert.deepEqual(
    approval.map(({ status }) => status),
    [200, 200],
  );
  assert.equal((await publish(headSha, firstHead)).status, 200);
  assert.deepEqual((await state(leader.token)).mergeQueue?.[0]?.repository.mergeApproval, { headSha, approved: true });

  const signed = async (action: string, base = 'trunk', head = branch, headRepository = slug) => {
    const raw = JSON.stringify({
      action,
      number: prNumber,
      pull_request: {
        merged: action === 'closed',
        merge_commit_sha: mergeCommitSha,
        head: { sha: headSha, ref: head, repo: { full_name: headRepository } },
        base: { ref: base },
      },
      repository: { full_name: slug },
    });
    const response = await app.request(link.webhook.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': randomUUID(),
        'x-hub-signature-256': `sha256=${createHmac('sha256', link.webhook.secret).update(raw).digest('hex')}`,
      },
      body: raw,
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.equal((await integrate(orchestrator.token)).status, 403);
  assert.deepEqual(await signed('opened'), { accepted: true, ignored: true });
  assert.deepEqual(await signed('closed', 'incorrect-base'), { accepted: true, integrated: 0 });
  assert.deepEqual(await signed('closed', 'trunk', branch, 'other/fork'), { accepted: true, integrated: 0 });
  assert.equal(taskSchema.parse(await (await integrate()).json()).repository?.state, 'open');
  assert.deepEqual(await signed('closed'), { accepted: true, integrated: 1 });
  assert.deepEqual(await signed('closed'), { accepted: true, integrated: 0 });
  const merged = taskSchema.parse(await (await integrate()).json());
  assert.equal(merged.status, 'completed');
  assert.equal(merged.repository?.mergeCommitSha, mergeCommitSha);
  assert.equal((await state()).runs.find((run) => run.taskId === id)?.status, 'done');
  assert.deepEqual((await state(leader.token)).mergeQueue, []);
  const result = { id: randomUUID(), text: 'The changes are in the pull request.' };
  assert.equal((await request(worker.token, `/chat/tasks/${id}/usage`, { tokens: 7, result })).status, 200);
  const events = await sql`select type from events where resource_id = ${id} and type in
    ('task.repository_bound', 'task.merge_approved', 'task.integrated', 'task.completed') order by sequence`;
  assert.deepEqual(
    events.map(({ type }) => type),
    ['task.repository_bound', 'task.merge_approved', 'task.integrated', 'task.completed'],
  );

  // Removing the binding invalidates the pending review even if the leader already loaded the PR page.
  const next = `/tasks/${nextTaskId}`;
  assert.equal((await request(worker.token, `${next}/claim`, {})).status, 200);
  assert.equal(
    (await request(worker.token, `${next}/chat-repository`, { ...repository, branch: `clqn/task-${nextTaskId}` }))
      .status,
    200,
  );
  const nextPr = { expectedHeadSha: null, headSha, prNumber: 43, prUrl: `https://github.com/${slug}/pull/43` };
  assert.equal((await request(worker.token, `${next}/repository`, nextPr)).status, 200);
  assert.equal((await state(leader.token)).mergeQueue?.[0]?.taskId, nextTaskId);
  assert.equal((await request(leader.token, `/repositories/${link.repository.id}/unlink`, {})).status, 200);
  assert.equal((await request(leader.token, `${next}/merge-approval`, { headSha, approved: true })).status, 409);
  assert.deepEqual((await state(leader.token)).mergeQueue, []);
});
