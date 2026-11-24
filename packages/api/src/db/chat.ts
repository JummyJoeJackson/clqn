import { bigserial, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { agents, clans, users } from './schema.js';

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id, { onDelete: 'cascade' }),
    sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    agentId: uuid('agent_id').references(() => agents.id),
    // Display name at send time: the member's email or the agent's name.
    author: text('author').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_messages_clan_sequence_idx').on(table.clanId, table.sequence)],
);
