# Log Proxy Service — Operations

How to enable and configure the Log Proxy for your app, verify it, the limits to design around, and how to troubleshoot from the caller side.

## Enabling the Service

The Log Proxy is an **opt-in** dependency of `firefoundry-core` and is disabled by default. Enable it in your environment's values:

```yaml
log-proxy-service:
  enabled: true
```

With the default release name, your bundles reach it in-cluster at `firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local` (gRPC ingestion on 50051, HTTP search and stream APIs on 3000, live tail on 8081). It is not exposed outside the cluster by default.

## Settings an App Team Uses

All paths are under the `log-proxy-service:` block of your `firefoundry-core` values.

| Value | Default | When to change it |
|-------|---------|-------------------|
| `enabled` | `false` | Set to `true` to deploy the proxy |
| `configMap.data.OTLP_LOGS_ENDPOINT` | `""` | Set to your OTLP/HTTP logs URL to forward logs to a backend. Empty means nothing is forwarded. |
| `secret.data.ADMIN_API_KEY` | placeholder (`changeme-...`) | **Change it.** Needed to manage streams. |
| `secret.data.SEARCH_API_KEY` | placeholder | **Change it.** Give it to people and tools that search logs. |
| `secret.data.WS_API_KEY` | placeholder | **Change it.** Give it to people and tools that live-tail logs. |

Everything else (storage, resources, image and encryption key management) is set by your environment administrator.

### Routing to your own backend

The proxy forwards to one OTLP/HTTP endpoint and sends OTLP **JSON** without authentication headers. The usual design is:

```
bundles ──▶ Log Proxy ──OTLP/HTTP──▶ in-cluster OpenTelemetry Collector ──▶ your backend
                                                                          (Loki, Datadog, Azure Monitor,
                                                                           Google Cloud Logging, CloudWatch, ...)
```

```yaml
log-proxy-service:
  configMap:
    data:
      OTLP_LOGS_ENDPOINT: "http://otel-collector.<namespace>.svc.cluster.local:4318/v1/logs"
```

The collector handles authentication and vendor-specific export to your final backend. The proxy cannot yet export directly to vendor backends. In the backend, logs are grouped by `service.name`, and `request_id`, `stream_id`, `tags` (comma-joined) and your attributes arrive as OTLP attributes, with `trace_id` and `span_id` on the log record.

The endpoint is environment-wide: every app using the proxy in that environment goes to the same backend. Use `service.name` or `stream_id` in the backend to separate apps.

## Managing Streams

Streams are created through the admin API and are **held in memory**. They disappear whenever the proxy restarts, upgrades or is rescheduled. Keep your stream definitions in your app's repo and re-apply them after each deploy, for example from a post-deploy job:

```bash
for f in streams/*.json; do
  curl -s -o /dev/null -X POST http://localhost:3000/admin/streams \
    -H "X-API-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d @"$f"
done
curl -s http://localhost:3000/admin/streams -H "X-API-Key: $ADMIN_KEY" | jq '.streams[].name'
```

In 0.2.0 the `POST` can return `400` even when it succeeds, so rely on the list call to confirm.

Streams are shared by everyone using the proxy in the environment. Scope your streams with `matchers.services` so they only apply to your bundles, and agree with other teams before disabling `all-logs`.

## Verifying From a Bundle

1. `GET /ready` on port 3000 returns `200 {"status":"ready"}`.
2. Send one test entry with `IngestBatch` and check `success: true` and `acceptedCount` in the response.
3. Search for its `id` with `GET /api/v1/logs/{id}` (search key required).
4. If you configured `OTLP_LOGS_ENDPOINT`, find it in your backend under your `service.name`.

## Limits and Behavior to Design Around

| Behavior | What it means for your app |
|----------|---------------------------|
| No SDK logger integration yet | Send logs with a Connect/gRPC client. Keep logging to stdout too while the service is in Preview. |
| Ingestion is unauthenticated | Anything in the cluster that can reach port 50051 can send logs, including with `trusted_source: true`. Don't rely on the proxy to authenticate producers. |
| Plaintext ports | No TLS inside the service. Traffic stays in-cluster by default. |
| Search keeps 7 days of metadata and no message text | Use live tail or your backend to read messages; use the backend for older logs. |
| Search is keyed by `id` | Always send a unique `id`, or entries overwrite each other in search. |
| Fan-out routing | A log that matches several streams is stored, streamed and exported once per stream. |
| Backpressure sheds logs | Honor `suggested_delay_ms`. Under pressure the proxy drops a share of new logs even when they are "accepted". |
| At-least-once delivery | Your backend may occasionally see duplicates. |
| Streams are in memory | Re-apply your streams after every proxy restart. |
| No decryption API | Encrypted values are ciphertext everywhere downstream. |
| Single instance | The proxy runs as one replica, so live tail and search see all logs, but there is no failover during a restart. |

## Security Checklist for Your App

- Replace the placeholder API keys, and hand out the search and WebSocket keys rather than the admin key.
- Log sensitive values as attributes with known keys, and list those keys in a stream's `sensitiveFields`.
- Add `customPatterns` for your own identifier formats; enable `ipAddresses` if IPs are sensitive in your domain (it is off in `all-logs`).
- Set a text `payload_content_type` on payloads you want redacted; binary payloads are not.
- Don't set `trusted_source: true` unless the producer's output is known to be safe.
- Treat redaction as a safety net, not a guarantee.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| gRPC client can't connect, or plain `curl` gets no response | Client is using HTTP/1.1, or TLS against a plaintext port | Use HTTP/2 cleartext: a Connect client with `httpVersion: '2'` and an `http://` URL, or `buf curl --http2-prior-knowledge`. `grpcurl` needs `-plaintext` and `-proto` because reflection is off. |
| Connection refused from the bundle | Service not enabled, or wrong namespace in the URL | Check `log-proxy-service.enabled` and the Service name `firefoundry-core-log-proxy-service` in your namespace |
| `401 UNAUTHORIZED` from search or stream APIs | Missing or wrong `X-API-Key` | Use the search key for `/api/v1/logs`, the admin key for `/admin` |
| WebSocket upgrade returns `401` | Key missing from `?token=`, `Authorization: Bearer` or `X-API-Key` | Pass the WebSocket key |
| `backpressure: true` and logs missing downstream | The proxy is under load or can't reach its backend | Honor `suggested_delay_ms`, reduce log volume (for example with stream `sampling`), and ask your administrator to check the backend connection |
| Logs searchable but never reach the backend | `OTLP_LOGS_ENDPOINT` is empty, the collector is down, or one of your streams lists an exporter other than `otlp-default` | Set the endpoint, check the collector, and use `["otlp-default"]` in your streams |
| Collector rejects batches (HTTP 400) | Free-form `trace_id` / `span_id` values | Send 32-hex trace IDs and 16-hex span IDs, or omit them |
| Logs appear twice in the backend or live tail | The log matches more than one stream | Expected fan-out. Filter on `stream_id`, or narrow your streams. |
| Sensitive text not redacted | Pattern off for the matching stream, non-text payload, or `trusted_source: true` | Enable the pattern, add a `customPatterns` or `sensitiveFields` entry, set a text `payload_content_type` |
| Logs for one custom stream missing | The stream's `encryption.keyId` doesn't match the proxy's key ID | Use `default` unless your administrator told you otherwise |
| Custom streams gone | The proxy restarted | Re-apply your streams |
| Search returns fewer logs than you sent | Missing or duplicate `id`, logs older than 7 days, or logs shed under backpressure | Send unique IDs; use the backend for older data |
| Stream create/update returns `400` with `"on": "response"` | Known 0.2.0 response issue; the change was applied | Confirm with `GET /admin/streams` |

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Overview](./README.md)
- [firefoundry-core Chart Reference](../../../../ff_local_dev/chart-reference.md)
