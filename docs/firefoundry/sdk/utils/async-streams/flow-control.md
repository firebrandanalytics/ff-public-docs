# Flow Control in Async Stream Pipelines

Flow control is the discipline of matching production rates to consumption rates so that
a pipeline operates within bounded memory, bounded latency variance, and completes
predictably even under bursty or adversarial input patterns. This document develops the
theory from first principles and maps each strategy to concrete primitives in the
async streams library.

For background on the Obj pattern, pipeline construction, and lifecycle management,
see the [Conceptual Guide](./concepts.md).

---

## 1. Flow-Control Fundamentals

Every stream pipeline has at least one producer and one consumer. Flow control is the
**stability contract** between them: the guarantee that the system will not exhaust memory,
will not exhibit unbounded latency growth, and will complete in finite time for finite
inputs.

Four quantities define the contract:

- **Producer rate** (lambda) -- items generated per unit time. This includes both the raw
  generation rate and any amplification from retries, fan-out, or batch expansion.

- **Consumer rate** (mu) -- items fully processed per unit time. "Fully processed" means
  the item has reached a terminal sink or been acknowledged; in-flight items do not count.

- **Service time** -- the wall-clock duration to process a single item from ingress to
  egress. Service time is rarely constant; its variance drives buffering requirements.

- **Queue depth** -- the number of items waiting between producer and consumer at any
  instant. Queue depth is the **integrator** of the rate mismatch: when lambda exceeds mu,
  queue depth grows; when mu exceeds lambda, it drains. Over an interval `[0, t]`:

```
queue_depth(t) = queue_depth(0) + integral(lambda(s) - mu(s), s=0..t)
```

Queue depth is the single most important metric for flow-control health. Even a small
sustained mismatch (lambda = 1.01 * mu) accumulates linearly over time. A pipeline
processing 1,000 items/second with a 1% mismatch accumulates a backlog of 10 items/second
-- 36,000 items per hour. Small mismatches are silent at first and catastrophic later.

The goal of every flow-control strategy is to keep queue depth bounded and recoverable.

---

## 2. Rate Regimes and Their Consequences

A pipeline operates in one of three regimes at any given moment. Real systems move
between regimes dynamically as load patterns, resource availability, and processing
costs change.

### 2a. Balanced Regime (lambda ~= mu)

Queue depth oscillates around a stable mean. Utilization is high. This is the target
operating point.

```
Queue depth over time (balanced):

depth
  |          .  .
  |  .    .      .    .      .
  |    ..          ..    ..
  +-------------------------------------> time
  0
```

Balanced does not mean zero buffering. Variance in service time causes short-lived
queue oscillations even when average rates match. A well-tuned pipeline absorbs these
oscillations with a small buffer and recovers within a few processing cycles.

### 2b. Producer-Faster Regime (lambda > mu)

The backlog grows without bound. The failure cascade is predictable:

1. **Queue growth** -- items accumulate faster than they are consumed.
2. **Memory pressure** -- heap expansion and increased GC pressure in JavaScript.
3. **GC churn** -- garbage collection pauses inflate tail latency for all items.
4. **Latency inflation** -- items spend longer waiting before processing begins.
5. **Timeout/retry amplification** -- upstream callers time out and retry, *increasing*
   lambda. This is a positive feedback loop.
6. **Cascading failure** -- memory exhaustion, process crash, or total abandonment.

```
Queue depth over time (producer-faster):

depth
  |                                  /
  |                              /
  |                         /
  |                    /
  |              /
  |        /
  |  /
  +-------------------------------------> time
  0
```

The critical insight: by the time latency is visibly degraded, queue depth is already
large. Monitoring queue depth directly gives minutes or hours of warning before
latency-based alerts fire.

**The cost trap: under-provisioning does not save money.** A common organizational
instinct is to keep consumer resources lean to control compute spend. The irony is that
the producer-faster regime *increases* total cost:

- **Retry amplification inflates volume.** When requests time out, clients retry. Each
  retry is a new request that consumes ingress bandwidth, queue space, and partial
  processing before timing out again. A system designed for 1,000 req/s that can only
  sustain 800 req/s may see effective load climb to 1,500 req/s once retries compound --
  nearly double the original demand.
- **Wasted partial work.** Items that sit in a growing queue accumulate processing effort
  at each pipeline stage before ultimately being dropped or timing out. That CPU time is
  pure waste -- it produced no useful output.
- **Degraded throughput under congestion.** GC pauses, lock contention, and memory
  allocation overhead reduce mu further as load increases. The system processes *fewer*
  useful items per second at high load than at moderate load.
- **User-facing costs.** Slow or failed responses drive users to retry manually, contact
  support, or churn entirely. The revenue impact of degraded service typically dwarfs the
  compute savings from under-provisioning.

The counterintuitive lesson: **spending less on consumers often costs more in total.**
The right response to a producer-faster regime is not to accept the backlog, but to
either increase mu (add capacity), decrease lambda (throttle or shed load), or both.
Monitor cost-per-completed-item, not cost-per-provisioned-resource.

### 2c. Consumer-Faster Regime (lambda < mu)

The consumer is idle most of the time. Consequences are more subtle:

1. **Empty buffers** -- the consumer frequently finds nothing to process and must wait.
2. **Idle compute** -- allocated CPU and memory are underutilized.
3. **Burst sensitivity** -- arriving bursts have no queued work to amortize startup costs.
4. **Synchronized waits** -- multiple consumers polling an empty source may synchronize
   their retry intervals, causing thundering-herd effects on arrival.
5. **Tail-latency spikes** -- idle periods plus burst arrivals create bimodal latency:
   most items are fast (no queue), burst items are slow (contention).

```
Queue depth over time (consumer-faster):

depth
  |
  |  .
  |    .
  |      .
  |        . . . . . . . . . . . . . .
  +-------------------------------------> time
  0
```

**The cost reality: you are paying for capacity you are not using.** Unlike the
producer-faster regime (which has hidden costs that make it more expensive than it
appears), the consumer-faster regime has a visible and straightforward cost problem:
you are provisioning resources that sit idle.

- **Direct waste.** If your consumer can handle 10,000 items/second but only receives
  2,000, you are paying for 5x the compute you need. For cloud-hosted LLM inference,
  GPU instances, or reserved database capacity, this idle spend adds up quickly.
- **Opportunity cost.** Resources locked into an over-provisioned consumer pipeline
  cannot serve other workloads. In a shared cluster, this reduces the capacity available
  to other teams or services.
- **False sense of headroom.** Low utilization can mask architectural problems. A system
  that "never has queue depth issues" because it has 5x consumer capacity may hide the
  fact that its processing logic is inefficient or that its source is broken and
  producing less than expected.

That said, *some* over-provisioning is healthy. You want mu to comfortably exceed
peak lambda (not average lambda) so that bursts drain quickly without queue buildup.
The sweet spot is typically **mu = 1.2-1.5x peak lambda** -- enough headroom for
bursts, not so much that you are burning money on idle resources.

The fix is not to speed up the producer. Right-size the consumer's concurrency budget
or consolidate consumers to reduce idle overhead. Use the
[adaptive capacity pattern](./use-cases/adaptive-capacity.md) to scale consumer
resources dynamically based on observed load, keeping utilization in a healthy band
(60-80%) without risking the producer-faster failure cascade.

---

## 3. Backpressure Strategy Taxonomy

Five fundamental strategies keep queue depth bounded. Every real system uses a
combination. The subsections below develop each strategy, describe when it applies,
and map it to library primitives.

### 3a. Drop / Sample

**Principle:** Intentionally discard items to keep the consumption rate achievable.

Dropping policies:

- **Tail-drop** -- discard the newest items when full. Preserves ordering of older items.
- **Head-drop** -- discard the oldest items when full. Preserves recency (sensor readings,
  UI updates).
- **Random sample** -- discard with probability `1 - (mu / lambda)`. Unbiased statistical
  sample at the cost of completeness.
- **Semantic sample** -- discard based on content (keep errors, drop successes; keep every
  Nth item; keep items matching a priority predicate).

Dropping is acceptable when the data is **telemetry or metrics** (statistical accuracy
survives sampling), the pipeline has **at-most-once delivery** semantics, or the
alternative is **system failure** (controlled loss beats uncontrolled crash).

Always track the **drop count** as a metric. Silent data loss is the most dangerous form
of failure because it is invisible to correctness checks.

**Library primitives:**

```typescript
import {
  PushChainBuilder, PullChain, SourceBufferObj, SinkCollectObj
} from '@firebrandanalytics/shared-utils';

// Push-side sampling: keep 10% of telemetry events
const chain = PushChainBuilder.start<TelemetryEvent>()
  .filter(() => Math.random() < 0.1)
  .into(new SinkCollectObj());

// Pull-side semantic filter: keep only errors
const errors = PullChain.from(source)
  .filter(event => event.severity === 'ERROR');
```

See `PushChainBuilder.filter()` in the [Push Chain Reference](./reference/push-chain.md)
and `PullFilterObj` in the [Pull Obj Classes Reference](./reference/pull-obj-classes.md).

### 3b. Bounded Buffer

**Principle:** Absorb short-lived rate mismatches with an explicit, finite buffer that
smooths out variance without allowing unbounded growth.

Two buffering modes:

- **Fixed-size window** -- flush when item count reaches a fixed size. Predictable memory
  and batch sizes.
- **Condition-based flush** -- flush when a predicate returns true (total bytes exceed a
  threshold, a time window expires, or a delimiter item arrives).

**Partial batch behavior:** When the upstream source completes, the buffer may contain
fewer items than the flush threshold. In both `PullWindowObj` and `PullBufferObj`, this
partial batch is returned as the generator's **return value**, not yielded. A `for await`
loop will not see it. To capture partial batches, use the iterator protocol directly:

```typescript
const result = await chain.next();
if (result.done && result.value) {
  // result.value is the partial batch
}
```

**Library primitives:**

```typescript
import {
  PullChain, SourceBufferObj, PushChainBuilder, SinkCollectObj
} from '@firebrandanalytics/shared-utils';

// Pull-side: group into batches of 100 for bulk insert
const batched = PullChain.from(new SourceBufferObj(items)).window(100);

// Push-side: buffer until total payload exceeds 1MB
const chain = PushChainBuilder.start<Payload>()
  .buffer(buf => buf.reduce((s, p) => s + p.size, 0) > 1_000_000)
  .into(bulkSink);
```

See `PushChainBuilder.buffer()` / `.window()` in the [Push Chain Reference](./reference/push-chain.md)
and `PullChain.buffer()` / `.window()` in the [Pull Chain Reference](./reference/pull-chain.md).

### 3c. Throttle / Rate-Limit

**Principle:** Deliberately pace the flow of items. Unlike buffering (which absorbs
bursts), throttling enforces a maximum throughput rate regardless of available capacity.

**Placement matters:**

- **Ingress throttle** -- limits how fast items enter the pipeline. Protects every
  downstream stage. Risk: if the producer cannot be slowed, items must be buffered or
  dropped upstream.
- **Mid-pipeline throttle** -- limits throughput between stages. Useful when a stage has
  a known capacity ceiling (e.g., an external API rate limit).
- **Sink-adjacent throttle** -- limits egress rate. Protects the sink but allows upstream
  stages to run at full speed (with buffering).

**Serialization as single-slot throttle.** `PushSerialObj` enforces that only one item
is in-flight through the downstream chain at a time, equivalent to a concurrency-1
throttle. It uses a generator internally to serialize concurrent `next()` calls at the
yield point.

**Library primitives:**

```typescript
import { PushChainBuilder, PullTimerObj } from '@firebrandanalytics/shared-utils';

// Push-side: serialize concurrent writes to a non-thread-safe sink
const chain = PushChainBuilder.start<Record>()
  .serial()
  .into(databaseSink);

// Pull-side: periodic polling at 5-second intervals
const timer = new PullTimerObj(5000, true);
```

See `PushSerialObj` in the [Push Obj Classes Reference](./reference/push-obj-classes.md)
and `PullTimerObj` in the [Pull Obj Classes Reference](./reference/pull-obj-classes.md).

### 3d. Signal-Based / Demand-Driven

**Principle:** Items flow only when the consumer explicitly signals demand. No demand,
no production.

The pull model is inherently demand-driven: calling `next()` on a `PullObj` propagates
demand upstream. The producer does no work until the consumer asks. This is the simplest
and most robust backpressure because it is a structural property of the pipeline, not a
configured behavior.

For push pipelines, demand signaling requires explicit coordination. `WaitObject` provides
a reusable signal: the producer awaits a signal from the consumer before producing.
`WaitObject` has "last-wins" semantics -- if a signal is emitted when no one is waiting,
the value is stored and delivered immediately on the next `wait()` call.

`PullAwaitReset` combines signal-gated behavior with a buffered source: it drains the
buffer, then waits for a `WaitObject` signal before draining again. This pattern is
central to the push-pull bridge (Section 6).

**Library primitives:**

```typescript
import { PullAwaitReset, SourceBufferObj, WaitObject } from '@firebrandanalytics/shared-utils';

const buffer = new SourceBufferObj(items);
const signal = new WaitObject<boolean>('refill');
const gated = new PullAwaitReset(buffer, signal);

// Consumer pulls all buffered items, then blocks until signal.resolve(true)
for await (const item of gated) {
  process(item);
}
```

See `PullAwaitReset` and `WaitObject` in the [Utilities Reference](./reference/utilities.md).

### 3e. Capacity-Gated Scheduling

**Principle:** Gate flow on the availability of underlying resources (CPU slots, GPU
units, memory budgets) rather than queue depth or timing.

This recognizes that processing cost is not uniform. A simple concurrency limit treats
all items equally, either over-provisioning (wasting expensive resources) or
under-provisioning (rejecting affordable items).

**Atomic multi-resource acquisition.** `ResourceCapacitySource` manages named resources
with variable costs. Acquisition is all-or-nothing: either every requested resource is
available and acquired atomically, or nothing is touched. This prevents **partial
allocation deadlocks** where Task A holds Resource X and waits for Y, while Task B
holds Y and waits for X.

The atomicity exploits JavaScript's single-threaded event loop: between a synchronous
`canAcquire()` check and a synchronous `acquireImmediate()` call, no other code can
interleave.

**Hierarchical capacity.** A child `ResourceCapacitySource` can have a parent. Acquisition
must satisfy both local and parent limits.

**WaitObject signaling.** `release()` signals the capacity source's `WaitObject`, waking
blocked callers to retry `canAcquire()`.

**Library primitives:**

```typescript
import { ResourceCapacitySource } from '@firebrandanalytics/shared-utils';

const cluster = new ResourceCapacitySource({ gpu: 8, cpu: 32 });
const teamA = new ResourceCapacitySource({ gpu: 4, cpu: 16 }, cluster);

const cost = { gpu: 2, cpu: 4 };
if (teamA.canAcquire(cost)) {
  teamA.acquireImmediate(cost);
  // ... run task ...
  teamA.release(cost);
}
```

See the [Scheduling Reference](./reference/scheduling.md).

---

## 4. Pull Pipelines: Natural Backpressure

In a pull pipeline, data flows only when the consumer calls `next()`. This propagates
upstream through the chain: each `PullObj1To1Link` calls `next()` on its source inside
`pull_impl()`. No data moves without demand.

```
Consumer        PullMapObj        SourceBufferObj
   |                |                   |
   |--- next() --->|                   |
   |                |--- next() ------>|
   |                |<--- value -------|
   |<--- mapped ---|                   |
```

A slow consumer simply calls `next()` less frequently, and the entire pipeline slows to
match. No configuration required.

### The hidden cost of pure pull: sequential stalls

The pull model's simplicity comes with a trade-off that is easy to overlook. Because
each `next()` call waits for the upstream source to produce before proceeding, **the
consumer sits idle while the source is working, and the source sits idle while the
consumer is working.** They take turns.

Consider a video transcoding pipeline:

```
Source: download 2 GB file (8 seconds)  -->  Consumer: transcode (30 seconds)
```

With pure pull:

```
time  0s        8s                         38s       46s                        76s
      |--download--|--------transcode--------|--download--|--------transcode--------|
      Source works   Source idle               Source works   Source idle
                     Consumer works                          Consumer works
```

Two files take 76 seconds. The download step and the transcode step never overlap --
the network sits completely idle for the 30 seconds of transcoding, and the GPU sits
completely idle for the 8 seconds of downloading. You are paying for both resources
full-time but using each one less than half the time.

What you want is **pipelining**: start downloading file 2 while file 1 is still
transcoding.

```
time  0s        8s       16s                38s      46s
      |--download-1--|                        |
                     |--download-2--|          |
                |--------transcode-1--------| |
                                             |--------transcode-2--------|
```

Two files now take ~68 seconds instead of 76, and with more files the pipeline
approaches the throughput of the slower stage (30s/file) rather than the sum of both
stages (38s/file). The improvement scales with the number of items: 10 files drop
from 380s (sequential) to ~278s (pipelined).

### `PullEagerObj`: Pre-fetching for pipeline overlap

`PullEagerObj` solves this by calling `source.next()` **before** the downstream consumer
has asked, maintaining `buffer_size` in-flight promises. When the consumer calls `next()`,
the oldest pre-fetched result is already resolved (or close to it) and returns
immediately. A new `source.next()` is initiated to refill the buffer.

```
Without eager:
  Consumer: |--wait for source--|--process--|--wait for source--|--process--|
  Source:   |------produce------|---idle----|------produce------|---idle----|

With eager(1):
  Consumer: |--wait--|--process--|--process--|--process--|
  Source:   |--produce--|--produce--|--produce--|--idle--|
                     ^^^
                     overlap: source is already working on next item
                     while consumer processes current item
```

The cost is up to `buffer_size` items held in memory. For large items (video files,
ML model weights, large API responses), keep `buffer_size` small (1-2). For small items
with high source latency (database queries, network API calls), a larger buffer (3-5)
absorbs more variance.

**When to use it:**
- Source and consumer have **comparable** processing times (both are significant).
  If one dominates (source is 100x faster), eager adds memory overhead with negligible
  throughput gain.
- Items are **independent** -- processing item N does not depend on the result of
  item N-1.
- The source is **safe to call ahead** -- it will not produce side effects you cannot
  buffer (e.g., acknowledging messages before processing).

**`PullTimeoutObj`: Overlapping `next()` calls on timeout.** When a timeout fires, the
source's pending `next()` is **not cancelled** -- it continues in the background. If the
consumer retries (`throwOnTimeout = false`), a new `next()` is issued while the old one
is still in flight. Sources must be concurrency-safe. When `throwOnTimeout = false`, the
timed-out pull is skipped (never yielded), and the loop continues with a fresh `next()`.

### Example: Pull pipeline with eager + timeout + window

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

const pipeline = PullChain.from(new SourceBufferObj(records))
  .eager(3)           // Pre-fetch 3 items for throughput
  .timeout(5000)      // 5s timeout per item
  .window(50)         // Batch into groups of 50
  .map(batch => bulkInsert(batch));

for await (const result of pipeline) {
  console.log('Batch inserted:', result);
}
```

### Merging: Many sources into one consumer

Pull pipelines naturally handle 1-to-1 chains, but many real systems need to combine
**multiple independent sources** into a single downstream consumer. The library provides
several many-to-1 combiners, each with different ordering and fairness semantics:

| Combiner | Strategy | When to use |
|----------|----------|-------------|
| `PullConcatObj` | Drain source 1 completely, then source 2, etc. | Sources have a natural order (primary + fallback) |
| `PullRoundRobinObj` | Take one item from each source in rotation | Fair interleaving when sources produce at similar rates |
| `PullRaceObj` | Yield from whichever source produces next (attributed) | Heterogeneous latency; you want the fastest result and need to know which source produced it |
| `PullRaceRobinObj` | Race semantics without attribution | Same as race, but you don't need the source label |
| `PullRaceCutoffObj` | Race N sources against a cutoff signal | Timed operations; cancel remaining sources when a deadline fires |

All combiners accept an optional `{ eager: true }` flag, which wraps each source in
`PullEagerObj` so that all sources are pre-fetching concurrently. Without eager mode,
`PullRoundRobinObj` still pulls sources sequentially on each rotation; with eager mode,
the next source's result is likely already buffered.

`PullChain` exposes these as both static factories and mid-chain methods:

```typescript
// Static: start a chain from multiple sources
const merged = PullChain.roundRobin(dbSource, apiSource, cacheSource);

// Mid-chain: merge additional sources into an existing chain
const pipeline = PullChain.from(primarySource)
  .map(normalize)
  .mergeRace(fallbackSource, backupSource)  // fold in extra sources
  .window(50);
```

The mid-chain methods (`.mergeRace()`, `.mergeRoundRobin()`, `.mergeConcat()`) replace
the chain's tail with the combiner, so upstream transformations still apply to the
original source while the merged sources contribute raw items.

Backpressure flows naturally: if the consumer slows down, it stops calling `next()` on
the combiner, which stops pulling from all upstream sources.

---

## 5. Push Pipelines: Explicit Flow Control

In a push pipeline, the producer calls `next(value)` to push data into the chain.
**Nothing prevents the producer from calling `next()` faster than the consumer can
process.** Without explicit flow control, a fast producer overwhelms a slow sink.

### PushSerialObj: Serialization gate

`PushSerialObj` uses an internal generator to serialize concurrent `next()` calls.
Because generators inherently serialize at yield points, only one item flows through
the downstream chain at a time.

**Generator priming note:** The first `next()` call to a generator is consumed by
initialization (advancing to the first `yield`). The first item pushed through
`PushSerialObj` is consumed by priming and does not reach the downstream sink. This is
a known behavior. If the first item is significant, account for it in your design.

### PushWindowObj / PushBufferObj: Batch accumulation

These accumulate items before flushing downstream, reducing per-item overhead.
`PushWindowObj` flushes at a fixed count; `PushBufferObj` flushes when a predicate
returns true.

### Example: Push pipeline with serial + filter + window

```typescript
import { PushChainBuilder, SinkCallbacksObj } from '@firebrandanalytics/shared-utils';

const chain = PushChainBuilder.start<LogEntry>()
  .serial()                          // Serialize concurrent pushes
  .filter(e => e.level !== 'DEBUG')  // Drop debug logs
  .window(100)                       // Batch into groups of 100
  .into(new SinkCallbacksObj(batch => sendToLogAggregator(batch)));

for (const entry of incomingLogs) {
  chain.next(entry);  // Does not block; serialized internally
}
await chain.return();
```

### Fan-out: Fork vs Distribution

Push pipelines support two fundamentally different fan-out patterns:

- **Fork (broadcast):** Every item goes to **all** branches. Use when multiple
  independent consumers each need every event -- logging, analytics, alerting,
  archival all processing the same stream.
- **Distribution (routing):** Each item goes to **exactly one** branch. Use when
  you want to partition work across workers for parallelism or route items to
  specialized handlers.

This distinction matters because it determines whether your total downstream work
scales with the number of branches (fork: yes, distribution: no).

### PushForkObj: Broadcast to all branches

`PushForkObj` sends each item to **every** branch sink. Branches are processed
**sequentially** -- each branch's `next()` is `await`ed before moving to the next.

**Why sequential?** This is a deliberate design choice, not a limitation:
1. **Reference safety.** The fork sends the **same object reference** to all branches.
   If branches ran concurrently via `Promise.all`, two branches could mutate the
   same object simultaneously. Sequential dispatch means each branch sees the object
   in a predictable state.
2. **Sink lifecycle management.** When a branch signals `done`, the fork removes it
   from the active list (splice during iteration). This requires sequential processing.
3. **Deterministic backpressure.** The fork's total latency is the **sum** of all branch
   latencies, giving the producer an honest signal about total downstream cost.

**Fork vs adding more steps to the chain.** A normal chain is a sequence where each
step receives the **output** of the previous step. A fork is different: each branch
receives the **same input** independently. Branch 2 does not see the output of branch 1;
it sees the original item. However, because branches execute sequentially on the same
object reference, if branch 1 **mutates** the input object, branch 2 will see the
mutation. The library does not freeze items -- it is the developer's responsibility to
treat forked items as read-only, or to `Object.freeze()` them if enforcement is needed.

### Example: Fork with independent branch pipelines

```typescript
import { PushChainBuilder, SinkCallbacksObj } from '@firebrandanalytics/shared-utils';

// Every incoming order is processed by three independent branches:
//  1. Real-time dashboard (fast, can drop old data)
//  2. Fraud detection (slower, needs every order)
//  3. Archive to data warehouse (slow batch writes)

const chain = PushChainBuilder.start<Order>()
  .filter(o => o.total > 0)           // Drop $0 orders before forking
  .fork(
    // Branch 1: real-time dashboard — keep only last 5 seconds of data
    branch => branch
      .map(o => ({ id: o.id, total: o.total, ts: Date.now() }))
      .into(dashboardSink),

    // Branch 2: fraud scoring — serialize so the ML model sees one at a time
    branch => branch
      .serial()
      .map(o => scoreFraudRisk(o))
      .filter(scored => scored.risk > 0.8)
      .into(alertSink),

    // Branch 3: archive — batch into groups of 500 for bulk insert
    branch => branch
      .window(500)
      .into(warehouseSink),
  );

for await (const order of orderStream) {
  await chain.next(order);
}
await chain.return();
```

The `.filter()` before `.fork()` runs once, and only qualifying items fan out to all
three branches. Each branch has its own pipeline stages -- serialization, windowing,
mapping -- independent of the others. If `warehouseSink` is slow (120ms per batch of
500), it blocks the fork for that item, delaying the dashboard and fraud branches. If
that latency is unacceptable, consider using a `PushPullBufferObj` bridge on the slow
branch so the fork returns immediately and the slow branch drains asynchronously.

### Distribution: Route each item to one branch

Where fork is "every item to every branch," distribution is "each item to exactly one
branch." The library provides three routing strategies:

| Class | Strategy | When to use |
|-------|----------|-------------|
| `PushRoundRobinObj` | Rotate through branches in order (0, 1, 2, 0, 1, 2, ...) | Load balancing across identical workers |
| `PushDistributeObj` | Route by index via `selector(item) → number` | Content-based routing (e.g., shard by hash) |
| `PushLabeledDistributeObj` | Route by label via `labelGetter(item) → L` | Named routing (e.g., route by `item.region`) |

Unlike fork, distribution does **not** have the reference-mutation concern -- each item
goes to exactly one branch, so there is no shared-reference hazard.

```typescript
// Round-robin across 3 worker branches for parallel processing
const chain = PushChainBuilder.start<Task>()
  .roundRobinTo(
    branch => branch.map(t => processTask(t)).into(resultSink1),
    branch => branch.map(t => processTask(t)).into(resultSink2),
    branch => branch.map(t => processTask(t)).into(resultSink3),
  );

// Content-based routing: shard orders by region
const chain = PushChainBuilder.start<Order>()
  .distribute(
    order => regionToIndex(order.region),  // selector returns branch index
    branch => branch.into(usEastSink),     // index 0
    branch => branch.into(euWestSink),     // index 1
    branch => branch.into(apacSink),       // index 2
  );
```

### Push fan-out and pull fan-in: dual operations

Push fan-out (fork, distribute) and pull fan-in (concat, round-robin, race) are **dual
operations**. A fork broadcasts one item to many sinks; a merge combines many sources
into one consumer. A push round-robin distributes items across workers; a pull
round-robin interleaves items from multiple producers.

If you need both in the same system -- e.g., fan out to parallel workers, then
re-combine results -- bridge between push and pull using `PushPullBufferObj`:

```
Producer --push--> PushForkObj ──┬── Worker A ──> PushPullBufferObj ──┐
                                 ├── Worker B ──> PushPullBufferObj ──┤
                                 └── Worker C ──> PushPullBufferObj ──┘
                                                                      │
                          PullChain.roundRobin(bufA, bufB, bufC) <────┘
                                         │
                                    Consumer (pull)
```

See the [Push Chain Reference](./reference/push-chain.md) and
[Push Obj Classes Reference](./reference/push-obj-classes.md).

---

## 6. Bridging Push and Pull

When a push-driven producer needs to feed a pull-driven consumer (or vice versa), a
bridge decouples the two sides with a shared buffer and signaling.

### PushPullBufferObj: Push-to-pull bridge

`PushPullBufferObj` connects a push interface to a pull interface:

- **Push side:** `SinkCollectObj` appends items to a shared `Array<T>`.
- **Pull side:** `SourceBufferObj` reads from the same array.
- **Coordination:** `WaitObject` signals "data available". The push side signals after
  each write (via `PushPostSignalObj`). The pull side waits when the buffer is empty
  (via `PullAwaitReset`).

```
Producer --push--> SinkCollectObj --> Array<T> --> SourceBufferObj --pull--> Consumer
                         |                                |
                    PushPostSignalObj               PullAwaitReset
                         |                                |
                         +-------> WaitObject <----------+
```

The shared buffer is the **critical control point**. Its growth directly reflects rate
mismatch. Monitor `buffer.length` as a health metric. If it grows unboundedly, the push
side is faster and you need a strategy from Section 3.

### PullPushBridgeObj: Pull-to-push side effects

`PullPushBridgeObj` is a pull stage that also feeds push sinks as a side effect. Each
pulled item is yielded downstream *and* pushed to registered sinks (logging, monitoring,
duplication). `return()` and `throw()` propagate to all sinks.

### Example: Bridging a push producer to a pull consumer

```typescript
import { PushPullBufferObj, PullChain } from '@firebrandanalytics/shared-utils';

const bridge = new PushPullBufferObj<Event>();

async function producer() {
  for (const event of eventStream) {
    await bridge.sink.next(event);
  }
  await bridge.sink.return();
}

async function consumer() {
  const pipeline = PullChain.from(bridge.source)
    .filter(e => e.type === 'IMPORTANT')
    .window(10);
  for await (const batch of pipeline) {
    await processBatch(batch);
  }
}

await Promise.all([producer(), consumer()]);
```

See `PushPullBufferObj` and `WaitObject` in the
[Utilities Reference](./reference/utilities.md).

---

## 7. Capacity-Gated Scheduling

When pipeline items are **work units** with heterogeneous resource requirements, flow
control becomes **scheduling**. The scheduling subsystem provides resource-aware flow
control over task execution.

### Lifecycle: peek-check-acquire-run-release

`ScheduledTaskPoolRunner` follows a strict protocol:

1. **Peek** the task source to see the next `ScheduledTask` descriptor without consuming.
2. **Check** `canAcquire(task.cost)` on `ResourceCapacitySource`.
3. If affordable: **consume** the task and call `acquireImmediate(task.cost)`.
4. **Start** the task. `task.runner()` returns either a `Promise` (one-shot) or an
   `AsyncGenerator` (streaming).
5. **Emit** `TaskProgressEnvelope` values:
   - `INTERMEDIATE` -- streaming task yielded a partial result.
   - `FINAL` -- task completed; runner calls `release(task.cost)`.
   - `ERROR` -- task threw; runner calls `release(task.cost)`.
6. **Release** signals the `WaitObject`, waking tasks waiting for resources.

### Multi-resource costs

`ResourceCost` is `Record<string, number>`. A task might require `{ gpu: 2, cpu: 4,
memory_gb: 16 }`. `canAcquire()` / `acquireImmediate()` is **atomic**: all resources
acquired together or none. This prevents partial-allocation deadlocks.

```typescript
import { ResourceCapacitySource } from '@firebrandanalytics/shared-utils';

const capacity = new ResourceCapacitySource({ gpu: 4, cpu: 16 });
// Task A needs 2 GPUs; Task B needs 3 GPUs.
// A starts (2 acquired). B waits (3 > 2 remaining).
// A completes, release signals, B retries and succeeds.
```

### Hierarchical capacity chains

A `ResourceCapacitySource` can have a parent. `canAcquire()` checks both local and parent
availability. `acquireImmediate()` decrements both. `release()` increments both and
signals both `WaitObject` instances.

```
Cluster:   { gpu: 16, cpu: 64 }
  +-- Team A: { gpu: 8, cpu: 32 }   (child of Cluster)
  +-- Team B: { gpu: 8, cpu: 32 }   (child of Cluster)
```

Team A can use at most 8 GPUs *and* the cluster must have availability. If Team A
requests 9, its local limit blocks even if the cluster has spare capacity.

### WaitObject signaling

`release()` calls `this._waitObj.resolve(true)`. The `ScheduledTaskPoolRunner`'s wait
phase wakes up and re-checks `canAcquire()` for the next pending task, creating a clean
feedback loop: complete -> release -> signal -> retry -> start.

---

## 8. Dynamic Scaling and Adaptive Concurrency

Static capacity limits work for predictable workloads. Variable workloads benefit from
a **control loop** that adjusts effective capacity based on observed conditions.

### The control loop pattern

1. **Monitor** a target metric: queue depth, completion throughput, or tail latency.
2. **Compare** against high and low thresholds.
3. **Act:** Above `high_threshold` -> increase capacity (scale up). Below
   `low_threshold` -> decrease capacity (scale down).
4. **Guard:** Hysteresis bands, cooldown timers, min/max bounds prevent oscillation.

### Implementation with ResourceCapacitySource

The library does not include a built-in autoscaler, but `ResourceCapacitySource` supports
a clean **reserve/release pattern**: pre-acquire a portion of the budget as "reserved".
When load increases, release reserved capacity (making it available to the scheduler).
When load decreases, re-acquire into the reserve.

```typescript
import { ResourceCapacitySource } from '@firebrandanalytics/shared-utils';

// Total: 16 workers. Start with 8 active, 8 reserved.
const capacity = new ResourceCapacitySource({ workers: 16 });
capacity.acquireImmediate({ workers: 8 }); // Reserve 8 slots

async function autoscale(queueDepthFn: () => number) {
  const HIGH = 100, LOW = 10, COOLDOWN_MS = 5000;
  let lastScale = 0, reserved = 8;

  while (true) {
    await sleep(1000);
    const depth = queueDepthFn();
    const now = Date.now();
    if (now - lastScale < COOLDOWN_MS) continue;

    if (depth > HIGH && reserved > 0) {
      const n = Math.min(2, reserved);
      capacity.release({ workers: n });
      reserved -= n;
      lastScale = now;
    } else if (depth < LOW && reserved < 8) {
      const n = Math.min(2, 8 - reserved);
      if (capacity.canAcquire({ workers: n })) {
        capacity.acquireImmediate({ workers: n });
        reserved += n;
        lastScale = now;
      }
    }
  }
}
```

### Guardrails

- **Hysteresis bands:** Separate high/low thresholds prevent rapid oscillation.
- **Cooldown timers:** Minimum interval between scaling actions.
- **Min/max bounds:** Never scale below a minimum or above a maximum.
- **Proportional response:** Scale in small increments (1-2 slots) to allow stabilization.

---

## 9. Observability and Failure Containment

Flow control without observability is flying blind. Minimal monitoring set:

| Metric              | What It Tells You              | Action                                          |
|---------------------|--------------------------------|-------------------------------------------------|
| Queue depth         | Rate mismatch direction        | Scale up if growing; scale down if draining      |
| Ingress rate        | Producer behavior              | Throttle or sample if above capacity             |
| Completion rate     | Throughput health              | Investigate if dropping                          |
| Drop count          | Data loss volume               | Alarm if unexpected; review sampling config      |
| Timeout/error rate  | Failure frequency              | Investigate root cause; check retry amplification|
| Resource utilization| Capacity headroom              | Scale or rebalance if sustained above 80%        |

### Collecting metrics with callbacks

The library's `.callback()` (pull) and `.preCallback()` / `.postCallback()` (push) stages
collect metrics without modifying data flow:

```typescript
const pipeline = PullChain.from(source)
  .callback(item => metrics.increment('ingress'))
  .filter(predicate)
  .callback(item => metrics.increment('post_filter'))
  .window(100);
```

`TaskProgressEnvelope` from `ScheduledTaskPoolRunner` provides structured observability:
each envelope carries a `taskId`, `type` (INTERMEDIATE, FINAL, ERROR), and the value or
error.

### Timeout placement

Aggressive per-stage timeouts are counterproductive under load. Timeouts cause retries,
which **increase** ingress rate -- exactly the wrong response to overload (retry
amplification).

**Place timeouts at the outermost boundary**, not per-stage. A single end-to-end timeout
at the API gateway is more effective than per-stage timeouts that compound into retry
storms. If per-stage timeouts are necessary (external API SLAs), set them generously
(2-3x expected P99) and **do not retry automatically**.

### Abort cascades

When a task fails in a dependency graph, abort its dependents rather than letting them
start. `DependencyGraph.abort(key)` cascades to all transitive dependents, moving them
to `aborted` state. The scheduler never yields aborted tasks, preventing wasted work.

---

## 10. Primitive Selection Guide

Decision matrix for common symptoms:

| Symptom                           | Strategy               | Primitives                                                  |
|-----------------------------------|------------------------|-------------------------------------------------------------|
| Memory growing unbounded          | Bounded buffer         | `PushChainBuilder.window()`, `PullChain.window()`           |
| Slow consumer overwhelmed         | Demand-driven pull     | `PullChain` (restructure to pull model)                     |
| Burst producer into slow sink     | Buffer + throttle      | `PushChainBuilder.serial().window()`                        |
| Push source, pull consumer        | Bridge                 | `PushPullBufferObj`                                         |
| Heterogeneous resource needs      | Capacity-gated         | `ResourceCapacitySource` + `ScheduledTaskPoolRunner`        |
| Variable load patterns            | Dynamic scaling        | `ResourceCapacitySource` reserve/release pattern             |
| Data loss acceptable              | Drop / sample          | `PushChainBuilder.filter()`                                 |
| Need observability                | Callbacks + envelopes  | `.callback()`, `TaskProgressEnvelope`                       |
| Multiple sources, fair processing | Multi-source combiner  | `PullChain.roundRobin()`, `PullChain.race()`                |
| Ordered output from parallel work | Reorder buffer         | `PullChain.inOrder()`                                       |
| External API rate limit           | Periodic pull          | `PullTimerObj` (paces upstream requests)                    |
| Concurrent push corruption        | Serialization          | `PushChainBuilder.serial()`                                 |

### Combining strategies

Most production pipelines combine multiple strategies:

1. **Ingress**: `PullTimerObj` or `PushSerialObj` to pace input.
2. **Transform**: `PullChain.map().filter()` or `PushChainBuilder.map().filter()`.
3. **Buffer**: `.window()` or `.buffer()` to batch for efficiency.
4. **Egress**: `ScheduledTaskPoolRunner` with `ResourceCapacitySource` for resource-aware
   delivery.
5. **Observability**: `.callback()` at key points to collect metrics.

### When to restructure

If you find yourself adding multiple flow-control stages to compensate for a fundamental
rate mismatch, consider restructuring:

- If the producer is always faster, **move to a pull model** where the consumer drives
  the pace.
- If resource requirements vary widely, **move to capacity-gated scheduling** rather than
  fixed concurrency limits.
- If the pipeline crosses process boundaries, use the **push-pull bridge** and monitor
  the bridge buffer as a health indicator.

For practical implementations of these strategies, see the [Use Cases](./use-cases/)
directory.

---

## Further Reading

- [Conceptual Guide](./concepts.md) -- Obj pattern, pipeline construction, lifecycle
- [Pull Chain Reference](./reference/pull-chain.md) -- Complete PullChain API
- [Push Chain Reference](./reference/push-chain.md) -- PushChainBuilder / PushChain API
- [Scheduling Reference](./reference/scheduling.md) -- ResourceCapacitySource,
  ScheduledTaskPoolRunner, DependencyGraph
- [Utilities Reference](./reference/utilities.md) -- WaitObject, PushPullBufferObj
- [Scheduling Fundamentals Tutorial](./tutorials/scheduling-fundamentals.md)
- [Use Cases](./use-cases/) -- Practical flow-control implementations
