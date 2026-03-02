# Web Search — Operations

Deployment, Bing API setup, monitoring, and troubleshooting for the Web Search Service.

## Bing API Setup

### Getting an API Key

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a resource → Search for "Bing Search v7"
3. Select a pricing tier:
   - **F0 (Free)**: 3 calls/second, 1,000 calls/month
   - **S1**: Higher limits for production use
4. Copy the API key from Keys and Endpoint

### Configuration

```bash
BING_API_KEY=your-api-key
BING_API_ENDPOINT=https://api.bing.microsoft.com/v7.0/search  # default
BING_TIMEOUT_MS=5000  # default
```

## Deployment

### Docker

```bash
# Build
docker build -t web-search:local .

# Run
docker run -p 8080:8080 --env-file .env web-search:local
```

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

The `/ready` endpoint checks both Bing API connectivity and database availability. If either is down, the service reports not ready and Kubernetes stops routing traffic.

### Resource Recommendations

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

The Web Search Service is lightweight — most processing happens at the Bing API. Resource needs are modest.

### CI/CD

GitHub Actions workflow builds on push to:
- `main` — Production (semantic version + `latest` tag)
- `dev` — Development (version-dev.sha + `dev` tag)
- `feat/**`, `fix/**` — Branch builds

## Database

### Schema Migration

```bash
psql -f migrations/001_create_search_logs.sql
```

Creates:
- `websearch` schema
- `websearch.search_logs` table
- Grants for `fireread` (SELECT) and `fireinsert` (SELECT, INSERT)

### Log Retention

Search logs grow over time. Consider periodic cleanup:

```sql
DELETE FROM websearch.search_logs
WHERE created_at < NOW() - INTERVAL '30 days';
```

## Monitoring

### Key Metrics

| Metric | Source | What to Watch |
|--------|--------|---------------|
| Response time | `search_logs.response_time_ms` | p95 should be < 2s |
| Error rate | `search_logs` where `success = false` | Should be < 5% |
| Result count | `search_logs.result_count` | Zero results may indicate query issues |
| Bing API latency | Application logs | Increases may indicate Bing throttling |

### Query the Logs

```sql
-- Recent search summary
SELECT
  date_trunc('hour', created_at) as hour,
  COUNT(*) as total,
  AVG(response_time_ms) as avg_ms,
  COUNT(*) FILTER (WHERE success = false) as errors
FROM websearch.search_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- Most common error codes
SELECT error_code, COUNT(*)
FROM websearch.search_logs
WHERE success = false
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY error_code
ORDER BY COUNT(*) DESC;
```

## Troubleshooting

### Common Issues

**Readiness probe fails:**
- Check `BING_API_KEY` is set and valid
- Verify database connectivity (`PG_HOST`, `PG_DATABASE`, `PG_PASSWORD`)
- Check network egress to `api.bing.microsoft.com`

**BING_ERROR (502):**
- The Bing API returned an error — check API key validity
- May indicate rate limiting on the Bing side
- Check Azure Portal for Bing service health

**TIMEOUT (504):**
- Bing API didn't respond within `BING_TIMEOUT_MS`
- Increase timeout for slow networks
- Check if the Bing API endpoint is reachable

**RATE_LIMITED (429):**
- Too many requests to the service
- Scale horizontally to handle more concurrent requests
- Consider implementing client-side request queuing

**Empty results:**
- The query may be too restrictive — try relaxing structured query constraints
- Remove domain restrictions (`sites.include`) to broaden results
- Check if `safeSearch=strict` is filtering relevant results

**Logging failures don't affect search:**
- By design — logging is fire-and-forget
- Check database connectivity if logs are missing
- Verify the `websearch.search_logs` table exists
