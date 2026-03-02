# Document Processing — Concepts

This page explains the core concepts underlying the Document Processing Service: the processing pipeline, caching strategy, quality detection, and Azure Document Intelligence integration.

## Processing Pipeline

The service implements a clean three-tier architecture:

### Orchestration Layer

The `DocProcessingProvider` coordinates the overall processing flow:

1. **Input Resolution**: Accepts direct file uploads or working memory references
2. **Cache Lookup**: Computes SHA256 hash of (operation + content + options) and checks for cached results
3. **Provider Delegation**: Routes to the appropriate processing provider
4. **Result Storage**: Caches results and logs the request to PostgreSQL
5. **Response Formatting**: Returns results in the requested format

### Processing Layer

Specialized providers handle different operation categories:

| Provider | Responsibilities |
|----------|-----------------|
| `ExtractionProvider` | Text extraction, metadata, structured data, OCR, document analysis |
| `GenerationProvider` | PDF creation from HTML |
| `TransformationProvider` | PDF manipulation (merge, split, compress, page extraction) |

Processing providers work exclusively with Buffers — they have no awareness of working memory or caching.

### Client Layer

Concrete implementations of the `IDocumentClient` interface:

| Client | Technology | Capabilities |
|--------|-----------|--------------|
| `PdfParseClient` | pdf-parse | PDF text extraction |
| `MammothClient` | mammoth | DOCX text extraction |
| `ExcelClient` | SheetJS (xlsx) | XLSX/XLS to CSV conversion |
| `PuppeteerClient` | Puppeteer + Chromium | HTML to PDF generation |
| `PdfLibClient` | pdf-lib | PDF manipulation |
| `DocumentIntelligenceClient` | Azure AI SDK | OCR, layout analysis, table extraction |

Clients are selected based on their declared capabilities. Multiple clients may support the same operation, and the system selects based on capabilities, options, and client health.

## Content-Based Caching

The service caches processing results to avoid redundant work:

- **Cache Key**: SHA256 hash of `(operation_type + input_content + processing_options)`
- **Storage**: PostgreSQL `cache` table with configurable TTL
- **Granularity**: Same document with different operations cached separately
- **Benefits**: Reduces processing time and external API costs (especially Azure Document Intelligence)

### Cache Behavior

- Cache hits return immediately without re-processing
- Cache misses trigger processing and store the result
- Caching failures are non-blocking — the request still completes
- TTL is configurable via `CACHE_TTL_SECONDS` (default: 3600)

## Quality Detection

The `/api/extract-general` endpoint uses heuristics to detect low-quality PDFs and automatically fall back to OCR:

| Heuristic | Threshold | Indicates |
|-----------|-----------|-----------|
| Characters per page | < 50 | Scanned/image-based PDF |
| Total characters | < 100 | Near-empty extraction |
| Alphanumeric ratio | < 30% | Poor text extraction (garbled output) |

When quality thresholds are triggered, the service transparently switches to Azure Document Intelligence OCR for better results.

## Azure Document Intelligence

The service integrates Azure's Document Intelligence (formerly Form Recognizer) for advanced capabilities:

### Features

- **Prebuilt Models**: Uses `prebuilt-layout` by default for general document analysis
- **OCR Engine**: High-accuracy optical character recognition for scanned documents
- **Layout Analysis**: Paragraph detection, reading order determination, bounding boxes
- **Table Detection**: Automatic table identification with cell structure and spans
- **Multi-format Support**: PDF, PNG, JPG, TIFF, BMP

### Output Formats

- **JSON**: Structured data with paragraphs, tables, content blocks, and bounding boxes
- **HTML**: Formatted HTML representation of document structure

### Confidence Scores

When `include_confidence=true` is specified, results include per-word and per-paragraph confidence scores for quality assessment.

## Input/Output Patterns

All endpoints support dual input patterns:

### Direct File Upload

Files are sent as multipart/form-data:

```bash
curl -X POST http://localhost:8080/api/extract-text -F "file=@document.pdf"
```

### Working Memory Reference

Documents are referenced by working memory ID (for integration with the Context Service):

```json
{
  "input": {
    "working_memory_id": "wm-12345"
  }
}
```

### Response Formats

- **Default**: Returns data directly (text or binary)
- **JSON Envelope**: Add `Accept: application/json` header or `?format=json` for metadata-rich responses:

```json
{
  "success": true,
  "data": "Extracted text...",
  "format": "text",
  "metadata": {
    "backend_used": "pdf-parse",
    "processing_time_ms": 150,
    "cached": false
  }
}
```

## Graceful Degradation

The service degrades gracefully when optional dependencies are unavailable:

- **Missing Azure credentials**: OCR features disabled, basic extraction still works
- **Cache failures**: Requests complete normally, just without caching
- **Logging failures**: Processing continues uninterrupted
- **Puppeteer unavailable**: HTML-to-PDF generation fails, other operations unaffected
