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

### Platform Integration

| Document | Description |
|----------|-------------|
| [FireFoundry Agent Integration](./firefoundry/agent-integration.md) | Using async streams with FireFoundry entities, bots, and workflows |
