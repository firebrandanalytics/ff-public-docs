# Structured Extraction Agent

## Overview

The Structured Extraction Agent is a FireFoundry system agent that turns binary documents — PDFs, Word documents, and Excel spreadsheets — into structured, page-level HTML with rich layout metadata. Upload a file, request extraction, and receive back a per-page representation that a downstream LLM, viewer, or retrieval pipeline can consume directly. The agent handles file-type detection, page rendering, OCR, vision-LLM extraction, and the assembly of structural metadata in one packaged workflow.

## Purpose and Role

Application developers frequently need to extract content from documents in a form that is both machine-readable and faithful to the original layout. Plain-text extraction loses tables, headings, and structure. Bare OCR misses semantic context. The Structured Extraction Agent addresses both gaps by combining document-processing primitives with a vision-LLM pipeline that produces HTML preserving the original document's structure, plus per-page metadata describing what was found (paragraphs, tables, figures, headings, and their positions).

Typical use cases:

- Preparing documents for knowledge-base ingestion when layout fidelity matters
- Producing structured representations of contracts, financial filings, or regulatory documents
- Extracting tables from PDFs and spreadsheets in a form LLMs can reason over
- Feeding downstream agents that need both prose and tabular content from the same source

## Key Features

- **Multi-format input** — PDF, DOCX, XLSX, XLS, with automatic file-type detection from MIME type or extension
- **Mode selection** — `compatibility` mode for fast, broad-format processing; `high-fidelity` mode for richer per-page vision-LLM extraction
- **Page selection** — Process all pages, a range, specific page numbers, or a mixed list (e.g. `[1, [5, 10], 15]`)
- **Per-page HTML and metadata** — Each processed page returns HTML plus structural metadata (paragraphs, tables, figures, headings with confidence scores and bounding boxes)
- **Caching** — Repeated extractions of the same document and page set short-circuit to cached results; a `forceRedo` flag bypasses the cache when needed
- **Excel-aware** — Spreadsheets are handled as direct HTML rather than per-page vision rendering; sheet indices map to page numbers
- **Working-memory backed** — Source documents and per-page artifacts are stored in the platform's working memory so they can be referenced, retrieved, or audited later
- **Concurrency control** — `maxConcurrency` lets callers tune throughput for large documents

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload-document` | Upload a binary document into working memory and receive a `documentId` |
| POST | `/api/extract-document` | Run extraction over a previously uploaded document |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### Upload: `POST /api/upload-document`

A multipart request that uploads a file into working memory. Returns a `documentId` that subsequent extract requests reference.

```json
{ "documentId": "wm-id-..." }
```

### Extract: `POST /api/extract-document`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `documentId` | string | yes | — | Working-memory ID returned by `/api/upload-document` (or any other document stored in working memory) |
| `pages` | flexible | no | `"all"` | Page selection — see below |
| `mode` | enum | no | `compatibility` | `compatibility` or `high-fidelity` (ignored for Excel) |
| `forceRedo` | boolean | no | `false` | Re-run extraction even if cached results exist |
| `dpi` | int (72–600) | no | `200` | Render DPI for PDF page images |
| `maxConcurrency` | int (1–20) | no | `5` | How many pages to process in parallel |

`pages` supports several shapes:

- `"all"` — every page
- `"5-10"` — a single range as a string
- `[1, 3, 5]` — explicit page numbers
- `[1, [5, 10], 15]` — mixed individual pages and `[start, end]` ranges

### Response

Returns a per-page extraction result plus a summary:

```json
{
  "requestId": "extraction-entity-uuid",
  "pages": [
    {
      "pageNumber": 1,
      "html": "<h1>...</h1><p>...</p><table>...</table>",
      "metadata": {
        "paragraphs": [ /* with bounding boxes, roles, confidence */ ],
        "tables": [ /* rows, columns, cells */ ],
        "headings": [ /* level, text, position */ ]
      }
    }
  ],
  "summary": {
    "totalPages": 42,
    "processedPages": 42,
    "cachedPages": 0,
    "failedPages": 0,
    "processingTimeMs": 73421,
    "mode": "compatibility"
  },
  "errors": []
}
```

### Example

Upload a PDF, then extract pages 1–5 in high-fidelity mode:

```bash
# 1. Upload
curl -X POST "https://<gateway-host>/api/upload-document" \
  -F 'file=@contract.pdf' \
  -F 'payload={"args":[{"$blob":0},{"name":"contract.pdf","contentType":"application/pdf"}]}'
# → { "documentId": "wm-..." }

# 2. Extract
curl -X POST "https://<gateway-host>/api/extract-document" \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "wm-...",
    "pages": "1-5",
    "mode": "high-fidelity"
  }'
```

## Dependencies

The Structured Extraction Agent calls:

- **FF Broker** — Vision-LLM extraction
- **Context Service** — Working memory for source documents and per-page artifacts
- **Document Processing Service** — Underlying OCR, layout analysis, and direct-HTML rendering for Office formats
- **Entity Service** — Persists the extraction request entity that tracks per-page work

## Configuration

The agent is configured via environment variables (see the bundle's `.env.template` for the full list). The main groups are:

- **Service endpoints** — URLs for the broker, context service, document processing service, entity service
- **Storage** — Working-memory and database connections

## Repository

Source code: [ff-app-system / structured-extraction](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/structured-extraction)

## Related Documentation

- [System Agents Catalog](./README.md)
- [Document Processing Service](../services/doc-proc-service/README.md) — OCR and layout backend
- [Context Service](../services/context-service/README.md) — Working-memory store for source documents
- [RAG Agent](./rag-agent.md) — Uses structured extraction as a building block for knowledge-base ingestion
