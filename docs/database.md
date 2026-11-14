# Database setup

Use local PostgreSQL for development or managed PostgreSQL on GCP. Set `DATABASE_URL` in the root `.env` to the connection string, then run:

```sh
npm run db:migrate
```

The committed Drizzle migrations create users, credentials, clans, memberships, invitations, and audit events. The schema uses server-assigned user UUIDs, unique credential hashes and membership pairs, and explicit membership roles. Migrations use a single connection suitable for the migration endpoint supplied by your database provider.

## Schema changes

Edit `packages/api/src/db/schema.ts`, then generate a migration:

```sh
npm run db:generate
```

Review the generated SQL in `packages/api/drizzle` before applying it with `npm run db:migrate`. Commit schema changes and their generated migrations together.

## Current scope

No database is needed for health checks or the default smoke tests. Authenticated routes require PostgreSQL and verify personal credentials and clan membership on the server. See [authentication and clans](authentication.md) for provisioning and API routes. Direct SQL access is privileged and remains server-side.

Set `TEST_DATABASE_URL` to a dedicated test PostgreSQL database to run integration checks with `npm test`. The suite applies migrations, exercises concurrent clan creation and invitation consumption, identity binding, expiry, isolation, credential revocation, and a two-user CLI-to-API flow, then deletes its own test records. CI provides PostgreSQL and runs this suite on Node 22 and 24. Never point integration tests at a production database.
