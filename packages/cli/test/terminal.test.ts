import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalText } from '../src/terminal.js';

test('terminal links have a copyable URL label and piped output stays plain', (t) => {
  const terminal = process.env.TERM;
  t.after(() => {
    if (terminal === undefined) delete process.env.TERM;
    else process.env.TERM = terminal;
  });
  process.env.TERM = 'xterm';
  const url = 'https://github.com/example/project/pull/5';
  const text = `Pull request\n${url}`;
  assert.equal(terminalText(text, false, [url]), text);
  assert.equal(terminalText(text, true, [url]), `Pull request\n\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`);
  process.env.TERM = 'dumb';
  assert.equal(terminalText(text, true, [url]), text);
});

test('terminal link rendering strips injected escapes and ignores unsupported targets', () => {
  const text = '\x1b]8;;file:///tmp/hidden\x07';
  assert.equal(terminalText(text, true, ['file:///tmp/hidden', text]), ' ]8;;file:///tmp/hidden ');
});
