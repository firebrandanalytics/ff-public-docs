# Combining Multiple Async Streams

Many real-world applications need to consume data from more than one source at
the same time. You might be polling several APIs, reading from multiple message
queues, or merging user-input streams with background data feeds. Handling each
source independently works for simple cases, but once you need a single
processing pipeline that draws from several origins, you need a combination
strategy.

The async-streams library provides **four core strategies** for combining pull
streams: **race**, **round-robin**, **concat**, and **zip**. Each strategy is
available in three forms:

1. As a **`PullChain` static factory** (`PullChain.race(...)`, etc.)
2. As a **mid-chain merge** on an existing `PullChain` instance (`.mergeRace(...)`, etc.)
3. As a **standalone Obj class** (`PullRaceObj`, `PullConcatObj`, etc.)

This tutorial walks through all four strategies, shows how to use them in each
form, and closes with a practical multi-API aggregation example.

---

## The Four Combination Strategies

### Race

Race yields from whichever source produces a value first. The output order is
non-deterministic because it depends on how quickly each source resolves. Each
yielded value is an `AttributedResult` containing `{ source, result }`, where
`source` is a reference to the iterator that produced the value and `result` is
the `IteratorResult`.

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

const fast = new SourceBufferObj([1, 2, 3]);
const slow = new SourceBufferObj([10, 20, 30]);

for await (const { source, result } of PullChain.race(fast, slow)) {
    console.log(result.value); // interleaved based on which source yields first
}
```

**When to use:** Real-time streams where you want the freshest data regardless
of source. Monitoring multiple feeds, tailing several log files, or consuming
from competing WebSocket connections.

---

### Round Robin

Round-robin takes one item from each source in strict rotation. The ordering is
deterministic: source A, then source B, then source A again, and so on.

```typescript
const a = new SourceBufferObj([1, 2, 3]);
const b = new SourceBufferObj([10, 20, 30]);

const results = await PullChain.roundRobin(a, b).collect();
// [1, 10, 2, 20, 3, 30]
```

**When to use:** Fair consumption from multiple sources. Load balancing across
worker queues. Any scenario where no single source should dominate the pipeline.

---

### Concat

Concat exhausts the first source completely before moving on to the next. The
output order is sequential and deterministic.

```typescript
const first = new SourceBufferObj([1, 2]);
const second = new SourceBufferObj([3, 4]);

const results = await PullChain.concat(first, second).collect();
// [1, 2, 3, 4]
```

**When to use:** Sequential processing in a defined order. Appending data
batches. Prioritized sources where the first source must be fully drained
before the next begins.

---

### Zip

Zip pairs corresponding items from each source into tuples. It continues while
**any** source remains active. When a source is exhausted, it is removed, and
subsequent tuples contain values only from the remaining sources.

```typescript
const names = new SourceBufferObj(['alice', 'bob', 'charlie']);
const scores = new SourceBufferObj([95, 87, 92]);

const results = await PullChain.zip(names, scores).collect();
// [['alice', 95], ['bob', 87], ['charlie', 92]]
```

**When to use:** Correlating items across sources by position. Pairing
request/response data. Joining two ordered datasets element-by-element.

---

## Summary Table

| Strategy    | Behavior                          | Ordering                | Use When                        |
| ----------- | --------------------------------- | ----------------------- | ------------------------------- |
| Race        | Yields from whichever produces first | Non-deterministic       | Interleaving real-time streams  |
| Round Robin | One from each in rotation         | Deterministic rotation  | Fair consumption                |
| Concat      | Exhausts sources sequentially     | Sequential, deterministic | Ordered batch processing       |
| Zip         | Pairs items into tuples (continues while any source active) | Positional pairing      | Correlating data across sources |

---

## Mid-Chain Merge

You do not always start with multiple sources. Sometimes you build a pipeline
from a single source, apply some transforms, and then want to merge in
additional data partway through. The mid-chain merge methods handle this.

```typescript
const primary = PullChain.from(new SourceBufferObj([1, 2, 3]));
const secondary = new SourceBufferObj([10, 20, 30]);

// Merge with race semantics
const merged = primary
    .map(x => x * 100)
    .mergeRace(secondary)
    .collect();
```

When you call a merge method, the current tail of the chain becomes one of the
combiner's input sources. The merge replaces that tail in the chain's internal
links array, so all downstream operators (`.map`, `.filter`, `.collect`, etc.)
see the combined output transparently.

Available merge methods:

- **`.mergeRace(...others)`** -- merge with race semantics. Values arrive from
  whichever source produces first.
- **`.mergeRoundRobin(...others)`** -- merge with round-robin semantics. Values
  alternate fairly between the current chain and each additional source.
- **`.mergeConcat(...others)`** -- append other sources after the current chain
  is exhausted. The chain's existing data comes first, followed by each
  additional source in order.

You can pass one or more additional sources to any merge method. Each source
must implement the pull-stream interface (any `Obj` class or another
`PullChain`).

---

## Using Standalone Obj Classes

The same combination strategies are available as raw Obj classes for manual
composition outside of `PullChain`. This is useful when you are building
custom pipelines or need direct access to the combiner's async iterator.

```typescript
import { PullRaceObj, PullConcatObj, SourceBufferObj } from '@firebrandanalytics/shared-utils';

const sources = [
    new SourceBufferObj([1, 2]),
    new SourceBufferObj([3, 4]),
];

const combiner = new PullRaceObj(sources);

for await (const value of combiner) {
    console.log(value);
}
```

The six standalone combiner classes are:

- **`PullConcatObj`** -- sequential. Exhausts each source in order.
- **`PullZipObj`** -- positional pairing. Yields tuples of corresponding items.
- **`PullRoundRobinObj`** -- fair rotation. Takes one from each source in turn.
- **`PullRaceObj`** -- fastest first. Yields an `AttributedResult` that
  includes a reference to the source that produced the value.
- **`PullRaceRobinObj`** -- race with round-based fairness. Within each round,
  sources race (fastest yielded first), but every source must produce exactly
  one result per round before the next round begins. Prevents fast sources
  from starving slow ones.
- **`PullRaceCutoffObj`** -- race with timeout cutoff. Like `PullRaceObj` but
  discards sources that do not produce within a configurable deadline.

All six classes implement the async-iterable protocol, so you can use them
directly with `for await...of` or pass them into `PullChain.from()` to
continue building a chain.

---

## Labeled Variants

Sometimes you need to know *which* source produced each value. The labeled
variants wrap each emitted item with a label that identifies its origin.

```typescript
import { PullLabeledRaceObj, SourceBufferObj } from '@firebrandanalytics/shared-utils';

const sources = new Map<string, SourceBufferObj<number>>([
    ['api-1', new SourceBufferObj([1, 2])],
    ['api-2', new SourceBufferObj([10, 20])],
]);

const labeled = new PullLabeledRaceObj(sources);

for await (const { key, value } of labeled) {
    console.log(`From ${key}: ${value}`);
}
// From api-1: 1
// From api-2: 10
// From api-1: 2
// From api-2: 20
```

Instead of an array of sources, labeled classes accept a `Map<string, Source>`
so each source has a human-readable key. The emitted items are `LabeledValue`
objects with `{ key, value }` fields.

Available labeled classes:

- **`PullLabeledZipObj`** -- positional pairing with labels.
- **`PullLabeledRoundRobinObj`** -- fair rotation with labels.
- **`PullLabeledRaceObj`** -- fastest-first with labels.
- **`PullLabeledRaceRobinObj`** -- race with round-based fairness, labeled.

Labeled combiners are especially useful for logging, debugging, and routing
logic where downstream operators need to branch based on the data's origin.

---

## Practical Example: Multi-API Aggregation

The following example demonstrates a realistic pattern: fetching records from
three different API endpoints and processing them through a unified pipeline.

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

// Simulated API data (in practice, these would be async generators
// wrapping HTTP calls, database cursors, or message queues)
const userRecords = [
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' },
];
const orderRecords = [
    { id: 'o1', total: 49.99 },
    { id: 'o2', total: 120.0 },
];
const eventRecords = [
    { id: 'e1', action: 'login' },
    { id: 'e2', action: 'purchase' },
];

// Wrap each dataset in a chain that tags items with their type
const apiSources = {
    users: PullChain.from(new SourceBufferObj(userRecords))
        .map(u => ({ type: 'user' as const, data: u })),
    orders: PullChain.from(new SourceBufferObj(orderRecords))
        .map(o => ({ type: 'order' as const, data: o })),
    events: PullChain.from(new SourceBufferObj(eventRecords))
        .map(e => ({ type: 'event' as const, data: e })),
};

// Race all three -- process whichever is ready first
const aggregated = await PullChain.race(
    apiSources.users,
    apiSources.orders,
    apiSources.events,
)
    .map(item => ({ ...item, processedAt: Date.now() }))
    .collect();

for (const item of aggregated) {
    console.log(`[${item.type}] processed at ${item.processedAt}`, item.data);
}
```

In this pattern, each source independently tags its items with a discriminated
`type` field before entering the combiner. The race strategy ensures the
pipeline never blocks waiting for a slow source while a fast one has data
ready. After the race, the `.map` step adds a processing timestamp, and
`.collect()` gathers everything into an array.

You could swap `PullChain.race` for `PullChain.roundRobin` to guarantee fair
interleaving, or use `PullChain.concat` if you need all users processed before
any orders.

---

## Next Steps

- [Pull Pipeline Basics](./pull-pipeline-basics.md) -- building single-source
  transform pipelines with `PullChain`.
- [Scheduling Fundamentals](./scheduling-fundamentals.md) -- task orchestration
  and concurrency control.
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- full API
  documentation for all combiner classes.
- [PullChain API Reference](../reference/pull-chain.md) -- merge methods,
  static factories, and chain operators.
