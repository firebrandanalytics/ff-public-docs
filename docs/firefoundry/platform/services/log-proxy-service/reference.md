# Log Proxy Service — Reference

Reference for the Log Proxy Service 0.2.0 as your app uses it: the gRPC ingestion API, the search API, stream management, the live-tail WebSocket protocol and errors.

## Endpoints

| Interface | Port | Protocol | In-cluster URL (default release name) |
|-----------|------|----------|---------------------------------------|
| Ingestion | 50051 | gRPC, gRPC-Web and Connect over **HTTP/2 cleartext** | `http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:50051` |
| HTTP API (search, streams, health) | 3000 | HTTP/1.1 JSON | `http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:3000` |
| Live tail | 8081 | WebSocket | `ws://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:8081/ws/stream` |

The service is not exposed outside the cluster by default. An OpenAPI 3 document for the HTTP API is served at `GET /openapi` (UI) and `GET /openapi/json`.

### Authentication

| API | Key | How to send it |
|-----|-----|----------------|
| Ingestion (gRPC) | None | — |
| Search (`/api/v1/logs/*`) | `SEARCH_API_KEY`, or the admin key if that is unset | `X-API-Key` header |
| Streams (`/admin/*`) | `ADMIN_API_KEY` | `X-API-Key` header |
| Live tail | `WS_API_KEY`, or the admin key if that is unset | `?token=`, `Authorization: Bearer`, or `X-API-Key` on the upgrade request |
| `/health`, `/ready`, `/openapi` | None | — |

Keys are in the `firefoundry-core-log-proxy-service-secret` Secret. Ask your environment administrator for the search or WebSocket key if you don't have `kubectl` access to it.

---

## gRPC Ingestion API

**Service:** `firefoundry.logproxy.v1.LogIngestionService`

The server does not enable reflection, so clients need the [protobuf definition](#protobuf-definition). The listener is HTTP/2 only; HTTP/1.1 clients cannot connect.

### IngestBatch (unary)

```
rpc IngestBatch(LogBatch) returns (IngestResponse);
```

One request, one response. The simplest choice for most bundles: buffer logs in memory and send a batch every second or so.

```bash
buf curl --http2-prior-knowledge --schema log_proxy.proto \
  --data '{"batchId":"b-1","entries":[{"id":"log-1","level":"LOG_LEVEL_INFO","message":"hello","service":"my-bundle"}]}' \
  http://localhost:50051/firefoundry.logproxy.v1.LogIngestionService/IngestBatch
```

### Ingest (bidirectional stream)

```
rpc Ingest(stream IngestRequest) returns (stream IngestResponse);
```

For high-volume producers. Each `IngestRequest` carries either `single` (one `LogEntry`, response `batch_id` empty) or `batch` (a `LogBatch`, `batch_id` echoed). The server answers every request message with one `IngestResponse`.

### Health

```
rpc Health(HealthRequest) returns (HealthResponse);
```

Returns `{ healthy: true, status: "ok", timestamp }` when the gRPC server is up.

### Messages

**`LogEntry`**

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `id` | string | Unique log ID. **Set this** (for example a UUID). Search is keyed by it. |
| 2 | `timestamp` | `google.protobuf.Timestamp` | When the log was produced. Defaults to receive time. |
| 3 | `level` | `LogLevel` | Severity |
| 4 | `message` | string | Log line. Redacted, and encrypted if the stream says so. |
| 5 | `service` | string | Your bundle or app name. Used for routing, search and OTLP `service.name`. |
| 6 | `instance_id` | string | Instance or pod identifier |
| 7 | `version` | string | Your bundle's version |
| 8 | `attributes` | map<string,string> | Searchable key/value metadata. Redacted, never encrypted. |
| 9 | `tags` | repeated string | Searchable tags. Never encrypted. |
| 10 | `payload` | bytes | Optional rich payload. Redacted only if `payload_content_type` is text-like; can be encrypted. |
| 11 | `payload_content_type` | string | MIME type of `payload` |
| 12 | `trace_id` | string | Trace ID. Use a 32-hex-character W3C ID if you export to an OpenTelemetry Collector. |
| 13 | `span_id` | string | Span ID (16 hex characters for W3C) |
| 14 | `request_id` | string | Request correlation ID |
| 15 | `stream_hint` | string | ID or name of a stream to include first (see [Concepts](./concepts.md#routing-is-fan-out)) |
| 16 | `trusted_source` | bool | Skip redaction and encryption for this entry. Use with care. |

**`LogLevel`**: `LOG_LEVEL_UNSPECIFIED`=0, `LOG_LEVEL_TRACE`=1, `LOG_LEVEL_DEBUG`=2, `LOG_LEVEL_INFO`=3, `LOG_LEVEL_WARN`=4, `LOG_LEVEL_ERROR`=5, `LOG_LEVEL_FATAL`=6.

**`LogBatch`**: `entries` (repeated `LogEntry`), `batch_id` (string, echoed in the response).

**`IngestResponse`**

| Field | Type | Description |
|-------|------|-------------|
| `success` | bool | `true` if the batch was handed to the pipeline |
| `batch_id` | string | Echo of the request's `batch_id` |
| `accepted_count` | int32 | Entries accepted |
| `rejected_count` | int32 | Entries rejected |
| `errors` | repeated string | Error messages when `success` is `false` |
| `backpressure` | bool | `true` when the proxy is under load and shedding logs |
| `suggested_delay_ms` | int32 | How long to wait before sending more: 0, 100 or 1000 |

An empty batch returns `success: true` with zero counts. Processing failures are reported in the response (`success: false`, `rejected_count`, `errors`), not as gRPC status codes.

### Protobuf Definition

Save this as `log_proxy.proto` to generate a client or to use with `buf curl`.

```protobuf
syntax = "proto3";

package firefoundry.logproxy.v1;

import "google/protobuf/timestamp.proto";

enum LogLevel {
  LOG_LEVEL_UNSPECIFIED = 0;
  LOG_LEVEL_TRACE = 1;
  LOG_LEVEL_DEBUG = 2;
  LOG_LEVEL_INFO = 3;
  LOG_LEVEL_WARN = 4;
  LOG_LEVEL_ERROR = 5;
  LOG_LEVEL_FATAL = 6;
}

message LogEntry {
  string id = 1;
  google.protobuf.Timestamp timestamp = 2;
  LogLevel level = 3;
  string message = 4;
  string service = 5;
  string instance_id = 6;
  string version = 7;
  map<string, string> attributes = 8;
  repeated string tags = 9;
  bytes payload = 10;
  string payload_content_type = 11;
  string trace_id = 12;
  string span_id = 13;
  string request_id = 14;
  string stream_hint = 15;
  bool trusted_source = 16;
}

message LogBatch {
  repeated LogEntry entries = 1;
  string batch_id = 2;
}

message IngestResponse {
  bool success = 1;
  string batch_id = 2;
  int32 accepted_count = 3;
  int32 rejected_count = 4;
  repeated string errors = 5;
  bool backpressure = 6;
  int32 suggested_delay_ms = 7;
}

message IngestRequest {
  oneof request {
    LogEntry single = 1;
    LogBatch batch = 2;
  }
}

message HealthResponse {
  bool healthy = 1;
  string status = 2;
  google.protobuf.Timestamp timestamp = 3;
}

message HealthRequest {}

service LogIngestionService {
  rpc Ingest(stream IngestRequest) returns (stream IngestResponse);
  rpc IngestBatch(LogBatch) returns (IngestResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}
```

---

## Search API

**Base path:** `/api/v1/logs`. Results come from the 7-day metadata index. Records look like this:

```json
{
  "id": "log-0002",
  "timestamp": "2026-03-10T12:01:00.000Z",
  "service": "billing-bundle",
  "level": "warn",
  "traceId": "trace-abc-123",
  "requestId": "req-1",
  "streamId": "all-logs",
  "tags": ["billing", "payments"],
  "attributes": { "customer_id": "42" }
}
```

The message and payload are **not** returned. Sensitive-looking attribute keys are never present.

### POST /api/v1/logs/search

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startTime` | string (ISO 8601) | Yes | Start of the range (inclusive) |
| `endTime` | string (ISO 8601) | Yes | End of the range (inclusive) |
| `services` | string[] | No | Any of these services |
| `levels` | string[] | No | Any of `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `traceId` | string | No | Exact trace ID |
| `requestId` | string | No | Exact request ID |
| `streamId` | string | No | Exact stream ID |
| `tags` | string[] | No | Logs with **any** of these tags |
| `attributes` | object (string→string) | No | Logs with **all** of these key/value pairs |
| `messageContains` | string | No | Substring match on the redacted message |
| `limit` | number (1–1000) | No | Page size (default 100) |
| `cursor` | string | No | `cursor` from the previous page |
| `sortOrder` | `asc` \| `desc` | No | Order by timestamp |

**Response:** `{ "logs": [LogRecord], "total": number, "hasMore": boolean, "cursor"?: string }`. Pass `cursor` back for the next page.

### POST /api/v1/logs/aggregate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startTime` | string | Yes | Start of the range |
| `endTime` | string | Yes | End of the range |
| `groupBy` | `service` \| `level` \| `stream` \| `hour` \| `day` | Yes | Grouping key |
| `services` | string[] | No | Service filter |
| `levels` | string[] | No | Level-name filter |

**Response:** `{ "groups": [{ "key": string, "count": number }], "total": number }`, sorted by count descending. For `level`, keys are the numeric level as a string (`"4"` = warn). For `hour` keys look like `YYYY-MM-DD HH:00`, and for `day` like `YYYY-MM-DD` (UTC).

### Other lookups

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/v1/logs/{id}` | One log record, or `404 NOT_FOUND` |
| GET | `/api/v1/logs/trace/{traceId}?limit=` | `{ "traceId", "logs": [LogRecord], "total" }`. `limit` 1–10000, default 1000. |
| GET | `/api/v1/logs/services` | `{ "services": [string] }` |
| GET | `/api/v1/logs/tags` | `{ "tags": [string] }` |

---

## Stream Management API

**Base path:** `/admin/streams`. Requires the admin key. Use this to give your bundle's logs their own redaction policy (see [Concepts — Streams](./concepts.md#streams)).

| Method | Path | Body | Result |
|--------|------|------|--------|
| GET | `/admin/streams` | — | `{ "streams": [StreamSummary], "total": n }` |
| POST | `/admin/streams` | `StreamInput` | Creates the stream with a server-generated UUID `id` |
| PUT | `/admin/streams/{id}` | `StreamInput` | Replaces the stream |
| PUT | `/admin/streams/{id}/enable` | `{ "enabled": boolean }` | Enables or disables the stream |
| DELETE | `/admin/streams/{id}` | — | `{ "message": "Stream deleted successfully" }` |

**Caller-visible limitations in 0.2.0:**

- `POST`, `PUT /{id}` and `PUT /{id}/enable` apply the change but can respond with `400 VALIDATION_ERROR` (details mention `"on": "response"`). Treat that specific error as success and confirm with `GET /admin/streams`.
- `GET /admin/streams/{id}` does not return an existing stream's full definition. Keep your full definitions in version control.
- Streams are held in memory and are lost when the proxy restarts.

**`StreamSummary`**: `id`, `name`, `description`, `priority`, `enabled`, `exporters`, `matcherCount`, `createdAt`, `updatedAt`.

**`StreamInput`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | 1–100 characters |
| `description` | string | No | Up to 500 characters |
| `priority` | number | Yes | 0–10000. Lower numbers are evaluated first. |
| `matchers.services` | string[] | No | Exact service names |
| `matchers.levels` | number[] | No | Numeric levels (1–6) |
| `matchers.tags` | string[] | No | Any-of tag match |
| `matchers.messagePattern` | string | No | JavaScript regex. An invalid regex is ignored. |
| `processing.redaction.patterns` | object | Yes | Booleans, all required: `emails`, `phones`, `creditCards`, `ssn`, `ipAddresses`, `apiKeys` |
| `processing.redaction.customPatterns` | array | Yes (may be empty) | `{ name, regex, replacement }` |
| `processing.redaction.sensitiveFields` | string[] | Yes (may be empty) | Attribute keys whose values become `[REDACTED]` |
| `processing.redaction.llm` | object | No | Accepted but **not implemented** |
| `processing.encryption.encryptPayload` | boolean | Yes | Encrypt `payload` |
| `processing.encryption.encryptMessage` | boolean | Yes | Encrypt `message` |
| `processing.encryption.algorithm` | `"aes-256-gcm"` | Yes | The only supported value |
| `processing.encryption.keyId` | string | Yes | Use `default` unless your administrator configured another key ID |
| `processing.sampling` | number | No | 0–1. Fraction of matching logs to keep. |
| `exporters` | string[] | Yes | Use `["otlp-default"]`. An unknown exporter ID stops delivery to the backend. |
| `enabled` | boolean | Yes | Whether the stream participates in routing |

---

## Live Tail (WebSocket)

**URL:** `ws://<host>:8081/ws/stream`. Authenticate on the upgrade request (see [Authentication](#authentication)); a missing or wrong key returns `401`.

**Client → server** (JSON text frames):

| Message | Description |
|---------|-------------|
| `{"type":"subscribe","filters":{...}}` | Start or replace the subscription. All filters are optional: `services` (string[]), `levels` (number[]), `streams` (string[] of stream IDs), `tags` (string[], any-of), `traceId` (string). |
| `{"type":"unsubscribe"}` | Stop receiving logs |
| `{"type":"ping"}` | Keep-alive |

**Server → client:**

| `type` | Payload |
|--------|---------|
| `connected` | `clientId`, `timestamp` |
| `subscribed` | `success`, `filters` |
| `unsubscribed` | — |
| `pong` | `timestamp` |
| `log` | `entry`: `{ id, timestamp, level (number), service, message, attributes, tags, traceId, spanId, streamId }`. `timestamp` is the processing time. |
| `backpressure` | `dropping: true`, `queueDepth`, `maxQueueDepth`. You are falling behind and logs are being dropped for you. |
| `error` | `message` (invalid JSON or unknown message type) |

Use narrow filters for long-running tails. If a client stops receiving after a `backpressure` message, reconnect.

---

## Health Endpoints

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{"status":"ok","timestamp":"..."}` when the HTTP server is up |
| GET | `/ready` | `200 {"status":"ready",...}` once the service can accept and index logs; `503 {"error":"Service not ready"}` before that |

---

## Error Format

HTTP errors use one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Stream with ID abc not found" } }
```

| HTTP | `code` | When |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | Invalid body, params or query (for example a non-date `startTime`). `details` holds the validator output. |
| 401 | `UNAUTHORIZED` | Missing or wrong `X-API-Key` |
| 404 | `NOT_FOUND` | Unknown route, stream or log ID |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | — | `/ready` before startup completes |

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
- [Overview](./README.md)
