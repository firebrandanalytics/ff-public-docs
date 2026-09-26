# Document Processing Python Worker: Reference

This page lists the options, result shapes, and errors for each worker-backed capability. You reach these capabilities through the [Document Processing Service](../doc-proc-service/reference.md). For which endpoints and request parameters the service exposes in your version, see its reference. The option names and defaults below are the ones the worker applies.

## Conventions

- **Option values are strings**, for example `"300"` or `"true"`. The worker ignores unknown options.
- **`pages`** takes 1-based pages and ranges, such as `1,3,5-10`. If you omit it, the worker processes all pages. For how page numbers appear in results, see [Concepts: Page Selection](./concepts.md#page-selection-and-page-numbers).
- **Image results** are returned as base64 strings inside JSON.

## Endpoints on the Document Processing Service

| Endpoint | Capability |
|----------|------------|
| `POST /api/pdf-to-images` | PDF to images |
| `POST /api/upscale-image` | Image upscaling |
| `POST /api/convert-colorspace` | Colorspace conversion |

Each endpoint takes the input document as a multipart `file`.

## PDF to Images (`pdf_to_images`)

**Availability:** Standard

| Option | Default | Values |
|--------|---------|--------|
| `pages` | all | page list (original page numbers are kept) |
| `dpi` | `200` | integer |
| `format` | `png` | `png`, `jpeg`, `jpg` |

The image encoding option is named `format`, not `output_format`.

```json
{
  "images": [
    { "page": 1, "data": "<base64>", "format": "png", "width": 1700, "height": 2200 }
  ]
}
```

## Structured Extraction (`extract_structured`)

**Availability:** Standard

| Option | Default | Values |
|--------|---------|--------|
| `pages` | all | page list (results are renumbered from 1; an out-of-range page is an error) |
| `output_format` | `json` | `json`, `html` |
| `include_bounding_boxes` | `false` | `true`, `false` (adds per-word coordinates) |

```json
{
  "pages": [
    {
      "page_number": 1,
      "text": "extracted page text",
      "tables": [ { "table_index": 0, "data": [["cell", "cell"], ["cell", null]] } ],
      "words": [ { "text": "Invoice", "x0": 72.0, "y0": 90.1, "x1": 118.4, "y1": 101.3 } ]
    }
  ]
}
```

`words` appears only when `include_bounding_boxes=true`. With `output_format=html`, you get an HTML document with one `<div class="page">` per page, holding a `<pre>` text block and `<table>` elements.

## Advanced Table Extraction (`extract_tables`)

**Availability:** Extended worker image

| Option | Default | Values |
|--------|---------|--------|
| `pages` | all | page list (results are renumbered from 1; an out-of-range page is an error) |
| `table_flavor` | `lattice` | `lattice` (ruled tables with visible borders), `stream` (whitespace-separated columns) |

```json
{
  "tables": [
    { "page": "1", "data": [["Item", "Qty"], ["Widget", "4"]], "accuracy": 99.2, "table_index": 0 }
  ]
}
```

`page` is a string in this result.

## Local OCR (`ocr_local`)

**Availability:** Extended worker image. Accepts a PDF or a single image.

| Option | Default | Values |
|--------|---------|--------|
| `pages` | all | page list, PDF only (original page numbers are kept) |
| `language` | `eng` | Tesseract language codes. Standard OCR images include English only. |
| `dpi` | `300` | integer (resolution used to render PDF pages) |
| `include_bounding_boxes` | `false` | `true`, `false` (adds word boxes and average `confidence`) |

```json
{
  "pages": [
    {
      "page": 1,
      "text": "recognized text",
      "confidence": 87.5,
      "words": [ { "text": "Total", "confidence": 96.0, "x": 102, "y": 540, "width": 48, "height": 14 } ]
    }
  ]
}
```

## Neural OCR (`ocr_advanced`)

**Availability:** Extended worker image. Accepts a PDF or a single image.

| Option | Default | Values |
|--------|---------|--------|
| `pages` | all | page list, PDF only (original page numbers are kept) |
| `language` | `en` | comma-separated language codes, such as `en,es` |
| `dpi` | `300` | integer |
| `gpu` | `false` | `true`, `false` (takes effect only if the environment provides a GPU) |

A worker replica loads its OCR model with the `language` and `gpu` settings of the first neural OCR request it serves, and keeps those settings for later requests. Use the same language set across your app.

```json
{
  "pages": [
    {
      "page": 1,
      "text": "all detections joined by spaces",
      "detections": [
        { "text": "Total", "confidence": 0.95, "bbox": [[10, 20], [60, 20], [60, 34], [10, 34]] }
      ]
    }
  ]
}
```

## Image Upscaling (`upscale_image`)

**Availability:** Standard. Input can be PNG, JPEG, WebP, or TIFF.

| Option | Default | Values |
|--------|---------|--------|
| `provider` | `stability` | `stability`, `lanczos`, `auto` |
| `scale_factor` | `2` | `stability`: `2`, `4`; `lanczos`: `2`, `3`, `4`, `6`, `8`; `auto`: `2`–`8` |
| `output_format` | `png` | `png`, `jpeg`, `jpg`, `webp`, `tiff` |

`stability` needs a Stability AI key in your environment and rejects output larger than 2048×2048. `lanczos` runs locally and has no size cap.

```json
{
  "image": {
    "data": "<base64>",
    "format": "png",
    "mime_type": "image/png",
    "width": 3072,
    "height": 3072,
    "original_width": 1024,
    "original_height": 1024
  },
  "method": "pillow-lanczos",
  "provider": "lanczos",
  "metadata": { "scale_factor": "3" }
}
```

## Colorspace Conversion (`convert_colorspace`)

**Availability:** Standard

| Option | Default | Values |
|--------|---------|--------|
| `target_colorspace` | `cmyk` | `cmyk`, `srgb`, `rgb`, `adobe_rgb` |
| `source_profile` | auto | `embedded` or a profile name. Auto uses the embedded profile, otherwise sRGB. |
| `target_profile` | `default` | `default` or a profile name |
| `rendering_intent` | `perceptual` | `perceptual`, `relative_colorimetric`, `saturation`, `absolute_colorimetric` |
| `output_format` | `tiff` | `tiff`, `jpeg`, `jpg`, `png` (PNG cannot hold CMYK) |
| `preserve_transparency` | `false` | `true`, `false` (CMYK has no alpha channel) |

Profile names are case-insensitive: `srgb`, `adobe_rgb`, `fogra39`, `swop`, `gracol`, `generic_cmyk`. Only sRGB and a generic CMYK profile are always present, and `fogra39` resolves to the generic CMYK profile. Your environment administrator must install any other profile.

```json
{
  "image": {
    "data": "<base64>",
    "format": "tiff",
    "mime_type": "image/tiff",
    "width": 1700,
    "height": 2200,
    "colorspace": "CMYK"
  },
  "conversion": {
    "source_colorspace": "RGB",
    "target_colorspace": "CMYK",
    "source_profile": "sRGB (assumed)",
    "target_profile": "FOGRA39",
    "rendering_intent": "perceptual"
  },
  "metadata": {}
}
```

## Errors

The Document Processing Service passes worker failures back to your app. These are the messages you may see:

| Message | Meaning | What to do |
|---------|---------|------------|
| `No backend found for operation '<op>'` | Your environment's worker image doesn't include this capability, or the operation doesn't exist. `detect_language` doesn't exist. | Check [supported capabilities](./getting-started.md#step-3-check-which-capabilities-your-environment-supports). Ask your administrator for an extended image. |
| `Processing failed: Invalid page number N. Document has M pages.` | The `pages` list goes past the end of the document | Check the page count first |
| `Processing failed: Invalid page range: a-b (start > end)` | Malformed `pages` value | Fix the range |
| `Processing failed: Invalid <option>: ...` | Option value outside its allowed set | Use a value from the tables above |
| `Processing failed: Invalid image data: ...` | The input isn't a readable image | Check the file and its format |
| `Processing failed: Stability AI API key is required. ...` | `provider=stability` (the default) and your environment has no key | Pass `provider=lanczos` |
| `... would exceed maximum allowed (2048x2048)` | Stability AI output cap | Use a smaller scale factor or `provider=lanczos` |
| `Profile 'X' not found. Available profiles: [...]` | The requested ICC profile isn't installed | Use a listed profile, or ask your administrator to install it |

If the worker is disabled, unreachable, or too slow, the Document Processing Service returns an error without a worker message. See [Operations: Troubleshooting](./operations.md#troubleshooting).

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
- [Document Processing Service: Reference](../doc-proc-service/reference.md)
