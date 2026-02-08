# Metrics & Observability Reference

API reference for the metrics and observability subsystem of the async streams library. This subsystem provides lightweight in-process metric primitives, domain-specific collectors for capacity management and chain pipelines, and an optional sink interface for bridging to external telemetry systems (OpenTelemetry, Prometheus, etc.).

For design philosophy and how these pieces fit into the broader async streams architecture, see the [Conceptual Guide](../concepts.md).

```typescript
import {
    // Primitives
    ICounter, IUpDown, IDuration, IRollingWindow,
    Counter, UpDown, Duration, RollingWindow,
    RollingWindowStats,

    // Capacity metrics
    ICapacityMetricsCollector, DefaultCapacityMetricsCollector,
    CapacityMetricsSnapshot, TryAcquireResult, TryAcquireRejectReason,
    CapacityAcquireAcceptedEvent, CapacityAcquireRejectedEvent,
    CapacityReleaseEvent, CapacityResetEvent,
    CapacityIncrementEvent, CapacitySetLimitsEvent,

    // Chain metrics
    IChainMetricsCollector, DefaultChainMetricsCollector,
    ChainMetricsSnapshot, TurnstileSnapshot, SectionSnapshot,
    ChainToken, ChainSectionStatus, TurnstileOptions,

    // Sink
    MetricsSink, MetricsSnapshot, MetricAttrs,

    // Integration targets
    ResourceCapacitySource, PullChain, PushChainBuilder,
} from '@firebrandanalytics/shared-utils';
```

---

## Architecture Overview

The metrics subsystem is organized in three layers:

```
 Primitives              Domain Collectors               Sink
 ──────────              ─────────────────               ────
 Counter          ──>   CapacityMetricsCollector   ──>   MetricsSink
 UpDown           ──>   ChainMetricsCollector      ──>   (OTel, Prometheus, ...)
 RollingWindow
 Duration
```

**Primitives** are low-level building blocks (counters, gauges, rolling windows, duration trackers) that are composed internally by the collectors. Library consumers do not use primitives directly.

**Domain collectors** aggregate metrics for specific subsystems. `CapacityMetricsCollector` tracks resource acquire/reject/release events on `ResourceCapacitySource`. `ChainMetricsCollector` tracks throughput at named checkpoints (turnstiles), in-flight item counts, and inter-stage latency across `PullChain` and `PushChainBuilder` pipelines.

**MetricsSink** is an optional bridge interface for exporting collected metrics to external observability systems. The default collectors are fully self-contained (in-memory with rolling-window statistics). The sink decouples the library from any specific telemetry SDK.

---

## Primitives

These are internal building blocks used by the domain collectors. They are exported for custom collector implementations but are not intended for direct use by library consumers.

### RollingWindowStats

Aggregated statistics from a rolling time window. Returned by `IRollingWindow.stats()` and `IDuration.stats()`.

```typescript
export interface RollingWindowStats {
    /** The window duration in milliseconds. */
    windowMs: number;
    /** Number of observations in the window. */
    count: number;
    /** Sum of observed values in the window. */
    sum: number;
    /** Arithmetic mean of observed values (0 if count is 0). */
    avg: number;
    /** Smallest observed value, or null if no observations. */
    min: number | null;
    /** Largest observed value, or null if no observations. */
    max: number | null;
}
```

When no observations exist within the window, `count` is 0, `sum` is 0, `avg` is 0, and both `min` and `max` are `null`.

---

### ICounter

A monotonically increasing counter. Counters only go up (or reset to zero). Use for: total requests, total items processed, total errors.

```typescript
export interface ICounter {
    /** Increment by delta (default 1). Delta must be non-negative. */
    add(delta?: number): void;
    /** Current counter value. */
    value(): number;
    /** Reset to zero. */
    reset(): void;
}
```

**Implementation:** `Counter` -- simple in-memory counter.

```typescript
const counter = new Counter();
counter.add();       // value() === 1
counter.add(5);      // value() === 6
counter.reset();     // value() === 0
```

---

### IUpDown

A gauge that can go up or down. Use for: in-flight items, current queue depth, current utilization.

```typescript
export interface IUpDown {
    /** Add delta (positive to increase, negative to decrease). */
    add(delta: number): void;
    /** Current gauge value. */
    value(): number;
    /** Reset to zero. */
    reset(): void;
}
```

**Implementation:** `UpDown` -- simple in-memory gauge.

```typescript
const gauge = new UpDown();
gauge.add(3);        // value() === 3
gauge.add(-1);       // value() === 2
gauge.reset();       // value() === 0
```

---

### IRollingWindow

A rolling time window that tracks arbitrary numeric observations. Observations older than `windowMs` are evicted on each read. Use for: throughput rate, utilization sampling, moving averages.

```typescript
export interface IRollingWindow {
    /** Record a value. atMs defaults to Date.now(). */
    observe(value: number, atMs?: number): void;
    /** Compute statistics over the current window. */
    stats(nowMs?: number): RollingWindowStats;
    /** Clear all observations. */
    reset(): void;
}
```

**Implementation:** `RollingWindow` -- array-backed with lazy eviction on reads.

```typescript
const window = new RollingWindow(60_000); // 60-second window

window.observe(100);
window.observe(200);
window.observe(150);

const stats = window.stats();
// stats.count === 3
// stats.sum === 450
// stats.avg === 150
// stats.min === 100
// stats.max === 200
```

The implementation uses a simple array with lazy eviction. For typical in-process use (hundreds to low thousands of observations per window), this is more than fast enough. For millions of observations per second, use a circular buffer or time-bucketed histogram instead.

**Constructor:**

```typescript
constructor(windowMs: number)
```

| Parameter | Description |
|-----------|-------------|
| `windowMs` | Duration of the rolling window in milliseconds |

---

### IDuration

Records durations and provides rolling-window statistics. Use for: request latency, section processing time, stage duration.

```typescript
export interface IDuration {
    /** Record an externally measured duration in milliseconds. */
    record(durationMs: number): void;
    /** Start a timer. Returns a stop function that records the elapsed ms and returns it. */
    start(): () => number;
    /** Rolling-window statistics of recorded durations. */
    stats(nowMs?: number): RollingWindowStats;
    /** Clear all recorded data. */
    reset(): void;
}
```

**Implementation:** `Duration` -- backed by a `RollingWindow`.

```typescript
const duration = new Duration(60_000); // 60-second window

// Option 1: Record a known duration
duration.record(42);

// Option 2: Start/stop timer
const stop = duration.start();
await doExpensiveWork();
const elapsedMs = stop(); // records and returns elapsed time

const stats = duration.stats();
// stats contains rolling-window statistics of all recorded durations
```

**Constructor:**

```typescript
constructor(windowMs: number)
```

| Parameter | Description |
|-----------|-------------|
| `windowMs` | Duration of the rolling window in milliseconds |

---

## Capacity Metrics

### TryAcquireResult

Discriminated union returned by `ResourceCapacitySource.tryAcquire()`. On success (`ok: true`), resources have been atomically acquired. On failure (`ok: false`), nothing was acquired and the reason is provided.

```typescript
export type TryAcquireResult =
    | {
        ok: true;
        /** The cost that was requested and acquired. */
        requested: Readonly<ResourceCost>;
        /** Available resources after the acquisition. */
        availableAfter: Readonly<ResourceCost>;
    }
    | {
        ok: false;
        /** The cost that was requested. */
        requested: Readonly<ResourceCost>;
        /** Available resources at the time of rejection. */
        available: Readonly<ResourceCost>;
        /** Why the acquisition failed. */
        reason: TryAcquireRejectReason;
    };
```

---

### TryAcquireRejectReason

```typescript
export type TryAcquireRejectReason = "insufficient_capacity" | "invalid_cost";
```

| Reason | Meaning |
|--------|---------|
| `"insufficient_capacity"` | The requested resources exceed what is currently available |
| `"invalid_cost"` | The cost contains negative values |

---

### Capacity Event Types

Six event types are emitted by `ResourceCapacitySource` to the capacity metrics collector:

**CapacityAcquireAcceptedEvent** -- emitted when `tryAcquire()` succeeds:

```typescript
export interface CapacityAcquireAcceptedEvent {
    atMs: number;
    requested: Readonly<ResourceCost>;
    availableAfter: Readonly<ResourceCost>;
}
```

**CapacityAcquireRejectedEvent** -- emitted when `tryAcquire()` is rejected:

```typescript
export interface CapacityAcquireRejectedEvent {
    atMs: number;
    requested: Readonly<ResourceCost>;
    available: Readonly<ResourceCost>;
    reason: TryAcquireRejectReason;
}
```

**CapacityReleaseEvent** -- emitted when `release()` is called:

```typescript
export interface CapacityReleaseEvent {
    atMs: number;
    released: Readonly<ResourceCost>;
    availableAfter: Readonly<ResourceCost>;
}
```

**CapacityResetEvent** -- emitted when `reset()` is called:

```typescript
export interface CapacityResetEvent {
    atMs: number;
    limitsAfter: Readonly<ResourceCost>;
    availableAfter: Readonly<ResourceCost>;
}
```

**CapacityIncrementEvent** -- emitted when `increment()` is called:

```typescript
export interface CapacityIncrementEvent {
    atMs: number;
    incrementBy: Readonly<ResourceCost>;
    availableAfter: Readonly<ResourceCost>;
}
```

**CapacitySetLimitsEvent** -- emitted when `setLimits()` is called (and on construction):

```typescript
export interface CapacitySetLimitsEvent {
    atMs: number;
    limitsBefore: Readonly<ResourceCost>;
    limitsAfter: Readonly<ResourceCost>;
    availableAfter: Readonly<ResourceCost>;
}
```

---

### CapacityMetricsSnapshot

Point-in-time snapshot of all capacity metrics, returned by `ICapacityMetricsCollector.snapshot()`.

```typescript
export interface CapacityMetricsSnapshot {
    /** When this snapshot was captured. */
    capturedAtMs: number;
    /** Cumulative event counts since last reset. */
    totals: {
        acquireAccepted: number;
        acquireRejected: number;
        release: number;
        reset: number;
        increment: number;
        setLimits: number;
    };
    /** Current in-flight resources per dimension (acquired minus released). */
    inFlightByResource: Record<string, number>;
    /** Cumulative rejected capacity per resource dimension. */
    requestedRejectedByResource: Record<string, number>;
    /** Current utilization ratio (0.0-1.0) per resource dimension. */
    utilizationByResource: Record<string, number>;
    /** Rolling-window event rates. */
    rates: {
        acquireAcceptedPerSec: RollingWindowStats;
        acquireRejectedPerSec: RollingWindowStats;
        releasePerSec: RollingWindowStats;
    };
}
```

| Field | Description |
|-------|-------------|
| `totals` | Cumulative counts of each event type since the collector was created |
| `inFlightByResource` | Per-resource gauge showing how much capacity is currently in use (acquired minus released) |
| `requestedRejectedByResource` | Per-resource counter of rejected amounts. Only accumulates for `insufficient_capacity` rejections (not `invalid_cost`, where amounts may be negative). |
| `utilizationByResource` | Per-resource ratio computed as `(limit - available) / limit`. Ranges from 0.0 (idle) to 1.0 (fully used). Resources with a limit of 0 report 0. |
| `rates` | Rolling-window statistics for event rates. The `count` field indicates how many events occurred within the window; `sum`, `avg`, `min`, and `max` reflect the observation values (each event observes a value of 1). |

---

### ICapacityMetricsCollector

Interface for capacity metrics collection. Implement this to create custom collectors (e.g., an OTel bridge).

```typescript
export interface ICapacityMetricsCollector {
    onTryAcquireAccepted(event: CapacityAcquireAcceptedEvent): void;
    onTryAcquireRejected(event: CapacityAcquireRejectedEvent): void;
    onRelease(event: CapacityReleaseEvent): void;
    onReset(event: CapacityResetEvent): void;
    onIncrement(event: CapacityIncrementEvent): void;
    onSetLimits(event: CapacitySetLimitsEvent): void;
    snapshot(nowMs?: number): CapacityMetricsSnapshot;
}
```

| Method | Called when |
|--------|------------|
| `onTryAcquireAccepted` | `tryAcquire()` succeeds |
| `onTryAcquireRejected` | `tryAcquire()` fails (insufficient capacity or invalid cost) |
| `onRelease` | `release()` is called |
| `onReset` | `reset()` is called |
| `onIncrement` | `increment()` is called |
| `onSetLimits` | `setLimits()` is called (also called once during construction) |
| `snapshot` | Captures a point-in-time view of all aggregated metrics |

---

### DefaultCapacityMetricsCollector

In-memory capacity metrics collector. Tracks event counts, per-resource in-flight usage, rejection totals, and rolling-window event rates. Thread-safe by JavaScript's single-threaded event loop guarantee.

**Constructor:**

```typescript
constructor(windowMs = 60_000)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `windowMs` | `60000` | Rolling window duration for rate calculations in milliseconds |

**Usage Example:**

```typescript
const metrics = new DefaultCapacityMetricsCollector();
const capacity = new ResourceCapacitySource(
    { gpu: 4, cpu: 8 },
    undefined,  // no parent
    metrics,    // attach the collector
);

// tryAcquire emits metrics (canAcquire does not)
const result = capacity.tryAcquire({ gpu: 2, cpu: 4 });
if (result.ok) {
    // Do work...
    capacity.release({ gpu: 2, cpu: 4 });
}

// Inspect the snapshot
const snap = metrics.snapshot();
console.log(snap.totals.acquireAccepted);       // 1
console.log(snap.totals.release);                // 1
console.log(snap.inFlightByResource['gpu']);      // 0 (released)
console.log(snap.utilizationByResource['gpu']);   // 0.0 (all available)
```

**Rejection tracking example:**

```typescript
const metrics = new DefaultCapacityMetricsCollector();
const capacity = new ResourceCapacitySource({ gpu: 2 }, undefined, metrics);

// Acquire all GPUs
capacity.tryAcquire({ gpu: 2 }); // ok: true

// Attempt to acquire more -- rejected
const result = capacity.tryAcquire({ gpu: 1 });
// result.ok === false
// result.reason === "insufficient_capacity"

const snap = metrics.snapshot();
console.log(snap.totals.acquireAccepted);            // 1
console.log(snap.totals.acquireRejected);            // 1
console.log(snap.requestedRejectedByResource['gpu']); // 1
console.log(snap.inFlightByResource['gpu']);           // 2
console.log(snap.utilizationByResource['gpu']);        // 1.0
```

**Rolling-window rates example:**

```typescript
// Use a 1-second window for demonstration
const metrics = new DefaultCapacityMetricsCollector(1000);
const capacity = new ResourceCapacitySource({ slots: 100 }, undefined, metrics);

// Perform several acquisitions
for (let i = 0; i < 10; i++) {
    capacity.tryAcquire({ slots: 1 });
}

const snap = metrics.snapshot();
console.log(snap.rates.acquireAcceptedPerSec.count); // 10 (within the window)
```

**Important:** Only `tryAcquire()` emits acceptance and rejection metrics. The lower-level `canAcquire()` + `acquireImmediate()` protocol does not emit metrics, because `canAcquire()` is an advisory check that should not count as a rejection. Use `tryAcquire()` when you want full observability.

---

## Chain Metrics

### ChainToken

Opaque token for correlating section enter/leave events. Monotonically increasing integer, minted by the collector.

```typescript
export type ChainToken = number;
```

---

### ChainSectionStatus

Outcome of a section leave.

```typescript
export type ChainSectionStatus = "ok" | "error" | "cancelled";
```

---

### TurnstileOptions\<T\>

Options for `turnstile()` on `PullChain` and `PushChainBuilder`.

```typescript
export interface TurnstileOptions<T> {
    /**
     * Extract a stable identity from each item for cross-stage correlation.
     *
     * When provided, the collector uses this ID to compute inter-stage latency
     * (time between the same item passing two different turnstiles).
     *
     * When omitted, the collector uses FIFO ordering -- turnstile pass N at
     * checkpoint A is paired with turnstile pass N at checkpoint B.
     */
    id?: (item: T) => string | number;
}
```

**When to use FIFO (default) vs. ID correlation:**

| Scenario | Correlation mode | Rationale |
|----------|-----------------|-----------|
| Pull chain (sequential) | FIFO (omit `id`) | Items pass through in order; FIFO is always correct |
| Push chain, synchronous operators | FIFO (omit `id`) | No reordering between turnstiles |
| Push chain, variable-latency async operators | Provide `id` | Items may arrive at downstream turnstiles in a different order |
| Chain with filters between turnstiles | Provide `id` | Filtered items break FIFO pairing |

---

### TurnstileSnapshot

Per-turnstile aggregated metrics, included in `ChainMetricsSnapshot`.

```typescript
export interface TurnstileSnapshot {
    /** Total items that passed this turnstile. */
    passed: number;
    /** Rolling-window throughput rate. */
    throughputPerSec: RollingWindowStats;
}
```

---

### SectionSnapshot

Per-section aggregated metrics, included in `ChainMetricsSnapshot`.

```typescript
export interface SectionSnapshot {
    /** Total items that entered this section. */
    entered: number;
    /** Total items that left this section (any status). */
    left: number;
    /** Total items that left with status "error". */
    errored: number;
    /** Items currently inside the section. */
    inFlight: number;
    /** Rolling-window duration statistics for completed items. */
    durationMs: RollingWindowStats;
}
```

---

### ChainMetricsSnapshot

Point-in-time snapshot of all chain metrics, returned by `IChainMetricsCollector.snapshot()`.

```typescript
export interface ChainMetricsSnapshot {
    /** When this snapshot was captured. */
    capturedAtMs: number;
    /** Per-checkpoint turnstile metrics. */
    turnstiles: Record<string, TurnstileSnapshot>;
    /** Per-section enter/leave metrics. */
    sections: Record<string, SectionSnapshot>;
    /**
     * Inter-stage latency between pairs of turnstiles.
     * Keys are "checkpointA->checkpointB" (in order of first observation).
     */
    stageLatencyMs: Record<string, RollingWindowStats>;
}
```

| Field | Description |
|-------|-------------|
| `turnstiles` | Per-checkpoint throughput counts and rolling-window rates. Keyed by the checkpoint name passed to `onTurnstilePass()`. |
| `sections` | Per-section in-flight, duration, and error counts. Keyed by the section name passed to `enterSection()` / `leaveSection()`. |
| `stageLatencyMs` | Inter-stage latency between pairs of turnstiles. Keys are `"A->B"` where A was observed before B. Latency is computed by correlating individual item passes across checkpoints (using FIFO or ID-keyed matching). |

---

### IChainMetricsCollector

Interface for chain metrics collection. Implement this for custom collection (e.g., an OTel bridge).

```typescript
export interface IChainMetricsCollector {
    /**
     * Record an item passing a named checkpoint.
     *
     * @param checkpoint Name of the checkpoint (e.g., "ingress", "decoded").
     * @param itemId Optional stable identity for cross-stage correlation.
     *   When omitted, uses FIFO ordering.
     * @param atMs Timestamp override (default Date.now()).
     */
    onTurnstilePass(checkpoint: string, itemId?: string | number, atMs?: number): void;

    /**
     * Record an item entering a named section. Returns a token for leave correlation.
     *
     * @param section Name of the section (e.g., "decode", "transform").
     * @param atMs Timestamp override (default Date.now()).
     * @returns An opaque token to pass to leaveSection().
     */
    enterSection(section: string, atMs?: number): ChainToken;

    /**
     * Record an item leaving a named section.
     *
     * @param section Name of the section (must match the enterSection call).
     * @param token The token returned by enterSection().
     * @param status Outcome: "ok" (default), "error", or "cancelled".
     * @param atMs Timestamp override (default Date.now()).
     */
    leaveSection(section: string, token: ChainToken, status?: ChainSectionStatus, atMs?: number): void;

    /** Capture a point-in-time snapshot of all metrics. */
    snapshot(nowMs?: number): ChainMetricsSnapshot;
}
```

| Method | Purpose |
|--------|---------|
| `onTurnstilePass` | Count an item at a named checkpoint and contribute to inter-stage latency calculation |
| `enterSection` | Begin timing an item in a named section; returns a token for later correlation |
| `leaveSection` | End timing for a section entry; records duration and updates in-flight count |
| `snapshot` | Produce a point-in-time view of all turnstile, section, and latency metrics |

---

### DefaultChainMetricsCollector

In-memory chain metrics collector. Tracks per-checkpoint throughput (turnstiles), per-section in-flight/duration/error counts, and inter-stage latency between turnstile pairs using FIFO or ID-keyed correlation.

**Constructor:**

```typescript
constructor(windowMs = 60_000, maxPendingCorrelation = 10_000)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `windowMs` | `60000` | Rolling window duration for rate and duration calculations in milliseconds |
| `maxPendingCorrelation` | `10000` | Maximum unmatched entries per turnstile before the oldest are evicted. Prevents unbounded memory growth when items are dropped or filtered between turnstiles. |

**Turnstile tracking:**

When `onTurnstilePass()` is called, the collector:

1. Increments the pass counter for the checkpoint.
2. Records a rate observation in the rolling window.
3. Computes inter-stage latency from all earlier checkpoints to this one (using FIFO or ID-keyed matching).
4. Stores the timestamp for future downstream correlation.

Checkpoint order is determined by order of first observation. If checkpoint "A" is first observed before checkpoint "B", the latency key will be `"A->B"`.

**Section tracking:**

Section tracking uses a token-based enter/leave protocol:

1. `enterSection("name")` increments the entered counter, increments the in-flight gauge, and returns an opaque token.
2. `leaveSection("name", token, status)` validates the token, decrements in-flight, increments the left counter, records the duration, and (if `status === "error"`) increments the error counter.
3. Unknown or already-consumed tokens are silently ignored.
4. Mismatched section names (token was minted for a different section) are silently ignored.

**FIFO vs. ID-keyed correlation:**

By default, inter-stage latency is computed using FIFO ordering: turnstile pass N at checkpoint A is paired with turnstile pass N at checkpoint B. This is correct when items flow through the chain in order without being filtered or reordered.

When an `id` extractor is provided (via `TurnstileOptions`), the collector uses the item's identity to match passes across checkpoints. This handles reordering and filtering correctly at the cost of storing pending timestamps in a `Map`.

Both modes enforce `maxPendingCorrelation` to cap memory usage. When the limit is exceeded, the oldest unmatched entries are evicted.

**Turnstile usage example:**

```typescript
const collector = new DefaultChainMetricsCollector();

// Simulate items passing two checkpoints
for (let i = 0; i < 100; i++) {
    collector.onTurnstilePass('ingress');
    // ... processing happens ...
    collector.onTurnstilePass('egress');
}

const snap = collector.snapshot();
console.log(snap.turnstiles['ingress'].passed);  // 100
console.log(snap.turnstiles['egress'].passed);   // 100

// Inter-stage latency between ingress and egress
const latency = snap.stageLatencyMs['ingress->egress'];
console.log(latency.count);  // 100
console.log(latency.avg);    // average processing time in ms
```

**Section tracking example:**

```typescript
const collector = new DefaultChainMetricsCollector();

// Track items through a "transform" section
for (let i = 0; i < 10; i++) {
    const token = collector.enterSection('transform');

    try {
        await doTransform(items[i]);
        collector.leaveSection('transform', token, 'ok');
    } catch (err) {
        collector.leaveSection('transform', token, 'error');
    }
}

const snap = collector.snapshot();
const section = snap.sections['transform'];
console.log(section.entered);    // 10
console.log(section.left);       // 10
console.log(section.errored);    // number of failures
console.log(section.inFlight);   // 0 (all left)
console.log(section.durationMs); // rolling-window duration statistics
```

**ID-keyed correlation example:**

```typescript
const collector = new DefaultChainMetricsCollector();

type Item = { id: string; payload: unknown };
const idExtractor = (item: Item) => item.id;

// Items pass "start" in order A, B, C
collector.onTurnstilePass('start', idExtractor({ id: 'A', payload: null }), 1000);
collector.onTurnstilePass('start', idExtractor({ id: 'B', payload: null }), 1010);
collector.onTurnstilePass('start', idExtractor({ id: 'C', payload: null }), 1020);

// Items arrive at "end" reordered: B first, then A, then C
collector.onTurnstilePass('end', idExtractor({ id: 'B', payload: null }), 1030);  // B: 20ms
collector.onTurnstilePass('end', idExtractor({ id: 'A', payload: null }), 1100);  // A: 100ms
collector.onTurnstilePass('end', idExtractor({ id: 'C', payload: null }), 1050);  // C: 30ms

const snap = collector.snapshot(1200);
const latency = snap.stageLatencyMs['start->end'];
console.log(latency.count); // 3
console.log(latency.min);   // 20  (B)
console.log(latency.max);   // 100 (A)
console.log(latency.avg);   // 50  ((20 + 100 + 30) / 3)
```

---

## MetricsSink

Optional bridge interface for exporting metrics to external systems (OpenTelemetry, Prometheus, etc.). All methods are fire-and-forget -- errors in the sink should not affect the library's operation.

### MetricAttrs

Arbitrary key-value attributes attached to metric emissions.

```typescript
export type MetricAttrs = Record<string, string | number | boolean>;
```

---

### MetricsSnapshot

Combined snapshot from both capacity and chain collectors.

```typescript
export interface MetricsSnapshot {
    capturedAtMs: number;
    capacity?: CapacityMetricsSnapshot;
    chain?: ChainMetricsSnapshot;
}
```

---

### MetricsSink Interface

```typescript
export interface MetricsSink {
    /** Report a counter increment. */
    counter(name: string, delta: number, attrs?: MetricAttrs): void;
    /** Report a gauge value. */
    gauge(name: string, value: number, attrs?: MetricAttrs): void;
    /** Report a duration measurement. */
    duration(name: string, durationMs: number, attrs?: MetricAttrs): void;
    /** Receive a full snapshot (called periodically or on-demand). */
    snapshot?(snapshot: MetricsSnapshot): void;
    /** Flush any buffered data to the external system. */
    flush?(): void | Promise<void>;
}
```

| Method | Required | Description |
|--------|----------|-------------|
| `counter` | Yes | Report a monotonic counter increment with optional attributes |
| `gauge` | Yes | Report a gauge (up/down) value with optional attributes |
| `duration` | Yes | Report a duration measurement (for histograms) with optional attributes |
| `snapshot` | No | Receive a full combined snapshot from both collectors |
| `flush` | No | Flush buffered data to the external system; may be sync or async |

**OTel adapter example (sketch):**

```typescript
import { MetricsSink, MetricsSnapshot, MetricAttrs } from '@firebrandanalytics/shared-utils';
import { metrics } from '@opentelemetry/api';

class OTelMetricsSink implements MetricsSink {
    private readonly meter = metrics.getMeter('async-streams');

    counter(name: string, delta: number, attrs?: MetricAttrs): void {
        this.meter.createCounter(name).add(delta, attrs);
    }

    gauge(name: string, value: number, attrs?: MetricAttrs): void {
        this.meter.createObservableGauge(name)
            .addCallback(obs => obs.observe(value, attrs));
    }

    duration(name: string, durationMs: number, attrs?: MetricAttrs): void {
        this.meter.createHistogram(name).record(durationMs, attrs);
    }
}
```

---

## Integration Points

### ResourceCapacitySource Constructor

The `ResourceCapacitySource` constructor accepts an optional `ICapacityMetricsCollector` as its third parameter. When provided, the capacity source emits events to the collector on every `tryAcquire()`, `release()`, `reset()`, `increment()`, and `setLimits()` call. An initial `onSetLimits` event is also emitted during construction.

```typescript
constructor(
    limits: ResourceCost,
    parent?: ResourceCapacitySource,
    metrics?: ICapacityMetricsCollector,
)
```

```typescript
const metrics = new DefaultCapacityMetricsCollector();
const capacity = new ResourceCapacitySource(
    { gpu: 8, memory_gb: 32 },
    undefined,  // no parent
    metrics,    // collector
);

// All tryAcquire/release/reset/increment/setLimits calls now emit events
const result = capacity.tryAcquire({ gpu: 2 });
capacity.release({ gpu: 2 });

// Read aggregated metrics at any time
const snap = metrics.snapshot();
```

**With hierarchical capacity and ScheduledTaskPoolRunner:**

```typescript
const capacityMetrics = new DefaultCapacityMetricsCollector();
const capacity = new ResourceCapacitySource({ slots: 4 }, undefined, capacityMetrics);

const tasks: ScheduledTask<string, string>[] = [
    {
        key: 'task-1',
        runner: async () => 'result-1',
        cost: { slots: 1 },
    },
    {
        key: 'task-2',
        runner: async () => 'result-2',
        cost: { slots: 2 },
    },
];

const source = new TaskSource(tasks);
const runner = new ScheduledTaskPoolRunner('pool', source, capacity);

for await (const envelope of runner.runTasks()) {
    // Process envelopes...
}

// After all tasks complete, inspect capacity metrics
const snap = capacityMetrics.snapshot();
console.log(snap.totals.acquireAccepted); // 2
console.log(snap.totals.release);         // 2
console.log(snap.inFlightByResource['slots']); // 0
```

---

### PullChain.turnstile()

Inserts a metrics observation point into a pull chain. Each item that passes through is counted by the collector at the named checkpoint, without modification to the item.

```typescript
turnstile(
    checkpoint: string,
    collector: IChainMetricsCollector,
    options?: TurnstileOptions<T>,
): PullChain<T>
```

| Parameter | Description |
|-----------|-------------|
| `checkpoint` | A name for this observation point (e.g., `"ingress"`, `"decoded"`) |
| `collector` | The chain metrics collector to report to |
| `options` | Optional ID extractor for cross-stage correlation. Omit to use FIFO ordering (correct for sequential pull chains). |

The turnstile is implemented as a `PullCallbackObj` that calls `collector.onTurnstilePass()` for each item. Errors in the observation callback are silently caught so that metrics collection never breaks the data pipeline.

```typescript
const collector = new DefaultChainMetricsCollector();
const source = new SourceBufferObj([1, 2, 3, 4, 5], true);

const results = await PullChain.from(source)
    .turnstile('raw', collector)
    .map(x => x * 2)
    .filter(x => x > 4)
    .turnstile('filtered', collector)
    .collect();

const snap = collector.snapshot();
console.log(snap.turnstiles['raw'].passed);      // 5
console.log(snap.turnstiles['filtered'].passed);  // 3 (6, 8, 10)

// Note: inter-stage latency uses FIFO by default.
// Because filter drops items, FIFO pairing is incorrect here.
// For accurate latency with filters, provide an id extractor.
```

**With ID extractor (recommended when filters are present):**

```typescript
type Item = { id: number; value: number };
const collector = new DefaultChainMetricsCollector();

const items: Item[] = [
    { id: 1, value: 10 },
    { id: 2, value: 20 },
    { id: 3, value: 30 },
];
const source = new SourceBufferObj(items, true);

const results = await PullChain.from(source)
    .turnstile('in', collector, { id: (item) => item.id })
    .filter(item => item.value > 15)
    .turnstile('out', collector, { id: (item) => item.id })
    .collect();

const snap = collector.snapshot();
console.log(snap.turnstiles['in'].passed);   // 3
console.log(snap.turnstiles['out'].passed);  // 2 (items 2 and 3)

// Latency is correctly computed only for items that passed both turnstiles
const latency = snap.stageLatencyMs['in->out'];
console.log(latency.count); // 2
```

---

### PushChainBuilder.turnstile()

Inserts a metrics observation point into a push chain. Each item that passes through is counted by the collector at the named checkpoint, without modification to the item.

```typescript
turnstile(
    checkpoint: string,
    collector: IChainMetricsCollector,
    options?: TurnstileOptions<OUT>,
): PushChainBuilder<IN, OUT>
```

| Parameter | Description |
|-----------|-------------|
| `checkpoint` | A name for this observation point (e.g., `"ingress"`, `"egress"`) |
| `collector` | The chain metrics collector to report to |
| `options` | Optional ID extractor for cross-stage correlation. Omit to use FIFO ordering (correct for synchronous push chains). Provide an `id` extractor for chains with variable-latency async operators. |

The turnstile is implemented as a `PushPreCallbacksObj` that calls `collector.onTurnstilePass()` for each item before forwarding it to the next stage. Errors in the observation callback are silently caught.

```typescript
const collector = new DefaultChainMetricsCollector();

const { chain, buffer } = PushChainBuilder.start<number>()
    .turnstile('ingress', collector)
    .map(x => x * 10)
    .turnstile('egress', collector)
    .toArray();

for (let i = 1; i <= 15; i++) {
    await chain.next(i);
}
await chain.return();

const snap = collector.snapshot();
console.log(snap.turnstiles['ingress'].passed); // 15
console.log(snap.turnstiles['egress'].passed);  // 15

const latency = snap.stageLatencyMs['ingress->egress'];
console.log(latency.count); // 15
```

---

## Combined Capacity and Chain Metrics

A common pattern is to use both collectors together: capacity metrics on the resource pool that gates task execution, and chain metrics inside each task's pipeline.

```typescript
const capacityMetrics = new DefaultCapacityMetricsCollector();
const chainMetrics = new DefaultChainMetricsCollector();

const capacity = new ResourceCapacitySource({ slots: 2 }, undefined, capacityMetrics);

// Run tasks gated by capacity, each with an internal pipeline
for (let i = 0; i < 5; i++) {
    const result = capacity.tryAcquire({ slots: 1 });
    if (!result.ok) {
        // Wait for capacity...
        continue;
    }

    // Each task runs a pull chain with turnstiles
    const data = [i * 10, i * 10 + 1, i * 10 + 2];
    const source = new SourceBufferObj(data, true);

    const results = await PullChain.from(source)
        .turnstile('task-in', chainMetrics)
        .map(x => x + 1)
        .turnstile('task-out', chainMetrics)
        .collect();

    capacity.release({ slots: 1 });
}

// Capacity metrics: 5 acquisitions, 5 releases, zero in-flight
const capSnap = capacityMetrics.snapshot();
console.log(capSnap.totals.acquireAccepted); // 5
console.log(capSnap.totals.release);         // 5
console.log(capSnap.inFlightByResource['slots']); // 0

// Chain metrics: 5 tasks * 3 items = 15 items through each turnstile
const chainSnap = chainMetrics.snapshot();
console.log(chainSnap.turnstiles['task-in'].passed);  // 15
console.log(chainSnap.turnstiles['task-out'].passed); // 15
console.log(chainSnap.stageLatencyMs['task-in->task-out'].count); // 15
```

---

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, pull vs push models, the Obj pattern
- [Scheduling Reference](./scheduling.md) -- ResourceCapacitySource, task pool runners, dependency graphs
- [Pull Chain API Reference](./pull-chain.md) -- Fluent pipeline builder with turnstile support
- [Push Chain API Reference](./push-chain.md) -- Push-based pipeline builder with turnstile support
