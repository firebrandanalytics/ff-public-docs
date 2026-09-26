# Knowledge Service — Getting Started

This guide walks through the full app-builder flow: create a knowledge base, register a document, trigger ingestion and wait for it to finish, navigate the ingested document, ask questions through the RAG agent bundle, and clean up. It then shows the same flow from TypeScript inside an agent bundle.

## Prerequisites

- The Knowledge Service and the [RAG agent bundle](../../system-agents/rag-agent.md) enabled in your environment (see [Operations](./operations.md#enabling-the-service))
- A document already stored where the RAG agent bundle can read it — typically in working memory via the [Context Service](../context-service/README.md) ([Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)) — and its path, which becomes `blobPath`
- `curl` and `jq`

From an agent bundle in the cluster, the service is at `http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`. For local experiments, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-knowledge-service -n <namespace> 8080:8080
export KS=http://localhost:8080
```

Check it responds:

```bash
curl -s $KS/health
# { "status": "healthy", "service": "knowledge-service" }
```

## Step 1: Create a Knowledge Base

```bash
curl -s -X POST $KS/api/kb \
  -H 'Content-Type: application/json' \
  -d '{ "name": "engineering-docs", "description": "Specifications and design documents" }'
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

Save the id — your app should persist it, because every later call (including RAG queries) uses it:

```bash
export KB_ID=7d0f5a3e-2c1b-4e9a-9a51-0f6f7c1d2b3a
```

## Step 2: Register a Document

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

Response (`201 Created`) — the document starts as `registered`:

```json
{
  "data": {
    "id": "3b8e1c2d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    "kbId": "7d0f5a3e-2c1b-4e9a-9a51-0f6f7c1d2b3a",
    "metadata": { "title": "Platform Specification", "mimeType": "application/pdf", "authorNames": ["Platform Team"], "sourceUri": "https://example.com/spec.pdf", "pageCount": 42 },
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

> **Financial filings:** you can also pass `issuer`, `fiscal_year`, `fiscal_period` (`Q1`–`Q4` or `FY`), and `document_type` in `metadata`. They are filterable immediately and carried through ingestion.

## Step 3: Trigger Ingestion

```bash
curl -s -X POST $KS/api/kb/$KB_ID/documents/$DOC_ID/ingest
```

Response (`202 Accepted`):

```json
{ "data": { "jobId": "c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f", "status": "queued", "message": "Ingestion queued" } }
```

- `502` means the RAG agent bundle could not be reached; the document keeps its status, so retry the same call.
- `409 ingestion_in_flight` means the document is already `queued` or `complete`.

## Step 4: Poll Until Complete

Ingestion runs in the background. Poll the document until `status` is `complete` or `failed`:

```bash
while true; do
  STATUS=$(curl -s $KS/api/kb/$KB_ID/documents/$DOC_ID | jq -r '.data.status')
  echo "status: $STATUS"
  [ "$STATUS" = "complete" ] || [ "$STATUS" = "failed" ] && break
  sleep 5
done

curl -s $KS/api/kb/$KB_ID/documents/$DOC_ID | jq '.data | {status, entityCount, edgeCount, error}'
```

```json
{ "status": "complete", "entityCount": 812, "edgeCount": 1964, "error": null }
```

If `status` is `failed`, `error` holds the reason; fix the cause (for example a wrong `blobPath`) and trigger again with Step 3.

## Step 5: Inspect What the Document Offers

```bash
curl -s $KS/api/kb/$KB_ID/documents/$DOC_ID/capabilities \
  | jq '.data | {ingestion_version, counts: .capabilities.counts, flags: .capabilities.flags}'
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

A response of `{ "ingestion_version": "v1", "capabilities": null }` means the document can be queried but not navigated by section or page.

## Step 6: Navigate Pages and Sections

Fetch a page by 0-based physical index or by printed label:

```bash
curl -s $KS/api/kb/$KB_ID/pages/0   | jq '.data | {physical_page_index, page_label, chunks: (.chunks | length)}'
curl -s $KS/api/kb/$KB_ID/pages/iii | jq '.data.page_label'
```

If the reference matches more than one page, you get `409` with candidates — retry with the chosen `id`:

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

Read a whole section (child sections, chunks, spanned pages) using a section id from a page's `sections` array:

```bash
SECTION_ID=$(curl -s $KS/api/kb/$KB_ID/pages/0 | jq -r '.data.sections[0].id')
curl -s $KS/api/kb/$KB_ID/sections/$SECTION_ID \
  | jq '.data | {heading, depth, children: (.children | length), chunks: (.chunks | length)}'
```

## Step 7: Ask Questions

Questions go to the RAG agent bundle, scoped by KB id:

```bash
curl -s -X POST "https://<gateway-host>/api/rag-query" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"What are the platform's availability requirements?\",
    \"kbIds\": [\"$KB_ID\"],
    \"maxTokens\": 4096
  }" | jq '{context, sources: [.sources[] | {title, relevance}]}'
```

The response contains assembled `context` to put into your prompt and `sources` for citations. See [RAG Agent Bundle](../../system-agents/rag-agent.md) for all query options (search mode, detail level, metadata filters).

## Step 8: List and Filter Documents

```bash
# All documents (at most 200; compare total with the number returned)
curl -s $KS/api/kb/$KB_ID/documents | jq '{total, count: (.data | length)}'

# Filtered and paginated
curl -s "$KS/api/kb/$KB_ID/documents?mime_type=application/pdf&has_tables=true&page=1&size=20" \
  | jq '{total, page, size, titles: [.data[].metadata.title]}'

# Financial filings for a fiscal-year range
curl -s "$KS/api/kb/$KB_ID/documents?issuer=ACME&fiscal_year_min=2023&fiscal_year_max=2025&document_type=10-K"
```

Any query parameter switches the endpoint to filtered mode, which adds `page` and `size` to the response.

## Step 9: Clean Up

```bash
# Delete one document and everything ingested from it
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $KS/api/kb/$KB_ID/documents/$DOC_ID   # 204

# Delete the whole knowledge base
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $KS/api/kb/$KB_ID                     # 204
```

Deletes are permanent.

## From an Agent Bundle (TypeScript)

TypeScript bundles can use `@firebrandanalytics/kb-client`, which is generated from the service's OpenAPI document. Configure the service URL through an environment variable on your bundle (for example `KNOWLEDGE_SERVICE_URL=http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`).

```typescript
import { KnowledgeBaseClient } from "@firebrandanalytics/kb-client";

const kbUrl = process.env.KNOWLEDGE_SERVICE_URL!;
const kb = new KnowledgeBaseClient({ baseUrl: kbUrl });

// 1. Create the KB once and persist created.id with your app's data
const created = await kb.createKnowledgeBase({ name: "engineering-docs" });

// 2. Register a file you already stored in working memory
const doc = await kb.registerDocument(created.id, {
  metadata: { title: "spec.pdf", mimeType: "application/pdf" },
  blobPath: "<path-of-the-stored-file>",
});

// 3. Trigger ingestion (status is "queued")
await kb.triggerIngestion(created.id, doc.id);

// 4. Poll until complete or failed
async function waitForIngestion(kbId: string, docId: string, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${kbUrl}/api/kb/${kbId}/documents/${docId}`);
    if (!res.ok) throw new Error(`status check failed: ${res.status}`);
    const { data } = await res.json();
    if (data.status === "complete") return data;
    if (data.status === "failed") throw new Error(`ingestion failed: ${data.error}`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error("ingestion did not finish in time");
}

await waitForIngestion(created.id, doc.id);
```

The client is generated from the same OpenAPI document the [Reference](./reference.md) describes; see its type definitions for the remaining operations (listing, capabilities, sections, pages, delete). Clients in other languages can be generated from `GET /openapi.json`, or you can call the REST API directly.

For long ingestions inside an agent workflow, prefer checking status on a schedule or on the user's next interaction rather than holding a single request open for many minutes.

## Next Steps

- **[Concepts](./concepts.md)** — Lifecycle rules, page addressing, and app design patterns
- **[Reference](./reference.md)** — Every endpoint, filter parameter, schema, and error code
- **[Operations](./operations.md)** — Enabling the service and caller-side troubleshooting
- **[RAG Agent Bundle](../../system-agents/rag-agent.md)** — Ingestion options and querying
