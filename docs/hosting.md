# GCP hosting

The cloud API will be hosted on GCP with managed PostgreSQL. Choose a simple managed deployment; specific services and infrastructure configuration are still to be selected. The repository does not yet include deployment automation.

The CLI and stdio MCP adapter run on members' machines and connect to the API over HTTPS.

## Configuration

Build with `npm run build`, then start the API with `npm run start --workspace @clqn/api`.

Configure these values through the deployment environment:

| Variable | Purpose |
| --- | --- |
| `HOST` | Set to `0.0.0.0` for the deployed listener |
| `PORT` | Port supplied by the deployment environment |
| `DATABASE_URL` | Managed PostgreSQL connection string |

Point local CLI/MCP clients at the deployed HTTPS endpoint with `CLQN_API_URL`.

`GET /health` checks process liveness only. It does not indicate database readiness or authorization. Other routes currently return a structured 404; authenticated collaboration endpoints remain to be implemented.

See [database setup](database.md) for migration instructions.
