# Document Processing — Getting Started

This guide walks you through extracting text from documents, generating PDFs, and performing document transformations.

## Prerequisites

- A running Document Processing Service instance
- PostgreSQL with the `document_processing` schema migrated
- (Optional) Azure Document Intelligence API key for OCR features
- (Optional) Chromium installed for HTML-to-PDF generation

## Step 1: Verify the Service is Running

```bash
# Health check
curl http://localhost:8080/health
# Expected: {"status":"ok"}

# Readiness check (verifies database and Azure connectivity)
curl http://localhost:8080/ready
```

## Step 2: Extract Text from a PDF

```bash
curl -X POST http://localhost:8080/api/extract-text \
  -F "file=@document.pdf"
```

Response: Plain text content of the PDF.

For structured output with metadata:

```bash
curl -X POST http://localhost:8080/api/extract-text \
  -F "file=@document.pdf" \
  -H "Accept: application/json"
```

```json
{
  "success": true,
  "data": "Extracted text content...",
  "format": "text",
  "metadata": {
    "backend_used": "pdf-parse",
    "processing_time_ms": 120,
    "cached": false
  }
}
```

## Step 3: Intelligent Extraction with OCR Fallback

The `/api/extract-general` endpoint automatically detects low-quality PDFs and falls back to OCR:

```bash
curl -X POST http://localhost:8080/api/extract-general \
  -F "file=@scanned-document.pdf" \
  -H "Accept: application/json"
```

If the PDF appears to be a scan (few characters per page), the service transparently uses Azure Document Intelligence for OCR.

## Step 4: Extract Structured Data

Get page-by-page extraction with metadata:

```bash
curl -X POST http://localhost:8080/api/extract-structured \
  -F "file=@report.pdf" \
  -H "Accept: application/json"
```

Get document metadata (title, author, dates, page count):

```bash
curl -X POST http://localhost:8080/api/extract-metadata \
  -F "file=@report.pdf"
```

## Step 5: Convert Excel to CSV

```bash
# Convert the first sheet
curl -X POST http://localhost:8080/api/extract-sheet-to-csv \
  -F "file=@spreadsheet.xlsx"

# Convert a specific sheet with custom formatting
curl -X POST http://localhost:8080/api/extract-sheet-to-csv \
  -F "file=@spreadsheet.xlsx" \
  -F "sheet=Summary" \
  -F "separator=;" \
  -F "includeHeaders=true"
```

## Step 6: Generate a PDF from HTML

```bash
curl -X POST http://localhost:8080/api/html-to-pdf \
  -F "file=@report.html" \
  -F "format=Letter" \
  -F "landscape=true" \
  -F "marginTop=1cm" \
  -F "marginBottom=1cm" \
  --output report.pdf
```

## Step 7: Manipulate PDFs

### Extract Specific Pages

```bash
curl -X POST http://localhost:8080/api/extract-pages \
  -F "file=@document.pdf" \
  -F "pages=1,3,5-10" \
  --output extracted.pdf
```

### Split a PDF into Chunks

```bash
curl -X POST http://localhost:8080/api/split-pdf \
  -F "file=@document.pdf" \
  -F "chunkSize=5"
```

### Merge Multiple PDFs

```bash
curl -X POST http://localhost:8080/api/merge-documents \
  -F "files=@part1.pdf" \
  -F "files=@part2.pdf" \
  -F "files=@part3.pdf" \
  --output merged.pdf
```

### Compress a PDF

```bash
curl -X POST http://localhost:8080/api/compress-pdf \
  -F "file=@large-document.pdf" \
  --output compressed.pdf
```

## Step 8: Azure Document Intelligence (OCR)

For scanned documents and images, use the Azure-powered endpoints:

```bash
# Full document analysis with layout
curl -X POST http://localhost:8080/api/analyze-document \
  -F "file=@scanned-invoice.pdf" \
  -F "output_format=json" \
  -F "include_confidence=true"

# OCR text extraction with confidence scores
curl -X POST http://localhost:8080/api/extract-text-ocr \
  -F "file=@scan.png"

# Table extraction
curl -X POST http://localhost:8080/api/extract-tables \
  -F "file=@spreadsheet-scan.pdf"
```

## Next Steps

- Read [Concepts](./concepts.md) for the processing pipeline, caching, and quality detection
- See [Reference](./reference.md) for the complete API specification
- See [Operations](./operations.md) for deployment and Azure configuration
