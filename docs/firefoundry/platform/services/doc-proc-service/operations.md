# Document Processing — Operations

Enabling the Document Processing Service and its optional backends for your app, limits to design around, and caller-side troubleshooting.

## Enabling the Service

The Document Processing Service is a component of the `firefoundry-core` Helm chart and is disabled by default:

```yaml
doc-proc-service:
  enabled: true
```

The component also needs a database credential when it is installed; your environment administrator provides it.

Once enabled, bundles in the cluster reach the service at `http://firefoundry-core-doc-proc-service:8081`. It is not exposed outside the cluster by default.

With only this setting, you get text, structured, and metadata extraction for digital documents, Excel to CSV, HTML to PDF, Excel and Word template filling, and page extraction, splitting, and image-to-PDF.

## Optional Backends

### OCR and layout analysis (Azure Document Intelligence)

This backend enables `analyze-document`, `extract-text-ocr`, `extract-tables` (when the Python worker is off), and OCR in `extract-general`. Create an Azure Document Intelligence resource (in the Azure Portal, search for "Document Intelligence"; a free tier exists for testing) and give the service its endpoint and key:

```yaml
doc-proc-service:
  configMap:
    data:
      AZURE_DOC_INTELLIGENCE_ENDPOINT: "https://your-region.api.cognitive.microsoft.com/"
      AZURE_DOC_INTELLIGENCE_MODEL: "prebuilt-layout"   # optional; this is the default
  secret:
    data:
      AZURE_DOC_INTELLIGENCE_KEY: "your-api-key"
```

Keep the key in your environment's secret management. Azure usage is billed to that Azure resource, so watch it if your app runs OCR on many pages.

### Python worker

The Python worker enables page images, image upscaling, colorspace conversion, and structured extraction of images. With the extended worker image, it also enables local OCR, neural OCR, and table extraction. Enable the worker and connect the service to it:

```yaml
doc-proc-pyworker:
  enabled: true

doc-proc-service:
  pythonWorker:
    enabled: true
```

With the worker enabled, `extract-tables` and PDF `extract-structured` requests go to the worker (see [Reference](./reference.md#post-apiextract-tables)). See the [Python worker getting started guide](../doc-proc-pyworker/getting-started.md) for verification steps and for how to tell which capabilities your worker image includes.

Restart the Document Processing Service after changing its settings.

## Verifying Access from a Bundle

1. `GET /health` returns `{"status": "healthy", ...}`.
2. `GET /ready` returns `{"ready": true, ...}`. A 503 means a dependency (its database, the Context Service, or storage) is unavailable; tell your environment administrator. `/ready` does not check the optional OCR backend or the Python worker.
3. `POST /api/extract-text` with a small digital PDF returns text.
4. If you rely on Azure OCR, `POST /api/extract-text-ocr` with a small image returns text.
5. If you rely on the Python worker, `POST /api/pdf-to-images` with a small PDF returns images.

## Limits and Behavior to Design Around

- **File size**: uploads are limited to 50 MB by default. If you call the service through an ingress, the ingress's own body-size limit also applies. For bigger documents, split them or ask your environment administrator to raise the limits.
- **Processing time**: large PDFs, OCR, and HTML rendering take seconds to minutes. Call these operations from a background step in your workflow rather than in a latency-sensitive user request. Worker-backed operations are also bounded by the worker timeout (30 seconds per request by default).
- **Busy responses**: when the service is at capacity it answers `503` with a `Retry-After` header instead of queueing. Retry after the indicated delay, and limit how many documents you send in parallel.
- **Memory-heavy operations**: HTML to PDF, page images at high DPI, and very large PDFs use a lot of memory. Prefer splitting long documents and processing chunks.
- **OCR cost**: each Azure OCR or analysis call is billed. Try `extract-text` or `extract-general` first and OCR only what needs it, or use the worker's local OCR.
- **Caching window**: identical requests are served from cache for a limited time (one hour by default). Store results you need long-term yourself.
- **Optional features**: OCR and worker-backed endpoints fail in environments that haven't enabled them. Handle that as "not available" in your app.
- **Not yet available**: `convert-format` returns an error, and `merge-documents` currently returns only the first uploaded document.
- **HTML input**: `html-to-pdf` should receive self-contained HTML. Don't rely on external stylesheets, fonts, or images loading.

## Troubleshooting

**A request fails with 501 and an `error` message**
- `No client available for <operation> with format: <format>`: that operation doesn't support this file type, or the backend it needs isn't enabled. Check the file name's extension and the [endpoint summary](./reference.md#endpoint-summary).
- A message mentioning the Python worker, or a worker error such as `No backend found for operation`: the worker is off, or your worker image lacks that capability. See the [Python worker errors](../doc-proc-pyworker/reference.md#errors).
- `... not yet implemented`: the endpoint isn't available yet.

**A request fails with 500 and "Internal Server Error"**
- Make sure the request has a `file` (with a file name) or an `input` with a `working_memory_id`.
- Check the file size against the limit (50 MB by default).

**503 with `Retry-After`**
- The service is busy, or reading the input from working memory timed out. Retry after the delay, and reduce parallel requests.

**Extracted text is garbled or empty**
- The PDF is probably scanned. Use `/api/extract-general`, or OCR it directly (`extract-text-ocr` or `ocr-local`).
- In the JSON envelope, `fallback_unavailable: true` means OCR would have been used but isn't configured.

**`extract-tables` fails even though Azure is configured**
- With the Python worker enabled, table extraction runs on the worker and needs the extended worker image. Use the extended image, or `analyze-document` for tables through Azure.

**The request is too large, or is cut off**
- Split the PDF (`split-pdf`, `extract-pages`) first.
- If you go through an ingress, its body-size limit may be lower than the service's.

**HTML to PDF fails or looks wrong**
- Make the HTML self-contained, with inline CSS and embedded images.
- For very large reports, generate several smaller PDFs.

**Timeouts on large documents**
- Process fewer pages per request, or process chunks in parallel.
- For worker-backed operations, lower `dpi` or `pages`, and see the [Python worker operations guide](../doc-proc-pyworker/operations.md).

**Worker-backed endpoints fail**
- Check that `doc-proc-pyworker.enabled` and `doc-proc-service.pythonWorker.enabled` are both `true`, and that the service was restarted after the change.

**Results look stale**
- Identical requests are served from cache (`X-Cache: HIT`). Change an option or wait for the cache to expire if you need a fresh run, for example after changing OCR configuration.
