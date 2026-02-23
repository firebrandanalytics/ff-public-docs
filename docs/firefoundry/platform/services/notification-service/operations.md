# Notification Service — Operations Guide

Day-to-day guide for managing providers, monitoring the service, and troubleshooting issues.

## Provider Management

### Listing Providers

```bash
curl -s http://localhost:8080/admin/providers | jq
```

This returns all configured providers across all channels, including inactive ones.

### Adding a New Provider

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
curl -s -X POST http://localhost:8080/admin/providers/<id>/validate | jq
```

The validate endpoint checks:
1. All keys in `secretEnvVars` resolve to non-empty environment variables
2. The cloud SDK client can be instantiated with those credentials

It does **not** send a test message.

### Activating a Provider

```bash
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate | jq
```

This runs in a database transaction:
1. `BEGIN`
2. Deactivate all providers on the same channel
3. Activate the target provider
4. `COMMIT`

The adapter cache is cleared, so the next send request will create a fresh adapter with the new provider's config.

### Switching Providers

To switch from ACS to SendGrid for email:

1. Create the SendGrid provider config (with appropriate env vars set)
2. Validate it
3. Activate it — this atomically deactivates ACS and activates SendGrid
4. All subsequent email sends use SendGrid; no consumer changes needed

```bash
# 1. Create
curl -s -X POST http://localhost:8080/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "email",
    "providerType": "sendgrid",
    "config": { "senderAddress": "noreply@yourdomain.com", "senderName": "FireFoundry" },
    "secretEnvVars": { "apiKey": "SENDGRID_API_KEY" }
  }' | jq '.id'

# 2. Validate
curl -s -X POST http://localhost:8080/admin/providers/<new-id>/validate | jq

# 3. Activate (atomically switches)
curl -s -X POST http://localhost:8080/admin/providers/<new-id>/activate | jq
```

### Updating Provider Config

Update non-sensitive settings without recreating:

```bash
curl -s -X PUT http://localhost:8080/admin/providers/<id> \
  -H 'Content-Type: application/json' \
  -d '{"config": {"senderAddress": "notifications@new-domain.com"}}'
```

### Deleting a Provider

```bash
curl -s -X DELETE http://localhost:8080/admin/providers/<id>
# Returns 204 No Content on success
```

If the deleted provider was active, the channel will have no active provider. Send requests for that channel will return `CHANNEL_DISABLED` until another provider is activated.

## Monitoring

### Health Checks

| Endpoint | Purpose | Kubernetes Probe |
|----------|---------|------------------|
| `GET /health` | Process is running | `livenessProbe` |
| `GET /ready` | Service can accept traffic | `readinessProbe` |
| `GET /status` | Version, uptime, channel status | Dashboard / manual |

### Key Metrics to Watch

**Request-level:**
- Send endpoint response times (P50, P95, P99)
- Send success rate vs. failure rate
- Idempotency hit rate (200 vs. 202 responses)

**Provider-level:**
- ACS `pollUntilDone` duration (email sends include polling time)
- Provider error rate by error code
- Provider timeout rate (120s abort)

**Database-level:**
- `send_log` table row count growth rate
- Connection pool utilization (`max: 5` per pool)
- Query latency on `provider_configs` lookups

### Querying the Send Log

Check recent sends:

```sql
SELECT id, channel, provider, status, created_at
FROM notification.send_log
ORDER BY created_at DESC
LIMIT 20;
```

Check failure rate:

```sql
SELECT status, COUNT(*)
FROM notification.send_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
```

Find sends by correlation ID:

```sql
SELECT *
FROM notification.send_log
WHERE correlation_id = 'your-correlation-id';
```

## Troubleshooting

### Symptom: All sends return CHANNEL_DISABLED

**Diagnosis:** No active provider for the channel.

**Solution:**
```bash
# Check which providers exist
curl -s http://localhost:8080/admin/providers | jq '.[] | {id, channel, providerType, isActive}'

# Activate one
curl -s -X POST http://localhost:8080/admin/providers/<id>/activate
```

### Symptom: Sends fail with AUTHENTICATION_FAILED

**Diagnosis:** The ACS connection string is wrong, expired, or the env var is missing.

**Solution:**
1. Validate the provider: `curl -X POST http://localhost:8080/admin/providers/<id>/validate`
2. If `envVarsPresent: false`, the env var name in `secretEnvVars` doesn't match any set variable
3. If `providerConnected: false`, the value is wrong — check the ACS resource in Azure Portal

### Symptom: Email sends take > 30 seconds

**Diagnosis:** ACS `pollUntilDone` is slow. This is normal for ACS email — the poller waits for provider-side processing.

**Mitigation:**
- The adapter has a 120-second abort timeout to prevent indefinite blocking
- If consistently slow, check ACS service health in Azure Portal
- Consider async send (Phase 2: return 202 immediately, update status via background job)

### Symptom: Database connection errors on startup

**Diagnosis:** PostgreSQL is unreachable or credentials are wrong.

**Solution:**
1. Verify connectivity: `psql -h <host> -U fireread -d <database> -c "SELECT 1;"`
2. Check `.env` has correct `PG_HOST`, `PG_PASSWORD`, `PG_INSERT_PASSWORD`
3. For Azure PG: ensure SSL settings are correct (don't set `PG_SSL_DISABLED=true` in production)
4. Check pool config: `max: 5`, `connectionTimeoutMillis: 5000`

### Symptom: Duplicate emails being sent

**Diagnosis:** Consumers are using unique idempotency keys for each retry instead of the same key.

**Solution:** Idempotency keys must be **deterministic and stable** across retries. Use patterns like `{action}-{entity}-{id}` (e.g., `welcome-email-user-42`), not random UUIDs.

### Symptom: Service crashes on SIGTERM

**Diagnosis:** This should not happen — the service handles SIGTERM/SIGINT gracefully by closing both connection pools.

**Solution:** Check logs for unhandled errors. The shutdown sequence:
1. Receive SIGTERM/SIGINT
2. `await Promise.allSettled([readPool.end(), writePool.end()])`
3. Process exits

## Database Maintenance

### Send Log Retention

The `send_log` table grows with every send. For long-running deployments, implement a retention policy:

```sql
-- Delete records older than 90 days (adjust as needed)
DELETE FROM notification.send_log
WHERE created_at < NOW() - INTERVAL '90 days';
```

Consider running this as a scheduled job or adding it as a future admin endpoint.

### Index Maintenance

The partial index on `provider_message_id` only indexes non-null values. After bulk deletes, consider:

```sql
REINDEX INDEX notification.idx_send_log_provider_message_id;
ANALYZE notification.send_log;
```

## Security Considerations

### Admin API Access

In production, admin endpoints should be accessible only through the Kong gateway with API key authentication. They are not separately authenticated at the service level.

### Credential Storage

The database stores environment variable **names**, never actual secrets. Ensure:
- ACS connection strings and API keys are in Kubernetes Secrets or Helm values
- `.env` files are never committed to version control (`.gitignore` covers this)
- Rotate credentials by updating the env var value; no DB changes needed

### TLS

Database connections use SSL by default. In production (`NODE_ENV=production`), `rejectUnauthorized: true` enforces certificate validation. In development, self-signed certificates are accepted.

## Graceful Shutdown

The shutdown sequence on SIGTERM/SIGINT:

1. Stop accepting new HTTP connections
2. Wait for in-flight requests to complete
3. Close read and write PostgreSQL connection pools
4. Exit process

## Related

- [Concepts](./concepts.md) — Core abstractions and mental models
- [Getting Started](./getting-started.md) — Step-by-step setup tutorial
- [Reference](./reference.md) — Complete API reference
- [Overview](./README.md) — Service overview and architecture
