# Entity Graph Diagnostics

Using `ff-eg-read` for diagnostic investigations. This guide focuses on diagnostic patterns; see [ff-eg-read skill](../../ff-eg-read/SKILL.md) for full command reference.

## Runnable Entity Concepts

Runnable entities (workflows, bots, waitables) have executable logic via a `run_impl` generator that:
- **Yields progress envelopes** - Status updates, messages, errors, values
- **Returns an output** - The final result accessible via `node io`
- **Propagates progress up the call stack** - Progress appears in all callers connected by "Calls" edges

**Key diagnostic commands:**
- `ff-eg-read node io <id>` - Get the output (what `run_impl` returned)
- `ff-eg-read node progress <id>` - Get all progress envelopes

## Diagnostic Starting Points

### Starting from a Known Entity ID

When you have an entity ID (e.g., from logs or telemetry):

```bash
# 1. Get the entity's current state
ff-eg-read node get <entity-id> | jq '{name, status, entity_type, created_at, updated_at}'

# 2. Check for error information
ff-eg-read node get <entity-id> | jq '.error // .error_message // .failure_reason // "no error field"'

# 3. See all properties
ff-eg-read node get <entity-id> | jq .
```

### Starting from an Entity Name

When you know the entity name but not the ID:

```bash
# Get by exact name
ff-eg-read node get-by-name "MyWorkflowEntity"

# Search by name pattern (if supported in conditions)
ff-eg-read search nodes-scoped --condition '{"name": {"$regex": ".*Report.*"}}'
```

### Finding Failed Entities

```bash
# Find all failed entities
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "Failed"}}'

# Find recently failed entities
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Failed"}}' \
  --order-by '{"updated_at": "desc"}' \
  --size 10

# Find failed entities of a specific type
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Failed"}, "entity_type": {"$eq": "WorkflowEntity"}}'
```

## Relationship Exploration

### Understanding Entity Relationships

```bash
# Get all edges (relationships) for an entity
ff-eg-read node edges <entity-id> | jq '.[] | {type: .edge_type, direction: (if .source_id == "<entity-id>" then "outgoing" else "incoming" end), other: (if .source_id == "<entity-id>" then .target_id else .source_id end)}'

# Get entity with all edges in one call
ff-eg-read node with-edges <entity-id>
```

### Finding Parent Entities

When you need to find what "owns" an entity:

```bash
# Get incoming edges (things pointing TO this entity)
ff-eg-read node edges-to <entity-id> | jq '.[] | {type: .edge_type, from: .source_id}'

# Find parent via specific edge type
ff-eg-read search reverse-connected BELONGS_TO <entity-id>
ff-eg-read search reverse-connected HAS_CHILD <entity-id>
```

### Finding Child Entities

When you need to find what an entity "owns":

```bash
# Get outgoing edges
ff-eg-read node edges-from <entity-id> | jq '.[] | {type: .edge_type, to: .target_id}'

# Get connected nodes by edge type
ff-eg-read node connected <entity-id> HAS_CHILD
ff-eg-read node connected <entity-id> CONTAINS

# Get children with their details
ff-eg-read node connected <entity-id> HAS_CHILD | jq '.[] | {id, name, status}'
```

### Deep Traversal

For workflows with multiple levels:

```bash
# Traverse up to 3 levels deep
ff-eg-read node connected-udf <entity-id> HAS_CHILD --max-depth 3

# Find all descendants
ff-eg-read node connected-udf <entity-id> CONTAINS --max-depth 5
```

## Workflow Diagnostics

### Trace a Workflow's Structure

```bash
# 1. Get the workflow
ff-eg-read node get <workflow-id> | jq '{name, status, type: .entity_type}'

# 2. Find all steps
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {name, status, order: .step_order}'

# 3. Find the failed step(s)
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | select(.status == "Failed")'
```

### Find Related Documents/Data

```bash
# Documents processed by a workflow
ff-eg-read node connected <workflow-id> PROCESSES

# Inputs to an entity
ff-eg-read node connected <entity-id> HAS_INPUT

# Outputs from an entity
ff-eg-read node connected <entity-id> HAS_OUTPUT
```

## Extracting Breadcrumb Information

For correlating with logs and telemetry:

```bash
# Get entity_id and entity_type for breadcrumb searching
ff-eg-read node get <entity-id> | jq '{entity_type: .entity_type, entity_id: .id}'

# For workflows, get breadcrumb info for all children
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {entity_type: .entity_type, entity_id: .id, name}'
```

Then use in telemetry:
```bash
ff-telemetry-read trace by-breadcrumb <entity_type> <entity_id>
```

And in logs:
```bash
grep "<entity-id>" logs/*.log
```

## Finding Similar Entities

When investigating patterns across entities:

```bash
# Find similar entities (by vector embedding)
ff-eg-read vector similar <entity-id> --limit 10

# Find similar with threshold
ff-eg-read vector similar <entity-id> --limit 10 --threshold 0.8

# Filter by metadata
ff-eg-read vector similar <entity-id> --metadata-filters '{"entity_type": "DocumentEntity"}'
```

## Status Patterns

### Common Status Values

Entities typically have statuses like:
- `Pending` - Waiting to be processed
- `InProgress` / `Processing` - Currently being worked on
- `Completed` / `Success` - Finished successfully
- `Failed` / `Error` - Failed with error
- `Cancelled` - Cancelled by user/system

### Status Timeline

```bash
# Get entities by status
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "InProgress"}}'

# Find stuck entities (in progress for too long)
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "InProgress"}}' \
  --order-by '{"created_at": "asc"}' \
  --size 10
```

## Common Diagnostic Queries

### Query 1: Failed Workflow Analysis

```bash
# Find the workflow
ff-eg-read node get <workflow-id> | jq .

# Get all steps with status
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {name, status}'

# Find the failing step
FAILED_STEP=$(ff-eg-read node connected <workflow-id> HAS_STEP | jq -r '.[] | select(.status == "Failed") | .id')

# Get failing step details
ff-eg-read node get $FAILED_STEP | jq .

# Check what the step was trying to do
ff-eg-read node connected $FAILED_STEP HAS_INPUT
ff-eg-read node connected $FAILED_STEP HAS_OUTPUT
```

### Query 2: Entity Dependencies

```bash
# What does this entity depend on?
ff-eg-read node connected <entity-id> DEPENDS_ON

# What depends on this entity?
ff-eg-read search reverse-connected DEPENDS_ON <entity-id>
```

### Query 3: Recent Activity

```bash
# Recently created entities
ff-eg-read search nodes-scoped --order-by '{"created_at": "desc"}' --size 20

# Recently updated entities
ff-eg-read search nodes-scoped --order-by '{"updated_at": "desc"}' --size 20

# Recently failed entities
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Failed"}}' \
  --order-by '{"updated_at": "desc"}' \
  --size 10
```

## Troubleshooting ff-eg-read

### Check Configuration

```bash
echo "Gateway: $FF_EG_GATEWAY"
echo "Namespace: $FF_EG_NAMESPACE"
echo "Agent Bundle: $FF_EG_AGENT_BUNDLE_ID"
echo "Port: ${FF_EG_PORT:-30080}"
```

### Test Connectivity

```bash
# Simple test - list some nodes
ff-eg-read search nodes-scoped --size 1
```

### Common Issues

| Error | Likely Cause | Fix |
|-------|--------------|-----|
| Connection refused | Gateway not reachable | Check FF_EG_GATEWAY and port |
| Unauthorized | Invalid API key | Check FF_EG_API_KEY |
| Not found | Wrong namespace/bundle | Verify FF_EG_NAMESPACE, FF_EG_AGENT_BUNDLE_ID |
| Empty results | Scope mismatch | Use `search nodes` (global) vs `search nodes-scoped` |

## Runnable Entity Analysis

### Check Entity Output

The output is the return value from the entity's `run_impl`:

```bash
# Get the full I/O
ff-eg-read node io <entity-id> | jq .

# Get just the output
ff-eg-read node io <entity-id> | jq '.output'
```

Cross-reference with the entity's TypeScript source to understand the output structure.

### Analyze Progress Envelopes

Progress envelopes show the execution timeline:

```bash
# Get all progress
ff-eg-read node progress <entity-id> | jq .

# See the timeline
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status, message, entity_name}'
```

### Progress Envelope Types

| Type | What It Shows |
|------|---------------|
| `STATUS` | State transitions: STARTED → RUNNING → COMPLETED/FAILED |
| `MESSAGE` | Informational log-like messages |
| `ERROR` | Exception details (FFError) |
| `BOT_PROGRESS` | Nested bot execution phases |
| `VALUE` | Yielded values; `sub_type: "return"` = final output |
| `WAITING` | Entity paused for external input |

### Expected Lifecycle

A healthy runnable execution:
```
STATUS (STARTED, "Entity execution started")
  → BOT_PROGRESS (STARTED, "Starting thread")
  → BOT_PROGRESS (STARTED, "Starting try")
  → BOT_PROGRESS (COMPLETED, "Try completed")
  → BOT_PROGRESS (COMPLETED, "Thread completed")
  → STATUS (COMPLETED, "Entity execution completed successfully")
  → VALUE (sub_type: "return", value: {...})
  → STATUS (COMPLETED, "Entity execution finished")
```

**Failure detection:**
- **STARTED but no COMPLETED** = crash or hang
- **STATUS with FAILED** = controlled failure
- **ERROR envelope** = exception thrown

### Find Failures

```bash
# Find FAILED status
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "STATUS" and .status == "FAILED")'

# Find ERROR envelopes
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR") | .error'

# Find last status before failure
ff-eg-read node progress <entity-id> | jq '[.[] | select(.type == "STATUS")] | last'
```

### Analyze Bot Execution

Bot progress is nested in `BOT_PROGRESS` envelopes:

```bash
# See bot phases
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "BOT_PROGRESS") | {bot: .progress.bot_name, phase: .progress.sub_type, status: .progress.status}'

# Find failed bot tries
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "BOT_PROGRESS" and .progress.status == "FAILED")'
```

Bot execution phases:
- `THREAD` - Bot conversation thread
- `TRY` - Individual attempt (may retry on failure)

### Get Return Value

```bash
# Find the final return value
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "VALUE" and .sub_type == "return") | .value'
```

### Trace Call Stack

Progress propagates up through "Calls" edges:

```bash
# Find the caller entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls") | .source_id'

# Get caller's progress (includes this entity's progress)
ff-eg-read node progress <caller-id>

# Find all entities in the call chain
ff-eg-read node connected-udf <root-entity-id> Calls --max-depth 10
```

### Compare Expected vs Actual

When debugging, compare:
1. **Source code** - What should `run_impl` do?
2. **Progress** - What actually happened?
3. **Output** - What was returned?

```bash
# 1. Get the entity type
ff-eg-read node get <entity-id> | jq '.entity_type'

# 2. Find the source file
# Search for: class <EntityType> extends RunnableEntity

# 3. Compare run_impl logic with progress timeline
ff-eg-read node progress <entity-id> | jq '.[] | {type, message}'

# 4. Check the output matches expected return type
ff-eg-read node io <entity-id> | jq '.output'
```
