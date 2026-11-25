import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@clqn/shared';
import { messageLines, painter, threaded } from '../src/chat-view.js';

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

test('queued and processing messages shimmer until the orchestrator answers', () => {
  const paint = painter(true);
  const queued = messageLines(message, 60, 'me', paint, 3)[0]!;
  assert.match(queued.replace(/\x1b\[\d+m/g, ''), /Queued$/);
  assert.match(queued, /\x1b\[97mQ/);
  const processing = { ...message, processing: true };
  assert.match(messageLines(processing, 60, 'me', paint)[0]!.replace(/\x1b\[\d+m/g, ''), /Processing$/);
  const bright = (frame: number) =>
    [...messageLines(processing, 60, 'me', paint, frame)[0]!.matchAll(/\x1b\[97m(.)/g)].map((match) => match[1]);
  assert.deepEqual(bright(3), ['P']);
  assert.deepEqual(bright(5), ['o']);
  assert.notDeepEqual(bright(5), bright(6));
  // Handled messages never shimmer or show Processing.
  assert.doesNotMatch(messageLines({ ...processing, status: 'handled' }, 60, 'me', paint, 3)[0]!, /\x1b\[97m/);
});

test('answers sit right below the message they answer', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const at = (n: number, changes: Partial<ChatMessage>): ChatMessage => ({
    ...message,
    id: id(n),
    sequence: n,
    ...changes,
  });
  const first = at(1, {});
  const second = at(2, {});
  const answerToSecond = at(3, { role: 'orchestrator', replyTo: id(2), status: 'handled' });
  const answerToFirst = at(4, { role: 'orchestrator', replyTo: id(1), status: 'handled' });
  const workerResult = at(5, { role: 'worker', replyTo: id(1), status: 'handled' });
  const memberReply = at(6, { replyTo: id(1) });
  const answerToOlder = at(7, { role: 'orchestrator', replyTo: id(9), status: 'handled' });
  const order = threaded([first, second, answerToSecond, answerToFirst, workerResult, memberReply, answerToOlder]);
  assert.deepEqual(
    order.map(({ sequence }) => sequence),
    [1, 4, 5, 2, 3, 6, 7],
  );
});
