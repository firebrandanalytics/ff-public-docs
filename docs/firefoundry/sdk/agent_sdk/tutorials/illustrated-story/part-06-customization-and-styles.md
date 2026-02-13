# Part 6: Customization Types & Style Selection

In this part, you'll add user-facing customization to the storybook pipeline. Instead of hardcoding a single illustration style, image quality, and age range, the user can now choose from six illustration styles, three quality levels, five aspect ratios, and a custom age range. These options are defined as shared types, threaded through entity data and bot request args, and consumed dynamically by the `StoryWriterPrompt` -- which adapts its instructions based on the user's choices.

**What you'll learn:**
- Defining constrained option types with TypeScript union types and const maps
- Adding a `StoryCustomization` interface to the shared types package
- Using `STYLE_DESCRIPTIONS` to map user-facing style names to detailed image generation prompt text
- Making prompt sections dynamic with lambda children that read from request args at render time
- Threading customization through the data flow: API request -> entity data -> bot request args -> prompt template
- Updating the Zod output schema to prepare for reference image support (Part 7)

**What you'll build:** A shared customization type system, an updated `StoryWriterPrompt` that dynamically adapts its context, task, and image prompt sections based on the user's style and age range choices, and updated entities and API endpoints that pass customization through the pipeline.

**Starting point:** Completed code from [Part 5: Parallel Image Generation](./part-05-parallel-image-generation.md). You should have a working pipeline with entity-based parallel image generation, capacity management, and the `ImageGenerationEntity`.

---

## Concepts: Customization as a Cross-Cutting Concern

Customization touches almost every layer of the pipeline. Understanding how data flows through the system clarifies why changes are needed in multiple files:

```
User sends { topic, customization }
       |
       v
POST /api/create-story
       |  (agent-bundle.ts stores customization in entity data)
       v
StoryPipelineEntity.run_impl()
       |  (reads customization from dto.data, passes to child entities)
       |
       |-- StoryWriterEntity (receives customization in dto.data)
       |     |-- get_bot_request_args_impl() puts customization in request args
       |     |-- StoryWriterBot passes request args to StoryWriterPrompt
       |     |-- StoryWriterPrompt reads style, age_range, illustration_count
       |     |-- Prompt dynamically adjusts Context, Task, ImagePrompt sections
       |
       |-- ImageGenerationEntity (receives image_quality, aspect_ratio in dto.data)
             |-- Maps quality/ratio to broker enums (already done in Part 5)
```

The customization values originate at the API boundary and sink through four layers before reaching the prompt text that the LLM sees. This part traces that path from bottom to top: first define the types, then update the prompt, then wire the entities, and finally update the API.

---

## Step 1: Define Customization Types

Add the customization types to the shared types package. These types are used by the API layer (to validate input), the entities (to store and pass data), and the prompt (to read values for dynamic sections).

**`packages/shared-types/src/index.ts`** (add these alongside existing types):

```typescript
// ─── Illustration style options ───────────────────────────

export type IllustrationStyle =
  | 'watercolor'
  | 'digital-art'
  | 'colored-pencil'
  | 'storybook-classic'
  | 'anime'
  | 'paper-cutout';

export type ImageQualityLevel = 'low' | 'medium' | 'high';

export type AspectRatioOption = '1:1' | '3:2' | '2:3' | '4:3' | '16:9';

// ─── Customization interface ──────────────────────────────

export interface StoryCustomization {
  style?: IllustrationStyle;
  image_quality?: ImageQualityLevel;
  age_range?: string;
  illustration_count?: number;
  aspect_ratio?: AspectRatioOption;
  reference_image_base64?: string;
}

// ─── Style-to-prompt mapping ──────────────────────────────

export const STYLE_DESCRIPTIONS: Record<IllustrationStyle, string> = {
  'watercolor':
    "children's book illustration, watercolor style, warm and inviting colors, soft lighting, gentle brush strokes, dreamy atmosphere",
  'digital-art':
    "children's book illustration, modern digital art style, vibrant colors, clean lines, polished rendering, bright and cheerful",
  'colored-pencil':
    "children's book illustration, colored pencil style, soft textured strokes, warm earth tones, hand-drawn feel, gentle shading",
  'storybook-classic':
    "classic children's book illustration, reminiscent of Beatrix Potter or Maurice Sendak, detailed pen and ink with watercolor wash, timeless charm",
  'anime':
    "children's book illustration, anime-inspired style, large expressive eyes, pastel colors, soft shading, kawaii aesthetic",
  'paper-cutout':
    "children's book illustration, paper cutout collage style, layered paper textures, bold flat colors, craft-like appearance, whimsical",
};
```

Then update the existing `CreateStoryRequest` and `StoryEntityData` interfaces to include the new customization field:

```typescript
export interface CreateStoryRequest {
  topic: string;
  customization?: StoryCustomization;
}

export interface StoryEntityData {
  topic: string;
  customization?: StoryCustomization;
  [key: string]: any;
}
```

### Why Union Types Instead of Enums

TypeScript enums (`enum IllustrationStyle { Watercolor = 'watercolor', ... }`) would work, but union types have three advantages for this use case:

| Concern | Union Type | Enum |
|---------|-----------|------|
| **Serialization** | JSON-native -- `'watercolor'` serializes as-is | Requires `IllustrationStyle.Watercolor` in code, serializes as `'watercolor'` -- two representations |
| **API boundary** | Request body contains `"style": "watercolor"` -- TypeScript validates directly | Must parse string to enum value, handle invalid values manually |
| **Bundle size** | Zero runtime overhead -- types are erased at compile time | Enums generate runtime JavaScript objects |

For options that cross the API boundary (user sends JSON, server validates, prompt reads the value), union types are the simpler choice. The type system enforces the constraint at compile time, and the values work as plain strings everywhere.

### The `STYLE_DESCRIPTIONS` Map

This is the bridge between user-facing style names and image generation prompts. When a user selects `'watercolor'`, the prompt does not just say "watercolor" -- it says:

> children's book illustration, watercolor style, warm and inviting colors, soft lighting, gentle brush strokes, dreamy atmosphere

This level of detail is necessary because image generation models respond better to rich, descriptive prompts than to single-word style labels. The `STYLE_DESCRIPTIONS` map centralizes these descriptions so they are consistent across all image prompts in a story.

Each description follows a pattern:

1. **Domain anchor**: `"children's book illustration"` -- tells the model this is for a children's book, not a random art piece
2. **Style identifier**: `"watercolor style"` or `"anime-inspired style"` -- the core style
3. **Visual attributes**: `"warm and inviting colors, soft lighting"` -- specific qualities that reinforce the style
4. **Mood/feel**: `"dreamy atmosphere"` or `"timeless charm"` -- the emotional quality

### All Fields Are Optional

Every field in `StoryCustomization` is optional. This means existing API callers (from Parts 1-5) continue to work without changes -- they send `{ topic: "..." }` and the pipeline uses sensible defaults. New callers can provide any subset of customization options. The defaults are applied at the prompt level (Step 2) and the entity level (Step 4).

### The `reference_image_base64` Field

This field is declared but not used in this part. It prepares for Part 7, where users can upload a reference image (e.g., a character sketch) that influences the generated illustrations. Declaring the field now means the `StoryCustomization` interface is stable -- Part 7 adds behavior without changing the type.

---

## Step 2: Update the StoryWriterPrompt for Dynamic Customization

The Part 2 `StoryWriterPrompt` was fully static -- every story got the same prompt regardless of user preferences. Now, the prompt reads customization values from request args at render time and adapts three of its six sections dynamically.

### Options vs Request Args

Prompt nodes receive data through two distinct channels:

| Channel | When Set | Lifetime | Access Pattern |
|---------|----------|----------|----------------|
| **Options** (`this.options`) | Construction time | Fixed for the prompt's lifetime | Direct property access in any method |
| **Request args** (`request.args`) | Render time | Varies per bot invocation | Lambda children that receive `PromptNodeRequest` |

**Options** are for static configuration -- pre-configuring a prompt template that never changes. For example, if you always wanted watercolor style, you could bake it in at construction time.

**Request args** are for per-request data. Since customization varies per user request, this is the correct channel. The bot constructs the prompt once with `new StoryWriterPrompt('system', {})` -- empty options -- and reuses it across requests. The customization data arrives later, at render time, through request args.

### Lambda Children (The Implementation)

The SDK supports **lambda children** -- functions that receive the `PromptNodeRequest` at render time and return a string. Any child in a section's `children` array can be either a static string or a `(request) => string` function (the `Basic_Render_Function` type). The full union type for children is `PromptTemplateNodeChild`, which is `PromptTemplateNode | string | Basic_Render_Function`.

At render time, the SDK iterates through each section's children. Static strings are used as-is. Lambda functions are called with the current `PromptNodeRequest`, whose `args` field carries the per-request data -- in this case, `{ customization?: StoryCustomization }`.

**`apps/story-bundle/src/prompts/StoryWriterPrompt.ts`** (complete updated file):

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  RegisterPrompt,
} from '@firebrandanalytics/ff-agent-sdk';
import type { IllustrationStyle, StoryCustomization } from '@shared/types';
import { STYLE_DESCRIPTIONS } from '@shared/types';

// ─── Type helper: request args now carry customization ─────

export interface StoryWriterPromptArgs {
  static: {};
  request: {
    customization?: StoryCustomization;
  };
}

type STORY_PTH = PromptTypeHelper<string, StoryWriterPromptArgs>;

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
    this.add_section(this.get_ReferenceImage_Section());
    this.add_section(this.get_Rules_Section());
  }

  // ─── Prompt sections ─────────────────────────────────────

  protected get_Context_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        'You are a master children\'s storyteller and illustration director.',
        (request) => {
          const ageRange = request.args?.customization?.age_range || '3-10';
          return `You create engaging, beautifully written stories for children aged ${ageRange}.`;
        },
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
        (request) => {
          const count = request.args?.customization?.illustration_count || 5;
          return `The story should have ${count} scenes, each with an accompanying illustration.`;
        },
        'Write the story as HTML with embedded CSS styling for a storybook look.',
        (request) => {
          const count = request.args?.customization?.illustration_count || 5;
          return `Use {{IMAGE_1}} through {{IMAGE_${count}}} as placeholders where illustrations should appear.`;
        },
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
        (request) => {
          const style = (request.args?.customization?.style || 'watercolor') as IllustrationStyle;
          const desc = STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS['watercolor'];
          return `Always include the art style in every prompt: "${desc}"`;
        },
        'Describe the scene composition, characters, setting, and mood',
        'Maintain visual consistency — describe recurring characters the same way each time',
        'Keep prompts family-friendly and whimsical',
        'Each prompt should be 2-3 sentences long',
      ]
    });
  }

  protected get_ReferenceImage_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Character Consistency:',
      children: [
        (request) => {
          const hasRefImage = !!request.args?.customization?.reference_image_base64;
          if (hasRefImage) {
            return 'A reference image has been provided for the main character. Match the character\'s appearance exactly in all scene prompts. Do NOT set needs_reference_image to true — a reference is already provided.';
          }
          return [
            'If the story features a recurring main character who appears in 3 or more illustrations, set needs_reference_image to true.',
            'Provide a reference_image_description with a detailed visual description: physical build, hair color/style, skin tone, clothing, distinctive features.',
            'This reference will be used to generate a character sheet before the scene illustrations, ensuring visual consistency.',
            'If the story does not have a strong recurring character (e.g., nature scenes, different animals), set needs_reference_image to false.',
          ].join(' ');
        },
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
            (request) => {
              const ageRange = request.args?.customization?.age_range || '3-10';
              return `Use simple, clear language appropriate for ages ${ageRange}`;
            },
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

### What Changed from Part 2

Three sections now contain **lambda children** instead of static strings. The lambdas receive the `PromptNodeRequest` at render time and read customization from `request.args`. Here is a side-by-side for each change:

**Context section** -- age range is now dynamic:

```typescript
// Part 2 (static):
'You create engaging, beautifully written stories for children aged 3-10.',

// Part 6 (lambda child):
(request) => {
  const ageRange = request.args?.customization?.age_range || '3-10';
  return `You create engaging, beautifully written stories for children aged ${ageRange}.`;
},
```

**Task section** -- illustration count is now dynamic:

```typescript
// Part 2 (static):
'The story should have 3-5 scenes, each with an accompanying illustration.',

// Part 6 (lambda child):
(request) => {
  const count = request.args?.customization?.illustration_count || 5;
  return `The story should have ${count} scenes, each with an accompanying illustration.`;
},
```

**ImagePrompt section** -- art style is now dynamic:

```typescript
// Part 2 (static):
'Always include the art style: "children\'s book illustration, watercolor style, warm and inviting colors, soft lighting"',

// Part 6 (lambda child):
(request) => {
  const style = (request.args?.customization?.style || 'watercolor') as IllustrationStyle;
  const desc = STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS['watercolor'];
  return `Always include the art style in every prompt: "${desc}"`;
},
```

### How Dynamic Sections Work

The `StoryWriterPrompt` is constructed **once** by the bot with `new StoryWriterPrompt('system', {})` -- empty options. The prompt instance is reused across requests. Dynamic behavior comes from lambda children that are evaluated at **render time**, not construction time.

The rendering flow:

```
Bot receives request with args: { customization: { style: 'anime', age_range: '5-8' } }
    |
    v
Bot calls StoryWriterPrompt.render() with the PromptNodeRequest
    |
    v
SDK iterates through each section's children:
  - Static string "You are a master children's storyteller..." -> used as-is
  - Lambda (request) => { ... age_range ... } -> called with request -> returns "...aged 5-8."
  - Static string "You also direct..." -> used as-is
    |
    v
Context section renders as:
  "You are a master children's storyteller and illustration director.
   You create engaging, beautifully written stories for children aged 5-8.
   You also direct the illustration process by writing detailed image generation prompts."
    |
ImagePrompt section renders as:
  "Always include the art style in every prompt:
   children's book illustration, anime-inspired style, large expressive eyes,
   pastel colors, soft shading, kawaii aesthetic"
```

### The Lambda Children Pattern

Each lambda follows a consistent pattern:

```typescript
(request) => {
  const style = (request.args?.customization?.style || 'watercolor') as IllustrationStyle;
  const desc = STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS['watercolor'];
  return `Always include the art style in every prompt: "${desc}"`;
},
```

Each lambda:

1. **Receives `request`** -- the `PromptNodeRequest` provided by the SDK at render time
2. **Reads from `request.args`** -- the per-request data that the entity placed in the bot request args
3. **Navigates the optional chain** -- `request.args?.customization?.style` handles `undefined` at every level
4. **Returns a sensible default** -- if the user did not specify a style, use `'watercolor'`
5. **Returns a string** -- the rendered text that replaces the lambda in the children array

Static children (plain strings) remain unchanged across requests. Only the values that vary per request use lambdas. This keeps the prompt readable -- most children are still plain strings, with lambdas only where needed.

### Alternative: The SwitchNode Approach

For the style section, a `PromptTemplateSwitchNode` provides a more structured alternative. This is useful when different cases have structurally different children -- not just different strings, but different counts or types of child nodes:

```typescript
import { PromptTemplateSwitchNode } from '@firebrandanalytics/ff-agent-sdk';

protected get_ImagePrompt_Section(): PromptTemplateNode<STORY_PTH> {
  return new PromptTemplateSectionNode<STORY_PTH>({
    semantic_type: 'rule',
    content: 'Image Prompt Guidelines:',
    children: [
      'Write detailed, vivid prompts suitable for AI image generation',
      new PromptTemplateSwitchNode<STORY_PTH, IllustrationStyle>({
        semantic_type: 'rule',
        expression_func: (request) =>
          (request.args?.customization?.style || 'watercolor') as IllustrationStyle,
        cases: {
          'watercolor': `Always include the art style: "${STYLE_DESCRIPTIONS['watercolor']}"`,
          'digital-art': `Always include the art style: "${STYLE_DESCRIPTIONS['digital-art']}"`,
          'colored-pencil': `Always include the art style: "${STYLE_DESCRIPTIONS['colored-pencil']}"`,
          'storybook-classic': `Always include the art style: "${STYLE_DESCRIPTIONS['storybook-classic']}"`,
          'anime': `Always include the art style: "${STYLE_DESCRIPTIONS['anime']}"`,
          'paper-cutout': `Always include the art style: "${STYLE_DESCRIPTIONS['paper-cutout']}"`,
        },
        default_case: `Always include the art style: "${STYLE_DESCRIPTIONS['watercolor']}"`,
      }),
      'Describe the scene composition, characters, setting, and mood',
      // ...
    ]
  });
}
```

How the SwitchNode works:

- **`expression_func`** evaluates at render time and returns a key (in this case, the `IllustrationStyle` string)
- **`cases`** maps keys to children -- each case can be a string, a node, or any valid `PromptTemplateNodeChild`
- **`default_case`** is used when no case matches the expression result

For this specific scenario, the lambda approach is simpler -- it is just a map lookup. The SwitchNode shines when cases have different structures. For example, a watercolor scene might need different compositional guidance than an anime scene:

```typescript
cases: {
  'watercolor': new PromptTemplateSectionNode<STORY_PTH>({
    semantic_type: 'rule',
    content: 'Watercolor Guidelines:',
    children: [
      `Use the style: "${STYLE_DESCRIPTIONS['watercolor']}"`,
      'Emphasize soft edges and bleeding colors between elements',
      'Describe ambient lighting and atmospheric effects',
    ]
  }),
  'anime': new PromptTemplateSectionNode<STORY_PTH>({
    semantic_type: 'rule',
    content: 'Anime Guidelines:',
    children: [
      `Use the style: "${STYLE_DESCRIPTIONS['anime']}"`,
      'Use expressive character poses and dynamic compositions',
      'Include sparkle effects and dramatic lighting for emotional moments',
      'Describe eye expressions in detail for each character',
    ]
  }),
}
```

### Alternative: Polymorphic Prompt Subclasses

For the most complex customization scenarios, you can create prompt subclasses that override entire sections. The protected section methods in `StoryWriterPrompt` are designed for this:

```typescript
// Base class — the sections are protected and overrideable
export class StoryWriterPrompt extends Prompt<STORY_PTH> {
  // ... (constructor adds sections including this.get_ImagePrompt_Section())

  protected get_ImagePrompt_Section(): PromptTemplateNode<STORY_PTH> {
    // Default: watercolor
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Image Prompt Guidelines:',
      children: [
        'Write detailed, vivid prompts suitable for AI image generation',
        `Always include the art style: "${STYLE_DESCRIPTIONS['watercolor']}"`,
        'Describe the scene composition, characters, setting, and mood',
        // ...
      ]
    });
  }
}

// Subclass per style
export class AnimeStoryWriterPrompt extends StoryWriterPrompt {
  protected override get_ImagePrompt_Section(): PromptTemplateNode<STORY_PTH> {
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Image Prompt Guidelines:',
      children: [
        'Write detailed, vivid prompts suitable for AI image generation',
        `Always include the art style: "${STYLE_DESCRIPTIONS['anime']}"`,
        'Use expressive character poses and dynamic compositions typical of anime illustration',
        'Describe the scene composition, characters, setting, and mood',
        // ...
      ]
    });
  }
}
```

The bot then selects the right prompt using `DiscriminatedUnionPrompt` -- the SDK's built-in class for prompt-level variant selection:

```typescript
import {
  DiscriminatedUnionPrompt,
  PromptGroup,
} from '@firebrandanalytics/ff-agent-sdk';

// DiscriminatedUnionPrompt evaluates a discriminator function at render time
// and delegates to the matching prompt variant. This is the Prompt-level
// analogue of PromptTemplateSwitchNode.
const storyPrompt = new DiscriminatedUnionPrompt<STORY_PTH, IllustrationStyle>(
  'system', {},
  (request) => (request.args?.customization?.style || 'watercolor') as IllustrationStyle,
  {
    'watercolor': new StoryWriterPrompt('system'),
    'anime': new AnimeStoryWriterPrompt('system'),
    'digital-art': new DigitalArtStoryWriterPrompt('system'),
    // ... one entry per style
  },
);

// Add to the prompt group as a single named prompt:
const baseGroup = new PromptGroup<STORY_PTH>([
  { name: 'story_writer', prompt: storyPrompt },
]);
```

The discriminator function receives the `PromptNodeRequest` at render time (just like lambda children), evaluates which variant to use, and delegates rendering to the matched prompt. If the key is not found, it returns `undefined` (or throws in strict mode). An optional `default_case` parameter provides a fallback.

The polymorphic approach has distinct advantages for complex systems:

- Each subclass can have structurally different sections, not just different strings
- An anime prompt might add extra guidance about composition; a paper-cutout prompt might add guidance about layering
- Each variant is self-contained and independently testable

The tradeoff is more code to maintain. Use this when the prompt structure genuinely differs per variant, not just a few interpolated values.

### Which Approach to Use

| Approach | When to Use |
|----------|------------|
| **Lambda children** | Values change per request but section structure stays the same. Simplest pattern -- use this by default. |
| **SwitchNode** | Different cases need structurally different children (different count, different nodes). Good middle ground. |
| **Polymorphic subclasses** + `DiscriminatedUnionPrompt` | Entire sections differ significantly between variants. Each variant has its own testing and evolution lifecycle. `DiscriminatedUnionPrompt` handles variant selection at render time. Best for complex multi-variant systems. |

The illustrated-story tutorial uses the **lambda children** approach because the section structure is identical across all styles -- only specific values (age range, illustration count, style description) change per request.

### The Updated PromptTypeHelper

The `STORY_PTH` type now includes request args:

```typescript
// Part 2:
type STORY_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

// Part 6:
type STORY_PTH = PromptTypeHelper<string, StoryWriterPromptArgs>;
```

Where `StoryWriterPromptArgs` is `{ static: {}; request: { customization?: StoryCustomization } }`. This type change propagates upward: the `BotTypeHelper` that references this `PTH` now knows the bot accepts customization in its request args, and the entity must provide it in `get_bot_request_args_impl()`.

### What the LLM Sees (Example)

With `customization: { style: 'anime', age_range: '5-8', illustration_count: 4 }`, the rendered prompt includes:

```
Context:
You are a master children's storyteller and illustration director.
You create engaging, beautifully written stories for children aged 5-8.
You also direct the illustration process by writing detailed image generation prompts.

Task:
Write a complete, illustrated children's story based on the provided topic.
The story should have 4 scenes, each with an accompanying illustration.
Write the story as HTML with embedded CSS styling for a storybook look.
Use {{IMAGE_1}} through {{IMAGE_4}} as placeholders where illustrations should appear.
For each placeholder, provide a detailed image generation prompt.

Image Prompt Guidelines:
Write detailed, vivid prompts suitable for AI image generation
Always include the art style in every prompt: "children's book illustration,
  anime-inspired style, large expressive eyes, pastel colors, soft shading,
  kawaii aesthetic"
Describe the scene composition, characters, setting, and mood
Maintain visual consistency — describe recurring characters the same way each time
Keep prompts family-friendly and whimsical
Each prompt should be 2-3 sentences long
```

Compare this to the default (no customization):

```
You create engaging, beautifully written stories for children aged 3-10.
The story should have 5 scenes, each with an accompanying illustration.
Always include the art style in every prompt: "children's book illustration,
  watercolor style, warm and inviting colors, soft lighting, gentle brush strokes,
  dreamy atmosphere"
```

The structural skeleton is identical -- only three specific values change. This is the strength of the lambda children approach: the prompt's architecture remains stable while specific instructions adapt to user preferences.

---

## Step 3: Update the StoryOutputSchema

The output schema needs two new fields to prepare for reference image support in Part 7. Add them alongside the existing fields.

**`apps/story-bundle/src/schemas.ts`** (update the `StoryOutputSchema`):

```typescript
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
    needs_reference_image: z.boolean().optional().default(false)
      .describe('Whether a reference character sheet should be generated first for visual consistency. Set to true when the story has a recurring main character who appears in multiple illustrations.'),
    reference_image_description: z.string().optional()
      .describe('If needs_reference_image is true, a detailed visual description of the main character to use as a reference sheet prompt. Include physical appearance, clothing, distinctive features, and coloring.'),
  }),
  'StoryOutput',
  'An illustrated children\'s story with image placeholders and generation prompts'
);
```

### What Changed

Two new fields were added as top-level fields of the schema (not inside each image prompt):

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `needs_reference_image` | `boolean` (optional) | `false` | Tells the pipeline whether a character reference sheet should be generated before scene illustrations |
| `reference_image_description` | `string` (optional) | `undefined` | A detailed visual description of the main character for generating a reference sheet |

The `needs_reference_image` field uses `.optional().default(false)`, following the defensive pattern from Part 2. The LLM may or may not produce these fields depending on whether a reference image was mentioned in the prompt. By defaulting `needs_reference_image` to `false`, existing stories (without reference images) work without any changes to downstream code.

### Why Add These Now

Adding schema fields that are not yet consumed follows a deliberate strategy: **expand the schema before expanding the behavior**. When Part 7 adds reference image logic to the prompt and the image generation entity, the schema is already in place. The LLM's output has been producing these fields (with default values) since Part 6, so Part 7 can immediately start reading them without a schema migration.

This also means you can deploy the Part 6 changes, observe that the new schema fields appear in production output (defaulting to `false` for `needs_reference_image`), and confirm the schema change is non-breaking before Part 7 adds the behavior that populates them.

---

## Step 4: Wire Customization Through the StoryWriterEntity

The `StoryWriterEntity` needs to read `customization` from its entity data and pass it to the bot as request args. This is the bridge between entity-level state and prompt-level dynamic content.

**`apps/story-bundle/src/entities/StoryWriterEntity.ts`** (update `get_bot_request_args_impl`):

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
import type { StoryCustomization } from '@shared/types';

interface StoryWriterDTOData {
  topic: string;
  customization?: StoryCustomization;
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
    const customization = dto.data.customization;
    return {
      input: `Write an illustrated children's story about: ${dto.data.topic}`,
      context: new Context(),
      args: { request: { customization } } as any
    };
  }
}
```

### What Changed from Part 2

Two changes connect the entity to the customization system:

**1. The DTO data interface now includes `customization`:**

```typescript
// Part 2:
interface StoryWriterDTOData {
  topic: string;
  [key: string]: any;
}

// Part 6:
interface StoryWriterDTOData {
  topic: string;
  customization?: StoryCustomization;
  [key: string]: any;
}
```

**2. `get_bot_request_args_impl` now passes customization in the request args:**

```typescript
// Part 2:
return {
  input: `Write an illustrated children's story about: ${dto.data.topic}`,
  context: new Context(),
  args: {} as STORY_BTH['pth']['args']['request']
};

// Part 6:
const customization = dto.data.customization;
return {
  input: `Write an illustrated children's story about: ${dto.data.topic}`,
  context: new Context(),
  args: { request: { customization } } as any
};
```

### The Data Flow Through `get_bot_request_args_impl`

This method is the critical junction where entity-level data becomes prompt-level data. Trace the full path:

```
StoryPipelineEntity creates StoryWriterEntity with data:
  { topic: "A brave kitten", customization: { style: 'anime', age_range: '5-8' } }
    |
    v
StoryWriterEntity.get_bot_request_args_impl() reads dto.data.customization
    |
    v
Returns { input: "Write an illustrated...", args: { request: { customization: { style: 'anime', age_range: '5-8' } } } }
    |
    v
StoryWriterBot passes request args to StoryWriterPrompt.render()
    |
    v
StoryWriterPrompt.render() receives PromptNodeRequest with args.customization
    |
    v
Lambda children are called with the request:
  (request) => request.args?.customization?.style  -> 'anime'
  (request) => request.args?.customization?.age_range -> '5-8'
  (request) => STYLE_DESCRIPTIONS[style] -> "children's book illustration, anime-inspired style, ..."
```

The `as any` cast on the args object is a pragmatic choice. The full type path from `StoryWriterRETH['enh']['eth']['bth']['pth']['args']['request']` would need to match the updated `StoryWriterPromptArgs['request']` type exactly. Since the prompt's type helper was updated in Step 2 and the bot's type helper references it, the types are consistent at runtime. The `as any` avoids a verbose type assertion that adds no safety beyond what the prompt's own type checking provides.

---

## Step 5: Update the StoryWriterBot

The bot's `PromptTypeHelper` needs to reflect the updated prompt args. The request args are no longer empty -- they carry the customization object.

**`apps/story-bundle/src/bots/StoryWriterBot.ts`** (updated type definitions):

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
import { StoryWriterPrompt, StoryWriterPromptArgs } from '../prompts/StoryWriterPrompt.js';
import { StoryOutputSchema, STORY_OUTPUT } from '../schemas.js';

type STORY_PROMPT_INPUT = string;

export type STORY_PTH = PromptTypeHelper<STORY_PROMPT_INPUT, StoryWriterPromptArgs>;
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

### What Changed from Part 2

Only the `STORY_PTH` type definition changed:

```typescript
// Part 2:
export type STORY_PTH = PromptTypeHelper<STORY_PROMPT_INPUT, { static: {}; request: {} }>;

// Part 6:
export type STORY_PTH = PromptTypeHelper<STORY_PROMPT_INPUT, StoryWriterPromptArgs>;
```

This single type change is all the bot needs. The `StoryWriterPromptArgs` interface is imported from the updated prompt file. Everything else remains the same -- the bot's constructor, prompt group assembly, and config are unchanged. The type system propagates the change: `STORY_PTH` now carries the customization shape, `STORY_BTH` inherits it, and any code that provides request args to this bot must include `{ customization?: StoryCustomization }`.

---

## Step 6: Update the Agent Bundle's create-story Endpoint

The API endpoint needs to accept the `customization` field from the request body and pass it through to the pipeline entity's data.

**`apps/story-bundle/src/agent-bundle.ts`** (update the `createStory` method):

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-story' })
async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
  const { topic, customization } = body;
  if (!topic?.trim()) throw new Error('Topic is required');
  logger.info('[API] Creating story pipeline', { topic, style: customization?.style });

  const entity = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `story-pipeline-${Date.now()}`,
    specific_type_name: 'StoryPipelineEntity',
    general_type_name: 'StoryPipelineEntity',
    status: 'Pending',
    data: { topic, customization } as StoryEntityData,
  });

  return { entity_id: entity.id! };
}
```

### What Changed from Part 4

Two changes:

**1. Destructure `customization` from the request body:**

```typescript
// Part 4:
const { topic } = body;

// Part 6:
const { topic, customization } = body;
```

**2. Include `customization` in the entity data:**

```typescript
// Part 4:
data: { topic } as StoryEntityData,

// Part 6:
data: { topic, customization } as StoryEntityData,
```

The validation is minimal -- no need to validate the `customization` object's fields here because the types are union types that TypeScript checks at compile time, and the prompt's lambda children provide defaults for any missing fields. If a caller sends `"style": "invalid-style"`, TypeScript will flag it at compile time (for typed clients) and at runtime the lambda will fall through to the default because `STYLE_DESCRIPTIONS['invalid-style']` is `undefined`, which the fallback `|| STYLE_DESCRIPTIONS['watercolor']` handles gracefully.

---

## Step 7: Update the StoryPipelineEntity

The pipeline entity reads `customization` from its own data and passes it to child entities. This is where the top-level customization object fans out to multiple consumers.

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (update `run_impl` to read and pass customization):

```typescript
protected override async *run_impl() {
  const dto = await this.get_dto();
  const { topic, customization } = dto.data;

  logger.info('[Pipeline] Starting story pipeline', {
    entityId: this.id,
    topic,
    style: customization?.style,
    quality: customization?.image_quality,
  });

  // ─── Stage 1: Content safety check ──────────────────────

  yield await this.createStatusEnvelope('RUNNING', 'Running content safety check');
  await this.updateEntityData({ stage: 'safety_check' });

  const safetyEntity = await this.appendOrRetrieveCall(
    ContentSafetyCheckEntity,
    'safety-check',
    { topic },
  );
  const safetyResult: ContentSafetyResult = yield* await safetyEntity.start();

  if (!safetyResult.is_safe) {
    logger.warn('[Pipeline] Content rejected', { entityId: this.id, safetyResult });
    await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
    return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
  }

  await this.updateEntityData({ stage: 'safety_passed', safety_result: safetyResult });

  // ─── Stage 2: Story writing (with customization) ────────

  yield await this.createStatusEnvelope('RUNNING', 'Writing story');
  await this.updateEntityData({ stage: 'writing' });

  const writerEntity = await this.appendOrRetrieveCall(
    StoryWriterEntity,
    'story-writer',
    { topic, customization },
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

  // ─── Stage 3: Parallel image generation (with customization) ──

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

  // ... remainder of Stage 3 (parallel execution) unchanged from Part 5 ...
  // ... Stages 4-6 (assembly, PDF, storage) unchanged from Part 4 ...
}
```

### What Changed from Part 4/5

**1. Destructure `customization` alongside `topic`:**

```typescript
// Part 4:
const { topic } = dto.data;

// Part 6:
const { topic, customization } = dto.data;
```

**2. Pass `customization` to the StoryWriterEntity:**

```typescript
// Part 4:
const writerEntity = await this.appendOrRetrieveCall(
  StoryWriterEntity,
  'story-writer',
  { topic },
);

// Part 6:
const writerEntity = await this.appendOrRetrieveCall(
  StoryWriterEntity,
  'story-writer',
  { topic, customization },
);
```

**3. Use customization values for image generation task items:**

```typescript
// Part 5 (hardcoded):
data: {
  // ...
  image_quality: 'medium',
  aspect_ratio: '3:2',
},

// Part 6 (from customization with defaults):
data: {
  // ...
  image_quality: customization?.image_quality || 'medium',
  aspect_ratio: customization?.aspect_ratio || '3:2',
},
```

### How Customization Fans Out

The single `customization` object from the API request serves three different consumers in the pipeline:

| Consumer | Fields Used | How |
|----------|------------|-----|
| **StoryWriterPrompt** | `style`, `age_range`, `illustration_count` | Read via lambda children at render time from `request.args` |
| **ImageGenerationEntity** | `image_quality`, `aspect_ratio` | Read from entity data, mapped to broker enums |
| **Future: Reference image (Part 7)** | `reference_image_base64` | Will be passed to ImageGenerationEntity for reference-guided generation |

The content safety entity does not receive customization -- safety rules are the same regardless of illustration style or age range.

---

## Step 8: Build and Test

Build the project:

```bash
pnpm run build
```

Deploy:

```bash
ff ops build --app-name story-bundle
ff ops deploy --app-name story-bundle
```

### Test with Default Customization

Verify backward compatibility -- requests without customization still work:

```bash
RESULT=$(ff-sdk-cli api call create-story \
  --method POST \
  --body '{"topic":"A brave kitten who learns to swim"}' \
  --url http://localhost:3001)

ENTITY_ID=$(echo $RESULT | jq -r '.entity_id')
ff-sdk-cli iterator run $ENTITY_ID --url http://localhost:3001
```

The output should be identical to Part 5 -- watercolor style, 5 scenes, ages 3-10. No customization means all defaults are applied.

### Test with Full Customization

```bash
RESULT=$(ff-sdk-cli api call create-story \
  --method POST \
  --body '{
    "topic": "A robot who discovers music",
    "customization": {
      "style": "anime",
      "image_quality": "high",
      "age_range": "5-8",
      "illustration_count": 4,
      "aspect_ratio": "16:9"
    }
  }' \
  --url http://localhost:3001)

ENTITY_ID=$(echo $RESULT | jq -r '.entity_id')
ff-sdk-cli iterator run $ENTITY_ID --url http://localhost:3001
```

Verify the output:
1. The story should have exactly 4 scenes (matching `illustration_count: 4`)
2. Each image prompt in the output should include the anime style description
3. The `age_range` in the output should reflect `"5-8"` rather than the default `"3-10"`

### Test with Partial Customization

```bash
RESULT=$(ff-sdk-cli api call create-story \
  --method POST \
  --body '{
    "topic": "A penguin who paints",
    "customization": {
      "style": "paper-cutout"
    }
  }' \
  --url http://localhost:3001)

ENTITY_ID=$(echo $RESULT | jq -r '.entity_id')
ff-sdk-cli iterator run $ENTITY_ID --url http://localhost:3001
```

This tests the default fallback behavior. Only `style` is specified, so:
- Style: `'paper-cutout'` (from customization)
- Age range: `'3-10'` (default)
- Illustration count: `5` (default)
- Image quality: `'medium'` (default)
- Aspect ratio: `'3:2'` (default)

### Inspect the Prompt

Use `ff-telemetry-read` to see the actual prompt sent to the LLM:

```bash
ff-telemetry-read broker-requests --entity-id <story-writer-entity-id>
```

Look for the three dynamic sections in the rendered prompt:
- The Context section should show the correct age range
- The Task section should show the correct illustration count
- The ImagePrompt section should show the full style description matching the selected style

### Verify Schema Changes

Check that the new schema fields appear in the bot's output:

```bash
ff-eg-read node io <story-writer-entity-id>
```

The output should have `needs_reference_image: false` and `reference_image_description` absent -- the defaults applied by Zod since no reference image logic exists yet.

---

## The Complete Customization Architecture

Here is the full picture of how a customization option flows from the user to the LLM:

```
User selects "anime" style in the GUI
    |
    v
POST /api/create-story
  body: { topic: "...", customization: { style: "anime" } }
    |
    v
agent-bundle.ts: createStory()
  -> entity_factory.create_entity_node({ data: { topic, customization } })
    |
    v
StoryPipelineEntity (entity data: { topic, customization: { style: "anime" } })
  -> run_impl() reads dto.data.customization
  -> appendOrRetrieveCall(StoryWriterEntity, name, { topic, customization })
    |
    v
StoryWriterEntity (entity data: { topic, customization: { style: "anime" } })
  -> get_bot_request_args_impl()
  -> returns { args: { request: { customization: { style: "anime" } } } }
    |
    v
StoryWriterBot
  -> passes request args to StoryWriterPrompt.render()
    |
    v
StoryWriterPrompt (render() called with PromptNodeRequest containing customization in args)
  -> ImagePrompt section's lambda child reads request.args.customization.style
  -> style resolves to 'anime'
  -> STYLE_DESCRIPTIONS['anime'] returns:
     "children's book illustration, anime-inspired style,
      large expressive eyes, pastel colors, soft shading, kawaii aesthetic"
    |
    v
LLM sees in the prompt:
  "Always include the art style in every prompt:
   children's book illustration, anime-inspired style, large expressive eyes,
   pastel colors, soft shading, kawaii aesthetic"
    |
    v
LLM generates image prompts that include the anime style description
    |
    v
ImageGenerationEntity sends those prompts to the broker
    |
    v
Generated images reflect the anime art style
```

Seven layers from user choice to rendered image. Each layer has a single responsibility:
- **API endpoint**: Accepts and validates the request
- **Pipeline entity**: Reads and distributes customization to child entities
- **Writer entity**: Bridges entity data to bot request args
- **Bot**: Passes request args to prompt
- **Prompt**: Lambda children read `request.args` at render time, producing dynamic sections
- **LLM**: Follows the style instructions in the prompt
- **Image generation entity**: Uses quality and aspect ratio from customization

---

## Key Takeaways

1. **Union types are ideal for API-facing option sets.** They serialize as plain JSON strings, require no runtime code, and are enforced at compile time. Use them instead of enums when the values cross an API boundary.

2. **`STYLE_DESCRIPTIONS` centralizes prompt-level detail.** Image generation models need rich, descriptive prompts -- not single-word labels. A const map bridges the gap between user-facing simplicity (`'anime'`) and model-facing specificity (`"children's book illustration, anime-inspired style, large expressive eyes, pastel colors, soft shading, kawaii aesthetic"`).

3. **Lambda children make prompt sections dynamic at render time.** Any child in a section's `children` array can be a `(request) => string` function. The SDK calls these lambdas with the `PromptNodeRequest` at render time, so they can read per-request data from `request.args`. This keeps the prompt instance reusable across requests -- the bot constructs it once, and each render produces different output based on the current request's customization.

4. **Lambda children keep sections readable by colocating logic with output.** Each lambda reads from `request.args` with optional chaining and provides a sensible default. The pattern -- read, default, interpolate, return -- is consistent across all dynamic children. Static children (plain strings) remain as-is, so the section's structure is still visible at a glance.

5. **Customization flows through the entity data -> request args -> prompt render chain.** The API stores customization in entity data. The entity's `get_bot_request_args_impl()` reads it from the DTO and puts it in request args. The prompt's lambda children read from `request.args` at render time. This is a general pattern for threading any dynamic per-request configuration to the LLM.

6. **All customization fields should be optional with defaults.** This ensures backward compatibility -- existing callers that do not send customization continue to work. Defaults are applied at the lowest layer (the prompt's lambda children), not at the API boundary.

7. **Expand the schema before expanding the behavior.** Adding `needs_reference_image` and `reference_image_description` to the Zod schema now (with safe defaults) means Part 7 can start consuming these fields immediately. Schema changes deployed ahead of behavior changes are easier to validate as non-breaking.

8. **A single customization object fans out to multiple consumers.** The `StoryCustomization` interface is read by the prompt (style, age range, illustration count), the image generation entity (quality, aspect ratio), and future features (reference image). Each consumer reads only the fields it needs.

---

## Next Steps

The pipeline now accepts user customization and adapts the story and illustrations accordingly. In Part 7, you'll add **reference image support** -- users can upload a character sketch, and the pipeline will use it as a visual reference for generating consistent character illustrations across all scenes. You'll use the `reference_image_base64` field from `StoryCustomization` and the `needs_reference_image` / `reference_image_description` fields from the output schema that you added in this part.

---

**Previous:** [Part 5: Parallel Image Generation](./part-05-parallel-image-generation.md) | **Next:** [Part 7: Reference Images & Character Consistency](./part-07-reference-images.md)
