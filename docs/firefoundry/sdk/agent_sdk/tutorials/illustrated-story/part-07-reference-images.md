# Part 7: Reference Images & Character Consistency

In Part 6, you added customization types and style selection so users can choose an art style, image quality, and aspect ratio. But there is a deeper visual problem: when the pipeline generates multiple illustrations independently, the same character looks different in every scene. A rabbit with brown fur and a red scarf in Scene 1 becomes a white rabbit with no scarf in Scene 2. In this part, you'll solve this with **reference images** -- a conditional pipeline stage that generates a character reference sheet before the scene illustrations, ensuring visual consistency across the entire storybook.

**What you'll learn:**
- Conditional prompt sections that change based on runtime context (user-provided reference vs. LLM-decided reference)
- Using the LLM to decide whether a reference image is needed via structured output fields (`needs_reference_image`, `reference_image_description`)
- Adding a conditional pipeline stage with `appendOrRetrieveCall` for the reference image entity
- Text-based character consistency as a fallback when direct image reference is not yet supported
- The pipeline pattern: sequential decision, conditional branch, parallel execution

**What you'll build:** A `get_ReferenceImage_Section()` prompt method, updated schema fields for reference image decisions, a conditional Stage 2b in the pipeline that generates a character reference sheet, and a character consistency suffix appended to all scene image prompts.

**Starting point:** Completed code from [Part 6: Customization & Style Selection](./part-06-customization-and-styles.md). You should have a working pipeline with style selection, image quality, and aspect ratio customization.

---

## The Consistency Problem

When generating multiple illustrations for the same story, each image generation call is independent. The image generation model has no memory of previous images. Consider a story about "a brave kitten named Whiskers who explores the forest":

```
Scene 1 prompt: "A small orange tabby kitten with green eyes standing at a forest edge..."
  → Generates: orange kitten, green eyes, bushy tail

Scene 2 prompt: "A kitten climbing a tall oak tree in the forest..."
  → Generates: grey kitten, blue eyes, short tail

Scene 3 prompt: "The kitten sharing berries with a squirrel friend..."
  → Generates: white kitten, yellow eyes, striped pattern
```

Each image is individually fine, but together they look like three different cats. The reader sees a different character in every illustration, breaking the storybook illusion.

### Two Approaches to Consistency

| Approach | How It Works | Pros | Cons |
|----------|-------------|------|------|
| **Reference image** | Generate a character sheet first, then pass it to scene generations via img2img or style transfer | Strongest visual consistency; model sees the actual character | Requires img2img support in the broker client; adds one extra generation step |
| **Text description suffix** | Append a detailed character description to every scene prompt | Works today with any image generation backend; no extra generation step | Less consistent than visual reference; relies on the model interpreting text the same way each time |

This part implements both approaches. The pipeline generates a reference character sheet (Approach 1) for future use when the broker client supports passing reference images directly. In the meantime, it uses the character description as a text suffix (Approach 2) to improve consistency with the current infrastructure.

---

## Step 1: Update the Schema with Reference Image Fields

The `StoryOutputSchema` needs two new fields so the LLM can communicate whether a reference image is needed and what the character looks like.

**`apps/story-bundle/src/schemas.ts`** (updated fields in `StoryOutputSchema`):

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
    // ─── New: Reference image fields ─────────────────────────
    needs_reference_image: z.boolean().optional().default(false)
      .describe('Whether a reference character sheet should be generated first for visual consistency. Set to true when the story has a recurring main character who appears in multiple illustrations.'),
    reference_image_description: z.string().optional()
      .describe('If needs_reference_image is true, a detailed visual description of the main character to use as a reference sheet prompt. Include physical appearance, clothing, distinctive features, and coloring.'),
  }),
  'StoryOutput',
  'An illustrated children\'s story with image placeholders and generation prompts'
);
```

### Why These Fields Are Optional with Defaults

The `needs_reference_image` field uses `.optional().default(false)`, while `reference_image_description` uses `.optional()` without a default:

```typescript
needs_reference_image: z.boolean().optional().default(false)
reference_image_description: z.string().optional()
```

This follows the same defensive pattern introduced in Part 2 for `alt_text`. The `needs_reference_image` field defaults to `false` so the pipeline can safely check it without null guards. The `reference_image_description` is simply optional -- it is only expected when `needs_reference_image` is `true`.

### The LLM Decides

A key design choice: the **LLM** decides whether a reference image is needed, not the pipeline code. The story writer bot is in the best position to make this decision because it understands the story content:

| Story Type | `needs_reference_image` | Why |
|-----------|------------------------|-----|
| "A brave kitten explores the forest" (kitten in 4/5 scenes) | `true` | Recurring main character in most scenes |
| "Four seasons in the meadow" (nature scenes, different animals) | `false` | No recurring character to keep consistent |
| "A day at the beach" (child appears in 2/5 scenes) | `false` | Character appears in fewer than 3 scenes |
| "Luna the dragon's three adventures" (dragon in all scenes) | `true` | Strong recurring protagonist |

The threshold of "3 or more illustrations" is communicated to the LLM via the prompt (Step 2). This gives the LLM a concrete rule rather than a vague "if appropriate" instruction.

---

## Step 2: Add the Reference Image Prompt Section

The `StoryWriterPrompt` needs a new section that instructs the LLM about character consistency. This section uses **conditional content** -- its children change based on whether the user has already provided a reference image.

**`apps/story-bundle/src/prompts/StoryWriterPrompt.ts`** (add the new section):

```typescript
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
    this.add_section(this.get_ReferenceImage_Section());   // NEW
    this.add_section(this.get_Rules_Section());
  }

  // ... existing sections unchanged ...

  protected get_ReferenceImage_Section(): PromptTemplateNode<STORY_PTH> {
    const hasRefImage = !!(this.options as any)?.request?.customization?.reference_image_base64;
    return new PromptTemplateSectionNode<STORY_PTH>({
      semantic_type: 'rule',
      content: 'Character Consistency:',
      children: hasRefImage
        ? [
            'A reference image has been provided for the main character. Match the character\'s appearance exactly in all scene prompts.',
            'Do NOT set needs_reference_image to true — a reference is already provided.',
          ]
        : [
            'If the story features a recurring main character who appears in 3 or more illustrations, set needs_reference_image to true.',
            'Provide a reference_image_description with a detailed visual description: physical build, hair color/style, skin tone, clothing, distinctive features.',
            'This reference will be used to generate a character sheet before the scene illustrations, ensuring visual consistency.',
            'If the story does not have a strong recurring character (e.g., nature scenes, different animals), set needs_reference_image to false.',
          ]
    });
  }
}
```

### Conditional Prompt Sections

This is the first time in this tutorial that a prompt section's content changes based on runtime context. The `get_ReferenceImage_Section()` method checks whether the user has provided a `reference_image_base64` in the customization options:

```typescript
const hasRefImage = !!(this.options as any)?.request?.customization?.reference_image_base64;
```

Based on this boolean, the section renders one of two sets of children:

| Condition | Children | Purpose |
|-----------|----------|---------|
| User provided a reference image | "Match the character's appearance exactly...", "Do NOT set needs_reference_image to true..." | Tell the LLM to use the provided reference and skip generating one |
| No reference image provided | "If the story features a recurring main character...", "Provide a reference_image_description..." | Tell the LLM to decide if a reference is needed and describe the character |

This is different from the lambda-based conditional rendering in the report-generator tutorial. There, lambdas were used to conditionally render individual strings within a section based on request args. Here, the entire children array is swapped based on a construction-time check. Both approaches work; use whichever fits the branching logic better.

### Why Check at Construction Time

The `hasRefImage` check happens in the method body, not in a lambda. This works because the `StoryWriterPrompt` is constructed fresh for each bot request -- the `StoryWriterBot` creates a new prompt instance with the current options each time. If the prompt were a singleton shared across requests, this pattern would not work; you would need lambdas instead.

### Section Ordering

The reference image section is placed between `ImagePrompt` and `Rules`:

```
Context → Task → Format → ImagePrompt → ReferenceImage → Rules
```

This ordering groups the image-related guidance together (ImagePrompt + ReferenceImage) before the general storytelling rules. The LLM sees the image generation guidelines, then the character consistency instructions, then the craft rules -- a natural flow from specific visual guidance to general writing advice.

---

## Step 3: Pipeline Stage 2b -- Conditional Reference Image Generation

After the story writer produces its output, the pipeline checks whether a reference image is needed. If so, it generates a character reference sheet using a dedicated `ImageGenerationEntity` child before proceeding to scene image generation.

This stage is "2b" because it sits between Stage 2 (story writing) and Stage 3 (parallel scene image generation). It only executes when a reference image is needed and the user has not already provided one.

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (add Stage 2b after story writing):

```typescript
import { STYLE_DESCRIPTIONS, IllustrationStyle } from '@shared/types';
import { ImageGenerationEntity } from './ImageGenerationEntity.js';
import type { GeneratedImageResult } from '@shared/types';

// ... inside run_impl(), after Stage 2 (story writing) completes ...

    // ─── Stage 2b: Conditional reference image generation ─────

    let referenceImageBase64: string | undefined = customization?.reference_image_base64;

    if (!referenceImageBase64 && storyResult.needs_reference_image && storyResult.reference_image_description) {
      yield await this.createStatusEnvelope('RUNNING', 'Generating character reference sheet');
      await this.updateEntityData({ stage: 'generating_reference' });

      const style = customization?.style || 'watercolor';
      const styleDesc = STYLE_DESCRIPTIONS[style as IllustrationStyle] || STYLE_DESCRIPTIONS['watercolor'];

      const refEntity = await this.appendOrRetrieveCall(
        ImageGenerationEntity,
        'reference-image',
        {
          placeholder: '{{REFERENCE}}',
          prompt: `Character reference sheet: ${storyResult.reference_image_description}. ${styleDesc}. Full body front view, clean background, consistent proportions.`,
          alt_text: 'Character reference sheet',
          model_pool: process.env.IMAGE_MODEL_POOL || 'fb-image-gen',
          image_quality: customization?.image_quality || 'medium',
          aspect_ratio: '1:1',
        },
      );
      const refResult: GeneratedImageResult = yield* await refEntity.start();
      referenceImageBase64 = refResult.base64;

      logger.info('[Pipeline] Reference image generated', { entityId: this.id });
    }
```

### The Three-Way Condition

The reference image generation stage fires only when all three conditions are met:

```typescript
if (!referenceImageBase64 && storyResult.needs_reference_image && storyResult.reference_image_description) {
```

| Condition | What It Checks | When False |
|-----------|---------------|------------|
| `!referenceImageBase64` | No user-provided reference image | User already supplied one via `customization.reference_image_base64`; skip generation |
| `storyResult.needs_reference_image` | The LLM decided a reference is needed | Story has no strong recurring character; skip generation |
| `storyResult.reference_image_description` | The LLM provided a character description | Safety net: even if `needs_reference_image` is true, an empty description means nothing to generate |

This cascading check ensures the pipeline only generates a reference image when it is both needed and actionable.

### Using `appendOrRetrieveCall` for the Reference Entity

The pipeline uses `appendOrRetrieveCall` (not `appendCall`) for the reference image entity:

```typescript
const refEntity = await this.appendOrRetrieveCall(
  ImageGenerationEntity,
  'reference-image',
  { /* entity data */ },
);
```

This is the same idempotent pattern introduced in Part 5 for scene images. The name `'reference-image'` is deterministic -- it does not include `Date.now()` or a random suffix. If the pipeline is interrupted after generating the reference image and then resumed, `appendOrRetrieveCall` returns the existing entity (already completed) instead of creating a duplicate.

### Reference Image Prompt Construction

The reference image prompt is assembled from three parts:

```typescript
prompt: `Character reference sheet: ${storyResult.reference_image_description}. ${styleDesc}. Full body front view, clean background, consistent proportions.`
```

| Part | Source | Example |
|------|--------|---------|
| Character description | `storyResult.reference_image_description` (from the LLM) | "A small orange tabby kitten with bright green eyes, wearing a tiny red scarf, round face, fluffy tail" |
| Style description | `STYLE_DESCRIPTIONS[style]` (from Part 6) | "Watercolor illustration style with soft blended colors, visible brushstrokes, and a warm, inviting palette" |
| Composition instructions | Hardcoded suffix | "Full body front view, clean background, consistent proportions" |

The composition instructions request a clean, straightforward character view rather than a complex scene. This produces a reference that is easier for both humans and future img2img pipelines to use.

### Square Aspect Ratio

The reference image uses `'1:1'` (square) rather than the story's configured aspect ratio:

```typescript
aspect_ratio: '1:1',
```

A square format works best for character reference sheets because it provides equal horizontal and vertical space for a full-body view. Scene illustrations use the user's chosen aspect ratio (typically `'3:2'` landscape), but the reference sheet is a utility image, not a story illustration.

---

## Step 4: Character Consistency Suffix for Scene Prompts

The reference image has been generated, but the current broker client does not support passing reference images directly to scene generations. Until that capability is available, the pipeline appends the character description as a text suffix to every scene prompt.

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (update Stage 3 task item construction):

```typescript
    // ─── Stage 3: Parallel image generation ───────────────────

    const imagePrompts = storyResult.image_prompts;

    const characterSuffix = storyResult.reference_image_description
      ? ` The main character: ${storyResult.reference_image_description}. Maintain consistent character appearance across all scenes.`
      : '';

    const taskItems = imagePrompts.map((ip) => ({
      name: `image-${ip.placeholder}`,
      data: {
        placeholder: ip.placeholder,
        prompt: ip.prompt + characterSuffix,
        alt_text: ip.alt_text,
        model_pool: process.env.IMAGE_MODEL_POOL || 'fb-image-gen',
        image_quality: customization?.image_quality || 'medium',
        aspect_ratio: customization?.aspect_ratio || '3:2',
      },
    }));
```

### How the Suffix Works

Without the suffix, each scene prompt stands alone:

```
Scene 1: "A small kitten standing at the edge of a misty forest, watercolor style..."
Scene 2: "A kitten climbing a tall oak tree while birds watch, watercolor style..."
```

With the suffix, every prompt ends with the same character anchor:

```
Scene 1: "A small kitten standing at the edge of a misty forest, watercolor style...
          The main character: A small orange tabby kitten with bright green eyes,
          wearing a tiny red scarf, round face, fluffy tail. Maintain consistent
          character appearance across all scenes."

Scene 2: "A kitten climbing a tall oak tree while birds watch, watercolor style...
          The main character: A small orange tabby kitten with bright green eyes,
          wearing a tiny red scarf, round face, fluffy tail. Maintain consistent
          character appearance across all scenes."
```

The image generation model now receives the same character description for every scene. While this does not guarantee pixel-perfect consistency (text-based descriptions are inherently ambiguous), it significantly reduces variation. The model is more likely to produce an orange tabby with green eyes and a red scarf in every scene than it would without the suffix.

### Conditional Application

The suffix is only appended when `reference_image_description` is non-empty:

```typescript
const characterSuffix = storyResult.reference_image_description
  ? ` The main character: ${storyResult.reference_image_description}. Maintain consistent character appearance across all scenes.`
  : '';
```

If the LLM determined that no reference image is needed (e.g., nature scenes with different animals), `reference_image_description` is an empty string (the schema default), and `characterSuffix` evaluates to `''`. The scene prompts remain unmodified. This means the suffix logic is safe to apply unconditionally -- it only affects stories where the LLM identified a recurring character.

---

## Step 5: Updated Pipeline Flow

Here is the complete pipeline flow after adding the reference image stage:

```
User sends topic + optional customization (including optional reference_image_base64)
       |
       v
Stage 1: Content Safety Check
       |  ContentSafetyCheckEntity via appendOrRetrieveCall() + yield*
       v
Stage 2: Story Writing
       |  StoryWriterEntity via appendOrRetrieveCall() + yield*
       |  LLM produces: html_content, image_prompts[], needs_reference_image,
       |                 reference_image_description
       v
Stage 2b: Conditional Reference Image Generation           ◄── NEW
       |  IF no user reference AND needs_reference_image AND description exists:
       |    ImageGenerationEntity via appendOrRetrieveCall() + yield*
       |    Generates character reference sheet (1:1, style-matched)
       |  ELSE: skip
       v
Stage 3: Parallel Scene Image Generation
       |  Character description suffix appended to each scene prompt  ◄── NEW
       |  parallelCalls(ImageGenerationEntity) + CapacitySource
       v
Stage 4: HTML Assembly
       |  Replace {{IMAGE_N}} with <img src="data:...">
       v
Stage 5: PDF Generation
       |  doc-proc service htmlToPdf()
       v
Stage 6: Store in Working Memory
```

### Entity Graph After Completion

With reference image generation, the entity graph gains one additional child:

```
StoryPipelineEntity (story-pipeline-brave-kitten)     Status: Complete
  ├── ContentSafetyCheckEntity (safety-check)          Status: Complete
  ├── StoryWriterEntity (story-writer)                 Status: Complete
  ├── ImageGenerationEntity (reference-image)          Status: Complete   ◄── NEW
  ├── ImageGenerationEntity (image-{{IMAGE_1}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_2}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_3}})        Status: Complete
  ├── ImageGenerationEntity (image-{{IMAGE_4}})        Status: Complete
  └── ImageGenerationEntity (image-{{IMAGE_5}})        Status: Complete
```

The `reference-image` entity is distinct from the scene image entities. It uses a fixed name (`'reference-image'`) rather than a placeholder-based name (`'image-{{IMAGE_N}}'`), making it easy to identify in the entity graph.

For stories where the LLM sets `needs_reference_image: false`, the `reference-image` entity does not appear in the graph at all -- the pipeline skips Stage 2b entirely.

---

## Step 6: Future -- Direct Reference Image Support

The current approach uses the character description text as a consistency mechanism. This works, but it is a workaround. The broker's underlying protobuf schema already supports passing reference images directly.

### What the Protobuf Supports

The broker's `ImageGenerationRequest` protobuf includes an `ImageReference` message type:

```protobuf
message ImageReference {
  string blob_key = 1;          // Reference to an image in blob storage
  float influence_strength = 2;  // How strongly the reference influences generation (0.0-1.0)
}

message ImageGenerationRequest {
  string model_pool = 1;
  string prompt = 2;
  ImageQuality quality = 3;
  AspectRatio aspect_ratio = 4;
  repeated ImageReference input_images = 5;  // Reference images for style transfer / img2img
}
```

The `input_images` field allows passing one or more reference images that influence the generation. The `influence_strength` controls how closely the output should match the reference -- higher values produce closer matches at the cost of creative freedom.

### What Is Missing

The TypeScript `SimplifiedBrokerClient` does not yet expose the `input_images` parameter in its `generateImage()` method. When this is added, the pipeline can pass the reference image bytes directly:

```typescript
// Future: direct reference image support
const result = await brokerClient.generateImage({
  modelPool: 'fb-image-gen',
  prompt: scenePrompt,
  quality: ImageQuality.IMAGE_QUALITY_MEDIUM,
  aspectRatio: AspectRatio.ASPECT_RATIO_3_2,
  inputImages: [
    {
      blobKey: referenceImageBlobKey,
      influenceStrength: 0.7,
    },
  ],
});
```

This would produce significantly stronger character consistency because the image generation model would see the actual reference image, not just a text description. The `influenceStrength` of `0.7` balances character fidelity with scene-specific variation -- the character looks the same, but the pose, lighting, and composition change per scene.

### Upgrading When Available

When `SimplifiedBrokerClient` adds `inputImages` support, the upgrade path is straightforward:

1. Store the reference image's `objectKey` (blob storage key) from Stage 2b
2. In Stage 3, pass it as `inputImages[0].blobKey` to each scene generation call
3. Optionally keep the text suffix as a belt-and-suspenders approach, or remove it

The pipeline architecture does not need to change -- Stage 2b already generates and stores the reference image. The only modification is in how Stage 3 passes the reference to each scene generation call.

---

## Step 7: Test the Reference Image Flow

### Test with a Recurring Character

```bash
RESULT=$(ff-sdk-cli api call create-story \
  --method POST \
  --body '{
    "topic": "A brave orange kitten named Whiskers who explores a magical forest",
    "customization": {
      "style": "watercolor",
      "image_quality": "medium"
    }
  }' \
  --url http://localhost:3001)

ENTITY_ID=$(echo $RESULT | jq -r '.entity_id')
ff-sdk-cli iterator run $ENTITY_ID --url http://localhost:3001
```

Watch the output for:

```
STATUS  RUNNING  Writing story
...
STATUS  RUNNING  Generating character reference sheet    ◄── Stage 2b fired
STATUS  RUNNING  Generating image for {{REFERENCE}}
STATUS  RUNNING  Retrieving {{REFERENCE}} from storage
...
STATUS  RUNNING  Generating 5 images                     ◄── Stage 3 with suffix
```

After completion, check the story writer's output:

```bash
ff-eg-read node io <story-writer-entity-id>
```

Verify that:
- `needs_reference_image` is `true`
- `reference_image_description` contains a detailed character description (physical build, fur color, eye color, clothing, distinctive features)

### Test Without a Recurring Character

```bash
ff-sdk-cli api call create-story \
  --method POST \
  --body '{
    "topic": "The four seasons in a mountain meadow — spring flowers, summer butterflies, autumn leaves, winter snow",
    "customization": { "style": "watercolor" }
  }' \
  --url http://localhost:3001
```

This story has no recurring character. The output should show:

```
STATUS  RUNNING  Writing story
...
STATUS  RUNNING  Generating 4 images                     ◄── No Stage 2b
```

Verify that `needs_reference_image` is `false` and the `reference-image` entity does not appear in the entity graph:

```bash
ff-eg-read tree <pipeline-entity-id>
```

### Test with a User-Provided Reference

```bash
# Assuming REFERENCE_B64 contains a base64-encoded character image
ff-sdk-cli api call create-story \
  --method POST \
  --body "{
    \"topic\": \"A brave kitten explores the forest\",
    \"customization\": {
      \"style\": \"watercolor\",
      \"reference_image_base64\": \"${REFERENCE_B64}\"
    }
  }" \
  --url http://localhost:3001
```

The pipeline should skip Stage 2b because a reference image was provided by the user. The prompt section tells the LLM "a reference image has been provided" and instructs it not to set `needs_reference_image`.

---

## Key Takeaways

1. **Conditional prompt sections adapt to runtime context.** The `get_ReferenceImage_Section()` method renders different children based on whether the user provided a reference image. The prompt class checks the options at construction time and produces the appropriate instructions for each case.

2. **Let the LLM decide when a reference is needed.** The `needs_reference_image` boolean and `reference_image_description` string are structured output fields that the LLM fills based on the story content. This is better than a hardcoded rule because the LLM understands whether the story has a recurring character and can describe that character in detail.

3. **`appendOrRetrieveCall` works for conditional stages too.** The reference image entity uses the same idempotent creation pattern as scene images. The fixed name `'reference-image'` ensures resumability -- if the pipeline restarts after generating the reference, it retrieves the existing entity instead of regenerating.

4. **Text-based character consistency is a pragmatic fallback.** Appending the character description to every scene prompt is not as strong as passing a reference image directly, but it significantly improves consistency with zero infrastructure changes. The suffix is conditionally applied -- stories without recurring characters are unaffected.

5. **The pipeline pattern is: sequential decision, conditional branch, parallel execution.** Stage 2 (story writing) produces structured data. Stage 2b reads that data and conditionally generates a reference. Stage 3 uses the reference data to enhance parallel scene generation. Each stage's output feeds the next stage's input.

6. **Design for the future while shipping today.** The reference image is generated and stored even though the broker client cannot pass it to scene generations yet. When `inputImages` support arrives, the upgrade is minimal -- the architecture already produces and persists the reference image.

7. **Schema defaults protect the pipeline from missing data.** The `needs_reference_image: false` default means the pipeline's conditional logic works correctly even if the LLM omits this field entirely. The `reference_image_description` is optional and only checked when `needs_reference_image` is `true`.

---

## Next Steps

In [Part 8: Input Validation & Error Handling](./part-08-input-validation.md), you'll add robust validation to the pipeline's input stage -- validating topic length, customization parameters, and reference image format before the pipeline begins execution. You'll learn how to surface validation errors through the iterator protocol and how to structure error responses that clients can act on.

---

**Previous:** [Part 6: Customization & Style Selection](./part-06-customization-and-styles.md) | **Next:** [Part 8: Input Validation & Error Handling](./part-08-input-validation.md)
