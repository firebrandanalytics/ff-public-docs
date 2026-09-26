# Document Processing — Getting Started

This guide walks through extracting text, handling scanned documents, generating PDFs, and transforming PDFs.

## Prerequisites

- The Document Processing Service enabled in your FireFoundry environment (see [Operations](./operations.md#enabling-the-service))
- Optional: Azure Document Intelligence configured, for the OCR steps (the fallback in Step 3, and Step 8)
- Optional: the [Python worker](../doc-proc-pyworker/README.md) enabled, for Step 9

Inside the cluster, the service is reachable at `http://firefoundry-core-doc-proc-service:8081`. To try it from your workstation, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-doc-proc-service -n <namespace> 8081:8081
```

The examples below use `http://localhost:8081`.

## Step 1: Check That the Service Is Ready

```bash
curl http://localhost:8081/health
# Expected: {"status":"healthy", ...}

curl http://localhost:8081/ready
# Expected: {"ready":true,"services":{...}}
```

## Step 2: Extract Text from a PDF

```bash
curl -X POST http://localhost:8081/api/extract-text \
  -F "file=@document.pdf"
```

The response is the document's plain text. For the JSON envelope with metadata:

```bash
curl -X POST http://localhost:8081/api/extract-text \
  -F "file=@document.pdf" \
  -H "Accept: application/json"
```

```json
{
  "success": true,
  "data": "Extracted text content...",
  "format": "text/plain",
  "metadata": {
    "backend_used": "pdf-parse",
    "processing_time_ms": 120,
    "cached": false
  }
}
```

## Step 3: Extract Text When You Don't Know If the PDF Is Scanned

```bash
curl -X POST http://localhost:8081/api/extract-general \
  -F "file=@maybe-scanned.pdf" \
  -H "Accept: application/json"
```

If the PDF looks like a scan, the service uses OCR automatically (when OCR is configured). Check `metadata.extraction_method` to see which path ran. The same endpoint also accepts DOCX, Excel, CSV, text, and image files.

## Step 4: Extract Structured Data and Metadata

Page-by-page content from a PDF, or sheets and slides from Excel and PowerPoint:

```bash
curl -X POST http://localhost:8081/api/extract-structured \
  -F "file=@report.pdf"

curl -X POST http://localhost:8081/api/extract-structured \
  -F "file=@deck.pptx" -F "includeImages=false"
```

Document properties (title, author, dates, page count):

```bash
curl -X POST http://localhost:8081/api/extract-metadata \
  -F "file=@report.pdf"
```

## Step 5: Convert Excel to CSV

```bash
# First sheet
curl -X POST http://localhost:8081/api/extract-sheet-to-csv \
  -F "file=@spreadsheet.xlsx"

# A specific sheet with a custom separator
curl -X POST http://localhost:8081/api/extract-sheet-to-csv \
  -F "file=@spreadsheet.xlsx" \
  -F "sheet=Summary" \
  -F "separator=;" \
  -F "includeHeaders=true"
```

## Step 6: Generate a PDF from HTML

```bash
curl -X POST http://localhost:8081/api/html-to-pdf \
  -F "file=@report.html" \
  -F "format=Letter" \
  -F "landscape=true" \
  -F "marginTop=1cm" \
  -F "marginBottom=1cm" \
  --output report.pdf
```

Make the HTML self-contained, with inline CSS and embedded images.

To fill a designed template instead, use `create-excel` or `create-docx`:

```bash
curl -X POST http://localhost:8081/api/create-excel \
  -F "file=@invoice-template.xlsx" \
  -F "mode=cells" \
  -F 'data={"Invoice": {"B2": "ACME Corp", "B3": "2026-09-26", "E20": 1250.00}}' \
  --output invoice.xlsx
```

## Step 7: Transform PDFs

```bash
# Extract specific pages
curl -X POST http://localhost:8081/api/extract-pages \
  -F "file=@document.pdf" -F "pages=1,3,5-10" --output extracted.pdf

# Split into 5-page chunks (JSON with base64-encoded PDF chunks)
curl -X POST http://localhost:8081/api/split-pdf \
  -F "file=@document.pdf" -F "chunkSize=5"

# Wrap a photo or scan in a Letter-size PDF
curl -X POST http://localhost:8081/api/image-to-pdf \
  -F "file=@receipt.jpg" -F "pageSize=Letter" --output receipt.pdf
```

## Step 8: OCR and Layout Analysis

These calls require Azure Document Intelligence to be configured in your environment.

```bash
# Full layout analysis with confidence scores
curl -X POST http://localhost:8081/api/analyze-document \
  -F "file=@scanned-invoice.pdf" \
  -F "output_format=json" \
  -F "include_confidence=true"

# OCR text
curl -X POST http://localhost:8081/api/extract-text-ocr \
  -F "file=@scan.png"

# Tables
curl -X POST http://localhost:8081/api/extract-tables \
  -F "file=@statement-scan.pdf"
```

If the Python worker is enabled in your environment, `extract-tables` runs on the worker instead of Azure (see [Reference](./reference.md#post-apiextract-tables)).

## Step 9: Page Images and Local OCR (Python Worker)

These calls require the [Python worker](../doc-proc-pyworker/README.md). Local OCR also needs the extended worker image.

```bash
# Render pages 1-3 as PNG at 150 DPI
curl -X POST http://localhost:8081/api/pdf-to-images \
  -F "file=@document.pdf" -F "pages=1-3" -F "dpi=150"

# OCR inside your environment
curl -X POST http://localhost:8081/api/ocr-local \
  -F "file=@scan.pdf" -F "language=eng"
```

## Calling the Service from an Agent Bundle

From a bundle, call the in-cluster URL with a multipart upload and ask for the JSON envelope:

```typescript
const form = new FormData();
form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'document.pdf');

const response = await fetch(
  'http://firefoundry-core-doc-proc-service:8081/api/extract-general',
  { method: 'POST', body: form, headers: { Accept: 'application/json' } }
);
const result = await response.json();
if (!result.success) {
  throw new Error(`Extraction failed: ${result.error}`);
}
const text: string = result.data;
```

A TypeScript client package, `@firebrandanalytics/doc-proc-client`, is also available. Agents that use the [MCP Gateway](../mcp-gateway/README.md) can call the `docproc_*` tools instead. See [MCP Gateway tools](../mcp-gateway/tools.md#document-processing-adapter).

## Next Steps

- [Concepts](./concepts.md): choosing operations, OCR fallback, caching, and design patterns
- [Reference](./reference.md): all endpoints and parameters
- [Operations](./operations.md): enabling optional backends, limits, and troubleshooting
- [Python Worker](../doc-proc-pyworker/README.md): page images, local OCR, and image operations
