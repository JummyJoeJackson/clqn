import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { VERSION, healthSchema, createClanSchema, type User } from '@clqn/shared';
import { hashToken, type WorkspaceStore } from './store.js';

export function createApp(store?: WorkspaceStore) {
  const app = new Hono<{ Variables: { user: User } }>();
  // Liveness only: this endpoint intentionally does not connect to the database.
  app.get('/health', (c) => c.json(healthSchema.parse({ status: 'ok', service: 'clqn-api', version: VERSION })));
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const header = c.req.header('authorization');
    const token = header?.match(/^Bearer (clqn_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return c.json({ error: { code: 'UNAUTHORIZED', message: 'A valid bearer credential is required' } }, 401);
    if (!store) return c.json({ error: { code: 'UNAVAILABLE', message: 'Database is not configured' } }, 503);
    const user = await store.authenticate(hashToken(token));
    if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'A valid bearer credential is required' } }, 401);
    c.set('user', user);
    await next();
  });
  app.get('/v1/me', (c) => c.json(c.get('user')));
  app.get('/v1/clans', async (c) => c.json({ clans: await store!.listClans(c.get('user').id) }));
  app.post('/v1/clans', bodyLimit({ maxSize: 4096, onError: (c) =>
    c.json({ error: { code: 'INVALID_REQUEST', message: 'Request body is too large' } }, 413) }), async (c) => {
    const raw = await c.req.text();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return c.json({ error: { code: 'INVALID_REQUEST', message: 'Expected a JSON body' } }, 400); }
    const parsed = createClanSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Provide a clan name between 1 and 100 characters' } }, 400);
    return c.json(await store!.createClan(c.get('user').id, parsed.data.name), 201);
  });
  app.get('/v1/clans/:clanId/members', async (c) => {
    const id = z.uuid().safeParse(c.req.param('clanId'));
    const members = id.success ? await store!.members(c.get('user').id, id.data) : undefined;
    if (!members) return c.json({ error: { code: 'NOT_FOUND', message: 'Clan not found' } }, 404);
    return c.json({ members });
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));
  app.onError((error, c) => {
    // Database errors may contain SQL parameters. Never log request credentials or user data.
    console.error('API request failed', { name: error.name });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
  });
  return app;
}
