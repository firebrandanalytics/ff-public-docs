# Notification Service — Reference

Complete API reference for the Notification Service. All endpoints accept and return JSON unless otherwise noted.

## REST API

### Send Endpoints

#### POST /send/email

Send an email through the active email provider.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idempotencyKey` | string | Yes | Client-provided deduplication key (max 256 chars) |
| `to` | string[] | Yes | Recipient email addresses (1-50) |
| `subject` | string | Yes | Email subject line |
| `html` | string | No | HTML body (at least one of `html`/`text` required) |
| `text` | string | No | Plain text body (at least one of `html`/`text` required) |
| `from` | string | No | Sender address override (defaults to provider config) |
| `replyTo` | string | No | Reply-to address |
| `cc` | string[] | No | CC recipients (max 50) |
| `bcc` | string[] | No | BCC recipients (max 50) |
| `attachments` | object[] | No | File attachments (max 10) |
| `attachments[].name` | string | Yes | Filename |
| `attachments[].contentType` | string | Yes | MIME type |
| `attachments[].contentBase64` | string | Yes | Base64-encoded file content |
| `correlationId` | string | No | Caller-supplied trace/correlation ID |
| `metadata` | object | No | Arbitrary key-value pairs for caller use |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 202 | New notification dispatched | `SendResult` |
| 200 | Duplicate idempotency key | `SendResult` (existing) |
| 400 | Validation error | `ErrorResponse` with field details |
| 422 | No active email provider | `ErrorResponse` with `CHANNEL_DISABLED` |
| 500 | Internal error | `ErrorResponse` |

**Example:**

```bash
curl -X POST http://localhost:8080/send/email \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "welcome-user-42",
    "to": ["user@example.com"],
    "subject": "Welcome",
    "html": "<p>Welcome to the platform!</p>",
    "correlationId": "signup-flow-abc"
  }'
```

---

#### POST /send/sms

Send an SMS through the active SMS provider.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idempotencyKey` | string | Yes | Client-provided deduplication key (max 256 chars) |
| `to` | string | Yes | Recipient phone number in E.164 format (e.g., `+15551234567`) |
| `content` | string | Yes | Message text (1-1600 characters) |
| `from` | string | No | Sender number override (defaults to provider config) |
| `correlationId` | string | No | Caller-supplied trace/correlation ID |
| `metadata` | object | No | Arbitrary key-value pairs for caller use |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 202 | New notification dispatched | `SendResult` |
| 200 | Duplicate idempotency key | `SendResult` (existing) |
| 400 | Validation error | `ErrorResponse` with field details |
| 422 | No active SMS provider | `ErrorResponse` with `CHANNEL_DISABLED` |
| 500 | Internal error | `ErrorResponse` |

---

### Notification Status

#### GET /notifications/{id}

Retrieve the full details of a sent notification.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Notification ID (returned by send endpoints) |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 200 | Found | `NotificationDetail` |
| 404 | Not found | `ErrorResponse` |

---

### Admin Endpoints

These endpoints manage provider configurations. In production deployments, they are protected by Kong gateway API key authentication.

#### GET /admin/providers

List all configured providers across all channels.

**Response:** `ProviderConfig[]`

---

#### POST /admin/providers

Create a new provider configuration. The provider is created in an inactive state.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | `email`, `sms`, or `push` |
| `providerType` | string | Yes | `acs`, `sendgrid`, or `twilio` |
| `config` | object | Yes | Non-sensitive provider settings |
| `secretEnvVars` | object | Yes | Maps logical names to env var names |

**Provider-specific `config` fields:**

| Provider Type | Channel | Config Fields |
|---------------|---------|---------------|
| `acs` | email | `senderAddress` (required) — Verified ACS sender address |
| `acs` | sms | `senderNumber` — ACS phone number |
| `sendgrid` | email | `senderAddress`, `senderName` |
| `twilio` | sms | `senderNumber`, `messagingServiceSid` |

**Provider-specific `secretEnvVars` keys:**

| Provider Type | Required Keys | Description |
|---------------|---------------|-------------|
| `acs` | `connectionString` | ACS resource connection string |
| `sendgrid` | `apiKey` | SendGrid API key |
| `twilio` | `accountSid`, `authToken` | Twilio credentials |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 201 | Created | `ProviderConfig` |
| 400 | Validation error | `ErrorResponse` |
| 409 | Duplicate channel+providerType | `ErrorResponse` |

---

#### PUT /admin/providers/{id}

Update an existing provider configuration. Clears the adapter cache.

**Request Body:** Any subset of `config` and `secretEnvVars`.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 200 | Updated | `ProviderConfig` |
| 404 | Not found | `ErrorResponse` |

---

#### DELETE /admin/providers/{id}

Delete a provider configuration. Clears the adapter cache.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 204 | Deleted | (empty) |
| 404 | Not found | `ErrorResponse` |

---

#### POST /admin/providers/{id}/activate

Activate a provider for its channel. This atomically deactivates any other provider on the same channel (within a database transaction) and activates this one. Clears the adapter cache.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 200 | Activated | `ProviderConfig` |
| 404 | Not found | `ErrorResponse` |

---

#### POST /admin/providers/{id}/validate

Check that the provider's required environment variables are set and that the cloud SDK can initialize successfully. Does not send a test message.

**Response:**

```json
{
  "valid": true,
  "checks": {
    "envVarsPresent": true,
    "providerConnected": true
  },
  "errors": []
}
```

| Code | Condition | Body |
|------|-----------|------|
| 200 | Validation complete | `ValidationResult` |
| 404 | Provider not found | `ErrorResponse` |

---

### Platform Endpoints

#### GET /health

Liveness probe. Returns 200 if the process is running.

```json
{"status": "healthy", "timestamp": "2026-02-23T02:25:25.233Z"}
```

#### GET /ready

Readiness probe. Returns 200 if the service can accept traffic, 503 if not.

```json
{"status": "ready", "timestamp": "2026-02-23T02:25:25.233Z"}
```

#### GET /status

Detailed service status including version, uptime, and channel information.

```json
{
  "service": "ff-services-notification",
  "version": "0.1.1",
  "uptime": 3600,
  "environment": "development",
  "channels": {
    "email": {"active": true, "provider": "acs"},
    "sms": {"active": false, "provider": null}
  }
}
```

---

## Response Schemas

### SendResult

Returned by `POST /send/email` and `POST /send/sms`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Internal notification ID |
| `providerMessageId` | string | Provider-assigned message ID (for webhook reconciliation) |
| `status` | string | `accepted`, `sending`, `sent`, `delivered`, `bounced`, or `failed` |
| `channel` | string | `email` or `sms` |
| `provider` | string | Provider name (e.g., `acs`) |
| `timestamp` | string | ISO 8601 timestamp |
| `error` | string | Error message (present only when `status` is `failed`) |

### NotificationDetail

Returned by `GET /notifications/{id}`. Extends `SendResult` with:

| Field | Type | Description |
|-------|------|-------------|
| `idempotencyKey` | string | Client-provided dedup key |
| `correlationId` | string | Caller-supplied trace ID (if provided) |
| `metadata` | object | Caller-supplied metadata (if provided) |
| `createdAt` | string | ISO 8601 creation timestamp |
| `updatedAt` | string | ISO 8601 last update timestamp |

### ProviderConfig

Returned by admin endpoints.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Provider config ID |
| `channel` | string | `email`, `sms`, or `push` |
| `providerType` | string | `acs`, `sendgrid`, or `twilio` |
| `isActive` | boolean | Whether this provider is active for its channel |
| `config` | object | Non-sensitive provider settings |
| `secretEnvVars` | object | Env var name mappings |
| `createdAt` | string | ISO 8601 creation timestamp |
| `updatedAt` | string | ISO 8601 last update timestamp |

### ErrorResponse

Returned on error.

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error code (see Error Codes below) |
| `message` | string | Human-readable error description |
| `details` | object[] | Field-level validation errors (for `VALIDATION_ERROR`) |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed Zod schema validation |
| `NOT_FOUND` | 404 | Resource not found |
| `CHANNEL_DISABLED` | 422 | No active provider configured for the requested channel |
| `DUPLICATE_REQUEST` | 200 | Idempotency key already exists (returns existing result) |
| `AUTHENTICATION_FAILED` | 502 | Provider credentials invalid or expired |
| `RATE_LIMITED` | 502 | Provider is throttling requests |
| `INVALID_RECIPIENT` | 502 | Provider rejected the recipient address/number |
| `PROVIDER_ERROR` | 502 | Unclassified provider SDK error |
| `MISSING_CREDENTIALS` | 500 | Required environment variable is not set |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Environment Variables

### Service Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `SERVICE_NAME` | `ff-services-notification` | Service name for logging |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `PG_HOST` | — | Direct PostgreSQL host (e.g., `localhost`) |
| `PG_SERVER` | — | Azure PG server name (auto-appends `.postgres.database.azure.com`) |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | `ff_int_dev_clone` | Database name |
| `PG_PASSWORD` | — | Password for `fireread` user |
| `PG_INSERT_PASSWORD` | — | Password for `fireinsert` user (falls back to `PG_PASSWORD`) |
| `PG_SSL_DISABLED` | — | Set to `true` to disable SSL (local development only) |

One of `PG_HOST` or `PG_SERVER` is required. SSL is enabled by default; `rejectUnauthorized` is `true` in production, `false` in development.

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | — | Required by `@firebrandanalytics/shared-utils` logger |

### Provider Credentials

These are user-defined env var names configured via the admin API. The service doesn't hardcode any specific credential variable names. Example:

| Variable | Description |
|----------|-------------|
| `ACS_CONNECTION_STRING` | Azure Communication Services connection string |

---

## Database Schema

### Schema: `notification`

#### Table: `provider_configs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `channel` | VARCHAR(20) | `email`, `sms`, or `push` |
| `provider_type` | VARCHAR(50) | `acs`, `sendgrid`, `twilio` |
| `is_active` | BOOLEAN | Active flag (one active per channel enforced by partial unique index) |
| `config` | JSONB | Non-sensitive settings |
| `secret_env_vars` | JSONB | Env var name mappings |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Last update time (auto-refreshed by trigger) |

**Constraints:**
- `uq_provider_configs_channel_provider` — Unique on `(channel, provider_type)`
- `uq_active_provider_per_channel` — Partial unique index on `(channel) WHERE is_active = true`

#### Table: `send_log`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `idempotency_key` | VARCHAR(256) | Unique — client deduplication key |
| `channel` | VARCHAR(20) | Channel used |
| `provider` | VARCHAR(50) | Provider used |
| `status` | VARCHAR(20) | Current status |
| `provider_message_id` | VARCHAR(512) | Provider-assigned ID (for webhooks) |
| `correlation_id` | VARCHAR(256) | Caller-supplied trace ID |
| `metadata` | JSONB | Caller-supplied metadata |
| `request` | JSONB | Original request (attachments stripped) |
| `response` | JSONB | Provider response |
| `error` | TEXT | Error detail |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

**Indexes:**
- `idempotency_key` — Unique (from constraint)
- `idx_send_log_provider_message_id` — Partial on `provider_message_id IS NOT NULL`
- `idx_send_log_status` — For monitoring queries
- `idx_send_log_created_at` — For time-range queries and retention

---

## Version Information

- **Current Version**: 0.1.1
- **Node.js**: 20+
- **Runtime**: TypeScript (ESM)
- **Framework**: Express 5
- **Test Framework**: Vitest + Supertest
- **Database**: PostgreSQL 14+

## Related

- [Concepts](./concepts.md) — Core abstractions and mental models
- [Getting Started](./getting-started.md) — Step-by-step tutorial
- [Operations](./operations.md) — Admin workflows and troubleshooting
- [Overview](./README.md) — Service overview and architecture
