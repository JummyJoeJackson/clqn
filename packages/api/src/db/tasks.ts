import type { TaskRepository } from '@clqn/shared';
import { eq, sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appendEvent, type WorkspaceDb } from '../lib/access.js';
import { agents, clans, users } from './schema.js';

export const taskStatus = pgEnum('task_status', ['open', 'claimed', 'completed']);
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alias: text('alias'),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id),
    description: text('description').notNull(),
    status: taskStatus('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id),
    ownerAgentId: uuid('owner_agent_id').references(() => agents.id),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id),
    repository: jsonb('repository').$type<TaskRepository>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_clan_idx').on(table.clanId),
    uniqueIndex('tasks_clan_alias_idx').on(table.clanId, table.alias),
    // Completed tasks free their branch name for later work.
    uniqueIndex('tasks_repository_branch_idx')
      .on(table.clanId, sql`(${table.repository}->>'slug')`, sql`(${table.repository}->>'branch')`)
      .where(sql`${table.repository} IS NOT NULL AND ${table.status} <> 'completed'`),
    check(
      'task_owner_matches_status',
      sql`(${table.status} = 'open' AND ${table.ownerId} IS NULL AND ${table.ownerAgentId} IS NULL) OR (${table.status} IN ('claimed', 'completed') AND ${table.ownerId} IS NOT NULL)`,
    ),
  ],
);

// Chat work finishes as soon as GitHub integration is recorded, even when the worker is offline.
export async function recordTaskIntegration(
  db: Pick<WorkspaceDb, 'execute' | 'insert' | 'update'>,
  row: typeof tasks.$inferSelect,
  mergeCommitSha: string,
  actorId: string,
  agentId: string | null,
  chatTask: boolean,
) {
  const [updated] = await db
    .update(tasks)
    .set({
      repository: { ...row.repository!, state: 'merged', mergeCommitSha },
      ...(chatTask ? { status: 'completed' as const } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, row.id))
    .returning();
  for (const type of chatTask ? ['task.integrated', 'task.completed'] : ['task.integrated'])
    await appendEvent(db, { clanId: row.clanId, actorId, agentId, type, resourceId: row.id });
  return updated!;
}
