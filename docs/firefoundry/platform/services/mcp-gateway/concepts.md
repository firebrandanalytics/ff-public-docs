# MCP Gateway — Concepts

This page explains the mental model you need to give AI agents access to FireFoundry through the MCP Gateway: what an adapter is, when to use the unified or a per-adapter endpoint, what tool results look like, how identity and tracing flow, how to add your own tools, and where A2A fits.

## MCP in One Paragraph

The Model Context Protocol (MCP) is a JSON-RPC 2.0 protocol that lets an AI client discover and use capabilities offered by a server. A server advertises three kinds of things:

| MCP concept | What it is | Gateway example |
|-------------|-----------|-----------------|
| **Tool** | A named operation with a JSON Schema for its arguments; the client calls it with `tools/call` | `entity_get_node`, `websearch_search` |
| **Resource** | Readable content addressed by a URI; the client reads it with `resources/read` | `entity://nodes/{node_id}` |
| **Prompt** | A reusable, parameterized message template; the client fetches it with `prompts/get` | `debug_request` |

The gateway implements MCP protocol version `2024-11-05` over plain HTTP: the client POSTs one JSON-RPC message and receives one JSON response.

## Adapters

An **adapter** exposes one FireFoundry service as MCP tools. Each adapter has a name (used in URLs such as `/mcp/entity`), a set of tools with a common prefix, and optionally resource templates. An adapter is active only when its service is configured for the gateway in your environment (see [Operations](./operations.md#enabling-adapters-for-your-app)).

| Adapter | Backing service | Tools |
|---------|-----------------|-------|
| `entity` | [Entity Service](../entity-service/README.md) | 7 |
| `context` | [Context Service](../context-service/README.md) | 13 |
| `docproc` | [Document Processing](../doc-proc-service/README.md) | 5 |
| `telemetry` | [Telemetry Service](../telemetry-service/README.md) | 9 |
| `sandbox` | [Code Sandbox](../code-sandbox/README.md) | 1 |
| `websearch` | [Web Search](../web-search/README.md) | 3 |
| `dataaccess` | [Data Access Service](../data-access/README.md) | 7 |
| `knowledgebase` | Earlier standalone KB ingestion and RAG query APIs (not the current Knowledge Service — see [Tools](./tools.md#knowledge-base-adapter)) | 7 |
| `skills` | [Skills Service](../skills-service/README.md) | 3 |
| `grpc` | Your own gRPC services | dynamic |
| `a2a-client` | Remote A2A agents | dynamic |

The full tool list is in the [Tools Catalog](./tools.md). `GET /status` and `GET /mcp` show which adapters are active on a running gateway; `tools/list` is always the source of truth.

A misconfigured service URL usually does not stop the adapter from appearing — it surfaces on the first tool call as an error result. Smoke-test with one cheap read tool per adapter you rely on.

## Unified vs. Per-Adapter Endpoints

| | Unified `POST /mcp` | Per-adapter `POST /mcp/<adapter>` |
|---|---|---|
| Tools and resources | Every active adapter | One adapter |
| Prompts, `completion/complete` | Yes | No |
| `tools/list` pagination | Optional cursor, 50 per page | Full list |
| Read results | Read-only tools may return a result up to 60 s old | Always fresh |
| Trace headers forwarded to the backing service | No | Yes |
| `mcp_tool_call` telemetry event per call | No | Yes (when telemetry is enabled) |

**Choose the unified endpoint** for general-purpose agents that should see everything, such as a developer's Claude Code session exploring an environment.

**Choose a per-adapter endpoint** when:

- the agent should only see a narrow tool set (a debugging agent that only needs `telemetry`, a research worker that only needs `websearch`) — this is also the main way to limit what a client can do, since the gateway has no per-tool authorization;
- you want each tool call traced and recorded in telemetry under the caller's trace;
- the agent must see fresh data immediately after writing it, or backing services return caller-specific data for the same arguments (unified read results are shared between callers with identical arguments for up to 60 seconds).

An agent can connect to several per-adapter endpoints at once (for example `/mcp/entity` and `/mcp/context`) to get a curated tool set with fresh reads and tracing.

## Tool Results

Every tool returns an MCP `CallToolResult`: a `content` array with one text item. For almost all tools the text is pretty-printed JSON of the backing service's response. `skills_read_file` returns raw file text, and `a2a-client` tools return the remote agent's text.

A failure inside a tool (bad arguments, downstream error) comes back as a normal result with `isError: true` and the error message as text — not as a JSON-RPC error. JSON-RPC errors are reserved for protocol problems such as an unknown method or an unknown tool name (see [Reference](./reference.md#json-rpc-error-codes)). Design agents to read `isError` and recover.

Binary data (documents, blobs, generated PDFs) travels as **base64** strings inside JSON arguments and results. Request bodies are limited to 50 MB; for large files, store them via the Context Service and pass references.

### Resources

Resource templates give URI-style read access:

| Template | Adapter | Returns |
|----------|---------|---------|
| `entity://nodes/{node_id}` | `entity` | The node as JSON |
| `context://blobs/{blob_key}` | `context` | The blob, base64 in `blob`, with its content type |
| `telemetry://requests/{request_id}` | `telemetry` | All telemetry events for that trace ID |

### Prompts

The unified endpoint offers five prompts that produce a short, step-by-step plan using gateway tools: `list_tools_by_adapter`, `debug_request`, `explore_entity_graph`, `ingest_and_query`, and `data_analysis`. See the [Tools Catalog](./tools.md#prompts).

## Identity and Tracing

Clients can send three optional headers on every request:

| Header | Purpose |
|--------|---------|
| `X-On-Behalf-Of` | Caller identity: `app=<application-id>; bundle=<agent-bundle-id>; user=<user-id>` (`user` optional). Ignored unless both `app` and `bundle` are present. |
| `X-Trace-Id` | Trace to continue; a new one is generated when absent |
| `X-Span-Id` | Caller's span; becomes the parent of the gateway's span |

`X-On-Behalf-Of` is carried to downstream service calls; the Skills adapter uses it so skill resolution respects the caller's application and environment scope. Always send it from agent bundles and Virtual Workers so work is attributed correctly.

**Access is not per-caller.** The gateway authenticates clients with a single shared API key, and it calls backing services with its own configured credentials. Every key holder sees every active tool. Entity tools act in the scope of the agent bundle configured for the gateway (see [Operations](./operations.md#enabling-adapters-for-your-app)), not the caller's bundle.

## Bringing Your Own Tools

Two adapters build their tools from registrations instead of a fixed list, so an app team can put its own capabilities next to the platform's:

- **`grpc`** — register a gRPC service with a `.proto` file and a list of *tool mappings* from an MCP tool name to a gRPC method. Unary and server-streaming methods are supported; server reflection is not.
- **`a2a-client`** — register a remote A2A agent by URL. The gateway reads its agent card and turns every skill into an MCP tool named `a2a:<agent-name>:<skill-id>`.

Register them in the gateway's startup configuration (persistent) or through the admin API (in memory, lost on restart). Tools registered through the admin API after startup are callable only on the per-adapter endpoint (`/mcp/grpc` or `/mcp/a2a-client`) until the gateway restarts, and only if that adapter was enabled at startup. See [Reference — Registering your own tools](./reference.md#registering-your-own-tools).

## A2A Protocol Support (Optional)

When A2A is enabled, the gateway also acts as an **A2A agent**:

- It publishes an **Agent Card** at `/.well-known/a2a-agent-card` (and `/.well-known/agent-card.json`). Each active adapter becomes one skill, `firefoundry-<adapter>`.
- It accepts A2A `message/send` and `message/stream` at `POST /a2a`. A message whose text (or data part) is `{"tool": "<tool-name>", "arguments": {...}}` runs that tool and returns the result as a text artifact. A message that does not name a tool returns the list of available tools.

Use this when an A2A-native agent needs FireFoundry tools without an MCP client. The opposite direction — calling remote A2A agents as MCP tools — is the `a2a-client` adapter.

## Designing Your App Around the Gateway

- **Coding agents against a dev environment** — a developer connects Claude Code to `/mcp` to inspect entities, telemetry, and working memory while building a bundle. Add a second, per-adapter connection (for example `/mcp/telemetry`) for focused debugging sessions.
- **Virtual Workers** — give each worker definition only the per-adapter endpoints its job needs. A document-review worker might get `/mcp/docproc`, `/mcp/context`, and `/mcp/entity`.
- **LLM agents inside a bundle** — when a bot needs open-ended tool use across services, point its MCP client at the gateway and forward `X-On-Behalf-Of` and trace headers. Deterministic code paths should still use the SDK directly.
- **Exposing app capabilities to agents** — register your app's gRPC service with the `grpc` adapter so every agent that already uses the gateway can call it, with no per-agent integration.

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Connecting Clients](./clients.md)
- [Tools Catalog](./tools.md)
- [Reference](./reference.md)
