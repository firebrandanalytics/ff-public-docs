# Log Proxy Service — Concepts

This page explains the mental model behind the Log Proxy Service: what a log entry looks like, how streams decide what happens to it, and how it moves from ingestion through the buffer to a backend.

## The Log Entry

Every log sent to the proxy is a `LogEntry` protobuf message (package `firefoundry.logproxy.v1`). Its fields fall into these groups:

| Group | Fields | Notes |
|-------|--------|-------|
| Identity and time | `id`, `timestamp`, `level` | Give every entry a unique `id`. The search index is keyed by it (see [Search](#search-index)). If `timestamp` is omitted, the proxy uses its receive time. |
| Content | `message`, `payload`, `payload_content_type` | `message` is the human-readable line. `payload` is optional binary or structured data. Both can be redacted and encrypted. |
| Source | `service`, `instance_id`, `version` | `service` drives stream matching and becomes `service.name` on OTLP export. |
| Searchable metadata | `attributes` (string map), `tags` (list) | Never encrypted, so they stay searchable. Attributes can still be redacted. |
| Tracing | `trace_id`, `span_id`, `request_id` | Used for search and forwarded to the backend. |
| Processing hints | `stream_hint`, `trusted_source` | See [Stream Routing](#stream-routing) and [Trusted Sources](#trusted-sources). |

Levels are an enum: `TRACE`=1, `DEBUG`=2, `INFO`=3, `WARN`=4, `ERROR`=5, `FATAL`=6 (0 is unspecified). Stream matchers and WebSocket filters use these **numeric** values. The search API uses the lowercase names.

## Streams

A **stream** is a named policy that says:

1. **Which logs** it applies to (its *matchers*)
2. **How to process** them (its *redaction*, *encryption* and optional *sampling* settings)
3. **Where to send** them (a list of *exporter IDs*)

```json
{
  "name": "billing-errors",
  "priority": 10,
  "matchers": { "services": ["billing-bundle"], "levels": [5, 6] },
  "processing": {
    "redaction": {
      "patterns": { "emails": true, "phones": true, "creditCards": true, "ssn": true, "ipAddresses": true, "apiKeys": true },
      "customPatterns": [{ "name": "account", "regex": "ACCT-[0-9]{6}", "replacement": "[ACCOUNT_REDACTED]" }],
      "sensitiveFields": ["password"]
    },
    "encryption": { "encryptPayload": true, "encryptMessage": false, "algorithm": "aes-256-gcm", "keyId": "default" },
    "sampling": 1.0
  },
  "exporters": ["otlp-default"],
  "enabled": true
}
```

### Matchers

Every matcher field is optional. When a matcher is present, the log must satisfy it. When it is absent, it matches everything.

| Matcher | Match rule |
|---------|-----------|
| `services` | `service` is exactly one of the listed names |
| `levels` | `level` is one of the listed numeric levels |
| `tags` | The log has **at least one** of the listed tags |
| `messagePattern` | A JavaScript regular expression tested against `message` |

A stream with no matchers matches every log.

### Stream Routing

Routing is **fan-out**, not first-match:

1. If the entry has a `stream_hint` that equals an enabled stream's `id` or `name`, that stream is selected first.
2. Every other enabled stream whose matchers match is **also** selected, in priority order (a lower number means a higher priority).
3. If nothing matched, the built-in `default` stream is used.

The entry is then processed **once per selected stream**. If it matches two streams, two processed copies go to the buffer, the live tail and the exporters, one per stream, each tagged with its `stream_id`.

### The Built-in Streams

The service starts with two streams:

| Stream | Where it lives | Matchers | Redaction | Encryption | Exporters |
|--------|----------------|----------|-----------|------------|-----------|
| `all-logs` ("All Logs") | Listed by `GET /admin/streams`, priority 0 | none (matches everything) | emails, phones, credit cards, SSN, API keys; sensitive fields `password`, `secret`, `token`, `apiKey` | off | `otlp-default` |
| `default` | Internal fallback, not listed | — | same pattern set, plus `api_key` as a sensitive field | payload encryption on | `otlp-default` |

Because `all-logs` matches everything, the `default` fallback is only used if you disable or delete `all-logs`. A custom stream you add runs **in addition to** `all-logs`. To send some logs *only* through a stricter policy, disable `all-logs` and define streams that together cover all your producers.

> **Streams are held in memory.** Streams created through the admin API are not persisted. After a pod restart, only the built-in streams exist until you re-apply your configuration.

## Processing Pipeline

For each (entry, stream) pair the pipeline runs these steps in order:

```
entry ──▶ sampling? ──▶ redaction ──▶ metadata extraction ──▶ encryption ──▶ handlers
                                        (from redacted data)                  ├─ disk buffer
                                                                              ├─ search index
                                                                              └─ WebSocket
```

1. **Sampling.** If the stream sets `sampling` below 1.0, that fraction of entries is kept at random and the rest are skipped for this stream.
2. **Redaction.** Pattern and field redaction is applied (see below). It is skipped for trusted sources.
3. **Metadata extraction.** The searchable metadata is taken from the *redacted* entry. Attribute keys that look sensitive (containing `password`, `secret`, `token`, `key`, `auth`, `credential` or `private`, case-insensitive) are left out of the search index entirely. `instance_id`, `version` and `span_id` are added as index attributes.
4. **Encryption.** The message and/or payload is encrypted if the stream asks for it. This is skipped for trusted sources.
5. **Handlers.** The result goes to the disk buffer, the search index and WebSocket subscribers.

### Redaction

Redaction applies to the `message`, to every attribute value, and to the `payload` when `payload_content_type` is text-like (`text/*`, `application/json`, `application/xml`, or anything containing `utf-8`).

| Built-in pattern | Replacement |
|------------------|-------------|
| `emails` | `[EMAIL_REDACTED]` |
| `phones` | `[PHONE_REDACTED]` |
| `creditCards` | `[CREDIT_CARD_REDACTED]` |
| `ssn` | `[SSN_REDACTED]` |
| `ipAddresses` (IPv4) | `[IP_REDACTED]` |
| `apiKeys` | `[API_KEY_REDACTED]` |

On top of these:

- **`customPatterns`**: `{ name, regex, replacement }` entries. The regex is applied globally.
- **`sensitiveFields`**: attribute keys whose values are replaced with `[REDACTED]`. The key must match exactly, or match in lowercase.

For example, with the `all-logs` stream, the message `Payment failed for jane@example.com card 4111 1111 1111 1111` with attribute `password=hunter2` becomes `Payment failed for [EMAIL_REDACTED] card [CREDIT_CARD_REDACTED]` with `password=[REDACTED]`.

Redaction is pattern-based. It reduces accidental leakage but is not a guarantee. Do not rely on it to make deliberately logged secrets safe. The stream schema has an `llm` block for LLM-assisted redaction, which is **not implemented yet**. The block is accepted and ignored.

### Encryption

When a stream's `encryption` block enables it, the proxy encrypts with **AES-256-GCM**, using a random 12-byte IV per value:

- **`encryptMessage`**: the message is replaced by `enc:v1:<base64>`. The base64 decodes to a JSON envelope `{ v, keyId, algorithm, iv, tag, ciphertext }`.
- **`encryptPayload`**: the payload is replaced by a binary envelope `[version=1][iv (12 bytes)][tag (16 bytes)][ciphertext]`, and `payload_content_type` becomes `encrypted/aes-256-gcm;v=1;keyId=<id>;original=<original type>`.

The key comes from `ENCRYPTION_KEY` (32 bytes, base64) under the ID given by `ENCRYPTION_KEY_ID` (default `default`). The `keyId` in a stream must match that ID. If `ENCRYPTION_KEY` is not set, the service generates a random in-memory key at startup, and anything encrypted with it cannot be decrypted after a restart. The Helm chart generates and keeps a persistent key for you.

The service does **not** currently expose a decryption API. Encrypted values reach exporters and WebSocket subscribers as ciphertext. Keep the key if you need to decrypt offline.

### Trusted Sources

An entry with `trusted_source: true` skips redaction **and** encryption for every stream. The flag is set by the client, so only enable it for producers you control and whose output you know to be safe.

## Buffering and Delivery

Processed logs are appended as NDJSON to **segment files** (`buffer-<timestamp>-<seq>.ndjson`) in `BUFFER_DIR`. A segment rotates when it reaches `BUFFER_MAX_FILE_SIZE`.

A flush timer (every `BUFFER_FLUSH_INTERVAL_MS`) seals the active segment and exports the oldest sealed segment when either condition holds:

- at least `BUFFER_MIN_BATCH_SIZE` logs are waiting
- `BUFFER_MAX_WAIT_MS` has passed since the last flush

Delivery is **at-least-once**, and a segment is deleted only after every target exporter succeeds:

- Each log goes to the exporters listed on its stream.
- If *any* target fails (or an exporter ID does not exist), the whole segment is kept and retried on the next tick.
- If no exporters are configured, logs stay in the buffer and are never silently dropped.
- Segments that remain on disk survive a restart and are exported when the service comes back.

If the buffer would exceed `BUFFER_MAX_TOTAL_SIZE`, the **oldest sealed segment is evicted** (deleted) to make room.

### Backpressure

The buffer reports a state based on its usage (total size ÷ `BUFFER_MAX_TOTAL_SIZE`):

| State | Usage | Effect on writes | Suggested client delay |
|-------|-------|------------------|------------------------|
| `normal` | below `BUFFER_HIGH_WATERMARK` (default 0.9) | all logs written | 0 ms |
| `pressure` | ≥ `BUFFER_HIGH_WATERMARK` | about 50% of logs randomly dropped | 100 ms |
| `critical` | ≥ 0.95 | about 90% of logs randomly dropped | 1000 ms |

Every ingestion response carries `backpressure` and `suggested_delay_ms`, and well-behaved clients should wait that long before sending again.

## Exporters

An **exporter** delivers logs to a backend. The service registers one exporter, `otlp-default`, and only when `OTLP_LOGS_ENDPOINT` is set. It POSTs OTLP/HTTP **JSON** (`resourceLogs`) to that URL:

- Logs are grouped by `service` into resources (`service.name`, `service.instance.id`, `service.version`).
- Levels map to OTLP severity numbers and text.
- `request_id`, `stream_id`, `tags` (comma-joined) and the log's attributes become OTLP attributes.
- `trace_id` and `span_id` are copied onto the log record.

You can enable or disable exporters at runtime through the admin API. A disabled exporter counts as successful and its logs are discarded, so a disabled exporter does not block the buffer. The source tree also contains exporters for Azure Application Insights, Google Cloud Logging, AWS CloudWatch and Datadog, but they **cannot be configured yet**. There is no environment variable or API to register them.

## Search Index

Alongside the buffer, the proxy writes metadata for every processed log to a SQLite database (`search_index.db` in `BUFFER_DIR`):

- It stores `id`, timestamp, service, level, trace ID, request ID, stream ID, tags and non-sensitive attributes. The (redacted, possibly encrypted) message is stored for `messageContains` filtering but is **not returned** by the search API.
- Entries older than **7 days** are pruned every hour.
- The index is **keyed by `id`**. A second log with the same ID replaces the first. That includes entries with no ID, which all share the empty ID. When a log matches several streams, the index keeps only the last copy.

The index is for recent, operational lookups: "what did service X log in the last hour", or "every log for trace T". Long-term retention and analytics belong in the backend the proxy exports to.

## Live Tail

The WebSocket endpoint (`/ws/stream` on port 8081) pushes processed logs to subscribed clients as they pass through the pipeline, filtered by service, level, stream, tag and trace ID. Clients see the processed form: redacted, and encrypted when the stream encrypts. Live tail is best-effort. A slow client is put into a backpressure state and its messages are dropped instead of queued.

## How It Fits With Other Services

| Service | Relationship |
|---------|--------------|
| **Log producers** (platform services, agent bundles) | Send `LogEntry` batches over gRPC. The repository includes a reference Winston-style transport built on the Connect client. |
| **OpenTelemetry Collector / log backend** | Receives exported logs over OTLP/HTTP. Long-term storage and querying live there. |
| **[Telemetry Service](../telemetry-service/README.md)** | Separate system. The proxy *emits* its own operational telemetry events there (`log.ingestion.batch`, `log.pipeline.processed`, `log.buffer.write`, `log.export.batch`, `log.redaction.applied`) as fire-and-forget calls. It does not send your application logs to the Telemetry Service. |

## Related

- [Getting Started](./getting-started.md): try the concepts end to end
- [Reference](./reference.md): exact API shapes
- [Operations](./operations.md): deploying and running the service
- [Overview](./README.md)
