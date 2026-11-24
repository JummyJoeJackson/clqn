import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { agentRegistrationSchema, agentSchema, ClqnClient } from '@clqn/shared';
import { configDirectory, writePrivateJson } from './config.js';

export const runtimes = ['codex', 'claude'] as const;
export type Runtime = (typeof runtimes)[number];

// CLQN_RUNTIME=claude or codex picks the agent CLI when both are installed.
export const runtimeSetting = () => runtimes.find((runtime) => runtime === process.env.CLQN_RUNTIME);

export async function detectAgentRuntime(preferred = runtimeSetting()): Promise<Runtime> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const runtime of preferred ? [preferred] : runtimes) {
    const executable = await Promise.any(
      directories.map(async (directory) => {
        const path = resolve(directory, runtime);
        await access(path, constants.X_OK);
        if (!(await stat(path)).isFile()) throw new Error();
        return path;
      }),
    ).catch(() => undefined);
    if (executable) return runtime;
  }
  if (preferred)
    throw new Error(
      `Install ${preferred === 'codex' ? 'Codex CLI' : 'Claude Code'} and make sure ${preferred} is on PATH.`,
    );
  throw new Error('Install Codex CLI or Claude Code to run agents. Make sure codex or claude is on PATH.');
}

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

export interface AgentCommand {
  command: Runtime;
  args: string[];
  env: NodeJS.ProcessEnv;
}

// A non-interactive runtime run with the agent's clqn MCP server. The prompt goes to stdin, so chat text never
// appears in argv. The orchestrator may only use clqn tools; workers may also edit files in their workspace.
export function agentCommand(
  runtime: Runtime,
  profilePath: string,
  options: { project: string; role: 'orchestrator' | 'worker'; model?: string | null | undefined },
): AgentCommand {
  const command = process.execPath;
  const args = [resolve(process.argv[1]!), 'mcp', '--profile', profilePath, '--path', options.project];
  const model = options.model ? (runtime === 'codex' ? ['-m', options.model] : ['--model', options.model]) : [];
  const runtimeArgs =
    runtime === 'codex'
      ? [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--sandbox',
          options.role === 'worker' ? 'workspace-write' : 'read-only',
          ...model,
          '-c',
          `mcp_servers.clqn={command=${JSON.stringify(command)},args=${JSON.stringify(args)}}`,
          '-c',
          `shell_environment_policy.set.CLQN_AGENT_PROFILE=${JSON.stringify(profilePath)}`,
          '-',
        ]
      : [
          '--print',
          '--output-format',
          'json',
          ...model,
          '--strict-mcp-config',
          '--mcp-config',
          JSON.stringify({ mcpServers: { clqn: { type: 'stdio', command, args } } }),
          '--permission-mode',
          options.role === 'worker' ? 'acceptEdits' : 'default',
          '--allowedTools',
          'mcp__clqn',
        ];
  const env: NodeJS.ProcessEnv = { ...process.env, CLQN_AGENT_PROFILE: profilePath };
  delete env.CLQN_TOKEN;
  delete env.CLQN_CLAN_ID;
  return { command: runtime, args: runtimeArgs, env };
}

type Json = { [key: string]: unknown };
const object = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const count = (...values: unknown[]) =>
  values.reduce<number>((sum, value) => sum + (typeof value === 'number' && value > 0 ? value : 0), 0);

// Total input and output tokens and the final message from a finished run's stdout.
export function agentOutput(runtime: Runtime, stdout: string): { tokens: number; text?: string; error?: string } {
  let tokens = 0;
  let text: string | undefined;
  let error: string | undefined;
  for (const line of runtime === 'codex' ? stdout.split('\n') : [stdout]) {
    let event: Json;
    try {
      event = object(JSON.parse(line));
    } catch {
      continue;
    }
    if (runtime === 'claude') {
      const usage = object(event.usage);
      tokens = count(
        usage.input_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens,
        usage.output_tokens,
      );
      if (typeof event.result === 'string') text = event.result;
      if (event.is_error === true) error = text ?? 'Claude Code reported an error';
    } else if (event.type === 'turn.completed') {
      // Codex input tokens already include cached input.
      const usage = object(event.usage);
      tokens += count(usage.input_tokens, usage.output_tokens);
    } else if (event.type === 'turn.failed' || event.type === 'error') {
      const detail = event.type === 'error' ? event.message : object(event.error).message;
      if (typeof detail === 'string') error = detail;
    } else if (event.type === 'item.completed') {
      const item = object(event.item);
      if (item.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    }
  }
  return {
    tokens: Math.min(tokens, Number.MAX_SAFE_INTEGER),
    ...(text?.trim() ? { text: text.trim() } : {}),
    ...(error ? { error: plainError(error) } : {}),
  };
}

// Runtime errors are shown on one status line, so keep them short and free of control characters.
const plainError = (text: string) =>
  text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .trim()
    .slice(0, 160);
