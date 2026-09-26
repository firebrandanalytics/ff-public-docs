# Web Search — Concepts

This page explains the query types, the response model, and the patterns for building apps on the Web Search Service.

## Query Types

### Simple string queries

A plain search string, like what you would type into a search engine:

```
"kubernetes deployment best practices"
```

Send it as the `q` parameter on `GET /v1/search`, or as `query` in a `POST` body. This is the best fit when an LLM writes the query itself.

### Structured queries

A JSON object that describes the search logically:

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

The service turns this into the provider's query syntax, so your code doesn't need to know search-operator syntax and doesn't change if the provider does. Structured queries work well when your app, rather than the LLM, owns part of the query. For example, your app can always restrict to an allow-list of trusted domains while the LLM supplies the terms.

| Field | Type | Purpose |
|-------|------|---------|
| `terms` | string[] | Required. Terms that must all appear (AND) |
| `exactPhrases` | string[] | Exact phrase matches |
| `anyOf` | string[] | Alternative terms (OR) |
| `exclude` | string[] | Terms to exclude |
| `sites.include` | string[] | Only return results from these domains |
| `sites.exclude` | string[] | Never return results from these domains |
| `fileTypes` | string[] | Filter by file type (`pdf`, `doc`, `xls`, ...) |
| `inTitle` | string[] | Terms that must appear in the page title* |
| `inBody` | string[] | Terms that must appear in the page body* |
| `rawQuery` | string | Raw suffix appended for provider-specific operators |

\*Support for `inTitle` and `inBody` depends on the provider. Where they are not supported, they may be treated as ordinary terms. Don't rely on them for strict filtering. `rawQuery` is provider-specific by definition, so avoid it if you want provider independence.

## Response Model

Every successful search returns the same shape.

### Results

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Result identifier within this response (e.g. `result-0`) |
| `title` | string | Page title |
| `url` | string | Full URL |
| `displayUrl` | string | Shortened display URL |
| `snippet` | string | Text excerpt from the page |
| `datePublished` | string | Publication date (ISO 8601), when known |
| `siteName` | string | Website name, when known |

Treat `datePublished` and `siteName` as optional.

### Metadata

| Field | Description |
|-------|-------------|
| `requestId` | Request identifier; echoes `X-Request-ID` if you sent one |
| `processingTimeMs` | Server-side processing time |
| `timestamp` | Response timestamp |
| `provider` | Which search provider served the request |
| `totalResults` | Provider's estimate of total matches |

### Pagination

| Field | Description |
|-------|-------------|
| `offset` | Current offset |
| `limit` | Results per page |
| `total` | Estimated total results |
| `hasMore` | Whether more results are available |

`total` and `totalResults` are estimates. Use `hasMore` to decide whether to fetch another page.

### Spelling corrections and related searches

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

Related query suggestions, when available, come back in `relatedSearches`. Both fields are optional.

## Page Fetching

Search results only contain snippets. To read a page, fetch it through the service (with the client library or the MCP tools):

- **Content modes**: `markdown` (default, the best choice for LLM prompts), `text`, `html`, or `raw`
- **Render modes**: `static` for plain HTML, or `dynamic` to render JavaScript-heavy pages
- **Screenshots**: optional, and require `dynamic` rendering
- **Batch fetch**: up to 20 URLs in one call, with configurable concurrency. Per-URL failures are reported in `errors` without failing the whole batch.

See [Reference](./reference.md#page-fetching) for the options.

## Request Tracing

Send `X-Request-ID` to correlate a search with your own workflow, for example your bundle's entity or request ID:

```bash
curl -H "X-Request-ID: my-trace-id" "http://firefoundry-core-websearch-service:8080/v1/search?q=test"
```

The ID is returned in `meta.requestId` and recorded in the service's logs, which makes it easy to find a specific search when you debug.

## App Design Patterns

**Search, then read.** Search for candidates, pick the top few by snippet, fetch them as Markdown, and give the page text (not just snippets) to the LLM. Keep the URLs so the answer can cite its sources.

**Let the app own the guardrails.** Have the LLM produce `terms` and `exactPhrases`, while your code adds `sites.include` / `sites.exclude`, `safeSearch`, and `freshness` from app policy. The model then can't widen the search beyond what you allow.

**Budget searches per task.** Every search is an external call with latency and provider cost. Cap the number of searches and pages per user request, and cache results in working memory when the same research is likely to be reused.

**Handle "no results" deliberately.** Overly specific structured queries often return nothing. Retry once with fewer constraints (drop `exactPhrases` or `sites.include`) before telling the user nothing was found.

**Choose the right level.** For a single cited answer, the [Web Search Agent](../../system-agents/web-search.md) is less code. Use this service directly when you need custom ranking, domain policies, or search inside your own agent's reasoning loop.
