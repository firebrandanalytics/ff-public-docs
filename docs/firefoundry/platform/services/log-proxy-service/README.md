# Log Proxy Service

## Overview

The Log Proxy Service is an optional, central log pipeline for your FireFoundry environment. Your agent bundles and apps send structured log entries to it over gRPC. The proxy **redacts** sensitive data (emails, card numbers, API keys, fields you name), optionally **encrypts** messages and payloads, forwards the result to an **OTLP-compatible backend** such as an OpenTelemetry Collector, and keeps a **7-day searchable index** you can query or **live-tail** while you debug.

It is a **System service** and is **opt-in**: `firefoundry-core` ships it disabled (`log-proxy-service.enabled: false`). Nothing is sent to it unless your app sends logs there.

## Purpose and Role in Platform

Without a central proxy, each bundle logs straight to wherever its container output ends up. Redaction is left to each developer, and it is easy to leak customer PII or credentials into logs. The Log Proxy gives your app:

- **One ingestion endpoint** for all of your bundles' logs, with backpressure hints so a chatty bundle slows down instead of overwhelming it
- **Central redaction policy** applied before anything is stored, streamed or forwarded, so a bundle that accidentally logs an email address or card number doesn't leak it
- **Recent-log search and live tail** by service, level, trace ID, tag or attribute, without going to your long-term backend
- **Backend choice without code changes.** Your bundles talk to the proxy, and the proxy forwards to whichever OTLP endpoint your environment points it at.

## Key Features

- **gRPC ingestion.** Unary `IngestBatch` for simple clients and bidirectional `Ingest` streaming for high-volume producers. The server speaks gRPC, gRPC-Web and the Connect protocol.
- **Pattern redaction.** Built-in detectors for emails, phone numbers, credit cards, US SSNs, IPv4 addresses and API keys, plus your own regex patterns and a list of attribute keys to blank out.
- **Streams.** Named policies that match logs by service, level, tag or message pattern and apply their own redaction, encryption and sampling. Use one to give a sensitive bundle a stricter policy.
- **Optional AES-256-GCM encryption** of the message and/or payload, per stream.
- **OTLP/HTTP export** to any OpenTelemetry-compatible endpoint.
- **Search API** over the last 7 days of log metadata, with filters and aggregations.
- **Live tail** over WebSocket, filtered by service, level, stream, tag or trace.

## Architecture Overview

```
┌──────────────────────────┐
│ Your agent bundles / apps│
│  (Connect/gRPC client)   │
└────────────┬─────────────┘
             │ IngestBatch / Ingest  (gRPC, port 50051)
             ▼
┌───────────────────────────────────────────┐        ┌──────────────────────────────┐
│ Log Proxy Service                         │  OTLP  │ Your log backend             │
│  match streams → redact → encrypt (opt.)  │──HTTP─▶│ (OpenTelemetry Collector →   │
│  durable delivery to the backend          │        │  Loki, Datadog, Azure, ...)  │
└───────┬───────────────────────┬───────────┘        └──────────────────────────────┘
        │                       │
        ▼                       ▼
  Search API (port 3000)   Live tail (WebSocket, port 8081)
  last 7 days, redacted    redacted logs as they arrive
        ▲                       ▲
        └───── you, your tools, dashboards ─────┘
```

Everything downstream of the proxy (search, live tail and the backend) sees only the **redacted** (and, where configured, encrypted) form of your logs.

## Documentation

- **[Concepts](./concepts.md)**: the log entry, streams, redaction, encryption, delivery and search
- **[Getting Started](./getting-started.md)**: enable the service, send logs from a bundle, see redaction, search, add a stricter stream and tail logs live
- **[Reference](./reference.md)**: the gRPC ingestion API and proto, the search, stream and live-tail APIs, and errors
- **[Operations](./operations.md)**: enabling and configuring it for your app, verifying, limits and troubleshooting

## Version and Maturity

- **Service version**: 0.2.0 (the version this documentation describes)
- **Helm chart**: `log-proxy-service` 0.1.2, an opt-in dependency of `firefoundry-core`. The chart's default image tag is `0.1.1`; ask your environment administrator for a 0.2.0 image to get everything described here.
- **Maturity**: **Preview.** Ingestion, redaction, encryption, OTLP export, search and live tail work. Limitations to design around:
  - There is no FireFoundry SDK logger integration yet. Bundles send logs with a Connect/gRPC client (see [Getting Started](./getting-started.md#step-3-send-logs-from-your-bundle)).
  - Custom streams are held in memory and must be re-applied after the proxy restarts.
  - Only an OTLP/HTTP backend can be configured.
  - There is no decryption API, and LLM-assisted redaction is not implemented.

## Repository

Source code: [ff-services-log-proxy](https://github.com/firebrandanalytics/ff-services-log-proxy) (private)

## Related

- [Platform Services Overview](../README.md)
- [Telemetry Service](../telemetry-service/README.md): request telemetry, which is separate from application logs
- [firefoundry-core Chart Reference](../../../../ff_local_dev/chart-reference.md)
