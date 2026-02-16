---
name: ff-eg-read
description: Read and query the FireFoundry Entity Graph. Use when you need to inspect entities, traverse relationships, search nodes, or explore the entity graph structure for debugging or analysis.
version: 1.1.0
tags: [cli-tool, firefoundry, entity-graph, diagnostics]
---

# FireFoundry Entity Graph Read Skill

Read-only CLI tool for querying and exploring the FireFoundry Entity Graph.

## Overview

The `ff-eg-read` tool provides safe, read-only access to the entity graph. Use it to:
- Inspect individual entities (nodes) and their properties
- Traverse relationships (edges) between entities
- Search for entities by conditions
- Find similar entities via vector search
- Explore the graph structure for debugging

**Command format:**
```bash
ff-eg-read <command> <subcommand> [options]
```

## Prerequisites

The tool auto-configures from environment variables or a `.env` file in the current working directory.

**Installation:**
```bash
npm install -g @firebrandanalytics/ff-eg-read
```

**Verify it's working:**
```bash
ff-eg-read node get --help
```

For connection troubleshooting, load [modes/configuration.md](./modes/configuration.md).

## Quick Reference

### Node Commands

| Command | Purpose |
|---------|---------|
| `node get <id>` | Get a single node by ID |
| `node get-batch <id1> <id2>...` | Get multiple nodes |
| `node get-by-name <name>` | Get node by name |
| `node io <id>` | Get node input/output data (runnable entities) |
| `node progress <id>` | Get progress envelopes (runnable entities) |
| `node edges <id>` | Get all edges for a node |
| `node edges-from <id>` | Get outgoing edges |
| `node edges-to <id>` | Get incoming edges |
| `node with-edges <id>` | Get node with all its edges |
| `node connected <id> <edge-type>` | Get connected nodes by edge type |
| `node connected-udf <id> <edge-type> --max-depth N` | Deep traversal |

### Search Commands

| Command | Purpose |
|---------|---------|
| `search nodes` | Global search across all agent bundles |
| `search nodes-scoped` | Search within your agent bundle |
| `search data` | Search by JSONB data (containment/jsonpath, GIN-indexed) |
| `search reverse-connected <edge-type> <id>` | Find parent nodes |
| `search jsonpath <node-id> <edge-type> --options '{...}'` | JSONPath search |

### Utility Commands

| Command | Purpose |
|---------|---------|
| `count` | Count nodes matching conditions |
| `exists <id>` | Check if a node exists by ID |
| `edge-types` | List distinct edge type names |

### Vector Commands

| Command | Purpose |
|---------|---------|
| `vector similar <node-id>` | Find similar nodes |
| `vector search-embedding --embedding '[...]'` | Search by vector |

## Common Patterns

### Inspect an Entity

```bash
# Get full entity details
ff-eg-read node get <entity-id> | jq .

# Get just the entity name and status
ff-eg-read node get <entity-id> | jq '{name: .name, status: .status}'

# Get entity with all relationships
ff-eg-read node with-edges <entity-id> | jq .
```

### Explore Relationships

```bash
# See what's connected to an entity
ff-eg-read node edges <entity-id> | jq '.[] | {type: .edge_type, target: .target_id}'

# Get all child entities of a specific type
ff-eg-read node connected <entity-id> HAS_CHILD | jq '.[] | .name'

# Deep traversal (e.g., find all descendants)
ff-eg-read node connected-udf <entity-id> HAS_CHILD --max-depth 5
```

### Search for Entities

```bash
# Find entities by status
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}'

# Find entities by type
ff-eg-read search nodes-scoped --condition '{"entity_type": {"$eq": "DocumentEntity"}}'

# Recent entities (ordered by creation)
ff-eg-read search nodes-scoped --order-by '{"created_at": "desc"}' --size 10

# Combined conditions
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Completed"}, "entity_type": {"$eq": "WorkflowEntity"}}' \
  --size 20
```

### JSONB Data Search

```bash
# Find entities with specific data properties (uses GIN-indexed @> operator)
ff-eg-read search data --containment '{"color": "red"}'

# Find entities using JSONPath expression (uses GIN-indexed @? operator)
ff-eg-read search data --jsonpath '$.tags[*] ? (@ == "important")'

# Combine containment and jsonpath with pagination
ff-eg-read search data --containment '{"type": "doc"}' --jsonpath '$.score > 0.5' --page 0 --size 20
```

### Utility Operations

```bash
# Count matching entities
ff-eg-read count --condition '{"status": {"$eq": "Failed"}}'

# Check if a specific entity exists
ff-eg-read exists <entity-id>

# List all edge types in the graph
ff-eg-read edge-types
ff-eg-read edge-types --agent-bundle-id-filter <uuid>
```

### Find Parents (Reverse Lookup)

```bash
# What entities point to this one?
ff-eg-read search reverse-connected BELONGS_TO <entity-id>

# Find workflow that owns this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "HAS_CHILD")'
```

### Vector Similarity

```bash
# Find entities similar to a given one
ff-eg-read vector similar <entity-id> --limit 5 --threshold 0.8

# Filter by metadata
ff-eg-read vector similar <entity-id> --metadata-filters '{"type": "document"}'
```

## Runnable Entity Diagnostics

Runnable entities (workflows, bots, etc.) have additional diagnostic data: **output** and **progress envelopes**.

### Get Entity Output

The output is whatever the runnable's `run_impl` generator returned:

```bash
# Get the output of a runnable entity
ff-eg-read node io <entity-id> | jq .

# Extract just the output (the return value)
ff-eg-read node io <entity-id> | jq '.output'
```

Cross-reference the output structure with the entity's TypeScript `run_impl` to understand what was returned.

### Get Progress Envelopes

Progress envelopes show the execution lifecycle of a runnable:

```bash
# Get all progress envelopes
ff-eg-read node progress <entity-id> | jq .

# Filter by type
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "STATUS")'
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR")'
```

### Progress Envelope Types

| Type | Purpose |
|------|---------|
| `STATUS` | Execution state (STARTED, RUNNING, COMPLETED, FAILED, CANCELLED) |
| `MESSAGE` | Informational messages |
| `ERROR` | Error details with FFError |
| `BOT_PROGRESS` | Nested bot execution progress |
| `VALUE` | Yielded values (`sub_type: "return"` = final output) |
| `WAITING` | Entity paused for external input (waitables) |

### Expected Lifecycle Pattern

A healthy runnable shows this pattern:

```
STATUS (STARTED) → ... processing ... → STATUS (COMPLETED/FAILED) → STATUS (finished)
```

**Diagnostic signals:**
- **Missing COMPLETED after STARTED** = crash or hang
- **ERROR envelope** = exception details
- **FAILED status** = controlled failure
- **VALUE with sub_type "return"** = the actual return value

### Analyze Progress Timeline

```bash
# See execution timeline
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status, message, entity_name}'

# Find where it failed
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "STATUS" and .status == "FAILED")'

# Find errors
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR") | .error'

# Find the return value
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "VALUE" and .sub_type == "return") | .value'
```

### Bot Progress (Nested)

Bot execution is wrapped in `BOT_PROGRESS` envelopes:

```bash
# See bot execution phases
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "BOT_PROGRESS") | {bot: .progress.bot_name, status: .progress.status, sub_type: .progress.sub_type}'
```

Bot phases: `THREAD` (started) → `TRY` (attempt) → completion

### Trace Call Stack

Progress envelopes percolate up through entities connected by "Calls" edges:

```bash
# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'

# Get progress from the caller (will include this entity's progress)
ff-eg-read node progress <caller-entity-id>
```

## Output Processing with jq

All commands output JSON. Common jq patterns:

```bash
# Pretty print
ff-eg-read node get <id> | jq .

# Extract specific fields
ff-eg-read node get <id> | jq '{id, name, status, created_at}'

# Process arrays
ff-eg-read search nodes-scoped --condition '...' | jq '.result[].id'

# Filter results
ff-eg-read node edges <id> | jq '.[] | select(.edge_type == "HAS_CHILD")'

# Count results
ff-eg-read search nodes-scoped --condition '...' | jq '.result | length'
```

## Diagnostic Workflows

### Starting Point: Known Entity ID

When you have an entity ID (e.g., from logs or telemetry):

```bash
# 1. Get the entity
ff-eg-read node get <entity-id> | jq .

# 2. Understand its relationships
ff-eg-read node with-edges <entity-id> | jq .

# 3. Find related entities
ff-eg-read node connected <entity-id> <edge-type>
```

### Starting Point: Entity Name or Type

When searching for entities:

```bash
# 1. Search by name
ff-eg-read node get-by-name "MyWorkflow"

# 2. Search by type and status
ff-eg-read search nodes-scoped \
  --condition '{"entity_type": {"$eq": "ReportEntity"}, "status": {"$eq": "Failed"}}'
```

### Tracing a Workflow

```bash
# 1. Get the workflow entity
ff-eg-read node get <workflow-id> | jq .

# 2. Find all steps/children
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {name, status}'

# 3. For failed steps, get details
ff-eg-read node get <failed-step-id> | jq .
```

## Error Handling

If commands fail, the tool auto-configures from `.env` files so configuration issues are rare.

For connection troubleshooting, load [modes/configuration.md](./modes/configuration.md).

## See Also

- [ff-diagnostics](../ff-diagnostics/SKILL.md) - Full diagnostic workflow orchestration
- [ff-telemetry-read](../ff-telemetry-read/SKILL.md) - Telemetry and request tracing
- [ff-cli](../ff-cli/SKILL.md) - Cluster operations
