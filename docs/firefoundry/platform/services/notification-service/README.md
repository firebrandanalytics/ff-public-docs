# Notification Service

The Notification Service is a cloud-agnostic platform service that sends email, SMS, and push notifications through a unified REST API. It abstracts over cloud communication providers — starting with Azure Communication Services (ACS) — so that any FireFoundry component can send messages without knowing which provider backs the channel.

## Purpose and Role in Platform

FireFoundry agent bundles, bots, and platform services frequently need to send notifications: password resets, alert emails, SMS verifications, workflow status updates, and more. Without a centralized service, each consumer would integrate directly with a cloud provider, duplicating credentials, retry logic, and configuration.

The Notification Service solves this by:

- **Centralizing delivery** — One REST API for all notification channels
- **Abstracting providers** — Swap from ACS to SendGrid or Twilio via admin config, zero consumer code changes
- **Enforcing idempotency** — Race-safe deduplication prevents double-sends
- **Auditing every send** — Immutable send log with provider message IDs for reconciliation

## Key Features

- **Multi-channel support** — Email and SMS today, Push in Phase 2
- **Pluggable provider adapters** — ACS Email, ACS SMS shipped; architecture supports SendGrid, Twilio, AWS SES/SNS
- **Admin API** — Full CRUD for provider configurations, activation, and connectivity validation
- **Idempotency** — Client-provided keys with database-level dedup (INSERT ON CONFLICT DO NOTHING)
- **Credential safety** — Database stores environment variable *names*, not secrets. Adapters resolve `process.env[configuredEnvVarName]` at runtime
- **Send audit log** — Every attempt recorded with status, provider message ID, and request metadata

## Architecture Overview

```
Consumers (agent bundles, bots, platform services)
        │
        ▼
  ┌─────────────┐
  │   REST API   │  POST /send/email, /send/sms
  └──────┬──────┘
         │
         ▼
  ┌──────────────────┐
  │ Channel Dispatcher│  Route by channel, adapter caching, idempotency check
  └──────┬───────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ Email  │ │  SMS   │   Provider Adapter layer (implements IEmailProvider / ISmsProvider)
│Adapter │ │Adapter │
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌────────┐ ┌────────┐
│ACS SDK │ │ACS SDK │   Cloud provider SDKs (swappable)
└────────┘ └────────┘
```

### Request Flow

1. Consumer sends `POST /send/email` with an `idempotencyKey`
2. Channel Dispatcher resolves the active email provider from the database
3. Dispatcher inserts a send log row with `INSERT ... ON CONFLICT DO NOTHING`
4. If the idempotency key already exists, the existing result is returned (no duplicate send)
5. The provider adapter translates the request into the cloud SDK format
6. ACS Email adapter calls `beginSend` then `pollUntilDone` (with 120s timeout)
7. The send log is updated with the final status and provider message ID
8. Consumer receives `202 Accepted` with the notification ID and status

### Database Architecture

The service uses a dedicated `notification` schema in the shared PostgreSQL database with two tables:

- **`provider_configs`** — Channel/provider combinations with non-sensitive config and env var name mappings. A partial unique index enforces one active provider per channel.
- **`send_log`** — Immutable audit trail of every send attempt. Unique constraint on `idempotency_key` provides race-safe dedup.

Read operations use the `fireread` role; writes use `fireinsert`.

## What This Service Is NOT

- **Not a marketing email platform** — No campaigns, A/B testing, or list management
- **Not a real-time messaging system** — No WebSocket chat, presence, or typing indicators
- **Not a template engine** — Consumers send pre-rendered content (templates may come in Phase 2)
- **Not a voice/video service** — Those require client-side SDKs with fundamentally different abstractions

## Documentation

- **[Concepts](./concepts.md)** — Channels, provider adapters, idempotency model, credential architecture
- **[Getting Started](./getting-started.md)** — Step-by-step from zero to your first email
- **[Reference](./reference.md)** — All REST endpoints, request/response schemas, env vars, error codes
- **[Operations](./operations.md)** — Provider management, monitoring, troubleshooting

## Related

- [Platform Architecture](../architecture.md)
- [FF Broker Service](../ff-broker/README.md)
- [FireFoundry SDK](../../../sdk/)
