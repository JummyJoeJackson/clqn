import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ApiError, type Actor } from '@clqn/shared';
import { memberships, events } from './db/schema.js';

export type WorkspaceDb = PostgresJsDatabase;

export function requirePersonal(actor: Actor): void {
  if (actor.agentId) throw new ApiError(403, 'FORBIDDEN', 'A personal credential is required');
}

export async function requireClan(db: WorkspaceDb, actor: Actor, clanId: string) {
  if (!z.uuid().safeParse(clanId).success) throw new ApiError(404, 'NOT_FOUND', 'Clan not found');
  if (actor.agentId && actor.clanId !== clanId) throw new ApiError(404, 'NOT_FOUND', 'Clan not found');
  const [membership] = await db.select().from(memberships).where(and(
    eq(memberships.userId, actor.id), eq(memberships.clanId, clanId)));
  if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Clan not found');
  return membership;
}

// Allocate each clan's event cursor only after earlier writers commit, so polling cannot skip late commits.
export async function appendEvent(tx: Pick<WorkspaceDb, 'execute' | 'insert'>, event: typeof events.$inferInsert) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.clanId}::text, 0))`);
  await tx.insert(events).values(event);
}
