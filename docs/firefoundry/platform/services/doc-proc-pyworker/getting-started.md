# Document Processing Python Worker: Getting Started

This guide turns on the worker-backed capabilities in a FireFoundry environment, checks which capabilities you have, and makes a first call through the Document Processing Service. You never call the worker itself.

The examples use a local environment created as described in [Minikube Bootstrap](../../../local-development/minikube-bootstrap.md): the `firefoundry-core` release in the `ff-dev` namespace. Adjust names for your environment.

## Prerequisites

- A FireFoundry environment with the [Document Processing Service](../doc-proc-service/README.md) enabled
- Permission to change the environment's `firefoundry-core` Helm values. If you don't have it, ask your environment administrator to do Step 1.
- `kubectl` access to the environment namespace (for the checks below)
- A small sample PDF

## Step 1: Enable the Worker

Two switches are needed: one deploys the worker, and one tells the Document Processing Service to use it. Add both to the environment's `firefoundry-core` values:

```yaml
doc-proc-pyworker:
  enabled: true

doc-proc-service:
  enabled: true
  pythonWorker:
    enabled: true
```

If the environment is a Flux `HelmRelease` (the default for environments created with `ff-cli env create`), edit its values:

```bash
kubectl edit helmrelease firefoundry-core -n ff-dev
```

After the change rolls out, restart the Document Processing Service so it picks up the new setting:

```bash
kubectl rollout restart deploy/firefoundry-core-doc-proc-service -n ff-dev
```

## Step 2: Confirm the Worker Is Running

```bash
kubectl get pods -n ff-dev | grep doc-proc-pyworker
```

The pod can take up to a minute to report `1/1 Running`.

## Step 3: Check Which Capabilities Your Environment Supports

The worker lists the capabilities it loaded when it starts:

```bash
kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev | grep -E "not available|Registered"
```

```
... CamelotBackend not available (camelot-py not installed)
... TesseractBackend not available (pytesseract not installed)
... EasyOCRBackend not available (easyocr not installed)
... Registered 4 backends
```

Map the output to capabilities like this:

| Log line | Capability that is **missing** |
|----------|--------------------------------|
| `CamelotBackend not available` | Advanced table extraction (`extract_tables`) |
| `TesseractBackend not available` | Local OCR (`ocr_local`) |
| `EasyOCRBackend not available` | Neural OCR (`ocr_advanced`) |

`Registered 4 backends` means you have only the Standard capabilities: PDF to images, structured extraction, upscaling, and colorspace conversion. An extended image registers up to 7.

Without cluster access, try the capability. A request for a missing capability fails with `No backend found for operation '<name>'`. To get a missing capability, ask your environment administrator for an extended worker image.

## Step 4: Make a First Call

Call a worker-backed endpoint on the Document Processing Service. In `firefoundry-core` the service listens on port 8081:

```bash
kubectl port-forward svc/firefoundry-core-doc-proc-service -n ff-dev 8081:8081 &

curl -s -X POST http://localhost:8081/api/pdf-to-images \
  -F "file=@sample.pdf" | head -c 400
```

A successful response contains the rendered page images. For the result shape, see [Reference](./reference.md#pdf-to-images-pdf_to_images).

The Document Processing Service also exposes these worker-backed endpoints:

- `POST /api/upscale-image`: multipart `file` holding an image
- `POST /api/convert-colorspace`: multipart `file` holding an image

From an agent bundle, call the same endpoints on the in-cluster service address instead of a port-forward.

## Step 5 (Optional): Confirm the Request Reached the Worker

```bash
kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev --tail 5
```

```
... Processing document: operation=pdf_to_images, size=58587 bytes, ...
... Processing completed successfully in 412ms: output_size=301877 bytes, format=json
```

If your request fails and nothing shows up here, the Document Processing Service isn't reaching the worker. See [Operations: Troubleshooting](./operations.md#troubleshooting).

## Next Steps

- [Concepts](./concepts.md): choose the right capability for your app
- [Reference](./reference.md): options and result shapes for each capability
- [Document Processing Service](../doc-proc-service/README.md): the full API your bundle calls
