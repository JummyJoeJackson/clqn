import { cells, characters, type Paint, plain } from './text.js';

// A small Markdown renderer for agent chat messages. Layout never depends on color, so line
// counts match whether or not the terminal is painted.

const BOLD = 1;
const ITALIC = 3;
const UNDERLINE = 4;
const STRIKE = 9;
const CODE = 36;
const MUTED = 90;

interface Cell {
  char: string;
  style: string;
}
type Line = Cell[];

const cellsOf = (text: string, style: readonly number[] = []): Line =>
  characters(plain(text)).map((char) => ({ char, style: style.join(';') }));

function addStyle(style: readonly number[], code: number) {
  return style.includes(code) ? style : [...style, code];
}

const escapable = /[!-/:-@[-`{-~]/;
const delimiters = ['**', '__', '~~', '*', '_'] as const;
const styleFor = { '**': BOLD, __: BOLD, '~~': STRIKE, '*': ITALIC, _: ITALIC } as const;
const word = /[\p{L}\p{N}]/u;

function closing(text: string, mark: string, from: number) {
  for (let j = text.indexOf(mark, from); j !== -1; j = text.indexOf(mark, j + 1)) {
    // In `***x***` the closing `**` is the last two stars.
    while (text[j + mark.length] === mark[0]) j++;
    if (j <= from || /\s/.test(text[j - 1]!)) continue;
    if (mark[0] === '_' && word.test(text[j + mark.length] ?? '')) continue;
    return j;
  }
  return -1;
}

export function inline(text: string, style: readonly number[] = []): Line {
  const out: Line = [];
  let literal = '';
  const flush = () => {
    out.push(...cellsOf(literal, style));
    literal = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '\\' && escapable.test(text[i + 1] ?? '')) {
      literal += text[i + 1];
      i += 2;
      continue;
    }
    if (char === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(run, i + run.length);
      if (end !== -1 && !text.startsWith('`', end + run.length)) {
        flush();
        let code = text.slice(i + run.length, end);
        if (/^ .*\S.* $/.test(code)) code = code.slice(1, -1);
        out.push(...cellsOf(code, addStyle(style, CODE)));
        i = end + run.length;
        continue;
      }
      literal += run;
      i += run.length;
      continue;
    }
    if (char === '[' || (char === '!' && text[i + 1] === '[')) {
      const open = char === '!' ? i + 1 : i;
      const match = /^\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(open));
      if (match) {
        flush();
        const [whole, label, url] = match as unknown as [string, string, string];
        out.push(...inline(label || url, addStyle(style, UNDERLINE)));
        if (url && url !== label) out.push(...cellsOf(` (${url})`, addStyle(style, MUTED)));
        i = open + whole.length;
        continue;
      }
    }
    if (char === '<') {
      const match = /^<((?:https?|mailto):[^\s<>]+)>/.exec(text.slice(i));
      if (match) {
        flush();
        out.push(...cellsOf(match[1]!, addStyle(style, UNDERLINE)));
        i += match[0].length;
        continue;
      }
    }
    const mark = delimiters.find((candidate) => text.startsWith(candidate, i));
    if (
      mark &&
      text[i + mark.length] &&
      !/\s/.test(text[i + mark.length]!) &&
      !(mark[0] === '_' && word.test(text[i - 1] ?? ''))
    ) {
      const end = closing(text, mark, i + mark.length);
      if (end !== -1) {
        flush();
        out.push(...inline(text.slice(i + mark.length, end), addStyle(style, styleFor[mark])));
        i = end + mark.length;
        continue;
      }
    }
    literal += char;
    i++;
  }
  flush();
  return out;
}

/** Word-wraps styled cells; words longer than the limit are split. */
function wrapCells(line: Line, limit: number): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let used = 0;
  let space = -1;
  for (let i = 0; i < line.length; i++) {
    const size = cells(line[i]!.char);
    if (used + size > limit && i > start) {
      const end = space > start ? space : i;
      lines.push(line.slice(start, end));
      start = end;
      while (line[start]?.char === ' ') start++;
      i = start - 1;
      used = 0;
      space = -1;
    } else {
      used += size;
      if (line[i]!.char === ' ') space = i;
    }
  }
  lines.push(line.slice(start));
  return lines;
}

function hardWrap(line: Line, limit: number): Line[] {
  const lines: Line[] = [[]];
  let used = 0;
  for (const cell of line) {
    const size = cells(cell.char);
    if (used + size > limit && used > 0) {
      lines.push([]);
      used = 0;
    }
    lines.at(-1)!.push(cell);
    used += size;
  }
  return lines;
}

const lineWidth = (line: Line) => line.reduce((total, cell) => total + cells(cell.char), 0);

/** Wraps a block under a first-line prefix, indenting continuation lines to match it. */
function hang(content: Line, prefix: Line, limit: number): Line[] {
  const indent = lineWidth(prefix);
  const rest = cellsOf(' '.repeat(indent));
  return wrapCells(content, Math.max(1, limit - indent)).map((line, index) => [...(index ? rest : prefix), ...line]);
}

const fence = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const heading = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const rule = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const item = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const quote = /^ {0,3}> ?(.*)$/;
const tableRow = /^\s*\|.*\|\s*$|^[^|]+\|[^|]/;
const tableDivider = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const splitRow = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

function table(rows: string[][], limit: number): Line[] {
  const count = Math.max(...rows.map((row) => row.length));
  const grid = rows.map((row, index) =>
    Array.from({ length: count }, (_, column) => inline(row[column] ?? '', index === 0 ? [BOLD] : [])),
  );
  const natural = Array.from({ length: count }, (_, column) =>
    Math.max(1, ...grid.map((row) => lineWidth(row[column]!))),
  );
  const available = limit - 3 * (count - 1);
  if (available < count * 3) return rows.flatMap((row) => wrapCells(inline(row.join(' | ')), limit));
  // Give narrow columns their natural width and share what remains among the wide ones.
  const widths = [...natural];
  let total = widths.reduce((sum, value) => sum + value, 0);
  while (total > available) {
    const widest = Math.max(...widths);
    const next = Math.max(3, ...widths.filter((value) => value < widest));
    const wide = widths.filter((value) => value === widest).length;
    const target = Math.max(next, widest - Math.ceil((total - available) / wide));
    for (let column = 0; column < count; column++) if (widths[column] === widest) widths[column] = target;
    total = widths.reduce((sum, value) => sum + value, 0);
    if (target === 3 && total > available) break;
  }
  const wrappedRows = grid.map((row) => row.map((cell, column) => wrapCells(cell, widths[column]!)));
  for (let column = 0; column < count; column++)
    widths[column] = Math.max(1, ...wrappedRows.flatMap((row) => row[column]!.map(lineWidth)));
  const separator = cellsOf(' │ ', [MUTED]);
  const out: Line[] = [];
  wrappedRows.forEach((wrapped, index) => {
    const height = Math.max(...wrapped.map((lines) => lines.length));
    for (let line = 0; line < height; line++) {
      const parts = wrapped.map((lines, column) => {
        const content = lines[line] ?? [];
        return [...content, ...cellsOf(' '.repeat(Math.max(0, widths[column]! - lineWidth(content))))];
      });
      out.push(parts.flatMap((part, column) => (column ? [...separator, ...part] : part)));
    }
    if (index === 0) out.push(cellsOf(widths.map((value) => '─'.repeat(value)).join('─┼─'), [MUTED]));
  });
  return out;
}

function blocks(source: string[], limit: number): Line[] {
  const out: Line[] = [];
  const gap = () => {
    if (out.length && out.at(-1)!.length) out.push([]);
  };
  let i = 0;
  while (i < source.length) {
    const line = source[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const open = fence.exec(line);
    if (open) {
      const marker = open[1]!;
      const code: string[] = [];
      for (i++; i < source.length; i++) {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(source[i]!);
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
          i++;
          break;
        }
        code.push(source[i]!);
      }
      gap();
      for (const text of code) out.push(...hardWrap(cellsOf(text.replace(/\t/g, '  '), [CODE]), limit));
      continue;
    }
    const title = heading.exec(line);
    if (title) {
      gap();
      const style = title[1]!.length === 1 ? [BOLD, UNDERLINE] : [BOLD];
      out.push(...wrapCells(inline(title[2] ?? '', style), limit));
      i++;
      continue;
    }
    if (rule.test(line)) {
      gap();
      out.push(cellsOf('─'.repeat(limit), [MUTED]));
      i++;
      continue;
    }
    if (quote.test(line)) {
      const inner: string[] = [];
      while (i < source.length && quote.test(source[i]!)) inner.push(quote.exec(source[i++]!)![1]!);
      gap();
      const bar = cellsOf('│ ', [MUTED]);
      for (const quoted of blocks(inner, Math.max(1, limit - 2))) {
        out.push([...bar, ...quoted.map((cell) => ({ ...cell, style: cell.style ? cell.style : String(ITALIC) }))]);
      }
      continue;
    }
    if (item.test(line)) {
      gap();
      const indents: number[] = [];
      while (i < source.length) {
        const match = item.exec(source[i]!);
        if (!match) break;
        const indent = match[1]!.replace(/\t/g, '    ').length;
        while (indents.length && indents.at(-1)! > indent) indents.pop();
        if (!indents.length || indents.at(-1)! < indent) indents.push(indent);
        let text = match[3] ?? '';
        for (i++; i < source.length; i++) {
          const next = source[i]!;
          if (!next.trim() || item.test(next) || fence.test(next) || heading.test(next) || quote.test(next)) break;
          text += ` ${next.trim()}`;
        }
        const marker = /\d/.test(match[2]!) ? match[2]! : '•';
        const task = /^\[([ xX])\]\s+/.exec(text);
        const bullet = task ? (task[1] === ' ' ? '☐' : '☑') : marker;
        if (task) text = text.slice(task[0].length);
        const prefix = [...cellsOf('  '.repeat(indents.length - 1)), ...cellsOf(bullet, [MUTED]), ...cellsOf(' ')];
        out.push(...hang(inline(text), prefix, limit));
        // Loose lists separate items with blank lines; keep them compact like a chat would.
        while (i < source.length && !source[i]!.trim() && item.test(source[i + 1] ?? '')) i++;
      }
      continue;
    }
    if (tableRow.test(line) && tableDivider.test(source[i + 1] ?? '') && source[i + 1]!.includes('-')) {
      const rows = [splitRow(line)];
      for (i += 2; i < source.length && source[i]!.includes('|') && source[i]!.trim(); i++)
        rows.push(splitRow(source[i]!));
      gap();
      out.push(...table(rows, limit));
      continue;
    }
    const paragraph: string[] = [];
    let style: number[] = [];
    while (i < source.length) {
      const next = source[i]!;
      if (paragraph.length && /^ {0,3}(=+|-+)\s*$/.test(next)) {
        style = next.includes('=') ? [BOLD, UNDERLINE] : [BOLD];
        i++;
        break;
      }
      if (
        !next.trim() ||
        (paragraph.length && (fence.test(next) || heading.test(next) || quote.test(next) || item.test(next)))
      )
        break;
      paragraph.push(next);
      i++;
    }
    gap();
    // Keep the author's line breaks: chat messages rarely rely on Markdown's soft wrapping.
    for (const text of paragraph) out.push(...wrapCells(inline(text.trim(), style), limit));
  }
  return out;
}

/** Renders Markdown into terminal lines no wider than `columns`. */
export function markdownLines(text: string, columns: number, paint: Paint = (value) => value): string[] {
  const lines = blocks(text.split(/\r?\n/), Math.max(1, columns));
  if (!lines.length) return [''];
  return lines.map((line) => {
    let result = '';
    let run = '';
    let style = '';
    const flush = () => {
      result += style ? paint(run, style.split(';').map(Number)) : run;
      run = '';
    };
    for (const cell of line) {
      if (cell.style !== style) {
        flush();
        style = cell.style;
      }
      run += cell.char;
    }
    flush();
    return result;
  });
}
