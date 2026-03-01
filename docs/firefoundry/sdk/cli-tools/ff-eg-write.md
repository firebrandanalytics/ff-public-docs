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

| Variable | Purpose |
|----------|---------|
| `FF_EG_URL` | Entity Graph service URL |
| `FF_AGENT_BUNDLE_ID` | Agent bundle ID |

## Command Reference

### Node Commands

Create, update, and delete entities.

#### node create

Create a new entity.

```bash
ff-eg-write node create [options]
```

| Option | Purpose |
|--------|---------|
| `--name <name>` | Entity name |
| `--entity-type <type>` | Entity type (e.g., `CustomEntity`) |
| `--properties '<json>'` | Entity properties as JSON |

```bash
ff-eg-write node create \
  --name "MyEntity" \
  --entity-type "CustomEntity" \
  --properties '{"key": "value"}'
```

#### node update

Update properties of an existing entity.

```bash
ff-eg-write node update <id> [options]
```

```bash
ff-eg-write node update <entity-id> --properties '{"status": "reviewed"}'
```

#### node delete

Delete an entity.

```bash
ff-eg-write node delete <id>
```

**Warning:** Deleting an entity may orphan related entities. Check relationships with `ff-eg-read node edges <id>` before deleting.

#### node set-status

Change the status of an entity.

```bash
ff-eg-write node set-status <id> <status>
```

```bash
# Mark as completed
ff-eg-write node set-status <entity-id> Completed

# Mark as failed
ff-eg-write node set-status <entity-id> Failed
```

### Edge Commands

Create and delete relationships between entities.

#### edge create

Create a relationship (edge) between two entities.

```bash
ff-eg-write edge create <from-id> <to-id> <edge-type>
```

```bash
ff-eg-write edge create <parent-id> <child-id> HAS_CHILD
```

#### edge delete

Delete a relationship between two entities.

```bash
ff-eg-write edge delete <from-id> <to-id> <edge-type>
```

### Recovery Commands

Reset stuck entities and clear stale progress data.

#### recovery reset-runnable

Reset a runnable entity that is stuck in `InProgress` status. This clears the entity's execution state so it can be re-run.

```bash
ff-eg-write recovery reset-runnable <id>
```

```bash
# Reset a stuck entity
ff-eg-write recovery reset-runnable <entity-id>
```

**When to use:** An entity shows `InProgress` status but is no longer executing (e.g., the pod crashed during execution). Use `ff-eg-read node progress <id>` to confirm the entity is truly stuck before resetting.

#### recovery clear-progress

Clear all progress envelopes for an entity. This removes the execution history without changing the entity's status.

```bash
ff-eg-write recovery clear-progress <id>
```

## Safety Guidelines

- **Read before writing.** Use `ff-eg-read node get <id>` to verify entity state before modifying.
- **Check relationships first.** Use `ff-eg-read node edges <id>` before deleting entities to avoid orphaning related nodes.
- **Test in dev namespace.** Don't experiment in production environments.
- **No undo.** There is no built-in undo for write operations. Back up data before bulk operations.

## Common Workflows

### Create an Entity with Relationships

```bash
# 1. Create parent entity
ff-eg-write node create \
  --name "ProjectWorkflow" \
  --entity-type "WorkflowEntity" \
  --properties '{"description": "Main project workflow"}'
# Note the returned ID

# 2. Create child entity
ff-eg-write node create \
  --name "DataProcessingStep" \
  --entity-type "StepEntity" \
  --properties '{"order": 1}'
# Note the returned ID

# 3. Connect them
ff-eg-write edge create <parent-id> <child-id> HAS_STEP
```

### Recover a Stuck Workflow

```bash
# 1. Identify the stuck entity
ff-eg-read search nodes-scoped --condition '{"status": {"$eq": "InProgress"}}' | jq '.result[] | {id, name}'

# 2. Check its progress to confirm it's stuck
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status}'

# 3. Reset it
ff-eg-write recovery reset-runnable <entity-id>

# 4. Verify the reset
ff-eg-read node get <entity-id> | jq '{status}'
```

## See Also

- [ff-eg-read](ff-eg-read.md) — Read operations (always read before writing)
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
- [Entity Service](../../platform/services/entity-service.md) — Platform service documentation
