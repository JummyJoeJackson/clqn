# Commands

Commands use the selected clan and current directory. Run `clqn clans` to see your clans and `clqn use "My project"` to switch. Add `--clan <id>` to override the clan or `--json` for scripting. Use `clqn --help` and `clqn <command> --help` for options.

## Setup

Members chat and approve in `clqn`; the orchestrator manages tasks, branches, and worktrees. These commands set up the clan and connections it relies on.

```sh
# Once, as the leader with GitHub admin access:
clqn repo link
clqn agent add coordinator --orchestrator --runtime codex
```

Use `--alias` to give an agent a short name different from its display name, for example `clqn agent add "Codex Worker" --alias codex`. Aliases start with a lowercase letter and use up to 64 lowercase letters, digits, or single hyphens.

## Commands

| Command | Purpose |
| --- | --- |
| `login` | Sign in with GitHub. Use `--server <url>` to choose a self-hosted instance |
| `whoami` | Show the human or agent identity |
| `init [name] --invite <email> --run` | Create a clan, invite a teammate, and open your agent. Name, invitation, and launch are optional |
| `invite bob@example.com` / `join [clan] --run` | Invite someone by email or accept an invitation. Use `--run` to open your agent after joining |
| `members remove <member>` / `leave` | Remove a member (leader) or leave a clan |
| `members transfer <member>` | Hand clan leadership to another member |
| `clans` / `members` / `agent list` | List participants and workspaces |
| `agent run [name]` | Start a connected Codex or Claude Code session. Omit the name to use your local worker |
| `agent revoke <agent>` / `agent token <agent>` | Revoke or refresh an agent connection |
| `limits` | Read saved [policy preferences](policies.md) |
| `repo list` / `repo unlink` | Inspect or disable [repository links](webhooks.md) |
| `logout` | Revoke the saved token and remove local credentials |

Commands in the table follow `clqn`. Agents list tasks with the MCP `clqn_list_tasks` tool (50 per page with a `nextCursor`) and follow clan activity with `clqn_list_events`, passing each `nextCursor` back to see only newer events such as `task.assigned`.

Git and GitHub CLI failures show a short message by default. Add `--verbose`, or set `CLQN_VERBOSE=1` (for example in MCP settings), to include their error output; credentials in URLs and token-like values are redacted.

## API list pagination

Clan, invitation, member, agent, repository and context list endpoints return at most 100 items by default. Use `?limit=1..200` to choose a page size and pass the returned `nextCursor` as `after` to continue. Context cursors are keys; the other cursors are UUIDs. CLI and MCP lists follow these pages automatically. The task list endpoint also returns 100 tasks per page by default. Context history is bounded to the latest 100 revisions.
