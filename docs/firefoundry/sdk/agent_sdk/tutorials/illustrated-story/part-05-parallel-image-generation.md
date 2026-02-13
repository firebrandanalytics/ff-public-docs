# Part 5: Parallel Image Generation

In Part 3, you built an `ImageService` that generates images sequentially -- one at a time, waiting for each to complete before starting the next. That works, but it is slow. A story with 5 images at ~10 seconds each takes 50 seconds of wall time. In this part, you'll replace the sequential approach with parallel generation using the SDK's `CapacitySource`, `HierarchicalTaskPoolRunner`, and `SourceBufferObj` utilities. The result: those same 5 images complete in ~20 seconds, and the system stays safe even when multiple stories run concurrently.

**What you'll learn:**
- Why sequential image generation is a bottleneck and why naive parallelism is dangerous
- `CapacitySource` for hierarchical concurrency limits (parent/child capacity chains)
- `HierarchicalTaskPoolRunner` for concurrent task execution with capacity control
- `SourceBufferObj` for feeding tasks to the runner
- `TaskProgressEnvelope` for streaming individual task results as they complete
- Two-level capacity: global limit (10 concurrent across all stories) + per-story limit (3 concurrent per story)
- How the parallel implementation integrates with the pipeline entity from Part 4

**What you'll build:** An updated `ImageService` with a `generateAllImagesParallel()` async generator that replaces the sequential `generateAllImages()` method, plus the pipeline integration code that consumes it.

**Starting point:** Completed code from [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-and-api.md). You should have a working pipeline with sequential image generation.

---

## The Problem with Sequential Generation

Look at the `generateAllImages` method from Part 3:

```typescript
async generateAllImages(
  imagePrompts: ImagePrompt[],
  onProgress?: (generated: number, total: number) => void,
  modelPool?: string,
): Promise<GeneratedImageResult[]> {
  const results: GeneratedImageResult[] = [];
  const total = imagePrompts.length;

  for (let i = 0; i < imagePrompts.length; i++) {
    const result = await this.generateImage(imagePrompts[i], modelPool);
    results.push(result);
    onProgress?.(i + 1, total);
  }

  return results;
}
```

Each image waits for the previous one to finish. The timeline for a 5-image story looks like this:

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

That is a 60% reduction in wall time. But naive parallelism creates a new problem: if you launch 5 stories at once, each with 5 images, that is 25 concurrent image generation requests hitting the backend simultaneously. The image generation model has throughput limits, and exceeding them causes timeouts, rate-limit errors, or degraded quality for everyone.

You need **controlled parallelism** -- concurrency that is bounded at two levels:
1. **Per story**: No single story hogs all available capacity
2. **Globally**: Total concurrent requests across all stories stays within backend limits

This is what `CapacitySource` and `HierarchicalTaskPoolRunner` solve.

---

## Concepts: Hierarchical Capacity

The capacity model has two layers. Each layer is a `CapacitySource` instance, and the child links to its parent:

```
                    ┌──────────────────────────┐
                    │  GLOBAL_IMAGE_CAPACITY    │
                    │  CapacitySource(10)       │
                    │                          │
                    │  Shared across ALL        │
                    │  ImageService instances   │
                    │  (module-level constant)  │
                    └────────┬────────┬────────┘
                             │        │
                ┌────────────┘        └────────────┐
                │                                  │
     ┌──────────▼──────────┐          ┌────────────▼────────────┐
     │  Story A capacity    │          │  Story B capacity        │
     │  CapacitySource(3,   │          │  CapacitySource(3,       │
     │    GLOBAL_CAPACITY)  │          │    GLOBAL_CAPACITY)      │
     │                      │          │                          │
     │  Created per call to │          │  Created per call to     │
     │  generateAllImages   │          │  generateAllImages       │
     │  Parallel()          │          │  Parallel()              │
     └─────────────────────┘          └──────────────────────────┘
```

When Story A acquires a capacity unit, **both** the per-story count and the global count decrement. This enforces two invariants simultaneously:

- No single story exceeds 3 concurrent images
- The process never exceeds 10 concurrent images total, regardless of how many stories are running

---

## Step 1: CapacitySource -- Hierarchical Concurrency Limits

`CapacitySource` is a concurrency primitive from `@firebrandanalytics/shared-utils`. It tracks a count of available capacity units and supports parent-child chaining.

### Creating Capacity Sources

```typescript
import { CapacitySource } from '@firebrandanalytics/shared-utils';

// Standalone capacity: 10 concurrent operations max
const globalCapacity = new CapacitySource(10);

// Child capacity: 3 max, but ALSO checks parent before granting
const storyCapacity = new CapacitySource(3, globalCapacity);
```

The first argument is the maximum concurrent units. The optional second argument is the parent `CapacitySource`. When a child is constructed with a parent, every acquire/release operation cascades up the chain.

### Key Methods

| Method | Behavior |
|--------|----------|
| `peek()` | Returns `true` if capacity is available (checks self AND parent). Does not modify state. |
| `acquire()` | Takes one unit. If none available, returns a `Promise` that resolves when capacity frees up. Decrements both self and parent. |
| `release()` | Returns one unit. Increments both self and parent. |

### Acquire and Release Cascade

When `storyCapacity.acquire()` is called:

1. Check if `storyCapacity` has units available (count > 0)
2. Check if `globalCapacity` has units available (count > 0)
3. If both have capacity: decrement both, return immediately
4. If either is exhausted: block until both have capacity

When `storyCapacity.release()` is called:

1. Increment `storyCapacity` count
2. Increment `globalCapacity` count
3. Wake up any blocked `acquire()` calls that now have capacity

This means:
- A story can never run more than 3 images at once (its own limit)
- Even if 10 stories each want 3 concurrent images, only 10 total will run (global limit)
- The 11th request blocks until one of the 10 in-flight requests completes

### Module-Level Global State

The global capacity is declared at module level:

```typescript
const GLOBAL_IMAGE_CAPACITY = new CapacitySource(10);
```

This is intentional. The `ImageService` class may be instantiated multiple times (once per pipeline entity, or once in the agent bundle), but all instances share the same module-level constant. The global limit applies to the entire process, not to a single `ImageService` instance.

Each call to `generateAllImagesParallel()` creates a **new** per-story `CapacitySource(3, GLOBAL_IMAGE_CAPACITY)`. When the generator completes and the per-story source is garbage collected, the global capacity is unaffected -- all acquired units were released during the generator's execution.

---

## Step 2: Task Runners and SourceBufferObj

`HierarchicalTaskPoolRunner` does not accept an array of promises or an array of tasks directly. It consumes tasks from a **source** -- an object that implements `PullObj & Peekable`. The `SourceBufferObj` class wraps an array into this interface.

### Converting Prompts to Task Functions

Each task is a zero-argument function that returns a `Promise`. Map your image prompts into these functions:

```typescript
const taskRunners = imagePrompts.map(
  (prompt) => () => this.generateImage(prompt, modelPool)
);
```

Each function, when called, starts one image generation request. The runner decides *when* to call each function based on available capacity.

### Wrapping with SourceBufferObj

```typescript
import { SourceBufferObj } from '@firebrandanalytics/shared-utils';

const taskSource = new SourceBufferObj(taskRunners, true);
```

| Argument | Type | Description |
|----------|------|-------------|
| `taskRunners` | `Array<() => Promise<T>>` | The array of task functions to execute |
| `true` | `boolean` | One-shot mode: the source closes automatically when the buffer is empty |

`SourceBufferObj` implements `PullObj` (the runner can pull the next task) and `Peekable` (the runner can check if more tasks are available without consuming them). The one-shot flag (`true`) means: once all tasks have been pulled from the buffer, the source signals completion. The runner uses this signal to know when to stop pulling and wait for in-flight tasks to finish.

---

## Step 3: HierarchicalTaskPoolRunner -- The Execution Engine

The runner coordinates task execution against the capacity source. It pulls tasks from the source, acquires capacity before launching each one, and yields results as they complete.

```typescript
import { HierarchicalTaskPoolRunner } from '@firebrandanalytics/shared-utils';

const runner = new HierarchicalTaskPoolRunner<GeneratedImageResult, GeneratedImageResult>(
  'image-gen',       // label for logging
  taskSource,        // PullObj & Peekable source of task functions
  storyCapacity,     // CapacitySource that governs concurrency
);
```

| Argument | Description |
|----------|-------------|
| `'image-gen'` | A string label used in log messages. Helps distinguish runner instances in multi-runner scenarios. |
| `taskSource` | The `SourceBufferObj` that feeds task functions to the runner. |
| `storyCapacity` | The `CapacitySource` that controls how many tasks can run concurrently. Since `storyCapacity` has `GLOBAL_IMAGE_CAPACITY` as its parent, both limits are enforced. |

The two type parameters `<GeneratedImageResult, GeneratedImageResult>` are the intermediate and final result types. For image generation, tasks do not produce intermediate results -- each task is a single `Promise` that resolves to a `GeneratedImageResult`. Both type parameters are the same.

### Running Tasks and Consuming Results

```typescript
for await (const envelope of runner.runTasks()) {
  // Handle each result as it arrives
}
```

`runTasks()` returns an `AsyncGenerator` that yields a `TaskProgressEnvelope` each time a task completes (or fails). The runner manages the concurrency internally:

1. Pull a task from the source
2. Acquire capacity (blocks if limits reached)
3. Launch the task
4. When the task completes, release capacity and yield the result
5. Repeat until the source is empty and all in-flight tasks have finished

Results arrive in **completion order**, not submission order. If Image 3 finishes before Image 1, you receive Image 3's envelope first.

---

## Step 4: TaskProgressEnvelope -- Streaming Results

Each yielded value from `runner.runTasks()` is an envelope that wraps the result of a single task:

```typescript
type TaskProgressEnvelope<I, O> = {
  taskId: number;
  type: 'INTERMEDIATE' | 'FINAL' | 'ERROR';
  value?: I | O;
  error?: any;
};
```

| Field | Description |
|-------|-------------|
| `taskId` | Zero-based index of the task in the order it was submitted (not completed). |
| `type` | Discriminator for what happened. |
| `value` | The task result (present when `type` is `'FINAL'`). |
| `error` | The error details (present when `type` is `'ERROR'`). |

The three envelope types:

| Type | Meaning | When It Occurs |
|------|---------|----------------|
| `FINAL` | Task completed successfully | The promise returned by the task function resolved |
| `ERROR` | Task failed | The promise rejected |
| `INTERMEDIATE` | Task produced a partial result | For streaming tasks that yield intermediate values (not used in image generation) |

For image generation, you will only see `FINAL` and `ERROR` envelopes. Each image generation call is a single promise -- there are no intermediate results. The `INTERMEDIATE` type exists for tasks that use streaming (e.g., token-by-token LLM responses), which is not the case here.

The `ImageService` re-exports a narrowed type alias for clarity:

```typescript
export type ImageTaskEnvelope = {
  taskId: number;
  type: 'INTERMEDIATE' | 'FINAL' | 'ERROR';
  value?: GeneratedImageResult;
  error?: any;
};
```

---

## Step 5: The Updated ImageService

Here is the complete `generateAllImagesParallel()` method that replaces the sequential `generateAllImages()`:

**`apps/story-bundle/src/services/image-service.ts`** (updated):

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';
import {
  SimplifiedBrokerClient,
  AspectRatio,
  ImageQuality,
} from '@firebrandanalytics/ff_broker_client';
import {
  CapacitySource,
  HierarchicalTaskPoolRunner,
  SourceBufferObj,
} from '@firebrandanalytics/shared-utils';
import { createBlobStorage } from '@firebrandanalytics/shared-utils/storage';
import type { ImagePrompt, GeneratedImageResult } from '@shared/types';

/** Progress envelope from HierarchicalTaskPoolRunner */
export type ImageTaskEnvelope = {
  taskId: number;
  type: 'INTERMEDIATE' | 'FINAL' | 'ERROR';
  value?: GeneratedImageResult;
  error?: any;
};

/**
 * Global capacity — limits total concurrent image requests across all stories.
 * This is process-level state: all StoryPipelineEntity instances share it.
 */
const GLOBAL_IMAGE_CAPACITY = new CapacitySource(10);

export class ImageService {
  private brokerClient: SimplifiedBrokerClient;

  constructor() {
    this.brokerClient = new SimplifiedBrokerClient({
      host: process.env.LLM_BROKER_HOST || 'localhost',
      port: parseInt(process.env.LLM_BROKER_PORT || '50052'),
    });
  }

  async generateImage(
    imagePrompt: ImagePrompt,
    modelPool: string = 'fb-image-gen'
  ): Promise<GeneratedImageResult> {
    logger.info('[ImageService] Generating image', {
      placeholder: imagePrompt.placeholder,
      prompt_preview: imagePrompt.prompt.substring(0, 80),
    });

    const result = await this.brokerClient.generateImage({
      modelPool,
      prompt: imagePrompt.prompt,
      semanticLabel: 'illustrated-story-image',
      quality: ImageQuality.IMAGE_QUALITY_MEDIUM,
      aspectRatio: AspectRatio.ASPECT_RATIO_3_2,
    });

    if (!result.images || result.images.length === 0) {
      throw new Error(`No images generated for ${imagePrompt.placeholder}`);
    }

    const image = result.images[0];
    const base64 = await this.retrieveImageAsBase64(image.objectKey);
    const contentType = image.format === 'png' ? 'image/png' : 'image/jpeg';

    return {
      placeholder: imagePrompt.placeholder,
      base64,
      content_type: contentType,
      alt_text: imagePrompt.alt_text,
    };
  }

  /**
   * Generate all images in parallel with hierarchical capacity management.
   *
   * Uses HierarchicalTaskPoolRunner with a two-level CapacitySource:
   * - Global: max 10 concurrent image requests across all stories
   * - Per-story: max 3 concurrent images per story
   *
   * Yields TaskProgressEnvelope for each completed/failed image.
   */
  async *generateAllImagesParallel(
    imagePrompts: ImagePrompt[],
    modelPool?: string,
  ): AsyncGenerator<ImageTaskEnvelope> {
    if (imagePrompts.length === 0) return;

    // Per-story capacity, linked to global capacity.
    // A story can run at most 3 images concurrently, but only if
    // the global pool has capacity available too.
    const storyCapacity = new CapacitySource(3, GLOBAL_IMAGE_CAPACITY);

    // Create task runners — one per image prompt
    const taskRunners = imagePrompts.map(
      (prompt) => () => this.generateImage(prompt, modelPool)
    );

    // SourceBufferObj provides PullObj & Peekable — feeds tasks to the runner
    const taskSource = new SourceBufferObj(taskRunners, true);

    const runner = new HierarchicalTaskPoolRunner<GeneratedImageResult, GeneratedImageResult>(
      'image-gen',
      taskSource,
      storyCapacity,
    );

    yield* runner.runTasks();
  }

  assembleHtml(htmlTemplate: string, images: GeneratedImageResult[]): string {
    let html = htmlTemplate;
    for (const img of images) {
      const imgTag = `<img src="data:${img.content_type};base64,${img.base64}" alt="${img.alt_text}" style="max-width:100%; border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" />`;
      html = html.replace(img.placeholder, imgTag);
    }
    return html;
  }

  private async retrieveImageAsBase64(objectKey: string): Promise<string> {
    const blobStorage = createBlobStorage();
    const { readableStream } = await blobStorage.getBlob(objectKey);

    const chunks: Buffer[] = [];
    for await (const chunk of readableStream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return buffer.toString('base64');
  }
}
```

### What Changed from Part 3

| Aspect | Part 3 (Sequential) | Part 5 (Parallel) |
|--------|---------------------|-------------------|
| **New imports** | None | `CapacitySource`, `HierarchicalTaskPoolRunner`, `SourceBufferObj` |
| **Module-level state** | None | `GLOBAL_IMAGE_CAPACITY = new CapacitySource(10)` |
| **Method name** | `generateAllImages()` | `generateAllImagesParallel()` |
| **Return type** | `Promise<GeneratedImageResult[]>` (all at once) | `AsyncGenerator<ImageTaskEnvelope>` (one at a time) |
| **Progress mechanism** | `onProgress` callback | `TaskProgressEnvelope` yielded per task |
| **Concurrency** | 1 (sequential `for` loop with `await`) | Up to 3 per story, 10 globally |
| **Error handling** | First error aborts entire batch | Errors reported per-task; other tasks continue |

The `generateImage()` method is unchanged. It is still the unit of work -- one prompt in, one image out. The difference is in *how many* of these run at the same time and *how* results are delivered to the caller.

Note that the old `generateAllImages()` method can be removed entirely, or kept as a simpler alternative for cases where parallelism is unnecessary (e.g., unit testing with a single image). The pipeline entity now uses `generateAllImagesParallel()` exclusively.

---

## Step 6: Pipeline Integration

The pipeline entity consumes the parallel generator with a `for await...of` loop over the envelopes. Here is the updated Stage 3 from `StoryPipelineEntity.run_impl()`:

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (Stage 3 excerpt):

```typescript
    // ─── Stage 3: Parallel image generation ───────────────────────

    yield await this.createStatusEnvelope(
      'RUNNING',
      `Generating ${storyResult.image_prompts.length} images`,
    );
    await this.updateEntityData({
      stage: 'generating_images',
      images_total: storyResult.image_prompts.length,
      images_generated: 0,
    });

    const images: GeneratedImageResult[] = [];
    for await (const envelope of imageService.generateAllImagesParallel(storyResult.image_prompts)) {
      if (envelope.type === 'FINAL' && envelope.value) {
        images.push(envelope.value);
        await this.updateEntityData({ images_generated: images.length });
        yield await this.createStatusEnvelope(
          'RUNNING',
          `Generated ${images.length}/${storyResult.image_prompts.length} images`,
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

### Advantages Over Sequential Generation

Compared to calling `generateImage()` in a sequential loop (one `await` per image), the parallel approach changes two things:

1. **Results arrive one at a time via `for await`** instead of all at once after `await`. This lets the pipeline yield progress envelopes as each image completes, giving the consumer real-time feedback.

2. **Errors are per-task, not per-batch.** If Image 3 fails but Images 1, 2, 4, and 5 succeed, you get 4 images and 1 error envelope. A sequential loop would have thrown on Image 3 and never attempted Images 4 and 5.

### Handling the Envelope Types

The `for await` loop inspects `envelope.type` to decide what to do:

```typescript
if (envelope.type === 'FINAL' && envelope.value) {
  // Success: collect the image, update progress
  images.push(envelope.value);
  await this.updateEntityData({ images_generated: images.length });
  yield await this.createStatusEnvelope(
    'RUNNING',
    `Generated ${images.length}/${storyResult.image_prompts.length} images`,
  );
} else if (envelope.type === 'ERROR') {
  // Failure: log but continue — other images may still succeed
  logger.warn('[Pipeline] Image generation error', {
    entityId: this.id,
    taskId: envelope.taskId,
    error: envelope.error,
  });
}
```

There is no `INTERMEDIATE` handler because image generation tasks produce a single result. If you later add a task type that streams intermediate values (e.g., a progress percentage from a long-running render), you would add an `else if (envelope.type === 'INTERMEDIATE')` branch.

After the loop, the `images` array contains all successfully generated images. The subsequent `assembleHtml()` step replaces only the placeholders for which images were generated. Any failed images leave their `{{IMAGE_N}}` placeholders in the HTML as-is -- a visible indicator that something went wrong, which is better than silently dropping content.

---

## Capacity in Action

Walk through a concrete scenario: two stories are submitted simultaneously, each with 5 images. Global limit is 10, per-story limit is 3.

### Timeline

| Time | Story A | Story B | Global Used | Notes |
|------|---------|---------|-------------|-------|
| 0s | Launch IMG 1, 2, 3 | Launch IMG 1, 2, 3 | 6 / 10 | Both stories fill their per-story capacity (3 each) |
| ~10s | IMG 1 done; launch IMG 4 | IMG 2 done; launch IMG 4 | 6 / 10 | Releases cascade: story releases 1, global releases 1; then re-acquires for next task |
| ~12s | IMG 2 done; launch IMG 5 | IMG 1 done; launch IMG 5 | 6 / 10 | Steady state: 3 per story, 6 global |
| ~20s | IMG 3 done | IMG 3 done | 4 / 10 | Both stories are winding down |
| ~22s | IMG 4 done | IMG 4 done | 2 / 10 | |
| ~24s | IMG 5 done | IMG 5 done | 0 / 10 | Both stories complete |

At no point does either story exceed 3 concurrent images, and the global count stays at or below 6 (well under the limit of 10). The global limit becomes relevant when more stories are running -- with 4 concurrent stories each trying 3 images, the global limit of 10 means one story must wait for capacity.

### When Global Limits Kick In

Now consider 5 stories at once, each with 5 images:

| Time | Active per Story A-E | Total Active | What Happens |
|------|---------------------|-------------|-------------|
| 0s | A:3, B:3, C:3, D:1, E:0 | 10 / 10 | Global full. Stories D and E are throttled. |
| ~10s | A:3, B:3, C:2, D:1, E:1 | 10 / 10 | As C finishes one, E gets capacity |
| ~15s | A:2, B:3, C:3, D:1, E:1 | 10 / 10 | Capacity shifts between stories as images complete |

Story D only gets 1 concurrent slot (not its full 3) because the global pool is exhausted. As other stories finish images and release global capacity, Story D picks up more slots. The per-story limit of 3 prevents any single story from monopolizing the global pool.

---

## Key Takeaways

1. **Sequential generation is a latency bottleneck.** Five images at 10 seconds each costs 50 seconds sequentially but only ~20 seconds with 3-way concurrency. For pipelines that generate multiple images, parallelism directly improves user-facing response time.

2. **`CapacitySource` provides hierarchical concurrency control.** A child `CapacitySource` links to a parent. Every `acquire()` decrements both; every `release()` increments both. This enforces limits at multiple levels with a single mechanism.

3. **Module-level `GLOBAL_IMAGE_CAPACITY` is shared across all requests.** Because it is a module-level constant, all `ImageService` instances in the process share the same global limit. Per-story limits are scoped to individual `generateAllImagesParallel()` calls.

4. **`SourceBufferObj` bridges arrays to the runner's pull-based interface.** The runner does not accept arrays directly. `SourceBufferObj` wraps an array into a `PullObj & Peekable` source. The `true` argument enables one-shot mode: the source closes when empty.

5. **`HierarchicalTaskPoolRunner.runTasks()` returns an async generator.** Each yielded `TaskProgressEnvelope` represents one task completing or failing. The runner handles capacity acquisition, task launching, and capacity release internally.

6. **Results arrive in completion order, not submission order.** The `for await` loop receives whichever image finishes first. The `taskId` field tells you which original task it corresponds to. The pipeline collects all successful results into an array regardless of order.

7. **Per-task error isolation is a key advantage over sequential.** In the sequential approach, one failed image aborts the entire batch. With the runner, a failed image produces an `ERROR` envelope, and the remaining tasks continue. The pipeline decides how to handle partial results.

8. **The `async *` generator signature enables `yield*` delegation.** The `generateAllImagesParallel()` method is an `AsyncGenerator`, and it delegates to `runner.runTasks()` with `yield*`. The pipeline entity's `run_impl()` consumes this with `for await...of`, which is the standard pattern for streaming results through the entity system.

---

## Next Steps

The parallel image generation system handles throughput efficiently, but there are further improvements that could enhance the quality and flexibility of the illustrated storybook:

- **Reference images for character consistency** -- passing a reference image to the broker's `generateImage()` call so that the same character looks consistent across all illustrations in a story
- **Style selection with prompt dispatch** -- letting users choose an art style (watercolor, digital art, pencil sketch) and dispatching to different model pools or prompt prefixes based on the selection
- **User-configurable quality** -- exposing `ImageQuality` as a parameter on the `create-story` API endpoint so users can trade generation speed for image fidelity

---

**Previous:** [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-and-api.md) | **Start over:** [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md)
