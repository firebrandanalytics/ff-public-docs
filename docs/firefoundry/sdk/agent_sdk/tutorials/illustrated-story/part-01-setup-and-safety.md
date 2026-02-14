# Part 1: Project Setup & Content Safety Bot

In this part, you'll scaffold the illustrated story project and build the first component of the pipeline: a content safety bot that evaluates whether a user-submitted topic is appropriate for a children's story. This introduces structured output validation with Zod schemas and the mixin composition patterns used throughout FireFoundry.

**What you'll learn:**
- Scaffolding a monorepo project with `ff-cli`
- Defining structured output with Zod schemas and `withSchemaMetadata`
- Building a structured prompt with `Prompt`, `PromptTemplateSectionNode`, and `@RegisterPrompt`
- Creating a bot with `ComposeMixins`, `MixinBot`, and `StructuredOutputBotMixin`
- Wrapping a bot in a `BotRunnableEntityMixin`-based entity
- Passing entity data to the bot via `get_bot_request_args_impl`
- The type helper chain: `PromptTypeHelper` -> `BotTypeHelper` -> `EntityNodeTypeHelper` -> `RunnableEntityTypeHelper`

**What you'll build:** A content safety bot that receives a story topic, evaluates it against child-safety rules, and returns a structured assessment (`is_safe`, `safety_score`, `concerns`, `reasoning`) validated by a Zod schema.

---

## Concepts: The Bot-Entity Pattern

Before writing code, understand the two core building blocks and how they connect:

| Concept | Role | Analogy |
|---------|------|---------|
| **Entity** | Stores state, manages lifecycle, lives in the entity graph | A work order on a clipboard |
| **Bot** | Stateless AI behavior -- takes input, produces output | The worker who reads the clipboard and does the work |
| **BotRunnableEntityMixin** | Glue -- when the entity runs, it delegates to the bot | The foreman who hands the clipboard to the worker |

The content safety check follows this pattern: a `ContentSafetyCheckEntity` holds the user's topic, and when started, it delegates to a `ContentSafetyBot` that calls the LLM, validates the response against a Zod schema, and returns a typed result.

---

## Step 1: Scaffold the Project

Use `ff-cli` to create a new application:

```bash
ff application create illustrated-story
cd illustrated-story
ff agent-bundle create story-bundle
```

This creates a monorepo with:

```
illustrated-story/
├── firefoundry.json              # Application-level config
├── apps/
│   └── story-bundle/
│       ├── firefoundry.json      # Bundle-level config
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared-types/             # Shared type definitions
│       └── src/index.ts
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### firefoundry.json Files

**Root level** (`illustrated-story/firefoundry.json`) -- declares the application:

```json
{
  "application_id": "your-app-uuid-here"
}
```

**Bundle level** (`apps/story-bundle/firefoundry.json`) -- configures the agent bundle:

```json
{
  "agent_bundle_id": "your-bundle-uuid-here",
  "application_id": "your-app-uuid-here"
}
```

Install dependencies:

```bash
pnpm install
```

By the end of this tutorial series, the `src/` directory will contain several subdirectories. Create the folder structure now:

```bash
mkdir -p apps/story-bundle/src/{bots,entities,prompts}
```

The final structure will look like this:

```
apps/story-bundle/src/
├── index.ts
├── agent-bundle.ts
├── constructors.ts
├── schemas.ts
├── bots/
│   ├── ContentSafetyBot.ts
│   └── StoryWriterBot.ts
├── entities/
│   ├── ContentSafetyCheckEntity.ts
│   └── StoryWriterEntity.ts
├── prompts/
│   ├── ContentSafetyPrompt.ts
│   └── StoryWriterPrompt.ts
```

In this part, you'll create the files related to content safety: `schemas.ts`, `ContentSafetyPrompt.ts`, `ContentSafetyBot.ts`, `ContentSafetyCheckEntity.ts`, and update `constructors.ts`.

---

## Step 2: Define the Output Schema

The content safety bot needs to return structured data, not free-form text. Use Zod to define what the LLM must produce, and `withSchemaMetadata` to add a name and description that the framework injects into the prompt.

**`apps/story-bundle/src/schemas.ts`**:

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

export const ContentSafetySchema = withSchemaMetadata(
  z.object({
    is_safe: z.boolean()
      .describe('Whether the topic is safe for a children\'s story'),
    safety_score: z.number().min(0).max(100)
      .describe('Safety score from 0 (unsafe) to 100 (completely safe)'),
    concerns: z.array(z.string())
      .describe('List of safety concerns found, empty if none'),
    reasoning: z.string()
      .describe('Brief explanation of the safety assessment'),
  }),
  'ContentSafetyOutput',
  'Content safety assessment for children\'s story topics'
);

export type CONTENT_SAFETY_OUTPUT = z.infer<typeof ContentSafetySchema>;
```

### How `withSchemaMetadata` Works

`withSchemaMetadata` attaches a name and description to the schema object itself (not to individual fields). These appear as the header of the schema documentation that `StructuredOutputBotMixin` injects into the prompt.

```typescript
export function withSchemaMetadata<T extends z.ZodType<any>>(
  schema: T,
  name: string,
  description?: string
): T
```

| Argument | Purpose | Value in our schema |
|----------|---------|---------------------|
| `schema` | The Zod schema to annotate | `z.object({ is_safe, safety_score, concerns, reasoning })` |
| `name` | Top-level label shown in the prompt | `'ContentSafetyOutput'` |
| `description` | Elaboration shown after the name | `'Content safety assessment for children\'s story topics'` |

The metadata is stored as properties on the schema object (`__schemaName` and `__schemaDescription`). The `StructuredOutputBotMixin` reads these when building the prompt.

### What the LLM Sees

When the mixin renders this schema into the prompt, it produces text like:

```
Output your response using the following schema in json format:
ContentSafetyOutput. Content safety assessment for children's story topics
is_safe: boolean. Whether the topic is safe for a children's story
safety_score: number. Safety score from 0 (unsafe) to 100 (completely safe)
concerns: array of string. List of safety concerns found, empty if none
reasoning: string. Brief explanation of the safety assessment
```

This is a natural-language representation, not a JSON Schema document. The format is designed to be easy for LLMs to understand and follow.

### Writing Effective `.describe()` Annotations

Each field's `.describe()` text appears directly in the prompt the LLM receives. Write descriptions as instructions, not documentation:

```typescript
// BAD: Vague documentation style
z.boolean().describe('Safety flag')

// GOOD: Clear instruction style
z.boolean().describe('Whether the topic is safe for a children\'s story')
```

### Schema Design Choices

Several details in this schema are worth noting:

- **`safety_score` uses `.min(0).max(100)`** -- Zod validates the numeric range at runtime. If the LLM returns `safety_score: 150`, Zod rejects it.
- **`concerns` is an array** -- this lets the LLM enumerate multiple issues. An empty array means no concerns.
- **`reasoning` comes last** -- unlike the report generator's "reasoning first" pattern, here the boolean and score come first because the safety decision is simple and the reasoning explains it. For complex generation tasks, put reasoning first so the LLM "thinks before it writes."
- **The inferred type `CONTENT_SAFETY_OUTPUT`** gives you full TypeScript type safety: `{ is_safe: boolean; safety_score: number; concerns: string[]; reasoning: string }`.

---

## Step 3: Define Shared Types

Add the content safety result interface to the shared types package. This lets other packages (like a future GUI) reference the same shape without depending on the agent SDK.

**`packages/shared-types/src/index.ts`**:

```typescript
export interface ContentSafetyResult {
  is_safe: boolean;
  safety_score: number;
  concerns: string[];
  reasoning: string;
}
```

---

## Step 4: Create the Content Safety Prompt

FireFoundry prompts are classes that build structured prompt templates from composable sections. Each section has a `semantic_type` that tells the framework what role it plays (`context`, `rule`, etc.), and sections can contain nested children.

**`apps/story-bundle/src/prompts/ContentSafetyPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  RegisterPrompt,
} from '@firebrandanalytics/ff-agent-sdk';

type SAFETY_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

@RegisterPrompt('ContentSafetyPrompt')
export class ContentSafetyPrompt extends Prompt<SAFETY_PTH> {
  constructor(
    role: 'system' | 'user' | 'assistant',
    options?: SAFETY_PTH['options']
  ) {
    super(role, options ?? {});
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Task_Section());
    this.add_section(this.get_Rules_Section());
  }

  protected get_Context_Section(): PromptTemplateNode<SAFETY_PTH> {
    return new PromptTemplateSectionNode<SAFETY_PTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        'You are a content safety specialist for children\'s stories.',
        'Your job is to assess whether a story topic is appropriate for children of all ages.',
      ]
    });
  }

  protected get_Task_Section(): PromptTemplateNode<SAFETY_PTH> {
    return new PromptTemplateSectionNode<SAFETY_PTH>({
      semantic_type: 'rule',
      content: 'Task:',
      children: [
        'Analyze the provided story topic for content safety.',
        'Determine if it is appropriate for children aged 3-10.',
        'Provide a safety score from 0-100 (100 = completely safe).',
        'Be moderately conservative — flag genuinely concerning themes but allow adventure, mild conflict, and age-appropriate challenges.',
      ]
    });
  }

  protected get_Rules_Section(): PromptTemplateNode<SAFETY_PTH> {
    return new PromptTemplateSectionNode<SAFETY_PTH>({
      semantic_type: 'rule',
      content: 'Safety Rules:',
      children: [
        'Reject: sexual content, graphic violence, gore, horror, drugs, alcohol, profanity',
        'Reject: content promoting discrimination, bullying, or harmful behavior',
        'Allow: adventure, mild danger, age-appropriate challenges, fantasy conflict',
        'Allow: stories about overcoming fears, making friends, learning lessons',
        'Promote: positive values, kindness, courage, friendship, creativity',
      ]
    });
  }
}
```

### Key Concepts

**`@RegisterPrompt('ContentSafetyPrompt')`** registers this prompt class with the framework by name. This enables the framework to discover and reference it in the prompt registry, similar to how `@RegisterBot` works for bots. The name string must be unique across all registered prompts.

**`PromptTypeHelper<string, { static: {}; request: {} }>`** defines the type shape for this prompt:
- The first argument (`string`) is the input type -- what the user provides as the topic text.
- The second argument defines static args (set at construction) and request args (set per-request). This prompt has no args, so both are empty objects.

**`PromptTemplateSectionNode`** creates a structured section with:
- `semantic_type` -- tells the framework the section's role. Common values: `'context'` (background information), `'rule'` (behavioral instructions), `'task'` (what to do).
- `content` -- the section header text.
- `children` -- an array of strings or nested nodes that form the section body.

**Prompt composition via `add_section`** -- the constructor builds the prompt by adding sections in order. The framework renders these sections sequentially when assembling the final prompt for the LLM. This is more maintainable than a single large string because each section is independently testable and overridable by subclasses.

---

## Step 5: Create the Content Safety Bot

The bot composes `MixinBot` (core LLM calling) with `StructuredOutputBotMixin` (Zod validation on output) using `ComposeMixins`.

**`apps/story-bundle/src/bots/ContentSafetyBot.ts`**:

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
import { ContentSafetyPrompt } from '../prompts/ContentSafetyPrompt.js';
import { ContentSafetySchema, CONTENT_SAFETY_OUTPUT } from '../schemas.js';

type SAFETY_PROMPT_INPUT = string;
type SAFETY_PROMPT_ARGS = { static: {}; request: {} };

export type SAFETY_PTH = PromptTypeHelper<SAFETY_PROMPT_INPUT, SAFETY_PROMPT_ARGS>;
export type SAFETY_BTH = BotTypeHelper<SAFETY_PTH, CONTENT_SAFETY_OUTPUT>;

@RegisterBot('ContentSafetyBot')
export class ContentSafetyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<SAFETY_BTH, [StructuredOutputBotMixin<SAFETY_BTH, typeof ContentSafetySchema>]>,
  [StructuredOutputBotMixin<SAFETY_BTH, typeof ContentSafetySchema>]
]> {
  constructor() {
    const promptGroup = new StructuredPromptGroup<SAFETY_PTH>({
      base: new PromptGroup([
        {
          name: "content_safety_system",
          prompt: new ContentSafetyPrompt('system', {}) as any
        }
      ]),
      input: new PromptGroup([
        {
          name: "user_input",
          prompt: new PromptInputText({})
        }
      ]),
    });

    const config: MixinBotConfig<SAFETY_BTH> = {
      name: "ContentSafetyBot",
      base_prompt_group: promptGroup,
      model_pool_name: "firebrand-gpt-5.2-failover",
      static_args: {}
    };

    super(
      [config],
      [{ schema: ContentSafetySchema }],
    );
  }

  override get_semantic_label_impl(_request: BotTryRequest<SAFETY_BTH>): string {
    return "ContentSafetyBotSemanticLabel";
  }
}
```

### Understanding the Type Helpers

The type helpers form a chain that connects every layer of the system. Let's trace them:

```
PromptTypeHelper (PTH)
  - Defines: what the user sends (string) + what args the prompt needs ({ static, request })
      |
      v
BotTypeHelper (BTH)
  - Combines: PTH + what the bot returns (CONTENT_SAFETY_OUTPUT)
  - This tells the framework: "this bot takes PTH-shaped input and produces this output type"
```

These type helpers are exported from the bot file (`SAFETY_PTH`, `SAFETY_BTH`) because the entity needs them to set up its own type chain. The types flow upward from prompt to bot to entity, providing end-to-end type safety.

### How `ComposeMixins` Works

`ComposeMixins(MixinBot, StructuredOutputBotMixin)` creates a new class that inherits behavior from both mixins:

- **`MixinBot`** provides core bot functionality: prompt rendering, LLM calling, and response handling.
- **`StructuredOutputBotMixin`** adds two capabilities: (1) it injects schema documentation into the prompt so the LLM knows the expected output format, and (2) it validates the LLM's response against the Zod schema, extracting JSON and running `safeParse`.

The `super()` call passes arguments to each mixin in order:

```typescript
super(
  [config],                          // args for MixinBot
  [{ schema: ContentSafetySchema }], // args for StructuredOutputBotMixin
);
```

The type parameter after `ComposeMixins(...)` is a tuple that tells TypeScript which mixin gets which type arguments:

```typescript
<[
  MixinBot<SAFETY_BTH, [StructuredOutputBotMixin<...>]>,  // Types for MixinBot
  [StructuredOutputBotMixin<SAFETY_BTH, typeof ContentSafetySchema>]  // Types for remaining mixins
]>
```

This is verbose but gives you full type safety -- TypeScript knows the bot returns `CONTENT_SAFETY_OUTPUT` and will catch type mismatches at compile time.

### `@RegisterBot` Decorator

`@RegisterBot('ContentSafetyBot')` registers this bot with the framework by name. This serves the same purpose as `@RegisterPrompt` -- it makes the bot discoverable in the framework's registry. The name must be unique across all registered bots.

### `StructuredPromptGroup` and Prompt Assembly

The bot organizes its prompts into two groups:

| Group | Role | What goes here |
|-------|------|----------------|
| `base` | System-level instructions | The `ContentSafetyPrompt` (context, task, rules) |
| `input` | User-provided content | `PromptInputText` -- the topic to evaluate |

At prompt assembly time, the `StructuredOutputBotMixin` automatically inserts a third section between `base` and `input` containing the schema documentation. The LLM receives:

1. **System prompt** -- your ContentSafetyPrompt (context, task, rules)
2. **Schema documentation** -- generated from `ContentSafetySchema` (injected by the mixin)
3. **User input** -- the topic text

### `get_semantic_label_impl`

This method returns a string used for telemetry and logging. When you inspect LLM calls with `ff-telemetry-read`, this label helps you identify which bot made which call. Use a descriptive, unique name.

---

## Step 6: Create the Content Safety Check Entity

The entity wraps the bot. When started, it reads its stored data (the topic), passes it to the bot, and returns the validated safety assessment.

**`apps/story-bundle/src/entities/ContentSafetyCheckEntity.ts`**:

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
} from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { SAFETY_BTH, ContentSafetyBot } from '../bots/ContentSafetyBot.js';
import { CONTENT_SAFETY_OUTPUT } from '../schemas.js';
import { StoryBundleConstructors } from '../constructors.js';

interface ContentSafetyCheckDTOData {
  topic: string;
  [key: string]: any;
}

type ContentSafetyCheckDTO = EntityInstanceNodeDTO<ContentSafetyCheckDTOData> & {
  node_type: "ContentSafetyCheckEntity";
};

type ContentSafetyCheckENH = EntityNodeTypeHelper<
  EntityTypeHelper<SAFETY_BTH, typeof StoryBundleConstructors>,
  ContentSafetyCheckDTO,
  'ContentSafetyCheckEntity',
  {},
  {}
>;

type ContentSafetyCheckRETH = RunnableEntityTypeHelper<
  ContentSafetyCheckENH,
  CONTENT_SAFETY_OUTPUT
>;

@EntityMixin({
  specificType: 'ContentSafetyCheckEntity',
  generalType: 'ContentSafetyCheckEntity',
  allowedConnections: {}
})
export class ContentSafetyCheckEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<ContentSafetyCheckRETH>,
  BotRunnableEntityMixin<ContentSafetyCheckRETH>
]> {
  constructor(
    factory: EntityFactory<ContentSafetyCheckENH['eth']>,
    idOrDto: UUID | ContentSafetyCheckDTO
  ) {
    super(
      [factory, idOrDto],
      [new ContentSafetyBot()]
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<ContentSafetyCheckRETH['enh']['eth']['bth']>>
  ): Promise<BotRequestArgs<ContentSafetyCheckRETH['enh']['eth']['bth']>> {
    const dto = await this.get_dto();
    return {
      input: dto.data.topic,
      context: new Context(),
      args: {} as SAFETY_BTH['pth']['args']['request']
    };
  }
}
```

### Understanding the Type Helper Chain

The entity introduces two more type helpers that extend the chain from the bot:

```
PromptTypeHelper (PTH)         -- prompt input shape + args
    |
    v
BotTypeHelper (BTH)            -- PTH + bot output type
    |
    v
EntityNodeTypeHelper (ENH)     -- BTH + DTO shape + entity name + constructor map
    |
    v
RunnableEntityTypeHelper (RETH) -- ENH + run return type
```

Let's trace each one in the content safety entity:

**`EntityTypeHelper<SAFETY_BTH, typeof StoryBundleConstructors>`** -- connects the bot's type information (`SAFETY_BTH`) to the constructor map. This tells the framework which bots this entity can use and which entity types exist in the bundle.

**`EntityNodeTypeHelper<ETH, ContentSafetyCheckDTO, 'ContentSafetyCheckEntity', {}, {}>`** -- adds the entity's DTO shape (what data it stores), its type name (must match `@EntityMixin`), and connection configuration (empty `{}` for both static and dynamic connections in this case).

**`RunnableEntityTypeHelper<ContentSafetyCheckENH, CONTENT_SAFETY_OUTPUT>`** -- adds the return type of `run_impl`. Since this entity delegates to `ContentSafetyBot`, the return type is `CONTENT_SAFETY_OUTPUT`.

These types are verbose, but they provide complete type safety from prompt input through to entity output. If you change the Zod schema, TypeScript will flag every place that needs updating.

### `@EntityMixin` Decorator

```typescript
@EntityMixin({
  specificType: 'ContentSafetyCheckEntity',
  generalType: 'ContentSafetyCheckEntity',
  allowedConnections: {}
})
```

- **`specificType`** -- the exact type name. This must match the `node_type` in the DTO and the key used in the constructor map. It is the identifier used when creating instances via the API.
- **`generalType`** -- a broader category. Often the same as `specificType` for simple entities. Used for polymorphic queries (e.g., "find all entities of general type X").
- **`allowedConnections`** -- defines which other entity types this entity can connect to in the entity graph. Empty for now; you'll use connections in later parts for pipeline orchestration.

### `AddMixins` vs. `ComposeMixins`

Entities use `AddMixins` instead of `ComposeMixins`:

| | ComposeMixins | AddMixins |
|---|---|---|
| **Used for** | Bots (creating from scratch) | Entities (extending a base class) |
| **Base class** | Created by the mixin composition | Provided as the first argument (`RunnableEntity`) |
| **Pattern** | `class Bot extends ComposeMixins(A, B)` | `class Entity extends AddMixins(Base, Mixin)` |
| **Why** | Bots have no single base -- they're built entirely from mixins | Entities always extend `RunnableEntity`, and mixins add behavior on top |

The `super()` call passes arguments to each layer:

```typescript
super(
  [factory, idOrDto],        // RunnableEntity args (base class)
  [new ContentSafetyBot()]   // BotRunnableEntityMixin args (the bot instance)
);
```

### `BotRunnableEntityMixin` and `get_bot_request_args_impl`

`BotRunnableEntityMixin` is the bridge between entity and bot. When the entity is started, the mixin:

1. Calls `get_bot_request_args_impl()` to get the bot's input
2. Passes those args to the `ContentSafetyBot`
3. The bot renders prompts, calls the LLM, validates the response
4. Returns the validated `CONTENT_SAFETY_OUTPUT`

The `get_bot_request_args_impl` method is where you map entity data to bot input:

```typescript
protected async get_bot_request_args_impl(
  _preArgs: Partial<BotRequestArgs<...>>
): Promise<BotRequestArgs<...>> {
  const dto = await this.get_dto();     // Read entity's stored data
  return {
    input: dto.data.topic,              // The topic text -> becomes user message
    context: new Context(),             // Empty context (extensible later)
    args: {}                            // No request args needed
  };
}
```

The `input` field becomes the user message to the LLM. In this case, it's the story topic the user submitted. The `context` provides runtime context (empty here), and `args` supplies per-request arguments defined in the `PromptTypeHelper` (also empty here since our prompt has no request args).

### The Complete Data Flow

```
ContentSafetyCheckEntity started
    |
    v
BotRunnableEntityMixin calls get_bot_request_args_impl()
    |
    v
Entity reads stored data: { topic: "A brave kitten's adventure" }
    |
    v
Returns { input: "A brave kitten's adventure", context, args: {} }
    |
    v
ContentSafetyBot renders: [ContentSafetyPrompt] + [Schema docs] + [topic text]
    |
    v
LLM returns JSON -> StructuredOutputBotMixin extracts + validates via Zod
    |
    v
Entity returns CONTENT_SAFETY_OUTPUT:
  { is_safe: true, safety_score: 95, concerns: [], reasoning: "..." }
```

---

## Step 7: Register the Entity

Add the entity to the constructor map so the bundle can instantiate it.

**`apps/story-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { ContentSafetyCheckEntity } from './entities/ContentSafetyCheckEntity.js';
import { StoryWriterEntity } from './entities/StoryWriterEntity.js';

export const StoryBundleConstructors = {
  ...FFConstructors,
  ContentSafetyCheckEntity: ContentSafetyCheckEntity,
  StoryWriterEntity: StoryWriterEntity,
} as const;
```

`FFConstructors` includes built-in entity types (like `ReviewStep`). You spread it and add your own. The key in the map (e.g., `ContentSafetyCheckEntity`) must match the `specificType` in the `@EntityMixin` decorator.

> **Note:** This constructor map also includes `StoryWriterEntity`, which you'll build in Part 2. If you're following along and building incrementally, you can omit `StoryWriterEntity` for now and add it in the next part. The import will cause a compile error until the file exists.

---

## Step 8: Build and Test

Build the project:

```bash
pnpm run build
```

Deploy to your cluster:

```bash
ff ops build --app-name story-bundle
ff ops deploy --app-name story-bundle
```

### Create a ContentSafetyCheckEntity

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ContentSafetyCheckEntity",
    "data": {
      "topic": "A brave kitten who learns to share with forest friends"
    }
  }' \
  --url http://localhost:3001
```

Note the returned `entity_id`.

### Start the Entity

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

You should see:

1. A `STATUS` event with `"status": "STARTED"`
2. `BOT_PROGRESS` events as the LLM generates tokens
3. A `VALUE` event containing the structured output:
   ```json
   {
     "is_safe": true,
     "safety_score": 95,
     "concerns": [],
     "reasoning": "The topic involves a kitten learning to share with forest friends, which promotes positive values of friendship and generosity. No safety concerns identified."
   }
   ```
4. A `STATUS` event with `"status": "COMPLETED"`

### Test with an Unsafe Topic

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ContentSafetyCheckEntity",
    "data": {
      "topic": "A zombie apocalypse with graphic battles"
    }
  }' \
  --url http://localhost:3001
```

Start this entity and observe that `is_safe` is `false`, `safety_score` is low, and `concerns` lists the specific issues found.

### Inspect with Diagnostic Tools

```bash
# View the entity's stored data
ff-eg-read node get <entity-id>

# Check the return value
ff-eg-read node io <entity-id>

# Review the progress envelopes
ff-eg-read node progress <entity-id>

# See the actual prompt sent to the LLM (including injected schema)
ff-telemetry-read broker-requests --entity-id <entity-id>
```

The `broker-requests` output will show the full prompt, including the schema documentation that `StructuredOutputBotMixin` injected. This is useful for verifying that the schema and prompt sections appear correctly.

---

## What You've Built

You now have:
- A scaffolded monorepo project with the application and bundle configuration
- A Zod schema (`ContentSafetySchema`) with field-level `.describe()` annotations and `withSchemaMetadata` naming
- A structured prompt class (`ContentSafetyPrompt`) with context, task, and rules sections
- A bot (`ContentSafetyBot`) that composes `MixinBot` and `StructuredOutputBotMixin` for validated structured output
- An entity (`ContentSafetyCheckEntity`) that bridges entity data to bot requests via `BotRunnableEntityMixin`
- A working content safety pipeline: entity data -> bot request -> LLM call -> Zod validation -> typed result

---

## Key Takeaways

1. **`withSchemaMetadata` wraps a Zod schema with a name and description** -- these appear as the header of the schema documentation in the LLM prompt. The `StructuredOutputBotMixin` reads them automatically; you never format the schema into the prompt yourself.

2. **`StructuredOutputBotMixin` automates schema-to-prompt and validation** -- it injects schema documentation into the prompt, extracts JSON from the LLM response, and validates it with `safeParse`. You define a schema once and get both prompt injection and output validation for free.

3. **`ComposeMixins` builds bots from scratch; `AddMixins` extends entities** -- bots have no single base class and are composed entirely from mixins. Entities always extend `RunnableEntity`, and mixins like `BotRunnableEntityMixin` add behavior on top.

4. **`BotRunnableEntityMixin` makes "run entity = run bot"** -- it calls `get_bot_request_args_impl()` to get input from the entity's stored data, passes it to the bot, and returns the bot's validated output.

5. **`@RegisterBot`, `@RegisterPrompt`, and `@EntityMixin` register components** -- each decorator makes its class discoverable by the framework. The name strings must be unique and consistent (the entity's `specificType` must match its constructor map key).

6. **The type helper chain provides end-to-end type safety** -- `PromptTypeHelper` -> `BotTypeHelper` -> `EntityNodeTypeHelper` -> `RunnableEntityTypeHelper` connects prompt input shapes, bot output types, entity DTO shapes, and run return types. Changing the Zod schema propagates type changes through the entire chain.

7. **`.describe()` on Zod fields is your primary schema-prompting tool** -- every description becomes a direct instruction in the LLM prompt. Write them as actionable instructions ("Whether the topic is safe...") not passive documentation ("Safety flag").

---

## Next Steps

In [Part 2: Story Writer Bot & Prompts](./part-02-story-writer.md), you'll create the `StoryWriterBot` that generates an illustrated HTML story with `{{IMAGE_N}}` placeholders for images. You'll learn complex prompt engineering with HTML output formatting, prompt composition with multiple template sections, and how the story writer schema structures a multi-part creative output.
