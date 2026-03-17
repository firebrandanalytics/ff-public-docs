# Performance & Optimization Guide

This guide covers techniques for improving the throughput, latency, and resource efficiency of FireFoundry agent bundles. It spans prompt optimization, concurrency tuning, memory management, caching strategies, and entity graph efficiency.

**Prerequisites:** Familiarity with the [SDK Quick-Start](sdk-quickstart.md), [Entity Lifecycle & Patterns](entity-lifecycle-patterns.md), and [Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md).

---

## Table of Contents

- [Performance Model](#performance-model)
- [Prompt Optimization](#prompt-optimization)
- [Concurrency & Parallelism](#concurrency--parallelism)
- [Entity Graph Efficiency](#entity-graph-efficiency)
- [Memory Management](#memory-management)
- [Caching Strategies](#caching-strategies)
- [Streaming & SSE Optimization](#streaming--sse-optimization)
- [Model Pool Selection](#model-pool-selection)
- [Measuring Performance](#measuring-performance)
- [Common Bottlenecks](#common-bottlenecks)

---

## Performance Model

Understanding where time is spent in a typical agent bundle request helps you prioritize optimization efforts:

```
Request lifecycle (typical distribution):

  API Endpoint          ~1%    (parse request, validate input)
  Entity Creation       ~2%    (create node in entity graph)
  Bot Execution        ~85%    (LLM call via broker)
    ├─ Prompt rendering  ~1%
    ├─ Network to broker ~2%
    ├─ LLM inference    ~80%
    └─ Response parsing  ~2%
  Entity Update         ~2%    (persist result to entity graph)
  Response              ~1%    (serialize and return)
  Overhead              ~9%    (logging, telemetry, etc.)
```

**Key insight:** LLM inference dominates execution time. The most impactful optimizations reduce the number of LLM calls, the size of prompts, or the latency of individual calls.

---

## Prompt Optimization

### Reduce Token Count

Every token in a prompt costs time and money. Minimize prompt size without losing essential instructions:

```typescript
// Before: verbose prompt (320 tokens)
const verbosePrompt = new Prompt({
  role: 'system',
  content: `You are a highly skilled professional analyst. Your job is to
    carefully analyze the provided document and generate a comprehensive
    summary that captures all the important details, key themes, and
    significant findings. Please make sure to include relevant quotes
    and statistics. The summary should be well-organized and easy to read.`,
});

// After: concise prompt (80 tokens)
const concisePrompt = new Prompt({
  role: 'system',
  content: `Analyze the document. Return a structured summary with:
    - Key findings (with supporting quotes/stats)
    - Main themes
    - Significance`,
});
```

### Use Schema-Driven Output

`StructuredOutputBotMixin` tells the LLM exactly what shape to produce, reducing retries from malformed output:

```typescript
// The schema acts as both validation AND prompt guidance
const AnalysisSchema = z.object({
  summary: z.string().describe('2-3 sentence overview'),
  findings: z.array(z.object({
    claim: z.string(),
    evidence: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
  })).describe('Key findings with evidence'),
  themes: z.array(z.string()).describe('3-5 main themes'),
});
```

### Avoid Redundant Context

Don't repeat information the LLM already has from the system prompt:

```typescript
// Before: repeats system context in user message
const messages = [
  { role: 'system', content: 'You are an analyst. Summarize documents.' },
  { role: 'user', content: 'You are an analyst. Please summarize this document: ...' },
];

// After: system sets the role, user provides the task
const messages = [
  { role: 'system', content: 'You are an analyst. Summarize documents.' },
  { role: 'user', content: 'Summarize: ...' },
];
```

### Batch Small Items

Instead of making one LLM call per item, batch items into a single call when the outputs are independent:

```typescript
// Before: 10 LLM calls (slow)
for (const item of items) {
  const result = await this.classifyBot.execute({
    input: `Classify: ${item.text}`,
    // ...
  });
}

// After: 1 LLM call (fast)
const batchInput = items
  .map((item, i) => `${i + 1}. ${item.text}`)
  .join('\n');

const result = await this.batchClassifyBot.execute({
  input: `Classify each item:\n${batchInput}`,
  // Schema: z.array(z.object({ index: z.number(), category: z.string() }))
});
```

> **Tip:** Batching works best when each item is small and the combined prompt stays under the model's sweet spot (roughly 4,000 tokens for classification tasks). For larger items, use parallel entity execution instead.

---

## Concurrency & Parallelism

### Parallel Entity Execution

Use the `parallel` control flow helper to run independent entities concurrently:

```typescript
protected async run_impl() {
  const documents = await this.getDocuments();

  // Process all documents in parallel
  await this.parallel(
    documents.map(doc => async () => {
      const child = await this.createChildEntity('AnalysisEntity', {
        documentId: doc.id,
        content: doc.text,
      });
      await child.run();
    })
  );

  // Aggregate results after all complete
  await this.aggregateResults();
}
```

### Controlling Concurrency

Unbounded parallelism can overwhelm the broker or exhaust memory. Limit concurrency with the async streams library:

```typescript
import { asyncChain } from '@firebrandanalytics/shared-utils/async-streams';

protected async run_impl() {
  const documents = await this.getDocuments();

  // Process with concurrency limit of 5
  await asyncChain(documents)
    .parallel(5, async (doc) => {
      const child = await this.createChildEntity('AnalysisEntity', {
        documentId: doc.id,
      });
      await child.run();
    })
    .drain();
}
```

### Pipeline Parallelism

For multi-stage workflows, overlap stages using entity-based parallelism:

```typescript
// Instead of: fetch → parse → analyze → summarize (sequential)
// Use: entity per document, each runs its own pipeline

protected async run_impl() {
  // Stage 1: Create all document entities (fast)
  const entities = await this.forEach(documents, async (doc) => {
    return this.createChildEntity('DocumentPipelineEntity', {
      url: doc.url,
    });
  });

  // Stage 2: Run all pipelines in parallel
  // Each DocumentPipelineEntity internally: fetch → parse → analyze → summarize
  await this.parallel(
    entities.map(entity => () => entity.run())
  );
}
```

---

## Entity Graph Efficiency

### Minimize Graph Reads

Each `get_dto()` call reads from the entity graph database. Cache the DTO when you need it multiple times:

```typescript
// Before: multiple graph reads
protected async run_impl() {
  const dto1 = await this.get_dto();  // Read 1
  const name = dto1.data.name;

  await this.run_bot();

  const dto2 = await this.get_dto();  // Read 2 (unnecessary if data unchanged)
  const status = dto2.status;
}

// After: single read, reuse the result
protected async run_impl() {
  const dto = await this.get_dto();
  const { name } = dto.data;

  await this.run_bot();
  // Entity framework updates status automatically — no need to re-read
}
```

### Batch Entity Operations

When creating multiple child entities, the entity graph supports batch operations:

```typescript
// Before: sequential entity creation (N round trips)
for (const item of items) {
  await this.entity_factory.create_entity_node({
    name: `analysis-${item.id}`,
    specific_type_name: 'AnalysisEntity',
    data: item,
  });
}

// After: create entities in parallel (concurrent round trips)
await Promise.all(items.map(item =>
  this.entity_factory.create_entity_node({
    name: `analysis-${item.id}`,
    specific_type_name: 'AnalysisEntity',
    data: item,
  })
));
```

### Use Scoped Queries

When searching for entities, use scoped queries with filters rather than fetching all entities and filtering in code:

```typescript
// Before: fetch all, filter in JS (slow for large graphs)
const all = await this.entity_client.query_entity_nodes({ app_id: appId });
const errors = all.filter(e => e.status === 'Error');

// After: scoped query (fast, database-level filtering)
const errors = await this.entity_client.query_entity_nodes({
  app_id: appId,
  status: 'Error',
  specific_type_name: 'AnalysisEntity',
});
```

### Keep Entity Data Lean

Store only essential data on entity nodes. Use working memory for large content:

```typescript
// Before: large content on entity data (bloats graph queries)
await this.entity_factory.create_entity_node({
  name: 'analysis-1',
  data: {
    documentContent: largeDocument,  // 50KB+ string on entity
    metadata: { title: 'Report' },
  },
});

// After: store large content in working memory
const entity = await this.entity_factory.create_entity_node({
  name: 'analysis-1',
  data: {
    metadata: { title: 'Report' },
    // Reference to working memory, not the content itself
  },
});

// Store the large content in working memory
await this.context_client.write({
  entityId: entity.id,
  key: 'document-content',
  content: largeDocument,
});
```

---

## Memory Management

### Avoid Accumulating Large Arrays

In `forEach` loops over many items, avoid building up a large in-memory array of results:

```typescript
// Before: accumulates all results in memory
const allResults: Result[] = [];
await this.forEach(thousandsOfItems, async (item) => {
  const result = await processItem(item);
  allResults.push(result);  // Memory grows with each item
});

// After: persist results as you go
await this.forEach(thousandsOfItems, async (item) => {
  const result = await processItem(item);
  // Persist immediately to working memory or entity graph
  await this.context_client.write({
    entityId: this.id,
    key: `result-${item.id}`,
    content: JSON.stringify(result),
  });
});
```

### Stream Large Responses

For endpoints that return large datasets, use SSE streaming instead of buffering the entire response:

```typescript
@ApiEndpoint({ method: 'GET', route: 'results', streaming: true })
async *getResults(params: { entityId: string }) {
  const children = await this.getChildEntities(params.entityId);

  for (const child of children) {
    const dto = await child.get_dto();
    yield { type: 'result', data: dto.data };
  }

  yield { type: 'complete', data: { total: children.length } };
}
```

### Clean Up Temporary Entities

Long-running workflows that create temporary entities should clean them up when finished:

```typescript
protected async run_impl() {
  const tempEntities: string[] = [];

  try {
    // Create temporary working entities
    const temp = await this.createChildEntity('TempProcessingEntity', data);
    tempEntities.push(temp.id);

    await temp.run();
    const result = await temp.get_dto();

    // Use the result
    await this.updateData({ result: result.data });
  } finally {
    // Clean up temporary entities
    for (const id of tempEntities) {
      await this.entity_client.delete_entity_node(id).catch(() => {});
    }
  }
}
```

---

## Caching Strategies

### Bot Result Caching via Entity Resumability

The entity framework's resumability acts as an automatic cache. Re-running an entity that has already completed returns the cached result:

```typescript
// First call: runs the bot, persists result
const entity = await factory.create_entity_node({ name: 'analysis-doc-123', ... });
await entity.run();  // LLM call happens here

// Second call with same name: returns cached result (no LLM call)
const existing = await factory.findByName('analysis-doc-123');
if (existing.status === 'Completed') {
  return existing.data;  // Cached result
}
```

### Working Memory as Cache

Store expensive computation results in working memory for reuse:

```typescript
async getOrComputeEmbedding(text: string): Promise<number[]> {
  const cacheKey = `embedding-${hashString(text)}`;

  // Check cache
  const cached = await this.context_client.read({
    entityId: this.id,
    key: cacheKey,
  }).catch(() => null);

  if (cached) {
    return JSON.parse(cached);
  }

  // Compute and cache
  const embedding = await this.computeEmbedding(text);
  await this.context_client.write({
    entityId: this.id,
    key: cacheKey,
    content: JSON.stringify(embedding),
  });

  return embedding;
}
```

### Prompt Template Caching

Prompt groups are instantiated once and reused. Avoid creating new prompt instances on every bot execution:

```typescript
// Good: prompt group created once (module-level)
const analysisPromptGroup = new PromptGroup([
  new SystemPrompt(),
  new TaskPrompt(),
]);

@RegisterBot('AnalysisBot')
export class AnalysisBot extends ComposeMixins(...)<[...]> {
  constructor() {
    super([{
      base_prompt_group: analysisPromptGroup,  // Reused across calls
      // ...
    }]);
  }
}
```

---

## Streaming & SSE Optimization

### Iterator Proxies for Cross-Bundle Streaming

When consuming streaming results from another bundle, use `IteratorProxy` to avoid buffering:

```typescript
import { IteratorProxy } from '@firebrandanalytics/ff-agent-sdk/client';

// Stream results from a remote bundle without buffering
const stream = await appClient.stream('process', { documentId: 'doc-123' });

for await (const event of stream) {
  // Process each event as it arrives
  await handleEvent(event);
}
```

### Yield Early, Yield Often

For SSE endpoints, send progress updates to keep clients informed:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze', streaming: true })
async *analyze(data: { documentId: string }) {
  yield { type: 'status', data: { step: 'starting', progress: 0 } };

  const entity = await this.createAnalysisEntity(data.documentId);
  yield { type: 'status', data: { step: 'entity_created', progress: 10 } };

  await entity.run();
  yield { type: 'status', data: { step: 'analysis_complete', progress: 90 } };

  const result = await entity.get_dto();
  yield { type: 'result', data: result.data };
  yield { type: 'status', data: { step: 'done', progress: 100 } };
}
```

---

## Model Pool Selection

Different model pools offer different performance characteristics. Choose the right pool for each bot:

| Pool | Latency | Quality | Cost | Best For |
|------|---------|---------|------|----------|
| `firebrand_completion_fast` | Low | Good | Low | Classification, extraction, simple formatting |
| `firebrand_completion_default` | Medium | High | Medium | Analysis, summarization, complex reasoning |
| `firebrand_completion_large` | High | Highest | High | Multi-step reasoning, creative writing |

### Use Fast Models for Simple Tasks

```typescript
// Classification doesn't need a large model
@RegisterBot('ClassifierBot')
export class ClassifierBot extends ComposeMixins(...)<[...]> {
  constructor() {
    super([{
      name: 'ClassifierBot',
      model_pool_name: 'firebrand_completion_fast',  // Fast, cheap
      max_tries: 2,
      // ...
    }]);
  }
}

// Complex analysis benefits from a capable model
@RegisterBot('DeepAnalysisBot')
export class DeepAnalysisBot extends ComposeMixins(...)<[...]> {
  constructor() {
    super([{
      name: 'DeepAnalysisBot',
      model_pool_name: 'firebrand_completion_default',  // Higher quality
      max_tries: 3,
      // ...
    }]);
  }
}
```

---

## Measuring Performance

### Telemetry Queries

Use `ff-telemetry-read` to analyze real execution times:

```bash
# View recent broker request latencies
ff-telemetry-read broker recent --limit 20

# Find slow requests (> 30s)
ff-telemetry-read broker slow --threshold 30000

# Analyze token usage by bot
ff-telemetry-read llm by-bot --app-id $APP_ID

# Trace a specific request end-to-end
ff-telemetry-read trace get <broker-request-id>
```

### Entity-Level Timing

Track timing within entity execution:

```typescript
protected async run_impl() {
  const start = Date.now();

  await this.run_bot();

  const elapsed = Date.now() - start;
  logger.info('Entity execution completed', {
    entityId: this.id,
    elapsedMs: elapsed,
    entityType: this.get_specific_type_name(),
  });
}
```

### Async Streams Metrics

For pipeline-based processing, use the built-in metrics collectors:

```typescript
import {
  DefaultChainMetricsCollector,
} from '@firebrandanalytics/shared-utils/async-streams';

const metrics = new DefaultChainMetricsCollector();

await asyncChain(items)
  .parallel(5, processItem)
  .withMetrics(metrics)
  .drain();

console.log('Throughput:', metrics.getThroughput());
console.log('Avg latency:', metrics.getAverageLatency());
```

---

## Common Bottlenecks

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| High latency per request | Large prompts, verbose system messages | Trim prompts, use schema-driven output |
| Low throughput despite available resources | Sequential entity processing | Use `parallel` or `forEach` with concurrency |
| Memory spikes during batch processing | Accumulating results in memory | Stream results, persist incrementally |
| Frequent bot retries | Ambiguous prompts, wrong schema | Improve prompt clarity, simplify schema |
| Slow entity creation | Creating entities sequentially | Batch with `Promise.all` |
| High broker wait times | All bots using the same model pool | Split workloads across fast/default pools |
| Timeouts on complex workflows | Single entity doing too much | Break into smaller child entities |

---

## Related Guides

- **[Deployment & Configuration](deployment-configuration.md)** — resource tuning and scaling for production
- **[Monitoring & Debugging](monitoring-debugging.md)** — identifying bottlenecks with telemetry
- **[Prompt Patterns Cookbook](prompt-patterns-cookbook.md)** — efficient prompt construction
- **[Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md)** — parallel and pipelined workflows
- **[Advanced Parallelism](../feature_guides/advanced_parallelism.md)** — fine-grained concurrency control
- **[Error Handling & Resilience](error-handling-resilience.md)** — reducing retries through better error handling
