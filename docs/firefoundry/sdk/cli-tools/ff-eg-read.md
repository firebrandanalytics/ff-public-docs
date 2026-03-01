# ff-eg-read — Entity Graph Read Operations

Read-only CLI tool for querying and exploring the FireFoundry Entity Graph. Inspect entities, traverse relationships, search by conditions, and find similar entities via vector search.

## Installation

```bash
npm install -g @firebrandanalytics/ff-eg-read
```

Verify:

```bash
ff-eg-read node get --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose |
|----------|---------|
| `FF_EG_URL` | Entity Graph service URL |
| `FF_AGENT_BUNDLE_ID` | Agent bundle ID (for scoped searches) |

## Command Reference

### Node Commands

Get individual entities and their relationships.

#### node get

Get a single node by ID.

```bash
ff-eg-read node get <id>
```

```bash
# Get full entity details
ff-eg-read node get <entity-id> | jq .

# Extract specific fields
ff-eg-read node get <entity-id> | jq '{name: .name, status: .status}'
```

#### node get-batch

Get multiple nodes in a single request.

```bash
ff-eg-read node get-batch <id1> <id2> ...
```

#### node get-by-name

Look up a node by its name.

```bash
ff-eg-read node get-by-name <name>
```

```bash
ff-eg-read node get-by-name "MyWorkflow"
```

#### node io

Get input/output data for a runnable entity (workflow, bot, etc.). The output is whatever the runnable's `run_impl` generator returned.

```bash
ff-eg-read node io <id>
```

```bash
# Get full I/O data
ff-eg-read node io <entity-id> | jq .

# Extract just the output
ff-eg-read node io <entity-id> | jq '.output'
```

#### node progress

Get progress envelopes showing the execution lifecycle of a runnable entity.

```bash
ff-eg-read node progress <id>
```

Progress envelope types:

| Type | Purpose |
|------|---------|
| `STATUS` | Execution state (STARTED, RUNNING, COMPLETED, FAILED, CANCELLED) |
| `MESSAGE` | Informational messages |
| `ERROR` | Error details with FFError |
| `BOT_PROGRESS` | Nested bot execution progress |
| `VALUE` | Yielded values (`sub_type: "return"` = final output) |
| `WAITING` | Entity paused for external input (waitables) |

```bash
# See execution timeline
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status, message, entity_name}'

# Find errors
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR") | .error'

# Find the return value
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "VALUE" and .sub_type == "return") | .value'

# See bot execution phases
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "BOT_PROGRESS") | {bot: .progress.bot_name, status: .progress.status}'
```

**Expected lifecycle:** A healthy runnable shows `STATUS (STARTED) → ... processing ... → STATUS (COMPLETED/FAILED)`. Missing COMPLETED after STARTED indicates a crash or hang.

#### node edges

Get all edges (relationships) for a node.

```bash
ff-eg-read node edges <id>
```

```bash
ff-eg-read node edges <entity-id> | jq '.[] | {type: .edge_type, target: .target_id}'
```

#### node edges-from

Get outgoing edges only.

```bash
ff-eg-read node edges-from <id>
```

#### node edges-to

Get incoming edges only.

```bash
ff-eg-read node edges-to <id>
```

```bash
# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'
```

#### node with-edges

Get a node together with all its edges in a single request.

```bash
ff-eg-read node with-edges <id>
```

#### node connected

Get all nodes connected by a specific edge type.

```bash
ff-eg-read node connected <id> <edge-type>
```

```bash
# Get all child entities
ff-eg-read node connected <entity-id> HAS_CHILD | jq '.[] | .name'

# Find all steps in a workflow
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {name, status}'
```

#### node connected-udf

Deep traversal — recursively follow edges up to a maximum depth.

```bash
ff-eg-read node connected-udf <id> <edge-type> --max-depth <N>
```

```bash
# Find all descendants up to 5 levels deep
ff-eg-read node connected-udf <entity-id> HAS_CHILD --max-depth 5
```

### Search Commands

Find entities by conditions across the graph.

#### search nodes

Global search across all agent bundles.

```bash
ff-eg-read search nodes [options]
```

#### search nodes-scoped

Search within your agent bundle (uses `FF_AGENT_BUNDLE_ID`).

```bash
ff-eg-read search nodes-scoped [options]
```

| Option | Purpose |
|--------|---------|
| `--condition '<json>'` | Filter by entity properties |
| `--order-by '<json>'` | Sort results |
| `--size <N>` | Limit result count |

Condition operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$like`.

```bash
# Find entities by status
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}'

# Find entities by type
ff-eg-read search nodes-scoped --condition '{"entity_type": {"$eq": "DocumentEntity"}}'

# Recent entities
ff-eg-read search nodes-scoped --order-by '{"created_at": "desc"}' --size 10

# Combined conditions
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Completed"}, "entity_type": {"$eq": "WorkflowEntity"}}' \
  --size 20
```

#### search data

Search by JSONB data using GIN-indexed containment (`@>`) or JSONPath (`@?`) operators.

```bash
ff-eg-read search data [options]
```

| Option | Purpose |
|--------|---------|
| `--containment '<json>'` | Match by data containment (`@>` operator) |
| `--jsonpath '<expr>'` | Match by JSONPath expression (`@?` operator) |
| `--page <N>` | Page number (0-indexed) |
| `--size <N>` | Results per page |

```bash
# Find entities with specific data properties
ff-eg-read search data --containment '{"color": "red"}'

# Find using JSONPath expression
ff-eg-read search data --jsonpath '$.tags[*] ? (@ == "important")'

# Combine both with pagination
ff-eg-read search data --containment '{"type": "doc"}' --jsonpath '$.score > 0.5' --page 0 --size 20
```

#### search reverse-connected

Find parent nodes — entities that have an edge of a given type pointing to a target node.

```bash
ff-eg-read search reverse-connected <edge-type> <id>
```

```bash
# What entities point to this one?
ff-eg-read search reverse-connected BELONGS_TO <entity-id>
```

#### search jsonpath

JSONPath search scoped to connected entities.

```bash
ff-eg-read search jsonpath <node-id> <edge-type> --options '<json>'
```

### Utility Commands

#### count

Count nodes matching conditions.

```bash
ff-eg-read count --condition '<json>'
```

```bash
ff-eg-read count --condition '{"status": {"$eq": "Failed"}}'
```

#### exists

Check if a node exists by ID.

```bash
ff-eg-read exists <id>
```

#### edge-types

List distinct edge type names in the graph.

```bash
ff-eg-read edge-types
ff-eg-read edge-types --agent-bundle-id-filter <uuid>
```

### Vector Commands

Semantic similarity search using pre-computed embeddings.

#### vector similar

Find nodes similar to a given node.

```bash
ff-eg-read vector similar <node-id> [options]
```

| Option | Purpose |
|--------|---------|
| `--limit <N>` | Maximum results |
| `--threshold <0-1>` | Minimum similarity score |
| `--metadata-filters '<json>'` | Filter by metadata |

```bash
ff-eg-read vector similar <entity-id> --limit 5 --threshold 0.8
ff-eg-read vector similar <entity-id> --metadata-filters '{"type": "document"}'
```

#### vector search-embedding

Search by a raw embedding vector.

```bash
ff-eg-read vector search-embedding --embedding '[0.1, 0.2, ...]'
```

## Diagnostic Workflows

### Starting from a Known Entity ID

```bash
# 1. Get the entity
ff-eg-read node get <entity-id> | jq .

# 2. Understand its relationships
ff-eg-read node with-edges <entity-id> | jq .

# 3. Find related entities
ff-eg-read node connected <entity-id> <edge-type>
```

### Finding Failed Entities

```bash
# 1. Search for failures
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}'

# 2. Get progress for a failed entity
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR") | .error'
```

### Tracing a Workflow

```bash
# 1. Get the workflow entity
ff-eg-read node get <workflow-id> | jq .

# 2. Find all steps
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {name, status}'

# 3. Get details for failed steps
ff-eg-read node get <failed-step-id> | jq .

# 4. Check progress envelopes for the failure
ff-eg-read node progress <failed-step-id> | jq '.[] | select(.type == "ERROR")'
```

### Tracing Call Stacks

Progress envelopes percolate up through entities connected by "Calls" edges:

```bash
# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'

# Get progress from the caller (includes this entity's progress)
ff-eg-read node progress <caller-entity-id>
```

## See Also

- [ff-eg-write](ff-eg-write.md) — Write operations (create, update, delete)
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
- [ff-wm-read](ff-wm-read.md) — Read working memory (files, records)
- [Entity Service](../../platform/services/entity-service.md) — Platform service documentation
