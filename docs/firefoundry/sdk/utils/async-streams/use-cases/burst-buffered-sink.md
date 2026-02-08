# Burst-Buffered Sink

Push-based flow control for high-rate producers writing to slow downstream sinks, with serialization, sampling, and batching.

---

## The Problem

You have a high-rate event producer -- user activity events, telemetry data, log entries -- that pushes data as fast as it generates it. Downstream, a slow sink (database batch writer, HTTP endpoint, file system) cannot keep up with the peak rate.

Without flow control, three failure modes emerge:

1. **Out of memory.** Unbounded in-process buffers grow until the process crashes. Every event that arrives faster than the sink can drain adds to the backlog.

2. **Dropped events.** A bounded buffer that drops on overflow loses data silently. You may not discover the loss until an audit reveals gaps.

3. **Corrupted state.** Push objects can receive concurrent `next()` calls. If the sink or intermediate stages have shared mutable state (like `PushWindowObj`'s internal buffer), concurrent access corrupts it. A window of 10 might yield arrays of 8 or 12 items, or worse, throw.

What you want is a pipeline where:

- Concurrent pushes are serialized so stages with shared state are safe.
- A sampling or drop strategy sheds load when the producer outpaces the sink.
- Events are batched for efficient bulk writes.
- The producer does not block indefinitely.

## The Strategy

**Bounded buffer + serialization + optional sampling.**

In the push model, the producer drives. We need explicit mechanisms to manage the rate:

| Stage | Purpose |
|-------|---------|
| `serial()` | Serializes concurrent `next()` calls through a generator, ensuring one-at-a-time processing |
| `filter(sampling)` | Probabilistic sampling drops ~20% of events to reduce sustained load |
| `window(10)` | Accumulates 10 items into an array before forwarding to the sink |

The `serial()` stage is the critical safety mechanism. `PushSerialObj` wraps an internal async generator. Since generators inherently serialize -- a `yield` suspends the generator until the next `next()` call -- all downstream stages see strictly sequential input regardless of how many concurrent `next()` calls the producer fires.

## Architecture

```
+----------+    +----------+    +--------+    +-----------+    +----------------+
| Producer |--->| serial() |--->| filter |--->| window(10)|--->| SlowBatchSink  |
| (burst)  |    | (queue)  |    | (~80%) |    | (batching)|    | (120ms/batch)  |
+----------+    +----------+    +--------+    +-----------+    +----------------+
     |                                                               |
     +--- concurrent next() calls ----->  serialized  ------>  batched writes
```

**Data flow:** The producer calls `chain.next(value)` for each event, potentially many times concurrently. `serial()` queues these and processes them one at a time. Each value passes through `filter` (which drops ~20%), then into `window` (which accumulates). When the window fills, the batch array is pushed to `SlowBatchSink`.

**Backpressure:** There is no pull-side backpressure in the push model -- the producer pushes regardless. The serializer acts as an implicit queue: concurrent `next()` calls await their turn. If the producer sends all events at once and awaits `Promise.all(writes)`, the total time is bounded by `(accepted_events / window_size) * sink_latency`.

## Implementation

### The slow sink

```typescript
import { PushChainBuilder, PushObj } from '@firebrandanalytics/shared-utils';

class SlowBatchSink extends PushObj<number[]> {
    public batchCount = 0;
    public itemCount = 0;

    protected override async next_impl(
        batch: number[]
    ): Promise<IteratorResult<void>> {
        await sleep(120);  // simulate slow I/O
        this.batchCount++;
        this.itemCount += batch.length;
        console.log(
            `[sink]  batch=${this.batchCount}  size=${batch.length}  ` +
            `first=${batch[0]}  last=${batch[batch.length - 1]}`
        );
        return { done: false, value: undefined };
    }
}
```

- `PushObj<number[]>` is the base class for push sinks. It receives values via `next()` and implements `next_impl()`.
- Returning `{ done: false }` indicates the sink is still accepting data. Returning `{ done: true }` would signal the upstream to stop.
- The `public` counters let us verify how much data made it through.

### Pipeline construction

```typescript
const rng = makeRng(7);  // seeded PRNG for reproducibility
const sink = new SlowBatchSink();

const chain = PushChainBuilder.start<number>()
    .serial()                        // serialize concurrent pushes
    .filter(() => rng() > 0.2)      // ~80% pass rate
    .window(10)                      // batch into arrays of 10
    .into(sink);                     // terminal: connect to the sink
```

`PushChainBuilder` uses a two-phase pattern: the builder phase collects operation descriptors (factory functions) without constructing any objects. The terminal method (`.into()`) builds the chain **backwards** from the sink. This is necessary because each push object takes its downstream sink as a constructor argument.

### The priming call

```typescript
await chain.next(-1 as any);  // priming call -- value is discarded
```

**This is a real API requirement that must not be skipped.**

`PushSerialObj` uses an internal async generator for serialization:

```typescript
// Inside PushSerialObj (simplified):
protected async* serialize(): AsyncGenerator<void, void, T> {
    let result = { done: false };
    while (!result.done)
        result = await this.sink.next(yield);  // yield pauses here
    return;
}
```

Standard JavaScript generator semantics dictate that the first `next()` call advances the generator to the first `yield` point. The value passed to that first `next()` is **not captured** by `yield` -- it is discarded. This is how all JS generators work: the first `next()` is the "priming" call that starts execution up to the first `yield`.

Consequence: you must call `chain.next(someValue)` once before sending real data. The value passed in the priming call is lost. In this example we use `-1` as a sentinel, but any value works -- it will never reach the sink.

### Burst production

```typescript
const writes: Array<Promise<IteratorResult<void>>> = [];
for (let i = 1; i <= 80; i++) {
    writes.push(chain.next(i));  // non-blocking push
}
await Promise.all(writes);       // wait for all to drain
await chain.return();            // signal end-of-stream
```

All 80 calls to `chain.next()` fire without awaiting each other. The `serial()` stage queues them internally. Each value passes through the filter, then into the window accumulator. When the window reaches 10 items, it flushes to the sink (120 ms). The `Promise.all` resolves once every value has been processed through the full pipeline.

For the full runnable version, see [`examples/burst-buffered-sink.ts`](../examples/burst-buffered-sink.ts).

## What to Observe

When you run the example, output looks like this:

```
--- burst-buffered-sink ---
Producing 80 events. ~20% sampled out, batched in windows of 10.

[producer]  Firing all events...
  [sink]  batch=1  size=10  first=1   last=14
  [sink]  batch=2  size=10  first=15  last=27
  [sink]  batch=3  size=10  first=28  last=39
  [sink]  batch=4  size=10  first=40  last=52
  [sink]  batch=5  size=10  first=53  last=66
  [sink]  batch=6  size=10  first=67  last=80

[summary]  produced=80  delivered=60  batches=6  elapsed=740ms
[summary]  drop rate=25.0%
```

**What each metric tells you:**

| Metric | Meaning |
|--------|---------|
| `produced=80` | Total events the producer fired |
| `delivered=60` | Events that survived the ~20% filter. The seeded PRNG gives a consistent result. |
| `batches=6` | 60 items / 10 per window = 6 full batches |
| `elapsed=740ms` | 6 batches x 120 ms sink latency = ~720 ms + overhead |
| `drop rate=25.0%` | Actual drop rate from this PRNG seed. Varies with seed; averages ~20% over large runs. |
| Gaps in `first`/`last` | The filter dropped events between `first` and `last`, so the numbers are not contiguous |

**Key insight:** The total elapsed time is determined by `batches * sink_latency`, not `events * anything`. Batching amortizes the per-event cost. Without windowing, 60 events x 120 ms = 7.2 seconds. With windowing, 6 batches x 120 ms = 0.72 seconds -- a 10x improvement.

## Variations

### 1. Priority-based dropping instead of random sampling

Replace the probabilistic filter with a priority-aware one:

```typescript
type Event = { priority: number; payload: string };

const chain = PushChainBuilder.start<Event>()
    .serial()
    .filter(e => e.priority >= 3)  // drop low-priority events
    .window(10)
    .into(sink);
```

### 2. Dynamic filter threshold

Because `PushFilterObj.filter` is a public mutable property, you can change the drop rate at runtime:

```typescript
const filterLink = chain.links[2] as PushFilterObj<number>;
// Under heavy load, increase drop rate:
filterLink.filter = () => rng() > 0.5;  // 50% drop
// Under light load, pass everything:
filterLink.filter = () => true;
```

### 3. Fork to multiple sinks

Replace `.into(sink)` with `.fork()` to broadcast batches to multiple destinations:

```typescript
const chain = PushChainBuilder.start<number>()
    .serial()
    .window(10)
    .fork(
        branch => branch.into(databaseSink),
        branch => branch.into(metricsSink),
    );
```

### 4. Round-robin load distribution

Distribute events across multiple sink instances for parallel writes:

```typescript
const chain = PushChainBuilder.start<number>()
    .serial()
    .window(10)
    .roundRobinTo(
        branch => branch.into(new SlowBatchSink()),
        branch => branch.into(new SlowBatchSink()),
        branch => branch.into(new SlowBatchSink()),
    );
```

### 5. Condition-based buffering

Replace fixed windows with condition-based buffering when batch sizes should vary:

```typescript
const chain = PushChainBuilder.start<number>()
    .serial()
    .buffer(buf => buf.length >= 10 || someTimeCondition())
    .into(sink);
```

## See Also

- [Push Obj Classes Reference](../reference/push-obj-classes.md) -- API details for `PushObj`, `PushSerialObj`, `PushFilterObj`, `PushWindowObj`, `SinkCollectObj`
- [PushChain Reference](../reference/push-chain.md) -- `PushChainBuilder` two-phase construction, `PushChain` runtime, branching terminals
- [Conceptual Guide](../concepts.md) -- Push model philosophy, concurrency semantics, comparison with pull
- [Push Pipeline Basics Tutorial](../tutorials/push-pipeline-basics.md) -- Step-by-step introduction to push pipelines
- [Utilities Reference](../reference/utilities.md) -- `WaitObject`, `PushPullBufferObj` for bridging push and pull
