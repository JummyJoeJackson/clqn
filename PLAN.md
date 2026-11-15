# clqn — Development Plan

## Overview

**clqn** is a lightweight, open-source CLI tool that enables humans and their AI agents to collaborate on shared projects.

Users bring their own agents (Codex, Claude Code, Cursor, custom agents, etc.) and connect them to a shared cloud workspace called a **clan**.

Each clan uses a leader-owned orchestrator to delegate work to members' agents and coordinate Git integration. Workers run locally in isolated task worktrees. The API stores shared context, task ownership, repository references, and activity; GitHub remains the code source of truth.

**Tagline:** Your agents. My agents. One workspace.

## Core Principles

1. **CLI-first:** All functionality is accessible through the terminal. No dashboard or GUI is planned.
2. **Agent-agnostic:** Support different models, providers, and agent frameworks through MCP.
3. **Lightweight:** Minimal setup, dependencies, and infrastructure.
4. **Human-controlled:** Users retain control over their agents, permissions, and resources.
5. **Persistent collaboration:** Shared knowledge and project progress survive individual agent sessions.
6. **Focused scope:** Ship orchestrator-led task coordination and Git integration in small working slices. Keep execution local and defer shared compute.
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

CLI commands and local MCP tools call the same HTTP API. The API owns authentication, clan authorization, and collaboration state. Existing agent tools handle reasoning and execution on their users' machines. The designated orchestrator assigns work through the API. Local CLI commands prepare worktrees, push task branches, and verify GitHub PRs with `gh`; no model framework or hosted execution service is required.

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
- **Agent:** AI assistant registered by a member, with a worker or orchestrator role.
- **Orchestrator:** One leader-owned registration per clan that can assign work and record integration. Its model process runs in the leader's existing agent runtime.
- **Context:** Shared, versioned knowledge accessible to authorized agents.
- **Task:** Unit of work that a human or agent can create, claim, and complete.
- **Event:** Auditable record of actions and state changes.

## CLI Design

Target MVP commands are below; unchecked roadmap items are not available yet.

```bash
# Authentication
clqn login
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
clqn agent add Codex
clqn agent add Coordinator --orchestrator
clqn agent list
clqn agent status

# Shared context
clqn context list
clqn context read <key>
clqn context write <key>
clqn context history <key>

# Task coordination
clqn task add "<description>" --code
clqn task list
clqn task show <id>
clqn task assign <id> --agent <id>
clqn task unassign <id> --agent <id>
clqn task start <id>
clqn task submit <id>
clqn task check <id>
clqn task merge <id>
clqn task release <id>
clqn task done <id>

# Local main synchronization
clqn sync --watch

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
clqn_get_task
clqn_assign_task
clqn_unassign_task
clqn_report_task_repository
clqn_record_task_integration
clqn_get_policy
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
- Tasks track ownership, assignment, status, timestamps, and optional repository/base/branch/PR/merge metadata.
- Repository tasks require recorded integration before completion.
- GitHub verification runs locally; the API stores authenticated reports rather than GitHub credentials.
- Events provide an append-only audit trail.
- Authorization is enforced server-side.

## Development Roadmap

### v0.1 — Shared Workspace (MVP)

**Goal:** Two developers using different AI agents can collaborate through one shared workspace.

Implement:

- [x] TypeScript monorepo (CLI, API, shared types)
- [x] Authentication and clan creation
- [x] Invitations and membership
- [x] Agent registration and MCP integration
- [x] Persistent shared context with revision history
- [x] Shared task creation, claiming, and completion
- [x] Activity event log
- [x] `clqn status`, polling-based `clqn watch`, and basic counts in `clqn stats`
- [x] JSON output for machine-readable commands
- [x] Basic tests and installation instructions

**Current slice:** The initial MVP implementation is complete: personal and clan-scoped agent credentials, private clans and invitations, versioned shared context, task ownership and release, transactional audit events, status/stats, polling watch, and local stdio MCP tools. Automated acceptance exercises two users and two MCP clients through the real HTTP API and PostgreSQL. The production container and explicit migration entrypoint are verified locally. See [authentication setup](docs/authentication.md) and [GCP deployment](docs/hosting.md).

**Repository coordination slice:** Implemented a permanent designated orchestrator role, worker assignments and compare-and-clear unassignment, task repository/base SHA/branch references, isolated local worktree preparation, non-force publication, exact-head PR checks and squash merge, confirmed integration reports, and ownership-gated completion. API and MCP remain adapters around server-side authorization; Git and `gh` operate locally. See [repository workflow](docs/repositories.md).

**Main-only automatic sync:** Implemented `clqn sync --watch` as a local foreground polling command. Fetch only `origin/main`, and fast-forward only the selected clean main checkout. Skip dirty, diverged, locally ahead, or non-main checkouts; never automatically update task branches/worktrees. Polling errors retry. Sync does not launch agents or update task integration records.

**Simple CLI:** Infer the repository and checkout from the current directory. `task add --code` records the latest origin/main and chooses a unique branch; `task start` claims work and chooses or resumes a task worktree; `task submit` uses the current worktree; `task done` completes it. Use `agent add <name>` and `limits --tokens <number>`. Older names remain compatible, with explicit overrides documented in the [command reference](docs/commands.md). API and MCP contracts stay unchanged.

**Execution boundary:** Registration does not launch or keep model processes running. Existing agent runtimes invoke these tools. Member token/model/control policies are persisted, but hard usage enforcement and execution approvals still need metering and a runner. DMs/group chats, unattended scheduling, automatic webhook ingestion, and conflict resolution are not implemented.

**Remaining validation:** Deploy the API and managed PostgreSQL on GCP, then run the acceptance workflow on separate machines with real Codex and Claude Code applications. These operator-run checks have not been performed; the automated protocol clients do not establish real application configuration or deployed networking. Resolve any friction from that check before choosing post-MVP features.

**Acceptance test:** Alice uses Codex and Bob uses Claude Code on separate machines. Both connect to the same clan, read/write shared context, coordinate tasks, and observe each other's progress.

### MVP Implementation Boundaries

- **Authentication:** Keep the current operator-provisioned personal tokens for the first collaboration test. Add scoped agent credentials with registration. Public signup, identity-provider integration, and automated credential rotation are separate decisions.
- **Invitations:** A leader creates an expiring, single-use invite code bound to the intended email identity; the inviter delivers it manually. Joining requires an authenticated user with that identity. Consume the invitation and add membership in one transaction. No email-delivery service is required. Operator-provisioned email labels are not proof of mailbox ownership.
- **Agents:** Register workers under their human owners and one designated orchestrator under the clan leader. Use clan-scoped credentials. The orchestrator may assign/unassign tasks and record integrations, but cannot invite members, create agents, change member policies, or complete another actor's task. No heartbeat or model launcher.
- **Context:** Store text by key with immutable numbered revisions. Require the expected revision on updates and return a conflict for stale writes. No branching, merging, embeddings, or automatic conflict resolution.
- **Tasks:** Keep open, claimed, and completed states. Serialize assignment, claims, repository reports, and integration with row locks. Only the assigned agent can claim an assigned task; only its exact owner can report code or complete it. Repository tasks must have a recorded merge before completion. Owner release or human leader reset clears assignment. No leases or dependency scheduler.
- **Events:** Append audit rows in the same transaction as state changes. List them with bounded cursor pagination. `watch` polls this endpoint at a modest interval; no SSE or pub/sub service unless polling proves inadequate.
- **Status and stats:** Show members, registered agents, task counts, and recent activity using ordinary queries. Defer time-series storage, dashboards, presence tracking, and configurable analytics.
- **Deployment:** Run one API service and managed PostgreSQL. Keep migrations explicit and credentials server-side. No multi-region architecture or shared execution environment.

Keep authorization, atomic writes, revision conflict checks, and task ownership even when simplifying. They protect the basic collaboration workflow.

### After the MVP — Candidate Improvements

Choose the next small feature from actual usage after the two-person acceptance test. These are candidates, not committed release requirements:

- Asynchronous messages, if shared context and tasks leave a communication gap.
- Task dependency scheduling and safe worktree refresh at explicit checkpoints, if real coordination requires them.
- Activity filters or SSE, if basic counts and polling fail a demonstrated need.
- Task leases or capability profiles, only if real unattended workflows require them.

### Uncommitted Future Ideas

Group chats, context branching, agent interoperability protocols, artifact storage, and distributed compute require separate proposals. The orchestrator role and Git coordination are core product direction. Build on existing agent runtimes; choose a new orchestration framework only for a concrete unmet execution requirement.

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
- Hosting users' model execution or replacing their existing agent runtimes.
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
