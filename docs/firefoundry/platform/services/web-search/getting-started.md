# Web Search — Getting Started

This guide walks you through executing search queries, using structured queries, and integrating search into agent workflows.

## Prerequisites

- A running Web Search Service instance
- Bing Web Search API key (see [Operations](./operations.md) for setup)
- PostgreSQL with the `websearch` schema migrated

## Step 1: Verify the Service is Running

```bash
# Health check
curl http://localhost:8080/health
# Expected: healthy response

# Readiness check (verifies Bing API and database connectivity)
curl http://localhost:8080/ready
```

## Step 2: Simple Search

### GET Request

```bash
curl "http://localhost:8080/v1/search?q=kubernetes+best+practices&limit=5"
```

### POST Request

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "typescript best practices", "limit": 10}'
```

Response:

```json
{
  "success": true,
  "results": [
    {
      "id": "result-0",
      "title": "TypeScript Best Practices",
      "url": "https://example.com/typescript",
      "snippet": "Learn TypeScript best practices..."
    }
  ],
  "meta": {
    "processingTimeMs": 150,
    "provider": "bing",
    "totalResults": 1000000
  },
  "pagination": {
    "offset": 0,
    "limit": 10,
    "hasMore": true
  }
}
```

## Step 3: Structured Queries

Build complex searches with domain filtering, exact phrases, and exclusions:

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "structuredQuery": {
      "terms": ["machine learning", "deployment"],
      "exactPhrases": ["model serving"],
      "sites": {
        "include": ["arxiv.org", "github.com"],
        "exclude": ["medium.com"]
      },
      "fileTypes": ["pdf"]
    },
    "limit": 20
  }'
```

## Step 4: Filter by Freshness

Limit results to recent content:

```bash
# Results from the past day
curl "http://localhost:8080/v1/search?q=latest+ai+news&freshness=day"

# Results from the past week
curl "http://localhost:8080/v1/search?q=kubernetes+release&freshness=week"

# Results from the past month
curl "http://localhost:8080/v1/search?q=typescript+updates&freshness=month"
```

## Step 5: Pagination

Retrieve more results by adjusting `offset`:

```bash
# First page
curl "http://localhost:8080/v1/search?q=react+hooks&limit=10&offset=0"

# Second page
curl "http://localhost:8080/v1/search?q=react+hooks&limit=10&offset=10"

# Third page
curl "http://localhost:8080/v1/search?q=react+hooks&limit=10&offset=20"
```

Check `pagination.hasMore` in the response to know if more results are available.

## Step 6: Request Tracing

Include a request ID for end-to-end tracing:

```bash
curl -H "X-Request-ID: agent-research-task-123" \
  "http://localhost:8080/v1/search?q=kubernetes+networking"
```

The request ID appears in response metadata and database logs.

## Step 7: Integration with Agent Bundles

### Basic Search Integration

```typescript
async function searchAndSummarize(query: string): Promise<string> {
  const response = await fetch('http://websearch-service:8080/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 5 })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Search failed: ${data.error.message}`);
  }

  return data.results
    .map(r => `${r.title}: ${r.snippet}`)
    .join('\n\n');
}
```

### Structured Research Query

```typescript
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

## Next Steps

- Read [Concepts](./concepts.md) for query types, provider abstraction, and the response model
- See [Reference](./reference.md) for the complete API specification
- See [Operations](./operations.md) for deployment and Bing API setup
