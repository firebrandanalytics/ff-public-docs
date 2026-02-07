# Building an ETL Pipeline with the Scheduling Subsystem

This tutorial walks through building a multi-stage Extract-Transform-Load pipeline using the scheduling subsystem. Each record flows through three stages with different resource profiles, dependencies enforce stage ordering within a record, and multiple records process in parallel within resource limits.

**Prerequisites:** This tutorial builds on [Scheduling Fundamentals](./scheduling-fundamentals.md). You should be comfortable with `DependencyGraph`, `ResourceCapacitySource`, and `ScheduledTaskPoolRunner` before proceeding.

---

## 1. The Problem

You have 10 records to ingest. Each record must pass through three stages:

1. **Extract** -- pull raw data from an external source (IO-heavy)
2. **Transform** -- parse, validate, and reshape the data (CPU-heavy)
3. **Load** -- write the transformed data to a database (IO + memory)

Within a single record, the stages must run in order: you cannot transform data you have not extracted, and you cannot load data you have not transformed. Across records, there are no dependencies -- record 3's extract can run at the same time as record 7's load, as long as resources permit.

```
Record 1:  extract-1  -->  transform-1  -->  load-1
Record 2:  extract-2  -->  transform-2  -->  load-2
Record 3:  extract-3  -->  transform-3  -->  load-3
...
Record 10: extract-10 -->  transform-10 -->  load-10
```

The scheduling subsystem handles the hard part: it tracks which tasks are eligible to run, respects multi-dimensional resource limits, and chooses which eligible task to run next based on priority.

---

## 2. Step 1: Build the Dependency Graph

Start by modeling the per-record stage dependencies. Each record contributes three nodes. The transform depends on the extract, and the load depends on the transform. Records have no cross-dependencies.

```typescript
import { DependencyGraph } from '@firebrandanalytics/shared-utils';

const graph = new DependencyGraph<string>();
const RECORD_COUNT = 10;

for (let i = 1; i <= RECORD_COUNT; i++) {
    graph.addNode(`extract-${i}`);
    graph.addNode(`transform-${i}`, [`extract-${i}`]);
    graph.addNode(`load-${i}`, [`transform-${i}`]);
}

// 30 nodes total: 10 extracts, 10 transforms, 10 loads.
// All 10 extract nodes have no dependencies, so they start as ready.
console.log(graph.ready.size);  // 10
```

The graph now contains 30 nodes. Because no extract depends on anything, all 10 are immediately in the `ready` state. Transforms and loads are `pending` -- they will transition to `ready` as their dependencies complete.

---

## 3. Step 2: Define Resource Costs per Stage

Not all stages consume the same resources. Extracts pull data over the network (IO-heavy), transforms parse and reshape data (CPU-heavy), and loads write to a database while holding result buffers in memory (IO + memory).

```typescript
import { ResourceCost, ResourceCapacitySource } from '@firebrandanalytics/shared-utils';

const STAGE_COSTS: Record<string, ResourceCost> = {
    extract:   { capacity: 1, io: 2, cpu: 1, memory_gb: 1 },
    transform: { capacity: 1, io: 0, cpu: 4, memory_gb: 4 },
    load:      { capacity: 1, io: 3, cpu: 1, memory_gb: 2 },
};

const capacity = new ResourceCapacitySource({
    capacity: 6,    // max 6 concurrent tasks overall
    io: 8,          // 8 IO units total
    cpu: 12,        // 12 CPU units total
    memory_gb: 16,  // 16 GB memory total
});
```

These numbers create natural bottlenecks that shape the pipeline's behavior:

| Stage     | Bottleneck Resource | Max Concurrent | Why                              |
|-----------|---------------------|----------------|----------------------------------|
| Extract   | IO (2 per task)     | 4              | 8 IO / 2 per extract = 4        |
| Transform | CPU (4 per task)    | 3              | 12 CPU / 4 per transform = 3    |
| Load      | IO (3 per task)     | 2              | 8 IO / 3 per load = 2 (rounded) |

The `capacity: 6` limit acts as a global cap, but in practice the per-resource limits are tighter. This is the strength of multi-resource scheduling: each stage is constrained by whatever resource it uses most, without requiring separate pools or manual throttling.

---

## 4. Step 3: Build the Task Map with Bridge Callbacks

Each node in the dependency graph needs a corresponding `ScheduledTask` that the pool runner can execute. The bridge pattern wires each task's `onComplete` and `onError` callbacks back into the source, so that completing a task unlocks its dependents.

```typescript
import {
    ScheduledTask,
    PriorityDependencySourceObj,
} from '@firebrandanalytics/shared-utils';

// Forward reference: we need the source for bridge callbacks,
// but we need the task map to construct the source.
let source: PriorityDependencySourceObj<string, ScheduledTask<void, string>>;

function makeTask(
    key: string,
    stage: string,
    recordId: number,
): ScheduledTask<void, string> {
    return {
        key,
        runner: async () => {
            const duration = Math.random() * 100 + 50; // 50-150ms
            await new Promise(r => setTimeout(r, duration));
            return `${key} completed in ${duration.toFixed(0)}ms`;
        },
        cost: STAGE_COSTS[stage],
        onComplete: (k) => source.complete(k),
        onError: (k, err) => {
            console.error(`${k} failed:`, err);
            source.fail(k);
        },
    };
}

const taskMap = new Map<string, ScheduledTask<void, string>>();

for (let i = 1; i <= RECORD_COUNT; i++) {
    taskMap.set(`extract-${i}`, makeTask(`extract-${i}`, 'extract', i));
    taskMap.set(`transform-${i}`, makeTask(`transform-${i}`, 'transform', i));
    taskMap.set(`load-${i}`, makeTask(`load-${i}`, 'load', i));
}
```

A few things to note:

- **Forward reference:** The `source` variable is declared with `let` before the task map is built. The `onComplete` and `onError` closures capture `source` by reference, so they will see the assigned value when they actually execute. This is a common pattern when the tasks and the source have a circular dependency.
- **Bridge callbacks:** `onComplete` calls `source.complete(k)`, which transitions the node in the dependency graph to `completed` and enqueues any newly-ready dependents into the priority queue. `onError` calls `source.fail(k)`, which moves the node back to `ready` for retry.
- **Simulated work:** The runner uses a random delay to simulate real IO and computation. In a real pipeline, you would replace this with actual data fetching, transformation logic, and database writes.

---

## 5. Step 4: Wire the Source with Priority

Now connect the dependency graph and task map through a `PriorityDependencySourceObj`. This source yields tasks in priority order, but only after their dependencies are satisfied.

```typescript
source = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key) => {
        // Prioritize load (finishing records) > transform > extract
        if (key.startsWith('load-')) return 10;
        if (key.startsWith('transform-')) return 5;
        return 1;
    },
    agingRate: 0.01,
    maxAgeBoost: 20,
});
```

The priority function assigns higher values to later stages. This is a deliberate design choice:

- **Load gets priority 10.** Once a record has been extracted and transformed, pushing it through the load stage finishes that record and frees up memory. Without this priority, a newly-eligible extract might run before a waiting load, causing more records to be "in flight" simultaneously and increasing memory pressure.
- **Transform gets priority 5.** Transforms unlock loads, so progressing transforms keeps the pipeline moving forward rather than starting new extracts that pile up.
- **Extract gets priority 1.** Extracts are the entry point, but starting too many extracts in parallel consumes IO bandwidth without progressing records that are further along.

The `agingRate` of `0.01` prevents starvation: an extract that has been waiting 1000ms gains an effective priority boost of min(0.01 * 1000, 20) = 10, matching the load priority. The `maxAgeBoost` of 20 caps this so aged extracts do not permanently dominate loads.

---

## 6. Step 5: Run and Monitor

The `ScheduledTaskPoolRunner` pulls tasks from the source, checks resource availability, and runs them concurrently. It yields `TaskProgressEnvelope` objects that you consume with `for await...of`.

```typescript
import { ScheduledTaskPoolRunner } from '@firebrandanalytics/shared-utils';

const runner = new ScheduledTaskPoolRunner('etl', source, capacity);

let completed = 0;
const startTime = Date.now();

for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') {
        completed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] ${envelope.value} (${completed}/30)`);
    }
    if (envelope.type === 'ERROR') {
        console.error(`Task ${envelope.taskId} error:`, envelope.error);
    }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nAll 30 tasks completed in ${totalTime}s`);
```

The `false` argument to `runTasks` means the runner continues past errors (it does not stop on the first failure). Each errored task will trigger its `onError` callback, which calls `source.fail(key)`, moving the task back to `ready` for retry.

---

## 7. Understanding the Execution Pattern

When you run this pipeline, the scheduling subsystem produces a characteristic wave pattern. Here is what happens step by step:

**Phase 1 -- Initial extraction burst.** All 10 extracts are ready, but the IO bottleneck limits concurrency to 4 (8 IO / 2 per extract). The runner starts 4 extracts simultaneously.

**Phase 2 -- Transforms trickle in.** As each extract completes, its transform becomes ready. Transforms need 4 CPU each, so only 3 can run at once (12 CPU / 4 per transform). Meanwhile, newly-freed IO capacity allows another extract to start. The pipeline now has a mix of extracts and transforms running.

**Phase 3 -- Loads get priority.** When the first transform completes, its load becomes ready with priority 10. The runner prefers the load over any waiting extract (priority 1) or transform (priority 5). Loads consume 3 IO units, so at most 2 loads can run simultaneously.

**Phase 4 -- Steady state.** The pipeline reaches a balanced state where all three stages are active. Completed loads free resources for new work. The priority function ensures that records near the end of their pipeline get resources first, minimizing the number of in-flight records.

**Phase 5 -- Drain.** Eventually, all extracts have completed. The remaining transforms and loads process through, with loads always taking priority when resources are contested. The last task to complete is a load.

The total execution time is significantly less than if you ran all 30 tasks sequentially. With sequential execution, 30 tasks averaging 100ms each would take about 3 seconds. With this pipeline, the overlapping execution typically finishes in under 1 second.

---

## 8. Adding Metrics

You can track per-stage throughput by inspecting the task keys in each envelope. Here is a pattern for collecting timing and count metrics:

```typescript
const metrics: Record<string, { count: number; totalMs: number }> = {
    extract:   { count: 0, totalMs: 0 },
    transform: { count: 0, totalMs: 0 },
    load:      { count: 0, totalMs: 0 },
};

const taskStartTimes = new Map<string, number>();

// Modified makeTask that records start time
function makeTrackedTask(
    key: string,
    stage: string,
    recordId: number,
): ScheduledTask<void, string> {
    return {
        key,
        runner: async () => {
            taskStartTimes.set(key, Date.now());
            const duration = Math.random() * 100 + 50;
            await new Promise(r => setTimeout(r, duration));
            return key;
        },
        cost: STAGE_COSTS[stage],
        onComplete: (k) => source.complete(k),
        onError: (k, err) => source.fail(k),
    };
}

// In the for-await loop, track completions:
for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') {
        const key = envelope.value as string;
        const stage = key.split('-')[0];
        const startedAt = taskStartTimes.get(key);
        if (startedAt) {
            metrics[stage].count++;
            metrics[stage].totalMs += Date.now() - startedAt;
        }
    }
}

// Print summary
for (const [stage, data] of Object.entries(metrics)) {
    const avgMs = data.count > 0 ? (data.totalMs / data.count).toFixed(0) : 'N/A';
    console.log(`${stage}: ${data.count} tasks, avg ${avgMs}ms`);
}
```

This gives you visibility into per-stage performance. If you notice that transforms are consistently slower than expected, you might increase the CPU capacity limit or reduce the CPU cost per transform task. If loads are the bottleneck, you might add more IO capacity or batch multiple loads into a single task.

---

## 9. Full Working Example

Here is the complete pipeline in a single block for easy copy-paste:

```typescript
import {
    DependencyGraph,
    ResourceCost,
    ResourceCapacitySource,
    ScheduledTask,
    PriorityDependencySourceObj,
    ScheduledTaskPoolRunner,
} from '@firebrandanalytics/shared-utils';

// -- Configuration --
const RECORD_COUNT = 10;

const STAGE_COSTS: Record<string, ResourceCost> = {
    extract:   { capacity: 1, io: 2, cpu: 1, memory_gb: 1 },
    transform: { capacity: 1, io: 0, cpu: 4, memory_gb: 4 },
    load:      { capacity: 1, io: 3, cpu: 1, memory_gb: 2 },
};

const capacity = new ResourceCapacitySource({
    capacity: 6,
    io: 8,
    cpu: 12,
    memory_gb: 16,
});

// -- Dependency Graph --
const graph = new DependencyGraph<string>();

for (let i = 1; i <= RECORD_COUNT; i++) {
    graph.addNode(`extract-${i}`);
    graph.addNode(`transform-${i}`, [`extract-${i}`]);
    graph.addNode(`load-${i}`, [`transform-${i}`]);
}

// -- Task Map with Bridge Callbacks --
let source: PriorityDependencySourceObj<string, ScheduledTask<void, string>>;

function makeTask(key: string, stage: string): ScheduledTask<void, string> {
    return {
        key,
        runner: async () => {
            const duration = Math.random() * 100 + 50;
            await new Promise(r => setTimeout(r, duration));
            return `${key} done in ${duration.toFixed(0)}ms`;
        },
        cost: STAGE_COSTS[stage],
        onComplete: (k) => source.complete(k),
        onError: (k, err) => {
            console.error(`${k} failed:`, err);
            source.fail(k);
        },
    };
}

const taskMap = new Map<string, ScheduledTask<void, string>>();
for (let i = 1; i <= RECORD_COUNT; i++) {
    taskMap.set(`extract-${i}`, makeTask(`extract-${i}`, 'extract'));
    taskMap.set(`transform-${i}`, makeTask(`transform-${i}`, 'transform'));
    taskMap.set(`load-${i}`, makeTask(`load-${i}`, 'load'));
}

// -- Priority Source --
source = new PriorityDependencySourceObj(graph, taskMap, {
    priorityFn: (key) => {
        if (key.startsWith('load-')) return 10;
        if (key.startsWith('transform-')) return 5;
        return 1;
    },
    agingRate: 0.01,
    maxAgeBoost: 20,
});

// -- Run --
const runner = new ScheduledTaskPoolRunner('etl', source, capacity);

let completed = 0;
const startTime = Date.now();

for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') {
        completed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] ${envelope.value} (${completed}/30)`);
    }
    if (envelope.type === 'ERROR') {
        console.error(`Task ${envelope.taskId} error:`, envelope.error);
    }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nAll 30 tasks completed in ${totalTime}s`);
```

---

## 10. Next Steps

This tutorial covered a straightforward ETL pipeline where every task succeeds. Real pipelines need error handling, retries, and monitoring. Continue with these resources:

- [Retry and Error Handling](./retry-and-error-handling.md) -- strategies for handling task failures, retry budgets, and abort cascades
- [Scheduling Fundamentals](./scheduling-fundamentals.md) -- prerequisite concepts if you want to review the building blocks
- [Scheduling API Reference](../reference/scheduling.md) -- full API documentation for all scheduling classes and types
