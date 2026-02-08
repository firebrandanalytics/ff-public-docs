# Advanced Parallelism Guide

## 1. Introduction: Beyond Basic Parallelism

The [Multi-Step Workflow Orchestration Guide](./workflow_orchestration_guide.md) introduces a basic pattern for parallel execution using `Promise.allSettled`. While effective for simple, independent tasks, it has two key limitations:

1.  **Loss of Progress Streaming:** It relies on the `.run()` method, which returns a promise of the final result. This means you lose the rich, real-time `INTERNAL_UPDATE` progress envelopes streamed by child entities.
2.  **No Concurrency Control:** `Promise.allSettled` immediately starts all tasks. This is problematic when processing a large number of items, as it can overwhelm resources or hit API rate limits.

This guide introduces two powerful patterns for advanced parallelism that solve these problems, enabling you to build sophisticated, high-performance, and resource-aware workflows in FireFoundry.

-   **`AsyncIteratorCombiner`**: For simple, fixed-N parallelism with full progress streaming.
-   **`HierarchicalTaskPoolRunner`**: For production-grade, capacity-limited concurrency with support for dynamic task sources.
-   **`ScheduledTaskPoolRunner`**: For dependency-aware scheduling with multi-resource capacity and priority ordering (see [Async Streams -- FireFoundry Integration](../../utils/async-streams/firefoundry/agent-integration.md)).

> **Library Reference:** The streaming and scheduling primitives used in this guide are documented in the [Async Streams Library](../../utils/async-streams/README.md). See the [Scheduling API Reference](../../utils/async-streams/reference/scheduling.md) for full method signatures and the [Scheduling Fundamentals Tutorial](../../utils/async-streams/tutorials/scheduling-fundamentals.md) for a step-by-step walkthrough.

## 2. Pattern 1: Simple Parallelism with Progress Streaming (`AsyncIteratorCombiner`)

This pattern is the direct upgrade to `Promise.allSettled` when you need to retain progress streaming.

**When to Use It:**
You have a small, fixed number of parallel steps (e.g., 2-5) that can all be started immediately, and you want to create a single, unified stream of their progress updates as they happen.

**Concept:**
The `AsyncIteratorCombiner` takes multiple `AsyncGenerator` streams (from `entity.start()`) and "races" them against each other. Its `race_generator()` method yields the next progress envelope from whichever child entity produces one first, allowing you to consume a single, interleaved stream of updates in the order they are resolved.

**Code Example:**
Imagine an orchestrator that needs to run three independent analysis steps on the same data and stream their collective progress.

```typescript
import { AsyncIteratorCombiner } from './iterator_combiner.js'; // Adjust path as needed

// ... inside an orchestrator's run_impl method

// Phase 1: Create the independent steps
const sentimentAnalyzer = await this.appendOrRetrieveCall(
  SentimentAnalysisStep, "sentiment_analysis", { input: preprocessedData }
);
const topicExtractor = await this.appendOrRetrieveCall(
  TopicExtractionStep, "topic_extraction", { input: preprocessedData }
);
const keywordAnalyzer = await this.appendOrRetrieveCall(
  KeywordAnalysisStep, "keyword_analysis", { input: preprocessedData }
);

// Phase 2: Start the steps to get their AsyncGenerator iterators
const sentimentIterator = await sentimentAnalyzer.start();
const topicIterator = await topicExtractor.start();
const keywordIterator = await keywordAnalyzer.start();

// Phase 3: Combine the iterators
const combiner = new AsyncIteratorCombiner(
  sentimentIterator,
  topicIterator,
  keywordIterator
);

// Phase 4: Consume the unified progress stream
yield {
  type: "INTERNAL_UPDATE",
  message: "Starting parallel analysis with progress streaming.",
  metadata: { parallelSteps: combiner.size }
};

// This loop will yield progress from any of the three steps as soon as it's available.
for await (const progressEnvelope of combiner.race_generator()) {
  yield progressEnvelope;
}

yield {
  type: "INTERNAL_UPDATE",
  message: "All parallel analyses have completed."
};

// The individual results are now persisted in the child entities and can be
// retrieved if needed for a final synthesis step.
const sentimentResult = await sentimentAnalyzer.run();
const topicResult = await topicExtractor.run();
const keywordResult = await keywordAnalyzer.run();

// ... combine results and return
```

## 3. Pattern 2: Production-Grade Concurrency (`HierarchicalTaskPoolRunner`)

This is the industrial-strength solution for managing complex, dynamic, and resource-intensive parallel workloads.

**When to Use It:**
*   You need to process a **large or variable** number of tasks.
*   You must **limit concurrency** to respect API rate limits or control resource usage.
*   The tasks are **discovered dynamically** at runtime (e.g., processing files in a directory).

**Core Components:**

1.  **Task Source**: An iterator that yields **task runner functions** (e.g., `() => entity.start()`). A task is only started when the runner invokes this function.
2.  **Capacity Source**: The gatekeeper that enforces concurrency limits, including sophisticated hierarchical policies.
3.  **The Runner**: The engine that pulls tasks from the source, acquires capacity, executes the tasks, and streams back the results in tagged envelopes.

### 3.1 Basic Concurrency Limiting

**Scenario:** You need to process an array of 100 documents, but you should only process a maximum of 10 at a time to avoid overwhelming a downstream service.

```typescript
import { HierarchicalTaskPoolRunner } from './HierarchicalTaskPoolRunner.js';
import { CapacitySource } from './CapacitySource.js';
import { SourceBufferObj, BufferMode } from './pull_iterators_obj.js';

// ... inside an orchestrator's run_impl method
const dto = await this.get_dto();
const documentsToProcess = dto.data.documents; // An array of document data

// 1. Define the concurrency limit
const MAX_CONCURRENT_TASKS = 10;
const capacitySource = new CapacitySource(MAX_CONCURRENT_TASKS);

// 2. Create the task source: an array of functions that will start our entities.
//    Note: The entities are NOT started here. They are started by the runner.
const taskRunners = [];
for (let i = 0; i < documentsToProcess.length; i++) {
  const doc = documentsToProcess[i];
  taskRunners.push(
    // This function is the "task runner"
    async () => {
      const docProcessor = await this.appendOrRetrieveCall(
        DocumentProcessingStep,
        `doc_processor_${doc.id}`,
        { document: doc }
      );
      return docProcessor.start();
    }
  );
}
const taskSource = new SourceBufferObj(taskRunners, true, BufferMode.FIFO);

// 3. Instantiate the runner
const runner = new HierarchicalTaskPoolRunner(
  'document-processing-pool',
  taskSource,
  capacitySource
);

// 4. Run the tasks and handle the nested progress envelopes
for await (const outerEnvelope of runner.runTasks()) {
  if (outerEnvelope.type === 'INTERMEDIATE' || outerEnvelope.type === 'FINAL') {
    // The 'value' of the runner's envelope is the original progress envelope
    // from the child entity (DocumentProcessingStep).
    const innerEnvelope = outerEnvelope.value;
    
    // Here, you can add the taskId for enhanced logging or tracking
    innerEnvelope.metadata.taskId = outerEnvelope.taskId;
    
    // Yield the original progress update to the orchestrator's consumer
    yield innerEnvelope;

  } else if (outerEnvelope.type === 'ERROR') {
    // Handle errors from a specific task
    logger.error(`Task ${outerEnvelope.taskId} failed`, { error: outerEnvelope.error });
    // Optionally, decide whether to continue or throw
  }
}

return { success: true, message: "All documents processed." };
```

### 3.2 Hierarchical Capacity for Fair Resource Sharing

**Scenario:** You have a platform-wide limit of 30 concurrent database connections. Three different high-volume workflows (A, B, and C) run in parallel. You want to prevent any one workflow from using all 30 connections and starving the others, but you also want to allow workflows to use more than their "fair share" if others are idle, maximizing throughput.

**Concept:** A parent `CapacitySource` holds the global limit. Each workflow creates its own child `CapacitySource` with a higher individual limit, which must also acquire capacity from the parent.

**Example Configuration:**

*   **Global Limit:** 30 connections.
*   **Individual Limits:** Each of the 3 workflows gets a capacity of 14.

This ensures:
*   **No Starvation:** Any two workflows running at full capacity (14 + 14 = 28) will still leave 2 slots available for the third workflow.
*   **High Throughput:** If workflow A is idle, workflows B and C can each use up to 14 connections (totaling 28), which is more than their "fair share" of 10, thus maximizing resource utilization.

**Code Snippet:**

```typescript
// In a shared location or bundle initialization
const GLOBAL_DB_CAPACITY = new CapacitySource(30);

// In Workflow A's orchestrator
const workflowACapacity = new CapacitySource(14, GLOBAL_DB_CAPACITY);
const runnerA = new HierarchicalTaskPoolRunner('workflow-a-pool', taskSourceA, workflowACapacity);
// ...

// In Workflow B's orchestrator
const workflowBCapacity = new CapacitySource(14, GLOBAL_DB_CAPACITY);
const runnerB = new HierarchicalTaskPoolRunner('workflow-b-pool', taskSourceB, workflowBCapacity);
// ...
```

### 3.3 Dynamic and Streaming Task Sources

The true power of the `HierarchicalTaskPoolRunner` is its ability to consume tasks from a live, dynamic source, enabling pipeline parallelism.

#### 3.3.1 Pipelined Parallelism with a Generator Source

**Scenario:** You need to process a very large document by chunking it and analyzing each chunk. You want to start analyzing the first chunks as soon as they are ready, without waiting for the entire document to be chunked.

**Concept:** The task source itself is an `AsyncGenerator`. The runner will pull from this generator, allowing the "discovery" of tasks (chunking) to happen in parallel with the "execution" of those tasks (analysis).

```typescript
// ... inside an orchestrator's run_impl method
const capacitySource = new CapacitySource(5); // Analyze 5 chunks at a time

// 1. Define the task source as an async generator function.
//    This generator discovers work and yields functions to execute that work.
async function* chunkerAndTaskSource(documentId: string) {
  const documentReader = openDocumentStream(documentId);
  let chunkIndex = 0;
  for await (const chunk of documentReader) {
    // CRITICAL: We are yielding a FUNCTION that, when called by the runner,
    // will create and start the entity. This is the key to lazy, on-demand execution.
    yield async () => {
      const chunkAnalyzer = await this.appendOrRetrieveCall(
        ChunkAnalysisStep,
        `chunk_${documentId}_${chunkIndex++}`,
        { chunkData: chunk }
      );
      return chunkAnalyzer.start();
    };
  }
}

// 2. Instantiate the runner with the generator as its source
const runner = new HierarchicalTaskPoolRunner(
  'chunk-analysis-pool',
  chunkerAndTaskSource(dto.data.documentId),
  capacitySource
);

// 3. Run the tasks. The runner will start processing the first 5 chunks
//    while the chunkerAndTaskSource continues to read and yield new chunks
//    in the background.
for await (const envelope of runner.runTasks()) {
  yield envelope.value;
}
```

#### 3.3.2 Dynamic Task Injection with a Buffer Source

**Scenario:** A main process discovers sub-tasks that need to be executed in parallel. The runner should start processing sub-tasks as soon as they are found, and if it runs out of work, it should wait for the main process to find more.

**Concept:** Use a `PushPullBufferObj` as the task source. The runner "pulls" tasks from the buffer's source end. Your main logic can "push" new task runners into the buffer's sink end at any time.

```typescript
import { PushPullBufferObj } from './push_pull_adaptors.js';

// ... inside an orchestrator's run_impl method
const capacitySource = new CapacitySource(5);

// 1. Create a buffer to act as a dynamic work queue.
const taskQueue = new PushPullBufferObj<() => AsyncGenerator>();

// 2. Instantiate the runner, using the buffer's source as its task source.
const runner = new HierarchicalTaskPoolRunner(
  'dynamic-task-pool',
  taskQueue.source,
  capacitySource
);

// 3. We will run the producer (discovers tasks) and consumer (processes results) in parallel.
const producer = async () => {
  // Simulate discovering tasks over time.
  for (let i = 0; i < 10; i++) {
    const taskId = i;
    // Push a new task runner into the queue. The waiting runner will pick this up immediately.
    await taskQueue.sink.next(async () => {
      const subTask = await this.appendOrRetrieveCall(SubTaskStep, `subtask_${taskId}`);
      return subTask.start();
    });
    // Simulate time between task discovery.
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // IMPORTANT: Close the sink to signal that no more tasks are coming.
  // This allows the runner and the consumer loop to terminate gracefully.
  await taskQueue.sink.return();
};

const consumer = async () => {
  const results = [];
  for await (const envelope of runner.runTasks()) {
    if (envelope.type === 'FINAL') {
      results.push(envelope.value);
    }
    yield envelope.value; // Stream progress
  }
  return results;
};

// Run both concurrently.
const [_, finalResults] = await Promise.all([producer(), consumer()]);

return finalResults;
```

## 4. A Note on Parallelizing Waitable Entities

> **Important:** Running `WaitableRunnableEntity` instances in parallel using the patterns in this chapter is an advanced use case that is **not fully supported** by the `HierarchicalTaskPoolRunner` and requires special care.
>
> `Waitable` entities have a unique lifecycle that involves pausing execution to await external input. The current task runners are designed for continuous, one-way data flow (tasks stream results *out*) and have two fundamental limitations regarding waitables:
>
> 1.  **No Bidirectional Communication:** The `HierarchicalTaskPoolRunner` does not have a built-in mechanism to send a message (like an approval or rejection) *into* a specific task that is already running. This prevents the standard use of the `.sendMessage()` method to resume a waiting entity.
> 2.  **No "Task Pausing" Support:** When a waitable entity enters its `Waiting` state, it is effectively paused. However, from the runner's perspective, the task is still active and continues to occupy a capacity slot without performing any work. This can lead to deadlocks or inefficient use of resources, especially in a capacity-limited pool.
>
> **Recommendation:** For workflows that involve human-in-the-loop steps or other `Waitable` entities, we strongly recommend orchestrating them in a **sequential manner**.

## 5. Conclusion and Pattern Summary

Choosing the right parallelism pattern is key to building efficient and scalable workflows. This guide has provided powerful tools to handle everything from simple streaming to complex, resource-aware concurrency.

Here is a summary to help you choose the right tool for the job:

| Pattern                         | Progress Streaming | Concurrency Control | Dynamic Tasks | Best Use Case                                                                              |
| ------------------------------- | :----------------: | :-----------------: | :-----------: | ------------------------------------------------------------------------------------------ |
| **`Promise.allSettled`**        |         ❌         |         ❌          |      ❌       | Simple, fire-and-forget parallelism where only the final results matter.                     |
| **`AsyncIteratorCombiner`**     |         ✅         |         ❌          |      ❌       | Small, fixed number of tasks where you need to stream progress from all of them together.      |
| **`HierarchicalTaskPoolRunner`**|         ✅         |         ✅          |      ✅       | Large, variable, or dynamic sets of tasks that require concurrency limiting and high throughput. |
| **`ScheduledTaskPoolRunner`**  |         ✅         |         ✅          |      ✅       | Tasks with dependency ordering, multi-resource budgets, priority, retry/abort. See [integration guide](../../utils/async-streams/firefoundry/agent-integration.md). |

---
## Appendix A: Understanding Eagerness, Buffering, and Throughput

The asynchronous tools in FireFoundry are built on powerful iterator models. This section explains the different execution strategies and how they impact performance.

**Lazy vs. Eager Execution Models**

Our streaming library contains two primary models: pull and push.
*   The **pull-based model** is fundamentally **lazy**. Work is only performed when a consumer explicitly requests (`pulls`) the next item from an iterator. This is simple and memory-efficient but can create performance bottlenecks if the consumer and producer run in lockstep.
*   The **push-based model** is inherently **eager**. A producer sends (`pushes`) data as soon as it's available, without waiting for the consumer to ask for it.

For finer-grained control within the pull model, the library also provides `PullEager` wrappers. These wrappers perform a read-ahead of one item, creating partial eagerness. However, achieving full eagerness (where a producer can run far ahead of a consumer) requires explicit buffering.

**The `HierarchicalTaskPoolRunner`: An Eager Executor**

The `HierarchicalTaskPoolRunner` is designed for maximum throughput and uses an **eager execution strategy**.

When a capacity slot opens up (because a task has finished), the runner does two things simultaneously:
1.  It places the result of the completed task into an internal results buffer, ready for you to pull.
2.  It **immediately** pulls the next available task from its task source and starts executing it in the now-vacant slot.

This means the runner does not wait for you to consume the result of Task A before it starts working on Task F (assuming a capacity of 5). It proactively keeps its worker slots full to ensure resources are never idle if there is work to be done.

This provides natural backpressure: if you stop consuming results, the runner's internal results buffer will eventually fill up, and it will pause, unable to start new tasks until you resume.

**Advanced Pattern: Decoupling Production and Consumption**

In some high-throughput scenarios, you may want the `HierarchicalTaskPoolRunner` to process an entire batch of 100s of items as quickly as possible, even if the downstream consumer of those results is slow.

You can achieve this by introducing a `PushPullBufferObj` to fully decouple the runner's production from the consumer's logic.

> **Warning:** This is an advanced pattern that can consume significant memory, as it will buffer all results if the consumer is slow. Use it only when you need to complete all tasks as quickly as possible and can handle the memory implications.

The pattern involves running the task processing loop in a separate, non-awaited async function that populates a buffer. Your main logic then consumes from this buffer at its own pace.

```typescript
// DRAFT - Conceptual Example
import { PushPullBufferObj } from './push_pull_adaptors.js';

protected override async *run_impl(): AsyncGenerator<any, any, never> {
  // ... setup for runner, capacitySource, and taskSource ...
  const runner = new HierarchicalTaskPoolRunner('my-pool', taskSource, capacitySource);
  
  // 1. Create a buffer to hold results
  const resultsBuffer = new PushPullBufferObj<TaskProgressEnvelope<any, any>>();

  // 2. Start the runner in a separate, non-awaited function
  //    This function will run at full speed, populating the buffer.
  (async () => {
    try {
      for await (const envelope of runner.runTasks()) {
        await resultsBuffer.sink.next(envelope); // Push result to buffer
      }
      // Signal that production is complete
      await resultsBuffer.sink.return();
    } catch (e) {
      // Handle errors by rejecting the source side of the buffer
      // This will cause the consumer loop below to throw an error.
      await (resultsBuffer.source as any).throw(e);
    }
  })();

  // 3. The main logic can now consume from the buffer at its own pace
  //    The runner continues to work in the background.
  let finalResults = [];
  for await (const envelope of resultsBuffer.source) {
    // Process results slowly
    await processEnvelope(envelope);
    if (envelope.type === 'FINAL') {
      finalResults.push(envelope.value);
    }
  }

  return finalResults;
}
```

---

## See Also

- **[Async Streams Library](../../utils/async-streams/README.md)** -- Full documentation for the streaming and scheduling primitives used in this guide
- **[FireFoundry Agent Integration](../../utils/async-streams/firefoundry/agent-integration.md)** -- Using async streams with entities, including `ScheduledTaskPoolRunner` patterns
- **[Scheduling API Reference](../../utils/async-streams/reference/scheduling.md)** -- `DependencyGraph`, `ResourceCapacitySource`, `PriorityDependencySourceObj`, `ScheduledTaskPoolRunner`
- **[Utilities Reference](../../utils/async-streams/reference/utilities.md)** -- `AsyncIteratorCombiner`, `PushPullBufferObj`, `CapacitySource`