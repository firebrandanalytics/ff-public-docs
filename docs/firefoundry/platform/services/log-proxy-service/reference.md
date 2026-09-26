# Log Proxy Service — Reference

Complete reference for the Log Proxy Service 0.2.0: the gRPC ingestion API, the HTTP API (utility, search and admin), the WebSocket live-tail protocol, error formats and configuration.

## Ports and Base URLs

| Interface | Default port | Protocol | In-cluster URL (default release name) |
|-----------|--------------|----------|---------------------------------------|
| Ingestion | 50051 (`GRPC_PORT`) | gRPC, gRPC-Web and Connect over **HTTP/2 cleartext** | `http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:50051` |
| HTTP API | 3000 (`PORT`) | HTTP/1.1 JSON | `http://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:3000` |
| Live tail | 8081 (`WS_PORT`) | WebSocket | `ws://firefoundry-core-log-proxy-service.<namespace>.svc.cluster.local:8081/ws/stream` |

An OpenAPI 3 document for the HTTP API is served at `GET /openapi` (interactive UI) and `GET /openapi/json` (raw JSON).

---

## gRPC Ingestion API

**Service:** `firefoundry.logproxy.v1.LogIngestionService`

The server does not enable gRPC reflection. Clients need the [protobuf definition](#protobuf-definition). It runs on an HTTP/2-only listener, so HTTP/1.1 clients cannot connect.

Two optional request headers carry trace context. The proxy attaches them to its own telemetry events. They do not change how logs are processed.

| Header | Purpose |
|--------|---------|
| `x-trace-id` | The caller's trace ID. It is continued in the proxy's telemetry events. |
| `x-span-id` | The caller's span ID. It becomes the parent span of the proxy's telemetry events. |

### Ingest (bidirectional stream)

```
rpc Ingest(stream IngestRequest) returns (stream IngestResponse);
```

The recommended RPC for high-volume producers. Each `IngestRequest` carries either a single `LogEntry` or a `LogBatch`, and the server answers every request message with one `IngestResponse`.

| Request (`IngestRequest`, oneof `request`) | Description |
|------|-------------|
| `single` (`LogEntry`) | One log entry. The response's `batch_id` is empty. |
| `batch` (`LogBatch`) | Several entries. The response echoes `batch_id`. |

### IngestBatch (unary)

```
rpc IngestBatch(LogBatch) returns (IngestResponse);
```

A single request/response. Simpler for low-volume clients and for command-line testing.

**Example (`buf curl`):**

```bash
buf curl --http2-prior-knowledge --schema log_proxy.proto \
  --data '{"batchId":"b-1","entries":[{"id":"log-1","level":"LOG_LEVEL_INFO","message":"hello","service":"my-bundle"}]}' \
  http://localhost:50051/firefoundry.logproxy.v1.LogIngestionService/IngestBatch
```

### Health

```
rpc Health(HealthRequest) returns (HealthResponse);
```

Returns `{ healthy: true, status: "ok", timestamp }` whenever the gRPC server is up.

### Messages

**`LogEntry`**

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `id` | string | Unique log ID. **Set this.** The search index is keyed by it. |
| 2 | `timestamp` | `google.protobuf.Timestamp` | When the log was produced. Defaults to receive time if unset. |
| 3 | `level` | `LogLevel` | Severity |
| 4 | `message` | string | Log line. It can be redacted, and encrypted per stream. |
| 5 | `service` | string | Producing service or bundle name. Used for routing and OTLP `service.name`. |
| 6 | `instance_id` | string | Instance or pod identifier |
| 7 | `version` | string | Producer version |
| 8 | `attributes` | map<string,string> | Searchable key/value metadata. Can be redacted, never encrypted. |
| 9 | `tags` | repeated string | Searchable tags. Never encrypted. |
| 10 | `payload` | bytes | Optional rich payload. Redacted if text-like, and can be encrypted. |
| 11 | `payload_content_type` | string | MIME type of `payload`. Decides whether the payload is redacted. |
| 12 | `trace_id` | string | Trace ID (a 32-hex-character W3C ID is recommended if you export to OTLP) |
| 13 | `span_id` | string | Span ID |
| 14 | `request_id` | string | Request correlation ID |
| 15 | `stream_hint` | string | ID or name of a stream to include first (see [Concepts](./concepts.md#stream-routing)) |
| 16 | `trusted_source` | bool | Skip redaction and encryption for this entry |

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
| `backpressure` | bool | `true` when the buffer is in the `pressure` or `critical` state |
| `suggested_delay_ms` | int32 | How long the client should wait before sending more: 0 in `normal`, 100 in `pressure`, 1000 in `critical` |

An empty batch returns `success: true` with zero counts. "Accepted" means the entry entered the pipeline. Under backpressure the buffer may still drop some accepted entries (see [Concepts — Backpressure](./concepts.md#backpressure)).

### Protobuf Definition

Save this as `log_proxy.proto` to generate clients or to use with `buf curl`.

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

## HTTP API — Utility Endpoints

No authentication required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness: `{"status":"ok","timestamp":"..."}` |
| GET | `/ready` | Readiness: `200 {"status":"ready","timestamp":"..."}` once the pipeline, buffer and search index are up; otherwise `503 {"error":"Service not ready"}` |
| GET | `/status` | Service state, version, uptime and counters (below) |
| GET | `/metrics` | Prometheus text exposition |
| GET | `/metrics/json` | The same metrics as JSON |
| GET | `/openapi` | OpenAPI UI; `/openapi/json` returns the raw document |

**`GET /status` response:**

```json
{
  "status": "running",
  "startedAt": "2026-03-10T12:00:00.000Z",
  "uptime": 3600,
  "version": "0.2.0",
  "metrics": {
    "grpc":       { "totalReceived": 1200, "totalAccepted": 1200, "totalRejected": 0 },
    "pipeline":   { "totalProcessed": 1200, "processingErrors": 0, "averageProcessingTimeMs": 0.8 },
    "buffer":     { "totalSize": 0, "totalSegments": 0, "logsBuffered": 0 },
    "exporters":  { "totalExported": 2400, "totalFailed": 0 },
    "search":     { "totalIndexed": 2400, "totalLogs": 1200 },
    "redaction":  { "totalRedactions": 37 },
    "encryption": { "totalEncrypted": 0 }
  }
}
```

`status` is one of `starting`, `running`, `stopping` or `stopped`. Exporter and index counts can exceed ingested counts because each log is processed once per matching stream.

---

## HTTP API — Search Endpoints

**Base path:** `/api/v1/logs`

**Authentication:** if `SEARCH_API_KEY` is set, or failing that `ADMIN_API_KEY`, every request must send it in the `X-API-Key` header. Otherwise the endpoints are open.

All results come from the local 7-day metadata index. Log records have this shape:

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

The message and payload are **not** returned.

### POST /api/v1/logs/search

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startTime` | string (ISO 8601 date-time) | Yes | Start of the time range (inclusive) |
| `endTime` | string (ISO 8601 date-time) | Yes | End of the time range (inclusive) |
| `services` | string[] | No | Match any of these services |
| `levels` | string[] | No | Any of `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `traceId` | string | No | Exact trace ID |
| `requestId` | string | No | Exact request ID |
| `streamId` | string | No | Exact stream ID |
| `tags` | string[] | No | Match logs that have **any** of these tags |
| `attributes` | object (string→string) | No | Match logs that have **all** of these key/value pairs |
| `messageContains` | string | No | Substring match on the stored (redacted) message |
| `limit` | number (1–1000) | No | Page size (default 100) |
| `cursor` | string | No | The `cursor` value from the previous page |
| `sortOrder` | `asc` \| `desc` | No | Order by timestamp |

**Response:** `{ "logs": [LogRecord], "total": number, "hasMore": boolean, "cursor"?: string }`. Pass `cursor` back to fetch the next page. It is an offset.

### POST /api/v1/logs/aggregate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startTime` | string (date-time) | Yes | Start of the range |
| `endTime` | string (date-time) | Yes | End of the range |
| `groupBy` | `service` \| `level` \| `stream` \| `hour` \| `day` | Yes | Grouping key |
| `services` | string[] | No | Service filter |
| `levels` | string[] | No | Level-name filter |

**Response:** `{ "groups": [{ "key": string, "count": number }], "total": number }`, sorted by count descending. For `level`, keys are the **numeric** level as a string (`"4"` = warn). For `hour` the key format is `YYYY-MM-DD HH:00` and for `day` it is `YYYY-MM-DD` (UTC).

### GET /api/v1/logs/{id}

Returns one log record, or `404` with error code `NOT_FOUND`. The `decrypt` and `pin` query parameters are accepted but currently ignored, because decryption is not implemented.

### GET /api/v1/logs/trace/{traceId}

| Query | Type | Description |
|-------|------|-------------|
| `limit` | number (1–10000) | Maximum records (default 1000) |

**Response:** `{ "traceId": string, "logs": [LogRecord], "total": number }`

### GET /api/v1/logs/services

**Response:** `{ "services": [string] }`: the distinct service names in the index.

### GET /api/v1/logs/tags

**Response:** `{ "tags": [string] }`: the distinct tags in the index.

---

## HTTP API — Admin Endpoints

**Base path:** `/admin`

**Authentication:** if `ADMIN_API_KEY` is set, every request needs `X-API-Key: <key>`. A missing or wrong key returns `401 UNAUTHORIZED`. If the variable is unset, the admin API is **open**.

> **Known issue (0.2.0):** several admin endpoints fail their own response validation and return `400 VALIDATION_ERROR` (details include `"on": "response"`) even though the operation **succeeded**. The affected endpoints are marked **(KI)** below. Check the result with `GET /admin/streams` or `GET /admin/exporters/{id}`. See [Operations — Known Issues](./operations.md#known-issues).

### Streams

| Method | Path | Body | Success response |
|--------|------|------|------------------|
| GET | `/admin/streams` | — | `{ "streams": [StreamSummary], "total": n }` |
| GET | `/admin/streams/{id}` **(KI)** | — | Intended: `{ "stream": Stream }`. Currently always `400` for an existing ID; `404` if the stream is not found. |
| POST | `/admin/streams` **(KI)** | `StreamInput` | Intended: `{ "stream": Stream, "message": "Stream created successfully" }`. The stream is created, with a server-generated UUID `id`. |
| PUT | `/admin/streams/{id}` **(KI)** | `StreamInput` | Intended: `{ "stream": Stream, "message": "Stream updated successfully" }`. The stream is replaced. |
| DELETE | `/admin/streams/{id}` | — | `{ "message": "Stream deleted successfully" }` |
| PUT | `/admin/streams/{id}/enable` **(KI)** | `{ "enabled": boolean }` | Intended: `{ "stream": Stream, "message": "Stream enabled successfully" }` or `"... disabled successfully"`. The flag is applied. |

**`StreamSummary`**: `id`, `name`, `description`, `priority`, `enabled`, `exporters`, `matcherCount`, `createdAt`, `updatedAt`.

**`StreamInput`** (body for create and update, validated):

| Field | Type | Required | Constraints / description |
|-------|------|----------|---------------------------|
| `name` | string | Yes | 1–100 characters |
| `description` | string | No | Up to 500 characters |
| `priority` | number | Yes | 0–10000. Lower numbers are evaluated first. |
| `matchers.services` | string[] | No | Exact service names |
| `matchers.levels` | number[] | No | Numeric levels (1–6) |
| `matchers.tags` | string[] | No | Any-of tag match |
| `matchers.messagePattern` | string | No | JavaScript regex. An invalid regex is logged and the matcher is ignored. |
| `processing.redaction.patterns` | object | Yes | Booleans: `emails`, `phones`, `creditCards`, `ssn`, `ipAddresses`, `apiKeys` (all required) |
| `processing.redaction.customPatterns` | array | Yes (may be empty) | `{ name, regex, replacement }` |
| `processing.redaction.sensitiveFields` | string[] | Yes (may be empty) | Attribute keys whose values are replaced with `[REDACTED]` |
| `processing.redaction.llm` | object | No | `{ enabled, modelGroup, categories[], confidenceThreshold (0–1) }`. Accepted but **not implemented**. |
| `processing.encryption.encryptPayload` | boolean | Yes | Encrypt `payload` |
| `processing.encryption.encryptMessage` | boolean | Yes | Encrypt `message` |
| `processing.encryption.algorithm` | `"aes-256-gcm"` | Yes | The only supported value |
| `processing.encryption.keyId` | string | Yes | Must equal the service's `ENCRYPTION_KEY_ID` (default `default`) |
| `processing.sampling` | number | No | 0–1. The fraction of matching logs to keep. |
| `exporters` | string[] | Yes | Exporter IDs, for example `["otlp-default"]`. Every ID must exist, or the buffer cannot drain. |
| `enabled` | boolean | Yes | Whether the stream participates in routing |

### Exporters

| Method | Path | Body | Success response |
|--------|------|------|------------------|
| GET | `/admin/exporters` **(KI)** | — | Intended: `{ "exporters": [...], "total": n }`. Returns `400` whenever at least one exporter is registered; `{"exporters":[],"total":0}` when none are. |
| GET | `/admin/exporters/{id}` | — | `{ "exporter": { "id", "type", "enabled", "isHealthy", "metrics": { "totalExported", "totalFailed", "totalRetried", "queueDepth", "averageLatencyMs", "lastExportTime"?, "lastError"? } } }` |
| PUT | `/admin/exporters/{id}/enable` | `{ "enabled": boolean }` | `{ "message": "Exporter enabled successfully" }` |

There is no endpoint for creating or deleting exporters. The only exporter is `otlp-default`, which is registered at startup when `OTLP_LOGS_ENDPOINT` is set.

### Buffer and Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/buffer` | `{ "metrics": { "totalSegments", "sealedSegments", "totalSize", "oldestSegmentAge", "logsBuffered", "logsWritten", "logsRead", "logsAcknowledged" }, "backpressureState": "normal" \| "pressure" \| "critical", "suggestedDelayMs": n }` |
| POST | `/admin/buffer/flush` | Seals the active segment and tries to export the oldest sealed segment now. Returns `{ "message": "Buffer flush initiated" }` whatever the outcome. |
| GET | `/admin/status` | `{ "streams": { "total" }, "exporters": { "total", "healthy", "enabled" }, "buffer": { "state", "totalSize", "logsBuffered" } }` |

---

## WebSocket Live Tail

**URL:** `ws://<host>:8081/ws/stream`. Any other path returns `404`.

**Authentication:** if `WS_API_KEY` is set (or failing that `ADMIN_API_KEY`), the upgrade request must include the key in one of these forms. Otherwise it fails with `401`.

- the query parameter `?token=<key>`
- the header `Authorization: Bearer <key>`
- the header `X-API-Key: <key>`

**Client → server messages** (JSON text frames):

| Message | Description |
|---------|-------------|
| `{"type":"subscribe","filters":{...}}` | Start (or replace) the subscription. The filters are all optional: `services` (string[]), `levels` (number[]), `streams` (string[] of stream IDs), `tags` (string[], any-of) and `traceId` (string). |
| `{"type":"unsubscribe"}` | Stop receiving logs |
| `{"type":"ping"}` | Keep-alive |

**Server → client messages:**

| `type` | Payload |
|--------|---------|
| `connected` | `clientId`, `timestamp`. Sent on open. |
| `subscribed` | `success`, `filters` |
| `unsubscribed` | — |
| `pong` | `timestamp` |
| `log` | `entry`: `{ id, timestamp, level (number), service, message, attributes, tags, traceId, spanId, streamId }`. `timestamp` is the processing time. |
| `backpressure` | `dropping: true`, `queueDepth`, `maxQueueDepth` (5000). Sent when the client falls behind; logs are dropped for it until the socket drains. |
| `error` | `message`, for invalid JSON or an unknown message type |

---

## Error Format

HTTP errors use one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Stream with ID abc not found" } }
```

| HTTP | `code` | When |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | Invalid request body, params or query (for example a non-date-time `startTime`). `details` holds the validator output. It also appears for the response-validation issue described above. |
| 401 | `UNAUTHORIZED` | Missing or wrong `X-API-Key` on search or admin routes |
| 404 | `NOT_FOUND` | Unknown route, stream, exporter or log ID |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | — | `/ready` before startup completes: `{"error":"Service not ready"}` |

gRPC ingestion reports processing failures inside `IngestResponse` (`success: false`, `rejected_count`, `errors`), not as RPC status codes.

---

## Configuration

All configuration comes from environment variables and is validated at startup. An invalid value, such as a non-numeric port or an unknown `LOG_LEVEL`, stops the service.

### Service

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP API port |
| `GRPC_PORT` | `50051` | gRPC/Connect ingestion port |
| `WS_PORT` | `8081` | WebSocket port |
| `NODE_ENV` | `development` | `development`, `production` or `test`. `test` keeps the search index in memory. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` or `fatal` |
| `SERVICE_VERSION` | `0.2.0` | Version reported by `/status`, `/metrics` and OpenAPI |

### Export

| Variable | Default | Description |
|----------|---------|-------------|
| `OTLP_LOGS_ENDPOINT` | *(unset)* | Full OTLP/HTTP logs URL (for example `http://otel-collector:4318/v1/logs`). When set, it registers the `otlp-default` exporter. When unset or empty, no exporter is registered and logs stay in the buffer. |

### Buffer

| Variable | Default | Description |
|----------|---------|-------------|
| `BUFFER_DIR` | `/var/log-proxy/buffer` | Directory for buffer segments and `search_index.db`. Created if missing. |
| `BUFFER_MAX_FILE_SIZE` | `104857600` (100 MiB) | Segment rotation size in bytes |
| `BUFFER_MAX_TOTAL_SIZE` | `10737418240` (10 GiB) | Buffer size cap. The oldest sealed segments are evicted above it, and it is also the denominator for backpressure. |
| `BUFFER_FLUSH_INTERVAL_MS` | `1000` | How often the flush check runs |
| `BUFFER_MIN_BATCH_SIZE` | `1` | Minimum pending logs before a flush |
| `BUFFER_MAX_WAIT_MS` | `5000` | Flush anyway after this long, even below the minimum batch size |
| `BUFFER_HIGH_WATERMARK` | `0.9` | Usage fraction at which the `pressure` state begins. `critical` is fixed at 0.95. |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_API_KEY` | *(unset)* | Required in `X-API-Key` for `/admin/*`. Also the fallback for the search and WebSocket keys. If unset, those APIs are open. |
| `SEARCH_API_KEY` | *(falls back to `ADMIN_API_KEY`)* | Key for `/api/v1/logs/*` |
| `WS_API_KEY` | *(falls back to `ADMIN_API_KEY`)* | Key for the WebSocket endpoint |
| `ENCRYPTION_KEY` | *(unset)* | Base64-encoded 32-byte AES-256 key. If unset, a random key is generated in memory at every start. |
| `ENCRYPTION_KEY_ID` | `default` | ID under which `ENCRYPTION_KEY` is registered. Streams reference it in `encryption.keyId`. |

### Parsed but Not Used in 0.2.0

These variables are accepted by the configuration schema but have no effect yet: `OTEL_EXPORTER_OTLP_ENDPOINT`, `SERVICE_NAME`, `BUFFER_COMPRESSION`, `MEMORY_HIGH_WATERMARK`, `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_PASSWORD`, `PG_INSERT_PASSWORD`, `PG_SSL_DISABLED`. The service has no database dependency.

The proxy's own telemetry client reads its settings from the platform's shared telemetry configuration. In `firefoundry-core` this is injected through `global.envFrom`.

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
- [Overview](./README.md)
