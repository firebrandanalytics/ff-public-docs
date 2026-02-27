# Notification Service — Concepts

Core abstractions and mental models for working with the Notification Service.

## Channels

A **channel** is a communication medium: `email`, `sms`, or `push`. The REST API and configuration are organized by channel.

Each channel has exactly one **active provider** at any time. When you activate a provider for a channel, any previously active provider on that channel is automatically deactivated. Consumers never specify which provider to use — they just say "send an email" and the service routes to whatever is active.

```
Channel           Active Provider
─────────         ───────────────
email      ──▶    ACS Email
sms        ──▶    ACS SMS
push       ──▶    (none — planned)
```

## Providers

A **provider** is a cloud service that handles actual message delivery for a channel. The Notification Service ships with Azure Communication Services (ACS) support for email and SMS. The architecture supports adding providers like SendGrid, Twilio, or AWS SES/SNS without changing the API.

Currently available providers:

| Provider | Channels | Description |
|----------|----------|-------------|
| ACS | email, sms | Azure Communication Services |

### Switching Providers

Switching providers is a configuration change, not a code change:

1. Create a new provider config via the admin API
2. Validate that the credentials work
3. Activate it — the previous provider is atomically deactivated

All subsequent sends use the new provider. No consumer changes needed.

## Credential Model

The Notification Service separates credential configuration from credential storage:

- The **admin API** stores the *name* of the environment variable that holds each secret (e.g., `"connectionString": "ACS_CONNECTION_STRING"`)
- The **runtime environment** holds the actual secret values (via Kubernetes Secrets, Helm values, or environment configuration)

This means:
- Secrets never appear in API responses or database records
- You can rotate credentials by updating the environment variable — no service reconfiguration needed
- The `validate` endpoint confirms that required environment variables are present and credentials work

### Provider Config Structure

Each provider config has two configuration objects:

| Field | Contains | Example |
|-------|----------|---------|
| `config` | Non-sensitive settings | `{"senderAddress": "noreply@example.azurecomm.net"}` |
| `secretEnvVars` | Environment variable name mappings | `{"connectionString": "ACS_CONNECTION_STRING"}` |

The `config` field is safe to display in dashboards. The `secretEnvVars` field maps logical names to environment variable names — it does not contain actual secrets.

## Idempotency

Every send request requires a client-provided `idempotencyKey`. This guarantees exactly-once delivery: if the same key is sent twice, the second request returns the original result without resending.

### How It Works

- First request with a given key: the message is sent and the result is recorded
- Subsequent requests with the same key: the stored result is returned immediately (HTTP 200 instead of 202)

This is safe under concurrency — even if two requests with the same key arrive simultaneously, only one message is sent.

### Choosing Idempotency Keys

Good keys are deterministic and scoped to the business action:

| Pattern | Example | Why |
|---------|---------|-----|
| `{action}-{entity}-{id}` | `welcome-email-user-42` | Prevents resending the welcome email to user 42 |
| `{workflow}-{step}-{run}` | `invoice-notify-run-abc` | Prevents duplicate invoice notifications |
| `{caller}-{timestamp}-{hash}` | `bot-17-2024-01-15-a3f2` | Scoped to a specific bot invocation |

Avoid random UUIDs as idempotency keys — they're always unique, which defeats the purpose.

## Send Result and Status Model

Every send request returns a `SendResult`:

```json
{
  "id": "9d2a4225-0a69-4134-9da8-50af6b4df63b",
  "providerMessageId": "84bba3dd-f2a6-4418-81a7-f32941cff81e",
  "status": "sent",
  "channel": "email",
  "provider": "acs",
  "timestamp": "2026-02-23T02:28:39.043Z"
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `accepted` | Request received, send in progress |
| `sent` | Provider accepted the message for delivery |
| `failed` | Send attempt failed (see `error` field) |
| `delivered` | Recipient confirmed delivery (planned — via provider webhooks) |
| `bounced` | Message bounced (planned — via provider webhooks) |

### HTTP Response Codes

- `202 Accepted` — New notification dispatched
- `200 OK` — Duplicate idempotency key; returning existing result

## Error Classification

Provider-specific errors are normalized into a standard set of error codes:

| Code | Meaning |
|------|---------|
| `VALIDATION_ERROR` | Request body failed validation (missing fields, invalid format) |
| `CHANNEL_DISABLED` | No active provider configured for the requested channel |
| `AUTHENTICATION_FAILED` | Provider credentials invalid or expired |
| `RATE_LIMITED` | Provider is throttling requests |
| `INVALID_RECIPIENT` | Provider rejected the recipient address or phone number |
| `PROVIDER_ERROR` | Unclassified provider failure |
| `MISSING_CREDENTIALS` | Required environment variable is not set |

## Related

- [Getting Started](./getting-started.md) — Send your first email
- [Reference](./reference.md) — Complete API reference
- [Operations](./operations.md) — Provider management and troubleshooting
- [Overview](./README.md) — Service overview
