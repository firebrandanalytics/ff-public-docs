# Web Search — Reference

The Web Search Service API contract: endpoints, request and response schemas, page-fetching options, and error codes.

In-cluster base URL: `http://firefoundry-core-websearch-service:8080`.

## Search Endpoints

### GET /v1/search

Simple string query in URL parameters.

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `q` | string | | Yes | Search query (1–500 characters) |
| `limit` | number | `10`* | No | Results per page (1–50) |
| `offset` | number | `0` | No | Pagination offset |
| `safeSearch` | string | `moderate`* | No | `off`, `moderate`, `strict` |
| `market` | string | | No | Locale (e.g. `en-US`, `de-DE`) |
| `freshness` | string | | No | `day`, `week`, `month` |

\*Environment default; see [Operations](./operations.md#settings-you-may-change).

```bash
curl "http://firefoundry-core-websearch-service:8080/v1/search?q=kubernetes+best+practices&limit=10"
```

### POST /v1/search

Simple or structured query in a JSON body. Send `Content-Type: application/json`.

**Simple query:**

```json
{
  "query": "typescript best practices",
  "limit": 10,
  "offset": 0,
  "safeSearch": "moderate",
  "market": "en-US",
  "freshness": "week"
}
```

**Structured query** (use `structuredQuery` instead of `query`):

```json
{
  "structuredQuery": {
    "terms": ["kubernetes", "deployment"],
    "exactPhrases": ["rolling update"],
    "anyOf": ["AWS", "GCP", "Azure"],
    "exclude": ["tutorial", "beginner"],
    "sites": {
      "include": ["kubernetes.io"],
      "exclude": ["medium.com"]
    },
    "fileTypes": ["pdf"],
    "inTitle": [],
    "inBody": [],
    "rawQuery": ""
  },
  "limit": 20,
  "offset": 0,
  "safeSearch": "moderate",
  "freshness": "month"
}
```

See [Concepts](./concepts.md#structured-queries) for what each structured field does.

## Search Response

### Success (200)

```json
{
  "success": true,
  "results": [
    {
      "id": "result-0",
      "title": "Page Title",
      "url": "https://example.com/page",
      "displayUrl": "example.com/page",
      "snippet": "Text excerpt from page...",
      "datePublished": "2026-01-10T00:00:00Z",
      "siteName": "Example"
    }
  ],
  "meta": {
    "requestId": "uuid",
    "processingTimeMs": 150,
    "timestamp": "2026-01-14T12:00:00.000Z",
    "provider": "<provider name>",
    "totalResults": 1000000
  },
  "pagination": {
    "offset": 0,
    "limit": 10,
    "total": 1000000,
    "hasMore": true
  },
  "spellingCorrection": {
    "originalQuery": "typescrpt",
    "correctedQuery": "typescript",
    "appliedCorrection": true
  },
  "relatedSearches": ["typescript tutorial", "typescript vs javascript"]
}
```

`spellingCorrection` and `relatedSearches` are present only when the provider returns them.

### Error

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "requestId": "uuid",
    "details": [
      { "field": "query", "message": "Query cannot be empty" }
    ]
  }
}
```

### Error codes

| Code | HTTP Status | Meaning for the caller | Retry? |
|------|-------------|------------------------|--------|
| `VALIDATION_ERROR` | 400 | Invalid parameters; see `details` | No; fix the request |
| `RATE_LIMITED` | 429 | Too many requests | Yes, with backoff |
| provider error code | 502 | The search provider returned an error | Yes, a limited number of times |
| `FETCH_ERROR` | 502 | The service could not reach the search provider | Yes, a limited number of times |
| `TIMEOUT` | 504 | The search provider did not respond in time | Yes, a limited number of times |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Once at most |

## Page Fetching

Page fetching is available through the client library (`fetch`, `fetchBatch`) and the MCP tools (`websearch_fetch`, `websearch_fetch_batch`).

| Option (client / MCP) | Values | Description |
|-----------------------|--------|-------------|
| `contentMode` / `content_mode` | `markdown` (default), `text`, `html`, `raw` | How page content is extracted |
| `renderMode` / `render_mode` | `static`, `dynamic` | `dynamic` renders JavaScript before extraction |
| `timeoutMs` / `timeout_ms` | 1000–60000 | Per-fetch timeout in ms |
| `extractMetadata` / `extract_metadata` | boolean | Include page metadata (single fetch) |
| `includeScreenshot` / `include_screenshot` | boolean | Capture a screenshot; requires `dynamic` |
| `viewport` | `{ width: 320–3840, height: 240–2160 }` | Viewport size for screenshots |
| `concurrency` | 1–10 | Parallel fetches (batch only) |

A batch accepts 1–20 URLs.

Each fetch result includes `url`, `finalUrl` (after redirects), `statusCode`, `contentType`, `content`, `metadata`, `screenshot`, `fetchTimeMs`, and `contentLength`. A batch result also includes `errors` for URLs that failed, and `meta`.

## Client Library

`@firebrandanalytics/web-search-client`:

| Method | Description |
|--------|-------------|
| `WebSearchClient.create({ baseUrl, apiKey? })` | Create a client |
| `search(query, { limit, offset, safeSearch, market, freshness })` | Simple string search. Returns `{ results, pagination, meta, spellingCorrection, relatedSearches }`. |
| `fetch(url, options)` | Fetch one page. Returns `{ result }` with the fields above. |
| `fetchBatch(urls, options)` | Fetch up to 20 pages. Returns `{ results, errors, meta }`. |

For structured queries, call `POST /v1/search` directly.

## System Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Service info and available endpoints |
| `GET /health` | Liveness: the service is running |
| `GET /ready` | Readiness: the service can reach its search provider and database |
| `GET /status` | Service version, uptime, and environment |

## Request Headers

| Header | Purpose |
|--------|---------|
| `Content-Type` | `application/json` for POST requests |
| `X-Request-ID` | Optional correlation ID, returned in `meta.requestId` |
