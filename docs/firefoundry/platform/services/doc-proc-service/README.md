# Document Processing Service

## Overview

The Document Processing Service is the single API your agent bundles use for document work. It extracts text, tables, and metadata from PDFs, Office files (Word, Excel, PowerPoint), and images. It generates documents: PDFs from HTML, and Excel and Word files from templates. It transforms PDFs by extracting pages, splitting them into chunks, and wrapping images as PDFs. With optional backends enabled, it also runs OCR and layout analysis on scanned documents and renders PDF pages as images. You send a file, or a reference to a file in working memory, and get back text, JSON, or a new document.

## Purpose and Role in Platform

Most AI apps have to turn documents into something an LLM can read, or turn LLM output back into a document. Use this service for:

- **Ingestion**: extracting text from uploaded PDFs, Word files, spreadsheets, and slide decks before chunking, summarizing, or classifying them
- **Scanned documents**: OCR and layout analysis for scans, photos, and image-only PDFs
- **Structured extraction**: tables and page-level content for data-extraction workflows (invoices, statements, forms)
- **Output generation**: rendering an LLM-written HTML report as a PDF, or filling Excel and Word templates with data
- **Document preparation**: page selection and splitting before processing, and page images for vision models

## Key Features

- **Multi-format extraction**: PDF, DOCX, Excel (CSV or structured JSON), PowerPoint (slides with text and images), and images
- **Automatic OCR fallback**: `/api/extract-general` detects image-only or garbled PDFs and switches to OCR
- **OCR and layout analysis** (Azure Document Intelligence, when configured): paragraphs, reading order, tables, and confidence scores
- **HTML to PDF**: page size, orientation, and margins
- **Template-based generation**: fill `.xlsx` and `.docx` templates with JSON data
- **PDF transformation**: extract pages, split into chunks, and convert images to PDF
- **Working memory integration**: process documents already stored in [Context Service](../context-service/README.md) working memory, and optionally store results there
- **Result caching**: repeating the same operation on the same file with the same options returns quickly (reported in the `X-Cache` header)
- **Optional Python worker**: page images, local OCR, table extraction, image upscaling, and colorspace conversion (see [Python Worker](../doc-proc-pyworker/README.md))

## Supported Formats

### Input

| Format | Extensions | Capabilities |
|--------|-----------|--------------|
| PDF | `.pdf` | Text, structure, and metadata extraction; OCR and analysis; page extraction and splitting; page images |
| Microsoft Word | `.docx` | Text, HTML, and metadata extraction; template filling |
| Microsoft Excel | `.xlsx`, `.xls` | CSV or structured extraction; template filling (`.xlsx`) |
| Microsoft PowerPoint | `.pptx`, `.ppsx`, `.pptm` | Structured extraction (slides, text, images) |
| HTML | `.html` | Conversion to PDF |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` | OCR and analysis; conversion to PDF (PNG, JPG); upscaling and colorspace conversion |
| Plain text | `.txt`, `.md`, `.csv` | Pass-through |

The file name's extension tells the service what format a document is, so always send a real file name.

### Output

- Plain text
- Structured JSON (pages, tables, slides, cells, metadata)
- PDF, XLSX, and DOCX (generated or transformed)
- CSV (from Excel)
- HTML (from document analysis or DOCX)
- Images (PDF pages, upscaled images, colorspace-converted images)

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Your agent bundle / application             │
└──────────────────┬───────────────────────────┘
                   │  REST: multipart upload or working-memory reference
                   │  (or docproc_* tools via MCP Gateway)
┌──────────────────▼───────────────────────────┐
│        Document Processing Service           │
│  extraction · generation · transformation    │
│  caching                                     │
└──┬─────────────────┬───────────────────┬─────┘
   │                 │                   │
┌──▼─────────────┐ ┌─▼─────────────────┐ ┌▼────────────────────┐
│ Context Service│ │ Azure Document    │ │ Python Worker       │
│ (working       │ │ Intelligence      │ │ (optional: images,  │
│  memory)       │ │ (optional: OCR,   │ │  local OCR, tables, │
│                │ │  layout, tables)  │ │  upscale, color)    │
└────────────────┘ └───────────────────┘ └─────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)**: choosing an operation, OCR fallback, input and output patterns, caching, and app design patterns
- **[Getting Started](./getting-started.md)**: first extraction, PDF generation, and transformations
- **[Reference](./reference.md)**: endpoints, options, responses, and errors
- **[Operations](./operations.md)**: enabling the service and optional backends, limits, and troubleshooting

## Version

- **Current Version**: 0.2.1

## Repository

Source code: [ff-services-doc-proc](https://github.com/firebrandanalytics/ff-services-doc-proc) (private)

## Related

- [Platform Services Overview](../README.md)
- [Document Processing Python Worker](../doc-proc-pyworker/README.md): optional backend for page images, local OCR, tables, upscaling, and colorspace conversion
- [Context Service](../context-service/README.md): working memory for input and output documents
- [MCP Gateway tools](../mcp-gateway/tools.md#document-processing-adapter): the `docproc_*` MCP tools
- [Platform Architecture](../../architecture.md)
