# Web Search — Reference

Complete API reference for the Web Search Service, including endpoints, request/response schemas, error codes, and configuration variables.

## Search Endpoints

### GET /v1/search

Simple string query via URL parameters.

**Query Parameters:**

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `q` | string | | Yes | Search query (1–500 characters) |
| `limit` | number | `10` | No | Results per page (1–50) |
| `offset` | number | `0` | No | Pagination offset |
| `safeSearch` | string | `moderate` | No | `off`, `moderate`, `strict` |
| `market` | string | | No | Locale (e.g., `en-US`, `de-DE`) |
| `freshness` | string | | No | `day`, `week`, `month` |

```bash
curl "http://localhost:8080/v1/search?q=kubernetes+best+practices&limit=10"
```

### POST /v1/search

Simple or structured query via JSON body.

**Simple Query:**

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

**Structured Query:**

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

## Response Schema

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
    "provider": "bing",
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

### Error Response

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

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `BING_ERROR` | 502 | Bing API returned an error |
| `FETCH_ERROR` | 502 | Network error calling Bing API |
| `TIMEOUT` | 504 | Bing API request timed out |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## System Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /` | GET | Service info and available endpoints |
| `GET /health` | GET | Liveness probe (always healthy if running) |
| `GET /ready` | GET | Readiness probe (checks Bing API and database) |
| `GET /status` | GET | Service version, uptime, and environment |

## Request Headers

| Header | Purpose |
|--------|---------|
| `Content-Type` | Must be `application/json` for POST requests |
| `X-Request-ID` | Optional request correlation ID for tracing |

## Configuration Variables

### Required

| Variable | Purpose |
|----------|---------|
| `BING_API_KEY` | Bing Web Search API subscription key |
| `PG_DATABASE` | Database name for request logging |

Database connection variables (`PG_HOST`, `PG_PASSWORD`, etc.) are handled by `@firebrandanalytics/shared-utils` PostgresProvider.

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `BING_API_ENDPOINT` | `https://api.bing.microsoft.com/v7.0/search` | Bing API endpoint URL |
| `BING_TIMEOUT_MS` | `5000` | Request timeout (ms) |
| `SEARCH_DEFAULT_LIMIT` | `10` | Default results per page |
| `SEARCH_DEFAULT_SAFE_SEARCH` | `moderate` | Default safe search level |
| `PORT` | `8080` | Server port |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Logging level |
