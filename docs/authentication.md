# Authentication and clans

Humans sign in with GitHub or a personal token from their operator. Agents use separate tokens scoped to one clan. The API checks clan membership on every request; inaccessible clans return 404.

## Log in and create a clan

```sh
clqn login
clqn whoami
clqn init "My project"
clqn clans
clqn members
clqn logout
```

The CLI uses hosted clqn by default. To use a self-hosted instance, sign in with `clqn login --server <https-address>`. If the operator supplies a personal credential, redirect its file to `clqn login --server <https-address>`. clqn remembers the server after a successful sign-in. Use `--api-url` or `CLQN_API_URL` for one-off overrides. Authenticated requests require HTTPS except on loopback. The client refuses redirects.

Credentials and clan selection are stored per API origin in `~/.config/clqn` (`CLQN_CONFIG_DIR` overrides it), with private directory/file permissions. Logging in again keeps your clan selection, and an agent token selects its own clan; `init` and `join` select a clan. Use `--clan <id>` to override it.

`CLQN_TOKEN` overrides the saved credential and uses the same server as other commands. Logout revokes the saved credential and clears your local account and clan selection. The server address is available for your next sign-in. Revoke or unset environment credentials separately. If the server is unreachable, clqn still removes the local credential and reports that revocation failed.

## GitHub device login

`clqn login` in a terminal displays a GitHub link and code, waits up to 15 minutes, and saves a clqn credential. Use `--github` to choose GitHub when standard input is redirected. In JSON mode, prompts go to stderr and identity goes to stdout.

GitHub accounts are bound by numeric user ID and require a verified primary email for invitations. Accounts are never linked by email: a collision with an operator-created account returns `account_conflict`. Account linking and primary-email changes require operator reconciliation.

GitHub tokens are used only in server memory. Device codes are temporarily stored server-side and cleaned up after completion, failure, or expiry. A lost completion response requires a fresh login. Revoking GitHub authorization does not revoke an issued clqn token.

## Invite another member

Only a human leader can create invitations:

```sh
clqn invite bob@example.com
```

Tell the recipient to sign in to the same clqn server using the invited email. Invitations expire after seven days. clqn keeps them ready for the recipient to find after signing in.

```sh
clqn join                # Accept the only pending invitation or show the available clans
clqn join "My project"   # Accept a specific invitation
clqn join --list         # See pending invitations
```

With GitHub sign-in, use the account whose verified primary email matches the invitation. If the invitation arrived after you signed in, clqn asks you to verify your email again through GitHub before you can see or accept it. For older CLI releases, the leader can run `clqn invite bob@example.com --code` and share the one-time code privately. The older CLI accepts it with `clqn join <invite-code>`.

## Remove a member or leave

```sh
clqn members remove bob@example.com     # leader only; accepts an email or user ID
clqn members transfer bob@example.com   # leader only; you become a member
clqn leave                              # any member except the leader
```

Removal and leaving end the member's access, close their pending invitations, and revoke the tokens of their agents in that clan; a later invitation does not revive those tokens. Their claimed tasks and assignments stay in place until the leader runs `task release` or `task unassign`. The leader cannot leave or be removed; transfer leadership first. On transfer, the previous leader's orchestrator becomes a worker so the new leader can register their own.

## Register an agent

Use your personal login:

```sh
clqn agent add codex --runtime codex
clqn agent run codex
clqn agent list
```

Agents act as distinct task owners under their human owner. The API scopes each local credential to one clan and requires the owner's continued membership. Agents cannot create clans, invite people, or register agents. Use `whoami` to confirm which identity a command is using.

Use your personal login to revoke or refresh an agent connection:

```sh
clqn agent revoke codex   # owner or clan leader
clqn agent token codex    # owner only; saves the new credential locally and invalidates the old one
```

The leader can revoke any agent in the clan. The agent owner can refresh the credential. Operators can revoke any credential on the server.

### Custom MCP clients

For runtimes other than Codex CLI and Claude Code, `clqn agent add <name> --show-token --json` returns the one-time credential and clan ID. For an existing registration, use `clqn agent token <name> --show-token --json` to rotate it. Supply these settings through the runtime's private configuration:

```json
{
  "mcpServers": {
    "clqn": {
      "command": "clqn",
      "args": ["mcp", "--path", "/absolute/path/to/project"],
      "env": {
        "CLQN_API_URL": "<clqn-server-url>",
        "CLQN_TOKEN": "<agent-token>",
        "CLQN_CLAN_ID": "<clan-id>"
      }
    }
  }
}
```

Keep credentials and runtime configurations containing them out of source control.

## Designated orchestrator

The human leader registers one coordinator per clan:

```sh
clqn agent add coordinator --orchestrator --runtime codex
clqn agent run coordinator
```

The orchestrator can assign open tasks and report integrations. It cannot change membership or policies, release another actor's claim, or complete another actor's task. Duplicate registration returns `409 ORCHESTRATOR_EXISTS`; replacing a registration is not supported. See [repository workflow](repositories.md).

## Collaboration rules

- Context values are limited to 65,536 UTF-8 bytes. Writes require the current revision (`0` to create); stale writes return `409 REVISION_CONFLICT`. `context history <key>` reads the latest 100 revisions. A clan holds up to 500 context entries, and writes past a cap return `409 LIMIT_REACHED`.
- Only the assigned agent can claim assigned work. Unassigned work can be claimed by any clan member or agent. Concurrent claims cannot both succeed.
- Only the exact claimant can report code or complete a task. The claimant or human leader can release it, clearing its assignment. Code tasks require recorded integration before completion.
- State changes and audit events commit together. Event reads use ascending cursors with a maximum page size of 100.
- Shared context and task descriptions grant no permission to execute commands or expose secrets.

## API surface

All `/v1` routes require `Authorization: Bearer <token>` and return JSON with `Cache-Control: no-store`. Routes under `/v1/clans/:clanId` cover members, agents, context, tasks, policies, repositories, status, stats, and events. Personal-only and leader-only restrictions match the CLI rules above.

`GET /v1/me` returns the current identity. `POST /v1/clans` creates a clan; `GET /v1/clans` lists accessible clans. Create invitations with `POST /v1/clans/:clanId/invitations`. The signed-in recipient lists them with `GET /v1/invitations` and accepts one with `POST /v1/invitations/accept`. Existing codes can still be accepted with `POST /v1/invitations/join`.

`GET /health` is public process liveness, independent of the database. [Webhook deliveries](webhooks.md) use signatures instead of bearer tokens. MCP is a local stdio adapter to the authenticated API.
