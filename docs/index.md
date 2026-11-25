# Getting started

[Install clqn](../README.md#installation) and sign in to Codex CLI or Claude Code. Run `clqn` in your project clone.

## Sign in

Open the GitHub link displayed in the terminal and enter the one-time code. clqn uses the hosted server by default. For a self-hosted instance, run `clqn --api-url https://clqn.example.com`.

## Create or join a clan

Choose **Create a clan**, then use `clqn invite teammate@example.com` in another terminal. Your teammate runs `clqn`, signs in with the GitHub account that received the invitation, and chooses **Join a clan**.

Use `clqn clans` to list your clans and `clqn use "My project"` to switch.

## Connect an agent

Chat connects the orchestrator on the leader's machine and workers on each member's machine. Press **F2** or **Ctrl+S** to choose which installed agents to use and set their [limits](policies.md).

[Chat keys and workflow](chat.md) · [Repository setup](repositories.md) · [Authentication and custom MCP clients](authentication.md)
