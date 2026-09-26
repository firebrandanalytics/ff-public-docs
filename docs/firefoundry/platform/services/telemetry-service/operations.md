# Telemetry Service — Operations

Deployment, configuration, partition maintenance, monitoring, and troubleshooting for the Telemetry Service.

## Deployment

### Helm Chart

The service is deployed by the `telemetry-service` subchart of the `firefoundry-core` umbrella chart and is **enabled by default** (`telemetry-service.enabled: true`). The umbrella chart also includes:

- **`telemetry-postgresql`** — a dedicated in-cluster PostgreSQL (Bitnami chart, 10 Gi persistent volume) whose init script creates the `telemetry` database and the `firebrand` (admin), `fireinsert` (writer), and `fireread` (reader) roles. Enabled by default; disable it and set `telemetry-service.database.host` to use an external database.
- **A telemetry migration Job** — runs `src/db/bootstrap.ts` (creates the `telemetry` schema and default grants) and then the Drizzle migrations with the admin credentials from the `telemetry-db-admin-secret` Secret.
- **A shared ConfigMap** (`<release>-telemetry-config`) that injects `TELEMETRY_SERVICE_INGEST_URL` (`http://firefoundry-core-telemetry-service:50051`) and `TELEMETRY_SERVICE_HTTP_URL` (`http://firefoundry-core-telemetry-service:3000`) into every service via `global.envFrom`.

Key values under `telemetry-service:` in `firefoundry-core/values.yaml`:

| Value | Default | Purpose |
|-------|---------|---------|
| `enabled` | `true` | Deploy the service |
| `replicaCount` | `1` | Replicas (when autoscaling is off) |
| `image.tag` | `0.1.0` | Service image version — see [Version compatibility](#version-compatibility) |
| `configMap.data.*` | see below | Non-secret environment variables |
| `secret.data.PG_PASSWORD` | placeholder | Reader (`fireread`) password — override |
| `secret.data.PG_INSERT_PASSWORD` | placeholder | Writer (`fireinsert`) password — override |
| `database.host` | `""` | External DB host; empty uses `<release>-telemetry-postgresql` when `database.internal.enabled` |
| `database.port` / `database.name` | `5432` / `telemetry` | Connection target |
| `database.sslMode` | `disable` | `disable` for in-cluster, `require` for external databases |
| `database.internal.enabled` | `true` | Use the bundled `telemetry-postgresql` |
| `migration.enabled` | `true` | Run the bootstrap + migration Job |
| `migration.secretName` | `telemetry-db-admin-secret` | Secret with `username` / `password` for the admin role |
| `migration.autoCreateSecret` | `false` | Create that Secret from `migration.adminPassword` |
| `migration.databaseUrl` | `""` | Optional full `MIGRATION_DATABASE_URL` override |
| `service.http.port` / `service.grpc.port` | `3000` / `50051` | `ClusterIP` service ports |
| `resources` | 100m / 256Mi requests, 500m / 1Gi limits | Pod resources |
| `autoscaling.enabled` | `false` | HPA on CPU (1–10 replicas, 80% target) |
| `ingress.enabled` | `false` | No external exposure by default |

Default `configMap.data`:

```yaml
NODE_ENV: "production"
PORT: "3000"
GRPC_PORT: "50051"
LOG_LEVEL: "info"
SERVICE_NAME: "ff-telemetry-shredder"
SERVICE_VERSION: "0.1.0"
SHRED_STRATEGY: "size:1024"
BATCH_SIZE: "1000"
BATCH_FLUSH_INTERVAL_MS: "1000"
BATCH_MAX_WAIT_MS: "5000"
CACHE_ENABLED: "true"
CACHE_MAX_SIZE_MB: "256"
METRICS_ENABLED: "true"
```

The chart does not set the partition-related variables (`PG_DDL_PASSWORD`, `PARTITION_MAINTENANCE_API_KEY`, `MIGRATION_DB_*`). Add them through `configMap.data` / `secret.data` (or `envFrom`) when you run a version that uses them. See [Reference → Environment Variables](./reference.md#environment-variables) for the full list.

### Version Compatibility

The chart currently pins image `0.1.0`. Newer service versions add:

| Version | Adds |
|---------|------|
| 0.2.0 | `POST /events/batch` |
| 0.3.0 | Weekly partitions, `partition_key` on all APIs, `POST /admin/partitions/maintain`, legacy-schema migration, periodic readiness re-checks |
| 0.4.0 | In-service partition provisioner |
| 0.5.0 | Provisioner runs as the least-privilege `fireddl` role (`PG_DDL_PASSWORD`) |

Upgrading an existing installation from before 0.3.0 to 0.3.0 or later is a one-way data migration — follow [Upgrading to weekly partitions](#upgrading-to-weekly-partitions).

### Container

- Image runs as the non-root `bun` user and exposes ports `3000` and `50051`.
- Default command: `bun run dist/index.js`. The image also contains `src/db` and `sql/`, so migration and maintenance commands can run from the same image.
- On `SIGTERM` the service stops the partition loops, flushes pending batches, then closes the RPC server, HTTP server, and database pools.

## Database Roles

The service uses separate PostgreSQL roles so that no running component holds more privilege than it needs:

| Role | Used by | Privileges |
|------|---------|------------|
| `fireread` | Query path (`PG_PASSWORD`) | `SELECT` on `telemetry` and `telemetry_legacy` |
| `fireinsert` | Ingestion path (`PG_INSERT_PASSWORD`) | DML via the partition parent tables; cannot create or drop partitions |
| `fireddl` | In-service provisioner (`PG_DDL_PASSWORD`) | `EXECUTE` on `telemetry.create_partition_week` (a `SECURITY DEFINER` function) and `SELECT` on the partition registry; cannot drop or truncate |
| `firebrand` | Migration Job and retention maintenance (`MIGRATION_DB_*`) | Full DDL, including drops and truncation |

The `fireddl` grants are applied by migration `0002` **only if the role already exists** when migrations run. The bundled `telemetry-postgresql` init script does not create `fireddl`; to use in-service provisioning, create the role (with `LOGIN` and a password), re-run the migration Job, and set `PG_DDL_PASSWORD` (and `PG_DDL_USER` if you use a different name).

## Partition Maintenance and Retention

### How Partitions Stay Available

1. The migrations create partitions from five weeks back through four weeks ahead of the migration date.
2. When `PARTITION_PROVISIONER_ENABLED=true` (default) and `PG_DDL_PASSWORD` is set, the service provisions the current and future weeks at startup and every `PARTITION_PROVISIONER_INTERVAL_MS` (hourly). If the password is missing or a run fails, it logs and continues.
3. Every 60 seconds the readiness monitor checks that the current and next week exist. If not, `/ready` returns `503` and the provisioner is triggered immediately.
4. At startup, if the current and next week still do not exist after provisioning, the service **exits** — the pod will crash-loop until partitions are created.

If you run without the in-service provisioner, you must schedule maintenance (below) at least weekly, or the service becomes not-ready roughly four weeks after the last provisioning run.

### Retention

The service never drops data on its own. Schedule one maintenance run per week, before Monday 00:00 UTC, from a Kubernetes CronJob. Maintenance takes an advisory lock, provisions weeks, drops each whole week older than the retention window in its own transaction, and truncates legacy data past its window. A week that is missing any of its five child tables is not dropped; it is reported in `failures`.

**Option 1 — admin endpoint (lightweight cron via curl).** Set `PARTITION_MAINTENANCE_API_KEY` and admin credentials (`MIGRATION_DB_USER` / `MIGRATION_DB_PASSWORD` or `MIGRATION_DATABASE_URL`) on the service, then:

```bash
SVC=http://firefoundry-core-telemetry-service.<namespace>.svc.cluster.local:3000

# Preview (dry-run is the default)
curl -fsS -X POST -H "X-API-Key: $KEY" "$SVC/admin/partitions/maintain"

# Live run
curl -fsS -X POST -H "X-API-Key: $KEY" \
  "$SVC/admin/partitions/maintain?dry_run=false&retention_days=30&future_weeks=4"

# Provision future weeks only; keep all data
curl -fsS -X POST -H "X-API-Key: $KEY" \
  "$SVC/admin/partitions/maintain?dry_run=false&provision_only=true&future_weeks=4"
```

Note that enabling this endpoint places drop-capable admin credentials in the running service's environment.

**Option 2 — one-off Job from the service image**, with the admin credentials in its environment:

```bash
bun run src/db/partitions/maintain.ts --dry-run
bun run src/db/partitions/maintain.ts --retention-days 30 --future-weeks 4
bun run src/db/partitions/maintain.ts --provision-only --future-weeks 4
```

With a 30-day policy only whole elapsed weeks are removed, so effective retention is 30–37 days. Size the database for roughly five to six weeks of data plus provisioned future weeks.

### Upgrading to Weekly Partitions

Moving an existing pre-0.3.0 installation to 0.3.0 or later:

1. Back up the telemetry database.
2. Stop producers (or scale them down) and stop the service so pending batches flush cleanly.
3. Run the bootstrap and migrations (the migration Job). Existing tables move to the `telemetry_legacy` schema; nothing is backfilled.
4. Deploy the new image and verify `/ready`, a test ingestion, and both partition-keyed and unkeyed queries. Legacy events remain readable.
5. Resume producers.

Before any new write lands, rollback means dropping the new partitioned tables, moving the legacy tables back to the `telemetry` schema, and redeploying the old image. After new writes begin, roll forward instead.

## Health Checks

| Probe | Path | Chart settings | Behavior |
|-------|------|----------------|----------|
| Liveness | `GET /health` | initial delay 30s, period 10s | Always HTTP 200 while the process serves HTTP; body reports `healthy`/`unhealthy` and `checks.database` |
| Readiness | `GET /ready` | initial delay 15s, period 5s | 503 until startup completes and whenever the current/next week partitions are missing |

The image also defines a Docker `HEALTHCHECK` against `/health`.

## Scaling

- **Stateless replicas.** All durable state is in PostgreSQL; replicas can be added freely. Each replica keeps its own in-memory batch and 256 MB document cache, so size memory limits accordingly (the default 1 Gi limit leaves headroom).
- **Autoscaling.** `autoscaling.enabled: true` creates an HPA on CPU (default 1–10 replicas at 80%).
- **Ingestion throughput** is bounded mainly by flush size and database write speed. Increase `BATCH_SIZE` for fewer, larger writes; lower `BATCH_FLUSH_INTERVAL_MS` for fresher data.
- **Storage vs. row count.** `SHRED_STRATEGY=size:1024` is the recommended default. `full` maximizes deduplication at the cost of many more rows; a larger `size:N` reduces rows but deduplicates less.
- **Connection pools.** Each replica opens up to 10 reader and 10 writer connections. Account for this when sizing PostgreSQL `max_connections`.

## Security

- **No authentication on ingestion or query.** Any workload that can reach ports `50051` or `3000` can write events or read every payload. Keep the service `ClusterIP`-only (the default), leave ingress disabled, and restrict access with Kubernetes NetworkPolicies where required.
- **Payloads are sensitive.** Telemetry contains full prompts, model responses, and tool arguments. Treat the telemetry database and its backups with the same care as application data.
- **Least-privilege database access.** Query and ingestion use separate read and write roles; the provisioner uses a create-only role; drop-capable credentials are needed only by the migration Job and retention maintenance.
- **Admin endpoint.** Disabled unless `PARTITION_MAINTENANCE_API_KEY` is set; the key is compared in constant time and accepted as `X-API-Key` or `Authorization: Bearer`. Maintenance is dry-run unless `dry_run=false` is passed.
- **Secrets.** Replace every placeholder password in `values.yaml` (`telemetry-service.secret.data`, `telemetry-postgresql.*Password`) and keep admin credentials in a Secret (`telemetry-db-admin-secret`).

## Monitoring

`GET /metrics` exposes Prometheus metrics. Counters are per replica and reset on restart.

| Metric | Type | Description |
|--------|------|-------------|
| `tss_info` | gauge | Service name, version, and environment labels |
| `tss_uptime_seconds` | gauge | Uptime |
| `tss_ingest_events_total` | counter | Events accepted |
| `tss_ingest_bytes_total` | counter | Payload bytes accepted |
| `tss_ingest_errors_total` | counter | Events that failed during processing |
| `tss_shred_nodes_total` / `tss_shred_edges_total` | counter | Nodes and edges produced by shredding |
| `tss_shred_duration_seconds` | histogram | Time spent shredding |
| `tss_db_events_inserted_total` | counter | Events written to PostgreSQL |
| `tss_db_nodes_inserted_total` | counter | New nodes written |
| `tss_db_nodes_conflict_total` | counter | Nodes skipped because they already existed (deduplication) |
| `tss_db_edges_inserted_total` | counter | Edges written |
| `tss_db_flushes_total` / `tss_db_flush_errors_total` | counter | Batch flushes and failed flushes |
| `tss_db_flush_duration_seconds` | histogram | Flush duration |
| `tss_batch_nodes` / `tss_batch_edges` / `tss_batch_events` | gauge | Current batch contents |
| `tss_batch_dropped_events_total` | counter | Events dropped after flush retries were exhausted |
| `tss_dedup_ratio` | gauge | Deduplicated nodes / total nodes written |
| `tss_cache_total{result}` | counter | Document cache lookups (`hit` / `miss`) |
| `tss_cache_size_bytes` / `tss_cache_evictions_total` | gauge / counter | Cache size and evictions |
| `tss_rehydrate_total{result}` | counter | Reconstructions (`success` / `error` / `not_found`) |
| `tss_rehydrate_nodes_total` | counter | Nodes fetched during reconstruction |
| `tss_rehydrate_duration_seconds` | histogram | Reconstruction time |

Suggested alerts:

- `tss_batch_dropped_events_total` increasing — telemetry is being lost (usually a database or partition problem).
- `tss_db_flush_errors_total` increasing — writes are failing and being retried.
- Readiness failing for more than a few minutes — partitions missing; check provisioning and maintenance.
- A failed or missed weekly maintenance run (non-2xx response or non-zero exit).

`GET /batch/stats` and `GET /cache/stats` give a live view of one replica's batch and cache.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Pod crash-loops with `Current and next telemetry partitions must exist before startup` | Partitions missing and provisioning unavailable | Set `PG_DDL_PASSWORD` for a `fireddl` role that has the `0002` grants, or run maintenance with admin credentials (`--provision-only` is enough) |
| `/ready` returns 503 on a running pod | Current or next week missing | Same as above; check logs for `[partitions] readiness check failed` |
| Logs show `PG_DDL_PASSWORD is not set` | In-service provisioner has no credentials | Provide `PG_DDL_PASSWORD`, or rely on scheduled maintenance |
| Provisioner fails with permission denied | `fireddl` created after migrations ran, so grants were skipped | Re-run the migration Job so `0002` applies the grants |
| `IngestBatch` fails with `Batch size N exceeds maximum` | Producer sends more than `MAX_BATCH_SIZE` events | Send smaller batches or raise `MAX_BATCH_SIZE` |
| Per-event `Invalid JSON payload` | Payload bytes are not UTF-8 JSON | Send `JSON.stringify(...)` output encoded as UTF-8 |
| Per-event `partition_key ... does not match created_at week` | Producer computed the wrong week | Omit `partition_key` and let the service derive it |
| Native gRPC client cannot connect to `:50051` | Server uses Connect over HTTP/1.1 | Use a Connect or gRPC-Web client, or JSON over HTTP |
| Ingested events never appear in queries | Flush failing (check `tss_db_flush_errors_total`), or non-UUID `event_id` rejected by the database | Fix database connectivity or permissions; always send UUID event IDs |
| `Max retries exceeded for week ... Dropping` in logs | A week could not be written 3 times | Check that the week's partition exists and the writer role has privileges |
| `GET /event/{id}` returns 500 | Non-UUID ID, or database error | Verify the ID is a UUID; check logs |
| Admin endpoint returns 404 | `PARTITION_MAINTENANCE_API_KEY` not set | Set the key to enable it |
| Admin endpoint returns 503 | Admin credentials missing or database unreachable | Set `MIGRATION_DB_USER` / `MIGRATION_DB_PASSWORD` or `MIGRATION_DATABASE_URL` |
| Admin endpoint returns 500 with `failures` | A stale week is incomplete (missing child tables) | Inspect the listed weeks; maintenance fails closed and leaves them in place |
| Endpoints such as `/events/batch` return 404 | Running image predates the feature | Check `image.tag` against [Version compatibility](#version-compatibility) |

## Related

- [Telemetry Service overview](./README.md)
- [Reference](./reference.md)
- [Platform Operations](../../operations.md)
- [Local Development Troubleshooting](../../../local-development/troubleshooting.md)
