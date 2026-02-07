# Pull Pipeline Basics

This tutorial walks you through building pull pipelines with the async streams library. No prior knowledge of the library or any specific platform is needed -- just TypeScript familiarity.

## 1. What Is a Pull Pipeline?

A pull pipeline is **lazy and demand-driven**: no work happens until a consumer requests the next value. When you call `next()` or iterate with `for await...of`, the request propagates backward through the chain -- each stage pulls from the one before it, all the way back to the source. Only then does data flow forward through the transforms.

This is the opposite of push-based systems where a producer fires events whether or not anyone is ready to handle them.

**When to use pull pipelines:**

- Data processing and ETL transforms
- Combining multiple async data sources into one stream
- Lazy evaluation where you may not need all results
- Pipelines where backpressure matters (the consumer controls the pace)

## 2. Your First Pipeline

Everything starts with a source and a chain. Let's build one step by step.

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

// Step 1: Create a source that holds your data
const source = new SourceBufferObj([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

// Step 2: Wrap the source in a chain for the fluent API
const chain = PullChain.from(source);

// Step 3: Add transforms and a terminal
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    .filter(x => x % 2 === 0)     // keep evens: 2, 4, 6, 8, 10
    .map(x => x * 3)              // triple: 6, 12, 18, 24, 30
    .collect();                    // terminal: [6, 12, 18, 24, 30]
```

Each fluent method (`.filter()`, `.map()`, etc.) returns a **new** chain. The old chain reference is marked as consumed and cannot be used again. This consumed-chain safety prevents a common class of shared-iterator bugs where two references accidentally compete for the same underlying data.

```typescript
const chain1 = PullChain.from(new SourceBufferObj([1, 2, 3]));
const chain2 = chain1.map(x => x * 2);

// chain1 is now consumed -- this throws an error:
// await chain1.next();

// chain2 is the active chain:
await chain2.next(); // { value: 2, done: false }
```

## 3. Transform Methods

The fluent API provides a rich set of transforms. Here are the most important ones.

### map -- Transform Each Value

Applies a synchronous function to every value passing through.

```typescript
const result = await PullChain.from(new SourceBufferObj(['hello', 'world']))
    .map(x => x.toUpperCase())
    .collect();
// ['HELLO', 'WORLD']
```

### filter -- Keep Values Matching a Predicate

Drops values that do not satisfy the predicate. The predicate can be synchronous or asynchronous.

```typescript
// Synchronous predicate
const evens = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x % 2 === 0)
    .collect();
// [2, 4]

// Async predicate
const valid = await PullChain.from(new SourceBufferObj(items))
    .filter(async x => await isValid(x))
    .collect();
```

### flatMap -- One-to-Many Expansion

For each input value, calls an async generator that can yield zero or more output values. All yielded values are emitted before the next input is pulled.

```typescript
const result = await PullChain.from(new SourceBufferObj(['hello', 'world']))
    .flatMap(async function*(word) {
        for (const char of word) yield char;
    })
    .collect();
// ['h', 'e', 'l', 'l', 'o', 'w', 'o', 'r', 'l', 'd']
```

### reduce -- Running Accumulator

Applies a reducer to each value and yields every intermediate accumulator -- not just the final result. This is a streaming operator, so you see the running total as it builds up.

```typescript
const runningSums = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .reduce((item, accum) => (accum ?? 0) + item, 0)
    .collect();
// [1, 3, 6]
```

The reducer receives the current value as the first argument and the accumulator as the second. On the first call, if you provided an initial accumulator (the second argument to `.reduce()`), it is used; otherwise the accumulator is `undefined`.

### window -- Fixed-Size Groups

Collects values into fixed-size arrays. When the source ends, any trailing partial window is returned as the generator's **return value** (not yielded), so `collect()` does not include it.

```typescript
const batches = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .window(3)
    .collect();
// [[1, 2, 3]]  -- the trailing [4, 5] is the generator return value, not yielded
```

### buffer -- Dynamic Grouping

Like `window`, but flushes based on a condition function rather than a fixed size. The condition receives the current buffer and returns `true` when it should be flushed. When the source ends, if the remaining buffer satisfies the condition, it is returned as the generator's **return value** (not yielded), so `collect()` does not include it.

```typescript
const batches = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .buffer(buf => buf.length >= 3 || buf.reduce((a, b) => a + b, 0) > 10)
    .collect();
// [[1, 2, 3]]  -- the trailing [4, 5] satisfies the condition, but is the return value, not yielded
```

### dedupe -- Remove Duplicates

Removes duplicate values from the stream. With no arguments, uses strict equality. Pass a key-extraction function or a property name string to deduplicate by a derived key.

```typescript
// Simple value deduplication
const unique = await PullChain.from(new SourceBufferObj([1, 1, 2, 2, 3, 3]))
    .dedupe()
    .collect();
// [1, 2, 3]

// Deduplicate objects by a property
const users = [
    { id: 1, name: 'Alice' },
    { id: 1, name: 'Alice (dup)' },
    { id: 2, name: 'Bob' },
];
const uniqueUsers = await PullChain.from(new SourceBufferObj(users))
    .dedupe(item => item.id)
    .collect();
// [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
```

## 4. Terminal Methods

Terminals consume the pipeline and produce a final result. After a terminal completes, the chain is exhausted.

### collect() -- Gather All Values

Pulls every value and returns them as an array.

```typescript
const all = await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .map(x => x * 10)
    .collect();
// [10, 20, 30]
```

### first() -- Get Just the First Value

Pulls a single value and returns it. The rest of the pipeline is not consumed, which is useful for "peek" or "top-1" patterns.

```typescript
const top = await PullChain.from(new SourceBufferObj([10, 20, 30]))
    .first();
// 10
```

### forEach(fn) -- Process Each Value

Pulls all values and calls a callback on each one. The callback can be synchronous or asynchronous.

```typescript
await PullChain.from(new SourceBufferObj([1, 2, 3]))
    .forEach(item => console.log(item));
// Logs: 1, 2, 3
```

### for await...of -- Standard Async Iteration

Since `PullChain` implements `AsyncIterable`, you can use a standard `for await...of` loop. This gives you full control over when to break out of the iteration.

```typescript
const chain = PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .map(x => x * 2);

for await (const item of chain) {
    console.log(item); // 2, 4, 6, 8, 10
}
```

## 5. The pipe() Escape Hatch

The fluent API covers the most common transforms, but when you need something it does not provide -- a custom Obj class, a third-party transform, or a specialized timeout -- use `pipe()`. It receives the current pipeline tail as a source and expects you to return a new `PullObj`.

```typescript
import { PullChain, SourceBufferObj, PullTimeoutObj } from '@firebrandanalytics/shared-utils';

const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .map(x => x * 2)
    .pipe(src => new PullTimeoutObj(src, 5000, true))
    .collect();
```

This is particularly useful for integrating classes that have constructor parameters beyond what the fluent API exposes.

## 6. Mutable Configuration

One advantage of the Obj pattern underlying these chains is that configuration is exposed as **public mutable properties**. You can change a filter predicate, a map function, or a window size while the stream is running.

When you need this level of control, work with the Obj classes directly instead of the fluent chain:

```typescript
import { SourceBufferObj, PullFilterObj } from '@firebrandanalytics/shared-utils';

const source = new SourceBufferObj([1, 2, 3, 4, 5, 6]);
const filter = new PullFilterObj(source, n => n % 2 === 0);

const first = await filter.next(); // { value: 2, done: false }

// Swap the predicate mid-stream
filter.filter = n => n % 2 === 1;

for await (const n of filter) {
    console.log(n); // 3, 5
}
```

Configuration changes take effect immediately -- the new predicate (or transform, or window size) is read on every iteration. This is useful for adaptive pipelines where external conditions determine processing behavior at runtime.

## 7. Practical Example: Log Processing Pipeline

Here is a more realistic pipeline that filters, deduplicates, truncates, and batches log entries:

```typescript
import { PullChain, SourceBufferObj } from '@firebrandanalytics/shared-utils';

interface LogEntry {
    timestamp: number;
    level: string;
    message: string;
}

// Imagine `logs` is an array of log entries loaded from a file or API
const logs: LogEntry[] = [
    { timestamp: 1700000000, level: 'ERROR', message: 'Connection refused to database host' },
    { timestamp: 1700000001, level: 'INFO',  message: 'Health check passed' },
    { timestamp: 1700000002, level: 'WARN',  message: 'Retry limit approaching' },
    { timestamp: 1700000003, level: 'ERROR', message: 'Connection refused to database host' },
    { timestamp: 1700000004, level: 'ERROR', message: 'Timeout waiting for response from upstream' },
    { timestamp: 1700000005, level: 'WARN',  message: 'Retry limit approaching' },
    // ... potentially thousands more
];

const result = await PullChain.from(new SourceBufferObj<LogEntry>(logs))
    // Keep only errors and warnings
    .filter(entry => entry.level === 'ERROR' || entry.level === 'WARN')
    // Remove duplicate messages (keeps the first occurrence)
    .dedupe(entry => entry.message)
    // Truncate long messages
    .map(entry => ({
        ...entry,
        message: entry.message.substring(0, 100),
    }))
    // Group into batches of 2
    .window(2)
    // Wrap each batch with metadata
    .map(batch => ({ count: batch.length, entries: batch }))
    .collect();

// result: [{ count: 2, entries: [
//   { timestamp: 1700000000, level: 'ERROR', message: 'Connection refused to database host' },
//   { timestamp: 1700000002, level: 'WARN',  message: 'Retry limit approaching' },
// ]}]
// Note: the third entry is the trailing partial window (generator return value), not yielded by collect()
```

Because the pipeline is lazy, each log entry flows through all stages one at a time. If you replaced `.collect()` with `.first()`, only enough entries would be processed to fill the first batch -- the rest of the source would never be touched.

## 8. Next Steps

Now that you can build and consume pull pipelines, explore these topics next:

- [Combining Streams](./combining-streams.md) -- merge multiple sources with race, round-robin, concat, and zip
- [Push Pipeline Basics](./push-pipeline-basics.md) -- event dispatching with forking and branching
- [PullChain API Reference](../reference/pull-chain.md) -- complete API including mid-chain merge, dynamic mutation, and introspection
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- all Obj classes with full constructor signatures and mutable properties
