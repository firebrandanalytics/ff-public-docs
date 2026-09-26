# Document Processing Python Worker — Getting Started

The Python worker is a System service: you do not call it from agent code. This guide shows how to **enable** it in a FireFoundry environment, **verify** that the Document Processing Service can reach it, and **call it directly** when you need to debug an operation.

The examples assume a local environment created as described in [Minikube Bootstrap](../../../local-development/minikube-bootstrap.md): the `firefoundry-core` release in the `ff-dev` namespace. Adjust names for your environment.

## Prerequisites

- A running FireFoundry environment with the Document Processing Service available (`doc-proc-service.enabled: true`)
- `kubectl` access to the environment namespace
- Ability to change the `firefoundry-core` Helm values for the environment
- For direct gRPC calls: [grpcurl](https://github.com/fullstorydev/grpcurl), `jq`, and a copy of `document_worker.proto` (the full file is in the [Reference](./reference.md#protocol-buffer-definition))
- A small sample PDF and a sample PNG

## Step 1: Enable the Worker and the Integration

Both sides must be switched on: the worker Deployment itself, and the Document Processing Service's gRPC client. Add the following to the `firefoundry-core` values for your environment:

```yaml
doc-proc-pyworker:
  enabled: true

doc-proc-service:
  enabled: true
  pythonWorker:
    enabled: true
    # url: ""            # leave empty to use <release>-doc-proc-pyworker:50051
    timeoutMs: 30000
    connectTimeoutMs: 5000
```

If your environment is managed as a Flux `HelmRelease` (the default for environments created with `ff-cli env create`), edit its values:

```bash
kubectl edit helmrelease firefoundry-core -n ff-dev
```

If you install the chart directly with Helm, pass the values with `-f` on `helm upgrade`.

When `pythonWorker.url` is empty, the doc-proc-service chart sets `PYTHON_WORKER_URL` to `<release-name>-doc-proc-pyworker:50051` — for the `firefoundry-core` release, `firefoundry-core-doc-proc-pyworker:50051`.

## Step 2: Confirm the Worker Pod Is Ready

```bash
kubectl get pods -n ff-dev | grep doc-proc-pyworker
kubectl get svc firefoundry-core-doc-proc-pyworker -n ff-dev
```

```
NAME                                 TYPE        CLUSTER-IP     PORT(S)     AGE
firefoundry-core-doc-proc-pyworker   ClusterIP   10.96.41.120   50051/TCP   2m
```

The readiness probe is a TCP check on the gRPC port with a 30-second initial delay, so allow up to a minute before the pod reports `1/1 Running`.

Check the startup log to see which backends were loaded:

```bash
kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev | head -20
```

```
... - src.service - INFO - CamelotBackend not available (camelot-py not installed)
... - src.service - INFO - TesseractBackend not available (pytesseract not installed)
... - src.service - INFO - EasyOCRBackend not available (easyocr not installed)
... - src.service - INFO - DocumentWorker Service v0.1.0 initialized
... - src.service - INFO - Registered 4 backends
... - src.server - INFO - DocumentWorker gRPC server started on port 50051
```

"Registered 4 backends" means the slim image is running (core operations only). A full build registers up to 7.

## Step 3: Confirm the Document Processing Service Is Wired to the Worker

Check the environment variables that the chart rendered into the Document Processing Service:

```bash
kubectl exec -n ff-dev deploy/firefoundry-core-doc-proc-service -- env | grep PYTHON_WORKER
```

```
PYTHON_WORKER_ENABLED=true
PYTHON_WORKER_URL=firefoundry-core-doc-proc-pyworker:50051
PYTHON_WORKER_TIMEOUT_MS=30000
PYTHON_WORKER_CONNECT_TIMEOUT_MS=5000
```

If these are missing, `doc-proc-service.pythonWorker.enabled` is not `true`. The service reads these variables at startup, so restart it after changing them:

```bash
kubectl rollout restart deploy/firefoundry-core-doc-proc-service -n ff-dev
```

## Step 4: Exercise the Path End to End

Call a worker-backed endpoint on the Document Processing Service. In `firefoundry-core` the service listens on port 8081:

```bash
kubectl port-forward svc/firefoundry-core-doc-proc-service -n ff-dev 8081:8081 &

curl -s -X POST http://localhost:8081/api/pdf-to-images \
  -F "file=@sample.pdf" | head -c 400
```

A successful response contains the rendered page images produced by the worker. You can confirm the request reached the worker in its log:

```bash
kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev --tail 5
```

```
... - src.service - INFO - Processing document: operation=pdf_to_images, size=58587 bytes, options={...}
... - src.service - INFO - Using ImageBackend for operation 'pdf_to_images'
... - src.service - INFO - Processing completed successfully in 412ms: output_size=301877 bytes, format=json
```

Other worker-backed endpoints on the Document Processing Service include `POST /api/upscale-image` and `POST /api/convert-colorspace`.

## Step 5: Call the Worker Directly with grpcurl (Debugging)

Calling the worker directly isolates it from the Document Processing Service. Port-forward the gRPC port:

```bash
kubectl port-forward svc/firefoundry-core-doc-proc-pyworker -n ff-dev 50051:50051 &
```

The worker does not enable gRPC server reflection, so pass the proto file explicitly. Save the proto from the Reference page as `document_worker.proto` in the current directory.

### Health check

```bash
grpcurl -plaintext -import-path . -proto document_worker.proto \
  -d '{}' localhost:50051 document_worker.DocumentWorker/HealthCheck
```

```json
{
  "healthy": true,
  "version": "0.1.0",
  "supportedOperations": [
    "convert_colorspace",
    "extract_structured",
    "pdf_to_images",
    "upscale_image"
  ]
}
```

`supportedOperations` is the authoritative list for the running image. `extract_tables`, `ocr_local`, and `ocr_advanced` appear only in images built with those feature groups.

### Check a single operation

```bash
grpcurl -plaintext -import-path . -proto document_worker.proto \
  -d '{"operation": "ocr_local"}' \
  localhost:50051 document_worker.DocumentWorker/SupportsOperation
```

```json
{
  "message": "Operation 'ocr_local' is not supported"
}
```

(grpcurl omits fields with default values, so `"supported": false` is not printed.)

### Process a document

`document_data` is a `bytes` field, which grpcurl's JSON encoding represents as base64. Build the request with `jq`:

```bash
jq -n --arg d "$(base64 -w0 sample.pdf)" \
  '{document_data: $d, operation: "extract_structured", options: {pages: "1"}}' \
| grpcurl -plaintext -import-path . -proto document_worker.proto \
    -d @ localhost:50051 document_worker.DocumentWorker/ProcessDocument \
| tee response.json | jq '{success, format, metadata, processingTimeMs, errorMessage}'
```

```json
{
  "success": true,
  "format": "json",
  "metadata": {
    "pages_processed": "1",
    "total_tables": "0"
  },
  "processingTimeMs": 87,
  "errorMessage": null
}
```

Decode the output bytes to see the extraction result:

```bash
jq -r .outputData response.json | base64 -d | jq '.pages[0] | {page_number, text: .text[0:120], tables: (.tables | length)}'
```

On macOS use `base64 -i sample.pdf` instead of `base64 -w0 sample.pdf`, and `base64 -D` to decode.

### Reproduce an error

```bash
jq -n --arg d "$(base64 -w0 sample.pdf)" \
  '{document_data: $d, operation: "extract_structured", options: {pages: "99"}}' \
| grpcurl -plaintext -import-path . -proto document_worker.proto \
    -d @ localhost:50051 document_worker.DocumentWorker/ProcessDocument \
| jq '{success, errorMessage}'
```

```json
{
  "success": null,
  "errorMessage": "Processing failed: Invalid page number 99. Document has 1 pages."
}
```

The gRPC call succeeds; the failure is reported in the response body. (`success` is `false`, which grpcurl omits.)

## Step 6 (Optional): Upscale an Image with Lanczos

Lanczos upscaling runs entirely inside the worker and needs no API key:

```bash
jq -n --arg d "$(base64 -w0 sample.png)" \
  '{document_data: $d, operation: "upscale_image",
    options: {provider: "lanczos", scale_factor: "3", output_format: "png"}}' \
| grpcurl -plaintext -import-path . -proto document_worker.proto \
    -d @ localhost:50051 document_worker.DocumentWorker/ProcessDocument \
| jq -r .outputData | base64 -d | jq -r .image.data | base64 -d > upscaled.png
```

The output bytes are a JSON document whose `image.data` field holds the base64-encoded image — hence the double decode.

## Calling from TypeScript

The Document Processing Service uses the generated client package `@firebrandanalytics/doc-proc-pyworker-client` (published to GitHub Packages). If you have access to it, the same health check looks like this:

```typescript
import { DocumentProcessorClient } from '@firebrandanalytics/doc-proc-pyworker-client';

const client = new DocumentProcessorClient({ address: 'localhost:50051' });
const health = await client.healthCheck();
console.log(health.version, health.supportedOperations);

const result = await client.processDocument({
  documentData: pdfBuffer,
  operation: 'pdf_to_images',
  options: { pages: '1-2', dpi: '150', format: 'png' },
});
if (!result.success) throw new Error(result.errorMessage);
client.close();
```

## Next Steps

- [Reference](./reference.md) — Options and output schemas for every operation
- [Operations](./operations.md) — Building an OCR/table-enabled image, resources, and troubleshooting
- [Document Processing Service](../doc-proc-service/README.md) — The REST API that agents call
