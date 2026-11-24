import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ClqnClient } from '@clqn/shared';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { sourceNodeArgs } from '../../../scripts/test-node.js';
import { createApp } from '../src/app.js';
import { database, skip } from './postgres.js';

const cliPath = fileURLToPath(new URL('../../cli/src/index.ts', import.meta.url));

type ActivityEvent = { type: string; sequence: number; agentId: string | null; resourceId: string | null };

test('MVP acceptance: two people and two stdio agents share context, coordinate work, and observe progress', {
  skip,
  timeout: 30_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'clqn-acceptance-'));
  const clients: Client[] = [];
  let server: ReturnType<typeof serve> | undefined;
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (server) await new Promise((resolve) => server?.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const { db, connection, user } = await database(t);
  const alice = await user();
  const bob = await user();
  server = serve({ fetch: createApp(connection.store, db).fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete baseEnv.CLQN_TOKEN;
  delete baseEnv.CLQN_CLAN_ID;
  delete baseEnv.CLQN_AGENT_PROFILE;
  const aliceEnv = { ...baseEnv, CLQN_CONFIG_DIR: join(directory, 'alice'), CLQN_TOKEN: alice.token };
  const bobEnv = { ...baseEnv, CLQN_CONFIG_DIR: join(directory, 'bob'), CLQN_TOKEN: bob.token };
  const runRaw = async (env: Record<string, string>, args: string[], input?: string, json = true) => {
    const command = promisify(execFile)(
      process.execPath,
      [...sourceNodeArgs, cliPath, '--api-url', apiUrl, ...(json ? ['--json'] : []), ...args],
      { env, cwd: directory },
    );
    command.child.stdin?.end(input);
    return (await command).stdout;
  };
  const run = async (env: Record<string, string>, args: string[], input?: string) =>
    JSON.parse(await runRaw(env, args, input));
  // Clan setup happens in the interactive clqn prompt, so create and join through the API here.
  const clan = await new ClqnClient(apiUrl, alice.token).createClan(basename(directory));
  await run(aliceEnv, ['use', clan.name]);
  assert.doesNotMatch(await runRaw(aliceEnv, ['invite', bob.user.email], undefined, false), /clqn_inv_/);
  await new ClqnClient(apiUrl, bob.token).acceptInvitation(clan.id);
  await run(bobEnv, ['use', clan.name]);
  assert.equal((await run(aliceEnv, ['clans'])).clans.length, 1);
  // The chat connects each member's worker; add them directly here and use their saved connections.
  const addWorker = async (env: Record<string, string>, name: string, runtime: string) => {
    const added = await runRaw(env, ['agent', 'add', name, '--runtime', runtime], undefined, false);
    assert.doesNotMatch(added, /clqn_[A-Za-z0-9_-]{43}/);
    const agents = join(env.CLQN_CONFIG_DIR!, 'agents');
    const [file] = await readdir(agents);
    return join(agents, file!);
  };
  const codexProfile = await addWorker(aliceEnv, 'codex-alice', 'codex');
  const claudeProfile = await addWorker(bobEnv, 'claude-bob', 'claude');
  const { token: codexToken } = JSON.parse(await readFile(codexProfile, 'utf8'));
  const codexEnv = { ...aliceEnv, CLQN_AGENT_PROFILE: codexProfile };
  const claudeEnv = { ...bobEnv, CLQN_AGENT_PROFILE: claudeProfile };
  const codex = await run(codexEnv, ['whoami']);
  const claude = await run(claudeEnv, ['whoami']);
  assert.match(claude.agent.alias, /^claude-/);
  assert.equal(codex.agent.ownerId, alice.user.id);
  assert.equal(claude.agent.ownerId, bob.user.id);
  assert.equal((await run(bobEnv, ['agent', 'list'])).agents.length, 2);
  // An agent's scope wins over an unrelated clan saved by its human owner.
  const otherEnv = { ...baseEnv, CLQN_CONFIG_DIR: join(directory, 'other-human-clan'), CLQN_TOKEN: alice.token };
  const otherClan = await new ClqnClient(apiUrl, alice.token).createClan('Unrelated personal selection');
  await run(otherEnv, ['use', otherClan.name]);
  const scopedCodexEnv: Record<string, string> = { ...otherEnv, CLQN_TOKEN: codexToken };
  assert.equal(scopedCodexEnv.CLQN_CLAN_ID, undefined);
  const scopedMembers = await run(scopedCodexEnv, ['members']);
  assert.deepEqual(
    new Set(scopedMembers.members.map((member: { userId: string }) => member.userId)),
    new Set([alice.user.id, bob.user.id]),
  );
  const cleanAgentEnv = { ...baseEnv, CLQN_CONFIG_DIR: join(directory, 'agent-only'), CLQN_TOKEN: codexToken };
  assert.equal((await run(cleanAgentEnv, ['members'])).members.length, 2);
  const connectMcp = async (name: string, env: Record<string, string>) => {
    const client = new Client({ name, version: '1.0.0' });
    clients.push(client);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...sourceNodeArgs, cliPath, '--api-url', apiUrl, 'mcp'],
      cwd: directory,
      env,
      stderr: 'pipe',
    });
    (transport.stderr as Readable | null)?.resume();
    await client.connect(transport);
    return client;
  };
  const [aliceMcp, bobMcp] = await Promise.all([
    connectMcp('codex-acceptance', scopedCodexEnv),
    connectMcp('claude-acceptance', claudeEnv),
  ]);
  const expectedTools = [
    'clqn_read_context',
    'clqn_write_context',
    'clqn_list_context',
    'clqn_create_task',
    'clqn_claim_task',
    'clqn_complete_task',
    'clqn_list_tasks',
    'clqn_get_status',
  ];
  const listed = new Set((await aliceMcp.listTools()).tools.map((tool) => tool.name));
  for (const name of expectedTools) assert.ok(listed.has(name), `Missing MCP tool ${name}`);
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    const content = response.content as { text: string }[] | undefined;
    assert.notEqual(response.isError, true, `MCP ${name} failed: ${content?.[0]?.text}`);
    return JSON.parse(content?.[0]?.text ?? '');
  };
  assert.equal((await call(aliceMcp, 'clqn_get_status')).clan.id, clan.id);
  const aliceApi = new ClqnClient(apiUrl, alice.token);
  const bobApi = new ClqnClient(apiUrl, bob.token);
  const initial = await call(aliceMcp, 'clqn_write_context', {
    key: 'implementation',
    text: 'Alice: API work ready.',
    expectedRevision: 0,
  });
  assert.equal(initial.revision, 1);
  assert.equal((await call(bobMcp, 'clqn_read_context', { key: 'implementation' })).text, 'Alice: API work ready.');
  await call(bobMcp, 'clqn_write_context', {
    key: 'implementation',
    text: 'Bob: CLI work ready too.',
    expectedRevision: 1,
  });
  assert.equal((await call(aliceMcp, 'clqn_read_context', { key: 'implementation' })).revision, 2);
  assert.equal((await call(aliceMcp, 'clqn_read_context', { key: 'implementation' })).text, 'Bob: CLI work ready too.');
  assert.equal((await call(bobMcp, 'clqn_context_history', { key: 'implementation' })).revisions.length, 2);
  assert.equal((await call(aliceMcp, 'clqn_list_context')).entries.length, 1);
  const task = await call(aliceMcp, 'clqn_create_task', {
    description: 'Review shared implementation',
    alias: 'review',
  });
  assert.equal((await aliceApi.assignTask(clan.id, 'review', claude.agent.alias)).assignedAgentId, claude.agent.id);
  assert.equal((await call(bobMcp, 'clqn_claim_task', { taskId: 'review' })).ownerAgentId, claude.agent.id);
  const denied = await aliceMcp.callTool({ name: 'clqn_complete_task', arguments: { taskId: task.id } });
  assert.equal(denied.isError, true);
  assert.equal((await call(bobMcp, 'clqn_release_task', { taskId: task.id })).status, 'open');
  assert.equal((await call(aliceMcp, 'clqn_claim_task', { taskId: task.id })).ownerAgentId, codex.agent.id);
  assert.equal((await call(aliceMcp, 'clqn_complete_task', { taskId: task.id })).status, 'completed');
  const secondTask = await bobApi.createTask(clan.id, 'confirm', undefined, 'confirm');
  assert.equal(secondTask.alias, 'confirm');
  assert.equal(secondTask.description, 'confirm');
  assert.equal((await aliceApi.setTaskAlias(clan.id, 'confirm', 'verify')).id, secondTask.id);
  assert.equal((await bobApi.setAgentAlias(clan.id, claude.agent.alias, 'reviewer')).id, claude.agent.id);
  await call(bobMcp, 'clqn_claim_task', { taskId: 'verify' });
  assert.equal((await call(bobMcp, 'clqn_complete_task', { taskId: secondTask.id })).status, 'completed');
  assert.equal((await call(aliceMcp, 'clqn_list_tasks')).tasks.length, 2);
  assert.equal((await aliceApi.listTasks(clan.id)).tasks.length, 2);
  const status = await aliceApi.status(clan.id);
  assert.equal(status.clan.id, clan.id);
  assert.deepEqual(status.stats, { members: 2, agents: 2, tasks: { open: 0, claimed: 0, completed: 2 } });
  assert.equal((await call(bobMcp, 'clqn_get_status')).stats.tasks.completed, 2);
  const events: ActivityEvent[] = (
    await (
      await fetch(`${apiUrl}/v1/clans/${clan.id}/events`, { headers: { authorization: `Bearer ${bob.token}` } })
    ).json()
  ).events;
  assert.ok(events.some((event) => event.type === 'context.written' && event.agentId === codex.agent.id));
  assert.ok(events.some((event) => event.type === 'context.written' && event.agentId === claude.agent.id));
  assert.ok(events.some((event) => event.type === 'task.completed' && event.resourceId === task.id));
  assert.ok(events.every((event, i) => i === 0 || event.sequence > events[i - 1]!.sequence));
});
