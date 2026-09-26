# Document Processing — Reference

The Document Processing Service API contract: request conventions, endpoints and their options, response formats, and errors.

In-cluster base URL: `http://firefoundry-core-doc-proc-service:8081`.

## Request Conventions

Every processing endpoint is a `POST` that takes one input document, an operation-specific set of options, and an optional output target.

### Input

Provide exactly one of:

- **A file upload**: `multipart/form-data` with the document in the `file` field (`files` for `merge-documents`). The **file name's extension decides the format** (`report.pdf`, `deck.pptx`, `scan.png`), so send a real file name. If your upload has none, add a `filename` form field.
- **A working memory reference**: an `input` field containing `{"working_memory_id": "<id>"}`. The format comes from the working memory record's name. Add `"filename"` inside `input` to override it. `input` can be a form field holding JSON, or part of an `application/json` request body.

### Options

Pass options as individual form fields (`-F "pages=1-3" -F "landscape=true"`) or as one `options` field holding a JSON object. `true`/`false` and plain numbers in form fields are converted to booleans and numbers.

### Output target (optional)

By default the result comes back in the response. To store it in [Context Service](../context-service/README.md) working memory instead, send an `output` field with `{"entity_node_id": "<entity id>"}`. The response is then a JSON object whose `working_memory_id` points to the stored result, with no `data`. If the input came from working memory, the result is stored under that input's entity unless you name another.

### JSON-body requests

When the input is a working memory reference, you can send everything as JSON:

```json
{
  "input": { "working_memory_id": "wm-12345" },
  "options": { "pages": "1-5" },
  "output": { "entity_node_id": "entity-abc" }
}
```

## Responses

### Default: the result itself

With no `Accept: application/json` header, the response body is the result:

- **Text results** (`extract-text`, `extract-general`, OCR text): plain text.
- **JSON results** (`extract-structured`, `extract-metadata`, `analyze-document`, worker operations, `split-pdf`): a JSON document. Depending on the operation, the `Content-Type` may be `text/plain` or `application/octet-stream`, so parse the body as JSON rather than relying on the header.
- **Binary results** (PDF, DOCX, XLSX): the file bytes with a matching `Content-Type`.

Every successful response has an `X-Cache` header: `HIT` (served from cache), `MISS` (computed), or `PARTIAL` (some pages served from cache).

### JSON envelope

Send `Accept: application/json` or add `?format=json` to get the result with metadata:

```json
{
  "success": true,
  "data": "Extracted text...",
  "format": "text/plain",
  "metadata": {
    "backend_used": "pdf-parse",
    "processing_time_ms": 150,
    "cached": false
  }
}
```

| Field | Description |
|-------|-------------|
| `success` | Whether the operation succeeded |
| `data` | The result. For text and JSON results this is a string; parse it again for JSON results. |
| `format` | Result format, as a short name (`json`, `csv`) or a MIME type (`application/json`, `text/plain`) |
| `metadata` | `backend_used`, `processing_time_ms`, `cached`, plus operation-specific fields |
| `working_memory_id` | Present instead of `data` when you set an output target |

Use the envelope for text and JSON results. For binary results (PDF, DOCX, XLSX), use the default response. The envelope does not carry binary data in a convenient form.

## Endpoint Summary

"Needs" says what must be enabled in your environment (see [Operations](./operations.md#optional-backends)).

| Endpoint | Input formats | Needs |
|----------|---------------|-------|
| [`extract-text`](#post-apiextract-text) | PDF, DOCX | — |
| [`extract-structured`](#post-apiextract-structured) | PDF, DOCX, XLSX/XLS, PPTX/PPSX/PPTM; images with the worker | — |
| [`extract-metadata`](#post-apiextract-metadata) | PDF, DOCX | — |
| [`extract-general`](#post-apiextract-general) | PDF, DOCX, XLSX/XLS, CSV, TXT/MD, images | Azure DI for images and OCR fallback |
| [`extract-sheet-to-csv`](#post-apiextract-sheet-to-csv) | XLSX, XLS | — |
| [`analyze-document`](#post-apianalyze-document) | PDF, PNG, JPG, TIFF, BMP | Azure DI |
| [`extract-text-ocr`](#post-apiextract-text-ocr) | PDF, PNG, JPG, TIFF, BMP | Azure DI |
| [`extract-tables`](#post-apiextract-tables) | PDF, images | Python worker (extended image), or Azure DI when the worker is off |
| [`ocr`, `ocr-local`](#post-apiocr-and-post-apiocr-local) | PDF, images | Python worker (extended image) |
| [`ocr-advanced`](#post-apiocr-advanced) | PDF, images | Python worker (extended image) |
| [`html-to-pdf`, `generate-pdf`](#post-apihtml-to-pdf-and-post-apigenerate-pdf) | HTML | — |
| [`create-excel`](#post-apicreate-excel) | XLSX template | — |
| [`create-docx`](#post-apicreate-docx) | DOCX template | — |
| [`extract-pages`](#post-apiextract-pages) | PDF | — |
| [`split-pdf`](#post-apisplit-pdf) | PDF | — |
| [`merge-documents`](#post-apimerge-documents) | PDF | — (see limitation) |
| [`image-to-pdf`](#post-apiimage-to-pdf) | PNG, JPG | — |
| [`pdf-to-images`](#post-apipdf-to-images) | PDF | Python worker |
| [`upscale-image`](#post-apiupscale-image) | PNG, JPEG, WebP, TIFF | Python worker |
| [`convert-colorspace`](#post-apiconvert-colorspace) | Images (PNG, JPEG, WebP, TIFF) | Python worker |

`POST /api/convert-format` exists but is **not yet available**. Calls return an error.

## Extraction Endpoints

### POST /api/extract-text

Plain text from a PDF or DOCX. No options. To extract only some pages of a PDF, run `extract-pages` first.

### POST /api/extract-structured

Structured content. The result depends on the input format:

| Input | Result (JSON unless noted) |
|-------|----------------------------|
| PDF | Page-by-page text plus document info (`num_pages`, `info`, `pages`, `full_text`). **When the Python worker is enabled**, PDFs are handled by the worker instead and return its page, text, and table structure; see the [worker reference](../doc-proc-pyworker/reference.md#structured-extraction-extract_structured). |
| Images | Python worker only (same shape as the worker's PDF result) |
| DOCX | HTML conversion of the document |
| XLSX / XLS | Cells, values, and declared structure of the selected sheet |
| PPTX / PPSX / PPTM | Slides with text and image references, plus presentation info |

Options by format:

| Option | Applies to | Default | Purpose |
|--------|-----------|---------|---------|
| `pages` | PDF | all | Page selection |
| `sheet` | Excel | first sheet | Sheet name or zero-based index |
| `includeHidden` | Excel | `false` | Include hidden rows, columns, and sheets |
| `maxCells` | Excel | `50000` | Cap on cells returned |
| `includeStyles` | Excel | `true` | Include font styling and declared structure (tables, filters, frozen panes). Turn off for very large workbooks. |
| `includeImages` | PowerPoint | `true` | Include embedded image bytes (image references are always listed) |
| `slides` | PowerPoint | all | Which slides' images to include bytes for (text always covers the whole deck) |

If your app depends on one PDF result shape, keep your environment's worker setting fixed, or use `analyze-document` for layout-rich output.

### POST /api/extract-metadata

Document properties (title, author, dates, page count) for PDF and DOCX. **Response**: JSON.

### POST /api/extract-general

Best-effort text from almost any document, choosing the method by format:

| Input | Method (`metadata.extraction_method`) |
|-------|----------------------------------------|
| PDF | `pdf-basic`; switches to `pdf-ocr-fallback` when the text looks scanned or garbled (see [Concepts](./concepts.md#automatic-ocr-fallback)) |
| Images (PNG, JPG, TIFF, BMP, GIF, WebP) | `ocr` (requires Azure DI) |
| DOCX | `docx` |
| XLSX / XLS | `excel` (returns CSV; accepts the `extract-sheet-to-csv` options) |
| CSV | `csv` (returned as is) |
| TXT / MD | `plain-text` (returned as is) |

Useful metadata in the JSON envelope: `extraction_method`, `fallback_triggered`, `fallback_reason`, and `quality_metrics`. When a PDF looks scanned but OCR isn't configured, you get the basic text with `fallback_unavailable: true` and a `quality_warning`.

### POST /api/extract-sheet-to-csv

One Excel sheet as CSV.

| Option | Default | Purpose |
|--------|---------|---------|
| `sheet` | first sheet | Sheet name or zero-based index |
| `separator` | `,` | Column separator |
| `quoteChar` | `"` | Quote character |
| `escapeChar` | `"` | Escape character |
| `lineEnding` | `\n` | Line ending |
| `includeHeaders` | `true` | Include the header row |
| `includeHidden` | `false` | Include hidden rows and columns |

## OCR and Analysis Endpoints

### POST /api/analyze-document

Layout analysis with Azure Document Intelligence: paragraphs, reading order, tables, and bounding boxes.

| Option | Default | Purpose |
|--------|---------|---------|
| `output_format` | `json` | `json` or `html` |
| `include_confidence` | `true` | Include per-word and per-paragraph confidence scores |
| `model` | `prebuilt-layout` | Analysis model, e.g. `prebuilt-layout`, `prebuilt-document` |
| `pages` | all | Page selection |

### POST /api/extract-text-ocr

OCR text with Azure Document Intelligence.

| Option | Default | Purpose |
|--------|---------|---------|
| `include_confidence` | `false` | `true` returns JSON with confidence scores instead of plain text |

### POST /api/extract-tables

Tables with their cell contents.

- **With the Python worker enabled**, this runs on the worker and needs the extended worker image. Options: `pages`, and `table_flavor` (`lattice` for ruled tables, `stream` for whitespace-aligned). Result: `tables`, each with `page`, `data` (rows of cells), `accuracy`, and `table_index`. See the [worker reference](../doc-proc-pyworker/reference.md#advanced-table-extraction-extract_tables).
- **Without the worker**, it runs on Azure Document Intelligence and returns tables with cells, spans, and confidence.

If the worker is enabled but your environment runs the standard worker image, this endpoint fails. It does not fall back to Azure.

### POST /api/ocr and POST /api/ocr-local

Local OCR on the Python worker (Tesseract), with no cloud OCR provider involved. `ocr` is an alias of `ocr-local`. Options: `pages`, `language` (default `eng`), `dpi` (default `300`), `include_bounding_boxes`. See the [worker reference](../doc-proc-pyworker/reference.md#local-ocr-ocr_local).

### POST /api/ocr-advanced

Neural, multi-language OCR on the Python worker, with per-detection confidence. Options: `pages`, `language` (comma-separated, default `en`), `dpi`, `gpu`. See the [worker reference](../doc-proc-pyworker/reference.md#neural-ocr-ocr_advanced).

## Generation Endpoints

### POST /api/html-to-pdf and POST /api/generate-pdf

Render an HTML file to PDF. `generate-pdf` is an alias.

| Option | Default | Purpose |
|--------|---------|---------|
| `format` | `A4` | Page size: `A4`, `Letter`, `Legal` |
| `landscape` | `false` | Landscape orientation |
| `printBackground` | `true` | Print CSS backgrounds |
| `preferCSSPageSize` | `true` | Let CSS `@page` size take precedence |
| `marginTop`, `marginRight`, `marginBottom`, `marginLeft` | | Margins, e.g. `1cm` |
| `timeout` | | Render timeout in ms |

**Response**: PDF.

### POST /api/create-excel

Fill an `.xlsx` template with data. Upload the template as `file`.

| Option | Default | Purpose |
|--------|---------|---------|
| `data` | | JSON describing what to write (see below) |
| `mode` | `cells` | `cells` or `rows` |

- `cells` mode: `{"Sheet1": {"B1": "Hello", "C4": 42}}` writes values to cell references.
- `rows` mode: `{"Sheet1": {"startRow": 2, "headers": ["Name", "Qty"], "rows": [["Widget", 4]]}}` writes rows from `startRow` (default 1), with an optional header row first.

Sheets must already exist in the template. **Response**: XLSX.

### POST /api/create-docx

Fill a `.docx` template with data. Upload the template as `file`.

| Option | Default | Purpose |
|--------|---------|---------|
| `data` | | JSON object of values for the template |
| `cmdDelimiter` | `["{", "}"]` | Placeholder delimiters |

Templates use `docx-templates` placeholder syntax, with `{name}` for simple values. Images can be inserted from a URL or from working memory: a template calls `{IMAGE getScreenshot(ref)}`, where `ref` has `url` or `working_memory_id` and optional `width`/`height`. **Response**: DOCX.

## Transformation Endpoints

### POST /api/extract-pages

| Option | Default | Purpose |
|--------|---------|---------|
| `pages` | `1` | Pages to keep, e.g. `1,3,5-10` |

**Response**: PDF.

### POST /api/split-pdf

| Option | Default | Purpose |
|--------|---------|---------|
| `chunkSize` | `1` | Pages per chunk |

**Response**: JSON `{ "num_chunks", "chunk_size", "total_pages", "chunks": ["<base64 PDF>", ...] }`.

### POST /api/merge-documents

Upload the PDFs as repeated `files` fields. **Response**: PDF.

**Limitation:** currently only the first uploaded file is used, so the result is that one document. Don't rely on this endpoint to combine documents yet.

### POST /api/image-to-pdf

Wrap a PNG or JPG in a one-page PDF.

| Option | Default | Purpose |
|--------|---------|---------|
| `pageSize` | | `A4`, `Letter`, or `Legal`: fit the image on a standard page, centered |
| `dpi` | `96` | Without `pageSize`, the page is sized to the image at this DPI |

**Response**: PDF.

## Python Worker Image Endpoints

These need the [Document Processing Python Worker](../doc-proc-pyworker/README.md). Results are JSON with images as base64 strings. For full result shapes and error messages, see the [worker reference](../doc-proc-pyworker/reference.md).

### POST /api/pdf-to-images

| Option | Default | Purpose |
|--------|---------|---------|
| `pages` | all | Page selection |
| `dpi` | `200` | Render resolution |
| `format` | `png` | `png` or `jpeg` |

Result: `images`, one entry per page, each with `page`, `data` (base64), `format`, `width`, and `height`.

### POST /api/upscale-image

| Option | Default | Purpose |
|--------|---------|---------|
| `provider` | `stability` | `stability` (AI upscaling; needs a Stability AI key in your environment), `lanczos` (local), or `auto` |
| `scale_factor` | `2` | `stability`: `2`, `4`; `lanczos`: `2`, `3`, `4`, `6`, `8` |
| `output_format` | `png` | `png`, `jpeg`, `webp`, `tiff` |

Result: `image` (base64 `data`, `format`, `mime_type`, `width`, `height`, `original_width`, `original_height`) plus the method and provider used.

### POST /api/convert-colorspace

| Option | Default | Purpose |
|--------|---------|---------|
| `target_colorspace` | `cmyk` | `cmyk`, `srgb`, `rgb`, `adobe_rgb` |
| `source_profile` | auto | `embedded` or an ICC profile name |
| `target_profile` | `default` | `default` or an ICC profile name |
| `rendering_intent` | `perceptual` | `perceptual`, `relative_colorimetric`, `saturation`, `absolute_colorimetric` |
| `output_format` | `tiff` | `tiff`, `jpeg`, `png` (PNG cannot hold CMYK) |
| `preserve_transparency` | `false` | CMYK has no alpha channel |

Result: `image` (base64 `data`, `format`, `mime_type`, `width`, `height`, `colorspace`) and `conversion` (source and target colorspace and profiles, rendering intent).

## Errors

| Status | When | Body | What to do |
|--------|------|------|------------|
| 501 | The operation failed: unsupported format, a required backend not enabled, invalid option, unreadable document, or a feature that isn't available yet | `{ "success": false, "format": "error", "error": "<message>", "metadata": {...} }` | Read `error`. Fix the request, or treat it as "not available in this environment". |
| 503 | The service is busy, or fetching the input from working memory timed out | Same shape, with a `Retry-After` header | Retry after the indicated delay |
| 500 | The request couldn't be handled at all: no `file` and no working memory reference, a file over the size limit, or an unexpected error | `{ "success": false, "error": "Internal Server Error", ... }` | Check that the request has an input and is under the size limit |
| 404 | Unknown path | `{ "success": false, "error": "Not Found", ... }` | Check the endpoint name |

Check `success` in the body rather than only the status code. Error messages from the Python worker are listed in the [worker reference](../doc-proc-pyworker/reference.md#errors).

## System Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Service information |
| `GET /health` | Liveness: `{"status": "healthy", ...}` |
| `GET /ready` | Readiness: `{"ready": true, "services": {...}}`, or status 503 when a required dependency is unavailable |
| `GET /status` | Service status and uptime |

## Client Libraries and MCP Tools

- TypeScript client: `@firebrandanalytics/doc-proc-client`
- MCP: agents using the [MCP Gateway](../mcp-gateway/README.md) can call the `docproc_*` tools. See [MCP Gateway tools](../mcp-gateway/tools.md#document-processing-adapter).
