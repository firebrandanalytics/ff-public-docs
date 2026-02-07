# Retry and Error Handling

When tasks fail inside a scheduling pipeline, you have two choices: retry or
abort. The `DependencyGraph` state machine supports both paths. Calling
`fail(key)` moves a task back to `ready` so it will be re-yielded by the
source, while calling `abort(key)` permanently terminates the task and
cascades that termination to every transitive dependent.

This tutorial builds on [Scheduling Fundamentals](./scheduling-fundamentals.md).
You should be comfortable with `DependencyGraph`, `PriorityDependencySourceObj`,
`ResourceCapacitySource`, and `ScheduledTaskPoolRunner` before continuing.

---

## The Two Error Recovery Strategies

### Retry (fail -> ready)

The task moves back to the `ready` state and will be re-yielded by the source
on a subsequent iteration. Use this when the failure is transient -- a network
timeout, a temporary resource lock, or a rate-limit response.

### Abort (abort -> cascade)

The task is permanently terminated. Every node that depends on it (directly or
transitively) is also aborted. Use this when the failure is permanent -- invalid
input, a missing upstream dependency, or an unrecoverable configuration error.

```
running -> fail(key) -> ready -> running -> ... (retry loop)
running -> abort(key) -> aborted (+ all dependents aborted)
```

The distinction matters because retry preserves the possibility that downstream
work will eventually proceed, while abort cuts off an entire subgraph
immediately.

---

## The Bridge Pattern for Error Handling

The standard approach wires the `ScheduledTask.onError` callback to implement
the retry-or-abort decision. When the runner catches an error from a task's
`runner` function, it calls `onError` with the task key and the thrown error.
Your callback then decides whether to call `source.fail(key)` or
`source.abort(key)`.

```typescript
import {
    DependencyGraph, PriorityDependencySourceObj,
    ResourceCapacitySource, ScheduledTaskPoolRunner,
    ScheduledTask,
} from '@firebrandanalytics/shared-utils';

const MAX_RETRIES = 3;
const retryCount = new Map<string, number>();

let source: PriorityDependencySourceObj<string, ScheduledTask<void, string>>;
let taskMap: Map<string, ScheduledTask<void, string>>;

function makeTask(key: string, work: () => Promise<string>): ScheduledTask<void, string> {
    return {
        key,
        runner: work,
        cost: { capacity: 1 },
        onComplete: (k) => {
            retryCount.delete(k);
            source.complete(k);
        },
        onError: (k, error) => {
            const attempts = (retryCount.get(k) ?? 0) + 1;
            retryCount.set(k, attempts);

            if (attempts >= MAX_RETRIES) {
                console.error(`Task ${k} failed after ${attempts} attempts, aborting`);
                const aborted = source.abort(k);
                console.error(`Aborted ${aborted.length} tasks:`, aborted);
            } else {
                console.warn(`Task ${k} failed (attempt ${attempts}/${MAX_RETRIES}), retrying`);
                source.fail(k);
            }
        },
    };
}
```

The `onComplete` callback cleans up retry state and signals the source that the
task finished successfully. The `onError` callback increments the retry counter
and decides: if the task has exhausted its retries, it aborts (which cascades);
otherwise it fails (which re-queues).

---

## Retry with Exponential Backoff

For transient failures, a simple retry loop can hammer a recovering service.
Adding an exponential backoff delay gives the external system time to recover
between attempts.

```typescript
const retryDelays = new Map<string, number>(); // track backoff per task

function makeTaskWithBackoff(key: string, work: () => Promise<string>): ScheduledTask<void, string> {
    return {
        key,
        runner: async () => {
            const delay = retryDelays.get(key) ?? 0;
            if (delay > 0) {
                console.log(`Task ${key} backing off ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }
            return work();
        },
        cost: { capacity: 1 },
        onComplete: (k) => {
            retryDelays.delete(k);
            retryCount.delete(k);
            source.complete(k);
        },
        onError: (k, error) => {
            const attempts = (retryCount.get(k) ?? 0) + 1;
            retryCount.set(k, attempts);

            if (attempts >= MAX_RETRIES) {
                source.abort(k);
            } else {
                // Exponential backoff: 100ms, 200ms, 400ms, ...
                const backoff = 100 * Math.pow(2, attempts - 1);
                retryDelays.set(k, backoff);
                source.fail(k);
            }
        },
    };
}
```

The backoff delay is baked into the task's `runner` function. When `fail(key)`
moves the task back to `ready` and the source re-yields it, the runner checks
the delay map and sleeps before attempting the real work. On success, both maps
are cleared.

---

## Abort Cascades

When a task is aborted, every node that depends on it -- directly or through
any chain of intermediate dependencies -- is also aborted. This prevents the
scheduler from attempting work that can never succeed because an upstream
prerequisite has permanently failed.

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('fetch');
graph.addNode('parse', ['fetch']);
graph.addNode('validate', ['parse']);
graph.addNode('transform', ['parse']);
graph.addNode('save', ['validate', 'transform']);

// Simulate: fetch succeeds, parse fails permanently
graph.start('fetch');
graph.complete('fetch');
graph.start('parse');
const aborted = graph.abort('parse');
// aborted: ['parse', 'validate', 'transform', 'save']
// All downstream work is cancelled immediately
console.log(graph.isDone); // true (1 completed + 4 aborted = 5 total)
```

The `abort` call returns the full list of aborted keys, including the task
itself. In this example, `parse` failing permanently means `validate`,
`transform`, and `save` can never run -- they are all aborted in a single
operation. The graph considers itself done because every node has reached a
terminal state (completed or aborted).

---

## Partial Failure: Handling Diamond Patterns

In a diamond dependency graph, one branch can fail while the other succeeds.
The abort cascade only follows the dependency edges, so unrelated branches are
not affected.

```typescript
const graph = new DependencyGraph<string>();
graph.addNode('A');
graph.addNode('B', ['A']);
graph.addNode('C', ['A']);
graph.addNode('D', ['B', 'C']);

// A completes, B and C are both ready
graph.start('A');
graph.complete('A');

// C fails permanently -- abort C and its dependents
graph.start('C');
const aborted = graph.abort('C');
// aborted: ['C', 'D'] -- B is NOT aborted (it doesn't depend on C)

// B can still complete successfully
graph.start('B');
graph.complete('B');
// graph.isDone = true (A completed, B completed, C aborted, D aborted)
```

Node `D` depends on both `B` and `C`. Because `C` is aborted, `D` can never
have all of its dependencies satisfied, so it is aborted as well. But `B` is
independent of `C` and continues normally. This selective cascade keeps as much
of the pipeline running as possible.

---

## Graceful Shutdown

When an external signal (SIGTERM, user cancellation, health check failure)
arrives, you need to stop the pipeline without losing track of in-flight work.
The pattern is to abort all tasks that have not yet started while allowing
running tasks to finish naturally.

```typescript
const runner = new ScheduledTaskPoolRunner('pipeline', source, capacity);
const gen = runner.runTasks(false);

let shouldStop = false;

// External shutdown signal
process.on('SIGTERM', () => {
    shouldStop = true;
});

for await (const envelope of gen) {
    if (envelope.type === 'FINAL') {
        console.log('Task completed:', envelope.value);
    }
    if (envelope.type === 'ERROR') {
        console.error('Task error:', envelope.error);
    }

    if (shouldStop) {
        console.log('Shutdown requested, aborting remaining tasks...');
        // Abort all non-completed tasks
        for (const key of graph.ready) {
            source.abort(key);
        }
        // Let running tasks finish naturally
        break;
    }
}
```

Breaking out of the `for await` loop after aborting ready tasks ensures that no
new tasks are started. Tasks already in flight will complete (or fail), and
their results are discarded once the loop exits. This gives running work a
chance to release resources cleanly.

---

## stopOnError Mode

The `ScheduledTaskPoolRunner.runTasks()` method accepts a `stopOnError`
parameter that controls what happens when a task throws an error.

### stopOnError = true (default): Throw on first error

The generator throws the error, which breaks the `for await` loop. Use this
when any failure should halt the entire pipeline.

```typescript
try {
    for await (const envelope of runner.runTasks(true)) {
        // ... process envelopes
    }
} catch (error) {
    console.error('Pipeline failed:', error);
}
```

### stopOnError = false: Yield ERROR envelopes and continue

Errors are wrapped in envelopes with `type: 'ERROR'` and yielded alongside
normal results. The pipeline continues running. Use this when you want to
handle errors per-task (via `onError`) and keep the rest of the pipeline alive.

```typescript
for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'ERROR') {
        // Handle error but don't stop the pipeline
        console.error('Task failed:', envelope.error);
    }
}
```

In most retry scenarios, you will use `stopOnError = false` so that the
`onError` callback can decide whether to retry or abort on a per-task basis
without tearing down the entire pipeline.

---

## Complete Example: Resilient Pipeline

This example ties together all of the patterns from this tutorial: dependency
graph construction, task creation with retry and exponential backoff, abort
cascades, and `stopOnError = false` for per-task error handling.

```typescript
import {
    DependencyGraph, ResourceCapacitySource,
    PriorityDependencySourceObj, ScheduledTaskPoolRunner,
    ScheduledTask,
} from '@firebrandanalytics/shared-utils';

// -- Configuration --
const MAX_RETRIES = 3;
const retryCount = new Map<string, number>();
const retryDelays = new Map<string, number>();
const metrics = { completed: 0, retried: 0, retryAttempts: 0, aborted: 0 };

// -- Build the dependency graph --
const graph = new DependencyGraph<string>();
graph.addNode('fetch');
graph.addNode('parse', ['fetch']);
graph.addNode('validate', ['parse']);
graph.addNode('transform', ['parse']);
graph.addNode('save', ['validate', 'transform']);

// -- Wire the source (filled after task map is built) --
const capacity = new ResourceCapacitySource({ capacity: 2 });
const taskMap = new Map<string, ScheduledTask<void, string>>();

// -- Simulate work (parse fails twice then succeeds) --
let parseAttempts = 0;

function workFor(key: string): () => Promise<string> {
    return async () => {
        if (key === 'parse') {
            parseAttempts++;
            if (parseAttempts < 3) {
                throw new Error(`Transient failure in parse (attempt ${parseAttempts})`);
            }
        }
        return `${key}-result`;
    };
}

// -- Task factory with retry + backoff --
function makeTask(key: string): ScheduledTask<void, string> {
    const work = workFor(key);
    return {
        key,
        runner: async () => {
            const delay = retryDelays.get(key) ?? 0;
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            }
            return work();
        },
        cost: { capacity: 1 },
        onComplete: (k) => {
            retryDelays.delete(k);
            retryCount.delete(k);
            source.complete(k);
            metrics.completed++;
        },
        onError: (k, error) => {
            const attempts = (retryCount.get(k) ?? 0) + 1;
            retryCount.set(k, attempts);

            if (attempts >= MAX_RETRIES) {
                const aborted = source.abort(k);
                metrics.aborted += aborted.length;
            } else {
                const backoff = 100 * Math.pow(2, attempts - 1);
                retryDelays.set(k, backoff);
                source.fail(k);
                metrics.retried++;
                metrics.retryAttempts += attempts;
            }
        },
    };
}

// -- Build the task map --
for (const key of ['fetch', 'parse', 'validate', 'transform', 'save']) {
    taskMap.set(key, makeTask(key));
}

// -- Create the source (requires graph + taskMap) --
const source = new PriorityDependencySourceObj<string, ScheduledTask<void, string>>(graph, taskMap);

// -- Run --
const runner = new ScheduledTaskPoolRunner('resilient-pipeline', source, capacity);

for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') {
        console.log(`Task ${envelope.value} completed`);
    }
    if (envelope.type === 'ERROR') {
        console.error(`Task error: ${envelope.error}`);
    }
}

// -- Report --
console.log('\nSummary:');
console.log(`  Completed: ${metrics.completed}`);
console.log(`  Retried: ${metrics.retried} (${metrics.retryAttempts} retry attempts)`);
console.log(`  Aborted: ${metrics.aborted}`);
```

Expected output:

```
Task fetch completed
Task parse failed (attempt 1/3), retrying in 100ms
Task parse failed (attempt 2/3), retrying in 200ms
Task parse completed
Task validate completed
Task transform completed
Task save completed

Summary:
  Completed: 5
  Retried: 1 (2 retry attempts)
  Aborted: 0
```

All five tasks complete. The `parse` task fails twice with transient errors but
succeeds on its third attempt after backing off. Because it eventually succeeds,
its dependents (`validate`, `transform`, `save`) proceed normally and the
pipeline finishes with zero aborted tasks.

---

## Next Steps

- [Scheduling Fundamentals](./scheduling-fundamentals.md) -- prerequisite
  tutorial covering `DependencyGraph`, sources, and the pool runner.
- [ETL Pipeline](./etl-pipeline.md) -- a multi-stage pipeline example using
  scheduling with real data transforms.
- [Scheduling API Reference](../reference/scheduling.md) -- full API
  documentation for all scheduling classes and their methods.
