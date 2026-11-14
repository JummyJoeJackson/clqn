import { Hono } from 'hono';
import { VERSION, healthSchema } from '@clqn/shared';

export function createApp() {
  const app = new Hono();
  // Liveness only: this endpoint intentionally does not connect to the database.
  app.get('/health', (c) => c.json(healthSchema.parse({ status: 'ok', service: 'clqn-api', version: VERSION })));
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
  });
  return app;
}
