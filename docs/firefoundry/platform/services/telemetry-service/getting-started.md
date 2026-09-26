# Telemetry Service: Getting Started

This page has two parts:

- **Part A**: inspect the telemetry recorded for a request your bundle made. Most developers only need this.
- **Part B**: send your own events so they appear in the same traces. This is optional.

For everyday debugging of broker, LLM, and tool-call activity, the [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) CLI is usually the quickest route. For example, `ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>` finds the requests an entity made, and `ff-telemetry-read trace get <broker-request-id>` shows the full trace. The steps below use the service's HTTP API, which works for events from any producer, including your own.

## Prerequisites

- A FireFoundry environment with the telemetry service enabled. It is on by default in `firefoundry-core`.
- `kubectl` access to the namespace where FireFoundry core is installed (`ff-dev` in the local-development conventions).
- `curl` and `jq`.

The service is only reachable inside the cluster. From your machine, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-telemetry-service -n ff-dev 3000:3000 50051:50051
```

From code running in the cluster, use the service name instead. See [Operations → Reaching the Service from a Bundle](./operations.md#reaching-the-service-from-a-bundle).

## Part A: Inspect Telemetry for a Request

### Step 1: Check the Service Is Up

```bash
curl -s http://localhost:3000/ready
```

```json
{ "status": "ready" }
```

### Step 2: Find the Request

`GET /events` lists event metadata (without payloads), newest first. Filter by `layer`, `service`, or failures:

```bash
# Most recent broker requests
curl -s "http://localhost:3000/events?layer=broker&limit=20" \
  | jq '.events[] | {eventId, traceId, error, createdAt}'

# Only failed broker requests
curl -s "http://localhost:3000/events?layer=broker&error=true&limit=20" \
  | jq '.events[] | {eventId, traceId, createdAt}'
```

```json
{
  "eventId": "6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11",
  "traceId": "trace-7f3a",
  "error": true,
  "createdAt": "2026-06-30T14:02:11.482Z"
}
```

Use `offset` to page through results. `limit` is capped at 100.

If you already know the entity that made the request, `ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>` is a faster way to find its broker request IDs. The broker request ID is the trace ID.

### Step 3: Pull Every Event in the Trace

```bash
TRACE=trace-7f3a
curl -s "http://localhost:3000/events?trace_id=$TRACE&limit=100" \
  | jq '.events[] | {createdAt, service, layer, spanId, parentSpanId, error}'
```

Trace queries return events oldest first. The result shows which services took part, which step failed, and how the spans nest.

### Step 4: Read an Event's Payload

`GET /event/{eventId}` returns the event with its full JSON payload, such as the prompt sent to the model or the response it returned:

```bash
curl -s http://localhost:3000/event/6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11 | jq '{layer: .event.layer, payload}'
```

### Step 5: Fetch Several Payloads at Once

To load payloads for a whole trace without one request per event, use `POST /events/batch`:

```bash
IDS=$(curl -s "http://localhost:3000/events?trace_id=$TRACE&limit=100" | jq -c '[.events[].eventId]')

curl -s -X POST http://localhost:3000/events/batch \
  -H 'Content-Type: application/json' \
  -d "{\"eventIds\": $IDS}" \
  | jq '.results[] | select(. != null) | {layer: .event.layer, payload}'
```

Results come back in the same order as `eventIds`. An ID that is not found yields `null` in its position.

### Step 6: Narrow a Query to One Week

If you know roughly when something happened, pass `partition_key`, the Monday (UTC) of that week in `YYYY-MM-DD` form. The query then searches only that week, which is faster:

```bash
curl -s "http://localhost:3000/events?trace_id=$TRACE&partition_key=2026-06-29"
```

Every event includes its `partitionKey`, so you can reuse the value when you fetch payloads.

## Part B: Send Your Own Events

Your bundle can send its own events so that application-level steps, such as "document classified" or "validation failed", appear in the same trace as the platform's LLM and tool events. This is optional. The Agent SDK does not require it, and you should only add it if the extra detail helps you debug.

### Step 1: Send a Test Event

The ingestion API is one RPC, `IngestBatch`, served on port `50051` with the [Connect](https://connectrpc.com/) protocol. You can call it as plain HTTP with JSON. In the JSON encoding, `payload` and `meta` are base64-encoded JSON, and `createdAtMs` may be a string:

```bash
PAYLOAD=$(printf '%s' '{"step":"classify","label":"invoice","confidence":0.93}' | base64 | tr -d '\n')
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
      \"layer\": \"app.classify\",
      \"service\": \"my-bundle\",
      \"environment\": \"dev\",
      \"payload\": \"$PAYLOAD\",
      \"createdAtMs\": \"$NOW_MS\"
    }]
  }"
```

```json
{ "ingestedCount": 1, "rootHashes": ["..."] }
```

If an event is rejected, the response includes an `errors` map keyed by the event's index in the batch:

```json
{ "ingestedCount": 0, "rootHashes": ["..."], "errors": { "0": "Invalid JSON payload" } }
```

### Step 2: Confirm the Event Arrived

Events become queryable shortly after they are accepted, usually within a second or two:

```bash
curl -s "http://localhost:3000/events?trace_id=getting-started-trace" | jq '.events[] | {eventId, layer}'
curl -s "http://localhost:3000/event/$EVENT_ID" | jq .payload
```

### Step 3: Send Events from TypeScript

Generate a Connect client from the service's `telemetry.proto` (package `firefoundry.telemetry.v1`) with `buf generate` using `protoc-gen-es` and `protoc-gen-connect-es`, then call it through a Connect transport. Platform services use the `@firebrandanalytics/telemetry-client` package for the same purpose.

```typescript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { TelemetryIngestionService } from "./gen/firefoundry/telemetry/v1/telemetry_connect.js";
import { TelemetryEvent } from "./gen/firefoundry/telemetry/v1/telemetry_pb.js";

const transport = createConnectTransport({
  baseUrl: process.env.TELEMETRY_SERVICE_INGEST_URL!, // e.g. http://firefoundry-core-telemetry-service:50051
  httpVersion: "1.1",
});
const telemetry = createPromiseClient(TelemetryIngestionService, transport);
const encoder = new TextEncoder();

// Fire and forget: never let telemetry block or fail the user-facing work.
telemetry
  .ingestBatch({
    events: [
      new TelemetryEvent({
        eventId: crypto.randomUUID(),
        traceId,           // reuse the trace of the run this step belongs to
        spanId: crypto.randomUUID(),
        parentSpanId,
        layer: "app.classify",
        service: "my-bundle",
        environment: "production",
        error: false,
        payload: encoder.encode(JSON.stringify({ label, confidence })),
        createdAtMs: BigInt(Date.now()),
      }),
    ],
  })
  .then((res) => {
    if (Object.keys(res.errors).length > 0) console.warn("Telemetry events rejected", res.errors);
  })
  .catch((err) => console.warn("Telemetry send failed", err));
```

### Guidelines for Your Own Events

- **Always set a UUID `eventId`.** Event IDs must be UUIDs, and a non-UUID ID can cause the event to be lost silently.
- **Reuse trace IDs.** Put your events on the trace of the run they belong to so they show up next to the broker and tool events.
- **Pick a distinct `layer` and `service`.** A prefix such as `app.` keeps your events easy to filter and avoids confusion with platform layers such as `broker` or `llm`.
- **Batch.** Send up to 100 events per call. Larger batches are rejected as a whole.
- **Keep payloads under 10 MB** and JSON nesting under 100 levels.
- **Fire and forget.** Do not wait on the ingestion call in a user-facing path, and tolerate failures.
- **Leave `partitionKey` unset.** The service derives it from `createdAtMs`.
- **Mind what you record.** Anyone who can query the service can read your payloads, so do not put secrets or credentials in them.

## Next Steps

- [Concepts](./concepts.md): what is captured and how traces work
- [Reference](./reference.md): every query endpoint and the ingestion message format
- [Operations](./operations.md): enabling the service and reaching it from a bundle
- [`ff-telemetry-read` CLI](../../../sdk/cli-tools/ff-telemetry-read.md): interactive inspection of broker, LLM, and tool-call telemetry
