import type { ChatMetrics, ChatMetricsWindow } from '@clqn/shared';
import {
  clip,
  type Frame,
  limit,
  marginFor,
  name,
  number,
  type Paint,
  pad,
  painter,
  plain,
  runStatuses,
  width,
} from './chat-view.js';

interface MetricsView {
  columns: number;
  rows: number;
  color: boolean;
  clan: string;
  window: ChatMetricsWindow;
  metrics?: ChatMetrics | undefined;
  notice?: string | undefined;
}

const levels = '▁▂▃▄▅▆▇█';
const duration = (seconds: number | null) => {
  if (seconds === null) return '–';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
};

// Stretch or squeeze buckets to the available columns, keeping each column's peak.
function sample(values: number[], slots: number) {
  return Array.from({ length: slots }, (_, slot) => {
    const from = Math.floor((slot * values.length) / slots);
    const to = Math.max(from + 1, Math.floor(((slot + 1) * values.length) / slots));
    return Math.max(...values.slice(from, to));
  });
}

// An area chart drawn in eighth blocks, with the peak and zero marked on the left.
export function areaChart(values: number[], columns: number, height: number, paint: Paint, format = number, label = 1) {
  const peak = Math.max(0, ...values);
  const gutter = Math.max(width(format(peak)), label) + 2;
  const slots = Math.max(1, columns - gutter);
  const points = sample(values, slots);
  return Array.from({ length: height }, (_, index) => {
    const row = height - 1 - index;
    const mark = row === height - 1 ? format(peak) : row === 0 ? '0' : '';
    const bars = points
      .map((value) => {
        if (!peak || !value) return ' ';
        const eighths = Math.max(1, Math.round((value / peak) * height * 8));
        const fill = Math.min(8, eighths - row * 8);
        return fill > 0 ? levels[fill - 1] : ' ';
      })
      .join('');
    return `${paint(`${mark.padStart(gutter - 2)} ┤`, 'muted')}${paint(bars, 'accent')}`;
  });
}

// A one-line trend for small panels; empty buckets stay blank.
function sparkline(values: (number | null)[], slots: number) {
  const peak = Math.max(0, ...values.map((value) => value ?? 0));
  const points = sample(
    values.map((value) => (value === null ? -1 : value)),
    slots,
  );
  return points
    .map((value) => (value < 0 ? ' ' : levels[peak ? Math.round(((levels.length - 1) * value) / peak) : 0]))
    .join('');
}

function meter(used: number, max: number | null, span: number, paint: Paint) {
  const filled = max ? Math.min(span, Math.ceil((span * used) / max)) : 0;
  return (
    paint('━'.repeat(filled), max && used >= max ? 'warning' : 'accent') + paint('┄'.repeat(span - filled), 'muted')
  );
}

export function metricsFrame(view: MetricsView): Frame {
  const columns = Math.max(1, view.columns);
  const rows = Math.max(1, view.rows);
  const paint = painter(view.color);
  if (columns < 28 || rows < 12) return { lines: [clip('Enlarge terminal · Ctrl+C to quit', columns)] };
  const margin = marginFor(columns);
  const content = columns - 2 * margin;
  const rule = paint('─'.repeat(content), 'muted');
  const header = clip(`◆ clqn / ${plain(view.clan)} · Metrics`, content);
  const lines = [paint(header.slice(0, 6), 'accent') + paint(header.slice(6), 'bold'), rule];
  const toggle = (['24h', '7d'] as const).map((window) => (window === view.window ? `[${window}]` : window)).join(' ');
  const footer = [
    ...(view.notice ? [paint(clip(plain(view.notice), content), 'warning')] : []),
    rule,
    paint(clip(`T ${toggle}  ·  Esc Back  ·  Ctrl+C Quit`, content), 'muted'),
  ];
  // Keep the hints on the bottom row.
  const finish = () => {
    const body = lines.slice(0, rows - footer.length);
    while (body.length < rows - footer.length) body.push('');
    return { lines: [...body, ...footer].map((line) => ' '.repeat(margin) + line) };
  };
  const metrics = view.metrics;
  if (!metrics || metrics.window !== view.window) {
    lines.push('', paint('Loading metrics…', 'muted'));
    return finish();
  }

  const caption = (text: string) => paint(clip(text, content), 'bold');
  const tokens = metrics.tokens.reduce((sum, value) => Math.min(Number.MAX_SAFE_INTEGER, sum + value), 0);
  const per = metrics.bucketHours === 1 ? 'h' : `${metrics.bucketHours}h`;
  const tokenCaption = caption(
    `Tokens · ${metrics.window}  ${number(tokens)} total · peak ${number(Math.max(0, ...metrics.tokens))}/${per}`,
  );
  const label = Math.max(width(number(Math.max(0, ...metrics.tokens))), width(String(Math.max(0, ...metrics.agents))));
  const agentCaption = caption(`Active agents · ${metrics.window}  peak ${Math.max(0, ...metrics.agents)}`);
  const memberCaption = caption('Tokens by member · used / limit');
  const taskCaption = caption(`Tokens by task · ${metrics.window}`);
  const { queue } = metrics;
  const queueText = `Queue wait · avg ${duration(queue.averageSeconds)} · longest ${duration(queue.longestSeconds)}${
    queue.waiting ? ` · ${queue.waiting} waiting (oldest ${duration(queue.oldestSeconds)})` : ''
  }`;
  const trendSlots = Math.min(metrics.queueWait.length, content - width(queueText) - 2);
  const queueLine =
    paint(clip(queueText, content), 'bold') +
    (trendSlots >= 8 ? `  ${paint(sparkline(metrics.queueWait, trendSlots), 'accent')}` : '');

  const amounts = metrics.members.map(
    (member) =>
      `${number(member.tokens)}${member.reserved ? ` +${number(member.reserved)}` : ''} / ${limit(member.tokenLimit)}`,
  );
  const amountWidth = Math.max(0, ...amounts.map(width));
  const memberLines = metrics.members.map((member, index) => {
    const amount = amounts[index]!.padStart(amountWidth);
    const bar = content >= 48 ? 12 : 0;
    const label = Math.max(1, content - width(amount) - 2 - (bar ? bar + 2 : 0));
    const gauge = bar ? `${meter(member.tokens + member.reserved, member.tokenLimit, bar, paint)}  ` : '';
    return `${pad(clip(`  ${name(member.name)}`, label), label)}  ${gauge}${paint(amount, 'muted')}`;
  });
  const taskLines = metrics.tasks.map((task) => {
    const [glyph, , tone] = runStatuses[task.status];
    const amount = task.tokens === null ? `~${number(task.estimatedTokens)}` : number(task.tokens);
    const who = content >= 48 ? `  ${clip(name(task.worker), 16)}` : '';
    const label = Math.max(1, content - width(amount) - width(who) - 3);
    return `  ${paint(glyph, tone)} ${pad(clip(plain(task.title), label - 1), label - 1)}${paint(who, 'muted')} ${paint(amount, 'muted')}`;
  });

  // Fit the screen: five captions always show, then charts and lists share the remaining rows.
  const room = rows - lines.length - footer.length - 5;
  const wantList = Math.min(6, Math.max(1, memberLines.length)) + Math.min(6, Math.max(1, taskLines.length));
  const height = Math.max(1, Math.min(8, Math.floor((room - Math.min(wantList, Math.max(2, room - 4))) / 2)));
  let listRows = Math.max(0, room - 2 * height);
  const memberRows = Math.min(memberLines.length || 1, Math.ceil(listRows / 2));
  listRows -= memberRows;
  const taskRows = Math.min(taskLines.length || 1, listRows);
  const extra = listRows - taskRows;
  const fit = (items: string[], count: number, empty: string) => {
    if (count < 1) return [];
    if (!items.length) return [paint(`  ${empty}`, 'muted')];
    if (items.length <= count) return items;
    return [...items.slice(0, Math.max(0, count - 1)), paint(`  +${items.length - count + 1} more`, 'muted')];
  };
  lines.push(
    tokenCaption,
    ...areaChart(metrics.tokens, content, height, paint, number, label),
    agentCaption,
    ...areaChart(metrics.agents, content, height, paint, String, label),
    memberCaption,
    ...fit(memberLines, memberRows + Math.max(0, extra), 'No members yet'),
    taskCaption,
    ...fit(taskLines, taskRows, 'No delegations in this window'),
    queueLine,
  );
  return finish();
}
