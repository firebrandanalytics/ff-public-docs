# Notification Service — Getting Started

This guide walks you through setting up the Notification Service and sending your first email. By the end, you'll have a working notification pipeline from REST API to inbox.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL access (Azure PG or local)
- An Azure Communication Services resource with a verified sender domain
- The `fireread` and `fireinsert` database roles configured

## Step 1: Clone and Install

```bash
git clone https://github.com/firebrandanalytics/ff-services-notification.git
cd ff-services-notification
pnpm install
```

## Step 2: Run the Database Migration

The migration creates a `notification` schema with `provider_configs` and `send_log` tables. Run it with a user that has DDL privileges (not `fireread` or `fireinsert`):

```bash
psql -h <your-pg-host> -U <admin-user> -d <database> \
  -f migrations/V1__create_notification_schema.sql
```

Verify the schema was created:

```bash
psql -h <your-pg-host> -U fireread -d <database> \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'notification';"
```

Expected output:

```
    table_name
------------------
 provider_configs
 send_log
(2 rows)
```

## Step 3: Configure Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Service
PORT=8080
NODE_ENV=development

# Database
PG_HOST=firebrand-ai4bi-pg.postgres.database.azure.com
PG_PORT=5432
PG_DATABASE=ff_int_dev_clone
PG_PASSWORD=<fireread-password>
PG_INSERT_PASSWORD=<fireinsert-password>

# Logging (required by shared-utils)
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost

# ACS credentials (the actual secret — referenced by env var name in provider config)
ACS_CONNECTION_STRING="endpoint=https://your-resource.communication.azure.com/;accesskey=your-key"
```

**Important**: Quote values containing semicolons. The `dotenv` library treats unquoted `;` as inline comment delimiters.

## Step 4: Start the Service

```bash
# Option A: Development mode with hot reload
pnpm dev

# Option B: Build and run
pnpm build && pnpm start
```

Verify it's running:

```bash
curl http://localhost:8080/health
```

```json
{
  "status": "healthy",
  "timestamp": "2026-02-23T02:25:25.233Z"
}
```

## Step 5: Create a Provider Configuration

Before you can send messages, you need to register and activate a provider. The admin API stores non-sensitive config and environment variable *names* — not actual secrets.

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

Note that `isActive` is `false`. The provider won't be used until activated.

### Validate the Provider

Before activating, confirm that the referenced env vars are set and the SDK can connect:

```bash
curl -s -X POST http://localhost:8080/admin/providers/87039403-58cd-4c18-acc5-479bfbca938f/validate
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

If `providerConnected` is `false`, check your `ACS_CONNECTION_STRING` value. Common issues:
- Unquoted semicolons in `.env` (value truncated at `;`)
- Wrong env var name in `secretEnvVars` (case-sensitive)
- Expired or revoked ACS access key

### Activate the Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers/87039403-58cd-4c18-acc5-479bfbca938f/activate
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

Activation is atomic: it deactivates any other provider on the same channel within a database transaction, then activates this one.

## Step 6: Send Your First Email

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

Check your inbox — the email should arrive within a few seconds.

## Step 7: Verify Idempotency

Send the exact same request again:

```bash
curl -s -X POST http://localhost:8080/send/email \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-email-001",
    "to": ["your-email@example.com"],
    "subject": "Hello from Notification Service",
    "html": "<h2>It works!</h2><p>This email was sent through the FireFoundry Notification Service.</p>"
  }'
```

You'll get back the **same result** with the same `id` and `providerMessageId`. No duplicate email is sent. The response code is `200 OK` (not `202 Accepted`) to indicate this was a cached result.

## Step 8: Look Up a Notification

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

## Step 9: Set Up SMS (Optional)

SMS setup follows the same pattern. You'll need an ACS resource with a phone number provisioned.

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

Note that SMS and email can share the same ACS connection string (same resource) but are separate provider configs because they're different channels.

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

### "CHANNEL_DISABLED: No active provider configured for channel 'email'"

No provider is activated for this channel. Check:

```bash
curl http://localhost:8080/admin/providers
```

Look for a provider with the correct channel and `"isActive": true`. If none, activate one:

```bash
curl -X POST http://localhost:8080/admin/providers/<id>/activate
```

### Validate returns `providerConnected: false`

The ACS SDK can't connect. Common causes:

1. **Truncated connection string** — Semicolons in `.env` must be quoted: `ACS_CONNECTION_STRING="endpoint=...;accesskey=..."`
2. **Wrong env var name** — The `secretEnvVars.connectionString` value must exactly match the env var name (case-sensitive)
3. **Missing env var** — The env var exists in `.env` but wasn't loaded. If using `pnpm dev`, the service loads `.env` via dotenv at startup. For production, ensure the env var is set in the container/pod environment.

### Email sent but not received

1. Check the response status — `"status": "sent"` means ACS accepted it
2. Check spam/junk folders
3. Verify the sender domain is verified in Azure Communication Services
4. Check the ACS resource in Azure Portal for delivery status

### Connection timeout to database

Verify database connectivity:

```bash
psql -h <host> -U fireread -d <database> -c "SELECT 1;"
```

Check that `PG_HOST`, `PG_PASSWORD`, and `PG_INSERT_PASSWORD` are set correctly in `.env`.

## Related

- [Concepts](./concepts.md) — How channels, providers, and idempotency work
- [Reference](./reference.md) — Complete API reference
- [Operations](./operations.md) — Admin workflows and monitoring
- [Overview](./README.md) — Service overview and architecture
