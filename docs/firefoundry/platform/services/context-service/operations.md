# Context Service — Operations

What an application team needs to enable the Context Service, connect an agent bundle to it, verify it, and troubleshoot from the caller's side.

## Enabling the Service

The Context Service is part of the `firefoundry-core` chart and is **enabled by default**:

```yaml
# firefoundry-core values
context-service:
  enabled: true
```

Settings an application team may want to adjust:

| Value | Default | When to change |
|-------|---------|----------------|
| `context-service.replicaCount` | `1` | Increase for more concurrent file transfers or history requests |
| `context-service.autoscaling.enabled` | `false` | Enable CPU-based autoscaling for bursty workloads |
| `context-service.global.externalAccess` | `false` | Expose the service outside the cluster (e.g. for MCP-compatible coding agents or scripts running on a workstation); leave off unless needed |

File storage (Azure Blob Storage, Google Cloud Storage, or an S3-compatible store such as MinIO in local environments), database connectivity, and the service's API key are provisioned by your environment administrator. Your application does not need storage credentials.

## Connecting Your Agent Bundle

Set the service address, and the API key if your environment requires one, in your bundle's values:

```yaml
# agent bundle values
configMap:
  data:
    CONTEXT_SERVICE_ADDRESS: "http://firefoundry-core-context-service:50051"
secret:
  data:
    CONTEXT_SERVICE_API_KEY: "<provided by your environment administrator>"
```

Adjust the host if your `firefoundry-core` release has a different name or runs in another namespace. The address must include the protocol (`http://`).

## Verifying

From your workstation, port-forward the service and use the working memory CLI or a short client script:

```bash
kubectl port-forward svc/firefoundry-core-context-service 50051:50051 -n <namespace>
export CONTEXT_SERVICE_ADDRESS=http://localhost:50051
```

```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';

const client = new ContextServiceClient({
  address: process.env.CONTEXT_SERVICE_ADDRESS!,
  apiKey: process.env.CONTEXT_SERVICE_API_KEY || '',
});
const records = await client.fetchWMRecordsByEntity('<an-entity-node-id>');
console.log(`reachable: ${records.length} records`);
```

The [ff-wm-read](../../../sdk/cli-tools/ff-wm-read.md) CLI can also list and download working memory records for an entity.

## Limits and Behavior to Design Around

| Behavior | Details |
|----------|---------|
| Large files | Uploads and downloads are streamed in chunks; use `uploadBlobFromBuffer` / `getBlob` rather than building raw RPC streams |
| Mapping registrations | Not persisted — register at every bundle startup; `ALREADY_EXISTS` means it is already registered |
| Mapping scope | Mappings are scoped by `app_id`; pass the same app ID when registering and when fetching history |
| History freshness | History is read from the entity graph at request time, so it includes only turns your bundle has already written |
| History size | Long conversations produce long prompts; cap with `maxMessages` / `max_messages` |
| Manifest depth | `FetchWMManifest` traverses up to `max_depth` edges (default 3) |

## Troubleshooting

**`UNAUTHENTICATED` errors:**
- `CONTEXT_SERVICE_API_KEY` is missing or wrong in the bundle's secret; ask your environment administrator for the current key

**Connection refused / timeouts:**
- Check `CONTEXT_SERVICE_ADDRESS` includes `http://` and port `50051`
- Confirm the service name resolves from the bundle's namespace
- Confirm `context-service.enabled` is `true` in your `firefoundry-core` values

**`NOT_FOUND` for a working memory ID:**
- The record was deleted, or the ID stored in entity data is stale; list records with `fetchWMRecordsByEntity` to find the current one

**Chat history is empty or incomplete:**
- Confirm the node ID is the conversation/session root, not a single turn
- If you use a custom mapping, confirm it was registered at startup with the same `app_id` and `mapping_name` you are requesting
- Check your mapping's edge types and entity types match what your bundle actually writes (inspect with [ff-eg-read](../../../sdk/cli-tools/ff-eg-read.md))
- Messages out of order: check the mapping's order field and that your turn entities have correct timestamps

**`INTERNAL` errors:**
- Usually a transient failure reaching file storage or the entity graph; retry with backoff, and contact your environment administrator if it persists
