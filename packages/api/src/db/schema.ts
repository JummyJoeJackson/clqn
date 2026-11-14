import type { PolicySettings } from '@clqn/shared';
import { pgTable, uuid, text, timestamp, primaryKey, pgEnum, bigserial, jsonb, integer } from 'drizzle-orm/pg-core';

export const membershipRole = pgEnum('membership_role', ['leader', 'member']);

// User identities are provisioned server-side alongside opaque credentials.
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clans = pgTable('clans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  clanId: uuid('clan_id').notNull().references(() => clans.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: membershipRole('role').notNull().default('member'),
  agentPolicy: jsonb('agent_policy').$type<PolicySettings>(),
  policyRevision: integer('policy_revision').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.clanId, table.userId] })]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  clanId: uuid('clan_id').notNull().references(() => clans.id),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Opaque credentials are provisioned by the server operator; raw tokens are never stored.
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  agentId: uuid('agent_id').references(() => agents.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Only hashes are persisted; the raw invitation code is returned once to the leader.
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clanId: uuid('clan_id').notNull().references(() => clans.id),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const events = pgTable('events', {
  sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
  resourceId: text('resource_id'),
  id: uuid('id').primaryKey().defaultRandom(),
  clanId: uuid('clan_id').notNull().references(() => clans.id),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  agentId: uuid('agent_id').references(() => agents.id),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
