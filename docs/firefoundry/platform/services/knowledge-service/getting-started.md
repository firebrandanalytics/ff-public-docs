# Knowledge Service — Getting Started

This guide walks you through creating a knowledge base, registering a document, triggering ingestion through the RAG agent bundle, tracking the document's status, and exploring its structure once it has been ingested.

## Prerequisites

- A FireFoundry cluster with the Knowledge Service enabled (`knowledge-service.enabled: true` in the `firefoundry-core` Helm values — see [Operations](./operations.md#deployment))
- A running [Entity Service](../entity-service/README.md) (part of `firefoundry-core`)
- The [RAG agent bundle](../../system-agents/rag-agent.md) deployed, with the Knowledge Service's `RAG_AGENT_BUNDLE_URL` pointing at it, and the bundle configured with the Knowledge Service URL so it can post completion callbacks
- A document already stored where the RAG agent bundle can read it (for example in working memory via the [Context Service](../context-service/README.md)), and its path — this becomes `blobPath`
- `curl` and (optionally) `jq`

For local development, port-forward the service (adjust the namespace to your environment):

```bash
kubectl port-forward svc/firefoundry-core-knowledge-service -n ff-dev 8080:8080
export KS=http://localhost:8080
```

From inside the cluster, use `http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`.

## Step 1: Verify the Service is Running

```bash
curl -s $KS/health
```

```json
{ "status": "healthy", "service": "knowledge-service" }
```

```bash
curl -s $KS/status
```

```json
{
  "service": "knowledge-service",
  "version": "0.2.0",
  "environment": "production",
  "startedAt": "2026-08-21T09:00:00.000Z",
  "uptimeSeconds": 3600
}
```

The full OpenAPI document is available at `GET $KS/openapi.json`.

## Step 2: Create a Knowledge Base

```bash
curl -s -X POST $KS/api/kb \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "engineering-docs",
    "description": "Specifications and design documents"
  }'
```

Response (`201 Created`):

```json
{
  "data": {
    "id": "7d0f5a3e-2c1b-4e9a-9a51-0f6f7c1d2b3a",
    "name": "engineering-docs",
    "description": "Specifications and design documents",
    "createdAt": "2026-08-21T09:05:12.345Z",
    "updatedAt": "2026-08-21T09:05:12.345Z"
  }
}
```

Save the id — it is both the KB identifier and the name of the entity-graph partition that will hold its content:

```bash
export KB_ID=7d0f5a3e-2c1b-4e9a-9a51-0f6f7c1d2b3a
```

## Step 3: Register a Document

Registration records the document's metadata and a reference to its stored file. It does not upload or read the file.

```bash
curl -s -X POST $KS/api/kb/$KB_ID/documents \
  -H 'Content-Type: application/json' \
  -d '{
    "metadata": {
      "title": "Platform Specification",
      "mimeType": "application/pdf",
      "authorNames": ["Platform Team"],
      "sourceUri": "https://example.com/spec.pdf",
      "pageCount": 42
    },
    "blobPath": "<path-of-the-stored-file>"
  }'
```

Response (`201 Created`):

```json
{
  "data": {
    "id": "3b8e1c2d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    "kbId": "7d0f5a3e-2c1b-4e9a-9a51-0f6f7c1d2b3a",
    "metadata": {
      "title": "Platform Specification",
      "mimeType": "application/pdf",
      "authorNames": ["Platform Team"],
      "sourceUri": "https://example.com/spec.pdf",
      "pageCount": 42
    },
    "blobPath": "<path-of-the-stored-file>",
    "status": "registered",
    "uploadedAt": "2026-08-21T09:06:00.000Z",
    "updatedAt": "2026-08-21T09:06:00.000Z"
  }
}
```

```bash
export DOC_ID=3b8e1c2d-4f5a-4b6c-8d7e-9f0a1b2c3d4e
```

> **Financial filings:** you can also pass `issuer`, `fiscal_year`, `fiscal_period` (`Q1`–`Q4` or `FY`), and `document_type` inside `metadata`. They are filterable immediately and are forwarded to the RAG agent bundle at ingestion time.

## Step 4: Trigger Ingestion

```bash
curl -s -X POST $KS/api/kb/$KB_ID/documents/$DOC_ID/ingest
```

Response (`202 Accepted`):

```json
{
  "data": {
    "jobId": "c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f",
    "status": "queued",
    "message": "Ingestion queued"
  }
}
```

The service forwarded the request to the RAG agent bundle's `/api/kb-ingest` endpoint and marked the document `queued`. If the bundle could not be reached you get a `502` problem response instead and the document stays `registered` — fix the connectivity and retry the same call.

Triggering again while the document is `queued` or `complete` returns `409`:

```json
{
  "type": "https://firefoundry.io/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Document is already in state \"queued\"",
  "code": "ingestion_in_flight"
}
```

## Step 5: Poll the Document Status

```bash
curl -s $KS/api/kb/$KB_ID/documents/$DOC_ID | jq '.data | {status, jobId, entityCount, edgeCount, error}'
```

While the bundle works:

```json
{ "status": "queued", "jobId": "c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f" }
```

After the bundle's callback:

```json
{
  "status": "complete",
  "jobId": "c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f",
  "entityCount": 812,
  "edgeCount": 1964
}
```

If ingestion failed, `status` is `failed` and `error` holds the bundle's message. A `failed` document can be re-triggered with Step 4.

## Step 6: Inspect the Document's Capabilities

For documents ingested with the structured pipeline, the capability summary tells you how the document can be navigated:

```bash
curl -s $KS/api/kb/$KB_ID/documents/$DOC_ID/capabilities | jq '.data | {ingestion_version, counts: .capabilities.counts, flags: .capabilities.flags}'
```

```json
{
  "ingestion_version": "v2-mvp-1",
  "counts": { "pages": 42, "sections": 37, "chunks": 180, "tables": 6, "figures": 4 },
  "flags": {
    "is_navigable_by_section": true,
    "is_navigable_by_page": true,
    "is_addressable_by_label": true,
    "supports_table_query": true,
    "supports_figure_query": true,
    "is_complete": true
  }
}
```

A document ingested without the structured pipeline returns `{ "ingestion_version": "v1", "capabilities": null }` — it can still be queried through the RAG agent bundle, but section and page routes will not find anything for it.

## Step 7: Fetch a Page or Section

Fetch a page by 0-based physical index, by printed label, or by id:

```bash
curl -s $KS/api/kb/$KB_ID/pages/0      | jq '.data | {physical_page_index, page_label, chunks: (.chunks | length)}'
curl -s $KS/api/kb/$KB_ID/pages/iii    | jq '.data.page_label'
```

If a reference matches more than one page, the response is `409` with the candidates:

```json
{
  "data": {
    "ambiguous": true,
    "label": "42",
    "matches": [
      { "id": "…", "physical_page_index": 41, "page_label": "42" },
      { "id": "…", "physical_page_index": 42, "page_label": "43" }
    ]
  }
}
```

Retry with the chosen `id`. To read a whole section (with its child sections, chunks, and spanned pages), use a section id — for example one from a page's `sections` array:

```bash
SECTION_ID=$(curl -s $KS/api/kb/$KB_ID/pages/0 | jq -r '.data.sections[0].id')
curl -s $KS/api/kb/$KB_ID/sections/$SECTION_ID | jq '.data | {heading, depth, children: (.children | length), chunks: (.chunks | length)}'
```

## Step 8: List and Filter Documents

```bash
# All documents (capped at 200, no pagination metadata)
curl -s $KS/api/kb/$KB_ID/documents | jq '{total, count: (.data | length)}'

# Filtered and paginated
curl -s "$KS/api/kb/$KB_ID/documents?mime_type=application/pdf&has_tables=true&page=1&size=20" \
  | jq '{total, page, size, titles: [.data[].metadata.title]}'

# Financial filings for a fiscal-year range
curl -s "$KS/api/kb/$KB_ID/documents?issuer=ACME&fiscal_year_min=2023&fiscal_year_max=2025&document_type=10-K"
```

Any query parameter switches the endpoint into filtered mode, which adds `page` and `size` to the response.

## Step 9: Ask Questions

Question answering is not part of the Knowledge Service. Send queries to the RAG agent bundle's `/api/rag-query` endpoint with the KB id in `kbIds` — see [RAG Agent Bundle](../../system-agents/rag-agent.md).

## Step 10: Clean Up

```bash
# Delete a single document and everything ingested from it
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $KS/api/kb/$KB_ID/documents/$DOC_ID
# 204

# Delete the whole knowledge base
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $KS/api/kb/$KB_ID
# 204
```

Both are hard deletes. If they return `500` with a message about admin auth, the service needs `ENTITY_SERVICE_ADMIN_API_KEY` — see [Operations](./operations.md#security).

## Using the TypeScript Client

TypeScript applications and agent bundles can use the `@firebrandanalytics/kb-client` package, which is generated from the service's OpenAPI specification:

```typescript
import { KnowledgeBaseClient } from "@firebrandanalytics/kb-client";

const kb = new KnowledgeBaseClient({
  baseUrl: process.env.KNOWLEDGE_SERVICE_URL!,
});

const created = await kb.createKnowledgeBase({ name: "engineering-docs" });
const doc = await kb.registerDocument(created.id, {
  metadata: { title: "spec.pdf", mimeType: "application/pdf" },
  blobPath: "<path-of-the-stored-file>",
});
const trigger = await kb.triggerIngestion(created.id, doc.id);
// trigger.jobId correlates with the bundle's callback; trigger.status is "queued"
```

Clients in other languages can be generated from `GET /openapi.json`.

## Next Steps

- **[Concepts](./concepts.md)** — Partition layout, lifecycle rules, page addressing, and deletion semantics
- **[Reference](./reference.md)** — Every endpoint, filter parameter, schema, and error code
- **[Operations](./operations.md)** — Deploying and configuring the service, and troubleshooting stuck ingestions
- **[RAG Agent Bundle](../../system-agents/rag-agent.md)** — Ingestion configuration and querying
