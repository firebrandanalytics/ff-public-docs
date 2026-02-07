# Conceptual Guide

This guide explains the core concepts and design philosophy behind the async streams library. It focuses on *why* the library is built this way and *how* to choose the right tools, rather than exhaustive API details (see the [API Reference](./reference/) for that).

## 1. The "Obj" Pattern: Structured, Composable Iterators

The foundation of the library is the "Obj" pattern. Instead of using raw `AsyncGenerator` functions, we wrap them in classes (`PullObj`, `PushObj`).

**Why use classes instead of raw generators?**

1. **Reusability and Composition.** A class instance is a solid component you can pass around, chain together, and compose into complex pipelines. A raw generator function is transient — once consumed, it's gone.

2. **Consistent Interface.** Every Obj implements the standard `AsyncGenerator` interface (`next()`, `return()`, `throw()`), guaranteeing predictable behavior for resource management and graceful shutdown.

3. **State and Configuration.** Classes hold state and expose mutable configuration. A `PullWindowObj` holds its window size; a `PullFilterObj` holds its predicate. You can change these mid-stream.

```typescript
// Every Obj is a structured component with a predictable lifecycle.
export class PullObj<T> implements AsyncIterable<T> {
    protected generator?: AsyncGenerator<T, T | undefined, void>;

    constructor() {
        this.generator = this.pull_impl();
    }

    // Subclasses implement their logic here.
    protected async* pull_impl(): AsyncGenerator<T, T | undefined, void> {
        return undefined;
    }

    // Standard async iterator methods ensure consistent behavior.
    public async next(): Promise<IteratorResult<T>> { /* ... */ }
    public async return(value?: T): Promise<IteratorResult<T>> { /* ... */ }
    public async throw(error?: any): Promise<IteratorResult<T>> { /* ... */ }
}
```

## 2. The Pull Model: Lazy, Convergent Processing

The pull model is **lazy** — work only happens when a value is requested ("pulled") by a consumer. It is **convergent** (many-to-one) — it excels at combining multiple input streams into a single output.

**Building Blocks:**

- **`SourceObj`**: The start of a chain. Generates values from an internal source (e.g., an array, a timer, or an external API).
- **`PullObj1To1Link`**: The middle. Pulls a value from one upstream source, transforms it, and passes it downstream.
- **`PullObjManyTo1Link`**: A combiner. Pulls from multiple upstream sources and produces a single output stream.
- **Consumer**: Typically a `for await...of` loop or a chain terminal method like `.collect()`.

```typescript
const source = new SourceBufferObj([1, 2, 3, 4, 5]);
const doubled = new PullMapObj(source, (n) => n * 2);

for await (const value of doubled) {
    console.log(value); // 2, 4, 6, 8, 10
}
```

**When to use pull:** Standard data processing pipelines, combining multiple data sources, any case where you want lazy evaluation.

The library provides 12+ single-stream transforms (map, filter, reduce, flatMap, window, buffer, dedupe, timeout, etc.), 6 multi-stream combiners (concat, zip, race, roundRobin, etc.), and labeled variants. See the [Pull Obj Classes Reference](./reference/pull-obj-classes.md) for the complete list.

## 3. The Push Model: Eager, Divergent Processing

The push model is the symmetric opposite of pull. It is **eager** — a producer pushes data into the pipeline as soon as it's available. It is **divergent** (one-to-many) — it excels at splitting a single input to multiple destinations.

**Building Blocks:**

- **Producer**: Any code that calls `sink.next(value)`.
- **`PushObj1To1`**: Receives a value, transforms it, pushes to a downstream sink.
- **`PushForkObj` / `PushDistributeObj` / `PushRoundRobinObj`**: One-to-many splitters — broadcast, route by selector, or round-robin.

```typescript
const sink = new SinkCollectObj<number>();
const filter = new PushFilterObj(sink, (n) => n > 3);
const mapper = new PushMapObj(filter, (n) => n * 10);

await mapper.next(2);  // filtered out (2 <= 3)
await mapper.next(5);  // passes: 50 pushed to sink
await mapper.return();
console.log(sink.buffer); // [50]
```

**Concurrency note:** `next()` calls on push objects can be made concurrently by default. Use `PushSerialObj` to serialize when ordering matters. See the [Push Obj Classes Reference](./reference/push-obj-classes.md).

## 4. Mutable Configuration: Changing Behavior Mid-Stream

A key advantage of the Obj pattern is that configuration is exposed as **public mutable members**. You can change a filter predicate, a map function, or a timeout value while the stream is running.

```typescript
const source = new SourceBufferObj([1, 2, 3, 4, 5, 6]);
const filter = new PullFilterObj(source, (n) => n % 2 === 0);

const first = await filter.next(); // { value: 2, done: false }

// Swap to odd numbers mid-stream
filter.filter = (n) => n % 2 === 1;

for await (const n of filter) {
    console.log(n); // 3, 5
}
```

**Lifecycle note:** Configuration members (`.filter`, `.transform`, `.time_out`) take effect immediately since they're read on each iteration. Source swaps take effect on the next `pull_impl()` cycle, after the current generator completes.

## 5. Fluent Pipeline Chains

While Obj classes are powerful, manually chaining them is verbose. The library provides `PullChain` and `PushChainBuilder`/`PushChain` for fluent, type-safe pipeline construction.

### PullChain

`PullChain<T>` extends `PullObj<T>` — a chain **is** a PullObj, usable anywhere a source is expected.

```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x % 2 === 0)     // 2, 4
    .map(x => x * 3)              // 6, 12
    .reduce((n, a) => (a ?? 0) + n, 0) // 6, 18
    .collect();                    // [6, 18]
```

**Key safety features:**
- **Consumed-chain safety**: Extending a chain marks the old reference as consumed. Calling `next()` on a consumed chain throws, preventing the shared-iterator bug.
- **Done-flag sync**: The chain's `done` property reflects the true state of the pipeline tail.
- **Close propagation**: Closing a chain tears down the entire pipeline.

See the [PullChain Reference](./reference/pull-chain.md) for the full API including mid-chain merge, dynamic mutation, and many-to-1 factories.

### PushChainBuilder

Push objects require a sink at construction. `PushChainBuilder` uses a two-phase pattern: collect operations, then build backwards from the terminal.

```typescript
const chain = PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .map(s => s.toUpperCase())
    .into(new SinkCollectObj(buffer));

await chain.next("hello"); // "HELLO" → buffer
await chain.return();
```

Branching terminals (`.fork()`, `.distribute()`, `.roundRobinTo()`) handle one-to-many patterns. See the [PushChain Reference](./reference/push-chain.md).

## 6. Scheduling: Dependency Graphs, Priority, and Resource Management

The scheduling subsystem provides production-grade task orchestration. It solves a common problem: *you have many tasks with dependencies between them, different resource requirements, and varying priorities — how do you execute them efficiently?*

### DependencyGraph

A directed acyclic graph (DAG) that tracks task dependencies with an explicit state machine:

```
pending → ready (all deps completed) → running → completed
                                       running → failed → ready (retry)
                                       any non-completed → aborted (cascade)
```

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('A');                    // No deps → immediately ready
graph.addNode('B', ['A']);             // Depends on A
graph.addNode('C', ['A']);             // Depends on A
graph.addNode('D', ['B', 'C']);        // Depends on B and C (diamond)

graph.start('A');                      // A: running
graph.complete('A');                   // A: completed → B,C become ready
```

Cycle detection is enforced at `addNode()` time. The `abort()` method cascades to all transitive dependents.

### ResourceCapacitySource

Multi-resource capacity management with atomic all-or-nothing acquisition:

```typescript
const capacity = new ResourceCapacitySource({
    cpu: 8,
    gpu: 2,
    memory_gb: 32,
});

capacity.canAcquire({ cpu: 4, gpu: 1 }); // true
capacity.acquireImmediate({ cpu: 4, gpu: 1 });
capacity.canAcquire({ cpu: 4, gpu: 2 }); // false — only 1 GPU left
capacity.release({ cpu: 4, gpu: 1 });
```

Supports **hierarchical parent/child chains** for quota enforcement (e.g., team capacity within department capacity within org capacity). Limits can be adjusted at runtime via `setLimits()` for dynamic rebalancing, and `HierarchicalBalancer` provides a prebuilt control loop that automatically shrinks idle children and grows busy ones.

### Priority with Aging

`PriorityDependencySourceObj` combines dependency ordering with priority-based scheduling. An **aging rate** prevents starvation: tasks that wait longer get a priority boost.

```typescript
const pdSource = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key, task) => task.priority,
    agingRate: 0.1,      // +0.1 priority per ms of wait time
    maxAgeBoost: 50,     // Cap the aging boost
});
```

### ScheduledTaskPoolRunner

The runner ties everything together. It pulls tasks from a source, checks resource affordability, acquires resources, runs the task, and releases resources on completion:

```
loop:
  1. peek() task from source
  2. canAcquire(task.cost) on capacity?
  3. acquireImmediate(task.cost)
  4. pull and start task
  5. on complete → release(cost), call onComplete
  6. on error → release(cost), call onError
```

```typescript
const runner = new ScheduledTaskPoolRunner('pipeline', source, capacity);
for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') console.log('Task done:', envelope.value);
    if (envelope.type === 'ERROR') console.error('Task failed:', envelope.error);
}
```

See the [Scheduling Reference](./reference/scheduling.md) and the [Scheduling Fundamentals Tutorial](./tutorials/scheduling-fundamentals.md).

## 7. Error Handling: Retry vs. Abort

The scheduling system supports two error recovery strategies, controlled by how you wire the `onError` callback:

**Retry (fail → ready):** Call `graph.fail(key)` to move the task back to `ready` state. It will be re-yielded by the source and re-executed. Combine with attempt counting and exponential backoff for production use.

**Abort (abort → cascade):** Call `graph.abort(key)` to permanently terminate the task and all its transitive dependents. Use when a task's failure means downstream work is pointless.

```typescript
// Bridge pattern: wire lifecycle callbacks
task.onComplete = (key) => graph.complete(key);
task.onError = (key, error) => {
    const attempts = retryCount.get(key) ?? 0;
    if (attempts >= maxRetries) {
        graph.abort(key);    // Give up, cascade abort
    } else {
        retryCount.set(key, attempts + 1);
        graph.fail(key);     // Retry
    }
};
```

See the [Retry and Error Handling Tutorial](./tutorials/retry-and-error-handling.md).

## 8. Combining Streams

The library provides several strategies for consuming multiple pull streams:

| Strategy | Behavior | Use when |
|----------|----------|----------|
| **Race** | Yields from whichever source produces first | Interleaving real-time streams |
| **Round Robin** | Takes one from each source in rotation | Fair consumption from multiple sources |
| **Concat** | Exhausts one source, then the next | Sequential processing in a defined order |
| **Zip** | Pairs corresponding items into tuples | Correlating items across sources |

These are available as both standalone Obj classes and as `PullChain` static factories / mid-chain merge methods. See the [Combining Streams Tutorial](./tutorials/combining-streams.md).

## 9. Class Hierarchy and Lifecycle

```
PullObj<T>                          (base — AsyncIterable<T>)
├── SourceObj<T>                    (generates values, no upstream)
├── PullObj1To1Link<IN,OUT>         (one upstream source)
├── PullObjManyTo1Link<IN,OUT>      (array of upstream sources)
├── PullObjLabeledManyTo1Link<L,IN,OUT>  (labeled map of sources)
└── PullChain<T>                    (fluent pipeline wrapper)

PushObj<T>                          (base — receives pushed values)
├── PushObj1To1<IN,OUT>             (one downstream sink)
├── PushForkObj<T>                  (broadcasts to all sinks)
├── PushDistributeObj<T>            (routes by selector)
├── PushRoundRobinObj<T>            (fair rotation to sinks)
└── PushChain<T>                    (fluent pipeline wrapper)
```

**Close propagation:** `close()` or `closeInterrupt()` propagates to all upstream sources, ensuring graceful shutdown of entire pipelines.

**Generator reinit:** When a `pull_impl()` generator completes, the base class can reinitialize it. This enables long-lived Obj instances that restart their logic cycle, picking up any configuration changes.

## 10. Bridging Push and Pull

The `PushPullBufferObj` bridges the two models. It exposes a push sink interface for producers and a pull source interface for consumers, with an internal buffer and `WaitObject` signaling.

Use it when you need to decouple a producer from a consumer, or create dynamic work queues. See [Utilities Reference](./reference/utilities.md).

## Next Steps

- **New to the library?** Start with the [Pull Pipeline Basics Tutorial](./tutorials/pull-pipeline-basics.md).
- **Need task scheduling?** Jump to [Scheduling Fundamentals](./tutorials/scheduling-fundamentals.md).
- **Looking for API details?** See the [Reference Documentation](./reference/).
- **Understanding flow control?** See [Flow Control](./flow-control.md) for production vs consumption rates, backpressure strategies, and a primitive selection guide.
- **Problem-focused walkthroughs?** See the [Use Cases](./use-cases/) directory.
- **Using FireFoundry?** See [Agent Integration](./firefoundry/agent-integration.md).
