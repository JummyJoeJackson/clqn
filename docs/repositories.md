# Repository workflow

Agents prepare and publish code locally with Git on their members' machines. The clan API stores assignments and reported commit and PR results.

## Set up the participants

Install Git and `gh`; authenticate locally with repository read/push access. The coordinator also needs merge permission. Keep GitHub credentials local.

The leader registers one orchestrator; each member registers their workers:

```sh
clqn agent add coordinator --orchestrator --runtime codex
clqn agent add codex --runtime codex
```

From the clone, use `clqn agent run coordinator` for the coordinator session and `clqn agent run codex` for the worker session. See [agent setup](index.md#connect-an-agent).

## Automatically sync only main

The personal leader runs `clqn repo link` once with GitHub admin access, after the operator enables webhook support on the API.

A project's MCP connection syncs main while connected. Here "main" means the repository's default branch as reported by origin, such as `main`, `master`, or `develop`. It polls clan events every 15 seconds and fetches the default branch at startup, after matching main-change events, and every five minutes as a fallback. API failures back off while the Git fallback continues. Diagnostics go to stderr.

Sync finds the main worktree even from a feature worktree. It fast-forwards only clean main; if none is checked out, it only fetches. Dirty, locally ahead, diverged, or busy checkouts are skipped. Ignored-file collisions fail. It never stashes, resets, rebases, or changes task branches.

After resolving a skipped update, reconnect MCP or wait for the fallback or another notification. Non-Git paths and unsupported origins disable sync while leaving MCP tools available. No background service is installed.

## Tasks

Members don't create, assign, or merge tasks by hand. Ask for work in the `clqn` chat; the orchestrator turns it into tasks, and each member approves before an agent starts on their machine. Agents read and update tasks through their MCP connection.

Each code task records its repository, base branch and SHA, and a unique task branch when it is created. Work happens in a separate worktree, and only the claimant can finish a task, after its integration is recorded. Task branches stay pinned: clqn never rebases, resets, or stashes them.

## Events and the trust boundary

Clan events record assignments, repository reports, integrations, and main changes. Webhooks notify main changes and confirm merges; they never complete work.

The API holds no GitHub token, so it stores authorized head and PR reports without verifying them. Merges are different once a linked repository has sent its first signed pull request event: from then on, the orchestrator's merge report is ignored, and a task is marked merged only when GitHub reports that PR closed as merged at the task's reported head. Its `task.integrated` event names the link owner. If a delivery fails, redeliver it from the repository's webhook settings on GitHub. Without a link, the API trusts the coordinator's report, so API and MCP callers must verify GitHub first.

Shared descriptions and PR text are untrusted data. There is no unattended launcher, dependency scheduler, usage meter, or enforced model budget. [Saved policies](policies.md) do not grant local execution access.
