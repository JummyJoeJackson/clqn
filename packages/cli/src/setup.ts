import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  ApiError,
  allowedModelsSchema,
  type ChatSettings,
  type Clan,
  ClqnClient,
  createClanSchema,
  defaultChatSettings,
  limitSchema,
} from '@clqn/shared';
import { type Config, readConfig, removeConfig, writeConfig, writeServer } from './config.js';
import { githubLogin } from './login.js';
import { terminalText } from './terminal.js';

export type Ask = (question: string) => Promise<string>;
export type Print = (text: string) => void;

// Keep the selected clan across sign-ins and remember the server for later runs.
async function saveToken(server: string, token: string) {
  const { clanId } = await readConfig(server).catch((): Config => ({}));
  await writeConfig(server, clanId ? { token, clanId } : { token });
  await writeServer(server);
}

export async function signIn(server: string, expectedUserId?: string) {
  const { token, user } = await githubLogin(server, false);
  if (expectedUserId !== undefined && user.id !== expectedUserId) {
    await new ClqnClient(server, token).logout().catch(() => undefined);
    throw new Error('Sign in with the GitHub account that received the invitation.');
  }
  await saveToken(server, token);
  return user;
}

// Revoke the saved token, then remove the local credential and clan selection even if the API is unreachable.
export async function signOut(server: string) {
  const { token } = await readConfig(server).catch((): Config => ({}));
  let revoked = false;
  if (token)
    revoked = await new ClqnClient(server, token).logout().then(
      (result) => result.revoked,
      () => false,
    );
  await removeConfig(server);
  return [
    'Signed out.',
    token && !revoked ? 'The saved token could not be revoked on the server.' : '',
    process.env.CLQN_TOKEN ? 'CLQN_TOKEN is still set and was not revoked; unset it to stop using that token.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// The saved clan, unless the user has left it, was removed, or it was deleted; then forget it so setup asks again.
export async function savedClan(server: string, api: ClqnClient): Promise<string | undefined> {
  const config = await readConfig(server);
  if (!config.clanId) return undefined;
  if ((await api.listClans()).clans.some((clan) => clan.id === config.clanId)) return config.clanId;
  await writeConfig(server, config.token ? { token: config.token } : {});
  return undefined;
}

export async function selectClan(server: string, clanId: string) {
  await writeConfig(server, { ...(await readConfig(server)), clanId });
}

async function pick(ask: Ask, count: number, question: string) {
  for (;;) {
    const answer = (await ask(question)).trim();
    if (!answer) return undefined;
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice >= 1 && choice <= count) return choice - 1;
  }
}

// Blank means no limit. Asks again until the answer is valid.
async function askLimit<T>(ask: Ask, print: Print, question: string, parse: (answer: string) => T | undefined) {
  for (;;) {
    const answer = (await ask(question)).trim();
    const value = answer ? parse(answer) : null;
    if (value !== undefined) return value;
    print('Enter a valid value, or leave it blank for no limit.');
  }
}
const wholeNumber = (answer: string) => {
  const parsed = limitSchema.safeParse(/^\d+$/.test(answer) ? Number(answer) : undefined);
  return parsed.success ? parsed.data : undefined;
};
const modelList = (answer: string) => {
  const parsed = allowedModelsSchema.safeParse(answer.split(',').map((model) => model.trim()));
  return parsed.success ? parsed.data : undefined;
};

// New members, including the leader of a new clan, choose their limits. Approvals still apply either way.
export async function chooseLimits(api: ClqnClient, clanId: string, ask: Ask, print: Print) {
  print('\nLimits for agents on your machine\n  1. Full access (no limits)\n  2. Custom');
  let settings: ChatSettings = defaultChatSettings;
  if ((await pick(ask, 2, 'Enter a number (1): ')) === 1) {
    settings = {
      ...settings,
      tokenLimit: await askLimit(ask, print, 'Token limit (blank for none): ', wholeNumber),
      agentLimit: await askLimit(ask, print, 'Agent count (blank for none): ', wholeNumber),
      allowedModels: await askLimit(ask, print, 'Allowed models, comma-separated (blank for any): ', modelList),
    };
  }
  await api.saveChatSettings(clanId, settings);
  print('Saved. Change your limits later with F2 in the chat.');
}

interface ChooseClan {
  server: string;
  connect: () => Promise<ClqnClient>;
  ask: Ask;
  print: Print;
  // False when an environment token is in use, which a new GitHub sign-in would not replace.
  canSignIn: boolean;
}

// Offer the user's clans, creating a clan, or accepting a pending invitation.
export async function chooseClan({ server, connect, ask, print, canSignIn }: ChooseClan): Promise<Clan> {
  const text = (value: string) => terminalText(value, false);
  for (;;) {
    const api = await connect();
    const { clans } = await api.listClans();
    const choices = [...clans.map((clan) => text(clan.name)), 'Create a clan', 'Join a clan'];
    print(`\nChoose a clan\n${choices.map((choice, index) => `  ${index + 1}. ${choice}`).join('\n')}`);
    const choice = await pick(ask, choices.length, 'Enter a number: ');
    if (choice === undefined) continue;
    if (choice < clans.length) return clans[choice]!;
    if (choice === clans.length) {
      const fallback = basename(process.cwd()).trim().slice(0, 100) || 'My project';
      const name = (await ask(`Clan name (${text(fallback)}): `)).trim() || fallback;
      const parsed = createClanSchema.safeParse({ name });
      if (!parsed.success) {
        print('Enter a clan name of up to 100 characters.');
        continue;
      }
      const clan = await api.createClan(parsed.data.name);
      await chooseLimits(api, clan.id, ask, print);
      return clan;
    }
    try {
      const { invitations } = await api.listInvitations();
      if (!invitations.length) {
        const { email } = await api.whoami();
        print(text(`No pending invitations. Ask a clan leader to invite ${email}.`));
        continue;
      }
      print(
        `\nPending invitations\n${invitations.map((entry, i) => `  ${i + 1}. ${text(entry.clanName)}`).join('\n')}`,
      );
      const index = await pick(ask, invitations.length, 'Enter a number (Enter to go back): ');
      if (index === undefined) continue;
      const clan = await api.acceptInvitation(invitations[index]!.clanId);
      await chooseLimits(api, clan.id, ask, print);
      return clan;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'INVITATION_LOGIN_REQUIRED' || !canSignIn) throw error;
      const user = await api.whoami();
      print('Verify your GitHub email to see your invitations.');
      await signIn(server, user.id);
    }
  }
}

// Plain line prompts before the full-screen chat opens. Ctrl+C or Ctrl+D quits.
export function terminalPrompt() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let done = false;
  const quit = () => {
    if (done) return;
    process.stdout.write('\n');
    process.exit(130);
  };
  prompt.on('SIGINT', quit);
  prompt.on('close', quit);
  return {
    ask: (question: string) => prompt.question(question),
    close: () => {
      done = true;
      prompt.close();
    },
  };
}
