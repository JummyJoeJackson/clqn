# Hosting

The CLI and agent connection run locally. A clqn server stores the shared workspaces that everyone connects to. Run it with Docker Compose for a local trial or deploy it to Cloud Run with managed Cloud SQL PostgreSQL for a team.

## Self-host with Docker Compose

From a clone of this repository, one command builds the API, starts PostgreSQL, applies migrations, and serves the API on `127.0.0.1:8080`:

```sh
docker compose --profile server up --build -d --wait
docker compose exec -T api node packages/api/dist/manage-user.js create you@example.com \
  | clqn login --server http://127.0.0.1:8080
```

The second command creates a local account and pipes its credential directly to the CLI. Rerun the first command after pulling updates; it rebuilds the image and applies new migrations.

Set `POSTGRES_PASSWORD`, `GITHUB_CLIENT_ID` ([GitHub login](#github-oauth-app)), and `GITHUB_WEBHOOK_SECRET` ([webhooks](#webhook-server-setup)) in a private `.env` file next to `docker-compose.yml` to configure them. Set `POSTGRES_PASSWORD` before the first start; the database keeps its original password afterward.

Authenticated clients require HTTPS except on loopback. To share the API with teammates, put a TLS reverse proxy in front of port 8080, for example `caddy reverse-proxy --from clqn.example.com --to 127.0.0.1:8080`, and give them the HTTPS URL for `clqn login --server <url>`. Back up the `pgdata` volume.

## Provision user credentials

Set `DATABASE_URL` in the root `.env`, then run:

```sh
npm run db:migrate
npm run user -- create alice@example.com
npm run user -- revoke <credential-id>
```

Creation prints `user`, `credentialId`, and a one-time `token`. Deliver the token privately and keep the credential ID for revocation. Repeating creation issues another credential without revoking earlier ones. Operator-supplied email addresses are identity labels, not verified addresses.

Tokens do not expire automatically. Revocation blocks subsequent requests; a request already authenticated may finish. Database access stays server-side.

## Webhook server setup

Run `npm run db:migrate`. Set server-only `GITHUB_WEBHOOK_SECRET` to a high-entropy key of at least 32 characters; generate one with `openssl rand -hex 32`. Keep it consistent across instances and restarts, in a private environment or [GCP Secret Manager](#github-webhook-secret).

Expose `POST /hooks/github/:link-id` at a stable public HTTPS URL. It verifies `X-Hub-Signature-256` over the raw body instead of requiring a bearer token. `/v1` routes retain normal authentication.

Without the key, linking and delivery return `503 WEBHOOK_UNAVAILABLE`; other features and Git fallback remain available. A shorter configured key prevents startup. Each repository/clan link gets a derived secret; signing keys are never stored in PostgreSQL or client settings.

Rotating the root key changes every link secret. Update all API instances, then rerun `repo link` for every repository/clan link. Old signatures fail during rotation; fallback fetches recover missed changes.

## GitHub OAuth App

Create a dedicated GitHub OAuth App with **Device Flow** enabled. Set its homepage to the project site and required callback URL to the API origin; device flow uses no callback route. Set `GITHUB_CLIENT_ID` on the API and apply migrations before deployment. Users then sign in as described in [GitHub device login](authentication.md#github-device-login). No client secret or repository permissions are needed. Leave the ID unset to disable new logins.

Enabling login allows any qualifying GitHub user to create an account, but grants no clan membership. The API has process-local admission and polling limits, including 10 login starts per minute per client address (the last `X-Forwarded-For` entry, which Cloud Run sets). Behind an additional load balancer, that entry is the balancer, so clients share one limit. Configure edge rate limits before broad public signup. Keep authentication bodies out of logs.

Public endpoints: `POST /auth/github/start` and `POST /auth/github/poll`; send the polling handle in the JSON body. See [GitHub's device-flow documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

## Cloud Run on GCP

Run the API as one Cloud Run service with managed Cloud SQL PostgreSQL. The following sections cover this setup.

## Build and run the container

```sh
docker build -t clqn-api:local .
docker run --rm -p 127.0.0.1:8080:8080 clqn-api:local
```

The image runs as non-root on port 8080. Set server-side `DATABASE_URL` for authenticated requests; without it, only health works. Migrations are explicit. From a host with database access, use a private environment file:

```sh
docker run --rm --env-file /secure/clqn-server.env clqn-api:local node packages/api/dist/db/migrate.js
docker run --rm --env-file /secure/clqn-server.env clqn-api:local node packages/api/dist/manage-user.js create alice@example.com
```

Provisioning prints a one-time token. Deliver it privately; avoid jobs that capture it in shared logs.

## Prepare Google Cloud

Create these resources in a project with billing:

- A same-region Artifact Registry Docker repository and Cloud SQL PostgreSQL database/user.
- A VPC with private services access and a regional subnet. Use [Cloud SQL private IP](https://docs.cloud.google.com/sql/docs/postgres/configure-private-ip) and [Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc).
- A dedicated runtime service account with `roles/secretmanager.secretAccessor` on the database secret.
- A Secret Manager secret containing the full database URL, such as `postgresql://clqn:<url-encoded-password>@<private-ip>:5432/clqn?sslmode=require`. Match encryption settings to the instance.

The deployer needs permission to deploy Cloud Run, push images, use the service account/subnet, and enable APIs. Set these values for your resources:

```sh
CLQN_PROJECT=your-project
CLQN_REGION=us-central1
CLQN_REPOSITORY=your-docker-repository
CLQN_RELEASE=your-release-tag
CLQN_RUNTIME_ACCOUNT=clqn-api@your-project.iam.gserviceaccount.com
CLQN_NETWORK=your-vpc
CLQN_SUBNET=your-regional-subnet
CLQN_DB_SECRET=clqn-database-url
CLQN_DB_SECRET_VERSION=1
CLQN_IMAGE="$CLQN_REGION-docker.pkg.dev/$CLQN_PROJECT/$CLQN_REPOSITORY/clqn-api:$CLQN_RELEASE"

gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$CLQN_PROJECT"
gcloud auth configure-docker "$CLQN_REGION-docker.pkg.dev"
docker build --platform linux/amd64 -t "$CLQN_IMAGE" .
docker push "$CLQN_IMAGE"
```

## Migrate, then deploy

Run migrations with the release image on the database network:

```sh
gcloud run jobs deploy clqn-migrate \
  --project "$CLQN_PROJECT" --region "$CLQN_REGION" \
  --image "$CLQN_IMAGE" --service-account "$CLQN_RUNTIME_ACCOUNT" \
  --network "$CLQN_NETWORK" --subnet "$CLQN_SUBNET" --vpc-egress private-ranges-only \
  --set-secrets "DATABASE_URL=$CLQN_DB_SECRET:$CLQN_DB_SECRET_VERSION" \
  --command node --args packages/api/dist/db/migrate.js \
  --tasks 1 --max-retries 0 --execute-now --wait
```

After migration succeeds, deploy the same image:

```sh
gcloud run deploy clqn-api \
  --project "$CLQN_PROJECT" --region "$CLQN_REGION" \
  --image "$CLQN_IMAGE" --service-account "$CLQN_RUNTIME_ACCOUNT" \
  --network "$CLQN_NETWORK" --subnet "$CLQN_SUBNET" --vpc-egress private-ranges-only \
  --set-secrets "DATABASE_URL=$CLQN_DB_SECRET:$CLQN_DB_SECRET_VERSION" \
  --port 8080 --concurrency 80 --max-instances 4 --allow-unauthenticated
```

Public transport lets clients send clqn bearer tokens; the API still authenticates `/v1`. Cloud Run provides HTTPS.

Each instance opens up to `DATABASE_POOL_SIZE` database connections (default 10), so the service can use max instances × pool size connections: 40 with the flags above. Keep that below your Cloud SQL instance's `max_connections`, with room for the migration job and admin tools. Requests wait for a free connection when an instance's pool is busy. To serve more traffic, raise the database tier first, then `--max-instances` or `DATABASE_POOL_SIZE` (set it with `--update-env-vars`).

Each instance allows 300 `/v1` requests per minute per credential and answers `429` with `Retry-After` beyond that, before any database work. Instances count separately, so the service-wide limit is up to max instances × 300. Unauthenticated floods need limits at the edge, such as Cloud Armor in front of a load balancer.

Storage is capped per account and clan: each user can create 25 clans and register 25 agents per clan, a clan holds up to 500 context entries, and each entry keeps its latest 100 revisions. Writes past a cap return `409 LIMIT_REACHED`. Change the caps in `packages/api/src/lib/limits.ts`.

Give teammates the HTTPS service URL for `clqn login --server <url>`. Keep `DATABASE_URL` server-side.

## GitHub webhook secret

Store a root key of at least 32 characters in Secret Manager (`openssl rand -hex 32` generates one). Grant the runtime account access and keep its value consistent across instances. Extend the service deployment's secret flag:

```sh
--set-secrets "DATABASE_URL=$CLQN_DB_SECRET:$CLQN_DB_SECRET_VERSION,GITHUB_WEBHOOK_SECRET=clqn-github-webhook-secret:1"
```

This is a flag fragment, not a standalone command. The migration job needs no webhook key. Without it, linking/delivery return 503 while Git fallback works.

Allow public `/hooks/github/*` requests through to the API; GitHub signatures authenticate them. Have the personal clan leader run `clqn repo link`. See [webhook setup and rotation](webhooks.md).

## Verify a deployment

`GET /health` checks process liveness only; `GET /ready` returns `503` until the database answers, so use it for load balancer or startup probes. Every response carries an `X-Request-Id` header, and a `500` message repeats it; the API writes one JSON line per failure with that ID, the method, and the route pattern, never request bodies or credentials. Test authenticated `whoami`, membership, context, and tasks. Run the [two-person acceptance check](#manual-acceptance-check) to verify cloud networking, webhooks, and real agent settings.

## Enable GitHub login

Follow [OAuth App setup](#github-oauth-app). Build a new image, run its migrations, and deploy it before setting the public client ID:

```sh
gcloud run services update clqn-api \
  --project "$CLQN_PROJECT" --region "$CLQN_REGION" \
  --update-env-vars GITHUB_CLIENT_ID=YOUR_OAUTH_APP_CLIENT_ID
```

No client secret is needed. Keep database and webhook settings intact. Unset `GITHUB_CLIENT_ID` to disable new logins; existing clqn tokens remain valid until revoked. Test login, invitations, and revocation. Do not log authentication request/response bodies.

## Manual acceptance check

Before relying on a deployment, test on separate machines with real Codex and Claude Code applications:

1. Sign in as two people; create a clan, invite, and join.
2. Register an agent on each machine and launch a connected session with `clqn agent run`.
3. Share context, update it, inspect history, and confirm stale revisions fail.
4. Assign, claim, submit, merge, and complete a code task. Confirm other actors cannot claim assigned work or complete it; test owner and leader release.
5. Check `status`, `log`, live webhook delivery, clean-main sync, and missed-delivery fallback.
6. Confirm agent access to another clan and personal-only operations fails. Revoke a test token and confirm its next request fails.

Record application versions and setup issues. Automated MCP tests simulate clients; they do not validate real application settings or cloud networking.
