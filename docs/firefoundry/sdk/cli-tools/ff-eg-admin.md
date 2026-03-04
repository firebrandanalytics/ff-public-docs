# ff-eg-admin — Entity Graph Admin Operations

Admin CLI tool for destructive operations on the FireFoundry Entity Graph. Provides hard-delete capabilities and graph diagnostics that require admin API key authentication.

## Installation

```bash
npm install -g @firebrandanalytics/ff-eg-admin
```

Verify:

```bash
ff-eg-admin --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory. **All operations require an admin API key.**

### Required Variables

| Variable | Purpose |
|----------|---------|
| `FF_GATEWAY` | Gateway URL |
| `FF_EG_ADMIN_API_KEY` | Admin API key for authentication |

### Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_MODE` | Connection mode: `internal` (direct) or `external` (Kong gateway) | `external` |
| `FF_API_KEY` | Kong API key (required for external mode) | |
| `FF_NAMESPACE` | Kubernetes namespace (required for external mode) | |
| `FF_INTERNAL_PORT` | Internal service port | `8080` |
| `FF_PORT` | External gateway port | `30080` |

### Command-Line Overrides

| Option | Purpose |
|--------|---------|
| `--gateway` | Override `FF_GATEWAY` |
| `--admin-api-key` | Override `FF_EG_ADMIN_API_KEY` |
| `--mode` | Override `FF_MODE` |
| `--api-key` | Override `FF_API_KEY` |
| `--namespace` | Override `FF_NAMESPACE` |
| `--internal-port` | Override `FF_INTERNAL_PORT` |
| `--port` | Override `FF_PORT` |

## Quick Reference

| Command | Purpose |
|---------|---------|
| `delete-node <id>` | Hard-delete a node and its connected edges |
| `delete-edge <id>` | Hard-delete a single edge |
| `stats` | Get graph partition statistics (node/edge counts) |

## Command Reference

### delete-node

Hard-delete a node by UUID. Connected edges are automatically removed via foreign key cascade.

```bash
ff-eg-admin delete-node <node-uuid>
```

```bash
ff-eg-admin delete-node a1b2c3d4-5678-90ab-cdef-1234567890ab
# → {"deleted": true, "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab"}
```

**This operation is permanent and cannot be undone.** Unlike soft-archive operations available through `ff-eg-write`, hard-delete permanently removes the node from the database.

### delete-edge

Hard-delete a single edge by UUID.

```bash
ff-eg-admin delete-edge <edge-uuid>
```

```bash
ff-eg-admin delete-edge b2c3d4e5-6789-01ab-cdef-2345678901bc
# → {"deleted": true, "id": "b2c3d4e5-6789-01ab-cdef-2345678901bc"}
```

### stats

Get node and edge counts per graph partition.

```bash
ff-eg-admin stats
```

```bash
ff-eg-admin stats | jq .
# → {"graphs": [{"name": "default", "node_count": 150, "edge_count": 400}, ...]}
```

## Common Workflows

### Cleanup Test Data

```bash
# 1. Check partition sizes
ff-eg-admin stats | jq '.graphs[] | select(.name == "test-graph")'

# 2. Identify nodes to delete (using ff-eg-read)
ff-eg-read search nodes-scoped --condition '{"entity_type": {"$eq": "TestEntity"}}'

# 3. Delete specific test nodes
ff-eg-admin delete-node <test-node-id-1>
ff-eg-admin delete-node <test-node-id-2>

# 4. Verify cleanup
ff-eg-admin stats
```

### Verify Cascade Behavior

When deleting a node, all connected edges are automatically removed:

```bash
# 1. Check the node exists
ff-eg-read exists <node-id>
# → {"exists": true}

# 2. Check how many edges the node has
ff-eg-read node edges <node-id> | jq 'length'

# 3. Delete the node (edges cascade automatically)
ff-eg-admin delete-node <node-id>

# 4. Verify the node is gone
ff-eg-read exists <node-id>
# → {"exists": false}
```

### Remove Orphaned Edges

```bash
# 1. Find edges that might be orphaned
ff-eg-read node edges <node-id> | jq '.[] | {id: .id, type: .edge_type, target: .target_id}'

# 2. Delete a specific edge
ff-eg-admin delete-edge <edge-id>
```

### Monitor Graph Health

```bash
# Check total graph sizes across partitions
ff-eg-admin stats | jq '.graphs[] | "\(.name): \(.node_count) nodes, \(.edge_count) edges"'
```

## Safety Guidelines

- **Hard deletes are permanent** — there is no undo, recycle bin, or soft-delete recovery for these operations
- **Always verify before deleting** — use `ff-eg-read exists` and `ff-eg-read node get` to confirm the target before deletion
- **Cascade awareness** — deleting a node removes all its edges; deleting a parent node may leave child nodes orphaned
- **Use ff-eg-write for reversible operations** — prefer `ff-eg-write` archive/unarchive for non-destructive entity management
- **Admin key rotation** — rotate `FF_EG_ADMIN_API_KEY` regularly and restrict access to authorized operators

## See Also

- [ff-eg-read](ff-eg-read.md) — Read-only entity graph queries
- [ff-eg-write](ff-eg-write.md) — Entity graph write operations (create, update, archive)
- [Entity Service](../../platform/services/entity-service/README.md) — Platform service documentation
