# Code Sandbox — Operations

Deployment, scaling, security configuration, and troubleshooting for the Code Sandbox.

## Deployment

### Docker

```bash
# Build image locally
docker build -t code-sandbox:local .

# Run with environment file
docker run -p 3000:3000 --env-file .env code-sandbox:local
```

The Docker image uses Node.js 23 and includes:
- ODBC drivers for supported databases
- Chromium (for any future puppeteer support)
- PM2 for process management

### Kubernetes

The service is stateless and runs behind a standard Kubernetes deployment:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 10
```

### Resource Recommendations

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

TypeScript compilation and data processing can be memory-intensive. Monitor actual usage and adjust accordingly.

## Execution Mode Selection

| Mode | Setting | Pros | Cons |
|------|---------|------|------|
| Direct | `USE_WORKER_THREADS=false` | Lower latency, simpler | Less isolation between requests |
| Worker Threads | `USE_WORKER_THREADS=true` | Better isolation | Higher overhead per execution |

**Production recommendation**: Direct execution with horizontal scaling via Kubernetes. Scale the number of replicas rather than worker threads within a single container.

**High-isolation needs**: Worker threads mode with `NUM_WORKERS` set to match expected concurrency.

## Scaling Strategy

- Scale based on HTTP request concurrency
- Each container handles requests sequentially (direct mode) or via worker pool
- No shared state between containers — stateless design
- Use Kubernetes HPA with CPU or request-count metrics

## Security Configuration

### API Key Management

- Set `API_KEY` environment variable for production
- Omit `API_KEY` to disable authentication in development
- Rotate keys regularly via environment variable updates

### Network Security

- Restrict egress to known database endpoints and Azure services
- Use Kubernetes NetworkPolicy to limit pod-to-pod communication
- The sandbox does not need internet access for code execution

### Database Credential Security

Database connection strings should be stored in Azure KeyVault or Kubernetes secrets, not hardcoded:

```yaml
# Kubernetes secret reference
env:
  - name: ANALYTICS_CONNECTION_STRING
    valueFrom:
      secretKeyRef:
        name: sandbox-db-secrets
        key: analytics-connection-string
```

## Monitoring

### Key Metrics

| Metric | What to Watch |
|--------|---------------|
| Compilation time | Increases may indicate complex code or resource pressure |
| Execution time | Set timeout alerts for runaway code |
| Error rate | Compilation failures vs. runtime errors |
| Memory usage | TypeScript compilation is memory-intensive |
| ODBC connection pool | Connection exhaustion causes timeouts |

### Application Insights

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` to enable Azure Application Insights telemetry. This captures:
- Request traces with correlation IDs
- Dependency calls (database queries)
- Exception logging
- Performance metrics

## Troubleshooting

### Common Issues

**Compilation errors:**
- Check that the code exports the required function for the harness (`analyze` for finance, `run` for sql)
- Verify TypeScript syntax — the sandbox uses strict compilation
- Check for missing library imports (only bundled libraries are available)

**Database connection failures:**
- Verify connection string environment variables are set and correctly named
- Check ODBC driver availability in the container
- Ensure network connectivity from the sandbox pod to the database
- For Databricks: verify client credentials and tenant ID

**Timeout errors:**
- Default execution timeout is configurable — check if the workload needs more time
- Long-running queries should be optimized at the database level
- Consider breaking large analyses into smaller code executions

**Worker thread failures:**
- Check `NUM_WORKERS` does not exceed available CPU cores
- Monitor container memory — each worker consumes additional memory
- Fall back to direct mode if worker threads are unstable

**Out of memory:**
- Increase container memory limits
- Reduce data volume in queries (use LIMIT clauses)
- Process data in batches rather than loading everything into memory
