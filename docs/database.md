# Database setup

Use local PostgreSQL for development or managed PostgreSQL on GCP. Set `DATABASE_URL` in the root `.env` to the connection string, then run:

```sh
npm run db:migrate
```

The committed Drizzle migration creates users, clans, and memberships. The schema uses provider-assigned user UUIDs, unique membership pairs, and explicit membership roles. Migrations use a single connection suitable for the migration endpoint supplied by your database provider.

## Schema changes

Edit `packages/api/src/db/schema.ts`, then generate a migration:

```sh
npm run db:generate
```

Review the generated SQL in `packages/api/drizzle` before applying it with `npm run db:migrate`. Commit schema changes and their generated migrations together.

## Current scope

No database is needed to run health checks or smoke tests. No authenticated collaboration routes are exposed yet. Implement server-side identity verification and clan authorization before using these tables through API operations. Direct SQL access is privileged and remains server-side.
