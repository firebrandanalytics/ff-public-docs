# Push Pipeline Basics

This tutorial walks you through building push pipelines with `PushChainBuilder`. By the end you will understand the two-phase construction pattern, the core transform methods, every terminal method, and when to choose push over pull.

## 1. Introduction: What Is a Push Pipeline?

A push pipeline is **eager** and **divergent**. A producer pushes values into the head of the pipeline, and each stage forwards them to downstream sinks immediately -- no consumer needs to request them. This is the opposite of a pull pipeline, which is lazy and convergent (consumer pulls values on demand, multiple sources converge into one output). Push pipelines shine in the other direction: one input fans out to many outputs.

**When to reach for push:** event dispatching (one source broadcasts to multiple handlers), fan-out patterns (one stream feeds several processing branches), and broadcasting (every value must reach every subscriber).

```typescript
import { PushChainBuilder, SinkCollectObj } from '@firebrandanalytics/shared-utils';
```

## 2. PushChainBuilder: Two-Phase Construction

Push objects need a reference to their downstream sink at construction time. You cannot build a push chain top-down the way you build a pull chain, because the first stage needs to know about the second, which needs to know about the third, and so on down to the terminal sink. The chain must be wired **backwards** from the sink.

`PushChainBuilder` solves this with a two-phase pattern:

1. **Recipe phase** -- Fluent methods (`.map()`, `.filter()`, etc.) collect operations into an immutable recipe. Each call returns a **new** builder; the original is never modified.
2. **Build phase** -- A terminal method (`.into()`, `.fork()`, etc.) takes the recipe, starts from the terminal sink, and constructs the chain of `PushObj` instances backwards until it reaches the head.

The result is a `PushChain` -- a live pipeline you push values into.

```typescript
import { PushChainBuilder, SinkCollectObj } from '@firebrandanalytics/shared-utils';

const buffer: string[] = [];
const sink = new SinkCollectObj<string>(buffer);

const chain = PushChainBuilder.start<number>()
    .filter(n => n > 0)
    .map(n => `item-${n}`)
    .into(sink);

await chain.next(3);   // "item-3" -> buffer
await chain.next(-1);  // filtered out
await chain.next(7);   // "item-7" -> buffer
await chain.return();

console.log(buffer); // ["item-3", "item-7"]
```

`PushChainBuilder.start<number>()` creates a builder typed for `number` input. `.filter()` and `.map()` append operations to the recipe. `.into(sink)` triggers the backward build and returns the live `PushChain<number>`. Calling `chain.next(value)` pushes a value through the pipeline. Calling `chain.return()` signals graceful shutdown.

## 3. Transform Methods

Transform methods mirror many of the pull-side equivalents, but operate eagerly. Each one appends an operation to the builder recipe.

- **map** -- Transform each value: `.map(n => n * 2)`
- **filter** -- Drop values that fail a predicate: `.filter(n => n > 0)`
- **reduce** -- Running accumulator (emits each intermediate value, not just the final): `.reduce((sum, n) => sum + n, 0)`
- **window** -- Collect into fixed-size arrays: `.window(3)` yields `[1,2,3], [4,5,6], ...`
- **flatten** -- Flatten nested iterables so each element is pushed individually
- **serial** -- Serialize concurrent pushes (see below)
- **preCallback / postCallback** -- Side-effect callbacks before or after each value is forwarded

### serial -- Serialize concurrent pushes

By default, push stages process `next()` calls concurrently. If a producer fires `next(a)` and `next(b)` without awaiting the first, both values may be in flight simultaneously. Use `.serial()` when ordering matters.

These transforms can be combined freely. Here is a chain using several together:

```typescript
const chain = PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .map(s => s.trim())
    .serial()                      // serialize concurrent pushes
    .preCallback(s => console.log('Processing:', s))
    .into(sink);
```

## 4. Terminal Methods

Terminal methods consume the builder and produce a live `PushChain`. Each one determines the topology at the end of the pipeline.

### .into(sink) -- Single sink

The simplest terminal. Wires the entire recipe into one sink.

```typescript
const buffer: number[] = [];
const chain = PushChainBuilder.start<number>()
    .map(n => n * 2)
    .into(new SinkCollectObj(buffer));

await chain.next(5);
await chain.return();
console.log(buffer); // [10]
```

### .fork(...branches) -- Broadcast to ALL branches

Every value that reaches the fork point is pushed into every branch. Each branch callback receives a fresh `PushChainBuilder` so it can apply its own transforms and terminal independently.

```typescript
const logBuffer: string[] = [];
const archiveBuffer: string[] = [];
const logSink = new SinkCollectObj<string>(logBuffer);
const archiveSink = new SinkCollectObj<string>(archiveBuffer);

const chain = PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .fork(
        branch => branch.map(s => s.toUpperCase()).into(logSink),
        branch => branch.map(s => s.toLowerCase()).into(archiveSink),
    );

await chain.next("Hello");
// logSink receives "HELLO", archiveSink receives "hello"
await chain.return();
```

### .distribute(selector, ...branches) -- Route by selector function

Each value goes to exactly one branch. The selector returns a 0-based index.

```typescript
const chain = PushChainBuilder.start<LogEntry>()
    .distribute(
        entry => entry.level === 'ERROR' ? 0 : 1,
        branch => branch.into(errorSink),
        branch => branch.into(infoSink),
    );

await chain.next({ level: 'ERROR', message: 'disk full' });  // -> errorSink
await chain.next({ level: 'INFO', message: 'started' });     // -> infoSink
await chain.return();
```

### .roundRobinTo(...branches) -- Fair rotation

Values are distributed to branches in round-robin order, cycling through them. Useful for load balancing across multiple consumers.

```typescript
const worker1 = new SinkCollectObj<Task>();
const worker2 = new SinkCollectObj<Task>();
const worker3 = new SinkCollectObj<Task>();

const chain = PushChainBuilder.start<Task>()
    .roundRobinTo(
        branch => branch.into(worker1),
        branch => branch.into(worker2),
        branch => branch.into(worker3),
    );

await chain.next(taskA);  // -> worker1
await chain.next(taskB);  // -> worker2
await chain.next(taskC);  // -> worker3
await chain.next(taskD);  // -> worker1 (cycles back)
await chain.return();
```

### .toCallbacks(...fns) -- Convenience terminal with callbacks

Creates a terminal sink from plain callback functions. Each value is passed to every callback.

```typescript
const chain = PushChainBuilder.start<number>()
    .map(n => n * 2)
    .toCallbacks(
        n => console.log('Value:', n),
        n => metrics.track('processed', n),
    );

await chain.next(5);  // logs "Value: 10", tracks 10
```

### .toArray(buffer?) -- Convenience terminal collecting to an array

Returns both the chain and the buffer. If you provide an existing array, values are appended to it; otherwise a new array is created.

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

## 5. The pipe() Escape Hatch

When the built-in fluent methods do not cover your use case, `.pipe()` lets you insert any custom `PushObj` class into the recipe. You provide a factory that receives the downstream sink and returns your custom operator. This follows the same backward-construction pattern used internally.

```typescript
import { PushChainBuilder, PushSerialObj } from '@firebrandanalytics/shared-utils';

const chain = PushChainBuilder.start<number>()
    .pipe(sink => new PushSerialObj(sink))
    .into(finalSink);
```

## 6. Practical Example: Event Dispatcher

Here is a realistic example that ties together filtering, side effects, and forking. An application dispatches events to an audit log and routes errors to a separate buffer.

```typescript
import { PushChainBuilder, SinkCollectObj } from '@firebrandanalytics/shared-utils';

interface AppEvent {
    type: string;
    payload: any;
    timestamp: number;
}

const auditLog: AppEvent[] = [];
const errorBuffer: AppEvent[] = [];

const dispatcher = PushChainBuilder.start<AppEvent>()
    .preCallback(event => console.log(`[${event.type}]`, event.payload))
    .fork(
        // Branch 1: All events go to audit log
        branch => branch.into(new SinkCollectObj(auditLog)),
        // Branch 2: Only errors go to error buffer
        branch => branch
            .filter(e => e.type === 'error')
            .into(new SinkCollectObj(errorBuffer)),
    );

await dispatcher.next({ type: 'info', payload: 'started', timestamp: Date.now() });
await dispatcher.next({ type: 'error', payload: 'disk full', timestamp: Date.now() });
await dispatcher.next({ type: 'info', payload: 'recovered', timestamp: Date.now() });
await dispatcher.return();

console.log(auditLog.length);    // 3 -- every event
console.log(errorBuffer.length); // 1 -- only the error
```

The `preCallback` runs once per event before the fork, so every event is logged to the console. The fork then broadcasts to both branches. Branch 1 collects everything; branch 2 filters for errors first.

## 7. Push vs Pull: When to Choose Each

| Aspect | Pull (PullChain) | Push (PushChainBuilder) |
|--------|------------------|-------------------------|
| Data flow | Consumer pulls | Producer pushes |
| Laziness | Lazy -- work on demand | Eager -- immediate processing |
| Topology | Many-to-one (convergent) | One-to-many (divergent) |
| Use case | Data pipelines, ETL, combining sources | Event dispatch, fan-out, broadcasting |
| Concurrency | Sequential by default | Concurrent by default (use `.serial()` to serialize) |
| Construction | Forward from source | Backward from sink (via builder) |
| Branching | Mid-chain merge (many sources into one) | Terminal fork/distribute/roundRobin (one source to many sinks) |

**Rule of thumb:** If you have one producer and multiple consumers, use push. If you have multiple producers and one consumer, use pull. If you need both, use `PushPullBufferObj` to bridge the two models (see the [Utilities reference](../reference/utilities.md)).

## 8. Next Steps

- [Pull Pipeline Basics](./pull-pipeline-basics.md) -- Build lazy, demand-driven pipelines with PullChain.
- [Combining Streams](./combining-streams.md) -- Race, round-robin, concat, zip, and mid-chain merge.
- [PushChain API Reference](../reference/push-chain.md) -- Full API details including dynamic mutation (insertAfter, remove, replace).
- [Push Obj Classes Reference](../reference/push-obj-classes.md) -- Every PushObj class: constructors, properties, and examples.
