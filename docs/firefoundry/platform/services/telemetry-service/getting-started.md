# Telemetry Service — Getting Started

The Telemetry Service runs in the background, so "getting started" means two things:

- **Part A** — inspecting the telemetry recorded for a request (what most developers and operators need)
- **Part B** — emitting telemetry from a producer service (for platform service authors)

If you only want to see what the broker and LLMs did for an agent run, start with the [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) CLI — it is the most convenient tool for broker request, LLM, and tool-call telemetry. The steps below use the service's own HTTP API, which works for any producer's events.

## Prerequisites

- A running FireFoundry deployment with the telemetry service enabled (it is enabled by default in `firefoundry-core`)
- `kubectl` access to the namespace where FireFoundry core is installed (`ff-dev` in the local-development conventions)
- `curl` and `jq`

The service is `ClusterIP`-only and has no ingress by default. For local work, port-forward both ports:

```bash
kubectl port-forward svc/firefoundry-core-telemetry-service -n ff-dev 3000:3000 50051:50051
```

From inside the cluster, use the service DNS name instead, e.g. `http://firefoundry-core-telemetry-service.<namespace>.svc.cluster.local:3000`. In-cluster workloads also receive the addresses as `TELEMETRY_SERVICE_HTTP_URL` and `TELEMETRY_SERVICE_INGEST_URL`.

> Some features below (`partition_key`, `POST /events/batch`) require service version 0.3.0 or later. See [Version compatibility](./operations.md#version-compatibility).

## Part A: Inspect Telemetry for a Request

### Step 1: Check the Service Is Ready

```bash
curl -s http://localhost:3000/ready
```

```json
{ "status": "ready" }
```

A `503` with `{"status":"not ready", ...}` means the service is starting or its current/next weekly partitions are missing — see [Operations → Troubleshooting](./operations.md#troubleshooting).

`/info` shows the running configuration:

```bash
curl -s http://localhost:3000/info
```

```json
{
  "service": "ff-telemetry-shredder",
  "version": "0.1.0",
  "environment": "production",
  "shredStrategy": "size:1024"
}
```

### Step 2: List Recent Events

`GET /events` returns event metadata (no payloads), newest first. Filter by `service`, `layer`, or failures only:

```bash
# 20 most recent events
curl -s "http://localhost:3000/events?limit=20" | jq '.events[] | {eventId, traceId, service, layer, error, createdAt}'

# Only failed events from one producer
curl -s "http://localhost:3000/events?service=ff-broker&error=true&limit=20" | jq '.events[] | {eventId, traceId, layer}'
```

```json
{
  "eventId": "6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11",
  "traceId": "trace-7f3a",
  "service": "ff-broker",
  "layer": "LLMResponse",
  "error": false,
  "createdAt": "2026-06-30T14:02:11.482Z"
}
```

Use `offset` to page through results. `limit` is capped at 100.

### Step 3: Pull Every Event in a Trace

Once you have a `traceId`, fetch the whole run. Trace queries return events in chronological order:

```bash
TRACE=trace-7f3a
curl -s "http://localhost:3000/events?trace_id=$TRACE&limit=100" \
  | jq '.events[] | {createdAt, service, layer, spanId, parentSpanId, error, payloadSize}'
```

This gives you the shape of the run: which services took part, which step failed, and how the spans nest.

### Step 4: Read an Event's Full Payload

`GET /event/{eventId}` returns the event with its reconstructed JSON payload:

```bash
curl -s http://localhost:3000/event/6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11 | jq .
```

```json
{
  "event": {
    "partitionKey": "2026-06-29",
    "eventId": "6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11",
    "traceId": "trace-7f3a",
    "spanId": "span-2",
    "parentSpanId": "span-1",
    "layer": "LLMResponse",
    "service": "ff-broker",
    "environment": "production",
    "error": false,
    "payloadSize": 18234,
    "nodeCount": 37,
    "createdAt": "2026-06-30T14:02:11.482Z",
    "meta": null
  },
  "payload": { "...": "the original JSON document" },
  "reconstruction": { "nodesFetched": 37, "durationMs": 4.2, "cached": false }
}
```

A second request for the same event is typically served from the document cache (`"cached": true`).

### Step 5: Fetch Several Payloads at Once

To load payloads for every event in a trace without one request per event, use `POST /events/batch`:

```bash
IDS=$(curl -s "http://localhost:3000/events?trace_id=$TRACE&limit=100" | jq -c '[.events[].eventId]')

curl -s -X POST http://localhost:3000/events/batch \
  -H 'Content-Type: application/json' \
  -d "{\"eventIds\": $IDS}" \
  | jq '.results[] | select(. != null) | {layer: .event.layer, payload}'
```

Results are returned in the same order as `eventIds`; an ID that is not found yields `null` in that position.

### Step 6: Narrow Queries to One Week

Every query accepts an optional `partition_key` — the Monday (UTC) of the week, in `YYYY-MM-DD` form. When you know roughly when something happened, pass it to scan a single week:

```bash
curl -s "http://localhost:3000/events?trace_id=$TRACE&partition_key=2026-06-29"
curl -s "http://localhost:3000/event/6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11?partition_key=2026-06-29"
```

A value that is not a valid Monday returns `400` (`partition_key must be a Monday in UTC`).

## Part B: Emit Telemetry from a Producer Service

This part is for authors of platform services that produce telemetry. Agent bundle code does not need to do this.

### Step 1: Understand the Protocol

Ingestion is a single Protobuf RPC, `firefoundry.telemetry.v1.TelemetryIngestionService/IngestBatch`, served on port `50051` using the [Connect](https://connectrpc.com/) protocol over HTTP/1.1. You can call it with a generated Connect client or with plain HTTP + JSON. See [Reference → Ingestion API](./reference.md#ingestion-api) for the message definitions.

### Step 2: Send a Test Event with curl

With the Connect protocol, a unary RPC is a `POST` of the JSON-encoded request. Protobuf `bytes` fields (`payload`, `meta`) are base64-encoded, and `int64` fields may be sent as strings:

```bash
PAYLOAD=$(printf '%s' '{"model":"example-model","messages":[{"role":"user","content":"hello"}]}' | base64 | tr -d '\n')
EVENT_ID=$(uuidgen | tr 'A-Z' 'a-z')
NOW_MS=$(($(date +%s) * 1000))

curl -s -X POST \
  http://localhost:50051/firefoundry.telemetry.v1.TelemetryIngestionService/IngestBatch \
  -H 'Content-Type: application/json' \
  -d "{
    \"events\": [{
      \"eventId\": \"$EVENT_ID\",
      \"traceId\": \"getting-started-trace\",
      \"spanId\": \"span-1\",
      \"layer\": \"BotRequest\",
      \"service\": \"my-producer\",
      \"environment\": \"dev\",
      \"payload\": \"$PAYLOAD\",
      \"createdAtMs\": \"$NOW_MS\"
    }]
  }"
```

```json
{
  "ingestedCount": 1,
  "rootHashes": ["q0lE2c9m...base64 BLAKE3 hash..."]
}
```

If any event fails validation, the response includes an `errors` map keyed by the event's index in the batch, and that event's root hash is 32 zero bytes:

```json
{ "ingestedCount": 0, "rootHashes": ["AAAAAAAA..."], "errors": { "0": "Invalid JSON payload" } }
```

### Step 3: Confirm the Event Was Stored

The RPC returns once events are queued; they are written to the database on the next batch flush (within about a second with default settings). Then query the trace:

```bash
curl -s "http://localhost:3000/events?trace_id=getting-started-trace" | jq '.events[] | {eventId, layer, nodeCount}'
curl -s "http://localhost:3000/event/$EVENT_ID" | jq .payload
```

### Step 4: Use a Generated Client

For production producers, generate TypeScript types and a Connect client from `proto/firefoundry/telemetry/v1/telemetry.proto` (the service itself uses `buf generate` with `protoc-gen-es` and `protoc-gen-connect-es`), then call it through a Connect transport:

```typescript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { TelemetryIngestionService } from "./gen/firefoundry/telemetry/v1/telemetry_connect.js";
import { TelemetryEvent } from "./gen/firefoundry/telemetry/v1/telemetry_pb.js";

const transport = createConnectTransport({
  baseUrl: process.env.TELEMETRY_SERVICE_INGEST_URL!, // e.g. http://firefoundry-core-telemetry-service:50051
  httpVersion: "1.1",
});
const client = createPromiseClient(TelemetryIngestionService, transport);

const encoder = new TextEncoder();
const res = await client.ingestBatch({
  events: [
    new TelemetryEvent({
      eventId: crypto.randomUUID(),
      traceId,
      spanId,
      parentSpanId,
      layer: "LLMResponse",
      service: "my-producer",
      environment: "production",
      error: false,
      payload: encoder.encode(JSON.stringify(responseBody)),
      createdAtMs: BigInt(Date.now()),
    }),
  ],
});

if (Object.keys(res.errors).length > 0) {
  console.warn("Some telemetry events were rejected", res.errors);
}
```

### Producer Guidelines

- **Batch your events.** Send up to 100 events per call (the default `MAX_BATCH_SIZE`); larger batches are rejected outright.
- **Always set a UUID `eventId`.** Uniqueness is enforced per week on `(partition_key, event_id)`; the ID column is a UUID type.
- **Propagate `traceId` and span IDs** from the incoming request so your events join the rest of the run.
- **Keep payloads under 10 MB** and nesting under 100 levels (defaults).
- **Treat telemetry as fire-and-forget.** Do not block user-facing work on the ingestion call, and tolerate failures.
- **Omit `partitionKey`** unless you have a reason to set it; the service derives it from `createdAtMs`. If you do set it, it must be the Monday of that timestamp's UTC week.

## Next Steps

- [Concepts](./concepts.md) — How shredding, deduplication, and weekly partitions work
- [Reference](./reference.md) — Every endpoint, message, and configuration variable
- [Operations](./operations.md) — Deployment, partition maintenance, and troubleshooting
- [`ff-telemetry-read` CLI](../../../sdk/cli-tools/ff-telemetry-read.md) — Interactive inspection of broker, LLM, and tool-call telemetry
