# GitHub webhooks

A linked repository sends clqn signed GitHub webhooks. Push events to the default branch tell open chats to [sync main](repositories.md#keeping-main-current) right away, and pull request events [confirm merges](repositories.md#how-merges-are-recorded). Without webhooks, clqn still syncs at startup and every five minutes.

## Link a repository

The server must have webhooks enabled (self-hosters: see [webhook server setup](hosting.md#webhook-server-setup)). The clan leader links the clone when creating the clan, using their `gh` sign-in and repository admin access. These commands manage the same link:

```sh
clqn repo link                 # infer current origin
clqn repo link owner/project   # explicit repository
clqn repo list
```

Linking saves the clan binding and creates or updates its matching GitHub hook for push and pull request events. Links made before merge confirmation subscribe to push only; run `clqn repo link` again to update the hook. The secret passes to `gh` through stdin; it is not printed or saved locally. Agents can read metadata and events but cannot configure links or retrieve secrets. The API holds no GitHub access token.

If GitHub setup fails, fix local permissions and rerun: the existing clan link is reused. Duplicate matching hooks require manual cleanup. If the API hostname changes, remove the old GitHub hook before linking the replacement URL.

## Delivery security and ordering

The API verifies signatures before parsing JSON, limits bodies to 2 MiB, and requires the linked repository in push and pull request payloads. Only pushes to the default branch named in the payload emit a main-change event. Ping is accepted; push and pull request deliveries require a UUID delivery ID and are deduplicated per link for 30 days, longer than GitHub offers redelivery; older delivery IDs are deleted as new deliveries arrive.

Delivery registration, event insertion, and the link watermark commit together. Failed transactions remain retryable. Unlinking prevents later delivery acceptance. Audit events identify the integration owner, not the GitHub pusher.

Clients fetch current remote main and verify that it is safe to fast-forward locally. Divergent history is skipped and a deleted main fails to fetch. A signed pull request webhook records a matching merge and completes a chat task.

## Unlink a repository

```sh
clqn repo unlink
# Or: clqn repo unlink owner/project
```

Unlink disables the API binding before removing the matching GitHub hook. If removal fails, delete the hook in GitHub settings. Revoking a login token does not remove repository links.

For a renamed/moved repository, update origin and link the new slug.

## API

Under `/v1/clans/:clanId/repositories`:

| Method/path | Purpose |
| --- | --- |
| `POST /` with `{ "slug": "owner/project" }` | Personal leader creates/retrieves sensitive webhook setup |
| `GET /` | List metadata without secrets |
| `GET /:id` | Read metadata and `lastEventSequence` |
| `POST /:id/unlink` with `{}` | Personal leader disables the link |

`POST /hooks/github/:id` accepts signed public deliveries. Link setup is a personal CLI operation, unavailable through MCP.
