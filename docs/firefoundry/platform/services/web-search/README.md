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
- **Fire-and-Forget Logging**: Database writes don't block search responses

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 REST API Layer                       │
│              RouteManager (/v1/search)               │
│         GET (simple query) | POST (structured)       │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Search Provider                         │
│          SearchProviderInterface                     │
│   BingSearchProvider | (Future: Tavily, Brave...)    │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│            Search Log Repository                     │
│          (Fire-and-Forget to PostgreSQL)              │
│              websearch.search_logs                    │
└─────────────────────────────────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)** — Query types, provider abstraction, structured queries, response model
- **[Getting Started](./getting-started.md)** — First search request, structured queries, pagination
- **[Reference](./reference.md)** — API endpoints, request/response schemas, error codes, configuration
- **[Operations](./operations.md)** — Deployment, Bing API setup, monitoring, troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Status**: Beta — Functional with Bing provider
- **Node.js Version**: 20+ required

## Repository

Source code: [ff-services-websearch](https://github.com/firebrandanalytics/ff-services-websearch) (private)

## Related

- [Platform Services Overview](../README.md)
- [Context Service](../context-service/README.md) — Store search results in working memory
- [FF Broker](../ff-broker/README.md) — AI model routing for processing search results
