# MCP Gateway — Concepts

This page explains the mental model behind the MCP Gateway: what an adapter is, how the unified and per-adapter MCP servers differ, how tools, resources, and prompts are exposed, and how identity, caching, and the optional A2A layer fit in.

## MCP in One Paragraph

The Model Context Protocol (MCP) is a JSON-RPC 2.0 protocol that lets an AI client discover and use capabilities offered by a server. A server advertises three kinds of things:

| MCP concept | What it is | Gateway example |
|-------------|-----------|-----------------|
| **Tool** | A named operation with a JSON Schema for its arguments; the client calls it with `tools/call` | `entity_get_node`, `websearch_search` |
| **Resource** | Readable content addressed by a URI; the client reads it with `resources/read` | `entity://nodes/{node_id}` |
| **Prompt** | A reusable, parameterized message template; the client fetches it with `prompts/get` | `debug_request` |

The gateway implements MCP protocol version `2024-11-05` over plain HTTP: the client POSTs one JSON-RPC message and receives one JSON response.

## Adapters

An **adapter** is the unit of integration. Each adapter wraps one FireFoundry service client and declares:

- a **name** (used in URLs such as `/mcp/entity` and in status output),
- a list of **tools**, each with a typed input schema that is converted to JSON Schema for `tools/list`,
- optionally, **resource templates** and a `readResource` implementation.

| Adapter | Backing service | Enabled when | Tools |
|---------|-----------------|--------------|-------|
| `entity` | [Entity Service](../entity-service/README.md) | `ENTITY_SERVICE_URL` is set | 7 |
| `context` | [Context Service](../context-service/README.md) (gRPC) | `CONTEXT_SERVICE_ADDRESS` is set | 13 |
| `docproc` | [Document Processing](../doc-proc-service/README.md) | `DOC_PROC_SERVICE_URL` is set | 5 |
| `telemetry` | [Telemetry Service](../telemetry-service/README.md) | `TELEMETRY_SERVICE_URL` is set | 9 |
| `sandbox` | [Code Sandbox](../code-sandbox/README.md) | `SANDBOX_SERVICE_URL` is set | 1 |
| `websearch` | [Web Search](../web-search/README.md) | `WEB_SEARCH_SERVICE_URL` is set | 3 |
| `dataaccess` | [Data Access Service](../data-access/README.md) | `DATA_ACCESS_SERVICE_URL` is set | 7 |
| `knowledgebase` | Knowledge base ingestion and RAG query APIs | both `KB_INGESTION_SERVICE_URL` and `KB_RAG_QUERY_SERVICE_URL` are set | 7 |
| `skills` | [Skills Service](../skills-service/README.md) | `SKILLS_SERVICE_URL` is set | 3 |
| `grpc` | Any gRPC service you register | `GRPC_BACKENDS_ENABLED=true` | dynamic |
| `a2a-client` | Remote A2A agents | `A2A_REMOTE_AGENTS` lists at least one agent | dynamic |

The full tool list is in the [Tools Catalog](./tools.md).

### Adapter lifecycle

1. **Startup** — the gateway creates every adapter, then initializes only those whose configuration is present. An adapter without configuration is reported as `disabled`.
2. **Connected** — a successfully initialized adapter is `connected`. The gateway creates a per-adapter MCP server for it and includes its tools in the unified server.
3. **Error** — if initialization throws, the adapter stays out of the MCP surface and its error is shown in `GET /status`.
4. **Shutdown** — on `SIGTERM`/`SIGINT` each adapter releases its client.

Initialization creates the client object; for most adapters it does not make a network call. A misconfigured URL therefore usually surfaces on the first tool call (as a tool error), not at startup.

### Dynamic adapters

Two adapters build their tool list at runtime instead of from a fixed definition:

- **`grpc`** — you register gRPC backends (from a JSON file at startup, or through `POST /admin/grpc/backends`). Each backend supplies a `.proto` file path, the service name, and a list of *tool mappings* from an MCP tool name to a gRPC method. Unary and server-streaming methods are supported; server reflection is not.
- **`a2a-client`** — you list remote A2A agents (`A2A_REMOTE_AGENTS`, or `PUT /admin/a2a/agents`). The gateway fetches each agent's card from `<url>/.well-known/agent-card.json` and turns every skill into an MCP tool named `a2a:<agent-name>:<skill-id>`. Calling the tool sends an A2A `message/send` request to `<url>/a2a`.

> **Note:** The unified endpoint indexes tools once, at startup. Backends or agents that you register later through the admin API appear in `tools/list` but can only be *called* through their per-adapter endpoint (`/mcp/grpc` or `/mcp/a2a-client`), and only if that adapter was enabled at startup. Restart the gateway to add them to the unified index.

## Unified vs. Per-Adapter Servers

The gateway runs several MCP servers side by side:

| | Unified server | Per-adapter server |
|---|---|---|
| Endpoint | `POST /mcp` | `POST /mcp/<adapter>` |
| Tools | All connected adapters | One adapter |
| Resources / templates | All connected adapters | One adapter |
| Prompts, `completion/complete` | Yes | No |
| `tools/list` / `resources/list` pagination | Yes (cursor, 50 per page) | No (full list) |
| Read-only result cache | Yes (60 s) | No |
| Trace context passed to adapters | No | Yes |
| MCP tool-call telemetry events | No | Yes (when the telemetry adapter is connected) |
| Server name in `initialize` | `MCP_SERVER_NAME` (default `firefoundry-mcp-gateway`) | `firefoundry-mcp-<adapter>` |

Use the **unified server** for general-purpose agents that should see everything. Use a **per-adapter server** to give a client a narrow tool set (for example a debugging agent that only needs `telemetry`), or when you want per-call telemetry and trace propagation.

Tool names are globally unique by convention (each adapter uses its own prefix). If two adapters ever declared the same name, the unified server would log a collision and route to the adapter registered last.

## Tools, Resources, and Prompts

### Tool results

Every tool returns an MCP `CallToolResult`: a `content` array with one text item. For almost all tools the text is pretty-printed JSON of the backing service's response. `skills_read_file` returns raw file text, and `a2a-client` tools return the remote agent's text artifacts.

A failure inside a tool (bad arguments, downstream error) is returned as a normal result with `isError: true` and the error message as text — not as a JSON-RPC error. JSON-RPC errors are reserved for protocol problems such as an unknown method or an unknown tool name (see [Reference](./reference.md#json-rpc-error-codes)).

Binary data (documents, blobs, generated PDFs) travels as **base64** strings inside the JSON arguments and results. The HTTP layer accepts request bodies up to 50 MB.

### Resources

The built-in adapters expose resource **templates** (no static resources):

| Template | Adapter | Returns |
|----------|---------|---------|
| `entity://nodes/{node_id}` | `entity` | The node as JSON |
| `context://blobs/{blob_key}` | `context` | The blob, base64 in `blob`, with its content type |
| `telemetry://requests/{request_id}` | `telemetry` | All telemetry events whose trace ID equals `request_id` |

### Prompts

The unified server offers five built-in prompts that produce a short, step-by-step plan using gateway tools: `list_tools_by_adapter`, `debug_request`, `explore_entity_graph`, `ingest_and_query`, and `data_analysis`. `list_tools_by_adapter` is generated live from the connected adapters; the others are static templates. See the [Tools Catalog](./tools.md#prompts).

## Caller Identity and Tracing

Every HTTP request passes through a middleware that reads three optional headers:

| Header | Purpose |
|--------|---------|
| `X-Trace-Id` | Trace ID to continue; a new UUID is generated when absent |
| `X-Span-Id` | Caller's span; becomes the parent span of the gateway's own span |
| `X-On-Behalf-Of` | Caller identity in the form `app=<application-id>; bundle=<agent-bundle-id>; user=<user-id>` (`user` optional) |

A well-formed `X-On-Behalf-Of` value (both `app` and `bundle` present) is parsed and stored in the request's async context so downstream FireFoundry client calls made during the request can carry it. The Skills adapter explicitly forwards it as an `X-On-Behalf-Of` header on its calls to the Skills Service, which uses it for environment-scoped skill resolution.

Downstream **credentials** are not per-caller: the gateway authenticates to backing services with its own configuration (for example the single `API_KEY`, which is also forwarded to several services — see [Operations](./operations.md#security)).

## Result Caching

The unified server keeps an in-memory cache of successful results for tools whose names start with a read-only prefix (`entity_get_`, `entity_search_`, `context_get_`, `context_list_`, `context_fetch_`, `telemetry_get_`, `telemetry_search_`, `das_get_`, `das_query`, `das_list_`, `das_ontology_`, `das_resolve_`, `kb_list_`, `kb_get_`, `kb_query`, `docproc_extract_`). Entries live for 60 seconds, the cache holds at most 1,000 entries, and error results are never cached.

The cache key is the tool name plus its arguments — it does **not** include the caller identity. Two callers issuing the same read within a minute receive the same result. If your backing services return caller-specific data for identical arguments, use the per-adapter endpoints (which do not cache).

## Admin Configuration Records

With `DATABASE_ENABLED=true`, the gateway stores configuration in the `mcp_gateway` PostgreSQL schema and exposes it through the admin API:

- **Adapter configuration** (`adapter_config`) — an `enabled` flag per adapter
- **Tool configuration** (`tool_config`) — an `enabled` flag and optional `rate_limit_per_minute` per tool
- **External services** (`external_services`) — a catalog of outbound integrations (MCP servers, webhooks, REST, gRPC endpoints) with a connectivity test
- **Inbound APIs** (`inbound_apis`) — a catalog of inbound API definitions

> **Important:** In the current version these records are **stored and reported only**. The MCP request path does not consult the adapter/tool `enabled` flags or enforce `rate_limit_per_minute`, and the gateway does not route traffic to registered external services. Whether an adapter is active is controlled by its environment variables. Treat these records as configuration metadata for tooling such as the FireFoundry Console.

## A2A Protocol Support (Optional)

When `A2A_ENABLED=true`, the gateway also acts as an **A2A agent**:

- It publishes an **Agent Card** at `/.well-known/a2a-agent-card` (and the older `/.well-known/agent-card.json`). Each connected adapter becomes one skill, with ID `firefoundry-<adapter>` and a description that lists the adapter's tools.
- It accepts A2A JSON-RPC requests at `POST /a2a`. A `message/send` or `message/stream` whose text part is JSON of the form `{"tool": "<tool-name>", "arguments": {...}}` (or a data part with the same fields) runs that MCP tool and returns the result as a text artifact. A message that does not name a tool returns the list of available tools.
- Task history is kept in memory and exposed at `GET /a2a/tasks`; tasks can be cancelled with `POST /a2a/tasks/{id}/cancel`.

The opposite direction — calling *remote* A2A agents as MCP tools — is the `a2a-client` adapter described above.

## How the Gateway Interacts with Other Services

```
                ┌──────────────── MCP Gateway ─────────────────┐
  MCP client ──►│ /mcp  or  /mcp/<adapter>                     │
                │    │                                          │
                │    ├─ entity ─────── REST ──► Entity Service  │
                │    ├─ context ────── gRPC ──► Context Service │
                │    ├─ docproc ────── REST ──► Doc Processing  │
                │    ├─ telemetry ──── HTTP ──► Telemetry       │
                │    ├─ sandbox ────── REST ──► Code Sandbox    │
                │    ├─ websearch ──── REST ──► Web Search      │
                │    ├─ dataaccess ─── HTTP ──► Data Access     │
                │    ├─ knowledgebase  REST ──► KB ingestion/RAG│
                │    ├─ skills ─────── REST ──► Skills Service  │
                │    ├─ grpc ───────── gRPC ──► your backends   │
                │    └─ a2a-client ─── A2A ───► remote agents   │
                └──────────────────────────────────────────────┘
```

- **Entity Service** — the entity adapter uses the entity client with the configured `AGENT_BUNDLE_ID` (and optional `ENTITY_GRAPH_NAME`); nodes are created and read in that bundle's scope.
- **Telemetry Service** — besides the read tools, the gateway writes one `mcp_tool_call` event per tool call made through a per-adapter endpoint (tool, adapter, duration, error flag), linked to the caller's trace.
- **Entitlement agent** — the `mcp.access` entitlement is evaluated for MCP serving routes and A2A task execution; see [Operations](./operations.md#entitlements).

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Connecting Clients](./clients.md)
- [Tools Catalog](./tools.md)
- [Reference](./reference.md)
