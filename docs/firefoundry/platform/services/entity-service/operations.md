# Entity Service — Operations

What an application team needs to enable the Entity Service, connect an agent bundle to it, verify it, and troubleshoot from the caller's side.

## Enabling the Service

The Entity Service is part of the `firefoundry-core` chart and is **enabled by default**:

```yaml
# firefoundry-core values
entity-service:
  enabled: true
```

Settings an application team may want to adjust:

| Value | Default | When to change |
|-------|---------|----------------|
| `entity-service.replicaCount` | `1` | Increase for higher request concurrency (the service is stateless and scales horizontally) |
| `entity-service.autoscaling.enabled` | `false` | Enable CPU-based autoscaling for bursty workloads |
| `entity-service.resources` | 200m / 512Mi requests, 1 CPU / 2Gi limits | Raise for large graphs or heavy search/vector workloads |
| `entity-service.global.externalAccess` | `false` | Expose the service outside the cluster (e.g. for tools running outside the cluster); leave off unless needed |

Database connectivity and schema setup are handled by your environment administrator as part of installing `firefoundry-core`.

## Connecting Your Agent Bundle

The Agent SDK's `createEntityClient(APP_ID)` reads the service location from your bundle's environment:

```yaml
# agent bundle values (configMap.data)
REMOTE_ENTITY_SERVICE_URL: "http://firefoundry-core-entity-service"
REMOTE_ENTITY_SERVICE_PORT: "8080"
```

Adjust the host if your `firefoundry-core` release has a different name or lives in a different namespace (e.g. `http://firefoundry-core-entity-service.<namespace>.svc.cluster.local`).

## Verifying

From your workstation:

```bash
kubectl port-forward svc/firefoundry-core-entity-service 8080:8080 -n <namespace>
curl http://localhost:8080/health   # liveness: {"status":"ok"}
curl http://localhost:8080/ready    # readiness: service can reach its storage
```

From inside the cluster (e.g. a shell in your bundle's pod):

```bash
curl http://firefoundry-core-entity-service:8080/health
```

Then confirm your bundle is writing entities:

```bash
ff-eg-read search nodes-scoped --order-by '{"created_at": "desc"}' --size 5
```

## Limits and Behavior to Design Around

| Behavior | Details |
|----------|---------|
| Embedding size | Vectors must be exactly 3072 dimensions |
| Search pagination | Node search is paged (`page`, `size`); request only what you need and page through large result sets |
| Batched writes | `?batch=true` writes are committed shortly after the call returns (default ≤100 ms / 50 rows); don't read them back immediately |
| Read caching | Reads may be cached for ~2 seconds; a read right after a write can briefly return stale data |
| Deletes | Normal APIs archive (soft-delete) nodes; hard deletes are administrative (`ff-eg-admin`) |

## Monitoring Your Application's Graph

```bash
# Graph size by partition
ff-eg-admin stats | jq '.graphs[] | "\(.name): \(.node_count) nodes, \(.edge_count) edges"'

# Recent failures in your bundle
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}' --size 20
```

## Troubleshooting

**Bundle fails to start or entity calls fail with connection errors:**
- Check `REMOTE_ENTITY_SERVICE_URL` and `REMOTE_ENTITY_SERVICE_PORT` in the bundle's environment
- Confirm the service resolves from the bundle's namespace (`curl http://firefoundry-core-entity-service:8080/health`)
- If `/ready` fails, the service cannot reach its storage — contact your environment administrator

**Scoped search returns nothing:**
- Confirm the `X-Agent-Bundle-Id` header (or the `APP_ID` passed to `createEntityClient`) matches the bundle that created the entities
- Check you are querying the right graph partition (`X-Graph-Name`)
- Check whether the nodes were archived

**Newly created entity not found:**
- If it was created with `?batch=true`, retry after a short delay
- A read immediately after a write may be served from cache for ~2 seconds

**Vector search returns empty results:**
- Verify an embedding was stored for the target node: `ff-eg-read vector similar <id>`
- Lower the similarity threshold — 0.9 is often too strict
- Confirm your embeddings are 3072-dimensional and produced by the same model as your query vectors

**Slow search queries:**
- Add conditions to narrow results; unscoped/global searches are expensive
- Use scoped search (`X-Agent-Bundle-Id`) and paginate
