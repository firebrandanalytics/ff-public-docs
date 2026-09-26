# Document Processing Python Worker

## Overview

The Document Processing Python Worker ("pyworker") is a backend that adds Python-based document and image capabilities to the [Document Processing Service](../doc-proc-service/README.md). Your application and agent bundles **never call the worker directly**. You call the Document Processing Service, and it hands certain operations to the worker behind the scenes.

Read these pages if your app needs page images, local OCR, table extraction, image upscaling, or print colorspace conversion. They explain which capabilities the worker unlocks, how to switch it on in your environment, how to tell what your environment supports, and which limits to design around.

## Purpose and Role in Platform

The Document Processing Service is the single API for document work in FireFoundry. When the worker is enabled, the service can also offer these capabilities:

| Capability | What your app gets | Availability |
|------------|--------------------|--------------|
| **PDF to images** | PNG or JPEG images of PDF pages at a DPI you choose. Useful for vision models, thumbnails, and previews. | Standard |
| **Structured extraction** | Page-by-page text plus detected tables, with optional word coordinates. Output is JSON or HTML. | Standard |
| **Advanced table extraction** | Tables from ruled (`lattice`) or whitespace-aligned (`stream`) layouts, each with an accuracy score | Extended worker image |
| **Local OCR** | Text from scanned PDFs and images, without calling a cloud OCR provider | Extended worker image |
| **Neural OCR** | Higher-quality multi-language OCR with per-detection confidence | Extended worker image |
| **Image upscaling** | 2x–8x enlargement, done locally (Lanczos) or with an AI upscaler (Stability AI) | Standard (AI upscaling needs an API key) |
| **Colorspace conversion** | RGB to CMYK (or RGB to RGB) using ICC profiles, for print-ready output | Standard |

"Extended worker image" means the capability needs a larger worker image that your environment might not run. Ask your environment administrator.

## Key Features

- **Enabled through the Document Processing Service.** No new client, credentials, or endpoints appear in your bundle.
- **Local processing.** Every capability runs inside your environment except AI upscaling, which calls Stability AI. That keeps document content in the cluster and avoids per-page cloud OCR costs.
- **Page selection.** PDF operations accept a page list such as `1,3,5-10`, so you process only the pages you need.
- **Stateless.** The worker keeps nothing between requests, so the Document Processing Service can send any request to any worker replica.

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│   Your agent bundle / application            │
└──────────────────┬───────────────────────────┘
                   │  REST (multipart upload or working-memory reference)
┌──────────────────▼───────────────────────────┐
│        Document Processing Service           │
│  Public API, caching, request logging,       │
│  working-memory integration                  │
└───────┬──────────────────────────┬───────────┘
        │ internal (in-cluster)     │
┌───────▼──────────────────┐   ┌───▼───────────────────────┐
│ Document Processing      │   │ Other backends (built-in  │
│ Python Worker            │   │ parsers, Azure Document   │
│ page images, OCR,        │   │ Intelligence, ...)        │
│ tables, upscaling, color │   └───────────────────────────┘
└───────┬──────────────────┘
        │ only for AI upscaling
┌───────▼──────────────────┐
│ Stability AI (external)  │
└──────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)**: the capabilities, when to use each one, and app design patterns
- **[Getting Started](./getting-started.md)**: turn the worker on, check which capabilities you have, and make a first call
- **[Reference](./reference.md)**: options, result shapes, and errors for each capability
- **[Operations](./operations.md)**: configuration an app team sets, limits, and caller-side troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Early release. The worker is **disabled by default** in FireFoundry environments. The standard image includes only the Standard capabilities listed above.
- Language detection is **not available**. If your app needs it, detect the language in your own code.

## Repository

Source code: [ff-services-doc-proc-pyworker](https://github.com/firebrandanalytics/ff-services-doc-proc-pyworker) (private)

## Related

- [Document Processing Service](../doc-proc-service/README.md): the API your app calls
- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
