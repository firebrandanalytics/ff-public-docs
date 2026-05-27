# Knowledge Service

## Overview

The Knowledge Service is the FireFoundry platform service that owns the CRUD lifecycle of knowledge bases and the documents registered into them. It is the single API surface application developers use to create knowledge bases, register documents, track ingestion status, and trigger ingestion. The service itself is intentionally thin: it persists metadata in the entity graph and delegates the actual ingestion and query work to the RAG agent bundle.

## Purpose and Role in Platform

The Knowledge Service is the system-of-record for "what knowledge bases exist", "what documents are registered in each one", and "what's the current ingestion status of each document". Application developers use it to:

- Create and manage knowledge bases for their applications
- Register documents (with their metadata and a reference to a stored file) into a knowledge base
- Trigger ingestion of a registered document
- Track the lifecycle of each document from registration through ingestion completion
- List, retrieve, update, and archive knowledge bases and documents

The service deliberately stops there. Chunking, embedding, vector search, graph traversal, text extraction, and question answering are handled by other parts of the platform. The Knowledge Service exposes a clean CRUD surface in front of those capabilities so that callers have one place to manage knowledge-base state, regardless of how ingestion or query is implemented underneath.

## Key Features

- **Knowledge base CRUD**: Create, list, get, update, and archive knowledge bases through a single REST API
- **Document registration and metadata**: Register documents into a knowledge base with structured metadata (title, MIME type, source URI, author names, page count, file size) and a reference to the stored blob
- **Document lifecycle tracking**: Each document moves through a well-defined status flow that callers can poll: `registered -> queued -> in-progress -> complete | failed`
- **Ingestion trigger**: A single endpoint kicks off ingestion for a registered document; the service forwards the request to the RAG agent bundle and updates document status
- **Ingestion callback handling**: A dedicated callback endpoint receives completion or failure notifications from the RAG agent bundle and updates document status, entity counts, and error text
- **Entity-graph backed**: All durable state lives in the FireFoundry entity graph, so knowledge-base metadata, document records, and ingestion status participate in the same graph and partition model as the rest of an application's data
- **Standard health and readiness endpoints** for platform monitoring

## Architecture Overview

The Knowledge Service sits in front of the RAG agent bundle as the CRUD-facing API. It owns no data of its own; all reads and writes flow through the Entity Service.

```
+-----------------------------------------------------+
|         Application / Agent Bundle / GUI            |
+-----------------------+-----------------------------+
                        | HTTP (REST)
                        v
+-----------------------------------------------------+
|                 Knowledge Service                   |
|  +------------------+    +-----------------------+  |
|  | KB & Document    |    | Ingestion Trigger     |  |
|  | CRUD API         |    | + Callback Handler    |  |
|  +--------+---------+    +-----------+-----------+  |
|           |                          |              |
|  +--------v--------------------------v-----------+  |
|  |           Lifecycle & Metadata Logic          |  |
|  +--------+--------------------+-----------------+  |
+-----------|--------------------|--------------------+
            | entity CRUD        | trigger ingestion
            v                    v
   +----------------+    +-------------------+
   | Entity Service |    | RAG Agent Bundle  |
   | (entity graph) |    | (ingest + query)  |
   +----------------+    +-------------------+
```

**Core Components:**

- **KB & Document CRUD API** — Synchronous REST endpoints for managing knowledge bases and document metadata
- **Ingestion Trigger & Callback Handler** — Endpoints that bridge the CRUD surface and the RAG agent bundle: one to start ingestion, one to receive results
- **Lifecycle & Metadata Logic** — Validates requests, enforces status transitions, and translates between the API contract and entity-graph operations
- **Entity Service** — Owns all durable storage; each knowledge base lives in its own partition of the entity graph, with `KnowledgeBase` and `Document` entities holding the metadata
- **RAG Agent Bundle** — The system agent that performs chunking, embedding, and query; the Knowledge Service forwards ingestion requests to it and receives completion callbacks

## API and Interfaces

All application-facing endpoints are under `/api/kb` and use JSON request and response bodies.

### Knowledge Base Endpoints

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| POST | `/api/kb` | Create a knowledge base | 201 |
| GET | `/api/kb` | List knowledge bases | 200 |
| GET | `/api/kb/{kbId}` | Get a knowledge base | 200 |
| PUT | `/api/kb/{kbId}` | Update knowledge base metadata (name, description) | 200 |
| DELETE | `/api/kb/{kbId}` | Archive a knowledge base | 204 |

### Document Endpoints

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| POST | `/api/kb/{kbId}/documents` | Register a document into a knowledge base | 201 |
| GET | `/api/kb/{kbId}/documents` | List documents in a knowledge base | 200 |
| GET | `/api/kb/{kbId}/documents/{docId}` | Get a document's metadata and status | 200 |
| PUT | `/api/kb/{kbId}/documents/{docId}` | Update document metadata (title, author names, source URI, etc.) | 200 |
| DELETE | `/api/kb/{kbId}/documents/{docId}` | Archive a document | 204 |

Document status is not editable through `PUT`; it is managed by the lifecycle below.

### Ingestion Endpoints

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| POST | `/api/kb/{kbId}/documents/{docId}/ingest` | Trigger ingestion of a registered document via the RAG agent bundle | 202 |
| POST | `/api/kb/ingestion-callback` | Receive a completion or failure callback from the RAG agent bundle | 204 |

The trigger endpoint forwards the request to the RAG agent bundle, transitions the document to `queued`, and returns the bundle's job identifier so callers can correlate later. The callback endpoint is invoked by the RAG agent bundle when ingestion completes (status `complete`, with `entityCount` and `edgeCount`) or fails (status `failed`, with `error` text). Application code does not normally call the callback endpoint directly.

### Document Lifecycle

Every document moves through this status flow:

```
registered -> queued -> in-progress -> complete
                                    \-> failed
```

- **`registered`** — Document metadata exists; ingestion has not been triggered
- **`queued`** — The RAG agent bundle accepted the trigger request and returned a job identifier
- **`in-progress`** — Reserved for progress updates from the bundle during long ingestions
- **`complete`** — The bundle reported successful ingestion; entity and edge counts are populated on the document
- **`failed`** — The bundle reported a failure; the error text is populated on the document and the document can be re-triggered

Re-triggering ingestion is allowed from `registered` or `failed`. Triggering a document that is already `queued`, `in-progress`, or `complete` returns 409.

### Standard Service Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |
| GET | `/status` | Service status summary |

## Dependencies

- **Entity Service** — All durable storage. The Knowledge Service creates one entity-graph partition per knowledge base and stores `KnowledgeBase` and `Document` entities through the standard entity-graph APIs. See [Entity Service](./entity-service/README.md).
- **RAG Agent Bundle** — The system agent that performs ingestion (chunking, embedding) and query. The Knowledge Service forwards trigger requests to it and receives completion callbacks. See [RAG Agent Bundle](../system-agents/rag-agent.md) for usage details, ingestion configuration, and query APIs.

## Configuration

The service is configured via environment variables (see `.env.example` in the service repository for the complete list). The main groups are:

- **Service settings** — HTTP port and log level
- **Entity Service connection** — URL and port for the entity-graph API
- **RAG Agent Bundle connection** — Base URL of the RAG agent bundle's ingestion endpoint

## Version

- **Current Version**: 0.1.0

## Repository

Source code: [ff-services-knowledge](https://github.com/firebrandanalytics/ff-services-knowledge)

## Related Documentation

- [Platform Services Overview](./README.md) — Overview of all FireFoundry services
- [Entity Service](./entity-service/README.md) — Backing storage for all knowledge base and document state
- [RAG Agent Bundle](../system-agents/rag-agent.md) — Performs the actual ingestion and query; called by the Knowledge Service for ingestion triggers
- [Doc Proc Service](./doc-proc-service/README.md) — Text extraction service used during ingestion by the RAG agent bundle
