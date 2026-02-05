# Web Search Service

## Overview

The Web Search Service is a FireFoundry microservice that provides a provider-agnostic web search API for AI agents. It currently integrates with Microsoft Bing Web Search API v7, with an architecture designed to support additional providers (Tavily, Brave, Google) in future releases.

## Purpose and Role in Platform

The Web Search Service enables FireFoundry agents to:
- **Search the Web**: Execute queries and retrieve relevant results in real-time
- **Access Current Information**: Supplement agent knowledge with up-to-date web data
- **Augment Context**: Provide search results for RAG (Retrieval-Augmented Generation) patterns
- **Structured Queries**: Build complex searches with exact phrases, domain filtering, and exclusions
- **Research Workflows**: Support multi-step research with pagination and related searches

## Key Features

- **Unified Search API**: Provider-agnostic endpoints supporting both GET and POST methods
- **Structured Queries**: JSON-based query format for complex searches (AND/OR terms, site filters, file types)
- **Bing Integration**: Microsoft Bing Web Search API v7 as the initial provider
- **Spelling Corrections**: Automatic query correction with original and corrected query in response
- **Related Searches**: Suggestions for related queries to expand research
- **Request Logging**: All searches logged to PostgreSQL for analytics and debugging
- **Health Checks**: Kubernetes-ready liveness and readiness probes

## API Reference

### Search Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/search?q={query}` | Simple string query via URL parameter |
| `POST` | `/v1/search` | Simple or structured query via JSON body |

### Request Tracing

Include the `X-Request-ID` header to trace requests through logs:

```bash
curl -H "X-Request-ID: my-trace-id" "http://localhost:8080/v1/search?q=test"
```

### GET /v1/search

```bash
curl "http://websearch-service:8080/v1/search?q=kubernetes+best+practices&limit=10"
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | required | Search query (1-500 characters) |
| `limit` | number | 10 | Results per page (1-50) |
| `offset` | number | 0 | Pagination offset |
| `safeSearch` | string | moderate | `off`, `moderate`, `strict` |
| `market` | string | - | Locale (e.g., `en-US`, `de-DE`) |
| `freshness` | string | - | `day`, `week`, `month` |

### POST /v1/search

Supports both simple string queries and structured queries.

**Simple Query:**
```bash
curl -X POST http://websearch-service:8080/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "typescript best practices", "limit": 10}'
```

**Structured Query:**
```bash
curl -X POST http://websearch-service:8080/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "structuredQuery": {
      "terms": ["kubernetes", "deployment"],
      "exactPhrases": ["rolling update"],
      "anyOf": ["AWS", "GCP", "Azure"],
      "exclude": ["tutorial", "beginner"],
      "sites": {
        "include": ["kubernetes.io", "github.com"],
        "exclude": ["medium.com"]
      },
      "fileTypes": ["pdf"]
    },
    "limit": 20
  }'
```

**Structured Query Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `terms` | string[] | **Required.** Terms that must appear (AND'd together) |
| `exactPhrases` | string[] | Exact phrases to match (wrapped in quotes) |
| `anyOf` | string[] | Alternative terms (OR'd together) |
| `exclude` | string[] | Terms to exclude from results |
| `sites.include` | string[] | Only include results from these domains |
| `sites.exclude` | string[] | Exclude results from these domains |
| `fileTypes` | string[] | File types to filter (pdf, doc, xls, etc.) |
| `inTitle` | string[] | Terms that must appear in page title* |
| `inBody` | string[] | Terms that must appear in page body* |
| `rawQuery` | string | Raw query suffix for provider-specific operators |

*Note: `inTitle` and `inBody` are not supported by Bing and degrade to regular terms.

### Response Format

**Success (200):**
```json
{
  "success": true,
  "results": [
    {
      "id": "result-0",
      "title": "TypeScript Best Practices",
      "url": "https://example.com/typescript",
      "displayUrl": "example.com/typescript",
      "snippet": "Learn TypeScript best practices...",
      "datePublished": "2026-01-10T00:00:00Z",
      "siteName": "Example"
    }
  ],
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
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

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "details": [
      { "field": "query", "message": "Query cannot be empty" }
    ]
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `BING_ERROR` | 502 | Bing API returned an error |
| `FETCH_ERROR` | 502 | Network error calling Bing API |
| `TIMEOUT` | 504 | Bing API request timed out |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Standard Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Service info and available endpoints |
| `GET /health` | Liveness probe (always returns healthy if running) |
| `GET /ready` | Readiness probe (checks Bing API and database connectivity) |
| `GET /status` | Service version, uptime, and environment |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ff-services-websearch                     │
│                                                              │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────┐  │
│  │RouteManager │───▶│ SearchProvider  │───▶│BingSearch   │  │
│  │ /v1/search  │    │  (orchestrator) │    │Provider     │  │
│  └─────────────┘    └────────┬────────┘    └─────────────┘  │
│                              │                               │
│                    ┌─────────▼─────────┐                    │
│                    │SearchLogRepository│                    │
│                    │ (fire-and-forget) │                    │
│                    └─────────┬─────────┘                    │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │     PostgreSQL      │
                    │ websearch.search_logs│
                    └─────────────────────┘
```

**Key Design Decisions:**

- **Provider Abstraction**: `SearchProviderInterface` enables testing and future provider additions
- **Fire-and-Forget Logging**: Database writes don't block search responses
- **Discriminated Union Responses**: `success: true|false` for type-safe client handling
- **Shared Infrastructure**: Uses `@firebrandanalytics/shared-utils` for PostgreSQL and logging

### Provider Capabilities Matrix

Different search providers support different query features:

| Feature | Bing | Google* | Brave* |
|---------|------|---------|--------|
| exactPhrases | Yes | Yes | Yes |
| sites (include/exclude) | Yes | Yes | Yes |
| fileTypes | Yes | Yes | Yes |
| anyOf (OR) | Yes | Yes | Yes |
| exclude | Yes | Yes | Yes |
| inTitle | No | Yes | Yes |
| inBody | No | Yes | Yes |

*Future provider support planned

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `BING_API_KEY` | Bing Web Search API subscription key |
| `PG_DATABASE` | Database name for logging |

Database connection (`PG_HOST`, `PG_PASSWORD`, etc.) is handled by `@firebrandanalytics/shared-utils` PostgresProvider.

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BING_API_ENDPOINT` | `https://api.bing.microsoft.com/v7.0/search` | Bing API endpoint |
| `BING_TIMEOUT_MS` | 5000 | Request timeout in milliseconds |
| `SEARCH_DEFAULT_LIMIT` | 10 | Default results per page |
| `SEARCH_DEFAULT_SAFE_SEARCH` | moderate | Default safe search level |
| `PORT` | 8080 | Server port |
| `NODE_ENV` | development | Environment (development/production/test) |
| `LOG_LEVEL` | info | Logging level (debug/info/warn/error) |

### Getting a Bing API Key

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a resource → Search for "Bing Search v7"
3. Create with pricing tier (F0 is free tier: 3 calls/second, 1K calls/month)
4. Copy the API key from Keys and Endpoint

## Database

### Schema

The service uses a dedicated schema for request logging:

```sql
-- Schema and table created by migration
websearch.search_logs
```

**Captured data:**
- Request ID, query, parameters
- Provider used, response status
- Result count, total results
- Response time, error details
- Timestamps

### Migration

```bash
psql -f migrations/001_create_search_logs.sql
```

Creates:
- `websearch` schema
- `websearch.search_logs` table
- Grants for `fireread` (SELECT) and `fireinsert` (SELECT, INSERT)

## Dependencies

### Runtime Dependencies
- **Express 5**: Web framework
- **@firebrandanalytics/shared-utils**: Logging, PostgresProvider
- **pg**: PostgreSQL client
- **zod**: Request validation
- **winston**: Structured logging

### External Dependencies
- **Bing Web Search API v7**: Search provider (requires API key)
- **PostgreSQL**: Request logging and analytics

## Deployment

### Docker

```bash
# Build image locally
./scripts/build.sh

# Run with environment file
docker run -p 8080:8080 --env-file .env ff-services-websearch:local
```

### Kubernetes

The service exposes standard probe endpoints:
- **Liveness**: `GET /health`
- **Readiness**: `GET /ready` (fails if Bing API or database unavailable)

### CI/CD

GitHub Actions workflow builds on push to:
- `main` - Production (semantic version + `latest` tag)
- `dev` - Development (version-dev.sha + `dev` tag)
- `feat/**`, `fix/**` - Branch builds

## Version and Maturity

- **Current Version**: 0.1.0
- **Status**: Beta - Functional with Bing provider
- **Node.js Version**: 20+ required
- **License**: MIT

### Development Roadmap

- ✅ Phase 1: Bing provider implementation (complete)
- ✅ Phase 1: Structured query support (complete)
- ✅ Phase 1: Request logging (complete)
- 📋 Phase 2: Additional providers (Tavily, Brave, Serper)
- 📋 Phase 2: Provider fallback with circuit breakers
- 📋 Phase 2: In-memory LRU caching
- 📋 Phase 3: Redis caching layer
- 📋 Phase 3: Multi-provider aggregation
- 📋 Phase 3: Analytics endpoints

## Usage with Agent Bundles

### From an Agent Bundle

```typescript
// Example: Using web search in an agent workflow
async function searchAndSummarize(query: string): Promise<string> {
  const response = await fetch('http://websearch-service:8080/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit: 5
    })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Search failed: ${data.error.message}`);
  }

  // Process results for agent context
  const context = data.results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');

  return context;
}
```

### Structured Query Example

```typescript
// Research a specific topic with domain restrictions
const response = await fetch('http://websearch-service:8080/v1/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    structuredQuery: {
      terms: ['machine learning', 'deployment'],
      exactPhrases: ['model serving'],
      sites: {
        include: ['arxiv.org', 'github.com', 'huggingface.co'],
        exclude: ['medium.com', 'towardsdatascience.com']
      },
      fileTypes: ['pdf']
    },
    limit: 20,
    freshness: 'month'
  })
});
```

## Repository

**Source Code**: [ff-services-websearch](https://github.com/firebrandanalytics/ff-services-websearch) (private)

## Related Documentation

- **[Context Service](./context-service.md)**: Store search results in working memory
- **[Platform Services Overview](./README.md)**: FireFoundry microservices architecture
- **[FF Broker](./ff-broker.md)**: AI model routing for processing search results
