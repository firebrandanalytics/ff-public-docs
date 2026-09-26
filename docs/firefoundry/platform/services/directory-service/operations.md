# Directory Service — Operations

Deployment, configuration, health checks, scaling, security, monitoring, and troubleshooting for the Directory Service.

## Deployment

### Packaging status

The Directory Service is **not yet included in the FireFoundry Helm charts** (`firefoundry-core` or a standalone chart), and its repository does not yet ship a container image definition. Until a chart is published, deploying it means running the Go server binary (`cmd/server`) as your own Kubernetes Deployment (or equivalent) with the environment variables below. This page describes what such a deployment needs; chart values will be documented here once the chart exists.

### Components to provision

| Component | Requirement |
|-----------|-------------|
| **Service process** | One or more replicas of the server binary, listening on `PORT` (default `8090`) |
| **PostgreSQL** | A database the service can reach via `DATABASE_URL`. The service creates and uses the `directory` schema. PostgreSQL 16 is used in development; `gen_random_uuid()` must be available (built in since PostgreSQL 13). |
| **Blob storage** | An Azure Blob Storage container (`BLOB_STORAGE_ACCOUNT`, `BLOB_STORAGE_KEY`, `BLOB_STORAGE_CONTAINER`). Local-disk storage (`BLOB_STORAGE_PROVIDER=local`) is for development and single-replica use only. |
| **Secrets** | API keys, the database password, the storage key, the token-sealing key, and OAuth client secrets |
| **Ingress for the OAuth callback** | Only if you enable Microsoft 365 or Box: the provider must be able to redirect a user's browser to `/v1/connections/callback` |

### Database migrations

The server does **not** apply migrations on startup. Run them before the first start and before each upgrade, using the `dirctl` operator CLI from the service repository:

```bash
dirctl migrate --database-url "$DATABASE_URL"            # apply pending migrations
dirctl migrate --database-url "$DATABASE_URL" --status   # show applied and pending
```

`dirctl migrate` records applied migrations (with a checksum of each file) in `directory.schema_migration` and takes an advisory lock so concurrent runs are safe. A typical Kubernetes pattern is a Job or init container that runs `dirctl migrate` before the Deployment rolls out.

| Migration | Adds |
|-----------|------|
| `V1__directory_schema` | Drives, items, and grants |
| `V2__import_jobs` | Connections, import jobs, and import entries |
| `V3__box_provider` | Box as an allowed connection provider |

Down migrations exist for V2 and V3 (`dirctl migrate --down <N>`). **Back up before upgrading**: a consistent recovery point is the PostgreSQL database, the blob container, and the `DIRECTORY_TOKEN_KEY` taken together.

### Example environment

```yaml
env:
  - name: PORT
    value: "8090"
  - name: DATABASE_URL
    valueFrom: { secretKeyRef: { name: directory-secrets, key: database-url } }
  - name: DIRECTORY_API_KEYS          # name:key:principal-uuid[,...]
    valueFrom: { secretKeyRef: { name: directory-secrets, key: api-keys } }
  - name: BLOB_STORAGE_ACCOUNT
    value: "<storage-account>"
  - name: BLOB_STORAGE_CONTAINER
    value: "<container>"
  - name: BLOB_STORAGE_KEY
    valueFrom: { secretKeyRef: { name: directory-secrets, key: blob-key } }
  - name: BUILD_COMMIT
    value: "<git sha>"
```

The full variable list is in [Reference](./reference.md#configuration).

## Configuration

### API keys and principals

`DIRECTORY_API_KEYS` maps each API key to an application principal UUID:

```
DIRECTORY_API_KEYS=deal-app:<key-1>:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f,credit-agent:<key-2>:4a3b2c1d-...
```

- The `name` appears in logs; the `principal-uuid` is what drives and grants refer to. Use the application's or agent bundle's principal id from your identity system so grants stay meaningful.
- The service will not start without at least one valid entry, and rejects malformed entries at startup.
- Changing keys requires a restart. In this release, principal resolution is configuration-based; it does not call the [Identity Management Service](../identity-service/README.md).

### Delegated import configuration

Delegated import is enabled when `DIRECTORY_TOKEN_KEY` is set **and** at least one provider is completely configured. Provider setup is described in [Integrations](./integrations.md#configuring-providers).

Generate a token-sealing key:

```bash
openssl rand -base64 32
```

Behavior worth knowing:

- **Nothing here can stop the service from starting**, with one exception: if Box credentials are set and `DIRECTORY_BOX_SCOPES` is anything other than exactly `root_readonly`, startup fails. An unusable `DIRECTORY_TOKEN_KEY` or an incomplete provider only logs a warning and leaves the connection routes answering `503`.
- **Keep `DIRECTORY_TOKEN_KEY` stable and backed up.** Stored tokens can only be decrypted with the key that sealed them. If the key is lost, every connection must be deleted and re-consented. A *wrong* key is treated as a configuration error — it does **not** mark connections as revoked — so restoring the right key restores service.
- **Key rotation** is not supported through configuration in this release (one key is active at a time).
- The redirect URLs must be reachable by users' browsers and must route to `GET /v1/connections/callback` on this service. That route is the only one that does not require an API key.

### Entitlements

The `/v1` surface can be gated on the `directory.access` entitlement (checked as a workload entitlement). Configure all four of `FF_ENTITLEMENT_AGENT_URL`, `FF_ENTITLEMENT_ISSUER`, `FF_ENTITLEMENT_JWKS_URL`, and `FF_CLUSTER_REF` (plus `FF_NAMESPACE` to pin the namespace).

| Configuration | Mode | Behavior |
|---------------|------|----------|
| None set | `report` (default) | No check is mounted; startup logs a warning |
| None set | `enforce` | **Service refuses to start** |
| Partial or invalid | either | **Service refuses to start** |
| Complete | `report` | Every request is served; a request that *would* be refused logs a `would-refuse` warning |
| Complete | `enforce` | Requests without the entitlement are refused with HTTP `402` |

Only the exact value `enforce` enables enforcement; any other value, including a different case, means `report`. Recommended rollout: configure in `report` mode, watch for `would-refuse` log lines, and switch to `enforce` only after a clean period.

The check runs after API-key authentication, and `/health` and `/ready` are never gated.

## Health Checks

| Endpoint | Auth | Checks | Use for |
|----------|------|--------|---------|
| `GET /health` | None | Process is serving | Liveness probe |
| `GET /ready` | None | PostgreSQL ping (3 s timeout) | Readiness probe |

```yaml
livenessProbe:
  httpGet: { path: /health, port: 8090 }
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /ready, port: 8090 }
  initialDelaySeconds: 5
  periodSeconds: 5
```

At startup the service pings PostgreSQL (10 s timeout) and exits if the database is unreachable. It shuts down gracefully on `SIGTERM`, allowing in-flight requests up to 15 s.

## Scaling

- **API replicas are stateless** apart from PostgreSQL and blob storage, and can be scaled horizontally. Use Azure blob storage (not local disk) when running more than one replica.
- **Import workers run in-process.** Each replica starts `IMPORT_WORKERS` workers (default `4`). Workers claim jobs and entries with 5-minute leases that are renewed while downloads progress, so any number of replicas can share import work safely, and a job interrupted by a restart is resumed by another worker.
- **Dedicated roles.** To separate interactive traffic from import work, run API replicas with `IMPORT_WORKERS=0` and a separate set of replicas with workers enabled.
- **Temporary disk.** Each in-progress download is streamed to a file in `DIRECTORY_IMPORT_TEMP_DIR` (default: the OS temp directory) while it is hashed. Budget up to 256 MiB per concurrently downloading worker. A full disk is recorded as entry reason `insufficient_space`.
- **Memory.** `POST /v1/items:upload` buffers the whole request body (up to 256 MiB) in memory. Size memory limits for your expected concurrent uploads, or prefer promote/import for large files.

## Security

- **API keys are application credentials.** Anyone holding a key can act as that application and assert any user. Dual-grant confines the damage to the drives that application has been granted — keep application grants narrow and rotate keys by updating `DIRECTORY_API_KEYS`.
- **`X-On-Behalf-Of` is unsigned.** Only trusted platform components should hold API keys. Always send the header as `user=<uuid>`; a malformed or bare value is either rejected or treated as "no user".
- **Existence is not leaked.** Unreachable items, connections, and jobs return `404`.
- **OAuth tokens** are sealed with AES-256-GCM, bound to their connection, never logged, and never returned by the API. Deleting a connection erases them.
- **Read-only providers.** Box scopes are restricted to `root_readonly`; Graph uses delegated read scopes. There is no write-back and no application-wide provider credential.
- **Download redirects** from providers are followed without forwarding the provider bearer token to other origins.
- **Secrets never appear in logs**: `DIRECTORY_TOKEN_KEY` and client secrets are excluded from log output and error messages.
- **Content is never deleted** by the service. Coordinate any blob or working-memory cleanup in your environment so it does not remove content the directory references (see [Concepts](./concepts.md#content-referenced-never-owned)).

## Monitoring

The service logs to stdout as structured key-value text (`log/slog`). Useful lines:

| Message | Level | Meaning |
|---------|-------|---------|
| `directory service starting` | INFO | Startup with port, blob backend, and principal count |
| `connection and import surface enabled` | INFO | Lists enabled providers and worker count |
| `connections are not configured; ...` | WARN | Connection routes will answer `503` |
| `DIRECTORY_TOKEN_KEY is present but unusable; ...` | WARN | Key is malformed; connections disabled |
| `entitlements are not configured; ...` / `entitlement check site mounted` | WARN / INFO | Entitlement status |
| `would-refuse` | WARN | Report-mode entitlement signal |
| `claimed import job` / `import job finished` | INFO | Job progress, with final counts |
| `import job paused on a transient error` | WARN | Job released for retry |
| `import job failed: credential revoked` | WARN | Connection needs re-consent |
| `source unreachable` | WARN | Provider or network failure during browse |
| `request failed` | ERROR | An unexpected `500` |

Set `LOG_LEVEL=debug` to log every request's method, path, and status.

For import health, poll `GET /v1/imports/{id}` and alert on jobs that remain non-terminal for a long time or that end `completed_with_errors`; use `GET /v1/imports/{id}/entries?state=failed` to see why.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Service exits: `DIRECTORY_API_KEYS is required` | No API keys configured | Set at least one `name:key:principal-uuid` entry |
| Service exits: `bad DIRECTORY_API_KEYS entry` | Malformed entry or non-UUID principal | Fix the entry format |
| Service exits: `postgres unreachable` | Wrong `DATABASE_URL` or network | Check connectivity and credentials |
| Service exits: `BLOB_STORAGE_CONTAINER is required` | Azure selected without a container | Set `BLOB_STORAGE_CONTAINER` |
| Service exits: `invalid DIRECTORY_BOX_SCOPES` | Box scope other than `root_readonly` | Set `DIRECTORY_BOX_SCOPES=root_readonly` |
| Service exits mentioning `FF_ENTITLEMENT_MODE=enforce` | Enforce mode without complete entitlement config | Complete the configuration or use `report` |
| SQL errors about missing `directory` tables | Migrations not applied | Run `dirctl migrate` |
| `401 UNAUTHENTICATED` | Missing or unknown `X-API-Key` | Check the key against `DIRECTORY_API_KEYS` |
| `403 FORBIDDEN` on a drive | The application has no grant on the drive root, or the user has no grant in the drive | Grant the application on the root; grant the user on a folder |
| `404` for an item that exists | Caller fails dual-grant, or the user's grants are on a different anchor | Check grants with `GET /v1/items/{id}/permissions`; see [Authorization](./authorization.md) |
| User lost access to a subfolder after sharing it | The first grant on a subfolder makes it a new anchor | Grant the user on that subfolder too |
| Requests act as the application, ignoring the user | `X-On-Behalf-Of` sent as a bare UUID | Send `user=<uuid>` |
| `503 CONNECTIONS_NOT_CONFIGURED` | Token key or provider settings missing | Check startup warnings; see [Integrations](./integrations.md#configuring-providers) |
| Consent returns `502 SOURCE_IDENTITY_UNAVAILABLE` | Graph scopes lack `openid` | Include `openid` in `DIRECTORY_MSGRAPH_SCOPES` |
| Consent returns `502 SOURCE_UNREACHABLE` | Token exchange failed, or no refresh token (`offline_access` missing) | Check client secret, token URL, and scopes |
| `409 AUTH_REVOKED` | Provider rejected the stored credential | Delete the connection and reconnect |
| Import entries `failed` / `too_large` | Source file over 256 MiB | Not supported in this release |
| Import entries `failed` / `name_conflict` | A different item with that name exists in the target folder | Rename or remove it, then re-import |
| Import entries `failed` / `insufficient_space` | Temp directory full | Enlarge `DIRECTORY_IMPORT_TEMP_DIR` storage |
| Jobs stay `queued` | No replica has `IMPORT_WORKERS` > 0 | Enable workers on at least one replica |
| `412 PRECONDITION_FAILED` on rename | Item changed since read | Re-read the item and retry with the new ETag |
