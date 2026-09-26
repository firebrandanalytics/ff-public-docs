# Document Processing Python Worker

## Overview

The Document Processing Python Worker ("pyworker") is a stateless gRPC microservice that performs document and image operations using Python's PDF, OCR, and imaging libraries. It is a **System service**: application code and agent bundles do not normally call it. Instead, the [Document Processing Service](../doc-proc-service/README.md) delegates Python-backed operations — PDF rasterization, structured PDF extraction, table extraction, local OCR, image upscaling, and colorspace conversion — to the worker over gRPC.

## Purpose and Role in Platform

The Document Processing Service is the REST front door for document work in FireFoundry. Some operations are best served by the Python ecosystem (pdfplumber, Camelot, Tesseract, EasyOCR, Pillow/ImageCms), so they live in this separate worker process:

- **PDF to images** — rasterize PDF pages to PNG/JPEG using Poppler
- **Structured extraction** — layout-aware page text and tables via pdfplumber
- **Advanced table extraction** — Camelot `lattice` / `stream` algorithms (optional feature group)
- **Local OCR** — Tesseract (`ocr_local`) and neural-network EasyOCR (`ocr_advanced`), free alternatives to cloud OCR (optional feature groups)
- **Image upscaling** — Lanczos resampling or AI upscaling through Stability AI
- **Colorspace conversion** — ICC-profile-based RGB → CMYK (and RGB → RGB) conversion for print preparation

The worker receives raw document bytes plus an operation name and a string map of options, and returns output bytes, an output format, and metadata. It keeps no state between requests and has no database.

## Key Features

- **Single, generic gRPC contract** — one `DocumentWorker` service with `ProcessDocument`, `SupportsOperation`, and `HealthCheck` RPCs; new operations do not require new RPCs
- **Backend registry** — each library is wrapped in a backend class; requests are routed to the first backend that supports the operation
- **Capability discovery** — `HealthCheck` reports exactly which operations the running image supports, so orchestrators can adapt to slim or full builds
- **Configurable image** — the default image is slim (PDF/image operations only); OCR, Camelot, and EasyOCR are opt-in build-time feature groups
- **Page selection** — a common `pages` option (`"1,3,5-10"`) limits processing to specific pages
- **Structured errors** — processing failures are returned in the response (`success=false`, `error_message`) with timing, rather than as transport errors
- **Large payloads** — gRPC send/receive limits raised to 100 MB per message
- **Optional HTTP API** — a FastAPI server exposes `/health` and a JSON `/process` endpoint for image operations
- **TypeScript client** — a generated, Promise-based gRPC client package is used by the Document Processing Service

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│   Agent bundles / applications (REST, multipart)    │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│          Document Processing Service (Node.js)      │
│   /api/pdf-to-images  /api/upscale-image            │
│   /api/convert-colorspace  ...                      │
│   PythonWorkerClient (gRPC, PYTHON_WORKER_URL)      │
└───────────────────┬─────────────────────────────────┘
                    │ gRPC  document_worker.DocumentWorker
                    │ (port 50051, plaintext, in-cluster)
┌───────────────────▼─────────────────────────────────┐
│        Document Processing Python Worker            │
│  gRPC server (ThreadPoolExecutor, 10 threads)       │
│  HTTP server (FastAPI, port 8080) — health/image    │
│  ┌───────────────────────────────────────────────┐  │
│  │               Backend registry                │  │
│  │  PDFPlumber  Image  Upscale  Colorspace       │  │
│  │  Camelot*    Tesseract*      EasyOCR*         │  │
│  └───────────────────────────────────────────────┘  │
│   * registered only when the feature group is       │
│     installed in the image                          │
└───────────────────┬─────────────────────────────────┘
                    │ (optional, upscale provider=stability)
┌───────────────────▼─────────────────────────────────┐
│              Stability AI API (external)            │
└─────────────────────────────────────────────────────┘
```

**Core components:**
- **gRPC server** (`src/server.py`) — binds `[::]:$GRPC_PORT`, starts the HTTP health server in a background thread, and shuts down gracefully on `SIGTERM`/`SIGINT` with a 5-second grace period
- **DocumentWorkerService** (`src/service.py`) — implements the three RPCs and the backend registry
- **Backends** (`src/backends/`) — one class per library, each declaring `SUPPORTED_OPERATIONS`
- **Providers** (`src/providers/`) — pluggable upscale providers (Stability AI, Lanczos) and the ICC profile manager / colorspace converter

## Documentation

- **[Concepts](./concepts.md)** — Operations, backends, feature groups, request lifecycle, and how the Document Processing Service uses the worker
- **[Getting Started](./getting-started.md)** — Enable the worker, verify the Document Processing Service → worker path, and call the worker directly for debugging
- **[Reference](./reference.md)** — gRPC service and messages, every operation and its options, output schemas, HTTP API, and environment variables
- **[Operations](./operations.md)** — Helm deployment, image variants, health checks, scaling, security, monitoring, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0 (service, Helm chart, and TypeScript client)
- **Maturity**: Early release. The gRPC contract is stable in shape, but the worker is disabled by default in FireFoundry environments and the published image is the slim build (see [Operations](./operations.md#image-variants)).
- **Language / Runtime**: Python 3.11
- **Protocol**: gRPC (plus an auxiliary HTTP API)

Language detection (`detect_language`), which appeared in early design notes, is **not implemented**.

## Repository

Source code: [ff-services-doc-proc-pyworker](https://github.com/firebrandanalytics/ff-services-doc-proc-pyworker) (private)

## Related

- [Document Processing Service](../doc-proc-service/README.md) — The REST service that calls this worker
- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
