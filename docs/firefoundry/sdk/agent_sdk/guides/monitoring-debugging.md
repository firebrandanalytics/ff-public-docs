# Monitoring & Debugging Guide

This guide covers how to monitor FireFoundry agent bundles in production and debug issues when they arise. It spans structured logging, entity status monitoring, telemetry analysis, CLI diagnostic tools, and systematic debugging workflows.

**Prerequisites:** Familiarity with the [SDK Quick-Start](sdk-quickstart.md), [Error Handling & Resilience](error-handling-resilience.md), and [Deployment & Configuration](deployment-configuration.md).

---

## Table of Contents

- [Observability Architecture](#observability-architecture)
- [Structured Logging](#structured-logging)
- [Entity Status Monitoring](#entity-status-monitoring)
- [Telemetry Analysis](#telemetry-analysis)
- [Diagnostic CLI Tools](#diagnostic-cli-tools)
- [Debugging Bot Failures](#debugging-bot-failures)
- [Debugging Workflow Failures](#debugging-workflow-failures)
- [Debugging Connection Issues](#debugging-connection-issues)
- [Common Failure Patterns](#common-failure-patterns)
- [Production Monitoring Checklist](#production-monitoring-checklist)

---

## Observability Architecture

FireFoundry provides three layers of observability that work together:

```
┌─────────────────────────────────────────────────────┐
│  Structured Logs                                    │
│  Per-bundle application logs (stdout/stderr)        │
│  → kubectl logs, log aggregator                     │
├─────────────────────────────────────────────────────┤
│  Entity Graph State                                 │
│  Entity status, data, relationships, timestamps     │
│  → ff-eg-read, entity graph API                     │
├─────────────────────────────────────────────────────┤
│  Telemetry                                          │
│  Broker requests, LLM calls, tool invocations       │
│  → ff-telemetry-read, telemetry API                 │
└─────────────────────────────────────────────────────┘
```

**Logs** tell you what happened in your code. **Entity graph** tells you the current state of your application's data. **Telemetry** tells you what happened in LLM interactions.

---

## Structured Logging

### Using the SDK Logger

The SDK provides a structured logger that outputs JSON for easy parsing by log aggregators:

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';

// Basic logging at different levels
logger.debug('Processing item', { itemId: 'item-1', step: 'parse' });
logger.info('Analysis complete', { entityId, resultCount: 5 });
logger.warn('Partial failure', { failed: 2, total: 10, entityId });
logger.error('Unrecoverable error', { entityId, error: err.message, stack: err.stack });
```

### Log Levels

| Level | When to Use | Examples |
|-------|-------------|---------|
| `debug` | Detailed flow tracing (development only) | DTO contents, prompt rendering, intermediate calculations |
| `info` | Normal operations worth recording | Entity created, bot completed, workflow started |
| `warn` | Recoverable problems | Partial failures, retries, fallback used |
| `error` | Failures requiring investigation | Unhandled exceptions, all retries exhausted, data corruption |

### Structured Context

Always include entity context in log messages for correlation:

```typescript
// Good: includes entity context for correlation
logger.info('Bot execution started', {
  entityId: this.id,
  entityType: this.get_specific_type_name(),
  botName: 'AnalysisBot',
  attempt: tryNumber,
});

// Good: includes timing data
const start = Date.now();
await this.run_bot();
logger.info('Bot execution completed', {
  entityId: this.id,
  botName: 'AnalysisBot',
  elapsedMs: Date.now() - start,
});
```

### Controlling Log Output

Set log levels via environment variables:

```bash
# In .env or Helm values
LOG_LEVEL=info              # Application log level
CONSOLE_LOG_LEVEL=debug     # Console output level (development)
```

| `LOG_LEVEL` | What You See |
|-------------|-------------|
| `debug` | Everything — very verbose |
| `info` | Normal operations + warnings + errors |
| `warn` | Only warnings and errors |
| `error` | Only errors |

> **Tip:** Use `debug` locally during development. Use `info` in production. Drop to `warn` for high-throughput services where log volume is a concern.

---

## Entity Status Monitoring

### Entity Status as Health Signal

Entity statuses form the primary health signal for agent bundles:

| Status | Meaning | Normal? |
|--------|---------|---------|
| `Pending` | Created but not yet started | Yes — waiting to be processed |
| `InProgress` | Currently executing | Yes — actively running |
| `Completed` | Finished successfully | Yes |
| `Error` | Failed during execution | No — investigate |
| `Waiting` | Paused for external input | Yes (waitable entities) |

### Querying Entity Status

Use `ff-eg-read` to find entities in error states:

```bash
# Find all entities in Error status for your app
ff-eg-read search nodes-scoped \
  --app-id $APP_ID \
  --condition '{"status": "Error"}'

# Find entities stuck in InProgress (potentially hung)
ff-eg-read search nodes-scoped \
  --app-id $APP_ID \
  --condition '{"status": "InProgress"}'

# Get details on a specific entity
ff-eg-read node get <entity-id>

# View entity relationships
ff-eg-read edges from <entity-id>
```

### Monitoring Error Rates

Track the ratio of errored entities to total entities as a key health metric:

```bash
# Count entities by status
ff-eg-read search nodes-scoped \
  --app-id $APP_ID \
  --condition '{"specific_type_name": "AnalysisEntity"}' \
  --count-by status
```

A rising error rate indicates a systemic issue (prompt regression, service degradation, data quality problem).

---

## Telemetry Analysis

### Telemetry Hierarchy

FireFoundry records telemetry at three levels:

```
BrokerRequest (top level)
  ├─ LlmApiRequest (individual LLM call)
  │   └─ ToolCallRequest (tool invocations within the call)
  ├─ LlmApiRequest (retry, if needed)
  └─ LlmApiRequest (another bot in the workflow)
```

Each request is linked to an entity via **breadcrumbs** (entity type + entity ID).

### Common Telemetry Queries

```bash
# View recent broker requests
ff-telemetry-read broker recent --limit 10

# View failed requests
ff-telemetry-read broker failed --limit 10

# Trace a specific request end-to-end
ff-telemetry-read trace get <broker-request-id>

# Find all requests for a specific entity
ff-telemetry-read trace by-breadcrumb AnalysisEntity <entity-id>

# Analyze LLM call patterns
ff-telemetry-read llm recent --limit 20

# Find LLM errors
ff-telemetry-read llm errors --limit 10

# View tool call activity
ff-telemetry-read tool recent --limit 10
```

### Token Usage Analysis

Monitor token consumption to identify expensive operations:

```bash
# View token usage for recent requests
ff-telemetry-read broker recent --limit 20 --fields id,model,prompt_tokens,completion_tokens,total_tokens

# Find high-token requests
ff-telemetry-read broker recent --sort total_tokens --desc --limit 10
```

High token counts on specific bots suggest prompts that need optimization (see [Performance & Optimization](performance-optimization.md)).

---

## Diagnostic CLI Tools

FireFoundry provides several CLI tools for debugging running systems:

### ff-sdk-cli — Bundle Health & Invocation

```bash
# Check if a bundle is healthy
ff-sdk-cli health --url http://main-bundle:3000

# Get bundle info (registered entities, bots, endpoints)
ff-sdk-cli info --url http://main-bundle:3000

# Invoke an endpoint for testing
ff-sdk-cli invoke --url http://main-bundle:3000 \
  --method POST --route analyze \
  --body '{"document_id": "doc-123"}'

# Stream an SSE endpoint
ff-sdk-cli stream --url http://main-bundle:3000 \
  --method POST --route analyze-stream \
  --body '{"document_id": "doc-123"}'
```

### ff-eg-read — Entity Graph Inspection

```bash
# Get an entity's full data
ff-eg-read node get <entity-id>

# List child entities
ff-eg-read edges from <entity-id>

# Search by type and status
ff-eg-read search nodes-scoped \
  --app-id $APP_ID \
  --condition '{"specific_type_name": "AnalysisEntity", "status": "Error"}'

# View entity history/timeline
ff-eg-read node history <entity-id>
```

### ff-wm-read — Working Memory Inspection

```bash
# List working memory records for an entity
ff-wm-read list --entity-id <entity-id>

# Download a specific working memory record
ff-wm-read download <wm-id> --output ./downloaded-file

# View working memory metadata
ff-wm-read get <wm-id>
```

### ff-telemetry-read — Telemetry Exploration

```bash
# Full request trace (broker → LLM → tools)
ff-telemetry-read trace get <broker-request-id>

# Entity-scoped trace
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# Failed request analysis
ff-telemetry-read broker failed --limit 5 --verbose
```

---

## Debugging Bot Failures

### Systematic Approach

When a bot fails, follow this workflow:

```
1. Find the failed entity
   └─ ff-eg-read search nodes-scoped --condition '{"status": "Error"}'

2. Get entity details
   └─ ff-eg-read node get <entity-id>
   └─ Check entity data for malformed input

3. Find the telemetry trace
   └─ ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

4. Inspect the LLM interaction
   └─ ff-telemetry-read trace get <broker-request-id>
   └─ Check: prompt tokens, completion tokens, error messages

5. Reproduce locally
   └─ ff-sdk-cli invoke with the same input
```

### Common Bot Failure Causes

**Schema validation failure (all retries exhausted):**

```bash
# Check telemetry for the request
ff-telemetry-read trace get <broker-request-id>
# Look at: completion content vs expected schema
# Fix: simplify schema, improve prompt instructions, increase max_tries
```

**Model returned empty or truncated response:**

```bash
# Check token counts
ff-telemetry-read llm recent --fields id,prompt_tokens,completion_tokens
# If completion_tokens is very high, output may have been truncated
# Fix: request shorter output, use a model with higher token limit
```

**Broker timeout or rate limit:**

```bash
# Check for error responses
ff-telemetry-read broker failed --limit 10
# Look at: error_code, error_message
# Fix: add retry logic, use a different model pool, reduce concurrency
```

### Reproducing Bot Issues Locally

Extract the prompt from telemetry and replay it:

```bash
# Get the full trace with prompt content
ff-telemetry-read trace get <broker-request-id> --verbose

# Use ff-brk to replay the exact prompt
ff-brk chat --model-pool firebrand_completion_default \
  --system "extracted system prompt" \
  --message "extracted user message"
```

---

## Debugging Workflow Failures

### Finding the Failed Step

Multi-step workflows create child entities. Find which step failed:

```bash
# Get the parent entity
ff-eg-read node get <workflow-entity-id>

# List child entities and their statuses
ff-eg-read edges from <workflow-entity-id>
# Look for children with status: Error
```

### Resuming Failed Workflows

`RunnableEntity` supports resumability. After fixing the root cause, re-run the entity:

```bash
# Re-trigger the entity via its API endpoint
ff-sdk-cli invoke --url http://main-bundle:3000 \
  --method POST --route retry \
  --body '{"entity_id": "<failed-entity-id>"}'
```

The entity framework skips completed steps and resumes from the failure point.

### Inspecting Intermediate State

Check working memory for intermediate outputs between workflow steps:

```bash
# List all working memory for the entity
ff-wm-read list --entity-id <entity-id>

# Download and inspect intermediate results
ff-wm-read download <wm-id> --output ./step-output.json
cat ./step-output.json | jq .
```

---

## Debugging Connection Issues

### Platform Service Connectivity

When a bundle can't connect to platform services:

```bash
# Check environment variables
kubectl exec <pod-name> -n ff-env -- env | grep -E 'LLM_|PG_|CONTEXT_'

# Test broker connectivity
kubectl exec <pod-name> -n ff-env -- nc -zv $LLM_BROKER_HOST $LLM_BROKER_PORT

# Test entity graph (PostgreSQL)
kubectl exec <pod-name> -n ff-env -- nc -zv $PG_HOST 5432

# Test context service
kubectl exec <pod-name> -n ff-env -- curl -s http://$CONTEXT_SERVICE_ADDRESS/health
```

### DNS Resolution

Service discovery issues in Kubernetes:

```bash
# Verify DNS resolves
kubectl exec <pod-name> -n ff-env -- nslookup ff-broker.ff-system.svc

# Check if the target service is running
kubectl get pods -n ff-system -l app=ff-broker
kubectl get svc -n ff-system ff-broker
```

### Pod Resource Issues

```bash
# Check resource usage
kubectl top pod <pod-name> -n ff-env

# Check for OOMKilled events
kubectl describe pod <pod-name> -n ff-env | grep -A 3 "Last State"

# Check pod events
kubectl get events -n ff-env --field-selector involvedObject.name=<pod-name>
```

---

## Common Failure Patterns

### Pattern: Entity Stuck in InProgress

**Symptom:** Entity status remains `InProgress` indefinitely.

**Diagnosis:**
```bash
# Check when the entity was last updated
ff-eg-read node get <entity-id>
# Look at updated_at timestamp

# Check if the pod is still running
kubectl get pods -n ff-env -l app=main-bundle

# Check for OOMKilled or pod restart
kubectl describe pod <pod-name> -n ff-env
```

**Common causes:**
- Pod was restarted (OOMKilled, deployment update) mid-execution
- LLM call hanging (broker not responding)
- Deadlock in parallel execution

**Fix:** Re-run the entity. The resumable framework will pick up from the last checkpoint.

### Pattern: Cascading Entity Failures

**Symptom:** A parent entity fails, leaving child entities in various states.

**Diagnosis:**
```bash
# Check parent entity
ff-eg-read node get <parent-id>

# Check all child entities
ff-eg-read edges from <parent-id>
```

**Fix:** Fix the root cause, then re-run the parent entity. Completed children will be skipped; failed/pending children will be retried.

### Pattern: Intermittent Schema Validation Failures

**Symptom:** A bot occasionally fails with schema validation errors despite working most of the time.

**Diagnosis:**
```bash
# Check telemetry for validation failures
ff-telemetry-read broker failed --limit 20
# Look for patterns: same bot, specific input types, specific model

# Check the actual LLM output
ff-telemetry-read trace get <request-id> --verbose
```

**Common causes:**
- Input data has edge cases (very long text, special characters)
- Model produces numeric strings instead of numbers
- Enum values don't match (case sensitivity, extra whitespace)

**Fix:** Add `.transform()` or `.preprocess()` to Zod schema. Increase `max_tries`. Improve prompt instructions for edge cases.

### Pattern: High Latency Spikes

**Symptom:** Requests occasionally take much longer than usual.

**Diagnosis:**
```bash
# Check for slow broker requests
ff-telemetry-read broker recent --sort duration --desc --limit 10

# Check pod resource usage
kubectl top pods -n ff-env -l app=main-bundle

# Check if the broker is queuing requests
ff-telemetry-read broker recent --fields id,queued_at,started_at,completed_at
```

**Common causes:**
- Large prompt tokens (input grew unexpectedly)
- Broker queuing under high load
- Pod memory pressure (GC pauses)

**Fix:** See [Performance & Optimization](performance-optimization.md) for prompt and concurrency tuning.

---

## Production Monitoring Checklist

Use this checklist to set up monitoring for a new production deployment:

### Health Monitoring

- [ ] Health and readiness probes configured in `firefoundry.json`
- [ ] Kubernetes liveness probe restarts unhealthy pods
- [ ] Kubernetes readiness probe removes pods from service on failure

### Log Monitoring

- [ ] `LOG_LEVEL` set to `info` in production
- [ ] Log aggregator configured (e.g., Loki, ELK, CloudWatch)
- [ ] Alerts on `error` level log spikes

### Entity Monitoring

- [ ] Periodic check for entities stuck in `Error` status
- [ ] Periodic check for entities stuck in `InProgress` beyond expected duration
- [ ] Entity creation rate tracked as a throughput metric

### Telemetry Monitoring

- [ ] Broker failure rate monitored (alert if > 5%)
- [ ] Token usage tracked for cost monitoring
- [ ] Latency percentiles tracked (p50, p95, p99)

### Resource Monitoring

- [ ] Pod CPU and memory usage tracked
- [ ] Node-level resource availability monitored
- [ ] Autoscaler configured for variable workloads

---

## Related Guides

- **[Deployment & Configuration](deployment-configuration.md)** — configuring health checks, resources, and environment variables
- **[Performance & Optimization](performance-optimization.md)** — reducing latency and improving throughput
- **[Error Handling & Resilience](error-handling-resilience.md)** — error patterns that produce the failures you're debugging
- **[Testing Guide](testing-guide.md)** — catching issues before production
- **[Entity Lifecycle & Patterns](entity-lifecycle-patterns.md)** — understanding entity status transitions
