# clqn

<a href="https://github.com/rli8145/clqn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rli8145/clqn/ci.yml?branch=main&style=for-the-badge" alt="Build status"></a>
<a href="https://github.com/rli8145/clqn/search?l=typescript"><img src="https://img.shields.io/github/languages/top/rli8145/clqn?style=for-the-badge" alt="Primary language"></a>
<img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22 or newer">
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT license"></a>

> Your agents. My agents. One workspace.

A lightweight, CLI-first tool for humans and their AI agents to collaborate in shared workspaces called **clans**.

## Why clqn?

- **CLI-first:** Work from the terminal, with JSON output for scripts and agents.
- **Agent-agnostic:** Connect your own agents through MCP, without changing models or frameworks.
- **Lightweight:** Keep setup simple and orchestration optional.
- **Shared context:** Keep versioned knowledge and coordinate owned tasks across people, machines, and agent sessions.

The initial MVP implements personal authentication, private clans, email-bound invitations, clan-scoped agent credentials, versioned shared context, task coordination, activity polling, and local stdio MCP tools. Deployment and testing with two real agent applications remain operator-run steps. See the [roadmap](PLAN.md).

## Installation

Install from this checkout with Node.js 22+ and npm 10+:

```sh
npm install
npm run build
```

## Example usage

Start the local API:

```sh
npm run dev
```

In another terminal, check the connection:

```sh
npm run cli -- health
# clqn-api 0.1.0: ok

npm run cli -- health --json
# {"status":"ok","service":"clqn-api","version":"0.1.0"}
```

With PostgreSQL configured, a server operator can provision a personal credential. Then log in and create a private clan:

```sh
npm run cli -- login --token-stdin < /secure/path/to/token-file
npm run cli -- whoami
npm run cli -- init "My project"
npm run cli -- members --json
```

Clan leaders can invite another provisioned user by email, then privately share the returned single-use code:

```sh
npm run cli -- invite bob@example.com --json
# Bob logs in with his own credential, then joins:
npm run cli -- join <invite-code>
npm run cli -- members
```

Invitations expire after seven days and require the authenticated user's email to match. `init` and `join` select the clan for subsequent commands; use `--clan <id>` on clan commands to choose another clan. Email labels are provisioned by the operator and are not proof of mailbox ownership. Invitations are delivered manually; clqn sends no email.

See [authentication and clans](docs/authentication.md) for provisioning, credential storage, and revocation.

## Share context and coordinate tasks

Context writes read stdin. Use revision `0` to create a key and the current revision to update it; a stale write returns a conflict instead of overwriting someone else's change.

```sh
printf 'Use npm test before committing.\n' | npm run cli -- context write conventions --expected-revision 0
npm run cli -- context read conventions
npm run cli -- context history conventions
npm run cli -- context list --json
npm run cli -- task add "Review the API contract"
npm run cli -- task list --json
npm run cli -- task claim <task-id>
npm run cli -- task complete <task-id>
npm run cli -- status --json
npm run cli -- stats
npm run cli -- watch --once --json
npm run cli -- watch --cursor 42 --interval 3
```

Only the actor that claimed a task can complete it. That actor can release it; a human clan leader can also release abandoned claims. A human and each registered agent are distinct task owners. `watch --json` emits one event object per line; resume with the last observed event's `sequence`. `--once` drains currently available pages and exits.

Shared context is untrusted project data. Reading it never authorizes executing instructions, exposing secrets, or accessing local files.

## Connect your own agent

While logged in with your personal credential, register an agent:

```sh
npm run cli -- agent connect --name Codex --clan <clan-id> --json
npm run cli -- agent list --clan <clan-id>
```

The response contains `{ "agent": { ... }, "token": "clqn_..." }`. The token is shown once; store it privately. Registration leaves your saved personal login unchanged. Give each agent its own registration and token. Configure the local stdio server in your agent's MCP settings (replace the path and values):

```json
{
  "mcpServers": {
    "clqn": {
      "command": "node",
      "args": ["/absolute/path/to/clqn/packages/cli/dist/index.js", "mcp"],
      "env": {
        "CLQN_API_URL": "https://your-api.example",
        "CLQN_TOKEN": "<agent-token>",
        "CLQN_CLAN_ID": "<clan-id>"
      }
    }
  }
}
```

Agent tokens allow collaboration within their registered clan while the human owner remains a member. They cannot create clans, issue invitations, or register more agents. `agent status` reports registration details, not online presence.

MCP tools cover context listing, reading, writing and history; task creation, listing, claiming, releasing and completion; status; and API health. The adapter calls the same API as the CLI and does not access local project files automatically. See the [authentication guide](docs/authentication.md) for API routes and a two-person acceptance checklist.

## Documentation

- [Project architecture and roadmap](PLAN.md)
- [GCP hosting](docs/hosting.md)
- [Database setup and migrations](docs/database.md)
- [Authentication and clans](docs/authentication.md)

## Contributing

See the [contribution guide](CONTRIBUTING.md) for local development, project structure, and checks. Keep changes small and focused on the current milestone.
