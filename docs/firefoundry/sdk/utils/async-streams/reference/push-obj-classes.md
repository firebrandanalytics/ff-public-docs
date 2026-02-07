# Push Obj Classes -- API Reference

Push-based async stream classes implement the eager, divergent processing model. A producer pushes values into the pipeline head via `next(value)`, and each stage forwards (or transforms, filters, fans out) to downstream sinks immediately. This is the symmetric opposite of the pull model: pull is lazy and convergent (many-to-one), push is eager and divergent (one-to-many).

For conceptual background, see the [Conceptual Guide](../concepts.md). For the fluent builder API that wraps these classes, see [PushChain API](./push-chain.md).

```typescript
import {
    PushObj, SinkCallbacksObj, SinkCollectObj,
    PushObj1To1, PushSerialObj, PushMapObj, PushFilterObj,
    PushReduceObj, PushBufferReduceObj, PushBufferObj, PushWindowObj,
    PushFlattenObj, PushFlatMapObj,
    PushPreCallbacksObj, PushPostCallbacksObj,
    PushPreSignalObj, PushPostSignalObj,
    PushForkObj, PushRoundRobinObj, PushDistributeObj,
    PushObjLabeled1ToMany, PushLabeledDistributeObj,
} from '@firebrandanalytics/shared-utils';
```

## Table of Contents

- [Base and Sink Classes](#base-and-sink-classes)
  - [PushObj](#pushobj)
  - [SinkCallbacksObj](#sinkcallbacksobj)
  - [SinkCollectObj](#sinkcollectobj)
- [1-to-1 Transform Classes](#1-to-1-transform-classes)
  - [PushObj1To1](#pushobj1to1)
  - [PushSerialObj](#pushserialobj)
  - [PushMapObj](#pushmapobj)
  - [PushFilterObj](#pushfilterobj)
  - [PushReduceObj](#pushreduceobj)
  - [PushBufferReduceObj](#pushbufferreduceobj)
  - [PushBufferObj](#pushbufferobj)
  - [PushWindowObj](#pushwindowobj)
  - [PushFlattenObj](#pushflattenobj)
  - [PushFlatMapObj](#pushflatmapobj)
  - [PushPreCallbacksObj](#pushprecallbacksobj)
  - [PushPostCallbacksObj](#pushpostcallbacksobj)
  - [PushPreSignalObj](#pushpresignalobj)
  - [PushPostSignalObj](#pushpostsignalobj)
- [1-to-Many Classes](#1-to-many-classes)
  - [PushObj1ToManyBase](#pushobj1tomanybase)
  - [PushObj1ToMany](#pushobj1tomany)
  - [PushForkObj](#pushforkobj)
  - [PushRoundRobinObj](#pushroundrobinobj)
  - [PushDistributeObj](#pushdistributeobj)
  - [PushObjLabeled1ToMany](#pushobjlabeled1tomany)
  - [PushLabeledDistributeObj](#pushlabeleddistributeobj)
- [Key Design Notes](#key-design-notes)
- [See Also](#see-also)

---

## Base and Sink Classes

### PushObj

**`class PushObj<T> implements AsyncGenerator<void, void, T>`**

Abstract base class for all push-based stream objects. Implements the `AsyncGenerator` protocol so that any `PushObj` can serve as a sink for upstream stages. Subclasses override `next_impl()` to define their forwarding behavior.

#### Constructor

```typescript
constructor(forward_errors: boolean = false, forward_close: boolean = false)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `forward_errors` | `boolean` | `false` | When `true`, `throw()` propagates to downstream sinks |
| `forward_close` | `boolean` | `false` | When `true`, `return()` propagates to downstream sinks |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `forward_errors` | `boolean` | No (protected) | Whether errors are forwarded downstream |
| `forward_close` | `boolean` | No (protected) | Whether close signals are forwarded downstream |
| `done` | `boolean` | No (protected) | `true` after `return()` or `throw()` has been called |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `next` | `next(i: T): Promise<IteratorResult<void>>` | Pushes a value into the pipeline. Returns `{done: false, value: undefined}` normally, or `{done: true}` if the pipeline has completed. |
| `return` | `return(): Promise<IteratorResult<void>>` | Signals graceful completion. Sets `done = true`. |
| `throw` | `throw(e: any): Promise<IteratorResult<void>>` | Signals an error. Sets `done = true`. |
| `next_impl` | `protected async next_impl(i: any): Promise<IteratorResult<void>>` | Override in subclasses to define per-value behavior. |

#### Example

```typescript
// PushObj is typically not used directly.
// Subclasses like SinkCollectObj or PushMapObj provide concrete behavior.
const sink = new SinkCollectObj<number>();
await sink.next(1);
await sink.next(2);
await sink.return();
console.log(sink.buffer); // [1, 2]
```

---

### SinkCallbacksObj

**`class SinkCallbacksObj<T> extends PushObj<T>`**

Terminal sink that executes an array of callback functions on each pushed value. Return values from callbacks are ignored. Useful for triggering side effects such as logging, metrics, or notifications at the end of a push pipeline.

#### Constructor

```typescript
constructor(...callbacks: Array<(i: T) => any>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `...callbacks` | `Array<(i: T) => any>` | One or more functions to call on each pushed value |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `callbacks` | `Array<(i: T) => any>` | Yes | The callback array. Add, remove, or replace callbacks at runtime. |

#### Example

```typescript
const logs: string[] = [];
const sink = new SinkCallbacksObj<string>(
    (s) => logs.push(`[INFO] ${s}`),
    (s) => console.log(s),
);

await sink.next('connected');
await sink.next('data received');
// logs: ['[INFO] connected', '[INFO] data received']
```

---

### SinkCollectObj

**`class SinkCollectObj<T> extends PushObj<T>`**

Terminal sink that appends every pushed value to an internal buffer array. Commonly used for testing or for collecting pipeline output in memory.

#### Constructor

```typescript
constructor(buffer?: Array<T>)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `buffer` | `Array<T>` | `[]` | Optional pre-existing array to collect into |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `buffer` | `Array<T>` | Yes | The accumulated values. Inspect after pipeline completes, or swap to a fresh array mid-stream. |

#### Example

```typescript
const sink = new SinkCollectObj<number>();
await sink.next(10);
await sink.next(20);
await sink.next(30);
await sink.return();

console.log(sink.buffer); // [10, 20, 30]
```

---

## 1-to-1 Transform Classes

All 1-to-1 transforms extend `PushObj1To1` and pass each pushed value through some transformation before forwarding to a single downstream sink.

### PushObj1To1

**`class PushObj1To1<IN, OUT = IN> extends PushObj<IN>`**

Base class for single-sink transforms. Receives values of type `IN`, produces values of type `OUT`, and forwards them to the downstream `sink`. When the sink signals done, this object's own `done` flag is set. `return()` and `throw()` are forwarded to the sink.

#### Constructor

```typescript
constructor(sink: AsyncGenerator<void, void, OUT>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | The downstream sink to forward values to |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink. Can be swapped at runtime to redirect output. |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const passthrough = new PushObj1To1<number>(collector);

await passthrough.next(42);
await passthrough.return();
console.log(collector.buffer); // [42]
```

---

### PushSerialObj

**`class PushSerialObj<T> extends PushObj1To1<T>`**

Serializes concurrent `next()` calls. By default, `PushObj` stages process `next()` calls concurrently. When push ordering matters and multiple callers may call `next()` at the same time, wrap the downstream stage with `PushSerialObj` to guarantee values are forwarded one at a time in the order they arrive.

Uses an internal generator to queue and serialize invocations.

#### Constructor

```typescript
constructor(sink: AsyncGenerator<void, void, T>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | The downstream sink to serialize writes into |

#### Properties

Inherits `sink` from `PushObj1To1`. No additional public properties.

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const serial = new PushSerialObj(collector);

// Even if called concurrently, values arrive in order:
await Promise.all([
    serial.next(1),
    serial.next(2),
    serial.next(3),
]);
console.log(collector.buffer); // [1, 2, 3]
```

---

### PushMapObj

**`class PushMapObj<IN, OUT = IN> extends PushObj1To1<IN, OUT>`**

Applies a transform function to each pushed value before forwarding the result to the downstream sink.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, OUT>,
    transform: (i: IN) => OUT,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Downstream sink |
| `transform` | `(i: IN) => OUT` | Function applied to each incoming value |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink (inherited) |
| `transform` | `(i: IN) => OUT` | Yes | The mapping function. Swap at runtime to change behavior mid-stream. |

#### Example

```typescript
const collector = new SinkCollectObj<string>();
const upper = new PushMapObj(collector, (s: string) => s.toUpperCase());

await upper.next('hello');
await upper.next('world');
await upper.return();
console.log(collector.buffer); // ['HELLO', 'WORLD']
```

---

### PushFilterObj

**`class PushFilterObj<T> extends PushObj1To1<T>`**

Forwards only values that pass the predicate function. Values that fail the predicate are silently dropped and return `{done: false}` to the caller.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, T>,
    filter: (i: T) => boolean,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Downstream sink |
| `filter` | `(i: T) => boolean` | Predicate. Returns `true` to forward, `false` to drop. |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Yes | Downstream sink (inherited) |
| `filter` | `(i: T) => boolean` | Yes | The filter predicate. Swap at runtime to change filtering criteria. |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const evens = new PushFilterObj(collector, (n: number) => n % 2 === 0);

await evens.next(1);  // dropped
await evens.next(2);  // forwarded
await evens.next(3);  // dropped
await evens.next(4);  // forwarded
await evens.return();
console.log(collector.buffer); // [2, 4]
```

---

### PushReduceObj

**`class PushReduceObj<IN, OUT = IN> extends PushObj1To1<IN, OUT>`**

Running accumulator. Each pushed value is folded into the accumulator using the `reduce` function, and the updated accumulator is forwarded downstream.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, OUT>,
    reduce: (accum: OUT, i: IN) => OUT,
    accum: OUT,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Downstream sink |
| `reduce` | `(accum: OUT, i: IN) => OUT` | Reducer function |
| `accum` | `OUT` | Initial accumulator value |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink (inherited) |
| `reduce` | `(accum: OUT, i: IN) => OUT` | Yes | The reducer function |
| `accum` | `OUT` | Yes | Current accumulator value. Read to inspect state; write to reset. |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const sum = new PushReduceObj(collector, (acc, n: number) => acc + n, 0);

await sum.next(5);   // accum=5, forwards 5
await sum.next(3);   // accum=8, forwards 8
await sum.next(2);   // accum=10, forwards 10
await sum.return();
console.log(collector.buffer); // [5, 8, 10]
```

---

### PushBufferReduceObj

**`class PushBufferReduceObj<IN, OUT = IN> extends PushObj1To1<IN, OUT>`**

Each input value is passed to an async reduce function that returns an `AsyncIterable<OUT>`, potentially producing zero or more output values per input. All outputs from the async iterable are forwarded downstream in order.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, OUT>,
    reduce: (i: IN) => Promise<AsyncIterable<OUT>>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Downstream sink |
| `reduce` | `(i: IN) => Promise<AsyncIterable<OUT>>` | Async function returning an iterable of output values |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink (inherited) |
| `reduce` | `(i: IN) => Promise<AsyncIterable<OUT>>` | Yes | The async reduce function |

#### Example

```typescript
const collector = new SinkCollectObj<string>();
const expander = new PushBufferReduceObj<number, string>(
    collector,
    async (n) => {
        // Produce n copies of the stringified value
        const results: string[] = Array(n).fill(String(n));
        return results;
    },
);

await expander.next(2);  // forwards '2', '2'
await expander.next(3);  // forwards '3', '3', '3'
await expander.return();
console.log(collector.buffer); // ['2', '2', '3', '3', '3']
```

---

### PushBufferObj

**`class PushBufferObj<T> extends PushObj1To1<T, Array<T>>`**

Collects pushed values into an internal buffer. After each push, a `check_buffer` predicate is evaluated; when it returns `true`, the buffered array is flushed downstream and the buffer is reset.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, Array<T>>,
    check_buffer: (b: Array<T>) => boolean,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, Array<T>>` | Downstream sink receiving batched arrays |
| `check_buffer` | `(b: Array<T>) => boolean` | Returns `true` when the buffer should be flushed |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, Array<T>>` | Yes | Downstream sink (inherited) |
| `buffer` | `Array<T>` | Yes | The internal buffer of accumulated values |
| `check_buffer` | `(b: Array<T>) => boolean` | Yes | The flush predicate. Swap to change flushing logic at runtime. |

#### Example

```typescript
const collector = new SinkCollectObj<number[]>();
const batcher = new PushBufferObj(collector, (buf) => buf.length >= 3);

await batcher.next(1);  // buffer: [1]
await batcher.next(2);  // buffer: [1, 2]
await batcher.next(3);  // buffer: [1, 2, 3] -> flush -> []
await batcher.next(4);  // buffer: [4]
await batcher.return();
console.log(collector.buffer); // [[1, 2, 3]]
```

---

### PushWindowObj

**`class PushWindowObj<T> extends PushBufferObj<T>`**

Convenience subclass of `PushBufferObj` that flushes at a fixed window size. Equivalent to `new PushBufferObj(sink, (b) => b.length >= windowSize)`.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, Array<T>>,
    window_size: number,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, Array<T>>` | Downstream sink receiving windowed arrays |
| `window_size` | `number` | Number of values per window |

#### Properties

Inherits all properties from `PushBufferObj`. The `check_buffer` predicate is pre-configured for fixed-size windowing.

#### Example

```typescript
const collector = new SinkCollectObj<string[]>();
const window = new PushWindowObj(collector, 2);

await window.next('a');  // buffered
await window.next('b');  // flush ['a', 'b']
await window.next('c');  // buffered
await window.next('d');  // flush ['c', 'd']
await window.return();
console.log(collector.buffer); // [['a', 'b'], ['c', 'd']]
```

---

### PushFlattenObj

**`class PushFlattenObj<IN, OUT = IN> extends PushObj1To1<IN, OUT>`**

Flattens iterable and async iterable values. If a pushed value implements `Symbol.asyncIterator` or `Symbol.iterator`, each element is forwarded individually to the downstream sink. Non-iterable values pass through unchanged.

#### Constructor

```typescript
constructor(sink: AsyncGenerator<void, void, OUT>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Downstream sink |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink (inherited) |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const flatten = new PushFlattenObj<number[] | number, number>(collector);

await flatten.next([1, 2, 3]);  // forwards 1, 2, 3 individually
await flatten.next(4);          // forwards 4 (non-iterable passthrough)
await flatten.return();
console.log(collector.buffer); // [1, 2, 3, 4]
```

---

### PushFlatMapObj

**`class PushFlatMapObj<IN, OUT = IN> extends PushObj1To1<IN, OUT>`**

Maps each value using a transform function, then flattens the result. Combines the behavior of `PushMapObj` and `PushFlattenObj`: the transform is applied first, and if the result is iterable, each element is forwarded individually.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, OUT>,
    transform: (i: IN) => OUT,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Downstream sink |
| `transform` | `(i: IN) => OUT` | Function applied before flattening |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, OUT>` | Yes | Downstream sink (inherited) |
| `transform` | `(i: IN) => OUT` | Yes | The mapping function. Swap at runtime to change behavior. |

#### Example

```typescript
const collector = new SinkCollectObj<string>();
const flatMap = new PushFlatMapObj<string, string>(
    collector,
    (s) => s.split(','),
);

await flatMap.next('a,b');    // forwards 'a', 'b'
await flatMap.next('c,d,e');  // forwards 'c', 'd', 'e'
await flatMap.return();
console.log(collector.buffer); // ['a', 'b', 'c', 'd', 'e']
```

---

### PushPreCallbacksObj

**`class PushPreCallbacksObj<T> extends PushObj1To1<T>`**

Executes an array of callback functions **before** forwarding each value to the downstream sink. Callback return values are ignored.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, T>,
    ...callbacks: Array<(i: T) => any>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Downstream sink |
| `...callbacks` | `Array<(i: T) => any>` | Functions to execute before forwarding |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Yes | Downstream sink (inherited) |
| `callbacks` | `Array<(i: T) => any>` | Yes | The pre-forwarding callbacks. Modify at runtime. |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const logged = new PushPreCallbacksObj(
    collector,
    (n) => console.log(`About to forward: ${n}`),
);

await logged.next(42);
// Console: "About to forward: 42"
// collector.buffer: [42]
```

---

### PushPostCallbacksObj

**`class PushPostCallbacksObj<T> extends PushObj1To1<T>`**

Executes an array of callback functions **after** forwarding each value to the downstream sink. Callback return values are ignored.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, T>,
    ...callbacks: Array<(i: T) => any>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Downstream sink |
| `...callbacks` | `Array<(i: T) => any>` | Functions to execute after forwarding |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Yes | Downstream sink (inherited) |
| `callbacks` | `Array<(i: T) => any>` | Yes | The post-forwarding callbacks. Modify at runtime. |

#### Example

```typescript
const collector = new SinkCollectObj<string>();
const afterLog = new PushPostCallbacksObj(
    collector,
    (s) => console.log(`Forwarded: ${s}`),
);

await afterLog.next('done');
// collector.buffer: ['done']
// Console: "Forwarded: done"
```

---

### PushPreSignalObj

**`class PushPreSignalObj<T> extends PushObj1To1<T>`**

Resolves a `WaitObject<void>` **before** forwarding each value to the downstream sink. Useful for synchronizing with external code that needs to know a value is about to be processed.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, T>,
    wait_obj: WaitObject<void>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Downstream sink |
| `wait_obj` | `WaitObject<void>` | Resolved before each forwarding operation |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Yes | Downstream sink (inherited) |
| `wait_obj` | `WaitObject<void>` | Yes | The WaitObject that is resolved before each forward |

#### Example

```typescript
const collector = new SinkCollectObj<number>();
const waitObj = new WaitObject<void>();
const preSignal = new PushPreSignalObj(collector, waitObj);

// In another async context, wait for the signal:
// await waitObj.wait();

await preSignal.next(99); // resolves waitObj, then forwards 99
```

---

### PushPostSignalObj

**`class PushPostSignalObj<T> extends PushObj1To1<T>`**

Resolves a `WaitObject<boolean>` **after** forwarding each value to the downstream sink. The resolved value is `!done` (i.e., `true` when the pipeline is still active, `false` when done). Also signals on `return()` and `throw()`.

#### Constructor

```typescript
constructor(
    sink: AsyncGenerator<void, void, T>,
    wait_obj: WaitObject<boolean>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Downstream sink |
| `wait_obj` | `WaitObject<boolean>` | Resolved with `!done` after each operation |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sink` | `AsyncGenerator<void, void, T>` | Yes | Downstream sink (inherited) |
| `wait_obj` | `WaitObject<boolean>` | Yes | The WaitObject resolved after each forward, return, or throw |

#### Example

```typescript
const collector = new SinkCollectObj<string>();
const waitObj = new WaitObject<boolean>();
const postSignal = new PushPostSignalObj(collector, waitObj);

await postSignal.next('data');
// waitObj resolves with true (pipeline still active)

await postSignal.return();
// waitObj resolves with false (pipeline done)
```

---

## 1-to-Many Classes

These classes fan out a single input stream to multiple downstream sinks. They are the defining feature of the push model's divergent nature.

### PushObj1ToManyBase

**`class PushObj1ToManyBase<IN, OUT = IN> extends PushObj<IN>`** *(abstract)*

Abstract base for all 1-to-many push objects. Provides the `sinks` accessor and forwards `return()` / `throw()` to all sinks when the corresponding `forward_close` / `forward_errors` flags are set.

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `sinks` | `Iterable<AsyncGenerator<void, void, OUT>>` (getter) | -- | Read-only accessor for the collection of downstream sinks |

#### Lifecycle

- `return()` -- when `forward_close` is `true`, calls `return()` on every sink.
- `throw(e)` -- when `forward_errors` is `true`, calls `throw(e)` on every sink.

---

### PushObj1ToMany

**`class PushObj1ToMany<IN, OUT = IN> extends PushObj1ToManyBase<IN, OUT>`**

Concrete base for unlabeled 1-to-many classes. Maintains an array of sinks. When a sink signals `done` in response to a `send_to_sink()` call, that sink is automatically removed from the array.

#### Constructor

```typescript
constructor(
    sinks: Array<AsyncGenerator<void, void, OUT>>,
    forward_errors?: boolean,
    forward_close?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sinks` | `Array<AsyncGenerator<void, void, OUT>>` | -- | Initial array of downstream sinks |
| `forward_errors` | `boolean` | `false` | Forward `throw()` to all sinks |
| `forward_close` | `boolean` | `false` | Forward `return()` to all sinks |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `_sinks` | `Array<AsyncGenerator<void, void, OUT>>` | Yes | The mutable sink array. Add or remove sinks at runtime. |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `send_to_sink` | `protected async send_to_sink(o: OUT, index: number): Promise<IteratorResult<void>>` | Sends a value to the sink at the given index. Removes the sink if it signals done. |

---

### PushForkObj

**`class PushForkObj<T> extends PushObj1ToMany<T>`**

Broadcasts each pushed value to **all** sinks. The fork is done when every sink has signaled done.

#### Constructor

```typescript
constructor(
    sinks: Array<AsyncGenerator<void, void, T>>,
    forward_errors?: boolean,
    forward_close?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sinks` | `Array<AsyncGenerator<void, void, T>>` | -- | Sinks to broadcast to |
| `forward_errors` | `boolean` | `false` | Forward errors to all sinks |
| `forward_close` | `boolean` | `false` | Forward close to all sinks |

#### Properties

Inherits `_sinks` from `PushObj1ToMany`.

#### Example

```typescript
const logSink = new SinkCollectObj<string>();
const archiveSink = new SinkCollectObj<string>();
const fork = new PushForkObj([logSink, archiveSink]);

await fork.next('event-A');
await fork.next('event-B');
await fork.return();

console.log(logSink.buffer);     // ['event-A', 'event-B']
console.log(archiveSink.buffer); // ['event-A', 'event-B']
```

---

### PushRoundRobinObj

**`class PushRoundRobinObj<T> extends PushObj1ToMany<T>`**

Distributes each pushed value to one sink at a time, cycling through the sink array in order.

#### Constructor

```typescript
constructor(
    sinks: Array<AsyncGenerator<void, void, T>>,
    forward_errors?: boolean,
    forward_close?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sinks` | `Array<AsyncGenerator<void, void, T>>` | -- | Sinks to distribute across |
| `forward_errors` | `boolean` | `false` | Forward errors to all sinks |
| `forward_close` | `boolean` | `false` | Forward close to all sinks |

#### Properties

Inherits `_sinks` from `PushObj1ToMany`.

#### Example

```typescript
const worker1 = new SinkCollectObj<number>();
const worker2 = new SinkCollectObj<number>();
const rr = new PushRoundRobinObj([worker1, worker2]);

await rr.next(1);  // -> worker1
await rr.next(2);  // -> worker2
await rr.next(3);  // -> worker1
await rr.next(4);  // -> worker2
await rr.return();

console.log(worker1.buffer); // [1, 3]
console.log(worker2.buffer); // [2, 4]
```

---

### PushDistributeObj

**`class PushDistributeObj<T> extends PushObj1ToMany<T>`**

Routes each pushed value to a specific sink determined by a selector function. The selector returns the index into the sinks array.

#### Constructor

```typescript
constructor(
    sinks: Array<AsyncGenerator<void, void, T>>,
    selector: (i: T) => number,
    forward_errors?: boolean,
    forward_close?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sinks` | `Array<AsyncGenerator<void, void, T>>` | -- | Sinks to route to |
| `selector` | `(i: T) => number` | -- | Returns the sink index for each value |
| `forward_errors` | `boolean` | `false` | Forward errors to all sinks |
| `forward_close` | `boolean` | `false` | Forward close to all sinks |

#### Properties

Inherits `_sinks` from `PushObj1ToMany`.

#### Example

```typescript
const highPriority = new SinkCollectObj<{ priority: number; data: string }>();
const lowPriority = new SinkCollectObj<{ priority: number; data: string }>();

const router = new PushDistributeObj(
    [highPriority, lowPriority],
    (item) => item.priority >= 5 ? 0 : 1,
);

await router.next({ priority: 8, data: 'urgent' });   // -> highPriority
await router.next({ priority: 2, data: 'routine' });   // -> lowPriority
await router.return();

console.log(highPriority.buffer); // [{ priority: 8, data: 'urgent' }]
console.log(lowPriority.buffer);  // [{ priority: 2, data: 'routine' }]
```

---

### PushObjLabeled1ToMany

**`class PushObjLabeled1ToMany<L, IN, OUT = IN> extends PushObj1ToManyBase<IN, OUT>`**

Base class for labeled 1-to-many distribution. Instead of an array of sinks indexed by position, sinks are stored in a `Map<L, AsyncGenerator>` keyed by a label of type `L`. An optional `throw_on_nonexistence` flag controls whether routing to a non-existent label throws an error or silently drops the value.

#### Constructor

```typescript
constructor(
    labeled_sinks: Map<L, AsyncGenerator<void, void, OUT>>,
    forward_errors?: boolean,
    forward_close?: boolean,
    throw_on_nonexistence?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `labeled_sinks` | `Map<L, AsyncGenerator<void, void, OUT>>` | -- | Map of labels to sinks |
| `forward_errors` | `boolean` | `false` | Forward errors to all sinks |
| `forward_close` | `boolean` | `false` | Forward close to all sinks |
| `throw_on_nonexistence` | `boolean` | `false` | Throw when routing to a label not in the map |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `labeled_sinks` | `Map<L, AsyncGenerator<void, void, OUT>>` | No (protected) | The labeled sink map |
| `throw_on_nonexistence` | `boolean` | No (protected) | Whether missing labels cause errors |

---

### PushLabeledDistributeObj

**`class PushLabeledDistributeObj<L, T> extends PushObjLabeled1ToMany<L, T>`**

Routes each pushed value to a labeled sink. The label is extracted from each value either by a property name (string) or a getter function.

#### Constructor

```typescript
constructor(
    labeled_sinks: Map<L, AsyncGenerator<void, void, T>>,
    label_getter: string | ((i: T) => L),
    forward_errors?: boolean,
    forward_close?: boolean,
    throw_on_nonexistence?: boolean,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `labeled_sinks` | `Map<L, AsyncGenerator<void, void, T>>` | -- | Map of labels to sinks |
| `label_getter` | `string \| ((i: T) => L)` | -- | Property name or function to extract the routing label from each value |
| `forward_errors` | `boolean` | `false` | Forward errors to all sinks |
| `forward_close` | `boolean` | `false` | Forward close to all sinks |
| `throw_on_nonexistence` | `boolean` | `false` | Throw when a label has no matching sink |

#### Properties

| Property | Type | Mutable | Description |
|----------|------|---------|-------------|
| `label_getter` | `string \| ((i: T) => L)` | Yes | The label extraction strategy. Swap at runtime. |

#### Example

```typescript
interface LogEntry { level: string; message: string; }

const infoSink = new SinkCollectObj<LogEntry>();
const errorSink = new SinkCollectObj<LogEntry>();

const router = new PushLabeledDistributeObj<string, LogEntry>(
    new Map([['info', infoSink], ['error', errorSink]]),
    'level',
);

await router.next({ level: 'info', message: 'Started' });
await router.next({ level: 'error', message: 'Failed' });
await router.next({ level: 'info', message: 'Retrying' });
await router.return();

console.log(infoSink.buffer.length);  // 2
console.log(errorSink.buffer.length); // 1
```

---

## Key Design Notes

### Push vs Pull

The push model is **eager**: values are forwarded immediately when `next(value)` is called, without waiting for a consumer to request them. This contrasts with the pull model, which is **lazy** -- work only happens when a consumer calls `next()` to request the next value. Push excels at **divergent** (one-to-many) patterns such as broadcasting, routing, and fan-out. Pull excels at **convergent** (many-to-one) patterns such as merging, zipping, and combining.

### Concurrency

By default, `next()` calls on push objects can be made **concurrently**. If a producer calls `next(a)` and `next(b)` without awaiting the first, both values may be in-flight simultaneously through the pipeline. This is typically fine for stateless transforms like `PushMapObj` or `PushFilterObj`. When ordering matters or the downstream stage has order-sensitive state, wrap with `PushSerialObj` to serialize concurrent pushes.

### Done Propagation

When a downstream sink's `next()` returns `{done: true}`, the upstream stage detects this and stops forwarding to that sink. In 1-to-many classes (`PushForkObj`, `PushRoundRobinObj`, `PushDistributeObj`), a sink that signals done is removed from the active sink array. The parent stage itself signals done only when all of its sinks are done.

### Reference Semantics

`PushForkObj` broadcasts the **same object reference** to every sink. It does not clone the value. If one sink mutates the object, other sinks will see the mutation. To avoid this, either:
- Treat pushed values as read-only.
- Use `PushMapObj` in each branch to create copies before the branch's processing begins.

### Mutable Configuration

All public properties (`.transform`, `.filter`, `.reduce`, `.callbacks`, `.sink`, `._sinks`, `.label_getter`, etc.) can be changed at runtime. Changes take effect on the next `next()` call. This enables dynamic pipeline reconfiguration without tearing down and rebuilding the pipeline.

---

## See Also

- [Conceptual Guide](../concepts.md) -- Core design philosophy, pull vs push, the Obj pattern
- [Pull Obj Classes](./pull-obj-classes.md) -- The pull-side counterpart: sources, transforms, combiners
- [PushChain API](./push-chain.md) -- Fluent builder API for constructing push pipelines
- [PullChain API](./pull-chain.md) -- Fluent pull pipeline chains
- [Utilities](./utilities.md) -- `WaitObject`, `PushPullBufferObj` (bridging push and pull)
- [Scheduling API](./scheduling.md) -- Task scheduling with dependency graphs and resource management
