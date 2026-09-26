# Knowledge Service

## Overview

The Knowledge Service is the FireFoundry API your application uses to manage **knowledge bases**: collections of documents that the [RAG agent bundle](../../system-agents/rag-agent.md) ingests and then answers questions over. Through one REST API (or the `@firebrandanalytics/kb-client` TypeScript client) you create a knowledge base for your app, register documents into it, trigger ingestion, poll until each document is ready, and navigate an ingested document's sections and pages.

Question answering itself is done by the RAG agent bundle's `/api/rag-query` endpoint, which you call with the knowledge-base ids you created here.

## Purpose and Role in Platform

Use the Knowledge Service whenever your app needs to answer questions from, search, or browse a body of documents — policy manuals, product specs, contracts, financial filings, research papers. It gives you:

- One place to create and manage the knowledge bases your app owns
- Document registration with descriptive metadata and a reference to the stored file
- An ingestion trigger and a status you can poll (`registered → queued → complete | failed`)
- Filtered, paginated document listing (by MIME type, page count, tables/figures present, issuer, fiscal year, publication date, and more)
- Structural navigation of ingested documents: a capability summary, section subtrees, and page lookup by index or printed label (`iii`, `A-3`)
- Hard deletion of documents and whole knowledge bases, including everything ingested from them

Responsibilities are split across the platform like this:

| What your app needs | Where it comes from |
|---|---|
| Create KBs, register documents, trigger ingestion, check status, browse structure | **Knowledge Service** |
| Ask questions / retrieve cited context over one or more KBs | [RAG agent bundle](../../system-agents/rag-agent.md) `POST /api/rag-query` |
| Store the raw file before registering it | Working memory via the [Context Service](../context-service/README.md) |
| Text, layout, table, and figure extraction during ingestion | [Document Processing Service](../doc-proc-service/README.md) (used by the RAG agent bundle) |

## Key Features

- **Knowledge-base CRUD** — create, list, get, rename, and delete knowledge bases
- **Document registration** — title, MIME type, authors, source URI, page count, publication date, plus optional financial-filing fields (`issuer`, `fiscal_year`, `fiscal_period`, `document_type`) that are filterable immediately
- **Ingestion with pollable status** — one call starts ingestion; poll the document until it is `complete` or `failed`, and re-trigger failed documents
- **Filtered listing** — server-side filters with `page`/`size` pagination
- **Structural navigation** — per-document capability summary, section subtrees, and page lookup by id, 0-based physical index, or printed label, with explicit disambiguation when a reference is ambiguous
- **Cascade delete** — deleting a document or KB removes everything ingested from it, so it no longer appears in queries
- **OpenAPI contract** — served at `GET /openapi.json`; the TypeScript client is generated from it
- **RFC 7807 errors** with stable `code` values (`kb_not_found`, `ingestion_in_flight`, `page_not_found`, …)

## Architecture Overview

```
                +--------------------------------------------+
                |   Your application / agent bundle / GUI    |
                +---+----------------+-------------------+---+
                    |                |                   |
       1. store file|  2. create KB, register doc       | 5. ask questions
                    |  3. trigger ingestion             |    (kbIds)
                    |  4. poll status, browse structure |
                    v                v                   v
          +-----------------+  +-------------------+  +-------------------+
          | Context Service |  | Knowledge Service |->| RAG agent bundle  |
          | (working memory)|  | KB catalog,       |<-| ingest + query    |
          +--------+--------+  | status, navigation|  +---------+---------+
                   ^           +---------+---------+            |
                   |                     |                      |
                   +------ file read by the RAG agent bundle ---+
                                         |                      |
                                         v                      v
                               +-----------------------------------------+
                               | Entity graph: documents, sections,      |
                               | pages, chunks, tables, figures          |
                               +-----------------------------------------+
```

Your app talks to two endpoints: the Knowledge Service for managing KBs and documents, and the RAG agent bundle for questions. The Knowledge Service forwards ingestion to the RAG agent bundle and records the result on the document when the bundle reports back.

## Documentation

- **[Concepts](./concepts.md)** — Knowledge bases, documents, the ingestion lifecycle, structural navigation, deletion, and app design patterns
- **[Getting Started](./getting-started.md)** — Create a KB, register and ingest a document, wait for completion, navigate it, query it, and do the same from a bundle
- **[Reference](./reference.md)** — Every endpoint with request/response shapes and error codes
- **[Operations](./operations.md)** — Enabling the service in your environment, verifying it from a bundle, limits, and caller-side troubleshooting

## Version and Maturity

- **Current Version**: 0.2.0
- **Maturity**: Early access. The service is an opt-in component of `firefoundry-core` (disabled by default) and is enabled together with the RAG agent bundle. The API is pre-1.0 and may change. It has no in-service authentication and is reached from inside the cluster or through the platform gateway.

## Repository

Source code: [ff-services-knowledge](https://github.com/firebrandanalytics/ff-services-knowledge) (private)

## Related

- [Platform Services Overview](../README.md)
- [RAG Agent Bundle](../../system-agents/rag-agent.md) — Ingestion pipeline and the `/api/rag-query` endpoint
- [Context Service](../context-service/README.md) and the [Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md) — Storing source files before registration
- [Entity Service](../entity-service/README.md) — Where ingested knowledge-base content lives
- [Document Processing Service](../doc-proc-service/README.md)
- [Platform Architecture](../../architecture.md)
