# Document Processing Service

## Overview

The Document Processing Service provides unified document extraction, generation, and transformation capabilities for the FireFoundry platform. It handles PDF, Office documents, images, and other formats with built-in caching, PostgreSQL persistence, and Azure Document Intelligence integration for advanced OCR and layout analysis.

## Purpose and Role in Platform

This service acts as the central document processing hub for FireFoundry bundles and agents, providing:
- **Extraction**: Text, tables, and metadata from various document formats
- **Generation**: PDF creation from HTML templates
- **Transformation**: PDF manipulation (merge, split, compress, page extraction)
- **OCR**: Advanced optical character recognition for scanned documents and images

## Key Features

- **Multi-format Text Extraction**: Extract text from PDF, DOCX, Excel, and images
- **Azure Document Intelligence Integration**: Advanced OCR, layout analysis, and table extraction for scanned documents
- **PDF Manipulation**: Merge, split, compress, and extract pages
- **HTML to PDF Generation**: Configurable conversion with Puppeteer
- **Intelligent Fallback**: Automatic OCR fallback for low-quality PDFs with quality detection heuristics
- **Content-Based Caching**: SHA256 hash-based caching to reduce processing time and API costs
- **Request Logging**: Complete audit trail of all operations in PostgreSQL

## Supported Formats

### Input Formats

| Format | Extensions | Capabilities |
|--------|-----------|--------------|
| PDF | `.pdf` | Text extraction, OCR, manipulation, analysis |
| Microsoft Word | `.docx` | Text extraction |
| Microsoft Excel | `.xlsx`, `.xls` | CSV conversion with sheet selection |
| HTML | `.html` | Conversion to PDF |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` | OCR and analysis |
| Plain Text | `.txt`, `.md`, `.csv` | Pass-through |

### Output Formats

- Plain text
- Structured JSON (with page information and metadata)
- PDF (generated or transformed)
- CSV (from Excel conversion)
- HTML (from Azure Document Intelligence analysis)

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│            Orchestration Layer                       │
│          DocProcessingProvider                       │
│  Working Memory → Cache Check → Process → Store     │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│           Processing Layer                          │
│  ExtractionProvider | GenerationProvider             │
│  TransformationProvider                              │
│  (Buffer-based, no working memory awareness)         │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Client Layer                            │
│  PdfParseClient | MammothClient | ExcelClient        │
│  PuppeteerClient | PdfLibClient                      │
│  DocumentIntelligenceClient (Azure AI)               │
└─────────────────────────────────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)** — Processing pipeline, caching, quality detection, Azure integration
- **[Getting Started](./getting-started.md)** — First extraction, PDF generation, and format conversion
- **[Reference](./reference.md)** — API endpoints, request/response schemas, configuration variables
- **[Operations](./operations.md)** — Deployment, Azure configuration, monitoring, troubleshooting

## Version and Maturity

- **Current Version**: 0.1.10
- **Status**: Beta (Phase 3 Complete — Azure Document Intelligence integration)
- **Node.js Version**: 20+ required

## Repository

Source code: [ff-services-doc-proc](https://github.com/firebrandanalytics/ff-services-doc-proc) (private)

## Related

- [Platform Services Overview](../README.md)
- [Context Service](../context-service/README.md) — Working memory integration for input/output references
- [Platform Architecture](../../architecture.md)
