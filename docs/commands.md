# Commands

Run `clqn` to sign in, choose a clan, and open chat. Chat handles work requests, approvals, agent settings, and sign-out. See the [chat guide](chat.md) for keys and settings.

| Command | Purpose |
| --- | --- |
| `clqn whoami` | Show the current identity |
| `clqn health` | Check API liveness |
| `clqn clans` / `clqn use <clan>` | List or select a clan |
| `clqn invite <email>` | Invite a teammate as clan leader |
| `clqn members` | List members |
| `clqn members remove <member>` / `clqn members transfer <member>` | Remove a member or transfer leadership as clan leader |
| `clqn leave` | Leave the current clan as a member |
| `clqn agent add <name>` / `clqn agent list` | Register or list agent connections |
| `clqn agent revoke <agent>` / `clqn agent token <agent>` | Revoke or refresh an agent credential |
| `clqn repo link` / `clqn repo list` / `clqn repo unlink` | Manage [GitHub repository links](webhooks.md) |

Use `clqn <command> --help` for options. Most clan commands accept `--clan <id>` to override the selected clan. Use `--api-url <url>` to choose a server and `--json` for machine-readable command output.

Git and GitHub CLI failures show a short message. Add `--verbose` or set `CLQN_VERBOSE=1` to include redacted diagnostics.

## API list pagination

Use `?limit=1..200` on paginated lists and pass the returned `nextCursor` as `after` to continue. Most lists default to 100 items. Context cursors use keys. Task and other resource cursors use UUIDs. Clqn follows pages automatically for CLI list commands.
