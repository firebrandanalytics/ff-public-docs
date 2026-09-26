# MCP Gateway — Reference

Complete reference for the MCP Gateway's HTTP endpoints, MCP methods, admin API, error codes, and configuration. For the tool list, see the [Tools Catalog](./tools.md).

All endpoints are served on one HTTP port (default `8080`). Request bodies are JSON, up to 50 MB.

## Authentication Summary

| Route group | `X-Api-Key` required (when `API_KEY` is set) | `mcp.access` entitlement guard |
|-------------|:---:|:---:|
| `GET /`, `/health`, `/ready`, `/status`, `GET /mcp` | No | No |
| `POST /mcp`, `GET/POST /mcp/{adapter}` | Yes | Yes |
| `/admin/*` (including `/admin/grpc/*`, `/admin/a2a/agents/*`) | Yes | No |
| `/api/v1/external-services/*`, `/api/v1/inbound-apis/*` | **No** | No |
| `/.well-known/a2a-agent-card`, `/.well-known/agent-card.json` | No | No |
| `/a2a`, `/a2a/tasks`, `/a2a/tasks/{id}/cancel` | Only if `A2A_AUTH_REQUIRED=true` | `message/send` and `message/stream` only |

Authentication failures return `401 {"error":"Missing X-Api-Key header"}` or `403 {"error":"Invalid API key"}`. Entitlement refusals (enforce mode only) are described under [Entitlement refusal](#entitlement-refusal).

---

## Service Endpoints

### GET /

Service information and endpoint map.

```json
{
  "message": "MCP Gateway for FireFoundry Services",
  "service": "mcp-gateway",
  "mcp": { "version": "1.0.0", "discovery": "/mcp", "endpoints": ["/mcp/entity", "/mcp/context", "..."] },
  "a2a": {
    "discovery": "/.well-known/a2a-agent-card",
    "legacyDiscovery": "/.well-known/agent-card.json",
    "endpoint": "/a2a",
    "protocolVersion": "1.0",
    "status": "active",
    "skillCount": 4
  }
}
```

The `a2a` block appears only when A2A is enabled.

### GET /health

Liveness. Always `200 {"status":"healthy","timestamp":"<ISO-8601>"}` while the process is serving.

### GET /ready

Readiness. `{"ready": true}` once adapter initialization has finished, otherwise `{"ready": false}` (status `200` in both cases).

### GET /status

```json
{
  "service": "mcp-gateway",
  "version": "1.0.0",
  "uptime": 1234.5,
  "environment": "production",
  "adapters": {
    "entity": {
      "enabled": true, "connected": true, "toolCount": 7,
      "initializedAt": "2026-09-26T12:00:00.000Z",
      "lastToolCall": "2026-09-26T12:05:00.000Z",
      "totalToolCalls": 42
    }
  }
}
```

Each adapter entry may also carry `error` (initialization failure message). `initializedAt` is only populated by adapters that record it (`knowledgebase`, `skills`, `grpc`, `a2a-client`).

---

## MCP Endpoints

### GET /mcp — discovery

Not an MCP call. Returns the unified endpoint and every adapter endpoint:

```json
{
  "service": "mcp-gateway",
  "version": "1.0.0",
  "unified": { "endpoint": "/mcp", "method": "POST", "description": "…", "toolCount": 29, "promptCount": 5 },
  "servers": [
    {
      "name": "entity",
      "endpoint": "/mcp/entity",
      "description": "Entity graph operations - nodes, edges, and vector search",
      "status": "connected",
      "toolCount": 7,
      "tools": ["entity_get_node", "…"]
    }
  ]
}
```

`status` is `connected`, `disabled` (no configuration), or `error` (initialization failed).

### POST /mcp — unified MCP server

Body: one JSON-RPC 2.0 message.

| Body | Response |
|------|----------|
| Request (`id` present) | `200` with a JSON-RPC response |
| Notification (`jsonrpc: "2.0"`, `method`, no `id`) | `204 No Content` |
| Anything else (including batch arrays) | `400` with JSON-RPC error `-32600 Invalid Request` |
| Unified server not yet created | `503 {"error":"Unified MCP server not available"}` |

### POST /mcp/{adapter} — per-adapter MCP server

Same contract as `POST /mcp`, scoped to one adapter. Additional responses:

| Condition | Response |
|-----------|----------|
| Unknown adapter name | `404 {"error":"MCP server not found: <adapter>"}` |
| Adapter not configured or failed to initialize | `503 {"error":"MCP server not available: <adapter>"}` |

Trace headers (`X-Trace-Id`, `X-Span-Id`, `X-On-Behalf-Of`) are passed to the adapter, and each `tools/call` emits an `mcp_tool_call` telemetry event when the telemetry adapter is connected.

### GET /mcp/{adapter} — keep-alive event stream

Opens a `text/event-stream` response that sends one `open` event, then a `ping` event every 30 seconds. No MCP messages are delivered on this stream; use `POST` for all MCP traffic. Same `404`/`503` rules as above.

---

## MCP Methods

| Method | Unified `/mcp` | Per-adapter `/mcp/{adapter}` | Notes |
|--------|:---:|:---:|-------|
| `initialize` | ✓ | ✓ | Returns protocol `2024-11-05`, capabilities, `serverInfo` |
| `initialized` | ✓ | ✓ | Accepted as a request (returns `{}`) or notification |
| `ping` | ✓ | ✓ | Returns `{}` |
| `tools/list` | ✓ | ✓ | Unified: optional `params.cursor` pagination (50 per page) |
| `tools/call` | ✓ | ✓ | `params.name` (required), `params.arguments` (object, default `{}`) |
| `resources/list` | ✓ | ✓ | Built-in adapters define no static resources, so the list is empty |
| `resources/templates/list` | ✓ | ✓ | Returns `resourceTemplates` |
| `resources/read` | ✓ | ✓ | `params.uri` (required); matched against resources and templates |
| `prompts/list` | ✓ | — | Five built-in prompts |
| `prompts/get` | ✓ | — | `params.name` (required), `params.arguments` (string map) |
| `logging/setLevel` | ✓ | ✓ | `params.level`: `debug`, `info`, `warning`, `error`, `critical`, `alert`, `emergency` |
| `completion/complete` | ✓ | — | `params.ref` (`ref/prompt` or `ref/resource`), `params.argument` `{name, value}`; up to 100 values |

Notifications always receive `204 No Content`. `initialized` and (on the unified endpoint) `notifications/cancelled` are logged; all other notifications, including `notifications/initialized`, are accepted and ignored.

**Capabilities advertised** — unified: `tools`, `resources` (no subscribe), `prompts`, `logging`, `completions`, all with `listChanged: false`. Per-adapter: `tools`, `resources`, `logging`.

### Pagination

`tools/list` and `resources/list` on the unified endpoint accept `params.cursor`, an opaque base64 string. When a cursor is supplied the response contains at most 50 items and a `nextCursor` if more remain. Without a cursor, the full list is returned. Start with the cursor `MA==` to page from the beginning.

### Tool call result

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "<JSON or text>" }],
    "isError": true
  }
}
```

`isError` is present (and `true`) only when the tool failed; the text then contains the error message.

### JSON-RPC error codes

| Code | Name | When |
|------|------|------|
| `-32600` | Invalid Request | Body is not a single JSON-RPC 2.0 request or notification |
| `-32601` | Method not found | Unsupported MCP method, or unknown prompt name in `prompts/get` |
| `-32602` | Invalid params | Missing `name`/`uri`, bad `logging/setLevel` level, malformed `completion/complete` params |
| `-32603` | Internal error | Unexpected exception while handling the method |
| `-32000` | Tool not found | `tools/call` names a tool that is not connected (or not in this adapter) |
| `-32001` | Resource not found | No resource/template matches the URI, or the read failed |
| `-32002` | Tool execution error | The adapter threw instead of returning an error result |

Most tool failures (validation of arguments, downstream HTTP/gRPC errors) are returned as a normal result with `isError: true`, not as `-32002`.

---

## Admin API

All admin routes require `X-Api-Key` when `API_KEY` is set. Errors use `{"error":{"code":"<CODE>","message":"…"}}` with codes `NOT_FOUND`, `VALIDATION_ERROR`, `DATABASE_UNAVAILABLE`, `CONFLICT`, `AGENT_UNREACHABLE`.

### Status, adapters, and tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/status` | Service status, database state (`enabled`, `connected`), adapter status, and A2A status with task metrics |
| GET | `/admin/adapters` | Adapter configuration records merged with runtime `connected`/`error` |
| GET | `/admin/adapters/{name}` | One adapter record (`404` if absent) |
| PUT | `/admin/adapters/{name}` | Body `{"enabled": boolean}`; requires the database (`503 DATABASE_UNAVAILABLE` otherwise) |
| GET | `/admin/tools` | Every tool from every adapter with `enabled`, `rate_limit_per_minute`, `configured` |
| GET | `/admin/tools/{name}` | One tool with its configuration |
| PUT | `/admin/tools/{name}` | Body `{"enabled"?: boolean, "rate_limit_per_minute"?: 1–10000 \| null}`; requires the database |
| DELETE | `/admin/tools/{name}` | Remove a tool's custom configuration; requires the database |

Without the database, `GET /admin/adapters` returns defaults (all `enabled: true`) for `entity`, `context`, `telemetry`, `docproc`, `sandbox`, and `websearch`.

> The adapter and tool `enabled` flags and `rate_limit_per_minute` are **stored only**; they are not enforced on MCP calls in the current version. See [Concepts — Admin configuration records](./concepts.md#admin-configuration-records).

### gRPC backend admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/grpc/backends` | List backends with `connected`, `error`, `tools`, `totalCalls`, `lastCallAt` |
| GET | `/admin/grpc/backends/{name}` | Full configuration and status of one backend |
| POST | `/admin/grpc/backends` | Register a backend and connect it if enabled. `201` on success, `400` invalid body, `409` name or tool already registered |
| DELETE | `/admin/grpc/backends/{name}` | Unregister and disconnect |
| POST | `/admin/grpc/backends/{name}/connect` | Reconnect a backend |

Backend registration body (also the format of each entry in the `GRPC_BACKENDS_CONFIG_PATH` JSON array):

```json
{
  "name": "inventory",
  "address": "inventory-service.my-namespace.svc.cluster.local:50051",
  "protoPath": "/config/protos/inventory.proto",
  "serviceName": "InventoryService",
  "packageName": "acme.inventory.v1",
  "tools": [
    {
      "toolName": "inventory_get_item",
      "grpcMethod": "GetItem",
      "description": "Look up an inventory item by SKU",
      "inputSchema": { "sku": { "type": "string", "description": "Item SKU" } },
      "streaming": false
    }
  ],
  "useTls": false,
  "connectTimeoutMs": 5000,
  "requestTimeoutMs": 30000,
  "enabled": true,
  "metadata": { "x-tenant": "acme" }
}
```

| Field | Required | Default | Notes |
|-------|:---:|---------|-------|
| `name` | ✓ | | Unique backend name |
| `address` | ✓ | | `host:port` |
| `protoPath` | effectively ✓ | | Path to the `.proto` file inside the gateway container; server reflection is not supported |
| `serviceName` | ✓ | | Service name (optionally dotted) |
| `packageName` | | | Proto package, if not part of `serviceName` |
| `tools` | ✓ | | At least one mapping; `toolName` and `grpcMethod` required; tool names must be unique across backends |
| `useTls` | | `false` | TLS with default roots, otherwise insecure channel |
| `connectTimeoutMs` / `requestTimeoutMs` | | `5000` / `30000` | |
| `enabled` | | `true` | Disabled backends are neither connected nor listed as tools |
| `metadata` | | | Static gRPC metadata sent with every call |

### Remote A2A agent admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/a2a/agents` | List configured agents: `name`, `url`, `connected`, `skillCount`, `toolCount`, `fetchedAt`, `lastError` |
| PUT | `/admin/a2a/agents` | Body `{"url": "<url>", "name": "<lowercase-with-hyphens>", "apiKey"?: "<key>"}`; fetches the agent card and registers tools. `400` invalid body, `502 AGENT_UNREACHABLE` |
| DELETE | `/admin/a2a/agents/{name}` | Remove an agent |
| POST | `/admin/a2a/agents/{name}/refresh` | Re-fetch the agent card and rebuild its tools |

Runtime changes are held in memory only; persist agents in `A2A_REMOTE_AGENTS`.

---

## Integration Catalog API

Catalog records for outbound and inbound integrations, stored in PostgreSQL (`DATABASE_ENABLED=true`). These routes are **not** protected by the API key. Errors use RFC 7807 problem details (`type`, `title`, `status`, `detail`, `instance`). Write operations return `503` when the database is unavailable; `409` on a duplicate `name`.

### External services — `/api/v1/external-services`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List, `?page=1&pageSize=25` (max 100). Response `{ data, meta: { total, page, pageSize, totalPages } }` |
| POST | `/` | Create. `201 { data }` |
| GET | `/{id}` | Get one |
| PUT | `/{id}` | Update any subset of fields |
| DELETE | `/{id}` | Delete |
| POST | `/{id}/test` | HTTP `GET` to `endpoint_url` (10 s timeout); returns `{ ok, latencyMs, error? }` and records the result |

Fields: `name` (1–255, unique), `type` (`mcp` \| `webhook` \| `rest` \| `grpc`), `endpoint_url` (URL), `description`, `auth_type` (`none` \| `api_key` \| `bearer` \| `basic`), `auth_config` (object), `enabled`. Responses add `id`, `last_tested_at`, `last_test_status`, `created_at`, `updated_at`.

### Inbound APIs — `/api/v1/inbound-apis`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all |
| POST | `/` | Create |
| GET | `/{id}` | Get one |
| PUT | `/{id}` | Update |
| DELETE | `/{id}` | Delete |

Fields: `name` (1–255, unique), `description`, `spec` (object), `auth_type` (`api_key` \| `bearer` \| `none`), `enabled`.

---

## A2A Endpoints

Registered only when `A2A_ENABLED=true`. Responses carry the `A2A-Version: 1.0` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/a2a-agent-card` | Agent Card (A2A 1.0 location) |
| GET | `/.well-known/agent-card.json` | Agent Card (older location, kept for compatibility) |
| POST | `/a2a` | A2A JSON-RPC: `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, and the other methods of the A2A request handler |
| GET | `/a2a/tasks` | In-memory task history; `?status=<state>&limit=<n>`. Response `{ tasks, count }` |
| POST | `/a2a/tasks/{id}/cancel` | Cancel a task. `404` unknown task, `409` already `completed`/`failed`/`canceled`/`rejected` |

Agent Card: `name` = `A2A_AGENT_NAME`, `url` = `A2A_BASE_URL`, `capabilities.streaming: true`, text input/output, one skill per connected adapter (`firefoundry-<adapter>`, tagged with the adapter name, `firefoundry`, and a domain tag such as `knowledge-graph`).

---

## Entitlement Refusal

In enforce mode, a request whose `mcp.access` grant is known to be false receives:

```
HTTP/1.1 402 Payment Required
x-ff-entitlement-state: LICENSED
```

```json
{
  "error": "entitlement_required",
  "feature": "mcp.access",
  "state": "LICENSED",
  "message": "mcp.access is not included in plan <plan>",
  "upgrade_url": "https://…"
}
```

In report mode (the default) the request is served and a would-refuse event is logged.

---

## Environment Variables

### Service

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development`, `production`, or `test`; `development` includes error messages in `500` responses |
| `PORT` | `8080` | HTTP port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SERVICE_NAME` | `mcp-gateway` | Name reported by `/`, `/status`, `GET /mcp` |
| `MCP_SERVER_NAME` | `firefoundry-mcp-gateway` | `serverInfo.name` of the unified server |
| `MCP_SERVER_VERSION` | `1.0.0` | `serverInfo.version` and the version shown in status output |
| `API_KEY` | — | Inbound `X-Api-Key` secret; also passed to the entity, context, web search, knowledge base (as `Authorization: Bearer`), and skills (as `X-API-Key`) clients |

### Adapters

| Variable | Adapter | Description |
|----------|---------|-------------|
| `ENTITY_SERVICE_URL` | `entity` | Entity Service base URL; enables the adapter |
| `AGENT_BUNDLE_ID` | `entity` | Agent bundle ID the entity client operates as (required with `ENTITY_SERVICE_URL`) |
| `ENTITY_CLIENT_MODE` | `entity` | `internal` (default, in-cluster) or `external` |
| `EXTERNAL_PORT` | `entity`, A2A | Port used by the entity client in `external` mode (default `8000`); also used for the default A2A base URL |
| `ENTITY_GRAPH_NAME` | `entity` | Optional graph name |
| `CONTEXT_SERVICE_ADDRESS` | `context` | Context Service gRPC `host:port`; enables the adapter |
| `CONTEXT_SERVICE_ENVIRONMENT` | `context` | Environment passed to the context client |
| `DOC_PROC_SERVICE_URL` | `docproc` | Document Processing base URL |
| `TELEMETRY_SERVICE_URL` | `telemetry` | Telemetry Service HTTP base URL |
| `SANDBOX_SERVICE_URL` | `sandbox` | Code Sandbox base URL |
| `WEB_SEARCH_SERVICE_URL` | `websearch` | Web Search base URL |
| `DATA_ACCESS_SERVICE_URL` | `dataaccess` | Data Access Service URL |
| `KB_INGESTION_SERVICE_URL` | `knowledgebase` | Ingestion API base URL (`/api/v1/ingestion/jobs`) |
| `KB_RAG_QUERY_SERVICE_URL` | `knowledgebase` | RAG API base URL (`/api/v1/query`, `/api/v1/chunks`, `/api/v1/embeddings/models`) |
| `SKILLS_SERVICE_URL` | `skills` | Skills Service base URL (`/v1/skills`) |
| `GRPC_BACKENDS_ENABLED` | `grpc` | `true` enables the gRPC adapter (default `false`) |
| `GRPC_BACKENDS_CONFIG_PATH` | `grpc` | Path to a JSON array of backend configurations loaded at startup |
| `A2A_REMOTE_AGENTS` | `a2a-client` | JSON array `[{"url": "...", "name": "...", "apiKey": "..."}]` of remote A2A agents |

### A2A server

| Variable | Default | Description |
|----------|---------|-------------|
| `A2A_ENABLED` | `false` | Register the A2A routes |
| `A2A_BASE_URL` | `http://localhost:<EXTERNAL_PORT>` (port `8000` unless `EXTERNAL_PORT` is set) | Public URL placed in the Agent Card — set it explicitly when A2A is enabled |
| `A2A_AGENT_NAME` | `FireFoundry MCP Gateway` | Agent Card name |
| `A2A_AGENT_DESCRIPTION` | (built-in description) | Agent Card description |
| `A2A_AUTH_REQUIRED` | `false` | Require `X-Api-Key` on `/a2a*` |

Boolean variables are parsed by JavaScript truthiness of the string: any non-empty value — including `"false"` — is treated as `true`. Leave a flag unset to disable it.

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_ENABLED` | `false` | Enable the PostgreSQL configuration store (database `firefoundry`, schema `mcp_gateway`) |
| `PG_HOST` | — | PostgreSQL host (the shared FireFoundry `PG_*` connection settings apply) |
| `PG_PASSWORD` | — | Password for the read role (`fireread`) |
| `PG_INSERT_PASSWORD` | — | Password for the write role (`fireinsert`) |

### Entitlements

| Variable | Default | Description |
|----------|---------|-------------|
| `FF_ENTITLEMENT_MODE` | `report` | Only the exact value `enforce` enables refusal |
| `FF_ENTITLEMENT_AGENT_URL` | `http://ff-entitlement-agent:8090` | Entitlement agent URL |
| `FF_ENTITLEMENT_ISSUER` | `https://license.firefoundry.ai` | Token issuer |
| `FF_ENTITLEMENT_JWKS_URL` | `<issuer>/.well-known/jwks.json` | JWKS URL |
| `FF_CLUSTER_REF` | — | Cluster identity (lowercase UUID). Missing/invalid: report mode logs once and runs unlicensed; enforce mode fails startup |
| `FF_NAMESPACE` | service-account namespace | Kubernetes namespace; same validation rules as `FF_CLUSTER_REF` |
| `FF_ENTITLEMENT_POLL_SECONDS` | `30` | Poll interval; must be a positive number or startup fails |

## Database Schema

Schema `mcp_gateway` (migrations `V1__create_schema.sql`, `V2__add_external_services_inbound_apis.sql`):

| Table | Purpose |
|-------|---------|
| `adapter_config` | `adapter_name` (PK), `enabled` |
| `tool_config` | `tool_name` (PK), `adapter_name` (FK), `enabled`, `rate_limit_per_minute` |
| `rate_limit_tracking` | Per-tool call counts per window (reserved for rate limiting) |
| `external_services` | External service catalog |
| `inbound_apis` | Inbound API catalog |

## Related

- [Tools Catalog](./tools.md)
- [Connecting Clients](./clients.md)
- [Operations](./operations.md)
