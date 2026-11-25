import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { type ChatState, defaultChatSettings, type TaskRepository } from '@clqn/shared';
import { chatMerger, chatPullRequests, pullRequestKey, pullRequestsFrame } from '../src/pull-requests.js';

const clanId = 'clan';
const taskId = 'task';
const headSha = 'b'.repeat(40);
const mergeCommitSha = 'c'.repeat(40);
const title = 'Fix links';
const repository = {
  slug: 'owner/project',
  baseBranch: 'main',
  baseSha: 'a'.repeat(40),
  branch: 'clqn/task-1',
  headSha,
  prNumber: 7,
  prUrl: 'https://github.com/owner/project/pull/7',
  mergeCommitSha: null,
  state: 'open',
} satisfies TaskRepository;

function chat(repo: TaskRepository, leader: boolean): ChatState {
  return {
    session: { clan: 'Docs', host: 'leader@example.com' },
    settings: defaultChatSettings,
    messages: [],
    before: null,
    approvals: [],
    questions: [],
    runs: [
      {
        messageId: 'message',
        taskId,
        title,
        worker: 'Worker',
        repository: repo,
        estimatedTokens: 500,
        status: 'running',
        tokens: 15,
      },
    ],
    ...(leader ? { mergeQueue: [{ taskId, title, repository: repo }] } : {}),
    queued: 0,
    running: 0,
    usage: { tokens: 15, reserved: 0, agents: 0 },
  };
}

test('any member can find the PR and only the leader sees approval for the displayed head', () => {
  const view = { columns: 72, rows: 12, color: false, links: false, clan: 'Docs' };
  for (const leader of [false, true]) {
    const requests = chatPullRequests(chat(repository, leader));
    assert.equal(requests.length, 1);
    const selected = pullRequestKey(requests[0]!);
    const frame = pullRequestsFrame({ ...view, requests, selected }).lines.join('\n');
    assert.match(frame, /Fix links/);
    assert.match(frame, /https:\/\/github\.com\/owner\/project\/pull\/7/);
    assert.match(frame, /Commit b{12}/);
    assert.equal(frame.includes('Y Approve merge'), leader);
    const changed = chatPullRequests(chat({ ...repository, headSha: 'd'.repeat(40) }, leader));
    const stale = pullRequestsFrame({ ...view, requests: changed, selected }).lines.join('\n');
    assert.doesNotMatch(stale, /Y Approve merge/);
    assert.match(stale, /List changed/);
  }
});

test('the chat merger processes approved heads for the active leader and reports only GitHub-confirmed merges', async () => {
  const approved = { ...repository, mergeApproval: { headSha, approved: true } };
  const session = chat(approved, true);
  const task = {
    id: taskId,
    clanId,
    description: title,
    status: 'claimed' as const,
    ownerId: null,
    ownerAgentId: null,
    assignedAgentId: null,
    repository: approved as TaskRepository,
    createdAt: '',
    updatedAt: '',
  };
  const control = new AbortController();
  let authorized = true;
  let mergeCalls = 0;
  let writes = 0;
  const api = {
    chatInfo: async () => ({
      session: session.session,
      clan: 'Docs',
      canStart: authorized,
      settings: session.settings,
    }),
    repositories: async () => ({
      repositories: [{ id: 'repo', clanId, slug: repository.slug, createdAt: '', lastEventSequence: 0 }],
    }),
    task: async () => task,
    integrateTask: async (_clan: string, id: string, integration: { headSha: string; mergeCommitSha: string }) => {
      assert.equal(id, taskId);
      assert.deepEqual(integration, { headSha, mergeCommitSha });
      writes++;
      return { ...task, repository: { ...approved, state: 'merged' as const, mergeCommitSha } };
    },
  };
  const result = { headSha, url: repository.prUrl, checksPassed: true, checksReported: true };
  const merge = async (input: Parameters<typeof import('../src/git.js').mergePullRequest>[0]) => {
    assert.equal(input.headSha, headSha);
    assert.equal(input.waitForChecks, true);
    await input.beforeMerge?.();
    mergeCalls++;
    return { ...result, state: 'MERGED' as const, mergeCommitSha };
  };
  const merger = chatMerger(api, clanId, control.signal, merge);
  const requests = chatPullRequests(session);
  merger.update(chatPullRequests(chat(approved, false)));
  merger.update(chatPullRequests(chat(repository, true)));
  merger.update(chatPullRequests(chat({ ...approved, headSha: 'd'.repeat(40) }, true)));
  await setImmediate();
  assert.equal(mergeCalls, 0);
  const waiting = chatMerger(api, clanId, control.signal, async () => ({
    ...result,
    state: 'OPEN',
    mergeCommitSha: null,
    checksPassed: false,
  }));
  waiting.update(requests);
  await setImmediate();
  assert.match(waiting.status(pullRequestKey(requests[0]!))!, /Waiting for checks/);
  assert.equal(writes, 0);

  merger.update(requests);
  merger.update(requests);
  await setImmediate();
  assert.equal(mergeCalls, 1);
  assert.equal(writes, 1);
  assert.equal(merger.status(pullRequestKey(requests[0]!)), 'Merged');

  authorized = false;
  const formerLeader = chatMerger(api, clanId, control.signal, merge);
  formerLeader.update(requests);
  await setImmediate();
  assert.equal(mergeCalls, 1);
  assert.equal(writes, 1);
  assert.match(formerLeader.status(pullRequestKey(requests[0]!))!, /approval or pull request changed/);
});
