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
- **Shared context:** Build toward persistent knowledge and task coordination across people, machines, and agent sessions.

clqn is in early development. Personal authentication, private clan creation, email-bound invitations, membership reads, API health checks, and a local MCP health adapter work today. Agent registration, shared context, and tasks are next. See the [roadmap](PLAN.md).

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

Invitations expire after seven days and require the authenticated user's email to match. `init` and `join` select the clan for subsequent commands; use `--clan <id>` on `invite` or `members` to choose another clan. Email labels are provisioned by the operator and are not proof of mailbox ownership. Invitations are delivered manually; clqn sends no email.

See [authentication and clans](docs/authentication.md) for provisioning, credential storage, and revocation.

Connect an agent by adding the local stdio MCP server to its configuration (replace the path):

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

The adapter currently exposes `clqn_health` to check API liveness. It does not register an agent or access local project files automatically.

## Documentation

- [Project architecture and roadmap](PLAN.md)
- [GCP hosting](docs/hosting.md)
- [Database setup and migrations](docs/database.md)
- [Authentication and clans](docs/authentication.md)

## Contributing

See the [contribution guide](CONTRIBUTING.md) for local development, project structure, and checks. Keep changes small and focused on the current milestone.
