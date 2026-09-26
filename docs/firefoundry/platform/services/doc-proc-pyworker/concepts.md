# Document Processing Python Worker: Concepts

This page covers what the worker-backed capabilities do, how to choose between them, and how to fit them into an app. You use every capability through the [Document Processing Service](../doc-proc-service/README.md).

## How a Request Flows

1. Your bundle sends a document to the Document Processing Service, either as a multipart upload or as a working-memory reference.
2. The service sees that the operation is worker-backed and forwards the document bytes and options to the worker.
3. The worker processes the document and returns a result, usually JSON. For image outputs, the JSON carries base64-encoded images.
4. The service returns the result to you and applies its usual caching and request logging.

The worker stores nothing. It needs no setup from your app beyond having the capability enabled in your environment.

## Capabilities

| Capability | Operation name | Input | Result | Availability |
|------------|----------------|-------|--------|--------------|
| PDF to images | `pdf_to_images` | PDF | JSON list of base64 page images | Standard |
| Structured extraction | `extract_structured` | PDF | JSON (or HTML): text and tables per page | Standard |
| Advanced table extraction | `extract_tables` | PDF | JSON list of tables with accuracy scores | Extended image |
| Local OCR | `ocr_local` | PDF or image | JSON text per page, optional word boxes | Extended image |
| Neural OCR | `ocr_advanced` | PDF or image | JSON text and detections with confidence | Extended image |
| Image upscaling | `upscale_image` | PNG, JPEG, WebP, TIFF | JSON with base64 image | Standard |
| Colorspace conversion | `convert_colorspace` | Image | JSON with base64 image | Standard |

Your app sees the operation names in results and in error messages such as `No backend found for operation 'ocr_local'`. The Document Processing Service also accepts dash-style names (`pdf-to-images`).

### Standard and extended capabilities

The standard worker image includes the four Standard capabilities. OCR and advanced table extraction need an **extended worker image**, which your environment administrator must deploy. Two environments can both have the worker enabled and still offer different capabilities. For how to check yours, see [Getting Started](./getting-started.md#step-3-check-which-capabilities-your-environment-supports).

## Choosing a Capability

### Reading text from PDFs

| Situation | Use |
|-----------|-----|
| Digital (text-layer) PDF; you want plain text | The Document Processing Service's built-in text extraction |
| Digital PDF; you need page structure, simple tables, or word positions | **Structured extraction** (`extract_structured`) |
| Scanned PDF or photo; data must stay local, or cloud OCR cost matters | **Local OCR** (`ocr_local`), English |
| Scanned content in several languages, or poor-quality scans | **Neural OCR** (`ocr_advanced`) |
| You need the best layout analysis and can use Azure | The Document Processing Service's Azure Document Intelligence endpoints |

### Extracting tables

- **Structured extraction** returns the tables it finds on each page, next to the page text. It is available on the standard image.
- **Advanced table extraction** handles harder layouts. `lattice` suits tables with visible cell borders, and `stream` suits columns aligned by whitespace. Each table carries an `accuracy` score that your app can use to reject bad extractions.

### Feeding pages to a vision model

Use **PDF to images** with a moderate DPI (150–200) and a page list. Higher DPI makes larger images and slower requests, and it rarely helps a vision model.

### Preparing images for print

A common pipeline is AI-generated image, then **upscale**, then **convert to CMYK**:

1. Upscale with `provider=lanczos` (local, any size) or `provider=stability` (AI, output capped at 2048×2048).
2. Convert to `cmyk` with `output_format=tiff`. PNG cannot hold CMYK.

## Page Selection and Page Numbers

PDF capabilities accept a `pages` option with 1-based pages and ranges, such as `1`, `1,3,5`, `2-4`, or `1-3,7`. How page numbers appear in results depends on the capability, so account for this when you map results back to the original document:

| Capability | Page numbers in the result |
|------------|----------------------------|
| Structured extraction, advanced table extraction | **Renumbered from 1** within the selected pages. With `pages=5-6`, the results show pages 1 and 2. |
| PDF to images, local OCR, neural OCR | **Original** page numbers are kept |

For structured and table extraction, a page past the end of the document is an error. Check the page count first, for example with the Document Processing Service's metadata extraction.

## Upscaling Providers

| Provider | Runs | Scale factors | Notes |
|----------|------|---------------|-------|
| `lanczos` | Locally | 2, 3, 4, 6, 8 | Free, with no size cap. Good for text and diagrams. |
| `stability` | Stability AI API | 2, 4 | AI super-resolution. Needs a Stability AI key in your environment. Output is capped at 2048×2048. |
| `auto` | Either | 2–8 | Uses the environment's default provider when it can, otherwise any provider that supports the request |

If you omit `provider`, the worker uses **`stability`**. Unless you know your environment has a Stability AI key, pass `provider=lanczos` explicitly.

## Colorspace and ICC Profiles

Colorspace conversion uses ICC profiles:

- **Source**: the image's embedded profile if it has one, otherwise sRGB.
- **Target**: for `cmyk`, the environment's default CMYK profile (`FOGRA39`). For RGB targets, sRGB or Adobe RGB.
- The standard image ships a generic CMYK profile, and the `FOGRA39` name resolves to it. If your print vendor requires certified profiles (FOGRA39, SWOP, GRACoL, Adobe RGB), ask your environment administrator to install them. The response's `conversion.target_profile` shows which profile the worker used.

## Example App Designs

- **Invoice intake**: upload the PDF, run structured extraction to get text and tables, and fall back to local OCR for pages that return little text.
- **Visual Q&A over reports**: convert the pages the user asks about to images at 150 DPI and send them to a vision-capable model.
- **Print-on-demand artwork**: generate an image, upscale 4x with Lanczos, convert to CMYK TIFF, and store the result in working memory.

## Related

- [Reference](./reference.md): exact options and result shapes
- [Operations](./operations.md): limits and troubleshooting
- [Document Processing Service: Concepts](../doc-proc-service/concepts.md)
