# Part 8: Input Validation & Error Handling

Parts 1-7 built a complete illustrated storybook pipeline -- from content safety through parallel image generation, reference images, and style customization. Everything works when inputs are valid and services cooperate. This part adds the defensive layer: input validation at the API boundary, deterministic entity naming for idempotency, XSS prevention in HTML assembly, failed image tracking, and clean branching with the `condition()` helper.

**What you'll learn:**
- Validating API inputs (topic, style, quality, aspect ratio, illustration count) before creating entities
- Deterministic entity naming with slug + hash for idempotent entity creation
- Escaping LLM-generated text before inserting it into HTML attributes
- Tracking failed images and reporting partial completion
- Using the `condition()` helper for clean pipeline branching

**What you'll build:** A hardened version of the `createStory` endpoint and pipeline that validates all inputs, prevents duplicate entities, escapes untrusted content, and degrades gracefully when individual image generations fail.

**Starting point:** Completed code from [Part 7: Reference Images for Character Consistency](./part-07-reference-images.md). You should have a working pipeline with style selection, quality/aspect ratio customization, and reference image generation.

---

## Why Validate at the API Boundary

The `createStory` endpoint is the only entry point to the pipeline. Everything downstream -- the safety bot, the story writer, the image generation entities -- trusts that the data on the entity is well-formed. This is by design: validate once at the edge, trust internally.

If you scatter validation across the pipeline, you get duplicated checks, inconsistent error messages, and defensive code in places that should focus on their primary responsibility. Instead, the principle is:

| Layer | Responsibility |
|-------|---------------|
| **API endpoint** (`createStory`) | Validate all user input. Reject invalid requests with clear error messages before any entity is created. |
| **Pipeline entity** (`run_impl`) | Trust that entity data is valid. Focus on orchestration logic. |
| **Child entities** (safety bot, story writer, image gen) | Trust that the data passed by the parent is well-formed. Focus on their specific task. |

This keeps the codebase clean and makes errors easy to diagnose: if you see a validation error, it always comes from the API layer.

---

## Step 1: API Endpoint Validation

Update the `createStory` method in `agent-bundle.ts` to validate every field in the request before creating the pipeline entity.

**`apps/story-bundle/src/agent-bundle.ts`** (updated `createStory` method):

```typescript
import crypto from 'node:crypto';

// ─── Valid option sets ───────────────────────────────────────

const VALID_STYLES = ['watercolor', 'digital-art', 'colored-pencil', 'storybook-classic', 'anime', 'paper-cutout'];
const VALID_QUALITIES: ImageQualityLevel[] = ['low', 'medium', 'high'];
const VALID_ASPECT_RATIOS: AspectRatioOption[] = ['1:1', '3:2', '2:3', '4:3', '16:9'];

@ApiEndpoint({ method: 'POST', route: 'create-story' })
async createStory(body: CreateStoryRequest): Promise<CreateStoryResponse> {
  const { topic, customization } = body;

  // ─── Topic validation ────────────────────────────────────
  if (!topic?.trim()) {
    throw new Error('Topic is required');
  }
  if (topic.length > 500) {
    throw new Error('Topic must be 500 characters or fewer');
  }

  // ─── Customization validation (all fields optional) ──────
  if (customization) {
    if (customization.style && !VALID_STYLES.includes(customization.style)) {
      throw new Error(`Invalid style. Must be one of: ${VALID_STYLES.join(', ')}`);
    }

    if (customization.image_quality && !VALID_QUALITIES.includes(customization.image_quality)) {
      throw new Error(`Invalid image_quality. Must be one of: ${VALID_QUALITIES.join(', ')}`);
    }

    if (customization.aspect_ratio && !VALID_ASPECT_RATIOS.includes(customization.aspect_ratio)) {
      throw new Error(`Invalid aspect_ratio. Must be one of: ${VALID_ASPECT_RATIOS.join(', ')}`);
    }

    if (customization.illustration_count !== undefined) {
      if (customization.illustration_count < 1 || customization.illustration_count > 10) {
        throw new Error('illustration_count must be between 1 and 10');
      }
    }
  }

  // ─── Deterministic entity naming (Step 2) ────────────────
  const slug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const custHash = customization
    ? crypto.createHash('sha256').update(JSON.stringify(customization)).digest('hex').slice(0, 8)
    : '0';
  const entityName = `story-pipeline-${slug}-${custHash}`;

  logger.info('[API] Creating story pipeline', { topic, entityName });

  const entity = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: entityName,
    specific_type_name: 'StoryPipelineEntity',
    general_type_name: 'StoryPipelineEntity',
    status: 'Pending',
    data: { topic: topic.trim(), customization } as StoryEntityData,
  });

  return { entity_id: entity.id! };
}
```

### What Each Validation Does

| Check | Why |
|-------|-----|
| `!topic?.trim()` | Rejects `null`, `undefined`, `""`, and whitespace-only strings. The optional chaining handles the null/undefined case without throwing a TypeError. |
| `topic.length > 500` | Prevents excessively long topics that could produce enormous prompts. 500 characters is generous for a story topic description. |
| `!VALID_STYLES.includes(...)` | Rejects unknown styles that the image generation prompt would not handle correctly. The error message lists valid options so the caller knows what to use. |
| `!VALID_QUALITIES.includes(...)` | Ensures quality maps to a known `ImageQuality` enum value downstream. An unknown quality string would fall through to a default, masking the caller's intent. |
| `!VALID_ASPECT_RATIOS.includes(...)` | Same principle as quality -- prevents silent fallback to a default aspect ratio. |
| `count < 1 \|\| count > 10` | Bounds the illustration count. Below 1 makes no sense; above 10 would produce very long generation times and potentially exceed context limits. |

### Error Message Design

Each error message includes the invalid value and the valid options:

```
Invalid style "pastel". Valid styles: watercolor, digital-art, colored-pencil, storybook-classic, anime, paper-cutout
```

This pattern makes API errors self-documenting. The caller does not need to consult documentation to fix the request -- the error message tells them exactly what to send.

---

## Step 2: Idempotent Entity Naming

In Part 4, the entity name used `Date.now()`:

```typescript
// Part 4 (non-idempotent)
name: `story-pipeline-${Date.now()}`
```

This creates a new entity every time, even for identical requests. If a user accidentally submits the same topic twice (or a client retries after a timeout), two separate pipelines run. The updated approach creates a deterministic name from the topic and customization:

```typescript
const slug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
const custHash = customization
  ? crypto.createHash('sha256').update(JSON.stringify(customization)).digest('hex').slice(0, 8)
  : '0';
const entityName = `story-pipeline-${slug}-${custHash}`;
```

### How It Works

**Step 1: Create a slug from the topic.** The topic is lowercased, non-alphanumeric characters are replaced with hyphens, and the result is truncated to 40 characters. This produces a human-readable prefix:

```
"A Brave Kitten's Adventure!"  ->  "a-brave-kitten-s-adventure-"  ->  (truncated to 40)
```

**Step 2: Hash the customization object.** The full customization object is JSON-serialized and hashed with SHA-256, then truncated to 8 hex characters. This produces a short, collision-resistant fingerprint:

```
{ style: 'watercolor', image_quality: 'high' }  ->  "a3f8c1d2"
```

If there is no customization, the hash is `'0'`.

**Step 3: Combine into the entity name.**

```
"story-pipeline-a-brave-kitten-s-adventure--a3f8c1d2"
```

### Why This Matters

| Scenario | `Date.now()` name | Deterministic name |
|----------|-------------------|-------------------|
| Same topic, same customization, submitted twice | Two entities, two pipelines | Same entity name -- `create_entity_node` returns the existing entity |
| Same topic, different customization | Two entities (correct) | Two entities (correct) -- different hash |
| Different topic, same customization | Two entities (correct) | Two entities (correct) -- different slug |

The deterministic name makes entity creation **idempotent**. The entity service treats the name as a unique key within the application: if an entity with that name already exists, `create_entity_node` returns the existing entity rather than creating a duplicate.

### Why Truncate the Slug

Entity names have a practical length limit. A 500-character topic would produce a 500-character slug, which is unwieldy in logs, CLI output, and the entity graph. Truncating to 40 characters keeps names readable while retaining enough information to be meaningful. The customization hash (8 hex characters) adds differentiation for topics that share the same 40-character prefix.

---

## Step 3: XSS Prevention in HTML Assembly

The `assembleHtml` method from Part 3 inserts `alt_text` directly into an HTML attribute:

```typescript
// Part 3 (vulnerable)
const imgTag = `<img src="data:${img.content_type};base64,${img.base64}" alt="${img.alt_text}" ...`;
```

The `alt_text` comes from the Story Writer Bot -- an LLM. LLM-generated text can contain characters that break HTML attributes or, in adversarial scenarios, inject markup. Consider an `alt_text` like:

```
A kitten " onload="alert('xss')
```

Without escaping, this produces:

```html
<img src="data:..." alt="A kitten " onload="alert('xss')" ...>
```

The browser interprets `onload="alert('xss')"` as an event handler attribute. Even though this is a children's story application, the principle is universal: **always escape untrusted content before inserting it into HTML**.

Update the `assembleHtml` method to escape `alt_text`:

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (or wherever `assembleHtml` is defined):

```typescript
private assembleHtml(htmlTemplate: string, images: GeneratedImageResult[]): string {
  let html = htmlTemplate;
  for (const img of images) {
    const safeAlt = img.alt_text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const imgTag = `<img src="data:${img.content_type};base64,${img.base64}" alt="${safeAlt}" style="max-width:100%; border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" />`;
    html = html.replace(img.placeholder, imgTag);
  }
  return html;
}
```

### What Each Replacement Does

| Character | Replacement | Why |
|-----------|-------------|-----|
| `&` | `&amp;` | Prevents `&` from starting an HTML entity. Must be replaced first -- otherwise it would double-escape the other replacements. |
| `"` | `&quot;` | Prevents `"` from closing the `alt` attribute value and allowing attribute injection. |
| `<` | `&lt;` | Prevents `<` from starting an HTML tag. |
| `>` | `&gt;` | Prevents `>` from closing a tag context. |

The order matters: `&` must be replaced before the others, because `&amp;`, `&quot;`, `&lt;`, and `&gt;` all contain `&`. If you replaced `&` last, you would double-escape everything.

### Why Not Use a Library

For four static replacements on a short string, `String.replace()` is clearer and has no dependencies. A library like `he` or `escape-html` would work too, but the replacements are so simple that adding a dependency is not justified. If you find yourself escaping in multiple places, consider extracting this into a shared utility function:

```typescript
function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

---

## Step 4: Failed Image Tracking

In Part 5, the image generation loop logged errors but did not track them:

```typescript
// Part 5 (no failure tracking)
} else if (envelope.type === 'ERROR') {
  logger.warn('[Pipeline] Image generation error', { ... });
}
```

After the loop, the pipeline had no way to know how many images failed. Update the loop to count failures:

**`apps/story-bundle/src/entities/StoryPipelineEntity.ts`** (updated image generation loop):

```typescript
// ─── Stage 3: Parallel image generation ──────────────────────

const images: GeneratedImageResult[] = [];
let failedImages = 0;

for await (const envelope of runner.runTasks()) {
  if (envelope.type === 'FINAL' && envelope.value) {
    images.push(envelope.value);
    await this.updateEntityData({ images_generated: images.length });
    yield await this.createStatusEnvelope(
      'RUNNING',
      `Generated ${images.length}/${imagePrompts.length} images`,
    );
  } else if (envelope.type === 'ERROR') {
    failedImages++;
    logger.warn('[Pipeline] Image generation error', {
      entityId: this.id,
      taskId: envelope.taskId,
      error: envelope.error,
      failedImages,
    });
  }
}
```

### What Changed

Two additions to the loop:

1. **`let failedImages = 0`** -- a counter initialized before the loop.
2. **`failedImages++`** inside the `ERROR` branch -- increments for each failed image generation.
3. **`failedImages`** in the log context -- helps correlate log entries when debugging multi-failure scenarios.

After the loop completes, `images.length + failedImages` equals the total number of image prompts. The pipeline knows exactly how many succeeded and how many failed.

---

## Step 5: Partial Completion

With failure tracking in place, the pipeline can report three distinct outcomes instead of just "completed":

```typescript
// ─── Determine final stage ───────────────────────────────────

const finalStage = failedImages > 0 && images.length > 0
  ? 'completed_with_errors'
  : failedImages > 0
    ? 'failed'
    : 'completed';
```

### The Three Outcomes

| Condition | `finalStage` | What It Means |
|-----------|-------------|---------------|
| All images succeeded (`failedImages === 0`) | `'completed'` | Everything worked. The story has all requested illustrations. |
| Some images succeeded, some failed (`failedImages > 0 && images.length > 0`) | `'completed_with_errors'` | Partial success. The story has content, but some illustrations are missing. The `{{IMAGE_N}}` placeholders for failed images remain in the HTML as visible indicators. |
| All images failed (`failedImages > 0 && images.length === 0`) | `'failed'` | Total failure. No images were generated. The story HTML has no illustrations. |

### Update the PipelineResult Type

Add `failed_images` to the `PipelineResult` type in shared types:

**`packages/shared-types/src/index.ts`** (updated `PipelineResult`):

```typescript
export interface PipelineResult {
  stage: string;
  title?: string;
  moral?: string;
  age_range?: string;
  image_count?: number;
  failed_images?: number;
  pdf_wm_id?: string;
  html_wm_id?: string;
  safety_result?: ContentSafetyResult;
}
```

### Update the Final Result Construction

```typescript
const result: PipelineResult = {
  stage: finalStage,
  title: storyResult.title,
  moral: storyResult.moral,
  age_range: storyResult.age_range,
  image_count: images.length,
  failed_images: failedImages > 0 ? failedImages : undefined,
  pdf_wm_id: pdfWmId,
  html_wm_id: htmlWmId,
};

await this.updateEntityData({
  stage: finalStage,
  failed_images: failedImages,
  pdf_wm_id: pdfWmId,
  html_wm_id: htmlWmId,
  image_count: images.length,
});

return result;
```

### Why Partial Completion Matters

The alternative to partial completion is to treat any image failure as a total pipeline failure. This is a poor user experience:

```
User submits "A brave kitten's adventure" (5 images requested)
  -> 4 images generate successfully
  -> 1 image fails (transient API error)
  -> Pipeline reports: FAILED

vs.

  -> Pipeline reports: COMPLETED_WITH_ERRORS (4 of 5 images)
  -> User gets a story with 4 illustrations and 1 missing placeholder
```

The second outcome is strictly better. The user gets content they can use, and the missing image is visible (the `{{IMAGE_4}}` placeholder remains in the HTML). They can retry the pipeline or accept the partial result.

The `failed_images` count in the result and entity data tells consumers exactly how many images failed, enabling them to show appropriate UI messaging (e.g., "Your story was generated with 4 of 5 illustrations. 1 image could not be created.").

---

## Step 6: Safety Gate Branching with `condition()`

In Part 4, the safety check used an `if/else` block:

```typescript
// Part 4 (inline branching)
if (!safetyResult.is_safe) {
  await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
  return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
}
// ... continue with approved pipeline ...
```

This works, but as the pipeline grows in complexity, inline branching becomes harder to follow. The `condition()` helper provides a structured alternative:

```typescript
const pipelineResult: PipelineResult = yield* this.condition(
  'safety-gate',
  safetyResult.is_safe ? 'safe' : 'rejected',
  {
    rejected: async function*(this: StoryPipelineEntity) {
      await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
      return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
    },
    safe: async function*(this: StoryPipelineEntity) {
      return yield* this.runApprovedPipeline(topic, safetyResult, customization);
    },
  },
);
```

### How `condition()` Works

The `condition()` helper takes three arguments:

| Argument | Type | Purpose |
|----------|------|---------|
| `'safety-gate'` | `string` | A label for this branch point. Used for deterministic child naming within the entity context. |
| `safetyResult.is_safe ? 'safe' : 'rejected'` | `string` | The branch key -- selects which branch to execute. |
| `{ rejected: ..., safe: ... }` | `Record<string, AsyncGeneratorFunction>` | A map of branch key to generator function. Only the selected branch runs. |

Under the hood, `condition()` does three things:

1. **Selects the branch** by looking up the branch key in the map.
2. **Pushes a CALL_FRAME** with the branch label (`'safety-gate/safe'` or `'safety-gate/rejected'`) into the entity context. This affects how child entities created within the branch are named -- they include the branch label in their deterministic path. This prevents name collisions between entities created in different branches.
3. **Executes the selected generator** using `yield*`, forwarding all progress envelopes and returning the branch's return value.

### Why Use `condition()` Instead of `if/else`

For a simple two-way branch (safe vs. rejected), `if/else` is perfectly fine. The `condition()` helper becomes valuable when:

- **The pipeline has multiple branch points.** Each `condition()` call is self-documenting: the label, the branch key, and the branch bodies are all visible in one place.
- **Branches create child entities.** The CALL_FRAME ensures deterministic naming. Without it, child entities created in the `safe` branch might collide with child entities created in the `rejected` branch if they use the same names.
- **Branches are complex.** Extracting each branch into a named generator function keeps `run_impl()` readable. The `safe` branch delegates to `runApprovedPipeline()`, which contains the full pipeline logic (story writing, image generation, assembly, PDF, storage).

### The `runApprovedPipeline` Method

The `safe` branch delegates to a separate method that contains the pipeline stages for approved topics:

```typescript
private async *runApprovedPipeline(
  topic: string,
  safetyResult: ContentSafetyResult,
  customization?: StoryCustomization,
): AsyncGenerator<any, PipelineResult, undefined> {
  // Stage 2: Story writing
  // Stage 3: Image generation (with failure tracking)
  // Stage 4: HTML assembly (with XSS escaping)
  // Stage 5: PDF generation
  // Stage 6: Working memory storage
  // Return PipelineResult
}
```

This keeps `run_impl()` focused on the high-level flow: run safety check, branch on the result, return the pipeline result. The implementation details of each branch are in their own methods.

---

## Putting It All Together

Here is the complete updated `run_impl()` incorporating all the changes from this part:

```typescript
protected override async *run_impl() {
  const dto = await this.get_dto();
  const { topic, customization } = dto.data;

  logger.info('[Pipeline] Starting story pipeline', { entityId: this.id, topic });

  // ─── Stage 1: Content safety check ──────────────────────────
  yield await this.createStatusEnvelope('RUNNING', 'Running content safety check');
  await this.updateEntityData({ stage: 'safety_check' });

  const safetyEntity = await this.appendOrRetrieveCall(
    ContentSafetyCheckEntity,
    'safety-check',
    { topic },
  );
  const safetyResult: ContentSafetyResult = yield* await safetyEntity.start();

  // ─── Branch on safety result ────────────────────────────────
  const pipelineResult: PipelineResult = yield* this.condition(
    'safety-gate',
    safetyResult.is_safe ? 'safe' : 'rejected',
    {
      rejected: async function*(this: StoryPipelineEntity) {
        await this.updateEntityData({ stage: 'rejected', safety_result: safetyResult });
        return { stage: 'rejected', safety_result: safetyResult } as PipelineResult;
      },
      safe: async function*(this: StoryPipelineEntity) {
        return yield* this.runApprovedPipeline(topic, safetyResult, customization);
      },
    },
  );

  return pipelineResult;
}
```

Notice how `run_impl()` is now just 25 lines. The safety check and the branch are clearly visible. All downstream pipeline logic is in `runApprovedPipeline()`, and the defensive measures (validation, escaping, failure tracking) are integrated at the appropriate layers.

---

## Testing the Validation

### Invalid Topic

```bash
# Empty topic
curl -s -X POST http://localhost:3001/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic":""}' | jq .

# Response: { "error": "Topic is required" }
```

### Invalid Style

```bash
curl -s -X POST http://localhost:3001/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic":"A brave kitten","customization":{"style":"pastel"}}' | jq .

# Response: { "error": "Invalid style. Must be one of: watercolor, digital-art, colored-pencil, storybook-classic, anime, paper-cutout" }
```

### Invalid Illustration Count

```bash
curl -s -X POST http://localhost:3001/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic":"A brave kitten","customization":{"illustration_count":25}}' | jq .

# Response: { "error": "illustration_count must be between 1 and 10" }
```

### Idempotent Entity Creation

```bash
# First request
curl -s -X POST http://localhost:3001/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic":"A brave kitten"}' | jq .entity_id

# "abc-123-..."

# Same request again
curl -s -X POST http://localhost:3001/api/create-story \
  -H 'Content-Type: application/json' \
  -d '{"topic":"A brave kitten"}' | jq .entity_id

# "abc-123-..." (same entity ID)
```

### Partial Completion

After a run where some images fail, inspect the entity data:

```bash
ff-eg-read node get <entity-id>
```

```json
{
  "stage": "completed_with_errors",
  "image_count": 4,
  "failed_images": 1,
  "pdf_wm_id": "...",
  "html_wm_id": "..."
}
```

---

## Key Takeaways

1. **Validate at the API boundary, trust internal code.** The `createStory` endpoint checks topic, style, quality, aspect ratio, and illustration count. Everything downstream trusts that entity data is well-formed. This eliminates redundant checks and keeps validation logic in one place.

2. **Deterministic naming prevents duplicate entities.** A slug from the topic plus a hash of the customization produces a stable entity name. Same inputs produce the same name, and `create_entity_node` returns the existing entity instead of creating a duplicate. Different customizations produce different names, preventing unintended collisions.

3. **Always escape LLM output before inserting into HTML.** LLM-generated `alt_text` can contain characters that break HTML attributes. The four-replacement pattern (`&`, `"`, `<`, `>`) is simple, dependency-free, and sufficient for attribute contexts. Order matters: escape `&` first to avoid double-escaping.

4. **Graceful degradation: partial results are better than total failure.** The three-way outcome (`completed`, `completed_with_errors`, `failed`) gives consumers actionable information. A story with 4 of 5 illustrations is useful; a failed pipeline with 0 results is not.

5. **The `condition()` helper provides structured branching.** It selects a branch by key, pushes a CALL_FRAME for deterministic child naming, and executes the selected generator. This keeps `run_impl()` concise and prevents entity name collisions across branches.

6. **Error messages should be self-documenting.** Including the invalid value and the list of valid options in the error message means callers can fix their request without consulting documentation.

7. **Track failure counts, not just success.** The `failedImages` counter and `failed_images` field in `PipelineResult` make partial completion observable. Without explicit tracking, there is no way to distinguish "all 5 images generated" from "5 of 7 images generated."

---

## Next Steps

The pipeline is now defensively coded -- invalid inputs are rejected early, duplicate requests produce the same entity, HTML output is safe from injection, and partial failures are handled gracefully. In [Part 9: Web UI](./part-09-web-ui.md), you'll build a Next.js frontend that lets users submit topics, choose styles and quality options, watch real-time progress via SSE, and download the finished storybook as a PDF.

---

**Previous:** [Part 7: Reference Images for Character Consistency](./part-07-reference-images.md) | **Next:** [Part 9: Web UI](./part-09-web-ui.md)
