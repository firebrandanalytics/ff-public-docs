# Part 5: Parallel Image Generation with Entity-Based Parallelism

In Part 4, you built a `StoryPipelineEntity` that orchestrates the full story pipeline. Image generation runs sequentially -- one image at a time. A story with 5 images at ~10 seconds each takes 50 seconds of wall time. In this part, you'll replace the sequential approach with **entity-based parallelism** -- each image becomes its own `RunnableEntity` child, and a `HierarchicalTaskPoolRunner` executes them concurrently with capacity control. The result: those same 5 images complete in ~20 seconds, each image is visible in the entity graph, and the pipeline can resume where it left off if interrupted.

**What you'll learn:**
- Why each parallel task should be a `RunnableEntity` (observability, idempotency, resumability)
- `ImageGenerationEntity` -- a small entity that generates one image
- `appendOrRetrieveCall()` for deterministic, idempotent child entity creation
- `parallelCalls()` helper to create child entities and yield task lambdas
- `SourceFromIterable` to bridge an async generator to the task runner
- `HierarchicalTaskPoolRunner` for concurrent execution with capacity control
- Two-level capacity: global limit (10 concurrent across all stories) + per-story limit (3)

**What you'll build:** An `ImageGenerationEntity` for single-image generation and an updated `StoryPipelineEntity` Stage 3 that generates all images in parallel using entity-based tasks.

**Starting point:** Completed code from [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-and-api.md). You should have a working pipeline with sequential image generation.

---

## The Problem with Sequential Generation

In Part 4, the pipeline generates images one at a time in a `for` loop:

```typescript
for (const imagePrompt of storyResult.image_prompts) {
  const result = await imageService.generateImage(imagePrompt);
  images.push(result);
}
```

The timeline for a 5-image story looks like this:

```
Time:   0s         10s        20s        30s        40s        50s
        |----------|----------|----------|----------|----------|
IMG 1:  [=========]
IMG 2:             [=========]
IMG 3:                        [=========]
IMG 4:                                   [=========]
IMG 5:                                              [=========]
                                                               ^ Done at ~50s
```

With 3 concurrent slots, images overlap:

```
Time:   0s         10s        20s
        |----------|----------|
IMG 1:  [=========]
IMG 2:  [=========]
IMG 3:  [=========]
IMG 4:             [=========]
IMG 5:             [=========]
                              ^ Done at ~20s
```

That is a 60% reduction in wall time. But naive parallelism creates problems:

1. **Throughput limits**: 5 stories at once, each with 5 images = 25 concurrent image requests. The backend has capacity limits.
2. **No visibility**: Bare `Promise` tasks don't appear in the entity graph. You can't inspect progress per-image via `ff-eg-read`.
3. **No resumability**: If the process crashes after generating 3 of 5 images, all work is lost. The pipeline restarts from scratch.

Entity-based parallelism solves all three.

---

## Why Entities Instead of Bare Tasks

The key insight is: each parallel task should be a `RunnableEntity`, not a bare function. Here's why:

| Concern | Bare `() => Promise<T>` | `RunnableEntity` child |
|---------|------------------------|----------------------|
| **Observability** | Invisible -- only the parent entity exists in the graph | Each image is a named entity visible in `ff-eg-read` with status and data |
| **Idempotency** | Create-and-forget -- duplicates if retried | `appendOrRetrieveCall()` returns the existing entity if already created |
| **Resumability** | Lost on crash | Completed children are already done; only remaining images re-execute |
| **Progress** | Only the parent can report progress | Each child yields its own status envelopes |
| **Error isolation** | Error metadata is ephemeral | Error details persist in the child entity's data |

After running a 5-image story, the entity graph looks like this:

```
StoryPipelineEntity (story-pipeline-brave-kitten)
  ├── ContentSafetyCheckEntity (safety-check)
  ├── StoryWriterEntity (story-writer)
  ├── ImageGenerationEntity (image-{{IMAGE_1}})    ✓ Complete
  ├── ImageGenerationEntity (image-{{IMAGE_2}})    ✓ Complete
  ├── ImageGenerationEntity (image-{{IMAGE_3}})    ✗ Failed
  ├── ImageGenerationEntity (image-{{IMAGE_4}})    ✓ Complete
  └── ImageGenerationEntity (image-{{IMAGE_5}})    ✓ Complete
```

Every entity is individually inspectable: `ff-eg-read node <entity-id>` shows its data, status, and relationship to the parent pipeline.

---

## Step 1: ImageGenerationEntity -- One Image Per Entity

Create an entity that generates a single image. It reads its configuration from entity data (set by the parent at creation time), calls the broker, retrieves from blob storage, and returns a `GeneratedImageResult`.

**`apps/story-bundle/src/entities/ImageGenerationEntity.ts`**:

```typescript
import {
  RunnableEntity,
  EntityFactory,
  EntityMixin,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import {
  SimplifiedBrokerClient,
  AspectRatio,
  ImageQuality,
} from '@firebrandanalytics/ff_broker_client';
import { createBlobStorage } from '@firebrandanalytics/shared-utils/storage';
import type {
  GeneratedImageResult,
  ImageQualityLevel,
  AspectRatioOption,
} from '@shared/types';

// ─── Module-level service clients ───────────────────────────

const brokerClient = new SimplifiedBrokerClient({
  host: process.env.LLM_BROKER_HOST || 'localhost',
  port: parseInt(process.env.LLM_BROKER_PORT || '50052'),
});

// ─── Quality/aspect ratio mapping ───────────────────────────

const QUALITY_MAP: Record<ImageQualityLevel, ImageQuality> = {
  low: ImageQuality.IMAGE_QUALITY_LOW,
  medium: ImageQuality.IMAGE_QUALITY_MEDIUM,
  high: ImageQuality.IMAGE_QUALITY_HIGH,
};

const ASPECT_RATIO_MAP: Record<AspectRatioOption, AspectRatio> = {
  '1:1': AspectRatio.ASPECT_RATIO_1_1,
  '3:2': AspectRatio.ASPECT_RATIO_3_2,
  '2:3': AspectRatio.ASPECT_RATIO_2_3,
  '4:3': AspectRatio.ASPECT_RATIO_4_3,
  '16:9': AspectRatio.ASPECT_RATIO_16_9,
};

@EntityMixin({
  specificType: 'ImageGenerationEntity',
  generalType: 'ImageGenerationEntity',
  allowedConnections: {},
})
export class ImageGenerationEntity extends RunnableEntity<any> {
  constructor(factory: EntityFactory<any>, idOrDto: string | any) {
    super(factory, idOrDto);
  }

  protected override async *run_impl() {
    const dto = await this.get_dto();
    const {
      placeholder,
      prompt,
      alt_text,
      model_pool,
      image_quality,
      aspect_ratio,
    } = dto.data;

    // Yield status so the parent (and any SSE consumer) sees progress
    yield await this.createStatusEnvelope(
      'RUNNING',
      `Generating image for ${placeholder}`,
    );

    const quality = QUALITY_MAP[image_quality as ImageQualityLevel]
      ?? ImageQuality.IMAGE_QUALITY_MEDIUM;
    const ratio = ASPECT_RATIO_MAP[aspect_ratio as AspectRatioOption]
      ?? AspectRatio.ASPECT_RATIO_3_2;

    // Generate via broker
    const result = await brokerClient.generateImage({
      modelPool: model_pool || 'fb-image-gen',
      prompt,
      semanticLabel: 'illustrated-story-image',
      quality,
      aspectRatio: ratio,
    });

    if (!result.images || result.images.length === 0) {
      throw new Error(`No images generated for ${placeholder}`);
    }

    const image = result.images[0];

    yield await this.createStatusEnvelope(
      'RUNNING',
      `Retrieving ${placeholder} from storage`,
    );

    // Retrieve image bytes from blob storage
    const blobStorage = createBlobStorage();
    const { readableStream } = await blobStorage.getBlob(image.objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of readableStream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const base64 = Buffer.concat(chunks).toString('base64');
    const contentType = image.format === 'png' ? 'image/png' : 'image/jpeg';

    const imageResult: GeneratedImageResult = {
      placeholder,
      base64,
      content_type: contentType,
      alt_text,
    };

    return imageResult;
  }
}
```

### Key Design Points

**Single responsibility:** Each entity handles exactly one image. All configuration (prompt, quality, aspect ratio) comes from entity data, set by the parent at creation time.

**Status envelopes:** The entity yields two status updates -- one when generation starts and one when retrieval starts. These flow up to any SSE consumer watching the pipeline.

**No service class needed:** In Part 3, we used an `ImageService` class. That class is no longer necessary. The entity *is* the unit of work, and the broker client is a module-level singleton shared by all instances.

**Quality/aspect ratio mapping:** User-facing strings like `'medium'` and `'3:2'` are mapped to protobuf enums (`ImageQuality.IMAGE_QUALITY_MEDIUM`, `AspectRatio.ASPECT_RATIO_3_2`) at the entity level.

---

## Step 2: Register the Entity

Add `ImageGenerationEntity` to the constructors registry so the SDK can instantiate it:

**`apps/story-bundle/src/constructors.ts`** (updated):

```typescript
import { ImageGenerationEntity } from './entities/ImageGenerationEntity.js';

export const StoryBundleConstructors = {
  // ... existing entries ...
  ImageGenerationEntity,
};
```

---

## Step 3: `appendOrRetrieveCall` -- Deterministic Child Creation

When the pipeline creates child image entities, it uses `appendOrRetrieveCall()` instead of `appendCall()`. The difference is critical for idempotency:

| Method | Behavior |
|--------|----------|
| `appendCall(EntityClass, name, data)` | Always creates a new entity. Throws if the name already exists. |
| `appendOrRetrieveCall(EntityClass, name, data)` | Creates the entity if it doesn't exist. Returns the existing entity if it does. |

This enables **resumable pipelines**. If the process crashes after creating `image-{{IMAGE_1}}` and `image-{{IMAGE_2}}`, resuming the pipeline calls `appendOrRetrieveCall` again for all 5 images. The first two return their existing entities (already completed), and the remaining three are created fresh.

### Deterministic Naming

The child entity name must be deterministic -- the same inputs always produce the same name. The pipeline uses the placeholder name:

```typescript
const taskItems = imagePrompts.map((ip) => ({
  name: `image-${ip.placeholder}`,    // e.g., "image-{{IMAGE_1}}"
  data: {
    placeholder: ip.placeholder,
    prompt: ip.prompt,
    alt_text: ip.alt_text,
    model_pool: 'fb-image-gen',
    image_quality: 'medium',
    aspect_ratio: '3:2',
  },
}));
```

Each task item specifies:
- **`name`**: A stable, deterministic identifier. Combined with the parent entity's context, this uniquely identifies the child in the entity graph.
- **`data`**: The entity data passed to the child entity at creation time.

> **Important:** Never use `Date.now()`, random UUIDs, or loop indices as part of the entity name. These make resumption impossible -- the pipeline would create new entities instead of finding the existing ones.

---

## Step 4: `parallelCalls()` -- Creating Child Entities as Tasks

The `parallelCalls()` method is a helper on `RunnableEntity` that creates child entities from a list of task items and yields task lambdas (functions the runner can invoke):

```typescript
const taskSource = new SourceFromIterable(
  this.parallelCalls(ImageGenerationEntity, taskItems)
);
```

Under the hood, `parallelCalls()` does this for each task item:

1. Calls `appendOrRetrieveCall(ImageGenerationEntity, item.name, item.data)` to create (or retrieve) the child entity
2. Yields a lambda: `() => childEntity.start()` that, when called by the runner, executes the child entity's `run_impl()`

Because `parallelCalls()` is an async generator, child entities are created one at a time as the runner pulls tasks. This is important: it means the pipeline doesn't create all 5 entities up front. If the runner has capacity for 3, it creates 3 initially, then creates the 4th when one completes.

---

## Step 5: `SourceFromIterable` -- Bridging Generators to the Runner

`HierarchicalTaskPoolRunner` consumes tasks from a source that implements `PullObj & Peekable`. In Part 3's sequential approach, you might have used `SourceBufferObj` to wrap an array. With entity-based parallelism, the tasks come from an async generator, not an array. `SourceFromIterable` bridges this gap:

```typescript
import { SourceFromIterable } from '@firebrandanalytics/shared-utils';

const taskSource = new SourceFromIterable(
  this.parallelCalls(ImageGenerationEntity, taskItems)
);
```

| Source Class | Input | Use Case |
|-------------|-------|----------|
| `SourceBufferObj` | `Array<() => Promise<T>>` | All tasks known up front, loaded into memory |
| `SourceFromIterable` | `AsyncIterable<() => Promise<T>>` | Tasks created lazily from a generator |

`SourceFromIterable` pulls from the generator on demand. When the runner asks for the next task, the source advances the generator by one step, which creates the next child entity. When the generator is exhausted, the source signals completion.

---

## Step 6: Capacity Management

The capacity model has two layers, each a `CapacitySource` instance. The child links to its parent:

```
                    ┌──────────────────────────┐
                    │  GLOBAL_IMAGE_CAPACITY    │
                    │  CapacitySource(10)       │
                    │                          │
                    │  Shared across ALL        │
                    │  StoryPipelineEntity      │
                    │  instances (module-level) │
                    └────────┬────────┬────────┘
                             │        │
                ┌────────────┘        └────────────┐
                │                                  │
     ┌──────────▼──────────┐          ┌────────────▼────────────┐
     │  Story A capacity    │          │  Story B capacity        │
     │  CapacitySource(3,   │          │  CapacitySource(3,       │
     │    GLOBAL_CAPACITY)  │          │    GLOBAL_CAPACITY)      │
     │                      │          │                          │
     │  Created per pipeline│          │  Created per pipeline    │
     │  execution           │          │  execution               │
     └─────────────────────┘          └──────────────────────────┘
```

```typescript
import { CapacitySource } from '@firebrandanalytics/shared-utils';

// Module-level: shared across all pipeline instances in the process
const GLOBAL_IMAGE_CAPACITY = new CapacitySource(10);

// Inside run_impl(): per-story, linked to global
const storyCapacity = new CapacitySource(3, GLOBAL_IMAGE_CAPACITY);
```

### How Capacity Cascades

When `storyCapacity.acquire()` is called:
1. Check `storyCapacity` has units available (count > 0)
2. Check `GLOBAL_IMAGE_CAPACITY` has units available (count > 0)
3. If both have capacity: decrement both, return immediately
4. If either is exhausted: block until both have capacity

When `storyCapacity.release()` is called:
1. Increment `storyCapacity` count
2. Increment `GLOBAL_IMAGE_CAPACITY` count
3. Wake up any blocked `acquire()` calls

This enforces two invariants simultaneously:
- No single story exceeds 3 concurrent images
- The process never exceeds 10 concurrent images total

---

## Step 7: Putting It Together -- The Updated Pipeline

Here is the complete Stage 3 from `StoryPipelineEntity.run_impl()`, replacing the sequential loop with entity-based parallelism:

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (Stage 3):

```typescript
import {
  CapacitySource,
  HierarchicalTaskPoolRunner,
  SourceFromIterable,
} from '@firebrandanalytics/shared-utils';
import { ImageGenerationEntity } from './ImageGenerationEntity.js';
import type { GeneratedImageResult } from '@shared/types';

const GLOBAL_IMAGE_CAPACITY = new CapacitySource(10);

// ... inside run_impl() or runApprovedPipeline() ...

    // ─── Stage 3: Parallel image generation (entity-based) ──────

    const imagePrompts = storyResult.image_prompts;

    yield await this.createStatusEnvelope(
      'RUNNING',
      `Generating ${imagePrompts.length} images`,
    );
    await this.updateEntityData({
      stage: 'generating_images',
      images_total: imagePrompts.length,
      images_generated: 0,
    });

    // 1. Define task items: name + data for each child entity
    const taskItems = imagePrompts.map((ip) => ({
      name: `image-${ip.placeholder}`,
      data: {
        placeholder: ip.placeholder,
        prompt: ip.prompt,
        alt_text: ip.alt_text,
        model_pool: process.env.IMAGE_MODEL_POOL || 'fb-image-gen',
        image_quality: customization?.image_quality || 'medium',
        aspect_ratio: customization?.aspect_ratio || '3:2',
      },
    }));

    // 2. Create task source from entity-based parallel calls
    const taskSource = new SourceFromIterable(
      this.parallelCalls(ImageGenerationEntity, taskItems)
    );

    // 3. Per-story capacity, linked to global capacity
    const storyCapacity = new CapacitySource(3, GLOBAL_IMAGE_CAPACITY);

    // 4. Create runner
    const runner = new HierarchicalTaskPoolRunner<any, GeneratedImageResult>(
      'image-gen',
      taskSource,
      storyCapacity,
    );

    // 5. Consume results as they complete
    const images: GeneratedImageResult[] = [];
    for await (const envelope of runner.runTasks()) {
      if (envelope.type === 'FINAL' && envelope.value) {
        images.push(envelope.value);
        await this.updateEntityData({ images_generated: images.length });
        yield await this.createStatusEnvelope(
          'RUNNING',
          `Generated ${images.length}/${imagePrompts.length} images`,
        );
      } else if (envelope.type === 'ERROR') {
        logger.warn('[Pipeline] Image generation error', {
          entityId: this.id,
          taskId: envelope.taskId,
          error: envelope.error,
        });
      }
    }
```

### What Changed from Part 4

| Aspect | Part 4 (Sequential) | Part 5 (Entity-Based Parallel) |
|--------|---------------------|-------------------------------|
| **Image generation** | `ImageService.generateImage()` in a `for` loop | `ImageGenerationEntity` -- one entity per image |
| **Child creation** | N/A (service method, not an entity) | `appendOrRetrieveCall()` via `parallelCalls()` |
| **Task source** | N/A | `SourceFromIterable` wrapping `parallelCalls()` generator |
| **Concurrency** | 1 (sequential `await`) | Up to 3 per story, 10 globally |
| **Resumability** | None -- restart from scratch | Deterministic names enable resumption |
| **Entity graph** | Only pipeline + safety + writer entities | Pipeline + safety + writer + N image entities |
| **Progress** | After all images complete | Per-image as each completes |
| **Error handling** | First error aborts batch | Per-entity errors; other images continue |

### Handling Envelope Types

Results arrive in **completion order**, not submission order. The `for await` loop inspects `envelope.type`:

```typescript
if (envelope.type === 'FINAL' && envelope.value) {
  // Success: collect the image and report progress
  images.push(envelope.value);
  yield await this.createStatusEnvelope(
    'RUNNING',
    `Generated ${images.length}/${imagePrompts.length} images`,
  );
} else if (envelope.type === 'ERROR') {
  // Failure: log but continue — other images may still succeed
  logger.warn('[Pipeline] Image generation error', { ... });
}
```

After the loop, `images` contains all successfully generated results. Failed images leave their `{{IMAGE_N}}` placeholders in the HTML -- a visible indicator that something went wrong, which is better than silently dropping content.

---

## Step 8: Delete the ImageService

The `ImageService` class from Part 3 is no longer needed. All image generation logic lives in `ImageGenerationEntity`. Delete the file:

```bash
rm apps/story-bundle/src/services/image-service.ts
```

Remove any imports of `ImageService` from the pipeline entity. The pipeline now creates child entities directly via `parallelCalls()`.

---

## Capacity in Action

Walk through a concrete scenario: two stories are submitted simultaneously, each with 5 images. Global limit is 10, per-story limit is 3.

### Timeline

| Time | Story A | Story B | Global Used | Notes |
|------|---------|---------|-------------|-------|
| 0s | Launch IMG 1, 2, 3 | Launch IMG 1, 2, 3 | 6 / 10 | Both stories fill their per-story capacity (3 each) |
| ~10s | IMG 1 done; launch IMG 4 | IMG 2 done; launch IMG 4 | 6 / 10 | Release + re-acquire cascades through both levels |
| ~12s | IMG 2 done; launch IMG 5 | IMG 1 done; launch IMG 5 | 6 / 10 | Steady state: 3 per story, 6 global |
| ~20s | IMG 3 done | IMG 3 done | 4 / 10 | Winding down |
| ~24s | All done | All done | 0 / 10 | Both stories complete |

### When Global Limits Kick In

With 5 stories at once:

| Time | Active per Story A-E | Total Active | What Happens |
|------|---------------------|-------------|-------------|
| 0s | A:3, B:3, C:3, D:1, E:0 | 10 / 10 | Global full. Stories D and E are throttled. |
| ~10s | A:3, B:3, C:2, D:1, E:1 | 10 / 10 | As C finishes one, E gets capacity |

Story D only gets 1 concurrent slot (not its full 3) because the global pool is exhausted. As other stories finish images, capacity shifts between stories automatically.

### Entity Graph After Completion

Inspect with `ff-eg-read`:

```bash
ff-eg-read tree <pipeline-entity-id>
```

```
StoryPipelineEntity (story-pipeline-brave-kitten)     Status: Complete
  ├── ContentSafetyCheckEntity (safety-check)          Status: Complete
  ├── StoryWriterEntity (story-writer)                 Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_1}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_2}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_3}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_4}})        Status: Complete
  └── ImageGenerationEntity (image-{{IMAGE_5}})        Status: Complete
```

Each child entity's data contains its prompt, quality settings, and (after completion) the generated image metadata. This is invaluable for debugging: if one image looks wrong, inspect its entity to see the exact prompt that was sent to the broker.

---

## Key Takeaways

1. **Each parallel task should be a `RunnableEntity`.** Entities provide observability (visible in entity graph), idempotency (deterministic names), resumability (existing entities are reused), and progress isolation (each child reports its own status).

2. **`appendOrRetrieveCall()` enables resumable pipelines.** By using deterministic names like `image-{{IMAGE_1}}`, the pipeline can restart without creating duplicate entities. Already-completed children are returned as-is.

3. **`parallelCalls()` creates child entities lazily.** The helper is an async generator -- it creates each child entity as the runner requests it, not all at once. This plays well with capacity limits: entities are only created when the runner has capacity to execute them.

4. **`SourceFromIterable` bridges generators to the runner.** While `SourceBufferObj` works for arrays, `SourceFromIterable` works for async generators. Since `parallelCalls()` is a generator, `SourceFromIterable` is the right choice.

5. **`CapacitySource` provides hierarchical concurrency control.** A child links to a parent. `acquire()` decrements both; `release()` increments both. This enforces per-story and global limits with a single mechanism.

6. **`HierarchicalTaskPoolRunner.runTasks()` streams results as they complete.** Each `TaskProgressEnvelope` represents one child entity finishing (or failing). Results arrive in completion order. The pipeline yields progress envelopes for real-time client feedback.

7. **Per-entity error isolation.** If Image 3 fails but Images 1, 2, 4, and 5 succeed, you get 4 images and 1 error envelope. The failed image's entity persists in the graph with error details for debugging.

8. **No `ImageService` class needed.** The entity is the unit of work. Service clients are module-level singletons shared across all entity instances.

---

## Next Steps

The parallel image generation system handles throughput efficiently with full observability. In [Part 6: Customization Types & Style Selection](./part-06-customization-and-styles.md), you'll add user-configurable options -- illustration style, image quality, aspect ratio, and illustration count -- threading them through the entire pipeline from API endpoint to prompt to image generation.

---

**Previous:** [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-and-api.md) | **Next:** [Part 6: Customization Types & Style Selection](./part-06-customization-and-styles.md)
