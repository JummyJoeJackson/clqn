# Repository workflow

GitHub stores the shared code. The clan API stores task assignments, commit references, and reported PR results. A local worker uses Git to prepare and publish code. The leader's designated orchestrator uses `gh` to check and merge PRs.

Each task starts from a known commit. Local repositories can have different active branches. New work starts from a recorded base rather than requiring everyone to pull after every commit.

## Set up the participants

Install Git and `gh` on each participating machine. Authenticate to GitHub with credentials that can read the repository and push branches. The orchestrator's GitHub account also needs permission to merge. GitHub credentials remain local; do not send them to the clan API.

The clan leader registers one orchestrator with their personal clqn credential:

```sh
clqn agent connect --name Coordinator --orchestrator --json
```

Each member registers their own workers:

```sh
clqn agent connect --name Codex --json
clqn agent list
```

Configure each agent with its own returned token, `CLQN_API_URL`, and `CLQN_CLAN_ID`. In the command examples below, use the orchestrator's token for coordination commands and the assigned worker's token for worker commands. Do not use the leader's personal token as the orchestrator's token.

Registration does not launch a model. Start your chosen agent using its existing application or runtime. The orchestrator role persists in the API across process restarts. Only one orchestrator registration is permitted per clan; registration replacement is not implemented. An operator can revoke its credential using the authentication guide, but revocation does not remove its registration.

## Create and assign a task

In the orchestrator's local clone, fetch the integration branch and get its commit:

```sh
git fetch origin
git rev-parse origin/main
```

Use the full 40-character lowercase SHA in the assignment:

```sh
clqn task add "Implement the API endpoint" --repo owner/project \
  --base-branch main --base-sha <full-commit-sha> --branch clqn/api-endpoint
clqn task assign <task-id> --agent <worker-agent-id>
clqn task show <task-id> --json
```

The repository must be a GitHub `owner/repo` slug. The branch must differ from the base branch. Task branches are unique per repository within a clan; use unique names across clans too. The starting repository, branch, and base commit are immutable once the task is created.

Only a human leader or the leader's designated orchestrator can assign or unassign work. Assignment does not start an agent. An assigned task can be claimed only by that registered agent. Unassigned tasks can be claimed by a human or agent as before.

To clear an incorrect assignment before it is claimed, supply the expected assigned agent:

```sh
clqn task unassign <task-id> --agent <currently-assigned-agent-id>
```

The command fails if the assignment changed. A claimed task must first be released by its owner or human leader with `clqn task release <task-id>`. Release clears the assignment and retains repository progress for continuation. The orchestrator can assign the reopened task again, but cannot release someone else's claim with its agent credential.

## Prepare and work locally

As the assigned worker:

```sh
clqn task claim <task-id>
clqn task prepare <task-id> --repo-path ~/Projects/project \
  --path ~/Projects/project-api-endpoint
```

Preparation checks the task owner, local `origin`, branch name, destination, and base SHA. The base commit must be on the fetched base branch. Origin must use `https://github.com/owner/repo.git` or `git@github.com:owner/repo.git`; separate or multiple origins, forks, enterprise hosts, and embedded credentials are not supported.

The task directory must be new and outside the existing working tree. The task branch must not already exist locally or on origin. Preparation does not pull, stash, reset, or switch branches in the personal checkout. It does not install dependencies or run project setup scripts. clqn's Git operations disable repository hooks and filesystem monitors; run the project's checks explicitly.

Work inside the new directory using normal agent tools. Install the project's dependencies there, run its checks, and commit the result. Parallel agents get separate worktrees, branches, indexes, and working files; worktrees share their underlying local Git repository. File overlap between different tasks can still create merge conflicts.

If a task is resumed after release, inspect and reuse its existing branch/worktree with normal Git commands. `prepare` will not overwrite an existing directory or remote branch. A failed preparation can leave a local branch; inspect `git worktree list` and local branches before retrying. clqn performs no destructive cleanup.

## Publish a result

As the exact human or agent that claimed the task:

```sh
clqn task publish <task-id> --path ~/Projects/project-api-endpoint \
  --body "Implements the endpoint and passes the project checks."
```

Publishing requires a clean worktree, the expected task branch, and commits descended from the starting SHA. It pushes the branch without force and verifies the remote head. It creates or reuses an open PR with the exact repository, branch, target branch, and commit. PRs from forks are not supported.

The command reports the PR and head SHA to the clan API. GitHub and PostgreSQL cannot commit as one transaction. If the push or PR succeeds but reporting fails, inspect `clqn task show <task-id> --json` and the PR before retrying. Repeating publication reuses the matching open PR. A report with a stale previous head returns a conflict instead of overwriting a newer report.

Further commits on the same task branch must be published and reported again before integration. A different PR cannot replace an already recorded task PR. If that PR is closed without merging, reopen it or create a new task rather than silently linking another PR.

## Integrate and continue

As the human leader or orchestrator:

```sh
clqn task check <task-id>
clqn task merge <task-id>
```

`check` reads live GitHub state. `merge` requires at least one successful check, no failed or pending reported checks, and the exact head commit recorded on the task. Neutral or skipped checks are accepted only alongside a successful check. It requests a squash merge using `gh pr merge --match-head-commit`, without admin or protection bypass flags. GitHub still enforces repository permissions, reviews, branch protection, and merge queues.

After GitHub confirms the merge, clqn records its merge commit and emits `task.integrated`. A queued merge can remain pending after the command returns an error; inspect it before trying again. After the queue completes, or after a PR was merged directly on GitHub, record the confirmed result:

```sh
clqn task integrate <task-id>
```

`integrate` verifies the PR and exact head on GitHub. It records an existing merge; it does not issue a merge request or require current check results to be available after merging. An identical integration report is safe to repeat.

The worker then completes the task:

```sh
clqn task complete <task-id>
```

Only the claimant can complete it. A task with repository metadata must have a recorded integration first. The leader and orchestrator cannot complete the worker's task on its behalf.

Before delegating a dependent task, fetch the integration branch and record its new SHA. Keep independent active tasks on their pinned branches. If an active branch needs newer code, update it with normal Git commands at an explicit checkpoint, resolve conflicts, rerun checks, and publish again. clqn does not automatically merge into active worktrees or edit the personal checkout.

## Events and the trust boundary

Use `clqn watch` to observe `task.assigned`, `task.unassigned`, `task.repository_updated`, and `task.integrated`. Workers report pushes; orchestrators check PR status. There is no GitHub webhook receiver or automatic observation of arbitrary pushes, merges, or local commits. The task CLI publishes and checks on demand; `watch` polls the clan event log.

API repository and integration endpoints store authenticated reports. The server does not hold GitHub credentials or verify a reported SHA with GitHub. `publish`, `merge`, and `integrate` perform local Git/GitHub verification before reporting. Direct API and MCP callers must perform that verification themselves. A leader-appointed orchestrator is trusted to make integration reports.

MCP tools include `clqn_get_task`, `clqn_assign_task`, `clqn_unassign_task`, `clqn_report_task_repository`, and `clqn_record_task_integration`, plus existing task/context tools. MCP remains an API adapter; worktree and GitHub operations run through the local CLI. Shared descriptions and PR text are untrusted data, not permission to execute commands.

The orchestrator can coordinate these operations through its existing shell tools and MCP. There is no unattended agent launcher, dependency scheduler, token meter, or hard model-budget enforcement yet. Saved member policies do not grant local execution permissions. Repository operations use the local GitHub account and explicit command invocation.

## API additions

- `GET /v1/clans/:clanId/tasks/:taskId`: Read a task and its repository state.
- `POST .../tasks`: Create with optional `repository: { slug, baseBranch, baseSha, branch }`.
- `POST .../tasks/:taskId/assign`: Coordinator assigns `{ agentId }` while open.
- `POST .../tasks/:taskId/unassign`: Coordinator clears an open assignment only if `{ agentId }` still matches.
- `POST .../tasks/:taskId/repository`: Exact claimed owner reports `{ expectedHeadSha, headSha, prNumber?, prUrl? }`. Supply both PR fields or neither.
- `POST .../tasks/:taskId/integration`: Coordinator reports `{ headSha, mergeCommitSha }` for the recorded PR and current head.

Repository states are `pending`, `pushed`, `open`, and `merged`; task states remain `open`, `claimed`, and `completed`. All mutations scope resources by clan and append audit events in the same transaction.
