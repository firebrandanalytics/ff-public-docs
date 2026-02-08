# BidirectionalChain API Reference

`BidirectionalChain<IN, OUT>` is the third chain type in the async streams library, alongside `PullChain` (consumer-driven) and `PushChainBuilder`/`PushChain` (producer-driven). BidirectionalChain is **caller-driven**: each `.next(input)` sends a request through the pipeline and returns a response. This models request-response patterns, stateful transformations, conversational protocols, and cursor-based pagination.

Internally, stages are plain async functions `(input) => output`, not generators. This avoids the JavaScript generator priming confusion where the first `.next()` argument is silently discarded. Generator-based stages are supported via the `fromGenerator()` adapter, which handles priming automatically.

## Import

```typescript
import { BidirectionalChain } from '@firebrandanalytics/shared-utils';
```

The associated types can be imported alongside the class:

```typescript
import {
    BidirectionalChain,
    BidiProcessor,
    BidiProcessorFactory,
} from '@firebrandanalytics/shared-utils';
```

## Quick Example

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n * 10);

const r1 = await chain.next(5);   // { value: 50, done: false }
const r2 = await chain.next(3);   // { value: 30, done: false }

await chain.return();
```

Each call to `.next(input)` flows the input through all stages left-to-right and returns the final output as an `IteratorResult`.

---

## Types

### `BidiProcessor<IN, OUT>`

```typescript
type BidiProcessor<IN, OUT> = (input: IN) => OUT | Promise<OUT>;
```

A bidirectional processing function that transforms input to output. May be synchronous or asynchronous. Stateful processors capture state via closures.

### `BidiProcessorFactory<IN, OUT>`

```typescript
type BidiProcessorFactory<IN, OUT> = () => BidiProcessor<IN, OUT>;
```

Factory that creates a fresh `BidiProcessor`. Factories enable lazy initialization -- the processor is not created until the chain is first used.

---

## Static Factories

### `BidirectionalChain.of(fn)`

```typescript
static of<IN, OUT>(fn: BidiProcessor<IN, OUT>): BidirectionalChain<IN, OUT>
```

Creates a chain from a single processing function. Use this for **stateless** stages where the function does not need fresh state on each build.

```typescript
const doubler = BidirectionalChain.of<number, number>(n => n * 2);

const r1 = await doubler.next(5);   // { value: 10, done: false }
const r2 = await doubler.next(7);   // { value: 14, done: false }
```

```typescript
const formatter = BidirectionalChain.of<number, string>(n => `val:${n}`);

const r = await formatter.next(42); // { value: 'val:42', done: false }
```

### `BidirectionalChain.from(factory)`

```typescript
static from<IN, OUT>(factory: BidiProcessorFactory<IN, OUT>): BidirectionalChain<IN, OUT>
```

Creates a chain from a processor factory. The factory is called lazily when the chain is first used, allowing **stateful** stages to initialize fresh state.

```typescript
const counter = BidirectionalChain.from<number, number>(() => {
    let total = 0;
    return (n) => { total += n; return total; };
});

await counter.next(10);  // { value: 10, done: false }
await counter.next(20);  // { value: 30, done: false }
await counter.next(5);   // { value: 35, done: false }
```

### `BidirectionalChain.identity()`

```typescript
static identity<T>(): BidirectionalChain<T, T>
```

Creates a pass-through chain that returns each input unchanged. Useful as a starting point for building pipelines with fluent methods.

```typescript
const id = BidirectionalChain.identity<number>();

const r = await id.next(42); // { value: 42, done: false }
```

### `BidirectionalChain.fromGenerator(factory)`

```typescript
static fromGenerator<IN, OUT>(
    factory: () => AsyncGenerator<OUT, any, IN>,
): BidirectionalChain<IN, OUT>
```

Adapter for `AsyncGenerator`-based stages. The generator is automatically primed on first use (the initial `.next()` call is made internally and its yielded value is discarded). Subsequent `.next(input)` calls send input to the generator and return its yielded output.

Use this to integrate generator-based stateful stages that use the `let input = yield output` pattern.

```typescript
async function* accumulator(): AsyncGenerator<number, any, number> {
    let total = 0;
    let input: number = yield total; // initial yield (discarded by adapter)
    while (true) {
        total += input;
        input = yield total;
    }
}

const chain = BidirectionalChain.fromGenerator(() => accumulator());

await chain.next(10);  // { value: 10, done: false }
await chain.next(20);  // { value: 30, done: false }
await chain.next(5);   // { value: 35, done: false }
```

```typescript
async function* doubler(): AsyncGenerator<number, any, number> {
    let input: number = yield 0; // initial yield discarded by adapter
    while (true) {
        input = yield input * 2;
    }
}

const chain = BidirectionalChain.fromGenerator(() => doubler());

await chain.next(5);  // { value: 10, done: false }
await chain.next(3);  // { value: 6, done: false }
```

---

## Fluent Methods

Each fluent method returns a **new** `BidirectionalChain` instance -- the original is not modified.

| Method | Signature | Description |
|--------|-----------|-------------|
| `map` | `map<U>(fn: BidiProcessor<OUT, U>): BidirectionalChain<IN, U>` | Transform each output value |
| `then` | `then<U>(factory: BidiProcessorFactory<OUT, U>): BidirectionalChain<IN, U>` | Append a stateful stage via factory |
| `tap` | `tap(fn: (value: OUT) => void \| Promise<void>): BidirectionalChain<IN, OUT>` | Observe values without modifying them |

### map

Appends a transformation function to the pipeline. Every input that flows through the chain will have its output transformed by `fn` before reaching the caller. The function can be synchronous or asynchronous.

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n * 10);

await chain.next(5);  // { value: 50, done: false }
await chain.next(3);  // { value: 30, done: false }
```

Multiple maps compose naturally:

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n + 100)
    .map(n => `${n}`);

await chain.next(5);   // { value: '105', done: false }
await chain.next(10);  // { value: '110', done: false }
```

Async mapping functions are supported:

```typescript
const chain = BidirectionalChain.identity<string>()
    .map(async s => s.toUpperCase());

await chain.next('hello');  // { value: 'HELLO', done: false }
```

### then

Appends a stateful stage via a processor factory. This is the general composition method -- analogous to PullChain's `.pipe()`. The factory is called at build time and must return a fresh processor function.

```typescript
const chain = BidirectionalChain
    .of<number, number>(n => n * 2)
    .then<string>(() => {
        let count = 0;
        return async (n) => `[${++count}] ${n}`;
    });

await chain.next(5);  // { value: '[1] 10', done: false }
await chain.next(3);  // { value: '[2] 6', done: false }
await chain.next(0);  // { value: '[3] 0', done: false }
```

Composing three stages:

```typescript
const chain = BidirectionalChain.identity<number>()
    .then<number>(() => {
        let prev = 0;
        return (n) => { const out = prev; prev = n; return out; };
    })
    .map(n => `prev:${n}`);

await chain.next(10);  // { value: 'prev:0', done: false }
await chain.next(20);  // { value: 'prev:10', done: false }
await chain.next(30);  // { value: 'prev:20', done: false }
```

### tap

Appends a side-effect stage that observes values without modifying them. Useful for logging, metrics, and debugging. The tap function receives the current value and its return value is ignored. The function can be synchronous or asynchronous.

```typescript
const observed: number[] = [];
const chain = BidirectionalChain.identity<number>()
    .tap(n => { observed.push(n); })
    .map(n => n * 2);

await chain.next(5);  // { value: 10, done: false }
await chain.next(3);  // { value: 6, done: false }

console.log(observed); // [5, 3]
```

---

## Introspection

### `length`

```typescript
get length(): number
```

Returns the number of stages in the chain. Each factory (including those added by `of`, `identity`, `map`, `then`, and `tap`) counts as one stage.

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n * 2)
    .map(n => n + 1);

console.log(chain.length); // 3 (identity + map + map)
```

`tap` also counts as a stage, since it is implemented as a function-based processor internally:

```typescript
const chain = BidirectionalChain.identity<number>()
    .tap(() => {})
    .map(n => n * 2);

console.log(chain.length); // 3
```

---

## AsyncGenerator Protocol

`BidirectionalChain<IN, OUT>` implements `AsyncGenerator<OUT, any, IN>`, providing protocol compatibility with any code that expects a bidirectional async generator.

### `next(value)`

```typescript
async next(value: IN): Promise<IteratorResult<OUT>>
```

Sends `value` through the pipeline and returns the result. Returns `{ value, done: false }` on success. If the chain has been closed via `return()` or `throw()`, returns `{ value: undefined, done: true }`.

### `return(value?)`

```typescript
async return(value?: any): Promise<IteratorResult<OUT>>
```

Closes the chain. Returns `{ value, done: true }`. All subsequent `next()` calls return `{ value: undefined, done: true }`.

```typescript
const chain = BidirectionalChain.identity<number>();

await chain.next(1);            // { value: 1, done: false }

const r = await chain.return(42);
console.log(r.done);            // true
console.log(r.value);           // 42

const after = await chain.next(5);
console.log(after.done);        // true
```

### `throw(error?)`

```typescript
async throw(error?: any): Promise<IteratorResult<OUT>>
```

Closes the chain and re-throws the provided error. The chain is marked as closed, so subsequent `next()` calls return done.

```typescript
const chain = BidirectionalChain.identity<number>();

await chain.next(1);

await chain.throw(new Error('abort')); // throws Error('abort')

const after = await chain.next(5);
console.log(after.done); // true
```

### `[Symbol.asyncIterator]()`

Returns `this`, satisfying the `AsyncIterable` protocol. However, note that a BidirectionalChain does **not** support meaningful `for await...of` iteration, because each `next()` call requires input from the caller. The `Symbol.asyncIterator` implementation exists solely for protocol compatibility.

---

## Error Handling

Errors thrown by stage functions propagate directly to the caller of `next()`. The chain itself remains open -- a stage error does not automatically close the chain.

```typescript
const chain = BidirectionalChain.of<number, number>(n => {
    if (n < 0) throw new Error('negative input');
    return n * 2;
});

await chain.next(5);    // { value: 10, done: false }
await chain.next(-1);   // throws Error('negative input')
await chain.next(3);    // { value: 6, done: false } -- chain is still open
```

Async stage errors are also propagated:

```typescript
const chain = BidirectionalChain.of<string, string>(async s => {
    if (s === '') throw new Error('empty');
    return s.toUpperCase();
});

await chain.next('hi');  // { value: 'HI', done: false }
await chain.next('');    // throws Error('empty')
```

---

## Design Notes

### Function-based internals vs generator-based

BidirectionalChain uses plain functions `(input) => output` as its internal stage primitive, rather than `AsyncGenerator` instances. This is a deliberate design choice to avoid the JavaScript generator priming problem: when you create an async generator and call `.next(value)` for the first time, the `value` argument is silently discarded because the generator has not yet advanced to its first `yield` expression. This priming behavior is a well-known source of bugs in bidirectional generator code.

By using functions internally, every `.next(input)` call delivers its input to the stage and receives an output -- no priming step, no discarded values, no surprise. The `fromGenerator()` adapter is provided for cases where generator-based stages are needed; it encapsulates the priming internally so callers never encounter it.

### Lazy build

Stage factories are not called until the first `next()` invocation on the chain. This means constructing a chain is cheap -- no processor state is allocated until the chain is actually used.

```typescript
let factoryCalled = false;
const chain = BidirectionalChain.from<number, number>(() => {
    factoryCalled = true;
    return (n) => n;
});

console.log(factoryCalled); // false -- factory not yet called
await chain.next(1);
console.log(factoryCalled); // true -- factory called on first use
```

### Immutable builder pattern

Each fluent method (`map`, `then`, `tap`) returns a **new** `BidirectionalChain` with a copy of the factory array plus the new stage. The original chain is not modified. This mirrors the immutable builder pattern used by `PushChainBuilder`.

### Concurrency

Stateful stages (closures created by `from()` or `then()`, generator adapters via `fromGenerator()`) assume **serialized invocation**. Do not call `.next()` concurrently on the same chain instance unless all stages are stateless. There is no built-in serialization mechanism -- if you need concurrent access, serialize calls externally.

### Deprecated TwoWay* utilities

The following generator-based utility functions are deprecated in favor of `BidirectionalChain`:

| Deprecated | Replacement |
|------------|-------------|
| `TwoWayIdentity(initial)` | `BidirectionalChain.identity()` |
| `TwoWayMap(fn, initial)` | `BidirectionalChain.of(fn)` |
| `TwoWayForward(factory, initialIn, initialOut)` | `BidirectionalChain.fromGenerator(factory)` |
| `TwoWayCompose(a, b)` | `chain.then(...)` or `chain.map(...)` |

The deprecated utilities required initial values for priming and exposed the generator priming semantics directly to callers. `BidirectionalChain` eliminates both concerns: no initial values are needed, and priming is handled internally when generators are used via `fromGenerator()`.

If you have existing generator-based stages that use the `let input = yield output` pattern, wrap them with `BidirectionalChain.fromGenerator(() => myGenerator())` for a direct migration path.

---

## See Also

- [Conceptual Guide](../concepts.md) -- Core design philosophy, pull vs push models, the Obj pattern
- [PullChain API Reference](./pull-chain.md) -- Consumer-driven pull pipelines
- [PushChain API Reference](./push-chain.md) -- Producer-driven push pipelines
- [Utilities Reference](./utilities.md) -- WaitObject, AsyncIteratorCombiner, PushPullBufferObj
