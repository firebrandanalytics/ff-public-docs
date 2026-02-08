# PushChain API Reference

`PushChainBuilder` and `PushChain` provide fluent, type-safe construction and runtime management of push pipelines. The design follows a **two-phase pattern**: `PushChainBuilder` collects operations as an immutable recipe, and a terminal method builds the concrete `PushChain` by wiring the Obj instances backwards from the terminal sink. This backward construction is necessary because every push object requires a reference to its downstream sink at construction time. The resulting `PushChain` extends `PushObj` -- it *is* a push object, so you can use it anywhere a `PushObj` is expected.

## Import

```typescript
import { PushChainBuilder, PushChain, SinkCollectObj } from '@firebrandanalytics/shared-utils';
```

## Quick Example

```typescript
const buffer: string[] = [];
const sink = new SinkCollectObj<string>(buffer);

const chain = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => `item-${n}`)
    .into(sink);

await chain.next(3);   // "item-3" pushed to sink
await chain.next(-1);  // filtered out
await chain.next(7);   // "item-7" pushed to sink
await chain.return();

console.log(buffer); // ["item-3", "item-7"]
```

---

## PushChainBuilder

`PushChainBuilder<IN, OUT>` is an immutable builder. Every fluent method returns a **new** builder instance -- the original is never modified. `IN` tracks the type entering the first operation and `OUT` tracks the type leaving the last operation added so far.

### Creating a Builder

```typescript
static start<T>(): PushChainBuilder<T, T>
```

Creates a new builder with no operations. `IN` and `OUT` both start as `T`. You supply the concrete input type as the type parameter.

```typescript
const builder = PushChainBuilder.start<number>();
```

### Fluent Methods

Each fluent method appends an operation to the builder and returns a new `PushChainBuilder` with an updated `OUT` type.

| Method | Signature | Description |
|--------|-----------|-------------|
| `map` | `map<U>(fn: (t: OUT) => U): PushChainBuilder<IN, U>` | Transform each value |
| `flatMap` | `flatMap<U>(fn: (t: OUT) => U): PushChainBuilder<IN, U>` | Transform and flatten one level |
| `filter` | `filter(fn: (t: OUT) => boolean): PushChainBuilder<IN, OUT>` | Pass through values that satisfy the predicate |
| `reduce` | `reduce<U>(fn: (accum: U, i: OUT) => U, initial: U): PushChainBuilder<IN, U>` | Accumulate values; emits running accumulator on each input |
| `bufferReduce` | `bufferReduce<U>(reducer: (i: OUT) => Promise<AsyncIterable<U>>): PushChainBuilder<IN, U>` | Async transform that produces multiple output values per input |
| `window` | `window(size: number): PushChainBuilder<IN, OUT[]>` | Collect values into fixed-size arrays |
| `buffer` | `buffer(condition: (b: OUT[]) => boolean): PushChainBuilder<IN, OUT[]>` | Collect values until condition returns true, then flush |
| `flatten` | `flatten(): PushChainBuilder<IN, any>` | Flatten one level of nesting (e.g., arrays of arrays) |
| `serial` | `serial(): PushChainBuilder<IN, OUT>` | Serialize concurrent `next()` calls so downstream sees them one at a time |
| `preCallback` | `preCallback(...fns: Array<(i: OUT) => any>): PushChainBuilder<IN, OUT>` | Run side-effect callbacks *before* pushing to the next stage |
| `postCallback` | `postCallback(...fns: Array<(i: OUT) => any>): PushChainBuilder<IN, OUT>` | Run side-effect callbacks *after* pushing to the next stage |

#### map

Applies a synchronous transform to each value. The output type changes to whatever `fn` returns.

```typescript
PushChainBuilder.start<number>()
    .map(n => n.toString())   // PushChainBuilder<number, string>
    .into(stringSink);
```

#### flatMap

Like `map`, but if the transform returns an iterable or array, the contents are flattened one level into the downstream sink.

```typescript
PushChainBuilder.start<string>()
    .flatMap(s => s.split(','))   // each comma-separated token pushed individually
    .into(tokenSink);
```

#### filter

Only values for which `fn` returns `true` are pushed downstream. Filtered-out values are silently dropped.

```typescript
PushChainBuilder.start<number>()
    .filter(n => n % 2 === 0)
    .into(evenSink);
```

#### reduce

Maintains a running accumulator. Each time a value arrives, the reducer runs and the new accumulator is pushed downstream.

```typescript
PushChainBuilder.start<number>()
    .reduce((sum, n) => sum + n, 0)   // emits running total: 1, 3, 6, 10, ...
    .into(totalSink);
```

#### bufferReduce

An async reducer that returns an `AsyncIterable`. For each input value, the reducer produces zero or more output values that are each pushed downstream individually. Useful for operations that expand a single input into a stream (e.g., chunked API responses).

```typescript
PushChainBuilder.start<string>()
    .bufferReduce(async function*(query) {
        for await (const page of fetchPages(query)) {
            yield page;
        }
    })
    .into(pageSink);
```

#### window

Collects values into fixed-size arrays. The array is pushed downstream once it reaches `size` elements. A partial window is flushed on `return()`.

```typescript
PushChainBuilder.start<number>()
    .window(3)            // [1,2,3], [4,5,6], ...
    .into(batchSink);
```

#### windowTimeout

Groups items into arrays, flushing on count **OR** timeout (whichever comes first). Uses `PushWindowTimeoutObj` under the hood.

```typescript
PushChainBuilder.start<Event>()
    .windowTimeout(100, 500)  // batch ≤ 100 items, flush at least every 500ms
    .into(batchSink);
```

#### buffer

Collects values into an internal array. After each value is added, `condition` is called with the current buffer. If it returns `true`, the buffer is flushed downstream and reset.

```typescript
PushChainBuilder.start<LogEntry>()
    .buffer(entries => entries.length >= 100 || totalSize(entries) > 1_000_000)
    .into(batchWriteSink);
```

#### flatten

Flattens one level of nesting. If a value is an array or iterable, each element is pushed individually.

```typescript
PushChainBuilder.start<number[]>()
    .flatten()            // individual numbers
    .into(numberSink);
```

#### serial

Wraps the downstream portion of the pipeline so that concurrent `next()` calls are serialized. By default, push objects process `next()` calls concurrently. Use `serial()` when ordering or mutual exclusion matters.

```typescript
PushChainBuilder.start<DbRecord>()
    .serial()             // one record at a time from here on
    .map(record => transform(record))
    .into(dbSink);
```

#### preCallback / postCallback

Attach side-effect callbacks that run before or after the value is pushed to the next stage. The value itself is not modified. Multiple callbacks can be passed and they all execute.

```typescript
PushChainBuilder.start<Request>()
    .preCallback(
        req => console.log('Processing:', req.id),
        req => metrics.increment('requests'),
    )
    .map(req => handleRequest(req))
    .postCallback(res => console.log('Done:', res.status))
    .into(responseSink);
```

### Escape Hatch: pipe()

```typescript
pipe<U>(factory: (sink: PushObj<U>) => PushObj<OUT>): PushChainBuilder<IN, U>
```

Integrates a custom `PushObj` class that the built-in fluent methods do not cover. You provide a factory function that receives the downstream sink and returns a `PushObj` that accepts the current `OUT` type.

The factory follows the same backward-construction pattern used internally: you receive the sink and return the operator that feeds into it.

```typescript
class MyCustomPushObj extends PushObj1To1<string, number> {
    // custom logic...
}

PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .pipe<number>(sink => new MyCustomPushObj(sink, config))
    .into(numberSink);
```

### Terminal Methods

Terminal methods consume the builder and produce a `PushChain`. After calling a terminal method, the builder should be discarded (it has been consumed to produce the chain).

#### into

```typescript
into(sink: PushObj<OUT>): PushChain<IN>
```

The simplest terminal. Wires the pipeline into an existing `PushObj` sink.

```typescript
const sink = new SinkCollectObj<number>();

const chain = PushChainBuilder.start<number>()
    .map(n => n * 2)
    .into(sink);

await chain.next(5);
await chain.return();
console.log(sink.buffer); // [10]
```

#### fork

```typescript
fork(...branches: Array<(b: PushChainBuilder<OUT, OUT>) => PushChain<OUT>>): PushChain<IN>
```

**Broadcasts** every value to all branches. Each branch callback receives a **fresh** `PushChainBuilder<OUT, OUT>`, so each branch can independently add its own operations and terminate with its own sink. Every value that reaches the fork point is pushed into every branch.

```typescript
const chain = PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .fork(
        branch => branch.map(s => s.toUpperCase()).into(upperSink),
        branch => branch.map(s => s.toLowerCase()).into(lowerSink),
        branch => branch.into(rawSink),
    );

await chain.next("Hello");
// upperSink receives "HELLO"
// lowerSink receives "hello"
// rawSink receives "Hello"
```

#### distribute

```typescript
distribute(
    selector: (i: OUT) => number,
    ...branches: Array<(b: PushChainBuilder<OUT, OUT>) => PushChain<OUT>>
): PushChain<IN>
```

**Routes** each value to exactly one branch, chosen by `selector`. The selector returns a branch index (0-based). Each branch callback receives a fresh builder.

```typescript
const chain = PushChainBuilder.start<LogEvent>()
    .distribute(
        event => event.level === 'error' ? 0 : 1,
        branch => branch.into(errorSink),    // index 0: errors
        branch => branch.into(infoSink),     // index 1: everything else
    );

await chain.next({ level: 'error', msg: 'fail' });   // -> errorSink
await chain.next({ level: 'info', msg: 'ok' });       // -> infoSink
```

#### roundRobinTo

```typescript
roundRobinTo(...branches: Array<(b: PushChainBuilder<OUT, OUT>) => PushChain<OUT>>): PushChain<IN>
```

Distributes values to branches in **round-robin** order, cycling through them. Useful for load balancing across multiple consumers.

```typescript
const chain = PushChainBuilder.start<Job>()
    .roundRobinTo(
        branch => branch.into(worker1),
        branch => branch.into(worker2),
        branch => branch.into(worker3),
    );

await chain.next(jobA);  // -> worker1
await chain.next(jobB);  // -> worker2
await chain.next(jobC);  // -> worker3
await chain.next(jobD);  // -> worker1 (cycles back)
```

#### toCallbacks

```typescript
toCallbacks(...callbacks: Array<(i: OUT) => any>): PushChain<IN>
```

Convenience terminal that creates sink(s) from plain callback functions. Each value is passed to every callback.

```typescript
const chain = PushChainBuilder.start<number>()
    .map(n => n * 2)
    .toCallbacks(
        n => console.log('Value:', n),
        n => analytics.track(n),
    );

await chain.next(5);  // logs "Value: 10", tracks 10
```

#### toArray

```typescript
toArray(buffer?: OUT[]): { chain: PushChain<IN>, buffer: OUT[] }
```

Convenience terminal that collects values into an array. Returns both the chain and the buffer. If you provide an existing array, values are appended to it; otherwise a new array is created.

```typescript
const { chain, buffer } = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .toArray();

await chain.next(3);
await chain.next(-1);
await chain.next(7);
await chain.return();

console.log(buffer); // [3, 7]
```

---

## PushChain

`PushChain<T>` extends `PushObj<T>`. It wraps an ordered array of linked `PushObj` instances and delegates `next()`, `return()`, and `throw()` to the head of the chain. It is the runtime representation of the pipeline you built with `PushChainBuilder`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `head` | `PushObj<T>` | The first (entry-point) object in the chain. Values pushed into the chain enter here. |
| `tail` | `PushObj<any>` | The last object in the chain (the terminal sink). |
| `links` | `ReadonlyArray<PushObj<any>>` | The full ordered array of linked objects, from head to tail. |
| `length` | `number` | The number of objects in the chain. |

```typescript
const { chain } = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => n * 2)
    .toArray();

console.log(chain.length);  // 3 (filter -> map -> collect sink)
console.log(chain.head);    // the PushFilterObj
console.log(chain.tail);    // the SinkCollectObj
```

### Pushing Values

`PushChain` delegates to its `head` object:

```typescript
// Push a value through the pipeline
await chain.next(value);

// Signal completion (propagates through all links)
await chain.return();

// Signal an error (propagates through all links)
await chain.throw(new Error('something went wrong'));
```

Each method returns `Promise<IteratorResult<void>>`. The `done` flag on the result reflects whether the head has been closed. Once a chain's head is done, subsequent `next()` calls are no-ops.

**Done propagation:** When the head object's generator completes (e.g., after `return()` is called), the chain's done state updates accordingly. Downstream objects also receive the `return()` signal so the entire pipeline shuts down cleanly.

### Dynamic Mutation

Unlike `PullChain`, which returns a new chain instance on mutation, `PushChain` mutates **in place**. This is because push objects hold forward references to their sinks -- inserting or removing a link requires rewiring the sink reference on the preceding object, which is done automatically.

#### insertAfter

```typescript
insertAfter(index: number, link: PushObj1To1<any, any>): void
```

Inserts a new link after the object at `index`. The new link's sink is set to whatever the object at `index` was previously pointing to, and the object at `index` is rewired to point to the new link.

```typescript
const debugLogger = new PushPreCallbacksObj(sink, (v) => console.log('debug:', v));
chain.insertAfter(0, debugLogger);  // insert after the first link
```

#### insertBefore

```typescript
insertBefore(index: number, link: PushObj1To1<any, any>): void
```

Inserts a new link before the object at `index`. The preceding object (if any) is rewired to point to the new link, and the new link's sink is set to the object at `index`.

```typescript
chain.insertBefore(1, validationObj);  // insert before index 1
```

#### remove

```typescript
remove(index: number): void
```

Removes the link at `index` and rewires the preceding link to point to the link that followed the removed one.

```typescript
chain.remove(1);  // remove the second link, rewire first -> third
```

#### replace

```typescript
replace(index: number, link: PushObj1To1<any, any>): void
```

Replaces the link at `index` with a new one. The new link inherits the same position in the chain: the preceding link's sink is rewired to the replacement, and the replacement's sink is set to the link that followed the original.

```typescript
const betterFilter = new PushFilterObj(null, improvedPredicate);
chain.replace(0, betterFilter);  // swap out the first link
```

---

## Key Design Differences from PullChain

| Aspect | PushChain | PullChain |
|--------|-----------|-----------|
| **Mutation** | In place (`insertAfter`, `remove`, etc. modify the chain) | Returns a new chain (old chain is marked consumed) |
| **Builder** | Immutable -- each fluent call returns a new `PushChainBuilder` | No separate builder -- `PullChain` itself is fluent |
| **Build direction** | Backwards from terminal sink | Forwards from source |
| **Branching** | Built-in branching terminals (`fork`, `distribute`, `roundRobinTo`) for one-to-many | Mid-chain merge methods for many-to-one |
| **Data flow** | Producer pushes values in via `next()` | Consumer pulls values out via `next()` / `for await` |

---

## See Also

- [Conceptual Guide](../concepts.md) -- core design philosophy, pull vs push models, Obj pattern
- [Push Obj Classes](./push-obj-classes.md) -- `PushObj`, `PushObj1To1`, `PushForkObj`, `PushDistributeObj`, `PushRoundRobinObj`, and all transforms
- [PullChain API](./pull-chain.md) -- the pull-side counterpart: fluent pull pipelines, factories, terminals, dynamic mutation
