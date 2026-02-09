# Chain Compilation API Reference

Chain compilation fuses pipeline operators into a single generator (pull) or function (push), eliminating per-stage overhead: extra generator state machines, promise wraps, virtual dispatches, and `IteratorResult` allocations. This is a performance optimization for hot paths — the compiled chain produces identical results to the uncompiled chain but with significantly less overhead.

## Import

```typescript
import {
    PullChain,
    PushChainBuilder,
    CompiledPullChain,
    CompiledPushChain,
} from '@firebrandanalytics/shared-utils';
```

## Quick Example

```typescript
// Pull: compile a filter+map+reduce pipeline
const compiled = PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    .filter(x => x % 2 === 0)
    .map(x => x * 3)
    .compile();

const result = await compiled.collect(); // [6, 12, 18, 24, 30]

// Push: compile a filter+map pipeline
const { chain, buffer } = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => n * 10)
    .compile()
    .toArray();

await chain.next(3);   // 30 → buffer
await chain.next(-1);  // filtered out
await chain.next(7);   // 70 → buffer
await chain.return();
console.log(buffer);   // [30, 70]
```

---

## Compilation Strategies

The compiler analyzes the operator pipeline and selects one of two strategies:

### Fast Path (1-to-1 ops)

When all operators preserve cardinality — `map`, `filter`, `dedupe`, `reduce`, `callback` — the compiler generates a tight inline loop with no intermediate arrays. Filter and dedupe use a labeled `continue outer` to skip items without allocations.

```
for await (let v of source) {      // single source iteration
    v = mapFn(v);                   // inline transform
    if (!filterFn(v)) continue;     // skip without allocation
    v = reduceFn(v, accum);         // inline accumulate
    yield v;                        // single yield
}
```

### General Path (cardinality-changing ops)

When any operator changes cardinality — `flatMap`, `flatten`, `window`, `buffer` — the compiler uses a values-array approach where each stage operates on an array of in-flight values.

```
for await (const raw of source) {
    let values = [raw];
    for (const op of ops) {
        const next = [];
        for (const v of values) { /* apply op, push to next */ }
        values = next;
    }
    for (const v of values) yield v;
}
```

### Non-Fusible Operators (Barriers)

Operators that cannot be fused — such as `pipe()` on pull or `serial()` on push — act as barriers. On the pull side, encountering a barrier throws an error at compile time. On the push side, the current implementation falls back to a pass-through (no ops fused). See [issue #36](https://github.com/firebrandanalytics/ff-core-types/issues/36) for planned improvements.

---

## Pull-Side Compilation

### `PullChain.compile()`

```typescript
compile(): CompiledPullChain<T>
```

Compiles the current chain into a `CompiledPullChain`. The chain must not contain non-fusible operators (e.g., `pipe()`); if it does, an error is thrown.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x > 2)
    .map(x => x * 10);

const compiled = chain.compile();
const result = await compiled.collect(); // [30, 40, 50]
```

**Fusible pull operators:**

| Operator | Compilation | Fast path? |
|----------|-------------|------------|
| `map(fn)` | Inline `v = fn(v)` | Yes |
| `filter(fn)` | `continue outer` on false | Yes |
| `dedupe(fn?)` | `Set`-based, `continue outer` on duplicate | Yes |
| `reduce(fn, initial?)` | Inline accumulator | Yes |
| `callback(...fns)` | Inline side-effect calls | Yes |
| `window(size)` | Array buffering + flush | No (general path) |
| `buffer(condition)` | Condition-based flush | No (general path) |
| `flatMap(fn)` | Async generator expansion | No (general path) |
| `flatten()` | Iterable expansion | No (general path) |
| `pipe(fn)` | **Not fusible** — throws at compile time | N/A |

### `CompiledPullChain<T>`

Extends `PullObj<T>`. Can be used anywhere a `PullObj` is expected.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `source` | `PullObj<any>` | The upstream source. Can be swapped to restart with a new source. |
| `ops` | `readonly PullOpDescriptor[]` | The fused operator descriptors (read-only). |
| `done` | `boolean` | Whether the chain has been exhausted. |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `next` | `next(): Promise<IteratorResult<T>>` | Pulls the next value through the fused pipeline. |
| `return` | `return(value?: T): Promise<IteratorResult<T>>` | Signals graceful shutdown. |
| `throw` | `throw(error?: any): Promise<IteratorResult<T>>` | Signals error shutdown. |
| `collect` | `collect(): Promise<T[]>` | Pulls all values and returns them as an array. |
| `first` | `first(): Promise<T \| undefined>` | Pulls a single value and closes the chain. |
| `forEach` | `forEach(fn: (t: T) => void \| Promise<void>): Promise<void>` | Processes each value with a callback. |
| `close` | `close(): void` | Initiates graceful shutdown; propagates to source. |
| `closeInterrupt` | `closeInterrupt(): void` | Forces immediate shutdown. |
| `restart` | `restart(): void` | Resets the chain (clears done state, recreates the fused generator). Stateful ops (dedupe, reduce) are reset. |

**Source swapping:**

```typescript
const compiled = PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 10)
    .compile();

const r1 = await compiled.collect(); // [10, 20, 30]

compiled.source = new SourceBufferObj([4, 5]);
const r2 = await compiled.collect(); // [40, 50]
```

Setting `source` automatically resets the chain and recreates the fused generator. Stateful operators (dedupe's `Set`, reduce's accumulator) are reset to their initial state.

---

## Push-Side Compilation

### `PushChainBuilder.compile()`

```typescript
compile(): PushChainBuilder<IN>
```

Adds a compilation step to the builder recipe. When a terminal method (`.into()`, `.fork()`, etc.) is called, the fusible operations are compiled into a single `CompiledPushChain` stage.

```typescript
const { chain, buffer } = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => `item-${n}`)
    .compile()
    .toArray();

await chain.next(3);   // "item-3" → buffer
await chain.next(-1);  // filtered out
await chain.return();
```

**Fusible push operators:**

| Operator | Compilation | Fast path? |
|----------|-------------|------------|
| `map(fn)` | Inline `v = fn(v)` | Yes |
| `filter(fn)` | Early return on false | Yes |
| `reduce(fn, initial)` | Inline accumulator | Yes |
| `preCallback(...fns)` | Inline side-effect before sink push | Yes |
| `postCallback(...fns)` | Deferred side-effect after sink push | Yes |
| `window(size)` | Array buffering + flush | No (general path) |
| `buffer(condition)` | Condition-based flush | No (general path) |
| `flatMap(fn)` | Iterable expansion | No (general path) |
| `flatten()` | Iterable expansion | No (general path) |
| `serial()` | **Not fusible** — barrier | N/A |

### `CompiledPushChain<T>`

Extends `PushObj<T>`. Can be used anywhere a `PushObj` is expected.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `sink` | `PushObj<any>` | The downstream sink. Can be swapped. |
| `ops` | `readonly PushOpDescriptor[]` | The fused operator descriptors (read-only). |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `next` | `next(value: T): Promise<IteratorResult<void>>` | Pushes a value through the fused pipeline. |
| `return` | `return(): Promise<IteratorResult<void>>` | Signals graceful shutdown; propagates to sink. |
| `throw` | `throw(error: any): Promise<IteratorResult<void>>` | Signals error shutdown; propagates to sink. |

---

## Performance Characteristics

Chain compilation is most effective when:

- The pipeline has 3+ stages of 1-to-1 operators (map, filter, reduce)
- The source produces many items (hundreds or thousands)
- The operators are synchronous (async operators still benefit but with less impact)

The primary savings come from:

1. **Eliminated generator overhead**: Each uncompiled stage is a separate `AsyncGenerator` with its own state machine, promise wrapping, and `IteratorResult` allocation. Compilation reduces this to a single generator.
2. **Inlined transforms**: Map and filter functions are called directly instead of through virtual dispatch.
3. **Reduced allocations**: No intermediate `IteratorResult` objects between stages. The fast path creates zero intermediate arrays.

### Benchmark Results

Measured with 5000 items, 3 iterations per scenario, on a quiet machine (load average < 1). Values > 1.0x indicate the compiled chain is faster.

**Pull-side compilation** (consistent wins for fast-path ops):

| Scenario | Node.js (V8) | Bun (JSC) |
|----------|:---:|:---:|
| map + filter (2 stages) | 2.9x | 2.8x |
| 5-stage pipeline | 2.7x | 2.4x |
| 10-stage pipeline | 4.1x | 5.1x |
| High-rejection filter (90%) | 1.5x | 1.0x |
| window + map (general path) | 1.7x | 0.5x |

**Push-side compilation** (modest gains on V8, regressions on JSC — see [issue #37](https://github.com/firebrandanalytics/ff-core-types/issues/37)):

| Scenario | Node.js (V8) | Bun (JSC) |
|----------|:---:|:---:|
| map + filter (2 stages) | 1.3x | 0.9x |
| 5-stage pipeline | 1.3x | 1.2x |
| 10-stage pipeline | 1.1x | 0.9x |
| window batching (general path) | 0.95x | 0.5x |

### Runtime Matters — Measure Your Own Workloads

These numbers vary significantly between JavaScript engines. V8 (Node.js/Deno) and JavaScriptCore (Bun) optimize async generators, closures, and promise chains differently. A pipeline that compiles 4x faster on V8 may show no benefit — or even regress — on JSC, and vice versa.

**Recommendations:**

- **Always benchmark your actual pipeline** with your actual data shapes and volumes before committing to compiled chains in production. The included benchmark suite (`CompiledChainPerformance.test.ts`) can serve as a starting template.
- **System load affects results** — async pipelines with many per-item `await` points are sensitive to OS scheduling pressure. Benchmark on a quiet system for reliable numbers.
- **Pull-side fast-path ops are the safe bet** — `map`, `filter`, `dedupe`, `reduce`, and `callback` show consistent 2-5x wins across both runtimes. This is the recommended use case for compilation.
- **Push-side and general-path compilation is runtime-dependent** — V8 shows modest gains (1.1-1.3x), JSC can regress. If you target multiple runtimes, consider leaving push chains uncompiled or gating compilation behind a runtime check.
- **For long-running services**, consider measuring both compiled and interpreted throughput at startup and selecting the faster path dynamically. Since `CompiledPullChain` and `PullChain` both implement `PullObj`, and `CompiledPushChain` and `PushChainBuilder` both produce `PushObj`, they are drop-in interchangeable — making runtime selection straightforward.

---

## Limitations

- **Async filter/reduce predicates**: The compiled fast path does not `await` filter or reduce functions. If you use async predicates, either stay with the uncompiled chain or ensure the async function's synchronous return value is usable (e.g., a Promise is truthy for filter). See [issue #36](https://github.com/firebrandanalytics/ff-core-types/issues/36).
- **Partial windows/buffers**: When using `collect()` or `for await...of`, partial windows and buffers at stream end are not included in the result (they become the generator's return value). This matches uncompiled behavior.
- **Locked pipeline**: After compilation, the operator pipeline is fixed. Only the source (pull) or sink (push) can be swapped.
- **Non-fusible barriers**: `pipe()` (pull) throws at compile time. `serial()` (push) causes a fallback to pass-through.

---

## See Also

- [PullChain API Reference](./pull-chain.md) — Full fluent pull pipeline API
- [PushChain API Reference](./push-chain.md) — Full fluent push pipeline API
- [Conceptual Guide](../concepts.md) — Pull, push, and bidirectional model philosophy
