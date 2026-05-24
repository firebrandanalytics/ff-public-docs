# Entity Lifecycle & Patterns Guide

This guide covers entity composition, lifecycle hooks, control flow helpers, and common patterns for building entities in the FireFoundry SDK. It assumes familiarity with the [Core Entities Guide](../core/entities.md) and the [SDK Quick-Start](sdk-quickstart.md).

---

## Table of Contents

- [Mixin Composition](#mixin-composition)
- [Entity Lifecycle](#entity-lifecycle)
- [Bot Integration (Three-Phase Pattern)](#bot-integration-three-phase-pattern)
- [Control Flow Helpers](#control-flow-helpers)
- [Child Entity Creation](#child-entity-creation)
- [Progress Reporting](#progress-reporting)
- [Common Patterns](#common-patterns)

---

## Mixin Composition

Entities are built by composing mixins onto `EntityNode`. The SDK provides two utilities for this: `AddMixins` and `ComposeMixins` (from `@firebrandanalytics/shared-utils`).

### Pre-Composed Base Classes

For common combinations, the SDK provides ready-made classes:

| Class | Composition | Use Case |
|-------|-------------|----------|
| `RunnableEntity` | `EntityNode` + `RunnableEntityMixin` | Entities that execute logic |
| `WaitableRunnableEntity` | `RunnableEntity` + `WaitableRunnableEntityMixin` | Entities that pause for external input |

### AddMixins

Use `AddMixins` when composing a base class with one or more mixins. Constructor arguments are passed as arrays matching mixin order:

```typescript
import { AddMixins } from '@firebrandanalytics/shared-utils';
import { RunnableEntity, BotRunnableEntityMixin } from '@firebrandanalytics/ff-agent-sdk/entity';

class AnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<AnalysisRETH>,
  BotRunnableEntityMixin<AnalysisRETH>
]> {
  constructor(factory: EntityFactory, idOrDto: string | DTO) {
    super(
      [factory, idOrDto],   // RunnableEntity args
      []                     // BotRunnableEntityMixin args (empty = lookup from config)
    );
  }
}
```

**Constructor argument rules:**
- Each mixin's arguments are wrapped in an array `[]`
- Order matches the mixin order in `AddMixins(...)`
- Empty array `[]` means no arguments for that mixin

### ComposeMixins

Use `ComposeMixins` for bot composition with multiple mixins. Arguments are passed as a config object with keys matching mixin class names:

```typescript
import { ComposeMixins } from '@firebrandanalytics/shared-utils';

class AnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
)<[
  MixinBot<AnalysisBTH, [StructuredOutputBotMixin<...>, FeedbackBotMixin<...>]>,
  [StructuredOutputBotMixin<...>, FeedbackBotMixin<...>]
]> {
  constructor() {
    const promptGroup = new StructuredPromptGroup<AnalysisPTH>({
      base: new PromptGroup([{ name: 'system', prompt: systemPrompt }]),
      input: new PromptGroup([{ name: 'user', prompt: userPrompt }]),
    });

    super(
      [{ name: 'AnalysisBot', base_prompt_group: promptGroup, model_pool_name: 'default', static_args: {} }],
      [AnalysisOutputSchema],     // StructuredOutputBotMixin args
      [{ role: 'system' }]        // FeedbackBotMixin args
    );
  }
}
```

### Stacking Mixins

You can stack multiple mixins for complex entities:

```typescript
class ReviewableAnalysis extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[
  RunnableEntity<RETH>,
  BotRunnableEntityMixin<RETH>,
  FeedbackRunnableEntityMixin<RETH>
]> {
  constructor(factory: EntityFactory, idOrDto: string | DTO, bot: Bot<BTH>) {
    super(
      [factory, idOrDto],   // RunnableEntity
      [bot],                // BotRunnableEntityMixin — pass bot instance
      []                    // FeedbackRunnableEntityMixin — no args needed
    );
  }
}
```

---

## Entity Lifecycle

### Status Flow

Every runnable entity follows this status progression:

```
Pending ──→ InProgress ──→ Completed
               │
               ├──→ Failed
               │
               └──→ Waiting (waitable entities only)
```

- **Pending**: Initial state after creation
- **InProgress**: Entity is actively executing
- **Completed**: Execution finished successfully; result is cached
- **Failed**: An error occurred during execution
- **Waiting**: Entity is paused, awaiting external input (waitable entities)

### Key Lifecycle Methods

#### `run()` — Execute to Completion

Runs the entity and returns the final result. If already `Completed`, returns the cached output immediately.

```typescript
const entity = await factory.create(MyEntity, { data: { input: 'hello' } });
const result = await entity.run();
```

#### `start()` — Get Streaming Iterator

Returns an async generator that yields progress envelopes. Use this when you need to stream progress to consumers:

```typescript
const iterator = await entity.start();
for await (const envelope of iterator) {
  if (envelope.type === 'VALUE' && envelope.sub_type === 'progress') {
    console.log('Progress:', envelope.value);
  }
}
// Final result is the generator return value
```

#### `run_impl()` — Your Implementation (Abstract)

This is the method you override to define entity behavior. It's an async generator that can yield progress updates and must return the final result:

```typescript
protected async *run_impl(): RunnableEntityResponseIterator<...> {
  const dto = await this.get_dto();

  // Do work...
  yield* this.updateProgressEnvelope(0.5, 'processing');

  // Return final result
  return { summary: 'Done', score: 42 };
}
```

#### `reset()` — Cleanup Before Retry

Called automatically when a `Failed` or `InProgress` entity is re-run. Override to clean up state:

```typescript
protected async reset(): Promise<void> {
  // Clean up temporary data, reset counters, etc.
  this._intermediateResults = [];
}
```

#### `init()` — Post-Construction Setup

Called after construction for custom initialization:

```typescript
init(): void {
  this._cache = new Map();
}
```

### Idempotent Re-Runs

If an entity is already `Completed`, calling `run()` or `start()` returns the cached output without re-executing. To force re-execution, the entity must first be reset (which happens automatically for `Failed`/`InProgress` states).

---

## Bot Integration (Three-Phase Pattern)

`BotRunnableEntityMixin` provides a three-phase hook system for constructing bot request arguments. Phases are merged with deep-combine:

```
get_bot_request_args_pre()    ← Mixins inject context (feedback, working memory)
        ↓ merge
get_bot_request_args_impl()   ← YOU implement this (required)
        ↓ merge
get_bot_request_args_post()   ← Force overrides (rarely needed)
        ↓
Final bot request args
```

### Implementing `get_bot_request_args_impl()`

This is the primary method you implement. It receives the pre-phase args and returns the full bot request:

```typescript
protected async get_bot_request_args_impl(preArgs: Partial<BotRequestArgs>) {
  const dto = await this.get_dto();

  return {
    input: { text: dto.data.input_text },
    args: {
      domain: dto.data.domain,
      max_length: dto.config?.max_length ?? 500,
    },
    context: this.context,
  };
}
```

### Bot Constructor Options

When creating a bot-runnable entity, you have three options for specifying which bot to use:

```typescript
// Option 1: Pass a bot instance directly
super([factory, idOrDto], [myBotInstance]);

// Option 2: Look up bot by name from the registry
super([factory, idOrDto], ['AnalysisBot']);

// Option 3: Data-driven — reads from dto.config.bot_constructor or dto.data.bot_constructor
super([factory, idOrDto], []);
```

### Pre-Phase Hook Example

The pre-phase is used by mixins like `FeedbackRunnableEntityMixin` to automatically inject feedback fields:

```typescript
// FeedbackRunnableEntityMixin automatically injects:
// {
//   args: {
//     _ff_feedback: <feedback from dto.config>,
//     _ff_previous_result: <previous result>,
//     _ff_version: <iteration count>
//   }
// }
// These are deep-merged into the args you return from get_bot_request_args_impl()
```

---

## Control Flow Helpers

Runnable entities provide built-in control flow helpers for common patterns. These maintain proper breadcrumb tracking and progress reporting.

### `forEach` — Iterate Over Collections

```typescript
protected async *run_impl() {
  const scenes = ['intro', 'conflict', 'resolution'];

  const results = yield* this.forEach('generate-scenes', scenes,
    async function*(this: StoryEntity, scene, index) {
      const child = await this.appendOrRetrieveCall(
        SceneEntity, scene, { scene_name: scene }
      );
      return yield* child.start();
    }
  );

  return { scenes: results };
}
```

### `loop` — Conditional Iteration

```typescript
const result = yield* this.loop('refine-output',
  () => this.qualityScore < 0.9,   // condition
  async function*(this: MyEntity, iteration) {
    const refined = yield* this.doCall(RefineEntity, `refine-${iteration}`, {
      input: this.lastOutput
    });
    this.qualityScore = refined.score;
    this.lastOutput = refined.output;
    return refined;
  },
  5  // maxIterations (safety limit)
);
```

### `condition` — Branch Execution

```typescript
const result = yield* this.condition('select-strategy',
  analysisType,  // 'sentiment' | 'summary' | 'extraction'
  {
    sentiment: async function*(this: MyEntity) {
      return yield* this.doCall(SentimentEntity, 'sentiment', data);
    },
    summary: async function*(this: MyEntity) {
      return yield* this.doCall(SummaryEntity, 'summary', data);
    },
    extraction: async function*(this: MyEntity) {
      return yield* this.doCall(ExtractionEntity, 'extraction', data);
    },
  }
);
```

### Parallel Execution

For running multiple child entities concurrently:

```typescript
// Homogeneous parallel (same entity type, multiple inputs)
const iterators = yield* this.parallelCalls(ImageGenEntity, [
  { name: 'scene-1', data: { prompt: 'A sunset...' } },
  { name: 'scene-2', data: { prompt: 'A forest...' } },
  { name: 'scene-3', data: { prompt: 'A mountain...' } },
]);

// With concurrency control
yield* this.runParallel(
  'generate-images',
  ImageGenEntity,
  imageItems,
  3  // max concurrency
);
```

---

## Child Entity Creation

### `appendCall` — Create and Connect

Creates a new child entity connected via a `Calls` edge:

```typescript
const child = await this.appendCall(
  AnalysisEntity,                  // Entity class
  'analysis-step',                 // Name (used for idempotency)
  { input_text: 'analyze this' }   // Data
);
const result = await child.run();
```

### `appendOrRetrieveCall` — Idempotent Create-or-Get

If a child with the same name already exists, retrieves it instead of creating a duplicate. Essential for resumable workflows:

```typescript
// First run: creates the entity
// Re-run after crash: retrieves the existing entity (which may already be Completed)
const child = await this.appendOrRetrieveCall(
  AnalysisEntity,
  'analysis-step',
  { input_text: 'analyze this' }
);
```

### `doCall` — Create and Execute in One Step

Shorthand that creates a child entity, runs it, and yields progress:

```typescript
const result = yield* this.doCall(
  AnalysisEntity,
  'analysis-step',
  { input_text: 'analyze this' }
);
// result is the child entity's output
```

---

## Progress Reporting

### Update Progress

```typescript
protected async *run_impl() {
  await this.updateProgress(0.0, 'starting');

  // ... do work ...
  await this.updateProgress(0.5, 'halfway', { items_processed: 50 });

  // ... more work ...
  await this.updateProgress(1.0, 'complete');

  return finalResult;
}
```

### Envelope Types

When consuming an entity's iterator via `start()`, you receive typed envelopes:

| Envelope Type | Description |
|---------------|-------------|
| `STATUS` | Lifecycle events: `STARTED`, `COMPLETED`, `FAILED` |
| `VALUE` (progress) | Progress updates with stage label and data |
| `VALUE` (return) | The final result value |
| `WAITING` | Entity is paused awaiting input (waitable entities) |
| `BOT_PROGRESS` | Progress from an inner bot execution |
| `ERROR` | Error information |

---

## Common Patterns

### Pattern 1: Simple Bot-Wrapped Entity

The most common pattern — an entity that delegates to a single bot:

```typescript
@EntityMixin({
  specificType: 'SentimentAnalysis',
  generalType: 'Analysis',
})
class SentimentEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<RETH>, BotRunnableEntityMixin<RETH>]> {
  constructor(factory: EntityFactory, idOrDto: string | DTO) {
    super([factory, idOrDto], ['SentimentBot']);
  }

  protected async get_bot_request_args_impl(preArgs: any) {
    const dto = await this.get_dto();
    return {
      input: { text: dto.data.text },
      args: { language: dto.data.language ?? 'en' },
      context: this.context,
    };
  }
}
```

### Pattern 2: Orchestrator Entity

An entity that coordinates multiple child entities in sequence:

```typescript
class PipelineEntity extends RunnableEntity<PipelineRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Step 1: Extract
    await this.updateProgress(0.0, 'extracting');
    const extracted = yield* this.doCall(ExtractEntity, 'extract', {
      source: dto.data.source_url,
    });

    // Step 2: Transform
    await this.updateProgress(0.33, 'transforming');
    const transformed = yield* this.doCall(TransformEntity, 'transform', {
      raw_data: extracted.data,
    });

    // Step 3: Analyze
    await this.updateProgress(0.66, 'analyzing');
    const analysis = yield* this.doCall(AnalysisEntity, 'analyze', {
      clean_data: transformed.output,
    });

    await this.updateProgress(1.0, 'complete');
    return {
      extraction: extracted,
      transformation: transformed,
      analysis: analysis,
    };
  }
}
```

### Pattern 3: Fan-Out / Fan-In

Process multiple items in parallel, then aggregate:

```typescript
class BatchProcessor extends RunnableEntity<BatchRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const items = dto.data.items;

    // Fan out: process each item in parallel
    const results = yield* this.forEach('process-items', items,
      async function*(this: BatchProcessor, item, index) {
        await this.updateProgress(index / items.length, 'processing', { item: item.name });
        const child = await this.appendOrRetrieveCall(
          ItemProcessor, `item-${item.id}`, { item }
        );
        return yield* child.start();
      }
    );

    // Fan in: aggregate results
    return {
      total: results.length,
      successful: results.filter(r => r.success).length,
      results,
    };
  }
}
```

### Pattern 4: Waitable Entity (Human-in-the-Loop)

An entity that pauses for external input:

```typescript
class ApprovalEntity extends WaitableRunnableEntity<ApprovalRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Generate draft
    const draft = yield* this.doCall(DraftEntity, 'draft', dto.data);

    // Pause and wait for human approval
    const approval = yield* this.waitForMessage(
      'Please review and approve the draft',
      { draft }
    );

    if (approval.data.approved) {
      return { status: 'approved', draft, reviewer: approval.data.reviewer };
    } else {
      // Re-run with feedback
      const revised = yield* this.doCall(DraftEntity, 'revision', {
        ...dto.data,
        feedback: approval.data.feedback,
        previous_draft: draft,
      });
      return { status: 'revised', draft: revised };
    }
  }
}
```

### Pattern 5: Data-Driven Bot Selection

Select which bot to use based on entity data:

```typescript
class FlexibleEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<FlexRETH>, BotRunnableEntityMixin<FlexRETH>]> {
  constructor(factory: EntityFactory, idOrDto: string | DTO) {
    // Empty array = look up bot from dto.data.bot_constructor or dto.config.bot_constructor
    super([factory, idOrDto], []);
  }

  protected async get_bot_request_args_impl(preArgs: any) {
    const dto = await this.get_dto();
    return {
      input: { text: dto.data.input },
      args: {},
      context: this.context,
    };
  }
}

// Create with specific bot at runtime:
const entity = await factory.create_entity_node({
  specific_type_name: 'FlexibleEntity',
  name: 'flex-1',
  data: { input: 'hello', bot_constructor: 'SummaryBot' },
});
```

---

## Type Helpers Quick Reference

| Helper | Purpose |
|--------|---------|
| `RunnableEntityTypeHelper<Output, Data, BTH>` | Defines entity output, data shape, and bot type |
| `BotTypeHelper<PTH, Output, Partial, Meta, BrokerContent, ToolSpecs>` | Defines bot I/O types |
| `PromptTypeHelper<Input, Args, Options, SemanticType>` | Defines prompt input/output types |

### Minimal Type Setup

```typescript
import { z } from 'zod';

// 1. Define output schema
const OutputSchema = z.object({
  summary: z.string(),
  score: z.number(),
});
type Output = z.infer<typeof OutputSchema>;

// 2. Define entity data shape
interface EntityData {
  input_text: string;
  domain?: string;
}

// 3. Wire up type helpers
type MyPTH = PromptTypeHelper<{ text: string }, { static: {}; request: {} }>;
type MyBTH = BotTypeHelper<MyPTH, Output>;
type MyRETH = RunnableEntityTypeHelper<Output, EntityData, MyBTH>;
```

---

## See Also

- [Core Entities Guide](../core/entities.md) — Foundational entity concepts
- [Core Decorators Reference](core-decorators-reference.md) — `@EntityMixin`, `@RegisterBot`, `@ApiEndpoint`
- [Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md) — Multi-step workflow patterns
- [Advanced Parallelism](../feature_guides/advanced_parallelism.md) — Parallel execution deep dive
- [Waitable Entities](../feature_guides/waitable_guide.md) — Human-in-the-loop patterns
- [Review Workflows](../feature_guides/review-workflows.md) — Feedback iteration patterns
