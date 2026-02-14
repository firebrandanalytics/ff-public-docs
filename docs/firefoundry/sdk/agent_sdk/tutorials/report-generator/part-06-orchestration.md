# Part 6: Workflow Orchestration

In this part, you'll replace the placeholder HTML generation from Part 5 with a proper multi-entity orchestration pattern. You'll create a parent `ReportEntity` that delegates AI-powered HTML generation to a child `ReportGenerationEntity`, using the `appendOrRetrieveCall` and `yield*` patterns to coordinate work and stream progress across entity boundaries.

**What you'll learn:**
- Using `appendOrRetrieveCall` to create and retrieve child entities idempotently
- Delegating execution to child entities with `yield* await childEntity.start()`
- How `yield*` propagates child entity progress events to the parent's iterator
- Building a 3-stage orchestrator: extract text, generate HTML (via child), convert to PDF
- Inspecting parent-child entity relationships in the entity graph

**What you'll build:** A `ReportEntity` orchestrator that coordinates three stages using child entity delegation, plus a `ReportGenerationEntity` that wraps the AI-powered `ReportGenerationBot` from Part 2.

**Starting point:** Completed code from [Part 5: Document Processing Pipeline](./part-05-doc-processing.md). You should have a working document processing pipeline with text extraction and PDF conversion.

---

## The Orchestrator Pattern

Before writing code, let's understand the pattern. In FireFoundry, workflow orchestration uses a parent-child entity relationship:

```
ReportEntity (orchestrator)
    |
    |-- Stage 1: Extract text (direct doc-proc call)
    |
    |-- Stage 2: Create/retrieve ReportGenerationEntity
    |            |
    |            +-- ReportGenerationBot runs LLM
    |            |
    |            +-- Returns { reasoning, html_content }
    |
    |-- Stage 3: Convert HTML to PDF (direct doc-proc call)
    |
    +-- Returns { pdf_working_memory_id, reasoning, html_content }
```

The orchestrator (parent) does not contain AI logic itself. Instead, it coordinates the workflow and delegates the AI step to a child entity. This separation gives you:

- **Single responsibility** -- each entity does one thing well
- **Resumability** -- if the pipeline crashes after Stage 2, the child entity's result is already persisted; `appendOrRetrieveCall` retrieves it instead of re-creating it
- **Reusability** -- `ReportGenerationEntity` can be used independently or by different orchestrators
- **Visibility** -- the entity graph shows exactly which entities were involved and their relationships

---

## Step 1: Create the ReportGenerationEntity

This entity wraps the `ReportGenerationBot` (from Part 2) and makes it available as a callable child entity. It uses two mixins:

- `BotRunnableEntityMixin` -- connects the entity to a bot so that `start()` runs the bot
- `FeedbackRunnableEntityMixin` -- enables revision cycles (used in Part 8)

**`apps/report-bundle/src/entities/ReportGenerationEntity.ts`**:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityFactory,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  EntityTypeHelper,
  BotRequestArgs,
  Context,
  FeedbackRunnableEntityMixin,
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { REPORT_BTH, ReportGenerationBot } from '../bots/ReportGenerationBot.js';
import { REPORT_OUTPUT } from '../schemas.js';
import { ReportBundleConstructors } from '../constructors.js';

/**
 * Data stored in the ReportGenerationEntity.
 * This is set by the parent orchestrator via appendOrRetrieveCall.
 */
interface ReportGenerationEntityDTOData {
  plain_text: string;                          // Extracted document text
  orientation: 'portrait' | 'landscape';       // Page layout
  user_prompt: string;                          // User's instructions
  html_content?: string;                        // Populated after generation
  ai_reasoning?: string;                        // Populated after generation
  created_at?: string;
  [key: string]: any;
}

type ReportGenerationEntityDTO = EntityInstanceNodeDTO<ReportGenerationEntityDTOData> & {
  node_type: "ReportGenerationEntity";
};

type ReportGenerationEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<REPORT_BTH, typeof ReportBundleConstructors>,
  ReportGenerationEntityDTO,
  'ReportGenerationEntity',
  {},
  {}
>;

type ReportGenerationEntityRETH = RunnableEntityTypeHelper<
  ReportGenerationEntityENH,
  REPORT_OUTPUT
>;

/**
 * Entity that wraps the ReportGenerationBot.
 *
 * Uses the mixin composition pattern:
 * - RunnableEntity: provides run_impl / start() lifecycle
 * - BotRunnableEntityMixin: connects a bot instance to this entity
 * - FeedbackRunnableEntityMixin: enables feedback/revision cycles
 *
 * When start() is called, BotRunnableEntityMixin automatically:
 * 1. Calls get_bot_request_args_impl() to build the bot's input
 * 2. Runs the bot (which calls the LLM)
 * 3. Returns the bot's structured output as the entity's result
 */
@EntityMixin({
  specificType: 'ReportGenerationEntity',
  generalType: 'ReportGenerationEntity',
  allowedConnections: {}
})
export class ReportGenerationEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[
  RunnableEntity<ReportGenerationEntityRETH>,
  BotRunnableEntityMixin<ReportGenerationEntityRETH>,
  FeedbackRunnableEntityMixin<ReportGenerationEntityRETH, string>
]> {
  constructor(
    factory: EntityFactory<ReportGenerationEntityENH['eth']>,
    idOrDto: UUID | ReportGenerationEntityDTO
  ) {
    super(
      [factory, idOrDto],              // RunnableEntity args
      [new ReportGenerationBot()],     // BotRunnableEntityMixin - bot instance
      []                               // FeedbackRunnableEntityMixin - no config needed
    );
  }

  /**
   * Prepare bot request arguments from entity data.
   *
   * This method bridges the entity's stored data to the bot's
   * expected input format. The BotRunnableEntityMixin calls this
   * automatically before running the bot.
   */
  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<ReportGenerationEntityRETH['enh']['eth']['bth']>>
  ): Promise<BotRequestArgs<ReportGenerationEntityRETH['enh']['eth']['bth']>> {
    const dto = await this.get_dto();
    const data = dto.data;

    logger.info('[ReportGenerationEntity] Preparing bot request', {
      entity_id: this.id,
      orientation: data.orientation,
      text_length: data.plain_text.length
    });

    return {
      input: data.user_prompt,       // The user's instructions become the bot's input
      context: new Context(),
      args: {
        plain_text: data.plain_text,       // Document text for the prompt
        orientation: data.orientation       // Layout info for the prompt
      }
    };
  }
}
```

### Understanding the Mixin Constructor Pattern

The `AddMixins` pattern uses positional arrays for each mixin's constructor arguments:

```typescript
super(
  [factory, idOrDto],              // Arg array for RunnableEntity
  [new ReportGenerationBot()],     // Arg array for BotRunnableEntityMixin
  []                               // Arg array for FeedbackRunnableEntityMixin
);
```

Each array is spread into the corresponding mixin's constructor. The order matches the order of mixins in `AddMixins(RunnableEntity, BotRunnableEntityMixin, FeedbackRunnableEntityMixin)`.

---

## Step 2: Update the ReportEntity Orchestrator

Now update the `ReportEntity` from Part 5 to use child entity delegation for Stage 2 instead of the placeholder `generate_simple_html` method.

**`apps/report-bundle/src/entities/ReportEntity.ts`** (updated imports and types):

```typescript
import {
  RunnableEntity,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  EntityFactory,
  WorkingMemoryProvider,
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';
import { ReportGenerationEntity } from './ReportGenerationEntity.js';

interface ReportEntityDTOData {
  prompt: string;
  orientation: 'portrait' | 'landscape';
  original_document_wm_id?: string;
  original_filename?: string;
  extracted_text_wm_id?: string;
  pdf_working_memory_id?: string;
  [key: string]: any;
}
```

**Updated `allowedConnections`**:

```typescript
@EntityMixin({
  specificType: 'ReportEntity',
  generalType: 'ReportEntity',
  allowedConnections: {
    'Calls': ['ReportGenerationEntity']   // Declare this entity can call ReportGenerationEntity
  }
})
```

The `allowedConnections` declaration tells the entity graph which entity types this orchestrator is allowed to create as children. The `'Calls'` edge type is the standard edge for parent-child orchestration relationships.

**Updated `run_impl` with child entity delegation**:

```typescript
type REPORT_WORKFLOW_OUTPUT = {
  pdf_working_memory_id: string;
  reasoning: string;
  html_content: string;
};

// ... (inside the ReportEntity class)

protected override async *run_impl(): AsyncGenerator<any, REPORT_WORKFLOW_OUTPUT, never> {
  const startTime = Date.now();
  const dto = await this.get_dto();
  const { prompt, orientation, original_document_wm_id } = dto.data;
  // Feedback context is stored in the config column by ReviewableEntity (Part 8)
  const config = (dto as any).config || {};

  if (!original_document_wm_id) {
    throw new Error('No document uploaded - original_document_wm_id is missing');
  }

  yield {
    type: "INTERNAL_UPDATE",
    message: "Starting report generation workflow",
    metadata: {
      stage: "workflow_start",
      entity_id: this.id,
      orientation,
      prompt_length: prompt.length
    }
  };

  try {
    // -- Stage 1: Extract text from document --
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 1/3: Extracting text from document",
      metadata: { stage: "text_extraction", working_memory_id: original_document_wm_id }
    };

    const extractedText = await this.extract_document_text(original_document_wm_id);

    yield {
      type: "INTERNAL_UPDATE",
      message: `Text extraction complete (${extractedText.length} characters)`,
      metadata: {
        stage: "text_extraction_complete",
        text_length: extractedText.length,
        word_count: extractedText.split(/\s+/).length
      }
    };

    // -- Stage 2: Generate HTML using AI (via child entity) --
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 2/3: Generating HTML report with AI",
      metadata: { stage: "ai_generation" }
    };

    // Create (or retrieve) a child ReportGenerationEntity.
    // appendOrRetrieveCall is idempotent: if called again with the
    // same key ("ai_html_generation"), it returns the existing entity
    // rather than creating a duplicate.
    const reportGenEntity = await this.appendOrRetrieveCall(
      ReportGenerationEntity,
      'ai_html_generation',   // Idempotency key (unique within this parent)
      {
        plain_text: extractedText,
        orientation: orientation,
        user_prompt: prompt
      }
    );

    logger.info('[ReportEntity] Created/retrieved ReportGenerationEntity', {
      entity_id: reportGenEntity.id
    });

    // Delegate execution to the child entity.
    // yield* forwards ALL of the child entity's yielded events
    // (INTERNAL_UPDATEs, STATUS changes, etc.) to this entity's
    // iterator. The caller sees a single continuous stream.
    const aiResult = yield* await reportGenEntity.start();

    logger.info('[ReportEntity] HTML generation complete', {
      html_length: aiResult.html_content.length,
      reasoning_length: aiResult.reasoning.length
    });

    yield {
      type: "INTERNAL_UPDATE",
      message: `HTML generation complete (${aiResult.html_content.length} characters)`,
      metadata: {
        stage: "ai_generation_complete",
        html_length: aiResult.html_content.length,
        reasoning_length: aiResult.reasoning.length
      }
    };

    // -- Stage 3: Convert HTML to PDF --
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 3/3: Converting HTML to PDF",
      metadata: { stage: "pdf_conversion" }
    };

    const pdfWorkingMemoryId = await this.convert_to_pdf(
      aiResult.html_content,
      orientation
    );

    const processingTime = Date.now() - startTime;

    yield {
      type: "INTERNAL_UPDATE",
      message: "Report generation complete",
      metadata: {
        stage: "workflow_complete",
        pdf_working_memory_id: pdfWorkingMemoryId,
        processing_time_ms: processingTime
      }
    };

    return {
      pdf_working_memory_id: pdfWorkingMemoryId,
      reasoning: aiResult.reasoning,
      html_content: aiResult.html_content
    };

  } catch (error) {
    logger.error('[ReportEntity] Workflow failed', { entity_id: this.id, error });

    yield {
      type: "INTERNAL_UPDATE",
      message: `Workflow failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: {
        stage: "workflow_failed",
        error: error instanceof Error ? error.message : String(error)
      }
    };

    throw error;
  }
}
```

You can now remove the `generate_simple_html` placeholder method from Part 5. It has been replaced by the child entity delegation.

---

## Step 3: Understanding `appendOrRetrieveCall`

This is one of the most important methods in the orchestration toolkit. Let's break it down:

```typescript
const childEntity = await this.appendOrRetrieveCall(
  ReportGenerationEntity,    // Entity class to instantiate
  'ai_html_generation',      // Idempotency key
  {                           // Data to store in the child entity
    plain_text: extractedText,
    orientation: orientation,
    user_prompt: prompt
  }
);
```

### What happens internally

1. **First call** (entity does not exist):
   - Creates a new `ReportGenerationEntity` instance in the entity graph
   - Stores the provided data in the child entity's `data` field
   - Creates a `Calls` edge from the parent to the child
   - Returns the new entity instance

2. **Subsequent calls** (entity already exists):
   - Looks up the child entity by the idempotency key `'ai_html_generation'`
   - Returns the **existing** entity instance (does not create a duplicate)
   - The data argument is ignored on retrieval

### Why idempotency matters

Consider what happens if the orchestrator crashes after creating the child entity but before processing its result:

```
1. appendOrRetrieveCall creates child entity     [persisted]
2. child entity runs bot and produces result      [persisted]
3. CRASH before parent reads result
4. Parent entity restarts, run_impl called again
5. appendOrRetrieveCall retrieves EXISTING child  [no duplicate]
6. child entity start() returns cached result     [no re-run]
7. Parent continues with Stage 3
```

The idempotency key must be unique within the parent entity. Use descriptive names that reflect the step's purpose (e.g., `'ai_html_generation'`, `'compliance_check'`, `'formatting_step'`).

---

## Step 4: Understanding `yield*` Delegation

The `yield*` operator is standard JavaScript, but its use with async generators in FireFoundry is particularly powerful.

```typescript
const aiResult = yield* await reportGenEntity.start();
```

This single line does three things:

1. **`await reportGenEntity.start()`** -- starts the child entity's `run_impl` and returns its async generator
2. **`yield*`** -- delegates to the child's generator, forwarding every `yield` from the child to the parent's caller
3. **`const aiResult =`** -- captures the child's `return` value when its generator completes

### What the caller sees

Without `yield*`, the parent's iterator would only show the parent's own yields. With `yield*`, the caller sees a merged stream:

```
[INTERNAL_UPDATE] Stage 1/3: Extracting text from document       <-- parent yield
[INTERNAL_UPDATE] Text extraction complete (12847 characters)     <-- parent yield
[INTERNAL_UPDATE] Stage 2/3: Generating HTML report with AI      <-- parent yield
[STATUS]          ReportGenerationEntity STARTED                  <-- child yield (via yield*)
[INTERNAL_UPDATE] Preparing LLM request...                        <-- child yield (via yield*)
[INTERNAL_UPDATE] LLM response received                           <-- child yield (via yield*)
[STATUS]          ReportGenerationEntity COMPLETED                <-- child yield (via yield*)
[INTERNAL_UPDATE] HTML generation complete (8234 characters)      <-- parent yield
[INTERNAL_UPDATE] Stage 3/3: Converting HTML to PDF               <-- parent yield
[INTERNAL_UPDATE] Report generation complete                      <-- parent yield
[VALUE]           { pdf_working_memory_id: "...", ... }           <-- parent return
```

The client receives a single, continuous stream of events from the entire entity tree. This is the foundation for building deep orchestration hierarchies (orchestrators calling orchestrators) while maintaining a coherent progress stream.

### Visual: With vs. Without `yield*`

```
WITHOUT yield* (manual iteration):
  Parent yields:  [1] [2] [3] ... [final]
  Child yields:         (hidden)

WITH yield* (delegation):
  Parent yields:  [1] [2] [child-1] [child-2] [child-final] [3] ... [final]
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            Child events forwarded transparently
```

---

## Step 5: Register Both Entities

Update the constructor map to include both entities.

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { ReportEntity } from './entities/ReportEntity.js';
import { ReportGenerationEntity } from './entities/ReportGenerationEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  ReportEntity: ReportEntity,
  ReportGenerationEntity: ReportGenerationEntity,
} as const;
```

Both entities must be registered, even though `ReportGenerationEntity` is only created internally by `ReportEntity`. The framework needs the constructor map entry to instantiate the child entity from its persisted state.

---

## Step 6: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

---

## Step 7: Test with ff-sdk-cli

### 7.1 Run the Full Pipeline

Create a ReportEntity and run it just like Part 5. The only difference is that Stage 2 now uses AI:

```bash
# Create the entity
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportEntity",
    "data": {
      "prompt": "Create a professional executive summary highlighting key metrics and recommendations",
      "orientation": "portrait",
      "original_document_wm_id": "<your-working-memory-id>",
      "original_filename": "quarterly-report.pdf"
    }
  }' \
  --url http://localhost:3001
```

```bash
# Run the pipeline with streaming
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

Watch for the child entity events appearing in the stream between Stage 2 start and completion. These are the `yield*` forwarded events from `ReportGenerationEntity`.

### 7.2 Inspect Entity Relationships

After the pipeline completes, use `ff-eg-read` to examine the parent-child relationship:

```bash
# View the parent entity
ff-eg-read node get <parent-entity-id>

# List edges from the parent entity
ff-eg-read edges list <parent-entity-id>
```

You should see a `Calls` edge from the `ReportEntity` to the `ReportGenerationEntity`. This edge was created automatically by `appendOrRetrieveCall`.

```json
{
  "edges": [
    {
      "edge_type": "Calls",
      "source_id": "<report-entity-id>",
      "target_id": "<report-generation-entity-id>",
      "metadata": {
        "call_key": "ai_html_generation"
      }
    }
  ]
}
```

### 7.3 Inspect the Child Entity

View the child entity to see its stored data and result:

```bash
ff-eg-read node get <report-generation-entity-id>
```

The child entity's data will contain:
- `plain_text` -- the extracted document text passed by the parent
- `orientation` -- the page layout setting
- `user_prompt` -- the user's instructions
- Status information showing it completed successfully

### 7.4 Test Idempotency

Run the parent entity again with `start`. Because the child entity already exists and completed, `appendOrRetrieveCall` retrieves it instead of creating a new one, and `start()` returns the cached result immediately:

```bash
# Re-run the same entity
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

Stage 2 should complete almost instantly because the child entity's result is already persisted.

### 7.5 Verify with ff-telemetry-read

Check the LLM call that was made during Stage 2:

```bash
ff-telemetry-read calls list --entity-id <report-generation-entity-id>
```

This shows the broker request made by `ReportGenerationBot`, including the prompt that was sent and the LLM's response.

---

## What You've Built

You now have a multi-entity orchestration pipeline:

```
ReportEntity (orchestrator)
    |
    |-- [Stage 1] extractGeneral() --> Working Memory (extracted text)
    |
    |-- [Stage 2] appendOrRetrieveCall(ReportGenerationEntity)
    |                  |
    |                  +-- ReportGenerationBot (LLM call)
    |                  |
    |                  +-- Returns { reasoning, html_content }
    |
    |-- [Stage 3] htmlToPdf() --> Working Memory (final PDF)
    |
    +-- Returns { pdf_working_memory_id, reasoning, html_content }
```

- **Parent entity** (`ReportEntity`) orchestrates the workflow without containing AI logic
- **Child entity** (`ReportGenerationEntity`) encapsulates the AI step with full persistence
- **`appendOrRetrieveCall`** provides idempotent child creation for crash recovery
- **`yield*`** provides transparent progress streaming across entity boundaries
- **Entity graph** records the relationships for inspection and debugging

---

## Key Takeaways

1. **`appendOrRetrieveCall` is idempotent** -- it creates a child entity on first call and retrieves the existing one on subsequent calls. The idempotency key must be unique within the parent. This is what makes workflows resumable after crashes.

2. **`yield*` delegates the entire generator** -- all `yield` events from the child entity flow through to the parent's caller. The caller sees a single, continuous stream of events from the entire entity tree.

3. **The orchestrator pattern separates coordination from execution** -- the parent entity manages workflow logic (what steps to run, in what order, with what data), while child entities encapsulate the actual work (AI calls, transformations, etc.).

4. **`allowedConnections` declares the relationship** -- setting `'Calls': ['ReportGenerationEntity']` in the `@EntityMixin` decorator tells the entity graph which child types this entity can create. This is enforced at runtime.

5. **Both entities must be in the constructor map** -- even internally-created entities need to be registered so the framework can instantiate them from persisted state.

6. **Entity graph edges are your debugging tool** -- `ff-eg-read edges list` shows which entities called which, with the idempotency key in the edge metadata. This is invaluable for understanding complex workflows.

---

## Next Steps

In [Part 7: Structured Output & Validation](./part-07-structured-output.md), we'll look inside the `ReportGenerationBot` to understand how `StructuredOutputBotMixin` and `withSchemaMetadata` work together to get reliable, validated JSON output from the LLM. You'll learn how Zod schema descriptions become part of the prompt and how the mixin handles validation and error recovery.
