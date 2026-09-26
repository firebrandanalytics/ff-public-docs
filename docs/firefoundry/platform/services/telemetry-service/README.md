# Telemetry Service

## Overview

The Telemetry Service records what happened when your agent bundle did its work: the broker requests your bots made, the individual LLM calls behind them, the tool calls the models made, and events from other platform services involved in the same request. Each record keeps the full JSON payload (prompts, responses, tool arguments and results), so you can go back and see exactly what a model was sent and what it returned.

You do not need to add anything to your bundle to get this telemetry. The platform services your bundle calls, such as the [FF Broker](../ff-broker/README.md) and the [MCP Gateway](../mcp-gateway/README.md), emit it for you. You use it when you debug, audit, or tune an application: through the FireFoundry Console, the [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) CLI, the MCP Gateway's `telemetry_*` tools, or the service's HTTP query API.

## Purpose and Role in Platform

Telemetry answers "what did the models and services actually do for this request?" Use it to:

- Trace one agent run end to end across services. Every event in a run shares a `trace_id`.
- Inspect the exact prompts, responses, and tool calls behind a bad or failed answer.
- Find failed requests and see which step failed.
- Review token usage and model choice for a workflow.

Telemetry complements the other debugging views. Logs show what your code did, the entity graph shows your application's current state, and telemetry shows what happened in the LLM and service interactions. See [Monitoring & Debugging](../../../sdk/agent_sdk/guides/monitoring-debugging.md) for how the three fit together.

## Key Features

- **Captured automatically.** Broker requests, LLM calls, tool calls, and MCP Gateway tool calls are recorded without code in your bundle.
- **Trace correlation.** Events carry `trace_id`, `span_id`, and `parent_span_id`, so you can pull back a whole run with one query and rebuild its parent/child structure.
- **Full payloads.** Queries return the original JSON document for each event.
- **Filtering.** You can list events by trace, producing service, event kind (`layer`), or error flag.
- **Custom events.** Your application can send its own events into the same traces through the ingestion API. See [Getting Started](./getting-started.md#part-b-send-your-own-events).
- **Compact storage.** Large payloads that repeat, such as system prompts and tool schemas, are stored once, so recording full payloads stays affordable.

## Architecture Overview

```
┌──────────────────────────┐
│  Your agent bundle       │──── optional: your own events (IngestBatch) ───┐
└────────────┬─────────────┘                                                │
             │ completions, tool calls                                      │
             ▼                                                              ▼
┌──────────────────────────┐   emit events    ┌──────────────────────────────────┐
│  FF Broker, MCP Gateway, │ ───────────────▶ │        Telemetry Service         │
│  other platform services │   (IngestBatch)  │  ingestion :50051 · query :3000  │
└──────────────────────────┘                  └────────────────┬─────────────────┘
                                                               │ read
                     ┌───────────────────┬─────────────────────┼────────────────────┐
                     ▼                   ▼                     ▼                    ▼
              FireFoundry Console   ff-telemetry-read   MCP Gateway telemetry   HTTP query API
                                          CLI                 tools             (curl, scripts)
```

- **Producers** are the platform services your bundle calls. They send events to the ingestion API as they work. Your bundle can also be a producer if you want custom events.
- **Consumers** read the events back. The Console and CLI are the usual tools. The HTTP query API is available to scripts and in-cluster code.

## Documentation

- **[Concepts](./concepts.md)**: what is captured, events, traces and layers, and how telemetry behaves
- **[Getting Started](./getting-started.md)**: inspect the telemetry for a request, and send your own events
- **[Reference](./reference.md)**: the query endpoints, the `IngestBatch` RPC, and errors
- **[Operations](./operations.md)**: enabling the service, reaching it from a bundle, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.5.0 (source `main`)
- **Maturity**: Early production. Ingestion, trace queries, and payload retrieval are implemented. The query and ingestion endpoints have no authentication and are meant to be reached only from inside the cluster.

## Repository

Source code: [ff-services-telemetry](https://github.com/firebrandanalytics/ff-services-telemetry) (private)

## Related

- [Platform Services Overview](../README.md): all FireFoundry services
- [Platform Architecture](../../architecture.md)
- [FF Broker](../ff-broker/README.md): the main producer of LLM call telemetry
- [MCP Gateway](../mcp-gateway/README.md): exposes telemetry read tools and records MCP tool-call events
- [`ff-telemetry-read` CLI](../../../sdk/cli-tools/ff-telemetry-read.md): interactive inspection of broker, LLM, and tool-call telemetry
- [Monitoring & Debugging guide](../../../sdk/agent_sdk/guides/monitoring-debugging.md)
