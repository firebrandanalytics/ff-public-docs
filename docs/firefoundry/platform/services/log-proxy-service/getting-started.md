# Log Proxy Service — Getting Started

This walkthrough enables the Log Proxy, sends logs to it from a TypeScript agent bundle, shows the redaction that was applied, searches the logs, adds a stricter stream for your bundle, and tails logs live.

## Prerequisites

- A FireFoundry environment deployed with the `firefoundry-core` Helm chart, and `kubectl` access to its namespace
- An agent bundle or Node/Bun app in the same cluster (for Step 3)
- A copy of the service's protobuf definition saved as `log_proxy.proto` (see [Reference — Protobuf Definition](./reference.md#protobuf-definition)). The server does not enable gRPC reflection, so clients need the schema.
- Optional: [`buf`](https://buf.build/docs/installation) for calling the gRPC API from the command line (Step 4), plus `curl` and `jq`
- Optional: an OTLP/HTTP log endpoint, such as an OpenTelemetry Collector on port 4318, if you want logs forwarded to a backend

Throughout this guide, `<namespace>` is the namespace of your `firefoundry-core` release. With the default release name, the Kubernetes Service is `firefoundry-core-log-proxy-service`.

## Step 1: Enable the Service

The Log Proxy is disabled by default. Enable it in your `firefoundry-core` values (or ask your environment administrator to):

```yaml
log-proxy-service:
  enabled: true
  configMap:
    data:
      # Optional: forward to your OTLP/HTTP logs endpoint
      OTLP_LOGS_ENDPOINT: "http://otel-collector.<namespace>.svc.cluster.local:4318/v1/logs"
  secret:
    data:
      ADMIN_API_KEY: "<choose-a-strong-admin-key>"
      SEARCH_API_KEY: "<choose-a-strong-search-key>"
      WS_API_KEY: "<choose-a-strong-websocket-key>"
```

Apply it with your usual `helm upgrade` for the `firefoundry-core` release, then wait for the pod:

```bash
kubectl -n <namespace> rollout status deploy/firefoundry-core-log-proxy-service
```

Without `OTLP_LOGS_ENDPOINT` the proxy still accepts, redacts, indexes and live-streams your logs, but nothing is forwarded to a backend. That is fine for development.

## Step 2: Connect and Check Health

Port-forward the HTTP, gRPC and WebSocket ports and load the API keys:

```bash
kubectl -n <namespace> port-forward svc/firefoundry-core-log-proxy-service 3000:3000 50051:50051 8081:8081
```

```bash
SECRET=firefoundry-core-log-proxy-service-secret
export ADMIN_KEY=$(kubectl -n <namespace> get secret $SECRET -o jsonpath='{.data.ADMIN_API_KEY}' | base64 -d)
export SEARCH_KEY=$(kubectl -n <namespace> get secret $SECRET -o jsonpath='{.data.SEARCH_API_KEY}' | base64 -d)
export WS_KEY=$(kubectl -n <namespace> get secret $SECRET -o jsonpath='{.data.WS_API_KEY}' | base64 -d)

curl -s http://localhost:3000/ready
# {"status":"ready","timestamp":"2026-03-10T12:00:00.000Z"}
```

## Step 3: Send Logs From Your Bundle

There is no built-in FireFoundry SDK logger for the proxy yet, so your bundle sends logs with a Connect client generated from `log_proxy.proto`. Generate TypeScript stubs with `@bufbuild/protoc-gen-es` and `@connectrpc/protoc-gen-connect-es` (the v1.x plugin family), and add `@bufbuild/protobuf`, `@connectrpc/connect` and `@connectrpc/connect-node` to your bundle.

A small batching logger is enough for most bundles:

```typescript
import { Timestamp } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { LogIngestionService } from './gen/log_proxy_connect';
import { LogBatch, LogEntry, LogLevel } from './gen/log_proxy_pb';

const client = createClient(
  LogIngestionService,
  createConnectTransport({
    // In-cluster address; keep it in your bundle's configuration
    baseUrl: 'http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:50051',
    httpVersion: '2', // the ingestion port is HTTP/2 cleartext only
  }),
);

const SERVICE = 'billing-bundle';
let pending: LogEntry[] = [];
let pauseUntil = 0;

export function log(
  level: LogLevel,
  message: string,
  fields: { attributes?: Record<string, string>; tags?: string[]; traceId?: string; requestId?: string } = {},
) {
  pending.push(
    new LogEntry({
      id: crypto.randomUUID(), // always unique
      timestamp: Timestamp.now(),
      level,
      message,
      service: SERVICE,
      ...fields,
    }),
  );
}

async function flush() {
  if (pending.length === 0 || Date.now() < pauseUntil) return;
  const entries = pending;
  pending = [];
  try {
    const res = await client.ingestBatch(new LogBatch({ batchId: crypto.randomUUID(), entries }));
    if (res.backpressure) pauseUntil = Date.now() + res.suggestedDelayMs;
  } catch (err) {
    console.error('log-proxy send failed', err); // don't let logging break the bundle
  }
}

setInterval(flush, 1000);
```

Use it anywhere in the bundle:

```typescript
log(LogLevel.INFO, 'Invoice generated', {
  attributes: { invoice_id: 'INV-77', environment: 'dev' },
  tags: ['billing'],
  requestId: 'req-1',
});
```

Keep writing to stdout as well while the service is in Preview, so you still have container logs if the proxy is not deployed. High-volume producers can use the bidirectional `Ingest` stream instead (see [Reference](./reference.md#ingest-bidirectional-stream)).

## Step 4: See Redaction From the Command Line

You can also send a test batch with `buf curl`. The second entry contains an email address, a card number and a `password` attribute, all of which the default `all-logs` stream redacts:

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

buf curl --http2-prior-knowledge --schema log_proxy.proto \
  --data '{
    "batchId": "batch-001",
    "entries": [
      {
        "id": "log-0001", "timestamp": "'"$NOW"'", "level": "LOG_LEVEL_INFO",
        "message": "Invoice generated", "service": "billing-bundle",
        "attributes": { "invoice_id": "INV-77" }, "tags": ["billing"],
        "traceId": "trace-abc-123", "requestId": "req-1"
      },
      {
        "id": "log-0002", "timestamp": "'"$NOW"'", "level": "LOG_LEVEL_WARN",
        "message": "Payment failed for jane@example.com card 4111 1111 1111 1111",
        "service": "billing-bundle",
        "attributes": { "customer_id": "42", "password": "hunter2" },
        "tags": ["billing", "payments"],
        "traceId": "trace-abc-123", "requestId": "req-1"
      }
    ]
  }' \
  http://localhost:50051/firefoundry.logproxy.v1.LogIngestionService/IngestBatch
```

```json
{ "success": true, "batchId": "batch-001", "acceptedCount": 2 }
```

Fields at their default values (`rejectedCount: 0`, `backpressure: false`, `suggestedDelayMs: 0`) are omitted from the JSON output.

What was indexed, streamed and forwarded is the redacted form of the second entry:

```text
message:    Payment failed for [EMAIL_REDACTED] card [CREDIT_CARD_REDACTED]
attributes: customer_id=42, password=[REDACTED]
```

## Step 5: Search Your Logs

Search the last hour for `billing-bundle` warnings and errors:

```bash
START=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)   # macOS: date -u -v-1H +%Y-%m-%dT%H:%M:%SZ
END=$(date -u -d '+5 min' +%Y-%m-%dT%H:%M:%SZ)      # macOS: date -u -v+5M +%Y-%m-%dT%H:%M:%SZ

curl -s -X POST http://localhost:3000/api/v1/logs/search \
  -H "X-API-Key: $SEARCH_KEY" -H 'Content-Type: application/json' \
  -d '{"startTime":"'"$START"'","endTime":"'"$END"'","services":["billing-bundle"],"levels":["warn","error"]}' | jq
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

The `password` attribute is not in the index at all, because sensitive-looking keys are never indexed. The message is not returned by search; use `messageContains` to filter on it.

Other useful lookups:

```bash
# Every log for one trace
curl -s http://localhost:3000/api/v1/logs/trace/trace-abc-123 -H "X-API-Key: $SEARCH_KEY" | jq

# Counts per level over the window
curl -s -X POST http://localhost:3000/api/v1/logs/aggregate \
  -H "X-API-Key: $SEARCH_KEY" -H 'Content-Type: application/json' \
  -d '{"startTime":"'"$START"'","endTime":"'"$END"'","groupBy":"level","services":["billing-bundle"]}' | jq
```

## Step 6: Add a Stricter Stream for Your Bundle

Create a stream for `billing-bundle` errors that also redacts IP addresses and your account-number format, blanks a `customer_email` attribute, and encrypts the message:

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
        "customPatterns": [{ "name": "account", "regex": "ACCT-[0-9]{6}", "replacement": "[ACCOUNT_REDACTED]" }],
        "sensitiveFields": ["password", "customer_email"]
      },
      "encryption": { "encryptPayload": true, "encryptMessage": true, "algorithm": "aes-256-gcm", "keyId": "default" }
    },
    "exporters": ["otlp-default"],
    "enabled": true
  }'
```

> In 0.2.0 this call creates the stream but may respond with HTTP 400 `VALIDATION_ERROR` (details mention `"on": "response"`). Confirm with the list call below.

```bash
curl -s http://localhost:3000/admin/streams -H "X-API-Key: $ADMIN_KEY" | jq '.streams[] | {id, name, priority, enabled}'
```

```json
{ "id": "all-logs", "name": "All Logs", "priority": 0, "enabled": true }
{ "id": "c12e5acd-...", "name": "billing-errors", "priority": 10, "enabled": true }
```

A `billing-bundle` error now matches **both** `all-logs` and `billing-errors` and is processed once for each. The `billing-errors` copy's message leaves the proxy as `enc:v1:...` ciphertext. Streams live in memory, so keep this JSON in your repo and re-apply it after the proxy restarts.

## Step 7: Tail Logs Live

Connect to the WebSocket endpoint and subscribe. This example uses [`websocat`](https://github.com/vi/websocat), but any WebSocket client works:

```bash
websocat "ws://localhost:8081/ws/stream?token=$WS_KEY"
```

```text
< {"type":"connected","clientId":"e20c0cd4-...","timestamp":"..."}
> {"type":"subscribe","filters":{"services":["billing-bundle"],"levels":[5]}}
< {"type":"subscribed","success":true,"filters":{"services":["billing-bundle"],"levels":[5]}}
```

Log an error from your bundle and it appears immediately, once per matching stream:

```text
< {"type":"log","entry":{"id":"...","level":5,"service":"billing-bundle","message":"...","streamId":"all-logs",...}}
< {"type":"log","entry":{"id":"...","level":5,"service":"billing-bundle","message":"enc:v1:...","streamId":"c12e5acd-...",...}}
```

## Step 8: Check Your Backend

If you set `OTLP_LOGS_ENDPOINT`, your logs appear in your backend under `service.name = billing-bundle`, with `request_id`, `stream_id`, `tags` and your attributes as OTLP attributes. If they don't, see [Operations — Troubleshooting](./operations.md#troubleshooting).

## Next Steps

- [Concepts](./concepts.md): streams, redaction and delivery in more depth
- [Reference](./reference.md): the full ingestion, search, stream and live-tail APIs
- [Operations](./operations.md): configuration, limits and troubleshooting
