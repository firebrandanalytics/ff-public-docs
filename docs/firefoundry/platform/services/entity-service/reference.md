# Entity Service — Reference

Complete REST API reference for the Entity Service, including all endpoints, request/response schemas, headers, and error codes.

## Request Headers

| Header | Purpose | Required |
|--------|---------|----------|
| `X-Agent-Bundle-Id` | Agent bundle identifier for scoped operations | For scoped searches |
| `X-Graph-Name` | Graph partition name | No (defaults to `default`) |
| `Content-Type` | Must be `application/json` for POST/PATCH | Yes for mutations |

## Node Endpoints

### GET /api/node/:id

Retrieve a single node by ID.

**Response** (200):
```json
{
  "id": "uuid",
  "name": "string",
  "general_type_name": "string",
  "status": "string",
  "data": {},
  "graph_name": "string",
  "agent_bundle_id": "uuid",
  "created_at": "ISO-8601",
  "modified_at": "ISO-8601",
  "is_archived": false
}
```

### POST /api/node

Create a new node. Supports `?batch=true` for automatic batching.

**Request Body**:
```json
{
  "name": "string (required)",
  "general_type_name": "string (required)",
  "data": {},
  "status": "string (default: 'Created')",
  "graph_name": "string (default: 'default')"
}
```

### POST /api/nodes/batch

Get multiple nodes by IDs.

**Request Body**:
```json
{
  "ids": ["uuid", "uuid", ...]
}
```

### PATCH /api/node/:id/data

Update node data with JSON merge. Existing fields not in the patch are preserved.

**Request Body**:
```json
{
  "key": "new_value",
  "nested.path": "deep_update"
}
```

### PATCH /api/node/:id/status

Update node status.

**Request Body**:
```json
{
  "status": "Completed"
}
```

### PATCH /api/node/:id/archive

Archive or unarchive a node (soft delete).

**Request Body**:
```json
{
  "is_archived": true
}
```

## Edge Endpoints

### GET /api/edge/:id

Retrieve a single edge by ID.

### POST /api/edge

Create a new edge. Supports `?batch=true` for automatic batching.

**Request Body**:
```json
{
  "source_node_id": "uuid (required)",
  "target_node_id": "uuid (required)",
  "edge_type": "string (required)",
  "data": {},
  "graph_name": "string (default: 'default')"
}
```

### POST /api/edge/udf

Create an edge using a user-defined function (server-side edge creation logic).

### POST /api/edges/batch

Get multiple edges by IDs.

### PATCH /api/edge/:id/data

Update edge data with JSON merge.

## Relationship Traversal Endpoints

### GET /api/node/:id/edges

Get all edges (both incoming and outgoing) for a node.

### GET /api/node/:id/edges/from

Get outbound edges only.

### GET /api/node/:id/edges/to

Get inbound edges only.

### GET /api/node/:id/connected-nodes

Get connected nodes filtered by edge type.

**Query Parameters**:

| Parameter | Type | Purpose |
|-----------|------|---------|
| `edgeType` | string | Filter by edge type |
| `direction` | string | `from` or `to` |

### POST /api/connected-nodes/jsonpath

Filter connected nodes using JSONPath expressions on node data.

**Request Body**:
```json
{
  "node_id": "uuid",
  "edge_type": "string",
  "jsonpath": "$.field ? (@ > 10)"
}
```

## Search Endpoints

### POST /api/search/nodes

Global search across all agent bundles.

**Request Body**:
```json
{
  "condition": {"field": {"$operator": "value"}},
  "order_by": {"field": "asc|desc"},
  "page": 0,
  "size": 50
}
```

**Condition Operators**: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$like`

### POST /api/search/nodes/scoped

Search scoped to a specific agent bundle (uses `X-Agent-Bundle-Id` header).

Same request body as `/api/search/nodes`.

### POST /api/search/udf

Execute a custom search via user-defined function.

## Node I/O Endpoints

### GET /api/node/:id/io

Get execution input/output for a runnable entity.

### PUT /api/node/:id/io

Set node I/O data.

**Request Body**:
```json
{
  "input": {},
  "output": {}
}
```

### POST /api/node/:id/io/progress

Append a progress envelope.

**Request Body**:
```json
{
  "type": "STATUS|MESSAGE|ERROR|BOT_PROGRESS|VALUE|WAITING",
  "status": "string",
  "message": "string",
  "value": {},
  "sub_type": "string"
}
```

### GET /api/node/:id/progress

Get all progress envelopes for a node.

## Vector Endpoints

### POST /api/vector/embedding

Create an embedding for a node.

**Request Body**:
```json
{
  "node_id": "uuid",
  "embedding": [0.1, 0.2, ...],
  "metadata": {}
}
```

The embedding must be a 3072-dimensional vector (compatible with OpenAI text-embedding-3-large).

### GET /api/vector/similar/:node_id

Find nodes similar to a given node.

**Query Parameters**:

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `limit` | number | 10 | Maximum results |
| `threshold` | number | 0 | Minimum similarity score (0–1) |
| `metadata_filters` | JSON | | Filter by embedding metadata |

### POST /api/vector/search

Search by raw embedding vector.

**Request Body**:
```json
{
  "embedding": [0.1, 0.2, ...],
  "limit": 10,
  "threshold": 0.8,
  "metadata_filters": {},
  "order_config": {
    "orderBy": "similarity|modified|created",
    "orderDirection": "ASC|DESC"
  }
}
```

## System Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Liveness probe |
| `/ready` | GET | Readiness probe (checks database connectivity) |
| `/status` | GET | Service status and uptime |
| `/api/cache/stats` | GET | Cache performance metrics |
| `/api/batch/metrics` | GET | Batch insert statistics |

## Error Responses

Errors return standard JSON with appropriate HTTP status codes:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

| Status | Meaning |
|--------|---------|
| 400 | Invalid request (missing fields, bad format) |
| 404 | Node or edge not found |
| 409 | Conflict (duplicate creation) |
| 500 | Internal server error |
