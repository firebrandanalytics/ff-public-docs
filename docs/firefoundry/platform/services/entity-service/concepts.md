# Entity Service — Concepts

This page explains the model you design your application around: the entity graph, nodes, edges, partitions, bundle scoping, node I/O and progress, and vector search.

## The Entity Graph

The entity graph is a labeled property graph. Persistent state in a FireFoundry application — your domain entities, workflows, bot runs, and the relationships between them — lives in the graph. It has two primitives:

- **Nodes**: Entities with a type, arbitrary JSON data, and a status
- **Edges**: Directed, typed relationships between nodes

### Why a Graph?

Agent applications produce richly connected data. A single workflow run creates entities, calls bots, produces child entities, stores results, and reports progress. A graph models these relationships directly, so you can answer questions like "what did this workflow produce?" or "which run created this document?" by traversal instead of bespoke bookkeeping.

## Nodes

A **node** represents a single entity. Every node has:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Primary identifier |
| `name` | string | Human-readable name |
| `general_type_name` | string | Entity type (e.g., `DocumentEntity`, `WorkflowEntity`) |
| `status` | string | Lifecycle status (e.g., `Created`, `Running`, `Completed`, `Failed`) |
| `data` | JSON object | Your domain-specific properties |
| `graph_name` | string | Graph partition name |
| `agent_bundle_id` | UUID | Owning agent bundle |
| `created_at` | timestamp | Creation time |
| `modified_at` | timestamp | Last modification time |
| `is_archived` | boolean | Soft-delete flag |

### Node Data

The `data` field holds your entity's domain properties as JSON. In the Agent SDK you read and write it through entity classes and decorators such as `@property`. Data can be queried with JSON containment and JSONPath expressions, and updates are merges: fields you don't send are preserved.

### Node Status Lifecycle

Runnable nodes progress through a standard status lifecycle:

```
Created → Running → Completed
                  ↘ Failed
                  ↘ Cancelled
```

Status transitions are also recorded in progress envelopes (see below).

## Edges

An **edge** is a directed, typed relationship between two nodes:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Edge identifier |
| `source_node_id` | UUID | Source node |
| `target_node_id` | UUID | Target node |
| `edge_type` | string | Relationship type name |
| `data` | JSON object | Optional edge data |
| `graph_name` | string | Graph partition |

### Common Edge Types

| Edge Type | Meaning |
|-----------|---------|
| `HAS_CHILD` | Parent-child containment |
| `Calls` | Invocation relationship (workflow calls bot) |
| `HAS_STEP` | Workflow contains a step |
| `BELONGS_TO` | Membership or ownership |
| `REFERENCES` | Soft reference between entities |

You can define your own edge types for your domain (for example `ATTACHED_TO`, `REVIEWED_BY`). Choose names that read naturally as "source → edge → target".

### Edge Traversal

Edges support forward and reverse traversal:
- **Outgoing edges** (`edges-from`): Follow edges from a source node
- **Incoming edges** (`edges-to`): Find what points to a target node
- **Connected nodes**: Get the nodes on the other side of edges, optionally filtered by edge type or by a JSONPath condition on their data

## Graph Partitions

Nodes and edges belong to a **graph partition** (the `graph_name` field), which provides logical separation of data:

- Each agent bundle typically uses its own partition
- Queries can be scoped to a partition for isolation
- The `default` partition is used when no graph name is specified

The `X-Graph-Name` request header selects the partition for a REST call.

## Agent Bundle Scoping

Nodes are associated with an **agent bundle** via `agent_bundle_id`. This lets you:
- Search only your own bundle's entities (scoped search)
- Share one platform installation across multiple applications
- Attribute and audit data by bundle

The `X-Agent-Bundle-Id` request header sets the bundle context. The SDK entity client (`createEntityClient(APP_ID)`) sets this for you.

## Node I/O and Progress Tracking

Runnable entities (workflows, bots) record their execution in two ways.

### Node I/O

The I/O object stores the entity's input and output:

```json
{
  "input": { "query": "Analyze Q4 revenue" },
  "output": { "summary": "Revenue grew 15% in Q4..." }
}
```

### Progress Envelopes

Progress envelopes form an append-only timeline of the entity's execution:

| Envelope Type | Purpose |
|---------------|---------|
| `STATUS` | Execution state changes (STARTED, RUNNING, COMPLETED, FAILED, CANCELLED) |
| `MESSAGE` | Informational messages during execution |
| `ERROR` | Error details with a structured error |
| `BOT_PROGRESS` | Nested bot execution progress (percolates up through `Calls` edges) |
| `VALUE` | Yielded values; `sub_type: "return"` indicates the final output |
| `WAITING` | Entity paused for external input (waitables / human-in-the-loop) |

**Progress percolation**: when entity A calls entity B (connected by a `Calls` edge), B's progress envelopes appear in A's timeline. Your UI or client can monitor an entire execution tree from the root entity.

## Vector Search

You can attach an embedding to a node and then search for semantically similar nodes.

1. **Store an embedding** for a node, with optional metadata
2. **Find similar nodes** to a given node, ranked by cosine similarity
3. **Search by raw vector**, e.g. an embedding you computed from a user's query

Embeddings must be **3072-dimensional** (compatible with OpenAI `text-embedding-3-large`). The service stores and searches embeddings; your application (or the SDK/broker) is responsible for producing them.

Query options:
- Similarity threshold (0–1) and result limit
- Filtering on embedding metadata
- Ordering by similarity, created time, or modified time

## Designing Your App Around the Graph

- **Model domain objects as entities, not blobs.** Put fields you will search or filter on in node `data`; link related objects with edges rather than embedding IDs in data.
- **Use containment edges for ownership** (`HAS_CHILD`, or your own type) so you can fetch "everything under X" in one traversal.
- **Scope searches to your bundle.** Scoped searches are faster and avoid seeing other applications' data. Global search is for admin and diagnostic tools.
- **Treat progress envelopes as your run log.** Stream them to your UI instead of polling status fields; use `VALUE` with `sub_type: "return"` for final results.
- **Archive instead of deleting.** Archiving is a soft delete that keeps history intact; hard deletes are an administrative operation (`ff-eg-admin`).
- **Keep large binary content elsewhere.** Store files in working memory (via the [Context Service](../context-service/README.md)) and keep references in the entity graph.
