import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  token?: string;
  clanId?: string;
}

export const hostedServer = 'https://clqn-api-660379279615.us-central1.run.app';

export function serverOrigin(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error('Enter a full server address, such as https://clqn.example.com');
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('Use HTTPS for a team server. HTTP is supported for a server on this machine.');
  }
  if (url.username || url.password) throw new Error('The server address cannot contain a username or password');
  return url.origin;
}

export const configDirectory = () => process.env.CLQN_CONFIG_DIR ?? join(homedir(), '.config', 'clqn');
const filename = (apiUrl: string) =>
  join(configDirectory(), `${createHash('sha256').update(new URL(apiUrl).origin).digest('hex')}.json`);

export async function readConfig(apiUrl: string): Promise<Config> {
  let contents: string;
  try {
    contents = await readFile(filename(apiUrl), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Could not read clqn configuration');
  }
  try {
    const config: unknown = JSON.parse(contents);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
    const value = config as Record<string, unknown>;
    if (
      (value.token !== undefined && typeof value.token !== 'string') ||
      (value.clanId !== undefined && typeof value.clanId !== 'string')
    )
      throw new Error();
    return {
      ...(typeof value.token === 'string' ? { token: value.token } : {}),
      ...(typeof value.clanId === 'string' ? { clanId: value.clanId } : {}),
    };
  } catch {
    throw new Error('Invalid clqn configuration; log out to remove it');
  }
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function writePrivateJson(path: string, value: unknown): Promise<void> {
  return writePrivateFile(path, `${JSON.stringify(value)}\n`);
}

export function writeConfig(apiUrl: string, config: Config): Promise<void> {
  return writePrivateJson(filename(apiUrl), config);
}

export async function removeConfig(apiUrl: string): Promise<void> {
  await rm(filename(apiUrl), { force: true });
}

const serverFile = () => join(configDirectory(), 'server');

export async function readServer(): Promise<string | undefined> {
  try {
    return serverOrigin(await readFile(serverFile(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Could not read the saved server. Run clqn login --server <url> to select it again.');
  }
}

export function writeServer(apiUrl: string): Promise<void> {
  return writePrivateFile(serverFile(), `${serverOrigin(apiUrl)}\n`);
}

export async function preferredServer(): Promise<string> {
  return (await readServer()) ?? hostedServer;
}
