import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownLines } from '../src/markdown.js';
import { painter, width } from '../src/text.js';

const strip = (line: string) => line.replace(/\x1b\[\d+m/g, '');

test('renders inline Markdown without its markers', () => {
  assert.deepEqual(markdownLines('Use **bold**, *it*, `npm test` and [docs](https://x.dev).', 80), [
    'Use bold, it, npm test and docs (https://x.dev).',
  ]);
  assert.deepEqual(markdownLines('snake_case_name and 2 * 3 * 4 stay \\*literal\\*', 80), [
    'snake_case_name and 2 * 3 * 4 stay *literal*',
  ]);
  const [line] = markdownLines('**bold** `code`', 80, painter(true));
  assert.equal(line, '\x1b[1mbold\x1b[0m \x1b[36mcode\x1b[0m');
});

test('renders block Markdown', () => {
  const text = [
    '## Plan',
    'Two steps:',
    '- first item that wraps across the line',
    '  - nested',
    '1. numbered',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '> quoted',
    '---',
  ].join('\n');
  assert.deepEqual(markdownLines(text, 24), [
    'Plan',
    '',
    'Two steps:',
    '',
    '• first item that wraps',
    '  across the line',
    '  • nested',
    '1. numbered',
    '',
    'const x = 1;',
    '',
    '│ quoted',
    '',
    '─'.repeat(24),
  ]);
});

test('renders tables within the width', () => {
  const lines = markdownLines('| Task | Owner |\n|---|---|\n| Fix the login redirect bug | ana |', 24);
  assert.deepEqual(lines, [
    'Task          │ Owner',
    '──────────────┼──────',
    'Fix the login │ ana  ',
    'redirect bug  │      ',
  ]);
  for (const line of lines) assert.ok(width(line) <= 24);
});

test('keeps layout identical with and without color', () => {
  const text = '# Title\n- **a** _b_ `c`\n\n| x | y |\n|-|-|\n| 1 | 2 |\n\n```\nlong code line here\n```';
  for (const columns of [8, 20, 60]) {
    const bare = markdownLines(text, columns);
    const painted = markdownLines(text, columns, painter(true)).map(strip);
    assert.deepEqual(painted, bare);
    for (const line of bare) assert.ok(width(line) <= columns, `${line} > ${columns}`);
  }
});

test('neutralizes control characters', () => {
  assert.deepEqual(markdownLines('a\x1b[31mb', 80), ['a [31mb']);
});
