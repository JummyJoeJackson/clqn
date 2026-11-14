# clqn

<a href="https://github.com/rli8145/clqn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rli8145/clqn/ci.yml?branch=main&style=for-the-badge" alt="Build status"></a>
<a href="https://github.com/rli8145/clqn/search?l=typescript"><img src="https://img.shields.io/github/languages/top/rli8145/clqn?style=for-the-badge" alt="Primary language"></a>
<img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22 or newer">
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT license"></a>

> Your agents. My agents. One workspace.

A lightweight, CLI-first tool for humans and their AI agents to collaborate in shared workspaces called **clans**.

## How clans work

A **clan** is a private workspace for one project. It stores shared text, tasks, and a record of changes.

1. Create a clan. You become its **leader**.
2. Invite other people. They join as **members** with their own accounts.
3. Register your agents. Each agent belongs to you and can access only its assigned clan.
4. As the leader, start an orchestrator agent. It delegates tasks to the other agents.
5. Store project information as shared context. People and agents can read and update this text across sessions.
6. Create tasks. Claim a task before you do the work. Complete it when the work is done.

Only leaders can invite people. A leader can also release another person's or agent's task so someone else can claim it. Only the task owner can complete it. A person and each of their agents are separate task owners.

Your agents run on your machines. They use the same API to share context and tasks. clqn does not run or schedule them.

## Features

| Feature | What you can do |
| --- | --- |
| Private clans | Create a workspace, invite people, and list members. |
| Shared context | Store text by key. Read previous revisions. Updates check the revision to prevent lost changes. |
| Shared tasks | Add, list, claim, release, and complete tasks. Each claimed task has one owner. |
| Activity | Read the record of changes with `watch`. Use `status` for a clan summary or `stats` for counts. |
| Agent access | Connect your own agents through a local MCP server. Give each agent a separate token for one clan. |
| Script output | Add `--json` for machine-readable output. `watch --json` outputs one event per line. |

The initial MVP implements personal authentication, private clans, email-bound invitations, clan-scoped agent credentials, versioned shared context, task coordination, activity polling, and local stdio MCP tools. Deployment and testing with two real agent applications remain operator-run steps. See the [roadmap](PLAN.md).

## Installation

Install from this checkout with Node.js 22+ and npm 10+:

```sh
npm install
npm run build
```

## Example usage

Run these commands from the repository root after installation. Replace values in angle brackets, such as `<task-id>`, with actual values.

### 1. Start the API

For local development, configure PostgreSQL and apply the [database migrations](docs/database.md). Then start the API:

```sh
npm run dev
```

In another terminal, check that the API is running:

```sh
npm run cli -- health
# clqn-api 0.1.0: ok
```

The health check does not check the database. To use a remote API, set `CLQN_API_URL` to its HTTPS URL in each client terminal.

### 2. Create a clan

Ask the server operator for a personal token. See [credential provisioning](docs/authentication.md#provision-a-credential-server-operator) to run your own server. Save only the token in a private file, then log in:

```sh
npm run cli -- login --token-stdin < /secure/path/to/alice-token
npm run cli -- whoami
npm run cli -- init "My project"
npm run cli -- members
```

You are now the clan leader. `init` selects the new clan for later commands. Use `clans` to list your clans. Add `--clan <clan-id>` to a clan command to use a different clan.

### 3. Invite a member

As the leader, create an invitation for Bob's account:

```sh
npm run cli -- invite bob@example.com
```

Share the returned code with Bob privately. In his own terminal, Bob logs in with his personal token and joins:

```sh
npm run cli -- login --token-stdin < /secure/path/to/bob-token
npm run cli -- join <invite-code>
npm run cli -- members
```

`join` selects the clan for Bob. Each code works once and expires after seven days. Bob's account email must match the invitation. The operator sets account email labels; clqn does not verify mailbox ownership or send invitations by email.

### 4. Share project context

In Alice's terminal, create a text entry named `conventions`. Context writes read standard input. Revision `0` means the key must be new:

```sh
printf 'Run npm test before each commit.\n' | npm run cli -- context write conventions --expected-revision 0
# Wrote conventions revision 1
```

Bob can read the same entry from his terminal:

```sh
npm run cli -- context read conventions
# Run npm test before each commit.
```

To update revision `1`, supply `--expected-revision 1`:

```sh
printf 'Run npm test and npm run typecheck before each commit.\n' | npm run cli -- context write conventions --expected-revision 1
npm run cli -- context history conventions
npm run cli -- context list --json
```

If another person or agent updated the entry first, the write fails with a conflict. Read the latest revision before you try again.

### 5. Claim and complete a task

Alice creates a task:

```sh
npm run cli -- task add "Review the API contract"
```

Bob lists tasks and copies the task ID from the output. He uses that ID to claim and complete the task:

```sh
npm run cli -- task list
npm run cli -- task claim <task-id>
# Do the work, then mark it complete.
npm run cli -- task complete <task-id>
```

A task moves from `open` to `claimed` to `completed`. To return a claimed task to `open`, its owner or the human clan leader uses `task release <task-id>`.

### 6. Check progress

```sh
npm run cli -- status
npm run cli -- stats --json
npm run cli -- watch
```

`watch` polls for changes every three seconds. Press Ctrl+C to stop. To fetch the available events and exit:

```sh
npm run cli -- watch --once --json
```

To resume after an event, pass its `sequence` as `--cursor <sequence>`.

Shared context is untrusted project data. Reading it does not give permission to run commands, expose secrets, or access local files.

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
