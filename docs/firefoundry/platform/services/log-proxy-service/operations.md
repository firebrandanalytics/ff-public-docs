# Log Proxy Service — Operations

This guide covers deploying, configuring, securing, monitoring and troubleshooting the Log Proxy Service.

## Deployment

### Helm Chart

The service is packaged as the `log-proxy-service` chart (version 0.1.2) and is an **opt-in** dependency of `firefoundry-core`. It is disabled by default:

```yaml
# firefoundry-core values
log-proxy-service:
  enabled: true
```

With the default release name `firefoundry-core`, the chart creates:

| Resource | Name |
|----------|------|
| Deployment and Service | `firefoundry-core-log-proxy-service` |
| ConfigMap (non-secret env) | `firefoundry-core-log-proxy-service-config` |
| Secret (API keys and encryption key) | `firefoundry-core-log-proxy-service-secret` |
| PersistentVolumeClaim (buffer) | `firefoundry-core-log-proxy-service-buffer` |
| HorizontalPodAutoscaler | only if `autoscaling.enabled: true` |
| Ingress | only if `ingress.enabled: true` |

### Key Values

All paths are relative to the `log-proxy-service:` block in `firefoundry-core` values.

| Value | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Deploy the service |
| `replicaCount` | `1` | Replicas. Keep this at 1 (see [Scaling](#scaling)). |
| `image.tag` | `0.1.1` | Container image tag. Use a `0.2.0` image for the features this documentation describes. |
| `configMap.data.*` | see below | Non-secret environment variables. Every key becomes an env var, so you can add any variable from the [Reference](./reference.md#configuration). |
| `configMap.data.OTLP_LOGS_ENDPOINT` | `""` | OTLP/HTTP logs URL. Empty means no export. |
| `secret.data.ADMIN_API_KEY` | `changeme-admin-api-key` | Admin API key. **Change it.** |
| `secret.data.SEARCH_API_KEY` | `changeme-search-api-key` | Search API key. **Change it.** |
| `secret.data.WS_API_KEY` | `changeme-ws-api-key` | WebSocket key. **Change it.** |
| `secret.data.ENCRYPTION_KEY` | `auto` | `auto` generates a random 32-byte key on first install and keeps it across upgrades. Or supply your own base64 32-byte key. |
| `persistence.enabled` | `true` | Mount a PVC for the buffer and search index |
| `persistence.size` | `10Gi` | PVC size |
| `persistence.accessMode` | `ReadWriteOnce` | PVC access mode |
| `persistence.mountPath` | `/var/log-proxy/buffer` | Must match `BUFFER_DIR` |
| `service.http.port` / `service.grpc.port` / `service.websocket.port` | `3000` / `50051` / `8081` | ClusterIP ports |
| `resources` | requests 100m / 256Mi, limits 500m / 1Gi | Container resources |
| `global.externalAccess` | `false` | Not exposed outside the cluster by default |

The default ConfigMap data is:

```yaml
configMap:
  data:
    PORT: "3000"
    GRPC_PORT: "50051"
    WS_PORT: "8081"
    LOG_LEVEL: "info"
    BUFFER_DIR: "/var/log-proxy/buffer"
    OTLP_LOGS_ENDPOINT: ""
```

In `firefoundry-core`, the pod also receives the shared platform ConfigMaps and Secrets through `global.envFrom`, including the telemetry configuration the proxy uses for its own telemetry events. The service does not use the shared database settings.

### Container

- The image runs Bun as a non-root user (UID/GID 1001). The chart sets `runAsNonRoot` and `fsGroup: 1001` so the buffer volume is writable.
- It exposes ports 3000 (HTTP), 50051 (gRPC) and 8081 (WebSocket).
- On `SIGTERM`/`SIGINT` the service shuts down gracefully. It stops gRPC ingestion, seals the buffer and tries a final flush. Any segments it cannot export stay on the PVC and are exported after the next start.

## Configuration

### Enabling Export

Point the proxy at an OTLP/HTTP logs receiver, such as an OpenTelemetry Collector with the `otlphttp` receiver:

```yaml
log-proxy-service:
  configMap:
    data:
      OTLP_LOGS_ENDPOINT: "http://otel-collector.<namespace>.svc.cluster.local:4318/v1/logs"
```

The exporter sends OTLP **JSON** with no authentication headers. Use an in-cluster collector as the endpoint, and let the collector handle authentication to your final backend (Azure Monitor, Google Cloud Logging, CloudWatch, Datadog, Loki and so on). The service has code for those vendor backends, but it cannot be configured yet.

### Buffer Sizing

The buffer directory holds both the NDJSON segments and the SQLite search index (7 days of metadata). The in-app buffer cap `BUFFER_MAX_TOTAL_SIZE` defaults to 10 GiB, the same as the default PVC size. Because the search index shares the volume, the disk can fill before the cap is reached. Set the cap well below the PVC size:

```yaml
log-proxy-service:
  persistence:
    size: 20Gi
  configMap:
    data:
      BUFFER_DIR: "/var/log-proxy/buffer"
      BUFFER_MAX_TOTAL_SIZE: "10737418240"   # 10 GiB cap on a 20 GiB volume
      BUFFER_MAX_FILE_SIZE: "104857600"      # 100 MiB segments
```

Size the buffer to cover the backend outage you want to survive at your peak log rate, remembering that each log is stored once **per matching stream**.

Without an exporter (`OTLP_LOGS_ENDPOINT` empty), nothing leaves the buffer. It grows until it reaches the cap. Past the high-water mark new logs start being shed, and at the cap the oldest segments are evicted. That is fine for local development but not for production.

### Flush Tuning

| Goal | Setting |
|------|---------|
| Lowest latency to backend | `BUFFER_MIN_BATCH_SIZE: "1"` (default), `BUFFER_FLUSH_INTERVAL_MS: "1000"` |
| Fewer, larger export requests | Raise `BUFFER_MIN_BATCH_SIZE` (for example `"500"`) and keep `BUFFER_MAX_WAIT_MS` as the latency bound |
| Earlier backpressure signal | Lower `BUFFER_HIGH_WATERMARK` (for example `"0.7"`) |

### Stream Configuration

Streams are managed at runtime through the admin API and are **held in memory only**. They are lost on every pod restart, upgrade or reschedule. Keep your stream definitions in version control and re-apply them after each start with a small script or a post-deploy job:

```bash
for f in streams/*.json; do
  curl -s -o /dev/null -X POST http://localhost:3000/admin/streams \
    -H "X-API-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d @"$f"
done
curl -s http://localhost:3000/admin/streams -H "X-API-Key: $ADMIN_KEY" | jq '.streams[].name'
```

(The `POST` responses return HTTP 400 in 0.2.0 even on success. See [Known Issues](#known-issues). Rely on the list call to confirm.)

## Health Checks

| Endpoint | Meaning | Chart usage |
|----------|---------|-------------|
| `GET /health` (port 3000) | The HTTP server is up | `livenessProbe` (initial delay 30s, period 10s) |
| `GET /ready` (port 3000) | Pipeline, buffer and search index are initialized. Returns `503` until then. | Not used by default. The chart's `readinessProbe` also calls `/health`. |
| `Health` RPC (port 50051) | The gRPC server is up | Manual / client checks |
| `GET /status` | Version, uptime and pipeline counters | Dashboards / manual |

To make readiness stricter, point the readiness probe at `/ready`:

```yaml
log-proxy-service:
  readinessProbe:
    httpGet:
      path: /ready
      port: 3000
    initialDelaySeconds: 15
    periodSeconds: 5
```

## Scaling

Run **one replica**, which is the chart default. Scaling out is not supported yet:

- Each replica has its own disk buffer and search index. A `ReadWriteOnce` PVC cannot be shared across nodes, and search results would be split between replicas.
- Streams are per-process and in memory, so an admin call reaches only one replica.
- WebSocket subscribers see only the logs that pass through their replica.

The chart includes an optional HPA (`autoscaling.enabled`), but do not enable it until these limitations are addressed. Scale vertically instead: raise `resources.limits` and give the PVC faster storage. Rolling updates with an RWO volume can stall if the new pod lands on a different node. If that happens, delete the old pod or use a node-local storage class.

## Security

- **Change the default API keys.** The chart ships placeholder values (`changeme-*`). If `ADMIN_API_KEY` is unset entirely, the admin, search and WebSocket APIs are **unauthenticated**.
- **Separate keys by role.** Give operators and the Console `SEARCH_API_KEY` or `WS_API_KEY` for read access, and keep `ADMIN_API_KEY` for stream and exporter changes.
- **The ingestion port is unauthenticated.** Any in-cluster client that can reach port 50051 can submit logs, including with `trusted_source: true`, which bypasses redaction and encryption. Keep `global.externalAccess: false`, keep the ingress disabled, and restrict access with Kubernetes NetworkPolicies if your threat model requires it.
- **No TLS in the service.** All three ports are plaintext. Use your mesh or ingress for TLS if the traffic leaves a trusted network.
- **Protect the encryption key.** The key in `firefoundry-core-log-proxy-service-secret` (`ENCRYPTION_KEY`) is the only way to read encrypted messages and payloads. Back it up. If it is lost, encrypted data cannot be recovered, and if it leaks, encryption provides no protection. With `ENCRYPTION_KEY: auto`, the chart keeps the existing key on upgrade. Deleting the Secret generates a new key.
- **Redaction is best-effort.** It is regex-based and may miss unusual formats, or over-redact (the phone pattern can match other 10-digit numbers). Add `customPatterns` and `sensitiveFields` for your own data shapes. The search index never stores attribute keys that look sensitive.
- **The buffer holds processed data.** Segments on the PVC contain the redacted (and, where configured, encrypted) logs. Treat the volume as sensitive.

## Monitoring

### Prometheus Metrics

`GET /metrics` on port 3000 serves Prometheus text format. In 0.2.0 only these series are updated. The remaining `log_proxy_*` counters and histograms are declared but stay at zero:

| Metric | Type | Description |
|--------|------|-------------|
| `log_proxy_buffer_size_bytes` | gauge | Bytes in the disk buffer |
| `log_proxy_buffer_segments` | gauge | Buffer segments on disk |
| `log_proxy_buffer_backpressure_state` | gauge | 0 = normal, 1 = pressure, 2 = critical |
| `log_proxy_exporter_healthy{exporter,type}` | gauge | 1 if the exporter reports healthy |
| `log_proxy_grpc_active_streams` | gauge | Open `Ingest` streams |
| `log_proxy_ws_connections_active` | gauge | Connected WebSocket clients |
| `log_proxy_ws_subscriptions_active` | gauge | Clients with an active subscription |

For throughput and error counts, poll `GET /status` (`grpc.totalReceived`, `pipeline.processingErrors`, `exporters.totalFailed` and so on) and `GET /admin/buffer`.

### What to Watch

| Signal | Healthy | Investigate when |
|--------|---------|------------------|
| `log_proxy_buffer_backpressure_state` | 0 | Any non-zero value. Logs are being shed. |
| `log_proxy_buffer_segments` / `buffer_size_bytes` | Near zero, draining | Growing steadily. The export is failing or no exporter is configured. |
| `/status` → `exporters.totalFailed` | Flat | Increasing |
| `/status` → `pipeline.processingErrors` | 0 | Increasing, for example because of an encryption key mismatch |
| `/admin/buffer` → `logsAcknowledged` vs `logsWritten` | Tracking closely | Diverging |

### Telemetry Events

The proxy emits its own operational events to the platform Telemetry Service: `log.ingestion.batch`, `log.pipeline.processed`, `log.buffer.write`, `log.export.batch` and `log.redaction.applied`. When a producer sends `x-trace-id` / `x-span-id` headers, these events join that caller's trace. Telemetry is fire-and-forget and never blocks ingestion.

## Known Issues

These affect version 0.2.0:

| Issue | Impact | Workaround |
|-------|--------|------------|
| `POST /admin/streams`, `PUT /admin/streams/{id}` and `PUT /admin/streams/{id}/enable` return `400 VALIDATION_ERROR` (`"on": "response"`) | The change **is applied**, but the response looks like a failure | Confirm with `GET /admin/streams` |
| `GET /admin/streams/{id}` returns `400` for existing streams | Cannot fetch one stream's full configuration | Use `GET /admin/streams` (summary view) and keep full definitions in version control |
| `GET /admin/exporters` returns `400` when an exporter is registered | Cannot list exporters | Use `GET /admin/exporters/otlp-default` |
| Streams are not persisted | Custom streams vanish on restart | Re-apply after every start (see [Stream Configuration](#stream-configuration)) |
| Search index is keyed by log `id` | Entries with a missing or duplicate `id` overwrite each other in search. Logs matching several streams appear once. | Always send a unique `id` |
| Most Prometheus counters stay at 0 | Throughput is not visible in Prometheus | Use `/status` |
| A WebSocket client that hits the 5,000-message queue limit stops receiving until its socket signals drain | Long-running live tails may stall | Reconnect the client, and use narrow filters |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Pod crash-loops with `Configuration validation failed` | Invalid env value (non-numeric port or size, unknown `LOG_LEVEL`, bad `NODE_ENV`) | Fix the value in `configMap.data`. The log names the offending field. |
| Pod fails at startup with `Encryption key must be 32 bytes` | `ENCRYPTION_KEY` is not a base64-encoded 32-byte value | Set it to `auto`, or generate one with `openssl rand -base64 32` |
| Pod stuck `Pending` / `Multi-Attach error` on rollout | RWO PVC still attached to the old pod on another node | Delete the old pod, or schedule the pod onto the same node |
| `401 UNAUTHORIZED` from search or admin | Missing or wrong `X-API-Key`. Search uses `SEARCH_API_KEY` if set, otherwise `ADMIN_API_KEY`. | Read the right key from the Secret |
| WebSocket upgrade returns `401` | Key missing from `?token=`, `Authorization: Bearer` or `X-API-Key` | Pass `WS_API_KEY` (or the admin key if it is unset) |
| gRPC client cannot connect, or plain `curl` gets no response | Client using HTTP/1.1, or TLS against a plaintext port | Use HTTP/2 cleartext: `buf curl --http2-prior-knowledge`, or a Connect client with `httpVersion: '2'`. `grpcurl` needs `-plaintext` and `-proto`, because reflection is not enabled. |
| Buffer grows and never drains; `/admin/exporters/otlp-default` returns 404 | `OTLP_LOGS_ENDPOINT` is empty, so no exporter is registered | Set the endpoint and restart. Buffered segments are exported on the next start. |
| Buffer grows and never drains; exporter exists | The export is failing (endpoint down, or HTTP error from the collector), **or** a stream lists an exporter ID that does not exist. One failing target blocks the whole segment. | Check the pod logs for `[OtlpExporter:otlp-default] Export failed` or `Exporter not found`, then check the `lastError` field on `GET /admin/exporters/otlp-default`. Fix the endpoint or the stream's `exporters` list. |
| Collector rejects batches with HTTP 400 | The OTLP collector enforces W3C trace and span IDs, and producers send free-form `trace_id` values | Send 32-hex-character trace IDs and 16-hex-character span IDs, or omit them |
| `backpressure: true` in responses and logs missing downstream | Buffer usage is at or above `BUFFER_HIGH_WATERMARK`. About 50% (pressure) or 90% (critical) of logs are being dropped. | Fix the export path so the buffer drains, raise `BUFFER_MAX_TOTAL_SIZE` and the PVC size, and make producers honor `suggested_delay_ms` |
| Logs appear twice in the backend or live tail | The log matches more than one stream (for example `all-logs` plus a custom stream) | Expected fan-out. Filter on the `stream_id` attribute, or disable `all-logs` and cover producers with your own streams. |
| Sensitive text not redacted | Its pattern is off for the matching stream (for example `ipAddresses` is off in `all-logs`), the payload's content type is not text-like, or the entry had `trusted_source: true` | Enable the pattern, add a `customPatterns` entry or `sensitiveFields` key, and set a text `payload_content_type` |
| `processingErrors` rising; logs for one stream missing | The stream's `encryption.keyId` does not match `ENCRYPTION_KEY_ID` | Use the service key ID (default `default`) in the stream |
| Custom streams gone after a restart | Streams are in memory | Re-apply them (see [Stream Configuration](#stream-configuration)) |
| Search returns fewer logs than were sent | Missing or duplicate `id`, logs older than 7 days, or logs dropped under backpressure | Send unique IDs, and query the backend for older data |

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Overview](./README.md)
- [firefoundry-core Chart Reference](../../../../ff_local_dev/chart-reference.md)
- [Platform Operations](../../operations.md)
