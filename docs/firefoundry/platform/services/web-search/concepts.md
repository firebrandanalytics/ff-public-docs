# Web Search — Concepts

This page explains the core concepts underlying the Web Search Service: query types, provider abstraction, structured queries, and the response model.

## Query Types

The service supports two query patterns:

### Simple String Queries

A plain text search string, like what you would type into a search engine:

```
"kubernetes deployment best practices"
```

Simple queries are sent via GET parameter or POST body and passed directly to the search provider.

### Structured Queries

A JSON object that composes complex search logic:

```json
{
  "terms": ["kubernetes", "deployment"],
  "exactPhrases": ["rolling update"],
  "anyOf": ["AWS", "GCP", "Azure"],
  "exclude": ["tutorial", "beginner"],
  "sites": {
    "include": ["kubernetes.io", "github.com"],
    "exclude": ["medium.com"]
  },
  "fileTypes": ["pdf"]
}
```

Structured queries are compiled into provider-specific query syntax. This abstraction allows the same query structure to work across different search providers.

### Structured Query Fields

| Field | Type | Purpose |
|-------|------|---------|
| `terms` | string[] | Required. Terms that must all appear (AND logic) |
| `exactPhrases` | string[] | Exact phrase matches (wrapped in quotes) |
| `anyOf` | string[] | Alternative terms (OR logic) |
| `exclude` | string[] | Terms to exclude from results |
| `sites.include` | string[] | Only include results from these domains |
| `sites.exclude` | string[] | Exclude results from these domains |
| `fileTypes` | string[] | Filter by file type (pdf, doc, xls, etc.) |
| `inTitle` | string[] | Terms that must appear in page title* |
| `inBody` | string[] | Terms that must appear in page body* |
| `rawQuery` | string | Raw suffix for provider-specific operators |

*Not all providers support `inTitle` and `inBody`. Bing degrades these to regular terms.

## Provider Abstraction

The service defines a `SearchProviderInterface` that any search provider must implement. This abstraction enables:

- **Testing**: Mock providers for unit and integration tests
- **Swappability**: Switch providers without changing client code
- **Future expansion**: Add Tavily, Brave, Google, or Serper providers

### Provider Capabilities Matrix

| Feature | Bing | Google* | Brave* |
|---------|------|---------|--------|
| exactPhrases | Yes | Yes | Yes |
| sites (include/exclude) | Yes | Yes | Yes |
| fileTypes | Yes | Yes | Yes |
| anyOf (OR) | Yes | Yes | Yes |
| exclude | Yes | Yes | Yes |
| inTitle | No | Yes | Yes |
| inBody | No | Yes | Yes |

*Future provider support planned.

## Response Model

Every search response follows a consistent structure:

### Result Objects

Each search result contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Result identifier (e.g., `result-0`) |
| `title` | string | Page title |
| `url` | string | Full URL |
| `displayUrl` | string | Shortened display URL |
| `snippet` | string | Text excerpt from the page |
| `datePublished` | string | Publication date (ISO 8601) |
| `siteName` | string | Website name |

### Metadata

Response metadata includes:

| Field | Description |
|-------|-------------|
| `requestId` | Unique request identifier for tracing |
| `processingTimeMs` | Server-side processing time |
| `timestamp` | Response timestamp |
| `provider` | Which search provider was used |
| `totalResults` | Estimated total matching results |

### Pagination

| Field | Description |
|-------|-------------|
| `offset` | Current offset in result set |
| `limit` | Results per page |
| `total` | Estimated total results |
| `hasMore` | Whether more results are available |

### Spelling Corrections

If the provider detects a likely typo, the response includes:

```json
{
  "spellingCorrection": {
    "originalQuery": "typescrpt",
    "correctedQuery": "typescript",
    "appliedCorrection": true
  }
}
```

### Related Searches

The provider may suggest related queries for expanding research:

```json
{
  "relatedSearches": ["typescript tutorial", "typescript vs javascript"]
}
```

## Request Logging

All search requests are logged to `websearch.search_logs` in PostgreSQL using a fire-and-forget pattern:

- Logging is asynchronous — it does not block search responses
- Logged data: request ID, query, parameters, provider, result count, response time, errors
- Useful for analytics, debugging, and usage monitoring

## Request Tracing

Include the `X-Request-ID` header to correlate search requests with upstream operations:

```bash
curl -H "X-Request-ID: my-trace-id" "http://localhost:8080/v1/search?q=test"
```

The request ID appears in response metadata and logs, enabling end-to-end request tracing.
