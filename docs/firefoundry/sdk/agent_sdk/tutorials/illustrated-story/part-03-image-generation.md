# Part 3: Image Generation & HTML Assembly

In this part, you'll build the `ImageService` -- the component that takes the image prompts produced by the Story Writer Bot (Part 2), generates actual illustrations via the broker client, retrieves the images from blob storage, and assembles them into the final HTML document.

**What you'll learn:**
- Using `SimplifiedBrokerClient.generateImage()` to create images through the broker service
- Configuring image quality and aspect ratio with the broker client's enum types
- Retrieving generated images from blob storage with `createBlobStorage()`
- Converting image buffers to base64 for inline data URI embedding
- Assembling a final illustrated HTML document by replacing `{{IMAGE_N}}` placeholders
- Implementing a progress callback pattern for tracking multi-image generation

**What you'll build:** An `ImageService` class that generates illustrations from text prompts, retrieves them from blob storage, encodes them as base64 data URIs, and replaces placeholders in the HTML template to produce a fully illustrated document.

**Starting point:** Completed code from [Part 2: Story Writer Bot & Prompts](./part-02-story-writer.md). You should have a Story Writer Bot that produces HTML with `{{IMAGE_N}}` placeholders and a corresponding array of `ImagePrompt` objects.

---

## How Image Generation Works

Before writing code, understand the flow from text prompt to embedded image:

```
ImagePrompt { prompt, placeholder, alt_text }
       |
       v
SimplifiedBrokerClient.generateImage()
       |  (sends prompt to model pool)
       v
Image Generation Model (e.g., DALL-E, Stable Diffusion)
       |  (generates image, stores in blob storage)
       v
Response: { blobId, objectKey, format, sizeBytes }
       |
       v
createBlobStorage().getBlob(objectKey)
       |  (retrieves image bytes from Azure/S3)
       v
Buffer -> base64 encoding
       |
       v
<img src="data:image/png;base64,..." />
       |
       v
Replace {{IMAGE_N}} in HTML template
```

The broker acts as an intermediary. Your code never communicates directly with the image generation model. Instead, you send a prompt to a **model pool** (a named routing group), and the broker dispatches it to whatever image generation backend is configured for that pool. The generated image is automatically stored in blob storage, and you get back metadata including an `objectKey` you can use to retrieve the image bytes.

---

## Shared Types

The `ImageService` works with two key types shared across the pipeline. These were introduced in Part 2 as part of the Story Writer Bot's output, and now the `ImageService` consumes and produces them.

**`packages/shared/src/types.ts`** (relevant additions):

```typescript
export interface ImagePrompt {
  placeholder: string;   // e.g., "{{IMAGE_1}}"
  prompt: string;        // Detailed prompt for the image generation model
  alt_text: string;      // Accessible description for the <img> alt attribute
}

export interface GeneratedImageResult {
  placeholder: string;   // Matches the ImagePrompt's placeholder
  base64: string;        // Base64-encoded image data
  content_type: string;  // MIME type: "image/png" or "image/jpeg"
  alt_text: string;      // Carried through from the ImagePrompt
}
```

`ImagePrompt` is the input -- it comes from the Story Writer Bot. `GeneratedImageResult` is the output -- it contains everything needed to embed the image into HTML.

---

## Step 1: Create the ImageService

Create the `ImageService` class that handles all image generation and HTML assembly logic.

**`apps/story-bundle/src/services/image-service.ts`**:

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';
import {
  SimplifiedBrokerClient,
  AspectRatio,
  ImageQuality,
} from '@firebrandanalytics/ff_broker_client';
import { createBlobStorage } from '@firebrandanalytics/shared-utils/storage';
import type { ImagePrompt, GeneratedImageResult } from '@shared/types';

export class ImageService {
  private brokerClient: SimplifiedBrokerClient;

  constructor() {
    this.brokerClient = new SimplifiedBrokerClient({
      host: process.env.LLM_BROKER_HOST || 'localhost',
      port: parseInt(process.env.LLM_BROKER_PORT || '50052'),
    });
  }

  async generateImage(
    imagePrompt: ImagePrompt,
    modelPool: string = 'fb-image-gen'
  ): Promise<GeneratedImageResult> {
    logger.info('[ImageService] Generating image', {
      placeholder: imagePrompt.placeholder,
      prompt_preview: imagePrompt.prompt.substring(0, 80),
    });

    const result = await this.brokerClient.generateImage({
      modelPool,
      prompt: imagePrompt.prompt,
      semanticLabel: 'illustrated-story-image',
      quality: ImageQuality.IMAGE_QUALITY_MEDIUM,
      aspectRatio: AspectRatio.ASPECT_RATIO_3_2,
    });

    if (!result.images || result.images.length === 0) {
      throw new Error(`No images generated for ${imagePrompt.placeholder}`);
    }

    const image = result.images[0];
    logger.info('[ImageService] Image generated', {
      placeholder: imagePrompt.placeholder,
      blob_id: image.blobId,
      object_key: image.objectKey,
      format: image.format,
      size_bytes: image.sizeBytes,
    });

    const base64 = await this.retrieveImageAsBase64(image.objectKey);
    const contentType = image.format === 'png' ? 'image/png' : 'image/jpeg';

    return {
      placeholder: imagePrompt.placeholder,
      base64,
      content_type: contentType,
      alt_text: imagePrompt.alt_text,
    };
  }

  async generateAllImages(
    imagePrompts: ImagePrompt[],
    onProgress?: (generated: number, total: number) => void,
    modelPool?: string,
  ): Promise<GeneratedImageResult[]> {
    const results: GeneratedImageResult[] = [];
    const total = imagePrompts.length;

    for (let i = 0; i < imagePrompts.length; i++) {
      const result = await this.generateImage(imagePrompts[i], modelPool);
      results.push(result);
      onProgress?.(i + 1, total);
    }

    return results;
  }

  assembleHtml(htmlTemplate: string, images: GeneratedImageResult[]): string {
    let html = htmlTemplate;
    for (const img of images) {
      const imgTag = `<img src="data:${img.content_type};base64,${img.base64}" alt="${img.alt_text}" style="max-width:100%; border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" />`;
      html = html.replace(img.placeholder, imgTag);
    }
    return html;
  }

  private async retrieveImageAsBase64(objectKey: string): Promise<string> {
    const blobStorage = createBlobStorage();
    const { readableStream } = await blobStorage.getBlob(objectKey);

    const chunks: Buffer[] = [];
    for await (const chunk of readableStream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return buffer.toString('base64');
  }
}
```

This is the entire service in one file. Let's break down each method and the concepts behind them.

---

## Step 2: Understand the Broker Client and Image Generation

### SimplifiedBrokerClient

The `SimplifiedBrokerClient` is the high-level client for communicating with the FireFoundry Broker Service. While most of the report-generator tutorial used the broker for text completions, here we use its `generateImage()` method -- added in broker client v1.2.0.

```typescript
this.brokerClient = new SimplifiedBrokerClient({
  host: process.env.LLM_BROKER_HOST || 'localhost',
  port: parseInt(process.env.LLM_BROKER_PORT || '50052'),
});
```

The broker client connects over gRPC (port 50052 by default). In a deployed cluster, this points to the in-cluster broker service. For local development, you port-forward the broker:

```bash
kubectl port-forward svc/firefoundry-core-broker -n ff-dev 50052:50052
```

### The generateImage() Method

```typescript
const result = await this.brokerClient.generateImage({
  modelPool,
  prompt: imagePrompt.prompt,
  semanticLabel: 'illustrated-story-image',
  quality: ImageQuality.IMAGE_QUALITY_MEDIUM,
  aspectRatio: AspectRatio.ASPECT_RATIO_3_2,
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `modelPool` | `string` | Named routing group that maps to an image generation backend (e.g., `'fb-image-gen'`) |
| `prompt` | `string` | The text description of the image to generate |
| `semanticLabel` | `string` | A label for telemetry and logging -- helps you filter image requests in monitoring |
| `quality` | `ImageQuality` | Enum controlling the fidelity/cost tradeoff |
| `aspectRatio` | `AspectRatio` | Enum controlling the output dimensions |

The method returns a response containing an `images` array. Each image entry includes metadata about the generated image:

```typescript
interface ImageGenerationResult {
  images: Array<{
    blobId: string;      // Unique identifier in blob storage
    objectKey: string;   // Storage path for retrieval
    format: string;      // 'png' or 'jpeg'
    sizeBytes: number;   // File size
  }>;
}
```

The image bytes are not returned inline -- they are stored in blob storage by the broker service, and you receive the `objectKey` needed to retrieve them.

### ImageQuality Enum

The `ImageQuality` enum controls the generation quality and directly affects cost and latency:

| Value | Description |
|-------|-------------|
| `IMAGE_QUALITY_LOW` | Fastest, lowest cost. Good for thumbnails and previews. |
| `IMAGE_QUALITY_MEDIUM` | Balanced quality and speed. Good for most use cases. |
| `IMAGE_QUALITY_HIGH` | Highest fidelity. Use for final production images. |

For a children's storybook, `MEDIUM` provides a good balance -- the images are detailed enough to be engaging while keeping generation time reasonable for a pipeline that produces multiple images.

### AspectRatio Enum

The `AspectRatio` enum controls the output image dimensions:

| Value | Ratio | Typical Use |
|-------|-------|-------------|
| `ASPECT_RATIO_1_1` | 1:1 (square) | Profile images, icons |
| `ASPECT_RATIO_3_2` | 3:2 (landscape) | Story illustrations, banners |
| `ASPECT_RATIO_2_3` | 2:3 (portrait) | Book covers, posters |
| `ASPECT_RATIO_16_9` | 16:9 (widescreen) | Presentations, video thumbnails |

We use `ASPECT_RATIO_3_2` because landscape illustrations work well for storybook pages -- they span the width of the page and give the image generation model more horizontal space for scene composition.

---

## Step 3: Understand Blob Storage Retrieval

After the broker generates an image, the image bytes live in blob storage (Azure Blob Storage or S3, depending on your deployment). The `retrieveImageAsBase64` method fetches those bytes.

```typescript
private async retrieveImageAsBase64(objectKey: string): Promise<string> {
  const blobStorage = createBlobStorage();
  const { readableStream } = await blobStorage.getBlob(objectKey);

  const chunks: Buffer[] = [];
  for await (const chunk of readableStream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  return buffer.toString('base64');
}
```

### createBlobStorage()

The `createBlobStorage()` factory from `@firebrandanalytics/shared-utils/storage` auto-detects the storage backend from environment variables. It returns a unified interface regardless of whether you are using Azure Blob Storage or AWS S3.

The detection logic checks these environment variables:

```
# Azure Blob Storage
BLOB_STORAGE_PROVIDER=azure
BLOB_STORAGE_ACCOUNT=firebrand
BLOB_STORAGE_KEY=<your-storage-key>
BLOB_STORAGE_CONTAINER=image-gen

# AWS S3 (alternative)
BLOB_STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
BLOB_STORAGE_BUCKET=image-gen
```

In a deployed FireFoundry cluster, these environment variables are typically pre-configured in the deployment's ConfigMap or Secret. For local development, add them to your `.env` file.

### Streaming Retrieval

The `getBlob()` method returns a `readableStream` rather than a complete buffer. This is important for large images -- streaming avoids holding the entire image in memory twice. The code collects chunks into an array and concatenates them into a single `Buffer` at the end:

```typescript
const chunks: Buffer[] = [];
for await (const chunk of readableStream as AsyncIterable<Buffer>) {
  chunks.push(Buffer.from(chunk));
}
const buffer = Buffer.concat(chunks);
```

### Base64 Encoding

The final step converts the binary image data to a base64 string:

```typescript
return buffer.toString('base64');
```

Base64 encoding increases the data size by approximately 33%, but it allows embedding the image directly in HTML as a data URI. This means the final HTML document is completely self-contained -- no external image URLs that might break or require authentication.

---

## Step 4: Understand Sequential Generation and Progress Tracking

### generateAllImages()

The `generateAllImages` method iterates through all image prompts and generates them one at a time:

```typescript
async generateAllImages(
  imagePrompts: ImagePrompt[],
  onProgress?: (generated: number, total: number) => void,
  modelPool?: string,
): Promise<GeneratedImageResult[]> {
  const results: GeneratedImageResult[] = [];
  const total = imagePrompts.length;

  for (let i = 0; i < imagePrompts.length; i++) {
    const result = await this.generateImage(imagePrompts[i], modelPool);
    results.push(result);
    onProgress?.(i + 1, total);
  }

  return results;
}
```

**Why sequential, not parallel?** Image generation is the most resource-intensive operation in the pipeline. Generating all images concurrently would:

1. Spike resource usage on the image generation backend
2. Risk hitting rate limits on the underlying model API
3. Make it harder to report meaningful progress (all images would appear to finish at once)

Sequential generation provides predictable load and clean progress reporting. In a future optimization phase, you could add controlled concurrency (e.g., 2-3 images at a time) using `Promise.all` with batching, but sequential is the correct starting point.

### The onProgress Callback Pattern

The optional `onProgress` callback lets callers track generation progress without coupling the service to any specific progress-reporting mechanism:

```typescript
onProgress?.(i + 1, total);  // e.g., onProgress(3, 5) = "3 of 5 images done"
```

In Part 4, you'll see how the pipeline orchestrator connects this callback to `INTERNAL_UPDATE` events:

```typescript
// Preview of how the orchestrator uses onProgress (covered in Part 4)
const images = await this.imageService.generateAllImages(
  imagePrompts,
  (generated, total) => {
    // This becomes an INTERNAL_UPDATE event that clients see in real time
    emitProgress(`Generating illustrations: ${generated}/${total}`);
  }
);
```

This separation keeps the `ImageService` focused on image generation while the orchestrator handles progress reporting. The service does not know or care whether progress is displayed in a terminal, a web UI, or logged to a file.

---

## Step 5: Understand HTML Assembly

The `assembleHtml` method is the final step -- it takes the HTML template (with `{{IMAGE_N}}` placeholders) and replaces each placeholder with an actual `<img>` tag containing the base64-encoded image.

```typescript
assembleHtml(htmlTemplate: string, images: GeneratedImageResult[]): string {
  let html = htmlTemplate;
  for (const img of images) {
    const imgTag = `<img src="data:${img.content_type};base64,${img.base64}" alt="${img.alt_text}" style="max-width:100%; border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" />`;
    html = html.replace(img.placeholder, imgTag);
  }
  return html;
}
```

### How Placeholders Work

In Part 2, the Story Writer Bot was instructed to produce HTML with placeholders like `{{IMAGE_1}}`, `{{IMAGE_2}}`, etc. Each placeholder corresponds to an entry in the `image_prompts` array with a matching `placeholder` field. The `assembleHtml` method connects these two outputs:

```
Story Writer Bot output:
  html_content: "<div>Once upon a time... {{IMAGE_1}} ...the dragon appeared {{IMAGE_2}}</div>"
  image_prompts: [
    { placeholder: "{{IMAGE_1}}", prompt: "A child walking...", alt_text: "..." },
    { placeholder: "{{IMAGE_2}}", prompt: "A friendly dragon...", alt_text: "..." }
  ]

After generateAllImages():
  GeneratedImageResult[]:
    [
      { placeholder: "{{IMAGE_1}}", base64: "iVBOR...", content_type: "image/png", ... },
      { placeholder: "{{IMAGE_2}}", base64: "R0lGO...", content_type: "image/jpeg", ... }
    ]

After assembleHtml():
  "<div>Once upon a time... <img src="data:image/png;base64,iVBOR..." /> ...the dragon appeared <img src="data:image/jpeg;base64,R0lGO..." /></div>"
```

### Data URIs

The `<img>` tag uses a [data URI](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs) rather than a URL pointing to an external file:

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..." alt="A child walking through a meadow" />
```

This approach makes the HTML document completely self-contained. The images are embedded directly in the markup, which means:

- The HTML can be opened in any browser without a web server
- No broken image links if storage credentials change
- The document can be converted to PDF without network access
- The file can be emailed or shared as a single artifact

The tradeoff is file size -- a story with 5 images might produce an HTML file of 5-10 MB. For a children's storybook, this is acceptable. For applications with many high-resolution images, you would instead store images as separate files and reference them by URL.

### Inline Styles

The `<img>` tag includes inline CSS for presentation:

```html
style="max-width:100%; border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);"
```

| Property | Effect |
|----------|--------|
| `max-width: 100%` | Image scales to fit its container, never overflows |
| `border-radius: 8px` | Rounded corners for a softer, storybook-like feel |
| `box-shadow: 0 2px 8px rgba(0,0,0,0.15)` | Subtle shadow that lifts the image off the page |

These styles are inline (rather than in a `<style>` block) because the `assembleHtml` method does not modify the `<head>` of the HTML -- it only performs string replacement at the placeholder positions.

---

## Step 6: Environment Configuration

The `ImageService` depends on two sets of environment variables -- one for the broker connection and one for blob storage retrieval.

### Broker Connection

```
LLM_BROKER_HOST=localhost
LLM_BROKER_PORT=50052
```

For local development with port-forwarding:

```bash
kubectl port-forward svc/firefoundry-core-broker -n ff-dev 50052:50052
```

In a deployed cluster, these are typically set to the in-cluster service address (e.g., `firefoundry-core-broker.ff-dev.svc.cluster.local`).

### Blob Storage

```
BLOB_STORAGE_PROVIDER=azure
BLOB_STORAGE_ACCOUNT=firebrand
BLOB_STORAGE_KEY=<your-storage-account-key>
BLOB_STORAGE_CONTAINER=image-gen
```

These must match the blob storage configuration used by the broker service. When the broker generates an image, it writes the result to this storage location. The `ImageService` reads from the same location using `createBlobStorage()`.

### Complete .env Example

Add these to your `apps/story-bundle/.env` file (or your deployment's ConfigMap):

```
# Broker service (image generation)
LLM_BROKER_HOST=localhost
LLM_BROKER_PORT=50052

# Blob storage (image retrieval)
BLOB_STORAGE_PROVIDER=azure
BLOB_STORAGE_ACCOUNT=firebrand
BLOB_STORAGE_KEY=<your-storage-account-key>
BLOB_STORAGE_CONTAINER=image-gen
```

---

## The Complete Image Generation Flow

Here is the full lifecycle of a single image, from Story Writer Bot output to embedded HTML:

```
Story Writer Bot
  |
  |-- Produces ImagePrompt:
  |     { placeholder: "{{IMAGE_1}}",
  |       prompt: "A watercolor illustration of a curious young fox
  |               standing at the edge of a magical forest...",
  |       alt_text: "A young fox gazing into a glowing forest" }
  |
  v
ImageService.generateImage()
  |
  |-- SimplifiedBrokerClient.generateImage({
  |       modelPool: 'fb-image-gen',
  |       prompt: "A watercolor illustration of a curious...",
  |       quality: IMAGE_QUALITY_MEDIUM,
  |       aspectRatio: ASPECT_RATIO_3_2
  |   })
  |
  |-- Broker routes to image generation model
  |-- Model generates image, broker stores in blob storage
  |-- Returns: { blobId, objectKey: "image-gen/abc123.png", format: "png" }
  |
  v
ImageService.retrieveImageAsBase64()
  |
  |-- createBlobStorage() -> Azure/S3 client
  |-- getBlob("image-gen/abc123.png") -> readableStream
  |-- Collect chunks -> Buffer -> base64 string
  |
  v
GeneratedImageResult
  { placeholder: "{{IMAGE_1}}",
    base64: "iVBORw0KGgoAAAANSUhEUg...",
    content_type: "image/png",
    alt_text: "A young fox gazing into a glowing forest" }
  |
  v
ImageService.assembleHtml()
  |
  |-- html.replace("{{IMAGE_1}}", '<img src="data:image/png;base64,iVBOR..." />')
  |
  v
Final HTML with embedded illustration
```

---

## What You've Built

You now have:
- An `ImageService` that generates illustrations from text prompts using the broker client's `generateImage()` method
- Blob storage retrieval that auto-detects Azure or S3 from environment variables
- Base64 encoding that produces self-contained data URIs for embedding images in HTML
- An `assembleHtml` method that replaces `{{IMAGE_N}}` placeholders with fully rendered `<img>` tags
- A progress callback pattern that decouples generation tracking from the service's core logic
- Sequential image generation that provides predictable load and clean progress reporting

---

## Key Takeaways

1. **The broker abstracts image generation backends** -- `SimplifiedBrokerClient.generateImage()` sends a prompt to a model pool, and the broker routes it to whatever image generation model is configured. Your code never interacts with the underlying model API directly.

2. **Generated images live in blob storage, not in the response** -- the broker stores the image and returns metadata (`objectKey`, `format`, `sizeBytes`). You must retrieve the image bytes separately using `createBlobStorage().getBlob()`.

3. **`createBlobStorage()` auto-detects the storage provider** -- it reads environment variables to determine whether to use Azure Blob Storage or S3. This means the same code works in any deployment without changes.

4. **Base64 data URIs make the HTML self-contained** -- embedding images as `data:image/png;base64,...` means the document has no external dependencies. This is essential for PDF conversion (Part 5) where the renderer may not have network access.

5. **Sequential generation is the right starting point** -- generating images one at a time gives you clean progress reporting, predictable resource usage, and simpler error handling. Parallelization is an optimization for later.

6. **The progress callback pattern separates concerns** -- `onProgress` lets the caller decide how to report progress (INTERNAL_UPDATE events, console logs, UI updates) without the service needing to know about any of those mechanisms.

7. **Placeholder-based assembly is simple and reliable** -- `String.replace()` is the right tool for connecting the Story Writer Bot's HTML template to the generated images. The `placeholder` field in both `ImagePrompt` and `GeneratedImageResult` is the key that links them.

---

## Next Steps

The `ImageService` is a standalone utility -- it does not know about entities, bots, or the pipeline. In [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-orchestration.md), you'll wire everything together: the Content Safety Bot (Part 1), the Story Writer Bot (Part 2), the ImageService (this part), and a PDF generation step into a multi-stage pipeline. You'll build the orchestrator entity that manages the full lifecycle and expose REST endpoints for triggering stories and polling progress.
