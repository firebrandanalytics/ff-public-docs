# Part 4: Pipeline Orchestration & API Endpoints

In this part, you'll build the `StoryPipelineEntity` -- a `RunnableEntity` that orchestrates the full story generation pipeline inside its `run_impl()` generator. You'll also build the agent bundle class with API endpoints that create pipeline entities and return their IDs.

**What you'll learn:**
- Why orchestration belongs in a `RunnableEntity`, not on the `AgentBundle` class
- Creating a `StoryPipelineEntity` that extends `RunnableEntity` with a custom `run_impl()`
- Using `appendCall()` to create child entities connected via edges in the entity graph
- Using `yield* await child.start()` to delegate execution and forward progress envelopes
- Yielding `createStatusEnvelope('RUNNING', message)` for consumer-visible progress
- Updating entity data inside `run_impl()` for polling-based progress
- The `IllustratedStoryAgentBundle` with API endpoints and entity creation
- The consumer workflow: create an entity via the API, then consume it via the SDK's iterator protocol

**What you'll build:** A `StoryPipelineEntity` that coordinates six stages (safety check, story writing, image generation, HTML assembly, PDF conversion, working memory storage) plus the `IllustratedStoryAgentBundle` with two API endpoints.

**Starting point:** Completed code from [Part 3: Image Generation Service](./part-03-image-generation.md). You should have a working `ImageService`, two bot entities (`ContentSafetyCheckEntity` and `StoryWriterEntity`), and shared type definitions.

---

## Concepts: Why Orchestration Belongs in an Entity

It might seem natural to put pipeline logic directly on the `AgentBundle` class -- add a `runPipeline()` method that coordinates the stages. This is an anti-pattern. Here is why, and what the correct approach looks like.

### The Problem with Bundle-Level Orchestration

When the agent bundle class itself runs the pipeline, several things go wrong:

| Problem | Explanation |
|---------|-------------|
| **Not resumable** | If the server restarts mid-pipeline, the work is lost. The bundle's `runPipeline()` is an in-memory async function with no persistence. |
| **Not an entity** | The pipeline execution has no node in the entity graph. You cannot inspect it with `ff-eg-read`, query its edges, or see its relationship to the child entities it creates. |
| **Not consumable via iterators** | The SDK's iterator protocol (`ff-sdk-cli iterator run`) works with entities, not with bundle methods. Bundle-level orchestration forces you to invent a separate progress mechanism (polling entity data) rather than using the built-in streaming protocol. |
| **Mixed concerns** | The bundle class becomes responsible for both API routing and multi-stage workflow logic. This makes it harder to test, harder to read, and harder to extend. |

### The Entity-Based Approach

The correct pattern is to put orchestration in a `RunnableEntity` subclass with a custom `run_impl()` generator:

```
POST /api/create-story
       |
       v
AgentBundle.createStory()
  --> creates a StoryPipelineEntity with { topic }
  --> returns entity_id immediately
       |
       v (consumer starts the entity)
ff-sdk-cli iterator run <entity_id>
       |
       v
StoryPipelineEntity.run_impl()
       |
       |-- yield createStatusEnvelope('RUNNING', 'Running safety check')
       |-- const safetyEntity = await this.appendCall(ContentSafetyCheckEntity, ...)
       |-- const safetyResult = yield* await safetyEntity.start()
       |
       |-- yield createStatusEnvelope('RUNNING', 'Writing story')
       |-- const writerEntity = await this.appendCall(StoryWriterEntity, ...)
       |-- const storyResult = yield* await writerEntity.start()
       |
       |-- yield createStatusEnvelope('RUNNING', 'Generating images')
       |-- ... image generation, HTML assembly, PDF, working memory ...
       |
       |-- return PipelineResult
       |
       v
Consumer sees STATUS, BOT_PROGRESS, VALUE, and COMPLETED envelopes in real time
```

This approach gives you:

- **Persistence** -- the pipeline entity exists in the entity graph. If the server restarts, the entity's state is recoverable.
- **Observability** -- `ff-eg-read node get <pipeline-entity-id>` shows the pipeline's current data. Edge queries show its child entities.
- **Iterator protocol** -- consumers use the same `ff-sdk-cli iterator run` command they use for any entity. Progress envelopes stream in real time.
- **Separation of concerns** -- the bundle handles API routing; the entity handles workflow logic.

---

## Step 1: The StoryPipelineEntity Class

Create the pipeline entity. This is a `RunnableEntity` subclass with an `@EntityMixin` decorator -- the same pattern you used for `ContentSafetyCheckEntity` and `StoryWriterEntity`, but without a bot. The pipeline entity does not delegate to a bot; it implements `run_impl()` directly to coordinate multiple child entities and services.

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`**:

```typescript
import {
  RunnableEntity,
  EntityFactory,
  EntityMixin,
  logger,
  WorkingMemoryProvider,
} from '@firebrandanalytics/ff-agent-sdk';
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';
import { ImageService } from '../services/image-service.js';
import { ContentSafetyCheckEntity } from './ContentSafetyCheckEntity.js';
import { StoryWriterEntity } from './StoryWriterEntity.js';
import type {
  ContentSafetyResult,
  StoryResult,
  GeneratedImageResult,
  PipelineResult,
} from '@shared/types';

// ─── Service clients (initialized once, shared across all runs) ──

const imageService = new ImageService();

const DOC_PROC_URL = process.env.DOC_PROC_SERVICE_URL
  || 'http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:3000';
const docProcClient = DocProcClient.create({ baseUrl: DOC_PROC_URL });

const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS
  || 'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
const contextClient = new ContextServiceClient({
  address: CONTEXT_SERVICE_ADDRESS,
  apiKey: process.env.CONTEXT_SERVICE_API_KEY || '',
});
const wmProvider = new WorkingMemoryProvider(contextClient);

@EntityMixin({
  specificType: 'StoryPipelineEntity',
  generalType: 'StoryPipelineEntity',
  allowedConnections: {},
})
export class StoryPipelineEntity extends RunnableEntity<any> {
  constructor(factory: EntityFactory<any>, idOrDto: string | any) {
    super(factory, idOrDto);
  }

  protected override async *run_impl() {
    // ... pipeline stages go here (Steps 2-7 below)
  }

  private async updateEntityData(updates: Record<string, any>): Promise<void> {
    try {
      const dto = await this.get_dto();
      const currentData = dto.data || {};
      await this.update_data({ ...currentData, ...updates });
    } catch (err) {
      logger.warn('[Pipeline] Failed to update entity data', {
        entityId: this.id,
        error: err,
      });
    }
  }
}
```

### Comparing to Bot Entities

In Parts 1 and 2, your entities used `AddMixins(RunnableEntity, BotRunnableEntityMixin)` and delegated to a bot via `get_bot_request_args_impl()`. The pipeline entity takes a different approach:

| Aspect | Bot Entity (Parts 1-2) | Pipeline Entity (this part) |
|--------|------------------------|----------------------------|
| **Base class** | `AddMixins(RunnableEntity, BotRunnableEntityMixin)` | `RunnableEntity` directly |
| **Bot** | Has one (ContentSafetyBot or StoryWriterBot) | Has none |
| **run_impl()** | Provided by `BotRunnableEntityMixin` (calls the bot) | Overridden directly to implement pipeline logic |
| **Output** | The bot's validated Zod result | A `PipelineResult` returned at the end of `run_impl()` |
| **Type helpers** | Full chain: PTH -> BTH -> ENH -> RETH | Simplified: `RunnableEntity<any>` |

The pipeline entity extends `RunnableEntity<any>` directly because it does not need the full type helper chain. It coordinates other entities rather than running a bot, so the bot-related type information is not relevant. The `any` type parameter is a pragmatic choice for orchestration entities.

### The `@EntityMixin` Decorator

```typescript
@EntityMixin({
  specificType: 'StoryPipelineEntity',
  generalType: 'StoryPipelineEntity',
  allowedConnections: {},
})
```

This is identical in structure to the bot entity decorators from Parts 1 and 2. The `specificType` must match the key used in the constructor map and the `specific_type_name` passed when creating the entity via `entity_factory.create_entity_node()`.

### The `updateEntityData` Helper

This private method merges new fields into the entity's existing data, using a read-then-write pattern for progress tracking:

```typescript
private async updateEntityData(updates: Record<string, any>): Promise<void> {
  try {
    const dto = await this.get_dto();
    const currentData = dto.data || {};
    await this.update_data({ ...currentData, ...updates });
  } catch (err) {
    logger.warn('[Pipeline] Failed to update entity data', {
      entityId: this.id,
      error: err,
    });
  }
}
```

Key details:

- **Merge, don't replace** -- `{ ...currentData, ...updates }` preserves existing data fields while adding new ones. The entity accumulates data as the pipeline progresses.
- **Wrapped in try/catch** -- entity data updates are best-effort. If the entity service is temporarily slow, the pipeline should not crash just because it could not update progress.
- **Read-then-write** -- reads the current data with `get_dto()` before writing, avoiding accidental overwrites of fields set by earlier stages.

---

## Step 2: The run_impl() Generator Structure

The `run_impl()` method is an async generator function (`async *`). This is the same generator protocol that bot entities use internally, but here you write it directly. The generator can `yield` progress envelopes, `yield*` to delegate to child entities, and `return` a final result.

```typescript
protected override async *run_impl() {
  const dto = await this.get_dto();
  const { topic } = dto.data;

  logger.info('[Pipeline] Starting story pipeline', { entityId: this.id, topic });

  // ... Stage 1: Content safety check (Step 4) ...
  // ... Stage 2: Story writing (Step 4) ...
  // ... Stage 3: Image generation (Step 5) ...
  // ... Stage 4: HTML assembly (Step 6) ...
  // ... Stage 5: PDF generation (Step 6) ...
  // ... Stage 6: Store in working memory (Step 6) ...

  return result;  // PipelineResult
}
```

The first thing `run_impl()` does is read the entity's stored data to get the `topic`. This data was set when the entity was created by the API endpoint. The service clients (`imageService`, `docProcClient`, `wmProvider`) are available as module-level variables (Step 3).

Three key mechanisms are used inside the generator:

| Mechanism | Syntax | What It Does |
|-----------|--------|--------------|
| **yield** | `yield await this.createStatusEnvelope(...)` | Emits a progress envelope that consumers see in real time |
| **yield*** | `yield* await childEntity.start()` | Delegates execution to a child entity, forwarding all of its progress envelopes to the consumer |
| **return** | `return result` | Produces the final value, delivered as a `VALUE` envelope when the generator completes |

---

## Step 3: Module-Level Service Clients

Service clients are initialized at module level, outside the entity class. These clients are stateless and their configuration does not change between runs, so there is no reason to recreate them on each invocation:

```typescript
// ─── Service clients (initialized once, shared across all runs) ──

const imageService = new ImageService();

const DOC_PROC_URL = process.env.DOC_PROC_SERVICE_URL
  || 'http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:3000';
const docProcClient = DocProcClient.create({ baseUrl: DOC_PROC_URL });

const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS
  || 'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
const contextClient = new ContextServiceClient({
  address: CONTEXT_SERVICE_ADDRESS,
  apiKey: process.env.CONTEXT_SERVICE_API_KEY || '',
});
const wmProvider = new WorkingMemoryProvider(contextClient);
```

These are placed above the class declaration. Every `StoryPipelineEntity` instance in the process shares the same clients. This is the correct pattern for service clients that read their configuration from environment variables at startup -- the values do not change during the process lifetime, so creating new instances per run would be wasteful.

| Service | Client | Purpose |
|---------|--------|---------|
| **Image generation** | `ImageService` (wraps `SimplifiedBrokerClient`) | Generates images from text prompts, retrieves from blob storage |
| **PDF conversion** | `DocProcClient` | Converts assembled HTML to PDF |
| **Working memory** | `WorkingMemoryProvider` (wraps `ContextServiceClient`) | Stores final PDF and HTML for retrieval |

---

## Step 4: Using appendCall() and yield* for Child Entities

This is the core pattern for entity-based orchestration. The pipeline creates child entities with `appendCall()` and delegates to them with `yield* await`.

### Stage 1: Content Safety Check

```typescript
// Stage 1: Content safety check
yield await this.createStatusEnvelope('RUNNING', 'Running content safety check');
await this.updateEntityData({ stage: 'safety_check' });

const safetyEntity = await this.appendCall(
  ContentSafetyCheckEntity,
  `safety-check-${Date.now()}`,
  { topic },
);
const safetyResult: ContentSafetyResult = yield* await safetyEntity.start();

if (!safetyResult.is_safe) {
  logger.warn('[Pipeline] Content rejected', { entityId: this.id, safetyResult });
  await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
  return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
}

await this.updateEntityData({ stage: 'safety_passed', safety_result: safetyResult });
```

### Stage 2: Story Writing

```typescript
// Stage 2: Story writing
yield await this.createStatusEnvelope('RUNNING', 'Writing story');
await this.updateEntityData({ stage: 'writing' });

const writerEntity = await this.appendCall(
  StoryWriterEntity,
  `story-writer-${Date.now()}`,
  { topic },
);
const storyResult: StoryResult = yield* await writerEntity.start();

await this.updateEntityData({
  stage: 'writing_complete',
  story_result: {
    title: storyResult.title,
    moral: storyResult.moral,
    age_range: storyResult.age_range,
    html_content: '',
    image_prompts: storyResult.image_prompts,
  },
});
```

### Understanding appendCall()

`appendCall()` is the entity-graph-aware way to create child entities. It does three things:

1. **Creates a new entity node** in the entity graph with the specified type, name, and initial data
2. **Creates an edge** from the parent (pipeline entity) to the child, recording the relationship in the entity graph
3. **Returns a typed entity instance** ready to be started

```typescript
const safetyEntity = await this.appendCall(
  ContentSafetyCheckEntity,    // Entity class (must be in constructor map)
  `safety-check-${Date.now()}`, // Unique name for this entity
  { topic },                    // Initial data (becomes dto.data)
);
```

Compare this to the previous approach where the bundle called `entity_factory.create_entity_node()` directly. That approach created entities with no graph relationship to the pipeline -- they were orphaned nodes. With `appendCall()`, you get a proper parent-child edge that tools like `ff-eg-read` can traverse.

### Understanding yield* await child.start()

The `yield* await` combination does two things in sequence:

1. `await safetyEntity.start()` -- starts the child entity and returns an async iterator
2. `yield*` -- delegates to that iterator, forwarding every envelope the child produces (STATUS, BOT_PROGRESS, VALUE) to the pipeline's consumer

This means the consumer sees a unified stream of progress events from both the pipeline and its children:

```
Pipeline:  STATUS { "RUNNING", "Running content safety check" }
  Child:     STATUS { "STARTED" }
  Child:     BOT_PROGRESS { ... tokens ... }
  Child:     VALUE { is_safe: true, safety_score: 95, ... }
  Child:     STATUS { "COMPLETED" }
Pipeline:  STATUS { "RUNNING", "Writing story" }
  Child:     STATUS { "STARTED" }
  Child:     BOT_PROGRESS { ... tokens ... }
  ...
```

The critical detail: `yield*` returns the child generator's **return value**. When `ContentSafetyCheckEntity` finishes, its `run_impl()` returns a `ContentSafetyResult` (the validated Zod output from the bot). The `yield*` expression evaluates to that return value, which you capture in `safetyResult`. This is the correct way to extract structured output from child entities -- no manual iterator consumption or fallback parsing needed.

### Early Return on Rejection

If the safety check returns `is_safe: false`, the pipeline returns early:

```typescript
if (!safetyResult.is_safe) {
  await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
  return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
}
```

The `return` statement inside `run_impl()` produces the generator's final value, delivered to the consumer as a `VALUE` envelope followed by a `COMPLETED` status. The pipeline entity's status transitions to `Completed` in the entity graph.

---

## Step 5: Yielding Status Envelopes for Consumer-Visible Progress

Each pipeline stage begins by yielding a status envelope:

```typescript
yield await this.createStatusEnvelope('RUNNING', 'Writing story');
```

`createStatusEnvelope()` is a method inherited from `RunnableEntity`. It creates a progress envelope of type `STATUS` with the given status and message. When the consumer is connected via `ff-sdk-cli iterator run`, they see this envelope in real time:

```json
{ "type": "STATUS", "status": "RUNNING", "message": "Writing story" }
```

The `yield` keyword sends this envelope out through the generator protocol to whoever is consuming the entity's iterator. Without `yield`, the envelope would be created but never delivered.

### Status Envelopes vs. Entity Data Updates

The pipeline uses two complementary progress mechanisms:

| Mechanism | Who Sees It | When |
|-----------|-------------|------|
| **`yield createStatusEnvelope(...)`** | Consumers connected via the iterator protocol (`ff-sdk-cli iterator run`) | Real-time streaming |
| **`await this.updateEntityData(...)`** | Anyone who queries the entity's data (`GET /api/story-status` or `ff-eg-read node get`) | Polling at any time |

Both are used at each stage transition because different consumers prefer different access patterns. A connected client sees status envelopes instantly. A dashboard that checks status periodically reads entity data via the polling endpoint.

---

## Step 6: Image Generation, Assembly, and Storage

After the two bot entity stages, the pipeline continues with direct service calls for image generation, HTML assembly, PDF conversion, and working memory storage.

### Stage 3: Image Generation

```typescript
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
for await (const envelope of imageService.generateAllImages(storyResult.image_prompts)) {
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

The `ImageService.generateAllImages()` method (from Part 3) generates images sequentially. Each iteration yields a `GeneratedImageResult` (the base64-encoded image). The pipeline yields a status envelope after each successful image, so the consumer sees incremental progress.

> **Note:** In [Part 5](./part-05-parallel-image-generation.md), the `ImageService` is replaced entirely with entity-based parallel image generation using `ImageGenerationEntity` children and `HierarchicalTaskPoolRunner`.

### Stages 4-6: Assembly, PDF, and Storage

```typescript
// Stage 4: HTML assembly
yield await this.createStatusEnvelope('RUNNING', 'Assembling HTML with images');
await this.updateEntityData({ stage: 'assembling' });
const finalHtml = imageService.assembleHtml(storyResult.html_content, images);

// Stage 5: PDF generation
yield await this.createStatusEnvelope('RUNNING', 'Generating PDF');
await this.updateEntityData({ stage: 'creating_pdf' });
let pdfWmId: string | undefined;
try {
  const pdfResponse = await docProcClient.htmlToPdf(Buffer.from(finalHtml, 'utf-8'));
  if (pdfResponse.success && pdfResponse.data) {
    const pdfBuffer = typeof pdfResponse.data === 'string'
      ? Buffer.from(pdfResponse.data, 'base64')
      : Buffer.from(pdfResponse.data);
    const wmResult = await wmProvider.add_memory_from_buffer({
      entityNodeId: this.id!,
      name: `${storyResult.title || 'story'}.pdf`,
      description: `Illustrated storybook PDF: ${storyResult.title}`,
      contentType: 'application/pdf',
      memoryType: 'file',
      buffer: pdfBuffer,
      metadata: {
        title: storyResult.title,
        moral: storyResult.moral,
        image_count: images.length,
        generated_at: new Date().toISOString(),
      },
    });
    pdfWmId = wmResult.workingMemoryId;
  }
} catch (err) {
  logger.warn('[Pipeline] PDF generation failed, continuing without PDF', {
    entityId: this.id,
    error: err instanceof Error ? err.message : String(err),
  });
}

// Stage 6: Store HTML in working memory
yield await this.createStatusEnvelope('RUNNING', 'Storing results');
await this.updateEntityData({ stage: 'storing_results' });
let htmlWmId: string | undefined;
try {
  const wmResult = await wmProvider.add_memory_from_buffer({
    entityNodeId: this.id!,
    name: `${storyResult.title || 'story'}.html`,
    description: `Illustrated storybook HTML: ${storyResult.title}`,
    contentType: 'text/html',
    memoryType: 'file',
    buffer: Buffer.from(finalHtml, 'utf-8'),
    metadata: { title: storyResult.title, image_count: images.length },
  });
  htmlWmId = wmResult.workingMemoryId;
} catch (err) {
  logger.warn('[Pipeline] HTML storage failed', { entityId: this.id, error: err });
}
```

### Graceful Error Handling

Stages 5 and 6 are each wrapped in their own `try/catch`. This is intentional. PDF generation is a nice-to-have -- the story content (HTML with embedded images) is the primary output. If the doc-proc service is down, the pipeline still completes successfully with the HTML result. The same applies to the HTML working memory storage: if the context service is temporarily unavailable, the pipeline logs a warning but does not fail.

### Large Data and Working Memory

A critical design decision: the assembled HTML is stored in working memory, not in entity data. The final HTML contains base64-encoded images and can easily be 5-10 MB or more. Entity data is stored in PostgreSQL and should remain lightweight (metadata, IDs, stage names).

Notice the `html_content: ''` in the entity data update at the `writing_complete` stage:

```typescript
story_result: {
  title: storyResult.title,
  moral: storyResult.moral,
  age_range: storyResult.age_range,
  html_content: '',              // Empty! Not stored in entity data
  image_prompts: storyResult.image_prompts,
},
```

The actual HTML lives in working memory. Clients use the `html_wm_id` and `pdf_wm_id` stored in entity data to download the files through the working memory API.

---

## Step 7: Returning the Final Result

After all stages complete, the generator returns a `PipelineResult`:

```typescript
const result: PipelineResult = {
  stage: 'completed',
  title: storyResult.title,
  moral: storyResult.moral,
  age_range: storyResult.age_range,
  image_count: images.length,
  pdf_wm_id: pdfWmId,
  html_wm_id: htmlWmId,
};

await this.updateEntityData({
  stage: 'completed',
  pdf_wm_id: pdfWmId,
  html_wm_id: htmlWmId,
  image_count: images.length,
});

return result;
```

The `return` statement delivers the result as a `VALUE` envelope to the consumer, followed by a `COMPLETED` status. The entity data is also updated so that the polling endpoint reflects the final state.

### Pipeline Stage Summary

| Stage | What Happens | Entity Data Updated |
|-------|-------------|-------------------|
| `safety_check` | Creates `ContentSafetyCheckEntity` via `appendCall()`, delegates with `yield*` | `stage: 'safety_check'` |
| `safety_passed` / `rejected` | Records the safety result; early return if rejected | `safety_result: { ... }` |
| `writing` | Creates `StoryWriterEntity` via `appendCall()`, delegates with `yield*` | `stage: 'writing'` |
| `writing_complete` | Records story metadata (title, moral, age range, image prompts) | `story_result: { ... }` |
| `generating_images` | Generates images in parallel, yields progress per image | `images_generated: N, images_total: M` |
| `assembling` | Replaces `{{IMAGE_N}}` placeholders with base64 `<img>` tags | `stage: 'assembling'` |
| `creating_pdf` | Converts HTML to PDF, stores in working memory | `pdf_wm_id: '...'` |
| `storing_results` | Stores HTML in working memory | `html_wm_id: '...'` |
| `completed` | Pipeline finished | `stage: 'completed'`, all IDs |

---

## Step 8: The Agent Bundle

With orchestration in the `StoryPipelineEntity`, the agent bundle is just API endpoints and entity creation.

**`apps/story-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { StoryBundleConstructors } from "./constructors.js";
import type {
  CreateStoryRequest,
  CreateStoryResponse,
  StoryStatusResponse,
  StoryEntityData,
} from '@shared/types';

const APPLICATION_ID = process.env.FF_APPLICATION_ID || "e7a95bcc-7ef9-432e-9713-f040db078b14";
const AGENT_BUNDLE_ID = process.env.FF_AGENT_BUNDLE_ID || "3f78cd56-4ac4-4503-816d-01a0e61fd2cf";

export class IllustratedStoryAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: AGENT_BUNDLE_ID,
        application_id: APPLICATION_ID,
        name: "IllustratedStory",
        type: "agent_bundle",
        description: "AI-powered illustrated children's storybook generator",
      },
      StoryBundleConstructors,
      createEntityClient(APPLICATION_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("IllustratedStory bundle initialized!");
    logger.info("API endpoints:");
    logger.info("   POST /api/create-story   - Create a story pipeline entity");
    logger.info("   GET  /api/story-status   - Get generation progress");
    logger.info("");
    logger.info("Usage: POST /api/create-story -> get entity_id");
    logger.info("       ff-sdk-cli iterator run <entity_id> --url <url>");
  }

  @ApiEndpoint({ method: 'POST', route: 'create-story' })
  async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
    const { topic } = body;
    if (!topic?.trim()) throw new Error('Topic is required');
    logger.info('[API] Creating story pipeline', { topic });

    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `story-pipeline-${Date.now()}`,
      specific_type_name: 'StoryPipelineEntity',
      general_type_name: 'StoryPipelineEntity',
      status: 'Pending',
      data: { topic } as StoryEntityData,
    });

    return { entity_id: entity.id! };
  }

  @ApiEndpoint({ method: 'GET', route: 'story-status' })
  async getStoryStatus(query: { entity_id?: string }): Promise<StoryStatusResponse> {
    const { entity_id } = query;
    if (!entity_id) throw new Error('entity_id query parameter is required');

    const dto = await this.entity_client.get_node(entity_id);
    if (!dto) throw new Error(`Story ${entity_id} not found`);

    const data = (dto as any).data || {};
    return { entity_id: dto.id!, status: dto.status!, stage: data.stage || 'unknown', data };
  }
}
```

The bundle does not import `WorkingMemoryProvider`, `ContextServiceClient`, `DocProcClient`, or `ImageService`. It does not know how the pipeline works -- only that creating a `StoryPipelineEntity` with a topic is enough to start one.

### The create-story Endpoint

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-story' })
async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
  const { topic } = body;
  if (!topic?.trim()) throw new Error('Topic is required');

  const entity = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `story-pipeline-${Date.now()}`,
    specific_type_name: 'StoryPipelineEntity',
    general_type_name: 'StoryPipelineEntity',
    status: 'Pending',
    data: { topic } as StoryEntityData,
  });

  return { entity_id: entity.id! };
}
```

This endpoint creates the pipeline entity but does **not** start it. The entity is created with `status: 'Pending'`. The consumer is responsible for starting the entity by connecting to its iterator. This is the standard FireFoundry pattern: entity creation and entity execution are separate operations.

Note the `specific_type_name: 'StoryPipelineEntity'` -- this matches the `@EntityMixin` decorator and the constructor map key. When the consumer starts this entity, the framework looks up `StoryPipelineEntity` in the constructor map, instantiates it, and calls `run_impl()`.

### The story-status Endpoint

```typescript
@ApiEndpoint({ method: 'GET', route: 'story-status' })
async getStoryStatus(query: { entity_id?: string }): Promise<StoryStatusResponse> {
  const { entity_id } = query;
  if (!entity_id) throw new Error('entity_id query parameter is required');

  const dto = await this.entity_client.get_node(entity_id);
  if (!dto) throw new Error(`Story ${entity_id} not found`);

  const data = (dto as any).data || {};
  return { entity_id: dto.id!, status: dto.status!, stage: data.stage || 'unknown', data };
}
```

This endpoint reads entity data for polling-based progress. The `stage` field is updated by `run_impl()` as the pipeline progresses. Clients that cannot use the iterator protocol (e.g., a simple web dashboard with polling) use this endpoint to check progress.

---

## Step 9: Update the Constructor Map

Add `StoryPipelineEntity` to the constructor map alongside the entities from Parts 1 and 2.

**`apps/story-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { ContentSafetyCheckEntity } from './entities/ContentSafetyCheckEntity.js';
import { StoryWriterEntity } from './entities/StoryWriterEntity.js';
import { StoryPipelineEntity } from './entities/StoryPipelineEntity.js';

export const StoryBundleConstructors = {
  ...FFConstructors,
  ContentSafetyCheckEntity: ContentSafetyCheckEntity,
  StoryWriterEntity: StoryWriterEntity,
  StoryPipelineEntity: StoryPipelineEntity,
} as const;
```

The constructor map now has three entries. The framework uses this map to instantiate entities from their persisted type name. When `appendCall(ContentSafetyCheckEntity, ...)` is called inside the pipeline entity, the framework resolves the class through this map.

---

## Step 10: The Server Entry Point

The `index.ts` entry point is unchanged from the standard pattern:

**`apps/story-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { IllustratedStoryAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    logger.info(`Starting IllustratedStory server on port ${port}`);

    const server = await createStandaloneAgentBundle(
      IllustratedStoryAgentBundle,
      { port: port }
    );

    logger.info(`IllustratedStory server running on port ${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Create story: POST http://localhost:${port}/api/create-story`);
    logger.info(`Story status: GET http://localhost:${port}/api/story-status?entity_id=...`);

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down");
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

`createStandaloneAgentBundle` instantiates the bundle, calls `init()`, registers the `@ApiEndpoint` routes, sets up the iterator protocol routes, and starts the HTTP server. The iterator protocol routes are what enable `ff-sdk-cli iterator run` to communicate with entities.

---

## Step 11: The Consumer Workflow

With the entity-based approach, the consumer workflow has two steps: create the entity, then start it via the iterator.

### Create the Pipeline Entity

```bash
RESULT=$(ff-sdk-cli api call create-story \
  --method POST \
  --body '{"topic":"A brave kitten who learns to swim"}' \
  --url http://localhost:3001)

ENTITY_ID=$(echo $RESULT | jq -r '.entity_id')
echo "Pipeline entity: $ENTITY_ID"
```

This calls `POST /api/create-story`, which creates a `StoryPipelineEntity` with `status: 'Pending'` and returns the entity ID. The pipeline has not started yet.

### Start and Consume Progress via Iterator

```bash
ff-sdk-cli iterator run $ENTITY_ID --url http://localhost:3001
```

This connects to the entity's iterator, starts `run_impl()`, and streams progress envelopes to the terminal in real time. You will see output like:

```
STATUS  RUNNING  Running content safety check
STATUS  STARTED  (ContentSafetyCheckEntity)
BOT_PROGRESS  ... tokens ...
VALUE   { is_safe: true, safety_score: 95, concerns: [], reasoning: "..." }
STATUS  COMPLETED  (ContentSafetyCheckEntity)
STATUS  RUNNING  Writing story
STATUS  STARTED  (StoryWriterEntity)
BOT_PROGRESS  ... tokens ...
VALUE   { title: "...", html_content: "...", image_prompts: [...], ... }
STATUS  COMPLETED  (StoryWriterEntity)
STATUS  RUNNING  Generating 4 images
STATUS  RUNNING  Generated 1/4 images
STATUS  RUNNING  Generated 2/4 images
STATUS  RUNNING  Generated 3/4 images
STATUS  RUNNING  Generated 4/4 images
STATUS  RUNNING  Assembling HTML with images
STATUS  RUNNING  Generating PDF
STATUS  RUNNING  Storing results
VALUE   { stage: "completed", title: "...", image_count: 4, pdf_wm_id: "...", ... }
STATUS  COMPLETED
```

The child entity envelopes (ContentSafetyCheckEntity, StoryWriterEntity) are forwarded transparently by `yield*`. The consumer sees a unified stream without needing to know about the pipeline's internal structure.

### Poll for Status (Alternative)

If you prefer polling instead of the iterator protocol, use the status endpoint:

```bash
ff-sdk-cli api call story-status \
  --query '{"entity_id":"'"$ENTITY_ID"'"}' \
  --url http://localhost:3001
```

Or with curl:

```bash
curl -s "http://localhost:3001/api/story-status?entity_id=$ENTITY_ID" | jq .stage
```

The stage field progresses through:

```
safety_check -> safety_passed -> writing -> writing_complete -> generating_images -> assembling -> creating_pdf -> storing_results -> completed
```

### Inspect Results

After completion, verify the pipeline produced the expected outputs:

```bash
# Check the pipeline entity's data
ff-eg-read node get $ENTITY_ID

# Check edges to child entities
ff-eg-read node edges $ENTITY_ID

# Check working memory (PDF and HTML)
ff-wm-read list --entity-id $ENTITY_ID

# Download the PDF
ff-wm-read download <pdf-working-memory-id> --output ./story.pdf
```

---

## What You've Built

You now have:
- A `StoryPipelineEntity` that orchestrates six stages inside a `run_impl()` generator, using `appendCall()` for child entities and `yield*` for delegation
- Real-time progress via `createStatusEnvelope()` and polling progress via `updateEntityData()`
- An `IllustratedStoryAgentBundle` with two API endpoints and no orchestration logic
- An updated constructor map with all three entity types
- A consumer workflow using `ff-sdk-cli iterator run` for real-time streaming or `GET /api/story-status` for polling

The final project structure:

```
apps/story-bundle/src/
+-- index.ts                     # Server entry point
+-- agent-bundle.ts              # API endpoints (create-story, story-status)
+-- constructors.ts              # Entity registry (3 entities)
+-- schemas.ts                   # Zod schemas (safety + story output)
+-- bots/
|   +-- ContentSafetyBot.ts      # Safety assessment bot
|   +-- StoryWriterBot.ts        # Story generation bot
+-- entities/
|   +-- ContentSafetyCheckEntity.ts  # Bot entity for safety check
|   +-- StoryWriterEntity.ts         # Bot entity for story writing
|   +-- StoryPipelineEntity.ts       # Pipeline orchestrator entity
+-- prompts/
|   +-- ContentSafetyPrompt.ts   # Safety check prompt
|   +-- StoryWriterPrompt.ts     # Story writer prompt
+-- services/
    +-- image-service.ts         # Image generation and HTML assembly
```

---

## Key Takeaways

1. **Orchestration belongs in a RunnableEntity, not on the AgentBundle.** Placing pipeline logic in `run_impl()` gives you persistence in the entity graph, real-time progress via the iterator protocol, parent-child edges to child entities, and clean separation between API routing and workflow logic.

2. **`appendCall()` creates child entities with graph edges.** Unlike `entity_factory.create_entity_node()`, `appendCall()` records a parent-child relationship in the entity graph. This makes the pipeline's structure inspectable with `ff-eg-read node edges`.

3. **`yield* await child.start()` delegates and extracts the return value.** The `yield*` forwards all of the child's progress envelopes to the pipeline's consumer, and the expression evaluates to the child's return value (the validated bot output). No manual iterator consumption or `runBotEntity<T>()` helpers needed.

4. **`yield createStatusEnvelope('RUNNING', message)` produces consumer-visible progress.** Use it at each stage transition so consumers connected via `ff-sdk-cli iterator run` see real-time updates. Combine with `updateEntityData()` for polling-based consumers.

5. **The agent bundle defines API endpoints and creates entities.** It should not contain workflow logic or multi-stage orchestration. If your bundle class is growing past 100 lines, the orchestration should move to an entity.

6. **Entity data updates are for polling; status envelopes are for streaming.** Use both at each stage transition to support both consumer patterns. Entity data updates are best-effort (wrapped in try/catch) because they are not critical to the pipeline's execution.

7. **Service clients are module-level, not per-run.** These clients are stateless and configured from environment variables that do not change. Initialize them once at module level and share them across all entity instances in the process.

8. **Non-critical stages should fail gracefully.** PDF generation and working memory storage are each wrapped in their own `try/catch`. The pipeline's primary output is the assembled HTML; auxiliary outputs should not cause the pipeline to fail.

---

## Next Steps

In [Part 5: Parallel Image Generation](./part-05-parallel-image-generation.md), you'll revisit the image generation stage to add parallelism using `HierarchicalTaskPoolRunner` and hierarchical `CapacitySource`. You'll learn how to limit concurrent image requests both per-story (3) and globally (10), feed tasks via `SourceBufferObj`, and consume `TaskProgressEnvelope` results as images complete.
