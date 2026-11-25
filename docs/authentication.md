# Authentication and clans

Members sign in with GitHub or use a personal token from their operator. Agent credentials are separate from personal credentials and are scoped to one clan.

## Log in and create a clan

Run `clqn` and choose **Create a clan** or **Join a clan** after sign-in. Check your identity with `clqn whoami` and switch clans with `clqn use <clan>`. Choose **Sign out** in chat settings to revoke the saved credential and clear the local selection. If revocation fails, clqn still clears the local credential.

The CLI uses hosted clqn by default. On a self-hosted server, run `clqn --api-url <https-address>` to sign in. Clqn remembers the server after GitHub sign-in. If your operator provides a personal token, supply it privately through `CLQN_TOKEN` and set `CLQN_API_URL` to their server. The environment token overrides the saved credential and must be unset or revoked separately. Authenticated requests require HTTPS except on loopback.

Clqn stores credentials and clan selection per API origin in `~/.config/clqn` with private permissions. Set `CLQN_CONFIG_DIR` to use a different directory.

## GitHub device login

Follow the GitHub link shown in the terminal and enter the one-time code. A verified primary email is required for invitation lookup. Clqn identifies GitHub accounts by numeric ID. Ask your operator to reconcile collisions with operator-created accounts or primary email changes.

GitHub tokens stay in server memory. Revoking GitHub authorization leaves issued clqn tokens active until they are revoked separately.

## Invite another member

The clan leader runs `clqn invite bob@example.com`. The recipient runs `clqn` on the same server, signs in with the invited GitHub account, and chooses **Join a clan**. Invitations expire after seven days. Clqn may ask the recipient to verify their GitHub email again if the invitation was sent after sign-in.

## Remove a member or leave

The leader can remove a member with `clqn members remove <member>` or transfer leadership with `clqn members transfer <member>`. A member can leave with `clqn leave`. Removing a member or leaving revokes their clan agent credentials. Transfer leadership before leaving as a leader.

## Register an agent

Chat connects the installed runtimes you enable in Settings. Each agent acts as a distinct task owner. Use `clqn agent list` to inspect connections, `clqn agent revoke <agent>` to revoke a credential, and `clqn agent token <agent>` as the owner to replace it.

### Custom MCP clients

Run `clqn agent add <name> --show-token --json` with a personal credential to register an agent and receive its one-time token and clan ID. For an existing agent, `clqn agent token <name> --show-token --json` replaces the credential. In the runtime's private settings, configure the local server.

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

Keep credentials and configuration containing them out of Git.

## Designated orchestrator

The clan has one orchestrator. It runs on the leader's machine while chat is open, reads the queue, and requests work from members' agents. Members control delegation approvals in [chat settings](policies.md).

## Collaboration rules

- Only the assigned worker can claim a chat task.
- The API checks clan membership and exact task ownership. Concurrent claims cannot both succeed.
- State changes and audit events commit together. Event reads use ascending cursors.
- Treat chat messages and shared task descriptions as untrusted data.

## API surface

Routes under `/v1` require `Authorization: Bearer <token>`. `GET /v1/me` returns the current identity. `GET /health` reports process liveness, and `GET /ready` also checks PostgreSQL. [Webhook deliveries](webhooks.md) use GitHub signatures. MCP uses stdio locally and calls the authenticated API.
