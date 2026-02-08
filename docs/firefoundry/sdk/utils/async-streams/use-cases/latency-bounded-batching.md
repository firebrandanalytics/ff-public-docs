# Latency-Bounded Batching

Batch items by count OR time, whichever comes first -- bounding both throughput overhead and tail latency.

---

## The Problem

You have a stream of events (API requests, sensor readings, log entries) that arrive at variable rates. You want to batch them for efficient downstream processing -- writing to a database, sending over the network, or feeding an ML pipeline. A fixed-size window (`window(10)`) handles this well when the source is fast: you get full batches with low per-item overhead.

But what happens when traffic slows down?

The last few items sit in the batch buffer, waiting for item #10 that may not arrive for seconds or minutes. This creates an invisible latency problem: the items are *in the system* but not *being processed*. For a real-time dashboard, this means stale data. For a user-facing API, this means requests waiting in limbo.

Two failure modes emerge from naive batching:

1. **Tail-latency spikes.** Under light load, a fixed-size window holds items hostage until the batch fills. If your window is 100 and you receive 99 items in a burst followed by a lull, those 99 items sit idle -- possibly for minutes.

2. **Inefficient small batches.** The opposite extreme -- flush after every timeout regardless of fill level -- destroys the throughput benefit of batching. If your timeout is 50ms and items arrive every 10ms, you're flushing constantly instead of batching.

What you want is the Kafka pattern: **batch.size + linger.ms** -- flush when the batch is full *or* when a time limit expires, whichever comes first.

## The Strategy

**Dual-trigger batching: count threshold with time ceiling.**

The `windowTimeout(size, timeoutMs)` primitive provides exactly this. On each iteration:

1. Start accumulating items into a batch buffer.
2. If the buffer reaches `size` items, yield the full batch immediately.
3. If `timeoutMs` elapses before the buffer fills, yield the partial batch.
4. If the source exhausts mid-batch, yield whatever is buffered (no data loss).

| Parameter | Controls | Trade-off |
|-----------|----------|-----------|
| `size` | Maximum batch size | Higher = better throughput, more per-item latency under light load |
| `timeoutMs` | Maximum wait time | Lower = tighter latency bound, more frequent small batches |

The key insight is that both parameters are **mutable at runtime**. You can dynamically tune them based on observed conditions -- for example, increasing the timeout under sustained high throughput (when batches fill before the timer fires anyway) or decreasing batch size during traffic spikes that need lower latency.

## Architecture

### Pull model

```
             demand signal (next() calls)
        <-------------------------------------------
        |                                           |
+-------+--------+    +---------------------------+ | +----------+
|  EventSource    |--->| windowTimeout(100, 200ms) |-+>| Consumer |
| (variable rate) |    |  batch ≤100 OR ≤200ms     |   | (batch)  |
+-----------------+    +---------------------------+    +----------+
        |                                                     |
        +---- data flows forward (yield batches) ----------->+
```

```typescript
const pipeline = PullChain.from(eventSource)
    .windowTimeout(100, 200)
    .map(batch => processBatch(batch))
    .collect();
```

### Push model

```
+----------+    +---------------------------+    +----------+
|  Source   |--->| windowTimeout(100, 200ms) |--->|  Sink    |
| .next(x) |    |  flush on count or timer  |    | (batch)  |
+----------+    +---------------------------+    +----------+
```

```typescript
const chain = PushChainBuilder.start<Event>()
    .windowTimeout(100, 200)
    .into(batchSink);

// Push items as they arrive
await chain.next(event);
```

## Under the Hood

### Pull side: `PullWindowTimeoutObj`

The pull-side implementation uses `Promise.race` between the upstream source's `next()` and a timeout promise:

```
For each batch:
  1. Set deadline = now + timeout_ms
  2. Loop until batch.length === window_size:
     a. remaining = deadline - now
     b. If remaining ≤ 0 → break (timeout)
     c. Race: source.next() vs sleep(remaining)
     d. If timeout wins → save pending source promise for next batch, break
     e. If source wins and done → yield partial batch, return
     f. If source wins → push to batch
  3. Yield batch
```

**Dangling promise management.** When the timeout fires, the `source.next()` promise is still pending. Rather than discarding it (which would lose the eventual value) or calling `source.next()` again (which would create overlapping pulls), the pending promise is carried forward and reused as the first race candidate in the next batch. This ensures exactly one outstanding `source.next()` at any time.

### Push side: `PushWindowTimeoutObj`

The push-side implementation uses `setTimeout`:

```
On next(item):
  1. Push item to buffer
  2. If buffer.length >= window_size:
     - Clear timer
     - Flush buffer to sink
  3. Else:
     - Reset timer to timeout_ms
     - Timer callback: flush buffer to sink

On return():
  1. Clear timer
  2. If buffer non-empty → flush to sink
  3. Delegate to sink.return()
```

**Timer reset semantics.** Each item push resets the timer. This means the timeout measures "time since last item" rather than "time since batch started." Under sustained flow, the timer never fires -- items fill the batch before timeout. Under bursty flow, the timer fires during gaps, flushing whatever has accumulated.

## Tuning Guide

### Choosing window_size

| Workload | Recommended | Why |
|----------|-------------|-----|
| High-throughput DB writes | 100-1000 | Amortize connection overhead |
| Real-time dashboard updates | 10-50 | Balance freshness vs render cost |
| Network API batching | 20-100 | Stay under payload size limits |
| ML model micro-batching | 8-64 | Match GPU batch dimension |

### Choosing timeout_ms

| Requirement | Recommended | Why |
|-------------|-------------|-----|
| Sub-second dashboards | 100-500ms | Users perceive > 1s as stale |
| Database write batching | 1000-5000ms | DB connections are expensive |
| Network API calls | 200-1000ms | Balance latency vs overhead |
| Log aggregation | 5000-30000ms | Logs tolerate delay |

### Dynamic tuning

Both parameters are mutable at runtime:

```typescript
const wt = new PullWindowTimeoutObj(source, 100, 200);

// Under heavy load: bigger batches, same timeout
wt.window_size = 500;

// Under light load: smaller batches, tighter timeout
wt.window_size = 10;
wt.timeout_ms = 50;
```

## Example

### Pull pipeline: log aggregator

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

// Simulate log entries arriving at variable rates
const logs = new SourceBufferObj([
    'INFO: request started',
    'DEBUG: parsed body',
    'INFO: request completed',
    // ... more logs
]);

const batches = await PullChain.from(logs)
    .windowTimeout(50, 1000)  // batch up to 50 logs, flush at least every 1s
    .map(batch => ({
        count: batch.length,
        timestamp: Date.now(),
        entries: batch,
    }))
    .collect();
```

### Push pipeline: telemetry sink

```typescript
import { PushChainBuilder, SinkCallbacksObj } from '@firebrandanalytics/shared-utils';

const chain = PushChainBuilder.start<TelemetryEvent>()
    .windowTimeout(100, 500)  // batch up to 100 events, flush every 500ms
    .toCallbacks(batch => writeToBigQuery(batch));

// As telemetry arrives...
await chain.next({ metric: 'cpu', value: 0.72 });
await chain.next({ metric: 'mem', value: 0.45 });
// Timer fires after 500ms if batch doesn't fill
```

See the [runnable example](../examples/latency-bounded-batching.ts) for a complete, self-contained demonstration.
