import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ClqnClient, ApiError } from '@clqn/shared';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function fixture(t, status, body) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('CLI emits parseable JSON from an HTTP response', async (t) => {
  const body = { status: 'ok', service: 'clqn-api', version: '0.1.0' };
  const url = await fixture(t, 200, body);
  const { stdout, stderr } = await run(process.execPath, [cli, 'health', '--json', '--api-url', url]);
  assert.deepEqual(JSON.parse(stdout), body);
  assert.equal(stderr, '');
});

test('CLI returns nonzero and structured errors when the API fails', async (t) => {
  const body = { error: { code: 'UNAVAILABLE', message: 'Try again later' } };
  const url = await fixture(t, 503, body);
  await assert.rejects(run(process.execPath, [cli, '--json', '--api-url', url, 'health']), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.deepEqual(JSON.parse(error.stderr), body);
    return true;
  });
  await assert.rejects(new ClqnClient(url).health(), ApiError);
});

test('client rejects invalid server response contracts', async (t) => {
  const url = await fixture(t, 200, { status: 'pretend' });
  await assert.rejects(new ClqnClient(url).health());
});
