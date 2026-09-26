# Telemetry Service — Concepts

This page explains the mental model behind the Telemetry Service: what a telemetry event is, how events are correlated, how payloads are stored and reconstructed, and how data is partitioned and aged out.

## Producers and Consumers

The Telemetry Service sits between two groups:

- **Producers** are platform services that emit telemetry while they work. Each producer batches its events and calls the `IngestBatch` RPC on port `50051`. In a `firefoundry-core` deployment every service receives the ingestion address in the `TELEMETRY_SERVICE_INGEST_URL` environment variable (and the query address in `TELEMETRY_SERVICE_HTTP_URL`), so producers do not need per-service configuration.
- **Consumers** read telemetry back through the HTTP query API on port `3000` — tools such as the FireFoundry Console, diagnostic scripts, and operators investigating an incident.

Application code (agent bundles, bots) is normally neither: it produces telemetry indirectly, because the platform services it calls are producers.

> **About `ff-telemetry-read`:** the [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) CLI is the recommended interactive tool for broker request, LLM request, and tool-call telemetry. It reads that data directly from the telemetry PostgreSQL database (configured with `PG_*` variables) rather than through this service's HTTP API. Use the HTTP API described in these pages when you need generic events by trace, service, or layer.

## Telemetry Events

The unit of telemetry is an **event**: one JSON payload plus a small set of indexed metadata fields.

| Field | Meaning |
|-------|---------|
| `event_id` | Unique identifier for the event. Must be a UUID; if a producer leaves it empty, the service generates one. |
| `trace_id` | Identifier shared by every event in one logical run (an agent request, a workflow). |
| `span_id` / `parent_span_id` | Position of the event inside the trace, in the usual distributed-tracing sense. |
| `layer` | Kind of event within the producer — for example `BotRequest`, `LLMResponse`, or `BrokerRequest`. Free-form string chosen by the producer. |
| `service` | Name of the producing service. |
| `environment` | Optional environment label such as `production` or `staging`. |
| `error` | Boolean flag for fast filtering of failed operations. |
| `payload` | The JSON document being recorded (prompt, response, tool call, and so on). |
| `meta` | Optional arbitrary JSON metadata stored alongside the event. |
| `created_at` | Event timestamp. Producers send Unix milliseconds; if omitted, the ingestion time is used. |
| `partition_key` | The Monday (UTC) of the event's week, `YYYY-MM-DD`. Derived from `created_at` if omitted. |

The service also records two derived fields per event: `payload_size` (bytes of the original payload) and `node_count` (how many nodes the payload was shredded into), plus the payload's `root_hash`.

### Traces, Spans, and Layers

A single agent run typically fans out across services — a bot request leads to a broker request, which leads to one or more LLM calls and tool calls. When every producer tags its events with the same `trace_id`, the whole run can be pulled back with one query (`GET /events?trace_id=...`), ordered by time. `span_id` and `parent_span_id` let a consumer rebuild the parent/child tree; `layer` tells you what kind of step each event represents.

The service does not interpret spans or layers — it stores and indexes them. Their meaning is a convention between producers and consumers.

## Shredding and Deduplication

Telemetry payloads are large and repetitive. A long-running workload may send the same system prompt and tool schema thousands of times. Storing each payload as an opaque JSON blob would duplicate that content in every row.

Instead, the service **shreds** each payload into a content-addressed tree (a DAG):

1. **Canonicalize.** The JSON is serialized deterministically (based on RFC 8785 / JCS): object keys sorted, no whitespace, shortest number form.
2. **Hash.** Every value becomes a node identified by the BLAKE3 hash of its canonical form. Scalars are `s` nodes; objects and arrays are `o` and `a` nodes whose children are linked by object edges (parent, key, child) and array edges (parent, index, child).
3. **Store once.** Nodes are written with `ON CONFLICT DO NOTHING`, so a subtree that already exists — a repeated prompt, a shared tool definition — costs nothing to store again. The event row only records the **root hash**.

### Shred Strategies

Shredding every tiny value into its own row maximizes deduplication but creates many rows. The `SHRED_STRATEGY` setting controls the trade-off:

| Strategy | Behavior |
|----------|----------|
| `size:N` (default `size:1024`) | Only subtrees larger than `N` bytes are split further; smaller subtrees are stored as a single node holding their canonical JSON. |
| `depth:N` | Only the top `N` levels are split; everything deeper is stored whole. |
| `full` | Every subtree becomes its own node — maximum deduplication, maximum row count. |

The default keeps large repeated blocks (prompts, schemas, long messages) deduplicated while storing small fragments compactly.

### Reconstruction (Rehydration)

When a consumer asks for an event, the **Rehydrator** looks up the root hash, fetches the node graph breadth-first in batches, and reassembles the document. The result is semantically identical to the ingested payload. Because payloads are canonicalized before hashing, object key order and number formatting may differ from the producer's original bytes.

Reconstructed documents are cached in an in-memory LRU cache (256 MB per replica). Responses report whether the document came from the cache and how many nodes were fetched:

```json
"reconstruction": { "nodesFetched": 42, "durationMs": 3.1, "cached": false }
```

## Ingestion Lifecycle

```
Producer ──IngestBatch──▶ validate ─▶ parse JSON ─▶ shred ─▶ BatchManager ──flush──▶ PostgreSQL
              │                                                  │
              └──────── response: counts, root hashes, errors ◀──┘ (after queuing)
```

1. **Validate.** A request with more events than the batch limit (default 100) is rejected as a whole. Each event is then checked individually: payload size (default max 10 MB), valid JSON, and nesting depth (default max 100). An event that fails is reported in the response's `errors` map and skipped; the rest of the batch continues.
2. **Shred.** Valid payloads are shredded and assigned their weekly `partition_key`. If the producer supplied a `partition_key`, it must match the week of `created_at_ms`.
3. **Queue.** The event, its nodes, and its edges are added to the in-memory batch. The RPC returns once all events are queued — **not** after they are written to the database.
4. **Flush.** The batch is written to PostgreSQL when it reaches `BATCH_SIZE` events, when `BATCH_FLUSH_INTERVAL_MS` elapses, or when the oldest pending data has waited `BATCH_MAX_WAIT_MS`. Nodes are deduplicated in memory before the write, and again in the database.
5. **Retry.** A failed flush is retried per week with backoff (up to 3 attempts). If a week still cannot be written, that week's pending events are dropped and counted in the `tss_batch_dropped_events_total` metric; other weeks are unaffected.

On graceful shutdown (`SIGTERM`), the service flushes any remaining batched data before exiting.

Because ingestion is acknowledged at queue time, telemetry is best-effort: an event can be lost if a replica crashes before its batch flushes, or if the database rejects a week repeatedly. This is the right trade-off for observability data, but telemetry should not be treated as an audit log of record.

## Weekly Partitions

All telemetry tables are partitioned by **week**, keyed on the Monday (UTC) that starts the week:

- Each week has five child tables: events, nodes, object edges, array edges, and a document cache table.
- **Deduplication is per week.** A node is stored once within a week; the same content in a later week is stored again in that week. This keeps each week self-contained, so an old week can be removed by dropping its tables — no row-by-row deletes.
- **Queries can be scoped.** Every query endpoint accepts an optional `partition_key` (a Monday, `YYYY-MM-DD`). Supplying it lets PostgreSQL scan only that week. Omitting it searches all retained weeks.
- **Uniqueness** is enforced on `(partition_key, event_id)`. Producers should always generate globally unique UUIDs.

### Provisioning

A week's tables must exist before events for that week can be written. The service keeps them in place itself: on startup and then hourly, a background **provisioner** creates the current week and upcoming weeks using a dedicated create-only database role (`fireddl`). That role can create partitions but cannot drop them or truncate data, so the running service never holds credentials capable of deleting telemetry.

A **readiness monitor** checks every 60 seconds that the current and next week exist. If either is missing, the replica reports not-ready (so Kubernetes stops routing to it) and nudges the provisioner to fill the gap.

### Retention

The service never deletes data on its own. Removing old weeks is a separate, deliberate maintenance action (a CLI command or an API-key–protected admin endpoint), normally run weekly by a scheduled job. With the default 30-day policy only whole elapsed weeks are dropped, so the effective retention is 30–37 days. See [Operations](./operations.md#partition-maintenance-and-retention).

### Legacy Data

Deployments upgraded from a version before weekly partitions (pre-0.3.0) keep their earlier, unpartitioned data in a `telemetry_legacy` schema. Queries transparently merge legacy results with partitioned results, and the maintenance job truncates legacy data once it passes the retention window. New installations have an empty legacy schema.

## How It Interacts with Other Services

| Service / Tool | Interaction |
|----------------|-------------|
| [FF Broker](../ff-broker/README.md) | Primary producer of LLM call telemetry (requests, responses, tool calls). |
| Other platform services | Receive `TELEMETRY_SERVICE_INGEST_URL` via shared configuration and may emit events to it. |
| FireFoundry Console | Consumer: displays telemetry for runs and requests. |
| [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) | Consumer tool for broker/LLM/tool-call telemetry (reads the telemetry database directly). |
| PostgreSQL | Backing store; the service uses separate reader (`fireread`), writer (`fireinsert`), and create-only DDL (`fireddl`) roles. |

## What This Service Is Not

- **Not a metrics system.** It stores discrete JSON events, not time-series counters. Its own operational metrics are exposed on `/metrics` for Prometheus.
- **Not a log aggregator.** Service logs go to your cluster's logging stack.
- **Not a durable audit ledger.** Ingestion is acknowledged before persistence and data ages out with retention.
