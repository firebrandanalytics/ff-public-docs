# Telemetry Service: Concepts

This page covers what telemetry is captured about your application's requests, how events are organized into traces, and the behavior you should design around.

## What Is Captured

Your bundle does not produce most telemetry itself. The platform services it calls do:

| Source | What you get | `layer` values |
|--------|--------------|----------------|
| [FF Broker](../ff-broker/README.md) | Each broker request your bots make (model pool, selected model, provider, token counts, latency, status, breadcrumbs), each LLM API call made to serve it, and the tool calls the model requested | `broker`, `llm`, `tool_call` |
| [MCP Gateway](../mcp-gateway/README.md) | One event per tool call made through a per-adapter endpoint: tool name, adapter, duration, and error flag, linked to the caller's trace | `mcp_tool_call` |
| Other platform services | Service-specific events, where the service emits them | Service-defined |
| Your bundle (optional) | Any events you send yourself | Your choice |

Broker events are organized as a hierarchy: one broker request, the LLM calls made to serve it (including retries), and the tool calls inside each LLM call. Broker requests carry **breadcrumbs** that identify the entity that made the request (entity type and entity ID), so you can go from an entity in your application to the model calls it caused.

Payloads are recorded in full. Telemetry contains complete prompts, model responses, and tool arguments and results, so treat it with the same care as your application data.

## Events

The unit of telemetry is an **event**: one JSON payload plus a few indexed fields.

| Field | Meaning |
|-------|---------|
| `eventId` | Unique UUID for the event. |
| `traceId` | Shared by every event in one logical run. For broker telemetry, the trace ID is the broker request ID. |
| `spanId` / `parentSpanId` | The event's position in the trace, in the usual distributed-tracing sense. |
| `layer` | The kind of event, such as `broker`, `llm`, `tool_call`, or `mcp_tool_call`. Chosen by the producer. |
| `service` | The producing service. |
| `environment` | Optional environment label, such as `production`. |
| `error` | `true` for failed operations, so you can filter for them quickly. |
| `payload` | The recorded JSON document. |
| `meta` | Optional extra JSON stored with the event. |
| `createdAt` | Event timestamp. |
| `partitionKey` | The Monday (UTC) of the event's week, `YYYY-MM-DD`. Pass it back on queries to search a single week. |
| `payloadSize` | Size of the original payload in bytes. |

## Traces, Spans, and Layers

A single agent run fans out. A bot request becomes a broker request, which becomes one or more LLM calls, which may include tool calls. When every event is tagged with the same `trace_id`, you can pull back the whole run with one query (`GET /events?trace_id=...`), in time order. Use `span_id` and `parent_span_id` to rebuild the tree, and `layer` to see what each step was.

The service stores and indexes these fields but does not interpret them. Their meaning is a convention between the services that produce events and the tools that read them. If you send your own events, reuse the trace ID of the run they belong to so they appear alongside the platform's events.

## Ways to Read Telemetry

| Tool | Best for |
|------|----------|
| FireFoundry Console | Browsing telemetry for runs and requests in the UI. |
| [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md) | Interactive debugging from a terminal: recent and failed broker requests, a full broker/LLM/tool trace, and lookups by entity breadcrumb. It reads the broker's request-tracking records from the telemetry database, so it needs read credentials from your environment administrator. |
| MCP Gateway `telemetry_*` tools | Letting an AI agent (such as a coding assistant) investigate a request. See [MCP Gateway tools](../mcp-gateway/tools.md#telemetry-adapter). |
| HTTP query API | Scripts, custom dashboards, and in-cluster code. Works for events from any producer, including your own. See [Reference](./reference.md#http-query-api). |

## Behavior to Design Around

- **Best effort, not a ledger.** Ingestion is acknowledged before events are written, and an event can occasionally be lost, for example if a service instance restarts at the wrong moment. Do not use telemetry as an audit log of record or as application state. Store anything your application must keep in the entity graph or your own storage.
- **Short delay before events appear.** Events usually become queryable within a second or two of being sent. A query issued immediately after a request may not show its last events yet.
- **Limited retention.** Telemetry is kept for a limited window that your environment administrator sets (commonly about 30 days). Export anything you need for longer.
- **Canonical payloads.** Returned payloads are semantically identical to what was sent, but object key order and number formatting may differ from the original bytes.
- **Large repeated payloads are stored once.** You do not need to trim repeated system prompts or tool schemas to save telemetry space.

## What This Service Is Not

- **Not a metrics system.** It stores discrete JSON events, not time-series counters.
- **Not a log aggregator.** Your bundle's logs go to the cluster's logging stack (see the [Log Proxy Service](../log-proxy-service/README.md)).
- **Not an access-controlled store.** Any workload that can reach the service inside the cluster can read every event. See [Operations](./operations.md#security).
