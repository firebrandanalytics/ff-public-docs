# Part 2: Adding AI with Bots

In this part, you'll add an LLM-powered bot that takes text and produces a structured summary. This introduces the separation of **structure** (entities) from **behavior** (bots) that is central to FireFoundry's architecture.

**What you'll learn:**
- Creating a bot with `MixinBot` and `StructuredOutputBotMixin`
- Defining structured output with Zod schemas and `withSchemaMetadata`
- Wrapping a bot in a `BotRunnableEntityMixin`-based entity
- Passing entity data to the bot via `get_bot_request_args_impl`
- Using `ComposeMixins` and `AddMixins` to compose behavior

**What you'll build:** A `ReportGenerationBot` that receives document text and returns structured output (reasoning + summary), wrapped in a `ReportGenerationEntity` that you can create and run with `ff-sdk-cli`.

## Concepts: Entities vs. Bots

Before writing code, understand the key separation:

| Concept | Role | Analogy |
|---------|------|---------|
| **Entity** | Stores state, manages lifecycle, lives in the entity graph | A work order on a clipboard |
| **Bot** | Stateless AI behavior -- takes input, produces output | The worker who reads the clipboard and does the work |
| **BotRunnableEntityMixin** | Glue -- when the entity runs, it delegates to the bot | The foreman who hands the clipboard to the worker |

This separation means you can reuse the same bot across different entities, swap bots without changing entity structure, and test bots independently of persistence.

## Step 1: Define the Output Schema

The bot needs to return structured data, not free-form text. Use Zod to define the schema and `withSchemaMetadata` to add descriptive metadata that gets injected into the LLM prompt.

**`apps/report-bundle/src/schemas.ts`**:

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

/**
 * Output schema for the Report Generation Bot.
 * 
 * withSchemaMetadata wraps a Zod schema with:
 *   - A label (shown to the LLM as the output field name)
 *   - A description (explains what this output represents)
 * 
 * The StructuredOutputBotMixin automatically injects this schema
 * into the prompt so the LLM knows exactly what to return.
 */
export const ReportOutputSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string()
      .describe('Your thought process for structuring this report'),
    html_content: z.string()
      .describe('Complete HTML document with embedded CSS styling')
  }),
  'Your final output',
  'AI-generated HTML report with reasoning'
);

export type REPORT_OUTPUT = z.infer<typeof ReportOutputSchema>;
```

**Key points:**
- Each field in the Zod schema gets a `.describe()` string. The LLM sees these descriptions as instructions for what to put in each field.
- `withSchemaMetadata` adds a label and description that wrap the entire schema in the prompt.
- The inferred `REPORT_OUTPUT` type is `{ reasoning: string; html_content: string }` -- you get full TypeScript type safety on the bot's output.

## Step 2: Create the Bot

A bot in FireFoundry is built by composing **mixins**. `MixinBot` is the base, and `StructuredOutputBotMixin` adds the ability to parse and validate LLM output against a Zod schema.

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
  RegisterBot,
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import { ReportOutputSchema, REPORT_OUTPUT } from '../schemas.js';

/**
 * Type helpers define the shape of bot requests and responses.
 * These flow through the entire type system:
 *   PromptTypeHelper -> BotTypeHelper -> EntityTypeHelper
 */

// What the user types as their instruction (the "input" text)
type REPORT_PROMPT_INPUT = string;

// Arguments that provide context to the bot beyond the user's input
type REPORT_PROMPT_ARGS = {
  static: {};            // Set once at bot construction (none for now)
  request: {             // Set per-request from entity data
    plain_text: string;                    // The document text to summarize
    orientation: 'portrait' | 'landscape'; // Layout preference
  };
};

export type REPORT_PTH = PromptTypeHelper<REPORT_PROMPT_INPUT, REPORT_PROMPT_ARGS>;
export type REPORT_BTH = BotTypeHelper<REPORT_PTH, REPORT_OUTPUT>;

/**
 * Bot that generates HTML reports from document content.
 *
 * @RegisterBot registers this bot with the framework by name,
 * enabling it to be discovered and referenced in the bot registry.
 *
 * ComposeMixins creates a class that inherits behavior from:
 *   - MixinBot: core bot functionality (prompt rendering, LLM calls)
 *   - StructuredOutputBotMixin: Zod schema validation on LLM output
 */
@RegisterBot('ReportGenerationBot')
export class ReportGenerationBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
)<[
  MixinBot<REPORT_BTH, [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>]>,
  [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>]
]> {
  constructor() {
    // Build the prompt group that the bot sends to the LLM.
    // StructuredPromptGroup organizes prompts into "base" (system) and "input" (user).
    const promptGroup = new StructuredPromptGroup<REPORT_PTH>({
      base: new PromptGroup([
        {
          name: "report_generation_system",
          prompt: new PromptInputText({
            default_text: [
              'You are a professional report generator.',
              'You receive extracted text from documents and user instructions.',
              'Your job is to create well-formatted HTML reports.',
              'Include proper CSS styling in a <style> tag.',
              'Use semantic HTML5 elements with clear headings and sections.'
            ].join('\n')
          })
        }
      ]),
      input: new PromptGroup([
        {
          name: "user_input",
          prompt: new PromptInputText({})
        }
      ]),
    });

    // MixinBot configuration
    const config: MixinBotConfig<REPORT_BTH> = {
      name: "ReportGenerationBot",
      base_prompt_group: promptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {}
    };

    super(
      [config],                              // MixinBot args
      [{ schema: ReportOutputSchema }],      // StructuredOutputBotMixin args
    );
  }

  /**
   * Semantic label for telemetry and logging.
   * Helps identify this bot's calls in ff-telemetry-read output.
   */
  override get_semantic_label_impl(_request: BotTryRequest<REPORT_BTH>): string {
    return "ReportGenerationBotSemanticLabel";
  }
}
```

**How ComposeMixins works:**

`ComposeMixins(MixinBot, StructuredOutputBotMixin)` creates a new class that combines both mixins. The constructor takes an array of arguments for each mixin, in order:

```
super(
  [config],                          // args for MixinBot
  [{ schema: ReportOutputSchema }],  // args for StructuredOutputBotMixin
);
```

The type parameter `[MixinBot<...>, [StructuredOutputBotMixin<...>]]` tells TypeScript which mixin gets which type arguments. The first element types the base (`MixinBot`), and the second element is a tuple typing the remaining mixins.

## Step 3: Create the Entity

Now wrap the bot in an entity. `BotRunnableEntityMixin` is the bridge: when the entity runs, the mixin calls the bot and returns its output.

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
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { REPORT_BTH, ReportGenerationBot } from '../bots/ReportGenerationBot.js';
import { REPORT_OUTPUT } from '../schemas.js';
import { ReportBundleConstructors } from '../constructors.js';

/**
 * Data stored in the ReportGenerationEntity's graph node
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

type ReportGenerationEntityDTO = EntityInstanceNodeDTO<ReportGenerationEntityDTOData> & {
  node_type: "ReportGenerationEntity";
};

/**
 * Type helpers wire entity types to bot types.
 * EntityTypeHelper connects bot type info to the constructor map.
 * EntityNodeTypeHelper defines the entity's DTO shape and name.
 * RunnableEntityTypeHelper adds the run return type.
 */
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
 * Entity that wraps ReportGenerationBot.
 * 
 * AddMixins adds mixin behavior to an existing class:
 *   - RunnableEntity: base class (can be started, yields progress)
 *   - BotRunnableEntityMixin: delegates run to a bot
 * 
 * Unlike ComposeMixins (which creates a new class from scratch),
 * AddMixins extends an existing class with additional behavior.
 */
@EntityMixin({
  specificType: 'ReportGenerationEntity',
  generalType: 'ReportGenerationEntity',
  allowedConnections: {}
})
export class ReportGenerationEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
)<[
  RunnableEntity<ReportGenerationEntityRETH>,
  BotRunnableEntityMixin<ReportGenerationEntityRETH>,
]> {
  constructor(
    factory: EntityFactory<ReportGenerationEntityENH['eth']>,
    idOrDto: UUID | ReportGenerationEntityDTO
  ) {
    super(
      [factory, idOrDto],             // RunnableEntity args
      [new ReportGenerationBot()],    // BotRunnableEntityMixin args (bot instance)
    );
  }

  /**
   * Prepare the bot's request arguments from entity data.
   * 
   * This is the key bridge method. The BotRunnableEntityMixin calls this
   * before invoking the bot. You read entity state and return the
   * input/args/context the bot needs.
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
      input: data.user_prompt,       // Becomes the "user" message to the LLM
      context: new Context(),         // Empty context (extensible later)
      args: {
        plain_text: data.plain_text,  // Document text, available in prompts
        orientation: data.orientation  // Layout preference, available in prompts
      }
    };
  }
}
```

**The data flow when the entity runs:**

```
Entity started
    |
    v
BotRunnableEntityMixin calls get_bot_request_args_impl()
    |
    v
Entity reads its stored data (plain_text, orientation, user_prompt)
    |
    v
Returns { input, context, args } to the mixin
    |
    v
Mixin passes these to ReportGenerationBot
    |
    v
Bot renders prompts, calls LLM, validates output against Zod schema
    |
    v
Entity returns REPORT_OUTPUT { reasoning, html_content }
```

**AddMixins vs. ComposeMixins:**

| | ComposeMixins | AddMixins |
|---|---|---|
| **Used for** | Bots (creating from scratch) | Entities (extending a base class) |
| **Base class** | Created by the mixin composition | Provided as the first argument |
| **Pattern** | `class Bot extends ComposeMixins(A, B)` | `class Entity extends AddMixins(Base, Mixin)` |

## Step 4: Register the Entity

Add the new entity to the constructor map.

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { TextDocumentEntity } from './entities/TextDocumentEntity.js';
import { ReportGenerationEntity } from './entities/ReportGenerationEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  TextDocumentEntity: TextDocumentEntity,
  ReportGenerationEntity: ReportGenerationEntity,
} as const;
```

## Step 5: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 6: Test with ff-sdk-cli

### Create a ReportGenerationEntity

Create an entity with text content, a prompt, and an orientation:

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportGenerationEntity",
    "data": {
      "plain_text": "Q3 Revenue: $2.4M (up 15% YoY). Operating costs reduced by 8%. New customer acquisition increased 22% driven by product launch in EMEA region. Employee headcount grew from 45 to 52.",
      "orientation": "portrait",
      "user_prompt": "Create a concise executive summary report from this quarterly data."
    }
  }' \
  --url http://localhost:3001
```

Note the returned `entity_id`.

### Start the Entity

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

You should see the following events stream back:

1. A `STATUS` event with `"status": "STARTED"`
2. `BOT_PROGRESS` events as the LLM generates tokens
3. A `VALUE` event containing the structured output:
   ```json
   {
     "reasoning": "The data contains quarterly metrics...",
     "html_content": "<!DOCTYPE html><html>..."
   }
   ```
4. A `STATUS` event with `"status": "COMPLETED"`

### Verify the Output

The `VALUE` event contains your validated `REPORT_OUTPUT`. The `reasoning` field shows the LLM's thought process, and `html_content` contains a complete HTML document. If the LLM returns malformed output, the `StructuredOutputBotMixin` rejects it and retries, so you always get valid structured data.

### Inspect with ff-eg-read

```bash
ff-eg-read node get <entity-id>

# Check the return value
ff-eg-read node io <entity-id>

# Review the progress envelopes
ff-eg-read node progress <entity-id>
```

### Check LLM Call Details with ff-telemetry-read

To see the actual prompt that was sent to the LLM, including the injected schema:

```bash
ff-telemetry-read broker-requests --entity-id <entity-id>
```

This shows the full request/response, including how `StructuredOutputBotMixin` injected the Zod schema description into the system prompt.

## What You've Built

You now have:
- A Zod schema that defines the bot's structured output
- A `ReportGenerationBot` that composes `MixinBot` and `StructuredOutputBotMixin`
- A `ReportGenerationEntity` that bridges entity data to bot requests
- A working AI pipeline: entity data -> bot request -> LLM call -> validated structured output

## Key Takeaways

1. **Bots are stateless** -- they receive input, call the LLM, and return output. They do not store data.
2. **Entities own state** -- they persist in the entity graph and provide data to bots via `get_bot_request_args_impl`.
3. **StructuredOutputBotMixin handles schema injection and validation** -- you define a Zod schema, and the mixin ensures the LLM output conforms to it.
4. **ComposeMixins builds bots from mixins** -- each mixin adds a capability (structured output, feedback, etc.).
5. **AddMixins extends entities with mixin behavior** -- `BotRunnableEntityMixin` makes "run entity = run bot".
6. **Type helpers connect the layers** -- `PromptTypeHelper` -> `BotTypeHelper` -> `EntityTypeHelper` -> `RunnableEntityTypeHelper` form a type chain that gives you end-to-end type safety.

## Next Steps

The bot's prompt is currently a simple string. In [Part 3: Prompt Engineering](./part-03-prompt-engineering.md), you'll replace it with a structured `Prompt` class that uses template sections, conditional logic based on orientation, and numbered rule lists -- giving you full control over what the LLM sees.
