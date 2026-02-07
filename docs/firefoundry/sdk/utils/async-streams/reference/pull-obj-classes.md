# Pull Obj Classes Reference

Complete API reference for all pull-based Obj classes in the async streams library. These classes implement lazy, demand-driven async iteration and compose into pipelines via single-source transforms and many-to-one combiners.

```typescript
import {
    PullObj, SourceObj, SourceCacheObj, SourceBufferObj,
    PullObj1To1Link, PullMapObj, PullFlatMapObj, PullFilterObj,
    PullDedupeObj, PullReduceObj, PullWindowObj, PullBufferObj,
    PullBufferReduceObj, PullInOrderObj, PullFlattenObj, PullEagerObj,
    PullCallbackObj, PullTimeoutObj, PullAwaitReset,
    PullObjManyTo1Link, PullObjLabeledManyTo1Link,
    PullConcatObj, PullZipObj, PullRoundRobinObj, PullRaceObj,
    PullRaceRobinObj, PullRaceCutoffObj,
    PullLabeledZipObj, PullLabeledRoundRobinObj,
    PullLabeledRaceObj, PullLabeledRaceRobinObj,
    PullTimerObj, PullPushBridgeObj, PullPushDistributeObj,
    BufferMode,
} from '@firebrandanalytics/shared-utils';
```

---

## Types and Enums

These types are used across multiple pull Obj classes.

```typescript
/** Extracts an identifier from an object. Used by dedupe and ordering classes. */
type Obj2ID<T, V> = (o: T) => V;

/** An object that supports non-consuming lookahead. */
interface Peekable<T> {
    peek: () => T | undefined;
}

/** Controls drain order for SourceBufferObj. */
enum BufferMode {
    FIFO,  // First in, first out (default)
    LIFO,  // Last in, first out (stack)
}

/** Wraps a result with a reference to which source produced it. Used by PullRaceObj. */
type AttributedResult<T, R = any> = {
    source: AsyncIterator<T>;
    result: IteratorResult<T, R>;
};

/** A value tagged with a key identifying its source. Used by labeled combiners. */
type LabeledValue<L, T> = {
    key: L;
    value: T;
};
```

---

## Base Classes

### PullObj\<T\>

The root base class for all pull-based iterables. Wraps an internal `AsyncGenerator` with lifecycle management, graceful shutdown, and automatic generator reinitialization.

**Implements:** `AsyncIterable<T>`

**Constructor:**

```typescript
constructor()
```

The constructor calls `pull_impl()` to create the internal generator. Subclasses override `pull_impl()` to define their iteration logic.

**Protected Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_done` | `boolean` | Whether the iterator has completed |
| `closing` | `boolean` | Whether a graceful shutdown has been requested |
| `generator` | `AsyncGenerator<T, T \| undefined, void> \| undefined` | The active internal generator |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `done` | `boolean` | No (getter) | Read-only accessor for `_done` |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `next` | `async next(): Promise<IteratorResult<T>>` | Pulls the next value from the internal generator |
| `return` | `async return(value?: T): Promise<IteratorResult<T>>` | Signals completion with an optional final value |
| `throw` | `async throw(error?: any): Promise<IteratorResult<T>>` | Throws an error into the generator |
| `close` | `close(): void` | Graceful shutdown: sets the `closing` flag so the generator finishes its current cycle and stops |
| `closeInterrupt` | `closeInterrupt(): void` | Immediate shutdown: sets `done = true` and clears the generator reference |
| `handle_result` | `protected handle_result(result: IteratorResult<T>): IteratorResult<T>` | Manages generator reinitialization when the current generator completes |

**Generator Reinitialization:**

When `pull_impl()` finishes (its generator returns), `handle_result` automatically re-creates the generator by calling `pull_impl()` again -- unless `closing` is set. This means Obj instances are **long-lived**: they can restart their iteration cycle indefinitely, picking up any configuration changes made between cycles.

```typescript
// PullObj is typically not used directly. Subclasses override pull_impl().
class MySource extends PullObj<number> {
    protected async *pull_impl() {
        yield 1;
        yield 2;
        // Generator completes here, but handle_result will reinit it.
        // Without close(), this source yields 1, 2, 1, 2, ... forever.
    }
}
```

---

### SourceObj\<T\>

Extends `PullObj<T>`. A no-op base class that marks a class as a source (the start of a pipeline with no upstream dependency). All source classes extend this.

```typescript
class SourceObj<T> extends PullObj<T> {}
```

---

### SourceCacheObj\<T\>

Extends `SourceObj<T>`. A source that holds a single cached value and yields it once per generator cycle. Because of generator reinitialization, it effectively yields its cache value repeatedly.

**Implements:** `Peekable<T>`

**Constructor:**

```typescript
constructor(cache: T)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `cache` | `T` | Yes | The cached value. Changing it mid-stream causes the new value to be yielded on the next cycle. |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): T \| undefined` | Returns the current cache value without consuming it |

```typescript
const source = new SourceCacheObj("hello");
const result = await source.next(); // { value: "hello", done: false }
source.cache = "world";
const next = await source.next();   // { value: "world", done: false }
```

---

### SourceBufferObj\<T\>

Extends `SourceObj<T>`. A source that drains values from an internal array buffer. Supports FIFO and LIFO drain order, and an optional one-shot mode that auto-closes after the buffer empties.

**Implements:** `Peekable<T>`

**Constructor:**

```typescript
constructor(buffer?: Array<T>, one_shot: boolean = false, mode: BufferMode = BufferMode.FIFO)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `buffer` | `undefined` | Initial buffer contents. If omitted, starts empty. |
| `one_shot` | `false` | If `true`, the source closes after draining. Sets `closing` in the constructor. |
| `mode` | `BufferMode.FIFO` | Drain order: `FIFO` uses `shift()`, `LIFO` uses `pop()`. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `buffer` | `Array<T>` | Yes | The internal buffer. You can push new items into it at any time, even while iterating. |
| `mode` | `BufferMode` | No (protected) | The drain order, set at construction. |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): T \| undefined` | Returns the next value that would be yielded without removing it |

```typescript
const source = new SourceBufferObj([10, 20, 30], true); // one-shot
for await (const value of source) {
    console.log(value); // 10, 20, 30
}
// Iteration ends after buffer is drained because one_shot = true.

const lifo = new SourceBufferObj([1, 2, 3], true, BufferMode.LIFO);
console.log((await lifo.next()).value); // 3
```

---

## 1-to-1 Transform Classes

These classes pull from a single upstream source, transform or filter the data, and yield the result. They all extend `PullObj1To1Link`.

### PullObj1To1Link\<IN, OUT=IN\>

Extends `PullObj<OUT>`. The base class for all single-source transforms.

**Constructor:**

```typescript
constructor(source: PullObj<IN>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | The upstream source. Can be swapped at runtime; the new source takes effect on the next `pull_impl()` cycle. |

**Lifecycle:**

`close()` and `closeInterrupt()` both propagate to the source, tearing down the upstream pipeline.

```typescript
// Typically used via subclasses, not directly.
const link = new PullMapObj(source, x => x * 2);
link.source = differentSource; // Swap source mid-stream
```

---

### PullAwaitReset\<T\>

Extends `PullObj1To1Link<T>`. Waits for a signal, drains the source completely, then waits for the next signal. Useful for batch-on-demand patterns where an external trigger controls when data flows.

**Implements:** `Peekable<T>`

**Constructor:**

```typescript
constructor(source: PullObj<T> & Peekable<T>, wait_obj: WaitObject<boolean>)
```

The source must implement `Peekable<T>` so the class can check whether data is available.

**Protected Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `wait_obj` | `WaitObject<boolean>` | The signal to wait on before each drain cycle |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): T \| undefined` | Delegates to the source's `peek()` |

```typescript
const buf = new SourceBufferObj([1, 2, 3]);
const signal = new WaitObject<boolean>("gate");
const gated = new PullAwaitReset(buf, signal);

// Nothing yields until signal fires
signal.resolve(true);
const val = await gated.next(); // { value: 1, done: false }
```

---

### PullMapObj\<IN, OUT\>

Extends `PullObj1To1Link<IN, OUT>`. Applies a synchronous transform function to each value.

**Constructor:**

```typescript
constructor(source: PullObj<IN>, transform: (i: IN) => OUT)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `transform` | `(i: IN) => OUT` | Yes | The mapping function. Changing it mid-stream affects all subsequent values immediately. |

```typescript
const source = new SourceBufferObj(["hello", "world"], true);
const upper = new PullMapObj(source, s => s.toUpperCase());

for await (const val of upper) {
    console.log(val); // "HELLO", "WORLD"
}
```

---

### PullFlatMapObj\<IN, OUT\>

Extends `PullObj1To1Link<IN, OUT>`. Applies an async generator transform to each input value, yielding all values produced by the generator before moving to the next input.

**Constructor:**

```typescript
constructor(source: PullObj<IN>, transform: (i: IN) => AsyncGenerator<OUT>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `transform` | `(i: IN) => AsyncGenerator<OUT>` | Yes | The flat-mapping function. Each input may produce zero or more outputs. |

```typescript
const source = new SourceBufferObj(["a,b", "c,d,e"], true);
const flat = new PullFlatMapObj(source, async function*(csv) {
    for (const part of csv.split(",")) {
        yield part;
    }
});

for await (const val of flat) {
    console.log(val); // "a", "b", "c", "d", "e"
}
```

---

### PullFilterObj\<T\>

Extends `PullObj1To1Link<T>`. Drops values that do not satisfy a predicate. Supports both synchronous and asynchronous predicates.

**Constructor:**

```typescript
constructor(
    source: PullObj<T>,
    filter: ((i: T) => boolean) | ((i: T) => Promise<boolean>)
)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `filter` | `((i: T) => boolean) \| ((i: T) => Promise<boolean>)` | Yes | The predicate function. Swap mid-stream to change filter criteria immediately. |

```typescript
const source = new SourceBufferObj([1, 2, 3, 4, 5, 6], true);
const evens = new PullFilterObj(source, n => n % 2 === 0);

for await (const val of evens) {
    console.log(val); // 2, 4, 6
}
```

---

### PullDedupeObj\<T, KEY = T\>

Extends `PullObj1To1Link<T>`. Removes duplicate values using a `Set`-based cache. Duplicates are identified by a key extractor, which can be a function or a property name string.

**Constructor:**

```typescript
constructor(
    source: PullObj<T>,
    obj2id?: Obj2ID<T, KEY> | string,
    cache?: Set<KEY>
)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `obj2id` | `undefined` | Key extractor. If a function, called with each value to produce a cache key. If a string, used as a property name (e.g., `"id"`). If omitted, the value itself is the key. |
| `cache` | `new Set()` | Pre-populated cache of already-seen keys. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `obj2id` | `Obj2ID<T, KEY> \| string \| undefined` | Yes | The key extractor. Can be changed mid-stream. |
| `cache` | `Set<KEY>` | Yes | The seen-keys cache. Clear it to reset deduplication state. |

```typescript
const source = new SourceBufferObj([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 1, name: "Alice (dup)" },
], true);
const deduped = new PullDedupeObj(source, "id");

for await (const val of deduped) {
    console.log(val.name); // "Alice", "Bob"
}
```

---

### PullReduceObj\<IN, OUT\>

Extends `PullObj1To1Link<IN, OUT>`. Applies a reducer to each input value, yielding each intermediate accumulator value. Supports both synchronous and asynchronous reducers.

**Constructor:**

```typescript
constructor(
    source: PullObj<IN>,
    reducer: ((n: IN, a?: OUT) => OUT) | ((n: IN, a?: OUT) => Promise<OUT>),
    accum?: OUT
)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `reducer` | `((n: IN, a?: OUT) => OUT) \| ((n: IN, a?: OUT) => Promise<OUT>)` | Yes | The reducer function. First argument is the new value, second is the current accumulator. |
| `accum` | `OUT \| undefined` | Yes | The current accumulator state. Readable to inspect intermediate state; writable to reset or seed. |

```typescript
const source = new SourceBufferObj([1, 2, 3, 4], true);
const running = new PullReduceObj(source, (n, a) => (a ?? 0) + n, 0);

for await (const sum of running) {
    console.log(sum); // 1, 3, 6, 10
}
```

---

### PullWindowObj\<IN\>

Extends `PullObj1To1Link<IN, Array<IN>>`. Collects input values into fixed-size arrays (windows). If the source ends mid-window, the partial window is returned as the generator's **return value** (not yielded). This means `collect()` does not include the trailing partial window.

**Constructor:**

```typescript
constructor(source: PullObj<IN>, window_size: number)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `window_size` | `number` | Yes | The number of items per window. Changing mid-stream affects the next window. |

```typescript
const source = new SourceBufferObj([1, 2, 3, 4, 5], true);
const windowed = new PullWindowObj(source, 2);

for await (const batch of windowed) {
    console.log(batch); // [1, 2], [3, 4]
}
// The trailing partial [5] is the generator's return value, not yielded
```

---

### PullBufferObj\<IN\>

Extends `PullObj1To1Link<IN, Array<IN>>`. Like `PullWindowObj`, but flushes based on a dynamic condition function rather than a fixed size. Supports both synchronous and asynchronous conditions.

**Constructor:**

```typescript
constructor(
    source: PullObj<IN>,
    condition: ((buf: Array<IN>) => Promise<boolean>) | ((buf: Array<IN>) => boolean)
)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `condition` | `((buf: Array<IN>) => Promise<boolean>) \| ((buf: Array<IN>) => boolean)` | Yes | Returns `true` when the buffer should be flushed. Called after each item is added. |

```typescript
const source = new SourceBufferObj([1, 2, 10, 3, 4, 20], true);
// Flush when buffer sum exceeds 10
const buffered = new PullBufferObj(source, buf =>
    buf.reduce((a, b) => a + b, 0) > 10
);

for await (const batch of buffered) {
    console.log(batch); // [1, 2, 10], [3, 4, 20]
}
```

---

### PullBufferReduceObj\<IN, OUT\>

Extends `PullObj1To1Link<IN, OUT>`. Applies a stateful synchronous generator reducer to each input value. The generator can yield zero or more output values per input, enabling accumulation patterns with controlled emission.

**Constructor:**

```typescript
constructor(source: PullObj<IN>, reducer: (val: IN) => Generator<OUT>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<IN>` | Yes | Inherited. The upstream source. |
| `reducer` | `(val: IN) => Generator<OUT>` | Yes | A synchronous generator function called for each input. Yields zero or more output values. |

```typescript
let count = 0;
const source = new SourceBufferObj([1, 2, 3, 4, 5, 6], true);
// Emit a batch of 3 items as a string every 3 inputs
const reducer = new PullBufferReduceObj(source, function*(val: number) {
    count++;
    if (count % 3 === 0) {
        yield `batch-${count / 3}`;
        count = 0;
    }
});
```

---

### PullInOrderObj\<T\>

Extends `PullObj1To1Link<T>`. Reorders out-of-sequence items by an integer index. Holds items in an internal cache until the expected next index arrives, then yields them in order.

**Constructor:**

```typescript
constructor(
    source: PullObj<T>,
    obj2index: ((o: T) => number) | string,
    start: number = 0,
    cache?: Map<number, T>
)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `obj2index` | (required) | Extracts a sequence index from each item. Can be a function or a property name string. |
| `start` | `0` | The first expected index. |
| `cache` | `new Map()` | Pre-populated out-of-order items. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `obj2index` | `((o: T) => number) \| string` | Yes | The index extractor. |
| `start` | `number` | Yes | The next expected index. Advances as items are yielded. |
| `cache` | `Map<number, T>` | Yes | Items received out of order, awaiting their turn. |

```typescript
const source = new SourceBufferObj([
    { seq: 2, data: "c" },
    { seq: 0, data: "a" },
    { seq: 1, data: "b" },
], true);
const ordered = new PullInOrderObj(source, "seq", 0);

for await (const item of ordered) {
    console.log(item.data); // "a", "b", "c"
}
```

---

### PullFlattenObj\<T\>

Extends `PullObj1To1Link<T | Generator<T> | AsyncGenerator<T>, T>`. Flattens nested synchronous and asynchronous generators. Plain values pass through unchanged; generator values are fully drained.

**Constructor:**

```typescript
constructor(source: PullObj<T | Generator<T> | AsyncGenerator<T>>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T \| Generator<T> \| AsyncGenerator<T>>` | Yes | Inherited. The upstream source. |

```typescript
const source = new SourceBufferObj<number | Generator<number>>([
    1,
    function*() { yield 2; yield 3; }(),
    4,
], true);
const flat = new PullFlattenObj(source);

for await (const val of flat) {
    console.log(val); // 1, 2, 3, 4
}
```

---

### PullEagerObj\<T\>

Extends `PullObj1To1Link<T>`. Pre-fetches the next values from the source before the consumer requests them, enabling parallelism between production and consumption.

**Constructor:**

```typescript
constructor(source: PullObj<T>, buffer_size: number = 1)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `buffer_size` | `number` | Yes | How many values to pre-fetch ahead. Changing mid-stream adjusts eagerness. |

```typescript
const source = new SourceBufferObj([1, 2, 3, 4, 5], true);
// Pre-fetch 2 items ahead for better throughput
const eager = new PullEagerObj(source, 2);

for await (const val of eager) {
    console.log(val); // 1, 2, 3, 4, 5 (same values, but fetched eagerly)
}
```

---

### PullCallbackObj\<T\>

Extends `PullObj1To1Link<T>`. Executes side-effect callbacks for each value without altering it. The value passes through unchanged.

**Constructor:**

```typescript
constructor(source: PullObj<T>, ...callbacks: Array<(i: T) => any>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `callbacks` | `Array<(i: T) => any>` | Yes | Array of side-effect functions. Add, remove, or replace callbacks mid-stream. |

```typescript
const source = new SourceBufferObj([1, 2, 3], true);
const logged = new PullCallbackObj(source,
    val => console.log("Processing:", val),
    val => metrics.increment("items_processed"),
);

for await (const val of logged) {
    // val is unchanged: 1, 2, 3
}
```

---

### PullTimeoutObj\<T\>

Extends `PullObj1To1Link<T>`. Wraps each pull from the upstream source with a timeout. If the source does not produce a value within the specified duration, the timeout triggers.

**Constructor:**

```typescript
constructor(source: PullObj<T>, time_out: number, throw_on_timeout: boolean = true)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `time_out` | (required) | Timeout duration in milliseconds. |
| `throw_on_timeout` | `true` | If `true`, throws an error on timeout. If `false`, the timed-out pull is skipped and a new pull is issued immediately (the loop continues). |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream source. |
| `time_out` | `number` | Yes | The timeout in milliseconds. Can be adjusted mid-stream. |
| `throw_on_timeout` | `boolean` | Yes | Whether to throw or silently skip on timeout. |

**Important:** After a timeout, the source's pending `next()` call is **not** cancelled. The source may still resolve later, and that value will be picked up by the subsequent pull. Design your pipeline accordingly if ordering matters.

```typescript
const slow = new SourceBufferObj<number>([], false); // empty, never yields
const timed = new PullTimeoutObj(slow, 1000, false);

// With throw_on_timeout=false, each timed-out pull is skipped
// and the loop immediately retries. The source's pending next()
// call is NOT cancelled -- it continues in the background.
```

---

## Many-to-1 Combiner Classes

These classes pull from multiple upstream sources and produce a single output stream. They all extend either `PullObjManyTo1Link` or `PullObjLabeledManyTo1Link`.

### PullObjManyTo1Link\<IN, OUT=IN\>

Extends `PullObj<OUT>`. The base class for all array-based many-to-one combiners.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<IN>>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<IN>>` | Yes | The upstream sources. Can be modified at runtime. |

**Lifecycle:**

`close()` and `closeInterrupt()` propagate to **all** sources in the array.

---

### PullObjLabeledManyTo1Link\<L, IN, OUT=IN\>

Extends `PullObj<OUT>`. The base class for all labeled many-to-one combiners. Sources are identified by keys of type `L`.

**Constructor:**

```typescript
constructor(labeled_sources: Map<L, PullObj<IN>>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `labeled_sources` | `Map<L, PullObj<IN>>` | Yes | The labeled upstream sources. |
| `sources` | `Iterable<PullObj<IN>>` | No (getter) | Convenience accessor that returns the map's values. |

---

### PullConcatObj\<T\>

Extends `PullObjManyTo1Link<T>`. Exhausts sources sequentially: drains the first source completely, then the second, and so on.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<T>>, options?: { eager?: boolean })
```

| Option | Default | Description |
|--------|---------|-------------|
| `eager` | `false` | If `true`, pre-fetches from the current source for better throughput. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<T>>` | Yes | Inherited. The sources to concatenate. |
| `eager` | `boolean` | No (readonly) | Whether eager pre-fetching is enabled. |

```typescript
const a = new SourceBufferObj([1, 2], true);
const b = new SourceBufferObj([3, 4], true);
const concat = new PullConcatObj([a, b]);

for await (const val of concat) {
    console.log(val); // 1, 2, 3, 4
}
```

---

### PullZipObj

Extends `PullObjManyTo1Link<any, Array<any>>`. Pairs corresponding items from each source into tuples. Continues while **any** source remains active. When a source is exhausted, it is removed, and subsequent tuples contain values only from the remaining sources.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<any>>, options?: { eager?: boolean })
```

| Option | Default | Description |
|--------|---------|-------------|
| `eager` | `false` | If `true`, pre-fetches from all sources in parallel. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<any>>` | Yes | Inherited. The sources to zip. |
| `eager` | `boolean` | No (readonly) | Whether eager pre-fetching is enabled. |

```typescript
const names = new SourceBufferObj(["Alice", "Bob", "Carol"], true);
const ages = new SourceBufferObj([30, 25, 35], true);
const zipped = new PullZipObj([names, ages]);

for await (const [name, age] of zipped) {
    console.log(`${name}: ${age}`); // "Alice: 30", "Bob: 25", "Carol: 35"
}
```

---

### PullRoundRobinObj

Extends `PullObjManyTo1Link<any>`. Takes one item from each source in rotation. When a source is exhausted, it can optionally yield the return value before removing it from rotation.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<any>>, options?: { yieldReturn?: boolean, eager?: boolean })
```

| Option | Default | Description |
|--------|---------|-------------|
| `yieldReturn` | `false` | If `true`, yields the return value of a source when it completes. |
| `eager` | `false` | If `true`, pre-fetches from the next source in rotation. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<any>>` | Yes | Inherited. The sources to rotate through. |
| `yieldReturn` | `boolean` | Yes | Whether to yield return values from exhausted sources. |
| `eager` | `boolean` | No (readonly) | Whether eager pre-fetching is enabled. |

```typescript
const a = new SourceBufferObj([1, 2, 3], true);
const b = new SourceBufferObj(["a", "b", "c"], true);
const robin = new PullRoundRobinObj([a, b]);

for await (const val of robin) {
    console.log(val); // 1, "a", 2, "b", 3, "c"
}
```

---

### PullRaceObj

Extends `PullObjManyTo1Link<any, AttributedResult<any>>`. Yields from whichever source resolves first. Each result is wrapped in an `AttributedResult` that includes a reference to the producing source.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<any>>, options?: { yieldReturn?: boolean, eager?: boolean })
```

| Option | Default | Description |
|--------|---------|-------------|
| `yieldReturn` | `false` | If `true`, yields the return value of a source when it completes. |
| `eager` | `false` | If `true`, pre-fetches from all sources concurrently. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<any>>` | Yes | Inherited. The sources to race. |
| `yieldReturn` | `boolean` | Yes | Whether to yield return values from exhausted sources. |
| `eager` | `boolean` | No (readonly) | Whether eager pre-fetching is enabled. |

```typescript
const fast = new SourceBufferObj([1, 2, 3], true);
const slow = new SourceBufferObj([10, 20], true);
const race = new PullRaceObj([fast, slow]);

for await (const { source, result } of race) {
    console.log(result.value);
    // Yields from whichever source resolves first each round
}
```

---

### PullRaceRobinObj

Extends `PullObjManyTo1Link<any>`. A hybrid of race and round-robin: within each round, sources race, but the winner is then rotated to the back. This prevents a fast source from dominating the output.

**Constructor:**

```typescript
constructor(sources: Array<PullObj<any>>, options?: { eager?: boolean })
```

| Option | Default | Description |
|--------|---------|-------------|
| `eager` | `false` | If `true`, pre-fetches from all sources concurrently. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<any>>` | Yes | Inherited. The sources to race-robin. |
| `eager` | `boolean` | No (readonly) | Whether eager pre-fetching is enabled. |

```typescript
const a = new SourceBufferObj([1, 2, 3], true);
const b = new SourceBufferObj([10, 20, 30], true);
const raceRobin = new PullRaceRobinObj([a, b]);

for await (const val of raceRobin) {
    console.log(val);
    // Fair interleaving: fast source cannot starve slow source
}
```

---

### PullRaceCutoffObj\<T, CO\>

Extends `PullObjManyTo1Link<T>`. Races the main sources against a cutoff signal each round. If the cutoff source resolves first, the round is terminated.

**Constructor:**

```typescript
constructor(
    sources: Array<PullObj<T>>,
    cutoff_source: PullObj<CO>,
    throw_on_cutoff: boolean = false
)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cutoff_source` | (required) | A source that, when it yields, signals a cutoff. |
| `throw_on_cutoff` | `false` | If `true`, throws on cutoff instead of ending silently. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sources` | `Array<PullObj<T>>` | Yes | Inherited. The main data sources. |
| `cutoff_source` | `PullObj<CO>` | Yes | The cutoff signal source. |
| `throw_on_cutoff` | `boolean` | Yes | Whether to throw on cutoff. |

```typescript
const data = new SourceBufferObj([1, 2, 3, 4, 5], true);
const timeout = new PullTimerObj(1000); // fires every 1s
const cutoff = new PullRaceCutoffObj([data], timeout);

for await (const val of cutoff) {
    console.log(val);
    // Yields data values, but if the timer fires first, the round cuts off
}
```

---

## Labeled Many-to-1 Combiner Classes

These combiners use `Map`-based labeled sources instead of arrays. Each output value is tagged with the key of the source that produced it.

### PullLabeledZipObj\<L\>

Extends `PullObjLabeledManyTo1Link<L, any, Map<L, any>>`. Collects one value from each labeled source per round and yields a `Map<L, any>` with one entry per source.

**Constructor:**

```typescript
constructor(labeled_sources: Map<L, PullObj<any>>)
```

```typescript
const sources = new Map<string, PullObj<any>>([
    ["name", new SourceBufferObj(["Alice", "Bob"], true)],
    ["age", new SourceBufferObj([30, 25], true)],
]);
const zipped = new PullLabeledZipObj(sources);

for await (const row of zipped) {
    console.log(row.get("name"), row.get("age"));
    // "Alice" 30, then "Bob" 25
}
```

---

### PullLabeledRoundRobinObj\<L\>

Extends `PullObjLabeledManyTo1Link<L, any, LabeledValue<L, any>>`. Rotates through labeled sources, yielding a `LabeledValue` containing the source key and value.

**Constructor:**

```typescript
constructor(labeled_sources: Map<L, PullObj<any>>)
```

```typescript
const sources = new Map<string, PullObj<any>>([
    ["sensor-a", new SourceBufferObj([100, 200], true)],
    ["sensor-b", new SourceBufferObj([10, 20], true)],
]);
const robin = new PullLabeledRoundRobinObj(sources);

for await (const { key, value } of robin) {
    console.log(`${key}: ${value}`);
    // "sensor-a: 100", "sensor-b: 10", "sensor-a: 200", "sensor-b: 20"
}
```

---

### PullLabeledRaceObj\<L\>

Extends `PullObjLabeledManyTo1Link<L, any, LabeledValue<L, any>>`. Races all labeled sources and yields a `LabeledValue` from whichever resolves first.

**Constructor:**

```typescript
constructor(labeled_sources: Map<L, PullObj<any>>)
```

```typescript
const sources = new Map<string, PullObj<any>>([
    ["fast", new SourceBufferObj([1, 2, 3], true)],
    ["slow", new SourceBufferObj([10, 20], true)],
]);
const race = new PullLabeledRaceObj(sources);

for await (const { key, value } of race) {
    console.log(`Winner: ${key} = ${value}`);
}
```

---

### PullLabeledRaceRobinObj\<L\>

Extends `PullObjLabeledManyTo1Link<L, any, LabeledValue<L, any>>`. Combines race and round-robin with labeled sources. The race winner is rotated to prevent domination by a single fast source.

**Constructor:**

```typescript
constructor(labeled_sources: Map<L, PullObj<any>>)
```

```typescript
const sources = new Map<string, PullObj<any>>([
    ["api-1", new SourceBufferObj([1, 2, 3], true)],
    ["api-2", new SourceBufferObj([10, 20, 30], true)],
]);
const raceRobin = new PullLabeledRaceRobinObj(sources);

for await (const { key, value } of raceRobin) {
    console.log(`${key}: ${value}`);
    // Fair interleaving across labeled sources
}
```

---

## Source and Bridge Classes

### PullTimerObj

Extends `SourceObj<Date | undefined>`. A source that yields at a regular interval. Never stops on its own -- must be closed explicitly.

**Constructor:**

```typescript
constructor(interval: number, generate_timestamp: boolean = false)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `interval` | (required) | Time between yields in milliseconds. |
| `generate_timestamp` | `false` | If `true`, yields a `Date` object. If `false`, yields `undefined`. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `interval` | `number` | Yes | Milliseconds between ticks. Changing mid-stream adjusts the next interval immediately. |
| `generate_timestamp` | `boolean` | Yes | Whether to include a timestamp in the yielded value. |

```typescript
const timer = new PullTimerObj(1000, true);

let count = 0;
for await (const timestamp of timer) {
    console.log(timestamp); // Date object every ~1s
    if (++count >= 5) {
        timer.close();
    }
}
```

---

### PullPushBridgeObj\<T\>

Extends `PullObj1To1Link<T>`. A T-junction that forwards pulled values to one or more push sinks (synchronous generators) while also yielding them to the pull consumer. Bridges the pull and push models.

**Constructor:**

```typescript
constructor(source: PullObj<T>, ...sinks: Array<Generator<T, void>>)
```

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream pull source. |
| `sinks` | `Array<Generator<T, void>>` | Yes | Push sinks to forward values to. Add or remove sinks mid-stream. |

```typescript
function* logSink(): Generator<string, void> {
    while (true) {
        const val = yield;
        console.log("Side channel:", val);
    }
}

const source = new SourceBufferObj(["a", "b", "c"], true);
const bridge = new PullPushBridgeObj(source, logSink());

for await (const val of bridge) {
    console.log("Main:", val);
    // Logs both "Side channel: a" and "Main: a" for each value
}
```

---

### PullPushDistributeObj\<T\>

Extends `PullObj1To1Link<T>`. Routes each pulled value to a specific named push sink based on a selector. The value also passes through to the pull consumer.

**Constructor:**

```typescript
constructor(
    source: PullObj<T>,
    sink_map: Map<string, Generator<unknown, void, T>>,
    obj2selector: ((o: T) => string) | string
)
```

| Parameter | Description |
|-----------|-------------|
| `sink_map` | A map from selector keys to push sink generators. |
| `obj2selector` | A function or property name that extracts the routing key from each value. |

**Public Properties:**

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `source` | `PullObj<T>` | Yes | Inherited. The upstream pull source. |
| `sink_map` | `Map<string, Generator<unknown, void, T>>` | Yes | Named push sinks. Can be modified mid-stream to add/remove routes. |
| `obj2selector` | `((o: T) => string) \| string` | Yes | Routing logic. Can be swapped mid-stream. |

```typescript
type Event = { type: string; data: string };

function* handler(): Generator<unknown, void, Event> {
    while (true) {
        const evt = yield;
        console.log("Handling:", evt.data);
    }
}

const sinks = new Map([
    ["error", handler()],
    ["info", handler()],
]);
const source = new SourceBufferObj<Event>([
    { type: "error", data: "fail" },
    { type: "info", data: "ok" },
], true);

const dist = new PullPushDistributeObj(source, sinks, "type");
for await (const evt of dist) {
    // Each event is routed to its matching sink AND yielded here
}
```

---

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, pull vs push models, mutable configuration, and lifecycle
- [PullChain API](./pull-chain.md) -- Fluent pipeline builder wrapping these classes
- [Push Obj Classes](./push-obj-classes.md) -- The push-side counterpart classes
