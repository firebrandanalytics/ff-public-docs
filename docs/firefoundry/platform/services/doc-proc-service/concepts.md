# Document Processing — Concepts

This page explains how to choose an operation, how OCR fallback and caching behave, how to send input and get output, and how to design an app around the Document Processing Service.

## Operation Families

| Family | Endpoints | Use when |
|--------|-----------|----------|
| **Extraction** | `extract-text`, `extract-structured`, `extract-metadata`, `extract-general`, `extract-sheet-to-csv` | You need text or data out of a document |
| **OCR and analysis** | `analyze-document`, `extract-text-ocr`, `extract-tables`, `ocr`, `ocr-local`, `ocr-advanced` | The document is scanned or image-based, or you need layout, tables, and confidence scores |
| **Generation** | `html-to-pdf`, `create-excel`, `create-docx` | You need a PDF from HTML, or an Excel or Word file from a template |
| **Transformation** | `extract-pages`, `split-pdf`, `image-to-pdf` | You need to reshape documents before or after processing |
| **Image operations** | `pdf-to-images`, `upscale-image`, `convert-colorspace` | You need page images (for example for vision models), larger images, or print-ready color |

Several of these need an optional backend in your environment: Azure Document Intelligence or the [Python worker](../doc-proc-pyworker/README.md). The [endpoint summary](./reference.md#endpoint-summary) lists what each one needs.

### Choosing an extraction endpoint

- **You don't know what you'll get** (PDF, scan, Word, spreadsheet, text): use `/api/extract-general`. It picks the method by format and falls back to OCR for scanned PDFs.
- **You know it is a digital PDF or a DOCX**: use `/api/extract-text`. It is the fastest and cheapest option.
- **You know it is a scan or an image**: use `/api/extract-text-ocr` (Azure) or `/api/ocr-local` (Python worker, runs in your environment).
- **You need page boundaries, tables, sheets, or slides**: use `/api/extract-structured`.
- **You need tables with cell structure**: use `/api/extract-tables` or `/api/analyze-document`.
- **You want a vision model to read the page**: use `/api/pdf-to-images` and send the images to the model.

## Automatic OCR Fallback

For PDFs, `/api/extract-general` first extracts the text layer, then checks its quality. It switches to OCR when the text looks like a scan or is garbled: very little text per page (fewer than about 50 characters), very little text overall (fewer than about 100 characters), or mostly non-alphanumeric characters. Images always go to OCR.

OCR in `extract-general` uses Azure Document Intelligence (see [Operations](./operations.md#optional-backends)). When OCR isn't configured, a scanned PDF still returns whatever basic text was found, with `fallback_unavailable: true` and a `quality_warning` in the metadata, and an image input fails.

Ask for the [JSON envelope](#output-formats) to see `metadata.extraction_method` (`pdf-basic`, `pdf-ocr-fallback`, `ocr`, `docx`, `excel`, `csv`, `plain-text`) and `fallback_triggered`. Log these if you need to explain cost or quality differences between documents.

## OCR Options

| Option | Endpoints | Runs where | Good for |
|--------|-----------|------------|----------|
| Azure Document Intelligence | `extract-text-ocr`, `analyze-document`, `extract-tables` (when the worker is off), OCR in `extract-general` | Azure (external) | Highest-fidelity layout, tables, and confidence scores |
| Local OCR (Tesseract) | `ocr`, `ocr-local` | Python worker, in your environment | Keeping documents in the cluster; no per-page cloud cost |
| Neural OCR | `ocr-advanced` | Python worker, in your environment | Multi-language text and photos, with per-detection confidence |

The worker OCR options need the extended worker image. See the [Python worker](../doc-proc-pyworker/README.md) docs.

With `analyze-document`, confidence scores are included by default. Use them to flag low-confidence fields for human review instead of passing them straight to downstream logic.

## Input and Output Patterns

### Input: direct upload

Send the file as `multipart/form-data`. The file name's extension tells the service the format:

```bash
curl -X POST http://firefoundry-core-doc-proc-service:8081/api/extract-text -F "file=@document.pdf"
```

### Input: working memory reference

If the document is already in [Context Service](../context-service/README.md) working memory (for example, a user upload your bundle stored), reference it instead of uploading it again:

```json
{
  "input": {
    "working_memory_id": "wm-12345"
  }
}
```

This keeps large files out of your bundle's memory and ties processing to the stored document.

### Output: stored in working memory

Add `output: {"entity_node_id": "<entity id>"}` and the service stores the result in working memory under that entity, returning a `working_memory_id` instead of the data. This fits pipelines where later steps, or other bundles, pick up the result by reference.

### Output formats

- **Default**: the result itself: plain text, a JSON document, or a binary file (PDF, XLSX, DOCX).
- **JSON envelope**: send `Accept: application/json` or add `?format=json` to get the result plus metadata:

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

Use the envelope for text and JSON results. It gives you `success`, timing, and which backend ran. For JSON results, `data` is a JSON string that you parse again. For binary outputs, use the default response.

## Caching

Results are cached by operation, file content, and options:

- The same file processed the same way again returns the cached result. The `X-Cache` response header is `HIT`, and in the envelope `metadata.cached` is `true`.
- A different operation or different options on the same file is processed fresh.
- Cached results expire after a period (one hour by default).
- If caching is unavailable, requests still succeed, just without the speed-up.

Your app therefore doesn't need its own cache for repeat processing of the same document within that window. For long-lived results, store the extracted output yourself, for example in working memory or on an entity.

## Degraded Modes

Optional backends change what is available, not whether the service runs:

- **No Azure Document Intelligence**: `analyze-document` and `extract-text-ocr` fail. `extract-tables` fails unless the Python worker handles it. `extract-general` can't OCR scans or images.
- **No Python worker**: `pdf-to-images`, `upscale-image`, `convert-colorspace`, `ocr`, `ocr-local`, `ocr-advanced`, and structured extraction of images fail. Everything else works.
- **Standard (not extended) worker image**: page images, upscaling, colorspace conversion, and structured extraction work. Local OCR, neural OCR, and worker table extraction fail.

A failure for a missing backend comes back as an error response with a message. Design features that depend on OCR or the worker so they can tell the user "not available in this environment" clearly.

## App Design Patterns

**Ingest pipeline.** Store user uploads in working memory, run `extract-general`, then chunk and embed or summarize. Store the extracted text on your entity so you never extract it again.

**Human-in-the-loop extraction.** `analyze-document` with confidence scores feeds an LLM that maps fields. Anything below your confidence threshold goes to a review queue.

**Vision-model reading.** For complex layouts (forms, charts, handwriting), render the pages with `pdf-to-images` at a moderate DPI and send the images to a vision-capable model through the broker.

**Split before you process.** For long PDFs, use `extract-pages` or `split-pdf` to process only the relevant pages, or process chunks in parallel. This stays under size and time limits and reduces OCR cost.

**Report generation.** Have an LLM write self-contained HTML (inline CSS, no external assets), then call `html-to-pdf`. For business formats, keep a designed `.xlsx` or `.docx` template and fill it with `create-excel` or `create-docx`, so the LLM supplies only data, not layout.
