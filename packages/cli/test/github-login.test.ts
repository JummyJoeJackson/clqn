import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { sourceNodeArgs } from '../../../scripts/test-node.js';
import { readConfig, readServer, writeConfig } from '../src/config.js';

const interactive = `data:text/javascript,${encodeURIComponent("Object.defineProperty(process.stdin, 'isTTY', { value: true })")}`;

test('GitHub CLI saves only clqn token, prints identity without credentials, uses POST polling', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clqn-github-'));
  const token = `clqn_${'a'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/github/start')
      res.end(
        JSON.stringify({
          handle: 'h'.repeat(43),
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 15,
          interval: 5,
        }),
      );
    else {
      assert.equal(req.url, '/auth/github/poll');
      assert.equal(body.handle, 'h'.repeat(43));
      res.end(JSON.stringify({ status: 'complete', user, token }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const result = await promisify(execFile)(
    process.execPath,
    [...sourceNodeArgs, 'packages/cli/src/index.ts', '--json', 'login', '--server', url, '--github'],
    {
      env: { ...process.env, CLQN_CONFIG_DIR: dir, CLQN_TOKEN: '' },
      timeout: 15000,
    },
  );
  assert.deepEqual(JSON.parse(result.stdout), user);
  assert.match(result.stderr, /ABCD-EFGH/);
  assert.equal((result.stdout + result.stderr).includes(token), false);
  const previous = process.env.CLQN_CONFIG_DIR;
  process.env.CLQN_CONFIG_DIR = dir;
  try {
    assert.equal((await readConfig(url)).token, token);
    assert.equal(await readServer(), url);
  } finally {
    if (previous === undefined) delete process.env.CLQN_CONFIG_DIR;
    else process.env.CLQN_CONFIG_DIR = previous;
  }
});

test('GitHub CLI login reuses the saved server and retries a temporary poll failure', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clqn-github-'));
  const token = `clqn_${'b'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  let polls = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/github/start')
      res.end(
        JSON.stringify({
          handle: 'h'.repeat(43),
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 30,
          interval: 5,
        }),
      );
    else if (++polls === 1) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: { code: 'GITHUB_LOGIN_FAILED', message: 'GitHub login failed; try again' } }));
    } else res.end(JSON.stringify({ status: 'complete', user, token }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(join(dir, 'server'), url, { mode: 0o600 });
  const result = await promisify(execFile)(
    process.execPath,
    [...sourceNodeArgs, 'packages/cli/src/index.ts', '--json', 'login', '--github'],
    {
      env: { ...process.env, CLQN_CONFIG_DIR: dir, CLQN_TOKEN: '', CLQN_API_URL: undefined },
      timeout: 30000,
    },
  );
  assert.deepEqual(JSON.parse(result.stdout), user);
  assert.equal(polls, 2);
});

test('first-time interactive init signs in and creates the clan without a separate login command', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clqn-init-'));
  const token = `clqn_${'c'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  const clan = { id: randomUUID(), name: 'My project', createdBy: user.id, createdAt: new Date().toISOString() };
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push(req.url!);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/github/start') {
      res.end(
        JSON.stringify({
          handle: 'h'.repeat(43),
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 15,
          interval: 5,
        }),
      );
    } else if (req.url === '/auth/github/poll') {
      res.end(JSON.stringify({ status: 'complete', user, token }));
    } else {
      assert.equal(req.url, '/v1/clans');
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      assert.deepEqual(JSON.parse(raw), { name: clan.name });
      res.end(JSON.stringify(clan));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const result = await promisify(execFile)(
    process.execPath,
    [
      ...sourceNodeArgs,
      '--import',
      interactive,
      'packages/cli/src/index.ts',
      'init',
      clan.name,
      '--api-url',
      url,
      '--json',
    ],
    {
      env: { ...process.env, CLQN_CONFIG_DIR: dir, CLQN_TOKEN: undefined },
      timeout: 15000,
    },
  );
  assert.deepEqual(JSON.parse(result.stdout), clan);
  assert.match(result.stderr, /ABCD-EFGH/);
  assert.ok(!(result.stdout + result.stderr).includes(token));
  assert.deepEqual(requests, ['/auth/github/start', '/auth/github/poll', '/v1/clans']);
});

test('interactive join refreshes stale GitHub sign-in and keeps the refreshed credential', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clqn-join-'));
  const stale = `clqn_${'s'.repeat(43)}`;
  const token = `clqn_${'f'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  const clan = { id: randomUUID(), name: 'My project', createdBy: randomUUID(), createdAt: new Date().toISOString() };
  const invitation = { clanId: clan.id, clanName: clan.name, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const accepts: (string | undefined)[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.setHeader('content-type', 'application/json');
    switch (req.url) {
      case '/auth/github/start':
        res.end(
          JSON.stringify({
            handle: 'h'.repeat(43),
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://github.com/login/device',
            expiresIn: 15,
            interval: 5,
          }),
        );
        break;
      case '/auth/github/poll':
        res.end(JSON.stringify({ status: 'complete', user, token }));
        break;
      case '/v1/me':
        res.end(JSON.stringify(user));
        break;
      case '/v1/invitations':
        res.end(JSON.stringify({ invitations: [invitation] }));
        break;
      case '/v1/invitations/accept':
        assert.deepEqual(JSON.parse(raw), { clanId: clan.id });
        accepts.push(req.headers.authorization);
        if (req.headers.authorization === `Bearer ${stale}`) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: { code: 'INVITATION_LOGIN_REQUIRED', message: 'Sign in again' } }));
        } else {
          assert.equal(req.headers.authorization, `Bearer ${token}`);
          res.end(JSON.stringify(clan));
        }
        break;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.CLQN_CONFIG_DIR;
  process.env.CLQN_CONFIG_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.CLQN_CONFIG_DIR;
    else process.env.CLQN_CONFIG_DIR = previous;
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeConfig(url, { token: stale });
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [...sourceNodeArgs, '--import', interactive, 'packages/cli/src/index.ts', 'join', '--api-url', url, '--json'],
    { env: { ...process.env, CLQN_TOKEN: undefined }, timeout: 15000 },
  );
  assert.deepEqual(JSON.parse(stdout), clan);
  assert.match(stderr, /ABCD-EFGH/);
  assert.ok(!stdout.includes(token) && !stderr.includes(token));
  assert.deepEqual(accepts, [`Bearer ${stale}`, `Bearer ${token}`]);
  assert.deepEqual(await readConfig(url), { token, clanId: clan.id });
});
