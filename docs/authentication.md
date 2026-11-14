# Authentication and clans

The first authentication slice uses operator-provisioned personal credentials. There is no public signup endpoint or external identity provider yet. The API verifies opaque bearer tokens against SHA-256 hashes in PostgreSQL. Each token contains 256 bits of randomness, belongs to one human user, and grants access to that user's clans. Agent-scoped credentials will be added with agent registration.

## Provision a credential (server operator)

Configure `DATABASE_URL` in the root `.env`, then run from the repository root:

```sh
npm run db:migrate
npm run user -- create alice@example.com
```

The command prints JSON with `user`, `credentialId`, and `token`. The raw token is printed once; deliver it securely to the user and retain the credential ID for revocation. Treat this command's output as a secret. Running it again for the same normalized email issues another credential for the existing user; it does not revoke existing credentials. The email is an operator-supplied identity label, not a verified address.

Credentials do not expire automatically in this initial slice. Revoke a credential with privileged database access:

```sh
npm run user -- revoke <credential-id>
```

Revocation applies to subsequent API requests. An already authenticated request may finish. Provisioning and revocation require server-side database access and are not public API operations. Keep database credentials on the server.

## Log in and create a clan

Save only the raw token in a private file, then pipe it to the CLI so it is not included in command arguments or shell history:

```sh
npm run cli -- login --token-stdin < /secure/path/to/token-file
npm run cli -- whoami
npm run cli -- init "My project"
npm run cli -- clans --json
npm run cli -- members
npm run cli -- members --clan <clan-id> --json
npm run cli -- logout
```

Use `--api-url https://your-api.example` or `CLQN_API_URL` for your server. Authenticated requests require HTTPS except on loopback. The client refuses redirects.

Credentials and the clan selected by `init` or `join` are stored per API origin under `~/.config/clqn` (override with `CLQN_CONFIG_DIR`). The directory is private (`0700`) and credential files are `0600`. A successful login clears the previous clan selection. `CLQN_TOKEN` overrides the saved token for automation; manage that environment variable as a secret. `logout` removes local credentials and selection, but does not revoke the server credential or unset `CLQN_TOKEN`.

Clan creation atomically creates its leader membership. Clan lists show only the caller's clans; membership reads require membership in that clan. Inaccessible clans return the same 404 response as nonexistent clans. Only leaders can create invitations. Other membership management (removal and role changes) is not available yet.

## Invite another member

The leader creates a code for the intended member's operator-provisioned email:

```sh
npm run cli -- invite bob@example.com --json
# Or select a different clan explicitly:
npm run cli -- invite bob@example.com --clan <clan-id> --json
```

Deliver the returned code privately. Codes expire after seven days and can be used once. The API stores only the code's SHA-256 hash and returns the raw code only when creating the invitation. There is no email delivery service or invitation recovery endpoint; create another invitation if needed.

After logging in with their own credential, the recipient runs:

```sh
npm run cli -- join <invite-code>
npm run cli -- members
```

Joining selects the clan locally. The authenticated identity must match the invitation's normalized email. This checks the operator-provisioned identity, not mailbox ownership. Invalid, expired, consumed, or mismatched invitations return the same 404 response. An existing member receives `409 ALREADY_MEMBER`, leaving the invitation unconsumed. Joining consumes the code, adds membership, and appends an audit event in one transaction; simultaneous uses cannot add multiple memberships. Clan creation and invitation creation also append audit events. Event listing will be added in a later slice.

## API surface

All `/v1` operations require `Authorization: Bearer <token>` and return JSON. The server marks responses `Cache-Control: no-store`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/v1/me` | Current user ID and email |
| POST | `/v1/clans` | Create a private clan from `{ "name": "My project" }` |
| GET | `/v1/clans` | List the caller's clans |
| GET | `/v1/clans/:clanId/members` | List members of an authorized clan |
| POST | `/v1/clans/:clanId/invitations` | Leader creates an invitation from `{ "email": "bob@example.com" }` |
| POST | `/v1/invitations/join` | Join using `{ "code": "clqn_inv_..." }`; return the clan |

The public `/health` endpoint remains a database-independent liveness check. The MCP adapter still exposes only `clqn_health`; agent registration and collaboration tools are pending.
