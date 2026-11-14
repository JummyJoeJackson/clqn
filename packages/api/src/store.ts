import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql as query } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ApiError, type Clan, type User } from '@clqn/shared';
import * as schema from './db/schema.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export type Member = { userId: string; email: string; role: 'leader' | 'member'; createdAt: string };
export interface WorkspaceStore {
  createInvitation(userId: string, clanId: string, email: string): Promise<{ code: string; clanId: string; email: string; expiresAt: string } | undefined>;
  joinInvitation(user: User, code: string): Promise<Clan | undefined>;
  authenticate(tokenHash: string): Promise<User | undefined>;
  createClan(userId: string, name: string): Promise<Clan>;
  listClans(userId: string): Promise<Clan[]>;
  members(userId: string, clanId: string): Promise<Member[] | undefined>;
}

export function createStore(url: string) {
  const sql = postgres(url, { max: 5 });
  const db = drizzle(sql);
  const clanView = (clan: typeof schema.clans.$inferSelect): Clan => ({ ...clan, createdAt: clan.createdAt.toISOString() });
  const store: WorkspaceStore = {
    async authenticate(tokenHash) {
      const [result] = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.credentials)
        .innerJoin(schema.users, eq(schema.credentials.userId, schema.users.id))
        .where(eq(schema.credentials.tokenHash, tokenHash));
      return result;
    },
    async createClan(userId, name) {
      return db.transaction(async (tx) => {
        const [clan] = await tx.insert(schema.clans).values({ name, createdBy: userId }).returning();
        if (!clan) throw new Error('Clan creation returned no row');
        await tx.insert(schema.memberships).values({ clanId: clan.id, userId, role: 'leader' });
        await tx.insert(schema.events).values({ clanId: clan.id, actorId: userId, type: 'clan.created' });
        return clanView(clan);
      });
    },
    async createInvitation(userId, clanId, email) {
      return db.transaction(async (tx) => {
        const [leader] = await tx.select().from(schema.memberships).where(and(
          eq(schema.memberships.clanId, clanId), eq(schema.memberships.userId, userId),
          eq(schema.memberships.role, 'leader')));
        if (!leader) return undefined;
        const code = `clqn_inv_${randomBytes(32).toString('base64url')}`;
        const [invitation] = await tx.insert(schema.invitations).values({ clanId, email, createdBy: userId,
          codeHash: hashToken(code), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }).returning();
        if (!invitation) throw new Error('Invitation creation returned no row');
        await tx.insert(schema.events).values({ clanId, actorId: userId, type: 'invitation.created' });
        return { code, clanId, email, expiresAt: invitation.expiresAt.toISOString() };
      });
    },
    async joinInvitation(user, code) {
      return db.transaction(async (tx) => {
        // The conditional update locks and consumes exactly one valid invitation. All writes roll back together.
        const [invitation] = await tx.update(schema.invitations).set({ consumedAt: query`now()` }).where(and(
          eq(schema.invitations.codeHash, hashToken(code)), eq(schema.invitations.email, user.email),
          isNull(schema.invitations.consumedAt), gt(schema.invitations.expiresAt, query`now()`))).returning();
        if (!invitation) return undefined;
        const [membership] = await tx.insert(schema.memberships).values({ clanId: invitation.clanId, userId: user.id })
          .onConflictDoNothing().returning();
        if (!membership) throw new ApiError(409, 'ALREADY_MEMBER', 'You are already a member of this clan');
        await tx.insert(schema.events).values({ clanId: invitation.clanId, actorId: user.id, type: 'member.joined' });
        const [clan] = await tx.select().from(schema.clans).where(eq(schema.clans.id, invitation.clanId));
        if (!clan) throw new Error('Invitation clan not found');
        return clanView(clan);
      });
    },
    async listClans(userId) {
      const rows = await db.select({ clan: schema.clans }).from(schema.memberships)
        .innerJoin(schema.clans, eq(schema.memberships.clanId, schema.clans.id))
        .where(eq(schema.memberships.userId, userId)).orderBy(schema.clans.createdAt, schema.clans.id);
      return rows.map(({ clan }) => clanView(clan));
    },
    async members(userId, clanId) {
      const [membership] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships)
        .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clanId, clanId)));
      if (!membership) return undefined;
      const rows = await db.select({ userId: schema.users.id, email: schema.users.email,
        role: schema.memberships.role, createdAt: schema.memberships.createdAt }).from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(eq(schema.memberships.clanId, clanId)).orderBy(schema.memberships.createdAt, schema.users.id);
      return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    },
  };
  return {
    store,
    async provisionUser(email: string) {
      const token = `clqn_${randomBytes(32).toString('base64url')}`;
      const result = await db.transaction(async (tx) => {
        const [user] = await tx.insert(schema.users).values({ id: randomUUID(), email }).onConflictDoUpdate({
          target: schema.users.email, set: { email },
        }).returning({ id: schema.users.id, email: schema.users.email });
        if (!user) throw new Error('User creation returned no row');
        const [credential] = await tx.insert(schema.credentials).values({ userId: user.id, tokenHash: hashToken(token) })
          .returning({ id: schema.credentials.id });
        if (!credential) throw new Error('Credential creation returned no row');
        return { user, credentialId: credential.id };
      });
      return { ...result, token };
    },
    async revokeCredential(id: string) {
      const rows = await db.delete(schema.credentials).where(eq(schema.credentials.id, id)).returning({ id: schema.credentials.id });
      return rows.length > 0;
    },
    close: () => sql.end(),
  };
}
