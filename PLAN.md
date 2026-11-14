# clqn — Development Plan

## Overview

**clqn** is a lightweight, open-source CLI tool that enables humans and their AI agents to collaborate on shared projects.

Users bring their own agents (Codex, Claude Code, Cursor, custom agents, etc.) and connect them to a shared cloud workspace called a **clan**.

The MVP lets agents share persistent context and coordinate tasks across users and machines. Additional capabilities follow demonstrated collaboration needs.

**Tagline:** Your agents. My agents. One workspace.

## Core Principles

1. **CLI-first:** All functionality is accessible through the terminal. No dashboard or GUI is planned.
2. **Agent-agnostic:** Support different models, providers, and agent frameworks through MCP.
3. **Lightweight:** Minimal setup, dependencies, and infrastructure.
4. **Human-controlled:** Users retain control over their agents, permissions, and resources.
5. **Persistent collaboration:** Shared knowledge and project progress survive individual agent sessions.
6. **Focused scope:** Ship shared context and task coordination before considering optional extensions.
7. **Open source:** Extensible architecture with clear APIs.

## Architecture

```text
Human A + Agent A                  Human B + Agent B
        |                                 |
    clqn CLI / local stdio MCP adapters
        |                                 |
        +-------------- HTTPS ------------+
                         |
                  One clqn API
                         |
              One PostgreSQL database
```

CLI commands and local MCP tools call the same HTTP API. The API owns authentication, clan authorization, and collaboration state. Existing agent tools handle reasoning and execution on their users' machines.

### MVP Tech Stack

- **Language:** TypeScript npm workspaces
- **CLI:** Commander.js
- **Backend:** Hono (HTTP API)
- **Database:** PostgreSQL with Drizzle
- **Agent integration:** MCP TypeScript SDK, local stdio transport
- **Hosting:** One API service on GCP with managed PostgreSQL
- **Activity updates:** Poll an event-list endpoint with a cursor

Use ordinary database queries and transactions. The MVP needs no queue, cache service, event broker, orchestration framework, separate worker, or object storage. Add infrastructure only when a concrete feature or measured limit requires it.

## Core Concepts

- **Clan:** Shared collaborative workspace associated with a project.
- **Member:** Human user belonging to a clan.
- **Agent:** AI assistant registered by a member.
- **Context:** Shared, versioned knowledge accessible to authorized agents.
- **Task:** Unit of work that a human or agent can create, claim, and complete.
- **Event:** Auditable record of actions and state changes.

## CLI Design

Target MVP commands are below; unchecked roadmap items are not available yet.

```bash
# Authentication
clqn login --token-stdin
clqn logout
clqn whoami

# Clan management
clqn init "<name>"
clqn clans
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
clqn context write <key>
clqn context history <key>

# Task coordination
clqn task add "<description>"
clqn task list
clqn task claim <id>
clqn task release <id>
clqn task complete <id>

# Activity and metrics
clqn watch
clqn stats
```

Commands should support structured JSON output (`--json`) for scripting and agent consumption.

Use readable, minimal terminal formatting for human output. Implement one context input path first (for example, `context write <key>` reading stdin); add file convenience commands when useful. `agent status` reports registration details, not inferred online presence.

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
clqn_get_status
```

An agent should be able to join an existing workflow without changing its underlying model or framework.

The CLI and MCP server are adapters over the same backend.

Use a local stdio MCP server launched by the CLI. Add tools alongside each working API feature and CLI command, so agents can exercise each slice before the MVP is complete. Remote MCP is outside the MVP.

## Data Model

Add tables only with the feature that uses them:

```text
users
credentials
clans
memberships
agents
context_entries
context_revisions
tasks
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

- [x] TypeScript monorepo (CLI, API, shared types)
- [x] Authentication and clan creation
- [x] Invitations and membership
- [ ] Agent registration and MCP integration
- [ ] Persistent shared context with revision history
- [ ] Shared task creation, claiming, and completion
- [ ] Activity event log
- [ ] `clqn status`, polling-based `clqn watch`, and basic counts in `clqn stats`
- [x] JSON output for machine-readable commands
- [x] Basic tests and installation instructions

**Current slice:** Personal credentials, private clans, membership reads, and leader-created invitations with atomic joining are implemented through the API and CLI. Invitations are email-bound, expire after seven days, and remain single-use under concurrent requests. Membership changes append transactional audit events; event listing is pending. Agent registration with clan-scoped credentials and MCP integration is next. See [authentication setup](docs/authentication.md).

**Acceptance test:** Alice uses Codex and Bob uses Claude Code on separate machines. Both connect to the same clan, read/write shared context, coordinate tasks, and observe each other's progress.

### MVP Implementation Boundaries

- **Authentication:** Keep the current operator-provisioned personal tokens for the first collaboration test. Add scoped agent credentials with registration. Public signup, identity-provider integration, and automated credential rotation are separate decisions.
- **Invitations:** A leader creates an expiring, single-use invite code bound to the intended email identity; the inviter delivers it manually. Joining requires an authenticated user with that identity. Consume the invitation and add membership in one transaction. No email-delivery service is required. Operator-provisioned email labels are not proof of mailbox ownership.
- **Agents:** Register an agent under its human owner with a credential restricted to one clan. Start with a name and identity; no capability negotiation, heartbeat service, or agent scheduler.
- **Context:** Store text by key with immutable numbered revisions. Require the expected revision on updates and return a conflict for stale writes. No branching, merging, embeddings, or automatic conflict resolution.
- **Tasks:** Start with open, claimed, and completed states. Claim with one conditional database update; only the owning actor can complete a claimed task. Provide an explicit owner release or leader reset for abandoned claims. No leases, renewal timers, automatic reassignment, or delegation engine.
- **Events:** Append audit rows in the same transaction as state changes. List them with bounded cursor pagination. `watch` polls this endpoint at a modest interval; no SSE or pub/sub service unless polling proves inadequate.
- **Status and stats:** Show members, registered agents, task counts, and recent activity using ordinary queries. Defer time-series storage, dashboards, presence tracking, and configurable analytics.
- **Deployment:** Run one API service and managed PostgreSQL. Keep migrations explicit and credentials server-side. No multi-region architecture or shared execution environment.

Keep authorization, atomic writes, revision conflict checks, and task ownership even when simplifying. They protect the basic collaboration workflow.

### After the MVP — Candidate Improvements

Choose the next small feature from actual usage after the two-person acceptance test. These are candidates, not committed release requirements:

- Asynchronous messages, if shared context and tasks leave a communication gap.
- Explicit task assignment and handoff, if claiming and releasing tasks are insufficient.
- Activity filters or SSE, if basic counts and polling fail a demonstrated need.
- Task leases or capability profiles, only if real unattended workflows require them.

### Uncommitted Future Ideas

Optional coordination, context branching, agent interoperability protocols, artifact storage, and distributed compute are outside the implementation plan. They require a separate proposal with a concrete use case, costs, and security boundaries before work begins. Do not choose orchestration frameworks or build supporting abstractions in advance.

Shared compute in particular is a separate product-sized effort, not a prerequisite for a stable release of the collaboration tool. Never expose members' private API keys or execute arbitrary remote code on host machines without explicit authorization and isolation.

## Security Requirements

- Private clans by default.
- Scoped per-user and per-agent credentials.
- Server-side authorization for every operation.
- No automatic access to local files, secrets, or compute.
- Shared context treated as untrusted data, not authoritative instructions.
- Human approval for privileged or destructive actions.
- Audit logs for membership, agent, context, and task changes as those features are implemented.
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
6. Validate cross-user, cross-agent collaboration through the CLI and local MCP tools.
7. Fix friction found in the acceptance test before choosing any post-MVP feature.

Each feature includes its API, thin adapters, and relevant tests; do not postpone agent access to a separate integration phase.

## Development Guidelines for Coding Agents

- Prioritize a working end-to-end vertical slice over architectural complexity.
- Keep the CLI and MCP integrations thin; business logic belongs in the backend.
- Avoid premature abstractions, vector databases, and orchestration frameworks.
- Use strongly typed API contracts and shared schemas.
- Design commands to be composable, predictable, and scriptable.
- Keep dependencies minimal. Prefer a direct implementation over a plugin system, generic repository layer, or extension framework for hypothetical future features.
- Write tests for authorization, concurrent writes, and task ownership.
- Preserve backward compatibility in the CLI and API where practical.
- Document architectural decisions and tradeoffs.
- Do not implement roadmap features beyond the current milestone unless explicitly requested.

## Success Criteria

The first version succeeds when two people can install clqn, create a shared workspace, connect their existing agents, and collaborate on a real software project without manually transferring context between agent sessions.

**Primary focus: Make multi-human, multi-agent collaboration feel as straightforward as using Git.**
