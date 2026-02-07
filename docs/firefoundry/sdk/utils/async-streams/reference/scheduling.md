# Scheduling Reference

API reference for the scheduling subsystem of the async streams library. This subsystem provides multi-resource capacity management, DAG-based dependency tracking, priority queuing with starvation prevention, and task pool runners that combine these primitives into a complete execution engine.

For design philosophy and how these pieces fit into the broader async streams architecture, see the [Conceptual Guide](../concepts.md).

```typescript
import {
    ResourceCost, ResourceCapacitySource,
    NodeState, DependencyGraph,
    DependencySourceObj, PrioritySourceObj, PriorityDependencySourceObj,
    ScheduledTask, TASK_RUNNER, STREAMING_TASK_RUNNER, TaskProgressEnvelope,
    ScheduledTaskPoolRunner, HierarchicalTaskPoolRunner,
} from '@firebrandanalytics/shared-utils';
```

---

## Types

### ResourceCost

A dictionary mapping resource names to numeric amounts. Used throughout the scheduling subsystem to express how much of each resource a task requires or how much capacity remains.

```typescript
export type ResourceCost = Record<string, number>;
```

```typescript
// A task requiring 4 GPUs, 2 CPU cores, and 8 GB of memory
const cost: ResourceCost = { gpu: 4, cpu: 2, memory_gb: 8 };

// A simple single-dimension cost (the default for ScheduledTask)
const simpleCost: ResourceCost = { capacity: 1 };
```

---

### NodeState

The possible states of a node in a `DependencyGraph`. Nodes follow a strict state machine:

```typescript
export type NodeState = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'aborted';
```

**State machine transitions:**

```
pending ──→ ready         (all dependencies completed)
ready ──→ running         (start() called)
running ──→ completed     (complete() called)
running ──→ failed ──→ ready   (fail() called; retryable)
any non-completed ──→ aborted  (abort() called; cascades to dependents)
```

A node enters `pending` if it has unfinished dependencies when added. It transitions to `ready` once all dependencies reach `completed`. The `failed` state is transient -- it immediately transitions back to `ready` for retry.

---

### ScheduledTask\<I, O\>

A descriptor that bundles a task runner with its resource cost and lifecycle callbacks.

```typescript
export type ScheduledTask<I = unknown, O = unknown> = {
    key: string;
    runner: TASK_RUNNER<O> | STREAMING_TASK_RUNNER<I, O>;
    cost?: ResourceCost;      // default: { capacity: 1 }
    onComplete?: (key: string, result: O | undefined) => void;
    onError?: (key: string, error: unknown) => void;
};
```

| Field | Description |
|-------|-------------|
| `key` | Unique identifier for this task |
| `runner` | The function to execute (see TASK_RUNNER and STREAMING_TASK_RUNNER below) |
| `cost` | Resource cost for capacity management. Defaults to `{ capacity: 1 }` if omitted. |
| `onComplete` | Called when the task finishes successfully |
| `onError` | Called when the task throws an error |

---

### TASK_RUNNER\<O\>

A simple async function that returns a single result.

```typescript
export type TASK_RUNNER<O> = () => Promise<O>;
```

---

### STREAMING_TASK_RUNNER\<I, O\>

An async generator that yields intermediate results of type `I` and returns a final result of type `O`.

```typescript
export type STREAMING_TASK_RUNNER<I, O = I> = () => AsyncGenerator<I, O, void>;
```

---

### TaskProgressEnvelope\<I, O\>

Wraps task progress events emitted by the pool runners.

```typescript
export type TaskProgressEnvelope<I, O> = {
    taskId: number;
    type: 'INTERMEDIATE' | 'FINAL' | 'ERROR';
    value?: I | O;
    error?: any;
};
```

| Type | Meaning |
|------|---------|
| `INTERMEDIATE` | A streaming task yielded a progress value (`value` is of type `I`) |
| `FINAL` | A task completed successfully (`value` is of type `O`) |
| `ERROR` | A task threw an error (`error` is populated) |

---

## ResourceCapacitySource

Multi-resource capacity manager with atomic try-acquire-all-or-nothing semantics. Supports hierarchical chains where a child must have both local AND parent capacity to permit acquisition.

**Constructor:**

```typescript
constructor(limits: ResourceCost, parent?: ResourceCapacitySource)
```

| Parameter | Description |
|-----------|-------------|
| `limits` | Maximum capacity for each resource. All values must be non-negative. |
| `parent` | Optional parent capacity source. Acquisitions must succeed at both local and parent levels. |

The constructor validates that all limit values are non-negative and copies them into internal available counters.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `limits` | `Readonly<ResourceCost>` | Maximum capacity for each resource |
| `available` | `Readonly<ResourceCost>` | Currently available resources (returns a copy) |
| `utilization` | `Readonly<ResourceCost>` | Per-resource usage ratio: `(limits - available) / limits`. Returns 0.0 (idle) to 1.0 (fully used). Resources with a limit of 0 report 0. |
| `waitObj` | `WaitObject<boolean>` | Signaled on `release()` and `setLimits()` to wake retry loops |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `peek` | `peek(): ResourceCost \| undefined` | Returns available budget if every resource has some availability; returns `undefined` if ANY resource is fully exhausted. If a parent exists, returns the per-resource minimum of local and parent availability. |
| `canAcquire` | `canAcquire(cost: ResourceCost): boolean` | Synchronous check: can ALL resources in `cost` be satisfied? Checks local AND parent chain recursively. Resources in `cost` that are not tracked locally are ignored locally but still checked against the parent. Returns `false` for negative amounts. |
| `acquireImmediate` | `acquireImmediate(cost: ResourceCost): void` | Synchronous atomic decrement. **Only call after `canAcquire()` returns `true`.** JS single-threaded event loop guarantees no interleaving between the check and the acquire. Throws if any resource is insufficient (indicates a programming error). If parent acquisition fails, rolls back local changes. |
| `release` | `release(cost: ResourceCost): void` | Releases resources back. Clamps each resource to its limit (prevents over-release). Releases the same cost from the parent. Signals `waitObj` to wake waiters. |
| `setLimits` | `setLimits(newLimits: ResourceCost): void` | Adjusts capacity limits at runtime. Increasing a limit grows available capacity by the delta. Decreasing shrinks available (clamped to 0) — in-flight tasks are not revoked and release against the new ceiling. Supports partial updates (only specified keys change). Can add new resource keys. Signals `waitObj`. Throws on negative values. |
| `validateCost` | `validateCost(cost: ResourceCost): boolean` | Checks if a cost is satisfiable in principle (no resource exceeds total capacity). Call at enqueue time to reject impossible tasks early. Checks the parent chain recursively. |

**Usage Example:**

```typescript
// Define a capacity pool with 8 GPUs and 32 GB memory
const capacity = new ResourceCapacitySource({ gpu: 8, memory_gb: 32 });

// Check and acquire resources for a task
const taskCost: ResourceCost = { gpu: 2, memory_gb: 8 };

if (capacity.canAcquire(taskCost)) {
    capacity.acquireImmediate(taskCost);
    console.log(capacity.available); // { gpu: 6, memory_gb: 24 }
}

// Release when task completes
capacity.release(taskCost);
console.log(capacity.available); // { gpu: 8, memory_gb: 32 }
```

**Hierarchical Example:**

```typescript
// Global limit: 16 GPUs across all pools
const global = new ResourceCapacitySource({ gpu: 16 });

// Team limit: 8 GPUs, but still bound by global
const team = new ResourceCapacitySource({ gpu: 8 }, global);

const bigTask: ResourceCost = { gpu: 6 };
console.log(team.canAcquire(bigTask)); // true (6 <= 8 local, 6 <= 16 global)

team.acquireImmediate(bigTask);
// team.available = { gpu: 2 }, global.available = { gpu: 10 }

// Another team with the same global parent
const team2 = new ResourceCapacitySource({ gpu: 12 }, global);
const hugeTask: ResourceCost = { gpu: 11 };
console.log(team2.canAcquire(hugeTask)); // false (11 <= 12 local, but 11 > 10 global)
```

---

## HierarchicalBalancer

Periodic control loop that monitors child `ResourceCapacitySource` utilization over time and incrementally rebalances — shrinking idle children and growing busy children. Uses sustained observation (time thresholds) to avoid reacting to momentary spikes.

**Constructor:**

```typescript
constructor(children: BalancerChildConfig[], options?: HierarchicalBalancerOptions)
```

**`BalancerChildConfig`:**

| Field | Type | Description |
|-------|------|-------------|
| `capacity` | `ResourceCapacitySource` | The child capacity source to manage |
| `min` | `ResourceCost` | Floor per resource — child will never be shrunk below these |
| `max` | `ResourceCost` | Ceiling per resource — child will never be grown above these |

**`HierarchicalBalancerOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `checkIntervalMs` | `number` | `1000` | How often to sample utilization (ms) |
| `idleTimeThresholdMs` | `number` | `5000` | How long a child must be continuously idle before shrinking (ms) |
| `busyTimeThresholdMs` | `number` | `5000` | How long a child must be continuously busy before growing (ms) |
| `idleThreshold` | `number` | `0.3` | Utilization ratio below which a child is considered idle |
| `busyThreshold` | `number` | `0.85` | Utilization ratio above which a child is considered busy |
| `increment` | `ResourceCost` | `{ <key>: 1 }` for each key in min/max | Amount to adjust per rebalance step |

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `running` | `boolean` | Whether the periodic check loop is active |
| `options` | `Readonly<Required<HierarchicalBalancerOptions>>` | Current options (read-only) |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `start(): void` | Start the periodic rebalancing loop (idempotent) |
| `stop` | `stop(): void` | Stop the periodic loop (idempotent) |
| `check` | `check(): void` | Run a single rebalance check manually (for testing or one-shot use) |

**Behavior:**

- A child is **idle** when ALL resources are below `idleThreshold`.
- A child is **busy** when ANY resource is above `busyThreshold`.
- Shrinking: decreases the child's limit by `increment` (per resource), clamped to `min`.
- Growing: increases the child's limit by `increment` (per resource), clamped to `max`.
- After each shrink/grow action, the time tracker resets — the next adjustment requires another full threshold period.

**Example:**

```typescript
import { ResourceCapacitySource, HierarchicalBalancer } from '@firebrandanalytics/shared-utils';

const cluster = new ResourceCapacitySource({ gpu: 16 });
const teamA = new ResourceCapacitySource({ gpu: 12 }, cluster);
const teamB = new ResourceCapacitySource({ gpu: 12 }, cluster);

const balancer = new HierarchicalBalancer([
  { capacity: teamA, min: { gpu: 4 }, max: { gpu: 15 } },
  { capacity: teamB, min: { gpu: 4 }, max: { gpu: 15 } },
], {
  checkIntervalMs: 1000,
  idleTimeThresholdMs: 5000,
  busyTimeThresholdMs: 5000,
  increment: { gpu: 1 },
});

balancer.start();
// Idle teams gradually shrink (down to 4 GPUs)
// Busy teams gradually grow (up to 15 GPUs)
// Call balancer.stop() when done
```

---

## DependencyGraph\<K\>

Generic directed acyclic graph (DAG) for task dependency tracking with an explicit state machine. Cycle detection is incremental -- cycles are caught at insertion time, not as a post-hoc validation.

**Constructor:**

```typescript
constructor()
```

Creates an empty graph with no nodes.

**Callbacks:**

| Callback | Signature | Description |
|----------|-----------|-------------|
| `onReady` | `(key: K) => void` | Called when a node transitions to `ready` |
| `onComplete` | `(key: K) => void` | Called when a node transitions to `completed` |

Assign these after construction. They fire synchronously during state transitions.

**Construction Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `addNode` | `addNode(key: K, dependencies?: K[]): void` | Adds a node. If all dependencies are already completed (or none are specified), the node starts as `ready` and fires `onReady`. Throws if `key` already exists. Throws if any dependency does not exist. Throws if adding would create a cycle (with full rollback). |
| `addAll` | `addAll(deps: Map<K, K[]>): void` | Batch add with automatic topological ordering of input. Internally sorts the input map so that dependencies are added before dependents. Performs cycle detection on the input. |

**State Transition Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `start(key: K): void` | `ready` to `running`. Throws if the node is not in `ready` state. |
| `complete` | `complete(key: K): K[]` | `running` to `completed`. Returns an array of keys that became `ready` as a result. Fires `onComplete` for the completed node, then fires `onReady` for each newly-ready dependent. |
| `fail` | `fail(key: K): void` | `running` to `ready` (for retry). Fires `onReady`. |
| `abort` | `abort(key: K): K[]` | Any non-terminal state to `aborted`. Cascades to ALL transitive dependents via BFS. Returns all aborted keys. Skips nodes that are already `completed` or already `aborted`. |

**Query Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `ready` | `ReadonlySet<K>` | Nodes currently in `ready` state |
| `running` | `ReadonlySet<K>` | Nodes currently in `running` state |
| `completed` | `ReadonlySet<K>` | Nodes currently in `completed` state |
| `size` | `number` | Total number of nodes in the graph |
| `isDone` | `boolean` | `true` when `completed.size + aborted.size === size` |

**Query Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `getState` | `getState(key: K): NodeState` | Returns the current state of a node |
| `getDependencies` | `getDependencies(key: K): ReadonlySet<K>` | Returns the set of nodes this node depends on |
| `getDependents` | `getDependents(key: K): ReadonlySet<K>` | Returns the set of nodes that depend on this node |
| `has` | `has(key: K): boolean` | Whether a node with this key exists |
| `hasCycle` | `hasCycle(): boolean` | Full DFS cycle detection. Should always return `false` on a well-constructed graph (since `addNode` prevents cycles). Useful for assertions. |
| `topologicalSort` | `topologicalSort(): K[]` | Returns all keys in dependency order (dependencies before dependents) |

**Usage Example:**

```typescript
const graph = new DependencyGraph<string>();

// Wire up callbacks
graph.onReady = (key) => console.log(`Ready: ${key}`);
graph.onComplete = (key) => console.log(`Complete: ${key}`);

// Build the graph
graph.addNode('fetch-data');         // No deps → immediately ready
graph.addNode('parse', ['fetch-data']);
graph.addNode('validate', ['parse']);
graph.addNode('transform', ['parse']);
graph.addNode('save', ['validate', 'transform']);

// Execute
graph.start('fetch-data');
const newlyReady = graph.complete('fetch-data');
// newlyReady: ['parse']

graph.start('parse');
const afterParse = graph.complete('parse');
// afterParse: ['validate', 'transform']

// Both can run in parallel
graph.start('validate');
graph.start('transform');
graph.complete('validate');
graph.complete('transform');
// 'save' is now ready

console.log(graph.isDone); // false -- 'save' still pending
graph.start('save');
graph.complete('save');
console.log(graph.isDone); // true
```

**Batch Add Example:**

```typescript
const graph = new DependencyGraph<string>();

graph.addAll(new Map([
    ['save', ['validate', 'transform']],
    ['fetch-data', []],
    ['parse', ['fetch-data']],
    ['validate', ['parse']],
    ['transform', ['parse']],
]));
// addAll topologically sorts the input, so order in the map does not matter.
// 'fetch-data' is immediately ready.
```

**Abort Cascade Example:**

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('a');
graph.addNode('b', ['a']);
graph.addNode('c', ['b']);
graph.addNode('d', ['b']);

graph.start('a');

// Abort 'a' cascades to all transitive dependents
const aborted = graph.abort('a');
// aborted: ['a', 'b', 'c', 'd']
console.log(graph.isDone); // true (all aborted)
```

---

## Source Objects

These classes adapt scheduling primitives (dependency graphs, priority queues) into the `PullObj` / `Peekable` interface so they can be consumed by task pool runners.

### DependencySourceObj\<K, T\>

`PullObj` adapter for `DependencyGraph`. Yields tasks whose dependencies are satisfied. Tasks are yielded in the order they become ready.

**Extends:** `SourceObj<T>`
**Implements:** `Peekable<T>`

**Constructor:**

```typescript
constructor(graph: DependencyGraph<K>, taskMap: Map<K, T>)
```

| Parameter | Description |
|-----------|-------------|
| `graph` | The dependency graph governing task ordering |
| `taskMap` | Maps graph keys to the actual task values to yield |

The constructor wires the graph's `onReady` callback to signal an internal `WaitObject`, which wakes the pull loop. If an `onReady` callback already exists on the graph, it is preserved and called first.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `dependencyGraph` | `DependencyGraph<K>` | Getter for the underlying graph |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `complete` | `complete(key: K): void` | Marks a task as completed in the graph. May unlock dependents. If `graph.isDone`, signals stop. |
| `fail` | `fail(key: K): void` | Marks a task as failed. Moves it back to `ready` for retry. |
| `abort` | `abort(key: K): K[]` | Permanently aborts a task and cascades to dependents. Returns all aborted keys. |
| `peek` | `peek(): T \| undefined` | Returns the task value for the first ready key that has not yet been started. Reads from `graph.ready` directly (not generator state). Throws if the key is missing from `taskMap`. |

**pull_impl behavior:** Runs a non-terminating loop. Spreads `graph.ready` into an array (to avoid set mutation issues during iteration), calls `graph.start(key)` for each ready node, and yields the corresponding task value from `taskMap`. When nothing is ready and the graph is not done, awaits the internal `WaitObject`. Returns when `graph.isDone`.

**Usage Example:**

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('a');
graph.addNode('b', ['a']);
graph.addNode('c', ['a']);

const tasks = new Map([
    ['a', { name: 'Task A' }],
    ['b', { name: 'Task B' }],
    ['c', { name: 'Task C' }],
]);

const source = new DependencySourceObj(graph, tasks);

// Pull the first ready task
const first = await source.next();
// first.value = { name: 'Task A' } (only 'a' is ready)

// Complete 'a', which unlocks 'b' and 'c'
source.complete('a');

const second = await source.next();
const third = await source.next();
// 'b' and 'c' are yielded (order depends on set iteration)

source.complete('b');
source.complete('c');
// source is now done
```

---

### PrioritySourceObj\<T\>

Priority queue as a `PullObj` source with aging-based starvation prevention. Higher priority values are yielded first. When priorities are equal, the earliest-enqueued item wins (FIFO tiebreaker).

**Extends:** `SourceObj<T>`
**Implements:** `Peekable<T>`

**Constructor:**

```typescript
constructor(opts?: { agingRate?: number; maxAgeBoost?: number })
```

| Option | Default | Description |
|--------|---------|-------------|
| `agingRate` | `0` | Priority boost per millisecond of wait time. Set to `0` to disable aging. |
| `maxAgeBoost` | `Infinity` | Maximum aging boost. Caps the priority increase from aging. |

**Effective priority** = declared priority + min(agingRate * ageMs, maxAgeBoost).

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Number of items currently in the queue |
| `closed` | `boolean` | Whether the source has been closed |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `enqueue` | `enqueue(item: T, priority: number): void` | Adds an item at the given priority (higher = more important). Signals the internal `WaitObject`. Throws if the source is closed. |
| `closeSource` | `closeSource(): void` | Marks the source as closed. No more items can be enqueued. Sends a stop signal so the pull loop drains remaining items and terminates. |
| `peek` | `peek(): T \| undefined` | Returns the highest effective priority item without removing it |

**pull_impl behavior:** Drains all items in effective priority order, then waits for the internal signal. When `closeSource()` is called, drains any remaining items and returns.

**Usage Example:**

```typescript
const source = new PrioritySourceObj<string>();

source.enqueue('low-priority-task', 1);
source.enqueue('high-priority-task', 10);
source.enqueue('medium-priority-task', 5);

const first = await source.next();
// first.value = 'high-priority-task'

const second = await source.next();
// second.value = 'medium-priority-task'

source.closeSource();

const third = await source.next();
// third.value = 'low-priority-task'
// source is now done
```

**Aging Example:**

```typescript
// Aging prevents starvation: low-priority items gradually gain priority
const source = new PrioritySourceObj<string>({
    agingRate: 0.01,     // +0.01 priority per ms
    maxAgeBoost: 5,      // cap at +5 boost
});

source.enqueue('background', 1);
// After 500ms idle, effective priority = 1 + min(0.01 * 500, 5) = 6
// A newly enqueued item at priority 5 would now lose to 'background'
```

---

### PriorityDependencySourceObj\<K, T\>

Combines priority queuing with dependency tracking. Tasks become eligible when their dependencies are satisfied, then are served in priority order with optional aging.

**Extends:** `SourceObj<T>`
**Implements:** `Peekable<T>`

**Options Interface:**

```typescript
export interface PriorityDependencyOpts<K, T> {
    priorityFn?: (key: K, task: T) => number;  // default: () => 1
    agingRate?: number;                          // default: 0
    maxAgeBoost?: number;                        // default: Infinity
}
```

**Constructor:**

```typescript
constructor(
    graph: DependencyGraph<K>,
    taskMap: Map<K, T>,
    opts?: PriorityDependencyOpts<K, T>
)
```

| Parameter | Description |
|-----------|-------------|
| `graph` | The dependency graph governing task ordering |
| `taskMap` | Maps graph keys to task values. Throws if a ready key is missing from `taskMap` (prevents silent deadlock). |
| `opts` | Priority and aging configuration |

The constructor wires `graph.onReady` to enqueue newly-ready tasks into an internal priority queue. On construction, it also enqueues any nodes that are already in the `ready` state.

**Synchronous onReady path:** When `complete(key)` is called, the graph's `onReady` callback fires synchronously, which immediately enqueues newly-ready tasks and signals the `WaitObject`. There is no async gap between completion and enqueue.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `dependencyGraph` | `DependencyGraph<K>` | Getter for the underlying graph |
| `queueSize` | `number` | Items in the priority queue (excluding already-started tasks) |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `complete` | `complete(key: K): void` | Marks completed in graph. May enqueue dependents via `onReady`. If `isDone`, signals stop. |
| `fail` | `fail(key: K): void` | Marks failed. Moves back to `ready` for retry (`onReady` handles re-enqueue). |
| `abort` | `abort(key: K): K[]` | Permanently aborts task and cascades to dependents. Removes aborted tasks from the priority queue. Returns all aborted keys. |
| `peek` | `peek(): T \| undefined` | Returns the highest effective priority ready task (excluding already-started tasks) |
| `peekKey` | `peekKey(): K \| undefined` | Returns the key of the next task that would be yielded |

**Usage Example:**

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('fetch');
graph.addNode('parse', ['fetch']);
graph.addNode('analyze-a', ['parse']);
graph.addNode('analyze-b', ['parse']);
graph.addNode('report', ['analyze-a', 'analyze-b']);

const tasks = new Map([
    ['fetch',     { run: () => fetchData() }],
    ['parse',     { run: () => parseData() }],
    ['analyze-a', { run: () => analyzePartA() }],
    ['analyze-b', { run: () => analyzePartB() }],
    ['report',    { run: () => generateReport() }],
]);

const source = new PriorityDependencySourceObj(graph, tasks, {
    priorityFn: (key) => key === 'report' ? 10 : 1,
    agingRate: 0.001,
});

// 'fetch' is immediately ready and will be yielded first.
// After fetch completes and parse completes, both analyze tasks become ready.
// 'report' has priority 10 but cannot run until both analyses complete.

for await (const task of source) {
    const result = await task.run();
    // Caller is responsible for calling source.complete(key) after execution
}
```

---

## Task Pool Runners

### ScheduledTaskPoolRunner\<I, O\>

Task pool runner with multi-resource capacity management. Uses a synchronous peek-check-acquire protocol to avoid race conditions when starting tasks.

**Constructor:**

```typescript
constructor(
    name: string,
    source: PullObj<ScheduledTask<I, O>> & Peekable<ScheduledTask<I, O>>,
    capacity: ResourceCapacitySource
)
```

| Parameter | Description |
|-----------|-------------|
| `name` | Name for this runner (used in logging/diagnostics) |
| `source` | A pull source that yields `ScheduledTask` descriptors and supports `peek()` |
| `capacity` | The multi-resource capacity manager |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `runTasks` | `runTasks(stopOnError?: boolean): AsyncGenerator<TaskProgressEnvelope<I, O>, void, unknown>` | The main entry point. Returns an async generator that yields progress envelopes as tasks execute. |

**Execution Protocol:**

The runner operates in a fill-wait loop:

1. **Fill phase:** While the source has items and resources are available:
   - `peek()` the source for the next task descriptor
   - Read `task.cost` (defaults to `{ capacity: 1 }` if omitted)
   - Call `canAcquire(cost)` on the capacity source
   - If affordable: consume the task from the source, call `acquireImmediate(cost)`, start the task
   - If not affordable but other tasks are running: break to the wait phase
   - If not affordable and no tasks are running: wait for capacity release (via `waitObj`)
2. **Done check:** If `source.done` and no tasks are in-flight, return.
3. **Wait phase:** Race all running tasks against the capacity signal:
   - If capacity was released: loop back to the fill phase
   - If a streaming task yielded `INTERMEDIATE`: yield the progress envelope, continue
   - If a task completed (`FINAL`): release resources, fire `onComplete`, yield envelope
   - If a task errored: release resources, fire `onError`, yield `ERROR` envelope

**Key behaviors:**

- **Streaming detection:** Distinguishes streaming from regular tasks by checking `Symbol.asyncIterator in result`, not string-based constructor name checks.
- **Regular task wrapping:** Non-streaming tasks (returning a `Promise`) are wrapped in one-shot async generators internally.
- **Resource release on setup failure:** If a task throws during initialization, resources are released immediately.
- **Cached capacity promise:** The runner caches the capacity wait promise to prevent orphaned `.next()` calls across loop iterations.
- **Post-consume re-check:** After consuming a task from the source (which may be dynamic), the runner re-checks affordability before acquiring resources.

**Usage Example:**

```typescript
import {
    ScheduledTaskPoolRunner, ResourceCapacitySource,
    PrioritySourceObj, ScheduledTask, TaskProgressEnvelope,
} from '@firebrandanalytics/shared-utils';

// Set up capacity: 4 concurrent tasks, 16 GB memory
const capacity = new ResourceCapacitySource({ capacity: 4, memory_gb: 16 });

// Set up a priority source of ScheduledTask descriptors
const source = new PrioritySourceObj<ScheduledTask<string, string>>();

// Enqueue tasks
source.enqueue({
    key: 'task-1',
    runner: async () => {
        const result = await processItem('data-1');
        return result;
    },
    cost: { capacity: 1, memory_gb: 4 },
    onComplete: (key, result) => console.log(`${key} done:`, result),
    onError: (key, err) => console.error(`${key} failed:`, err),
}, 5);

source.enqueue({
    key: 'task-2',
    runner: async function*() {
        yield 'step 1 done';
        yield 'step 2 done';
        return 'final result';
    },
    cost: { capacity: 2, memory_gb: 8 },
}, 10);

source.closeSource();

// Run the pool
const runner = new ScheduledTaskPoolRunner('my-pool', source, capacity);

for await (const envelope of runner.runTasks()) {
    switch (envelope.type) {
        case 'INTERMEDIATE':
            console.log(`Task ${envelope.taskId} progress:`, envelope.value);
            break;
        case 'FINAL':
            console.log(`Task ${envelope.taskId} completed:`, envelope.value);
            break;
        case 'ERROR':
            console.error(`Task ${envelope.taskId} error:`, envelope.error);
            break;
    }
}
```

**With Dependency Graph:**

```typescript
import {
    ScheduledTaskPoolRunner, ResourceCapacitySource,
    DependencyGraph, PriorityDependencySourceObj,
    ScheduledTask,
} from '@firebrandanalytics/shared-utils';

const graph = new DependencyGraph<string>();
graph.addNode('download');
graph.addNode('extract', ['download']);
graph.addNode('index', ['extract']);

type Task = ScheduledTask<void, string>;

const taskMap = new Map<string, Task>([
    ['download', {
        key: 'download',
        runner: async () => { /* ... */ return 'downloaded'; },
        cost: { capacity: 1, network: 1 },
    }],
    ['extract', {
        key: 'extract',
        runner: async () => { /* ... */ return 'extracted'; },
        cost: { capacity: 1, memory_gb: 8 },
    }],
    ['index', {
        key: 'index',
        runner: async () => { /* ... */ return 'indexed'; },
        cost: { capacity: 1, cpu: 4 },
    }],
]);

const source = new PriorityDependencySourceObj(graph, taskMap);
const capacity = new ResourceCapacitySource({
    capacity: 4, network: 2, memory_gb: 32, cpu: 8,
});

const runner = new ScheduledTaskPoolRunner('etl-pipeline', source, capacity);

for await (const envelope of runner.runTasks()) {
    if (envelope.type === 'FINAL') {
        // Bridge pattern: notify the source so it can unlock dependents
        const key = taskMap.get(/* resolve key from taskId */);
        // In practice, the bridge callback wiring handles this (see Common Patterns)
    }
}
```

---

### HierarchicalTaskPoolRunner\<I, O\> (Legacy)

Legacy task pool runner using a single-counter `CapacitySource` instead of multi-resource `ResourceCapacitySource`. Prefer `ScheduledTaskPoolRunner` for new code.

**Constructor:**

```typescript
constructor(
    name: string,
    source: PullObj<any> & Peekable<any>,
    capacitySource: CapacitySource
)
```

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `runTasks` | `runTasks(stopOnError?: boolean): AsyncGenerator<TaskProgressEnvelope<I, O>, void, unknown>` | The main entry point |

**Key differences from ScheduledTaskPoolRunner:**

| Aspect | ScheduledTaskPoolRunner | HierarchicalTaskPoolRunner (Legacy) |
|--------|------------------------|-------------------------------------|
| Capacity model | Multi-resource `ResourceCapacitySource` | Single counter `CapacitySource` |
| Task source | Yields `ScheduledTask` descriptors | Yields raw runner functions |
| Streaming detection | `Symbol.asyncIterator in result` (reliable) | String-based constructor name check (fragile, breaks with minification) |
| Acquire protocol | Synchronous peek-check-acquire | Async `acquire()` |

---

## Common Patterns

### Bridge Pattern: Wiring Lifecycle Callbacks

The scheduling subsystem separates concerns: the source objects manage task ordering and the pool runner manages execution. A bridge is needed so that task completion in the runner feeds back into the source.

The standard approach is to wire `ScheduledTask.onComplete` and `onError` callbacks to call the source's `complete()` and `fail()` methods:

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('a');
graph.addNode('b', ['a']);
graph.addNode('c', ['a']);

const source = new PriorityDependencySourceObj(graph, new Map(), {
    priorityFn: () => 1,
});

// Build tasks with bridge callbacks
function makeTask(key: string, work: () => Promise<string>): ScheduledTask<void, string> {
    return {
        key,
        runner: work,
        cost: { capacity: 1 },
        onComplete: (k) => source.complete(k),
        onError: (k, err) => {
            console.error(`Task ${k} failed, retrying:`, err);
            source.fail(k);
        },
    };
}

const taskMap = new Map([
    ['a', makeTask('a', () => doWorkA())],
    ['b', makeTask('b', () => doWorkB())],
    ['c', makeTask('c', () => doWorkC())],
]);

// Re-create the source with the populated task map
const wiredSource = new PriorityDependencySourceObj(graph, taskMap);
// (In practice, build taskMap before constructing the source.)
```

### Peek-Check-Acquire Protocol

The `ScheduledTaskPoolRunner` uses a three-step synchronous protocol to avoid race conditions when acquiring resources:

```typescript
// Step 1: Peek at the next task without consuming it
const task = source.peek();
if (!task) break;

// Step 2: Check if resources are available (synchronous)
if (!capacity.canAcquire(task.cost ?? { capacity: 1 })) {
    // Wait for resources to free up
    break;
}

// Step 3: Consume and acquire (synchronous, no interleaving possible)
const consumed = await source.next(); // consume
capacity.acquireImmediate(consumed.value.cost ?? { capacity: 1 });
// Task is now running with resources reserved
```

Because steps 2 and 3 are synchronous (no `await` between the `canAcquire` check and the `acquireImmediate` call), the JavaScript single-threaded event loop guarantees that no other code can acquire the same resources between the check and the acquisition. The `source.next()` call in step 3 is async, but the runner re-checks affordability after it resolves (since a dynamic source might return a different task than what was peeked).

---

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, pull vs push models, the Obj pattern
- [Pull Obj Classes Reference](./pull-obj-classes.md) -- SourceObj, PullObj, and the Peekable interface used by scheduling sources
- [Pull Chain API Reference](./pull-chain.md) -- Fluent pipeline builder
