# Authentication and clans

Humans sign in with GitHub or a personal token from their operator. Agents use separate tokens scoped to one clan. The API checks clan membership on every request; inaccessible clans return 404.

## Log in and create a clan

```sh
clqn login --github
# Or use an operator-issued token:
clqn login < /secure/path/to/token-file
clqn whoami
clqn init "My project"
clqn clans
clqn members
clqn logout
```

Set `CLQN_API_URL` or `--api-url` to your operator's URL. Authenticated requests require HTTPS except on loopback; redirects are refused.

Credentials and clan selection are stored per API origin in `~/.config/clqn` (`CLQN_CONFIG_DIR` overrides it), with private directory/file permissions. Logging in again keeps your clan selection, and an agent token selects its own clan; `init` and `join` select a clan. Use `--clan <id>` to override it.

`CLQN_TOKEN` overrides the saved token. Logout revokes the saved token on the server, then removes local credentials and selection. It does not revoke or unset `CLQN_TOKEN`. If the API is unreachable, local credentials are still removed and the output reports that revocation failed.

## GitHub device login

`clqn login --github` displays a URL and code, waits up to 15 minutes, and saves a clqn token. In JSON mode, prompts go to stderr and identity goes to stdout; tokens are not printed. Piped token login remains supported.

GitHub accounts are bound by numeric user ID and require a verified primary email for invitations. Accounts are never linked by email: a collision with an operator-created account returns `account_conflict`. Account linking and primary-email changes require operator reconciliation.

GitHub tokens are used only in server memory. Device codes are temporarily stored server-side and cleaned up after completion, failure, or expiry. A lost completion response requires a fresh login. Revoking GitHub authorization does not revoke an issued clqn token.

## Invite another member

Only a human leader can create invitations:

```sh
clqn invite bob@example.com
```

Deliver the code privately. It expires after seven days and can be used once. There is no email delivery or code recovery; create another invitation if needed.

The recipient signs in with the matching email identity, then runs:

```sh
clqn join <invite-code>
```

Invalid, expired, consumed, or mismatched codes return 404. Existing members receive `409 ALREADY_MEMBER` without consuming the code.

## Remove a member or leave

```sh
clqn members remove bob@example.com     # leader only; accepts an email or user ID
clqn members transfer bob@example.com   # leader only; you become a member
clqn leave                              # any member except the leader
```

Removal and leaving end the member's access and revoke the tokens of their agents in that clan; a later invitation does not revive those tokens. Their claimed tasks and assignments stay in place until the leader runs `task release` or `task unassign`. The leader cannot leave or be removed; transfer leadership first. On transfer, the previous leader's orchestrator becomes a worker so the new leader can register their own.

## Register an agent

```sh
clqn agent add codex --json
clqn agent list
```

Use your personal credential. Configure the returned one-time token in the agent's [private MCP settings](index.md#connect-an-agent); registration leaves your personal login unchanged.

Agents act as distinct task owners under their human owner. Their tokens are restricted to one clan and require the owner's continued membership. Agents cannot create clans, invite people, or register agents. `whoami` shows the agent and owner, not whether the agent is running.

Revoke or replace agent tokens with your personal credential:

```sh
clqn agent revoke codex   # owner or clan leader; `agent list` marks it revoked until a new token is issued
clqn agent token codex    # owner only; prints a new one-time token and invalidates the old one
```

The leader can revoke any agent in the clan but cannot obtain another member's agent token. Operators can also revoke any credential on the server.

## Designated orchestrator

The human leader registers one coordinator per clan:

```sh
clqn agent add Coordinator --orchestrator --json
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

`GET /v1/me` returns the current identity. `POST /v1/clans` creates a clan; `GET /v1/clans` lists accessible clans. Invitations use `POST /v1/clans/:clanId/invitations` and `POST /v1/invitations/join`.

`GET /health` is public process liveness, independent of the database. [Webhook deliveries](webhooks.md) use signatures instead of bearer tokens. MCP is a local stdio adapter to the authenticated API.
