# Knowledge Service — Operations

How to enable the Knowledge Service for your app, verify it from an agent bundle, the limits to design around, and how to troubleshoot from the caller's side.

## Enabling the Service

The Knowledge Service is an **opt-in** component of the `firefoundry-core` Helm chart and is disabled by default. It only does useful work together with the [RAG agent bundle](../../system-agents/rag-agent.md), which performs ingestion and answers queries, so enable both.

```yaml
# firefoundry-core values override
knowledge-service:
  enabled: true
  configMap:
    data:
      # Base URL (including port) of the RAG agent bundle in your environment.
      # Agent-bundle releases are named <bundleName>-agent-bundle and listen on port 3000.
      RAG_AGENT_BUNDLE_URL: "http://rag-agent-bundle-agent-bundle:3000"
```

The RAG agent bundle, in turn, must be configured with the Knowledge Service's URL so it can report ingestion results; without that, documents stay `queued`. See the [RAG Agent Bundle](../../system-agents/rag-agent.md#configuration) configuration.

With a release named `firefoundry-core`, the service is reachable in-cluster at:

```
http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080
```

It is cluster-internal by default (no ingress). Browser or external clients reach it through the platform gateway.

### Settings an app team may touch

| Setting | Default | When to change it |
|---|---|---|
| `knowledge-service.enabled` | `false` | Set `true` to use knowledge bases |
| `configMap.data.RAG_AGENT_BUNDLE_URL` | `http://rag-agent-bundle-agent-bundle:3000` | Your RAG agent bundle release has a different name or port |
| `configMap.data.CAPABILITIES_CACHE_TTL_SECONDS` | `60` | Lower it (or `0`) if your app re-ingests documents and needs capability summaries to refresh immediately |
| `configMap.data.LOG_LEVEL` | `info` | `debug` while diagnosing |
| `replicaCount` / `autoscaling.enabled` | `1` / `false` | Heavy navigation or delete traffic; the service is stateless and scales horizontally |

Everything else (storage connection, credentials, service identity) is set by your environment administrator.

## Wiring It Into Your Bundle

Give your bundle the service URL through its own configuration, for example:

```yaml
# your agent bundle's values
configMap:
  data:
    KNOWLEDGE_SERVICE_URL: "http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080"
```

and read it when constructing the client (see [Getting Started](./getting-started.md#from-an-agent-bundle-typescript)). Your bundle also needs the RAG agent bundle's URL to call `/api/rag-query`.

## Verifying Reachability

From your bundle's pod (or a port-forward):

```bash
KS=http://firefoundry-core-knowledge-service.<namespace>.svc.cluster.local:8080

curl -s $KS/health          # { "status": "healthy", ... } — the process is up
curl -s $KS/status          # version, uptime
curl -s $KS/api/kb | jq '.total'   # end-to-end check, including storage
```

`/ready` does not check the service's dependencies, so use a real call such as `GET /api/kb` to confirm the service can do work. To confirm ingestion is wired end to end, register a small document, trigger it, and check it reaches `complete` ([Getting Started](./getting-started.md)).

## Limits and Behavior

| Behavior | Design around it by |
|---|---|
| No authentication in 0.2.0; every caller that can reach the service can see and change every KB | Keeping KB ids in your app's own data and only passing the right ones; reaching the service from your bundle, not directly from browsers |
| Unfiltered list endpoints return at most 200 items | Using filter parameters with `page` / `size` (max 200 per page) for large KBs |
| Ingestion is asynchronous and can take minutes for large documents | Polling document status every few seconds with an overall timeout; showing a "processing" state in your UI |
| Triggering is allowed only from `registered` or `failed` | Deleting and re-registering to re-ingest a completed document |
| Capability summaries can be up to about a minute stale after re-ingestion | Re-fetching after a short delay |
| Page and section lookups are scoped to the KB, not a document | Preferring page ids over labels in multi-document KBs; handling `409` disambiguation |
| Deletes are permanent and can take a while for large documents or KBs | Confirming with the user; retrying the same `DELETE` if it fails part-way |
| Request bodies up to 10 MB; no file upload | Storing files in working memory and passing `blobPath` |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Connection refused / DNS failure from your bundle | Service not enabled, or wrong URL / namespace | Check `knowledge-service.enabled` and the in-cluster URL; `curl $KS/health` from the bundle pod |
| All API calls return `503` | Backing storage temporarily unavailable | Retry with backoff; if it persists, contact your environment administrator |
| Trigger returns `502` | RAG agent bundle not deployed, wrong `RAG_AGENT_BUNDLE_URL`, or the bundle rejected the request | Read the problem `detail`; check the RAG agent bundle is running and the URL (including port 3000); retry — the document keeps its status |
| Document stays `queued` well past the expected time | Ingestion did not report back (the RAG agent bundle cannot reach the Knowledge Service, or it crashed) | Check the RAG agent bundle's logs and its Knowledge Service URL setting; delete the document, register it again, and re-trigger |
| Document is `failed` | Ingestion error, often an unreadable or wrong `blobPath` | Read `error`; fix the cause; trigger again |
| Trigger returns `409 ingestion_in_flight` | Document is already `queued` or `complete` | Wait for completion; to re-ingest a completed document, delete and re-register it |
| `DELETE` returns `500` consistently | Deletes are not permitted by the environment's configuration | Contact your environment administrator |
| `DELETE` returns `503` part-way | Temporary storage outage | Repeat the same `DELETE`; it is safe to retry |
| Capabilities return `ingestion_version: "v1"`, section/page routes return `404` | Document not yet complete, or ingested without the structured pipeline | Confirm `status: complete`; re-ingest with the structured pipeline |
| Filtered list returns nothing | Filter fields are not in the documents' metadata (most filters apply only after ingestion) | Inspect `GET …/documents/{docId}` `metadata`; supply financial fields at registration |
| Unfiltered list shows fewer items than `total` | 200-item cap | Use filter parameters with `page` / `size` |
| Page lookup returns `409` | The reference matches several pages | Retry with one of the returned `id`s |
| RAG query returns nothing for a new document | Document not yet `complete`, or wrong `kbIds` | Poll status until `complete`; check the KB id you pass |

When reporting a problem, include the `X-Request-Id` response header.

## Related

- [Reference](./reference.md) — Endpoints and error codes
- [RAG Agent Bundle](../../system-agents/rag-agent.md) — Ingestion pipeline, query endpoint, and configuration
- [Platform Deployment](../../deployment.md)
