import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@clqn/shared';
import { messageLines, painter } from '../src/chat-view.js';

const message: ChatMessage = {
  id: '00000000-0000-4000-8000-000000000001',
  sequence: 1,
  authorId: '00000000-0000-4000-8000-000000000002',
  author: 'ana@example.com',
  role: 'member',
  createdAt: new Date().toISOString(),
  text: 'Fix the links',
  status: 'queued',
  replyTo: null,
};

test('a queued message the orchestrator is handling shows a shimmering Processing', () => {
  const paint = painter(true);
  const still = messageLines(message, 60, 'me', paint)[0]!;
  assert.match(still, /\x1b\[90mQueued\x1b\[0m/);
  assert.match(messageLines(message, 60, 'me', paint, 0)[0]!.replace(/\x1b\[\d+m/g, ''), /Processing$/);
  const bright = (frame: number) =>
    [...messageLines(message, 60, 'me', paint, frame)[0]!.matchAll(/\x1b\[97m(.)/g)].map((match) => match[1]);
  assert.deepEqual(bright(3), ['P']);
  assert.deepEqual(bright(5), ['o']);
  assert.notDeepEqual(bright(5), bright(6));
  // Handled messages never shimmer or show Processing.
  assert.doesNotMatch(messageLines({ ...message, status: 'handled' }, 60, 'me', paint, 3)[0]!, /\x1b\[97m/);
});
