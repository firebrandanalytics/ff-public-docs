# Telemetry Service

## Overview

The Telemetry Service is the core FireFoundry platform service that collects, stores, and serves telemetry from broker LLM calls, tool invocations, agent runs, and other platform service operations. It gives application developers a unified, queryable record of what their agent workloads did and why — enabling debugging, auditing, cost analysis, and post-hoc investigation across an entire bundle's execution.

## Purpose and Role in Platform

The Telemetry Service is the single source of truth for runtime observability on the FireFoundry platform. Every platform service that does meaningful work — the FF Broker issuing model calls, the Entity Service mutating state, the Virtual Worker Manager running agents — emits structured telemetry events here. Application developers and operators consume that data to:

- Trace a single agent run end-to-end across services
- Inspect the exact prompts, tool calls, and responses involved in a broker request
- Audit which bundles, bots, or workers performed which actions
- Analyze token usage, latency, and cost across a workload
- Reconstruct events long after they happened

The service is designed to absorb high-volume event streams while keeping query latency low and storage requirements modest, even when many events share large overlapping payloads (such as repeated system prompts or tool schemas).

## Key Features

- **Unified ingestion**: All platform services emit telemetry through a single gRPC endpoint
- **Trace correlation**: Events are linked by trace identifiers so a single agent run can be reconstructed across services
- **Payload deduplication**: Identical or overlapping content (system prompts, tool schemas, repeated context) is stored once and reused across events, dramatically reducing storage for long-running workloads
- **Faithful reconstruction**: Original event payloads are returned exactly as they were ingested when queried
- **Filtered queries**: HTTP query endpoints support filtering by trace, service, and layer
- **Health and metrics**: Standard liveness, readiness, and Prometheus metrics endpoints for platform monitoring
- **CLI access**: The `ff-telemetry-read` CLI provides a convenient interactive way for developers to query telemetry without writing HTTP calls

## Architecture Overview

The Telemetry Service follows the standard FireFoundry layered architecture, with separate ingestion and query paths over the same backing store:

```
┌─────────────────────────────────────────────────────┐
│           Producer Services (FF Broker,             │
│           Entity Service, VWM, etc.)                │
└───────────────────┬─────────────────────────────────┘
                    │ gRPC IngestBatch
                    ▼
┌─────────────────────────────────────────────────────┐
│                Telemetry Service                    │
│  ┌─────────────────┐      ┌──────────────────────┐  │
│  │  Ingestion API  │      │   Query API (HTTP)   │  │
│  │     (gRPC)      │      │  /events, /event/:id │  │
│  └────────┬────────┘      └──────────┬───────────┘  │
│           │                          │              │
│  ┌────────▼──────────────────────────▼───────────┐  │
│  │            Storage & Query Engine             │  │
│  │   (deduplicating writer + event reassembly)   │  │
│  └────────────────────┬──────────────────────────┘  │
└───────────────────────┼─────────────────────────────┘
                        │
                ┌───────▼────────┐
                │   PostgreSQL   │
                └────────────────┘
```

**Core Components:**

- **Ingestion API (gRPC)**: Accepts batched telemetry events from any producer service
- **Query API (HTTP)**: Filtered listing and per-event reconstruction for consumer tools and CLIs
- **Storage & Query Engine**: Persists events efficiently and reassembles them on read

## API and Interfaces

### Ingestion API (gRPC)

Producer services emit telemetry through a single batched gRPC method. Application developers do not normally call this directly — emission is handled by the platform SDKs that the producer services use.

| Method | Description |
|--------|-------------|
| `IngestBatch` | Submit a batch of telemetry events. Returns an acknowledgement once the batch is durably accepted. |

### Query API (HTTP)

The query API is the primary interface for application developers and platform tooling.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/events` | List events matching the supplied filters (see query parameters below) |
| GET | `/event/:id` | Return a single event's full reconstructed payload by event ID |

**Common query parameters for `/events`:**

| Parameter | Description |
|-----------|-------------|
| `trace_id` | Restrict results to a specific trace (an entire agent run or correlated workflow) |
| `service` | Filter by the producing service (e.g. `broker`, `entity-service`) |
| `layer` | Filter by event layer or category within a service |

Single-event reconstruction via `/event/:id` returns the original payload exactly as it was ingested, regardless of how it is stored internally.

### Standard Service Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (checks backing store connectivity) |
| GET | `/metrics` | Prometheus-format service metrics |

### CLI Access

The recommended way for developers to explore telemetry interactively is the [`ff-telemetry-read`](../../sdk/cli-tools/ff-telemetry-read.md) CLI, which wraps the query API and provides convenient filters, formatting, and trace navigation. Direct HTTP access is fully supported for scripting and custom integrations.

## Dependencies

The Telemetry Service depends on a relational database for event storage. It is configured per environment as part of the standard FireFoundry deployment.

## Configuration

The service is configured via environment variables (see `.env.example` in the service repository for the complete list). The main groups are:

- **Service settings** — HTTP and gRPC ports, log level
- **Database connection** — host, database, credentials
- **Ingestion tuning** — batch sizes and flush intervals for high-volume workloads

## Version

- **Current Version**: 0.1.0

## Repository

Source code: [ff-services-telemetry](https://github.com/firebrandanalytics/ff-services-telemetry)

## Related Documentation

- [Platform Services Overview](./README.md) — Overview of all FireFoundry services
- [FF Broker](./ff-broker/README.md) — Primary producer of LLM call telemetry
- [Entity Service](./entity-service/README.md) — Produces state-mutation telemetry
- [`ff-telemetry-read` CLI](../../sdk/cli-tools/ff-telemetry-read.md) — Recommended way to query telemetry interactively
