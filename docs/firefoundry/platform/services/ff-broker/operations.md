# FF Broker — Operations Guide

This guide covers day-to-day operations for the FF Broker including feature flag management, admin APIs, monitoring, and production rollout planning.

## Feature Flag Management

All industrial subsystems are controlled by feature flags that can be set via environment variables at startup and overridden at runtime via the HTTP admin API.

### Environment Variables

Feature flags use the `BROKER_FF_` prefix. Set them in your deployment configuration:

```bash
# In Kubernetes deployment.yaml or Helm values
BROKER_FF_CAPACITY_GATING=true
BROKER_FF_STREAM_INSTRUMENTATION=true
BROKER_FF_PERFORMANCE_ROUTING=true
BROKER_FF_QOS_SWITCHING=false
BROKER_FF_PRIORITY_ROUTING=false
BROKER_FF_STICKY_ROUTING=false
BROKER_FF_QUOTA_ENFORCEMENT=false
BROKER_FF_OUTPUT_PREDICTION=false
BROKER_FF_COMPILED_CHAIN=false
```

### Runtime Override API

Override flags at runtime without restarting the service:

```bash
# View all flag states
GET /api/industrial/flags

# Override a single flag
PUT /api/industrial/flags/capacity_gating
{"enabled": true}

# Clear override (revert to env value)
DELETE /api/industrial/flags/capacity_gating

# Bulk override multiple flags
POST /api/industrial/flags/bulk
{
  "capacity_gating": true,
  "stream_instrumentation": true,
  "performance_routing": false
}

# Clear all overrides
DELETE /api/industrial/flags
```

**Important**: Runtime overrides are ephemeral — they reset when the service restarts. For persistent changes, update the environment variables.

### Recommended Rollout Sequence

Enable industrial subsystems in this recommended order for a safe, gradual rollout:

#### Phase 1: Observability (Low Risk)
```bash
BROKER_FF_STREAM_INSTRUMENTATION=true   # Collect TTFT/throughput metrics
BROKER_FF_OUTPUT_PREDICTION=true        # Start learning output patterns
```

These are read-only subsystems that observe but don't affect request routing.

#### Phase 2: Capacity Protection (Medium Risk)
```bash
BROKER_FF_CAPACITY_GATING=true          # Prevent provider overload
BROKER_FF_PERFORMANCE_ROUTING=true      # Avoid degraded deployments
```

These subsystems affect routing decisions but fail-safe to the default behavior.

#### Phase 3: Optimization (Medium Risk)
```bash
BROKER_FF_STICKY_ROUTING=true           # Improve prompt cache hit rates
BROKER_FF_COMPILED_CHAIN=true           # Reduce stream overhead
```

These subsystems optimize performance without changing correctness.

#### Phase 4: Policy Enforcement (Higher Risk)
```bash
BROKER_FF_QOS_SWITCHING=true            # Enable QoS tier differentiation
BROKER_FF_QUOTA_ENFORCEMENT=true        # Replace legacy QuotaTracker
BROKER_FF_PRIORITY_ROUTING=true         # Enable priority queuing
```

These subsystems can reject or reorder requests. Ensure monitoring is in place before enabling.

## Admin API Endpoints

### Feature Flags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/flags` | Get all flag states |
| PUT | `/api/industrial/flags/:flag` | Set flag override (`{"enabled": true}`) |
| DELETE | `/api/industrial/flags/:flag` | Clear flag override |
| POST | `/api/industrial/flags/bulk` | Bulk override flags |
| DELETE | `/api/industrial/flags` | Clear all overrides |

### Capacity Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/capacity` | Aggregate capacity stats |
| GET | `/api/industrial/capacity/:id` | Per-deployment stats |
| POST | `/api/industrial/capacity/:id/register` | Register deployment (`{"concurrencyLimit": 10}`) |
| PUT | `/api/industrial/capacity/:id/limits` | Update limits (`{"concurrencyLimit": 20}`) |

### Performance Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/performance` | All deployment stats + degraded list |
| GET | `/api/industrial/performance/:id` | Single deployment stats |

### Usage Patterns

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/usage` | All tracked labels with profile summaries |
| GET | `/api/industrial/usage/:label` | Full weekly profile for a label |

### QoS Tiers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/qos` | Tier definitions and constraints |
| POST | `/api/industrial/qos/resolve` | Resolve tier for a request |

### PTU Advisory

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/ptu` | PTU deployment registry |
| GET | `/api/industrial/ptu/recommendations` | Scale recommendations |
| GET | `/api/industrial/ptu/:name/headroom` | Headroom analysis (`?currentTpm=50000`) |

### Combined Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/industrial/status` | All subsystem statuses in one response |

Example response:
```json
{
  "flags": {
    "capacity_gating": {"enabled": true, "source": "env"},
    "stream_instrumentation": {"enabled": true, "source": "override"},
    "performance_routing": {"enabled": false, "source": "env"}
  },
  "capacityGating": {
    "enabled": true,
    "available": true,
    "stats": {"totalInFlight": 5, "totalRejected": 0}
  },
  "performanceRouting": {
    "enabled": false,
    "available": false
  },
  "qosSwitching": {
    "enabled": false,
    "available": false
  },
  "usagePatterns": {
    "enabled": true,
    "available": true,
    "trackedLabels": 12
  },
  "ptuAdvisory": {
    "available": false,
    "registeredDeployments": 0
  }
}
```

## Monitoring

### Key Metrics to Watch

#### Request-Level Metrics
- **Request rate**: Requests per second by model group
- **Error rate**: Failures per second, broken down by error type
- **Latency (p50, p95, p99)**: End-to-end request latency
- **TTFT**: Time to first token for streaming requests
- **Token usage**: Input/output tokens per request

#### Industrial Metrics
- **Capacity utilization**: In-flight requests vs limits per deployment
- **Rejection rate**: Requests rejected by capacity gating
- **Degraded deployments**: Count of deployments in degraded state
- **Quota utilization**: TPM/RPM usage vs limits
- **Sticky routing hit rate**: Cache hits vs misses
- **Priority queue depth**: Pending requests in priority queue

#### System Metrics
- **Memory usage**: Node.js heap and RSS
- **CPU usage**: Process CPU utilization
- **Database connections**: Active/idle pool connections
- **gRPC stream count**: Active streaming connections

### Health Checks

```bash
# HTTP health check
curl http://broker:3000/health

# Industrial status (comprehensive)
curl http://broker:3000/api/industrial/status

# Performance metrics
curl http://broker:3000/api/industrial/performance

# Capacity metrics
curl http://broker:3000/api/industrial/capacity
```

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Troubleshooting

### Capacity Gating Rejecting Too Many Requests

**Symptom**: High rate of `RESOURCE_EXHAUSTED` errors from capacity gating.

**Diagnosis**:
```bash
curl http://broker:3000/api/industrial/capacity
```

**Solutions**:
1. Increase concurrency limits: `PUT /api/industrial/capacity/:id/limits {"concurrencyLimit": 20}`
2. Add more deployments to the model group
3. Check if a specific deployment is slow (check performance metrics)

### Performance Routing Excluding Healthy Deployments

**Symptom**: Requests failing because performance routing excluded all deployments.

**Diagnosis**:
```bash
curl http://broker:3000/api/industrial/performance
```

**Solutions**:
1. Check if the degradation thresholds are too aggressive
2. Temporarily disable performance routing: `PUT /api/industrial/flags/performance_routing {"enabled": false}`
3. Investigate underlying provider issues

### Quota Exhaustion

**Symptom**: `RESOURCE_EXHAUSTED` errors mentioning quota.

**Diagnosis**:
```bash
# Check which deployment's quota is exceeded
curl http://broker:3000/api/industrial/status
```

**Solutions**:
1. Increase quota limits via admin API
2. Enable output prediction to improve estimation accuracy
3. Add more deployments to distribute load

### Sticky Routing Causing Imbalanced Load

**Symptom**: One deployment receives disproportionate traffic.

**Diagnosis**: Check if many long-running sessions are all sticky to the same deployment.

**Solutions**:
1. Temporarily disable sticky routing: `PUT /api/industrial/flags/sticky_routing {"enabled": false}`
2. Reduce sticky routing TTL to limit affinity duration
3. Add more deployments to the pool

## Graceful Shutdown

When the broker receives `SIGTERM`:

1. Stop accepting new gRPC connections
2. Wait for in-flight streaming requests to complete (with timeout)
3. Flush tracking metrics to database
4. Release capacity slots
5. Close database connections
6. Exit

**Note**: Full graceful shutdown orchestration for industrial subsystems is planned. Currently, in-flight requests may be interrupted on shutdown. See [issue #58](https://github.com/firebrandanalytics/ff_broker/issues/58).

## Database Maintenance

### Tracking Table Growth

The `brk_tracking.completion_request` table grows with every request. Plan for:
- **Retention policy**: Archive or delete records older than N days
- **Partitioning**: Consider partitioning by date for large deployments
- **Indexes**: Ensure indexes on `created_at`, `broker_request_id`, `semantic_label`

### Configuration Cache

The `DatabaseConfigManager` caches model group configurations with a TTL. After making configuration changes via the admin API, changes take effect after the cache expires (default: 5 minutes) or on the next service restart.

## Security Considerations

### Admin API Access

The industrial admin API endpoints (`/api/industrial/*`) do not currently have authentication. In production:
- Restrict access via network policies (Kubernetes NetworkPolicy)
- Place behind an authenticated API gateway
- Use Kubernetes RBAC to limit who can port-forward to the service

**Note**: Admin API authentication is planned. See [issue #56](https://github.com/firebrandanalytics/ff_broker/issues/56).

### Feature Flag Safety

Runtime feature flag overrides are powerful — they can enable or disable subsystems that reject requests. Treat them with the same care as configuration changes:
- Log who changed what (audit trail)
- Test in staging before production
- Have a rollback plan (clear overrides to revert to env values)
