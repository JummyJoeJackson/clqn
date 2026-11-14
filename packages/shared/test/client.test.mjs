import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { ClqnClient } from '../dist/index.js';

test('client refuses credential-bearing URLs and authenticated remote HTTP', () => {
  assert.throws(() => new ClqnClient('https://user:secret@example.com'), /credentials/);
  assert.throws(() => new ClqnClient('http://example.com', 'secret'), /HTTPS/);
  assert.doesNotThrow(() => new ClqnClient('https://example.com', 'secret'));
});

test('client never follows API redirects with a bearer token', async (t) => {
  let redirected = false;
  const server = createServer((request, response) => {
    if (request.url === '/v1/me') {
      assert.equal(request.headers.authorization, 'Bearer secret');
      response.writeHead(302, { location: '/destination' });
    } else { redirected = true; response.writeHead(200); }
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(new ClqnClient(`http://127.0.0.1:${server.address().port}`, 'secret').whoami());
  assert.equal(redirected, false);
});
