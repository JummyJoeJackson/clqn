# Contributing

clqn is a lightweight, CLI-first project. Read [PLAN.md](PLAN.md) for scope and [AGENTS.md](AGENTS.md) for agent workflow instructions. Prefer small working vertical slices and minimal dependencies. Keep business logic in the API and CLI/MCP integrations thin.

## Local development

Use Node.js 22+ and npm 10+:

```sh
npm install
npm run build
cp .env.example .env
npm run dev
```

The API reads the root `.env` on startup and defaults to `127.0.0.1:3000`. Override the listener with `HOST` and `PORT`. API watch mode picks up API source changes; rebuild after changing shared contracts.

The CLI requires a build first. It reads `CLQN_API_URL` from the environment, or accepts `--api-url`; it does not automatically read `.env`.

```sh
npm run cli -- --help
npm run cli -- --api-url http://127.0.0.1:3000 health
```

Successful JSON goes to stdout; errors go to stderr with a nonzero exit code. The MCP adapter reserves stdout for protocol messages and uses the same HTTP client as the CLI.

## Project structure

| Workspace | Responsibility |
| --- | --- |
| `packages/shared` | Zod contracts, API errors, HTTP client |
| `packages/api` | Hono server, Drizzle schema and migrations |
| `packages/mcp` | Thin stdio MCP adapter |
| `packages/cli` | Commander commands and terminal output |

Workspaces build in dependency order with strict TypeScript checking and ESM output.

## Checks

```sh
npm test
npm run typecheck
```

`npm test` builds all workspaces and runs Node's built-in test runner. Tests cover HTTP contracts, CLI JSON and failure behavior, MCP discovery and invocation, and a real stdio-to-HTTP flow. Default tests require local loopback access but no database. PostgreSQL integration tests are skipped unless `TEST_DATABASE_URL` is set to a dedicated test database; CI supplies PostgreSQL and runs all checks on Node 22 and 24. See [database setup](docs/database.md).

Authorization, credential revocation, and concurrent clan creation are covered. Add concurrent context write and task ownership tests as those features are implemented. For documentation-only changes, check formatting and relative links.

The current Drizzle Kit dependency tree reports four moderate development-only audit findings through its legacy esbuild loader. Production dependencies use patched releases. Avoid running Drizzle's development tooling as a public server; revisit the loader dependency when upgrading Drizzle Kit.

## Commits

Commit incrementally using `<type>(optional scope): <brief description>`, for example `feat(cli): add clan status`. Keep unrelated existing changes out of commits.
