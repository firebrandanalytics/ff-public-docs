# ff-eg-admin — Entity Graph Admin Operations

Admin CLI tool for destructive operations on the FireFoundry Entity Graph. Provides hard-delete capabilities and graph diagnostics that require admin API key authentication.

**All operations are permanent and cannot be undone.** For reversible operations, use [ff-eg-write](ff-eg-write.md) instead.

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
| `FF_GATEWAY` | Gateway URL (e.g., `http://localhost`) |
| `FF_EG_ADMIN_API_KEY` | Admin API key for authentication |

### Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_MODE` | Connection mode: `internal` (direct) or `external` (Kong gateway) | `external` |
| `FF_API_KEY` | Kong API key (required for external mode) | |
| `FF_NAMESPACE` | Kubernetes namespace (required for external mode) | |
| `FF_INTERNAL_PORT` | Internal service port (internal mode) | `8080` |
| `FF_PORT` | External gateway port (external mode) | `30080` |

### Command-Line Overrides

All environment variables can be overridden via command-line flags:

| Option | Overrides |
|--------|-----------|
| `--gateway` | `FF_GATEWAY` |
| `--admin-api-key` | `FF_EG_ADMIN_API_KEY` |
| `--mode` | `FF_MODE` |
| `--api-key` | `FF_API_KEY` |
| `--namespace` | `FF_NAMESPACE` |
| `--internal-port` | `FF_INTERNAL_PORT` |
| `--port` | `FF_PORT` |

### Connection Modes

**External mode** (default) — routes through Kong gateway:

```bash
FF_MODE=external
FF_GATEWAY=http://localhost
FF_PORT=30080
FF_API_KEY=your-kong-api-key
FF_NAMESPACE=ff-dev
FF_EG_ADMIN_API_KEY=your-admin-key
```

**Internal mode** — connects directly to the entity graph service:

```bash
FF_MODE=internal
FF_GATEWAY=http://localhost
FF_INTERNAL_PORT=8080
FF_EG_ADMIN_API_KEY=your-admin-key
```

For internal mode, port-forward the entity graph service:

```bash
kubectl port-forward -n ff-dev svc/ff-entity-graph 8080:8080
```

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

**This operation is permanent.** Unlike soft-archive via `ff-eg-write node delete`, hard-delete permanently removes the node from the database. The node cannot be recovered.

Edge cascade behavior:
- All edges where this node is the **source** are deleted
- All edges where this node is the **target** are deleted
- Connected nodes are **not** deleted (only their edges to this node)

### delete-edge

Hard-delete a single edge by UUID.

```bash
ff-eg-admin delete-edge <edge-uuid>
```

```bash
ff-eg-admin delete-edge b2c3d4e5-6789-01ab-cdef-2345678901bc
# → {"deleted": true, "id": "b2c3d4e5-6789-01ab-cdef-2345678901bc"}
```

To find the edge UUID, use `ff-eg-read`:

```bash
# List edges for a node to find the edge ID
ff-eg-read node edges <node-id> | jq '.[] | {id, edge_type, source_id, target_id}'
```

### stats

Get node and edge counts per graph partition.

```bash
ff-eg-admin stats
```

```bash
ff-eg-admin stats | jq .
# → {"graphs": [{"name": "default", "node_count": 150, "edge_count": 400}, ...]}

# Format as a readable table
ff-eg-admin stats | jq -r '.graphs[] | "\(.name): \(.node_count) nodes, \(.edge_count) edges"'
```

## Common Workflows

### Cleanup Test Data

```bash
# 1. Check partition sizes before cleanup
ff-eg-admin stats | jq '.graphs[] | select(.name == "test-graph")'

# 2. Identify test entities to delete
ff-eg-read search nodes-scoped \
  --condition '{"entity_type": {"$eq": "TestEntity"}}' | jq '.result[] | {id, name}'

# 3. Delete each test node
ff-eg-admin delete-node <test-node-id-1>
ff-eg-admin delete-node <test-node-id-2>

# 4. Verify cleanup
ff-eg-admin stats
```

### Bulk Delete by Condition

```bash
# Find and delete all failed test entities
ff-eg-read search nodes-scoped \
  --condition '{"status": {"$eq": "Failed"}, "entity_type": {"$eq": "TestEntity"}}' | \
  jq -r '.result[].id' | while read -r id; do
    echo "Deleting: $id"
    ff-eg-admin delete-node "$id"
  done
```

### Verify Cascade Behavior

```bash
# 1. Check the node exists and count its edges
ff-eg-read exists <node-id>
# → {"exists": true}
ff-eg-read node edges <node-id> | jq 'length'
# → 5

# 2. Delete the node (edges cascade automatically)
ff-eg-admin delete-node <node-id>
# → {"deleted": true, ...}

# 3. Verify the node is gone
ff-eg-read exists <node-id>
# → {"exists": false}
```

### Remove Orphaned Edges

After a failed cleanup or incomplete migration, edges may point to non-existent nodes:

```bash
# 1. Find edges for a node
ff-eg-read node edges <node-id> | jq '.[] | {id, type: .edge_type, target: .target_id}'

# 2. Check if targets still exist
ff-eg-read exists <target-id>

# 3. Delete orphaned edges
ff-eg-admin delete-edge <orphaned-edge-id>
```

### Monitor Graph Growth

```bash
# Track graph sizes over time
echo "$(date +%Y-%m-%d) $(ff-eg-admin stats | jq -r '.graphs[] | "\(.name): \(.node_count)n/\(.edge_count)e"')"

# Find the largest partitions
ff-eg-admin stats | jq '.graphs | sort_by(.node_count) | reverse | .[:5] | .[] | {name, node_count, edge_count}'
```

### Pre-Migration Snapshot

Before running a migration or bulk operation, capture the current state:

```bash
# Save current stats
ff-eg-admin stats | jq . > /tmp/pre-migration-stats.json

# Run your migration...

# Compare after
ff-eg-admin stats | jq . > /tmp/post-migration-stats.json
diff /tmp/pre-migration-stats.json /tmp/post-migration-stats.json
```

## Safety Guidelines

- **Hard deletes are permanent** — there is no undo, recycle bin, or soft-delete recovery for these operations
- **Always verify before deleting** — use `ff-eg-read exists` and `ff-eg-read node get` to confirm the target
- **Cascade awareness** — deleting a node removes all its edges; child nodes may become orphaned
- **Use ff-eg-write for reversible operations** — prefer `ff-eg-write` archive/unarchive for non-destructive entity management
- **Admin key security** — rotate `FF_EG_ADMIN_API_KEY` regularly and restrict access to authorized operators
- **Never run in production without backup** — export critical data before bulk delete operations

## See Also

- [ff-eg-read](ff-eg-read.md) — Read-only entity graph queries
- [ff-eg-write](ff-eg-write.md) — Entity graph write operations (create, update, soft-delete)
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
- [Entity Service](../../platform/services/entity-service/README.md) — Platform service documentation
