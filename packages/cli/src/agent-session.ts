import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { agentRegistrationSchema, agentSchema, ClqnClient } from '@clqn/shared';
import { configDirectory, writePrivateJson } from './config.js';

export const runtimes = ['codex', 'claude'] as const;
export type Runtime = (typeof runtimes)[number];

export type AgentProfile = {
  agentId: string;
  clanId: string;
  server: string;
  token: string;
  runtime?: Runtime | undefined;
};

export function agentProfilePath(server: string, agentId: string): string {
  const origin = new URL(server).origin;
  const hash = createHash('sha256').update(origin).digest('hex');
  return resolve(configDirectory(), 'agents', `${hash}-${agentId}.json`);
}

export async function readAgentProfile(path: string): Promise<AgentProfile | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const profile = {
      agentId: agentSchema.shape.id.parse(value.agentId),
      clanId: agentSchema.shape.clanId.parse(value.clanId),
      server: new URL(value.server).origin,
      token: agentRegistrationSchema.shape.token.parse(value.token),
      runtime: runtimes.find((runtime) => runtime === value.runtime),
    };
    new ClqnClient(profile.server, profile.token);
    return profile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Could not read the saved agent connection.');
  }
}

export async function saveAgentProfile(profile: AgentProfile): Promise<void> {
  await writePrivateJson(agentProfilePath(profile.server, profile.agentId), profile);
}

export async function runAgentSession(runtime: Runtime, profilePath: string, project: string): Promise<void> {
  if (!(await stat(project).catch(() => undefined))?.isDirectory())
    throw new Error('Choose an existing project directory with --path.');
  const command = process.execPath;
  const args = [resolve(process.argv[1]!), 'mcp', '--profile', profilePath, '--path', project];
  const runtimeArgs =
    runtime === 'codex'
      ? [
          '-c',
          `mcp_servers.clqn={command=${JSON.stringify(command)},args=${JSON.stringify(args)}}`,
          '-c',
          `shell_environment_policy.set.CLQN_AGENT_PROFILE=${JSON.stringify(profilePath)}`,
        ]
      : ['--mcp-config', JSON.stringify({ mcpServers: { clqn: { type: 'stdio', command, args } } })];
  const env: NodeJS.ProcessEnv = { ...process.env, CLQN_AGENT_PROFILE: profilePath };
  delete env.CLQN_TOKEN;
  delete env.CLQN_CLAN_ID;
  await new Promise<void>((done, fail) => {
    const child = spawn(runtime, runtimeArgs, { cwd: project, env, stdio: 'inherit' });
    child.once('error', (error: NodeJS.ErrnoException) =>
      fail(
        new Error(
          error.code === 'ENOENT'
            ? `Install ${runtime === 'codex' ? 'Codex CLI (codex)' : 'Claude Code (claude)'} and make sure it is on PATH.`
            : `Could not start ${runtime}.`,
        ),
      ),
    );
    child.once('exit', (code, signal) => {
      if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 1;
      else if (code) process.exitCode = code;
      done();
    });
  });
}
