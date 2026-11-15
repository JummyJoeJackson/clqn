# Commands

Use a short command for each common action. Commands use the selected clan and current directory unless you supply an override.

## Common workflow

```sh
# From the main project clone: keep only main synced.
clqn sync --watch

# Register identities with your personal credential.
clqn agent add Coordinator --orchestrator
clqn agent add Codex

# In the orchestrator's session, from the project clone:
clqn task add "Implement login" --code
clqn task assign <task-id> --agent <worker-agent-id>

# In the worker's session, from the project clone:
clqn task start <task-id>
# Change into the printed worktree directory. Work, test, and commit there.
clqn task submit <task-id>

# In the orchestrator's session:
clqn task check <task-id>
clqn task merge <task-id>

# In the worker's session:
clqn task done <task-id>
```

Agent registration does not launch a model process. These examples assume each agent session uses its own token. `start` claims and opens work; it does not launch an agent or execute project setup scripts. `submit` pushes a committed task branch and creates or reuses its PR. `done` records task completion; code tasks still require recorded integration first.

`task add --code` infers origin, fetches the latest `origin/main`, and chooses a unique branch. `start` chooses a worktree directory beside the primary clone, named with the first eight characters of the task ID. It prints the path and can resume the same matching worktree without changing its existing edits. Change into that directory before submitting. The current shell directory is not changed by clqn.

## Other common commands

```sh
clqn login < /secure/path/to/token
clqn init "My project"
clqn invite bob@example.com
clqn join <invite-code>
clqn limits
clqn limits --tokens 100000 --models provider/model --control approve
clqn status
clqn watch
```

`limits` shows saved preferences with no options, or updates the fields you specify. `--tokens none` removes a cap; `--models any` removes the allowlist. These settings are not yet enforced by a model runner. `watch` observes clan events; `sync --watch` polls Git and only fast-forwards a clean main checkout.

## Explicit overrides

```sh
# Sync a different checkout; origin is still inferred.
clqn sync --path ~/Projects/project --watch

# Assert the expected GitHub repository.
clqn sync --repo owner/project

# Set repository details yourself instead of using --code.
clqn task add "Review the API" --repo owner/project \
  --base-sha <full-commit-sha> --base-branch main --branch clqn/api-review

# Choose the source clone and task directory.
clqn task start <task-id> --from ~/Projects/project --path ~/Projects/api-review

# Submit without changing your shell directory.
clqn task submit <task-id> --path ~/Projects/api-review
```

Use either `--code` or explicit repository flags when creating a task. An initial `start` can fail after a successful claim, for example if fetching fails. The error reports that the task remains claimed; resolve the local problem and retry. An existing unrelated directory or branch is not overwritten. See [repository workflow](repositories.md) for recovery and GitHub requirements.

## Compatibility

Earlier commands remain supported. The default help and README show the shorter forms.

| Earlier command | Preferred command |
| --- | --- |
| `clqn repo sync --repo owner/project --repo-path . --watch` | `clqn sync --watch` |
| `clqn agent connect --name Codex` | `clqn agent add Codex` |
| `clqn policy show` | `clqn limits` |
| `clqn policy set --token-limit 100000` | `clqn limits --tokens 100000` |
| `clqn task claim <id>` then `clqn task prepare <id> --path <directory>` | `clqn task start <id>` |
| `clqn task publish <id> --path <directory>` | `clqn task submit <id>` from the task directory |
| `clqn task complete <id>` | `clqn task done <id>` |
| `clqn task integrate <id>` | `clqn task merge <id>` again after GitHub confirms the merge |
| `clqn login --token-stdin < <file>` | `clqn login < <file>` |

Explicit `task claim` and `task prepare` still work independently. The earlier repo/policy groups and lower-level task commands remain available even when omitted from the default help. API route names, MCP tool names, authorization, ownership, and JSON task contracts are unchanged. `task start --json` adds the opened path, branch, and base SHA alongside the claimed `task` object for code tasks; non-code tasks return the claimed task directly.
