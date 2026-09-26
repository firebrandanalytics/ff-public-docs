# Log Proxy Service — Getting Started

This walkthrough enables the Log Proxy in a FireFoundry environment, sends it a batch of logs, shows the redaction that was applied, searches the logs, defines a custom stream, and tails logs live over WebSocket.

## Prerequisites

- A FireFoundry environment deployed with the `firefoundry-core` Helm chart, with `kubectl` access to its namespace
- [`buf`](https://buf.build/docs/installation) for calling the gRPC API from the command line (`buf curl`), or Node.js/Bun if you prefer the TypeScript client in Step 4
- `curl` and `jq`
- A local copy of the service's protobuf definition saved as `log_proxy.proto` (the full file is in the [Reference](./reference.md#protobuf-definition)). The server does not enable gRPC reflection, so clients need the schema.
- Optional: an OTLP/HTTP log endpoint, such as an OpenTelemetry Collector listening on port 4318, if you want logs forwarded to a backend

Throughout this guide, `<namespace>` is the namespace of your `firefoundry-core` release. With the default release name, the Kubernetes Service is `firefoundry-core-log-proxy-service`.

## Step 1: Enable the Service

The Log Proxy is disabled by default. Enable it in your `firefoundry-core` values:

```yaml
log-proxy-service:
  enabled: true
  configMap:
    data:
      PORT: "3000"
      GRPC_PORT: "50051"
      WS_PORT: "8081"
      LOG_LEVEL: "info"
      BUFFER_DIR: "/var/log-proxy/buffer"
      # Optional: forward to an OTLP/HTTP logs endpoint
      OTLP_LOGS_ENDPOINT: "http://otel-collector.<namespace>.svc.cluster.local:4318/v1/logs"
  secret:
    data:
      ADMIN_API_KEY: "<choose-a-strong-admin-key>"
      SEARCH_API_KEY: "<choose-a-strong-search-key>"
      WS_API_KEY: "<choose-a-strong-websocket-key>"
      ENCRYPTION_KEY: "auto"
```

Apply the change with your usual `helm upgrade` for the `firefoundry-core` release, then wait for the pod:

```bash
kubectl -n <namespace> rollout status deploy/firefoundry-core-log-proxy-service
```

If you leave `OTLP_LOGS_ENDPOINT` empty, the service still accepts, indexes and live-streams logs, but nothing is exported. Logs build up in the disk buffer until an exporter is configured (see [Operations](./operations.md#buffer-sizing)).

## Step 2: Connect and Verify Health

Port-forward the three ports:

```bash
kubectl -n <namespace> port-forward svc/firefoundry-core-log-proxy-service 3000:3000 50051:50051 8081:8081
```

In another terminal, load the admin key from the chart-managed Secret and check the service:

```bash
export ADMIN_KEY=$(kubectl -n <namespace> get secret firefoundry-core-log-proxy-service-secret \
  -o jsonpath='{.data.ADMIN_API_KEY}' | base64 -d)
export SEARCH_KEY=$(kubectl -n <namespace> get secret firefoundry-core-log-proxy-service-secret \
  -o jsonpath='{.data.SEARCH_API_KEY}' | base64 -d)

curl -s http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-10T12:00:00.000Z"}

curl -s http://localhost:3000/ready
# {"status":"ready","timestamp":"2026-03-10T12:00:00.000Z"}
```

Check the gRPC side too. The ingestion port speaks HTTP/2 without TLS, so pass `--http2-prior-knowledge`:

```bash
buf curl --http2-prior-knowledge --schema log_proxy.proto \
  --data '{}' \
  http://localhost:50051/firefoundry.logproxy.v1.LogIngestionService/Health
```

```json
{
  "healthy": true,
  "status": "ok",
  "timestamp": "2026-03-10T12:00:00.123Z"
}
```

## Step 3: Send a Batch of Logs

Send two entries with `IngestBatch`. The second contains an email address, a credit card number and a `password` attribute, all of which the default `all-logs` stream redacts:

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

buf curl --http2-prior-knowledge --schema log_proxy.proto \
  -H 'x-trace-id: trace-abc-123' \
  --data '{
    "batchId": "batch-001",
    "entries": [
      {
        "id": "log-0001",
        "timestamp": "'"$NOW"'",
        "level": "LOG_LEVEL_INFO",
        "message": "Invoice generated",
        "service": "billing-bundle",
        "attributes": { "invoice_id": "INV-77", "environment": "dev" },
        "tags": ["billing"],
        "traceId": "trace-abc-123",
        "requestId": "req-1"
      },
      {
        "id": "log-0002",
        "timestamp": "'"$NOW"'",
        "level": "LOG_LEVEL_WARN",
        "message": "Payment failed for jane@example.com card 4111 1111 1111 1111",
        "service": "billing-bundle",
        "attributes": { "customer_id": "42", "password": "hunter2" },
        "tags": ["billing", "payments"],
        "traceId": "trace-abc-123",
        "requestId": "req-1"
      }
    ]
  }' \
  http://localhost:50051/firefoundry.logproxy.v1.LogIngestionService/IngestBatch
```

```json
{
  "success": true,
  "batchId": "batch-001",
  "acceptedCount": 2
}
```

Fields left at their default values (`rejectedCount: 0`, `backpressure: false`, `suggestedDelayMs: 0`) are omitted from the JSON output. If `backpressure` is ever `true`, wait `suggestedDelayMs` before sending again.

> **Always set a unique `id`.** The search index is keyed by it, so entries without an ID overwrite each other in search results.

What was stored and forwarded is the redacted form of the second entry:

```text
message:    Payment failed for [EMAIL_REDACTED] card [CREDIT_CARD_REDACTED]
attributes: customer_id=42, password=[REDACTED]
```

## Step 4 (Optional): Send Logs From TypeScript

Producers normally use a Connect RPC client instead of `buf curl`. Generate TypeScript stubs from `log_proxy.proto` with `@bufbuild/protoc-gen-es` and `@connectrpc/protoc-gen-connect-es` (the v1.x plugin family), then:

```typescript
import { Timestamp } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { LogIngestionService } from './gen/log_proxy_connect';
import { LogBatch, LogLevel } from './gen/log_proxy_pb';

const transport = createConnectTransport({
  baseUrl: 'http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:50051',
  httpVersion: '2',
});
const client = createClient(LogIngestionService, transport);

const res = await client.ingestBatch(
  new LogBatch({
    batchId: crypto.randomUUID(),
    entries: [
      {
        id: crypto.randomUUID(),
        timestamp: Timestamp.now(),
        level: LogLevel.INFO,
        message: 'Order processed',
        service: 'orders-bundle',
        attributes: { order_id: 'o-981' },
        tags: ['orders'],
      },
    ],
  }),
);

if (res.backpressure) {
  await new Promise((r) => setTimeout(r, res.suggestedDelayMs));
}
```

High-volume producers should use the bidirectional `Ingest` stream, which returns one acknowledgment per request message (see [Reference](./reference.md#ingest-bidirectional-stream)).

## Step 5: Search Your Logs

Search the last hour for `billing-bundle` warnings. The search API uses `X-API-Key`, and falls back to the admin key when `SEARCH_API_KEY` is not set:

```bash
START=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)   # macOS: date -u -v-1H +%Y-%m-%dT%H:%M:%SZ
END=$(date -u -d '+5 min' +%Y-%m-%dT%H:%M:%SZ)      # macOS: date -u -v+5M +%Y-%m-%dT%H:%M:%SZ

curl -s -X POST http://localhost:3000/api/v1/logs/search \
  -H "X-API-Key: $SEARCH_KEY" -H 'Content-Type: application/json' \
  -d '{
    "startTime": "'"$START"'",
    "endTime": "'"$END"'",
    "services": ["billing-bundle"],
    "levels": ["warn", "error"]
  }' | jq
```

```json
{
  "logs": [
    {
      "id": "log-0002",
      "timestamp": "2026-03-10T12:01:00.000Z",
      "service": "billing-bundle",
      "level": "warn",
      "traceId": "trace-abc-123",
      "requestId": "req-1",
      "streamId": "all-logs",
      "tags": ["billing", "payments"],
      "attributes": { "customer_id": "42" }
    }
  ],
  "total": 1,
  "hasMore": false
}
```

The `password` attribute is missing from the index entirely, because sensitive-looking keys are never indexed. The message is not returned by search either: use `messageContains` to filter on it.

Other useful lookups:

```bash
# Every log for one trace
curl -s http://localhost:3000/api/v1/logs/trace/trace-abc-123 -H "X-API-Key: $SEARCH_KEY" | jq

# One log by ID
curl -s http://localhost:3000/api/v1/logs/log-0001 -H "X-API-Key: $SEARCH_KEY" | jq

# Counts per service over the window
curl -s -X POST http://localhost:3000/api/v1/logs/aggregate \
  -H "X-API-Key: $SEARCH_KEY" -H 'Content-Type: application/json' \
  -d '{"startTime":"'"$START"'","endTime":"'"$END"'","groupBy":"service"}' | jq
```

## Step 6: Add a Stricter Stream

Create a stream that also redacts IP addresses and a custom account-number format, and encrypts the message, for `billing-bundle` errors:

```bash
curl -s -X POST http://localhost:3000/admin/streams \
  -H "X-API-Key: $ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{
    "name": "billing-errors",
    "description": "Errors from billing, encrypted",
    "priority": 10,
    "matchers": { "services": ["billing-bundle"], "levels": [5, 6] },
    "processing": {
      "redaction": {
        "patterns": { "emails": true, "phones": true, "creditCards": true, "ssn": true, "ipAddresses": true, "apiKeys": true },
        "customPatterns": [
          { "name": "account", "regex": "ACCT-[0-9]{6}", "replacement": "[ACCOUNT_REDACTED]" }
        ],
        "sensitiveFields": ["password", "customer_email"]
      },
      "encryption": { "encryptPayload": true, "encryptMessage": true, "algorithm": "aes-256-gcm", "keyId": "default" }
    },
    "exporters": ["otlp-default"],
    "enabled": true
  }'
```

> **Known issue (0.2.0):** this call creates the stream but responds with HTTP 400 and a `VALIDATION_ERROR` whose details mention `"on": "response"`. The failure is in the service serializing its own response, not in your request. Confirm the stream exists with the list call below. See [Operations — Known Issues](./operations.md#known-issues).

```bash
curl -s http://localhost:3000/admin/streams -H "X-API-Key: $ADMIN_KEY" | jq '.streams[] | {id, name, priority, enabled}'
```

```json
{ "id": "all-logs", "name": "All Logs", "priority": 0, "enabled": true }
{ "id": "c12e5acd-...", "name": "billing-errors", "priority": 10, "enabled": true }
```

Routing is fan-out: a `billing-bundle` error now matches **both** `all-logs` and `billing-errors`, and is processed and exported once for each, with a different `stream_id`. The `billing-errors` copy's message leaves the proxy as `enc:v1:...` ciphertext.

Streams live in memory, so re-create them after a pod restart.

## Step 7: Tail Logs Live

Connect to the WebSocket endpoint, then send a subscribe message. This example uses [`websocat`](https://github.com/vi/websocat), but any WebSocket client works:

```bash
WS_KEY=$(kubectl -n <namespace> get secret firefoundry-core-log-proxy-service-secret \
  -o jsonpath='{.data.WS_API_KEY}' | base64 -d)

websocat "ws://localhost:8081/ws/stream?token=$WS_KEY"
```

```text
< {"type":"connected","clientId":"e20c0cd4-...","timestamp":"..."}
> {"type":"subscribe","filters":{"services":["billing-bundle"],"levels":[5]}}
< {"type":"subscribed","success":true,"filters":{"services":["billing-bundle"],"levels":[5]}}
```

Send another `billing-bundle` error with `buf curl` (as in Step 3, with `"level": "LOG_LEVEL_ERROR"`) and it appears immediately, once per matching stream:

```text
< {"type":"log","entry":{"id":"log-0003","level":5,"service":"billing-bundle","message":"...","streamId":"all-logs",...}}
< {"type":"log","entry":{"id":"log-0003","level":5,"service":"billing-bundle","message":"enc:v1:...","streamId":"c12e5acd-...",...}}
```

## Step 8: Check Delivery

If you configured `OTLP_LOGS_ENDPOINT`, confirm the buffer is draining:

```bash
curl -s http://localhost:3000/admin/buffer -H "X-API-Key: $ADMIN_KEY" | jq
```

When `logsAcknowledged` keeps pace with `logsWritten` and `totalSegments` stays near 0, logs are reaching the backend. If segments accumulate, see [Operations — Troubleshooting](./operations.md#troubleshooting).

## Next Steps

- [Concepts](./concepts.md): how routing, redaction, encryption and buffering fit together
- [Reference](./reference.md): the full gRPC, HTTP and WebSocket API and every environment variable
- [Operations](./operations.md): Helm values, sizing, security, monitoring and troubleshooting
