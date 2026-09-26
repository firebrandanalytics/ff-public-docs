# Document Processing Python Worker — Concepts

This page explains the mental model behind the Python worker: what an operation is, how requests are routed to backends, which capabilities a given image provides, and how the Document Processing Service uses the worker.

## The Worker Model

The worker is a **stateless function server**. Every call carries everything needed to do the work:

```
ProcessRequest                          ProcessResponse
┌──────────────────────────┐            ┌──────────────────────────────┐
│ document_data  (bytes)   │            │ success          (bool)      │
│ operation      (string)  │  ───────►  │ output_data      (bytes)     │
│ options  (map<str,str>)  │            │ format           (string)    │
└──────────────────────────┘            │ metadata  (map<str,str>)     │
                                        │ processing_time_ms (int32)   │
                                        │ error_message    (string)    │
                                        └──────────────────────────────┘
```

- **No storage.** The worker never reads from or writes to working memory, blob storage, or a database. The caller (normally the Document Processing Service) is responsible for fetching input bytes and persisting results.
- **No sessions.** Requests are independent; any replica can serve any request.
- **String options.** All options are strings (`"300"`, `"true"`), because the proto uses `map<string, string>`. Each backend parses the values it understands and ignores the rest.

## Operations

An **operation** is a string naming a unit of work. The worker implements these operations:

| Operation | Input | Output (`format`) | Backend | Library | Feature group |
|-----------|-------|-------------------|---------|---------|---------------|
| `extract_structured` | PDF | `json` or `html` | PDFPlumberBackend | pdfplumber | core |
| `pdf_to_images` | PDF | `json` (base64 images inside) | ImageBackend | pdf2image + Poppler | core |
| `upscale_image` | Image | `json` (base64 image inside) | UpscaleBackend | Pillow / Stability AI | core |
| `convert_colorspace` | Image | `json` (base64 image inside) | ColorspaceBackend | Pillow ImageCms | core |
| `extract_tables` | PDF | `json` | CamelotBackend | camelot-py | tables |
| `ocr_local` | PDF or image | `json` | TesseractBackend | pytesseract + Tesseract | ocr |
| `ocr_advanced` | PDF or image | `json` | EasyOCRBackend | easyocr (PyTorch) | easyocr |

Operation names use underscores. The Document Processing Service normalizes dash-style names (for example `pdf-to-images`) to underscore style before calling the worker.

> Language detection (`detect_language`) is mentioned in early design material but is **not implemented**; requesting it returns "No backend found".

## Backends and the Registry

Each library is wrapped in a **backend** class that implements two methods:

- `supports(operation, format)` — returns true when the backend can handle the operation
- `process(data, operation, options)` — returns `(output_bytes, format, metadata)`, raising `ValueError` for bad input/options and `RuntimeError` for processing failures

At startup the service builds a registry. The four core backends (PDFPlumber, Image, Upscale, Colorspace) are always registered. Camelot, Tesseract, and EasyOCR are registered **only if their Python packages import successfully**; otherwise the worker logs that the backend is unavailable and continues without it.

For each request the service walks the registry in order and uses the **first backend whose `supports()` returns true**. Operation names are unique per backend, so in practice there is exactly one candidate.

## Feature Groups and Image Variants

Because OCR and table extraction pull in large system and Python dependencies (Tesseract, Ghostscript, OpenCV, PyTorch), the container image is built in feature groups:

| Build argument | Adds system packages | Adds Python packages | Enables |
|----------------|----------------------|----------------------|---------|
| *(always)* | poppler-utils | grpcio, pdfplumber, pdf2image, PyPDF2, Pillow, pandas, httpx, FastAPI, uvicorn, structlog | `extract_structured`, `pdf_to_images`, `upscale_image`, `convert_colorspace` |
| `INSTALL_OCR=true` | tesseract-ocr, tesseract-ocr-eng | pytesseract | `ocr_local` |
| `INSTALL_TABLES=true` | ghostscript, OpenCV runtime libs | camelot-py[cv] | `extract_tables` |
| `INSTALL_EASYOCR=true` | — | easyocr (includes PyTorch) | `ocr_advanced` |

The default build — and the image published by the project's CI — is the **slim** variant with only the core group. Always treat the `supported_operations` list from `HealthCheck` as the source of truth for what a running worker can do.

## Request Lifecycle

1. The caller sends `ProcessRequest{document_data, operation, options}`.
2. The service starts a timer and looks up a backend for `operation`.
3. If no backend matches, it returns `success=false` with `error_message="No backend found for operation '<op>'"`.
4. The backend optionally applies **page selection** (see below), validates options, and runs the library.
5. On success the service returns `success=true`, the output bytes, the output `format`, backend metadata, and `processing_time_ms`.
6. If the backend raises, the service logs the stack trace and returns `success=false` with `error_message="Processing failed: <reason>"`.

Errors are carried **inside the response**; the gRPC call itself completes with status `OK`. Callers must check `success`. Transport-level errors (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED` for oversized messages) still surface as gRPC status codes.

## Page Selection

Most PDF operations accept a `pages` option using 1-based ranges: `"1"`, `"1,3,5"`, `"2-4"`, `"1-3,7"`. Two strategies are used:

| Strategy | Operations | Behavior | Page numbers in output |
|----------|-----------|----------|------------------------|
| Pre-filter the PDF with PyPDF2 | `extract_structured`, `extract_tables` | A new PDF containing only the selected pages is built first; out-of-range pages raise an error | Renumbered from 1 within the filtered document |
| Render a page window with pdf2image | `pdf_to_images`, `ocr_local`, `ocr_advanced` | Pages from min to max are rendered, then only the requested ones are kept | Original page numbers |

## Image Operations

### Upscaling providers

`upscale_image` uses a small provider registry:

| Provider | Where it runs | Scale factors accepted | Limits |
|----------|---------------|------------------------|--------|
| `lanczos` | In-process (Pillow Lanczos resampling) | 2, 3, 4, 6, 8 | None beyond memory |
| `stability` | External Stability AI API (ESRGAN) | 2, 4 | Requires `STABILITY_API_KEY`; output ≤ 2048×2048; PNG/JPEG/WebP input |
| `auto` | Picks a provider | 2–8 | Tries the default provider (`UPSCALE_DEFAULT_PROVIDER`), then any provider that supports the scale/format |

The per-request default is `provider=stability`. In environments without a Stability AI key, pass `provider=lanczos` (and set `UPSCALE_DEFAULT_PROVIDER=lanczos` so that `auto` also selects Lanczos).

### ICC profiles and colorspace conversion

`convert_colorspace` converts images with Pillow's ImageCms using ICC profiles:

- The **source profile** is the image's embedded profile when present, otherwise sRGB is assumed (or a named profile when `source_profile` is set).
- The **target profile** defaults by target colorspace: the configured CMYK profile (`DEFAULT_CMYK_PROFILE`, default `FOGRA39`) for `cmyk`, sRGB for `srgb`, Adobe RGB for `adobe_rgb`.
- Profiles are resolved from `ICC_PROFILES_DIR` using aliases (for example `FOGRA39` matches `FOGRA39.icc`, `ISOcoated_v2_300_eci.icc`, `CoatedFOGRA39.icc`, or `GenericCMYK.icc`). The image ships with `GenericCMYK.icc`, so `FOGRA39` resolves to it unless you add a real FOGRA39 profile. sRGB is built in; unresolved RGB profiles fall back to built-in sRGB.

## Relationship to the Document Processing Service

The [Document Processing Service](../doc-proc-service/README.md) owns the public REST API, caching, request logging, and working-memory integration. It holds a gRPC client to the worker, configured through environment variables that the Helm chart sets:

| Variable (on doc-proc-service) | Set from | Meaning |
|--------------------------------|----------|---------|
| `PYTHON_WORKER_ENABLED` | `doc-proc-service.pythonWorker.enabled` | Turns the integration on. If unset, the integration is enabled whenever a URL is present. |
| `PYTHON_WORKER_URL` | `pythonWorker.url`, or `<release>-doc-proc-pyworker:50051` when empty | gRPC address of the worker |
| `PYTHON_WORKER_TIMEOUT_MS` | `pythonWorker.timeoutMs` (default `30000`) | Per-request deadline |
| `PYTHON_WORKER_CONNECT_TIMEOUT_MS` | `pythonWorker.connectTimeoutMs` (default `5000`) | Initial connection timeout |

The Document Processing Service exposes worker-backed REST endpoints such as `POST /api/pdf-to-images`, `POST /api/upscale-image`, and `POST /api/convert-colorspace`. Each accepts a multipart `file`, passes it through the Document Processing Service's request pipeline with the matching operation (`pdf_to_images`, `upscale_image`, `convert_colorspace`), and the pipeline calls the worker's `ProcessDocument` RPC.

### Sibling worker: PyMuPDF

FireFoundry also ships a separate **doc-proc-pymupdf** worker (Helm chart `doc-proc-pymupdf`, gRPC port 50052) for fast text-layer PDF extraction with font metadata and PyMuPDF table extraction. It is kept as a separate service for license isolation (PyMuPDF is AGPL-3.0). The Document Processing Service has a separate client for it, configured independently (`PYMUPDF_WORKER_URL` / `PYMUPDF_WORKER_ENABLED`). The two workers expose different capabilities and are enabled separately; neither is a drop-in replacement for the other. This documentation covers only the Python worker.

## Related

- [Reference](./reference.md) — Exact options and output schemas for every operation
- [Operations](./operations.md) — Image variants, deployment, and troubleshooting
- [Document Processing — Concepts](../doc-proc-service/concepts.md)
