
# clqn — Development Plan

## Overview

**clqn** is a lightweight, open-source CLI tool that enables humans and their AI agents to collaborate on shared projects.

Users bring their own agents (Codex, Claude Code, Cursor, custom agents, etc.) and connect them to a shared cloud workspace called a **clan**.

Agents can share persistent context, coordinate tasks, communicate, and eventually share compute resources across users and machines.

**Tagline:** Your agents. My agents. One workspace.

## Core Principles

1. **CLI-first:** All functionality is accessible through the terminal. No dashboard or GUI required.
2. **Agent-agnostic:** Support different models, providers, and agent frameworks through MCP.
3. **Lightweight:** Minimal setup, dependencies, and infrastructure.
4. **Human-controlled:** Users retain control over their agents, permissions, and resources.
5. **Persistent collaboration:** Shared knowledge and project progress survive individual agent sessions.
6. **Modular:** Advanced orchestration and resource sharing are optional extensions.
7. **Open source:** Extensible architecture with clear APIs.

## Architecture

```text
Human A + Agent A       Human B + Agent B
        |                       |
    clqn CLI                clqn CLI
        |                       |
        +----------+------------+
                   |
              MCP / HTTPS
                   |
              clqn Cloud API
                   |
          +--------+--------+
          |        |        |
       Context   Tasks   Messages
          |        |        |
          +--------+--------+
                   |
             PostgreSQL
                   |
          Orchestrater spawned by clan leader
          (Deep Agents/LangGraph)
```

### Proposed Tech Stack

- **Language:** TypeScript
- **CLI:** Commander.js
- **Backend:** Hono (HTTP API)
- **Database:** PostgreSQL (Supabase)
- **ORM:** Drizzle
- **Agent integration:** MCP TypeScript SDK
- **Realtime:** Server-Sent Events (SSE)
- **Hosting:** Railway or equivalent
- **Optional orchestration:** Deep Agents / LangGraph
- **Artifacts:** S3-compatible storage (later)

The backend manages deterministic collaboration state. Agent frameworks handle reasoning and orchestration, not persistence or authorization.

## Core Concepts

- **Clan:** Shared collaborative workspace associated with a project.
- **Member:** Human user belonging to a clan.
- **Agent:** AI assistant registered by a member.
- **Context:** Shared, versioned knowledge accessible to authorized agents.
- **Task:** Unit of work that a human or agent can create, claim, and complete.
- **Message:** Communication between members and/or agents.
- **Event:** Auditable record of actions and state changes.
- **Coordinator:** Optional agent responsible for orchestration, spawned by the clan leader.

## CLI Design

```bash
# Authentication
clqn login
clqn logout
clqn whoami

# Clan management
clqn init
clqn join <invite-code>
clqn invite <email>
clqn members
clqn status

# Agent integration
clqn agent connect
clqn agent list
clqn agent status

# Shared context
clqn context list
clqn context read <key>
clqn context push <file>
clqn context write <key>
clqn context history <key>

# Task coordination
clqn task add "<description>"
clqn task list
clqn task claim <id>
clqn task complete <id>
clqn task assign <id> <agent>

# Communication
clqn msg send <recipient> "<message>"
clqn msg inbox

# Activity and metrics
clqn watch
clqn stats
clqn stats --agent <id>
clqn stats --since 7d
```

Commands should support structured JSON output (`--json`) for scripting and agent consumption.

Use readable, minimal terminal formatting for human output.

## Agent Integration

Expose MCP tools backed by the same cloud API:

```text
clqn_read_context
clqn_write_context
clqn_list_context
clqn_create_task
clqn_claim_task
clqn_complete_task
clqn_list_tasks
clqn_send_message
clqn_read_messages
clqn_get_status
```

An agent should be able to join an existing workflow without changing its underlying model or framework.

The CLI and MCP server are adapters over the same backend.

Start with a local stdio MCP server launched by the CLI. Consider remote MCP later.

## Data Model

Initial entities:

```text
users
clans
memberships
agents
context_entries
context_revisions
tasks
messages
events
invitations
```

Important properties:

- All clan resources are scoped by clan ID.
- Every operation has an authenticated actor.
- Context revisions are immutable.
- Tasks track ownership, status, and timestamps.
- Events provide an append-only audit trail.
- Authorization is enforced server-side.

## Development Roadmap

### v0.1 — Shared Workspace (MVP)

**Goal:** Two developers using different AI agents can collaborate through one shared workspace.

Implement:

- [ ] TypeScript monorepo (CLI, API, shared types)
- [ ] Authentication and clan creation
- [ ] Invitations and membership
- [ ] Agent registration and MCP integration
- [ ] Persistent shared context with revision history
- [ ] Shared task creation, claiming, and completion
- [ ] Activity event log
- [ ] `clqn status`, `clqn watch`, and basic `clqn stats`
- [ ] JSON output for machine-readable commands
- [ ] Basic tests and installation instructions

**Acceptance test:** Alice uses Codex and Bob uses Claude Code on separate machines. Both connect to the same clan, read/write shared context, coordinate tasks, and observe each other's progress.

### v0.2 — Communication

- [ ] Agent-to-agent asynchronous messaging
- [ ] Task assignment and handoff
- [ ] Task ownership leases to prevent duplicate work
- [ ] Agent capability profiles
- [ ] Improved terminal metrics and activity visualization
- [ ] Notifications and event subscriptions

### v0.3 — Intelligent Coordination

- [ ] Optional coordinator agent spawned by the clan leader
- [ ] Deep Agents/LangGraph integration
- [ ] Automatic task decomposition and delegation
- [ ] Agent capability discovery
- [ ] Context branching and merging
- [ ] Knowledge provenance and decision history
- [ ] Evaluate A2A integration for independent agent delegation

The coordinator must be optional. Core collaboration should work without running an additional LLM.

### v1.0 — Distributed Resources

- [ ] Opt-in shared compute pool (CPU/GPU)
- [ ] Sandboxed remote job execution
- [ ] Resource availability and capability discovery
- [ ] Usage accounting and quotas
- [ ] Shared compute budgets
- [ ] Permissioned model routing
- [ ] Artifact sharing and storage

Never expose members' private API keys or execute arbitrary remote code on host machines without explicit authorization and isolation.

## Security Requirements

- Private clans by default.
- Scoped per-user and per-agent credentials.
- Server-side authorization for every operation.
- No automatic access to local files, secrets, or compute.
- Shared context treated as untrusted data, not authoritative instructions.
- Human approval for privileged or destructive actions.
- Audit logs for context changes, task operations, and resource usage.
- Explicit opt-in and sandboxing for future compute sharing.

## Website (Later)

A simple, aesthetic, mostly static website inspired by https://ghostty.org/.

Purpose:

- Explain what clqn does.
- Show terminal usage examples.
- Provide installation instructions.
- Host documentation and API reference.
- Link to GitHub and releases.

No web app, dashboards, authentication interface, or browser-based collaboration UI is planned.

All product functionality remains CLI-accessible.

## Non-Goals

- Building another general-purpose AI agent framework.
- Replacing Codex, Claude Code, or Cursor.
- Creating a graphical project management application.
- Replacing Git/GitHub for source control.
- Requiring a central orchestrator for collaboration.
- Building a distributed compute marketplace in the MVP.
- Adding complex agent autonomy before basic collaboration works.

## Implementation Priorities

1. Scaffold monorepo and CLI.
2. Implement cloud API, database, and authentication.
3. Implement clans, membership, and agent registration.
4. Implement shared context and revision history.
5. Implement shared tasks and activity events.
6. Expose functionality through local MCP tools.
7. Validate cross-user, cross-agent collaboration.
8. Add messaging and advanced coordination incrementally.

## Development Guidelines for Coding Agents

- Prioritize a working end-to-end vertical slice over architectural complexity.
- Keep the CLI and MCP integrations thin; business logic belongs in the backend.
- Avoid premature abstractions, vector databases, and orchestration frameworks.
- Use strongly typed API contracts and shared schemas.
- Design commands to be composable, predictable, and scriptable.
- Keep dependencies minimal.
- Write tests for authorization, concurrent writes, and task ownership.
- Preserve backward compatibility in the CLI and API where practical.
- Document architectural decisions and tradeoffs.
- Do not implement roadmap features beyond the current milestone unless explicitly requested.

## Success Criteria

The first version succeeds when two people can install clqn, create a shared workspace, connect their existing agents, and collaborate on a real software project without manually transferring context between agent sessions.

**Primary focus: Make multi-human, multi-agent collaboration feel as straightforward as using Git.**
