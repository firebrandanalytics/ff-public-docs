# Telemetry Service

## Overview

The Telemetry Service is a background FireFoundry platform service that collects, stores, and serves telemetry emitted by other platform services. Producer services send it structured JSON events (for example, a bot request, an LLM response, or a broker request); the service stores them compactly and lets tools read them back by event, by trace, or by filter.

Application developers do not normally interact with it directly. Telemetry is emitted automatically by the services that produce it, and developers consume it through the FireFoundry Console UI or the [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) CLI when they need to debug, audit, or analyze what their agent workloads did. These pages document the service for completeness and for platform operators; in day-to-day agent development you should not need to plan around it.

Internally the service is also known as the **Telemetry Shredding Service (TSS)**, after the technique it uses to store payloads (see [Concepts](./concepts.md)).

## Purpose and Role in Platform

The Telemetry Service is the platform's store for runtime event telemetry. Producer services emit events to it as they work, and operators and tools read them back to:

- Trace a single agent run end-to-end across services (events share a `trace_id`)
- Inspect the exact JSON payloads involved — prompts, tool calls, and responses
- Audit which services produced which events, and which ones failed
- Reconstruct events long after they happened, within the retention window

Telemetry payloads are highly repetitive: the same system prompt, tool schemas, and context blocks appear in thousands of events. The service is designed to absorb high-volume event streams while storing each repeated piece of content only once, keeping storage modest and query latency low.

## Key Features

- **Unified ingestion** — One batched RPC, `IngestBatch`, for every producer service (Connect/Protobuf, port `50051`)
- **Trace correlation** — Events carry `trace_id`, `span_id`, and `parent_span_id`, so a run can be reassembled across services
- **Payload deduplication** — JSON payloads are "shredded" into content-addressed nodes (BLAKE3 hashes); identical subtrees within a week are stored once
- **Faithful reconstruction** — Queries return the reassembled JSON document, semantically identical to what was ingested
- **Filtered queries** — HTTP endpoints list events by trace, service, layer, and error flag, and fetch one or many events with payloads
- **Weekly partitions and retention** — Data is partitioned by UTC week; whole weeks age out on a configurable retention policy
- **Self-provisioning storage** — The service creates upcoming weekly partitions itself, using a least-privilege database role
- **Health and metrics** — Liveness, readiness, and Prometheus metrics endpoints for platform monitoring

## Architecture Overview

The service has separate ingestion and query paths over the same PostgreSQL store:

```
┌─────────────────────────────────────────────────────┐
│      Producer services (platform services that      │
│      emit telemetry, e.g. broker / bot layers)      │
└───────────────────┬─────────────────────────────────┘
                    │ IngestBatch (Connect RPC, :50051)
                    ▼
┌─────────────────────────────────────────────────────┐
│                Telemetry Service                    │
│  ┌─────────────────┐      ┌──────────────────────┐  │
│  │  Ingestion API  │      │  Query API (HTTP)    │  │
│  │  Shredder       │      │  :3000 /events,      │  │
│  │  (BLAKE3 DAG)   │      │  /event/:id, ...     │  │
│  └────────┬────────┘      └──────────▲───────────┘  │
│           │                          │              │
│  ┌────────▼────────┐      ┌──────────┴───────────┐  │
│  │  BatchManager   │      │  Rehydrator +        │  │
│  │  → PgWriter     │      │  LRU document cache  │  │
│  └────────┬────────┘      └──────────▲───────────┘  │
│           │   Partition provisioner  │              │
│           │   + readiness monitor    │              │
└───────────┼──────────────────────────┼──────────────┘
            │ fireinsert               │ fireread
      ┌─────▼──────────────────────────┴─────┐
      │  PostgreSQL — schema "telemetry"     │
      │  weekly partitions (Monday UTC)      │
      └──────────────────────────────────────┘
```

**Core components:**

- **Ingestion API** — Validates each event, parses the JSON payload, and hands it to the shredder
- **Shredder** — Canonicalizes the JSON and splits it into content-addressed nodes and edges
- **BatchManager / PgWriter** — Buffers events and flushes them to PostgreSQL in bulk, deduplicating nodes with `ON CONFLICT DO NOTHING`
- **Rehydrator** — Reassembles stored payloads on read, with an in-memory LRU cache of reconstructed documents
- **Partition provisioner and readiness monitor** — Keep the current and upcoming weekly partitions in place and take the replica out of rotation if they are missing

## Documentation

- **[Concepts](./concepts.md)** — Events, traces, layers, shredding and deduplication, weekly partitions, and how producers and consumers fit together
- **[Getting Started](./getting-started.md)** — Inspect the telemetry for a request, and emit telemetry from a producer service
- **[Reference](./reference.md)** — The `IngestBatch` RPC, every HTTP endpoint, error codes, and environment variables
- **[Operations](./operations.md)** — Helm deployment, database roles, partition maintenance and retention, monitoring, and troubleshooting

## Version and Maturity

- **Current Version**: 0.5.0 (source `main`)
- **Maturity**: Early production. Ingestion, query, deduplication, and weekly partitioning are implemented. The query and ingestion endpoints are unauthenticated and intended for in-cluster use only.
- **Deployment note**: the `firefoundry-core` Helm chart currently pins the telemetry-service image at `0.1.0`, which predates weekly partitions, `partition_key`, `POST /events/batch`, and the admin maintenance endpoint. See [Operations](./operations.md#version-compatibility).

## Repository

Source code: [ff-services-telemetry](https://github.com/firebrandanalytics/ff-services-telemetry) (private)

## Related

- [Platform Services Overview](../README.md) — Overview of all FireFoundry services
- [Platform Architecture](../../architecture.md)
- [FF Broker](../ff-broker/README.md) — Primary producer of LLM call telemetry
- [`ff-telemetry-read` CLI](../../../sdk/cli-tools/ff-telemetry-read.md) — Recommended way to inspect broker request, LLM, and tool-call telemetry interactively
