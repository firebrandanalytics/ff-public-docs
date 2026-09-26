# MCP Gateway — Connecting Clients

This page shows how different kinds of clients connect to and authenticate with the MCP Gateway: external MCP clients such as Claude Code, Virtual Workers, agent bundles and other in-cluster callers, and A2A agents.

## What Every Client Needs

| Item | Value |
|------|-------|
| **Endpoint** | `POST /mcp` for all tools, or `POST /mcp/<adapter>` for one adapter (see [Concepts](./concepts.md#unified-vs-per-adapter-endpoints)) |
| **In-cluster URL** | `http://firefoundry-core-mcp-gateway.<namespace>.svc.cluster.local:8080/mcp` (default release name `firefoundry-core`) |
| **Authentication** | `X-Api-Key: <key>` header (see [Getting the API key](./operations.md#getting-the-api-key)) |
| **Content type** | `Content-Type: application/json`; body is a single JSON-RPC 2.0 message |
| **Optional headers** | `X-On-Behalf-Of`, `X-Trace-Id`, `X-Span-Id` (see [Identity and tracing headers](#identity-and-tracing-headers)) |

### Transport compatibility

The gateway implements the request/response part of MCP over HTTP:

- Each `POST` carries one JSON-RPC message and receives one `application/json` response (`204 No Content` for notifications).
- There is no `Mcp-Session-Id`; every request stands alone.
- `GET /mcp` returns a JSON discovery document, not an event stream. `GET /mcp/<adapter>` opens a Server-Sent Events stream that only emits `open` and periodic `ping` events — it is not the legacy MCP "HTTP+SSE" transport.
- JSON-RPC batch arrays are not accepted.

Configure clients for the **HTTP** (streamable HTTP) transport. Clients that only support the legacy SSE transport, or that depend on server-initiated messages, will not work.

### Authentication

Authentication is a single shared API key for the environment:

- a request without `X-Api-Key` gets `401 {"error":"Missing X-Api-Key header"}`,
- a request with a wrong key gets `403 {"error":"Invalid API key"}`.

There is no per-user authentication or per-tool authorization at the gateway — every holder of the key sees every active tool, including write-capable ones (entity writes, working-memory deletes, code execution, SQL queries). Give narrower clients a per-adapter URL, keep the key out of source control, and reach the gateway over the cluster network or `kubectl port-forward`.

## Claude Code and Other External MCP Clients

For a developer machine, port-forward the service first:

```bash
kubectl port-forward svc/firefoundry-core-mcp-gateway -n ff-dev 8080:8080
```

### Claude Code

Add the gateway as an HTTP MCP server:

```bash
claude mcp add --transport http firefoundry http://localhost:8080/mcp \
  --header "X-Api-Key: $FF_MCP_API_KEY"
```

Or check a project-scoped `.mcp.json` into your repository, keeping the key in an environment variable:

```json
{
  "mcpServers": {
    "firefoundry": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "X-Api-Key": "${FF_MCP_API_KEY}" }
    },
    "firefoundry-telemetry": {
      "type": "http",
      "url": "http://localhost:8080/mcp/telemetry",
      "headers": { "X-Api-Key": "${FF_MCP_API_KEY}" }
    }
  }
}
```

The second entry is an example of a narrow, single-adapter connection — useful for a debugging session that should only see telemetry tools. After connecting, the client lists the tools (for example `entity_get_node`, `telemetry_get_request_trace`) and the prompts from the unified endpoint.

### Other MCP clients

Any client that supports the MCP HTTP transport and custom headers can be configured the same way: URL `…/mcp` (or `…/mcp/<adapter>`) plus the `X-Api-Key` header. For programmatic access from TypeScript, use the official MCP SDK:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://firefoundry-core-mcp-gateway.ff-dev.svc.cluster.local:8080/mcp"),
  { requestInit: { headers: { "X-Api-Key": process.env.FF_MCP_API_KEY! } } },
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({
  name: "websearch_search",
  arguments: { query: "FireFoundry MCP", limit: 5 },
});
console.log(result.content);
```

## Virtual Workers

[Virtual Workers](../virtual-workers/README.md) reach platform services through the MCP Gateway. MCP connections are part of a worker's definition (`mcpServers`, each with a `name` and a `url`) and are wired into the CLI agent when a session starts. Point the URL at the gateway's MCP endpoint, not just the host:

```json
"mcpServers": [
  { "name": "ff-gateway", "url": "http://firefoundry-core-mcp-gateway.ff-dev.svc.cluster.local:8080/mcp" }
]
```

Use `…/mcp/<adapter>` to give a worker only one service's tools. The worker's MCP connection must also send the `X-Api-Key` header; see the [Virtual Worker Manager reference](../virtual-workers/reference.md) for how your version supplies credentials for MCP connections.

## Agent Bundles and Other In-Cluster Callers

Agent bundles and other in-cluster components can call the gateway directly over HTTP. Forward the caller identity and trace context so downstream services and telemetry can attribute the work:

```bash
curl -s -X POST http://firefoundry-core-mcp-gateway.ff-dev.svc.cluster.local:8080/mcp/context \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $MCP_KEY" \
  -H "X-On-Behalf-Of: app=<application-id>; bundle=<agent-bundle-id>; user=<user-id>" \
  -H "X-Trace-Id: <trace-id>" \
  -H "X-Span-Id: <parent-span-id>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"context_fetch_wm_by_entity","arguments":{"entity_node_id":"<node-id>"}}}'
```

Code that already uses the FireFoundry client libraries (entity client, context client, and so on) should normally keep calling those services directly; the gateway is most useful where the caller is an LLM agent that benefits from MCP discovery. The [FF Broker](../ff-broker/README.md)'s optional MCP integration is one such consumer: MCP servers registered with the broker have their tools listed and executed through the broker's `/api/mcp/*` endpoints.

### Identity and tracing headers

| Header | Format | Effect |
|--------|--------|--------|
| `X-On-Behalf-Of` | `app=<id>; bundle=<id>; user=<id>` (`user` optional) | Carried to downstream calls; the Skills adapter uses it to resolve skills in the caller's scope. Ignored if `app` or `bundle` is missing. |
| `X-Trace-Id` | Any string (UUID or W3C trace ID) | Trace to continue; generated if absent |
| `X-Span-Id` | Any string | Recorded as the parent of the gateway's span |

Trace headers are forwarded to backing services and recorded in an `mcp_tool_call` telemetry event only on per-adapter endpoints; use those when you need calls to show up under your request's trace.

## A2A Clients

When A2A is enabled on the gateway (see [Operations](./operations.md#optional-features)), agents that speak the A2A protocol can use the gateway's tools without MCP.

**1. Discover the agent card** (always public):

```bash
curl -s http://localhost:8080/.well-known/a2a-agent-card | jq '{name, protocolVersion, skills: [.skills[].id]}'
```

```json
{
  "name": "FireFoundry MCP Gateway",
  "protocolVersion": "1.0",
  "skills": ["firefoundry-entity", "firefoundry-context", "firefoundry-docproc", "firefoundry-websearch"]
}
```

**2. Send a task** naming a tool and its arguments as JSON text:

```bash
curl -s -X POST http://localhost:8080/a2a \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $MCP_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": {
      "message": {
        "kind": "message", "messageId": "msg-1", "role": "user",
        "parts": [{ "kind": "text", "text": "{\"tool\":\"entity_get_node\",\"arguments\":{\"node_id\":\"<node-id>\"}}" }]
      }
    }
  }'
```

The response is an A2A task whose artifact contains the tool's text result. A message that does not name a tool returns the list of available tools as an artifact.

**Authentication for A2A:** `/a2a` requires `X-Api-Key` only when the gateway's `A2A_AUTH_REQUIRED` setting is on. Without it, anyone who can reach the gateway can run tools over A2A — turn it on whenever you enable A2A. The Agent Card is always public. See [Reference — A2A endpoints](./reference.md#a2a-endpoints).

## Related

- [Getting Started](./getting-started.md) — Try every call with curl
- [Tools Catalog](./tools.md) — What each tool does and its arguments
- [Operations](./operations.md)
- [Virtual Worker Manager](../virtual-workers/README.md)
