# Notification Service — Operations Guide

Guide for managing providers, monitoring the service, and troubleshooting issues.

## Provider Management

### Listing Providers

```bash
curl -s http://localhost:8080/admin/providers
```

Returns all configured providers across all channels, including inactive ones.

### Adding a Provider

Create a provider configuration (always created inactive):

```bash
curl -s -X POST http://localhost:8080/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "email",
    "providerType": "acs",
    "config": { "senderAddress": "noreply@your-domain.azurecomm.net" },
    "secretEnvVars": { "connectionString": "ACS_CONNECTION_STRING" }
  }'
```

### Validating a Provider

Before activating, verify credentials and connectivity:

```bash
curl -s -X POST http://localhost:8080/admin/providers/<id>/validate
```

The validate endpoint confirms:
1. All referenced environment variables are present on the service
2. The cloud provider SDK can connect with those credentials

It does **not** send a test message.

### Activating a Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate
```

Only one provider can be active per channel. Activation atomically deactivates any other provider on the same channel. Changes take effect on the next send request.

### Switching Providers

To switch from one provider to another (e.g., ACS to SendGrid for email):

1. Create the new provider config with appropriate credentials set as env vars
2. Validate it
3. Activate it — the previous provider is deactivated in the same operation
4. All subsequent sends use the new provider; no consumer changes needed

```bash
# 1. Create
NEW_ID=$(curl -s -X POST http://localhost:8080/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "email",
    "providerType": "sendgrid",
    "config": { "senderAddress": "noreply@yourdomain.com", "senderName": "FireFoundry" },
    "secretEnvVars": { "apiKey": "SENDGRID_API_KEY" }
  }' | jq -r '.id')

# 2. Validate
curl -s -X POST http://localhost:8080/admin/providers/$NEW_ID/validate

# 3. Activate (atomically switches)
curl -s -X POST http://localhost:8080/admin/providers/$NEW_ID/activate
```

### Updating Provider Config

Update settings without recreating:

```bash
curl -s -X PUT http://localhost:8080/admin/providers/<id> \
  -H 'Content-Type: application/json' \
  -d '{"config": {"senderAddress": "notifications@new-domain.com"}}'
```

### Deleting a Provider

```bash
curl -s -X DELETE http://localhost:8080/admin/providers/<id>
# Returns 204 No Content
```

If the deleted provider was active, the channel will have no active provider. Send requests for that channel will return `CHANNEL_DISABLED` until another provider is activated.

## Monitoring

### Health Checks

| Endpoint | Purpose | Kubernetes Probe |
|----------|---------|------------------|
| `GET /health` | Process is running | `livenessProbe` |
| `GET /ready` | Service can accept traffic | `readinessProbe` |
| `GET /status` | Version, uptime, channel status | Dashboard / manual |

### Key Metrics

| Metric | What to Watch |
|--------|---------------|
| Send response time | P95 under 10s for email, under 2s for SMS |
| Send success rate | Failures by error code (auth, rate limit, invalid recipient) |
| Idempotency hit rate | Ratio of `200 OK` (duplicate) to `202 Accepted` (new) responses |
| Provider error rate | Spikes may indicate provider outage or credential expiry |

### Checking Channel Status

```bash
curl -s http://localhost:8080/status | jq '.channels'
```

```json
{
  "email": {"active": true, "provider": "acs"},
  "sms": {"active": false, "provider": null}
}
```

## Troubleshooting

### All sends return CHANNEL_DISABLED

**Cause:** No active provider for the channel.

**Fix:**
```bash
# List providers
curl -s http://localhost:8080/admin/providers | jq '.[] | {id, channel, providerType, isActive}'

# Activate one
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate
```

### Sends fail with AUTHENTICATION_FAILED

**Cause:** The provider credentials are wrong, expired, or the environment variable is missing.

**Fix:**
1. Validate the provider: `curl -X POST http://localhost:8080/admin/providers/<id>/validate`
2. If `envVarsPresent: false` — the env var name in `secretEnvVars` doesn't match any variable set on the service
3. If `providerConnected: false` — the credential value is invalid; check your provider account

### Sends fail with RATE_LIMITED

**Cause:** The cloud provider is throttling requests.

**Fix:** Reduce send volume or contact the provider to increase limits. Consider implementing client-side backoff.

### Email sends are slow (> 10 seconds)

**Cause:** Email providers may take several seconds to confirm acceptance. This is normal.

**Mitigation:** If consistently slow, check the provider's service health dashboard.

### Email sent (status: "sent") but not received

1. Check spam/junk folders
2. Verify the sender domain is verified in your provider account
3. Check the provider's delivery dashboard for bounce or complaint details
4. Use the `providerMessageId` to look up the message in the provider's admin console

### Service won't start or can't connect to database

1. Verify the service has correct database host and credentials configured
2. Check network connectivity between the service and the database
3. Ensure the database schema has been initialized (the `notification` schema must exist)

### Duplicate emails being sent

**Cause:** The consumer is using a different `idempotencyKey` for each retry.

**Fix:** Idempotency keys must be deterministic and stable across retries. Use patterns like `{action}-{entity}-{id}` (e.g., `welcome-email-user-42`), not random UUIDs.

## Credential Rotation

To rotate a provider credential:

1. Update the environment variable on the service host with the new value
2. Restart the service (or wait for the next deployment)
3. Validate the provider: `curl -X POST http://localhost:8080/admin/providers/<id>/validate`

No database changes or admin API calls are needed — the service reads credentials from environment variables at runtime.

## Security

- Admin endpoints are protected by API key authentication in production deployments
- Actual secrets are never stored in the database or returned by the API
- Provider credentials are resolved from environment variables at runtime
- TLS is enforced for database connections in production

## Deployment

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: 8080) |
| `NODE_ENV` | No | `development`, `production`, or `test` (default: development) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: info) |
| `PG_HOST` | Yes* | PostgreSQL host |
| `PG_SERVER` | Yes* | Azure PG server name (alternative to `PG_HOST`) |
| `PG_PORT` | No | PostgreSQL port (default: 5432) |
| `PG_DATABASE` | No | Database name (default: ff_int_dev_clone) |
| `PG_PASSWORD` | Yes | Database read password |
| `PG_INSERT_PASSWORD` | Yes | Database write password |
| `PG_SSL_DISABLED` | No | Set `true` to disable SSL (local development only) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Yes | Application Insights connection string |

*One of `PG_HOST` or `PG_SERVER` is required.

Provider credentials (e.g., `ACS_CONNECTION_STRING`) must also be set as environment variables — the specific names are configured per-provider via the admin API.

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Related

- [Concepts](./concepts.md) — Core abstractions and mental models
- [Getting Started](./getting-started.md) — Step-by-step setup tutorial
- [Reference](./reference.md) — Complete API reference
- [Overview](./README.md) — Service overview
