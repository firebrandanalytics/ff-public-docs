# Document Processing Python Worker — Operations

Deployment, configuration, health checks, scaling, security, monitoring, and troubleshooting for the Python worker.

## Deployment

### Helm Chart

The worker is deployed by the `doc-proc-pyworker` chart, included as a dependency of the `firefoundry-core` umbrella chart and **disabled by default**:

| Setting | Default | Notes |
|---------|---------|-------|
| `doc-proc-pyworker.enabled` | `false` | Deploys the worker |
| `doc-proc-pyworker.image.tag` | `0.1.0` | Worker image version |
| `doc-proc-pyworker.replicaCount` | `1` | Ignored when autoscaling is enabled |
| `doc-proc-pyworker.service.grpc.port` | `50051` | ClusterIP gRPC port (named `grpc`) |
| `doc-proc-pyworker.service.http.enabled` | `false` | HTTP port 8080 is not exposed by default |
| `doc-proc-pyworker.configMap.data` | see below | Rendered into container env vars |
| `doc-proc-pyworker.secret.enabled` | `false` | Enable to inject `STABILITY_API_KEY` |
| `doc-proc-pyworker.autoscaling.enabled` | `false` | HPA on CPU (see [Scaling](#scaling)) |

The Document Processing Service must also be told to use the worker:

```yaml
doc-proc-pyworker:
  enabled: true

doc-proc-service:
  enabled: true
  pythonWorker:
    enabled: true
    url: ""               # default: <release>-doc-proc-pyworker:50051
    timeoutMs: 30000      # per-request gRPC deadline
    connectTimeoutMs: 5000
```

The Kubernetes Service is named `<release>-doc-proc-pyworker` (for example `firefoundry-core-doc-proc-pyworker`) and is reachable in-cluster at `<release>-doc-proc-pyworker.<namespace>.svc.cluster.local:50051`. It carries the label `firefoundry.ai/service-type: doc-proc-pyworker`. Ingress is disabled and the service is not marked for external access.

### Default ConfigMap

```yaml
configMap:
  enabled: true
  data:
    GRPC_PORT: "50051"
    HTTP_PORT: "8080"
    LOG_LEVEL: "info"
    MAX_WORKERS: "4"
    REQUEST_TIMEOUT_S: "120"
```

Only `GRPC_PORT` and `HTTP_PORT` are read by the current worker. `LOG_LEVEL`, `MAX_WORKERS`, and `REQUEST_TIMEOUT_S` are rendered by the chart but have **no effect** in version 0.1.0 (the log level is fixed at `INFO` and the gRPC thread pool at 10). Add any variable from the [Reference](./reference.md#environment-variables) — for example `UPSCALE_DEFAULT_PROVIDER` or `ICC_PROFILES_DIR` — to `configMap.data`.

### Image Variants

The container image (`python:3.11-slim` base, runs `python -m src.server`) is built with optional feature groups controlled by Docker build arguments:

```bash
docker build .                                             # slim: core operations only
docker build --build-arg INSTALL_OCR=true .                # + Tesseract (ocr_local)
docker build --build-arg INSTALL_TABLES=true .             # + Camelot (extract_tables)
docker build --build-arg INSTALL_EASYOCR=true .            # + EasyOCR/PyTorch (ocr_advanced)
docker build --build-arg INSTALL_OCR=true \
             --build-arg INSTALL_TABLES=true \
             --build-arg INSTALL_EASYOCR=true .            # full
```

The image published by the project's CI is the **slim** build. If you need OCR or Camelot table extraction from the worker, build an image with the required groups, push it to a registry your cluster can pull from, and override `doc-proc-pyworker.image.repository` / `image.tag`. EasyOCR pulls in PyTorch and substantially increases image size and memory use.

Verify what a running image supports with `HealthCheck` (see [Getting Started](./getting-started.md#health-check)).

### Local (without Kubernetes)

```bash
docker build -t doc-proc-pyworker:local .
docker run --rm -p 50051:50051 -p 8080:8080 doc-proc-pyworker:local
```

The worker can also be run from a source checkout with Python 3.11 and Poppler installed: generate stubs from `proto/document_worker.proto` into `src/`, then `PYTHONPATH=src python -m src.server`.

## Configuration

### Stability AI upscaling

`upscale_image` defaults to `provider=stability`. To enable it, supply a key through the chart secret:

```yaml
doc-proc-pyworker:
  secret:
    enabled: true
    type: Opaque
    data:
      STABILITY_API_KEY: "<your-key>"
```

The worker must be able to reach `https://api.stability.ai` over outbound HTTPS. If you do not use Stability AI, have callers pass `provider=lanczos`, and set `UPSCALE_DEFAULT_PROVIDER: "lanczos"` in `configMap.data` so `provider=auto` resolves locally.

### ICC profiles

The image contains `profiles/GenericCMYK.icc` (used for the default `FOGRA39` alias) and a built-in sRGB profile. To use certified print profiles (FOGRA39, SWOP, GRACoL, Adobe RGB), mount them and point `ICC_PROFILES_DIR` at the mount. The deployment template accepts `volumes` and `volumeMounts`:

```yaml
doc-proc-pyworker:
  configMap:
    data:
      ICC_PROFILES_DIR: "/profiles"
      DEFAULT_CMYK_PROFILE: "FOGRA39"
  volumes:
    - name: icc-profiles
      configMap:
        name: icc-profiles        # created separately from your .icc files
  volumeMounts:
    - name: icc-profiles
      mountPath: /profiles
      readOnly: true
```

Profiles are scanned once at startup; restart the pods after changing them.

## Health Checks

The chart uses **TCP socket probes on the gRPC port**, because the published 0.1.0 image is treated as gRPC-only:

```yaml
livenessProbe:
  tcpSocket:
    port: grpc
  initialDelaySeconds: 60
  periodSeconds: 15
  timeoutSeconds: 10
  failureThreshold: 3

readinessProbe:
  tcpSocket:
    port: grpc
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

A TCP probe confirms only that the port is open. For a functional check, call `HealthCheck` over gRPC (returns `healthy`, `version`, and `supported_operations`):

```bash
grpcurl -plaintext -import-path . -proto document_worker.proto \
  -d '{}' <release>-doc-proc-pyworker:50051 document_worker.DocumentWorker/HealthCheck
```

The worker source also starts a FastAPI server with `GET /health` on `HTTP_PORT`. With an image that includes it, you can set `service.http.enabled: true` and switch the probes to `httpGet` on `/health`. The Dockerfile additionally defines a Docker `HEALTHCHECK` that calls the gRPC `HealthCheck` RPC (used by Docker, ignored by Kubernetes).

## Scaling

- The worker is **stateless**; any replica can serve any request. Scale horizontally.
- Each pod handles up to **10 concurrent RPCs** (fixed thread pool). OCR and table extraction are CPU-bound, so throughput per pod is ultimately bounded by its CPU limit.
- Default resources are sized for memory-hungry OCR/Camelot workloads:

  ```yaml
  resources:
    requests:
      memory: "1Gi"
      cpu: "500m"
    limits:
      memory: "4Gi"
      cpu: "2000m"
  ```

- Memory grows with page count × DPI for rasterizing operations (`pdf_to_images`, `ocr_*`), since all selected pages are rendered in memory. Use the `pages` option and moderate `dpi` for large documents.
- Enable the HPA for bursty workloads. `minReplicas` acts as a warm pool floor and `maxReplicas` as the burst ceiling:

  ```yaml
  doc-proc-pyworker:
    autoscaling:
      enabled: true
      minReplicas: 1
      maxReplicas: 5
      targetCPUUtilizationPercentage: 70
  ```

- gRPC uses long-lived HTTP/2 connections; with a plain ClusterIP Service, a single client connection may stay pinned to one pod. Expect uneven spreading across replicas unless the caller reconnects or balances client-side.

## Security

- **Internal only.** The service is ClusterIP with ingress disabled and external access off. Do not expose it outside the cluster.
- **No authentication or TLS.** The gRPC server listens in plaintext and trusts every caller. Rely on namespace isolation and, where available, Kubernetes NetworkPolicies that allow only the Document Processing Service to reach port 50051.
- **Untrusted input.** The worker parses arbitrary PDFs and images with native libraries (Poppler, Ghostscript, Tesseract). Keep resource limits in place and keep images current.
- **Secrets.** Provide `STABILITY_API_KEY` only through the chart secret or an external secret; never in `configMap.data`.
- **Egress.** Only `provider=stability` makes outbound calls (to Stability AI); all other operations run entirely in-process.
- **Temporary files.** Camelot and EasyOCR write short-lived temp files to the container's temp directory; they are deleted after each request.

## Monitoring

- **Logs** (stdout, plain text): each request logs `Processing document: operation=..., size=... bytes, options=...`, the backend chosen, and either `Processing completed successfully in <N>ms: output_size=..., format=...` or `Processing failed: ...` with a stack trace. Startup logs list which optional backends were loaded.

  ```bash
  kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev -f
  ```

- **Timing**: `processing_time_ms` is returned on every response, including failures.
- **Metrics**: the worker does not expose Prometheus metrics in 0.1.0. Use pod CPU/memory metrics and the Document Processing Service's own request logging.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| `No backend found for operation 'extract_tables'` (or `ocr_local`, `ocr_advanced`) | Slim image without that feature group | Deploy an image built with `INSTALL_TABLES` / `INSTALL_OCR` / `INSTALL_EASYOCR`; confirm with `HealthCheck` |
| `No backend found for operation 'detect_language'` | Operation is not implemented | Detect language in the caller |
| Document Processing worker endpoints fail; `PYTHON_WORKER_URL` missing on doc-proc-service | `doc-proc-service.pythonWorker.enabled` not set | Set it to `true` and restart the Document Processing Service |
| gRPC `UNAVAILABLE` from the Document Processing Service | Worker disabled, pod not ready, or wrong URL | Check `doc-proc-pyworker.enabled`, pod status, and that `PYTHON_WORKER_URL` matches the Service name and port 50051 |
| gRPC `DEADLINE_EXCEEDED` on large PDFs / OCR | Processing exceeds `pythonWorker.timeoutMs` (30 s default) | Raise `doc-proc-service.pythonWorker.timeoutMs`, reduce `pages` or `dpi`, or scale the worker |
| gRPC `RESOURCE_EXHAUSTED` | Request or response larger than 100 MB (e.g. many high-DPI page images) | Split the document with `pages`; lower `dpi` or use `jpeg` |
| Pod `OOMKilled` | Rasterizing many pages at high DPI, or EasyOCR model loading | Raise the memory limit; limit pages per request |
| Pod not ready for ~30–60 s after start | Probe initial delays (30 s readiness, 60 s liveness) | Expected; keep the delays generous for full images, which load heavier libraries at startup |
| `Stability AI API key is required` | Default `provider=stability` with no key | Pass `provider=lanczos` or configure `STABILITY_API_KEY` |
| `Output dimensions (...) would exceed maximum allowed (2048x2048)` | Stability AI output cap | Use `provider=lanczos` |
| `Profile 'X' not found. Available profiles: [...]` | Requested CMYK profile file not present | Mount the `.icc` file and set `ICC_PROFILES_DIR` |
| `Invalid page number N. Document has M pages.` | `pages` out of range | Correct the page range |
| `ocr_advanced` ignores a new `language` value | Reader is cached from the first request on that replica | Use a consistent language set per deployment, or restart the pod |
| OCR returns poor text for non-English documents | Only English Tesseract data is installed in the standard OCR build | Build an image with additional `tesseract-ocr-<lang>` packages, or use `ocr_advanced` |

## Related

- [Reference](./reference.md) — Environment variables and operation options
- [Document Processing — Operations](../doc-proc-service/operations.md)
- [Platform Operations](../../operations.md)
