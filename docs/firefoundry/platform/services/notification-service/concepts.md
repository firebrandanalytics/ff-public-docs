# Notification Service — Concepts

This document explains the core abstractions and mental models behind the Notification Service. Read this before the getting-started guide if you want to understand *why* the service is designed the way it is.

## Channels

A **channel** is a communication medium: `email`, `sms`, or `push`. Channels are the stable abstraction boundary in the service. The REST API, database schema, and internal interfaces are all organized by channel.

Each channel has exactly one **active provider** at any time. When you activate a provider for a channel, the service atomically deactivates any other provider on that same channel. This means consumers never need to specify *which* provider to use — they just say "send an email" and the service routes to whatever is active.

```
Channel           Active Provider
─────────         ───────────────
email      ──▶    ACS Email
sms        ──▶    ACS SMS
push       ──▶    (none — Phase 2)
```

## Provider Adapters

A **provider adapter** implements the channel interface for a specific cloud service. Each adapter translates the normalized notification request into the provider's SDK format and maps the provider's response back to a standard `SendResult`.

Currently shipped adapters:

| Adapter | Channel | Provider | SDK |
|---------|---------|----------|-----|
| `AcsEmailAdapter` | email | Azure Communication Services | `@azure/communication-email` |
| `AcsSmsAdapter` | sms | Azure Communication Services | `@azure/communication-sms` |

The adapter architecture is designed for extension. Adding a new provider (e.g., SendGrid for email) requires:

1. Implementing `IEmailProvider` or `ISmsProvider`
2. Registering the adapter factory in the Channel Dispatcher
3. Creating a provider config via the admin API

No changes to the REST API, database schema, or existing consumers.

### Adapter Lifecycle

```
Admin creates provider config
        │
        ▼
Consumer sends first request for that channel
        │
        ▼
Channel Dispatcher fetches active provider config from DB
        │
        ▼
Adapter factory creates adapter instance (constructor validates credentials)
        │
        ▼
Adapter is cached in memory (cleared on provider activation/deactivation)
        │
        ▼
Subsequent requests reuse cached adapter (no DB lookup)
```

Adapters are cached per-channel. The cache is cleared whenever a provider is activated, deactivated, updated, or deleted through the admin API.

## Credential Model

The Notification Service never stores actual secrets in the database. Instead, it uses an **env var reference** pattern:

```
┌─────────────────────────────────────────────┐
│ Database (provider_configs table)            │
│                                             │
│   secretEnvVars: {                          │
│     "connectionString": "ACS_CONN_STRING"   │  ← env var NAME, not the value
│   }                                         │
└──────────────────────┬──────────────────────┘
                       │
                       ▼ at runtime
┌─────────────────────────────────────────────┐
│ Adapter Constructor                         │
│                                             │
│   const value = process.env["ACS_CONN_STRING"]  │  ← resolves actual secret
│   new EmailClient(value)                    │
└─────────────────────────────────────────────┘
```

This approach means:
- The admin API can configure *which* env var to use without touching secrets
- Secrets live in Kubernetes Secrets, Helm values, or `.env` files — never in the database
- Rotating a credential means updating the environment variable; no DB migration needed
- The validate endpoint (`POST /admin/providers/:id/validate`) checks that required env vars are actually set

### Provider Config Structure

Each provider config has two JSON fields:

| Field | Contains | Example |
|-------|----------|---------|
| `config` | Non-sensitive settings | `{"senderAddress": "noreply@example.azurecomm.net"}` |
| `secretEnvVars` | Env var name mappings | `{"connectionString": "ACS_CONNECTION_STRING"}` |

The `config` field is safe to display in dashboards. The `secretEnvVars` field maps logical credential names to environment variable names that hold the actual secrets.

## Idempotency

Every send request requires a client-provided `idempotencyKey`. This key is the client's guarantee of exactly-once delivery semantics.

### How It Works

The service uses a **database-level** idempotency mechanism:

```sql
INSERT INTO notification.send_log (id, idempotency_key, ...)
VALUES ($1, $2, ...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *
```

- If the insert succeeds (new key), the notification is dispatched to the provider
- If the insert finds a conflict (duplicate key), the existing row is returned without sending again

This is **race-safe**: even if two concurrent requests arrive with the same key, the database unique constraint guarantees only one insert succeeds. The other gets back the existing result.

### Choosing Idempotency Keys

Good idempotency keys are deterministic and scoped to the business action:

| Pattern | Example | Why |
|---------|---------|-----|
| `{action}-{entity}-{id}` | `welcome-email-user-42` | Prevents resending the welcome email to user 42 |
| `{workflow}-{step}-{run}` | `invoice-notify-run-abc` | Prevents duplicate invoice notifications |
| `{caller}-{timestamp}-{hash}` | `bot-17-2024-01-15-a3f2` | Scoped to a specific bot invocation |

Bad patterns: UUIDs (always unique, defeats the purpose), empty strings, or overly broad keys.

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

### Status Transitions

```
accepted ──▶ sent     (provider confirmed acceptance)
         ──▶ failed   (provider rejected or timeout)

Phase 2 additions:
sent     ──▶ delivered (webhook confirmation)
         ──▶ bounced   (webhook bounce notification)
```

| Status | Meaning | When |
|--------|---------|------|
| `accepted` | Request received, send in progress | Immediately after insert |
| `sent` | Provider accepted the message | After successful provider API call |
| `failed` | Send attempt failed | Provider error, timeout, or invalid recipient |
| `delivered` | Recipient confirmed delivery | Phase 2: via provider webhook |
| `bounced` | Message bounced | Phase 2: via provider webhook |

The HTTP response code reflects the outcome:
- `202 Accepted` — New notification dispatched
- `200 OK` — Duplicate idempotency key, returning existing result

## Error Classification

Provider-specific errors are normalized into a standard set of error codes:

| Code | Meaning | Typical Cause |
|------|---------|---------------|
| `VALIDATION_ERROR` | Bad request body | Missing required fields, invalid format |
| `CHANNEL_DISABLED` | No active provider | Channel has no activated provider config |
| `AUTHENTICATION_FAILED` | Provider auth error | Wrong connection string or expired credentials |
| `RATE_LIMITED` | Provider throttling | Too many requests to provider |
| `INVALID_RECIPIENT` | Bad address/number | Malformed email or phone number |
| `PROVIDER_ERROR` | Unclassified failure | Provider SDK error not matching above categories |
| `MISSING_CREDENTIALS` | Env var not set | `secretEnvVars` references an unset env var |

## Channel Dispatcher

The Channel Dispatcher is the internal routing engine. It:

1. Resolves the active provider for the requested channel
2. Creates (or retrieves cached) adapter instances
3. Handles idempotency via the send log
4. Delegates to the adapter for actual delivery
5. Updates the send log with the result

The dispatcher caches adapter instances in memory. The cache is keyed by channel and cleared when any provider config changes via the admin API.

## Related

- [Getting Started](./getting-started.md) — Step-by-step tutorial
- [Reference](./reference.md) — Complete API reference
- [Operations](./operations.md) — Admin workflows and troubleshooting
- [Overview](./README.md) — Service overview and architecture
