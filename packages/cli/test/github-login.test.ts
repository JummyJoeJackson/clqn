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
import { readConfig, readServer } from '../src/config.js';

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
  const interactive = `data:text/javascript,${encodeURIComponent("Object.defineProperty(process.stdin, 'isTTY', { value: true })")}`;
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
