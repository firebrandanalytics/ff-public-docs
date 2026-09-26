# Log Proxy Service — Concepts

This page explains what your app sends to the Log Proxy, how streams decide what happens to each log, what redaction does and does not protect, and where logs end up.

## The Log Entry

Every log is a `LogEntry` protobuf message (package `firefoundry.logproxy.v1`). The fields fall into these groups:

| Group | Fields | What to put there |
|-------|--------|-------------------|
| Identity and time | `id`, `timestamp`, `level` | Give every entry a **unique `id`** (a UUID). Search is keyed by it. If `timestamp` is omitted, the proxy uses the time it received the log. |
| Content | `message`, `payload`, `payload_content_type` | `message` is the human-readable line. `payload` is optional structured or binary data. Both can be redacted and encrypted. |
| Source | `service`, `instance_id`, `version` | `service` is your bundle or app name. Streams match on it, search filters on it, and it becomes `service.name` in your backend. |
| Searchable metadata | `attributes` (string map), `tags` (list) | Structured fields you want to filter on. Never encrypted. Attribute values can be redacted. |
| Correlation | `trace_id`, `span_id`, `request_id` | Lets you pull every log for one request or trace. |
| Processing hints | `stream_hint`, `trusted_source` | See [Streams](#streams) and [Trusted Sources](#trusted-sources). |

Levels are `TRACE`=1, `DEBUG`=2, `INFO`=3, `WARN`=4, `ERROR`=5, `FATAL`=6. Stream matchers and live-tail filters use the **numeric** values. The search API uses the lowercase names (`warn`, `error` and so on).

### Designing your log entries

- **Put searchable context in `attributes` and `tags`**, not only in `message`. Search does not return the message text (it can only filter on it), so `order_id`, `customer_tier` or `workflow_step` belong in attributes.
- **Keep secrets out of attribute keys you want indexed.** Attribute keys that look sensitive (containing `password`, `secret`, `token`, `key`, `auth`, `credential` or `private`, case-insensitive) are never written to the search index, whatever their value.
- **Send W3C-style IDs** (32 hex characters for `trace_id`, 16 for `span_id`) if you forward to an OpenTelemetry Collector. Many collectors reject free-form trace IDs.
- **Use one `service` name per bundle**, so you can scope streams, search and live tail to it.

## Streams

A **stream** is a named policy that says:

1. **Which logs** it applies to (its *matchers*)
2. **How to process** them (*redaction*, optional *encryption* and optional *sampling*)
3. **Where to send** them (a list of exporter IDs, normally `["otlp-default"]`)

```json
{
  "name": "billing-errors",
  "priority": 10,
  "matchers": { "services": ["billing-bundle"], "levels": [5, 6] },
  "processing": {
    "redaction": {
      "patterns": { "emails": true, "phones": true, "creditCards": true, "ssn": true, "ipAddresses": true, "apiKeys": true },
      "customPatterns": [{ "name": "account", "regex": "ACCT-[0-9]{6}", "replacement": "[ACCOUNT_REDACTED]" }],
      "sensitiveFields": ["password", "customer_email"]
    },
    "encryption": { "encryptPayload": true, "encryptMessage": false, "algorithm": "aes-256-gcm", "keyId": "default" },
    "sampling": 1.0
  },
  "exporters": ["otlp-default"],
  "enabled": true
}
```

### Matchers

Every matcher is optional. An absent matcher matches everything, and a stream with no matchers matches every log.

| Matcher | Match rule |
|---------|-----------|
| `services` | `service` is exactly one of the listed names |
| `levels` | `level` is one of the listed numeric levels |
| `tags` | The log has **at least one** of the listed tags |
| `messagePattern` | A JavaScript regular expression tested against `message` |

### Routing is fan-out

A log is processed **once for every enabled stream it matches**, not just the first:

1. If the entry's `stream_hint` equals an enabled stream's `id` or `name`, that stream is included first.
2. Every other enabled stream whose matchers match is also included, in priority order (lower number first).
3. If nothing matches, a built-in fallback stream is used.

If a log matches two streams, two processed copies go to live tail and to your backend, each tagged with its `stream_id`.

### The built-in `all-logs` stream

The proxy starts with one listed stream, `all-logs`. It matches every log, redacts emails, phone numbers, credit cards, SSNs and API keys, blanks the attributes `password`, `secret`, `token` and `apiKey`, does not encrypt, and exports to `otlp-default`. **IP addresses are not redacted by default.**

A custom stream runs **in addition to** `all-logs`. So if you add a stricter stream for your bundle, the looser `all-logs` copy still goes out too. To make a stricter policy the *only* policy for your logs, disable `all-logs` and define streams that together cover every producer in the environment. Coordinate this with other teams sharing the environment.

> **Streams are held in memory.** Custom streams and changes to `all-logs` are lost when the proxy restarts. Keep your stream definitions in version control and re-apply them after each deploy (see [Operations](./operations.md#managing-streams)).

## Redaction

For each matching stream, redaction runs before the log is indexed, streamed or exported. It applies to:

- the `message`
- every attribute value
- the `payload`, **only when** `payload_content_type` is text-like (`text/*`, `application/json`, `application/xml`, or anything containing `utf-8`). Binary payloads are not redacted.

| Built-in pattern | Replacement |
|------------------|-------------|
| `emails` | `[EMAIL_REDACTED]` |
| `phones` | `[PHONE_REDACTED]` |
| `creditCards` | `[CREDIT_CARD_REDACTED]` |
| `ssn` | `[SSN_REDACTED]` |
| `ipAddresses` (IPv4) | `[IP_REDACTED]` |
| `apiKeys` | `[API_KEY_REDACTED]` |

### Marking your own sensitive data

You have two tools, both set on a stream:

- **`sensitiveFields`**: attribute keys whose whole value is replaced with `[REDACTED]`. The key must match exactly or in lowercase. Use this for structured fields you know are sensitive, such as `customer_email`, `ssn` or `access_token`.
- **`customPatterns`**: `{ name, regex, replacement }` entries, applied globally to the message, attribute values and text payloads. Use this for your domain's identifiers, such as account numbers or policy IDs.

The most reliable pattern for an app is to **log sensitive values only as attributes with well-known keys**, list those keys in `sensitiveFields`, and let the built-in patterns catch anything that slips into free text.

For example, with the `all-logs` stream, the message `Payment failed for jane@example.com card 4111 1111 1111 1111` with attribute `password=hunter2` becomes `Payment failed for [EMAIL_REDACTED] card [CREDIT_CARD_REDACTED]` with `password=[REDACTED]`.

**Redaction is best-effort.** It is regex-based, so it can miss unusual formats and can over-redact (the phone pattern can match other 10-digit numbers). It reduces accidental leakage; it does not make deliberately logged secrets safe. The stream schema accepts an `llm` block for LLM-assisted redaction, but it is **not implemented yet** and is ignored.

## Encryption

A stream can encrypt the `message` (`encryptMessage`) and/or the `payload` (`encryptPayload`) with AES-256-GCM. Attributes and tags are never encrypted, so they stay searchable.

- An encrypted message leaves the proxy as `enc:v1:<base64>`.
- An encrypted payload's `payload_content_type` becomes `encrypted/aes-256-gcm;v=1;keyId=<id>;original=<original type>`.

The stream's `keyId` must match the proxy's key ID (normally `default`). There is **no decryption API**: your backend, search and live tail see ciphertext. If your team needs to read encrypted values later, arrange access to the key with your environment administrator.

## Trusted Sources

An entry with `trusted_source: true` skips redaction **and** encryption for every stream. The client sets the flag, so use it only for producers whose output you know is safe, and never as a way to get around a policy.

## Delivery and Backpressure

Once processed, logs are buffered durably on the proxy and forwarded to your backend **at least once**. If the backend is down, logs are held and retried, and survive a proxy restart. Duplicates in the backend are possible after a retry.

Every ingestion response tells your client how the proxy is coping:

| `backpressure` | `suggested_delay_ms` | What it means |
|----------------|----------------------|---------------|
| `false` | 0 | Normal |
| `true` | 100 | The proxy is under pressure and is dropping about half of new logs |
| `true` | 1000 | The proxy is critical and is dropping about 90% of new logs |

Clients should wait `suggested_delay_ms` before sending again. "Accepted" in a response means the log entered the pipeline, not that it is guaranteed to reach the backend under pressure.

## Search Index

The proxy keeps a local index of recent log **metadata**: ID, timestamp, service, level, trace ID, request ID, stream ID, tags and non-sensitive attributes.

- It covers the **last 7 days**. Use your backend for anything older.
- The message is stored (redacted) so you can filter with `messageContains`, but search **does not return it**. Use live tail or your backend to read message text.
- It is **keyed by log `id`**. Entries with a missing or duplicate `id` overwrite each other, and a log that matched several streams appears once.

## Live Tail

The live-tail WebSocket pushes processed logs to you as they pass through the proxy, filtered by service, level, stream, tag and trace ID. You see the redacted (and, where configured, encrypted) form, once per matching stream. It is best-effort: a client that falls behind has messages dropped rather than queued.

## How It Fits With Other Services

| Service | Relationship |
|---------|--------------|
| **Your agent bundles and apps** | Send `LogEntry` batches over gRPC with a Connect client. |
| **Your log backend** | Receives exported logs over OTLP/HTTP (usually through an OpenTelemetry Collector). Long-term storage and analytics live there. |
| **[Telemetry Service](../telemetry-service/README.md)** | Separate system for request telemetry. The proxy does not send your application logs there. |

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
- [Overview](./README.md)
