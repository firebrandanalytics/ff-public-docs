# Web Search Service

## Overview

The Web Search Service gives your agent bundles one web search API that does not depend on a particular provider. Your bundle sends a query and gets back a consistent list of results (title, URL, snippet, date), with pagination, spelling corrections, and related searches. The service can also fetch pages and extract their content, so an agent can read the pages it finds. The current search provider is the Brave Search API.

## Purpose and Role in Platform

Use the Web Search Service when your app needs current information from the web and you want to control the research loop yourself:

- **Grounding answers**: search, then put the top snippets or fetched page text into a prompt, with URLs for citations.
- **Targeted research**: restrict to specific domains or file types, require exact phrases, and exclude noise.
- **Freshness-sensitive features**: news digests, release tracking, and monitoring, using the `freshness` filter.
- **Tool use**: expose search and fetch as tools that an agent calls when it decides it needs them.

If you just want a researched, cited answer to a question and don't need to control each search, use the [Web Search Agent](../../system-agents/web-search.md) instead. It runs the whole search, evaluate, and refine loop for you.

## Key Features

- **Simple and structured queries**: a plain query string, or a JSON query with AND/OR terms, exact phrases, exclusions, site filters, and file types
- **Consistent response shape**: the same result, pagination, and metadata fields regardless of provider
- **Filters**: freshness (`day`, `week`, `month`), SafeSearch level, and market/locale
- **Pagination**: `limit`/`offset` with a `hasMore` flag
- **Spelling corrections and related searches** when the provider returns them
- **Page fetching**: fetch one URL or up to 20 at once as Markdown, text, HTML, or raw content, with optional JavaScript rendering and screenshots
- **Request tracing**: send `X-Request-ID` to correlate searches with your own workflow

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Your agent bundle / application             │
└──────────────────┬───────────────────────────┘
                   │  REST (/v1/search) or client library,
                   │  or websearch_* tools via MCP Gateway
┌──────────────────▼───────────────────────────┐
│             Web Search Service               │
│  query building, normalized results,         │
│  page fetching, request logging              │
└──────────────────┬───────────────────────────┘
                   │  outbound HTTPS
┌──────────────────▼───────────────────────────┐
│  Search provider (Brave Search API)          │
│  and the web pages being fetched             │
└──────────────────────────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)**: query types, the response model, and app design patterns
- **[Getting Started](./getting-started.md)**: first search, structured queries, pagination, and calling from a bundle
- **[Reference](./reference.md)**: endpoints, request and response schemas, and error codes
- **[Operations](./operations.md)**: enabling the service, settings, limits, and troubleshooting

## Version

- **Current Version**: 0.2.4

## Repository

Source code: [ff-services-websearch](https://github.com/firebrandanalytics/ff-services-websearch) (private)

## Related

- [Platform Services Overview](../README.md)
- [Web Search Agent](../../system-agents/web-search.md): iterative, LLM-driven research with a cited summary
- [MCP Gateway tools](../mcp-gateway/tools.md#web-search-adapter): `websearch_search`, `websearch_fetch`, `websearch_fetch_batch`
- [Context Service](../context-service/README.md): store search results in working memory
- [FF Broker](../ff-broker/README.md): AI model routing for processing search results
