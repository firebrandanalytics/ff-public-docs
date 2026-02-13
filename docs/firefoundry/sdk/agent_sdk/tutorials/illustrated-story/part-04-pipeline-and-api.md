# Part 4: Pipeline Orchestration & API Endpoints

In this part, you'll build the agent bundle class that ties everything together. It orchestrates the full story generation pipeline -- content safety, story writing, image generation, HTML assembly, PDF conversion, and working memory storage -- and exposes REST API endpoints so clients can trigger stories and poll for progress.

**What you'll learn:**
- Extending `FFAgentBundle` with constructor arguments and `createEntityClient`
- Overriding `init()` to initialize platform service clients
- Using the `@ApiEndpoint` decorator to expose HTTP endpoints
- The background pipeline pattern: return immediately, process asynchronously
- Entity state management for client-side progress polling
- The `runBotEntity<T>()` pattern for extracting structured output from bot entities
- Creating child entities by `specific_type_name` and running them
- Storing large outputs in working memory instead of entity data
- Wiring up the server entry point with `createStandaloneAgentBundle`

**What you'll build:** The `IllustratedStoryAgentBundle` class with two API endpoints (`POST /api/create-story` and `GET /api/story-status`) and a six-stage background pipeline, plus the `index.ts` entry point that starts the HTTP server.

**Starting point:** Completed code from [Part 3: Image Generation Service](./part-03-image-generation.md). You should have a working `ImageService`, two bot entities (`ContentSafetyCheckEntity` and `StoryWriterEntity`), and shared type definitions.

---

## Concepts: The Agent Bundle as Orchestrator

In the report-generator tutorial, orchestration happened inside a parent entity's `run_impl()` using `appendOrRetrieveCall` and `yield*`. That pattern works well when the orchestrator is itself an entity that needs persistence and resumability.

The illustrated story demo takes a different approach: the **agent bundle class itself** is the orchestrator. The pipeline runs as a plain async method (`runPipeline`), creating child entities for the bot steps and calling services directly for image generation and PDF conversion. Entity data tracks progress so clients can poll for status.

This pattern is simpler for fire-and-forget workflows where the API endpoint needs to return immediately. The tradeoff is that the pipeline is not resumable across server restarts (a crashed pipeline must be re-triggered). For production use cases that need resumability, use the entity-based orchestration pattern from the report-generator tutorial.

```
POST /api/create-story
       |
       v
createStory() --> create entity, return entity_id immediately
       |
       v (background)
runPipeline()
       |
       |-- Stage 1: Content safety check (ContentSafetyCheckEntity)
       |-- Stage 2: Story writing (StoryWriterEntity)
       |-- Stage 3: Image generation (ImageService)
       |-- Stage 4: HTML assembly (ImageService.assembleHtml)
       |-- Stage 5: PDF conversion (DocProcClient)
       |-- Stage 6: Store in working memory
       |
       v
GET /api/story-status --> poll entity data for progress
```

---

## Step 1: The Agent Bundle Class

Create the main agent bundle file. This class extends `FFAgentBundle`, initializes all service clients, and defines the API endpoints and pipeline logic.

**`apps/story-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
  WorkingMemoryProvider,
} from "@firebrandanalytics/ff-agent-sdk";
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';
import { StoryBundleConstructors } from "./constructors.js";
import { ImageService } from "./services/image-service.js";
import type {
  CreateStoryRequest,
  CreateStoryResponse,
  StoryStatusResponse,
  StoryEntityData,
  ContentSafetyResult,
  StoryResult,
} from '@shared/types';

const APPLICATION_ID = process.env.FF_APPLICATION_ID || "e7a95bcc-7ef9-432e-9713-f040db078b14";
const AGENT_BUNDLE_ID = process.env.FF_AGENT_BUNDLE_ID || "3f78cd56-4ac4-4503-816d-01a0e61fd2cf";
```

Let's break down the imports before continuing:

| Import | From | Purpose |
|--------|------|---------|
| `FFAgentBundle` | `ff-agent-sdk` | Base class for agent bundles. Provides `entity_factory`, `entity_client`, `get_app_id()`, and the API endpoint registration system. |
| `createEntityClient` | `ff-agent-sdk` | Factory function that creates an entity client connected to the entity service. Takes the application ID. |
| `ApiEndpoint` | `ff-agent-sdk` | Decorator that registers a method as an HTTP endpoint under `/api/`. |
| `logger` | `ff-agent-sdk` | Structured logger for bundle-level and pipeline logging. |
| `WorkingMemoryProvider` | `ff-agent-sdk` | High-level wrapper around the context service for file storage. |
| `ContextServiceClient` | `cs-client` | Low-level client for the context service (manages working memory records). |
| `DocProcClient` | `doc-proc-client` | Client for the document processing service (HTML-to-PDF conversion). |
| `StoryBundleConstructors` | `./constructors.js` | Constructor map that registers all entity types (from Part 1 and Part 2). |
| `ImageService` | `./services/image-service.js` | Image generation and HTML assembly service (from Part 3). |

The two ID constants identify this bundle in the FireFoundry platform:
- **`APPLICATION_ID`** -- the application this bundle belongs to
- **`AGENT_BUNDLE_ID`** -- the unique ID for this specific agent bundle instance

These are typically set via environment variables in production. The hardcoded defaults are for local development.

---

## Step 2: The Constructor

```typescript
export class IllustratedStoryAgentBundle extends FFAgentBundle<any> {
  private working_memory_provider!: WorkingMemoryProvider;
  private image_service!: ImageService;
  private doc_proc_client!: DocProcClient;

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
```

The `FFAgentBundle` constructor takes three arguments:

1. **Bundle descriptor** -- an object with `id`, `application_id`, `name`, `type`, and `description`. The `id` is the agent bundle's own unique ID. The `application_id` links it to the parent application.

2. **Constructor map** -- the `StoryBundleConstructors` object from Part 1 that maps entity type names to their classes. The framework uses this to instantiate entities from persisted state (e.g., when retrieving an entity by ID, the framework looks up the type name in this map to know which class to construct).

3. **Entity client** -- created by `createEntityClient(APPLICATION_ID)`. This connects to the entity service and scopes all operations to the given application. The bundle inherits `this.entity_client` (for reading entities) and `this.entity_factory` (for creating entities) from this client.

The service clients (`working_memory_provider`, `image_service`, `doc_proc_client`) use the definite assignment assertion (`!`) because they are initialized in `init()` rather than the constructor. This is the standard pattern -- the constructor runs synchronously, but service clients often need async initialization.

---

## Step 3: The init() Override

```typescript
  override async init() {
    await super.init();

    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS
      || 'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);

    this.image_service = new ImageService();

    const DOC_PROC_URL = process.env.DOC_PROC_SERVICE_URL
      || 'http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:3000';
    this.doc_proc_client = DocProcClient.create({ baseUrl: DOC_PROC_URL });

    logger.info("IllustratedStory bundle initialized!");
  }
```

The `init()` method is called by `createStandaloneAgentBundle` after construction but before the HTTP server starts accepting requests. Always call `super.init()` first -- it initializes the base bundle's internal state.

Three service clients are initialized here:

| Client | Service | Purpose |
|--------|---------|---------|
| `WorkingMemoryProvider` | Context service | Store generated PDF and HTML files |
| `ImageService` | Broker service (via `BrokerClient` internally) | Generate images from text prompts |
| `DocProcClient` | Doc-proc service | Convert assembled HTML to PDF |

The service addresses default to in-cluster Kubernetes DNS names. For local development with port-forwarding, override them via environment variables:

```bash
export CONTEXT_SERVICE_ADDRESS=http://localhost:50051
export DOC_PROC_SERVICE_URL=http://localhost:3002
```

---

## Step 4: The @ApiEndpoint Decorator

The `@ApiEndpoint` decorator transforms a method on the agent bundle class into an HTTP endpoint. The SDK registers these as Express routes under the `/api/` prefix when the server starts.

### POST Endpoint: Create Story

```typescript
  @ApiEndpoint({ method: 'POST', route: 'create-story' })
  async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
    const { topic } = body;
    if (!topic?.trim()) {
      throw new Error('Topic is required');
    }

    logger.info('[API] Creating illustrated story', { topic });

    const storyEntity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `story-${Date.now()}`,
      specific_type_name: 'EntityNode',
      general_type_name: 'EntityNode',
      status: 'Pending',
      data: {
        topic,
        stage: 'created',
      } as StoryEntityData,
    });

    const entity_id = storyEntity.id!;

    // Run pipeline in background
    this.runPipeline(storyEntity, topic).catch(err => {
      logger.error('[Pipeline] Fatal error', { entity_id, error: err });
    });

    return { entity_id };
  }
```

**How `@ApiEndpoint` maps to HTTP:**

```
@ApiEndpoint({ method: 'POST', route: 'create-story' })
                  |                    |
                  v                    v
            POST method          /api/create-story
```

For POST endpoints, the SDK parses the JSON request body and passes it as the first argument to the method. The return value is serialized as the JSON response. Throwing an error returns an HTTP error response.

**What this endpoint does:**

1. **Validates input** -- checks that `topic` is present and non-empty
2. **Creates a tracking entity** -- uses `entity_factory.create_entity_node()` to create an `EntityNode` in the entity graph with initial data including the topic and stage
3. **Starts the pipeline in the background** -- calls `this.runPipeline()` without awaiting it, using `.catch()` to log fatal errors
4. **Returns immediately** -- the client gets the `entity_id` right away and can poll for progress

Note that the story entity uses `specific_type_name: 'EntityNode'` rather than a custom entity type. This is because the story entity is a plain data holder for tracking progress -- it does not need a custom class with `run_impl()`. The pipeline logic lives in the bundle, not in the entity.

### GET Endpoint: Story Status

```typescript
  @ApiEndpoint({ method: 'GET', route: 'story-status' })
  async getStoryStatus(query: { entity_id?: string }): Promise<StoryStatusResponse> {
    const { entity_id } = query;
    if (!entity_id) {
      throw new Error('entity_id query parameter is required');
    }

    const dto = await this.entity_client.get_node(entity_id);
    if (!dto) {
      throw new Error(`Story ${entity_id} not found`);
    }

    const data = (dto as any).data || {};
    return {
      entity_id: dto.id!,
      status: dto.status!,
      stage: data.stage || 'unknown',
      data,
    };
  }
```

For GET endpoints, the SDK parses URL query parameters into an object and passes it as the first argument. All query parameter values are strings.

This endpoint reads the entity's current state using `this.entity_client.get_node(entity_id)`. The `stage` field in entity data is updated by the pipeline as it progresses, so the client can show meaningful status:

```
created --> safety_check --> safety_passed --> writing --> writing_complete
         --> generating_images --> assembling --> creating_pdf --> completed
```

Or in error/rejection cases:
```
created --> safety_check --> rejected
created --> ... --> error
```

---

## Step 5: The Background Pipeline

The `runPipeline` method is the heart of the orchestration. It runs asynchronously in the background while the API endpoint has already returned.

```typescript
  private async runPipeline(storyEntity: any, topic: string): Promise<void> {
    const entityId = storyEntity.id!;

    try {
      // Step 1: Content safety check
      await this.updateStage(storyEntity, 'safety_check');
      const safetyResult = await this.runSafetyCheck(topic);

      if (!safetyResult.is_safe) {
        logger.warn('[Pipeline] Content rejected', { entityId, safetyResult });
        await this.updateStage(storyEntity, 'rejected', { safety_result: safetyResult });
        return;
      }

      await this.updateStage(storyEntity, 'safety_passed', { safety_result: safetyResult });

      // Step 2: Story writing
      await this.updateStage(storyEntity, 'writing');
      const storyResult = await this.runStoryWriter(topic);

      await this.updateStage(storyEntity, 'writing_complete', {
        story_result: {
          title: storyResult.title,
          moral: storyResult.moral,
          age_range: storyResult.age_range,
          html_content: '',
          image_prompts: storyResult.image_prompts,
        },
      });

      // Step 3: Image generation
      const imagePrompts = storyResult.image_prompts;
      await this.updateStage(storyEntity, 'generating_images', {
        images_total: imagePrompts.length,
        images_generated: 0,
      });

      const images = await this.image_service.generateAllImages(
        imagePrompts,
        async (generated, total) => {
          await this.updateStage(storyEntity, 'generating_images', {
            images_generated: generated,
            images_total: total,
          });
        },
      );

      // Step 4: Assemble HTML with embedded images
      await this.updateStage(storyEntity, 'assembling');
      const finalHtml = this.image_service.assembleHtml(storyResult.html_content, images);

      // Step 5: Convert to PDF
      await this.updateStage(storyEntity, 'creating_pdf');
      let pdfWmId: string | undefined;

      try {
        const pdfResponse = await this.doc_proc_client.htmlToPdf(
          Buffer.from(finalHtml, 'utf-8')
        );

        if (pdfResponse.success && pdfResponse.data) {
          const pdfBuffer = typeof pdfResponse.data === 'string'
            ? Buffer.from(pdfResponse.data, 'base64')
            : Buffer.from(pdfResponse.data);

          const wmResult = await this.working_memory_provider.add_memory_from_buffer({
            entityNodeId: entityId,
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
          entityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Step 6: Store final HTML in working memory
      try {
        await this.working_memory_provider.add_memory_from_buffer({
          entityNodeId: entityId,
          name: `${storyResult.title || 'story'}.html`,
          description: `Illustrated storybook HTML: ${storyResult.title}`,
          contentType: 'text/html',
          memoryType: 'file',
          buffer: Buffer.from(finalHtml, 'utf-8'),
          metadata: {
            title: storyResult.title,
            image_count: images.length,
          },
        });
      } catch (err) {
        logger.warn('[Pipeline] HTML storage failed', { entityId, error: err });
      }

      // Done!
      await this.updateStage(storyEntity, 'completed', {
        pdf_wm_id: pdfWmId,
        story_result: {
          title: storyResult.title,
          moral: storyResult.moral,
          age_range: storyResult.age_range,
          html_content: '',
          image_prompts: storyResult.image_prompts,
        },
        image_count: images.length,
      });

    } catch (err) {
      await this.updateStage(storyEntity, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
```

### Pipeline Stage Breakdown

| Stage | What Happens | Entity Data Updated |
|-------|-------------|-------------------|
| `safety_check` | Creates a `ContentSafetyCheckEntity` and runs it | `stage: 'safety_check'` |
| `safety_passed` / `rejected` | Records the safety result | `safety_result: { is_safe, ... }` |
| `writing` | Creates a `StoryWriterEntity` and runs it | `stage: 'writing'` |
| `writing_complete` | Records story metadata (title, moral, age range, image prompts) | `story_result: { ... }` |
| `generating_images` | Calls `ImageService.generateAllImages()` with progress callback | `images_generated: N, images_total: M` |
| `assembling` | Replaces `{{IMAGE_N}}` placeholders with base64-encoded `<img>` tags | `stage: 'assembling'` |
| `creating_pdf` | Calls `DocProcClient.htmlToPdf()` and stores the PDF in working memory | `pdf_wm_id: '...'` |
| `completed` | Stores final HTML in working memory and marks entity as done | `stage: 'completed'` |

### Graceful Error Handling

Notice that Steps 5 and 6 (PDF generation and HTML storage) are each wrapped in their own `try/catch`:

```typescript
try {
  const pdfResponse = await this.doc_proc_client.htmlToPdf(
    Buffer.from(finalHtml, 'utf-8')
  );
  // ... store PDF in working memory ...
} catch (err) {
  logger.warn('[Pipeline] PDF generation failed, continuing without PDF', {
    entityId,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

This is intentional. PDF generation is a nice-to-have -- the story content (HTML with embedded images) is the primary output. If the doc-proc service is down, the pipeline still completes successfully with the HTML result. The same applies to the HTML working memory storage: if the context service is temporarily unavailable, the pipeline logs a warning but does not fail.

The outer `try/catch` around the entire pipeline handles fatal errors (like a bot entity failing) by setting the stage to `error` with the error message, so the status endpoint can report what went wrong.

### Large Data and Working Memory

A critical design decision in this pipeline is **not** storing the assembled HTML in entity data. The final HTML contains base64-encoded images, which can easily be 5-10 MB or more. Entity data is stored in PostgreSQL and should remain lightweight (metadata, IDs, stage names).

Instead, the pipeline stores large outputs in working memory:

```typescript
// Store the PDF in working memory
const wmResult = await this.working_memory_provider.add_memory_from_buffer({
  entityNodeId: entityId,
  name: `${storyResult.title || 'story'}.pdf`,
  description: `Illustrated storybook PDF: ${storyResult.title}`,
  contentType: 'application/pdf',
  memoryType: 'file',
  buffer: pdfBuffer,
  metadata: { ... },
});
pdfWmId = wmResult.workingMemoryId;
```

The working memory ID (`pdfWmId`) is then stored in entity data. Clients use this ID to download the file through the working memory API.

Notice the pattern in the `story_result` stored in entity data at completion:

```typescript
story_result: {
  title: storyResult.title,
  moral: storyResult.moral,
  age_range: storyResult.age_range,
  html_content: '',              // Empty! Not stored in entity data
  image_prompts: storyResult.image_prompts,
},
```

The `html_content` field is explicitly set to an empty string. The actual HTML lives in working memory. This keeps entity data small and queryable.

---

## Step 6: Entity State Management with updateStage

The `updateStage` helper updates the entity's data with the current pipeline stage and any additional data:

```typescript
  private async updateStage(
    entity: any,
    stage: string,
    additionalData: Partial<StoryEntityData> = {},
  ): Promise<void> {
    try {
      const dto = await entity.get_dto();
      const currentData = dto.data || {};
      const newData = { ...currentData, stage, ...additionalData };
      await entity.update_data(newData);
      logger.info('[Pipeline] Stage updated', { entityId: entity.id, stage });
    } catch (err) {
      logger.warn('[Pipeline] Failed to update stage', {
        entityId: entity.id, stage, error: err,
      });
    }
  }
```

Key details:

- **Merge, don't replace** -- `{ ...currentData, stage, ...additionalData }` preserves existing data fields while updating the stage and adding new fields. This means the entity accumulates data as the pipeline progresses.
- **Wrapped in try/catch** -- stage updates are best-effort. If the entity service is temporarily slow, the pipeline should not crash just because it could not update progress. The pipeline's actual work (bot execution, image generation) is more important than status reporting.
- **Read-then-write** -- the method reads the current data with `get_dto()` before writing. This avoids accidentally overwriting fields set by earlier stages.

This pattern enables the status polling endpoint. The client calls `GET /api/story-status?entity_id=...` periodically and sees the stage progress:

```json
{ "stage": "safety_check" }
{ "stage": "writing" }
{ "stage": "generating_images", "images_generated": 2, "images_total": 5 }
{ "stage": "generating_images", "images_generated": 4, "images_total": 5 }
{ "stage": "completed", "pdf_wm_id": "abc-123", "image_count": 5 }
```

---

## Step 7: Bot Result Extraction -- the runBotEntity Pattern

This is the most important helper method in the bundle and addresses a common SDK gotcha.

```typescript
  private async runBotEntity<T>(entity: any): Promise<T> {
    const iterator = await entity.start();

    let result: any = undefined;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) {
        result = value;
        break;
      }
    }

    // Fallback: read from entity io.output
    if (result === undefined) {
      const io = await this.entity_client.get_node_io(entity.id!);
      result = (io as any)?.output;
    }

    if (result === undefined) {
      throw new Error(`Bot execution for ${entity.id} completed but no structured output found`);
    }

    return result as T;
  }
```

### Why Not `for await...of`?

You might expect to consume the iterator like this:

```typescript
// DO NOT DO THIS -- loses the return value!
let result;
for await (const value of iterator) {
  result = value;
}
// result is the LAST YIELDED value, NOT the return value
```

The problem is that `for await...of` discards the generator's **return value**. In JavaScript generators, `yield` produces intermediate values, and `return` produces the final value. The `for await...of` loop captures every `yield` but silently drops the `return`. Bot entities use `return` to deliver their structured output (the validated Zod result), so `for await...of` would lose it.

The correct approach is **manual iteration**:

```typescript
const { value, done } = await iterator.next();
if (done) {
  result = value;  // This IS the return value
  break;
}
```

When `done` is `true`, the `value` field contains the generator's return value -- the structured output from the bot.

### The Fallback

Even with manual iteration, there are edge cases where the return value might not propagate (e.g., if the entity was already completed from a previous run and the iterator returns a cached result in a different format). The fallback reads from the entity's IO output:

```typescript
if (result === undefined) {
  const io = await this.entity_client.get_node_io(entity.id!);
  result = (io as any)?.output;
}
```

The entity service persists the output of completed entities in the IO record. This is a reliable backup source.

### Usage

The `runBotEntity` helper is generic -- it works with any bot entity type:

```typescript
const safetyResult = await this.runBotEntity<ContentSafetyResult>(entity);
const storyResult = await this.runBotEntity<StoryResult>(entity);
```

The type parameter `<T>` types the return value, matching the Zod schema output defined in each bot.

---

## Step 8: Creating and Running Bot Entities

The `runSafetyCheck` and `runStoryWriter` methods show how to create child entities for bot execution:

```typescript
  private async runSafetyCheck(topic: string): Promise<ContentSafetyResult> {
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `safety-check-${Date.now()}`,
      specific_type_name: 'ContentSafetyCheckEntity',
      general_type_name: 'ContentSafetyCheckEntity',
      status: 'Pending',
      data: { topic },
    });

    logger.info('[Pipeline] Running content safety check', { entity_id: entity.id, topic });
    return this.runBotEntity<ContentSafetyResult>(entity);
  }

  private async runStoryWriter(topic: string): Promise<StoryResult> {
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `story-writer-${Date.now()}`,
      specific_type_name: 'StoryWriterEntity',
      general_type_name: 'StoryWriterEntity',
      status: 'Pending',
      data: { topic },
    });

    logger.info('[Pipeline] Running story writer', { entity_id: entity.id, topic });
    return this.runBotEntity<StoryResult>(entity);
  }
```

The pattern is:

1. **Create the entity** with `entity_factory.create_entity_node()`. The `specific_type_name` must exactly match the name registered in `StoryBundleConstructors` (and in the entity's `@EntityMixin` decorator). This is how the framework knows which class to instantiate.

2. **Pass data via the `data` field** -- the entity's `run_impl` (or `get_bot_request_args_impl` for bot entities) reads this data to build its input.

3. **Run it with `runBotEntity<T>()`** -- starts the entity, consumes the iterator, and extracts the structured return value.

Each entity is created with a unique name (using `Date.now()` as a suffix) and `status: 'Pending'`. The entity transitions to `InProgress` when `start()` is called and to `Completed` when the bot finishes.

---

## Step 9: The Server Entry Point

The `index.ts` file bootstraps the HTTP server:

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

### Understanding createStandaloneAgentBundle

`createStandaloneAgentBundle` does the following:

1. **Instantiates the bundle class** -- calls `new IllustratedStoryAgentBundle()`
2. **Calls `init()`** -- initializes service clients
3. **Scans for `@ApiEndpoint` decorators** -- finds all decorated methods on the bundle class and registers them as Express routes under `/api/`
4. **Registers built-in routes** -- adds `/health` for health checks and the standard invoke protocol routes
5. **Starts the HTTP server** -- listens on the specified port

The function takes the bundle class (not an instance) as the first argument, along with an options object. The `port` option defaults to 3000 if not specified.

### Signal Handling

The `SIGTERM` and `SIGINT` handlers ensure clean shutdown in containerized environments. Kubernetes sends `SIGTERM` when stopping a pod, and `SIGINT` is sent when pressing Ctrl+C during local development.

---

## Step 10: Build and Test

### Build

```bash
pnpm run build
```

### Local Testing

Start the server locally (with port-forwarding to platform services):

```bash
# In a separate terminal, set up port-forwarding
# (see Part 5 for full port-forwarding setup)

# Start the server
PORT=3000 node apps/story-bundle/dist/index.js
```

### Test the Create Story Endpoint

```bash
curl -X POST http://localhost:3000/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic": "a brave little robot who learns to paint"}'
```

Expected response:

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### Poll for Progress

```bash
curl "http://localhost:3000/api/story-status?entity_id=<entity-id>"
```

Immediately after creation:

```json
{
  "entity_id": "a1b2c3d4-...",
  "status": "Pending",
  "stage": "safety_check",
  "data": {
    "topic": "a brave little robot who learns to paint",
    "stage": "safety_check"
  }
}
```

During image generation:

```json
{
  "entity_id": "a1b2c3d4-...",
  "status": "Pending",
  "stage": "generating_images",
  "data": {
    "topic": "a brave little robot who learns to paint",
    "stage": "generating_images",
    "images_generated": 3,
    "images_total": 5,
    "safety_result": { "is_safe": true, "categories": [] },
    "story_result": {
      "title": "Rusty's Rainbow",
      "moral": "Creativity lives in everyone",
      "age_range": "4-8"
    }
  }
}
```

After completion:

```json
{
  "entity_id": "a1b2c3d4-...",
  "status": "Pending",
  "stage": "completed",
  "data": {
    "topic": "a brave little robot who learns to paint",
    "stage": "completed",
    "pdf_wm_id": "wm-xyz-789",
    "image_count": 5,
    "story_result": {
      "title": "Rusty's Rainbow",
      "moral": "Creativity lives in everyone",
      "age_range": "4-8"
    }
  }
}
```

### Test Content Rejection

```bash
curl -X POST http://localhost:3000/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic": "something inappropriate for children"}'
```

Poll the status -- it should show `stage: 'rejected'` with the safety result explaining why.

### Test Input Validation

```bash
# Missing topic
curl -X POST http://localhost:3000/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{}'

# Returns: { "error": "Topic is required" }

# Missing entity_id
curl "http://localhost:3000/api/story-status"

# Returns: { "error": "entity_id query parameter is required" }
```

### Verify Working Memory

After a story completes, use `ff-wm-read` to inspect the stored files:

```bash
# List working memory records for the story entity
ff-wm-read list --entity-id <entity-id>

# Download the PDF
ff-wm-read download <pdf-working-memory-id> --output ./story.pdf

# Download the HTML
ff-wm-read download <html-working-memory-id> --output ./story.html
```

---

## Complete File: agent-bundle.ts

For reference, here is the complete agent bundle file:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
  WorkingMemoryProvider,
} from "@firebrandanalytics/ff-agent-sdk";
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';
import { StoryBundleConstructors } from "./constructors.js";
import { ImageService } from "./services/image-service.js";
import type {
  CreateStoryRequest,
  CreateStoryResponse,
  StoryStatusResponse,
  StoryEntityData,
  ContentSafetyResult,
  StoryResult,
} from '@shared/types';

const APPLICATION_ID = process.env.FF_APPLICATION_ID || "e7a95bcc-7ef9-432e-9713-f040db078b14";
const AGENT_BUNDLE_ID = process.env.FF_AGENT_BUNDLE_ID || "3f78cd56-4ac4-4503-816d-01a0e61fd2cf";

export class IllustratedStoryAgentBundle extends FFAgentBundle<any> {
  private working_memory_provider!: WorkingMemoryProvider;
  private image_service!: ImageService;
  private doc_proc_client!: DocProcClient;

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

    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS
      || 'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);

    this.image_service = new ImageService();

    const DOC_PROC_URL = process.env.DOC_PROC_SERVICE_URL
      || 'http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:3000';
    this.doc_proc_client = DocProcClient.create({ baseUrl: DOC_PROC_URL });

    logger.info("IllustratedStory bundle initialized!");
  }

  @ApiEndpoint({ method: 'POST', route: 'create-story' })
  async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
    const { topic } = body;
    if (!topic?.trim()) {
      throw new Error('Topic is required');
    }

    logger.info('[API] Creating illustrated story', { topic });

    const storyEntity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `story-${Date.now()}`,
      specific_type_name: 'EntityNode',
      general_type_name: 'EntityNode',
      status: 'Pending',
      data: {
        topic,
        stage: 'created',
      } as StoryEntityData,
    });

    const entity_id = storyEntity.id!;

    // Run pipeline in background
    this.runPipeline(storyEntity, topic).catch(err => {
      logger.error('[Pipeline] Fatal error', { entity_id, error: err });
    });

    return { entity_id };
  }

  @ApiEndpoint({ method: 'GET', route: 'story-status' })
  async getStoryStatus(query: { entity_id?: string }): Promise<StoryStatusResponse> {
    const { entity_id } = query;
    if (!entity_id) {
      throw new Error('entity_id query parameter is required');
    }

    const dto = await this.entity_client.get_node(entity_id);
    if (!dto) {
      throw new Error(`Story ${entity_id} not found`);
    }

    const data = (dto as any).data || {};
    return {
      entity_id: dto.id!,
      status: dto.status!,
      stage: data.stage || 'unknown',
      data,
    };
  }

  private async runPipeline(storyEntity: any, topic: string): Promise<void> {
    const entityId = storyEntity.id!;

    try {
      // Step 1: Content safety check
      await this.updateStage(storyEntity, 'safety_check');
      const safetyResult = await this.runSafetyCheck(topic);

      if (!safetyResult.is_safe) {
        logger.warn('[Pipeline] Content rejected', { entityId, safetyResult });
        await this.updateStage(storyEntity, 'rejected', { safety_result: safetyResult });
        return;
      }

      await this.updateStage(storyEntity, 'safety_passed', { safety_result: safetyResult });

      // Step 2: Story writing
      await this.updateStage(storyEntity, 'writing');
      const storyResult = await this.runStoryWriter(topic);

      await this.updateStage(storyEntity, 'writing_complete', {
        story_result: {
          title: storyResult.title,
          moral: storyResult.moral,
          age_range: storyResult.age_range,
          html_content: '',
          image_prompts: storyResult.image_prompts,
        },
      });

      // Step 3: Image generation
      const imagePrompts = storyResult.image_prompts;
      await this.updateStage(storyEntity, 'generating_images', {
        images_total: imagePrompts.length,
        images_generated: 0,
      });

      const images = await this.image_service.generateAllImages(
        imagePrompts,
        async (generated, total) => {
          await this.updateStage(storyEntity, 'generating_images', {
            images_generated: generated,
            images_total: total,
          });
        },
      );

      // Step 4: Assemble HTML with embedded images
      await this.updateStage(storyEntity, 'assembling');
      const finalHtml = this.image_service.assembleHtml(storyResult.html_content, images);

      // Step 5: Convert to PDF
      await this.updateStage(storyEntity, 'creating_pdf');
      let pdfWmId: string | undefined;

      try {
        const pdfResponse = await this.doc_proc_client.htmlToPdf(
          Buffer.from(finalHtml, 'utf-8')
        );

        if (pdfResponse.success && pdfResponse.data) {
          const pdfBuffer = typeof pdfResponse.data === 'string'
            ? Buffer.from(pdfResponse.data, 'base64')
            : Buffer.from(pdfResponse.data);

          const wmResult = await this.working_memory_provider.add_memory_from_buffer({
            entityNodeId: entityId,
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
          entityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Step 6: Store final HTML in working memory
      try {
        await this.working_memory_provider.add_memory_from_buffer({
          entityNodeId: entityId,
          name: `${storyResult.title || 'story'}.html`,
          description: `Illustrated storybook HTML: ${storyResult.title}`,
          contentType: 'text/html',
          memoryType: 'file',
          buffer: Buffer.from(finalHtml, 'utf-8'),
          metadata: {
            title: storyResult.title,
            image_count: images.length,
          },
        });
      } catch (err) {
        logger.warn('[Pipeline] HTML storage failed', { entityId, error: err });
      }

      // Done!
      await this.updateStage(storyEntity, 'completed', {
        pdf_wm_id: pdfWmId,
        story_result: {
          title: storyResult.title,
          moral: storyResult.moral,
          age_range: storyResult.age_range,
          html_content: '',
          image_prompts: storyResult.image_prompts,
        },
        image_count: images.length,
      });

    } catch (err) {
      await this.updateStage(storyEntity, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Execute a bot entity and extract the structured output.
   * Uses manual iteration to capture the return value (done=true),
   * with fallback to the entity's io.output field.
   */
  private async runBotEntity<T>(entity: any): Promise<T> {
    const iterator = await entity.start();

    let result: any = undefined;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) {
        result = value;
        break;
      }
    }

    // Fallback: read from entity io.output
    if (result === undefined) {
      const io = await this.entity_client.get_node_io(entity.id!);
      result = (io as any)?.output;
    }

    if (result === undefined) {
      throw new Error(`Bot execution for ${entity.id} completed but no structured output found`);
    }

    return result as T;
  }

  private async runSafetyCheck(topic: string): Promise<ContentSafetyResult> {
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `safety-check-${Date.now()}`,
      specific_type_name: 'ContentSafetyCheckEntity',
      general_type_name: 'ContentSafetyCheckEntity',
      status: 'Pending',
      data: { topic },
    });

    logger.info('[Pipeline] Running content safety check', { entity_id: entity.id, topic });
    return this.runBotEntity<ContentSafetyResult>(entity);
  }

  private async runStoryWriter(topic: string): Promise<StoryResult> {
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `story-writer-${Date.now()}`,
      specific_type_name: 'StoryWriterEntity',
      general_type_name: 'StoryWriterEntity',
      status: 'Pending',
      data: { topic },
    });

    logger.info('[Pipeline] Running story writer', { entity_id: entity.id, topic });
    return this.runBotEntity<StoryResult>(entity);
  }

  private async updateStage(
    entity: any,
    stage: string,
    additionalData: Partial<StoryEntityData> = {},
  ): Promise<void> {
    try {
      const dto = await entity.get_dto();
      const currentData = dto.data || {};
      const newData = { ...currentData, stage, ...additionalData };
      await entity.update_data(newData);
      logger.info('[Pipeline] Stage updated', { entityId: entity.id, stage });
    } catch (err) {
      logger.warn('[Pipeline] Failed to update stage', {
        entityId: entity.id, stage, error: err,
      });
    }
  }
}
```

---

## What You've Built

You now have:
- An `IllustratedStoryAgentBundle` that extends `FFAgentBundle` with proper constructor arguments and service client initialization
- Two API endpoints: `POST /api/create-story` and `GET /api/story-status`
- A six-stage background pipeline that coordinates content safety, story writing, image generation, HTML assembly, PDF conversion, and working memory storage
- A `runBotEntity<T>()` helper that correctly extracts structured output from bot entities using manual iteration
- Entity state management via `updateStage()` for client-side progress polling
- Graceful error handling that lets the pipeline continue when non-critical steps fail
- An `index.ts` entry point using `createStandaloneAgentBundle` to wire everything up

---

## Key Takeaways

1. **`FFAgentBundle` constructor takes three arguments** -- bundle descriptor, constructor map, and entity client. The entity client is created with `createEntityClient(APPLICATION_ID)` which scopes all entity operations to your application.

2. **Override `init()` for async initialization** -- service clients that need async setup go in `init()`, not the constructor. Always call `super.init()` first. The definite assignment assertion (`!`) on private fields signals that initialization happens in `init()`.

3. **`@ApiEndpoint` registers HTTP routes automatically** -- `{ method: 'POST', route: 'create-story' }` becomes `POST /api/create-story`. POST methods receive the parsed JSON body; GET methods receive the parsed query parameters.

4. **Background pipelines return immediately** -- call `this.runPipeline().catch(...)` without `await` to fire-and-forget. Return the entity ID so clients can poll for progress. This keeps API response times fast regardless of pipeline duration.

5. **Use manual iteration for bot result extraction** -- `for await...of` loses the generator's return value. Use `iterator.next()` in a loop and check `done === true` to capture the structured output. Fall back to `entity_client.get_node_io()` if the return value is undefined.

6. **`specific_type_name` must match the constructor map** -- when creating entities with `entity_factory.create_entity_node()`, the `specific_type_name` must exactly match the key in your constructors map and the `@EntityMixin` decorator. This is how the framework knows which class to instantiate.

7. **Keep entity data lightweight** -- store large outputs (HTML with base64 images, PDFs) in working memory via `WorkingMemoryProvider.add_memory_from_buffer()`. Store only the working memory ID in entity data.

8. **Wrap non-critical steps in try/catch** -- PDF generation and working memory storage are nice-to-haves. If they fail, log a warning and continue. The outer try/catch handles truly fatal errors.

9. **`createStandaloneAgentBundle` bootstraps everything** -- pass it your bundle class and a port. It handles instantiation, `init()`, route registration, and HTTP server startup.

---

## Next Steps

In [Part 5: Testing & Deployment](./part-05-testing-and-deployment.md), you'll configure the Dockerfile, Helm values, and environment variables for production deployment. You'll run the full pipeline end-to-end using port-forwarding for local testing, verify results with `ff-sdk-cli`, `ff-eg-read`, and `ff-wm-read`, then deploy to the cluster with `ff ops build` and `ff ops deploy`.
