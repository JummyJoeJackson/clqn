# Agent policies

Each member can save limits for all their agents in a clan. **Allowed models are enforced** before each chat delegation: the orchestrator must pick one of your models (it defaults to the first), and approvals are rechecked against your current list. The token limit and control level are saved preferences that seed your chat settings. Responses report `enforcement: "models"`.

## Commands

```sh
clqn limits
clqn limits --tokens 100000 --models provider/model-a provider/model-b --control approve
clqn limits --tokens none --models any
```

Updates preserve unspecified fields. Use `--clan <id>` to select a clan and `--json` for scripting.

| Setting | Behavior | Default |
| --- | --- | --- |
| `--tokens <n>` | Total tokens across your agents in this clan, counted as in [How tokens are counted](chat.md#how-tokens-are-counted); no time window or reset. `0` requests no usage; `none` removes the cap. | `none` |
| `--models <ids...>` | Exact, case-sensitive model IDs that chat delegations to your agents may use; availability is not checked. `any` removes the restriction. | `any` |
| `--control manual` | You start work. | `manual` |
| `--control approve` | The leader requests work; you approve each request. | — |
| `--control automatic` | The leader requests work within limits and local permissions, without per-request approval. | — |

Policies never grant access to provider keys, override local permissions, or change task ownership rules.

## Authorization and concurrent edits

Only a personal credential can edit its own member policy; leaders cannot edit others' policies. Agents can read their owner's policy in their registered clan.

The CLI reads the current revision before updating. A concurrent change returns `409 REVISION_CONFLICT`; run `clqn limits`, review, and retry. Successful updates increment the revision and atomically record `policy.updated`. New memberships start at revision `0`.

## API and MCP

- `GET /v1/clans/:clanId/policy`: read your policy.
- `POST /v1/clans/:clanId/policy`: send `expectedRevision` and at least one of `tokenLimit`, `allowedModels`, or `control`. JSON `null` removes a cap or model restriction.
- MCP `clqn_get_policy`: read only; no update tool.

clqn checks the model named on each delegation; it cannot stop an agent from calling a different model outside clqn.
