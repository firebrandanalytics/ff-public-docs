# MCP Gateway — Reference

Reference for the MCP Gateway's HTTP endpoints, MCP methods, error codes, the APIs for registering your own tools, and the settings an app team uses. For the tool list, see the [Tools Catalog](./tools.md).

All endpoints are served on one HTTP port (default `8080`). Request bodies are JSON, up to 50 MB.

## Authentication Summary

| Route group | `X-Api-Key` required |
|-------------|:---:|
| `GET /`, `/health`, `/ready`, `/status`, `GET /mcp` | No |
| `POST /mcp`, `GET/POST /mcp/{adapter}` | Yes |
| `/admin/grpc/*`, `/admin/a2a/agents/*` | Yes |
| `/.well-known/a2a-agent-card`, `/.well-known/agent-card.json` | No |
| `/a2a`, `/a2a/tasks`, `/a2a/tasks/{id}/cancel` | Only when `A2A_AUTH_REQUIRED` is on |

Authentication failures return `401 {"error":"Missing X-Api-Key header"}` or `403 {"error":"Invalid API key"}`.

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
      "lastToolCall": "2026-09-26T12:05:00.000Z",
      "totalToolCalls": 42
    }
  }
}
```

Each adapter entry may also carry `error`, the reason the adapter failed to start.

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

`status` is `connected`, `disabled` (not configured in this environment), or `error` (failed to start).

### POST /mcp — unified MCP server

Body: one JSON-RPC 2.0 message.

| Body | Response |
|------|----------|
| Request (`id` present) | `200` with a JSON-RPC response |
| Notification (`jsonrpc: "2.0"`, `method`, no `id`) | `204 No Content` |
| Anything else (including batch arrays) | `400` with JSON-RPC error `-32600 Invalid Request` |
| Gateway still starting | `503 {"error":"Unified MCP server not available"}` |

### POST /mcp/{adapter} — per-adapter MCP server

Same contract as `POST /mcp`, scoped to one adapter. Additional responses:

| Condition | Response |
|-----------|----------|
| Unknown adapter name | `404 {"error":"MCP server not found: <adapter>"}` |
| Adapter not configured or failed to start | `503 {"error":"MCP server not available: <adapter>"}` |

Trace headers (`X-Trace-Id`, `X-Span-Id`, `X-On-Behalf-Of`) are forwarded to the backing service, read results are never served from the unified endpoint's short-lived result cache, and each `tools/call` emits an `mcp_tool_call` telemetry event when telemetry is enabled.

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
| `logging/setLevel` | ✓ | ✓ | Accepted for client compatibility (`params.level`: `debug`, `info`, `warning`, `error`, `critical`, `alert`, `emergency`); does not change what the gateway logs |
| `completion/complete` | ✓ | — | `params.ref` (`ref/prompt` or `ref/resource`), `params.argument` `{name, value}`; up to 100 values |

Notifications always receive `204 No Content` and are otherwise ignored.

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
| `-32002` | Tool execution error | The tool failed unexpectedly (rather than returning an error result) |

Most tool failures (validation of arguments, downstream HTTP/gRPC errors) are returned as a normal result with `isError: true`, not as `-32002`.

---

## Registering Your Own Tools

App teams can expose their own gRPC services and remote A2A agents as MCP tools. There are two ways to register them:

- **Startup configuration (persistent)** — set in the gateway's configuration by whoever manages your environment's Helm values (see [Settings](#settings)). Tools registered this way appear on both the unified and per-adapter endpoints.
- **Admin API (runtime)** — the endpoints below. Registrations are held in memory on the replica that received them and are lost on restart. Until the next restart, their tools are callable only on `/mcp/grpc` or `/mcp/a2a-client`, and only if that adapter was enabled at startup. Use this for trying things out; persist anything you rely on in the startup configuration.

Admin routes require `X-Api-Key`. Errors use `{"error":{"code":"<CODE>","message":"…"}}` with codes `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `AGENT_UNREACHABLE`.

### gRPC backends

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/grpc/backends` | List backends with `connected`, `error`, `tools`, `totalCalls`, `lastCallAt` |
| GET | `/admin/grpc/backends/{name}` | Full configuration and status of one backend |
| POST | `/admin/grpc/backends` | Register a backend and connect it if enabled. `201` on success, `400` invalid body, `409` name or tool already registered |
| DELETE | `/admin/grpc/backends/{name}` | Unregister and disconnect |
| POST | `/admin/grpc/backends/{name}/connect` | Reconnect a backend |

Backend definition (the body of `POST /admin/grpc/backends`, and the format of each entry in the startup JSON file):

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
| `protoPath` | ✓ | | Path to the `.proto` file as mounted in the gateway container; server reflection is not supported |
| `serviceName` | ✓ | | Service name (optionally dotted) |
| `packageName` | | | Proto package, if not part of `serviceName` |
| `tools` | ✓ | | At least one mapping; `toolName` and `grpcMethod` required; tool names must be unique across backends. Give tools a prefix of your own (e.g. `inventory_`) |
| `useTls` | | `false` | TLS with default roots, otherwise an insecure channel |
| `connectTimeoutMs` / `requestTimeoutMs` | | `5000` / `30000` | |
| `enabled` | | `true` | Disabled backends are neither connected nor listed as tools |
| `metadata` | | | Static gRPC metadata sent with every call |

See the [Tools Catalog](./tools.md#grpc-adapter-dynamic) for how mappings become MCP tools.

### Remote A2A agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/a2a/agents` | List configured agents: `name`, `url`, `connected`, `skillCount`, `toolCount`, `fetchedAt`, `lastError` |
| PUT | `/admin/a2a/agents` | Body `{"url": "<url>", "name": "<lowercase-with-hyphens>", "apiKey"?: "<key>"}`; fetches the agent card and registers tools. `400` invalid body, `502 AGENT_UNREACHABLE` |
| DELETE | `/admin/a2a/agents/{name}` | Remove an agent |
| POST | `/admin/a2a/agents/{name}/refresh` | Re-fetch the agent card and rebuild its tools |

The gateway reads the card from `<url>/.well-known/agent-card.json` and sends calls to `<url>/a2a`.

---

## A2A Endpoints

Available only when A2A is enabled. Responses carry the `A2A-Version: 1.0` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/a2a-agent-card` | Agent Card (A2A 1.0 location) |
| GET | `/.well-known/agent-card.json` | Agent Card (older location, kept for compatibility) |
| POST | `/a2a` | A2A JSON-RPC: `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, and the other standard A2A methods |
| GET | `/a2a/tasks` | Recent task history; `?status=<state>&limit=<n>`. Response `{ tasks, count }` |
| POST | `/a2a/tasks/{id}/cancel` | Cancel a task. `404` unknown task, `409` already `completed`/`failed`/`canceled`/`rejected` |

Agent Card: `name` = `A2A_AGENT_NAME`, `url` = `A2A_BASE_URL`, `capabilities.streaming: true`, text input/output, one skill per active adapter (`firefoundry-<adapter>`, tagged with the adapter name, `firefoundry`, and a domain tag such as `knowledge-graph`).

Task history is kept per gateway replica; with several replicas, `/a2a/tasks` and cancel only see tasks that ran on the replica you reach.

---

## Settings

These are the gateway settings an app team typically asks to have set in its environment. They live under `mcp-gateway:` in the `firefoundry-core` Helm values (secret values under `secret.data`, others under `configMap.data`); see [Operations](./operations.md#enabling-adapters-for-your-app) for examples. Changes take effect after the gateway restarts.

For on/off flags, set the value to `true` to turn the feature on, and remove the setting to turn it off — do not set it to `"false"`.

### Access and scope

| Setting | Description |
|---------|-------------|
| `API_KEY` | The shared key clients send as `X-Api-Key` |
| `AGENT_BUNDLE_ID` | Agent bundle the entity tools act as |
| `ENTITY_GRAPH_NAME` | Optional entity graph name for the entity tools |

### Adapters

An adapter is active when its service setting is present.

| Setting | Adapter |
|---------|---------|
| `ENTITY_SERVICE_URL` | `entity` (also needs `AGENT_BUNDLE_ID`) |
| `CONTEXT_SERVICE_ADDRESS` | `context` (gRPC `host:port`) |
| `DOC_PROC_SERVICE_URL` | `docproc` |
| `TELEMETRY_SERVICE_URL` | `telemetry` |
| `SANDBOX_SERVICE_URL` | `sandbox` |
| `WEB_SEARCH_SERVICE_URL` | `websearch` |
| `DATA_ACCESS_SERVICE_URL` | `dataaccess` |
| `KB_INGESTION_SERVICE_URL` and `KB_RAG_QUERY_SERVICE_URL` | `knowledgebase` (both required) |
| `SKILLS_SERVICE_URL` | `skills` |
| `GRPC_BACKENDS_ENABLED` | `grpc` — flag |
| `GRPC_BACKENDS_CONFIG_PATH` | `grpc` — path to a mounted JSON array of [backend definitions](#grpc-backends) loaded at startup |
| `A2A_REMOTE_AGENTS` | `a2a-client` — JSON array `[{"url": "...", "name": "...", "apiKey": "..."}]` |

### A2A server

| Setting | Default | Description |
|---------|---------|-------------|
| `A2A_ENABLED` | off | Serve the A2A endpoints |
| `A2A_BASE_URL` | — | Public URL placed in the Agent Card; set it whenever A2A is enabled |
| `A2A_AGENT_NAME` | `FireFoundry MCP Gateway` | Agent Card name |
| `A2A_AGENT_DESCRIPTION` | built-in | Agent Card description |
| `A2A_AUTH_REQUIRED` | off | Require `X-Api-Key` on `/a2a*` — turn on whenever A2A is enabled |

## Related

- [Tools Catalog](./tools.md)
- [Connecting Clients](./clients.md)
- [Operations](./operations.md)
