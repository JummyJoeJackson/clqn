import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createStore } from '../src/db/store.js';

export const skip = !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests';
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

// Connects to a dedicated test database and applies migrations. Teardown deletes only
// the users this test created and the clans they created; register other teardown first.
export async function database(t: TestContext) {
  const url = process.env.TEST_DATABASE_URL!;
  const sql = postgres(url, { max: 5 });
  const db = drizzle(sql);
  const connection = createStore(url);
  const userIds: string[] = [];
  t.after(async () => {
    try {
      if (userIds.length) await removeUsers(sql, userIds);
    } finally {
      await connection.close();
      await sql.end();
    }
  });
  await migrate(db, { migrationsFolder });
  const track = (...ids: string[]) => userIds.push(...ids);
  const user = async (email = `${randomUUID()}@example.com`) => {
    const provisioned = await connection.provisionUser(email);
    track(provisioned.user.id);
    return provisioned;
  };
  return { sql, db, connection, user, track };
}

async function removeUsers(sql: postgres.Sql, userIds: string[]) {
  const users = sql(userIds);
  const clans = sql`select id from clans where created_by in ${users}`;
  // Deleting a chat cascades to its messages and token hours; deleting a repository link, to its deliveries.
  await sql`delete from chats where clan_id in (${clans})`;
  await sql`delete from chat_members where clan_id in (${clans})`;
  await sql`delete from tasks where clan_id in (${clans})`;
  await sql`delete from context_revisions where clan_id in (${clans})`;
  await sql`delete from context_entries where clan_id in (${clans})`;
  await sql`delete from linked_repositories where clan_id in (${clans})`;
  await sql`delete from events where clan_id in (${clans}) or actor_id in ${users}`;
  await sql`delete from invitations where clan_id in (${clans}) or created_by in ${users}`;
  await sql`delete from credentials where user_id in ${users}`;
  await sql`delete from agents where clan_id in (${clans}) or owner_id in ${users}`;
  await sql`delete from memberships where clan_id in (${clans}) or user_id in ${users}`;
  await sql`delete from clans where created_by in ${users}`;
  await sql`delete from users where id in ${users}`;
}
