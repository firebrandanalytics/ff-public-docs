# Document Processing — Operations

Deployment, Azure configuration, monitoring, and troubleshooting for the Document Processing Service.

## Deployment

### Docker

```bash
docker build -t doc-proc-service:local .
docker run -p 8080:8080 --env-file .env doc-proc-service:local
```

The Docker image includes:
- Node.js 20
- Chromium (for Puppeteer HTML-to-PDF)
- System dependencies for canvas and image processing

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
```

### Resource Recommendations

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

PDF processing and Puppeteer rendering can be memory-intensive. Monitor actual usage and increase limits for workloads with large documents.

### Database Setup

Create the required schema before starting the service:

```bash
psql -h $PG_SERVER -U $PG_USER -d $PG_DATABASE -f src/database/schema.sql
```

This creates:
- `document_processing` schema
- `request_log` table (audit trail)
- `cache` table (content-based caching)

## Azure Document Intelligence Setup

### Getting an API Key

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a resource → Search for "Document Intelligence"
3. Select a pricing tier (F0 free tier available for testing)
4. Copy the endpoint URL and API key

### Configuration

```bash
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-region.api.cognitive.microsoft.com/
AZURE_DOC_INTELLIGENCE_KEY=your-api-key
AZURE_DOC_INTELLIGENCE_MODEL=prebuilt-layout
```

Without these variables, the service runs with basic extraction only — OCR and layout analysis features are unavailable.

## Caching

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `CACHE_TTL_SECONDS` | `3600` | Time-to-live for cached results |

### Cache Key Structure

Cache keys are SHA256 hashes of: `operation_type + input_content_hash + processing_options`

This means:
- Same document, different operation = different cache entries
- Same document, same operation, different options = different cache entries
- Identical requests = cache hit

### Cache Management

The cache table grows over time. Consider periodic cleanup of expired entries:

```sql
DELETE FROM document_processing.cache
WHERE created_at < NOW() - INTERVAL '7 days';
```

## File Size Limits

| Setting | Default | Purpose |
|---------|---------|---------|
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload file size |
| Multer limit | 50MB | Enforced at middleware level |

For larger files, increase both `MAX_FILE_SIZE_MB` and the Kubernetes ingress annotation:

```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "100m"
```

## Monitoring

### Request Logging

All processing operations are logged to the `document_processing.request_log` table:

```sql
SELECT operation, format, backend_used, processing_time_ms, cached, success
FROM document_processing.request_log
ORDER BY created_at DESC
LIMIT 20;
```

### Key Metrics

| Metric | What to Watch |
|--------|---------------|
| Processing time | Increases may indicate Azure API latency or resource pressure |
| Cache hit rate | Query `request_log` for `cached=true` ratio |
| Error rate | Group by `success=false` to find failing operations |
| Azure API calls | Monitor Azure billing for Document Intelligence usage |
| File sizes | Track average upload sizes for capacity planning |

## Troubleshooting

### Common Issues

**OCR returns empty results:**
- Verify Azure credentials are configured
- Check `/ready` endpoint — it reports Azure connectivity status
- Confirm the file format is supported (PDF, PNG, JPG, TIFF, BMP)
- Check Azure Document Intelligence service health in Azure Portal

**HTML-to-PDF fails:**
- Verify Chromium is installed in the container
- Check available memory — Puppeteer requires significant resources
- Ensure the HTML is valid and self-contained (no external resource dependencies)

**Extraction returns garbled text:**
- The PDF may be a scan — use `/api/extract-general` for automatic OCR fallback
- Try `/api/extract-text-ocr` directly for known scanned documents
- Check the document encoding

**Large file processing timeouts:**
- Increase Kubernetes ingress timeout annotations
- Increase `MAX_FILE_SIZE_MB` if file is being rejected
- For very large PDFs, consider splitting before processing

**Cache not working:**
- Verify PostgreSQL connectivity and the `document_processing.cache` table exists
- Check `CACHE_TTL_SECONDS` is not set to 0
- Cache failures are silent — check application logs for cache-related errors
