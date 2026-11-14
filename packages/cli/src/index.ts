#!/usr/bin/env node
import { Command } from 'commander';
import { ApiError, ClqnClient, VERSION } from '@clqn/shared';
import { serveMcp } from '@clqn/mcp';
import { readConfig, removeConfig, writeConfig } from './config.js';

const program = new Command()
  .name('clqn')
  .description('Your agents. My agents. One workspace.')
  .version(VERSION)
  .option('--api-url <url>', 'clqn API URL', process.env.CLQN_API_URL ?? 'http://127.0.0.1:3000')
  .option('--json', 'output machine-readable JSON');

const apiUrl = () => program.opts().apiUrl as string;
const output = (value: unknown, human: string) => console.log(program.opts().json ? JSON.stringify(value) : human);
const client = async () => new ClqnClient(apiUrl(), process.env.CLQN_TOKEN ?? (await readConfig(apiUrl())).token);

program.command('health').description('Check API liveness (not clan status or database readiness)').action(async () => {
  const health = await new ClqnClient(apiUrl()).health();
  output(health, `${health.service} ${health.version}: ${health.status}`);
});

program.command('login').description('Save a server-provisioned user token for this API')
  .option('--token-stdin', 'read the token from standard input')
  .action(async (options: { tokenStdin?: boolean }) => {
    if (!options.tokenStdin) throw new Error('Use login --token-stdin and pipe a server-provisioned token to standard input');
    if (process.stdin.isTTY) throw new Error('--token-stdin requires piped input');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > 4096) throw new Error('Token input is too long');
      chunks.push(buffer);
    }
    const token = Buffer.concat(chunks).toString('utf8').trim();
    if (!token || /\s/.test(token)) throw new Error('Provide one nonempty token on standard input');
    const user = await new ClqnClient(apiUrl(), token).whoami();
    await writeConfig(apiUrl(), { token });
    output(user, `Logged in as ${user.email}`);
  });

program.command('logout').description('Remove local credentials and selected clan for this API (does not revoke the token)')
  .action(async () => {
    await removeConfig(apiUrl());
    const environmentTokenActive = Boolean(process.env.CLQN_TOKEN);
    output({ credentialsRemoved: true, environmentTokenActive }, environmentTokenActive
      ? 'Local credentials removed. CLQN_TOKEN is still set; unset it to stop using that token.'
      : 'Local credentials removed.');
  });

program.command('whoami').description('Show the authenticated user').action(async () => {
  const user = await (await client()).whoami();
  output(user, `${user.email} (${user.id})`);
});

program.command('init <name>').description('Create a clan and select it for this API').action(async (name: string) => {
  const config = await readConfig(apiUrl());
  const clan = await (await client()).createClan(name);
  await writeConfig(apiUrl(), { ...config, clanId: clan.id });
  output(clan, `Created ${clan.name} (${clan.id})`);
});

program.command('clans').description('List your clans').action(async () => {
  const result = await (await client()).listClans();
  output(result, result.clans.map((clan) => `${clan.id}  ${clan.name}`).join('\n') || 'No clans yet.');
});

program.command('members').description('List clan members').option('--clan <id>', 'clan ID (defaults to the last clan created with init)')
  .action(async (options: { clan?: string }) => {
    const clanId = options.clan ?? (await readConfig(apiUrl())).clanId;
    if (!clanId) throw new Error('Select a clan with --clan <id> or create one with init <name>');
    const result = await (await client()).members(clanId);
    output(result, result.members.map((member) => `${member.email}  ${member.role}  ${member.userId}`).join('\n') || 'No members.');
  });

program.command('mcp').description('Start the local stdio MCP server for an agent').action(async () => {
  await serveMcp(await client());
});

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Command failed';
  console.error(program.opts().json ? JSON.stringify({ error: {
    code: error instanceof ApiError ? error.code : 'COMMAND_FAILED', message,
  } }) : `Error: ${message}`);
  process.exitCode = 1;
}
