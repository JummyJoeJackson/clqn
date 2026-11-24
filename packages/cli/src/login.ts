import { setTimeout as delay } from 'node:timers/promises';
import { ApiError, ClqnClient } from '@clqn/shared';
import { hostedServer, legacyLocalServer, preferredServer, serverOrigin } from './config.js';
import { terminalText } from './terminal.js';

export async function loginServer(explicit: string | undefined, github: boolean): Promise<string> {
  if (explicit !== undefined) return serverOrigin(explicit);
  // Keep piped credentials targeted at their original default unless an address is specified.
  return github ? preferredServer() : legacyLocalServer;
}

export async function readLoginToken(): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 4096) throw new Error('Credential input is too long');
    chunks.push(buffer);
  }

  const input = Buffer.concat(chunks).toString('utf8').trim();
  let token: unknown = input;
  if (input.startsWith('{')) {
    try {
      token = (JSON.parse(input) as { token?: unknown }).token;
    } catch {
      throw new Error('Provide a personal token or the JSON output from clqn user provisioning on standard input');
    }
  }
  if (typeof token !== 'string' || !token || /\s/.test(token))
    throw new Error('Provide a personal token on standard input, or use clqn login --github to sign in with GitHub');
  return token;
}

export async function githubLogin(server: string, json: boolean) {
  const api = new ClqnClient(server);
  const attempt = await api.startGithubLogin().catch((error: unknown) => {
    if (error instanceof TypeError || (error as Error).name === 'TimeoutError') {
      const destination = server === hostedServer ? 'hosted clqn' : `clqn at ${server}`;
      throw new Error(`Could not reach ${destination}. Check your connection and try again.`);
    }
    if (error instanceof ApiError && error.status === 503 && error.code === 'UNAVAILABLE')
      throw new ApiError(
        error.status,
        error.code,
        'GitHub sign-in is unavailable on this server. Ask your server operator to enable it or provide a personal credential.',
      );
    throw error;
  });
  console.error(
    terminalText(
      `Open GitHub to authorize clqn:\n${attempt.verificationUri}\n\nEnter this one-time GitHub code: ${attempt.userCode}`,
      process.stderr.isTTY && !json,
      [attempt.verificationUri],
    ),
  );
  const deadline = Date.now() + attempt.expiresIn * 1000;
  let interval = attempt.interval;
  while (Date.now() + interval * 1000 < deadline) {
    await delay(interval * 1000);
    let result: Awaited<ReturnType<ClqnClient['pollGithubLogin']>>;
    try {
      result = await api.pollGithubLogin(attempt.handle);
    } catch (error) {
      // Retry rate limits, server errors, and network failures until the code expires.
      if (
        error instanceof ApiError
          ? error.status === 429 || error.status >= 500
          : error instanceof TypeError || (error as Error).name === 'TimeoutError'
      )
        continue;
      throw error;
    }
    if (result.status === 'pending') {
      interval = result.interval;
      continue;
    }
    if (result.status !== 'complete')
      throw new Error(`GitHub login ${result.status}. Start again or contact the operator for account conflicts.`);
    return result;
  }
  throw new Error('GitHub login expired; run login again');
}
