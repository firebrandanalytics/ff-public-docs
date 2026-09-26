# Telemetry Service: Operations

How to make sure telemetry is available to your application, reach the service from a bundle, and fix common problems when reading or sending telemetry.

## Enabling the Service

The Telemetry Service is part of the `firefoundry-core` Helm chart and is **enabled by default**:

```yaml
telemetry-service:
  enabled: true
```

With it enabled, the broker and other platform services send telemetry automatically. There is nothing to configure in your bundle to capture broker, LLM, and tool-call telemetry.

The core chart publishes the service addresses in a shared ConfigMap, `<release>-telemetry-config` (`firefoundry-core-telemetry-config` for a release named `firefoundry-core`):

| Variable | Default value |
|----------|---------------|
| `TELEMETRY_SERVICE_HTTP_URL` | `http://firefoundry-core-telemetry-service:3000` (query API) |
| `TELEMETRY_SERVICE_INGEST_URL` | `http://firefoundry-core-telemetry-service:50051` (ingestion API) |

Platform services receive these automatically. Storage, database credentials, sizing, and retention are managed by your environment administrator.

## Reaching the Service from a Bundle

You only need this if your bundle queries telemetry or sends its own events.

Agent bundles are deployed with their own chart and do not get the telemetry variables automatically. Add the shared ConfigMap through the `agent-bundle` chart's `envFrom` value:

```yaml
envFrom:
  - configMapRef:
      name: firefoundry-core-telemetry-config
```

Or set the URL yourself. From a pod in the same namespace, the short name `firefoundry-core-telemetry-service` works. From another namespace, use `http://firefoundry-core-telemetry-service.<namespace>.svc.cluster.local:3000` (or `:50051`).

To verify, run this from the bundle's pod:

```bash
kubectl exec -n ff-dev deploy/<your-bundle> -- \
  sh -c 'curl -s "$TELEMETRY_SERVICE_HTTP_URL/ready"'
```

You should get `{"status":"ready"}`. If `curl` is not in your image, make the same request from your bundle code at startup and log the result.

## Limits

| Limit | Default | Applies to |
|-------|---------|------------|
| Events per `IngestBatch` call | 100 | Sending your own events |
| Payload size per event | 10 MB | Sending your own events |
| JSON nesting depth | 100 levels | Sending your own events |
| Results per `GET /events` call | 100 (default 50) | Queries; page with `offset` |
| Retention | Set by your environment administrator, commonly about 30 days | All telemetry |

Your environment administrator can change the ingestion limits.

## Security

- **No authentication.** Any workload that can reach ports `3000` or `50051` can read every event or write new ones. The service is `ClusterIP`-only with no ingress by default. Keep it that way, and ask your administrator for NetworkPolicies if you need to restrict which workloads can reach it.
- **Payloads are sensitive.** Telemetry holds full prompts, model responses, and tool arguments. Anything your bundle sends to a model ends up in telemetry, so handle it like application data.
- **Custom events.** Do not include secrets, credentials, or data you would not want visible to other in-cluster workloads.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| No telemetry at all for your requests | Telemetry service disabled, or not ready | Check `telemetry-service.enabled` and `curl .../ready`. A `503` means the service is starting or unhealthy; contact your environment administrator if it persists. |
| A trace is missing its most recent events | Events are written shortly after they are sent | Wait a second or two and query again. |
| Old requests are gone | They have passed the retention window | Query sooner, or export telemetry you need to keep. |
| `trace_id` query returns nothing | Wrong ID | For broker telemetry, the trace ID is the broker request ID. Find it with `ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>` or `GET /events?layer=broker`. |
| `GET /event/{id}` returns `500` | The ID is not a UUID | Use the `eventId` exactly as returned by `/events`. |
| `400 partition_key must be a Monday in UTC` | Wrong week value | Use the `partitionKey` returned with the event, or omit the parameter. |
| `POST /events/batch` returns `404` | Your environment runs an older service version | Fetch events individually with `GET /event/{eventId}`. |
| Bundle cannot resolve `TELEMETRY_SERVICE_*` | Variables not injected into the bundle | Add the `envFrom` entry shown in [Reaching the Service from a Bundle](#reaching-the-service-from-a-bundle). |
| `IngestBatch` fails with `Batch size N exceeds maximum` | More than 100 events in one call | Send smaller batches. |
| Per-event `Invalid JSON payload` | Payload bytes are not UTF-8 JSON | Send `JSON.stringify(...)` output encoded as UTF-8 (base64 in the JSON encoding). |
| Per-event `partition_key ... does not match created_at week` | Your code computed the wrong week | Leave `partitionKey` unset. |
| Your events are accepted but never show up | Non-UUID `eventId` | Always use `crypto.randomUUID()` (or leave `eventId` empty). |
| Native gRPC client cannot connect to `:50051` | The service speaks Connect over HTTP/1.1 | Use a Connect or gRPC-Web client, or JSON over HTTP. |
| `ff-telemetry-read` cannot connect | Missing or wrong database settings | See [`ff-telemetry-read` configuration](../../../sdk/cli-tools/ff-telemetry-read.md#configuration). Ask your environment administrator for read credentials. |

## Related

- [Telemetry Service overview](./README.md)
- [Reference](./reference.md)
- [Monitoring & Debugging guide](../../../sdk/agent_sdk/guides/monitoring-debugging.md)
- [Local Development Troubleshooting](../../../local-development/troubleshooting.md)
