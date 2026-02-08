# Using Async Streams with FireFoundry

This guide covers how the async streams library integrates with FireFoundry entities, bots, and workflows. The core library is general-purpose TypeScript (documented in the [main reference](../README.md)), but FireFoundry uses it extensively for parallel execution, progress streaming, and task scheduling within entity workflows.

**Audience:** FireFoundry developers who are already familiar with entities and bots and want to use the streaming and scheduling primitives in their workflows.

---

## AsyncIteratorCombiner: Progress Streaming from Parallel Entities

When an orchestrator entity runs multiple child entities in parallel, each child produces its own `AsyncGenerator` of progress envelopes via `entity.start()`. The `AsyncIteratorCombiner` merges these streams into a single interleaved stream, so the orchestrator can yield progress from all children as it arrives.

```typescript
import { AsyncIteratorCombiner } from '@firebrandanalytics/shared-utils';

// Inside an orchestrator's run_impl
const sentimentIter = await sentimentAnalyzer.start();
const topicIter = await topicExtractor.start();
const keywordIter = await keywordAnalyzer.start();

const combiner = new AsyncIteratorCombiner(sentimentIter, topicIter, keywordIter);

for await (const envelope of combiner.race_generator()) {
    yield envelope;  // Progress from whichever child produces next
}
```

The `race_generator()` method yields the next available result from any stream, removing streams as they complete. This gives you a unified progress feed without manually managing multiple `for await` loops.

**When to use:** Small, fixed sets of parallel entities (2--5) where all can start immediately and you want interleaved progress.

See also: [AsyncIteratorCombiner API](../reference/utilities.md#asynciteratorcombiner)

---

## HierarchicalTaskPoolRunner: Capacity-Limited Parallel Execution

For larger or dynamic workloads, the `HierarchicalTaskPoolRunner` provides capacity-limited concurrency. It pulls task runner functions from a source, acquires a capacity slot, executes the task, and yields `TaskProgressEnvelope` results.

### Basic Pattern

```typescript
import { HierarchicalTaskPoolRunner } from '@firebrandanalytics/shared-utils';
import { CapacitySource } from '@firebrandanalytics/shared-utils';
import { SourceBufferObj, BufferMode } from '@firebrandanalytics/shared-utils';

// Inside an orchestrator's run_impl
const documents = dto.data.documents;
const capacity = new CapacitySource(10);  // Max 10 concurrent

const taskRunners = documents.map(doc =>
    async () => {
        const processor = await this.appendOrRetrieveCall(
            DocumentProcessingStep,
            `doc_${doc.id}`,
            { document: doc }
        );
        return processor.start();
    }
);

const taskSource = new SourceBufferObj(taskRunners, true, BufferMode.FIFO);
const runner = new HierarchicalTaskPoolRunner('doc-pool', taskSource, capacity);

for await (const envelope of runner.runTasks()) {
    if (envelope.type === 'INTERMEDIATE' || envelope.type === 'FINAL') {
        yield envelope.value;  // Forward child progress to orchestrator's consumer
    } else if (envelope.type === 'ERROR') {
        logger.error(`Task ${envelope.taskId} failed`, { error: envelope.error });
    }
}
```

Each task runner function is called lazily by the runner -- entities are only created and started when a capacity slot is available.

### Hierarchical Capacity for Multi-Workflow Fairness

When multiple orchestrators share a resource pool (e.g., database connections), use a parent `CapacitySource` for the global limit and child sources for per-workflow limits:

```typescript
// Shared across all workflows
const globalCapacity = new CapacitySource(30);

// Per-workflow (in each orchestrator's run_impl)
const workflowCapacity = new CapacitySource(14, globalCapacity);
const runner = new HierarchicalTaskPoolRunner('workflow-a', taskSource, workflowCapacity);
```

A child source acquires capacity from both itself and its parent. This prevents any single workflow from monopolizing the global pool while allowing workflows to exceed their "fair share" when others are idle.

### Dynamic Task Injection with PushPullBufferObj

When tasks are discovered at runtime (e.g., chunking a large document), use a `PushPullBufferObj` as a live task queue:

```typescript
import { PushPullBufferObj } from '@firebrandanalytics/shared-utils';

const taskQueue = new PushPullBufferObj<() => AsyncGenerator>();
const capacity = new CapacitySource(5);
const runner = new HierarchicalTaskPoolRunner('chunk-pool', taskQueue.source, capacity);

// Producer: push tasks as they are discovered
const producer = async () => {
    for await (const chunk of openDocumentStream(documentId)) {
        await taskQueue.sink.next(async () => {
            const analyzer = await this.appendOrRetrieveCall(
                ChunkAnalysisStep,
                `chunk_${chunkIndex++}`,
                { chunkData: chunk }
            );
            return analyzer.start();
        });
    }
    await taskQueue.sink.return();  // Signal: no more tasks
};

// Consumer: process results as they arrive
const consumer = async function*() {
    for await (const envelope of runner.runTasks()) {
        yield envelope.value;
    }
};

// Run both concurrently
const producerPromise = producer();
for await (const result of consumer()) {
    yield result;
}
await producerPromise;
```

The runner pulls from the buffer's source end while your logic pushes into the buffer's sink end. When the producer is done, closing the sink signals the runner to drain and terminate.

See also: [PushPullBufferObj API](../reference/utilities.md#pushpullbufferobj), [CapacitySource API](../reference/utilities.md#capacitysource-legacy)

---

## ScheduledTaskPoolRunner: Dependency-Aware Scheduling

The `ScheduledTaskPoolRunner` is the newer, more powerful alternative to `HierarchicalTaskPoolRunner`. It adds:

- **Dependency graphs** -- tasks only run when their predecessors have completed
- **Multi-resource capacity** -- limits on multiple named resources (CPU, IO, memory, etc.) rather than a single counter
- **Priority with aging** -- higher-priority tasks run first, with starvation prevention

### When to Choose Each Runner

| Feature | HierarchicalTaskPoolRunner | ScheduledTaskPoolRunner |
|---------|---------------------------|------------------------|
| Task dependencies | No | Yes (DependencyGraph) |
| Resource limits | Single counter (CapacitySource) | Multi-resource (ResourceCapacitySource) |
| Priority ordering | No (FIFO from source) | Yes (PriorityDependencySourceObj) |
| Task source | PullObj (any async iterator) | PriorityDependencySourceObj or DependencySourceObj |
| Progress envelopes | TaskProgressEnvelope | TaskProgressEnvelope (same format) |
| Dynamic task addition | Via PushPullBufferObj | Via DependencyGraph.addNode at runtime |
| Retry support | Manual (re-push to buffer) | Built-in (fail → ready → re-yield) |
| Abort cascades | Manual | Built-in (abort → cascade to dependents) |

**Use `HierarchicalTaskPoolRunner`** when:
- Tasks are independent (no ordering constraints)
- You need simple concurrency limiting with a single counter
- Tasks are entity.start() calls that return AsyncGenerators

**Use `ScheduledTaskPoolRunner`** when:
- Tasks have dependency relationships (DAG structure)
- You need multi-dimensional resource budgeting
- You want built-in retry/abort semantics
- You are building ETL pipelines, build systems, or complex orchestrations

### Using ScheduledTaskPoolRunner in an Entity

```typescript
import {
    DependencyGraph, ResourceCapacitySource,
    PriorityDependencySourceObj, ScheduledTaskPoolRunner,
    ScheduledTask,
} from '@firebrandanalytics/shared-utils';

// Inside an orchestrator's run_impl
protected override async *run_impl(): AsyncGenerator<any, any, never> {
    const stages = dto.data.stages;  // Array of { id, deps, resourceCost }

    // Build the dependency graph
    const graph = new DependencyGraph<string>();
    for (const stage of stages) {
        graph.addNode(stage.id, stage.deps);
    }

    // Build the task map
    const taskMap = new Map<string, ScheduledTask<void, any>>();
    let source: PriorityDependencySourceObj<string, ScheduledTask<void, any>>;

    for (const stage of stages) {
        taskMap.set(stage.id, {
            key: stage.id,
            runner: async () => {
                const entity = await this.appendOrRetrieveCall(
                    StageProcessor, stage.id, stage
                );
                return entity.run();
            },
            cost: stage.resourceCost,
            onComplete: (k) => source.complete(k),
            onError: (k, err) => {
                logger.error(`Stage ${k} failed`, err);
                source.fail(k);  // Retry
            },
        });
    }

    // Wire the source and capacity
    source = new PriorityDependencySourceObj(graph, taskMap, {
        priorityFn: (key) => stages.find(s => s.id === key)?.priority ?? 1,
    });

    const capacity = new ResourceCapacitySource({
        capacity: 5,
        io: 10,
        cpu: 8,
    });

    // Run and stream progress
    const runner = new ScheduledTaskPoolRunner('pipeline', source, capacity);
    for await (const envelope of runner.runTasks(false)) {
        yield {
            type: 'INTERNAL_UPDATE',
            message: `Stage ${envelope.taskId}: ${envelope.type}`,
            metadata: { envelope },
        };
    }
}
```

See also: [Scheduling API Reference](../reference/scheduling.md), [Scheduling Fundamentals Tutorial](../tutorials/scheduling-fundamentals.md), [ETL Pipeline Tutorial](../tutorials/etl-pipeline.md)

---

## CapacitySource vs ResourceCapacitySource

Both enforce concurrency limits, but they differ in dimensionality:

**CapacitySource** (legacy, single counter):
```typescript
const capacity = new CapacitySource(10);       // 10 concurrent slots
const child = new CapacitySource(5, capacity); // Hierarchical
```

**ResourceCapacitySource** (new, multi-resource):
```typescript
const capacity = new ResourceCapacitySource({
    capacity: 10,
    io: 20,
    memory_gb: 32,
});
const child = new ResourceCapacitySource(
    { capacity: 5, io: 8 },
    capacity,  // Hierarchical -- checks parent too
);
```

`CapacitySource` works with `HierarchicalTaskPoolRunner`. `ResourceCapacitySource` works with `ScheduledTaskPoolRunner`. Both support hierarchical parent chains.

---

## PushPullBufferObj as a Dynamic Work Queue

The `PushPullBufferObj` bridges push and pull worlds. In FireFoundry, its most common use is as a dynamic task queue for the `HierarchicalTaskPoolRunner`:

1. The **sink** side accepts new task runners via `sink.next(taskRunner)`
2. The **source** side is consumed by the runner via `for await`
3. Closing the sink (`sink.return()`) signals completion to the runner

This is useful when a parent entity discovers sub-tasks incrementally (e.g., paginating through an API, chunking a document, or processing a file tree).

See also: [PushPullBufferObj API](../reference/utilities.md#pushpullbufferobj)

---

## Waitable Entities and Parallelism

Running `WaitableRunnableEntity` instances in parallel with the task pool runners requires care:

- **No bidirectional communication:** The runners do not have a built-in mechanism to send messages (like approvals) into a running task.
- **Capacity slot blocking:** A waiting entity holds its capacity slot without doing work, which can cause deadlocks in a capacity-limited pool.

**Recommendation:** Orchestrate waitable entities sequentially. Use the parallel runners for non-interactive computation only.

---

## Related Documentation

### Async Streams Library (General TypeScript)
- [Conceptual Guide](../concepts.md) -- Core design philosophy, pull vs push models
- [Scheduling API Reference](../reference/scheduling.md) -- Full API for all scheduling primitives
- [Scheduling Fundamentals Tutorial](../tutorials/scheduling-fundamentals.md) -- Build a scheduling pipeline from scratch
- [ETL Pipeline Tutorial](../tutorials/etl-pipeline.md) -- Multi-stage ETL with resource costs
- [Retry and Error Handling Tutorial](../tutorials/retry-and-error-handling.md) -- Retry, backoff, abort cascades

### FireFoundry SDK
- [Advanced Parallelism Guide](../../../agent_sdk/feature_guides/advanced_parallelism.md) -- Detailed patterns with entity code examples
- [Job Scheduling & Work Queues](../../../agent_sdk/feature_guides/job-scheduling-work-queues.md) -- Cron-based scheduling and background tasks
- [Workflow Orchestration Guide](../../../agent_sdk/feature_guides/workflow_orchestration_guide.md) -- Multi-step workflow patterns
