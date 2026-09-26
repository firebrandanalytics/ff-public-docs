# Telemetry Service: Reference

Reference for the Telemetry Service's HTTP query API and its `IngestBatch` ingestion RPC.

| Interface | Port | Protocol |
|-----------|------|----------|
| Query and health API | `3000` | HTTP/JSON |
| Ingestion API | `50051` | Connect RPC (Protobuf service over HTTP/1.1; Connect and gRPC-Web wire protocols) |

Neither API requires authentication. Both are meant to be reached only from inside the cluster. The running service also serves an OpenAPI description of the HTTP API at `/openapi`.

## HTTP Query API

### GET /events

List event metadata, without payloads.

| Query parameter | Type | Default | Description |
|-----------------|------|---------|-------------|
| `trace_id` | string | none | Return the events of one trace, oldest first. When set, `service`, `layer`, `error`, and `offset` are ignored. |
| `service` | string | none | Filter by producing service. |
| `layer` | string | none | Filter by layer, for example `broker`, `llm`, `tool_call`, or `mcp_tool_call`. |
| `error` | `true` | none | When `true`, return only error events. |
| `limit` | number | `50` | Maximum results. Capped at `100`. |
| `offset` | number | `0` | Results to skip (filtered listings only). |
| `partition_key` | `YYYY-MM-DD` | none | Search only this week (a Monday, UTC). |

Filtered listings are ordered newest first. Response `200`:

```json
{
  "events": [
    {
      "partitionKey": "2026-06-29",
      "eventId": "6b1f0d52-6f0e-4a7e-9d0a-2f0a3f8b9c11",
      "traceId": "trace-7f3a",
      "spanId": "span-2",
      "parentSpanId": "span-1",
      "layer": "llm",
      "service": "ff-broker",
      "environment": "production",
      "error": false,
      "payloadSize": 18234,
      "createdAt": "2026-06-30T14:02:11.482Z",
      "meta": null
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 50
}
```

Items also include internal storage fields (such as `nodeCount` and `rootHash`) that you can ignore.

### GET /event/{eventId}

Return one event with its full payload.

| Parameter | In | Description |
|-----------|----|-------------|
| `eventId` | path | Event UUID. |
| `partition_key` | query | Optional week to search. |

Response `200`:

```json
{
  "event": { "partitionKey": "…", "eventId": "…", "traceId": "…", "spanId": "…", "parentSpanId": null,
             "layer": "…", "service": "…", "environment": null, "error": false,
             "payloadSize": 1234, "createdAt": "…", "meta": null },
  "payload": { },
  "reconstruction": { "nodesFetched": 5, "durationMs": 1.7, "cached": false }
}
```

`payload` is the recorded JSON document. `reconstruction` reports retrieval timing and can be ignored.

| Status | Meaning |
|--------|---------|
| `404` | `{"error":"Event not found"}` |
| `400` | Invalid `partition_key` |
| `500` | Lookup failed. A malformed, non-UUID `eventId` also returns `500`. |
| `503` | Service still starting |

### POST /events/batch

Return several events with their payloads in one request.

```json
{
  "eventIds": ["6b1f0d52-…", "0c3e9a11-…"],
  "partitionKey": "2026-06-29"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventIds` | string[] | Yes | Event UUIDs to fetch. |
| `partitionKey` | string | No | Search only this week. |

Response `200`: `{ "results": [ <same shape as GET /event/{eventId}> | null, ... ] }`, in the same order as `eventIds`. Events that are not found are `null`.

| Status | Meaning |
|--------|---------|
| `400` | `eventIds must be an array of strings`, or invalid `partitionKey` |
| `500` | Lookup failed |
| `503` | Service still starting |

Older deployments may not have this endpoint and return `404`. Fetch events one at a time with `GET /event/{eventId}` instead.

### Health and Info

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ready` | `200 {"status":"ready"}` when the service can accept and serve telemetry. Otherwise `503 {"status":"not ready", ...}`. |
| GET | `/health` | Always HTTP `200` while the process is up. The body's `status` is `healthy` only when the service is ready and its storage responds. |
| GET | `/info` | Service name, version, and environment. |
| GET | `/openapi` | OpenAPI description of the HTTP API. |

### Error Format

HTTP errors use one shape:

```json
{ "error": "partition_key must be a Monday in UTC" }
```

`partition_key` errors (`400`): `partition_key must use YYYY-MM-DD format`, `partition_key is not a valid date`, `partition_key must be a Monday in UTC`.

## Ingestion API

Package `firefoundry.telemetry.v1`, service `TelemetryIngestionService`.

| RPC | HTTP path |
|-----|-----------|
| `IngestBatch(IngestBatchRequest) returns (IngestBatchResponse)` | `POST /firefoundry.telemetry.v1.TelemetryIngestionService/IngestBatch` |

Call it with a Connect client (`createConnectTransport`), a gRPC-Web client, or plain HTTP with `Content-Type: application/json`. Native gRPC over HTTP/2 is not supported.

The proto also declares a `TelemetryQueryService` (`GetEvent`, `ListEvents`, `GetEventsByTrace`). It is not served. Use the HTTP query API instead.

### IngestBatchRequest

| Field | Type | Description |
|-------|------|-------------|
| `events` | `repeated TelemetryEvent` | Events to send. At most 100 per request. |

### TelemetryEvent

| # | Field | Type | Required | Description |
|---|-------|------|----------|-------------|
| 1 | `event_id` | string | Recommended | UUID. Generated by the service if empty. Must be a UUID if set. |
| 2 | `trace_id` | string | No | Trace identifier shared across a run. |
| 3 | `span_id` | string | No | Span identifier. |
| 4 | `parent_span_id` | string | No | Parent span identifier. |
| 5 | `layer` | string | Yes | Event kind, for example `app.classify`. |
| 6 | `service` | string | Yes | Name of the sending service or bundle. |
| 7 | `environment` | string | No | Environment label, for example `production`. |
| 8 | `error` | bool | No | Marks the event as an error for filtering. |
| 9 | `payload` | bytes | Yes | UTF-8 JSON document (base64 in the JSON encoding). |
| 10 | `created_at_ms` | int64 | No | Unix milliseconds. Defaults to the time the service receives the event. |
| 11 | `meta` | bytes | No | Optional UTF-8 JSON object stored with the event. |
| 12 | `partition_key` | optional string | No | Leave unset; derived from `created_at_ms`. If set, it must be the Monday (UTC) of that timestamp's week. |

### IngestBatchResponse

| Field | Type | Description |
|-------|------|-------------|
| `ingested_count` | int32 | Number of events accepted. |
| `root_hashes` | `repeated bytes` | One entry per request event, in order. Used internally; you can ignore it. |
| `errors` | `map<int32, string>` | Error messages for rejected events, keyed by index in the request. Only rejected events appear. |

Accepted events are written shortly after the call returns, not before. See [Concepts → Behavior to Design Around](./concepts.md#behavior-to-design-around).

### Ingestion Errors

| Condition | Result |
|-----------|--------|
| More than 100 events in the request | The whole request fails with Connect code `invalid_argument`: `Batch size N exceeds maximum of M` |
| Payload larger than 10 MB | Per-event error: `Payload size N bytes exceeds maximum of M bytes` |
| Payload is not valid JSON | Per-event error: `Invalid JSON payload` |
| Payload nested more than 100 levels | Per-event error: `JSON depth N exceeds maximum of M` |
| `partition_key` malformed or not a Monday | Per-event error, for example `partition_key must be a Monday in UTC` |
| `partition_key` does not match `created_at_ms` | Per-event error: `partition_key X does not match created_at week Y` |

A rejected event does not affect the other events in the same request.

The limits above are the defaults. Your environment administrator can change them.
