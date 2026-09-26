# Document Processing Python Worker — Reference

Complete reference for the worker's gRPC service, every operation and its options, output schemas, the auxiliary HTTP API, and configuration variables.

## gRPC Service

- **Package**: `document_worker`
- **Service**: `DocumentWorker`
- **Default port**: `50051` (`GRPC_PORT`)
- **Transport**: plaintext (insecure) HTTP/2; no TLS, no authentication
- **Max message size**: 100 MB send and receive
- **Server reflection**: not enabled — clients need the proto file

| RPC | Request | Response | Purpose |
|-----|---------|----------|---------|
| `SupportsOperation` | `OperationRequest` | `SupportResponse` | Check whether a registered backend handles an operation |
| `ProcessDocument` | `ProcessRequest` | `ProcessResponse` | Run an operation on a document |
| `HealthCheck` | `Empty` | `HealthResponse` | Liveness, version, and supported operations |

Fully qualified method names: `document_worker.DocumentWorker/SupportsOperation`, `document_worker.DocumentWorker/ProcessDocument`, `document_worker.DocumentWorker/HealthCheck`.

### Protocol Buffer Definition

```protobuf
syntax = "proto3";

package document_worker;

// DocumentWorker service provides document processing operations
service DocumentWorker {
  // Check if the worker supports a specific operation
  rpc SupportsOperation(OperationRequest) returns (SupportResponse);

  // Process a document with the specified operation
  rpc ProcessDocument(ProcessRequest) returns (ProcessResponse);

  // Health check endpoint
  rpc HealthCheck(Empty) returns (HealthResponse);
}

// Request to check if an operation is supported
message OperationRequest {
  string operation = 1;  // e.g., "extract_tables", "ocr_local"
  string format = 2;     // Optional: input format hint (e.g., "pdf", "image/png")
}

// Response indicating if an operation is supported
message SupportResponse {
  bool supported = 1;
  string message = 2;    // Optional explanation
}

// Request to process a document
message ProcessRequest {
  bytes document_data = 1;           // Raw document bytes
  string operation = 2;              // Operation to perform
  map<string, string> options = 3;   // Operation-specific options
}

// Response containing processed document
message ProcessResponse {
  bytes output_data = 1;             // Processed output bytes
  string format = 2;                 // Output format (e.g., "json", "text", "image/png")
  map<string, string> metadata = 3;  // Additional metadata about the processing
  int32 processing_time_ms = 4;      // Time taken to process in milliseconds
  bool success = 5;                  // Whether processing succeeded
  string error_message = 6;          // Error message if success is false
}

// Empty message for requests with no parameters
message Empty {}

// Health check response
message HealthResponse {
  bool healthy = 1;
  string version = 2;
  repeated string supported_operations = 3;
}
```

### SupportsOperation

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name, e.g. `extract_tables` |
| `format` | string | Optional input-format hint. Current backends ignore it. |

Response: `supported=true` and `message="Supported by <BackendClass>"`, or `supported=false` and `message="Operation '<op>' is not supported"`.

### ProcessDocument

| Request field | Type | Description |
|---------------|------|-------------|
| `document_data` | bytes | Raw input (PDF or image bytes) |
| `operation` | string | One of the operations below |
| `options` | map<string,string> | Operation-specific options; unknown keys are ignored |

| Response field | Type | Description |
|----------------|------|-------------|
| `success` | bool | `true` when the operation completed |
| `output_data` | bytes | Result bytes (UTF-8 JSON or HTML for all current operations); empty on failure |
| `format` | string | `json` or `html`; empty on failure |
| `metadata` | map<string,string> | Backend-specific metadata (see each operation) |
| `processing_time_ms` | int32 | Wall-clock processing time, also set on failure |
| `error_message` | string | Set when `success=false` |

**Error messages** (returned with gRPC status `OK` and `success=false`):

| Message pattern | Cause |
|-----------------|-------|
| `No backend found for operation '<op>'` | Unknown operation, or the feature group for it is not installed in the image |
| `Processing failed: Invalid page number N. Document has M pages.` | `pages` out of range (pre-filtered operations) |
| `Processing failed: Invalid page range: a-b (start > end)` | Malformed `pages` range |
| `Processing failed: Invalid <option>: ...` | An option value outside its allowed set |
| `Processing failed: Invalid image data: ...` | Image operations received bytes Pillow cannot open |
| `Processing failed: Stability AI API key is required. Set STABILITY_API_KEY environment variable.` | `provider=stability` (the default) without a key |
| `Processing failed: <library error>` | Any other exception raised by the backend |

Transport failures use standard gRPC status codes: `UNAVAILABLE` (worker unreachable), `DEADLINE_EXCEEDED` (client deadline exceeded), `RESOURCE_EXHAUSTED` (message larger than 100 MB).

### HealthCheck

Returns `healthy=true`, `version` (currently `0.1.0`), and `supported_operations` — the sorted union of operations from all **registered** backends. Backends whose libraries are not installed are not registered and their operations are absent.

## Operations

All option values are strings. Defaults apply when an option is omitted.

### extract_structured

Layout-aware extraction with pdfplumber. **Feature group:** core.

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `pages` | all | e.g. `1,3,5-10` | Pre-filter pages (output renumbered from 1) |
| `output_format` | `json` | `json`, `html` | Output encoding |
| `include_bounding_boxes` | `false` | `true`, `false` | Add per-word coordinates |

Output (`format=json`):

```json
{
  "pages": [
    {
      "page_number": 1,
      "text": "extracted page text",
      "tables": [ { "table_index": 0, "data": [["cell", "cell"], ["cell", null]] } ],
      "words": [ { "text": "Invoice", "x0": 72.0, "y0": 90.1, "x1": 118.4, "y1": 101.3 } ]
    }
  ]
}
```

`words` is present only with `include_bounding_boxes=true`. With `output_format=html` the output is an HTML document with one `<div class="page">` per page containing a `<pre>` text block and `<table>` elements.

Metadata: `pages_processed`, `total_tables`.

### pdf_to_images

Rasterize PDF pages with pdf2image/Poppler. **Feature group:** core.

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `pages` | all | e.g. `1-3` | Pages to render (original page numbers preserved) |
| `dpi` | `200` | integer | Render resolution |
| `format` | `png` | `png`, `jpeg`, `jpg` | Image encoding (note: option is `format`, not `output_format`) |

Output (`format=json`):

```json
{
  "images": [
    { "page": 1, "data": "<base64>", "format": "png", "width": 1700, "height": 2200 }
  ]
}
```

Metadata: `images_generated`, `dpi`, `format`.

### extract_tables

Table detection with Camelot. **Feature group:** tables (`INSTALL_TABLES=true`).

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `pages` | all | e.g. `2-4` | Pre-filter pages (output renumbered from 1) |
| `table_flavor` | `lattice` | `lattice`, `stream` | `lattice` for ruled tables with visible borders; `stream` for whitespace-separated tables |

Output (`format=json`):

```json
{
  "tables": [
    { "page": "1", "data": [["Item", "Qty"], ["Widget", "4"]], "accuracy": 99.2, "table_index": 0 }
  ]
}
```

Metadata: `tables_found`, `flavor`.

### ocr_local

OCR with Tesseract. Accepts a PDF (detected by the `%PDF` header) or a single image. **Feature group:** ocr (`INSTALL_OCR=true`).

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `pages` | all | e.g. `1,3` | PDF only; original page numbers preserved |
| `language` | `eng` | Tesseract language code(s), e.g. `eng`, `eng+deu` | Only `eng` data is installed in the standard OCR build |
| `dpi` | `300` | integer | PDF rasterization resolution |
| `include_bounding_boxes` | `false` | `true`, `false` | Add per-word boxes and an average `confidence` |

Output (`format=json`):

```json
{
  "pages": [
    {
      "page": 1,
      "text": "recognized text",
      "confidence": 87.5,
      "words": [ { "text": "Total", "confidence": 96.0, "x": 102, "y": 540, "width": 48, "height": 14 } ]
    }
  ]
}
```

`confidence` and `words` are present only with `include_bounding_boxes=true`.

Metadata: `pages_processed`, `language`, `engine=tesseract`.

### ocr_advanced

Neural-network OCR with EasyOCR. Accepts a PDF or a single image. **Feature group:** easyocr (`INSTALL_EASYOCR=true`).

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `pages` | all | e.g. `1-2` | PDF only; original page numbers preserved |
| `language` | `en` | comma-separated EasyOCR codes, e.g. `en,es` | Languages for the reader |
| `dpi` | `300` | integer | PDF rasterization resolution |
| `gpu` | `false` | `true`, `false` | Use a GPU if available |

The EasyOCR reader is created on the first `ocr_advanced` request and reused for the life of the process, so the `language` and `gpu` values of that **first** request apply to later requests on the same replica.

Output (`format=json`):

```json
{
  "pages": [
    {
      "page": 1,
      "text": "all detections joined by spaces",
      "detections": [
        { "text": "Total", "confidence": 0.95, "bbox": [[10, 20], [60, 20], [60, 34], [10, 34]] }
      ]
    }
  ]
}
```

Metadata: `pages_processed`, `languages`, `engine=easyocr`, `gpu`.

### upscale_image

Upscale an image. Input: PNG, JPEG, WebP, or TIFF bytes. **Feature group:** core.

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `provider` | `stability` | `stability`, `lanczos`, `auto` | Upscaling provider |
| `scale_factor` | `2` | `stability`: `2`, `4`; `lanczos`: `2`, `3`, `4`, `6`, `8`; `auto`: `2`–`8` | Multiplier |
| `output_format` | `png` | `png`, `jpeg`, `jpg`, `webp`, `tiff` | Output encoding |

Provider notes:
- `stability` calls the external Stability AI API (ESRGAN), requires `STABILITY_API_KEY`, and rejects outputs larger than 2048×2048.
- `lanczos` runs locally with Pillow and has no resolution cap.
- `auto` uses the default provider (`UPSCALE_DEFAULT_PROVIDER`) if it supports the scale factor and input format, otherwise the first provider that does.

Output (`format=json`):

```json
{
  "image": {
    "data": "<base64>",
    "format": "png",
    "mime_type": "image/png",
    "width": 3072,
    "height": 3072,
    "original_width": 1024,
    "original_height": 1024
  },
  "method": "pillow-lanczos",
  "provider": "lanczos",
  "metadata": { "scale_factor": "3" }
}
```

Metadata: `provider`, `method`, `scale_factor`, `output_format`, `original_dimensions`, `output_dimensions`.

### convert_colorspace

ICC-profile colorspace conversion with Pillow ImageCms. **Feature group:** core.

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `target_colorspace` | `cmyk` | `cmyk`, `srgb`, `rgb`, `adobe_rgb` | Target colorspace |
| `source_profile` | auto | `embedded`, a profile name, or a path | Source profile; auto uses the embedded profile, else sRGB |
| `target_profile` | `default` | `default`, a profile name, or a path | `default` = `DEFAULT_CMYK_PROFILE` for CMYK, sRGB or Adobe RGB for RGB targets |
| `rendering_intent` | `perceptual` | `perceptual`, `relative_colorimetric`, `saturation`, `absolute_colorimetric` | ICC rendering intent |
| `output_format` | `tiff` | `tiff`, `jpeg`, `jpg`, `png` | Output encoding (TIFF recommended for CMYK; PNG cannot hold CMYK) |
| `preserve_transparency` | `false` | `true`, `false` | Keep alpha where the target supports it (CMYK does not) |

Profile names are resolved case-insensitively against aliases in `ICC_PROFILES_DIR`:

| Alias | File names searched |
|-------|---------------------|
| `srgb` | `sRGB.icc`, `sRGB IEC61966-2.1.icc`, `sRGB_IEC61966-2-1.icc` (built-in sRGB if none) |
| `adobe_rgb` | `AdobeRGB1998.icc`, `Adobe RGB (1998).icc`, `AdobeRGB.icc` |
| `fogra39` | `FOGRA39.icc`, `ISOcoated_v2_300_eci.icc`, `CoatedFOGRA39.icc`, `GenericCMYK.icc` |
| `swop` | `USWebCoatedSWOP.icc`, `SWOP.icc`, `WebCoatedSWOP2006Grade3.icc` |
| `gracol` | `GRACoL2006_Coated1v2.icc`, `GRACoL.icc` |
| `generic_cmyk` | `GenericCMYK.icc`, `Generic CMYK Profile.icc` |

Output (`format=json`):

```json
{
  "image": {
    "data": "<base64>",
    "format": "tiff",
    "mime_type": "image/tiff",
    "width": 1700,
    "height": 2200,
    "colorspace": "CMYK"
  },
  "conversion": {
    "source_colorspace": "RGB",
    "target_colorspace": "CMYK",
    "source_profile": "sRGB (assumed)",
    "target_profile": "FOGRA39",
    "rendering_intent": "perceptual"
  },
  "metadata": {}
}
```

Metadata: `source_colorspace`, `target_colorspace`, `source_profile`, `target_profile`, `rendering_intent`, `output_format`.

## HTTP API

The worker also runs a FastAPI server (port `HTTP_PORT`, default `8080`). In the Helm chart the HTTP port is **not exposed** by default (see [Operations](./operations.md#health-checks)). The HTTP API registers only the image-oriented backends: `pdf_to_images`, `upscale_image`, and `convert_colorspace`.

### GET /health

```json
{ "status": "ok", "operations": ["convert_colorspace", "pdf_to_images", "upscale_image"], "version": "0.1.0" }
```

### POST /process

Request body (`application/json`):

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | `pdf_to_images`, `upscale_image`, or `convert_colorspace` |
| `data` | string | Base64-encoded input bytes |
| `options` | object<string,string> | Same options as the gRPC operation |

Success (`200`):

```json
{
  "success": true,
  "result": { "image": { "data": "<base64>", "format": "png" }, "provider": "lanczos" },
  "format": "application/json",
  "metadata": { "provider": "lanczos", "scale_factor": "2" },
  "processing_time_ms": 132
}
```

Because every current operation emits JSON, `result` is the parsed JSON object (for a non-JSON output it would be a base64 string).

Errors are returned in FastAPI's `detail` envelope:

```json
{
  "detail": {
    "success": false,
    "error": { "code": "INVALID_OPERATION", "message": "Operation 'ocr_local' is not supported", "details": { "supported_operations": ["..."] } }
  }
}
```

| HTTP status | `error.code` | Cause |
|-------------|--------------|-------|
| 400 | `INVALID_BASE64` | `data` is not valid base64 |
| 400 | `INVALID_OPERATION` | Operation not available on the HTTP API |
| 400 | `INVALID_IMAGE`, `UPSCALE_PROVIDER_UNAVAILABLE`, `COLORSPACE_UNSUPPORTED`, `INVALID_OPERATION`, `PROCESSING_FAILED` | Validation error (`ValueError`), classified from the message |
| 500 | same codes as above | Processing error (`RuntimeError`), classified from the message |
| 500 | `PROCESSING_FAILED` | Unexpected exception |

## Environment Variables

Variables read by the worker:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GRPC_PORT` | `50051` | gRPC listen port |
| `HTTP_PORT` | `8080` | HTTP (FastAPI) listen port |
| `HTTP_HOST` | `0.0.0.0` | HTTP bind host when running the HTTP server standalone (`python -m src.http_server`); the embedded server always binds `0.0.0.0` |
| `STABILITY_API_KEY` | — | Stability AI key; required for `provider=stability` |
| `UPSCALE_DEFAULT_PROVIDER` | `stability` | Default provider for `provider=auto` and fallback selection |
| `ICC_PROFILES_DIR` | `<app>/profiles` | Directory scanned for `.icc`/`.icm` files |
| `DEFAULT_CMYK_PROFILE` | `FOGRA39` | Default CMYK target profile |
| `DEFAULT_RGB_PROFILE` | `sRGB` | Default RGB profile |

Fixed (not configurable) server settings: 10 gRPC worker threads, 100 MB max message size, 5-second shutdown grace period, `INFO` log level.

Variables read by the **Document Processing Service** to reach the worker are listed in [Concepts](./concepts.md#relationship-to-the-document-processing-service).

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
