# Entity Service — Concepts

This page explains the core concepts underlying the Entity Service: the entity graph model, nodes, edges, partitions, vector search, and progress tracking.

## The Entity Graph

The entity graph is a labeled property graph stored in PostgreSQL. Every piece of persistent state in FireFoundry — entities, workflows, bots, relationships — lives in the graph. The graph consists of two fundamental primitives:

- **Nodes**: Entities with typed data, metadata, and status
- **Edges**: Directed, typed relationships between nodes

### Why a Graph?

Agent-based systems produce richly connected data. A single workflow execution creates entities, calls bots, produces child entities, stores results, and logs progress. A graph naturally models these relationships without the rigidity of relational tables or the query limitations of document stores.

## Nodes

A **node** represents a single entity in the graph. Every node has:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Primary identifier |
| `name` | string | Human-readable name |
| `general_type_name` | string | Entity type (e.g., `DocumentEntity`, `WorkflowEntity`) |
| `status` | string | Lifecycle status (e.g., `Created`, `Running`, `Completed`, `Failed`) |
| `data` | JSONB | Arbitrary structured data |
| `graph_name` | string | Graph partition name |
| `agent_bundle_id` | UUID | Owning agent bundle |
| `created_at` | timestamp | Creation time |
| `modified_at` | timestamp | Last modification time |
| `is_archived` | boolean | Soft-delete flag |

### Node Data

The `data` field is a JSONB column that stores the entity's domain-specific properties. Agent code reads and writes to this field via SDK decorators like `@property`. The data can be queried using JSON path expressions and containment operators.

### Node Status Lifecycle

Nodes progress through a standard status lifecycle:

```
Created → Running → Completed
                  ↘ Failed
                  ↘ Cancelled
```

Status transitions are tracked in progress envelopes (see below).

## Edges

An **edge** is a directed, typed relationship between two nodes:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Edge identifier |
| `source_node_id` | UUID | Source node |
| `target_node_id` | UUID | Target node |
| `edge_type` | string | Relationship type name |
| `data` | JSONB | Optional edge data |
| `graph_name` | string | Graph partition |

### Common Edge Types

| Edge Type | Meaning |
|-----------|---------|
| `HAS_CHILD` | Parent-child containment |
| `Calls` | Invocation relationship (workflow calls bot) |
| `HAS_STEP` | Workflow contains a step |
| `BELONGS_TO` | Membership or ownership |
| `REFERENCES` | Soft reference between entities |

### Edge Traversal

Edges support both forward and reverse traversal:
- **Outgoing edges** (`edges-from`): Follow edges from a source node
- **Incoming edges** (`edges-to`): Find what points to a target node
- **Connected nodes**: Get the nodes on the other side of edges
- **Recursive traversal**: Follow edges to a configurable depth (`connected-udf`)

## Graph Partitions

Nodes and edges are organized into **graph partitions** (the `graph_name` field). Partitions provide logical separation of entity data:

- Each agent bundle typically gets its own partition
- Queries can be scoped to a partition for isolation
- The `default` partition is used when no graph name is specified
- Partitions map to PostgreSQL table partitions for query performance

The `X-Graph-Name` request header controls which partition an API call operates on.

## Agent Bundle Scoping

Nodes are associated with an **agent bundle** via the `agent_bundle_id` field. This scoping enables:
- Searching within a single agent bundle's entities (scoped search)
- Multi-tenant isolation on shared infrastructure
- Bundle-level access control and auditing

The `X-Agent-Bundle-Id` request header sets the agent bundle context for API operations.

## Node I/O and Progress Tracking

Runnable entities (workflows, bots) track their execution through two mechanisms:

### Node I/O

The I/O object stores the entity's input and output data:

```json
{
  "input": { "query": "Analyze Q4 revenue" },
  "output": { "summary": "Revenue grew 15% in Q4..." }
}
```

### Progress Envelopes

Progress envelopes form a timeline of the entity's execution lifecycle:

| Envelope Type | Purpose |
|---------------|---------|
| `STATUS` | Execution state changes (STARTED, RUNNING, COMPLETED, FAILED, CANCELLED) |
| `MESSAGE` | Informational messages during execution |
| `ERROR` | Error details with structured FFError |
| `BOT_PROGRESS` | Nested bot execution progress (percolates up through Calls edges) |
| `VALUE` | Yielded values; `sub_type: "return"` indicates the final output |
| `WAITING` | Entity paused for external input (waitables / human-in-the-loop) |

Progress percolation: When entity A calls entity B (connected by a "Calls" edge), B's progress envelopes appear in A's progress timeline. This allows monitoring a full execution tree from the root.

## Vector Search

The Entity Service integrates pgvector for semantic similarity search:

### How It Works

1. **Embedding creation**: When an entity is created or updated, an embedding vector (3072 dimensions, compatible with OpenAI text-embedding-3-large) is stored in the `entity.vector_similarity` table
2. **Similarity search**: Given a node ID, find other nodes with similar embeddings using cosine distance (`<=>` operator)
3. **Raw search**: Search using a raw embedding vector directly

### Query Capabilities

- Cosine distance similarity scoring
- Configurable similarity thresholds (0–1)
- Result limit and offset pagination
- Metadata-based filtering on embedding records
- Combined semantic + temporal ordering

## Batch Insert

The Entity Service supports automatic write batching for high-throughput scenarios:

- Nodes can be created with `?batch=true` query parameter
- The `BatchInsertManager` accumulates writes and flushes them in bulk
- Flush triggers: configurable row count threshold or time duration
- Metrics endpoint (`/api/batch/metrics`) reports batch statistics

This is particularly useful for workflows that create many entities in rapid succession, reducing database round-trips.

## Caching

API response caching via apicache reduces database load for repeated read operations:
- Configurable TTL (default: 2 seconds)
- Cache hit/miss statistics available at `/api/cache/stats`
- Can be disabled via `CACHE_ENABLED=false`
