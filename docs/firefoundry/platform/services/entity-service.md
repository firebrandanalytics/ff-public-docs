# Entity Service

## Overview

The Entity Service is a high-performance REST API that manages the FireFoundry Entity Graph, providing CRUD operations for nodes and edges with vector-based semantic search capabilities powered by PostgreSQL and pgvector.

## Purpose and Role in Platform

The Entity Service serves as the central knowledge store for FireFoundry agents, enabling them to:
- Store and retrieve structured entity data (nodes) and relationships (edges)
- Perform semantic similarity searches using vector embeddings
- Track execution state and progress through node I/O envelopes
- Query and traverse complex graph relationships
- Manage entity types, schemas, and metadata

This service acts as the persistent memory layer for agents, allowing them to build and query knowledge graphs over time.

## Key Features

- **Entity Graph CRUD**: Full create, read, update operations for nodes and edges with relationship traversal
- **Vector Semantic Search**: pgvector-powered similarity search for finding semantically related entities
- **Batch Insert Optimization**: Automatic batching of writes with configurable thresholds for high-throughput scenarios
- **Node I/O Tracking**: Store and append execution progress envelopes for workflow state management
- **Type-Safe Database Access**: Kysely query builder with full TypeScript type safety
- **Graph Traversal**: Recursive relationship queries with configurable depth and edge type filtering
- **API Response Caching**: Built-in apicache middleware for optimized read performance
- **CLI Tooling**: Command-line interface for health checks and entity operations

## Architecture Overview

The Entity Service follows a layered architecture pattern:

```
┌─────────────────────────────────────────────────────┐
│                 REST API Layer                      │
│              (Express 5 + Router)                   │
│         RouteManager: CRUD, Search, Vector          │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Business Logic Layer                   │
│              EntityProvider Class                   │
│  - Graph operations  - Vector search                │
│  - Batch management  - Relationship traversal       │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Data Access Layer                      │
│     Kysely Query Builder + PostgreSQL Pools         │
│    (Separate read/write connection pools)           │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│             PostgreSQL Database                     │
│          with pgvector Extension                    │
│  - entity.node (partitioned)                        │
│  - entity.edge (partitioned)                        │
│  - entity.vector_similarity (embeddings)            │
└─────────────────────────────────────────────────────┘
```

**Core Components:**
- **Service Class**: Express application lifecycle management with graceful shutdown
- **RouteManager**: RESTful endpoint definitions organized by capability (CRUD, search, vector, traversal)
- **EntityProvider**: Business logic for all entity graph operations
- **BatchInsertManager**: Configurable write batching with automatic flush on count or duration thresholds
- **PostgreSQL Connection Pools**: Separate read (fireread) and write (fireinsert) connection pools for scalability

## Vector Search Capabilities

The Entity Service integrates pgvector for high-performance semantic search:

**Embedding Storage:**
- Stores 3072-dimensional vector embeddings (compatible with OpenAI text-embedding-3-large)
- Uses `vector(3072)` column type in `entity.vector_similarity` table
- Supports optional metadata filtering on embeddings

**Search Operations:**
1. **Create Embedding**: `POST /api/vector/embedding` - Store embedding for a node
2. **Find Similar**: `GET /api/vector/similar/:node_id` - Find nodes similar to a given node
3. **Search by Embedding**: `POST /api/vector/search` - Search using raw embedding vector

**Query Features:**
- Cosine distance similarity (using `<=>` operator)
- Configurable similarity thresholds
- Result limit and offset pagination
- Metadata-based filtering
- Combined semantic + temporal ordering

**Example Vector Search:**
```typescript
// Search for similar entities with metadata filtering
POST /api/vector/search
{
  "embedding": [0.123, -0.456, ...],  // 3072 dimensions
  "limit": 10,
  "threshold": 0.8,
  "metadata_filters": { "category": "documentation" },
  "order_config": { "orderBy": "modified", "orderDirection": "DESC" }
}
```

## API and Interfaces

### Core REST Endpoints

**Node Operations:**
- `GET /api/node/:id` - Retrieve node by ID
- `POST /api/node` - Create new node (supports `?batch=true` for automatic batching)
- `POST /api/nodes/batch` - Get multiple nodes by IDs
- `PATCH /api/node/:id/data` - Update node data with JSON path support
- `PATCH /api/node/:id/status` - Update node status
- `PATCH /api/node/:id/archive` - Archive/unarchive node

**Edge Operations:**
- `GET /api/edge/:id` - Retrieve edge by ID
- `POST /api/edge` - Create edge (supports batching)
- `POST /api/edge/udf` - Create edge using user-defined function
- `POST /api/edges/batch` - Get multiple edges
- `PATCH /api/edge/:id/data` - Update edge data

**Relationship Traversal:**
- `GET /api/node/:id/edges` - Get all edges (from and to)
- `GET /api/node/:id/edges/from` - Get outbound edges
- `GET /api/node/:id/edges/to` - Get inbound edges
- `GET /api/node/:id/connected-nodes` - Get connected nodes with edge type filtering
- `POST /api/connected-nodes/jsonpath` - Filter connected nodes using JSONPath expressions

**Search Operations:**
- `POST /api/search/nodes` - Search nodes with conditions, ordering, and pagination
- `POST /api/search/nodes/scoped` - Search scoped to agent bundle
- `POST /api/search/udf` - Execute custom search via user-defined function

**Node I/O Tracking:**
- `GET /api/node/:id/io` - Get execution input/output
- `PUT /api/node/:id/io` - Set node I/O
- `POST /api/node/:id/io/progress` - Append progress envelope
- `GET /api/node/:id/progress` - Get execution progress

**Vector Endpoints:**
- `POST /api/vector/embedding` - Create embedding for node
- `GET /api/vector/similar/:node_id` - Find similar nodes
- `POST /api/vector/search` - Search by embedding vector

**System Endpoints:**
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe (checks database connectivity)
- `GET /status` - Service status and uptime
- `GET /api/cache/stats` - Cache performance metrics
- `GET /api/batch/metrics` - Batch insert statistics

### Request Headers

- `X-Agent-Bundle-Id`: Agent bundle identifier for scoped operations
- `X-Graph-Name`: Graph partition name (defaults to "default")

## Dependencies

### Required Services
- **PostgreSQL 14+** with pgvector extension installed
- Database roles: `fireread` (readonly) and `fireinsert` (write access)
- Database: `firefoundry_beta` (configurable via `PG_DATABASE`)

### NPM Dependencies
- `express@5.0.1` - Web framework
- `kysely@0.27.4` - Type-safe SQL query builder
- `pg@8.13.1` - PostgreSQL client
- `pgvector@0.2.0` - Vector similarity extension bindings
- `apicache@1.6.3` - API response caching
- `@firebrandanalytics/shared-types` - Shared TypeScript types
- `@firebrandanalytics/shared-utils` - Logging and utilities

## Configuration

Environment variables for service configuration:

### Service Settings
```bash
NODE_ENV=development              # Environment: development | production | test
PORT=8080                         # HTTP server port
LOG_LEVEL=info                    # Logging level: debug | info | warn | error
SERVICE_NAME=entity-service       # Service identifier
```

### Database Connection
```bash
PG_DATABASE=firefoundry_beta      # Database name
PG_PORT=6432                      # PostgreSQL port (5432 direct, 6432 pgbouncer)
PG_PASSWORD=***                   # Readonly user password
PG_INSERT_PASSWORD=***            # Write user password
PG_POOL_MAX=10                    # Max connections per pool
PG_POOL_MIN=2                     # Min connections per pool
```

### Performance Tuning
```bash
CACHE_ENABLED=true                # Enable API response caching
CACHE_TTL_SECONDS=2               # Cache time-to-live
BATCH_INSERT_ENABLED=true         # Enable automatic write batching
BATCH_INSERT_MAX_ROWS=50          # Flush batch after N rows
BATCH_INSERT_MAX_DURATION_MS=100  # Flush batch after N milliseconds
```

### FireFoundry Context
```bash
FF_AGENT_BUNDLE_ID=a0000000...    # Internal agent bundle UUID for system types
```

## Version and Maturity

- **Current Version**: 0.3.0-beta.0
- **Status**: Beta - Active development, API may change
- **Node.js Version**: 20+ required
- **TypeScript**: Full type safety with strict mode

## Repository

Source code: [ff-services-entity](https://github.com/firebrandanalytics/ff-services-entity)

## Related Documentation

- [Platform Services Overview](./README.md) - Overview of all FireFoundry services
- [Agent SDK Entity Documentation](../../sdk/agent-sdk/entity.md) - Using entities from agent code
- [Entity Graph Concepts](../../concepts/entity-graph.md) - Understanding the entity graph model
- [Vector Search Guide](../../guides/vector-search.md) - Semantic search implementation patterns

## Usage Example

### Creating and Querying Entities

```typescript
// Create a node with batching enabled
const response = await fetch('http://entity-service:8080/api/node?batch=true', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Agent-Bundle-Id': 'your-agent-bundle-id'
  },
  body: JSON.stringify({
    name: 'Documentation Entity',
    general_type_name: 'Document',
    data: {
      title: 'API Reference',
      content: 'Comprehensive API documentation...'
    }
  })
});

const node = await response.json();

// Create embedding for semantic search
await fetch('http://entity-service:8080/api/vector/embedding', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    node_id: node.id,
    embedding: embeddingVector,  // 3072-dim vector from OpenAI
    metadata: { category: 'documentation' }
  })
});

// Find similar documents
const similar = await fetch(
  `http://entity-service:8080/api/vector/similar/${node.id}?limit=5&threshold=0.8`
);
```

### CLI Usage

```bash
# Check service health and database connectivity
pnpm cli health

# Retrieve an entity by ID
pnpm cli get a1b2c3d4-5678-90ab-cdef-1234567890ab

# Run with verbose logging
pnpm cli get <node-id> --verbose
```
