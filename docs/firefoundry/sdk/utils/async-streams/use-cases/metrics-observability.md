# Metrics and Observability

Instrument async pipelines and capacity sources with built-in metrics collectors to answer: how fast is data flowing, where is time being spent, and how utilized are my resources?

## The Problem

You have a multi-stage async pipeline processing data through transforms, filters, and resource-gated scheduling. Everything works, but you cannot answer basic operational questions:

- **Throughput**: How many items per second pass through each stage?
- **Latency**: How long does an item take to travel from ingress to egress?
- **Utilization**: What fraction of my resource pool is in use at any moment?
- **Rejection rate**: How often are resource acquisition attempts denied?

Without instrumentation, these pipelines are opaque. You resort to ad-hoc `console.log` timestamps, manual counters, or external APM wrappers that do not understand the pipeline's internal structure.

## The Strategy

**Turnstiles for throughput, sections for duration, capacity collectors for utilization.**

The library provides two complementary metrics collectors that can be wired into pipelines without altering application logic:

### DefaultChainMetricsCollector

Attaches to `PullChain` or `PushChainBuilder` pipelines. It offers two instrumentation primitives:

1. **Turnstiles** -- Named checkpoints placed between pipeline stages. Every item that passes through is counted. When two turnstiles are placed at different points in the chain, the collector automatically computes inter-stage latency by correlating passes (FIFO ordering by default, or by explicit item ID for pipelines with reordering).

2. **Sections** -- Named regions with `enterSection()`/`leaveSection()` calls that track in-flight count, completion count, error count, and rolling duration statistics.

### DefaultCapacityMetricsCollector

Attaches to a `ResourceCapacitySource` via its constructor. It observes every `tryAcquire`, `release`, `reset`, `increment`, and `setLimits` event, providing:

- Cumulative event counts (accepted, rejected, released, reset, etc.)
- Per-resource in-flight tracking (acquired minus released)
- Per-resource utilization ratio (0.0 to 1.0)
- Per-resource rejection totals
- Rolling-window event rates (accepts/sec, rejects/sec, releases/sec)

Both collectors produce a `snapshot()` at any time -- a frozen, JSON-serializable object you can log, push to an APM system, or render in a dashboard.

## Architecture

```
PullChain pipeline:
  SourceBufferObj([items...])
    |
    +-- turnstile("ingress", chainCollector)
    |
    +-- map(item => transform(item))
    |
    +-- turnstile("transformed", chainCollector)
    |
    +-- filter(item => item.valid)
    |
    +-- turnstile("egress", chainCollector)
    |
    v
  .collect()

    chainCollector.snapshot() =>
      turnstiles: { ingress: { passed: N }, transformed: { passed: N }, egress: { passed: M } }
      stageLatencyMs: { "ingress->transformed": stats, "transformed->egress": stats }

ResourceCapacitySource with metrics:
  capacityCollector = new DefaultCapacityMetricsCollector()
  pool = new ResourceCapacitySource({ slots: 4 }, undefined, capacityCollector)
    |
    +-- tryAcquire({ slots: 1 })  -->  onTryAcquireAccepted / onTryAcquireRejected
    +-- release({ slots: 1 })     -->  onRelease
    |
    v
  capacityCollector.snapshot() =>
    totals: { acquireAccepted, acquireRejected, release }
    inFlightByResource: { slots: 2 }
    utilizationByResource: { slots: 0.50 }
    rates: { acquireAcceptedPerSec: stats, ... }
```

## Implementation

### Chain metrics with turnstiles

Place `.turnstile()` calls at the points where you want to measure. Each turnstile is a zero-overhead pass-through that reports to the shared collector:

```typescript
import {
  SourceBufferObj,
  PullChain,
  DefaultChainMetricsCollector,
} from '@firebrandanalytics/shared-utils';

const collector = new DefaultChainMetricsCollector();
const items = Array.from({ length: 100 }, (_, i) => ({ id: i, payload: `msg-${i}` }));
const source = new SourceBufferObj(items, true);

const results = await PullChain.from(source)
  .turnstile('ingress', collector)
  .map(item => ({ ...item, payload: item.payload.toUpperCase() }))
  .turnstile('transformed', collector)
  .filter(item => item.id % 2 === 0)
  .turnstile('egress', collector)
  .collect();

const snap = collector.snapshot();
console.log('ingress count:', snap.turnstiles['ingress'].passed);       // 100
console.log('egress count:',  snap.turnstiles['egress'].passed);        // 50 (filter)
console.log('ingress->egress latency:', snap.stageLatencyMs['ingress->egress']);
```

The collector automatically pairs turnstile passes in FIFO order: pass N at "ingress" is correlated with pass N at "transformed", giving you per-item inter-stage latency without any ID extraction. For pipelines that reorder items, pass an `id` extractor:

```typescript
.turnstile('ingress', collector, { id: (item) => item.id })
```

### Capacity metrics with ResourceCapacitySource

Pass a `DefaultCapacityMetricsCollector` as the third argument to `ResourceCapacitySource`. Every `tryAcquire` and `release` is then tracked:

```typescript
import {
  ResourceCapacitySource,
  DefaultCapacityMetricsCollector,
} from '@firebrandanalytics/shared-utils';

const capacityCollector = new DefaultCapacityMetricsCollector();
const pool = new ResourceCapacitySource(
  { slots: 4, memory_gb: 16 },
  undefined,           // no parent
  capacityCollector,
);

// Acquire and release in a work loop
const result = pool.tryAcquire({ slots: 1, memory_gb: 4 });
if (result.ok) {
  // ... do work ...
  pool.release({ slots: 1, memory_gb: 4 });
}

const snap = capacityCollector.snapshot();
console.log('accepted:', snap.totals.acquireAccepted);
console.log('rejected:', snap.totals.acquireRejected);
console.log('utilization:', snap.utilizationByResource);
console.log('in-flight:', snap.inFlightByResource);
```

### Combining both collectors

In a real system, you often have a resource-gated scheduler driving a pipeline. Wire both collectors to get a unified view:

```typescript
const capacityMetrics = new DefaultCapacityMetricsCollector();
const chainMetrics    = new DefaultChainMetricsCollector();

const pool = new ResourceCapacitySource({ slots: 3 }, undefined, capacityMetrics);

// For each task, gate on capacity and run a metered pipeline
for (let i = 0; i < 10; i++) {
  const r = pool.tryAcquire({ slots: 1 });
  if (!r.ok) continue;

  const data = new SourceBufferObj([i * 10, i * 10 + 1, i * 10 + 2], true);
  await PullChain.from(data)
    .turnstile('task-in', chainMetrics)
    .map(x => x + 1)
    .turnstile('task-out', chainMetrics)
    .collect();

  pool.release({ slots: 1 });
}

// Both snapshots are JSON-serializable
console.log('capacity:', capacityMetrics.snapshot());
console.log('chain:',    chainMetrics.snapshot());
```

For the full runnable version with a multi-stage pipeline and formatted snapshot output, see [`examples/metrics-observability.ts`](../examples/metrics-observability.ts).

## What to Observe

With 50 items flowing through a 3-stage pipeline and a 4-slot resource pool:

```
-- Chain Metrics Snapshot --

  Turnstiles:
    ingress       50 items   throughput 50.0/s (window 60s)
    transformed   50 items   throughput 50.0/s (window 60s)
    egress        25 items   throughput 25.0/s (window 60s)

  Stage Latency:
    ingress->transformed    avg  5.2ms   min  2.1ms   max 12.3ms
    transformed->egress     avg  3.1ms   min  1.0ms   max  8.7ms
    ingress->egress         avg  8.4ms   min  3.5ms   max 18.9ms

-- Capacity Metrics Snapshot --

  Totals:
    acquireAccepted   50    acquireRejected   3    releases   50

  In-Flight:
    slots   0 / 4

  Utilization:
    slots   0.00

  Rates (60s window):
    accepts/sec   50    rejects/sec   3    releases/sec   50
```

Key observations:

| Metric | What it tells you |
|--------|-------------------|
| **Turnstile passed** | How many items reached each stage. A drop between turnstiles indicates a filter or error path. |
| **Stage latency** | Where time is spent. A high `ingress->transformed` latency points to a slow transform. |
| **Throughput rate** | Rolling items/sec at each checkpoint. Useful for detecting slowdowns over time. |
| **acquireAccepted / Rejected** | Whether the resource pool is a bottleneck. A high rejection rate means tasks are contending for capacity. |
| **Utilization** | How much of the resource ceiling is in use. Values near 1.0 indicate saturation. |
| **In-flight** | Current active resource consumption. Should return to 0 when all tasks complete. |

## Variations

### Bridging to OpenTelemetry

The `MetricsSink` interface provides a lightweight bridge contract. Implement `counter()`, `gauge()`, and `duration()` to push data to any external system:

```typescript
import type { MetricsSink } from '@firebrandanalytics/shared-utils';

const otelSink: MetricsSink = {
  counter(name, delta, attrs) { /* otelMeter.createCounter(name).add(delta, attrs) */ },
  gauge(name, value, attrs)   { /* otelMeter.createObservableGauge(name)... */ },
  duration(name, ms, attrs)   { /* otelMeter.createHistogram(name).record(ms, attrs) */ },
};
```

### Periodic snapshot logging

Capture snapshots on an interval and ship them as structured logs:

```typescript
const interval = setInterval(() => {
  const snap = {
    capturedAtMs: Date.now(),
    capacity: capacityCollector.snapshot(),
    chain: chainCollector.snapshot(),
  };
  console.log(JSON.stringify(snap));
}, 10_000);
```

### Per-item ID correlation for push chains

Push chains with variable-latency async operators may reorder items. Use the `id` option to maintain correct cross-stage correlation:

```typescript
PushChainBuilder.start<Message>()
  .turnstile('in', collector, { id: (msg) => msg.id })
  .map(async (msg) => { /* variable-latency work */ })
  .turnstile('out', collector, { id: (msg) => msg.id })
  .toArray();
```

### Custom rolling window size

Both collectors accept a `windowMs` parameter (default 60,000 ms). Shorter windows give more responsive rates; longer windows smooth out bursts:

```typescript
// 10-second window for near-real-time dashboards
const collector = new DefaultChainMetricsCollector(10_000);

// 5-minute window for smoother averages
const capacityCollector = new DefaultCapacityMetricsCollector(300_000);
```

## See Also

- [Use Case: Rate-Limiting and Usage Quotas](./rate-limiting.md) -- QuotaCapacitySource patterns (metrics collectors work identically with quota sources)
- [Use Case: Multi-Resource Scheduling](./multi-resource-scheduling.md) -- ResourceCapacitySource patterns with multi-dimensional costs
- [Use Case: Adaptive Capacity](./adaptive-capacity.md) -- Dynamic scaling, where utilization metrics drive `setLimits()` decisions
