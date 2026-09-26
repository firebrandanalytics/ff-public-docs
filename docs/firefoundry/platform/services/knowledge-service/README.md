# Knowledge Service

## Overview

The Knowledge Service is the FireFoundry platform service that owns the CRUD lifecycle of knowledge bases and the documents registered into them. It is the single API surface application developers use to create knowledge bases, register documents, track ingestion status, and trigger ingestion. The service itself is intentionally thin: it persists metadata in the entity graph and delegates the actual ingestion and query work to the [RAG agent bundle](../../system-agents/rag-agent.md).

Since version 0.2.0 it also exposes read-only structural views over ingested documents — a per-document capability summary, section subtrees, and page lookup by id, physical index, or printed page label — so agents can navigate a document's structure before (or instead of) running a semantic query.

## Purpose and Role in Platform

The Knowledge Service is the system-of-record for "what knowledge bases exist", "what documents are registered in each one", and "what's the current ingestion status of each document". Application developers use it to:

- Create and manage knowledge bases for their applications
- Register documents (with their metadata and a reference to a stored file) into a knowledge base
- Trigger ingestion of a registered document
- Track the lifecycle of each document from registration through ingestion completion
- List (with metadata filters), retrieve, update, and delete knowledge bases and documents
- Inspect what an ingested document offers — page, section, chunk, table, and figure counts — and fetch individual sections and pages

The service deliberately stops there. Chunking, embedding, vector search, graph traversal, text extraction, and question answering are handled by other parts of the platform. The Knowledge Service exposes a clean CRUD surface in front of those capabilities so that callers have one place to manage knowledge-base state, regardless of how ingestion or query is implemented underneath.

| Responsibility | Owner |
|---|---|
| Knowledge-base and document catalog, ingestion status | **Knowledge Service** |
| Text extraction (PDF to text, layout, OCR) | [Document Processing Service](../doc-proc-service/README.md) |
| Chunking, entity-subgraph construction, summaries | [RAG agent bundle](../../system-agents/rag-agent.md) |
| Embedding generation | [FF Broker](../ff-broker/README.md) |
| Durable storage, vector similarity search | [Entity Service](../entity-service/README.md) |
| Question answering over a knowledge base | [RAG agent bundle](../../system-agents/rag-agent.md) (`/api/rag-query`) |
| Storing the raw uploaded file | Working memory / blob storage — the Knowledge Service only keeps the `blobPath` reference |

## Key Features

- **Knowledge base CRUD**: Create, list, get, update, and delete knowledge bases through a single REST API
- **Document registration and metadata**: Register documents into a knowledge base with structured metadata (title, MIME type, source URI, author names, page count, file size, publication date) and a reference to the stored blob; optional financial-filing fields (issuer, fiscal year, fiscal period, document type) are stored at registration and forwarded to ingestion
- **Document lifecycle tracking**: Each document moves through a well-defined status flow that callers can poll: `registered -> queued -> in-progress -> complete | failed`
- **Ingestion trigger**: A single endpoint kicks off ingestion for a registered document; the service forwards the request to the RAG agent bundle and marks the document `queued`
- **Ingestion callback handling**: A dedicated callback endpoint receives completion or failure notifications from the RAG agent bundle and updates document status, entity counts, and error text
- **Filtered document listing**: Server-side filters on issuer, language, MIME type, ingestion version, tables/figures present, page-count range, fiscal year/period, document type, and publication-date range, with pagination
- **Structural navigation**: Capability summary per document, section subtree fetch, and page fetch with dual addressing (physical index or printed label such as `iii` or `A-3`)
- **Cascade delete**: Deleting a document hard-deletes it together with its sections, pages, chunks, tables, figures, edges, and embeddings; deleting a knowledge base does the same for every document in it
- **Entity-graph backed**: All durable state lives in the FireFoundry entity graph, so knowledge-base metadata, document records, and ingestion status participate in the same graph and partition model as the rest of an application's data
- **OpenAPI contract**: The API is defined by Zod schemas that generate an OpenAPI 3.0 document, served at runtime from `GET /openapi.json`
- **Standard health and readiness endpoints** for platform monitoring, and RFC 7807 problem responses for errors

## Architecture Overview

The Knowledge Service sits in front of the RAG agent bundle as the CRUD-facing API. It owns no data of its own; all reads and writes flow through the Entity Service.

```
+-----------------------------------------------------+
|         Application / Agent Bundle / GUI            |
+-----------------------+-----------------------------+
                        | HTTP (REST, JSON)
                        v
+-----------------------------------------------------+
|                 Knowledge Service                   |
|  +--------------+ +---------------+ +------------+  |
|  | KB & Document| | Ingestion     | | Structural |  |
|  | CRUD API     | | Trigger +     | | Views      |  |
|  |              | | Callback      | | (caps,     |  |
|  |              | | Handler       | | sections,  |  |
|  |              | |               | | pages)     |  |
|  +------+-------+ +-------+-------+ +-----+------+  |
|         |                 |               |         |
|  +------v-----------------v---------------v------+  |
|  |           Lifecycle & Metadata Logic          |  |
|  +--------+--------------------+-----------------+  |
+-----------|--------------------|--------------------+
            | entity CRUD,       | POST /api/kb-ingest
            | admin hard-delete  |        ^
            v                    v        | POST /api/kb/ingestion-callback
   +----------------+    +-------------------+
   | Entity Service |<---| RAG Agent Bundle  |
   | (entity graph) |    | (ingest + query)  |
   +----------------+    +-------------------+
```

**Core Components:**

- **KB & Document CRUD API** — Synchronous REST endpoints for managing knowledge bases and document metadata
- **Ingestion Trigger & Callback Handler** — Endpoints that bridge the CRUD surface and the RAG agent bundle: one to start ingestion, one to receive results
- **Structural Views** — Read-only endpoints that project the entity subgraph the RAG agent bundle built (capabilities, sections, pages)
- **Lifecycle & Metadata Logic** — Validates requests, enforces status transitions, and translates between the API contract and entity-graph operations
- **Entity Service** — Owns all durable storage. `KnowledgeBase` entities live in the `system` partition; each knowledge base gets its own partition (named by the knowledge base id) that holds its `Document` entities and the subgraph produced by ingestion
- **RAG Agent Bundle** — The system agent that performs extraction, chunking, embedding, and query; the Knowledge Service forwards ingestion requests to it and receives completion callbacks

## Documentation

- **[Concepts](./concepts.md)** — Knowledge bases, documents, partitions, the ingestion lifecycle, structural views, and deletion semantics
- **[Getting Started](./getting-started.md)** — Create a knowledge base, register and ingest a document, and explore its structure
- **[Reference](./reference.md)** — Every endpoint with request/response shapes, error codes, and environment variables
- **[Operations](./operations.md)** — Helm deployment, configuration, health checks, scaling, security, and troubleshooting

## Version and Maturity

- **Current Version**: 0.2.0 (OpenAPI `info.version` 0.2.0)
- **Maturity**: Early access. The service is an opt-in component of the `firefoundry-core` Helm chart (disabled by default) and is intended to be enabled together with the RAG agent bundle. The API is pre-1.0 and may change; endpoints are unauthenticated and expected to sit behind the platform gateway.

## Repository

Source code: [ff-services-knowledge](https://github.com/firebrandanalytics/ff-services-knowledge) (private)

## Related

- [Platform Services Overview](../README.md) — Overview of all FireFoundry services
- [RAG Agent Bundle](../../system-agents/rag-agent.md) — Performs the actual ingestion and query; called by the Knowledge Service for ingestion triggers
- [Entity Service](../entity-service/README.md) — Backing storage for all knowledge base and document state
- [Document Processing Service](../doc-proc-service/README.md) — Text extraction used during ingestion by the RAG agent bundle
- [Context Service](../context-service/README.md) — Working memory, where source files typically live before ingestion
- [Platform Architecture](../../architecture.md)
