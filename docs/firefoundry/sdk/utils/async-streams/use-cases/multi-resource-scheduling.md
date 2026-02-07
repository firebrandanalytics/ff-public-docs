# Use Case 4: Multi-Resource Scheduling

Schedule tasks with heterogeneous resource requirements so that a GPU-heavy encode and a CPU-only thumbnail job can run concurrently, but two GPU-heavy jobs cannot.

## The Problem

A media processing pipeline ingests uploaded videos and runs three kinds of jobs per video:

| Job | GPU | CPU | Duration |
|-----|-----|-----|----------|
| **encode** | 2 | 1 | ~450 ms |
| **feature extraction** | 1 | 2 | ~360 ms (streaming) |
| **thumbnail generation** | 1 | 1 | ~220 ms |

A naive "max 3 concurrent" policy would allow all three to start simultaneously, consuming 4 GPU units when only 2 exist. The encode would stall, the GPU driver would OOM-kill workers, and the entire pipeline would degrade unpredictably.

What you actually need is **multi-resource budgeting**: the scheduler must track GPU and CPU independently, and only start a job when every resource it needs is simultaneously available. If `encode` is running (GPU: 2, CPU: 1), the remaining budget is GPU: 0, CPU: 2 -- enough for nothing that requires a GPU, but enough for a hypothetical CPU-only job if one existed.

Two additional requirements make this harder than it sounds:

1. **Atomic acquisition.** Acquiring GPU first, then checking CPU, risks a deadlock if another task grabs the CPU between the two checks. All resources must be checked and acquired as a single atomic operation.
2. **Progress visibility.** Feature extraction is a streaming task that yields intermediate progress (25%, 75%). The scheduler must surface these intermediate values without treating them as task completion.

## The Strategy

**Capacity-gated scheduling with multi-resource budgets.**

The `ResourceCapacitySource` holds a named budget (e.g., `{ gpu: 2, cpu: 3 }`). Each `ScheduledTask` declares its cost. The `ScheduledTaskPoolRunner` uses a peek-check-acquire protocol: it peeks at the next task, reads its cost, calls `canAcquire(cost)` on the capacity source, and only consumes the task if the full cost can be satisfied atomically.

Streaming tasks (async generators) yield `INTERMEDIATE` envelopes for progress tracking. When the generator returns, a `FINAL` envelope is emitted and resources are released.

## Architecture

```
TaskSource (peek-able)
  |
  |  peek() -> { key:'encode', cost:{ gpu:2, cpu:1 } }
  |  canAcquire({ gpu:2, cpu:1 }) -> true
  |  pull + acquireImmediate
  v
ScheduledTaskPoolRunner('demo')
  |
  +-- capacity: ResourceCapacitySource { gpu: 2, cpu: 3 }
  |
  |   Running tasks:
  |   +-----------+   +------------+   +-----------+
  |   |  encode   |   |  features  |   |  thumbs   |
  |   | gpu:2     |   | gpu:1      |   | gpu:1     |
  |   | cpu:1     |   | cpu:2      |   | cpu:1     |
  |   | 450ms     |   | streaming  |   | 220ms     |
  |   |           |   | 360ms      |   |           |
  |   +-----------+   +------------+   +-----------+
  |
  v
for await (envelope of runner.runTasks(false))
  -> INTERMEDIATE { taskId, value: 'features:25%' }
  -> INTERMEDIATE { taskId, value: 'features:75%' }
  -> FINAL        { taskId, value: 'thumbs:done'   }
  -> FINAL        { taskId, value: 'features:done' }
  -> FINAL        { taskId, value: 'encode:done'   }
```

Because `encode` costs GPU: 2 and the total GPU budget is 2, no other GPU-consuming task can start until `encode` finishes. But `features` (GPU: 1) and `thumbs` (GPU: 1) together cost GPU: 2, so they can run concurrently after `encode` releases its GPU units.

## Implementation

The key pieces are:

1. A custom `TaskSource` that extends `SourceObj<ScheduledTask>` and implements `Peekable<ScheduledTask>`.
2. A `ResourceCapacitySource` initialized with the total GPU and CPU budget.
3. A `ScheduledTaskPoolRunner` that wires the source to the capacity manager.

### Task source

The source must expose `peek()` so the runner can inspect the next task's cost before consuming it. The simplest implementation wraps an array and tracks an index:

```typescript
class TaskSource extends SourceObj<ScheduledTask<string, string>>
  implements Peekable<ScheduledTask<string, string>> {

  private idx = 0;

  constructor(private readonly tasks: Array<ScheduledTask<string, string>>) {
    super();
  }

  // Return the next task without consuming it
  peek(): ScheduledTask<string, string> | undefined {
    return this.tasks[this.idx];
  }

  // Yield tasks one at a time; the runner calls next() to consume
  protected override async* pull_impl():
    AsyncGenerator<ScheduledTask<string, string>> {
    for (const task of this.tasks) {
      this.idx++;
      yield task;
    }
  }
}
```

The `peek()` method reads `this.tasks[this.idx]` -- the same element that the next `yield` in `pull_impl` will produce. The runner calls `peek()` to read the cost, checks `canAcquire`, and only then calls `next()` to consume.

### Task definitions

Each task is a `ScheduledTask` with a `key`, a `cost`, and a `runner` function. The `features` task is a streaming runner (an `async function*` that yields intermediate progress):

```typescript
const tasks: Array<ScheduledTask<string, string>> = [
  {
    key: 'encode',
    cost: { gpu: 2, cpu: 1 },
    runner: async () => {
      await sleep(450);
      return 'encode:done';
    },
  },
  {
    key: 'features',
    cost: { gpu: 1, cpu: 2 },
    runner: async function* () {
      await sleep(120);
      yield 'features:25%';    // INTERMEDIATE envelope
      await sleep(120);
      yield 'features:75%';    // INTERMEDIATE envelope
      await sleep(120);
      return 'features:done';  // FINAL envelope
    },
  },
  {
    key: 'thumbs',
    cost: { gpu: 1, cpu: 1 },
    runner: async () => {
      await sleep(220);
      return 'thumbs:done';
    },
  },
];
```

The runner detects streaming vs. regular tasks automatically: if the return value of `runner()` has `Symbol.asyncIterator`, it is treated as a streaming task. No configuration flag is needed.

### Wiring and execution

```typescript
const source   = new TaskSource(tasks);
const capacity = new ResourceCapacitySource({ gpu: 2, cpu: 3 });
const runner   = new ScheduledTaskPoolRunner<string, string>(
  'demo', source, capacity,
);

for await (const e of runner.runTasks(false)) {
  if (e.type === 'INTERMEDIATE')
    console.log(`[INTERMEDIATE] taskId=${e.taskId} value=${e.value}`);
  if (e.type === 'FINAL')
    console.log(`[FINAL] taskId=${e.taskId} value=${e.value}`);
  if (e.type === 'ERROR')
    console.log(`[ERROR] taskId=${e.taskId} error=${String(e.error)}`);

  console.log(`  available=${JSON.stringify(capacity.available)}`);
}
```

The `false` argument to `runTasks` means "continue on error" -- an `ERROR` envelope is yielded instead of throwing.

For the full runnable version, see [`examples/multi-resource-scheduling.ts`](../examples/multi-resource-scheduling.ts).

## What to Observe

Expected console output:

```
[FINAL] taskId=1 value=encode:done
  available={"gpu":2,"cpu":2}
[INTERMEDIATE] taskId=2 value=features:25%
  available={"gpu":1,"cpu":1}
[INTERMEDIATE] taskId=2 value=features:75%
  available={"gpu":1,"cpu":1}
[FINAL] taskId=3 value=thumbs:done
  available={"gpu":2,"cpu":1}
[FINAL] taskId=2 value=features:done
  available={"gpu":2,"cpu":3}
done: all scheduled tasks finished
```

Key observations:

| Metric | Meaning |
|--------|---------|
| `available` after encode FINAL | GPU: 2 restored, CPU back to 2 (one was held by encode). `features` and `thumbs` can now start. |
| INTERMEDIATE envelopes | Feature extraction yields progress at 25% and 75%. Resources remain held during streaming. |
| `available` after thumbs FINAL | GPU goes to 2 (thumbs released its 1 GPU), CPU goes to 1 (features still holds 2 CPU). |
| `available` after features FINAL | All resources restored to full capacity. |

The exact ordering of `features` and `thumbs` FINAL envelopes depends on timing. `thumbs` (220 ms) finishes before `features` (360 ms total), so `thumbs:done` typically appears first.

Note that `encode` starts first and blocks the entire GPU budget. Only after it completes can `features` and `thumbs` start -- and they can run concurrently because their combined GPU cost (1 + 1 = 2) fits within the budget.

## Variations

### Different resource dimensions

Add any named resources to model your real constraints:

```typescript
const capacity = new ResourceCapacitySource({
  gpu: 2,
  cpu: 8,
  memory_gb: 16,
  network_mbps: 100,
});

const task: ScheduledTask<string, string> = {
  key: 'transcode-4k',
  cost: { gpu: 1, cpu: 4, memory_gb: 8, network_mbps: 50 },
  runner: async () => { /* ... */ return 'done'; },
};
```

All resources are checked atomically. If any single resource is insufficient, the task waits.

### Hierarchical capacity

Enforce team-level limits within a global budget:

```typescript
const global = new ResourceCapacitySource({ gpu: 8 });
const teamA  = new ResourceCapacitySource({ gpu: 4 }, global);
const teamB  = new ResourceCapacitySource({ gpu: 4 }, global);

// teamA and teamB each have 4 GPUs, but the global cap is 8.
// If teamA uses 4 and teamB tries to use 5, the global check fails.
```

### Priority ordering

Replace the simple array source with a `PriorityDependencySourceObj` to add dependency-aware priority scheduling:

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('encode');
graph.addNode('features', ['encode']);
graph.addNode('thumbs', ['encode']);

const source = new PriorityDependencySourceObj(graph, taskMap, {
  priorityFn: (key) => key === 'encode' ? 10 : 1,
});
```

### Error recovery

Wire `onComplete` and `onError` callbacks to feed back into the source for retry logic:

```typescript
const task: ScheduledTask<string, string> = {
  key: 'encode',
  cost: { gpu: 2, cpu: 1 },
  runner: async () => { /* ... */ return 'done'; },
  onComplete: (key) => console.log(`${key} completed`),
  onError: (key, err) => console.error(`${key} failed: ${err}`),
};
```

## See Also

- [Conceptual Guide -- Scheduling](../concepts.md#6-scheduling-dependency-graphs-priority-and-resource-management) -- Design philosophy and how the scheduling primitives fit together
- [Scheduling Reference](../reference/scheduling.md) -- Complete API for `ResourceCapacitySource`, `ScheduledTaskPoolRunner`, `ScheduledTask`, and `TaskProgressEnvelope`
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- `SourceObj`, `Peekable`, and the pull model that scheduling sources implement
- [Scheduling Fundamentals Tutorial](../tutorials/scheduling-fundamentals.md) -- Step-by-step introduction to dependency graphs, priority, and resource management
