# ff-eg-write — Entity Graph Write Operations

Write operations for the FireFoundry Entity Graph. Create entities, update properties, manage relationships, and perform recovery operations on stuck runnables.

**Use with caution** — these operations modify data and cannot be undone.

## Installation

```bash
npm install -g @firebrandanalytics/ff-eg-write
```

Verify:

```bash
ff-eg-write --version
ff-eg-write node --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_EG_URL` | Entity Graph service URL | `http://localhost:8080` |
| `FF_AGENT_BUNDLE_ID` | Agent bundle ID | |

### Port-Forward Setup

For remote Entity Graph in Kubernetes:

```bash
kubectl port-forward -n ff-dev svc/ff-entity-graph 8080:8080
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `node create` | Create a new entity |
| `node update <id>` | Update entity properties |
| `node delete <id>` | Delete an entity (soft archive) |
| `node set-status <id> <status>` | Change entity status |
| `edge create <from> <to> <type>` | Create a relationship between entities |
| `edge delete <from> <to> <type>` | Delete a relationship |
| `recovery reset-runnable <id>` | Reset a stuck runnable entity |
| `recovery clear-progress <id>` | Clear progress envelopes |

## Command Reference

### Node Commands

Create, update, and delete entities.

#### node create

Create a new entity.

```bash
ff-eg-write node create [options]
```

| Option | Required | Purpose |
|--------|----------|---------|
| `--name <name>` | Yes | Entity name |
| `--entity-type <type>` | Yes | Entity type (e.g., `CustomEntity`, `WorkflowEntity`) |
| `--properties '<json>'` | No | Entity properties as JSON |

```bash
# Create a simple entity
ff-eg-write node create \
  --name "MyEntity" \
  --entity-type "CustomEntity" \
  --properties '{"key": "value"}'

# Create a workflow entity
ff-eg-write node create \
  --name "DataPipeline" \
  --entity-type "WorkflowEntity" \
  --properties '{"description": "ETL pipeline", "priority": "high"}'

# Minimal creation (just name and type)
ff-eg-write node create \
  --name "EmptyNode" \
  --entity-type "GenericEntity"
```

The command returns JSON with the created node's ID:

```bash
# Capture the new node ID
NEW_ID=$(ff-eg-write node create \
  --name "MyEntity" \
  --entity-type "CustomEntity" | jq -r '.id')
echo "Created: $NEW_ID"
```

#### node update

Update properties of an existing entity.

```bash
ff-eg-write node update <id> [options]
```

| Option | Purpose |
|--------|---------|
| `--properties '<json>'` | New property values (merged with existing) |

Properties are merged — existing properties not in the update are preserved:

```bash
# Update a single property
ff-eg-write node update <entity-id> --properties '{"status": "reviewed"}'

# Update multiple properties
ff-eg-write node update <entity-id> --properties '{"reviewed": true, "reviewer": "admin", "score": 0.95}'
```

#### node delete

Delete an entity (soft archive).

```bash
ff-eg-write node delete <id>
```

**Warning:** Deleting an entity may orphan related entities. Always check relationships first:

```bash
# Check relationships before deleting
ff-eg-read node edges <entity-id> | jq '.[] | {type: .edge_type, target: .target_id}'

# Delete the entity
ff-eg-write node delete <entity-id>

# Verify deletion
ff-eg-read exists <entity-id>
```

#### node set-status

Change the status of an entity. Common statuses: `Created`, `InProgress`, `Completed`, `Failed`, `Cancelled`.

```bash
ff-eg-write node set-status <id> <status>
```

```bash
# Mark as completed
ff-eg-write node set-status <entity-id> Completed

# Mark as failed
ff-eg-write node set-status <entity-id> Failed

# Mark as cancelled
ff-eg-write node set-status <entity-id> Cancelled

# Reset to created
ff-eg-write node set-status <entity-id> Created
```

### Edge Commands

Create and delete relationships between entities. Edges are directional — they point from a source node to a target node.

#### edge create

Create a relationship (edge) between two entities.

```bash
ff-eg-write edge create <from-id> <to-id> <edge-type>
```

Common edge types:

| Edge Type | Purpose |
|-----------|---------|
| `HAS_CHILD` | Parent-child hierarchy |
| `HAS_STEP` | Workflow to step relationship |
| `Calls` | Execution call chain |
| `BELONGS_TO` | Membership relationship |
| `REFERENCES` | Cross-reference link |

```bash
# Create a parent-child relationship
ff-eg-write edge create <parent-id> <child-id> HAS_CHILD

# Create a workflow step
ff-eg-write edge create <workflow-id> <step-id> HAS_STEP

# Create a custom relationship
ff-eg-write edge create <source-id> <target-id> REFERENCES
```

#### edge delete

Delete a relationship between two entities.

```bash
ff-eg-write edge delete <from-id> <to-id> <edge-type>
```

```bash
# Remove a relationship
ff-eg-write edge delete <parent-id> <child-id> HAS_CHILD

# Verify removal
ff-eg-read node edges <parent-id> | jq '.[] | select(.edge_type == "HAS_CHILD")'
```

### Recovery Commands

Reset stuck entities and clear stale progress data. These are essential for recovering from pod crashes or network failures during entity execution.

#### recovery reset-runnable

Reset a runnable entity that is stuck in `InProgress` status. This clears the entity's execution state so it can be re-run by the platform.

```bash
ff-eg-write recovery reset-runnable <id>
```

**When to use:** An entity shows `InProgress` status but is no longer executing — typically because the pod crashed, the process was killed, or a network timeout occurred during execution.

```bash
# Verify the entity is actually stuck first
ff-eg-read node get <entity-id> | jq '{status, name}'
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status}'

# Reset it
ff-eg-write recovery reset-runnable <entity-id>

# Verify the reset worked
ff-eg-read node get <entity-id> | jq '{status}'
```

#### recovery clear-progress

Clear all progress envelopes for an entity. This removes the execution history without changing the entity's status.

```bash
ff-eg-write recovery clear-progress <id>
```

**When to use:** An entity has accumulated stale or corrupted progress data that needs to be cleared before a clean re-run.

```bash
# Check current progress
ff-eg-read node progress <entity-id> | jq 'length'

# Clear all progress
ff-eg-write recovery clear-progress <entity-id>

# Verify cleared
ff-eg-read node progress <entity-id> | jq 'length'
# → 0
```

## Safety Guidelines

- **Read before writing.** Use `ff-eg-read node get <id>` to verify entity state before modifying.
- **Check relationships first.** Use `ff-eg-read node edges <id>` before deleting entities to avoid orphaning related nodes.
- **Test in dev namespace.** Don't experiment in production environments.
- **No undo.** There is no built-in undo for write operations. Back up data before bulk operations.
- **Prefer set-status over delete.** Setting status to `Cancelled` or `Failed` preserves the entity for debugging.

## Common Workflows

### Create an Entity with Relationships

```bash
# 1. Create parent entity
PARENT_ID=$(ff-eg-write node create \
  --name "ProjectWorkflow" \
  --entity-type "WorkflowEntity" \
  --properties '{"description": "Main project workflow"}' | jq -r '.id')

# 2. Create child entities
STEP1_ID=$(ff-eg-write node create \
  --name "DataIngestion" \
  --entity-type "StepEntity" \
  --properties '{"order": 1}' | jq -r '.id')

STEP2_ID=$(ff-eg-write node create \
  --name "DataProcessing" \
  --entity-type "StepEntity" \
  --properties '{"order": 2}' | jq -r '.id')

# 3. Connect them
ff-eg-write edge create "$PARENT_ID" "$STEP1_ID" HAS_STEP
ff-eg-write edge create "$PARENT_ID" "$STEP2_ID" HAS_STEP

# 4. Verify the graph structure
ff-eg-read node connected "$PARENT_ID" HAS_STEP | jq '.[] | {name, status}'
```

### Recover a Stuck Workflow

```bash
# 1. Identify stuck entities
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "InProgress"}}' | jq '.result[] | {id, name}'

# 2. Check progress to confirm it's stuck (no recent activity)
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status}'

# 3. Reset the entity
ff-eg-write recovery reset-runnable <entity-id>

# 4. Verify the reset
ff-eg-read node get <entity-id> | jq '{status}'
```

### Bulk Status Update

```bash
# Find all failed entities and reset them to Created
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Failed"}}' | \
  jq -r '.result[].id' | while read -r id; do
    echo "Resetting $id"
    ff-eg-write node set-status "$id" Created
  done
```

### Restructure Entity Relationships

```bash
# 1. Remove old relationship
ff-eg-write edge delete <old-parent-id> <child-id> HAS_CHILD

# 2. Create new relationship
ff-eg-write edge create <new-parent-id> <child-id> HAS_CHILD

# 3. Verify
ff-eg-read node edges-to <child-id> | jq '.[] | {from: .source_id, type: .edge_type}'
```

### Diagnostic: Compare Before and After

```bash
# Capture state before modification
ff-eg-read node get <entity-id> | jq . > /tmp/before.json

# Make changes
ff-eg-write node update <entity-id> --properties '{"processed": true}'

# Capture state after
ff-eg-read node get <entity-id> | jq . > /tmp/after.json

# Compare
diff /tmp/before.json /tmp/after.json
```

## See Also

- [ff-eg-read](ff-eg-read.md) — Read operations (always read before writing)
- [ff-eg-admin](ff-eg-admin.md) — Hard-delete operations (permanent, admin-only)
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
- [ff-wm-write](ff-wm-write.md) — Write data to working memory
- [Entity Service](../../platform/services/entity-service/README.md) — Platform service documentation
