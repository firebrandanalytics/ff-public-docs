# Notification Service

The Notification Service provides cloud-agnostic email, SMS, and push notification delivery through a unified REST API. Any FireFoundry component — agent bundles, bots, or platform services — can send messages without knowing which cloud provider is behind the channel.

## Purpose and Role in Platform

FireFoundry applications frequently need to send notifications: password resets, alert emails, SMS verifications, workflow status updates, and more. The Notification Service centralizes this behind a single API, so every consumer gets:

- **One API for all channels** — Email, SMS, and Push through the same endpoint pattern
- **Provider independence** — Swap providers via admin config; zero consumer code changes
- **Exactly-once delivery** — Race-safe idempotency prevents double-sends
- **Audit trail** — Every send attempt is logged with status and provider message ID

## Key Features

- **Multi-channel support** — Email and SMS today, Push planned
- **Pluggable providers** — ACS shipped; SendGrid, Twilio, AWS SES/SNS can be added without API changes
- **Admin API** — Configure, activate, validate, and switch providers at runtime
- **Idempotency** — Client-provided keys guarantee at-most-once delivery per key
- **Credential safety** — Actual secrets never stored in the database; only environment variable names are saved

## How It Works

```
Your Application
      │
      ▼
┌─────────────┐
│  REST API    │   POST /send/email, /send/sms
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Notification │   Routes to active provider, enforces idempotency
│   Service    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    Cloud     │   ACS, SendGrid, Twilio, etc.
│   Provider   │
└─────────────┘
```

1. Your app sends `POST /send/email` with an `idempotencyKey`
2. The service checks for a duplicate key — if found, returns the previous result
3. If new, the request is dispatched to the active email provider
4. The provider sends the message and the result is recorded
5. Your app receives `202 Accepted` with a notification ID and status

## What This Service Is NOT

- **Not a marketing email platform** — No campaigns, A/B testing, or list management
- **Not a real-time messaging system** — No WebSocket chat, presence, or typing indicators
- **Not a template engine** — Consumers send pre-rendered content (templates may come later)

## Documentation

- **[Concepts](./concepts.md)** — Channels, providers, idempotency, credential model
- **[Getting Started](./getting-started.md)** — Send your first email in minutes
- **[Reference](./reference.md)** — All REST endpoints, request/response schemas, error codes
- **[Operations](./operations.md)** — Provider management, monitoring, troubleshooting, deployment

## Related

- [Platform Architecture](../architecture.md)
- [FF Broker Service](../ff-broker/README.md)
- [FireFoundry SDK](../../../sdk/)
