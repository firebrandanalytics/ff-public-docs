# MCP Gateway — Tools Catalog

This page lists every MCP tool, resource template, and prompt the gateway exposes, grouped by adapter. A tool appears only when its adapter is active in your environment (see [Concepts — Adapters](./concepts.md#adapters)); `tools/list` on a running gateway is always the source of truth, and it returns the exact JSON Schema for each tool's arguments.

In the argument tables, **Req** marks required arguments; defaults are applied by the gateway when an argument is omitted. Unless noted otherwise, a tool's result is a single text content item containing the backing service's response as JSON.

| Adapter | Tool prefix | Tools | Resource templates |
|---------|-------------|-------|--------------------|
| [`entity`](#entity-adapter) | `entity_` | 7 | `entity://nodes/{node_id}` |
| [`context`](#context-adapter) | `context_` | 13 | `context://blobs/{blob_key}` |
| [`docproc`](#document-processing-adapter) | `docproc_` | 5 | — |
| [`telemetry`](#telemetry-adapter) | `telemetry_` | 9 | `telemetry://requests/{request_id}` |
| [`sandbox`](#code-sandbox-adapter) | `sandbox_` | 1 | — |
| [`websearch`](#web-search-adapter) | `websearch_` | 3 | — |
| [`dataaccess`](#data-access-adapter) | `das_` | 7 | — |
| [`knowledgebase`](#knowledge-base-adapter) | `kb_` | 7 | — |
| [`skills`](#skills-adapter) | `skills_` | 3 | — |
| [`grpc`](#grpc-adapter-dynamic) | as configured | dynamic | — |
| [`a2a-client`](#a2a-client-adapter-dynamic) | `a2a:<agent>:` | dynamic | — |

---

## Entity Adapter

Knowledge-graph operations on the [Entity Service](../entity-service/README.md), scoped to the agent bundle (and graph, if set) configured for the gateway — see [Operations](./operations.md#enabling-adapters-for-your-app).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `entity_get_node` | Retrieve a node by ID | `node_id` (string, Req) |
| `entity_create_node` | Create a new instance node | `node_class` (string, Req) — type name, e.g. `Document`; `name` (string, Req); `data` (object) |
| `entity_update_node` | Replace an existing node's data | `node_id` (string, Req); `data` (object, Req) |
| `entity_archive_node` | Archive (soft delete) or unarchive a node | `node_id` (string, Req); `archived` (boolean, default `true`) |
| `entity_get_connected` | Get nodes connected to a node via one edge type | `node_id` (string, Req); `edge_type` (string, Req) |
| `entity_create_edge` | Create an edge between two nodes | `from_node_id` (string, Req); `to_node_id` (string, Req); `edge_type` (string, Req); `data` (object) |
| `entity_search_by_embedding` | Find nodes by embedding-vector similarity | `embedding` (number[], Req); `limit` (number, default `10`); `threshold` (number) |

**Resource template:** `entity://nodes/{node_id}` — returns the node as `application/json`.

## Context Adapter

Working memory, blob storage, and tool execution on the [Context Service](../context-service/README.md) (gRPC).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `context_insert_wm` | Insert a working-memory record | `memory_type` (string, Req) — e.g. `data/json`; `name` (string, Req); `description` (string, Req); `content` (object); `entity_node_id` (string); `reasoning` (string) |
| `context_fetch_wm` | Fetch a working-memory record | `record_id` (string, Req) |
| `context_delete_wm` | Delete a working-memory record | `record_id` (string, Req) |
| `context_fetch_wm_by_entity` | Fetch all working-memory records for an entity | `entity_node_id` (string, Req) |
| `context_get_manifest` | Hierarchical working-memory manifest for an entity, organized by type | `entity_node_id` (string, Req); `memory_types` (string[]); `subtypes` (string[]); `semantic_purposes` (string[]) |
| `context_upload_blob` | Upload content to blob storage | `memory_type` (string, Req); `name` (string, Req); `description` (string, Req); `content_type` (string, Req) — MIME type; `content` (string, Req) — **base64**; `entity_node_id` (string); `reasoning` (string) |
| `context_get_blob` | Retrieve a blob | `key` (string, Req); `include_metadata` (boolean, default `true`) |
| `context_delete_blob` | Delete a blob | `working_memory_id` (string); `blob_key` (string) — supply one |
| `context_list_blobs` | List blobs for an entity | `entity_node_id` (string, Req) |
| `context_rag_query` | Execute a RAG query | `sql` (string, Req) |
| `context_get_chat_history` | Chat history for a node | `node_id` (string, Req) |
| `context_list_tools` | List Context Service tools for a context type | `context_type` (string, Req) |
| `context_execute_tool` | Execute a Context Service tool | `tool_name` (string, Req); `parameters` (object of string values, Req); `context_type` (string, Req) |

`context_get_blob` returns `{ "content": "<base64>", "contentType": "<mime>" }`.

**Resource template:** `context://blobs/{blob_key}` — returns the blob base64-encoded in `blob`, with its stored content type.

## Document Processing Adapter

Extraction and conversion on the [Document Processing Service](../doc-proc-service/README.md). Document content is passed **base64-encoded**; the file extension in `filename` tells the service how to parse it.

| Tool | Description | Arguments |
|------|-------------|-----------|
| `docproc_extract_text` | Extract plain text (PDF, Word, Excel, images, …) | `content` (string, Req, base64); `filename` (string, Req) |
| `docproc_extract_structured` | Extract structured content (tables, lists, headings) | `content` (string, Req, base64); `filename` (string, Req) |
| `docproc_ocr` | OCR an image or scanned document | `content` (string, Req, base64); `filename` (string, Req) |
| `docproc_convert_format` | Convert a document to another format | `content` (string, Req, base64); `source_filename` (string, Req); `target_format` (string, Req) — e.g. `pdf`, `docx` |
| `docproc_html_to_pdf` | Render HTML to PDF | `html_content` (string, Req) — raw HTML |

Results have the shape `{ success, text | data | content, format, metadata }`. For `docproc_convert_format` and `docproc_html_to_pdf`, `content` is the output file, base64-encoded.

## Telemetry Adapter

Read access to request telemetry in the [Telemetry Service](../telemetry-service/README.md). Telemetry is stored as events grouped by trace ID; broker requests, LLM calls, and tool calls are events in different layers (`broker`, `llm`, `tool_call`).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `telemetry_get_broker_request` | Get a broker request event by its event ID | `request_id` (string, Req) |
| `telemetry_search_broker_requests` | List broker-layer events | `status` (string) — `failed` limits to errored events; `limit` (number, default `20`); `offset` (number, default `0`) |
| `telemetry_get_recent_requests` | Most recent broker-layer events | `limit` (number, default `20`) |
| `telemetry_get_llm_api_request` | Get an LLM call event by its event ID | `request_id` (string, Req) |
| `telemetry_search_llm_api_requests` | List LLM-layer events, optionally for one trace | `broker_request_id` (string) — trace ID; `limit` (number, default `20`); `offset` (number, default `0`) |
| `telemetry_get_tool_call` | Get a tool-call event by its event ID | `request_id` (string, Req) |
| `telemetry_search_tool_calls` | List tool-call-layer events, optionally for one trace | `llm_request_id` (string) — trace ID; `limit` (number, default `20`); `offset` (number, default `0`) |
| `telemetry_get_request_trace` | All events of one trace (the full request trace) | `broker_request_id` (string, Req) — trace ID |
| `telemetry_get_completion_stream` | Get a completion-stream event by its event ID | `stream_id` (string, Req) |

The "get" tools return an error result when the event does not exist. `telemetry_get_request_trace` returns an error result when the trace has no events.

**Resource template:** `telemetry://requests/{request_id}` — all events for the trace ID `request_id`, as JSON.

## Code Sandbox Adapter

Isolated code execution on the [Code Sandbox](../code-sandbox/README.md).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `sandbox_execute_code` | Execute code in a sandbox | `code` (string, Req); `language` (`typescript` \| `python` \| `sql`, Req); `harness` (`finance` \| `sql`, Req) |

Result: `{ success, stdout, stderr, returnData, errors }`.

## Web Search Adapter

Search and page fetching through the [Web Search Service](../web-search/README.md).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `websearch_search` | Search the web; returns titles, URLs, and snippets | `query` (string, Req, 1–500 chars); `limit` (1–50, default `10`); `offset` (≥0, default `0`); `safe_search` (`off` \| `moderate` \| `strict`); `market` (string, e.g. `en-US`); `freshness` (`day` \| `week` \| `month`) |
| `websearch_fetch` | Fetch and extract a URL, optionally with a screenshot | `url` (URL, Req); `content_mode` (`html` \| `markdown` \| `text` \| `raw`, default `markdown`); `render_mode` (`static` \| `dynamic`); `timeout_ms` (1000–60000); `extract_metadata` (boolean); `include_screenshot` (boolean, requires `dynamic`); `viewport` (`{ width: 320–3840, height: 240–2160 }`) |
| `websearch_fetch_batch` | Fetch up to 20 URLs concurrently | `urls` (URL[], Req, 1–20); `content_mode`; `render_mode`; `timeout_ms`; `concurrency` (1–10); `include_screenshot`; `viewport` — same meanings as above |

`websearch_search` returns `{ results, pagination, meta, spellingCorrection, relatedSearches }`. Fetch results include `url`, `finalUrl`, `statusCode`, `contentType`, `content`, `metadata`, `screenshot`, `fetchTimeMs`, and `contentLength`; the batch result adds `errors` and `meta`.

## Data Access Adapter

Governed SQL access, schema introspection, and domain ontology from the [Data Access Service](../data-access/README.md).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `das_get_connections` | List data connections, their types, and allowed operations | — |
| `das_get_schema` | Tables, views, and stored views with columns for a connection | `connection` (string, Req) |
| `das_query` | Run a SQL `SELECT`; returns columns, rows, row count, execution time | `connection` (string, Req); `sql` (string, Req); `params` (array) — values for `$1`, `$2`, …; `max_rows` (number, default `100`); `timeout` (number, ms) |
| `das_list_views` | List stored view definitions | `namespace` (string); `connection` (string) |
| `das_ontology_context` | Domain ontology (entity types, concepts, relationships) for prompt injection | `domain` (string, Req); `connection` (string) |
| `das_resolve_term` | Resolve a business term to entity types with column mappings and confidence | `term` (string, Req); `context_phrase` (string); `domain` (string); `connection` (string) |
| `das_process_context` | Business rules, processes, annotations, and calendar context for a domain | `domain` (string, Req); `min_importance` (`high` \| `medium` \| `low`) |

Access control is enforced by the Data Access Service, not by the gateway.

## Knowledge Base Adapter

RAG queries and ingestion jobs against the knowledge base ingestion and RAG query APIs. See also the [Knowledge Service](../knowledge-service/README.md).

| Tool | Description | Arguments |
|------|-------------|-----------|
| `kb_query` | RAG query; returns an answer with source citations and relevance scores | `knowledge_base_id` (string, Req); `query` (string, Req) |
| `kb_create_ingestion_job` | Start chunking and embedding a document into a knowledge base | `knowledge_base_id` (string, Req); `document_id` (string, Req) |
| `kb_get_ingestion_job` | Status and progress of an ingestion job | `job_id` (string, Req) |
| `kb_list_ingestion_jobs` | List ingestion jobs | `knowledge_base_id` (string); `page` (number, default `1`); `page_size` (number, default `20`) |
| `kb_cancel_ingestion_job` | Cancel a pending or running ingestion job | `job_id` (string, Req) |
| `kb_list_chunks` | Browse document chunks with content and token counts | `knowledge_base_id` (string, Req); `document_id` (string); `page` (default `1`); `page_size` (default `20`) |
| `kb_list_embedding_models` | Available embedding models with dimensions, token limits, and providers | — |

## Skills Adapter

Read access to the [Skills Service](../skills-service/README.md). The caller's `X-On-Behalf-Of` identity is forwarded so skill resolution respects the caller's scope.

| Tool | Description | Arguments |
|------|-------------|-----------|
| `skills_list` | List skills (front-matter metadata only) | `tags` (string[]); `name` (string, partial match) |
| `skills_read` | Read a skill's full definition, including content | `name` (string, Req) |
| `skills_read_file` | Read one file inside a skill | `name` (string, Req); `path` (string, Req) — relative path within the skill |

`skills_read_file` returns the raw file text rather than JSON.

## gRPC Adapter (Dynamic)

Each gRPC backend you register contributes one tool per entry in its `tools` mapping:

- **Name** — the mapping's `toolName`
- **Description** — the mapping's `description`, or `Call <serviceName>.<grpcMethod> via gRPC`
- **Arguments** — built from the mapping's `inputSchema` (a map of field name to `{ "type": "string" | "number" | "integer" | "boolean" | "array" | "object", "description"?, "optional"? }`); without an `inputSchema`, any JSON object is accepted and passed as the gRPC request message

The result is the gRPC response message as JSON; for a server-streaming method (`streaming: true`), an array of every message received before the stream ended. See [Reference — Registering your own tools](./reference.md#registering-your-own-tools) for the registration format.

## A2A Client Adapter (Dynamic)

Each remote A2A agent you register contributes tools: each skill on each remote agent's card becomes one tool:

- **Name** — `a2a:<agent-name>:<skill-id>`
- **Description** — `[Remote: <agent-name>] <skill name>: <skill description>`
- **Arguments** — `message` (string, Req) — the text sent to the remote agent; `arguments` (object) — optional structured arguments

The call sends A2A `message/send` to `<agent-url>/a2a` (30-second timeout, retried up to three times on 408/429/502/503/504) and returns the text parts of the task's artifacts.

---

## Prompts

Available on the unified endpoint (`POST /mcp`) through `prompts/list` and `prompts/get`.

| Prompt | Arguments | Produces |
|--------|-----------|----------|
| `list_tools_by_adapter` | `adapter` (optional) — e.g. `entity` | A live, Markdown list of connected tools grouped by adapter, with totals |
| `debug_request` | `request_id` (required) | A step-by-step plan for tracing a request with the telemetry tools |
| `explore_entity_graph` | `node_id` (required) | A plan for exploring the graph from a node with the entity tools |
| `ingest_and_query` | `topic` (required) | A plan for ingesting a document into a knowledge base and querying it with the `kb_` tools |
| `data_analysis` | `question` (required) | A plan for answering a data question with the `das_` tools |

`completion/complete` offers argument completion for the `adapter` argument of `list_tools_by_adapter` (connected adapter names) and prefix completion for static resource URIs.

> **Note:** Prompt plans are guidance, not exact tool names. If a plan mentions a tool that `tools/list` does not return (for example `telemetry_get_request` in `debug_request`), use the listed equivalent: `telemetry_get_request_trace`, `telemetry_search_llm_api_requests`, `telemetry_search_tool_calls`, or `telemetry_search_broker_requests`.

## Related

- [Concepts](./concepts.md) — Adapters, result format, choosing an endpoint
- [Getting Started](./getting-started.md) — Calling tools with curl
- [Reference](./reference.md) — MCP methods and error codes
