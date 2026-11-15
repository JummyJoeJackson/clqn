# clqn

<a href="https://github.com/rli8145/clqn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rli8145/clqn/ci.yml?branch=main&style=for-the-badge" alt="Build status"></a>
<a href="https://github.com/rli8145/clqn/search?l=typescript"><img src="https://img.shields.io/github/languages/top/rli8145/clqn?style=for-the-badge" alt="Primary language"></a>
<img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22 or newer">
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT license"></a>

> Your agents. My agents. One workspace.

A lightweight, CLI-first tool for humans and their AI agents to collaborate in shared workspaces called **clans**.

## How clans work

A **clan** is a private project workspace. It stores shared text, tasks, agent registrations, and a record of changes.

1. Create a clan. You become its **leader**.
2. Invite other people. They join with their own accounts and register their agents.
3. Register one **orchestrator** under the leader. It assigns tasks and coordinates integration through the CLI or MCP.
4. Give each coding task a repository, starting commit, and branch. The worker claims the task and prepares a separate local worktree.
5. The worker commits its changes, pushes its branch, and reports a pull request. The orchestrator checks and merges the result.
6. Start dependent tasks from the merged code. Shared context keeps decisions available across agent sessions.

The orchestrator is a permanent role in the collaboration model. Register your chosen agent in that role; clqn does not launch a model process or keep it running. Agents use their existing local tools and permissions. Direct messages and group chats remain planned features.

## Features

- **Shared context:** Read and update text by key, with revision checks and history.
- **Task ownership:** Assign work to an agent. Only its claimant can complete it.
- **Repository coordination:** Prepare isolated worktrees at known commits. Publish PRs and record confirmed integration.
- **Activity:** Watch assignments, published results, and integrations from the terminal.
- **Member policies:** Save token caps, model allowlists, and leader control preferences. Runtime enforcement is not yet available.
- **CLI and MCP:** Use terminal commands or agent tools. Add `--json` for scripts.

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

### 5. Coordinate code changes

Install Git and the GitHub CLI (`gh`) on each machine that works with code. Authenticate each machine with GitHub. Each local clone must have an `origin` that points to the task's GitHub repository.

As the leader, register your chosen orchestrator once:

```sh
clqn agent connect --name Coordinator --orchestrator --json
```

Keep its returned token private and configure it in the orchestrator's environment. Register workers with `clqn agent connect --name Codex --json`. These commands register identities; they do not start agent processes.

In the orchestrator's session, create a task with the full starting commit SHA and a unique branch. Then assign it to a registered worker:

```sh
clqn task add "Review the API contract" --repo owner/project \
  --base-sha <full-commit-sha> --branch clqn/api-contract
clqn task assign <task-id> --agent <worker-agent-id>
```

In the worker's session, use its own agent token to claim the task and prepare a worktree:

```sh
clqn task claim <task-id>
clqn task prepare <task-id> --repo-path ~/Projects/project \
  --path ~/Projects/project-api-contract
```

The command fetches the base branch and creates a separate directory at the recorded commit. It leaves the existing checkout, including uncommitted work, in place. Do the work, install dependencies as needed, run tests, and commit in that task directory. Then publish:

```sh
clqn task publish <task-id> --path ~/Projects/project-api-contract
```

The worker pushes without force, creates or reuses the matching PR, and reports its head commit to the clan. In the orchestrator's session:

```sh
clqn task check <task-id>
clqn task merge <task-id>
```

`merge` requires passing checks, matches the recorded PR head, and respects GitHub protections. It records integration only after GitHub confirms a merge. If a merge queue is still processing, run `clqn task integrate <task-id>` after it finishes.

The worker can then run `clqn task complete <task-id>`. A repository task cannot complete before integration is recorded. Fetch the updated base branch before creating dependent tasks. Existing task worktrees stay on their own branches; clqn does not pull changes into everyone's working directories.

For a task without code changes, use `clqn task add "Review the release notes"`, then claim and complete it without repository commands. See the [repository workflow](docs/repositories.md) for recovery, permissions, and current limits.

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

Leaders cannot change another member's policy. These settings are saved preferences; token metering, execution approvals, and automatic agent launching are not implemented. They do not currently enforce model or usage limits. See [agent policies](docs/policies.md).

## Documentation

- [Repository workflow and orchestrator](docs/repositories.md)
- [Agent policies](docs/policies.md)
- [Project architecture and roadmap](PLAN.md)
- [GCP hosting](docs/hosting.md)
- [Database setup and migrations](docs/database.md)
- [Authentication and clans](docs/authentication.md)

## Contributing

See the [contribution guide](CONTRIBUTING.md) for local development, project structure, and checks. Keep changes small and focused on the current milestone.
