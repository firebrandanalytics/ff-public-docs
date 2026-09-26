# MCP Gateway — Operations

Deployment, configuration, health checks, scaling, security, monitoring, and troubleshooting for the MCP Gateway.

## Deployment

### Helm chart

The gateway ships as the `mcp-gateway` chart (chart version 0.1.2) and is a dependency of the `firefoundry-core` umbrella chart, where it is **enabled by default** (`mcp-gateway.enabled: true`). With the default release name the Kubernetes service is `firefoundry-core-mcp-gateway`, a `ClusterIP` service on port 8080.

Key values (under `mcp-gateway:` in `firefoundry-core` values):

| Value | Default | Purpose |
|-------|---------|---------|
| `enabled` | `true` | Deploy the gateway |
| `replicaCount` | `1` | Pod replicas (ignored when autoscaling is on) |
| `image.repository` / `image.tag` | registry path / `0.1.2` | Container image |
| `configMap.data.*` | see below | Non-secret environment variables |
| `secret.data.*` | see below | Secret environment variables (service URLs, `API_KEY`, bundle ID) |
| `envFrom` / `global.envFrom` | `[]` | Extra ConfigMaps/Secrets to load (e.g. shared `PG_*` settings) |
| `service.http.port` | `8080` | Service and container port |
| `livenessProbe.httpGet.path` | `/health` | Liveness probe |
| `readinessProbe.httpGet.path` | `/health` | Readiness probe (consider `/ready`; see [Health Checks](#health-checks)) |
| `resources` | requests `100m`/`256Mi`, limits `500m`/`512Mi` | Pod resources |
| `autoscaling.enabled` | `false` | HorizontalPodAutoscaler (min 1, max 10, 80% CPU) |
| `ingress.enabled` | `false` | Expose outside the cluster |
| `global.externalAccess` | `false` | Platform external-access flag |

Default `configMap.data`:

```yaml
NODE_ENV: "production"
PORT: "8080"
LOG_LEVEL: "info"
SERVICE_NAME: "mcp-gateway"
MCP_SERVER_NAME: "firefoundry-mcp-gateway"
MCP_SERVER_VERSION: "1.0.0"
ENTITY_CLIENT_MODE: "internal"
DATABASE_ENABLED: "false"
```

Default `secret.data` in `firefoundry-core` wires the adapters to the in-release services:

| Key | Default | Notes |
|-----|---------|-------|
| `ENTITY_SERVICE_URL` | `http://firefoundry-core-entity-service:8080` | |
| `AGENT_BUNDLE_ID` | placeholder | **Set** to the agent bundle ID the entity tools should act as |
| `ENTITY_GRAPH_NAME` | placeholder | Set to your graph name, or remove |
| `CONTEXT_SERVICE_ADDRESS` | `firefoundry-core-context-service:50051` | |
| `CONTEXT_SERVICE_ENVIRONMENT` | `production` | |
| `DOC_PROC_SERVICE_URL` | `http://firefoundry-core-doc-proc-service:8081` | |
| `SANDBOX_SERVICE_URL` | `http://firefoundry-core-code-sandbox:3000` | |
| `WEB_SEARCH_SERVICE_URL` | `http://firefoundry-core-websearch-service:8080` | |
| `API_KEY` | placeholder | **Set** to a strong random value |
| `TELEMETRY_CONNECTION_STRING`, `TELEMETRY_SCHEMA` | placeholder | Not read by the gateway; the telemetry adapter uses `TELEMETRY_SERVICE_URL` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | placeholder | Optional; not used by the gateway's own configuration |

So out of the box the `entity`, `context`, `docproc`, `sandbox`, and `websearch` adapters are enabled. `telemetry`, `dataaccess`, `knowledgebase`, `skills`, `grpc`, and `a2a-client` stay disabled until you add their variables.

> **Image version:** the chart's default `image.tag` can lag the service release. Adapters such as `dataaccess`, `knowledgebase`, `skills`, `grpc`, and `a2a-client`, the unified `/mcp` endpoint, and the A2A layer require a recent image — set `image.tag` to the version you intend to run and confirm with `GET /mcp`.

### Example overrides

```yaml
mcp-gateway:
  enabled: true
  image:
    tag: "0.4.0"
  secret:
    data:
      API_KEY: "<generate-a-random-key>"
      AGENT_BUNDLE_ID: "<agent-bundle-uuid>"
      ENTITY_GRAPH_NAME: ""
      TELEMETRY_SERVICE_URL: "http://firefoundry-core-telemetry-service:3000"
      SKILLS_SERVICE_URL: "http://firefoundry-core-skills-service:8080"
      DATA_ACCESS_SERVICE_URL: "http://firefoundry-core-data-access:8080"
```

The names above assume the release is called `firefoundry-core` and the services use their chart-default HTTP ports; confirm with `kubectl get svc -n <namespace>`.

To disable the gateway entirely:

```yaml
mcp-gateway:
  enabled: false
```

### Container

The image runs `node dist/index.js` as a non-root user (UID 1001), exposes port 8080, and has a Docker `HEALTHCHECK` against `/health`.

### Database (optional)

The PostgreSQL configuration store is only needed for the admin configuration records and the integration catalog. To enable it:

1. Apply the migrations in the service repository (`migrations/V1__create_schema.sql`, `migrations/V2__add_external_services_inbound_apis.sql`) to the `firefoundry` database. They create the `mcp_gateway` schema and grant `fireread`/`fireinsert`.
2. Set `DATABASE_ENABLED=true` and provide `PG_HOST`, `PG_PASSWORD`, and `PG_INSERT_PASSWORD` (typically through `envFrom` with the platform's shared PostgreSQL ConfigMap/Secret).

If the database cannot be reached at startup the gateway logs a warning and continues without it; MCP traffic is unaffected.

## Configuration

The full variable list is in the [Reference](./reference.md#environment-variables). Operational rules of thumb:

- **An adapter is on when its URL is set.** Remove the variable to turn an adapter off; restart the pod to apply.
- **Changes need a restart.** Adapters, the unified tool index, and the A2A Agent Card are built at startup. gRPC backends and remote A2A agents added through the admin API are held in memory only and are lost on restart — persist them in `GRPC_BACKENDS_CONFIG_PATH` (mount the JSON file and `.proto` files, e.g. from a ConfigMap) and `A2A_REMOTE_AGENTS`.
- **Boolean flags are truthy strings.** `DATABASE_ENABLED`, `A2A_ENABLED`, `A2A_AUTH_REQUIRED`, and `GRPC_BACKENDS_ENABLED` treat any non-empty value as `true` — including the string `"false"`. To disable a flag, remove it (or set it to an empty string). Note that the chart's default `DATABASE_ENABLED: "false"` therefore attempts a database connection; without PostgreSQL settings this only produces a startup warning.

## Health Checks

| Endpoint | Meaning | Use for |
|----------|---------|---------|
| `GET /health` | Process is up; always `200` | Liveness |
| `GET /ready` | `{"ready": true}` after adapter initialization completes | Readiness (inspect body; status is `200` either way) |
| `GET /status` | Per-adapter `enabled`, `connected`, `error`, call counters | Dashboards, smoke tests |
| `GET /mcp` | Per-adapter endpoint, status, and tool list | Verifying the MCP surface after a deploy |

A quick post-deploy check:

```bash
kubectl port-forward svc/firefoundry-core-mcp-gateway -n ff-dev 8080:8080 &
curl -s localhost:8080/mcp | jq '.unified.toolCount, [.servers[] | {name, status}]'
```

Adapter "connected" means the client was created, not that the backend answered. Confirm end-to-end connectivity by calling one cheap read tool per adapter (for example `das_get_connections`, `kb_list_embedding_models`, `skills_list`, `telemetry_get_recent_requests`).

## Scaling

- The MCP path is stateless: every JSON-RPC message is independent, with no session affinity. You can run several replicas behind the service or enable the HPA.
- Per-replica state: the 60-second tool-result cache, adapter call counters, runtime-registered gRPC backends / A2A agents, and the A2A task store. With multiple replicas, A2A task history and cancellation (`/a2a/tasks`) only see tasks that ran on the replica you reach, and admin-API registrations apply to one replica — use the startup configuration instead.
- The gateway itself is light; throughput is bounded by the backing services. Size the backing services, and raise the gateway's memory limit if clients move large base64 documents (request bodies up to 50 MB are accepted).

## Security

- **Set `API_KEY`.** Without it, the MCP and admin routes are unauthenticated. With it, every MCP and admin request must send `X-Api-Key`. The key is a single shared secret for all clients — rotate it by updating the Secret and restarting the pod.
- **The API key is also used outbound.** The same `API_KEY` is passed to the entity, context, web search, knowledge base (`Authorization: Bearer`), and skills (`X-API-Key`) clients. Use a key those services accept, or leave those services' auth to the cluster network.
- **Keep the gateway internal.** It fronts write-capable tools (entity writes, working-memory deletes, code execution, SQL queries). Leave `ingress.enabled: false` and `global.externalAccess: false` unless you have a reason and an authenticating proxy in front; developers can use `kubectl port-forward`.
- **Unauthenticated catalog routes.** `/api/v1/external-services` and `/api/v1/inbound-apis` are not behind the API key. They only store catalog records, but `POST /api/v1/external-services/{id}/test` makes the gateway issue an HTTP `GET` to a stored URL. If you enable the database, restrict network access to the gateway (for example with a NetworkPolicy).
- **A2A.** When `A2A_ENABLED` is set, also set `A2A_AUTH_REQUIRED` (and `API_KEY`); otherwise `/a2a` runs tools without authentication. The Agent Card endpoints are always public.
- **No per-tool authorization.** Any holder of the key can call any connected tool. Limit exposure by enabling only the adapters you need, and by giving clients per-adapter URLs. The admin tool `enabled` flags and rate limits are not enforced in this version.
- **Shared result cache.** The unified endpoint caches read-only results for 60 seconds keyed by tool name and arguments, not by caller. If backing services return caller-specific data, have those clients use per-adapter endpoints.
- **Data in transit.** Documents and blobs travel as base64 in request/response bodies; tool arguments are not logged (only argument names are logged on errors).

### Entitlements

The MCP serving routes (`POST /mcp`, `GET/POST /mcp/{adapter}`) and A2A `message/send` / `message/stream` check the `mcp.access` workload entitlement through the FireFoundry entitlement agent.

- **Report mode (default):** requests are always served; would-refuse decisions are logged.
- **Enforce mode (`FF_ENTITLEMENT_MODE=enforce`):** a known-false grant returns `402` with the `x-ff-entitlement-state` header (see [Reference](./reference.md#entitlement-refusal)). Enforce mode requires valid `FF_CLUSTER_REF` and namespace identity or the service will not start.

Health, readiness, status, discovery, admin, and Agent Card routes are never entitlement-gated.

## Monitoring

- **Logs** — structured logs via the FireFoundry shared logger. Useful messages: `Initialized MCP server: <adapter>`, `Adapter <name> is disabled (missing configuration)`, `Failed to initialize adapter: <name>`, `Unified MCP server created` (with tool and prompt counts), `Error calling tool: <name>`, `Tool name collision`, and `[entitlements] …`.
- **Status counters** — `GET /status` reports `totalToolCalls` and `lastToolCall` per adapter; `GET /admin/status` adds A2A task metrics.
- **Telemetry events** — with the telemetry adapter connected, each `tools/call` on a per-adapter endpoint writes an `mcp_tool_call` event (service `mcp-gateway`, payload: tool, adapter, duration, error flag) linked to the caller's `X-Trace-Id`. Inspect them with the telemetry tools or the [ff-telemetry-read](../../../sdk/cli-tools/ff-telemetry-read.md) CLI. Calls through the unified endpoint do not emit these events.
- **Log level** — change the service log level with `LOG_LEVEL`. The MCP `logging/setLevel` method is accepted for client compatibility but does not change server logging.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Missing X-Api-Key header` | Client not sending the key | Add `X-Api-Key` to the client configuration |
| `403 Invalid API key` | Wrong key | Compare with the `API_KEY` in the release Secret |
| `402` with `entitlement_required` | Enforce mode and `mcp.access` not granted | Check the plan/license, or run in report mode |
| `tools/list` is empty or missing an adapter | Adapter variable not set, or image too old | Check `GET /status` / `GET /mcp`; set the variable; update `image.tag` |
| `503 MCP server not available: <adapter>` | Adapter disabled or failed to initialize | See `error` in `GET /status` and startup logs |
| `404 MCP server not found: <adapter>` | Typo in adapter name | Use a name from `GET /mcp` (e.g. `knowledgebase`, `a2a-client`) |
| JSON-RPC `-32000 Tool not found` on `/mcp` for a gRPC/A2A tool registered via admin API | Unified tool index is built at startup | Call through `/mcp/grpc` or `/mcp/a2a-client`, or persist the registration and restart |
| Entity tools return errors about the bundle or graph | `AGENT_BUNDLE_ID` / `ENTITY_GRAPH_NAME` still placeholders | Set real values in the Secret and restart |
| Tool result has `isError: true` with a connection error | Backend URL wrong or service down | Verify the service URL/port; call the backend's health endpoint from the cluster |
| Stale data from a read tool | 60-second result cache on `/mcp` | Wait for expiry, or use the per-adapter endpoint |
| Claude Code (or other client) cannot connect | Client using legacy SSE transport, or URL missing `/mcp` | Use the HTTP transport and the full `…/mcp` URL (see [Connecting Clients](./clients.md)) |
| `413`/request rejected for large documents | Body over 50 MB | Split the document, or store it via the Context Service and pass a reference |
| Startup warning `Failed to initialize config repository` | `DATABASE_ENABLED` set (even to `"false"`) without database settings | Remove `DATABASE_ENABLED`, or configure `PG_*` and run the migrations |
| A2A tasks missing from `/a2a/tasks` | Multiple replicas; task store is in memory per pod | Query the replica that ran the task, or run one replica for A2A |

## Related

- [Overview](./README.md)
- [Reference](./reference.md)
- [Connecting Clients](./clients.md)
- [Local chart reference](../../../../ff_local_dev/chart-reference.md)
- [Platform Operations](../../operations.md)
