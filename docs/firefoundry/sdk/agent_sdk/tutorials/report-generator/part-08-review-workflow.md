# Part 8: Human-in-the-Loop Review

In this part, you'll add a human review step to the report generation pipeline. Instead of blindly producing a final PDF, the system will pause after generating the report and wait for a human to approve the result or request changes. If changes are requested, the LLM will automatically revise its output using the reviewer's feedback.

**What you'll learn:**
- Wrapping an entity in a `ReviewableEntity` for approve/reject/revise cycles
- Configuring `wrappedEntityClass`, `reviewPrompt`, and `createResultEntity`
- How `ReviewableEntity` automatically creates `ReviewStep` entities
- Adding `FeedbackBotMixin` to a bot so it can incorporate reviewer feedback
- Adding `FeedbackRunnableEntityMixin` to an entity to auto-inject feedback context
- How `_ff_feedback`, `_ff_previous_result`, and `_ff_version` flow through the chain

**What you'll build:** A `ReportReviewWorkflowEntity` that wraps the existing `ReportEntity`, pauses for human review, and supports feedback-driven revision cycles.

## Key Concepts

Before writing code, understand how the review system works.

### ReviewableEntity

`ReviewableEntity` is a built-in SDK entity that implements the review loop pattern. It:

1. Runs a **wrapped entity** (your `ReportEntity`) to produce a result
2. Creates a **ReviewStep** entity that pauses execution and waits for human input
3. If the human **approves**, the workflow completes with the result
4. If the human provides **feedback**, the workflow increments the version, stores the feedback in the wrapped entity's config column, and re-runs from step 1

Each iteration creates a new named node (`wrapped_0`, `wrapped_1`, etc.) for idempotency -- completed nodes will not re-run if the workflow is restarted.

### FeedbackBotMixin and FeedbackRunnableEntityMixin

For the revision cycle to work, the LLM needs to know what the reviewer said. Two mixins handle this:

- **`FeedbackBotMixin`** adds a conditional feedback prompt to the bot. When `_ff_feedback` is present, it automatically injects a "Please address the following user feedback" section into the LLM prompt, along with the previous result as an assistant message for context.
- **`FeedbackRunnableEntityMixin`** auto-injects feedback fields from the entity's **config column** into the bot request args during the `get_bot_request_args_pre()` hook. This keeps system metadata separate from user data.

### FeedbackRequestArgs and the Config Column

The `FeedbackRequestArgs<T>` interface defines three special fields that flow through the review chain:

```typescript
interface FeedbackRequestArgs<FeedbackType> {
  _ff_feedback?: FeedbackType;        // The reviewer's feedback
  _ff_previous_result?: any;          // The result from the previous iteration
  _ff_version?: number;               // Current iteration number (0, 1, 2, ...)
}
```

**These fields are stored in the entity's `config` column, not the `data` column.** This is an important design decision -- it keeps system metadata (feedback state, version tracking) cleanly separated from user-facing entity data (prompt, orientation, document IDs).

`ReviewableEntity` writes feedback to the wrapped entity's config via `update_config()`. `FeedbackRunnableEntityMixin` reads from config and injects the fields into bot request args. Your entity data interfaces do NOT need to extend `FeedbackRequestArgs`.

## Step 1: Update ReportEntity to Accept Feedback

The `ReportEntity` orchestrator needs to pass feedback context down to `ReportGenerationEntity`. Update the data interface and the `run_impl` method.

**`apps/report-bundle/src/entities/ReportEntity.ts`** -- update the data interface:

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

/**
 * Data stored in the ReportEntity.
 * Note: feedback fields (_ff_feedback, etc.) are NOT in data --
 * they are stored in the config column by ReviewableEntity.
 */
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

In `run_impl`, read user data from `dto.data` and feedback context from the config column:

```typescript
protected override async *run_impl(): AsyncGenerator<any, REPORT_WORKFLOW_OUTPUT, never> {
  const dto = await this.get_dto();
  const { prompt, orientation, original_document_wm_id } = dto.data;
  // Feedback context is stored in config column by ReviewableEntity
  const config = (dto as any).config || {};

  // ... (stages 1 and 3 remain the same) ...

  // Stage 2: Generate HTML via child entity
  const reportGenEntity = await this.appendOrRetrieveCall(
    ReportGenerationEntity,
    `ai_html_generation`,
    {
      plain_text: extractedText,
      orientation: orientation,
      user_prompt: prompt
    }
  );

  // Propagate feedback context from our config to child entity's config
  // FeedbackRunnableEntityMixin on ReportGenerationEntity reads from config
  if (config._ff_feedback !== undefined || config._ff_version !== undefined) {
    try {
      await reportGenEntity.update_config({
        _ff_feedback: config._ff_feedback,
        _ff_previous_result: config._ff_previous_result,
        _ff_version: config._ff_version
      });
    } catch (err) {
      logger.warn('[ReportEntity] Config propagation failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const aiResult = yield* await reportGenEntity.start();
  // ... rest of workflow ...
}
```

The key change is propagating feedback from the config column to the child entity's config. `ReviewableEntity` stores feedback in this entity's config. This entity reads it and forwards it to `ReportGenerationEntity`'s config via `update_config()`. On the first run, the config has no feedback fields and the propagation is skipped. On revision runs, the feedback flows through to the child entity where `FeedbackRunnableEntityMixin` picks it up.

## Step 2: Add FeedbackRunnableEntityMixin to ReportGenerationEntity

Update `ReportGenerationEntity` to use `FeedbackRunnableEntityMixin`. This mixin automatically reads feedback fields from the entity's config column and injects them into the bot request args via the `get_bot_request_args_pre()` hook.

**`apps/report-bundle/src/entities/ReportGenerationEntity.ts`**:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityFactory,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  logger,
  EntityTypeHelper,
  BotRequestArgs,
  Context,
  FeedbackRunnableEntityMixin
} from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { REPORT_BTH, ReportGenerationBot } from '../bots/ReportGenerationBot.js';
import { REPORT_OUTPUT } from '../schemas.js';
import { ReportBundleConstructors } from '../constructors.js';

/**
 * Data stored in the ReportGenerationEntity.
 * Feedback fields are NOT in data -- FeedbackRunnableEntityMixin
 * reads them from the config column automatically.
 */
interface ReportGenerationEntityDTOData {
  plain_text: string;
  orientation: 'portrait' | 'landscape';
  user_prompt: string;
  html_content?: string;
  ai_reasoning?: string;
  created_at?: string;
  [key: string]: any;
}

// ... type helpers remain the same ...

@EntityMixin({
  specificType: 'ReportGenerationEntity',
  generalType: 'ReportGenerationEntity',
  allowedConnections: {}
})
export class ReportGenerationEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin       // NEW: adds feedback injection
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

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<ReportGenerationEntityRETH['enh']['eth']['bth']>>
  ): Promise<BotRequestArgs<ReportGenerationEntityRETH['enh']['eth']['bth']>> {
    const dto = await this.get_dto();
    const data = dto.data;

    return {
      input: data.user_prompt,
      context: new Context(),
      // Feedback fields (_ff_feedback, _ff_previous_result, _ff_version) are
      // auto-injected by FeedbackRunnableEntityMixin from config column via _preArgs
      args: {
        ..._preArgs.args,
        plain_text: data.plain_text,
        orientation: data.orientation
      }
    };
  }
}
```

Notice that `get_bot_request_args_impl` does not manually set feedback fields. Instead, it spreads `_preArgs.args` which contains any feedback fields already injected by `FeedbackRunnableEntityMixin` in its `get_bot_request_args_pre()` hook. The mixin reads `_ff_feedback`, `_ff_previous_result`, and `_ff_version` from the entity's config column (set by the parent via `update_config()`) and merges them into the pre-args. Your `_impl` method just spreads them through.

## Step 3: Add FeedbackBotMixin to ReportGenerationBot

Update the bot to include `FeedbackBotMixin`. This adds conditional prompt sections that only render when feedback is present.

**`apps/report-bundle/src/bots/ReportGenerationBot.ts`**:

```typescript
import {
  MixinBot,
  MixinBotConfig,
  StructuredOutputBotMixin,
  BotTypeHelper,
  PromptTypeHelper,
  BotTryRequest,
  StructuredPromptGroup,
  PromptGroup,
  PromptInputText,
  FeedbackBotMixin,
  FeedbackRequestArgs,
  RegisterBot
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import { ReportGenerationPrompt } from '../prompts/ReportGenerationPrompt.js';
import { ReportOutputSchema, REPORT_OUTPUT } from '../schemas.js';

type REPORT_PROMPT_INPUT = string;

type REPORT_PROMPT_ARGS = {
  static: {};
  request: {
    plain_text: string;
    orientation: 'portrait' | 'landscape';
  } & FeedbackRequestArgs<string>;    // Include feedback fields in type
};

export type REPORT_PTH = PromptTypeHelper<REPORT_PROMPT_INPUT, REPORT_PROMPT_ARGS>;
export type REPORT_BTH = BotTypeHelper<REPORT_PTH, REPORT_OUTPUT>;

@RegisterBot('ReportGenerationBot')
export class ReportGenerationBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin                    // NEW: adds feedback prompt
)<[
  MixinBot<REPORT_BTH, [
    StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>,
    FeedbackBotMixin<REPORT_BTH>
  ]>,
  [
    StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>,
    FeedbackBotMixin<REPORT_BTH>
  ]
]> {
  constructor() {
    const promptGroup = new StructuredPromptGroup<REPORT_PTH>({
      base: new PromptGroup([
        {
          name: "report_generation_system",
          prompt: new ReportGenerationPrompt('system', {}) as any
        }
      ]),
      input: new PromptGroup([
        {
          name: "user_input",
          prompt: new PromptInputText({})
        }
      ]),
    });

    const config: MixinBotConfig<REPORT_BTH> = {
      name: "ReportGenerationBot",
      base_prompt_group: promptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {}
    };

    super(
      [config],                        // MixinBot config
      [{ schema: ReportOutputSchema }], // StructuredOutputBotMixin
      [{}]                             // FeedbackBotMixin - empty config uses defaults
    );
  }

  override get_semantic_label_impl(_request: BotTryRequest<REPORT_BTH>): string {
    return "ReportGenerationBotSemanticLabel";
  }
}
```

Passing `[{}]` to `FeedbackBotMixin` uses the default feedback prompt, which renders as: "Please address the following user feedback: [feedback text]". The mixin automatically includes the previous result as an assistant message for context. The condition defaults to checking whether `_ff_feedback` and `_ff_previous_result` are both present, so on the first run (no feedback), the prompt section is simply omitted.

## Step 4: Create the ReportReviewWorkflowEntity

This is the new top-level entity that wraps everything in a review cycle. It extends `ReviewableEntity` and configures it to use `ReportEntity` as the wrapped entity.

**`apps/report-bundle/src/entities/ReportReviewWorkflowEntity.ts`**:

```typescript
import {
  EntityFactory,
  ReviewableEntity,
  logger,
  WorkingMemoryProvider,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper
} from '@firebrandanalytics/ff-agent-sdk';
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { ReportEntityDTOData } from '@shared/types';
import { ReportEntity } from './ReportEntity.js';

/**
 * Data shape for the workflow entity.
 * wrappedEntityArgs contains the data passed to ReportEntity on each iteration.
 */
interface ReportReviewWorkflowEntityDTOData {
  wrappedEntityArgs: ReportEntityDTOData;
  currentVersion: number;
  [key: string]: any;
}

type ReportReviewWorkflowEntityDTO =
  EntityInstanceNodeDTO<ReportReviewWorkflowEntityDTOData> & {
    node_type: "ReportReviewWorkflowEntity";
  };

type ReportReviewWorkflowEntityRETH = RunnableEntityTypeHelper<
  EntityNodeTypeHelper<
    any,
    EntityInstanceNodeDTO<ReportReviewWorkflowEntityDTOData>,
    any, any, any
  >,
  any, any, any, any
>;

@EntityMixin({
  specificType: 'ReportReviewWorkflowEntity',
  generalType: 'ReportReviewWorkflowEntity',
  allowedConnections: {
    'Calls': ['ReportEntity']
  }
})
export class ReportReviewWorkflowEntity extends ReviewableEntity<
  ReportReviewWorkflowEntityRETH,
  string   // FeedbackType is plain text
> {
  private working_memory_provider: WorkingMemoryProvider;

  constructor(
    factory: EntityFactory<ReportReviewWorkflowEntityRETH['enh']['eth']>,
    idOrDto: UUID | ReportReviewWorkflowEntityDTO
  ) {
    // Configure the review workflow
    const config = {
      wrappedEntityClass: ReportEntity,    // Entity to wrap
      reviewPrompt: 'Please review the generated report.',
      createResultEntity: false,           // We store results in working memory instead
    };
    super(factory, idOrDto, config);

    // Initialize working memory for document storage
    const CONTEXT_SERVICE_ADDRESS =
      process.env.CONTEXT_SERVICE_ADDRESS ||
      'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY =
      process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);
  }

  /**
   * Upload a document and start the review workflow.
   * This method owns the blob upload because the workflow entity
   * is the top-level entry point that clients interact with.
   */
  async *process_document_stream(
    document_buffer: Buffer,
    filename: string
  ): AsyncGenerator<any, any, never> {
    const dto = await this.get_dto();

    // Store the original document in working memory
    const originalDocResult = await this.working_memory_provider.add_memory_from_buffer({
      entityNodeId: this.id!,
      name: filename,
      description: `Original document uploaded: ${filename}`,
      contentType: this.getContentType(filename),
      memoryType: 'file',
      buffer: document_buffer,
      metadata: {
        original_filename: filename,
        upload_method: 'multipart_blob',
        file_size: document_buffer.length,
        stage: 'original_upload',
        uploaded_at: new Date().toISOString()
      },
    });

    // Set the working memory ID on the wrapped entity args
    dto.data.wrappedEntityArgs.original_document_wm_id =
      originalDocResult.workingMemoryId;
    dto.data.wrappedEntityArgs.original_filename = filename;
    await this.update_data(dto.data);

    // Start the review workflow (ReviewableEntity.run_impl handles the loop)
    const result = yield* await this.start();
    return result;
  }

  private getContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const contentTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'html': 'text/html',
    };
    return contentTypes[ext || ''] || 'application/octet-stream';
  }
}
```

There are three important design decisions here:

1. **`wrappedEntityClass: ReportEntity`** -- We pass the class reference directly rather than a string name. Either approach works, but the class reference gives you compile-time safety.

2. **`createResultEntity: false`** -- Our results (PDFs) are stored in working memory, not as separate entities. Setting this to `false` means `ReviewableEntity` skips the result entity creation step.

3. **`process_document_stream` lives here** -- The workflow entity owns the blob upload because it is the entry point clients interact with. The document goes into working memory first, then the workflow starts.

## Step 5: Register the New Entity

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { ReportEntity } from './entities/ReportEntity.js';
import { ReportGenerationEntity } from './entities/ReportGenerationEntity.js';
import { ReportReviewWorkflowEntity } from './entities/ReportReviewWorkflowEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  ReportEntity: ReportEntity,
  ReportGenerationEntity: ReportGenerationEntity,
  ReportReviewWorkflowEntity: ReportReviewWorkflowEntity,
} as const;
```

`FFConstructors` already includes the built-in `ReviewStep` entity, so you do not need to register it separately. The `ReviewableEntity` base class creates `ReviewStep` instances automatically using `appendOrRetrieveCall('ReviewStep', ...)`.

## Step 6: Understanding the Review Flow

Here is what happens at runtime when you upload a document to the workflow entity:

```
Client uploads document
       |
       v
ReportReviewWorkflowEntity.process_document_stream()
  |-- Stores document in working memory
  |-- Calls this.start() which invokes ReviewableEntity.run_impl()
       |
       v
  ReviewableEntity.run_impl() loop:
  |
  |-- Step 1: appendOrRetrieveCall(ReportEntity, 'wrapped_0', { ...args })
  |           update_config({ _ff_version: 0 })
  |           ReportEntity.run_impl()
  |             |-- Stage 1: Extract text
  |             |-- Stage 2: Generate HTML (via ReportGenerationEntity -> ReportGenerationBot)
  |             |-- Stage 3: Convert to PDF
  |             |-- Returns { pdf_working_memory_id, reasoning, html_content }
  |
  |-- Step 2: appendOrRetrieveCall('ReviewStep', 'review_0', { wrappedEntityResult, ... })
  |           ReviewStep.run_impl()
  |             |-- Yields a "waiting" envelope
  |             |-- ** PAUSES -- waits for human input **
  |
  |   Human reviews the result via ff-sdk-cli invoke...
  |
  |   IF approved:
  |     |-- ReviewStep returns { message: 'approved' }
  |     |-- Loop breaks, workflow returns final result
  |
  |   IF feedback provided:
  |     |-- ReviewStep returns { message: 'feedback', data: 'Make the title bigger' }
  |     |-- currentVersion increments to 1
  |     |-- Loop continues:
  |         |-- appendOrRetrieveCall(ReportEntity, 'wrapped_1', { ...args })
  |         |-- update_config({
  |         |     _ff_feedback: 'Make the title bigger',
  |         |     _ff_previous_result: { reasoning, html_content, ... },
  |         |     _ff_version: 1
  |         |   })
  |         |-- ReportEntity re-runs, FeedbackBotMixin injects feedback into prompt
  |         |-- New ReviewStep 'review_1' created, waits again
```

Each iteration creates uniquely-named child entities (`wrapped_0`, `wrapped_1`, `review_0`, `review_1`). If the workflow is interrupted and restarted, completed nodes are retrieved rather than re-executed -- this is the idempotency guarantee.

## Step 7: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 8: Test the Approve Flow

### Create and Upload

```bash
# Create the workflow entity
ff-sdk-cli api call create-report \
  --method POST \
  --body '{"prompt": "Summarize the key findings", "orientation": "portrait"}' \
  --url http://localhost:3001

# Note the entity_id from the response
# Upload a document (starts the workflow)
ff-sdk-cli iterator start-blob <entity-id> \
  --method process_document_stream \
  --file ./sample-report.pdf \
  --url http://localhost:3001
```

### Poll for Progress

```bash
ff-sdk-cli iterator next <entity-id> --url http://localhost:3001
```

You will see INTERNAL_UPDATE events as the workflow progresses through text extraction, HTML generation, and PDF conversion. Eventually you will see a "waiting" status -- this is the ReviewStep pausing for your input.

### Approve the Result

```bash
ff-sdk-cli invoke <review-step-id> \
  --method sendMessage \
  --args '["approved", true]' \
  --url http://localhost:3001
```

### Get the Final Result

```bash
ff-sdk-cli iterator next <entity-id> --url http://localhost:3001
```

This returns a `VALUE` event with the final result containing `pdf_working_memory_id`.

## Step 9: Test the Reject-and-Revise Flow

### Create, Upload, and Wait for Review

Follow the same steps as above until the ReviewStep pauses.

### Reject with Feedback

Instead of approving, provide feedback:

```bash
ff-sdk-cli invoke <review-step-id> \
  --method sendMessage \
  --args '["feedback", "Make the title larger and add an executive summary section at the top"]' \
  --url http://localhost:3001
```

### Poll for the Revised Result

```bash
ff-sdk-cli iterator next <entity-id> --url http://localhost:3001
```

The workflow re-runs `ReportEntity` as `wrapped_1`. This time, the `FeedbackBotMixin` injects your feedback into the LLM prompt. You will see the same progress stages (extraction is skipped if cached, but HTML generation and PDF conversion run again).

A new `ReviewStep` (`review_1`) is created. You can approve or reject again:

```bash
# Approve the revision
ff-sdk-cli invoke <review-step-1-id> \
  --method sendMessage \
  --args '["approved", true]' \
  --url http://localhost:3001
```

### Verify the Entity Graph

Use `ff-eg-read` to see the full entity tree:

```bash
ff-eg-read node get <workflow-entity-id> \
  --mode=internal \
  --gateway=http://localhost \
  --internal-port=8180
```

You should see the workflow entity with child edges to `wrapped_0`, `review_0`, `wrapped_1`, and `review_1` -- a complete audit trail of every iteration.

### Inspect the Config Column

After a revision cycle, use `ff-eg-read` to verify that feedback was stored in the config column (not data):

```bash
ff-eg-read node get <wrapped-1-id> --mode=internal --gateway=http://localhost --internal-port=8180
```

In the response, you should see the user data and system metadata cleanly separated:

```json
{
  "data": {
    "prompt": "Summarize the key findings",
    "orientation": "portrait",
    "original_document_wm_id": "wm-abc-..."
  },
  "config": {
    "_ff_feedback": "Make the title larger and add an executive summary section at the top",
    "_ff_previous_result": { "reasoning": "...", "html_content": "..." },
    "_ff_version": 1
  }
}
```

This separation is the config column pattern in action -- `data` contains only the user's input, while `config` holds system metadata that drives the feedback loop.

## What You've Built

You now have:
- A `ReportReviewWorkflowEntity` that wraps report generation in a human review cycle
- Feedback flowing from the reviewer through `ReviewableEntity` into `ReportEntity`, through `FeedbackRunnableEntityMixin` into `ReportGenerationEntity`, through `FeedbackBotMixin` into the LLM prompt
- Idempotent named nodes for each iteration, providing a full audit trail
- The ability to approve or reject reports with arbitrarily many revision cycles

## Key Takeaways

1. **ReviewableEntity handles the loop** -- You configure it with a wrapped entity class and a review prompt. It manages the iteration, version tracking, and ReviewStep creation automatically.
2. **FeedbackBotMixin is conditional** -- It only adds the feedback prompt section when `_ff_feedback` is present. On the first run, the prompt is identical to what you had before.
3. **FeedbackRunnableEntityMixin uses the pre/impl/post pattern** -- It injects feedback fields in the `pre` hook so your `impl` method does not need to handle them manually.
4. **Feedback flows through the config column** -- `ReviewableEntity` stores `_ff_feedback`, `_ff_previous_result`, and `_ff_version` in the wrapped entity's config (not data). `FeedbackRunnableEntityMixin` reads them from config and injects them into bot request args. Your entity data interfaces stay clean of system metadata.
5. **process_document_stream belongs on the workflow entity** -- The outermost entity should own the blob upload because it is the entry point clients use. Inner entities receive data references (working memory IDs) rather than raw buffers.
6. **Named nodes provide idempotency and audit trails** -- `wrapped_0`, `wrapped_1`, `review_0`, `review_1` are all preserved in the entity graph. If a workflow is interrupted and restarted, completed nodes are reused.

## Next Steps

In [Part 9: Custom API Endpoints](./part-09-api-endpoints.md), we'll add REST API endpoints to the agent bundle so clients can create reports and check status without using the low-level invoke protocol.
