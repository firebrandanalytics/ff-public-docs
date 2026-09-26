# MCP Gateway — Operations

How to enable and configure the MCP Gateway for your app, verify it from your agents, the limits to design around, and caller-side troubleshooting.

## Enabling the Gateway

The MCP Gateway is part of `firefoundry-core` and is **enabled by default** (`mcp-gateway.enabled: true`). With the default release name, it is reachable in-cluster at:

```
http://firefoundry-core-mcp-gateway.<namespace>.svc.cluster.local:8080
```

It is a cluster-internal service. From a developer machine, use port-forwarding:

```bash
kubectl port-forward svc/firefoundry-core-mcp-gateway -n <namespace> 8080:8080
```

## Getting the API Key

Every MCP and admin request needs the `X-Api-Key` header. The key is the `mcp-gateway.secret.data.API_KEY` value in your environment's `firefoundry-core` Helm values; your environment administrator can provide it. Keep it in an environment variable or secret store, never in committed client configuration.

## Enabling Adapters for Your App

Out of the box the `entity`, `context`, `docproc`, `sandbox`, and `websearch` adapters are active. `telemetry`, `dataaccess`, `knowledgebase`, `skills`, `grpc`, and `a2a-client` are off until their settings are added.

For the entity tools to work against your app, the gateway must be told which agent bundle (and optionally which graph) to act as. Example overrides:

```yaml
mcp-gateway:
  secret:
    data:
      AGENT_BUNDLE_ID: "<your-agent-bundle-id>"
      ENTITY_GRAPH_NAME: ""
      TELEMETRY_SERVICE_URL: "http://firefoundry-core-telemetry-service:3000"
      SKILLS_SERVICE_URL: "http://firefoundry-core-skills-service:8080"
      DATA_ACCESS_SERVICE_URL: "http://firefoundry-core-data-access:8080"
```

Service names and ports above assume the release is called `firefoundry-core` with chart-default ports; confirm with `kubectl get svc -n <namespace>`. The full list of settings is in [Reference — Settings](./reference.md#settings). Changes take effect when the gateway restarts.

Because entity tools act as one configured bundle, the gateway is best suited to one primary app per environment for entity work. If several bundles share an environment, have their agents use the Entity Service through the SDK for bundle-specific writes.

### Optional features

| Feature | Settings | Notes |
|---------|----------|-------|
| Your own gRPC tools | `GRPC_BACKENDS_ENABLED: "true"`, `GRPC_BACKENDS_CONFIG_PATH` | Mount the backend JSON file and `.proto` files (for example from a ConfigMap). See [Registering your own tools](./reference.md#registering-your-own-tools) |
| Remote A2A agents as tools | `A2A_REMOTE_AGENTS` | JSON array of `{url, name, apiKey?}` |
| Gateway as an A2A agent | `A2A_ENABLED: "true"`, `A2A_AUTH_REQUIRED: "true"`, `A2A_BASE_URL` | Always turn on `A2A_AUTH_REQUIRED` with A2A |

To turn a flag off, remove the setting rather than setting it to `"false"`.

## Verifying from Your App

```bash
curl -s localhost:8080/mcp | jq '.unified.toolCount, [.servers[] | {name, status}]'
```

| Endpoint | What it tells you |
|----------|-------------------|
| `GET /health` | The gateway is up |
| `GET /ready` | `{"ready": true}` once adapters have started |
| `GET /status` | Per-adapter `enabled`, `connected`, `error`, and call counts |
| `GET /mcp` | Per-adapter endpoint, status, and tool names |

An adapter showing `connected` does not prove the backing service answers. Confirm end-to-end by calling one cheap read tool per adapter your app relies on — for example `das_get_connections`, `kb_list_embedding_models`, `skills_list`, `telemetry_get_recent_requests`. To confirm reachability from a bundle, run the same `curl` (with the in-cluster URL) from the bundle's pod.

## Limits and Behavior to Design Around

- **Request size** — request bodies up to 50 MB. Documents travel base64-encoded (about 33% larger than the file). For large files, store them via the Context Service and pass references.
- **Stateless requests** — every JSON-RPC message stands alone; there is no session. Batch arrays and server-initiated messages are not supported.
- **Read freshness on `/mcp`** — read-only tool results on the unified endpoint can be up to 60 seconds old and are shared by callers sending identical arguments. Use a per-adapter endpoint for read-after-write or caller-specific data.
- **Tracing** — only per-adapter endpoints forward your trace headers and record `mcp_tool_call` telemetry events; view them with the telemetry tools or [ff-telemetry-read](../../../sdk/cli-tools/ff-telemetry-read.md).
- **No per-tool authorization** — every key holder can call every active tool, including writes, code execution, and SQL. Limit exposure with per-adapter URLs and by enabling only the adapters you need. Data Access Service permissions still apply to `das_` tools.
- **Runtime registrations** — gRPC backends and A2A agents added through the admin API live on one replica and are lost on restart; put anything you rely on in the startup configuration.
- **Timeouts** — gRPC calls default to 30 s (`requestTimeoutMs`); remote A2A calls time out at 30 s and are retried up to three times on 408/429/502/503/504.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Missing X-Api-Key header` | Client not sending the key | Add `X-Api-Key` to the client configuration |
| `403 Invalid API key` | Wrong key | Get the current key from your environment administrator |
| `tools/list` is empty or missing an adapter | Adapter not enabled in this environment | Check `GET /status` / `GET /mcp`; add the adapter's setting ([Reference — Settings](./reference.md#settings)) |
| `503 MCP server not available: <adapter>` | Adapter not enabled, or failed to start | See `error` for that adapter in `GET /status` |
| `404 MCP server not found: <adapter>` | Typo in adapter name | Use a name from `GET /mcp` (e.g. `knowledgebase`, `a2a-client`) |
| JSON-RPC `-32000 Tool not found` on `/mcp` for a gRPC/A2A tool you just registered | Runtime registrations are not on the unified endpoint until restart | Call it through `/mcp/grpc` or `/mcp/a2a-client`, or add it to the startup configuration |
| Entity tools return errors about the bundle or graph | Gateway not configured with your agent bundle / graph | Set `AGENT_BUNDLE_ID` / `ENTITY_GRAPH_NAME` ([above](#enabling-adapters-for-your-app)) |
| Tool result has `isError: true` with a connection error | Backing service URL wrong or service down | Verify the service is running and the adapter's setting points at it |
| A read tool returns data you just changed | Unified endpoint read results can be up to 60 s old | Use the per-adapter endpoint for that read |
| Tool calls missing from your request's trace | Calls went through `/mcp` | Use `/mcp/<adapter>` and send `X-Trace-Id` / `X-Span-Id` |
| Claude Code (or another client) cannot connect | Client using legacy SSE transport, or URL missing `/mcp` | Use the HTTP transport and the full `…/mcp` URL (see [Connecting Clients](./clients.md)) |
| Request rejected for a large document | Body over 50 MB | Split the document, or store it via the Context Service and pass a reference |
| A2A tasks missing from `/a2a/tasks` | Task history is per replica | Query from the same replica, or track results from the `message/send` response |

## Related

- [Overview](./README.md)
- [Reference](./reference.md)
- [Connecting Clients](./clients.md)
- [Local chart reference](../../../../ff_local_dev/chart-reference.md)
- [Platform Operations](../../operations.md)
