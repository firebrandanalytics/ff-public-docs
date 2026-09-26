# MCP Gateway — Getting Started

This guide walks through talking to the MCP Gateway with nothing but `curl`: checking which adapters are connected, running the MCP handshake, listing tools, calling a tool, reading a resource, and using a per-adapter endpoint. Once this works, see [Connecting Clients](./clients.md) to plug the gateway into Claude Code or a Virtual Worker.

## Prerequisites

- A FireFoundry environment with the `mcp-gateway` chart enabled (it is enabled by default in `firefoundry-core`), or the gateway running locally
- At least one backing service configured — for example the Entity Service (`ENTITY_SERVICE_URL` plus `AGENT_BUNDLE_ID`)
- The gateway API key, if `API_KEY` is set (the Helm chart sets it; see [Operations](./operations.md#configuration))
- `curl` and, optionally, `jq`

## Step 1: Reach the Gateway

The gateway is a `ClusterIP` service on port 8080. With the default release name `firefoundry-core` and the local-dev namespace `ff-dev`:

```bash
kubectl port-forward svc/firefoundry-core-mcp-gateway -n ff-dev 8080:8080
```

From inside the cluster, use `http://firefoundry-core-mcp-gateway.<namespace>.svc.cluster.local:8080` instead of `http://localhost:8080`.

Export the API key for the rest of this guide:

```bash
export MCP_URL=http://localhost:8080
export MCP_KEY=<your-gateway-api-key>
```

## Step 2: Check Health and Adapter Status

```bash
curl -s $MCP_URL/health
# {"status":"healthy","timestamp":"2026-09-26T12:00:00.000Z"}

curl -s $MCP_URL/ready
# {"ready":true}
```

`GET /status` shows which adapters are connected (no API key needed):

```bash
curl -s $MCP_URL/status | jq '.adapters | map_values({enabled, connected, toolCount})'
```

```json
{
  "entity":        { "enabled": true,  "connected": true,  "toolCount": 7 },
  "context":       { "enabled": true,  "connected": true,  "toolCount": 13 },
  "docproc":       { "enabled": true,  "connected": true,  "toolCount": 5 },
  "telemetry":     { "enabled": false, "connected": false, "toolCount": 9 },
  "sandbox":       { "enabled": true,  "connected": true,  "toolCount": 1 },
  "websearch":     { "enabled": true,  "connected": true,  "toolCount": 3 },
  "dataaccess":    { "enabled": false, "connected": false, "toolCount": 7 },
  "knowledgebase": { "enabled": false, "connected": false, "toolCount": 7 },
  "grpc":          { "enabled": false, "connected": false, "toolCount": 0 },
  "a2a-client":    { "enabled": false, "connected": false, "toolCount": 0 },
  "skills":        { "enabled": false, "connected": false, "toolCount": 3 }
}
```

An adapter with `enabled: false` has no configuration; one with `enabled: true, connected: false` failed to initialize — check the `error` field and the pod logs.

## Step 3: Discover the MCP Endpoints

`GET /mcp` is a discovery document (not an MCP call) listing the unified endpoint and each per-adapter endpoint:

```bash
curl -s $MCP_URL/mcp | jq '{unified, servers: [.servers[] | {name, endpoint, status, toolCount}]}'
```

```json
{
  "unified": {
    "endpoint": "/mcp",
    "method": "POST",
    "description": "Unified MCP endpoint — all tools, resources, and prompts via a single connection",
    "toolCount": 29,
    "promptCount": 5
  },
  "servers": [
    { "name": "entity",  "endpoint": "/mcp/entity",  "status": "connected", "toolCount": 7 },
    { "name": "context", "endpoint": "/mcp/context", "status": "connected", "toolCount": 13 },
    { "name": "telemetry", "endpoint": "/mcp/telemetry", "status": "disabled", "toolCount": 0 }
  ]
}
```

## Step 4: Initialize an MCP Session

MCP clients begin with `initialize`. All MCP calls are `POST` with a JSON-RPC 2.0 body and the `X-Api-Key` header:

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": { "listChanged": false },
      "resources": { "subscribe": false, "listChanged": false },
      "prompts": { "listChanged": false },
      "logging": {},
      "completions": {}
    },
    "serverInfo": { "name": "firefoundry-mcp-gateway", "version": "1.0.0" }
  }
}
```

Then send the `initialized` notification (no `id`); the gateway answers `204 No Content`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
# 204
```

The gateway is stateless between requests — there is no session ID — so you can skip straight to `tools/list` in scripts.

## Step 5: List Tools

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | jq '.result.tools[] | select(.name=="entity_get_node")'
```

```json
{
  "name": "entity_get_node",
  "description": "Retrieve a node from the knowledge graph by its ID",
  "inputSchema": {
    "type": "object",
    "properties": {
      "node_id": { "type": "string", "description": "The unique identifier of the node to retrieve" }
    },
    "required": ["node_id"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

To page through a long list, pass a cursor: the first request with `"params":{"cursor":"MA=="}` (base64 of `0`) returns 50 tools and a `nextCursor`; repeat with that value until `nextCursor` is absent. Without a cursor the full list is returned.

## Step 6: Call a Tool

Create a node, then read it back:

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {
      "name": "entity_create_node",
      "arguments": { "node_class": "Document", "name": "Q3 report", "data": { "status": "draft" } }
    }
  }' | jq -r '.result.content[0].text'
```

The result's `content[0].text` is the Entity Service response as pretty-printed JSON. Use the returned node `id`:

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call",
       "params":{"name":"entity_get_node","arguments":{"node_id":"<node-id>"}}}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      { "type": "text", "text": "{\n  \"id\": \"<node-id>\",\n  \"name\": \"Q3 report\",\n  ... }" }
    ]
  }
}
```

If the tool fails downstream, the response still has a `result`, with `"isError": true` and the error message in the text. An unknown tool name returns a JSON-RPC error with code `-32000`.

## Step 7: Read a Resource

Resource templates give URI-style access to the same data:

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/templates/list"}' | jq '.result.resourceTemplates[].uriTemplate'

curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":6,"method":"resources/read","params":{"uri":"entity://nodes/<node-id>"}}' \
  | jq -r '.result.contents[0].text'
```

## Step 8: Use a Prompt

```bash
curl -s -X POST $MCP_URL/mcp \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":7,"method":"prompts/get",
       "params":{"name":"explore_entity_graph","arguments":{"node_id":"<node-id>"}}}' \
  | jq -r '.result.messages[1].content.text'
```

The prompt returns a user/assistant message pair that an agent can use as a plan.

## Step 9: Scope a Client to One Adapter

Every connected adapter also has its own MCP server. The same JSON-RPC calls work against `/mcp/<adapter>`, but only that adapter's tools are visible:

```bash
curl -s -X POST $MCP_URL/mcp/entity \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -H "X-Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/list"}' | jq '[.result.tools[].name]'
```

```json
[
  "entity_get_node", "entity_create_node", "entity_update_node", "entity_archive_node",
  "entity_get_connected", "entity_create_edge", "entity_search_by_embedding"
]
```

Per-adapter endpoints are not cached, pass your trace headers through to the adapter, and record an `mcp_tool_call` telemetry event for each `tools/call` when the telemetry adapter is connected.

## Next Steps

- **[Connecting Clients](./clients.md)** — Configure Claude Code, Virtual Workers, and other MCP clients
- **[Tools Catalog](./tools.md)** — Arguments and behavior of every tool
- **[Reference](./reference.md)** — All endpoints, MCP methods, error codes, and environment variables
- **[Operations](./operations.md)** — Enable more adapters, secure the gateway, troubleshoot
