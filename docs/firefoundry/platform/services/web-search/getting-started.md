# Web Search — Getting Started

This guide takes you from a first search to structured queries, pagination, and calling the service from an agent bundle.

## Prerequisites

- The Web Search Service enabled in your FireFoundry environment, with a search provider key configured (see [Operations](./operations.md#enabling-the-web-search-service))

Inside the cluster, the service is reachable at `http://firefoundry-core-websearch-service:8080`. To try it from your workstation, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-websearch-service -n <namespace> 8080:8080
```

The `curl` examples below use `http://localhost:8080`.

## Step 1: Check That the Service Is Ready

```bash
curl http://localhost:8080/ready
```

A ready response means the service can reach its search provider and its database. If it is not ready, see [Troubleshooting](./operations.md#troubleshooting).

## Step 2: Run a Simple Search

### GET

```bash
curl "http://localhost:8080/v1/search?q=kubernetes+best+practices&limit=5"
```

### POST

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "typescript best practices", "limit": 10}'
```

Response (abridged):

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
    "totalResults": 1000000
  },
  "pagination": {
    "offset": 0,
    "limit": 10,
    "hasMore": true
  }
}
```

## Step 3: Use a Structured Query

Restrict domains, require phrases, and filter by file type:

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

```bash
curl "http://localhost:8080/v1/search?q=latest+ai+news&freshness=day"
curl "http://localhost:8080/v1/search?q=kubernetes+release&freshness=week"
curl "http://localhost:8080/v1/search?q=typescript+updates&freshness=month"
```

## Step 5: Paginate

```bash
curl "http://localhost:8080/v1/search?q=react+hooks&limit=10&offset=0"
curl "http://localhost:8080/v1/search?q=react+hooks&limit=10&offset=10"
```

Keep paging while `pagination.hasMore` is `true`, up to whatever budget your app sets.

## Step 6: Add a Request ID

```bash
curl -H "X-Request-ID: agent-research-task-123" \
  "http://localhost:8080/v1/search?q=kubernetes+networking"
```

The ID comes back in `meta.requestId`.

## Calling the Service from an Agent Bundle

### With the client library

`@firebrandanalytics/web-search-client` wraps search and page fetching:

```typescript
import { WebSearchClient } from '@firebrandanalytics/web-search-client';

const client = WebSearchClient.create({
  baseUrl: 'http://firefoundry-core-websearch-service:8080',
});

// Search
const search = await client.search('kubernetes networking', {
  limit: 5,
  freshness: 'month',
});

// Read the top results as Markdown for a prompt
const pages = await client.fetchBatch(
  search.results.slice(0, 3).map(r => r.url),
  { contentMode: 'markdown', concurrency: 3 }
);

const context = pages.results
  .map(p => `Source: ${p.url}\n\n${p.content}`)
  .join('\n\n---\n\n');
```

### With plain HTTP

Structured queries go in the `POST /v1/search` body:

```typescript
const response = await fetch('http://firefoundry-core-websearch-service:8080/v1/search', {
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

const data = await response.json();
if (!data.success) {
  throw new Error(`Search failed: ${data.error.code} ${data.error.message}`);
}
const summary = data.results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
```

### From MCP-capable agents

Agents that use the [MCP Gateway](../mcp-gateway/README.md) get `websearch_search`, `websearch_fetch`, and `websearch_fetch_batch` as tools. See [MCP Gateway tools](../mcp-gateway/tools.md#web-search-adapter).

## Next Steps

- [Concepts](./concepts.md): query types, the response model, and design patterns
- [Reference](./reference.md): the full API specification
- [Operations](./operations.md): enabling the service and troubleshooting
