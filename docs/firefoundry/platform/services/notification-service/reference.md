# Notification Service — Reference

Complete API reference for the Notification Service. All endpoints accept and return JSON.

## Send Endpoints

### POST /send/email

Send an email through the active email provider.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idempotencyKey` | string | Yes | Deduplication key (max 256 chars) |
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
| `metadata` | object | No | Arbitrary key-value pairs stored with the notification |

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

### POST /send/sms

Send an SMS through the active SMS provider.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idempotencyKey` | string | Yes | Deduplication key (max 256 chars) |
| `to` | string | Yes | Recipient phone number in E.164 format (e.g., `+15551234567`) |
| `content` | string | Yes | Message text (1-1600 characters) |
| `from` | string | No | Sender number override (defaults to provider config) |
| `correlationId` | string | No | Caller-supplied trace/correlation ID |
| `metadata` | object | No | Arbitrary key-value pairs stored with the notification |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 202 | New notification dispatched | `SendResult` |
| 200 | Duplicate idempotency key | `SendResult` (existing) |
| 400 | Validation error | `ErrorResponse` with field details |
| 422 | No active SMS provider | `ErrorResponse` with `CHANNEL_DISABLED` |
| 500 | Internal error | `ErrorResponse` |

---

## Notification Status

### GET /notifications/{id}

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

## Admin Endpoints

These endpoints manage provider configurations. In production, they are protected by API key authentication.

### GET /admin/providers

List all configured providers across all channels.

**Response:** `ProviderConfig[]`

---

### POST /admin/providers

Create a new provider configuration. Providers are created inactive.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | `email`, `sms`, or `push` |
| `providerType` | string | Yes | `acs`, `sendgrid`, or `twilio` |
| `config` | object | Yes | Non-sensitive provider settings |
| `secretEnvVars` | object | Yes | Maps logical credential names to environment variable names |

**Provider-specific `config` fields:**

| Provider | Channel | Config Fields |
|----------|---------|---------------|
| `acs` | email | `senderAddress` (required) — Verified sender address |
| `acs` | sms | `senderNumber` — Provisioned phone number |
| `sendgrid` | email | `senderAddress`, `senderName` |
| `twilio` | sms | `senderNumber`, `messagingServiceSid` |

**Provider-specific `secretEnvVars` keys:**

| Provider | Required Keys | Description |
|----------|---------------|-------------|
| `acs` | `connectionString` | ACS resource connection string |
| `sendgrid` | `apiKey` | SendGrid API key |
| `twilio` | `accountSid`, `authToken` | Twilio credentials |

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 201 | Created | `ProviderConfig` |
| 400 | Validation error | `ErrorResponse` |
| 409 | Duplicate channel + provider type | `ErrorResponse` |

---

### PUT /admin/providers/{id}

Update an existing provider configuration. Changes take effect on the next send request.

**Request Body:** Any subset of `config` and `secretEnvVars`.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 200 | Updated | `ProviderConfig` |
| 404 | Not found | `ErrorResponse` |

---

### DELETE /admin/providers/{id}

Delete a provider configuration.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 204 | Deleted | (empty) |
| 404 | Not found | `ErrorResponse` |

---

### POST /admin/providers/{id}/activate

Activate a provider for its channel. Any other active provider on the same channel is atomically deactivated. Changes take effect on the next send request.

**Responses:**

| Code | Condition | Body |
|------|-----------|------|
| 200 | Activated | `ProviderConfig` |
| 404 | Not found | `ErrorResponse` |

---

### POST /admin/providers/{id}/validate

Check that the provider's required environment variables are set and the cloud provider can be reached. Does not send a test message.

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

## Platform Endpoints

### GET /health

Liveness probe. Returns 200 if the service is running.

```json
{"status": "healthy", "timestamp": "2026-02-23T02:25:25.233Z"}
```

### GET /ready

Readiness probe. Returns 200 if the service can accept traffic, 503 if not.

```json
{"status": "ready", "timestamp": "2026-02-23T02:25:25.233Z"}
```

### GET /status

Service status including version, uptime, and channel information.

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
| `id` | UUID | Notification ID |
| `providerMessageId` | string | Provider-assigned message ID |
| `status` | string | `accepted`, `sending`, `sent`, `delivered`, `bounced`, or `failed` |
| `channel` | string | `email` or `sms` |
| `provider` | string | Provider name (e.g., `acs`) |
| `timestamp` | string | ISO 8601 timestamp |
| `error` | string | Error message (present only when `status` is `failed`) |

### NotificationDetail

Returned by `GET /notifications/{id}`. Includes all `SendResult` fields plus:

| Field | Type | Description |
|-------|------|-------------|
| `idempotencyKey` | string | The deduplication key |
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
| `secretEnvVars` | object | Environment variable name mappings |
| `createdAt` | string | ISO 8601 creation timestamp |
| `updatedAt` | string | ISO 8601 last update timestamp |

### ErrorResponse

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error code (see below) |
| `message` | string | Human-readable error description |
| `details` | object[] | Field-level validation errors (for `VALIDATION_ERROR` only) |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `NOT_FOUND` | 404 | Resource not found |
| `CHANNEL_DISABLED` | 422 | No active provider configured for the requested channel |
| `DUPLICATE_REQUEST` | 200 | Idempotency key already exists (returns existing result) |
| `AUTHENTICATION_FAILED` | 502 | Provider credentials invalid or expired |
| `RATE_LIMITED` | 502 | Provider is throttling requests |
| `INVALID_RECIPIENT` | 502 | Provider rejected the recipient address or number |
| `PROVIDER_ERROR` | 502 | Unclassified provider error |
| `MISSING_CREDENTIALS` | 500 | Required environment variable is not set |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Related

- [Concepts](./concepts.md) — Core abstractions and mental models
- [Getting Started](./getting-started.md) — Step-by-step tutorial
- [Operations](./operations.md) — Provider management and troubleshooting
- [Overview](./README.md) — Service overview
