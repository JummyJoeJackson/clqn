import { type Actor, ApiError, chatQuerySchema, sendChatSchema } from '@clqn/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { chatMessages } from '../db/chat.js';
import { agents } from '../db/schema.js';
import { lockClan, requireClan, type WorkspaceDb } from '../lib/access.js';

const view = (row: typeof chatMessages.$inferSelect) => ({
  id: row.id,
  sequence: row.sequence,
  author: row.author,
  authorId: row.authorId,
  agentId: row.agentId,
  text: row.text,
  createdAt: row.createdAt.toISOString(),
});

export function createChatRoutes(db: WorkspaceDb) {
  const app = new Hono<{ Variables: { user: Actor } }>();
  // Without `after`, return the latest messages; with it, return what came next, oldest first.
  app.get('/', async (c) => {
    const clanId = c.req.param('clanId')!;
    await requireClan(db, c.get('user'), clanId);
    const query = chatQuerySchema.safeParse(c.req.query());
    if (!query.success) throw new ApiError(400, 'INVALID_REQUEST', 'Use a limit between 1 and 200 and a valid cursor');
    const { after, limit } = query.data;
    const scope = eq(chatMessages.clanId, clanId);
    const rows =
      after === undefined
        ? (
            await db.select().from(chatMessages).where(scope).orderBy(desc(chatMessages.sequence)).limit(limit)
          ).reverse()
        : await db
            .select()
            .from(chatMessages)
            .where(and(scope, gt(chatMessages.sequence, after)))
            .orderBy(chatMessages.sequence)
            .limit(limit);
    return c.json({ messages: rows.map(view) });
  });
  app.post(
    '/',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: { code: 'INVALID_REQUEST', message: 'Request body is too large' } }, 413),
    }),
    async (c) => {
      const actor = c.get('user');
      const clanId = c.req.param('clanId')!;
      const parsed = sendChatSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new ApiError(400, 'INVALID_REQUEST', 'Provide message text up to 4000 characters');
      const message = await db.transaction(async (tx) => {
        await requireClan(tx, actor, clanId, 'share');
        let author = actor.email;
        if (actor.agentId) {
          const [agent] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, actor.agentId));
          author = agent?.name ?? author;
        }
        // Allocate sequences in commit order so polling with `after` cannot skip a late commit.
        await lockClan(tx, clanId);
        const [row] = await tx
          .insert(chatMessages)
          .values({ clanId, authorId: actor.id, agentId: actor.agentId ?? null, author, text: parsed.data.text })
          .returning();
        return row!;
      });
      return c.json(view(message), 201);
    },
  );
  return app;
}
