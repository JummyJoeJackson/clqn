import { legacyLocalServer, preferredServer, serverOrigin } from './config.js';

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
