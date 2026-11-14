# clqn

Your agents. My agents. One workspace.

A CLI-first shared workspace for humans and their AI agents. See [PLAN.md](PLAN.md) for the product architecture and roadmap.

This repository is the initial scaffold. It includes a working API liveness check through the CLI and a local stdio MCP server, shared validated contracts, and an initial PostgreSQL schema. Authentication, clan operations, agent registration, context, tasks, events, messaging, and SSE are not implemented yet. The two-user acceptance scenario in the plan is still future work.

## Local development

Install Node.js 22 or newer and npm 10 or newer.

```sh
npm install
npm run build
cp .env.example .env
npm run dev
```

In another terminal:

```sh
npm run cli -- --help
npm run cli -- health
npm run cli -- health --json
npm run cli -- --api-url http://127.0.0.1:3000 health
```

The API binds to `127.0.0.1:3000` by default. It reads the root `.env` on startup. `HOST` and `PORT` override the listener; set `HOST=0.0.0.0` when deploying to a container host. `GET /health` checks process liveness only; it does not indicate database readiness or authorization. Other routes return a structured 404.

The CLI reads `CLQN_API_URL` from its environment, or accepts `--api-url`. It does not automatically read `.env`. Successful JSON goes to stdout; errors go to stderr with a nonzero exit code. The root `npm run cli` command requires a build first. API watch mode picks up API source changes; rebuild after changing shared contracts.

## Hosting

The cloud API will be hosted on GCP with managed PostgreSQL. Choose a simple managed deployment; specific services and infrastructure configuration are still to be selected. Configure `HOST=0.0.0.0`, `PORT`, and `DATABASE_URL` through the deployment environment, and point local CLI/MCP clients at the deployed HTTPS endpoint using `CLQN_API_URL`. The CLI and stdio MCP adapter run on members' machines.

## Agent integration

Start the MCP adapter using `node /absolute/path/to/clqn/packages/cli/dist/index.js mcp`. Example agent configuration (replace the path):

```json
{
  "mcpServers": {
    "clqn": {
      "command": "node",
      "args": ["/absolute/path/to/clqn/packages/cli/dist/index.js", "mcp"],
      "env": { "CLQN_API_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

Only `clqn_health` is exposed today. The adapter uses the same HTTP client as the CLI and keeps stdout reserved for MCP protocol messages. It does not read local project files or register an agent automatically.

## Database foundation

Set `DATABASE_URL` in `.env` to a local or managed PostgreSQL connection string, then run:

```sh
npm run db:migrate
```

The committed Drizzle migration creates users, clans, and memberships. The schema uses provider-assigned user UUIDs, unique membership pairs, and explicit membership roles. Run `npm run db:generate` after schema changes and review the resulting SQL before applying it. Migrations use a single connection suitable for the migration endpoint supplied by your database provider. No database is needed to run the health check or smoke tests.

No authenticated collaboration routes are exposed. Server-side identity verification and clan authorization must be implemented before these tables are used by API operations. Direct SQL access is privileged and remains server-side.

## Structure and checks

| Workspace | Responsibility |
| --- | --- |
| `packages/shared` | Zod contracts, API errors, HTTP client |
| `packages/api` | Hono server, Drizzle schema and migrations |
| `packages/mcp` | Thin stdio MCP adapter |
| `packages/cli` | Commander commands and terminal output |

```sh
npm test
npm run typecheck
```

Workspaces build in dependency order using TypeScript with strict checking and ESM output. Tests use Node's built-in runner and exercise HTTP contracts, CLI JSON and failure behavior, and MCP discovery/tool invocation. CI runs the same checks on Node 22 and 24.

The current Drizzle Kit dependency tree reports four moderate development-only audit findings through its legacy esbuild loader. Production dependencies use patched releases. Avoid running Drizzle's development tooling as a public server; revisit the loader dependency when upgrading Drizzle Kit.

Next, implement authentication and a clan creation/membership vertical slice. Add authorization, concurrent context writes, and task ownership tests as those features arrive. Keep business logic on the API; CLI and MCP remain adapters. Orchestration, shared compute, and the website are deferred.
