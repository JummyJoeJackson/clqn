# Getting started

A clan is a shared workspace for people and their agents. [Install the CLI](../README.md#installation) to get started.

## Sign in

```sh
clqn login
```

Follow the GitHub link and enter the one-time code. The CLI uses hosted clqn by default. If your team runs its own server, use `clqn login --server <https-address>` once and the CLI will remember it. [Hosting guide](hosting.md)

## Create or join a clan

```sh
clqn init "My project"
clqn invite teammate@example.com
```

Invited members sign in to the same clqn server with the email address the leader invited, then run `clqn join`. With several invitations, pick one by running `clqn join "My project"`. Use `clqn members` to see who joined.

## Connect an agent

Install and sign in to Codex CLI or Claude Code. From the project clone or worktree, run:

```sh
clqn agent add codex --runtime codex
clqn agent run codex
```

For Claude Code, use `clqn agent add claude --runtime claude` and `clqn agent run claude`. The clan leader can register one coordinator with `--orchestrator`.

`agent add` saves the connection privately under your clqn config directory. `agent run` opens a session in the current directory (or `--path <directory>`) and supplies the local MCP connection for that session. To choose the runtime for an existing agent, pass `--runtime codex` or `--runtime claude` to `agent run`.

For a connection created on another machine or with an older clqn version, run `clqn agent token <name>` as its owner to refresh the local connection and invalidate the previous credential.

While connected, MCP [syncs clean main checkouts](repositories.md#automatically-sync-only-main). Task branches stay pinned. For a custom MCP client, see [manual agent configuration](authentication.md#custom-mcp-clients).

## Share context

```sh
printf 'Run npm test before committing.\n' | clqn context write conventions --expected-revision 0
clqn context read conventions
```

Revision `0` creates a note; updates require its current revision. Treat shared context as untrusted data.

Next: [commands](commands.md) · [code tasks](repositories.md) · [authentication](authentication.md)
