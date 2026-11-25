# Shared clan chat

Run `clqn` from the project clone, sign in with GitHub, and create or join a clan. The clan leader can link the current GitHub repository during setup and starts the shared session. Members join from the same screen. The transcript stays with the clan between terminal sessions.

Type a task, question, or project context and press **Enter**. Messages remain queued until the orchestrator picks them up. The agent pane shows each delegation's task, worker, status, and reported tokens. A tilde marks estimated usage.

The metrics view shows reported tokens and active agents over 24 hours or seven days.

| Key | Action |
| --- | --- |
| F2 | Open session settings. Use the arrow keys to move between fields and change approval mode. |
| F3 or Tab | Focus a spawn proposal. Use the arrow keys to choose one, then press **Y** to approve or **N** to decline. |
| F4 | Reply to a clarification. Press it again to choose a different question. |
| Ctrl+G or F5 | View clan metrics. |
| Ctrl+L or F6 | Find a worker’s pull request. Use the arrow keys to choose one. The clan leader presses **Y** to approve a reviewed commit or **N** to decline it. |
| Page Up / Page Down | Scroll the transcript. Press **End** to return to the latest messages. |
| Ctrl+C | Close the terminal session. |

New members choose full access or custom limits during setup. Spawn approval defaults to manual. Both approval modes enforce the worker owner's saved limits. Queued assignments reserve an agent slot and their estimated tokens. Reported usage draws down the budget, and finished work without a report counts at its estimate.

## How tokens are counted

A worker's tokens are its input, cache writes, and output, summed over the run. Cache reads are left out. Each API call resends the whole conversation, mostly from the prompt cache. Counting those reads would count the same context again on every call, and they are a small part of the cost. A short task therefore reports close to the context size Claude Code shows. Longer tasks report more, as each call adds new input and output. For Codex, cached input is subtracted from its input tokens.

Tokens are not dollars. Cache writes and output cost more per token than plain input. Orchestrator runs are not counted.

## Review code and sync main

Chat starts the orchestrator on the leader’s machine and approved workers on their owners’ machines. A worker’s code is committed in its own worktree, pushed to the linked repository, and posted in chat with a pull request link. The worker needs Git push access and an authenticated `gh` session to open the PR.

The clan leader opens the PR to review the commit shown in chat, then approves it in **Ctrl+L**. Keep the leader’s chat open so it can merge once all reported checks finish successfully and at least one passes. GitHub applies its normal repository merge rules.

With chat open from a linked clone, signed GitHub push notifications trigger a fast-forward of the clean local default branch. Sync also runs at startup and every five minutes as a fallback. [Repository workflow](repositories.md)

The Cloud Run API stores the transcript, proposals, and settings in PostgreSQL. Apply the [release migrations](hosting.md#migrate-then-deploy) before deploying the updated API.
