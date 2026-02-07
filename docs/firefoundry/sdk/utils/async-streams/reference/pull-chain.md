# PullChain API Reference

`PullChain<T>` is the fluent pipeline builder for the pull (lazy, convergent) side of the async streams library. It extends `PullObj<T>`, which means a `PullChain` is itself a valid pull source -- you can pass it anywhere a `PullObj` is expected, nest it inside another chain, or consume it directly with `for await...of`. Internally, a chain manages an ordered array of `PullObj` links. Each fluent method appends a new link, and calls to `next()` are delegated straight through to the pipeline's tail. A consumed-chain safety mechanism prevents a common class of shared-iterator bugs by marking old chain references as unusable after they have been extended.

---

## Import & Quick Example

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x % 2 === 0)
    .map(x => x * 10)
    .collect();
// [20, 40]
```

---

## Static Factories

### `PullChain.from(source)`

```typescript
static from<T>(source: PullObj<T>): PullChain<T>
```

Wraps any `PullObj` in a chain so you can use the fluent API. This is the standard entry point.

```typescript
const source = new SourceBufferObj(['a', 'b', 'c']);
const chain = PullChain.from(source);
const first = await chain.first(); // 'a'
```

### `PullChain.concat(...sources)`

```typescript
static concat<T>(...sources: PullObj<T>[]): PullChain<T>
```

Creates a chain that exhausts each source in order. The second source is not pulled from until the first is done, and so on.

```typescript
const a = new SourceBufferObj([1, 2]);
const b = new SourceBufferObj([3, 4]);

const result = await PullChain.concat(a, b).collect();
// [1, 2, 3, 4]
```

### `PullChain.race(...sources)`

```typescript
static race<T>(...sources: PullObj<T>[]): PullChain<any>
```

Creates a chain that yields from whichever source produces a value first. All sources are polled concurrently on each pull, and the fastest response wins. Each yielded value is an `AttributedResult` containing `{ source, result }`, where `source` is the iterator that produced the value and `result` is the `IteratorResult`.

```typescript
const fast = new SourceBufferObj([1, 2, 3]);
const slow = new SourceBufferObj([10, 20, 30]);

const chain = PullChain.race(fast, slow);
for await (const { source, result } of chain) {
    console.log(result.value); // interleaved, fastest-first order
}
```

### `PullChain.roundRobin(...sources)`

```typescript
static roundRobin<T>(...sources: PullObj<T>[]): PullChain<T>
```

Creates a chain that takes one value from each source in rotation. If a source is exhausted, it is skipped. This ensures fair consumption across sources.

```typescript
const a = new SourceBufferObj([1, 2, 3]);
const b = new SourceBufferObj([10, 20]);

const result = await PullChain.roundRobin(a, b).collect();
// [1, 10, 2, 20, 3]
```

### `PullChain.zip(...sources)`

```typescript
static zip<T>(...sources: PullObj<T>[]): PullChain<Array<T>>
```

Creates a chain that pulls one value from every source on each iteration, yielding them as a tuple (array). The chain continues while **any** source remains active. When a source is exhausted, it is removed from the combiner, and subsequent tuples contain values only from the remaining sources.

```typescript
const names  = new SourceBufferObj(['Alice', 'Bob']);
const scores = new SourceBufferObj([95, 87]);

const result = await PullChain.zip(names, scores).collect();
// [['Alice', 95], ['Bob', 87]]
```

---

## Fluent Transform Methods

These methods each append a new link to the pipeline and return a new `PullChain`. The previous chain reference is consumed (see [Consumed-Chain Safety](#consumed-chain-safety)).

### Summary Table

| Method | Signature | Description |
|--------|-----------|-------------|
| `map` | `map<U>(fn: (t: T) => U): PullChain<U>` | Transform each value |
| `flatMap` | `flatMap<U>(fn: (t: T) => AsyncGenerator<U>): PullChain<U>` | Transform each value into zero or more values |
| `filter` | `filter(fn: ((t: T) => boolean) \| ((t: T) => Promise<boolean>)): PullChain<T>` | Keep values matching a predicate |
| `dedupe` | `dedupe<K = T>(obj2id?: ((t: T) => K) \| string): PullChain<T>` | Remove consecutive or keyed duplicates |
| `reduce` | `reduce<U>(fn: ((n: T, a?: U) => U) \| ((n: T, a?: U) => Promise<U>), accum?: U): PullChain<U>` | Running accumulation |
| `window` | `window(size: number): PullChain<T[]>` | Collect fixed-size sliding windows |
| `buffer` | `buffer(condition: ((buf: T[]) => boolean) \| ((buf: T[]) => Promise<boolean>)): PullChain<T[]>` | Collect until a condition is met, then flush |
| `bufferReduce` | `bufferReduce<U>(reducer: (val: T) => Generator<U>): PullChain<U>` | Synchronous generator-based buffer transform |
| `flatten` | `flatten(): PullChain<any>` | Flatten nested iterables one level |
| `eager` | `eager(bufferSize?: number): PullChain<T>` | Pre-fetch into a buffer for concurrency |
| `callback` | `callback(...fns: Array<(t: T) => any>): PullChain<T>` | Side-effect callbacks on each value |
| `timeout` | `timeout(ms: number, throwOnTimeout?: boolean): PullChain<T>` | Time-limit each pull |
| `inOrder` | `inOrder(obj2index: ((o: T) => number) \| string, start?: number): PullChain<T>` | Reorder out-of-order values by index |

---

### `map`

```typescript
map<U>(fn: (t: T) => U): PullChain<U>
```

Applies a synchronous transform to each value. The return type of the chain changes to match the function's return type.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x.toString())
    .collect();
// ['1', '2', '3']
```

### `flatMap`

```typescript
flatMap<U>(fn: (t: T) => AsyncGenerator<U>): PullChain<U>
```

For each input value, calls a function that returns an `AsyncGenerator`. All yielded values from that generator are emitted downstream before the next input value is pulled. This is the standard way to expand one input into many outputs.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .flatMap(async function*(n) {
        for (let i = 0; i < n; i++) yield n;
    })
    .collect();
// [1, 2, 2, 3, 3, 3]
```

### `filter`

```typescript
filter(fn: ((t: T) => boolean) | ((t: T) => Promise<boolean>)): PullChain<T>
```

Keeps only values for which the predicate returns `true`. The predicate can be synchronous or asynchronous.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x > 3)
    .collect();
// [4, 5]
```

### `dedupe`

```typescript
dedupe<K = T>(obj2id?: ((t: T) => K) | string): PullChain<T>
```

Removes duplicate values from the stream. With no arguments, uses strict equality on the values themselves. Pass a key-extraction function or a property name string to deduplicate by a derived key.

```typescript
// Simple value deduplication
const result = await PullChain.from(new SourceBufferObj([1, 1, 2, 2, 3]))
    .dedupe()
    .collect();
// [1, 2, 3]

// Deduplicate objects by a property
const users = new SourceBufferObj([
    { id: 1, name: 'Alice' },
    { id: 1, name: 'Alice (dup)' },
    { id: 2, name: 'Bob' },
]);
const unique = await PullChain.from(users)
    .dedupe('id')
    .collect();
// [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
```

### `reduce`

```typescript
reduce<U>(
    fn: ((n: T, a?: U) => U) | ((n: T, a?: U) => Promise<U>),
    accum?: U
): PullChain<U>
```

Applies a running reduction. Unlike `Array.prototype.reduce`, this is a streaming operator -- it yields the accumulator after every input value, not just a single final result. The reducer receives the current value and the accumulator (which is `undefined` on the first call if no initial `accum` is provided).

```typescript
const sums = await PullChain.from(new SourceBufferObj([1, 2, 3, 4]))
    .reduce((n, acc) => (acc ?? 0) + n, 0)
    .collect();
// [1, 3, 6, 10]
```

### `window`

```typescript
window(size: number): PullChain<T[]>
```

Collects values into fixed-size arrays (windows). Each time `size` values have been accumulated, the window is yielded downstream. When the source ends, any trailing partial window is returned as the generator's **return value** (not yielded). This means `collect()` does **not** include the partial window.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .window(2)
    .collect();
// [[1, 2], [3, 4]]  -- the trailing [5] is the generator return value, not yielded
```

### `windowTimeout`

```typescript
windowTimeout(size: number, timeoutMs: number): PullChain<T[]>
```

Groups items into arrays, flushing on count **OR** timeout (whichever comes first). When `size` items accumulate, the batch is yielded immediately. If `timeoutMs` elapses before the batch fills, the partial batch is yielded. Unlike `window`, partial batches on source exhaustion are yielded (visible to `collect()`), so no data is lost.

```typescript
const result = await PullChain.from(source)
    .windowTimeout(100, 200) // batch ≤ 100 items, flush at least every 200ms
    .collect();
```

### `buffer`

```typescript
buffer(
    condition: ((buf: T[]) => boolean) | ((buf: T[]) => Promise<boolean>)
): PullChain<T[]>
```

Accumulates values in an internal buffer and yields the buffer contents each time the condition function returns `true`. The condition receives the current buffer and decides when to flush. This is more flexible than `window` -- for example, you can flush based on total byte size or elapsed time. When the source ends, if the remaining buffer satisfies the condition, it is returned as the generator's **return value** (not yielded), so `collect()` does **not** include it.

```typescript
// Flush when the buffer has 3 or more items
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .buffer(buf => buf.length >= 3)
    .collect();
// [[1, 2, 3]]  -- the trailing [4, 5] satisfies the condition, but is the return value, not yielded
```

### `bufferReduce`

```typescript
bufferReduce<U>(reducer: (val: T) => Generator<U>): PullChain<U>
```

A synchronous buffer-and-transform operator. For each input value, calls a **synchronous** `Generator` function. When the generator yields values, those are emitted downstream. When the generator returns without yielding, the value is effectively buffered internally (the generator's closure maintains state across calls). This is useful for parsing protocols or assembling multi-part messages.

```typescript
// Assemble pairs: yield a pair every two inputs
function* pairReducer(val: number): Generator<[number, number]> {
    // This is conceptual -- the actual state management
    // depends on the generator's closure across calls
}
```

### `flatten`

```typescript
flatten(): PullChain<any>
```

Flattens one level of nesting. If the upstream yields arrays or iterables, each element is emitted individually. Note that the return type is `PullChain<any>` -- use `as<U>()` afterward if you need to restore type information.

```typescript
const result = await PullChain.from(new SourceBufferObj([[1, 2], [3, 4], [5]]))
    .flatten()
    .collect();
// [1, 2, 3, 4, 5]
```

### `eager`

```typescript
eager(bufferSize?: number): PullChain<T>
```

Inserts a pre-fetch buffer into the pipeline. Upstream values are pulled eagerly and stored in an internal buffer (up to `bufferSize` entries). This decouples upstream production speed from downstream consumption speed and is particularly useful when upstream involves I/O latency. If `bufferSize` is omitted, a default buffer size is used.

```typescript
const chain = PullChain.from(networkSource)
    .eager(10)       // buffer up to 10 items ahead
    .map(parse)
    .filter(validate);
```

### `callback`

```typescript
callback(...fns: Array<(t: T) => any>): PullChain<T>
```

Executes one or more side-effect functions on each value, then passes the value through unchanged. Return values from the callbacks are ignored. Useful for logging, metrics, or debugging.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .callback(
        x => console.log('Processing:', x),
        x => metrics.increment('items_processed'),
    )
    .map(x => x * 2)
    .collect();
// Logs: Processing: 1, Processing: 2, Processing: 3
// result: [2, 4, 6]
```

### `timeout`

```typescript
timeout(ms: number, throwOnTimeout?: boolean): PullChain<T>
```

Adds a time limit to each individual pull from upstream. If the upstream does not produce a value within `ms` milliseconds, the behavior depends on `throwOnTimeout`:

- `throwOnTimeout = true` (or omitted): throws an error (`"PullTimeout timed out."`).
- `throwOnTimeout = false`: the timed-out pull is skipped and the loop issues a new pull from the source immediately. The source's pending `next()` call is **not** cancelled -- it continues running in the background.

```typescript
const chain = PullChain.from(slowSource)
    .timeout(5000, false)   // skip pulls that take > 5 seconds, retry immediately
    .collect();
```

### `inOrder`

```typescript
inOrder(obj2index: ((o: T) => number) | string, start?: number): PullChain<T>
```

Reorders an out-of-order stream by a numeric index. Values arriving out of sequence are internally buffered until all preceding indices have been emitted. `obj2index` is a function returning the index for a value, or a string property name. `start` defaults to `0`.

```typescript
// Items arrive out of order from parallel processing
const source = new SourceBufferObj([
    { seq: 2, data: 'c' },
    { seq: 0, data: 'a' },
    { seq: 1, data: 'b' },
]);

const result = await PullChain.from(source)
    .inOrder('seq', 0)
    .map(item => item.data)
    .collect();
// ['a', 'b', 'c']
```

---

## Escape Hatch: `pipe()`

```typescript
pipe<U>(factory: (source: PullObj<T>) => PullObj<U>): PullChain<U>
```

Integrates any custom `PullObj` subclass into the fluent chain. The factory function receives the current pipeline tail as its source and must return a new `PullObj` that pulls from it. This is the escape hatch for when the built-in transforms are not sufficient.

```typescript
class MyCustomObj extends PullObj1To1Link<string, number> {
    protected async* pull_impl() {
        for await (const val of this.source) {
            yield val.length * 2;
        }
    }
}

const result = await PullChain.from(new SourceBufferObj(['hi', 'hello']))
    .pipe(source => new MyCustomObj(source))
    .collect();
// [4, 10]
```

---

## Mid-Chain Merge

These methods merge additional sources into an existing chain. They **replace the tail** of the current chain with a many-to-1 combiner that includes both the current pipeline output and the provided sources.

### `mergeRace(...others)`

```typescript
mergeRace(...others: PullObj<any>[]): PullChain<any>
```

Merges additional sources using race-robin semantics (`PullRaceRobinObj`): within each round, sources race (fastest yielded first), but every source gets exactly one turn per round before the next round starts.

### `mergeRoundRobin(...others)`

```typescript
mergeRoundRobin(...others: PullObj<any>[]): PullChain<any>
```

Merges additional sources using round-robin rotation.

### `mergeConcat(...others)`

```typescript
mergeConcat(...others: PullObj<any>[]): PullChain<any>
```

Merges additional sources using sequential concatenation. The current chain's output is fully consumed first, then each additional source in order.

### Mid-Chain Merge Example

```typescript
const primary = new SourceBufferObj([1, 2, 3]);
const secondary = new SourceBufferObj([10, 20, 30]);

const result = await PullChain.from(primary)
    .map(x => x * 100)
    .mergeRace(secondary)    // merge secondary via race
    .map(x => x + 1)         // continue the chain after merge
    .collect();
// Values from both streams, interleaved by availability, each incremented by 1
```

Note that because the merge combiner handles heterogeneous sources, the return type is `PullChain<any>`. Use `as<U>()` to reassert the type if needed.

---

## Terminal Methods

Terminal methods consume the chain and return a result. After a terminal method completes, the chain is exhausted.

### `collect()`

```typescript
async collect(): Promise<T[]>
```

Pulls all values from the chain and returns them as an array.

```typescript
const values = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 2)
    .collect();
// [2, 4, 6]
```

### `first()`

```typescript
async first(): Promise<T | undefined>
```

Pulls a single value from the chain and returns it. Returns `undefined` if the chain is empty. The chain is not fully consumed -- only one value is pulled.

```typescript
const value = await PullChain.from(new SourceBufferObj([10, 20, 30]))
    .first();
// 10
```

### `forEach(fn)`

```typescript
async forEach(fn: (t: T) => void | Promise<void>): Promise<void>
```

Pulls all values and calls `fn` on each one. The callback can be synchronous or asynchronous. Returns a promise that resolves when the chain is exhausted.

```typescript
await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .forEach(x => console.log(x));
// Logs: 1, 2, 3
```

### `for await...of`

Since `PullChain<T>` extends `PullObj<T>`, which implements `AsyncIterable<T>`, you can consume it directly with a standard `for await...of` loop.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 2);

for await (const value of chain) {
    console.log(value); // 2, 4, 6
}
```

---

## Dynamic Mutation

These methods modify the internal link structure of the chain at runtime. They **consume** the current chain and return a new one. Because the link array stores `PullObj<any>`, type information is lost after mutation -- use `as<U>()` to reassert the expected output type.

Dynamic mutation is an advanced feature intended for cases where the pipeline structure must change based on runtime conditions (e.g., feature flags, adaptive processing).

### `insertAfter(index, factory)`

```typescript
insertAfter(
    index: number,
    factory: (source: PullObj<any>) => PullObj<any>
): PullChain<any>
```

Inserts a new link after the link at `index`. The factory receives the current link at `index` as its source and must return a new `PullObj` that will be wired in between.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 2)
    .filter(x => x > 2);

// Insert a logging callback after the map (index 1)
const modified = chain
    .insertAfter(1, source => new PullCallbackObj(source, x => console.log('After map:', x)))
    .as<number>();
```

### `insertBefore(index, factory)`

```typescript
insertBefore(
    index: number,
    factory: (downstream: PullObj<any>) => PullObj<any>
): PullChain<any>
```

Inserts a new link before the link at `index`. The factory receives the current link at `index` as its downstream and must return a new `PullObj` to be wired in before it.

### `remove(index)`

```typescript
remove(index: number): PullChain<any>
```

Removes the link at `index` from the chain and re-wires the surrounding links. The chain's source (index 0) cannot be removed.

### `replace(index, factory)`

```typescript
replace(
    index: number,
    factory: (source: PullObj<any>) => PullObj<any>
): PullChain<any>
```

Replaces the link at `index` with a new one produced by the factory. The factory receives the source that fed the old link.

### `as<U>()`

```typescript
as<U>(): PullChain<U>
```

A type-only helper that reasserts the chain's output type. This performs no runtime transformation -- it exists solely to recover type information lost after dynamic mutation or mid-chain merges.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 2)
    .filter(x => x > 2);

// After dynamic mutation, type is PullChain<any>
const modified = chain
    .remove(2)
    .as<number>();   // reassert: PullChain<number>
```

---

## Introspection

These properties allow you to inspect the internal structure of the chain at runtime.

### `links`

```typescript
get links(): ReadonlyArray<PullObj<any>>
```

Returns the full ordered array of links in the chain as a read-only view.

### `length`

```typescript
get length(): number
```

Returns the number of links in the chain.

### `linkAt(index)`

```typescript
linkAt(index: number): PullObj<any>
```

Returns the link at a specific index. Index `0` is the head (source), and `length - 1` is the tail.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 2)
    .filter(x => x > 2);

console.log(chain.length);      // 3
console.log(chain.links);       // [SourceBufferObj, PullMapObj, PullFilterObj]
console.log(chain.linkAt(0));   // the SourceBufferObj instance
```

---

## Consumed-Chain Safety

When you call a fluent method on a chain (e.g., `.map()`, `.filter()`), the method creates a new `PullChain` with the additional link and marks the original chain as **consumed**. Any subsequent call to `next()`, `return()`, or `throw()` on the consumed chain throws an error.

```typescript
const chain1 = PullChain.from(new SourceBufferObj([1, 2, 3]));
const chain2 = chain1.map(x => x * 2);

// chain1 is now consumed
await chain1.next(); // Error: chain has been consumed

// chain2 is the active chain
await chain2.next(); // { value: 2, done: false }
```

**Why this matters:** Without consumed-chain safety, both `chain1` and `chain2` would share the same underlying source iterator. Pulling from `chain1` would advance the source, causing `chain2` to silently miss values. This is a common source of bugs in raw async iterator code. The consumed-chain mechanism turns this silent data loss into a loud, immediate error.

Dynamic mutation methods (`insertAfter`, `insertBefore`, `remove`, `replace`) also consume the original chain and return a new one.

---

## Done-Flag Sync

The `done` property of a `PullChain` is synchronized with the pipeline's tail link:

```typescript
override get done(): boolean {
    return this._done || (this._links.length > 0 && this.tail.done);
}
```

This means you can check `chain.done` at any time to see whether the pipeline has been exhausted. The chain reports done when either its own internal `_done` flag is set (e.g., after `close()`) or when the tail link of the pipeline reports done (meaning the last transform has no more data to yield).

```typescript
const chain = PullChain.from(new SourceBufferObj([1]));

console.log(chain.done); // false
await chain.next();      // { value: 1, done: false }
await chain.next();      // { value: undefined, done: true }
console.log(chain.done); // true
```

### Close Propagation

Calling `close()` performs a graceful shutdown of the entire pipeline (all links receive a `return()` signal). Calling `closeInterrupt()` performs an immediate shutdown (all links receive a `throw()` signal). Both methods propagate through the full link chain from tail to head.

---

## See Also

- [Conceptual Guide](../concepts.md) -- Core design philosophy, pull vs push models, the Obj pattern
- [Pull Obj Classes Reference](./pull-obj-classes.md) -- Individual PullObj classes: 12 transforms, 6 combiners, sources, labeled variants
- [Push Chain API Reference](./push-chain.md) -- The push-side counterpart: PushChainBuilder and PushChain
- [Utilities Reference](./utilities.md) -- WaitObject, AsyncIteratorCombiner, PushPullBufferObj
- [Pull Pipeline Basics Tutorial](../tutorials/pull-pipeline-basics.md) -- Step-by-step first pipeline
- [Combining Streams Tutorial](../tutorials/combining-streams.md) -- Race, round-robin, concat, zip, and mid-chain merge in depth
