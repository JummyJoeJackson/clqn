import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serve } from '@hono/node-server';
import { createApp } from '../../api/dist/app.js';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('MCP discovers and calls the health tool through the protocol', async (t) => {
  const health = { status: 'ok', service: 'clqn-api', version: '0.1.0' };
  const server = createMcpServer({ health: async () => health });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 11);
  assert.ok(tools.some((tool) => tool.name === 'clqn_get_status'));
  assert.ok(tools.some((tool) => tool.name === 'clqn_write_context'));
  const result = await client.callTool({ name: 'clqn_health', arguments: {} });
  assert.deepEqual(JSON.parse(result.content[0].text), health);
});

test('CLI stdio MCP process reaches the real HTTP API', async (t) => {
  const http = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 });
  await once(http, 'listening');
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)),
      '--api-url', `http://127.0.0.1:${http.address().port}`, 'mcp'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'clqn_health', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).service, 'clqn-api');
});
