# Part 2: Story Writer Bot & Prompts

In this part, you'll create the `StoryWriterBot` -- the creative core of the storybook pipeline. This bot takes a topic and produces a complete illustrated children's story as structured HTML with image placeholders and matching image generation prompts.

**What you'll learn:**
- Complex prompt composition with multiple semantic sections
- Using `PromptTemplateListNode` for numbered rule lists within prompt sections
- Designing rich Zod schemas with nested objects, arrays, and defensive defaults
- The HTML-with-placeholders pattern for post-processing LLM output
- Producing dual output (narrative content + metadata) in a single LLM call

**What you'll build:** A `StoryWriterBot` that generates an illustrated story as structured output containing HTML (with `{{IMAGE_N}}` placeholders), image generation prompts for each placeholder, and story metadata -- all validated against a Zod schema. Plus the `StoryWriterEntity` that drives it.

**Starting point:** Completed code from [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md). You should have a scaffolded project with a working `ContentSafetyBot` and its entity.

---

## Concepts: Dual Output and the Placeholder Pattern

Before writing code, understand the design pattern this part introduces.

The StoryWriterBot needs to produce two very different kinds of output in a single LLM call:

| Output | Purpose | Example |
|--------|---------|---------|
| **Narrative content** | The story itself, as styled HTML | `<div class="scene"><h2>Chapter 1</h2><p>Once upon a time...</p></div>` |
| **Metadata** | Image generation prompts, title, moral, age range | `{ placeholder: "{{IMAGE_1}}", prompt: "A small rabbit in a meadow..." }` |

The trick is the **placeholder pattern**. The LLM generates HTML with tokens like `{{IMAGE_1}}`, `{{IMAGE_2}}`, etc. where illustrations should appear. Alongside the HTML, it produces a matching array of image generation prompts, one per placeholder. In a later pipeline stage (Part 3), you will replace each placeholder with an actual generated image.

This pattern has a key advantage: the LLM can focus on storytelling and art direction in one pass, without needing to know how images are actually generated or encoded. The pipeline handles the mechanical work of image generation and assembly separately.

---

## Step 1: Create the Story Writer Prompt

The `StoryWriterPrompt` is significantly more complex than the `ContentSafetyPrompt` from Part 1. It has five sections that together instruct the LLM to act as both a storyteller and an illustration director.

**`apps/story-bundle/src/prompts/StoryWriterPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  RegisterPrompt,
} from '@firebrandanalytics/ff-agent-sdk';

type STORY_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

@RegisterPrompt('StoryWriterPrompt')
export class StoryWriterPrompt extends Prompt<STORY_PTH> {
  constructor(
    role: 'system' | 'user' | 'assistant',
    options?: STORY_PTH['options']
  ) {
    super(role, options ?? {});
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Task_Section());
    this.add_section(this.get_Format_Section());
    this.add_section(this.get_ImagePrompt_Section());
    this.add_section(this.get_Rules_Section());
  }

  protected get_Context_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        'You are a master children\'s storyteller and illustration director.',
        'You create engaging, beautifully written stories for children aged 3-10.',
        'You also direct the illustration process by writing detailed image generation prompts.',
      ]
    });
  }

  protected get_Task_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Task:',
      children: [
        'Write a complete, illustrated children\'s story based on the provided topic.',
        'The story should have 3-5 scenes, each with an accompanying illustration.',
        'Write the story as HTML with embedded CSS styling for a storybook look.',
        'Use {{IMAGE_1}}, {{IMAGE_2}}, etc. as placeholders where illustrations should appear.',
        'For each placeholder, provide a detailed image generation prompt.',
      ]
    });
  }

  protected get_Format_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'HTML Format Requirements:',
      children: [
        'Include complete HTML with DOCTYPE, head (with embedded CSS), and body',
        'Use a warm, storybook-style design: serif fonts, soft pastel background, rounded image frames',
        'Each scene: a heading, story paragraph(s), and image placeholder in a <div class="illustration">{{IMAGE_N}}</div>',
        'Add CSS page-break-after between scenes for clean PDF output',
        'Include a title page with the story title and cover illustration ({{IMAGE_1}})',
        'End with the moral on its own page, styled distinctly',
        'Images should be styled as: max-width: 100%, border-radius, centered, with a subtle shadow',
      ]
    });
  }

  protected get_ImagePrompt_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Image Prompt Guidelines:',
      children: [
        'Write detailed, vivid prompts suitable for AI image generation',
        'Always include the art style: "children\'s book illustration, watercolor style, warm and inviting colors, soft lighting"',
        'Describe the scene composition, characters, setting, and mood',
        'Maintain visual consistency — describe recurring characters the same way each time',
        'Keep prompts family-friendly and whimsical',
        'Each prompt should be 2-3 sentences long',
      ]
    });
  }

  protected get_Rules_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Story Writing Rules:',
      children: [
        new PromptTemplateListNode<STORY_PTH>({
          semantic_type: 'rule',
          children: [
            'Use simple, clear language appropriate for the target age range',
            'Create vivid descriptions that engage the senses and imagination',
            'Include natural dialogue that children can understand',
            'Structure with a clear beginning, middle, and end',
            'Weave positive themes naturally — do not preach',
            'Make characters relatable and memorable',
            'The moral should emerge from the story, not be stated didactically',
          ],
          list_label_function: (_req: any, _child: any, idx: number) => `${idx + 1}. `
        })
      ]
    });
  }
}
```

### Prompt Architecture: Five Sections

Compare this to the `ReportGenerationPrompt` from the report-generator tutorial, which also has five sections. The structure is the same -- what changes is the domain content:

| Section | Semantic Type | Purpose |
|---------|---------------|---------|
| **Context** | `context` | Establishes the LLM's persona: storyteller + illustration director |
| **Task** | `rule` | Defines the deliverable: HTML story with image placeholders |
| **Format** | `rule` | Specifies HTML structure, CSS styling, and page layout |
| **ImagePrompt** | `rule` | Guides the quality and consistency of image generation prompts |
| **Rules** | `rule` | Numbered list of storytelling craft rules |

Each section is a separate protected method. This means you can subclass `StoryWriterPrompt` and override individual sections -- for example, creating a `ScaryStoryWriterPrompt` that overrides only the Context section to change the persona while keeping all other sections intact.

### `PromptTemplateListNode` vs. Flat Children

Notice that most sections use flat string children:

```typescript
// Flat children -- rendered as separate lines
children: [
  'Write detailed, vivid prompts suitable for AI image generation',
  'Always include the art style: ...',
  'Describe the scene composition, characters, setting, and mood',
]
```

But the Rules section wraps its children in a `PromptTemplateListNode`:

```typescript
// Numbered list -- rendered with "1. ", "2. ", etc.
children: [
  new PromptTemplateListNode<STORY_PTH>({
    semantic_type: 'rule',
    children: [
      'Use simple, clear language appropriate for the target age range',
      'Create vivid descriptions that engage the senses and imagination',
      // ...
    ],
    list_label_function: (_req: any, _child: any, idx: number) => `${idx + 1}. `
  })
]
```

The `list_label_function` receives three arguments: the request object, the child content, and the zero-based index. It returns a string prefix for each item. Here it produces numbered labels (`1. `, `2. `, etc.), but you could use bullets, letters, or any custom format.

When should you use a list node vs. flat children? Use `PromptTemplateListNode` when the items form a coherent ordered set that the LLM should treat as enumerated rules. Use flat children when items are independent instructions that happen to appear in the same section. The numbered formatting helps the LLM understand these are distinct, countable requirements.

### `@RegisterPrompt` Decorator

The `@RegisterPrompt('StoryWriterPrompt')` decorator registers the prompt class with the framework by name. This enables the prompt to be discovered in the prompt registry, which is useful for debugging and telemetry -- you can see which prompt class was used in a given LLM call.

---

## Step 2: Define the Output Schema

The StoryWriterBot needs to return a rich structured object: not just HTML, but also image prompts, a title, a moral, and an age range. This is where Zod schemas become powerful.

**`apps/story-bundle/src/schemas.ts`** (add the story output schema alongside the existing content safety schema):

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

// ... (ContentSafetyOutputSchema from Part 1 remains here) ...

/**
 * Output schema for the Story Writer Bot.
 *
 * This schema is significantly richer than the content safety schema:
 * - Nested objects (each image prompt has placeholder, prompt, alt_text)
 * - Arrays of objects (image_prompts is a variable-length list)
 * - Optional fields with defaults (alt_text)
 * - Multiple top-level fields for different kinds of output
 */
export const StoryOutputSchema = withSchemaMetadata(
  z.object({
    title: z.string()
      .describe('The story title'),
    html_content: z.string()
      .describe('Complete HTML story with {{IMAGE_1}}, {{IMAGE_2}} etc. placeholders where illustrations should appear. Include embedded CSS for storybook styling.'),
    image_prompts: z.array(z.object({
      placeholder: z.string()
        .describe('The placeholder string used in the HTML, e.g. {{IMAGE_1}}'),
      prompt: z.string()
        .describe('Detailed image generation prompt for this scene illustration'),
      alt_text: z.string().optional().default('Story illustration')
        .describe('Short alt text describing the illustration'),
    }))
      .describe('Image generation prompts for each placeholder in the HTML'),
    moral: z.string()
      .describe('The moral or lesson of the story'),
    age_range: z.string()
      .describe('Target age range, e.g. "3-7 years"'),
  }),
  'StoryOutput',
  'An illustrated children\'s story with image placeholders and generation prompts'
);

export type STORY_OUTPUT = z.infer<typeof StoryOutputSchema>;
```

### Rich Schema Design

This schema is more complex than the report-generator's `ReportOutputSchema` (which had just `reasoning` and `html_content`). Let's break down the notable patterns:

**Nested objects in arrays:**

```typescript
image_prompts: z.array(z.object({
  placeholder: z.string(),
  prompt: z.string(),
  alt_text: z.string().optional().default('Story illustration'),
}))
```

The `image_prompts` field is an array of objects. Each object has three fields. The `StructuredOutputBotMixin` renders this as nested schema documentation, so the LLM understands it needs to produce a JSON array where each element has `placeholder`, `prompt`, and `alt_text` fields.

**The `alt_text` lesson -- optional with defaults:**

```typescript
alt_text: z.string().optional().default('Story illustration')
  .describe('Short alt text describing the illustration'),
```

Why `z.string().optional().default('Story illustration')` instead of just `z.string()`?

This is a defensive pattern for working with LLM output. When a schema has many fields, LLMs sometimes omit fields that feel "secondary" or "optional" to them -- even if the schema marks them as required. `alt_text` is exactly the kind of field an LLM might skip: it is supplementary to the main `prompt` field, and the name itself suggests it is an alternative.

By making it `.optional().default('Story illustration')`, you get two benefits:
1. **Validation succeeds** even if the LLM omits the field entirely
2. **A sensible default** is filled in, so downstream code always has a value

This is a general principle: for fields that are "nice to have" but not critical to your pipeline, prefer `.optional().default(...)` over `.string()`. Reserve strict required fields for data your pipeline cannot function without (like `html_content` and `placeholder`).

**Multiple top-level fields for different purposes:**

| Field | Purpose | Used by |
|-------|---------|---------|
| `title` | Display name for the story | UI, PDF title page |
| `html_content` | The actual story content | Image assembly (Part 3), PDF generation |
| `image_prompts` | Instructions for image generation | Image generation service (Part 3) |
| `moral` | Story's lesson | Could be displayed separately in UI |
| `age_range` | Content classification | UI metadata, content filtering |

This "dual output" pattern -- producing both content and metadata in a single call -- is more efficient than making separate LLM calls for the story and the image prompts. The LLM writes the story and the image prompts together, which means the prompts naturally match the story content. If you split this into two calls, you would need to pass the full story HTML to a second call for image prompt extraction, adding latency and token cost.

---

## Step 3: Create the Story Writer Bot

The bot follows the same `ComposeMixins(MixinBot, StructuredOutputBotMixin)` pattern you saw in the report-generator tutorial. The difference is the prompt and schema.

**`apps/story-bundle/src/bots/StoryWriterBot.ts`**:

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
import { StoryWriterPrompt } from '../prompts/StoryWriterPrompt.js';
import { StoryOutputSchema, STORY_OUTPUT } from '../schemas.js';

type STORY_PROMPT_INPUT = string;
type STORY_PROMPT_ARGS = { static: {}; request: {} };

export type STORY_PTH = PromptTypeHelper<STORY_PROMPT_INPUT, STORY_PROMPT_ARGS>;
export type STORY_BTH = BotTypeHelper<STORY_PTH, STORY_OUTPUT>;

@RegisterBot('StoryWriterBot')
export class StoryWriterBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<STORY_BTH, [StructuredOutputBotMixin<STORY_BTH, typeof StoryOutputSchema>]>,
  [StructuredOutputBotMixin<STORY_BTH, typeof StoryOutputSchema>]
]> {
  constructor() {
    const promptGroup = new StructuredPromptGroup<STORY_PTH>({
      base: new PromptGroup([
        {
          name: "story_writer_system",
          prompt: new StoryWriterPrompt('system', {}) as any
        }
      ]),
      input: new PromptGroup([
        {
          name: "user_input",
          prompt: new PromptInputText({})
        }
      ]),
    });

    const config: MixinBotConfig<STORY_BTH> = {
      name: "StoryWriterBot",
      base_prompt_group: promptGroup,
      model_pool_name: "firebrand-gpt-5.2-failover",
      static_args: {}
    };

    super(
      [config],
      [{ schema: StoryOutputSchema }],
    );
  }

  override get_semantic_label_impl(_request: BotTryRequest<STORY_BTH>): string {
    return "StoryWriterBotSemanticLabel";
  }
}
```

### Comparing to the Report Generator Bot

If you completed the report-generator tutorial, this structure should be familiar. Here is what is the same and what is different:

| Aspect | Report Generator | Story Writer |
|--------|-----------------|--------------|
| **Mixin composition** | `ComposeMixins(MixinBot, StructuredOutputBotMixin)` | Same |
| **Prompt type** | `PromptInputText` (plain string, Part 2) then `ReportGenerationPrompt` (Part 3) | `StoryWriterPrompt` from the start |
| **Prompt args** | `{ static: {}; request: { plain_text, orientation } }` | `{ static: {}; request: {} }` |
| **Schema complexity** | 2 fields (reasoning, html_content) | 5 fields with nested array of objects |
| **Model pool** | `firebrand_completion_default` | `firebrand-gpt-5.2-failover` |

Note that `STORY_PROMPT_ARGS` has empty `static` and `request` objects. The StoryWriterBot does not use per-request prompt arguments because all the context the LLM needs comes from the user input (the topic). In the report-generator, the bot needed `plain_text` and `orientation` as request args because the prompt had conditional rendering based on those values. The StoryWriterPrompt has no lambdas or conditional logic -- it is fully static -- so no request args are needed.

### Prompt Assembly

When the bot prepares a request to the LLM, the prompt assembly produces this message sequence:

```
1. System message: StoryWriterPrompt (5 sections rendered in order)
   |-- Context: persona and capabilities
   |-- Task: deliverable definition
   |-- HTML Format Requirements: structural requirements
   |-- Image Prompt Guidelines: art direction rules
   |-- Story Writing Rules: 1-7 numbered craft rules

2. System message: Schema documentation (injected by StructuredOutputBotMixin)
   |-- "Output your response using the following schema..."
   |-- Field descriptions from StoryOutputSchema

3. User message: The topic string
   |-- "Write an illustrated children's story about: <topic>"
```

The LLM receives a clear separation between what it is (Context), what it should do (Task, Format, ImagePrompt, Rules), what format to use (Schema), and what the user wants (Input). This layered structure consistently produces better output than putting everything in a single system message.

---

## Step 4: Create the Story Writer Entity

The entity bridges the pipeline's stored state to the bot's request interface. When the entity runs, it reads its `topic` from the entity graph, formats it into a bot request, and delegates to the `StoryWriterBot`.

**`apps/story-bundle/src/entities/StoryWriterEntity.ts`**:

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
import { STORY_BTH, StoryWriterBot } from '../bots/StoryWriterBot.js';
import { STORY_OUTPUT } from '../schemas.js';
import { StoryBundleConstructors } from '../constructors.js';

interface StoryWriterDTOData {
  topic: string;
  [key: string]: any;
}

type StoryWriterDTO = EntityInstanceNodeDTO<StoryWriterDTOData> & {
  node_type: "StoryWriterEntity";
};

type StoryWriterENH = EntityNodeTypeHelper<
  EntityTypeHelper<STORY_BTH, typeof StoryBundleConstructors>,
  StoryWriterDTO,
  'StoryWriterEntity',
  {},
  {}
>;

type StoryWriterRETH = RunnableEntityTypeHelper<
  StoryWriterENH,
  STORY_OUTPUT
>;

@EntityMixin({
  specificType: 'StoryWriterEntity',
  generalType: 'StoryWriterEntity',
  allowedConnections: {}
})
export class StoryWriterEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<StoryWriterRETH>,
  BotRunnableEntityMixin<StoryWriterRETH>
]> {
  constructor(
    factory: EntityFactory<StoryWriterENH['eth']>,
    idOrDto: UUID | StoryWriterDTO
  ) {
    super(
      [factory, idOrDto],
      [new StoryWriterBot()]
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<StoryWriterRETH['enh']['eth']['bth']>>
  ): Promise<BotRequestArgs<StoryWriterRETH['enh']['eth']['bth']>> {
    const dto = await this.get_dto();
    return {
      input: `Write an illustrated children's story about: ${dto.data.topic}`,
      context: new Context(),
      args: {} as STORY_BTH['pth']['args']['request']
    };
  }
}
```

### The Data Flow

```
StoryWriterEntity started
    |
    v
BotRunnableEntityMixin calls get_bot_request_args_impl()
    |
    v
Entity reads dto.data.topic from the entity graph
    |
    v
Returns { input: "Write an illustrated children's story about: <topic>", context, args: {} }
    |
    v
StoryWriterBot renders StoryWriterPrompt (5 sections) + schema docs + user input
    |
    v
LLM generates JSON with title, html_content, image_prompts[], moral, age_range
    |
    v
StructuredOutputBotMixin validates against StoryOutputSchema
    |
    v
Entity returns STORY_OUTPUT
```

Note how simple `get_bot_request_args_impl` is compared to the report-generator version. The report entity had to pass `plain_text`, `orientation`, and a separate `user_prompt` as request args because the prompt used lambdas to render conditional content. Here, the topic is embedded directly in the `input` string, and the prompt is fully static, so `args` is empty.

### Minimal DTO Data

The `StoryWriterDTOData` interface only requires `topic`:

```typescript
interface StoryWriterDTOData {
  topic: string;
  [key: string]: any;
}
```

The `[key: string]: any` index signature allows the pipeline orchestrator (Part 4) to store additional data on the entity -- like the bot's output, pipeline status, or generated image URLs -- without changing the interface. This is a common pattern for entities that participate in multi-stage pipelines.

---

## Step 5: Register the Entity

Add `StoryWriterEntity` to the constructor map alongside the `ContentSafetyCheckEntity` from Part 1.

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

---

## Step 6: Build and Deploy

```bash
pnpm run build
ff ops build --app-name story-bundle
ff ops deploy --app-name story-bundle
```

---

## Step 7: Test with ff-sdk-cli

### Create a StoryWriterEntity

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "StoryWriterEntity",
    "data": {
      "topic": "a brave little rabbit who learns to share"
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
2. `BOT_PROGRESS` events as the LLM generates tokens (this will take longer than the content safety bot -- story generation produces significantly more output)
3. A `VALUE` event containing the structured output:
   ```json
   {
     "title": "Rosie the Rabbit Learns to Share",
     "html_content": "<!DOCTYPE html><html>...<div class=\"illustration\">{{IMAGE_1}}</div>...",
     "image_prompts": [
       {
         "placeholder": "{{IMAGE_1}}",
         "prompt": "A small white rabbit with pink ears standing in a sunny meadow...",
         "alt_text": "Rosie the rabbit in a meadow"
       },
       {
         "placeholder": "{{IMAGE_2}}",
         "prompt": "The white rabbit looking sadly at a pile of carrots while...",
         "alt_text": "Story illustration"
       }
     ],
     "moral": "Sharing brings more joy than keeping things to yourself",
     "age_range": "3-7 years"
   }
   ```
4. A `STATUS` event with `"status": "COMPLETED"`

### Verify the Output Structure

Check several things in the returned `STORY_OUTPUT`:

1. **Placeholder-prompt alignment**: Every `{{IMAGE_N}}` in `html_content` should have a matching entry in `image_prompts` with the same `placeholder` value. If the LLM generates `{{IMAGE_1}}` through `{{IMAGE_4}}` in the HTML, there should be four entries in the `image_prompts` array.

2. **HTML completeness**: The `html_content` should start with `<!DOCTYPE html>` and include a `<style>` tag with CSS.

3. **alt_text defaults**: Some entries may have `"alt_text": "Story illustration"` (the Zod default) if the LLM omitted the field. Others may have descriptive alt text if the LLM provided it.

### Inspect with Diagnostic Tools

```bash
# Get the entity's return value
ff-eg-read node io <entity-id>

# Review progress envelopes
ff-eg-read node progress <entity-id>

# See the full LLM request including rendered prompt and schema docs
ff-telemetry-read broker-requests --entity-id <entity-id>
```

The `ff-telemetry-read` output is especially informative here. You should see the five prompt sections rendered in order, followed by the schema documentation that `StructuredOutputBotMixin` injected. This lets you verify that the LLM received all the instructions you intended.

---

## Design Decisions Explained

### Why Not Include a "Reasoning" Field?

The report-generator schema included a `reasoning` field before `html_content` to improve output quality through chain-of-thought. The StoryWriterBot omits this. Why?

The story writer's prompt is already highly structured with five detailed sections. The LLM has enough guidance to produce quality output without an explicit reasoning step. Additionally, story generation produces large output (full HTML + multiple image prompts), and adding a reasoning field would increase token usage significantly. For bots that produce shorter, more analytical output, a reasoning field is valuable. For creative generation with heavy prompt guidance, it is less necessary.

### Why Static Prompts (No Lambdas)?

The `StoryWriterPrompt` has no lambda functions -- every child is a static string. Compare this to the `ReportGenerationPrompt`, which used lambdas for conditional layout instructions based on orientation.

The story writer does not need conditional rendering because every story gets the same instructions regardless of the topic. The topic comes in through the user input message, not through prompt args. If you later wanted to support different story styles (fairy tale vs. adventure vs. educational), you could add prompt args and lambda-based conditional sections, or you could subclass `StoryWriterPrompt` and override specific sections.

### Why One LLM Call Instead of Two?

An alternative design would split this into two calls:
1. Call 1: Generate the story HTML
2. Call 2: Read the HTML and generate image prompts

The single-call approach is better because:
- **Coherence**: The LLM writes the image prompts while the story is fresh in its context. A second call would need to re-parse the HTML.
- **Efficiency**: One call instead of two halves the latency and reduces total token usage.
- **Consistency**: The LLM can ensure placeholder positions and prompt descriptions align naturally.

The tradeoff is a more complex schema, but `StructuredOutputBotMixin` handles schema injection and validation automatically, so the complexity is manageable.

---

## What You've Built

You now have:
- A `StoryWriterPrompt` with five organized sections covering persona, task, format, art direction, and writing craft
- A `StoryOutputSchema` with nested objects, arrays, and defensive optional defaults
- A `StoryWriterBot` that produces dual output (narrative HTML + image metadata) in a single LLM call
- A `StoryWriterEntity` that bridges pipeline state to the bot
- Two registered entity types in the constructor map (ContentSafetyCheckEntity + StoryWriterEntity)

The pipeline so far:

```
User sends topic
    |
    v
Stage 1: ContentSafetyCheckEntity (Part 1)
    |  validates topic is child-appropriate
    v
Stage 2: StoryWriterEntity (this part)
    |  generates HTML story + image prompts
    v
Stage 3: Image generation (Part 3)
    |  generates actual images, replaces placeholders
    v
...
```

---

## Key Takeaways

1. **Complex prompts are just more sections** -- the `Prompt` class scales from one section to many. Each section is a separate method, keeping the prompt readable and extensible through subclassing.

2. **`PromptTemplateListNode` formats enumerated rules** -- use it when items form a coherent ordered set. The `list_label_function` gives you control over numbering format. Use flat children for independent instructions.

3. **Design schemas defensively for LLM output** -- use `.optional().default(...)` for fields the LLM might omit. Reserve strict required fields for data your pipeline cannot function without.

4. **The placeholder pattern decouples content from assets** -- `{{IMAGE_N}}` tokens in HTML let the LLM focus on storytelling while a later pipeline stage handles image generation. This separation of concerns makes each stage independently testable.

5. **Dual output in a single call improves coherence and efficiency** -- producing both narrative content and metadata (image prompts, title, moral) in one LLM call ensures alignment and reduces latency compared to multi-call approaches.

6. **Empty prompt args are fine** -- not every bot needs per-request prompt arguments. When the prompt is fully static and all context comes through the user input string, `{ static: {}; request: {} }` is the right choice.

---

## Next Steps

The StoryWriterBot produces HTML with `{{IMAGE_1}}`, `{{IMAGE_2}}` etc. placeholders, but those are still just text tokens. In [Part 3: Image Generation Service](./part-03-image-generation.md), you'll build the service that takes each image prompt, calls the broker's `generateImage()` API, retrieves the generated images from blob storage, encodes them as base64, and replaces the placeholders with actual `<img>` tags -- turning the story into a fully illustrated HTML document.
