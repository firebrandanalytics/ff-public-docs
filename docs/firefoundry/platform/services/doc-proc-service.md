# Document Processing Service

## Overview

The Document Processing Service provides unified document extraction, generation, and transformation capabilities for the FireFoundry platform. It handles PDF, Office documents, images, and other formats with built-in caching, PostgreSQL persistence, and Azure Document Intelligence integration for advanced OCR and layout analysis.

## Purpose and Role in Platform

This service acts as the central document processing hub for FireFoundry bundles and agents, providing:
- **Extraction**: Text, tables, and metadata from various document formats
- **Generation**: PDF creation from HTML templates
- **Transformation**: PDF manipulation (merge, split, compress, page extraction)
- **OCR**: Advanced optical character recognition for scanned documents and images

## Supported Document Formats

### Input Formats
- **PDF**: Text extraction, OCR, manipulation, analysis
- **Microsoft Word**: DOCX text extraction
- **Microsoft Excel**: XLSX/XLS to CSV conversion with sheet selection
- **HTML**: Conversion to PDF
- **Images**: PNG, JPG, JPEG, TIFF, BMP (OCR and analysis)
- **Plain Text**: TXT, MD, CSV pass-through

### Output Formats
- Plain text
- Structured JSON (with page information and metadata)
- PDF (generated or transformed)
- CSV (from Excel conversion)
- HTML (from Azure Document Intelligence analysis)

## Key Features

- **Multi-format Text Extraction**: Extract text from PDF (pdf-parse), DOCX (mammoth), Excel, and images
- **Azure Document Intelligence Integration**: Advanced OCR, layout analysis, and table extraction for scanned documents
- **PDF Manipulation**: Merge, split, compress, and extract pages using pdf-lib
- **HTML to PDF Generation**: Configurable conversion with puppeteer (page format, orientation, margins)
- **Intelligent Fallback**: Automatic OCR fallback for low-quality PDFs with quality detection heuristics
- **Content-Based Caching**: SHA256 hash-based caching to improve performance and reduce API costs
- **Request Logging**: Complete audit trail of all processing operations in PostgreSQL
- **Working Memory Integration**: Dual input/output pattern supporting direct file upload or Context Service references

## Architecture Overview

The service implements a clean three-tier architecture for separation of concerns:

### 1. Orchestration Layer (`DocProcessingProvider`)
- Resolves working memory IDs to Buffers via Context Service
- Implements content-based caching (SHA256 hash → result lookup)
- Logs all requests and responses to PostgreSQL
- Delegates processing to specialized providers
- Handles result storage and response formatting

### 2. Processing Layer (Specialized Providers)
- **`ExtractionProvider`**: Text, metadata, structured data, OCR, document analysis
- **`GenerationProvider`**: PDF generation from HTML
- **`TransformationProvider`**: PDF manipulation and format conversion
- Works exclusively with Buffers (no working memory awareness)
- Selects appropriate client based on operation and format

### 3. Client Layer (`IDocumentClient` implementations)
- **`PdfParseClient`**: PDF text extraction
- **`MammothClient`**: DOCX processing
- **`ExcelClient`**: XLSX/XLS to CSV conversion
- **`PuppeteerClient`**: HTML to PDF generation
- **`PdfLibClient`**: PDF manipulation operations
- **`DocumentIntelligenceClient`**: Azure AI for OCR and layout analysis
- Capability-based selection with health checking

## Processing Capabilities

### Extraction Operations
- **Text Extraction**: `POST /api/extract-text` - Plain text from PDF, DOCX
- **Structured Extraction**: `POST /api/extract-structured` - JSON with pages, metadata, full text
- **Metadata Extraction**: `POST /api/extract-metadata` - Document properties (title, author, dates, page count)
- **General Extraction**: `POST /api/extract-general` - Best-effort extraction from any format with intelligent fallback
- **Excel to CSV**: `POST /api/extract-sheet-to-csv` - Sheet selection with configurable CSV formatting
- **Table Extraction**: `POST /api/extract-tables` - Structured table data with cell boundaries and confidence

### Azure Document Intelligence Operations
- **Document Analysis**: `POST /api/analyze-document` - Full layout analysis with paragraphs, tables, structure
- **OCR Text Extraction**: `POST /api/extract-text-ocr` - Extract text from scanned documents with confidence scores
- **Table Extraction**: Specialized extraction with cell structure and spans

### Generation Operations
- **HTML to PDF**: `POST /api/html-to-pdf` - Convert HTML with configurable format (A4/Letter/Legal), orientation, margins, background printing

### Transformation Operations
- **Extract Pages**: `POST /api/extract-pages` - Extract specific pages (e.g., "1,3,5-10")
- **Split PDF**: `POST /api/split-pdf` - Split into chunks with configurable chunk size
- **Merge Documents**: `POST /api/merge-documents` - Combine multiple PDFs
- **Compress PDF**: `POST /api/compress-pdf` - Optimize file size with object streams

## Azure Document Intelligence Integration

The service integrates Azure's Document Intelligence (formerly Form Recognizer) for advanced capabilities:

### Features
- **Prebuilt Models**: Uses `prebuilt-layout` by default for general document analysis
- **OCR Engine**: High-accuracy optical character recognition for scanned documents
- **Layout Analysis**: Paragraph detection, reading order, bounding boxes
- **Table Detection**: Automatic table identification with cell structure
- **Multi-format Support**: PDF, PNG, JPG, TIFF, BMP processing
- **Confidence Scores**: Optional inclusion of confidence metrics for quality assessment

### Configuration
Set environment variables to enable Azure integration:
```bash
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://[region].api.cognitive.microsoft.com/
AZURE_DOC_INTELLIGENCE_KEY=your-api-key
AZURE_DOC_INTELLIGENCE_MODEL=prebuilt-layout  # Optional, defaults to prebuilt-layout
```

### Output Formats
- **JSON**: Structured data with paragraphs, tables, content blocks, bounding boxes
- **HTML**: Formatted HTML representation of document structure

## API and Interfaces

### Request Patterns

All endpoints support dual input/output patterns:

**Direct File Upload** (multipart/form-data):
```bash
curl -X POST http://localhost:8080/api/extract-text \
  -F "file=@document.pdf"
```

**Working Memory Reference** (planned):
```bash
curl -X POST http://localhost:8080/api/extract-text \
  -H "Content-Type: application/json" \
  -d '{"input": {"working_memory_id": "wm-12345"}}'
```

### Response Formats

**Default**: Returns data directly (text or binary)

**JSON Envelope**: Add `-H "Accept: application/json"` or `?format=json`:
```json
{
  "success": true,
  "data": "Extracted text content...",
  "format": "text",
  "metadata": {
    "backend_used": "pdf-parse",
    "processing_time_ms": 150,
    "cached": false
  }
}
```

### Standard Endpoints
- `GET /` - Service information
- `GET /health` - Health check (liveness probe)
- `GET /ready` - Readiness check (database and Azure service connectivity)
- `GET /status` - Service status and uptime

## Performance Optimizations

### Content-Based Caching
- **Cache Key**: SHA256 hash of (operation + input content + options)
- **Storage**: PostgreSQL `cache` table with TTL management
- **Benefits**: Reduces processing time and external API costs for repeated operations
- **Granularity**: Same document with different operations cached separately

### Capability-Based Backend Selection
- Providers query clients for operation support before delegation
- Multiple clients can support the same operation (e.g., both pdf-parse and Azure OCR for PDFs)
- Selection based on capabilities, options, and client health

### Intelligent Quality Detection
The `/api/extract-general` endpoint uses combined heuristics to detect low-quality PDFs:
- **Characters per page**: < 50 triggers OCR
- **Total characters**: < 100 indicates scanned document
- **Alphanumeric ratio**: < 30% suggests poor extraction quality
- **Automatic fallback**: Transparently switches to Azure OCR when needed

### Graceful Degradation
- Caching failures don't break requests
- Logging failures don't interrupt processing
- Missing Azure credentials disable OCR features without affecting basic operations

## Dependencies

### Core Services
- **PostgreSQL**: Request logging (`request_log` table) and result caching (`cache` table) in `document_processing` schema
- **Context Service**: Working memory resolution and storage (planned integration)
- **Azure Document Intelligence**: Optional OCR and layout analysis capabilities

### Node.js Libraries
- **Express 5**: HTTP server with Router-based routing
- **Kysely**: Type-safe SQL query builder for PostgreSQL operations
- **Multer**: Multipart file upload handling (50MB limit)
- **pdf-parse**: PDF text extraction
- **mammoth**: DOCX text extraction
- **xlsx (SheetJS)**: Excel to CSV conversion
- **puppeteer**: HTML to PDF generation with Chromium
- **pdf-lib**: PDF manipulation and transformation
- **@azure/ai-form-recognizer**: Azure Document Intelligence SDK
- **Zod**: Runtime configuration validation
- **Winston**: Structured logging

### System Requirements
- **Chrome/Chromium**: Required by Puppeteer for HTML to PDF generation
- **Node.js 20+**: Minimum Node version
- **pnpm**: Package manager

## Configuration

### Required Environment Variables
```bash
# PostgreSQL connection
PG_SERVER=your-server.postgres.database.azure.com
PG_DATABASE=firefoundry_beta
PG_PORT=6432
PG_PASSWORD=readonly-password
PG_INSERT_PASSWORD=write-password

# Context Service
CONTEXT_SERVICE_URL=http://context-service:8080
CONTEXT_SERVICE_API_KEY=optional-api-key
```

### Optional Environment Variables
```bash
# Azure Document Intelligence (enables OCR features)
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://[region].api.cognitive.microsoft.com/
AZURE_DOC_INTELLIGENCE_KEY=your-api-key
AZURE_DOC_INTELLIGENCE_MODEL=prebuilt-layout

# Service configuration
PORT=8080
NODE_ENV=production
LOG_LEVEL=info
CACHE_TTL_SECONDS=3600
MAX_FILE_SIZE_MB=50

# Application Insights (optional)
APPLICATIONINSIGHTS_CONNECTION_STRING=your-connection-string
```

### Database Setup
Before starting the service, create the database schema:
```bash
psql -h YOUR_PG_SERVER -U YOUR_USER -d ff_int_dev -f src/database/schema.sql
```

This creates the `document_processing` schema with `request_log` and `cache` tables.

## Version and Maturity

- **Current Version**: 0.1.10
- **Status**: Beta (Phase 3 Complete - Azure Document Intelligence integration)
- **Node.js Version**: 20+ required
- **License**: Proprietary

### Development Roadmap
- **✅ Phase 1**: Infrastructure (database, endpoints, caching, logging)
- **✅ Phase 2**: Core processing (PDF, DOCX, Excel, HTML to PDF, PDF manipulation)
- **✅ Phase 3**: Azure Document Intelligence integration (OCR, layout analysis, table extraction)
- **📋 Future**: Format conversion, image manipulation, template-based generation, Python worker integration

## Repository

**Source Code**: [ff-services-doc-proc](https://github.com/firebrandanalytics/ff-services-doc-proc) (private)

## Related Documentation

- **[Context Service](./context-service.md)**: Working memory integration for input/output references
- **[Platform Services Overview](../README.md)**: FireFoundry microservices architecture
- **Python Worker Integration**: Advanced document processing capabilities (planned)

## Usage Examples

### Extract Text from PDF with Automatic OCR Fallback
```bash
# Intelligent extraction with quality detection
curl -X POST http://localhost:8080/api/extract-general \
  -F "file=@document.pdf"

# Get detailed metadata about extraction method
curl -X POST http://localhost:8080/api/extract-general \
  -F "file=@document.pdf" \
  -H "Accept: application/json"
```

### Convert HTML to PDF with Custom Settings
```bash
curl -X POST http://localhost:8080/api/html-to-pdf \
  -F "file=@report.html" \
  -F "format=Letter" \
  -F "landscape=true" \
  -F "marginTop=1cm" \
  -F "marginBottom=1cm" \
  --output report.pdf
```

### Extract Structured Data with Azure
```bash
# Full document analysis with layout
curl -X POST http://localhost:8080/api/analyze-document \
  -F "file=@scanned-invoice.pdf" \
  -F "output_format=json" \
  -F "include_confidence=true"
```

### Excel to CSV Conversion
```bash
# Convert specific sheet with custom formatting
curl -X POST http://localhost:8080/api/extract-sheet-to-csv \
  -F "file=@spreadsheet.xlsx" \
  -F "sheet=Summary" \
  -F "separator=;" \
  -F "includeHeaders=true"
```
