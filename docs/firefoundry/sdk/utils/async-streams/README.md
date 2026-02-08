# Async Streams Library

A composable async streaming library for TypeScript, providing structured pull and push iterators, fluent pipeline chains, and a full-featured task scheduling engine with dependency graphs, priority queues, and multi-resource capacity management.

## Installation

```typescript
import {
    PullChain, PushChainBuilder,
    SourceBufferObj, PullMapObj, PullFilterObj,
    DependencyGraph, ResourceCapacitySource,
    PriorityDependencySourceObj, ScheduledTaskPoolRunner,
} from '@firebrandanalytics/shared-utils';
```

## Quick Examples

**Pull pipeline** — transform and collect data:
```typescript
const result = await PullChain.from(new SourceBufferObj([1, 2, 3, 4, 5]))
    .filter(x => x % 2 === 0)
    .map(x => x * 10)
    .collect();
// [20, 40]
```

**Push pipeline** — dispatch events to multiple handlers:
```typescript
const chain = PushChainBuilder.start<string>()
    .filter(s => s.length > 0)
    .fork(
        branch => branch.map(s => s.toUpperCase()).into(logSink),
        branch => branch.map(s => s.toLowerCase()).into(archiveSink),
    );
await chain.next("Hello");
```

**Task scheduling** — run dependent tasks with resource limits:
```typescript
const graph = new DependencyGraph<string>();
graph.addNode('extract');
graph.addNode('transform', ['extract']);
graph.addNode('load', ['transform']);

// ... create taskMap, wire PriorityDependencySourceObj, set up ResourceCapacitySource
const runner = new ScheduledTaskPoolRunner('etl', source, capacity);
for await (const envelope of runner.runTasks(false)) {
    console.log(envelope.type, envelope.value);
}
```

## Documentation

### Concepts

| Document | Description |
|----------|-------------|
| [Conceptual Guide](./concepts.md) | Core design philosophy, pull vs push models, Obj pattern, scheduling concepts |
| [Flow Control](./flow-control.md) | Production vs consumption rates, backpressure strategies, dynamic scaling, primitive selection guide |

### API Reference

| Document | Description |
|----------|-------------|
| [Pull Obj Classes](./reference/pull-obj-classes.md) | PullObj, 12 single-stream transforms, 6 many-to-1 combiners, labeled variants, sources |
| [Push Obj Classes](./reference/push-obj-classes.md) | PushObj, 1-to-1 transforms, fork/distribute/roundRobin one-to-many |
| [PullChain API](./reference/pull-chain.md) | Fluent pull pipeline: factories, transforms, terminals, dynamic mutation |
| [PushChain API](./reference/push-chain.md) | PushChainBuilder two-phase construction + PushChain runtime |
| [Scheduling API](./reference/scheduling.md) | DependencyGraph, ResourceCapacitySource, priority sources, task pool runners |
| [Utilities](./reference/utilities.md) | WaitObject, AsyncIteratorCombiner, PushPullBufferObj |

### Tutorials

| Document | Description |
|----------|-------------|
| [Pull Pipeline Basics](./tutorials/pull-pipeline-basics.md) | Build your first pull pipeline with map, filter, reduce, collect |
| [Push Pipeline Basics](./tutorials/push-pipeline-basics.md) | Event dispatching with PushChainBuilder, forking, and branching |
| [Combining Streams](./tutorials/combining-streams.md) | Race, round-robin, concat, zip, and mid-chain merge |
| [Scheduling Fundamentals](./tutorials/scheduling-fundamentals.md) | Dependency graphs, priority queues, resource-aware task execution |
| [ETL Pipeline](./tutorials/etl-pipeline.md) | Multi-stage pipeline with per-stage resource costs |
| [Retry and Error Handling](./tutorials/retry-and-error-handling.md) | Retry/backoff, abort cascades, graceful shutdown patterns |

### Use Cases

| Document | Description |
|----------|-------------|
| [Demand-Paced Ingestion](./use-cases/demand-paced-ingestion.md) | Pull-based backpressure for variable-rate sources with eager prefetch and batched consumption |
| [Burst-Buffered Sink](./use-cases/burst-buffered-sink.md) | Push-based flow control with serialization, sampling, and batched writes |
| [Push-Pull Bridge](./use-cases/push-pull-bridge.md) | Bridging push producers with pull consumers via PushPullBufferObj |
| [Multi-Resource Scheduling](./use-cases/multi-resource-scheduling.md) | Capacity-gated scheduling with heterogeneous GPU/CPU resource budgets |
| [Adaptive Capacity](./use-cases/adaptive-capacity.md) | Dynamic concurrency scaling via the reserve/release pattern |
| [Priority Request Routing (QoS)](./use-cases/priority-request-routing.md) | Tiered user priority with aging-based starvation prevention for LLM broker requests |
| [Latency-Bounded Batching](./use-cases/latency-bounded-batching.md) | Batch by count OR timeout (Kafka batch.size + linger.ms pattern) for pull and push pipelines |
| [Rate-Limiting and Usage Quotas](./use-cases/rate-limiting.md) | Quota-gated scheduling with periodic reset and token bucket patterns |

### Runnable Examples

Self-contained TypeScript programs demonstrating each use case. See the [`examples/`](./examples/) directory.

```bash
cd examples && npm install
npx tsx demand-paced-ingestion.ts
npx tsx burst-buffered-sink.ts
npx tsx push-pull-bridge.ts
npx tsx multi-resource-scheduling.ts
npx tsx adaptive-capacity.ts
npx tsx priority-request-routing.ts
npx tsx latency-bounded-batching.ts
```

### Platform Integration

| Document | Description |
|----------|-------------|
| [FireFoundry Agent Integration](./firefoundry/agent-integration.md) | Using async streams with FireFoundry entities, bots, and workflows |
