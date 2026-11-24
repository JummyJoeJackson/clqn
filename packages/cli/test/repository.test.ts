import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Actor, Task, TaskRepository } from '@clqn/shared';
import { sourceNodeArgs } from '../../../scripts/test-node.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const clanId = 'bf689cc3-c719-4ce6-a681-d56b43526fed';
const userId = '59b55e8d-0eb5-42fb-aead-f9e665406277';
const taskId = '7630f779-401b-4fe3-b7ba-b624dfc0e92d';
const agentId = 'e0d647e2-03ef-484c-94af-872964e2bfec';
const baseSha = 'a'.repeat(40);
const repository: TaskRepository = {
  slug: 'example/project',
  baseBranch: 'main',
  baseSha,
  branch: 'clqn/task-1',
  headSha: null,
  prNumber: null,
  prUrl: null,
  mergeCommitSha: null,
  state: 'pending',
};
const initialTask: Task = {
  id: taskId,
  clanId,
  description: 'Implement endpoint',
  status: 'open',
  ownerId: null,
  ownerAgentId: null,
  assignedAgentId: null,
  repository: null,
  createdAt: '2026-11-14T12:00:00.000Z',
  updatedAt: '2026-11-14T12:00:00.000Z',
};

async function fixture(
  t: TestContext,
  {
    actor = { id: userId, email: 'member@example.com' },
    task = initialTask,
    role = 'member',
  }: { actor?: Actor; task?: Task; role?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'clqn-repository-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const token = `clqn_${'r'.repeat(43)}`;
  const requests: {
    method: string | undefined;
    path: string | undefined;
    authorization: string | undefined;
    body: unknown;
  }[] = [];
  let value = { ...task };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }));
      return;
    }
    if (request.url === '/v1/me') response.end(JSON.stringify(actor));
    else if (request.url === '/v1/agent')
      response.end(
        JSON.stringify({
          id: actor.agentId,
          ownerId: actor.id,
          clanId,
          name: 'Worker',
          role: 'worker',
          createdAt: initialTask.createdAt,
        }),
      );
    else if (request.url === `/v1/clans/${clanId}/members`)
      response.end(
        JSON.stringify({
          members: [
            {
              userId: actor.id,
              email: actor.email,
              role,
              createdAt: initialTask.createdAt,
            },
          ],
        }),
      );
    else if (request.url === `/v1/clans/${clanId}/agents` && request.method === 'POST') {
      response.writeHead(201);
      response.end(
        JSON.stringify({
          agent: {
            id: agentId,
            ownerId: actor.id,
            clanId,
            name: body.name,
            role: body.role,
            createdAt: initialTask.createdAt,
          },
          token,
        }),
      );
    } else if (request.url === `/v1/clans/${clanId}/tasks` && request.method === 'POST') {
      value = {
        ...initialTask,
        description: body.description,
        repository: body.repository ? { ...repository, ...body.repository } : null,
      };
      response.writeHead(201);
      response.end(JSON.stringify(value));
    } else if (request.url === `/v1/clans/${clanId}/tasks/${taskId}/assign` && request.method === 'POST') {
      value = { ...value, assignedAgentId: body.agentId };
      response.end(JSON.stringify(value));
    } else if (request.url === `/v1/clans/${clanId}/tasks/${taskId}/claim` && request.method === 'POST') {
      value = { ...value, status: 'claimed', ownerId: actor.id };
      response.end(JSON.stringify(value));
    } else if (
      request.method === 'GET' &&
      [value.id, value.alias].filter(Boolean).some((ref) => request.url === `/v1/clans/${clanId}/tasks/${ref}`)
    )
      response.end(JSON.stringify(value));
    else {
      response.writeHead(404);
      response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const executions = join(directory, 'executions');
  // These sentinels make an unexpected subprocess visible without contacting GitHub.
  for (const executable of ['git', 'gh'])
    await writeFile(join(bin, executable), '#!/bin/sh\necho invoked >> "$CLQN_TEST_EXECUTIONS"\nexit 91\n', {
      mode: 0o700,
    });
  const call = (args: string[]) =>
    run(process.execPath, [...sourceNodeArgs, cli, '--api-url', apiUrl, ...args], {
      env: {
        ...process.env,
        CLQN_CONFIG_DIR: join(directory, 'config'),
        CLQN_TOKEN: token,
        CLQN_CLAN_ID: clanId,
        CLQN_TEST_EXECUTIONS: executions,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
  const assertNoExecutions = () => assert.rejects(readFile(executions), { code: 'ENOENT' });
  return { call, requests, directory, token, assertNoExecutions };
}

test('agent add forwards an explicit orchestrator role and defaults to worker', async (t) => {
  const f = await fixture(t);
  const orchestrator = JSON.parse((await f.call(['agent', 'add', 'Coordinator', '--orchestrator', '--json'])).stdout);
  assert.deepEqual(f.requests[0]?.body, { name: 'Coordinator', role: 'orchestrator' });
  assert.equal(orchestrator.agent.role, 'orchestrator');
  const worker = JSON.parse((await f.call(['agent', 'add', 'Worker', '--json'])).stdout);
  assert.deepEqual(f.requests[1]?.body, { name: 'Worker', role: 'worker' });
  assert.equal(worker.agent.role, 'worker');
});

test('whoami keeps human identity and includes agent registration for agent credentials', async (t) => {
  const human = { id: userId, email: 'member@example.com' };
  const personal = await fixture(t, { actor: human });
  assert.deepEqual(JSON.parse((await personal.call(['whoami', '--json'])).stdout), human);
  assert.deepEqual(
    personal.requests.map((request) => request.path),
    ['/v1/me'],
  );
  const actor = { ...human, agentId, clanId };
  const scoped = await fixture(t, { actor });
  const identity = JSON.parse((await scoped.call(['whoami', '--json'])).stdout);
  assert.deepEqual(identity, {
    ...actor,
    agent: { id: agentId, ownerId: userId, clanId, name: 'Worker', role: 'worker', createdAt: initialTask.createdAt },
  });
  const output = (await scoped.call(['whoami'])).stdout;
  assert.equal(output, `Worker (worker)\nSigned in for ${human.email}\n`);
  assert.deepEqual(
    scoped.requests.map((request) => request.path),
    ['/v1/me', '/v1/agent', '/v1/me', '/v1/agent'],
  );
});
