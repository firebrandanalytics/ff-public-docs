# Knowledge Service — Reference

REST API reference for the Knowledge Service 0.2.0: endpoints, request and response schemas, and error codes. The machine-readable contract is the OpenAPI 3.0 document served at `GET /openapi.json`; the `@firebrandanalytics/kb-client` TypeScript client is generated from it.

## Conventions

- **Base URL**: `http://<host>:8080` (in-cluster: `http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`)
- **Content type**: `application/json` for request and success bodies; errors use `application/problem+json` ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)).
- **Envelope**: single resources are returned as `{ "data": { … } }`; lists as `{ "data": [ … ], "total": n }`.
- **Ids**: `kbId`, `docId`, and `sectionId` path parameters must be UUIDs; otherwise the response is `400`. `pageId` accepts any non-empty string (see [Get a page](#get-apikbkbidpagespageid)).
- **Request body limit**: 10 MB.
- **Correlation**: every response carries an `X-Request-Id` header. If the request supplies `X-Request-Id` (1–128 characters of `[A-Za-z0-9_-]`), it is echoed; otherwise a UUID is generated. Include it when reporting a problem.
- **Authentication**: none in 0.2.0; callers send no credentials. The service is reached in-cluster or through the platform gateway.

## Endpoint Summary

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| POST | `/api/kb` | Create a knowledge base | 201 |
| GET | `/api/kb` | List knowledge bases | 200 |
| GET | `/api/kb/{kbId}` | Get a knowledge base | 200 |
| PUT | `/api/kb/{kbId}` | Update knowledge base metadata (name, description) | 200 |
| DELETE | `/api/kb/{kbId}` | Cascade-delete a knowledge base | 204 |
| POST | `/api/kb/{kbId}/documents` | Register a document into a knowledge base | 201 |
| GET | `/api/kb/{kbId}/documents` | List documents (optionally filtered and paginated) | 200 |
| GET | `/api/kb/{kbId}/documents/{docId}` | Get a document's metadata and status | 200 |
| PUT | `/api/kb/{kbId}/documents/{docId}` | Update document metadata | 200 |
| DELETE | `/api/kb/{kbId}/documents/{docId}` | Cascade-delete a document | 204 |
| GET | `/api/kb/{kbId}/documents/{docId}/capabilities` | Get a document's capability summary | 200 |
| POST | `/api/kb/{kbId}/documents/{docId}/ingest` | Trigger ingestion via the RAG agent bundle | 202 |
| GET | `/api/kb/{kbId}/sections/{sectionId}` | Get a section and its subtree | 200 |
| GET | `/api/kb/{kbId}/pages/{pageId}` | Get a page by id, physical index, or label | 200 |
| GET | `/` | Service info | 200 |
| GET | `/health` | Liveness probe | 200 |
| GET | `/ready` | Readiness probe | 200 |
| GET | `/status` | Service status summary | 200 |
| GET | `/openapi.json` | OpenAPI 3.0 document | 200 |

Any other path returns `404` with a problem body (`detail: "No route matches <METHOD> <path>"`). The service also exposes `POST /api/kb/ingestion-callback`, which the RAG agent bundle uses to report ingestion results; applications do not call it.

---

## Knowledge Base Endpoints

### KnowledgeBase schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Server-issued |
| `name` | string | Non-empty |
| `description` | string | Optional |
| `createdAt` | string | ISO-8601 |
| `updatedAt` | string | ISO-8601 |

### POST /api/kb

Create a knowledge base.

**Request**

```json
{ "name": "engineering-docs", "description": "optional" }
```

| Field | Type | Required |
|---|---|---|
| `name` | string (min length 1) | yes |
| `description` | string | no |

**Response** `201`: `{ "data": KnowledgeBase }`

**Errors**: `400` validation, `503` storage unavailable (retry).

### GET /api/kb

List all knowledge bases in the environment. No query parameters.

**Response** `200`:

```json
{ "data": [ KnowledgeBase, … ], "total": 3 }
```

`data` is capped at 200 items; `total` is the uncapped count.

**Errors**: `503`.

### GET /api/kb/{kbId}

**Response** `200`: `{ "data": KnowledgeBase }`

**Errors**: `400` (non-UUID id), `404` `kb_not_found`, `503`.

### PUT /api/kb/{kbId}

Update name and/or description. Omitted fields keep their current values.

**Request**

```json
{ "name": "renamed", "description": "new description" }
```

| Field | Type | Required |
|---|---|---|
| `name` | string (min length 1) | no |
| `description` | string | no |

**Response** `200`: `{ "data": KnowledgeBase }`

**Errors**: `400`, `404` `kb_not_found`, `503`.

### DELETE /api/kb/{kbId}

Permanently delete the knowledge base, every document in it, and everything ingested from them. Large KBs can take a while; if the call fails part-way, repeating it is safe.

**Response** `204` (no body)

**Errors**: `400`, `404` `kb_not_found`, `500`, `503`.

---

## Document Endpoints

### Document schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Server-issued |
| `kbId` | UUID | Owning knowledge base |
| `metadata` | DocumentMetadata | See below. After ingestion may include additional fields written by the RAG agent bundle. |
| `blobPath` | string | Reference to the stored file |
| `status` | enum | `registered`, `queued`, `in-progress`, `complete`, `failed` |
| `jobId` | UUID | Optional; set when ingestion is triggered |
| `entityCount` | integer ≥ 0 | Optional; set when ingestion completes |
| `edgeCount` | integer ≥ 0 | Optional; set when ingestion completes |
| `error` | string | Optional; set when ingestion fails |
| `uploadedAt` | string | ISO-8601 |
| `updatedAt` | string | ISO-8601 |

### DocumentMetadata schema

| Field | Type | Required at registration |
|---|---|---|
| `title` | string (min length 1) | yes |
| `mimeType` | string (min length 1) | yes |
| `authorNames` | string[] | no |
| `sourceUri` | string | no |
| `pageCount` | integer ≥ 0 | no |
| `fileSize` | integer ≥ 0 | no |
| `publishedDate` | string | no |
| `issuer` | string | no |
| `fiscal_year` | integer ≥ 0 | no |
| `fiscal_period` | enum `Q1` `Q2` `Q3` `Q4` `FY` | no |
| `document_type` | string | no |

### POST /api/kb/{kbId}/documents

Register a document. It starts with status `registered`.

**Request**

```json
{
  "metadata": { "title": "Annual Report", "mimeType": "application/pdf", "issuer": "ACME", "fiscal_year": 2025, "fiscal_period": "FY", "document_type": "10-K" },
  "blobPath": "<path-of-the-stored-file>"
}
```

| Field | Type | Required |
|---|---|---|
| `metadata` | DocumentMetadata | yes |
| `blobPath` | string (min length 1) | yes |

**Response** `201`: `{ "data": Document }`

**Errors**: `400`, `404` `kb_not_found`, `503`.

### GET /api/kb/{kbId}/documents

List documents in a KB.

- **Without query parameters**: returns `{ "data": [Document…], "total": n }`, capped at 200 items.
- **With any query parameter**: filters are applied server-side, and the response adds pagination: `{ "data": [...], "total": n, "page": 1, "size": 50 }`.

**Query parameters** (all optional, AND-ed together, matched against the document's `metadata`):

| Parameter | Type | Match |
|---|---|---|
| `issuer` | string | Exact |
| `language` | string | Exact |
| `mime_type` | string | Exact |
| `ingestion_version` | string | Exact |
| `has_tables` | `true` \| `false` | Document has (or lacks) tables |
| `has_figures` | `true` \| `false` | Document has (or lacks) figures |
| `min_pages` | integer 0–1,000,000 | Page count ≥ value |
| `max_pages` | integer 0–1,000,000 | Page count ≤ value |
| `fiscal_year` | integer 0–9999 | Exact |
| `fiscal_year_min` | integer 0–9999 | Fiscal year ≥ value |
| `fiscal_year_max` | integer 0–9999 | Fiscal year ≤ value |
| `fiscal_period` | string | Exact |
| `document_type` | string | Exact |
| `publication_date_after` | ISO-8601 date or datetime | Publication date ≥ value (inclusive) |
| `publication_date_before` | ISO-8601 date or datetime | Publication date ≤ value (inclusive) |
| `page` | integer ≥ 1 | Page number (default 1) |
| `size` | integer 1–200 | Page size (default 50) |

Most filters target the snake_case metadata written by the RAG agent bundle's structured ingestion (for example `mime_type`, `language`, page and table counts), so they match only after ingestion; the financial-filing fields supplied at registration match immediately. Documents lacking a field do not match a filter on it. Date parameters must match `YYYY-MM-DD` optionally followed by `THH:MM[:SS[.sss]][Z|±HH:MM]`.

**Errors**: `400` (invalid parameter), `404` `kb_not_found`, `503`.

### GET /api/kb/{kbId}/documents/{docId}

**Response** `200`: `{ "data": Document }`

**Errors**: `400`, `404` `document_not_found`, `503`.

### PUT /api/kb/{kbId}/documents/{docId}

Update document metadata. The supplied fields are merged into the existing metadata. Status, `blobPath`, and ingestion fields cannot be changed here.

**Request**

```json
{ "metadata": { "title": "Annual Report (restated)", "authorNames": ["Finance"] } }
```

| Field | Type | Required |
|---|---|---|
| `metadata` | Partial DocumentMetadata | no (an empty body is a no-op update) |

**Response** `200`: `{ "data": Document }`

**Errors**: `400`, `404` `document_not_found`, `503`.

### DELETE /api/kb/{kbId}/documents/{docId}

Permanently delete the document and everything ingested from it (sections, pages, chunks, tables, figures, embeddings). If the call fails part-way, repeating it is safe.

**Response** `204` (no body)

**Errors**: `400`, `404` `document_not_found`, `500`, `503`.

### GET /api/kb/{kbId}/documents/{docId}/capabilities

Return the capability summary for a document. Responses may be up to about a minute stale after a document is re-ingested.

**Response** `200` — one of two shapes:

```json
{ "data": { "ingestion_version": "v1", "capabilities": null } }
```

```json
{
  "data": {
    "ingestion_version": "v2-mvp-1",
    "capabilities": {
      "document_id": "uuid",
      "kb_id": "uuid",
      "ingestion_version": "v2-mvp-1",
      "extractor_version": "optional",
      "ingested_at": "optional ISO-8601",
      "content_hash": "optional",
      "title": "Annual Report",
      "document_type": "optional",
      "issuer": "optional",
      "publication_date": "optional",
      "language": "en",
      "mime_type": "application/pdf",
      "counts": { "pages": 42, "sections": 37, "chunks": 180, "tables": 6, "figures": 4 },
      "structure": { "has_outline": true, "max_section_depth": 3, "sections_by_depth": { "1": 8, "2": 21, "3": 8 } },
      "pages": {
        "physical_count": 42,
        "has_page_labels": true,
        "label_kinds": ["roman_lower", "arabic"],
        "physical_index_range": [0, 41]
      },
      "modality": { "has_tables": true, "has_figures": true },
      "edges": {
        "structural": { "contains": 264, "precedes": 256, "spans": 227 },
        "counts_are_exact": { "contains": true, "precedes": false, "spans": false }
      },
      "flags": {
        "is_navigable_by_section": true,
        "is_navigable_by_page": true,
        "is_addressable_by_label": true,
        "supports_table_query": true,
        "supports_figure_query": true,
        "is_complete": true
      }
    }
  }
}
```

`label_kinds` values: `arabic`, `roman_lower`, `roman_upper`, `alpha_prefixed`, `numeric_prefixed`, `custom`, `absent`. Fields outside the listed set are omitted rather than zero-filled; treat an absent field as "not populated by this extractor".

**Errors**: `400`, `404` `document_not_found`, `503`.

---

## Ingestion Endpoints

### POST /api/kb/{kbId}/documents/{docId}/ingest

Trigger ingestion. Allowed when the document is `registered` or `failed`. No request body. Financial-filing metadata supplied at registration is passed to ingestion automatically.

The call returns once the RAG agent bundle has accepted the work; ingestion continues in the background. Poll [`GET /api/kb/{kbId}/documents/{docId}`](#get-apikbkbiddocumentsdocid) until `status` is `complete` or `failed`.

**Response** `202`:

```json
{ "data": { "jobId": "uuid", "status": "queued", "message": "Ingestion queued" } }
```

**Errors**: `400`, `404` `document_not_found`, `409` `ingestion_in_flight` (status is `queued`, `in-progress`, or `complete`), `502` (RAG agent bundle unreachable or rejected the request; document status unchanged, retry), `503`.

---

## Structural Endpoints

### GET /api/kb/{kbId}/sections/{sectionId}

Return a section with its full subtree.

**Response** `200`: `{ "data": SectionSubtree }`

| Field | Type | Notes |
|---|---|---|
| `id`, `document_id` | UUID | |
| `heading` | string | |
| `numbering` | string | Optional, e.g. `2.3` |
| `depth` | integer ≥ 0 | |
| `ordinal_path` | string | Position path within the document |
| `position_in_parent` | integer | Optional |
| `start_physical_page`, `end_physical_page` | integer | Optional |
| `start_page_label`, `end_page_label` | string | Optional |
| `full_text`, `summary` | string | Optional |
| `children` | SectionSubtree[] | Child sections, recursively |
| `chunks` | ChunkSummary[] | |
| `spans_pages` | PageRef[] | Pages this section covers |

**ChunkSummary**: `id`, and optional `position_in_section`, `position_in_document`, `start_physical_page`, `end_physical_page`, `start_page_label`, `end_page_label`, `full_text`, `summary`.

**PageRef**: `id`, `physical_page_index`, optional `page_label`, `page_label_kind`.

**Errors**: `400`, `404` `section_not_found`, `503`.

### GET /api/kb/{kbId}/pages/{pageId}

Return one page. `pageId` may be a Page UUID, a 0-based physical page index, or a printed page label (for example `iii`, `A-3`). A numeric `pageId` is tried both as an index and as a label.

**Response** `200`: `{ "data": Page }`

| Field | Type | Notes |
|---|---|---|
| `id`, `document_id` | UUID | |
| `physical_page_index` | integer ≥ 0 | |
| `page_label` | string | Optional |
| `page_label_kind` | enum | Optional; see `label_kinds` above |
| `full_text` | string | Optional |
| `width_pt`, `height_pt` | number | Optional |
| `rotation_deg` | integer | Optional |
| `chunks` | ChunkSummary[] | Chunks spanning this page, in document order |
| `sections` | SectionRef[] | `{ id, heading, ordinal_path, depth }` |
| `visuals` | VisualSummary[] | `{ id, kind: "Table" \| "Figure", caption?, start_physical_page?, end_physical_page? }` |

**Response** `409` (ambiguous reference) — note this is **not** a problem body:

```json
{
  "data": {
    "ambiguous": true,
    "label": "42",
    "matches": [
      { "id": "uuid", "physical_page_index": 41, "page_label": "42" },
      { "id": "uuid", "physical_page_index": 42, "page_label": "43" }
    ]
  }
}
```

**Errors**: `400` (non-UUID `kbId` or empty `pageId`), `404` `page_not_found`, `503`.

---

## Service Endpoints

| Path | Response |
|---|---|
| `GET /` | `{ "service": "knowledge-service", "version": "0.2.0", "description": "…" }` |
| `GET /health` | `{ "status": "healthy", "service": "knowledge-service" }` |
| `GET /ready` | `{ "status": "ready" }` — does not check dependencies; use a real call such as `GET /api/kb` to verify end to end |
| `GET /status` | `{ "service", "version", "environment", "startedAt", "uptimeSeconds" }` |
| `GET /openapi.json` | OpenAPI 3.0.3 document (`info.title` "FireFoundry Knowledge Service") |

---

## Error Responses

Errors are RFC 7807 problem documents with content type `application/problem+json`:

```json
{
  "type": "https://firefoundry.io/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "…",
  "code": "kb_not_found"
}
```

| Status | `type` suffix | `code` | When |
|---|---|---|---|
| 400 | `validation` | — | Body or query fails schema validation; path id is not a UUID; empty `pageId` |
| 404 | `not-found` | `kb_not_found` | Knowledge base does not exist |
| 404 | `not-found` | `document_not_found` | Document does not exist in this KB |
| 404 | `not-found` | `section_not_found` | Section does not exist in this KB |
| 404 | `not-found` | `page_not_found` | No page matches the reference |
| 404 | `not-found` | — | No route matches |
| 409 | `conflict` | `ingestion_in_flight` | Trigger on a `queued`, `in-progress`, or `complete` document |
| 409 | — | — | Ambiguous page reference (disambiguation body, see above) |
| 500 | `internal` | — | Unexpected error; if deletes consistently return 500, contact your environment administrator |
| 502 | `bad-gateway` | — | Ingestion trigger could not reach the RAG agent bundle, or the bundle rejected the request; retry |
| 503 | `service-unavailable` | — | Backing storage temporarily unavailable; retry |
