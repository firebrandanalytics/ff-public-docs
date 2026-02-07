# Push-Pull Bridge

Bridging push-based event producers with pull-based analytics consumers using a bounded buffer and demand-driven downstream consumption.

---

## The Problem

You have two subsystems that operate on fundamentally different models:

1. **A push-based producer.** Market data ticks, WebSocket events, sensor telemetry -- data arrives when it arrives. The producer cannot wait for the consumer to be ready; it must fire and move on.

2. **A pull-based consumer.** An analytics engine, batch writer, or ML feature pipeline that processes data at its own pace, requesting the next chunk only when it is ready for it.

These two models are incompatible by default:

- If the producer pushes directly into the consumer, the consumer cannot control the pace. It processes at the producer's rate, or data is lost.
- If the consumer pulls directly from the producer, the producer must block until pulled -- destroying its ability to handle real-time events.
- If you put a plain array between them, the producer appends and the consumer reads, but **nothing coordinates them**: the consumer has no way to know when new data is available, and the producer has no way to know when the buffer was drained.

What you want is a **bridge** that:

- Accepts pushed values from the producer side.
- Serves pulled values to the consumer side.
- Coordinates the two with signaling, so the consumer waits efficiently when the buffer is empty.
- Lets the consumer use the full pull pipeline (windowing, mapping, filtering) on the output.

## The Strategy

**Bounded buffer bridge with demand-driven downstream consumption.**

`PushPullBufferObj<T>` is the bridge primitive. It exposes two faces:

| Face | Type | Role |
|------|------|------|
| `.sink` | `PushObj<T>` | Producer calls `.sink.next(value)` to push data in |
| `.source` | `PullObj<T>` | Consumer iterates with `for await...of` to pull data out |

Internally, it shares a single `Array<T>` buffer between a `SinkCollectObj` (push side appends via `.push()`) and a `SourceBufferObj` (pull side removes via `.shift()`). A `WaitObject` coordinates the two sides:

- When the push side writes a value, `PushPostSignalObj` resolves the `WaitObject`, signaling "data available."
- When the pull side finds the buffer empty, `PullAwaitReset` awaits the `WaitObject`, sleeping until the next signal.

This means the consumer never busy-waits and the producer never blocks (beyond the synchronous cost of appending to an array).

## Architecture

```
                  PUSH SIDE                         PULL SIDE
                  =========                         =========

+----------+    +------------------+    +-------------------+    +----------+
| Producer |--->| bridge.sink      |--->|    bridge.source   |--->| PullChain|
| (interval|    | PushPostSignalObj|    | PullAwaitReset +   |    | .window(5)|
|  ticks)  |    | + SinkCollectObj |    | SourceBufferObj    |    |          |
+----------+    +--------+---------+    +---------+---------+    +----+-----+
                         |                        |                    |
                         |    +----------+        |                    |
                         +--->| Array<T> |<-------+                    |
                              | (buffer) |                             |
                              +----+-----+                             v
                                   |                            +----------+
                                   +--- WaitObject ------------>| Consumer |
                                        "data available"        | (slow    |
                                                                |  analytics)
                                                                +----------+
```

**Data flow:**

1. Producer calls `bridge.sink.next(tick)`. `SinkCollectObj` appends to the shared array. `PushPostSignalObj` resolves the `WaitObject`.
2. Consumer's `for await` calls `pullPipeline.next()`. This reaches `PullAwaitReset` inside `bridge.source`. If the buffer has items, `SourceBufferObj` shifts and yields them. If the buffer is empty, `PullAwaitReset` awaits the `WaitObject` until the push side signals.
3. The `PullChain.window(5)` stage accumulates 5 ticks into an array and yields the batch to the consumer.

**Backpressure:** The pull side naturally throttles consumption -- it only pulls when ready. The push side is unbounded by default; if the producer is much faster than the consumer, the shared array grows. Monitor `bridge.buffer.length` (or the underlying array) to detect rate mismatch.

## Implementation

### Bridge setup

```typescript
import {
    PushPullBufferObj,
    PullChain,
} from '@firebrandanalytics/shared-utils';

type Tick = { seq: number; price: number };

const bridge = new PushPullBufferObj<Tick>();
```

`PushPullBufferObj<T>` takes an optional `Array<T>` constructor argument. If omitted (as here), it creates a fresh empty array internally. The constructor wires up:

1. A `SinkCollectObj` backed by the array (push side).
2. A `SourceBufferObj` backed by the same array (pull side).
3. A `PushPostSignalObj` wrapper on the sink that resolves a `WaitObject` after each push.
4. A `PullAwaitReset` wrapper on the source that awaits the `WaitObject` when the buffer is empty.

### Producer (push side)

```typescript
const producer = (async () => {
    let price = 100.0;
    for (let seq = 1; seq <= 30; seq++) {
        price += (Math.random() - 0.5) * 0.8;
        const tick: Tick = { seq, price: Number(price.toFixed(2)) };

        await bridge.sink.next(tick);                  // push into bridge

        await sleep(30 + Math.floor(Math.random() * 50));  // ~30-80 ms
    }
    await bridge.sink.return();  // signal end-of-stream
})();
```

- Each `bridge.sink.next(tick)` appends to the shared buffer and signals the pull side.
- `bridge.sink.return()` signals the push side is done. The pull side will drain remaining items and then terminate its `for await` loop.
- The producer runs concurrently (as an immediately-invoked async function) while the consumer runs in parallel below.

### Consumer (pull side)

```typescript
const pullPipeline = PullChain.from(bridge.source).window(5);

for await (const bucket of pullPipeline) {
    const avg = bucket.reduce((a, t) => a + t.price, 0) / bucket.length;
    console.log(
        `consumed=${consumed}  avgPrice=${avg.toFixed(2)}`
    );
    await sleep(120);  // simulate slow analytics
}
```

- `bridge.source` is a `PullObj<Tick>` that the consumer can wrap in any pull chain.
- `.window(5)` batches ticks into arrays of 5 for analytics processing.
- The `for await` loop is the demand signal. Each iteration pulls through the window, which pulls from the bridge source, which waits on the `WaitObject` if the buffer is empty.
- The 120 ms `sleep` simulates slow processing. During this time, the producer continues pushing ticks into the buffer.

### End-of-stream

```typescript
await bridge.sink.return();  // producer signals done
// ... consumer's for-await drains remaining items and exits
await producer;              // ensure producer coroutine has finished
```

When the producer calls `return()`, the `SinkCollectObj` marks itself as done. The `PushPostSignalObj` signals the `WaitObject` with `false` (indicating closure). On the pull side, `PullAwaitReset` receives the `false` signal and breaks out of its wait loop after the buffer is drained, causing the `SourceBufferObj` to complete, which terminates the `for await` loop.

For the full runnable version, see [`examples/push-pull-bridge.ts`](../examples/push-pull-bridge.ts).

## What to Observe

When you run the example, output looks like this:

```
--- push-pull-bridge ---
Producing 30 ticks (push), consuming in windows of 5 (pull).

[  350ms]  window=1  consumed=5/30   seqs=[1,2,3,4,5]   avg=99.87  range=[99.52, 100.23]
[  600ms]  window=2  consumed=10/30  seqs=[6,7,8,9,10]  avg=99.95  range=[99.61, 100.32]
[  860ms]  window=3  consumed=15/30  seqs=[11,12,13,14,15]  avg=100.12  ...
[ 1110ms]  window=4  consumed=20/30  seqs=[16,17,18,19,20]  avg=100.05  ...
[ 1360ms]  window=5  consumed=25/30  seqs=[21,22,23,24,25]  avg=99.98  ...
[ 1610ms]  window=6  consumed=30/30  seqs=[26,27,28,29,30]  avg=100.15  ...

[1610ms]  Done. consumed=30  windows=6
```

**What each metric tells you:**

| Metric | Meaning |
|--------|---------|
| Time between windows | ~250 ms: the producer fills 5 ticks in ~200 ms (5 x ~40 ms avg) while the consumer is still processing the previous window (120 ms). Eager prefetch effect. |
| `consumed=N/30` | Running total. Increases by 5 each window because `window(5)` always yields full batches until the stream ends. |
| `seqs` contiguous | No gaps -- the bridge preserves FIFO ordering. Every tick the producer sends is consumed in order. |
| `avg`, `range` | Window-level analytics computed on the pull side. Demonstrates that the consumer can do arbitrary processing per batch. |

**Rate mismatch indicator:** If you slow the producer (e.g., 200 ms per tick) and speed up the consumer (e.g., 10 ms per window), the consumer will frequently wait on the `WaitObject` -- you will see longer gaps between windows. If you speed the producer and slow the consumer, the shared buffer grows. Add a log line to print `bridge.peek()` or the buffer's length to observe backlog.

## Variations

### 1. Add a side-tap for monitoring

Use `PullPushBridgeObj` on the pull side to forward each pulled item to a monitoring sink without affecting the main pipeline:

```typescript
function* monitorSink(): Generator<Tick, void> {
    while (true) {
        const tick = yield;
        if (tick) console.log(`[monitor] seq=${tick.seq}`);
    }
}

const monitor = monitorSink();
monitor.next();  // prime the generator

const tappedPipeline = PullChain
    .from(bridge.source)
    .pipe(src => new PullPushBridgeObj(src, monitor))
    .window(5);
```

`PullPushBridgeObj` passes each pulled item to the synchronous generator sinks before yielding it downstream. The monitor sees every tick as it flows through.

### 2. Multiple consumers with a fork

If you need the same ticks to feed multiple consumers (e.g., analytics + archival), push into a `PushForkObj` before the bridge, or create multiple bridges:

```typescript
const analyticsBridge = new PushPullBufferObj<Tick>();
const archiveBridge = new PushPullBufferObj<Tick>();

// Producer pushes to both
for (const tick of ticks) {
    await analyticsBridge.sink.next(tick);
    await archiveBridge.sink.next(tick);
}
```

### 3. Bounded buffer with overflow handling

The default bridge has an unbounded buffer. To cap it, monitor buffer length and drop or block:

```typescript
const MAX_BUFFER = 100;
// Before pushing:
if (bridge['buffer'].length < MAX_BUFFER) {
    await bridge.sink.next(tick);
} else {
    console.warn('Buffer full, dropping tick', tick.seq);
}
```

### 4. Pull-side filtering and transformation

The pull side is a standard `PullObj`, so the full fluent API is available:

```typescript
const pipeline = PullChain.from(bridge.source)
    .filter(t => t.price > 100)              // only ticks above 100
    .map(t => ({ ...t, spread: t.price - 100 }))  // add computed field
    .window(5);
```

### 5. Using PullPushBridgeObj for distribute

For routing pulled items to different sinks by a selector:

```typescript
const sinkMap = new Map<string, Generator<unknown, void, Tick>>();
sinkMap.set('high', highPrioritySink);
sinkMap.set('low', lowPrioritySink);

const distributed = new PullPushDistributeObj(
    bridge.source,
    sinkMap,
    (tick) => tick.price > 100 ? 'high' : 'low'
);
```

## See Also

- [Utilities Reference](../reference/utilities.md) -- API details for `WaitObject`, `PushPullObj`, `PushPullBufferObj`, `PushPullBufferCacheObj`
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- `PullAwaitReset`, `PullPushBridgeObj`, `PullPushDistributeObj`
- [Push Obj Classes Reference](../reference/push-obj-classes.md) -- `PushPostSignalObj`, `SinkCollectObj`, `PushForkObj`
- [PullChain Reference](../reference/pull-chain.md) -- Fluent API for the consumer side of the bridge
- [Conceptual Guide](../concepts.md) -- Bridging Push and Pull (Section 10), the Obj pattern
