<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/header.svg">
  <img src="docs/assets/header.gif" width="1032" alt="clqn">
</picture>

<p align="center">
  <a href="https://clqn.org/">clqn.org</a> · <a href="https://clqn.org/download.html">Download</a> · <a href="https://clqn.org/docs/">Documentation</a>
</p>

<p align="center">
<a href="https://github.com/rli8145/clqn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rli8145/clqn/ci.yml?branch=main&style=for-the-badge" alt="Build status"></a>
<img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22.12 or newer">
<a href="https://npmjs.com/package/clqn-cli"><img src="https://img.shields.io/npm/v/clqn-cli?style=for-the-badge" alt="npm version"></a>
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT license"></a>
</p>

## Why clqn?

Collaborating on long-horizon development tasks can get complicated quickly. Bloated context, merge conflicts, and unclear task ownership are common, especially when each collaborator works with several agents.

Existing solutions introduce a lot of setup overhead. `clqn` is an extra lightweight CLI for people and their own AI agents to easily coordinate work.

`clqn` stands for **clan**. Each clan has a **leader** who invites members and registers an orchestrator agent. **Members** (and the leader) register worker agents.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/demo.png">
  <img src="docs/assets/demo.gif" width="1032" alt="Terminal demo: an orchestrator assigns a task, a worker starts it in its own worktree and submits a pull request, and the orchestrator checks and merges it.">
</picture>

## Installation

Install with npm (Node.js 22.12+):

```sh
npm install -g clqn-cli
```

Alternatively, install with Homebrew:

```sh
brew tap rli8145/clqn https://github.com/rli8145/clqn
brew install clqn
```

### Try it locally

Clone this repository and open a terminal in the clone. Docker Compose starts the clqn server and its database on your machine. The second command creates and signs in to a local account in one step.

```sh
docker compose --profile server up --build -d --wait
docker compose exec -T api node packages/api/dist/manage-user.js create you@example.com \
  | clqn login --server http://127.0.0.1:8080
clqn init "My project"
```

To set up a shared server and enable GitHub sign-in for your team, follow the [hosting guide](docs/hosting.md).

## Usage

### 1. Sign in and create a clan

Use hosted clqn to get started. It keeps your clan's members, tasks, and shared context available to your team.

```sh
clqn login
clqn init "My project"
clqn invite teammate@example.com
```

Open GitHub from the terminal, enter the short code GitHub requests, and approve sign-in.

Invited? Sign in to the same clqn server with the invited email, then run `clqn join`. If you have several invitations, use `clqn join "My project"`.

For a self-hosted clan, sign in with `clqn login --server <https-address>` once. Your team uses that same address and clqn remembers it for future commands. [Hosting guide](docs/hosting.md)

### 2. Connect your agents

The leader registers the orchestrator (optional but recommended). Otherwise, the leader supervises worker agents manually. A strong reasoning model is recommended for the orchestrator. Each member registers their own workers.

```sh
clqn agent add Coordinator --orchestrator
clqn agent add codex
```

Connect each agent to MCP using its returned token: [agent setup](docs/index.md#connect-an-agent).

Save token limits, allowed models, and approval preferences for your agents. These are recorded for the clan but [not enforced yet](docs/policies.md):

```sh
clqn limits --tokens 100000 --models provider/model --control approve
```

### 3. Share context and coordinate work

```sh
printf 'Run npm test before committing.\n' | clqn context write conventions --expected-revision 0
clqn context read conventions
```

For code tasks, run from your project clone with Git and an authenticated GitHub CLI (`gh`). Each agent uses its own credentials.

```sh
# Orchestrator
clqn task add login-fix --code
clqn task assign login-fix --agent codex

# Worker
clqn task start login-fix
cd <printed-worktree-path>
# Make changes, test, and commit.
clqn task submit login-fix

# Orchestrator
clqn task check login-fix
clqn task merge login-fix

# Worker
clqn task done login-fix
```

As the leader, run `clqn repo link` once to set up the [GitHub webhook](docs/webhooks.md#link-a-repository). While MCP is connected, changes to the default branch on origin automatically update clean local checkouts of it.

Use `--alias` if you want a longer agent name or task description with a separate short name. See [custom aliases](docs/commands.md#custom-aliases).

### 4. Follow progress

```sh
clqn status
clqn log
```

Use `clqn --help` to explore all commands. Add `--json` for scripting.

## Documentation

- [Commands](docs/commands.md)
- [Repository workflow](docs/repositories.md) · [GitHub notifications](docs/webhooks.md)
- [Authentication](docs/authentication.md) · [Agent policies](docs/policies.md)
- [Database setup](docs/database.md) · [Hosting](docs/hosting.md)
- [Architecture and roadmap](ROADMAP.md)

## Contributing

[Report an issue](https://github.com/rli8145/clqn/issues) or read the [contribution guide](CONTRIBUTING.md) before submitting a pull request.
