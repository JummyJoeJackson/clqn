import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { agents, clans, users } from './schema.js';

export const taskStatus = pgEnum('task_status', ['open', 'claimed', 'completed']);
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  clanId: uuid('clan_id').notNull().references(() => clans.id),
  description: text('description').notNull(),
  status: taskStatus('status').notNull().default('open'),
  ownerId: uuid('owner_id').references(() => users.id),
  ownerAgentId: uuid('owner_agent_id').references(() => agents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('tasks_clan_idx').on(table.clanId),
  check('task_owner_matches_status', sql`(${table.status} = 'open' AND ${table.ownerId} IS NULL AND ${table.ownerAgentId} IS NULL) OR (${table.status} IN ('claimed', 'completed') AND ${table.ownerId} IS NOT NULL)`),
]);
