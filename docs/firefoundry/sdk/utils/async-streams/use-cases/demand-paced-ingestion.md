# Demand-Paced Ingestion

Pull-based backpressure for variable-rate data sources, with eager prefetch and batched consumption.

---

## The Problem

You have a sensor (or API endpoint, message queue, etc.) that produces data at unpredictable rates. Sometimes it bursts dozens of readings per second; other times it goes quiet for hundreds of milliseconds. Downstream, a consumer processes readings in batches -- perhaps writing to a database, computing rolling averages, or feeding an ML model.

Without flow control, two failure modes emerge:

1. **Overflow.** The producer outruns the consumer. A naive approach buffers everything in memory, but buffer growth is unbounded. Under sustained load the process runs out of memory and crashes.

2. **Starvation.** The consumer polls on a fixed interval. When the source is quiet, every poll returns nothing -- wasting CPU cycles, network round-trips, and event-loop time.

What you want is a pipeline where:

- The consumer controls the pace (no work happens until the consumer is ready).
- A small prefetch buffer absorbs short bursts without blocking.
- A timeout prevents the consumer from hanging when the source stalls.
- Individual readings are grouped into batches for efficient processing.

## The Strategy

**Signal-based demand pull with bounded prefetch.**

In the pull model, the consumer drives everything. Each `next()` call propagates backward through the pipeline to the source. No data moves until the consumer asks for it -- this is inherent backpressure. On top of that base, we add:

| Stage | Purpose |
|-------|---------|
| `eager(2)` | Pre-fetches up to 2 items ahead of the consumer, overlapping source I/O with consumer processing |
| `timeout(300, false)` | If a single pull takes longer than 300 ms, skip it and try again instead of blocking forever |
| `window(5)` | Accumulate 5 items into an array before forwarding the batch |

The combination gives you a pipeline that adapts to variable rates automatically: the source only produces when pulled, eager smooths out small gaps, timeout prevents stalls, and window amortizes per-item overhead.

## Architecture

```
                    demand signal (next() calls)
               <-------------------------------------
               |                                     |
+--------------+--+    +----------+    +-----------+ | +-----------+    +----------+
|  SensorSource   |--->| eager(2) |--->|timeout(300)|-+>| window(5) |--->| Consumer |
| (variable delay)|    | prefetch |    | skip guard |   |  batching |    | (slow)   |
+-----------------+    +----------+    +-----------+    +-----------+    +----------+
               |                                                              |
               +------- data flows forward (yield) ------------------------->+
```

**Data flow:** The consumer's `for await...of` calls `pipeline.next()`. That call reaches `window`, which calls `timeout.next()` up to 5 times, each of which calls `eager.next()`, which may return a prefetched value or pull from `SensorSource`. Once 5 values accumulate, `window` yields the batch to the consumer.

**Backpressure:** The source's `pull_impl()` generator only runs when `eager` calls its `next()`. With a prefetch of 2, at most 2 readings are in flight at any time -- bounded memory, bounded concurrency.

## Implementation

The full implementation is compact. Here are the key sections with line-by-line explanation.

### Sensor source

```typescript
import { PullChain, SourceObj } from '@firebrandanalytics/shared-utils';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const jitter = (baseMs: number, spreadMs: number) =>
    baseMs + Math.floor(Math.random() * spreadMs);

class SensorSource extends SourceObj<number> {
    constructor(
        private readonly count: number,
        private readonly baseDelayMs: number,
    ) {
        super();
    }

    protected override async *pull_impl():
        AsyncGenerator<number, number | undefined, void>
    {
        for (let i = 1; i <= this.count; i++) {
            await sleep(jitter(this.baseDelayMs, 40));   // variable delay
            yield i;                                      // one reading per pull
        }
        return undefined;  // signals end-of-stream
    }
}
```

- `SourceObj<number>` is the base class for pull sources that generate values without upstream input.
- `pull_impl()` is the generator that the base class calls when `next()` is invoked. Each `yield` produces one reading.
- The `return undefined` at the end signals completion. The base class sets `done = true` and stops the pipeline.
- The variable `sleep` simulates a sensor with unpredictable timing.

### Pipeline construction

```typescript
const pipeline = PullChain
    .from(new SensorSource(20, 30))   // 20 readings, ~30-70 ms apart
    .eager(2)                          // pre-fetch 2 readings
    .timeout(300, false)               // 300 ms timeout, non-throwing
    .window(5);                        // batch into arrays of 5
```

Each fluent method returns a **new** `PullChain` and marks the previous one as consumed. This prevents the shared-iterator bug where two references compete for the same data stream.

- `.eager(2)` wraps the source in `PullEagerObj`. When the consumer pulls the current value, eager has already started fetching the next 2 values from the source. This overlaps source I/O with consumer processing.
- `.timeout(300, false)` wraps in `PullTimeoutObj` with `throw_on_timeout = false`. If a pull from the eager stage takes over 300 ms, the timeout fires and the pipeline retries. The stalled `next()` call on the source continues running in the background -- callers must ensure sources handle concurrent `next()` calls safely.
- `.window(5)` wraps in `PullWindowObj`. It accumulates 5 values into an array and yields the array. If the source ends before filling the window, the partial remainder becomes the generator's **return value** (not a yielded value).

### Consumer loop

```typescript
let batchNo = 0;
for await (const batch of pipeline) {
    batchNo++;
    await sleep(120);  // simulate slow batch processing

    const elapsed = Date.now() - started;
    console.log(
        `[${elapsed}ms]  batch=${batchNo}  ` +
        `size=${batch.length}  values=[${batch.join(', ')}]`
    );
}
```

The `for await...of` loop is the demand signal. Each iteration calls `pipeline.next()`, which cascades backward through the chain. The consumer processes at its own pace -- 120 ms per batch -- and the source never outpaces it.

**Partial window behavior:** When the source ends mid-window (e.g., 20 items / 5 per window = 4 full windows, 0 partial), `PullWindowObj` returns the partial array as the generator's return value. `for await...of` does **not** see return values -- only yielded values. If you need the partial tail, call `pipeline.next()` manually and check `result.done === true` with `result.value`.

For the full runnable version, see [`examples/demand-paced-ingestion.ts`](../examples/demand-paced-ingestion.ts).

## What to Observe

When you run the example, output looks like this:

```
--- demand-paced-ingestion ---
Producing 20 sensor readings, consuming in batches of 5.

[  310ms]  batch=1  size=5  values=[1, 2, 3, 4, 5]
[  540ms]  batch=2  size=5  values=[6, 7, 8, 9, 10]
[  790ms]  batch=3  size=5  values=[11, 12, 13, 14, 15]
[ 1020ms]  batch=4  size=5  values=[16, 17, 18, 19, 20]

[1020ms]  Done. Consumed 4 full batches.
```

**What each metric tells you:**

| Metric | Meaning |
|--------|---------|
| Elapsed time between batches | Dominated by whichever is slower: source production (5 readings x ~30-70 ms = ~150-350 ms) or consumer processing (120 ms). With eager prefetch, some source I/O overlaps with consumer processing. |
| `size=5` for all batches | Window is always full because 20 / 5 = 4 with no remainder. Try changing `totalReadings` to 23 to see partial-window behavior. |
| No timeout messages | With a 300 ms timeout and ~30-70 ms source delay, timeouts are rare. Lower the timeout to 40 ms to force them. |

**Tuning knobs:**

- Increase `eager` buffer size to absorb longer bursts (costs memory).
- Decrease `timeout` to fail fast on slow sources.
- Increase `window` size to reduce per-batch overhead at the cost of latency.

## Variations

### 1. Dynamic window size

Because `PullWindowObj.window_size` is a public mutable property, you can change the batch size mid-stream:

```typescript
const windowLink = pipeline.linkAt(3) as PullWindowObj<number>;
// After first batch, switch to larger windows
windowLink.window_size = 10;
```

### 2. Replace timeout with a cutoff source

For more complex timeout logic (e.g., a heartbeat monitor), replace `timeout()` with a `PullRaceCutoffObj` that races the data source against a timer source:

```typescript
const timer = new PullTimerObj(500);  // fires every 500 ms
const guarded = new PullRaceCutoffObj([dataSource], timer, false);
```

### 3. Multiple sensors with round-robin merging

If you have several sensors, merge them before batching:

```typescript
const merged = PullChain.roundRobin(sensor1, sensor2, sensor3)
    .eager(4)
    .window(10);
```

### 4. Condition-based buffering

Replace fixed windows with condition-based buffering when batch size should depend on the data:

```typescript
const pipeline = PullChain
    .from(source)
    .buffer(buf => buf.length >= 5 || buf.some(v => v > threshold));
```

## See Also

- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- API details for `SourceObj`, `PullEagerObj`, `PullTimeoutObj`, `PullWindowObj`
- [PullChain Reference](../reference/pull-chain.md) -- Fluent pipeline API, terminal methods, dynamic mutation
- [Conceptual Guide](../concepts.md) -- Pull model philosophy and the Obj pattern
- [Pull Pipeline Basics Tutorial](../tutorials/pull-pipeline-basics.md) -- Step-by-step introduction to pull pipelines
- [Combining Streams Tutorial](../tutorials/combining-streams.md) -- Merging multiple sources with race, round-robin, concat, zip
