# Scheduling Fundamentals

This tutorial walks you through building a task scheduling pipeline from scratch. No prior knowledge of the library is needed -- just TypeScript familiarity. By the end, you will understand how to model task dependencies, enforce resource limits, apply priority ordering, and execute everything through a single async iterator.

## 1. The Problem

You have many tasks with dependencies between them, different resource requirements, and varying priorities. You need to execute them efficiently -- running independent tasks in parallel, respecting ordering constraints, and staying within resource budgets.

The scheduling subsystem provides four building blocks:

| Component | Responsibility |
|---|---|
| `DependencyGraph` | Tracks which tasks depend on which, manages state transitions |
| `ResourceCapacitySource` | Enforces concurrency and resource limits |
| `PriorityDependencySourceObj` | Wires the graph to a priority queue, yielding tasks in the right order |
| `ScheduledTaskPoolRunner` | Pulls tasks from the source, acquires resources, executes, and emits results |

Let's build each piece step by step, then wire them together.

## 2. Step 1: Create a Dependency Graph

A dependency graph models the ordering constraints between tasks. We will build a classic diamond pattern where task A must complete before B and C can start, and both B and C must complete before D can start:

```
    A
   / \
  B   C
   \ /
    D
```

```typescript
import { DependencyGraph } from '@firebrandanalytics/shared-utils';

const graph = new DependencyGraph<string>();
graph.addNode('A');                     // No deps -- immediately ready
graph.addNode('B', ['A']);              // Depends on A
graph.addNode('C', ['A']);              // Depends on A
graph.addNode('D', ['B', 'C']);         // Depends on B and C (diamond)

console.log([...graph.ready]);          // ['A']
console.log(graph.size);               // 4
console.log(graph.isDone);             // false
```

Only `A` is ready because it has no dependencies. The other three tasks are pending, waiting for their upstream dependencies to complete.

### The State Machine

Every node in the graph follows this state machine:

```
pending --> ready (all deps completed) --> running --> completed
                                          running --> failed --> ready (retry)
                                   any non-completed --> aborted (cascade)
```

- **pending**: Waiting for upstream dependencies.
- **ready**: All dependencies are completed. The task can be started.
- **running**: Currently executing.
- **completed**: Finished successfully. Downstream dependents are re-evaluated.
- **failed**: Execution failed. The node moves back to ready for retry.
- **aborted**: An upstream dependency was aborted. Cascades downward.

### Walking Through State Transitions

Let's drive the graph manually to see the transitions in action:

```typescript
graph.start('A');                       // A: ready --> running
console.log([...graph.running]);        // ['A']

const newlyReady = graph.complete('A'); // A: running --> completed
console.log(newlyReady);               // ['B', 'C']
console.log([...graph.ready]);         // ['B', 'C']
```

When A completes, the graph checks every node that depends on A. Both B and C have all their dependencies completed (just A), so they transition from pending to ready. The `complete()` method returns the list of newly ready nodes so callers can react immediately.

```typescript
graph.start('B');                       // B: ready --> running
graph.start('C');                       // C: ready --> running
console.log([...graph.ready]);         // [] (nothing else is ready)

graph.complete('B');                    // B: completed, but D still waits for C
console.log([...graph.ready]);         // [] (D depends on both B and C)

graph.complete('C');                    // C: completed --> D becomes ready
console.log([...graph.ready]);         // ['D']
```

D only becomes ready when both B and C have completed. This is the diamond join in action.

## 3. Step 2: Create a Task Map

The dependency graph handles ordering but knows nothing about what each task actually does. For that, we create `ScheduledTask` descriptors and store them in a map keyed by the same identifiers used in the graph.

```typescript
import { ScheduledTask, ResourceCost } from '@firebrandanalytics/shared-utils';

type Task = ScheduledTask<void, string>;

const taskMap = new Map<string, Task>();

taskMap.set('A', {
    key: 'A',
    runner: async () => {
        console.log('Running A');
        return 'A done';
    },
    cost: { capacity: 1 },
});

taskMap.set('B', {
    key: 'B',
    runner: async () => {
        console.log('Running B');
        return 'B done';
    },
    cost: { capacity: 1 },
});

taskMap.set('C', {
    key: 'C',
    runner: async () => {
        console.log('Running C');
        return 'C done';
    },
    cost: { capacity: 1 },
});

taskMap.set('D', {
    key: 'D',
    runner: async () => {
        console.log('Running D');
        return 'D done';
    },
    cost: { capacity: 1 },
});
```

A `ScheduledTask` has the following fields:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Unique identifier, must match the dependency graph node |
| `runner` | `() => Promise<T>` or streaming variant | The work to execute |
| `cost` | `ResourceCost` | Resources this task needs (see Step 4) |
| `onComplete` | `(key: string) => void` | Called when the task finishes successfully |
| `onError` | `(key: string, error: Error) => void` | Called when the task fails |

We will fill in `onComplete` and `onError` in Step 5 once we have the source wired up.

## 4. Step 3: Wire PriorityDependencySourceObj

The `PriorityDependencySourceObj` connects the dependency graph and task map into a unified source that yields tasks in dependency-respecting, priority-aware order.

```typescript
import { PriorityDependencySourceObj } from '@firebrandanalytics/shared-utils';

const source = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key) => {
        // D is the final step -- give it highest priority
        if (key === 'D') return 10;
        return 1;
    },
    agingRate: 0.001,    // +0.001 priority per ms of wait
    maxAgeBoost: 5,      // cap aging at +5
});
```

When the source is constructed, it listens to the graph's `onReady` event. Every time a node transitions to the ready state, the source automatically enqueues it into an internal priority queue. This wiring is synchronous, which means there is no async gap between a dependency completing and the next task becoming available -- a property that matters for throughput.

The `priorityFn` assigns a base priority to each task. Higher numbers mean higher priority. When multiple tasks are ready at the same time, the one with the highest priority is dequeued first.

## 5. Step 4: Add Resource Capacity

Resource capacity prevents the runner from starting more work than the system can handle. You define a pool of named resources and their limits.

```typescript
import { ResourceCapacitySource } from '@firebrandanalytics/shared-utils';

const capacity = new ResourceCapacitySource({
    capacity: 2,       // max 2 concurrent tasks
    memory_gb: 8,      // 8 GB total memory budget
});
```

Each task declares the resources it needs through the `cost` field. Let's update B and C with different memory requirements:

```typescript
taskMap.set('B', {
    key: 'B',
    runner: async () => {
        console.log('Running B');
        return 'B done';
    },
    cost: { capacity: 1, memory_gb: 4 },  // needs 4 GB
});

taskMap.set('C', {
    key: 'C',
    runner: async () => {
        console.log('Running C');
        return 'C done';
    },
    cost: { capacity: 1, memory_gb: 6 },  // needs 6 GB
});
```

Even though the concurrency limit is 2, B and C cannot both run simultaneously. Their combined memory would be 4 + 6 = 10 GB, which exceeds the 8 GB budget. The runner will start whichever has higher priority, wait for it to complete and release its resources, then start the other.

The `ResourceCapacitySource` exposes three key methods:

- `canAcquire(cost)` -- synchronous check: returns `true` if all resources in the cost can be satisfied (checks local availability and the parent chain).
- `acquireImmediate(cost)` -- synchronous atomic decrement of all resources. Only call after `canAcquire()` returns `true`. Throws if any resource is insufficient.
- `release(cost)` -- releases resources back and signals waiters via a `WaitObject` so blocked callers can re-check availability.

## 6. Step 5: Wire the Bridge Pattern

There is one critical piece of wiring left. When a task completes, the runner needs to tell the source so the dependency graph can unlock downstream tasks. This happens through the `onComplete` and `onError` callbacks on each `ScheduledTask`.

Here is a helper function that creates properly wired tasks:

```typescript
function makeTask(
    key: string,
    work: () => Promise<string>,
    cost?: ResourceCost,
): Task {
    return {
        key,
        runner: work,
        cost: cost ?? { capacity: 1 },
        onComplete: (k) => source.complete(k),
        onError: (k, error) => {
            console.error(`Task ${k} failed:`, error);
            source.fail(k);  // moves back to ready for retry
        },
    };
}
```

When `onComplete` calls `source.complete(k)`, the source marks the node as completed in the underlying dependency graph, which may cause new nodes to transition to ready, which triggers the `onReady` listener, which enqueues them into the priority queue -- all synchronously. The next time the runner asks for a task, the newly ready task is already waiting.

When `onError` calls `source.fail(k)`, the node transitions from running back to ready. On the next scheduling cycle, the runner will pick it up again for a retry.

Let's rebuild our task map using this helper:

```typescript
taskMap.clear();

taskMap.set('A', makeTask('A', async () => {
    console.log('Running A');
    return 'A done';
}));

taskMap.set('B', makeTask('B', async () => {
    console.log('Running B');
    return 'B done';
}, { capacity: 1, memory_gb: 4 }));

taskMap.set('C', makeTask('C', async () => {
    console.log('Running C');
    return 'C done';
}, { capacity: 1, memory_gb: 6 }));

taskMap.set('D', makeTask('D', async () => {
    console.log('Running D');
    return 'D done';
}));
```

## 7. Step 6: Run with ScheduledTaskPoolRunner

Now we have all the pieces. The `ScheduledTaskPoolRunner` ties them together and drives execution through an async iterator.

```typescript
import { ScheduledTaskPoolRunner } from '@firebrandanalytics/shared-utils';

const runner = new ScheduledTaskPoolRunner('my-pipeline', source, capacity);

for await (const envelope of runner.runTasks(false)) {
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
console.log('All tasks done!');
```

The `runTasks(false)` call returns an `AsyncIterable` of envelopes. The `false` argument is the `stopOnError` parameter: when `false`, errors from tasks are yielded as `ERROR` envelopes instead of throwing, so the pipeline continues running. Pass `true` (the default) to throw on the first error, which breaks the `for await` loop.

### The Peek-Check-Acquire Protocol

Inside the runner, each scheduling cycle follows this protocol:

1. **Peek** -- Look at the highest-priority ready task without removing it from the queue.
2. **Check** -- Ask the capacity source whether the task's `cost` can be satisfied right now.
3. **Acquire** -- If yes, atomically acquire the resources and dequeue the task. If no, wait for a resource release event and retry.

This three-step protocol prevents a race condition where a task is dequeued but then cannot run because resources are exhausted.

## 8. Step 7: Understanding Priority and Aging

When multiple tasks are ready at the same time, the priority function determines which runs first. But what happens when a task gets stuck waiting because resources are not available? Without intervention, a low-priority task could wait indefinitely while higher-priority tasks keep jumping the queue.

This is where aging comes in.

```typescript
const source = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key) => 1,  // all tasks start at priority 1
    agingRate: 0.001,         // +0.001 priority per ms of wait
    maxAgeBoost: 5,           // cap aging at +5
});
```

With `agingRate: 0.001`, a task's effective priority increases by 0.001 for every millisecond it spends in the ready queue. After 2 seconds of waiting:

```
effectivePriority = basePriority + min(agingRate * waitTimeMs, maxAgeBoost)
                  = 1 + min(0.001 * 2000, 5)
                  = 1 + 2
                  = 3
```

After 5 seconds, the boost hits the cap:

```
effectivePriority = 1 + min(0.001 * 5000, 5)
                  = 1 + 5
                  = 6
```

This prevents starvation: even a low-priority task will eventually accumulate enough age boost to outrank newer, higher-priority arrivals. The `maxAgeBoost` cap prevents aged tasks from dominating indefinitely.

When tasks have equal effective priority, a FIFO tiebreaker applies -- the task that became ready first wins.

## 9. Step 8: Hierarchical Capacity

In larger systems, you may need resource limits at multiple levels. For example, a team might be allowed 3 concurrent tasks, but the organization as a whole might have a cap of 10 across all teams. Hierarchical capacity handles this.

```typescript
const orgCapacity = new ResourceCapacitySource({
    capacity: 10,
    gpu: 4,
});

const teamCapacity = new ResourceCapacitySource(
    { capacity: 3, gpu: 2 },
    orgCapacity,  // parent
);
```

The second argument to `ResourceCapacitySource` is an optional parent. When you call `canAcquire` or `acquireImmediate` on the child, the check propagates up the chain:

```typescript
// teamCapacity.canAcquire({ capacity: 1, gpu: 1 }) checks:
// 1. Does team have capacity 1 and gpu 1 available? Yes.
// 2. Does org (parent) have capacity 1 and gpu 1 available? Yes.
// --> true

// If the org already has 4 GPUs allocated across all teams:
// teamCapacity.canAcquire({ capacity: 1, gpu: 1 })
// --> false (org has no GPU capacity left, even though the team does)
```

Calling `acquireImmediate` claims resources at every level in the hierarchy. Calling `release` frees them at every level. This means a team can never exceed its own limits or the organization's limits, and the organization's limits are shared across all teams.

You can chain as many levels as you need:

```typescript
const globalCapacity = new ResourceCapacitySource({ capacity: 100 });
const regionCapacity = new ResourceCapacitySource({ capacity: 30 }, globalCapacity);
const teamCapacity = new ResourceCapacitySource({ capacity: 5 }, regionCapacity);
```

## 10. Complete Working Example

Here is the full diamond pipeline assembled from all the steps above:

```typescript
import {
    DependencyGraph,
    ResourceCapacitySource,
    PriorityDependencySourceObj,
    ScheduledTaskPoolRunner,
    ScheduledTask,
    ResourceCost,
} from '@firebrandanalytics/shared-utils';

// --- Types ---
type Task = ScheduledTask<void, string>;

// --- Step 1: Dependency graph ---
const graph = new DependencyGraph<string>();
graph.addNode('A');
graph.addNode('B', ['A']);
graph.addNode('C', ['A']);
graph.addNode('D', ['B', 'C']);

// --- Step 2: Task map (filled after source is created) ---
const taskMap = new Map<string, Task>();

// --- Step 3: Priority + dependency source ---
const source = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key) => (key === 'D' ? 10 : 1),
    agingRate: 0.001,
    maxAgeBoost: 5,
});

// --- Step 4: Resource capacity ---
const capacity = new ResourceCapacitySource({
    capacity: 2,
    memory_gb: 8,
});

// --- Step 5: Task factory with bridge wiring ---
function makeTask(
    key: string,
    work: () => Promise<string>,
    cost?: ResourceCost,
): Task {
    return {
        key,
        runner: work,
        cost: cost ?? { capacity: 1 },
        onComplete: (k) => source.complete(k),
        onError: (k, error) => {
            console.error(`Task ${k} failed:`, error);
            source.fail(k);
        },
    };
}

taskMap.set('A', makeTask('A', async () => {
    await delay(100);
    return 'A done';
}));

taskMap.set('B', makeTask('B', async () => {
    await delay(200);
    return 'B done';
}, { capacity: 1, memory_gb: 4 }));

taskMap.set('C', makeTask('C', async () => {
    await delay(150);
    return 'C done';
}, { capacity: 1, memory_gb: 6 }));

taskMap.set('D', makeTask('D', async () => {
    await delay(50);
    return 'D done';
}));

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Step 6: Run ---
const runner = new ScheduledTaskPoolRunner('diamond-pipeline', source, capacity);

for await (const envelope of runner.runTasks(false)) {
    switch (envelope.type) {
        case 'FINAL':
            console.log(`[DONE] ${envelope.taskId}: ${envelope.value}`);
            break;
        case 'ERROR':
            console.error(`[FAIL] ${envelope.taskId}:`, envelope.error);
            break;
    }
}

console.log('Pipeline complete.');
```

Expected output:

```
[DONE] A: A done
[DONE] B: B done          (or C first, depending on timing)
[DONE] C: C done
[DONE] D: D done
Pipeline complete.
```

Because B needs 4 GB and C needs 6 GB (total 10 > 8 GB limit), they run sequentially despite the concurrency limit of 2. B and C cannot overlap. D runs last because it depends on both.

## 11. Next Steps

You now understand the four core components and how they wire together. Here is where to go next:

- **[ETL Pipeline Tutorial](./etl-pipeline.md)** -- Apply scheduling to a real ETL workload with streaming tasks and checkpoints.
- **[Retry and Error Handling Tutorial](./retry-and-error-handling.md)** -- Deep dive into failure modes, retry strategies, and abort cascades.
- **[Scheduling API Reference](../reference/scheduling.md)** -- Complete API documentation for all scheduling types and methods.
- **[Conceptual Guide -- Scheduling section](../concepts.md#6-scheduling-dependency-graphs-priority-and-resource-management)** -- Architectural context and design rationale.
