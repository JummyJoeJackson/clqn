# GitHub main notifications

GitHub push webhooks notify the clan API when `main` changes. The API records a `repository.main_changed` event. Local watchers check lightweight clan events and fetch Git only after a matching notification, at startup, or on a slow safety fallback. No queue, worker service, SSE, or inbound connection to a user's machine is required.

## Server setup

Apply the database migration before running the updated API:

```sh
npm run db:migrate
```

Set a high-entropy server-only `GITHUB_WEBHOOK_SECRET` of at least 32 characters. Generate one with `openssl rand -hex 32` and store it in your server's private environment or GCP Secret Manager. Keep the same value across API instances and restarts. Do not put it in client or MCP settings. See [GCP hosting](hosting.md#github-webhook-secret).

Without this key, existing API features and Git fallback sync work, but repository linking and webhook delivery return `503 WEBHOOK_UNAVAILABLE`. A configured key shorter than 32 characters prevents API startup. The server derives a different webhook signing secret for each repository/clan link; neither the root key nor derived keys are stored in PostgreSQL.

The API must expose `POST /hooks/github/:link-id` at a stable public HTTPS URL reachable by GitHub. This route does not use a clqn bearer credential; it authenticates the raw body using `X-Hub-Signature-256`. All `/v1` configuration and metadata routes still require normal clan authorization.

## Link a repository

As the clan leader, log in using your personal clqn credential. Authenticate `gh` locally with an account that has admin access to the GitHub repository. From its clone:

```sh
clqn repo link
```

Or name the repository explicitly:

```sh
clqn repo link owner/project
```

The command saves the clan binding, then creates or updates the exact matching GitHub webhook URL. It subscribes to push events, uses JSON payloads and TLS verification, and sends the per-link secret to `gh` over stdin. It does not put the secret in command arguments, print it in JSON output, or save it in local config. The API needs no GitHub access token.

Only a personal clan leader can configure a link or retrieve its setup secret. Worker and orchestrator tokens can read metadata and events in their clan but cannot configure hooks. The same GitHub repository may be linked to different clans with different link IDs and signing secrets.

Setup is idempotent for a repository in a clan. If GitHub setup fails, the clan link may already exist. Fix `gh` authentication/admin access and run `repo link` again; it reuses that link and updates its matching hook. Duplicate matching hooks are refused rather than modified ambiguously. If the API hostname changes, remove the old webhook in GitHub settings before configuring its replacement URL.

## Watch locally

On each machine, select the clan and run from its main checkout:

```sh
clqn sync --watch
```

With a clan credential, the watcher reads the repository's event watermark before its startup Git fetch, so a main push during startup is not lost. It then polls the existing authorized clan event endpoint every 15 seconds. Bounded pages are drained, matching notifications are coalesced, and only events for this repository trigger a Git fetch. GitHub is not polled over Git every 15 seconds.

The watcher also fetches at startup and every five minutes by default. These checks recover from missed webhook deliveries, offline clients, or a missing link. Without a clan credential it uses local Git polling every five minutes. `--interval` changes event polling; `--fallback` changes the Git safety check. An explicit legacy `--interval` still changes Git polling in local-only mode when no `--fallback` is supplied.

A successful or skipped sync acknowledges its notifications. Dirty, diverged, locally ahead, or non-main checkouts remain untouched; after cleanup use `clqn sync`, wait for the fallback, or wait for another main notification. A failed Git attempt keeps notifications pending and retries with bounded exponential backoff. API failures also back off without disabling the Git fallback. Process cancellation aborts requests and subprocesses.

The existing safety checks still apply: only clean main can fast-forward, ignored-file collisions fail, and task branches never update automatically. A webhook SHA is only validated as payload data; it is never executed, checked out directly, or used to reset local history. Git fetch reads the current remote main, so out-of-order notifications cannot move a checkout to an old payload SHA.

## Delivery security and ordering

The API validates the HMAC against the exact raw request bytes before parsing JSON. The body limit is 2 MiB. Valid push payloads must name the linked repository. Only `refs/heads/main` produces a main-change event; other branches are ignored.

Each validated push delivery ID is recorded once per link. Concurrent redelivery produces one event. Delivery registration, audit event insertion, and the link's event watermark commit together. A failed transaction leaves the delivery retryable. Unlink and delivery processing lock the same binding row, so a removed link cannot accept a later delivery.

The audit event's actor identifies the integration owner who linked the repository, not the GitHub user who pushed. `resourceId` is the normalized repository slug. Main deletion and forced-push notifications also produce an event; clients still apply their Git safety checks. Deletion causes a fetch failure; divergent history is skipped rather than reset.

The hook does not mark PRs integrated or tasks complete. Continue using `task submit`, `task check`, `task merge`, and `task done` for the task lifecycle.

## Disable or rotate

As the personal clan leader:

```sh
clqn repo unlink
```

This revokes the API link first and then removes the exact GitHub hook. If GitHub removal fails, the API link is still disabled; remove the old hook in GitHub repository settings. Revoking a personal login token alone does not remove an existing integration.

Changing the server root key changes every derived webhook secret. Keep the new root key consistent across instances, then rerun `repo link` for every repository/clan link to update GitHub. Old signatures fail during that transition; startup and fallback fetches still recover code changes. Renaming or moving a GitHub repository requires updating the origin and linking its new slug.

## API

- `POST /v1/clans/:clanId/repositories` with `{ "slug": "owner/project" }`: personal leader creates or retrieves setup. Returns metadata plus the per-link webhook path and secret. Treat this response as sensitive.
- `GET /v1/clans/:clanId/repositories`: authorized clan members/agents list metadata, without secrets.
- `GET /v1/clans/:clanId/repositories/:id`: authorized metadata read, including `lastEventSequence`.
- `POST /v1/clans/:clanId/repositories/:id/unlink` with `{}`: personal leader disables the link.
- `POST /hooks/github/:id`: signed public GitHub delivery. Requires a valid signature and UUID delivery ID. Ping is accepted; validated push deliveries are deduplicated.

Webhook configuration remains a personal CLI operation, not an MCP tool available to agents. Agents already have task tools; the local sync watcher uses the shared client to read clan events.
