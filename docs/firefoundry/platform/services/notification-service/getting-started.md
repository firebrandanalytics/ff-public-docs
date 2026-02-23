# Notification Service — Getting Started

This guide walks you through configuring the Notification Service and sending your first email.

## Prerequisites

- A running Notification Service instance (deployed via FireFoundry platform or self-hosted)
- The service URL (e.g., `http://localhost:8080` for local development)
- An Azure Communication Services resource with a verified sender domain
- The ACS connection string set as an environment variable on the service

## Step 1: Verify the Service is Running

```bash
curl http://localhost:8080/health
```

```json
{
  "status": "healthy",
  "timestamp": "2026-02-23T02:25:25.233Z"
}
```

## Step 2: Create a Provider Configuration

Before you can send messages, you need to register and activate a provider. The admin API stores non-sensitive settings and the *names* of environment variables that hold secrets — never the secrets themselves.

### Register the ACS Email Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "email",
    "providerType": "acs",
    "config": {
      "senderAddress": "DoNotReply@your-domain.azurecomm.net"
    },
    "secretEnvVars": {
      "connectionString": "ACS_CONNECTION_STRING"
    }
  }'
```

Response:

```json
{
  "id": "87039403-58cd-4c18-acc5-479bfbca938f",
  "channel": "email",
  "providerType": "acs",
  "isActive": false,
  "config": {
    "senderAddress": "DoNotReply@your-domain.azurecomm.net"
  },
  "secretEnvVars": {
    "connectionString": "ACS_CONNECTION_STRING"
  },
  "createdAt": "2026-02-23T02:25:35.332Z",
  "updatedAt": "2026-02-23T02:25:35.332Z"
}
```

Note that `isActive` is `false`. The provider won't be used until you activate it.

## Step 3: Validate the Provider

Confirm that the referenced environment variables are set and the provider can connect:

```bash
curl -s -X POST http://localhost:8080/admin/providers/<id>/validate
```

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

If `providerConnected` is `false`, check that:
- The environment variable name in `secretEnvVars` matches an env var set on the service
- The credential value is valid and not expired
- The sender domain is verified in your provider account

## Step 4: Activate the Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate
```

```json
{
  "id": "87039403-58cd-4c18-acc5-479bfbca938f",
  "channel": "email",
  "providerType": "acs",
  "isActive": true,
  ...
}
```

Activation is atomic: if another provider was active on the same channel, it is deactivated in the same operation.

## Step 5: Send Your First Email

```bash
curl -s -X POST http://localhost:8080/send/email \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-email-001",
    "to": ["your-email@example.com"],
    "subject": "Hello from Notification Service",
    "html": "<h2>It works!</h2><p>This email was sent through the FireFoundry Notification Service.</p>",
    "text": "It works! This email was sent through the FireFoundry Notification Service."
  }'
```

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

A `202 Accepted` response with `"status": "sent"` means the provider accepted the message for delivery.

## Step 6: Verify Idempotency

Send the exact same request again (same `idempotencyKey`):

```bash
curl -s -X POST http://localhost:8080/send/email \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-email-001",
    "to": ["your-email@example.com"],
    "subject": "Hello from Notification Service",
    "html": "<h2>It works!</h2>"
  }'
```

You'll get back the **same result** with the same `id` and `providerMessageId`. No duplicate email is sent. The response code is `200 OK` (instead of `202 Accepted`) to indicate this was an existing result.

## Step 7: Look Up a Notification

Retrieve the full details of any sent notification:

```bash
curl -s http://localhost:8080/notifications/9d2a4225-0a69-4134-9da8-50af6b4df63b
```

```json
{
  "id": "9d2a4225-0a69-4134-9da8-50af6b4df63b",
  "providerMessageId": "84bba3dd-f2a6-4418-81a7-f32941cff81e",
  "status": "sent",
  "channel": "email",
  "provider": "acs",
  "timestamp": "2026-02-23T02:28:38.968Z",
  "idempotencyKey": "test-email-001",
  "createdAt": "2026-02-23T02:28:38.968Z",
  "updatedAt": "2026-02-23T02:28:42.976Z"
}
```

## Step 8: Set Up SMS (Optional)

SMS follows the same pattern. You'll need a phone number provisioned in your provider account.

### Register the ACS SMS Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "sms",
    "providerType": "acs",
    "config": {
      "senderNumber": "+15551234567"
    },
    "secretEnvVars": {
      "connectionString": "ACS_CONNECTION_STRING"
    }
  }'
```

SMS and email can share the same provider credentials (same cloud resource) but are separate provider configs because they're different channels.

### Activate and Send

```bash
# Activate
curl -s -X POST http://localhost:8080/admin/providers/<sms-provider-id>/activate

# Send
curl -s -X POST http://localhost:8080/send/sms \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-sms-001",
    "to": "+15559876543",
    "content": "Hello from FireFoundry Notification Service"
  }'
```

## Troubleshooting

### "CHANNEL_DISABLED: No active provider configured"

No provider is activated for this channel. List providers and activate one:

```bash
# Check which providers exist
curl -s http://localhost:8080/admin/providers

# Activate one
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate
```

### Validate returns `providerConnected: false`

The service can't connect to the cloud provider. Check:
1. The environment variable name in `secretEnvVars` is correct (case-sensitive)
2. The environment variable is set on the service host with a valid credential
3. The credential hasn't expired or been revoked

### Email sent but not received

1. Check the response — `"status": "sent"` means the provider accepted it
2. Check spam/junk folders
3. Verify the sender domain is verified in your provider account

### Send requests are slow

Email sends may take several seconds because the provider confirms acceptance before responding. This is normal. If sends consistently exceed 30 seconds, check your provider's service health.

## Related

- [Concepts](./concepts.md) — How channels, providers, and idempotency work
- [Reference](./reference.md) — Complete API reference
- [Operations](./operations.md) — Provider management and monitoring
- [Overview](./README.md) — Service overview
