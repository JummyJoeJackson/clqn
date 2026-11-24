import { randomUUID } from 'node:crypto';
import { emitKeypressEvents, type Key } from 'node:readline';
import {
  ApiError,
  allowedModelsSchema,
  type ChatMessage,
  type ChatMetrics,
  type ChatMetricsWindow,
  type ChatSettings,
  type ChatState,
  type ClqnClient,
  type SendChat,
} from '@clqn/shared';
import { characters, chatFrame, messageLines, plain, transcriptColumns } from './chat-view.js';
import { metricsFrame } from './metrics-view.js';

const ctrlShortcuts: Record<string, string> = { s: 'f2', p: 'f3', q: 'f4', g: 'f5' };
const help = (error: unknown) => (error instanceof Error ? error.message : 'Request failed');
const numeric = (text: string) => {
  if (!text || /^(none|∞)$/i.test(text)) return null;
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number)) throw new Error('Limits must be whole numbers or none');
  return number;
};
const models = (text: string) => {
  if (!text.trim() || /^any$/i.test(text.trim())) return null;
  const parsed = allowedModelsSchema.safeParse(text.split(',').map((model) => model.trim()));
  if (!parsed.success) throw new Error('Models must be unique names without spaces, separated by commas');
  return parsed.data;
};

type Info = Awaited<ReturnType<ClqnClient['chatInfo']>>;
type Setup = Omit<NonNullable<Parameters<typeof chatFrame>[0]['settings']>, 'action'>;
const setupFor = (settings: ChatSettings): Setup => ({
  value: settings,
  tokenText: settings.tokenLimit?.toString() ?? '',
  agentText: settings.agentLimit?.toString() ?? '',
  modelText: settings.allowedModels?.join(', ') ?? '',
  field: 5,
});

// Background agents that follow the polled chat state and report a short status line.
export interface ChatAgents {
  update(state: ChatState): void;
  status(): string | undefined;
}

// Resolves when the user quits, or with 'sign-out' when they choose Sign out in settings.
export async function runChat(api: ClqnClient, clanId: string, agents?: ChatAgents): Promise<'quit' | 'sign-out'> {
  const { stdin, stdout } = process;
  const actor = await api.whoami();
  if (actor.agentId) throw new Error('Sign in with a personal credential to open the chat');
  let info: Info = await api.chatInfo(clanId);
  let setup: Setup | undefined = setupFor(info.settings);
  let result: 'quit' | 'sign-out' = 'quit';
  let replaceField = true;
  let state: ChatState | undefined;
  let draft = '';
  let caret = 0;
  let scroll = 0;
  const older: ChatMessage[] = [];
  let recent: ChatMessage[] = [];
  let historyCursor: number | null = null;
  let loadOlder = false;
  let approval = 0;
  let approvalFocused = false;
  let reply: ChatMessage | undefined;
  let notice: string | undefined;
  let connection: string | undefined;
  let busy = false;
  let refreshing = false;
  let sending = false;
  let failed = false;
  let closed = false;
  let paste: string | undefined;
  let metrics: { window: ChatMetricsWindow; data?: ChatMetrics; at: number } | undefined;
  const outbox: SendChat[] = [];
  const controller = new AbortController();

  function rows() {
    return stdout.rows || 24;
  }

  function columns() {
    return stdout.columns || 80;
  }

  function messages() {
    return [...older, ...recent];
  }

  function draw() {
    if (closed) return;
    const session = state?.session ?? info.session;
    let frame = chatFrame({
      columns: columns(),
      rows: rows(),
      color: !('NO_COLOR' in process.env),
      clan: session?.clan ?? info.clan,
      host: session?.host,
      userId: actor.id,
      state,
      messages: messages(),
      settings: setup
        ? {
            ...setup,
            action: busy
              ? 'Connecting…'
              : state
                ? 'Save settings'
                : session
                  ? 'Join session'
                  : info.canStart
                    ? 'Start session'
                    : 'Check for session',
          }
        : undefined,
      draft,
      caret,
      scroll,
      hasOlder: historyCursor !== null,
      approval,
      approvalFocused,
      reply,
      notice:
        notice ??
        connection ??
        (failed ? 'Message unsent · Ctrl+R Retry' : outbox.length ? 'Sending…' : undefined) ??
        agents?.status(),
    });
    if (metrics)
      frame = metricsFrame({
        columns: columns(),
        rows: rows(),
        color: !('NO_COLOR' in process.env),
        clan: session?.clan ?? info.clan,
        window: metrics.window,
        metrics: metrics.data,
        notice,
      });
    // Draw in one write to keep polling from moving the input cursor or scrolling the shell.
    const screen = frame.lines.map((line, index) => `\x1b[${index + 1};1H\x1b[2K${line}`).join('');
    const cursor = frame.cursor ? `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H\x1b[?25h` : '';
    stdout.write(
      `\x1b[?25l${screen}\x1b[${Math.min(rows(), frame.lines.length + 1)};1H${frame.lines.length < rows() ? '\x1b[J' : ''}${cursor}`,
    );
  }

  function mergeState(next: ChatState) {
    const first = next.messages[0]?.sequence ?? 0;
    const last = next.messages.at(-1)?.sequence ?? 0;
    if (scroll && recent.length) {
      const previous = recent.at(-1)!.sequence;
      const transcript = transcriptColumns(columns());
      scroll += next.messages
        .filter((message) => message.sequence > previous)
        .reduce((sum, message) => sum + messageLines(message, transcript, actor.id).length, 0);
    }
    const displaced = recent.filter((message) => message.sequence < first);
    if (displaced.length) older.push(...displaced);
    recent = [...next.messages, ...recent.filter((message) => message.sequence > last)];
    if (older.length === 0) historyCursor = next.before;
    const selectedApproval = state?.approvals[approval]?.messageId;
    const index = next.approvals.findIndex(({ messageId }) => messageId === selectedApproval);
    approval = Math.max(index, 0);
    if (!next.approvals.length) approvalFocused = false;
    state = next;
    agents?.update(next);
  }

  async function loadMetrics() {
    const view = metrics;
    if (!view) return;
    view.at = Date.now();
    try {
      const data = await api.chatMetrics(clanId, view.window, controller.signal);
      if (metrics?.window === data.window) metrics.data = data;
    } catch (error) {
      if (!closed) notice = help(error);
    } finally {
      draw();
    }
  }

  async function refresh() {
    if (metrics && Date.now() - metrics.at > 30_000) void loadMetrics();
    if (closed || refreshing || !state) return;
    refreshing = true;
    try {
      mergeState(await api.chatState(clanId, controller.signal));
      connection = undefined;
    } catch (error) {
      if (!closed) connection = `Chat disconnected · ${help(error)}`;
    } finally {
      refreshing = false;
      draw();
    }
  }

  async function save() {
    if (busy || !setup) return;
    busy = true;
    notice = undefined;
    draw();
    try {
      if (!info.session && !info.canStart) {
        info = await api.chatInfo(clanId, controller.signal);
        if (!info.session && !info.canStart) {
          notice = 'Waiting for the clan leader to start this session';
          return;
        }
      }
      const { value, tokenText, agentText, modelText } = setup;
      await api.joinChat(
        clanId,
        {
          ...value,
          tokenLimit: numeric(tokenText),
          agentLimit: numeric(agentText),
          allowedModels: models(modelText),
        },
        controller.signal,
      );
      mergeState(await api.chatState(clanId, controller.signal));
      setup = undefined;
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      draw();
    }
  }

  async function olderPage() {
    if (loadOlder || !historyCursor) return;
    loadOlder = true;
    try {
      const page = await api.chatHistory(clanId, historyCursor, controller.signal);
      older.unshift(...page.messages);
      historyCursor = page.before;
    } catch (error) {
      notice = help(error);
    } finally {
      loadOlder = false;
      draw();
    }
  }

  async function flush() {
    if (sending) return;
    sending = true;
    failed = false;
    try {
      while (outbox.length && !closed) {
        const message = await api.sendChat(clanId, outbox[0]!, controller.signal);
        if (!recent.some(({ id }) => id === message.id)) recent.push(message);
        outbox.shift();
        draw();
      }
      void refresh();
    } catch (error) {
      failed = true;
      notice = `Unsent · ${help(error)} · Ctrl+R Retry`;
    } finally {
      sending = false;
      draw();
    }
  }

  async function decide(approve: boolean) {
    const pending = state?.approvals[approval];
    if (!pending || busy) return;
    busy = true;
    try {
      await api.approveChat(clanId, pending.messageId, approve, controller.signal);
      approvalFocused = false;
      notice = approve ? 'Delegation approved' : 'Delegation declined';
      void refresh();
    } catch (error) {
      notice = help(error);
      if (error instanceof ApiError && error.code === 'CHAT_CONFLICT') void refresh();
    } finally {
      busy = false;
      draw();
    }
  }

  function edit(text: string) {
    const insert = plain(text).slice(0, Math.max(0, 4000 - draft.length));
    draft = draft.slice(0, caret) + insert + draft.slice(caret);
    caret += insert.length;
  }

  function setupKey(text: string, key: Key) {
    if (!setup || busy) return;
    if (key.name === 'escape') {
      if (!state) stop();
      else setup = undefined;
    } else if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
      const change = key.name === 'up' || key.shift ? -1 : 1;
      setup.field = (setup.field + 7 + change) % 7;
      replaceField = true;
    } else if (setup.field === 0 && ['left', 'right', 'space', 'return'].includes(key.name ?? '')) {
      setup.value = { ...setup.value, approval: setup.value.approval === 'manual' ? 'automatic' : 'manual' };
    } else if (setup.field === 4 && ['left', 'right', 'space', 'return'].includes(key.name ?? '')) {
      const levels = ['off', 'sandboxed', 'unrestricted'] as const;
      const next = levels.indexOf(setup.value.commands) + (key.name === 'left' ? 2 : 1);
      setup.value = { ...setup.value, commands: levels[next % 3]! };
    } else if (key.name === 'return') {
      if (setup.field === 5) void save();
      else if (setup.field === 6) {
        result = 'sign-out';
        stop();
      } else {
        setup.field++;
        replaceField = true;
      }
    } else if (setup.field >= 1 && setup.field <= 3) {
      const field = (['tokenText', 'agentText', 'modelText'] as const)[setup.field - 1]!;
      const allowed = field === 'modelText' ? /^[^\x00-\x1f\x7f-\x9f]+$/ : /^[0-9none∞]+$/i;
      if (key.name === 'backspace') {
        setup[field] = setup[field].slice(0, -1);
        replaceField = false;
      } else if (text && allowed.test(text) && !key.ctrl && !key.meta) {
        setup[field] = ((replaceField ? '' : setup[field]) + text).slice(0, field === 'modelText' ? 1000 : 16);
        replaceField = false;
      }
    }
  }

  function composerKey(text: string, key: Key) {
    if (key.name === 'f2' && state) {
      setup = setupFor(state.settings);
      approvalFocused = false;
    } else if (key.name === 'f5') {
      metrics = { window: '24h', at: 0 };
      approvalFocused = false;
      void loadMetrics();
    } else if (['f3', 'tab'].includes(key.name ?? '') && state?.approvals.length) {
      approvalFocused = !approvalFocused;
    } else if (key.name === 'f4' && state?.questions.length) {
      const index = state.questions.findIndex(({ id }) => id === reply?.id);
      reply = state.questions[(index + 1) % state.questions.length];
      approvalFocused = false;
    } else if (approvalFocused) {
      const count = state?.approvals.length ?? 0;
      if (key.name === 'escape' || key.name === 'tab') approvalFocused = false;
      else if (count && key.name === 'up') approval = (approval + count - 1) % count;
      else if (count && key.name === 'down') approval = (approval + 1) % count;
      else if (!key.ctrl && !key.meta && /^[yn]$/i.test(text)) void decide(text.toLowerCase() === 'y');
    } else if (key.ctrl && key.name === 'r' && failed) {
      void flush();
    } else if (key.name === 'escape') {
      reply = undefined;
    } else if (['pageup', 'pagedown', 'up', 'down'].includes(key.name ?? '')) {
      // Terminals send the mouse wheel as ↑/↓ in full-screen apps, so those scroll a line at a time.
      const increment = key.name === 'up' || key.name === 'down' ? 1 : Math.max(1, rows() - 13);
      const back = key.name === 'pageup' || key.name === 'up';
      const span = Math.max(2, transcriptColumns(columns()));
      const total = messages().reduce((sum, message) => sum + messageLines(message, span, actor.id).length, 0);
      const max = Math.max(0, total - 2);
      scroll = Math.max(0, Math.min(max, scroll + (back ? increment : -increment)));
      if (back && scroll >= Math.max(0, max - Math.max(increment, rows() - 13))) void olderPage();
    } else if (key.name === 'end' && scroll) {
      scroll = 0;
    } else if (key.name === 'return' && draft.trim()) {
      if (outbox.length === 10) {
        notice = 'Outbox full · Ctrl+R Retry';
        return;
      }
      outbox.push({ id: randomUUID(), text: draft.trim(), ...(reply?.replyTo ? { replyTo: reply.replyTo } : {}) });
      draft = '';
      caret = scroll = 0;
      reply = undefined;
      if (!failed) void flush();
    } else if (key.name === 'backspace' || key.name === 'left') {
      const length = characters(draft.slice(0, caret)).at(-1)?.length ?? 0;
      if (key.name === 'backspace') draft = draft.slice(0, caret - length) + draft.slice(caret);
      caret -= length;
    } else if (key.name === 'delete' || key.name === 'right') {
      const length = characters(draft.slice(caret))[0]?.length ?? 0;
      if (key.name === 'delete') draft = draft.slice(0, caret) + draft.slice(caret + length);
      else caret += length;
    } else if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      caret = 0;
    } else if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      caret = draft.length;
    } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f-\x9f]/.test(text)) {
      edit(text);
    }
  }

  function keypress(text: string | undefined, key: Key = {}) {
    if (closed) return;
    if (key.name === 'paste-start') {
      paste = '';
      return;
    }
    if (paste !== undefined) {
      if (key.name === 'paste-end') {
        if (state && !setup && !metrics && !approvalFocused) edit(paste);
        paste = undefined;
        draw();
      } else if (paste.length < 4000) {
        paste += text ?? (key.name === 'return' ? ' ' : '');
      }
      return;
    }
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
      stop();
      return;
    }
    notice = undefined;
    // macOS sends F-keys to brightness and volume unless fn is held, so each has a Ctrl alternative.
    const fKey = key.ctrl ? ctrlShortcuts[key.name ?? ''] : undefined;
    if (fKey) key = { ...key, ctrl: false, name: fKey };
    if (metrics) {
      if (key.name === 'escape' || key.name === 'f5') metrics = undefined;
      else if (key.name === 't' || key.name === 'tab') {
        metrics = { window: metrics.window === '24h' ? '7d' : '24h', at: 0 };
        void loadMetrics();
      }
    } else if (setup) setupKey(text ?? '', key);
    else if (state) composerKey(text ?? '', key);
    draw();
  }

  const wasRaw = stdin.isRaw;
  let stop!: () => void;
  return new Promise((resolve) => {
    const timer = setInterval(() => void refresh(), 2500);
    stop = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      clearInterval(timer);
      stdin.off('keypress', keypress);
      stdin.off('end', stop);
      stdout.off('resize', draw);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1007l\x1b[?1049l');
      resolve(result);
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on('keypress', keypress);
    stdin.on('end', stop);
    stdout.on('resize', draw);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // ?1007h asks xterm-style terminals to send the mouse wheel as ↑/↓ on this screen.
    stdout.write('\x1b[?1049h\x1b[?2004h\x1b[?1007h\x1b[2J');
    stdin.resume();
    draw();
  });
}
