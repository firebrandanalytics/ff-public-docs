# RAG Agent

## Overview

The RAG Agent is a FireFoundry system agent that provides intelligent knowledge-base ingestion and semantic retrieval as a packaged bundle. It accepts documents on one endpoint, processes them into rich, interconnected entity subgraphs in the FireFoundry entity graph, and answers natural-language questions against those subgraphs on a second endpoint — returning assembled context with source citations ready to drop into a downstream prompt or to display to a user. Both operations share a single bundle deployment.

## Purpose and Role

Retrieval-augmented generation is a foundational pattern: load a corpus, then let an LLM answer questions grounded in that corpus. Building a production RAG system from scratch means stitching together a document processor, chunker, embedding pipeline, vector store, query planner, and citation tracker — and getting all of them to behave consistently. The RAG Agent ships that whole pipeline as one bundle.

Application developers typically use this agent in two phases:

- **Ingestion** — Feed a document into a knowledge base. The agent extracts content, plans its subdivision, builds an entity subgraph (documents, sections, pages, chunks, tables, figures) with embeddings and summaries at multiple granularities, and reports completion.
- **Query** — Ask a natural-language question scoped to one or more knowledge bases. The agent performs hybrid semantic and keyword search, navigates the resulting subgraph intelligently (expanding context, excluding irrelevant material, re-searching when needed), and returns synthesized context with chunk-level source citations.

Knowledge bases are entity-graph partitions, not a parallel storage system — once ingested, content lives alongside the rest of the application's entity data and can be inspected, joined, or extended through the same APIs.

## Key Features

- **Two endpoints, one bundle** — Ingestion and query share a deployment and a knowledge model
- **Multi-granularity entities** — Documents are decomposed into sections, pages, chunks, tables, and figures, all wired together with typed edges
- **Layout-aware extraction** — Ingestion runs through the Document Processing Service so layout, tables, and figures are preserved
- **Hybrid search** — Query supports vector, keyword, and hybrid retrieval modes with tunable weighting
- **Multiple detail levels** — Each retrieved entity has `full_text`, `compressed`, and `summary` representations; the query agent picks the right level per source to fit the requested token budget
- **Strategy router** — Queries are dispatched through a classifier that picks between direct structured lookup and pure vector retrieval automatically, or accepts an explicit strategy override
- **Background ingestion** — Ingestion returns a workflow handle immediately and runs the long-running pipeline in the background, so callers are not held in a multi-minute HTTP request
- **Idempotent ingestion** — Re-submitting the same `(knowledge base, document, ingestion version)` triple resumes the existing workflow rather than restarting from scratch
- **Citation-rich responses** — Every query response includes chunk-level sources with relevance scores

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/kb-ingest` | Start ingestion of a document into a knowledge base. Returns immediately with a workflow handle. |
| POST | `/api/rag-query` | Run a semantic query against one or more knowledge bases. Returns assembled context with citations. |
| GET | `/api/health` | Detailed health check across the agent's service dependencies |

### Ingestion: `POST /api/kb-ingest`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kbId` | string | yes | Identifier of the target knowledge base (a partition in the entity graph) |
| `documentId` | UUID | yes | Identifier for the source document |
| `blobPath` | string | yes | Path or URL to the source document's binary content |
| `config.ingestion_version` | string | no | Pipeline version tag (defaults to the current platform default) |
| `config.embeddingModelGroup` | string | no | Embedding model group to use |
| `config.maxChunkTokens` | int | no | Maximum tokens per chunk (default 512) |
| `config.summarizationLevels` | string[] | no | Summary granularities to generate |
| `config.chunkingStrategy` | enum | no | `semantic` / `sliding_window` / `recursive` / `hybrid` |
| `config.extractionMode` | enum | no | `text` or `layout` (default `layout`) |
| `config.documentMetadataOverride` | object | no | Manually-supplied title, issuer, publication date, fiscal year, etc. |

Returns:

```json
{
  "jobId": "0c2c...",
  "workflowEntityId": "5a4f...",
  "status": "started",
  "message": "ingestion workflow started"
}
```

Ingestion runs in the background. Callers can poll the workflow entity for status, or rely on the Knowledge Service to receive the completion notification.

### Query: `POST /api/rag-query`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | The natural-language question |
| `kbIds` | UUID[] | yes | One or more knowledge-base IDs to search |
| `maxTokens` | int | no | Target token budget for the returned context (default 4096) |
| `strategy.maxIterations` | int | no | Cap on retrieval rounds (default 5) |
| `strategy.detailLevel` | enum | no | `auto` / `full_text` / `compressed` / `summary` |
| `strategy.includeMetadataFilters` | object | no | Filter by metadata fields (e.g. `published_date`, `author_names`) with operators like `gte`, `lte`, `eq` |
| `strategy.searchMode` | enum | no | `vector` / `keyword` / `hybrid` |
| `routerStrategy` | enum | no | `auto` / `pure-vector` / `structured-direct` — overrides the strategy classifier |
| `targetParams` | object | no | Required when `routerStrategy=structured-direct` — identifies a specific entity to retrieve directly |

Returns assembled context plus sources:

```json
{
  "context": "The key findings indicate that error rates in production systems...",
  "sources": [
    {
      "documentId": "doc-uuid",
      "chunkId": "chunk-uuid",
      "title": "Production Error Rate Analysis",
      "relevance": 0.92,
      "detailLevel": "full_text"
    }
  ],
  "iterations": 3,
  "tokenCount": 3847
}
```

### Example

```bash
curl -X POST "https://<gateway-host>/api/rag-query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the key findings about error rates in production systems?",
    "kbIds": ["kb-partition-uuid"],
    "maxTokens": 4096,
    "strategy": {
      "maxIterations": 5,
      "detailLevel": "auto",
      "includeMetadataFilters": { "published_date": { "gte": "2024-01-01" } }
    }
  }'
```

## Dependencies

The RAG Agent calls several platform services:

- **FF Broker** — All LLM and embedding model calls
- **Entity Service** — Persistent storage for the knowledge subgraph and vector similarity search
- **Context Service** — Working memory and graph-neighborhood projection during query
- **Document Processing Service** — Text, layout, table, and figure extraction during ingestion
- **Knowledge Service** — Knowledge-base catalog and completion callbacks

## Configuration

The agent is configured via environment variables (see the bundle's `.env.template` for the full list). The main groups are:

- **Service endpoints** — URLs for the broker, entity service, context service, document processing service, knowledge service
- **Embedding** — Default embedding model group
- **Ingestion tuning** — Render concurrency, relationship extraction confidence floor, whether to extract typed relationships
- **Storage** — Blob storage bucket, database connection (where applicable)

## Repository

Source code: [ff-app-system / rag-agent-bundle](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/rag-agent-bundle)

## Related Documentation

- [System Agents Catalog](./README.md)
- [Knowledge Service](../services/knowledge-service.md) — Knowledge-base catalog and ingestion lifecycle
- [Entity Service](../services/entity-service/README.md) — Underlying storage and vector search
- [Document Processing Service](../services/doc-proc-service/README.md) — Document extraction backend
- [Context Service](../services/context-service/README.md) — Working memory used during query
