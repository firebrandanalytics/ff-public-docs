# Document Processing Python Worker: Operations

This page covers what an app team configures for the worker-backed capabilities, the limits to design around, and how to troubleshoot from the caller's side.

## Enabling and Configuring

The worker is **disabled by default**. These are the `firefoundry-core` values that app teams typically set:

```yaml
doc-proc-pyworker:
  enabled: true                 # deploy the worker

doc-proc-service:
  pythonWorker:
    enabled: true               # let the Document Processing Service use it
    timeoutMs: 30000            # per-request time limit for worker operations
```

After you change `doc-proc-service.pythonWorker`, restart the Document Processing Service. For step-by-step instructions, see [Getting Started](./getting-started.md#step-1-enable-the-worker).

### AI upscaling (optional)

To use `provider=stability`, give the worker a Stability AI key through the chart secret. The worker also needs outbound HTTPS access to `api.stability.ai`.

```yaml
doc-proc-pyworker:
  secret:
    enabled: true
    data:
      STABILITY_API_KEY: "<your-key>"
```

If you don't use Stability AI, you can make `provider=auto` resolve to local upscaling:

```yaml
doc-proc-pyworker:
  configMap:
    data:
      UPSCALE_DEFAULT_PROVIDER: "lanczos"
```

This setting doesn't change the per-request default of `provider=stability`. Callers should still pass `provider=lanczos` or `provider=auto`.

### Extended capabilities and print profiles

These items need changes that your **environment administrator** makes:

- **OCR and advanced table extraction** need an extended worker image. Some operations require one; ask your environment administrator.
- **Certified ICC print profiles** (FOGRA39, SWOP, GRACoL, Adobe RGB) must be installed into the worker. By default, only sRGB and a generic CMYK profile are available.

## Checking What Your Environment Supports

For the log-based check and the probe-by-request approach, see [Getting Started: Step 3](./getting-started.md#step-3-check-which-capabilities-your-environment-supports). If your app runs in several environments, such as dev, staging, and production, check each one. The capabilities can differ between them.

## Limits to Design Around

| Limit | Value | Design guidance |
|-------|-------|-----------------|
| Upload size | Document Processing Service's `MAX_FILE_SIZE_MB` (default 50 MB) | Split very large PDFs before sending them |
| Worker message size | 100 MB for the request and for the result | High-DPI images of many pages can go over this. Use `pages`, a lower `dpi`, or `format=jpeg`. |
| Time per request | `doc-proc-service.pythonWorker.timeoutMs` (default 30 s) | OCR at 300 DPI on long documents can take longer. Process in page batches, or raise the timeout. |
| Memory | Grows with pages × DPI for rendering operations | Batch pages instead of sending a whole large document at high DPI |
| Stability AI upscaling | 2x or 4x only; output ≤ 2048×2048 | Use `lanczos` for large outputs or other scale factors |
| Local OCR languages | English only on standard OCR images | Use neural OCR for other languages |
| Neural OCR settings | Fixed per worker replica by its first request | Use one consistent `language` set across your app |
| Language detection | Not available | Detect the language in your app |

The worker adds no authentication of its own. Your app uses the same access it already has to the Document Processing Service.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| `No backend found for operation 'extract_tables'` (or `ocr_local`, `ocr_advanced`) | Your environment runs the standard worker image | Ask your environment administrator for an extended worker image |
| Worker-backed endpoints fail and the worker log shows no requests | `doc-proc-service.pythonWorker.enabled` isn't `true`, or the service wasn't restarted | Set the value, then restart the Document Processing Service |
| Worker-backed endpoints fail right after you enable the worker | The worker pod is still starting | Wait about a minute, then check `kubectl get pods \| grep doc-proc-pyworker` |
| Timeouts on large PDFs or OCR | The request takes longer than `pythonWorker.timeoutMs` | Reduce `pages` or `dpi`, or raise the timeout |
| Failures on very large page-image requests | The result is over 100 MB | Request fewer pages, lower `dpi`, or use `jpeg` |
| `Stability AI API key is required` | Default `provider=stability` with no key configured | Pass `provider=lanczos`, or configure the key |
| `... would exceed maximum allowed (2048x2048)` | Stability AI output cap | Use `provider=lanczos` |
| `Profile 'X' not found` | The ICC profile isn't installed | Use an available profile, or ask your administrator to install it |
| Structured or table results show the wrong page numbers | These capabilities renumber selected pages from 1 | Map results back to your `pages` list |
| Neural OCR ignores a new `language` value | The replica already loaded a different language set | Use one consistent language set, or ask your administrator to restart the worker |
| Poor OCR on non-English scans | Local OCR has English data only | Use neural OCR (`ocr_advanced`) |

To see whether a request reached the worker and why it failed there, read the worker log:

```bash
kubectl logs deploy/firefoundry-core-doc-proc-pyworker -n ff-dev --tail 50
```

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Document Processing Service: Operations](../doc-proc-service/operations.md)
