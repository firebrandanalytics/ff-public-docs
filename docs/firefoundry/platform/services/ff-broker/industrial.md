# FF Broker — Industrial Subsystems

The FF Broker includes 12 production-grade subsystems for industrial-scale operations. All subsystems are controlled by feature flags, enabling gradual rollout and instant rollback. When disabled, subsystems add zero overhead — they are not instantiated.

## Feature Flags

Each subsystem is gated by an environment variable with the `BROKER_FF_` prefix:

| Flag | Env Variable | Subsystem(s) |
|------|-------------|--------------|
| `capacity_gating` | `BROKER_FF_CAPACITY_GATING` | DeploymentCapacityManager |
| `stream_instrumentation` | `BROKER_FF_STREAM_INSTRUMENTATION` | StreamPipeline (PullChain) |
| `compiled_chain` | `BROKER_FF_COMPILED_CHAIN` | Compiled PullChain optimization |
| `performance_routing` | `BROKER_FF_PERFORMANCE_ROUTING` | DeploymentPerformanceTracker |
| `qos_switching` | `BROKER_FF_QOS_SWITCHING` | QosTierManager |
| `priority_routing` | `BROKER_FF_PRIORITY_ROUTING` | PriorityRequestRouter |
| `sticky_routing` | `BROKER_FF_STICKY_ROUTING` | StickyRoutingManager |
| `quota_enforcement` | `BROKER_FF_QUOTA_ENFORCEMENT` | QuotaCapacityManager |
| `output_prediction` | `BROKER_FF_OUTPUT_PREDICTION` | SemanticLabelOutputModel, UsagePatternCollector |

Flags can be overridden at runtime via the HTTP admin API without restarting the service. See [Operations — Feature Flag Management](./operations.md#feature-flag-management) for the API reference.

## Capacity Gating

**Flag**: `BROKER_FF_CAPACITY_GATING`
**Component**: `DeploymentCapacityManager`

### What It Does

Enforces per-deployment concurrency limits to prevent overwhelming AI provider endpoints. Each deployment has a maximum number of concurrent in-flight requests. When the limit is reached, new requests are rejected with `RESOURCE_EXHAUSTED` rather than queued indefinitely.

### How It Works

```
Request arrives
    │
    ▼
DeploymentCapacityManager.tryAcquire(deploymentId)
    │
    ├── Slot available → proceed to provider
    │
    └── No slot → reject with RESOURCE_EXHAUSTED

Request completes
    │
    ▼
DeploymentCapacityManager.release(deploymentId)
```

### Configuration

Deployments are registered with concurrency limits via the admin API:

```bash
POST /api/industrial/capacity/:deploymentId/register
{
  "concurrencyLimit": 10
}
```

### Metrics

| Metric | Description |
|--------|-------------|
| `totalInFlight` | Total concurrent requests across all deployments |
| `totalRejected` | Total requests rejected due to capacity |
| `perDeployment` | Per-deployment in-flight and rejected counts |

## Stream Instrumentation

**Flag**: `BROKER_FF_STREAM_INSTRUMENTATION`
**Component**: `StreamPipeline` (PullChain)

### What It Does

Wraps provider streaming responses in a PullChain pipeline that collects real-time metrics without modifying provider code:

- **TTFT (Time to First Token)**: Latency from request to first streamed token
- **Throughput**: Tokens per second during streaming
- **Token Count**: Exact input/output token counts
- **Stream Duration**: Total streaming time

### PullChain Architecture

The PullChain is a composable pipeline of operators applied to async generators:

```
Provider AsyncGenerator
    │
    ▼
Turnstile (concurrency limiting)
    │
    ▼
TTFT Timer (measures time to first yield)
    │
    ▼
Token Counter (counts chunks/tokens)
    │
    ▼
Throughput Tracker (tokens/sec)
    │
    ▼
Client receives chunks
```

### Compiled Chain

When `BROKER_FF_COMPILED_CHAIN` is also enabled, the PullChain is compiled into a single fused operator, reducing per-chunk overhead from ~5 function calls to ~1.

## Performance Routing

**Flag**: `BROKER_FF_PERFORMANCE_ROUTING`
**Component**: `DeploymentPerformanceTracker`

### What It Does

Tracks real-time performance metrics for each deployment and adjusts model selection scores. Deployments with degraded performance receive score penalties, causing the broker to prefer healthier alternatives.

### Tracked Metrics

| Metric | Window | Description |
|--------|--------|-------------|
| Latency (p50, p95, p99) | Rolling 5-minute | End-to-end request latency |
| TTFT (p50, p95) | Rolling 5-minute | Time to first token |
| Error rate | Rolling 5-minute | Percentage of failed requests |
| TPS | Rolling 1-minute | Tokens per second throughput |

### Degradation Detection

A deployment is marked **degraded** when:
- Error rate exceeds threshold (default: 10%)
- p95 latency exceeds 2x the rolling baseline
- TTFT exceeds 3x the rolling baseline

Degraded deployments receive a score penalty proportional to the severity. Severely degraded deployments may be excluded entirely from selection.

## QoS Tiering

**Flag**: `BROKER_FF_QOS_SWITCHING`
**Component**: `QosTierManager`

### What It Does

Assigns each request a Quality-of-Service tier that constrains which models and resources are available. Higher tiers unlock premium resources; lower tiers are limited to economy resources.

### Tier Definitions

| Tier | Priority | Description |
|------|----------|-------------|
| `ECONOMY` | 0 | Lowest cost, may use smaller models |
| `STANDARD` | 1 | Default tier, balanced cost/quality |
| `PREMIUM` | 2 | Higher quality models, faster routing |
| `CRITICAL` | 3 | Highest priority, best available resources |

### Tier Resolution

Tiers are resolved per-request based on:
1. Explicit `requestedTier` in the request
2. Customer-level default tier
3. System default (`STANDARD`)

### Constraints

Each tier has configurable constraints:
- **Allowed model families**: Which model families can be used
- **Max latency target**: Expected latency SLA
- **Priority boost**: Score adjustment applied during model selection

## Sticky Routing

**Flag**: `BROKER_FF_STICKY_ROUTING`
**Component**: `StickyRoutingManager`

### What It Does

Maintains session-to-deployment affinity so that consecutive requests from the same session are routed to the same deployment. This optimizes **prompt caching** — providers like Azure OpenAI cache prompts per-deployment, so routing the same session to the same deployment improves cache hit rates and reduces latency.

### How It Works

```
Request arrives with session key (entityId or requestId)
    │
    ▼
StickyRoutingManager.getPreferredDeployment(sessionKey)
    │
    ├── Cache hit → prefer this deployment in model selection
    │
    └── Cache miss → normal selection, then record affinity
```

### Session Key

The session key is derived from (in order of preference):
1. `breadcrumbs[0].entityId` — entity-level affinity
2. `request.id` — request-level affinity
3. `brokerRequestId` — fallback to broker-generated ID

### Cache TTL

Affinity entries expire after a configurable TTL (default: 30 minutes of inactivity). This prevents stale routing when sessions are abandoned.

## Priority Routing

**Flag**: `BROKER_FF_PRIORITY_ROUTING`
**Component**: `PriorityRequestRouter`

### What It Does

When system load exceeds a threshold, activates a priority queue that ensures high-priority requests are served before low-priority ones. Under normal load, all requests are processed equally.

### Priority Resolution

Priority is derived from:
1. Customer ID → customer priority tier
2. Semantic label → label priority mapping
3. QoS tier → tier-based priority

### Load Threshold

Priority routing only activates when the total in-flight request count (from DeploymentCapacityManager) exceeds a configurable threshold. Below the threshold, all requests are treated equally.

> **Dependency**: Priority routing requires `BROKER_FF_CAPACITY_GATING` to also be enabled, as it uses the capacity manager's load metrics.

## Quota Enforcement

**Flag**: `BROKER_FF_QUOTA_ENFORCEMENT`
**Component**: `QuotaCapacityManager`

### What It Does

Enforces hierarchical token-per-minute (TPM) and request-per-minute (RPM) quotas at the deployment level. When enabled, it replaces the legacy `QuotaTracker` with a more capable system.

### Quota Hierarchy

```
Organization quota (total TPM/RPM across all deployments)
    │
    └── Deployment quota (per-deployment TPM/RPM limit)
        │
        └── Request check: estimated tokens vs remaining quota
```

### Token Estimation

Quota consumption is estimated before the request executes:
- **Input tokens**: Calculated from message content
- **Output tokens**: Estimated using SemanticLabelOutputModel (if enabled) or a static estimate

### Behavior on Quota Exceeded

When quota is exceeded, the request is rejected with `RESOURCE_EXHAUSTED` and an error message indicating which quota was exceeded. The client can retry after the quota window resets.

## Output Prediction

**Flag**: `BROKER_FF_OUTPUT_PREDICTION`
**Components**: `SemanticLabelOutputModel`, `UsagePatternCollector`

### SemanticLabelOutputModel

Uses Exponentially Weighted Moving Average (EWMA) to predict expected output token counts based on the request's semantic label. This improves:
- **Quota enforcement**: More accurate token estimation before execution
- **Capacity planning**: Better resource allocation predictions
- **Cost estimation**: More accurate cost projections

The model learns from actual output token counts after each request completes, gradually improving its predictions per semantic label.

### UsagePatternCollector

Maintains a 168-slot weekly usage profile (one slot per hour, 7 days × 24 hours) for each semantic label. This enables:
- **Pattern detection**: Identify peak usage hours per label
- **Anomaly detection**: Flag unusual usage patterns
- **PTU advisory**: Feed usage patterns into PTU capacity recommendations

Metrics collected per slot:
- Request count
- Total tokens consumed
- Average latency

## PTU Capacity Advisory

**Component**: `PtuCapacityAdvisor` (always available, no feature flag required)

### What It Does

Provides Provisioned Throughput Unit (PTU) capacity analysis and scale recommendations for Azure OpenAI deployments. PTU is Azure's dedicated capacity model that guarantees throughput at a fixed cost.

### PTU Registry

The advisor maintains a registry of PTU deployments with:
- Deployment name and model
- Provisioned TPM capacity
- Cost per PTU unit

### Headroom Analysis

For each PTU deployment, calculates real-time headroom:

```
headroom = (provisioned_tpm - current_tpm) / provisioned_tpm
```

### Scale Recommendations

Combines PTU registry with usage patterns from UsagePatternCollector to generate:
- **Scale up**: If peak usage exceeds 80% of provisioned capacity
- **Scale down**: If peak usage is below 30% of provisioned capacity
- **Optimal sizing**: Recommended PTU units based on usage patterns

### API

```bash
# Get PTU deployment registry
GET /api/industrial/ptu

# Get headroom for a deployment
GET /api/industrial/ptu/:deploymentName/headroom?currentTpm=50000

# Generate scale recommendations (requires usage patterns)
GET /api/industrial/ptu/recommendations
```

## Subsystem Integration

The industrial subsystems integrate into the broker request flow at specific points:

```
Request arrives
    │
    ▼
1. QoS Tier Resolution (QosTierManager)
    │
    ▼
2. Capacity Check (DeploymentCapacityManager)
    │
    ▼
3. Priority Resolution (PriorityRequestRouter)
    │
    ▼
4. Sticky Routing Lookup (StickyRoutingManager)
    │
    ▼
5. Model Selection (with performance scores from DeploymentPerformanceTracker)
    │
    ▼
6. Quota Check (QuotaCapacityManager, with estimates from SemanticLabelOutputModel)
    │
    ▼
7. Provider Execution (with stream instrumentation via PullChain)
    │
    ▼
8. Post-Request: Usage recording, sticky routing update, performance tracking
```

Each step is independently feature-flagged — any subsystem can be disabled without affecting the others.
