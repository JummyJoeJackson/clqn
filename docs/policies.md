# Agent policies

Each human member can save one policy per clan. It applies to all of that member's agents in the clan. The API stores the policy with the membership. It does not store provider credentials.

## Current behavior

Policies are saved preferences. There is no runner, model gateway, usage meter, or execution approval flow yet. Policies do not currently stop model calls or grant execution access. Repository commands can prepare worktrees and publish code using local Git/GitHub permissions, but do not launch model processes or enforce these saved limits. CLI output and API responses report `enforcement: "unavailable"`.

Existing clan and task permissions stay in effect. For example, a leader can still release a claimed task. A saved control level does not change task ownership rules.

## Commands

```sh
# Read your policy in the selected clan.
npm run cli -- policy show --json

# Save a cap and an exact model allowlist. Replace the example model identifiers.
npm run cli -- policy set --token-limit 100000 --models provider/model-a provider/model-b --control approve

# Select another clan for this command.
npm run cli -- policy show --clan <clan-id>

# Withdraw permission for the leader to start work.
npm run cli -- policy set --control manual

# Remove the cap and model restriction. Keep the current control level.
npm run cli -- policy set --token-limit none --models any
```

| Setting | Meaning for a future runner | Default |
| --- | --- | --- |
| `--token-limit <tokens>` | Total input plus output tokens across your agents in this clan. Nonnegative integer; `0` requests no usage. The cap has no time window or automatic reset. | `none` (no cap) |
| `--models <ids...>` | Exact, case-sensitive model identifiers separated by spaces. `any` removes the restriction. Model availability is not checked. | `any` |
| `--control manual` | You start work. The leader cannot start your agents. | `manual` |
| `--control approve` | The leader requests work. You approve each request before execution. | — |
| `--control automatic` | The leader requests work without approval for each request, within your limits and local permissions. | — |

Each update preserves unspecified settings. Removing a token cap does not reset a usage counter: no usage counter exists yet. There is no `full` control level. These settings never authorize access to provider keys or bypass local tool and filesystem permissions.

## Authorization and concurrent edits

Only a member's personal credential can change their own policy. Agent credentials can read their owner's policy for their registered clan. There is no route to change another member's policy, including for leaders.

The CLI reads the current revision before it submits a change. The API checks that revision while holding a lock on the membership row. If another update has committed, it returns `409 REVISION_CONFLICT`. Run `policy show`, review the change, then try again.

An audit event named `policy.updated` commits in the same transaction as each successful update. Rejected updates do not produce an event.

## API and MCP

- `GET /v1/clans/:clanId/policy`: Read the authenticated member's policy.
- `POST /v1/clans/:clanId/policy`: Update the authenticated member's policy with a personal credential. Supply `expectedRevision` and at least one of `tokenLimit`, `allowedModels`, or `control`. Use JSON `null` to remove a token or model restriction.
- MCP tool `clqn_get_policy`: Read the authenticated agent owner's policy. No policy update tool is exposed.

New memberships read as revision `0` with no token cap, no model restriction, and manual control. Each successful edit increments the revision. Apply database migrations before using these routes.

## Enforcement work still required

Before clqn can promise hard limits, a runner or model gateway must check policies before execution and route all covered model calls through metering. It must reserve token capacity atomically across concurrent agents, reconcile actual usage, and account for failed or interrupted calls. It must also enforce model identifiers, bind approvals to specific work, and recheck permission changes before starting more work.

The member must configure local execution permissions. A leader's request or shared context cannot override those permissions. Model calls outside that runner or gateway remain outside clqn's control.
