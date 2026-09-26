# Entity Service — Getting Started

This guide walks you through creating entities, establishing relationships, and querying the entity graph — first from an agent bundle with the SDK, then with the CLI and REST API for exploration and debugging.

## Prerequisites

- A FireFoundry environment with the Entity Service enabled (it is on by default in `firefoundry-core`; see [Operations](./operations.md))
- For the REST examples: access to the service, e.g. `kubectl port-forward svc/firefoundry-core-entity-service 8080:8080 -n <namespace>`
- The `ff-eg-read` and `ff-eg-write` CLI tools (optional but recommended)

## Step 1: Use the Entity Graph from Your Bundle (SDK)

In an agent bundle, pass an entity client to your bundle and let the SDK talk to the Entity Service:

```typescript
import { FFAgentBundle, createEntityClient } from "@firebrandanalytics/ff-agent-sdk";

export class MyBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      { id: APP_ID, application_id: APP_ID, name: "MyBundle", type: "agent_bundle", description: "..." },
      MyConstructors,
      createEntityClient(APP_ID)   // scoped to your application
    );
  }

  async listArticles(status?: string) {
    const criteria: any = { specific_type_name: "ArticleEntity" };
    if (status) criteria.status = status;
    const result = await this.entity_client.search_nodes(criteria, { created: "desc" });
    return result.result;
  }
}
```

`createEntityClient` requires `REMOTE_ENTITY_SERVICE_URL` and `REMOTE_ENTITY_SERVICE_PORT` in your bundle's environment (see [Operations](./operations.md#connecting-your-agent-bundle)). Entity classes created through `this.entity_factory` are persisted as nodes automatically; see [Agent SDK: Entities](../../../sdk/agent_sdk/core/entities.md).

The remaining steps show the same operations with the CLI and REST API, which is how you inspect what your bundle wrote.

## Step 2: Verify the Service is Reachable

```bash
curl http://localhost:8080/health
# Expected: {"status":"ok"}

curl http://localhost:8080/ready
```

## Step 3: Create a Node

Create an entity node using the REST API:

```bash
curl -X POST http://localhost:8080/api/node \
  -H "Content-Type: application/json" \
  -H "X-Agent-Bundle-Id: your-agent-bundle-id" \
  -d '{
    "name": "My First Entity",
    "general_type_name": "DocumentEntity",
    "data": {
      "title": "Getting Started Guide",
      "content": "This is a test document."
    }
  }'
```

Response:

```json
{
  "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "name": "My First Entity",
  "general_type_name": "DocumentEntity",
  "status": "Created",
  "data": {
    "title": "Getting Started Guide",
    "content": "This is a test document."
  },
  "graph_name": "default",
  "created_at": "2026-01-15T10:30:00.000Z"
}
```

Or using the CLI:

```bash
ff-eg-write node create \
  --name "My First Entity" \
  --type "DocumentEntity" \
  --data '{"title": "Getting Started Guide", "content": "This is a test document."}'
```

## Step 4: Read the Node Back

```bash
# Via REST API
curl http://localhost:8080/api/node/a1b2c3d4-5678-90ab-cdef-1234567890ab

# Via CLI
ff-eg-read node get a1b2c3d4-5678-90ab-cdef-1234567890ab | jq .
```

## Step 5: Create an Edge (Relationship)

Connect two nodes with a typed edge:

```bash
curl -X POST http://localhost:8080/api/edge \
  -H "Content-Type: application/json" \
  -d '{
    "source_node_id": "parent-node-id",
    "target_node_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "edge_type": "HAS_CHILD"
  }'
```

Or using the CLI:

```bash
ff-eg-write edge create \
  --source <parent-node-id> \
  --target <child-node-id> \
  --type HAS_CHILD
```

## Step 6: Traverse Relationships

```bash
# Find all children of a node
ff-eg-read node connected <parent-id> HAS_CHILD | jq '.[] | {name, status}'

# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'

# Get a node with all its edges in one call
ff-eg-read node with-edges <entity-id> | jq .
```

## Step 7: Search Entities

### By Property Conditions

```bash
# Find failed entities
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}'

# Find entities by type
ff-eg-read search nodes-scoped --condition '{"entity_type": {"$eq": "DocumentEntity"}}'

# Recent entities, sorted
ff-eg-read search nodes-scoped --order-by '{"created_at": "desc"}' --size 10
```

### By JSONB Data

```bash
# Containment search
ff-eg-read search data --containment '{"category": "finance"}'

# JSONPath expression
ff-eg-read search data --jsonpath '$.tags[*] ? (@ == "important")'
```

## Step 8: Update Node Data

```bash
curl -X PATCH http://localhost:8080/api/node/a1b2c3d4-5678-90ab-cdef-1234567890ab/data \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "reviewed": true
  }'
```

Or using the CLI:

```bash
ff-eg-write node update-data <node-id> --data '{"title": "Updated Title", "reviewed": true}'
```

## Step 9: Create a Vector Embedding

For semantic search, store a 3072-dimensional embedding vector that your application computed:

```bash
curl -X POST http://localhost:8080/api/vector/embedding \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "embedding": [0.123, -0.456, 0.789, ...],
    "metadata": { "category": "documentation" }
  }'
```

Find similar entities:

```bash
ff-eg-read vector similar a1b2c3d4-5678-90ab-cdef-1234567890ab --limit 5 --threshold 0.8
```

## Next Steps

- Read [Concepts](./concepts.md) for a deeper understanding of the entity graph model
- See [Reference](./reference.md) for the complete API specification
- See [Operations](./operations.md) for enabling the service, connecting a bundle, and troubleshooting
- Explore [ff-eg-read CLI](../../../sdk/cli-tools/ff-eg-read.md) for comprehensive query capabilities
