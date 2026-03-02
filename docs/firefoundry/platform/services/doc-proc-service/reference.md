# Document Processing — Reference

Complete API reference for the Document Processing Service, including all endpoints, request parameters, response schemas, and configuration variables.

## Extraction Endpoints

### POST /api/extract-text

Extract plain text from a document.

**Input**: `multipart/form-data` with `file` field.

**Supported Formats**: PDF, DOCX

**Response**: Plain text (default) or JSON envelope with `Accept: application/json`.

### POST /api/extract-structured

Extract structured content with page information and metadata.

**Input**: `multipart/form-data` with `file` field.

**Response**: JSON with page-by-page content.

### POST /api/extract-metadata

Extract document properties (title, author, dates, page count).

**Input**: `multipart/form-data` with `file` field.

### POST /api/extract-general

Best-effort extraction with automatic OCR fallback for low-quality PDFs.

**Input**: `multipart/form-data` with `file` field.

**Behavior**: Uses quality detection heuristics. If extraction quality is low, automatically falls back to Azure Document Intelligence OCR.

### POST /api/extract-sheet-to-csv

Convert an Excel spreadsheet to CSV.

**Input**: `multipart/form-data`

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `file` | file | required | XLSX or XLS file |
| `sheet` | string | first sheet | Sheet name to convert |
| `separator` | string | `,` | CSV delimiter |
| `includeHeaders` | boolean | `true` | Include column headers |

### POST /api/extract-tables

Extract structured table data with cell boundaries and confidence.

**Input**: `multipart/form-data` with `file` field. Requires Azure Document Intelligence.

## Azure Document Intelligence Endpoints

These endpoints require Azure Document Intelligence credentials to be configured.

### POST /api/analyze-document

Full layout analysis with paragraphs, tables, and structure.

**Input**: `multipart/form-data`

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `file` | file | required | PDF or image file |
| `output_format` | string | `json` | Output: `json` or `html` |
| `include_confidence` | boolean | `false` | Include per-element confidence scores |
| `model` | string | `prebuilt-layout` | Azure model to use |

### POST /api/extract-text-ocr

Extract text from scanned documents using OCR.

**Input**: `multipart/form-data` with `file` field.

**Supported Formats**: PDF, PNG, JPG, JPEG, TIFF, BMP

## Generation Endpoints

### POST /api/html-to-pdf

Convert HTML to PDF with configurable layout.

**Input**: `multipart/form-data`

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `file` | file | required | HTML file |
| `format` | string | `A4` | Page format: `A4`, `Letter`, `Legal` |
| `landscape` | boolean | `false` | Landscape orientation |
| `marginTop` | string | | Top margin (e.g., `1cm`) |
| `marginBottom` | string | | Bottom margin |
| `marginLeft` | string | | Left margin |
| `marginRight` | string | | Right margin |
| `printBackground` | boolean | `false` | Print CSS backgrounds |

**Response**: PDF binary.

## Transformation Endpoints

### POST /api/extract-pages

Extract specific pages from a PDF.

| Parameter | Type | Purpose |
|-----------|------|---------|
| `file` | file | PDF file |
| `pages` | string | Page specification (e.g., `1,3,5-10`) |

**Response**: PDF binary.

### POST /api/split-pdf

Split a PDF into chunks.

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `file` | file | required | PDF file |
| `chunkSize` | number | | Pages per chunk |

### POST /api/merge-documents

Combine multiple PDFs into one.

| Parameter | Type | Purpose |
|-----------|------|---------|
| `files` | file[] | Multiple PDF files |

**Response**: PDF binary.

### POST /api/compress-pdf

Optimize PDF file size using object streams.

| Parameter | Type | Purpose |
|-----------|------|---------|
| `file` | file | PDF file |

**Response**: Compressed PDF binary.

## System Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /` | GET | Service information |
| `GET /health` | GET | Liveness probe |
| `GET /ready` | GET | Readiness probe (checks database and Azure) |
| `GET /status` | GET | Service status and uptime |

## Configuration Variables

### Required

| Variable | Purpose |
|----------|---------|
| `PG_SERVER` | PostgreSQL host |
| `PG_DATABASE` | Database name |
| `PG_PORT` | PostgreSQL port |
| `PG_PASSWORD` | Read-only password |
| `PG_INSERT_PASSWORD` | Write password |

### Optional — Azure Document Intelligence

| Variable | Purpose |
|----------|---------|
| `AZURE_DOC_INTELLIGENCE_ENDPOINT` | Azure API endpoint |
| `AZURE_DOC_INTELLIGENCE_KEY` | Azure API key |
| `AZURE_DOC_INTELLIGENCE_MODEL` | Model name (default: `prebuilt-layout`) |

### Optional — Service

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP server port |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Logging level |
| `CACHE_TTL_SECONDS` | `3600` | Cache time-to-live |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size |
| `CONTEXT_SERVICE_URL` | | Context Service URL |
| `CONTEXT_SERVICE_API_KEY` | | Context Service API key |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | | Azure monitoring |

## Error Responses

```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE"
}
```

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request (missing file, unsupported format) |
| 413 | `FILE_TOO_LARGE` | File exceeds `MAX_FILE_SIZE_MB` |
| 415 | `UNSUPPORTED_FORMAT` | File format not supported for this operation |
| 500 | `PROCESSING_ERROR` | Internal processing failure |
| 502 | `AZURE_ERROR` | Azure Document Intelligence API error |
