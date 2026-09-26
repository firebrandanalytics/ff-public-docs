# Knowledge Service — Operations

Deployment, configuration, health checks, scaling, security, monitoring, and troubleshooting for the Knowledge Service.

## Deployment

The Knowledge Service ships as the `knowledge-service` Helm chart and is included as an **opt-in** subchart of the `firefoundry-core` umbrella chart. It is disabled by default; enable it alongside the [RAG agent bundle](../../system-agents/rag-agent.md).

### Enabling in firefoundry-core

```yaml
# firefoundry-core values override
knowledge-service:
  enabled: true
  image:
    tag: "0.2.0"            # the chart default is 0.1.0; pin the version you run
  configMap:
    data:
      # Point at your RAG agent bundle release. Agent-bundle releases follow
      # the pattern <bundleName>-agent-bundle and listen on port 3000.
      RAG_AGENT_BUNDLE_URL: "http://rag-agent-bundle-agent-bundle:3000"
      # Recommended: keep the trigger call short (see "Ingestion trigger window")
      RAG_BUNDLE_TIMEOUT_MS: "5000"
```

With a release named `firefoundry-core`, the service is reachable in-cluster at `http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`.

### Chart defaults

| Value | Default | Notes |
|---|---|---|
| `enabled` (umbrella) | `false` | Opt-in |
| `replicaCount` | `1` | |
| `image.tag` | `0.1.0` | Override to the release you intend to run |
| `service.type` | `ClusterIP` | HTTP only (`service.grpc.enabled: false`) |
| `service.http.port` / `targetPort` | `8080` / `8080` | |
| `global.externalAccess` | `false` | Not exposed outside the cluster |
| `global.authentication.required` | `false` | |
| `ingress.enabled` | `false` | Cluster-internal; expose through the gateway if needed |
| `resources.requests` | `cpu: 100m`, `memory: 256Mi` | |
| `resources.limits` | `cpu: 500m`, `memory: 512Mi` | |
| `autoscaling.enabled` | `false` | `minReplicas: 1`, `maxReplicas: 5`, `targetCPUUtilizationPercentage: 80` |
| `secret.enabled` | `false` | Enable to supply `ENTITY_SERVICE_ADMIN_API_KEY` |
| `envFrom` | `[]` | Reference shared ConfigMaps/Secrets |

### Default ConfigMap

```yaml
configMap:
  enabled: true
  data:
    PORT: "8080"
    NODE_ENV: "production"
    LOG_LEVEL: "info"
    SERVICE_NAME: "knowledge-service"
    KNOWLEDGE_SERVICE_BUNDLE_ID: "c1d2e3f4-5a6b-7c8d-9e0f-112233445566"
    APPLICATION_ID: "a1b2c3d4-5e6f-7a8b-9c0d-eeff00112233"
    REMOTE_ENTITY_SERVICE_URL: "http://firefoundry-core-entity-service"
    REMOTE_ENTITY_SERVICE_PORT: "8080"
    USE_REMOTE_ENTITY_CLIENT: "true"
    RAG_AGENT_BUNDLE_URL: "http://rag-agent-bundle-agent-bundle:3000"
```

Each `configMap.data` and `secret.data` entry is injected as an individual environment variable; these take precedence over anything supplied through `envFrom`.

### Container image

- Node.js 20 (Alpine), multi-stage build
- Runs as non-root user `app` (UID 1001)
- Exposes port `8080`
- Built-in Docker `HEALTHCHECK` against `/health`
- Graceful shutdown on `SIGTERM`, `SIGINT`, `SIGQUIT`: stops accepting connections and lets in-flight requests finish

## Configuration

The full list of environment variables is in the [Reference](./reference.md#environment-variables). The ones that matter operationally:

### Required

| Variable | Purpose |
|---|---|
| `REMOTE_ENTITY_SERVICE_URL` | Entity Service base URL (no port). Must be a valid URL. |
| `RAG_AGENT_BUNDLE_URL` | RAG agent bundle base URL including port. Must be a valid URL. |

The process exits at startup if either is missing or malformed.

### Service identity

`KNOWLEDGE_SERVICE_BUNDLE_ID` and `APPLICATION_ID` identify the entities the service writes. They have built-in defaults and must stay **stable** for the lifetime of an environment; change them only when standing up a new environment with no existing knowledge bases.

### Ingestion trigger window

`RAG_BUNDLE_TIMEOUT_MS` controls how long `POST …/ingest` waits for the RAG agent bundle's response before returning `202`:

- If the bundle responds with 2xx inside the window, or the window elapses while the request is still pending, the trigger succeeds and the request continues in the background.
- If the connection fails or the bundle returns non-2xx inside the window, the trigger returns `502` and the document status is unchanged.

The default (`300000`, 5 minutes) accommodates bundles that run the ingestion pipeline synchronously inside `/api/kb-ingest`, but it means the trigger call can block for that long. When the bundle returns immediately with a workflow handle, a window of a few seconds gives callers a prompt `202` while still catching connection errors. The service records `queued` only after the window resolves, so a short window also avoids a completion callback arriving before the `queued` status is written.

### Callbacks from the RAG agent bundle

The Knowledge Service does not send a callback URL to the bundle. Configure the RAG agent bundle's Knowledge Service endpoint so it can reach `POST /api/kb/ingestion-callback` on this service (for example `http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080`). See the [RAG Agent Bundle](../../system-agents/rag-agent.md) configuration.

### Capabilities cache

`CAPABILITIES_CACHE_TTL_SECONDS` (default `60`) sets the in-memory cache TTL for capability responses. The cache is per replica, bounded at 1024 entries, and invalidated when a document or KB is deleted through the service. Set it to `0` to disable caching.

## Health Checks

| Endpoint | Probe | Behavior |
|---|---|---|
| `GET /health` | Liveness | Returns `200 {"status":"healthy"}` while the process is serving |
| `GET /ready` | Readiness | Returns `200 {"status":"ready"}`; deliberately does **not** check the Entity Service, so a transient dependency outage does not take pods out of rotation. Dependency failures surface per request as `503`. |
| `GET /status` | Diagnostics | Version, environment, start time, uptime |

Chart probe settings:

```yaml
livenessProbe:
  httpGet: { path: /health, port: 8080 }
  initialDelaySeconds: 20
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /ready, port: 8080 }
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

Because readiness does not reflect dependencies, verify end-to-end health with a real call such as `GET /api/kb`.

## Scaling

- **Stateless**: all durable state is in the Entity Service, so replicas can be added freely. Enable `autoscaling` for CPU-based horizontal scaling.
- **Per-replica cache**: the only in-memory state is the capabilities cache; with several replicas a capability response may be up to one TTL stale on some replicas after a re-ingestion.
- **Heavy operations**: cascade deletes of large documents or knowledge bases issue many Entity Service calls (bounded concurrency of 8, with automatic retry on database deadlocks). Section-subtree and page requests also fan out to several Entity Service calls. Size the Entity Service accordingly.
- **Long trigger calls**: with a long `RAG_BUNDLE_TIMEOUT_MS`, each in-flight trigger holds a request open; shorten the window if many ingestions are started concurrently.
- **List limits**: unfiltered list endpoints cap at 200 items; direct clients to filtered, paginated listing for large KBs.

## Security

- **No in-service authentication** in 0.2.0. All endpoints, including `POST /api/kb/ingestion-callback`, accept unauthenticated requests. The chart defaults to `ClusterIP`, no ingress, and `externalAccess: false`. Keep the service cluster-internal and expose it only through the platform gateway with authentication enabled.
- **Restrict the callback path**: the callback endpoint can mark any document `complete` or `failed`. Use Kubernetes NetworkPolicies (or gateway routing rules) so that only the RAG agent bundle can reach `/api/kb/ingestion-callback`.
- **Entity Service admin key**: cascade deletes call the Entity Service admin API (`DELETE /admin/node/{id}`), authenticated with `X-API-Key`. If the Entity Service has an admin key configured, supply it to the Knowledge Service as `ENTITY_SERVICE_ADMIN_API_KEY` from a Kubernetes Secret — for example via `secret.enabled: true` with the key under `secret.data`, or via `envFrom` referencing an existing Secret. Without it, deletes fail with `500` ("entity service admin auth misconfigured"). Never put the key in the ConfigMap.
- **Input hardening**: path ids are validated as UUIDs; numeric filter values are bounded; publication-date filters accept only strict ISO-8601 strings before they reach Entity Service queries.
- **Blob access**: the service never reads the file behind `blobPath`; access control for the stored file is enforced where it is stored and by the RAG agent bundle that reads it.

## Monitoring

### Logs

The service logs structured JSON through the shared FireFoundry logging library. Key events:

| Log message | Meaning |
|---|---|
| `request` (with `requestId`, `method`, `path`, `status`, `durationMs`) | One line per API request; probes (`/`, `/health`, `/ready`, `/status`) are excluded |
| `RagBundleClient.triggerIngestion fire` / `fired (immediate 2xx)` / `fired (timeout window)` | Trigger sent to the bundle and how it resolved |
| `RagBundleClient: bundle returned non-2xx after fire` | The bundle eventually failed after the trigger window closed; expect a `failed` callback or a stuck `queued` document |
| `Ingestion callback jobId mismatch` | Callback for an older job; usually a re-trigger |
| `KnowledgeProvider.handleIngestionCallback` | Callback applied, with final status |
| `EntityServiceClient: transient deadlock, retrying with backoff` | Cascade delete hit a database deadlock and is retrying |
| `…partition created but KnowledgeBase entity creation failed — partition is leaked` | KB creation half-failed; an empty, unreachable partition remains |
| `Entity admin auth failed` | `ENTITY_SERVICE_ADMIN_API_KEY` missing or wrong |

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` to forward telemetry, and `LOG_LEVEL=debug` for more detail. Correlate client reports with logs using the `X-Request-Id` response header.

### Useful signals

- Count of documents in `queued` older than your expected ingestion time (poll `GET /api/kb/{kbId}/documents` and compare `updatedAt`)
- Rate of `502` from the trigger endpoint (bundle availability)
- Rate of `503` across endpoints (Entity Service availability)

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Pod exits at startup with a validation error | `REMOTE_ENTITY_SERVICE_URL` or `RAG_AGENT_BUNDLE_URL` missing or not a valid URL; malformed UUID in identity variables | Set the variables in `configMap.data` with full `http://…` URLs |
| All API calls return `503` | Entity Service unreachable or wrong URL/port | Check `REMOTE_ENTITY_SERVICE_URL`/`PORT` and Entity Service health; `/ready` will still report ready |
| Trigger returns `502` | RAG agent bundle unreachable, wrong URL, or it rejected the request | Check `RAG_AGENT_BUNDLE_URL` (including port — agent bundles typically listen on 3000); read the `detail` field; retry — the document stays `registered`/`failed` |
| Trigger takes minutes to return | Bundle runs ingestion synchronously and `RAG_BUNDLE_TIMEOUT_MS` is large | Lower `RAG_BUNDLE_TIMEOUT_MS` to a few seconds |
| Document stuck in `queued` | Bundle never sent the callback (cannot reach the Knowledge Service, crashed, or failed after the trigger window), or the callback landed before `queued` was recorded | Check bundle logs and its Knowledge Service URL setting; check for `bundle returned non-2xx after fire`; shorten `RAG_BUNDLE_TIMEOUT_MS`. The status cannot be edited via `PUT`, so a stuck document is recovered by the bundle re-sending its callback, or by deleting and re-registering it |
| Trigger returns `409 ingestion_in_flight` | Document is already `queued` or `complete` | Wait for the callback; to re-ingest a `complete` document, delete it and register it again |
| Callback returns `404 document_not_found` | Document was deleted, or wrong `kbId`/`documentId` | Usually a stale job; safe to ignore |
| `DELETE` returns `500` mentioning admin auth | Entity Service requires an admin key | Provide `ENTITY_SERVICE_ADMIN_API_KEY` via a Secret |
| `DELETE` returns `503` part-way | Entity Service outage during a cascade | Retry the same `DELETE`; children are removed before the document, so retries are safe |
| Capabilities return `ingestion_version: "v1"`, section/page routes return `404` | Document was ingested without the structured pipeline, or ingestion has not completed | Confirm `status: complete`; re-ingest with the structured pipeline |
| Filtered list returns nothing | Filter fields are not present in the documents' stored metadata | Check `GET …/documents/{docId}` `metadata`; financial fields must be supplied at registration or written by ingestion |
| Unfiltered list shows fewer documents than `total` | 200-item cap | Use filter parameters with `page`/`size` |
| Page lookup returns `409` | The reference matches several pages | Retry with one of the returned `id`s |
| Capabilities look stale after re-ingestion | Per-replica cache | Wait `CAPABILITIES_CACHE_TTL_SECONDS` or lower it |

## Related

- [Reference](./reference.md) — Endpoints, error codes, and environment variables
- [Entity Service](../entity-service/README.md) — Storage, admin API, and partitions
- [RAG Agent Bundle](../../system-agents/rag-agent.md) — Ingestion pipeline and callback configuration
- [Platform Deployment](../../deployment.md)
