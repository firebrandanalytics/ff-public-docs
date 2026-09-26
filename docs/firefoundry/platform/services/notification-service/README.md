# Notification Service

## Overview

The Notification Service sends email and SMS through a single REST API. Agent bundles, bots, and application backends send a message by channel ("send an email") without knowing which cloud provider delivers it.

## Purpose and Role in Platform

FireFoundry applications frequently need to notify people: alert emails, verification SMS, workflow status updates, reports ready for review. The Notification Service puts this behind one API, so your application gets:

- **One API for all channels** — Email and SMS through the same endpoint pattern
- **Provider independence** — The delivery provider is chosen by configuration, not by your code
- **Exactly-once sends** — Client-supplied idempotency keys make retries safe
- **Audit trail** — Every send can be looked up later with its status and provider message ID

## Key Features

- **Email** — To/CC/BCC, HTML and/or text bodies, reply-to, and attachments
- **SMS** — E.164 phone numbers, up to 1600 characters
- **Idempotency** — Repeating a request with the same key returns the original result instead of sending again
- **Correlation and metadata** — Attach your own trace ID and key-value metadata to each notification
- **Provider admin API** — Configure, validate, and switch providers at runtime without consumer changes
- **Credential safety** — Provider secrets are never returned by the API; configurations reference them by environment variable name

## Architecture Overview

```
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Your Agent Bundle / bots /   │   │ Your environment admin   │
│ application backend          │   │ (provider setup)         │
└──────────────┬───────────────┘   └────────────┬─────────────┘
               │ POST /send/email, /send/sms     │ /admin/providers
               │ GET /notifications/{id}         │
               ▼                                 ▼
        ┌─────────────────────────────────────────────┐
        │            Notification Service              │
        │  validates · de-duplicates · routes by channel│
        └──────────────────────┬──────────────────────┘
                               │ active provider per channel
                               ▼
        ┌─────────────────────────────────────────────┐
        │  Cloud delivery provider                     │
        │  (Azure Communication Services today)        │
        └─────────────────────────────────────────────┘
```

1. Your app sends `POST /send/email` with an `idempotencyKey`
2. If that key was already used, the service returns the earlier result (`200 OK`) without sending
3. Otherwise the message goes to the channel's active provider
4. Your app receives `202 Accepted` with a notification ID and status, which it can look up later

## What This Service Is NOT

- **Not a marketing email platform** — No campaigns, A/B testing, or list management
- **Not a real-time messaging system** — No WebSocket chat, presence, or typing indicators
- **Not a template engine** — Send pre-rendered content; render templates in your bundle

## Documentation

- **[Concepts](./concepts.md)** — Channels, providers, idempotency, status model, and design guidance
- **[Getting Started](./getting-started.md)** — Send your first email and SMS
- **[Reference](./reference.md)** — REST endpoints, request/response schemas, error codes
- **[Operations](./operations.md)** — Enabling the service, provider setup, verifying, limits, troubleshooting

## Version and Maturity

- **Current Version**: 0.2.0
- **Deployment**: **Opt-in** (`notification-service.enabled: false` by default in `firefoundry-core`)
- **Channels**: Email and SMS available; Push is planned
- **Providers**: Azure Communication Services (`acs`) available; other providers (e.g. SendGrid, Twilio) are planned
- **Delivery tracking**: `delivered` / `bounced` statuses are planned; today the final status is `sent` or `failed`

## Repository

Source code: `ff-services-notification` (FireFoundry Notification Service).

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [FF Broker Service](../ff-broker/README.md)
