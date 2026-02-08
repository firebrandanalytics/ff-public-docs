# Utilities -- API Reference

Utility classes that support the async streams library: signaling primitives, iterator combiners, push-pull bridges, and legacy capacity management.

```typescript
import {
    WaitObject,
    AsyncIteratorCombiner,
    PushPullObj, PushPullBufferObj, PushPullBufferCacheObj,
    CapacitySource, SourceCapacityObj, SinkCapacityObj,
} from '@firebrandanalytics/shared-utils';
```

---

## WaitObject\<T\>

**`class WaitObject<T = boolean> implements AsyncIterable<T>`**

A promise-sequence signaling mechanism. Bridges push-style producers and pull-style consumers: producers call `resolve(value)` to send a signal, and consumers `await` the next signal via async iteration or the `wait()` convenience method. Nothing happens when nobody is listening -- values are stored for the next consumer to pick up.

### Constructor

```typescript
constructor(label: string, init_value?: T)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | `string` | (required) | Debugging label, used in internal logger.debug calls |
| `init_value` | `T` | `undefined` | If provided, stored as the initial `last_value` so the first iteration yields immediately |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `[Symbol.asyncIterator]` | `[Symbol.asyncIterator](): AsyncGenerator<T, T \| undefined, void>` | Returns an async generator that yields values as they arrive |
| `wait` | `wait(): Promise<IteratorResult<T>>` | Convenience shorthand -- awaits the next signal by calling `.next()` on the internal iterator |
| `resolve` | `resolve(value: T): any` | Sends a value. If a consumer is awaiting, resolves its promise immediately. Otherwise, stores as `last_value` for the next consumer. |
| `reject` | `reject(error: any): any` | Sends an error. If a consumer is awaiting, rejects its promise. Error is sticky -- once set, all future iterations throw. |
| `stop` | `stop(): void` | Terminates the async iterator by calling `return(undefined)` on the internal generator |

### Behavior

- **On each iteration (`next()`):** If `last_value` is set, yields it immediately without creating a new promise. If `last_error` is set, throws it. Otherwise, creates a new promise and awaits it until a producer calls `resolve()` or `reject()`.
- **`resolve(value)`:** If a promise is pending (a consumer called `.next()` and is waiting), resolves it with the value. If no consumer is waiting, stores the value as `last_value` for the next `.next()` call.
- **`reject(error)`:** Stores the error. If a promise is pending, rejects it. The error is sticky -- once set, all future iterations throw the same error.
- **`stop()`:** Calls `return(undefined)` on the internal async iterator, ending iteration gracefully.

### Example: Producer-Consumer Signaling

```typescript
const signal = new WaitObject<string>("my-signal");

// Consumer (runs concurrently)
(async () => {
    for await (const value of signal) {
        console.log("Received:", value);
    }
})();

// Producer
signal.resolve("first");   // Consumer logs: "Received: first"
signal.resolve("second");  // Consumer logs: "Received: second"
signal.stop();             // Consumer's for-await loop exits
```

### Example: One-Shot Await

```typescript
const ready = new WaitObject<boolean>("init-ready");

// In one context: wait for initialization
const result = await ready.wait();
console.log("Ready:", result.value); // true

// In another context: signal that init is complete
ready.resolve(true);
```

### Use Cases

- **Signaling between producers and consumers** -- e.g., `ResourceCapacitySource` signals on release so waiting tasks can re-check availability.
- **Bridging push and pull models** -- `PushPostSignalObj` resolves a WaitObject after each push; `PullAwaitReset` awaits a WaitObject before draining its source.
- **Coordinating async state transitions** -- gate a pipeline stage until an external condition is met.

---

## AsyncIteratorCombiner

**`class AsyncIteratorCombiner<Sources, OUT>`**

Low-level utility for combining multiple async iterators into a single stream. Used internally by `PullObjManyTo1Link` subclasses (`PullRaceObj`, `PullRoundRobinObj`, etc.). Exposes instance methods for consuming source values in various patterns.

### Type Parameters

```typescript
class AsyncIteratorCombiner<
    Sources extends readonly AsyncIterator<any, any>[],
    OUT = UnionYieldAndReturnTypesFromIteratorTuple<Sources>
>
```

### Constructor

```typescript
constructor(...sources: [...Sources])
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` (getter) | Number of currently active (non-exhausted) sources |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `check_close` | `check_close(sop: SourceOutcomePair): SourceResultPair` | Checks whether an outcome is a successful result or an error. Removes exhausted sources from the active set. |

### Instance Methods

These methods operate on the combiner's set of active source iterators:

#### race_generator

```typescript
async* race_generator(yield_final_values?: boolean): AsyncGenerator<OUT>
```

Yields from whichever source produces a value first each round. When a source is exhausted, it is removed. Iteration ends when all sources are exhausted.

#### round_robin_generator

```typescript
async* round_robin_generator(yield_final_values?: boolean): AsyncGenerator<OUT>
```

Takes one value from each source in rotation. When a source is exhausted, it is removed from the rotation. Iteration ends when all sources are exhausted.

#### all

```typescript
async all(yield_final_values?: boolean): Promise<Array<OUT>>
```

Waits for all sources to yield one value each. Returns an array of results in source order. Similar to `Promise.all` but for async iterators.

#### race

```typescript
async race(yield_final_values?: boolean, discard_round?: boolean): Promise<OUT>
```

Returns the first successfully resolved value from any source. If the resolved source is done and `yield_final_values` is false, continues racing the remaining sources.

#### any

```typescript
async any(yield_final_values?: boolean, discard_round?: boolean): Promise<OUT>
```

Gets the first successfully resolved value following `Promise.any()` semantics. Errors from individual sources are collected but ignored until either a success is found or all sources fail.

### Type Helpers

These utility types are exported alongside `AsyncIteratorCombiner`:

| Type | Description |
|------|-------------|
| `TupleToUnion<T>` | Converts a tuple type to a union of its element types |
| `AsyncIteratorYieldType<I>` | Extracts `T` from `AsyncIterator<T, TReturn>` |
| `AsyncIteratorReturnType<I>` | Extracts `TReturn` from `AsyncIterator<T, TReturn>` |
| `AsyncIteratorYieldAndReturnTypes<I>` | Union of both `T` and `TReturn` |
| `UnionYieldTypesFromIteratorTuple<Tuple>` | Union of yield types from a tuple of iterators |
| `UnionReturnTypeFromIteratorTuple<Tuple>` | Union of return types from a tuple of iterators |

---

## Push-Pull Bridges

These classes bridge the push and pull models, allowing a push-mode producer to feed a pull-mode consumer (or vice versa). They use `WaitObject` internally to signal between the two sides.

### PushPullObj\<IN, OUT\>

**`class PushPullObj<IN, OUT = IN>`**

The base bridge class. Wraps an existing `PushObj` sink and `PullObj` source with WaitObject-based signaling so that pushes into the sink wake up the pull-side consumer.

#### Constructor

```typescript
constructor(sink: PushObj<IN>, source: PullObj<OUT> & Peekable<OUT>)
```

The constructor wraps the provided objects internally:
- The **sink** is wrapped in `PushPostSignalObj`, which resolves a shared `WaitObject` after each push.
- The **source** is wrapped in `PullAwaitReset`, which awaits the same `WaitObject` when the source is exhausted, then retries.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `sink` | `PushObj<IN>` | The wrapped push sink. Push values into this side. |
| `source` | `PullObj<OUT> & Peekable<OUT>` | The wrapped pull source. Pull values from this side. |

---

### PushPullBufferObj\<T\>

**`class PushPullBufferObj<T> extends PushPullObj<T>`**

A concrete bridge with an internal buffer array. Push values in via `sink`, pull them out via `source`. When the buffer is empty, the pull side blocks until new values are pushed.

#### Constructor

```typescript
constructor(buffer?: Array<T>)  // defaults to a new empty array
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): T \| undefined` | Returns the next value that would be pulled (`buffer[0]`) without removing it |

#### Internal Wiring

- **Push side:** Uses `SinkCollectObj` to append pushed values to the buffer array.
- **Pull side:** Uses `SourceBufferObj` to shift values from the buffer array (FIFO).
- **Signaling:** A `WaitObject` wakes up the pull side whenever a value is pushed, so the consumer resumes automatically.

#### Example: Dynamic Work Queue

```typescript
const queue = new PushPullBufferObj<string>();

// Producer pushes work items
await queue.sink.next("task-1");
await queue.sink.next("task-2");
await queue.sink.next("task-3");

// Consumer pulls work items (in a separate async context)
(async () => {
    for await (const task of queue.source) {
        console.log("Processing:", task);
        // "Processing: task-1", "Processing: task-2", "Processing: task-3"
    }
})();

// Push more items later -- the consumer picks them up automatically
await queue.sink.next("task-4");
```

#### Example: Decoupling Producer and Consumer

```typescript
const bridge = new PushPullBufferObj<number>();

// Wire the push side into a push pipeline
const pipeline = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => n * 10)
    .into(bridge.sink);

// Wire the pull side into a pull pipeline
const results = PullChain.from(bridge.source)
    .map(n => `result-${n}`);

// Push values in
await pipeline.next(5);    // 50 enters the buffer
await pipeline.next(-1);   // filtered out
await pipeline.next(3);    // 30 enters the buffer

// Pull values out
const first = await results.next();  // { value: "result-50", done: false }
const second = await results.next(); // { value: "result-30", done: false }
```

---

### PushPullBufferCacheObj\<T\>

**`class PushPullBufferCacheObj<T> extends PushPullObj<T, Array<T>>`**

A variant of `PushPullBufferObj` that yields the **entire buffer array** on each pull, rather than individual items. Uses `SourceCacheObj` instead of `SourceBufferObj` for the pull side.

#### Constructor

```typescript
constructor(buffer?: Array<T>)  // defaults to a new empty array
```

This is useful when the consumer needs to see the full accumulated state on each pull, rather than processing items one by one.

---

## CapacitySource (Legacy)

**`class CapacitySource implements Peekable<number>`**

> **Note:** `CapacitySource` is a legacy single-counter capacity manager. For new code, prefer `ResourceCapacitySource`, which supports named multi-resource capacity with atomic all-or-nothing acquisition. See the [Scheduling Reference](./scheduling.md).

Manages a simple integer capacity counter. Acquiring a unit decrements the counter; releasing increments it. Supports hierarchical parent-child chains where acquiring from a child also acquires from the parent.

### Constructor

```typescript
constructor(initialCapacity: number, parent?: CapacitySource)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `initialCapacity` | `number` | (required) | Maximum capacity units available |
| `parent` | `CapacitySource` | `undefined` | Optional parent. Acquire/release propagates up the chain. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `maxCapacity` | `number` (getter) | The initial capacity value set at construction |
| `currentCapacity` | `number` (getter) | How many units are currently available |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): number \| undefined` | Returns `currentCapacity` if capacity is available (both local and parent), otherwise `undefined` |
| `acquire` | `async acquire(): Promise<number>` | Acquires one capacity unit. Blocks (via WaitObject) if no capacity is available. Also acquires from the parent if one exists. Returns the new current capacity. |
| `release` | `async release(): Promise<void>` | Releases one capacity unit. Also releases from the parent if one exists. Signals waiting acquirers via WaitObject. |

### Key Differences from ResourceCapacitySource

| Aspect | CapacitySource | ResourceCapacitySource |
|--------|---------------|----------------------|
| Resources | Single counter (always increments of 1) | Named multi-resource (e.g., `{ cpu: 4, gpu: 1 }`) |
| Acquire | Async, blocks until available | Synchronous `canAcquire()` check + `acquireImmediate()` |
| Atomicity | Single resource, no atomicity concern | Atomic all-or-nothing for multiple resources |
| Signaling | Internal WaitObject for blocking acquire | External WaitObject signaled on release |

### Helper Classes

- **`SourceCapacityObj`** -- A `PullObj` that yields capacity units. Each pull decrements the counter by one.
- **`SinkCapacityObj`** -- A `PushObj` that accepts capacity returns. Each push increments the counter by one.
- **`CapacityObj`** type: `{ capacity: number }`

These helpers integrate `CapacitySource` into pull and push pipelines, enabling capacity-gated stream processing.

---

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, pull vs push models, mutable configuration, and lifecycle
- [Pull Obj Classes](./pull-obj-classes.md) -- Source classes (`SourceBufferObj`, `SourceCacheObj`) and `PullAwaitReset` used by the bridges
- [Push Obj Classes](./push-obj-classes.md) -- Sink classes (`SinkCollectObj`, `PushPostSignalObj`) used by the bridges
- [PullChain API](./pull-chain.md) -- Fluent pull pipeline builder
- [PushChain API](./push-chain.md) -- Fluent push pipeline builder
- [Scheduling API](./scheduling.md) -- `ResourceCapacitySource`, `DependencyGraph`, and task scheduling
