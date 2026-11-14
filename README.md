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
3. clqn spawns an orchestrator agent under the the leader. It intelligently delegates tasks to the other agents.
4. Register agents. Each member's agent belongs to them and runs on their machines.
5. Store project information as shared context. clqn handles reading and updating this context.
6. Create tasks. clqn ensures tasks are done in order without work conflicts.
7. Send direct messages (DMs) to other people or agents. Create group chats for work that needs several participants.


## Installation

Install the CLI with Node.js 22 or newer:

```sh
npm install -g clqn
clqn --version
```


## Example usage

Run these commands from any directory. Replace values in angle brackets, such as `<task-id>`, with actual values.

### 1. Connect to the hosted API

Set the API URL supplied by your clqn operator. Replace the example URL with your deployment's HTTPS URL:

```sh
export CLQN_API_URL="https://your-clqn-host.example"
clqn health
# clqn-api 0.1.0: ok
```

Set `CLQN_API_URL` in each terminal, or add it to your shell configuration. All clan members must connect to the same API. You do not need to run a local server or database. The health check confirms that the API is running; it does not check the database.

### 2. Create a clan

Get a personal token from your clqn operator. Save only the token in a private file, then log in:

```sh
clqn login --token-stdin < /secure/path/to/alice-token
clqn whoami
clqn init "My project"
clqn members
```

You are now the clan leader. `init` selects the new clan for later commands. Use `clans` to list your clans. Add `--clan <clan-id>` to a clan command to use a different clan.

### 3. Invite a member

As the leader, create an invitation for Bob's account:

```sh
clqn invite bob@example.com
```

Share the returned code with Bob privately. In his own terminal, Bob logs in with his personal token and joins:

```sh
clqn login --token-stdin < /secure/path/to/bob-token
clqn join <invite-code>
clqn members
```

`join` selects the clan for Bob. Each code works once and expires after seven days. Bob's account email must match the invitation. The operator sets account email labels; clqn does not verify mailbox ownership or send invitations by email.

### 4. Share project context

In Alice's terminal, create a text entry named `conventions`. Context writes read standard input. Revision `0` means the key must be new:

```sh
printf 'Run npm test before each commit.\n' | clqn context write conventions --expected-revision 0
# Wrote conventions revision 1
```

Bob can read the same entry from his terminal:

```sh
clqn context read conventions
# Run npm test before each commit.
```

To update revision `1`, supply `--expected-revision 1`:

```sh
printf 'Run npm test and npm run typecheck before each commit.\n' | clqn context write conventions --expected-revision 1
clqn context history conventions
clqn context list --json
```

If another person or agent updated the entry first, the write fails with a conflict. Read the latest revision before you try again.

### 5. Claim and complete a task

Alice creates a task:

```sh
clqn task add "Review the API contract"
```

Bob lists tasks and copies the task ID from the output. He uses that ID to claim and complete the task:

```sh
clqn task list
clqn task claim <task-id>
# Do the work, then mark it complete.
clqn task complete <task-id>
```

A task moves from `open` to `claimed` to `completed`. To return a claimed task to `open`, its owner or the human clan leader uses `task release <task-id>`.

### 6. Check progress

```sh
clqn status
clqn stats --json
clqn watch
```

`watch` polls for changes every three seconds. Press Ctrl+C to stop. To fetch the available events and exit:

```sh
clqn watch --once --json
```

To resume after an event, pass its `sequence` as `--cursor <sequence>`.


## Connect your own agent

While logged in with your personal credential, register an agent:

```sh
clqn agent connect --name Codex --clan <clan-id> --json
clqn agent list --clan <clan-id>
```

The response contains `{ "agent": { ... }, "token": "clqn_..." }`. The token is shown once; store it privately. Registration leaves your saved personal login unchanged. Give each agent its own registration and token. Configure the local stdio server in your agent's MCP settings. Replace the API URL, token, and clan ID. The `clqn` command must be available on your agent's `PATH`:

```json
{
  "mcpServers": {
    "clqn": {
      "command": "clqn",
      "args": ["mcp"],
      "env": {
        "CLQN_API_URL": "https://your-clqn-host.example",
        "CLQN_TOKEN": "<agent-token>",
        "CLQN_CLAN_ID": "<clan-id>"
      }
    }
  }
}
```


## Set your agent policy

Save limits for your agents in the selected clan:

```sh
clqn policy show
clqn policy set --token-limit 100000 --models provider/model-a provider/model-b --control approve
clqn policy show --json
```

Replace the example model identifiers with the exact identifiers your agent runner uses. The token cap covers total input and output tokens across your agents in this clan. Use `--token-limit none` for no cap or `--models any` for no model restriction.

Choose a leader control level:

- `manual`: You start your agents' work. The leader has no permission to start it.
- `approve`: The leader can request work. You must approve each request before it starts.
- `automatic`: The leader can request work without approval for each request, within your token and model limits.

Leaders cannot change another member's policy.

## Documentation

- [Project architecture and roadmap](PLAN.md)
- [GCP hosting](docs/hosting.md)
- [Database setup and migrations](docs/database.md)
- [Authentication and clans](docs/authentication.md)

## Contributing

See the [contribution guide](CONTRIBUTING.md) for local development, project structure, and checks. Keep changes small and focused on the current milestone.
