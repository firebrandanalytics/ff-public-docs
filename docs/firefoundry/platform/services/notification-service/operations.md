# Notification Service — Operations Guide

What an application team needs to enable the Notification Service, set up a provider, verify delivery, and troubleshoot from the caller's side.

## Enabling the Service

The Notification Service is part of the `firefoundry-core` chart but is **opt-in**:

```yaml
# firefoundry-core values
notification-service:
  enabled: true
  secret:
    data:
      ACS_CONNECTION_STRING: "<Azure Communication Services connection string>"
```

`ACS_CONNECTION_STRING` holds the credential that provider configurations reference by name (see [Credential Model](./concepts.md#credential-model)). Credentials, database connectivity, and admin API keys are provisioned by your environment administrator; your application only needs the service URL.

Other settings you may adjust:

| Value | Default | When to change |
|-------|---------|----------------|
| `notification-service.replicaCount` | `1` | Increase for high send volume |
| `notification-service.configMap.data.LOG_LEVEL` | `info` | Set to `debug` while diagnosing send failures |
| `notification-service.global.externalAccess` | `false` | Expose outside the cluster only if non-cluster clients must send |

## Calling from Your Agent Bundle

Use the in-cluster URL `http://firefoundry-core-notification-service:8080` (adjust the host if your `firefoundry-core` release has a different name or runs in another namespace). There is no dedicated SDK client; call the REST API with `fetch` or your HTTP client of choice (see [Getting Started](./getting-started.md#step-5-send-your-first-email)).

## Provider Setup and Management

Providers are configured through the admin API, usually once per environment.

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

Only one provider per channel is active, and switching is a configuration change. Today `acs` is the only available provider type, so switching applies once additional providers ship; the flow will be:

1. Create the new provider config (its credential must already be provisioned for the service)
2. Validate it
3. Activate it — the previous provider is deactivated in the same operation
4. All subsequent sends use the new provider; no consumer changes needed

To change settings of the current ACS configuration (for example the sender address), update it in place instead — see below.

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

## Verifying and Monitoring

### Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Process is running |
| `GET /ready` | Service can accept traffic |
| `GET /status` | Version, uptime, and which channels have an active provider |

### What to Watch

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

## Limits and Behavior to Design Around

| Behavior | Details |
|----------|---------|
| Email recipients | `to` 1–50 addresses; `cc` and `bcc` up to 50 each |
| Attachments | Up to 10 per email, base64-encoded in the request body |
| SMS | One E.164 recipient per request; 1–1600 characters |
| Idempotency key | Required on every send; max 256 characters |
| Latency | Sends are synchronous with the provider; email can take several seconds |
| Final status | `sent` means accepted by the provider; delivery/bounce tracking is planned |
| Channels | Email and SMS; push is planned |

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
2. If `envVarsPresent: false` — the name in `secretEnvVars` doesn't match a secret provisioned for the service (e.g. `ACS_CONNECTION_STRING`)
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

### Connection refused from your bundle

1. Confirm `notification-service.enabled` is `true` — the service is off by default
2. Check the service name and namespace in the URL you are calling
3. `GET /ready` returning 503 means the service is up but not ready; contact your environment administrator

### Duplicate emails being sent

**Cause:** The consumer is using a different `idempotencyKey` for each retry.

**Fix:** Idempotency keys must be deterministic and stable across retries. Use patterns like `{action}-{entity}-{id}` (e.g., `welcome-email-user-42`), not random UUIDs.

## Credential Rotation

To rotate a provider credential, your environment administrator updates the secret value (e.g. `ACS_CONNECTION_STRING`) and restarts the service. Then validate the provider:

```bash
curl -X POST http://localhost:8080/admin/providers/<id>/validate
```

No provider reconfiguration or consumer changes are needed.

## Security

- Admin endpoints are protected by API key authentication in production deployments
- Provider secrets are never returned by the API
- Send endpoints accept arbitrary recipients: restrict which of your components can reach the service, and validate recipients in your own code before sending

## Related

- [Concepts](./concepts.md) — Core abstractions and mental models
- [Getting Started](./getting-started.md) — Step-by-step setup tutorial
- [Reference](./reference.md) — Complete API reference
- [Overview](./README.md) — Service overview
