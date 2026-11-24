import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ClqnClient } from '@clqn/shared';
import { readConfig, readServer, writeConfig } from '../src/config.js';
import { chooseClan, signIn, signOut } from '../src/setup.js';

type Handler = (request: IncomingMessage, body: unknown, response: ServerResponse) => void;

// Each test gets a private config directory and a local API that records requests.
async function fixture(t: TestContext, handler: Handler) {
  const directory = await mkdtemp(join(tmpdir(), 'clqn-setup-'));
  const requests: { path: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push({ path: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    handler(request, raw ? JSON.parse(raw) : undefined, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = { dir: process.env.CLQN_CONFIG_DIR, token: process.env.CLQN_TOKEN };
  process.env.CLQN_CONFIG_DIR = directory;
  delete process.env.CLQN_TOKEN;
  t.mock.method(console, 'error', () => undefined);
  t.after(async () => {
    if (previous.dir === undefined) delete process.env.CLQN_CONFIG_DIR;
    else process.env.CLQN_CONFIG_DIR = previous.dir;
    if (previous.token === undefined) delete process.env.CLQN_TOKEN;
    else process.env.CLQN_TOKEN = previous.token;
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { directory, requests, url };
}

const deviceStart = {
  handle: 'h'.repeat(43),
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 30,
  interval: 5,
};

// Answer prompts in order and record what was printed.
function scripted(answers: string[]) {
  const questions: string[] = [];
  const printed: string[] = [];
  return {
    questions,
    printed,
    ask: async (question: string) => {
      questions.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
      return answer;
    },
    print: (text: string) => printed.push(text),
  };
}

test('GitHub sign-in saves only the clqn token and the server, and retries a temporary poll failure', async (t) => {
  const token = `clqn_${'a'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  let polls = 0;
  const f = await fixture(t, (request, body, response) => {
    assert.equal(request.method, 'POST');
    if (request.url === '/auth/github/start') response.end(JSON.stringify(deviceStart));
    else if (++polls === 1) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: { code: 'GITHUB_LOGIN_FAILED', message: 'Try again' } }));
    } else {
      assert.deepEqual(body, { handle: deviceStart.handle });
      response.end(JSON.stringify({ status: 'complete', user, token }));
    }
  });
  const clanId = randomUUID();
  await writeConfig(f.url, { token: 'stale', clanId });
  assert.deepEqual(await signIn(f.url), user);
  assert.equal(polls, 2);
  // A new sign-in keeps the selected clan.
  assert.deepEqual(await readConfig(f.url), { token, clanId });
  assert.equal(await readServer(), f.url);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  const printed = (console.error as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls
    .map((call) => call.arguments.join(' '))
    .join('\n');
  assert.match(printed, /ABCD-EFGH/);
  assert.ok(!printed.includes(token));
});

test('choosing a clan opens an existing one, creates one, or reports no invitations', async (t) => {
  const userId = randomUUID();
  const existing = { id: randomUUID(), name: 'Existing', createdBy: userId, createdAt: new Date().toISOString() };
  const created = { ...existing, id: randomUUID(), name: basename(process.cwd()) };
  const token = `clqn_${'b'.repeat(43)}`;
  let clans = [existing];
  const f = await fixture(t, (request, body, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.url === '/v1/clans' && request.method === 'POST') {
      assert.deepEqual(body, { name: created.name });
      response.writeHead(201);
      response.end(JSON.stringify(created));
    } else if (request.url === '/v1/clans') response.end(JSON.stringify({ clans }));
    else if (request.url === '/v1/invitations') response.end(JSON.stringify({ invitations: [] }));
    else if (request.url === '/v1/me') response.end(JSON.stringify({ id: userId, email: 'me@example.com' }));
    else response.writeHead(404).end();
  });
  const connect = async () => new ClqnClient(f.url, token);

  const pickExisting = scripted(['9', '1']);
  assert.deepEqual(await chooseClan({ server: f.url, connect, canSignIn: true, ...pickExisting }), existing);
  assert.match(pickExisting.printed[0]!, /1\. Existing\n {2}2\. Create a clan\n {2}3\. Join a clan/);
  assert.equal(pickExisting.questions.length, 2);

  clans = [];
  const create = scripted(['2', '1', '']);
  assert.deepEqual(await chooseClan({ server: f.url, connect, canSignIn: true, ...create }), created);
  assert.match(create.printed.join('\n'), /No pending invitations\. Ask a clan leader to invite me@example\.com\./);
  assert.match(create.questions.at(-1)!, /^Clan name \(/);
});

test('joining a clan accepts the chosen invitation and refreshes a stale GitHub sign-in', async (t) => {
  const stale = `clqn_${'s'.repeat(43)}`;
  const token = `clqn_${'f'.repeat(43)}`;
  const user = { id: randomUUID(), email: 'verified@example.com' };
  const clan = { id: randomUUID(), name: 'Second', createdBy: randomUUID(), createdAt: new Date().toISOString() };
  const invitations = [
    { clanId: randomUUID(), clanName: 'First', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { clanId: clan.id, clanName: clan.name, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  ];
  const accepts: (string | undefined)[] = [];
  const f = await fixture(t, (request, body, response) => {
    if (request.url === '/auth/github/start') response.end(JSON.stringify(deviceStart));
    else if (request.url === '/auth/github/poll') response.end(JSON.stringify({ status: 'complete', user, token }));
    else if (request.url === '/v1/me') response.end(JSON.stringify(user));
    else if (request.url === '/v1/clans') response.end(JSON.stringify({ clans: [] }));
    else if (request.url === '/v1/invitations') response.end(JSON.stringify({ invitations }));
    else if (request.url === '/v1/invitations/accept') {
      assert.deepEqual(body, { clanId: clan.id });
      accepts.push(request.headers.authorization);
      if (request.headers.authorization === `Bearer ${stale}`) {
        response.writeHead(403);
        response.end(JSON.stringify({ error: { code: 'INVITATION_LOGIN_REQUIRED', message: 'Sign in again' } }));
      } else response.end(JSON.stringify(clan));
    } else response.writeHead(404).end();
  });
  await writeConfig(f.url, { token: stale });
  const connect = async () => new ClqnClient(f.url, (await readConfig(f.url)).token);
  const prompts = scripted(['2', '2', '2', '2']);
  assert.deepEqual(await chooseClan({ server: f.url, connect, canSignIn: true, ...prompts }), clan);
  assert.deepEqual(accepts, [`Bearer ${stale}`, `Bearer ${token}`]);
  assert.match(prompts.printed.join('\n'), /1\. First\n {2}2\. Second/);
  assert.equal((await readConfig(f.url)).token, token);
});

test('sign-in for an invitation rejects a different GitHub account without saving it', async (t) => {
  const token = `clqn_${'d'.repeat(43)}`;
  const f = await fixture(t, (request, _body, response) => {
    if (request.url === '/auth/github/start') response.end(JSON.stringify(deviceStart));
    else if (request.url === '/auth/github/poll')
      response.end(JSON.stringify({ status: 'complete', user: { id: randomUUID(), email: 'b@example.com' }, token }));
    else if (request.url === '/v1/logout') response.end(JSON.stringify({ revoked: true }));
    else response.writeHead(404).end();
  });
  await writeConfig(f.url, { token: 'original' });
  await assert.rejects(signIn(f.url, randomUUID()), /GitHub account that received the invitation/);
  assert.deepEqual(f.requests.at(-1), { path: '/v1/logout', authorization: `Bearer ${token}` });
  assert.deepEqual(await readConfig(f.url), { token: 'original' });
});

test('sign out revokes the saved token and removes local credentials and clan selection', async (t) => {
  const token = `clqn_${'e'.repeat(43)}`;
  let revoke = true;
  const f = await fixture(t, (request, _body, response) => {
    assert.equal(request.url, '/v1/logout');
    if (revoke) response.end(JSON.stringify({ revoked: true }));
    else response.writeHead(503).end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Down' } }));
  });
  await writeConfig(f.url, { token, clanId: randomUUID() });
  assert.equal(await signOut(f.url), 'Signed out.');
  assert.deepEqual(f.requests, [{ path: '/v1/logout', authorization: `Bearer ${token}` }]);
  assert.deepEqual(await readdir(f.directory), []);

  // Local removal still happens when the server cannot revoke the token; an environment token is left alone.
  revoke = false;
  await writeConfig(f.url, { token });
  process.env.CLQN_TOKEN = 'env_token';
  assert.match(await signOut(f.url), /could not be revoked.*CLQN_TOKEN is still set/);
  assert.deepEqual(await readConfig(f.url), {});
});
