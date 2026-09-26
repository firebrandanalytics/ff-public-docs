# Log Proxy Service

## Overview

The Log Proxy Service is FireFoundry's centralized log pipeline. Services and agent bundles send structured log entries to it over gRPC. The proxy routes each entry to one or more **streams**, applies each stream's **redaction** and **encryption** rules, writes the result to a **durable on-disk buffer**, and forwards it to an **OTLP-compatible backend** such as an OpenTelemetry Collector. Along the way it keeps a local, searchable index of recent log metadata and can push matching logs live to WebSocket subscribers.

It is a **System service** and is **opt-in**: `firefoundry-core` ships it disabled (`log-proxy-service.enabled: false`). Application code does not need to call it. When it is enabled, the log producers you configure send their logs through it, and operators work with the results through the search API, the live stream, or the backend it forwards to.

## Purpose and Role in Platform

Without a central proxy, each service logs straight to its own backend. Redaction policy is inconsistent, it is easy to leak PII or credentials into logs by accident, and changing backends means touching every service. The Log Proxy sits between producers and backends:

```
Producers ──gRPC──▶ Log Proxy ──▶ [route] ──▶ [redact] ──▶ [encrypt] ──▶ disk buffer ──▶ OTLP backend
                                                      │
                                                      ├──▶ local search index (7 days)
                                                      └──▶ WebSocket live tail
```

It gives the platform:

- **One ingestion endpoint** for every log producer, with backpressure signalling so producers slow down instead of overwhelming it
- **Central privacy policy.** Pattern-based PII and credential redaction runs before anything is stored or forwarded.
- **Durability across backend outages.** A log segment is deleted only after every target exporter has accepted it.
- **Recent-log search** without querying the long-term backend

## Key Features

- **gRPC ingestion.** Bidirectional streaming (`Ingest`) for high-volume producers and unary `IngestBatch` for simple clients. The server speaks gRPC, gRPC-Web and the Connect protocol.
- **Stream routing.** Each log is matched against admin-defined streams by service, level, tags or message regex, and is processed once for *every* stream it matches.
- **Pattern redaction.** Built-in detectors for emails, phone numbers, credit cards, US SSNs, IPv4 addresses and API keys. You can add custom regex patterns and list attribute keys to blank out completely.
- **AES-256-GCM encryption.** Each stream can encrypt the log message and/or the binary payload.
- **Durable disk buffer.** Logs are appended to NDJSON segment files, flushed on a timer and acknowledged only after a successful export. The buffer applies load-shedding at high usage.
- **OTLP/HTTP export.** Logs are forwarded as OTLP JSON to any OpenTelemetry-compatible endpoint.
- **Search API.** A SQLite index of redacted log metadata with time-range, service, level, trace, tag and attribute filters, plus aggregations. It keeps 7 days.
- **Live tail.** A WebSocket endpoint streams matching logs to subscribers in real time.
- **Operational endpoints.** Health, readiness, status, Prometheus and JSON metrics, and an OpenAPI document.

## Architecture Overview

```
┌──────────────────────────┐       ┌────────────────────────────┐
│ gRPC / Connect  :50051   │       │ HTTP API (Elysia)   :3000  │
│  Ingest (bidi stream)    │       │  /health /ready /status    │
│  IngestBatch (unary)     │       │  /metrics /openapi         │
│  Health                  │       │  /api/v1/logs/*  (search)  │
└────────────┬─────────────┘       │  /admin/*        (admin)   │
             │                     └────────────────────────────┘
             ▼                       admin edits streams; search
┌──────────────────────────────────┐ reads the index
│ Processing Pipeline              │
│  1. StreamRouter (match streams) │
│  2. RedactionEngine (patterns)   │
│  3. MetadataExtractor            │
│  4. EncryptionService (AES-GCM)  │
└───┬──────────────┬───────────┬───┘
    │              │           │
    ▼              ▼           ▼
┌──────────┐ ┌────────────┐ ┌──────────────────┐
│ Buffer   │ │ Search     │ │ WebSocket  :8081 │
│ Manager  │ │ Index      │ │ /ws/stream       │
│ (NDJSON  │ │ (SQLite,   │ │ (live tail)      │
│ segments │ │  7 days)   │ └──────────────────┘
│ on disk) │ └────────────┘
└────┬─────┘
     │ flush on a timer; segment acknowledged only on success
     ▼
┌──────────────────────────┐
│ Exporter Manager         │──▶ OTLP/HTTP endpoint (e.g. OpenTelemetry Collector)
│  otlp-default            │
└──────────────────────────┘
```

**Core components:**

- **LogIngestionServer**: the HTTP/2 Connect RPC server that implements `firefoundry.logproxy.v1.LogIngestionService`
- **ProcessingPipeline / StreamRouter**: fan out each entry to its matching streams and apply per-stream processing
- **RedactionEngine / PatternMatcher**: regex redaction of the message, attributes and text payloads
- **EncryptionService**: AES-256-GCM encryption with a key supplied through `ENCRYPTION_KEY`
- **BufferManager / LocalDiskBuffer**: segment-based disk buffer with backpressure states (`normal`, `pressure`, `critical`)
- **ExporterManager / OtlpExporter**: sends each log to the exporters its stream lists
- **SearchIndexWriter / SearchService**: SQLite metadata index stored in the buffer directory
- **WebSocketServer / SubscriptionManager**: filtered live streaming to connected clients

## Documentation

- **[Concepts](./concepts.md)**: streams, the processing pipeline, redaction, encryption, buffering, backpressure, export and search
- **[Getting Started](./getting-started.md)**: enable the service, send your first logs, search them, define a stream and tail logs live
- **[Reference](./reference.md)**: the gRPC API, every HTTP endpoint, the WebSocket protocol, error formats and environment variables
- **[Operations](./operations.md)**: Helm deployment, configuration, health checks, scaling, security, monitoring and troubleshooting

## Version and Maturity

- **Service version**: 0.2.0 (the version this documentation describes)
- **Helm chart**: `log-proxy-service` 0.1.2, included in `firefoundry-core` as an opt-in dependency
- **Default image tag in the chart**: `0.1.1`. Features added in 0.2.0 (the `/openapi` document, telemetry events, `x-trace-id`/`x-span-id` propagation) need a 0.2.0 image.
- **Maturity**: **Preview.** The ingestion, redaction, encryption, buffering, OTLP export, search and live-tail paths are implemented and working. Several parts are not yet production-complete:
  - Stream configuration lives in memory and is lost when the pod restarts.
  - Only the OTLP exporter can be configured.
  - Some admin endpoints return a validation error even when the change succeeds. See [Operations — Known Issues](./operations.md#known-issues).

**Not yet implemented** (exists in design documents or as unwired code): LLM-assisted redaction, decryption through the API, persistent stream and exporter configuration, and configuring the Azure, GCP, AWS and Datadog exporters.

## Repository

Source code: [ff-services-log-proxy](https://github.com/firebrandanalytics/ff-services-log-proxy) (private)

## Related

- [Platform Services Overview](../README.md)
- [Telemetry Service](../telemetry-service/README.md): request telemetry, which is separate from application logs
- [Platform Operations](../../operations.md)
- [firefoundry-core Chart Reference](../../../../ff_local_dev/chart-reference.md)
