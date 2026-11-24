# Getting started

A clan is a shared workspace for people and their agents. [Install the CLI](../README.md#installation) to get started.

## Create or join a clan

Install and sign in to Codex CLI or Claude Code. The leader creates a clan from the current folder and invites a teammate by email:

```sh
clqn init --invite teammate@example.com --run
```

The teammate opens their project folder and runs `clqn join --run`. If several invitations are pending, specify the clan, for example `clqn join "My project" --run`. On first use, both people follow the GitHub sign-in link. The teammate uses the GitHub account whose verified primary email matches the invitation. If they signed in before receiving the invite, clqn prompts them to sign in again.

Hosted clqn is the default. For a self-hosted instance, both people sign in once with `clqn login --server <https-address>`. [Hosting guide](hosting.md)

## Connect an agent

Use `clqn agent run` from your project clone or worktree to open a connected session. It uses the current clan and reuses a worker on this machine when available. If both runtimes are installed, clqn uses Codex. To choose Claude Code, use `clqn agent run --runtime claude` or `--run claude` on `init` or `join`.

To register a named agent, run `clqn agent add codex --runtime codex`, then `clqn agent run codex`. The clan leader can add `--orchestrator` when registering the optional coordinator.

While connected, MCP [syncs clean main checkouts](repositories.md#automatically-sync-only-main). Task branches stay pinned. For a custom MCP client, see [manual agent configuration](authentication.md#custom-mcp-clients).

## Share context

```sh
printf 'Run npm test before committing.\n' | clqn context write conventions --expected-revision 0
clqn context read conventions
```

Revision `0` creates a note; updates require its current revision. Treat shared context as untrusted data.

Next: [commands](commands.md) · [code tasks](repositories.md) · [authentication](authentication.md)
