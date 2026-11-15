import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, chmod } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { prepareWorktree, publishWorktree, inspectPullRequest, mergePullRequest } from '../dist/git.js';

const execute = promisify(execFile);
const git = async (cwd, args) => (await execute('git', args, { cwd, encoding: 'utf8' })).stdout.trim();
async function fixture(t) {
  const actualGit = (await execute('which', ['git'], { encoding: 'utf8' })).stdout.trim();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'clqn-git-')));
  const saved = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  });
  process.env.GIT_CONFIG_GLOBAL = devNull;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.GIT_CONFIG_COUNT;
  const remote = join(root, 'remote.git');
  const repoPath = join(root, 'personal');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['clone', remote, repoPath]);
  await git(repoPath, ['config', 'user.email', 'test@example.com']);
  await git(repoPath, ['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'file.txt'), 'base\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'base']);
  await git(repoPath, ['branch', '-M', 'main']);
  await git(repoPath, ['push', '-u', 'origin', 'main']);
  const baseSha = await git(repoPath, ['rev-parse', 'HEAD']);
  await git(repoPath, ['remote', 'set-url', 'origin', 'https://github.com/test/project.git']);
  const bin = join(root, 'bin');
  await mkdir(bin);
  const logPath = join(root, 'commands.jsonl');
  const prPath = join(root, 'pr.json');
  const ghScript = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLQN_TEST_LOG, JSON.stringify({file:'gh',args})+'\\n');
const path = process.env.CLQN_TEST_PR;
const pr = JSON.parse(fs.readFileSync(path, 'utf8'));
if(args[1] === 'list') process.stdout.write(JSON.stringify(process.env.CLQN_TEST_PR_EXISTS === '1' ? [pr] : []));
else if(args[1] === 'view') process.stdout.write(JSON.stringify(pr));
else if(args[1] === 'create') process.stdout.write(pr.url+'\\n');
else if(args[1] === 'merge') {
 if(process.env.CLQN_TEST_MERGE_PENDING !== '1') {
  pr.state = 'MERGED'; pr.mergeCommit = {oid: 'a'.repeat(40)};
  fs.writeFileSync(path,JSON.stringify(pr));
 }
} else process.exit(1);
`;
  const gitScript = `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLQN_TEST_LOG,JSON.stringify({file:'git',args})+'\\n');
const network = args.some(x => ['fetch','push','ls-remote'].includes(x));
const extra = network ? ['-c','url.'+process.env.CLQN_TEST_REMOTE+'.insteadOf=https://github.com/test/project.git','-c','protocol.file.allow=always'] : [];
const result = cp.spawnSync(process.env.CLQN_TEST_GIT,[...extra,...args],{stdio:'inherit'});
process.exit(result.status ?? 1);
`;
  await writeFile(join(bin, 'git'), gitScript); await chmod(join(bin, 'git'), 0o755);
  await writeFile(join(bin, 'gh'), ghScript); await chmod(join(bin, 'gh'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.CLQN_TEST_GIT = actualGit;
  process.env.CLQN_TEST_REMOTE = remote;
  process.env.CLQN_TEST_LOG = logPath;
  process.env.CLQN_TEST_PR = prPath;
  delete process.env.CLQN_TEST_PR_EXISTS;
  delete process.env.CLQN_TEST_MERGE_PENDING;
  const repository = { slug: 'test/project', baseBranch: 'main', baseSha, branch: 'clqn/task-123' };
  const worktreePath = join(root, 'task');
  const pr = (headSha, overrides = {}) => ({
    number: 7, url: 'https://github.com/test/project/pull/7', state: 'OPEN',
    headRefName: repository.branch, headRefOid: headSha, headRepository: { name: 'project' },
    headRepositoryOwner: { login: 'test' }, baseRefName: 'main', isCrossRepository: false,
    mergeCommit: null, statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  });
  const savePr = (value) => writeFile(prPath, JSON.stringify(value));
  const commands = async () => (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { root, repoPath, worktreePath, repository, baseSha, savePr, pr, commands, remote };
}

test('preparing a task worktree preserves a dirty personal checkout and starts at the recorded SHA', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repoPath, 'file.txt'), 'personal changes\n');
  await writeFile(join(f.repoPath, 'private.txt'), 'untracked\n');
  const before = await git(f.repoPath, ['status', '--porcelain=v1']);
  const prepared = await prepareWorktree(f);
  assert.deepEqual(prepared, { path: f.worktreePath, branch: f.repository.branch, baseSha: f.baseSha });
  assert.equal(await git(f.worktreePath, ['rev-parse', 'HEAD']), f.baseSha);
  assert.equal(await git(f.repoPath, ['symbolic-ref', '--short', 'HEAD']), 'main');
  assert.equal(await git(f.repoPath, ['status', '--porcelain=v1']), before);
  assert.equal(await readFile(join(f.repoPath, 'file.txt'), 'utf8'), 'personal changes\n');
  const commands = await f.commands();
  assert.ok(commands.some(({args}) => args.includes('fetch')));
  assert.ok(!commands.some(({args}) => args.some(x => ['pull', 'reset', 'stash', '--force'].includes(x))));
});

test('preparing refuses the wrong origin, unsafe refs, existing paths and an unrelated base', async (t) => {
  const f = await fixture(t);
  await assert.rejects(prepareWorktree({ ...f, repository: { ...f.repository, slug: 'other/repo' } }), /Origin does not match/);
  await git(f.repoPath, ['remote', 'set-url', '--push', 'origin', 'https://github.com/other/project.git']);
  await assert.rejects(prepareWorktree(f), /Origin does not match/);
  await git(f.repoPath, ['remote', 'set-url', '--push', 'origin', 'https://github.com/test/project.git']);
  for (const branch of ['--force', '../main', 'main@{1}', 'refs/heads/task', 'main;touch']) {
    await assert.rejects(prepareWorktree({ ...f, repository: { ...f.repository, branch } }));
  }
  await assert.rejects(prepareWorktree({ ...f, worktreePath: join(f.repoPath, 'task') }), /outside/);
  await assert.rejects(prepareWorktree({ ...f, worktreePath: join(f.repoPath, '..task') }), /outside/);
  await assert.rejects(prepareWorktree({ ...f, worktreePath: f.repoPath }), /already exists/);
  await git(f.repoPath, ['switch', '-c', 'unrelated']);
  await writeFile(join(f.repoPath, 'extra.txt'), 'not on main');
  await git(f.repoPath, ['add', '.']); await git(f.repoPath, ['commit', '-m', 'other']);
  const other = await git(f.repoPath, ['rev-parse', 'HEAD']);
  await assert.rejects(prepareWorktree({ ...f, repository: { ...f.repository, baseSha: other } }), /not on the fetched/);
});

async function taskCommit(f) {
  await prepareWorktree(f);
  await writeFile(join(f.worktreePath, 'task.txt'), 'task changes');
  await git(f.worktreePath, ['add', '.']); await git(f.worktreePath, ['commit', '-m', 'task']);
  return git(f.worktreePath, ['rev-parse', 'HEAD']);
}

test('publish pushes without force, creates or reuses the exact PR, and leaves the personal checkout alone', async (t) => {
  const f = await fixture(t);
  const headSha = await taskCommit(f);
  await f.savePr(f.pr(headSha));
  process.env.GH_HOST = 'enterprise.invalid';
  const result = await publishWorktree({ ...f, title: 'Task result', body: 'Reviewed task work' });
  assert.deepEqual(result, { headSha, prNumber: 7, prUrl: 'https://github.com/test/project/pull/7' });
  assert.equal(await git(f.repoPath, ['symbolic-ref', '--short', 'HEAD']), 'main');
  process.env.CLQN_TEST_PR_EXISTS = '1';
  assert.deepEqual(await publishWorktree({ ...f, title: 'Task result' }), result);
  await assert.rejects(prepareWorktree({ ...f, worktreePath: join(f.root, 'duplicate') }), /already exists on origin/);
  const commands = await f.commands();
  const pushes = commands.filter(({file,args}) => file === 'git' && args.includes('push'));
  assert.equal(pushes.length, 2);
  assert.ok(pushes.every(({args}) => args.includes(`HEAD:refs/heads/${f.repository.branch}`) && !args.includes('--force')));
  assert.equal(commands.filter(({file,args}) => file === 'gh' && args[1] === 'create').length, 1);
  assert.ok(commands.filter(({file}) => file === 'gh').every(({args}) => args[args.indexOf('--repo') + 1] === 'github.com/test/project'));
});

test('publish refuses dirty worktrees, the wrong branch, missing commits, and a mismatched PR', async (t) => {
  const f = await fixture(t);
  await prepareWorktree(f);
  await assert.rejects(publishWorktree({ ...f, title: 'Task result' }), /no commits/);
  await writeFile(join(f.worktreePath, 'task.txt'), 'uncommitted');
  await assert.rejects(publishWorktree({ ...f, title: 'Task result' }), /Commit or remove/);
  await git(f.worktreePath, ['add', '.']); await git(f.worktreePath, ['commit', '-m', 'task']);
  const headSha = await git(f.worktreePath, ['rev-parse', 'HEAD']);
  await assert.rejects(publishWorktree({ ...f, repository: { ...f.repository, branch: 'other' }, title: 'Task result' }), /not on the task branch/);
  await f.savePr(f.pr(headSha, { headRepositoryOwner: { login: 'attacker' } }));
  process.env.CLQN_TEST_PR_EXISTS = '1';
  await assert.rejects(publishWorktree({ ...f, title: 'Task result' }), /does not match/);
});

test('PR inspection validates identity and treats pending, failed, skipped-only, and missing checks as unpassed', async (t) => {
  const f = await fixture(t);
  const input = { repository: f.repository, prNumber: 7 };
  for (const statusCheckRollup of [[], null,
    [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null }],
    [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
    [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }],
    [{ __typename: 'StatusContext', state: 'PENDING' }],
  ]) {
    await f.savePr(f.pr(f.baseSha, { statusCheckRollup }));
    assert.equal((await inspectPullRequest(input)).checksPassed, false);
  }
  await f.savePr(f.pr(f.baseSha));
  assert.equal((await inspectPullRequest(input)).checksPassed, true);
  await f.savePr(f.pr(f.baseSha, { headRefName: 'other' }));
  await assert.rejects(inspectPullRequest(input), /does not match/);
  await f.savePr(f.pr(f.baseSha, { url: 'https://evil.example/pull/7' }));
  await assert.rejects(inspectPullRequest(input), /does not match/);
});

test('merge matches the reviewed head, respects pending queues, and reports only GitHub-confirmed merges', async (t) => {
  const f = await fixture(t);
  const input = { repository: f.repository, prNumber: 7, headSha: f.baseSha };
  await f.savePr(f.pr(f.baseSha, { statusCheckRollup: [] }));
  await assert.rejects(mergePullRequest(input), /at least one successful check/);
  await f.savePr(f.pr('b'.repeat(40)));
  await assert.rejects(mergePullRequest(input), /head changed/);
  await f.savePr(f.pr(f.baseSha));
  process.env.CLQN_TEST_MERGE_PENDING = '1';
  assert.equal((await mergePullRequest(input)).state, 'OPEN');
  delete process.env.CLQN_TEST_MERGE_PENDING;
  assert.equal((await mergePullRequest(input)).state, 'MERGED');
  assert.equal((await mergePullRequest(input)).state, 'MERGED');
  const merges = (await f.commands()).filter(({file,args}) => file === 'gh' && args[1] === 'merge');
  assert.equal(merges.length, 2);
  assert.ok(merges.every(({args}) => args.includes('--match-head-commit') && args.includes(f.baseSha)
    && !args.includes('--admin') && !args.includes('--auto')));
});
