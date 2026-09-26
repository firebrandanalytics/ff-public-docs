# Skills Service — Operations

Guide for deploying, configuring, securing, monitoring, and troubleshooting the Skills Service.

## Deployment

### Helm Chart

The Skills Service ships as the `skills-service` subchart of the `firefoundry-core` umbrella chart. It is **opt-in** — disabled by default because not every installation needs skill management.

Enable it in your `firefoundry-core` values:

```yaml
skills-service:
  enabled: true
  configMap:
    enabled: true
    data:
      SERVICE_NAME: "ff-services-skills"
      NODE_ENV: "production"
      PORT: "8080"
      LOG_LEVEL: "info"
      RUN_MIGRATIONS: "true"
      # The environment this instance serves on the consumer (/v1) API
      ENVIRONMENT_ID: "<environment-uuid>"
      # Blob storage for skill zips (see "Blob Storage" below)
      BLOB_STORAGE_PROVIDER: "<provider>"
      BLOB_STORAGE_CONTAINER: "skills"
```

With the default release name `firefoundry-core`, the Kubernetes Service is `firefoundry-core-skills-service` (ClusterIP, HTTP port `8080`), reachable in-cluster at:

```
http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080
```

### Key Chart Values

| Value | Default | Description |
|-------|---------|-------------|
| `skills-service.enabled` | `false` | Deploy the service |
| `replicaCount` | `1` | Number of pods (ignored when autoscaling is enabled) |
| `image.repository` / `image.tag` | chart default / `latest` | Container image; pin a tag in production |
| `configMap.data` | see above | Non-secret environment variables, set as explicit container env |
| `secret.enabled` / `secret.data` | `false` / `{}` | Service-specific secret env vars (e.g. blob storage credentials). Supply values via `--set-string` or an untracked values overlay; never commit them. |
| `envFrom` | `[]` | Extra ConfigMaps/Secrets to load as env |
| `service.http.port` | `8080` | Service port |
| `resources` | requests `100m` / `64Mi`, limits `500m` / `256Mi` | Pod resources |
| `autoscaling.enabled` | `false` | HPA (min 1, max 5, 80% CPU target) |
| `ingress.enabled` | `false` | The service is cluster-internal by default |
| `global.authentication.*` | not required | Service annotations consumed by the platform gateway |

### Values Provided by the Umbrella Chart

Every `firefoundry-core` subchart receives shared settings through `global.envFrom`:

| Source | Variables used by this service |
|--------|--------------------------------|
| Shared database ConfigMap | `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_SSL_DISABLED` |
| Shared database Secret | `PG_PASSWORD` (fireread), `PG_INSERT_PASSWORD` (fireinsert) |
| Shared entitlement ConfigMap (when the entitlement agent is enabled) | `FF_ENTITLEMENT_*`, `FF_CLUSTER_REF`, `FF_NAMESPACE` |

The Skills Service uses the standard `firefoundry` database and the standard `fireread` / `fireinsert` roles; it needs no database credential of its own. Entries in `configMap.data` / `secret.data` override values from `envFrom`.

### What You Must Add

The chart defaults do **not** configure two things the service needs for full functionality:

1. **`ENVIRONMENT_ID`** — without it the consumer API returns only registry skills; installations and custom skills are not served.
2. **Blob storage** — without it the service starts, but every upload, download, and file read fails.

## Configuration

See [Reference — Environment Variables](./reference.md#environment-variables) for the full list. Operational notes:

### Environment Context

A Skills Service instance serves exactly one environment on its consumer API, set by `ENVIRONMENT_ID` (a UUID). Admin endpoints are not limited to that environment — they take `environment_id` explicitly — so tooling can manage records for any environment through any instance. Use the same UUID when creating installations and custom skills that you expect this instance to serve.

### Blob Storage

Skill zips are stored through the shared FireFoundry blob storage factory, configured with the standard `BLOB_STORAGE_*` variables (provider, account/bucket, container, and provider credentials) — the same convention used by other platform services such as the Context Service. Put non-secret settings in `configMap.data` and credentials in `secret.data` or an `envFrom` Secret.

Objects are written under:

- `registry/<entry-name>/<version>.zip`
- `custom/<environment-id>/<skill-name>/<version>.zip`

Deleting an entry, custom skill, or version record does not delete its blob.

At startup the service logs `Blob storage initialized`, or `Blob storage not configured — skill upload/download will be disabled.` if initialization failed.

### Boolean Settings

`RUN_MIGRATIONS` and `PG_SSL_DISABLED` are treated as **true when set to any non-empty value, including `"false"`**. Leave a variable unset (or set it to an empty string) to turn it off.

This matters in the umbrella chart: the shared database ConfigMap always sets `PG_SSL_DISABLED` to `"true"` or `"false"`, so this release connects **without SSL** in both cases. If your database requires SSL, override it for this service with an empty value:

```yaml
skills-service:
  configMap:
    data:
      PG_SSL_DISABLED: ""
```

When SSL is on, the server certificate is not verified (`rejectUnauthorized: false`).

### Database Migrations

The service's SQL migrations create the `skills` schema and its seven tables, and grant `SELECT` to `fireread` and `SELECT, INSERT, UPDATE, DELETE` to `fireinsert`. Applied migrations are recorded in `public.skills_migrations`, so re-running is safe.

- **In Helm**: `RUN_MIGRATIONS: "true"` (the chart default) runs migrations on every pod start before the server listens.
- **Manually** (from the source repository): `pnpm migrate`.

Migrations connect as `fireinsert`, which must be allowed to create the `skills` schema on first run (or have the schema pre-created by a DBA).

### Entitlements

The `/admin` and `/v1` routes are guarded by the `skills.access` entitlement feature.

| Mode | Behavior |
|------|----------|
| `report` (default) | Licensing problems are logged; requests continue to be served. A missing or malformed `FF_CLUSTER_REF` / namespace logs one error and the service runs unlicensed. |
| `enforce` | Requests are refused when the deployment is not entitled. A missing or malformed cluster reference or namespace **fails startup**. |

Only the exact value `FF_ENTITLEMENT_MODE=enforce` enables enforcement. In the umbrella chart, set `entitlement.mode` and enable `entitlement-agent` to populate these variables.

## Health Checks

| Endpoint | Probe | Behavior |
|----------|-------|----------|
| `GET /health` | Liveness (initial delay 5s, every 30s) | `200 {"status":"healthy",...}` while the process is up |
| `GET /ready` | Readiness (initial delay 10s, every 10s) | `200 {"ready":true}` once the server is listening. It does **not** check PostgreSQL or blob storage. |
| `GET /status` | — | Version, uptime, and `NODE_ENV` |

The container image also defines a Docker `HEALTHCHECK` against `/health`.

Because readiness does not check dependencies, verify database connectivity with a real call, for example `GET /admin/registry?limit=1`.

## Scaling

- The service is **stateless**; scale horizontally with `replicaCount` or `autoscaling.enabled`.
- Each pod opens up to 10 read and 5 write PostgreSQL connections.
- Uploaded zips (up to 50 MB) are held in memory during upload, and zips are loaded fully into memory for downloads and file reads. With the default 256 Mi memory limit, raise `resources.limits.memory` if you handle large skills or concurrent uploads.
- Consumer listings issue one query per registry entry / installation / custom skill; very large catalogs make `/v1/skills` and `/v1/skills/manifest` slower.
- When scaling out with `RUN_MIGRATIONS` enabled, pods starting at the same time may race on the first migration; a pod that fails restarts and skips already-applied migrations. For first-time rollouts, start with one replica.

## Security

- **Network exposure** — The chart deploys a ClusterIP service with ingress disabled. Expose it outside the cluster only through the platform gateway.
- **Admin API has no built-in authorization** — Anyone who can reach `/admin` can publish, delete, and grant skills. Restrict access to trusted platform tooling (network policy, gateway ACL groups via `global.authentication`).
- **Trusted identity header** — The consumer ACL trusts `X-On-Behalf-Of` as sent. It must be set by a trusted component (such as the MCP Gateway), not by end users directly.
- **Fail-closed consumers** — Consumer calls without a valid identity see nothing.
- **Secrets** — Database passwords come from the shared database Secret; blob credentials belong in `secret.data` or an `envFrom` Secret, not `configMap.data`.
- **Container** — Runs as a non-root user (UID 1001) on a Node.js 20 Alpine image.
- **Content** — Skill zips are served as uploaded; treat publishing rights as equivalent to the ability to change agent instructions.

## Monitoring

The service logs to stdout:

| Log line | Meaning |
|----------|---------|
| `Starting ff-services-skills {version, port, env}` | Startup |
| `Blob storage initialized` / `Blob storage not configured — ...` | Blob storage status |
| `[run] 00X_....sql` / `[skip] ...` / `Migrations complete.` | Migration progress |
| `GET /v1/skills 200 12ms` | One line per request: method, URL, status, duration |
| `[identity] GET /skills — app=... bundle=... user=...` | Parsed consumer identity |
| `[identity] ... incomplete identity header ...` | `X-On-Behalf-Of` missing `app` or `bundle` |
| `Request error: ...` | Unhandled error behind a 500 response |
| `[entitlements] ...` | Entitlement configuration or polling problems |

```bash
kubectl -n <namespace> logs deploy/firefoundry-core-skills-service -f
```

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Upload returns `500`; log shows `Blob storage not configured` | Blob storage variables missing or invalid | Configure `BLOB_STORAGE_*` settings and credentials; restart |
| `GET /v1/skills` returns `[]` | No `X-On-Behalf-Of` header, or it lacks `app`/`bundle` | Send `X-On-Behalf-Of: app=<id>; bundle=<id>` |
| Single-skill call returns `403 Access denied` | No identity, or the application has grants that don't include this skill | Add identity; add an `application` access grant, or remove all grants for pass-through |
| Custom skills or installations never appear on `/v1` | `ENVIRONMENT_ID` unset or different from the records' `environment_id` | Set `ENVIRONMENT_ID` to the environment UUID |
| Custom skill not listed | `status` is `draft` or `deprecated`, or it has no version | `PUT /admin/custom/:id` with `{"status":"active"}`; upload a version |
| Consumer sees a newer version than the one installed via `/v1/skills/:name` | Single-skill lookups use the latest upload; installations only pin listings | Expected in this release; see [Concepts](./concepts.md#current-limitations) |
| Upload returns `500` on a valid-looking zip | No `SKILL.md` at the zip root (or under one top-level folder), duplicate version, or unknown entry ID | Check the zip layout; use a new version string; verify the entry ID. Set `NODE_ENV=development` in a test environment to see the error message. |
| `POST /admin/registry` returns `500` | Duplicate registry `name` | Choose a unique name or update the existing entry |
| `POST /admin/custom` with a file returns `500` but the skill exists | The skill row was created but the version upload failed (e.g. no blob storage) | Fix the cause, then upload with `POST /admin/custom/:id/versions` |
| Pod crash-loops at startup with `Invalid configuration` | An env var failed validation (e.g. non-UUID `ENVIRONMENT_ID`, bad `LOG_LEVEL` or `NODE_ENV`) | Fix the value; the log shows which field failed |
| Startup fails with an `FF_CLUSTER_REF` / namespace error | `FF_ENTITLEMENT_MODE=enforce` with missing cluster identity | Provide a valid `FF_CLUSTER_REF`, or use report mode |
| Migration fails with a permission error | `fireinsert` cannot create the `skills` schema | Grant the privilege or pre-create the schema |
| Database connection fails against an SSL-only server | `PG_SSL_DISABLED="false"` is treated as true | Set `PG_SSL_DISABLED: ""` for this service |
| OOMKilled during large uploads | Zips are buffered in memory | Raise the memory limit |
