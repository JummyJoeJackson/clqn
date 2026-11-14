import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, createTaskSchema, type Actor, type Task } from '@clqn/shared';
import { requireClan, appendEvent, type WorkspaceDb } from './access.js';
import { tasks } from './db/tasks.js';

const taskView = (row: typeof tasks.$inferSelect): Task => ({
  ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const missingTask = () => new ApiError(404, 'NOT_FOUND', 'Task not found');
const conflict = () => new ApiError(409, 'TASK_CONFLICT', 'Task state or ownership does not allow this action');

export function createTaskRoutes(db: WorkspaceDb) {
  const app = new Hono<{ Variables: { user: Actor } }>();
  app.use('*', bodyLimit({ maxSize: 32 * 1024, onError: (c) =>
    c.json({ error: { code: 'INVALID_REQUEST', message: 'Request body is too large' } }, 413) }));
  app.get('/', async (c) => {
    const clanId = c.req.param('clanId')!;
    await requireClan(db, c.get('user'), clanId);
    const rows = await db.select().from(tasks).where(eq(tasks.clanId, clanId)).orderBy(tasks.createdAt, tasks.id);
    return c.json({ tasks: rows.map(taskView) });
  });
  app.post('/', async (c) => {
    const actor = c.get('user');
    const clanId = c.req.param('clanId')!;
    await requireClan(db, actor, clanId);
    const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'INVALID_REQUEST', 'Provide a task description between 1 and 4000 characters');
    const task = await db.transaction(async (tx) => {
      const [row] = await tx.insert(tasks).values({ clanId, description: parsed.data.description }).returning();
      if (!row) throw new Error('Task creation returned no row');
      await appendEvent(tx, { clanId, actorId: actor.id, agentId: actor.agentId ?? null, type: 'task.created', resourceId: row.id });
      return taskView(row);
    });
    return c.json(task, 201);
  });
  for (const action of ['claim', 'release', 'complete'] as const) {
    app.post(`/:taskId/${action}`, async (c) => {
      const actor = c.get('user');
      const clanId = c.req.param('clanId')!;
      const membership = await requireClan(db, actor, clanId);
      const taskId = z.uuid().safeParse(c.req.param('taskId'));
      if (!taskId.success) throw missingTask();
      const body = z.object({}).strict().safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new ApiError(400, 'INVALID_REQUEST', 'Expected an empty JSON object');
      const task = await db.transaction(async (tx) => {
        const owner = and(eq(tasks.ownerId, actor.id), actor.agentId
          ? eq(tasks.ownerAgentId, actor.agentId) : isNull(tasks.ownerAgentId));
        const leaderReset = action === 'release' && !actor.agentId && membership.role === 'leader';
        const conditions = and(eq(tasks.clanId, clanId), eq(tasks.id, taskId.data),
          eq(tasks.status, action === 'claim' ? 'open' : 'claimed'),
          action === 'claim' || leaderReset ? undefined : owner);
        const update = action === 'claim'
          ? { status: 'claimed' as const, ownerId: actor.id, ownerAgentId: actor.agentId ?? null, updatedAt: sql`now()` }
          : action === 'release'
            ? { status: 'open' as const, ownerId: null, ownerAgentId: null, updatedAt: sql`now()` }
            : { status: 'completed' as const, updatedAt: sql`now()` };
        const [row] = await tx.update(tasks).set(update).where(conditions).returning();
        if (!row) {
          const [existing] = await tx.select({ id: tasks.id }).from(tasks)
            .where(and(eq(tasks.clanId, clanId), eq(tasks.id, taskId.data)));
          if (!existing) throw missingTask();
          throw conflict();
        }
        const type = { claim: 'task.claimed', release: 'task.released', complete: 'task.completed' }[action];
        await appendEvent(tx, { clanId, actorId: actor.id, agentId: actor.agentId ?? null, type, resourceId: row.id });
        return taskView(row);
      });
      return c.json(task);
    });
  }
  return app;
}
