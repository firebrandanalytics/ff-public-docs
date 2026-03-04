# Entity Service — Getting Started

This guide walks you through creating entities, establishing relationships, and querying the entity graph.

## Prerequisites

- A running Entity Service instance (deployed via Helm or running locally)
- PostgreSQL with pgvector extension and the `entity` schema migrated
- The `ff-eg-read` and `ff-eg-write` CLI tools installed (optional but recommended)

## Step 1: Verify the Service is Running

```bash
# HTTP health check
curl http://localhost:8080/health
# Expected: {"status":"ok"}

# Readiness check (verifies database connectivity)
curl http://localhost:8080/ready
```

## Step 2: Create a Node

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

## Step 3: Read the Node Back

```bash
# Via REST API
curl http://localhost:8080/api/node/a1b2c3d4-5678-90ab-cdef-1234567890ab

# Via CLI
ff-eg-read node get a1b2c3d4-5678-90ab-cdef-1234567890ab | jq .
```

## Step 4: Create an Edge (Relationship)

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

## Step 5: Traverse Relationships

```bash
# Find all children of a node
ff-eg-read node connected <parent-id> HAS_CHILD | jq '.[] | {name, status}'

# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'

# Get a node with all its edges in one call
ff-eg-read node with-edges <entity-id> | jq .
```

## Step 6: Search Entities

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

## Step 7: Update Node Data

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

## Step 8: Create a Vector Embedding

For semantic search, store an embedding vector:

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
- See [Operations](./operations.md) for configuration and deployment guidance
- Explore [ff-eg-read CLI](../../../sdk/cli-tools/ff-eg-read.md) for comprehensive query capabilities
