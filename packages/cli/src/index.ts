#!/usr/bin/env node
import { Command } from 'commander';
import { ApiError, ClqnClient, VERSION } from '@clqn/shared';
import { serveMcp } from '@clqn/mcp';

const program = new Command()
  .name('clqn')
  .description('Your agents. My agents. One workspace.')
  .version(VERSION)
  .option('--api-url <url>', 'clqn API URL', process.env.CLQN_API_URL ?? 'http://127.0.0.1:3000')
  .option('--json', 'output machine-readable JSON');

const client = () => new ClqnClient(program.opts().apiUrl as string);

program.command('health').description('Check API liveness (not clan status or database readiness)').action(async () => {
  const health = await client().health();
  console.log(program.opts().json ? JSON.stringify(health) : `${health.service} ${health.version}: ${health.status}`);
});

program.command('mcp').description('Start the local stdio MCP server for an agent').action(async () => {
  await serveMcp(client());
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
