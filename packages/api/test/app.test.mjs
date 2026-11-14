import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { healthSchema, errorSchema } from '@clqn/shared';

test('health endpoint satisfies the shared contract without a database', async () => {
  const response = await createApp().request('/health');
  assert.equal(response.status, 200);
  assert.equal(healthSchema.parse(await response.json()).status, 'ok');
});

test('unknown workspace endpoints expose no data', async () => {
  const response = await createApp().request('/v1/clans');
  assert.equal(response.status, 404);
  assert.equal(errorSchema.parse(await response.json()).error.code, 'NOT_FOUND');
});
