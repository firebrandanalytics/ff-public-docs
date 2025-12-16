# FF Console Integration

This guide covers enabling FF Console to observe and manage self-contained FireFoundry Core deployments. Starting with chart version **0.12.0**, the `firefoundry-core` chart includes an optional migration that creates the database schema required by FF Console.

## Overview

FF Console is typically deployed with the Control Plane and connects to external PostgreSQL databases. In self-contained deployments where each FireFoundry Core instance has its own bundled PostgreSQL, the Console needs additional database objects to display broker activity, entity graphs, and request tracking.

The `console-migration` feature automatically creates these objects when you install or upgrade the chart.

## When to Enable

Enable `console-migration` when:

- You're running FF Console and want it to observe this environment
- Your deployment uses the bundled PostgreSQL (`postgresql.enabled=true`)
- You want to view broker requests, LLM calls, and tool executions in the Console UI

**Not needed when:**

- You're not using FF Console
- Console will not connect to this environment's database
- You're using an external PostgreSQL that already has the console schema

## Configuration

### Helm Values

Add the following to your `values.yaml`:

```yaml
# Enable console schema migration
console-migration:
  enabled: true
  adminUsername: "firebrand"
  # adminPassword set in secrets.yaml
```

### Secrets

Add the admin password to your `secrets.yaml`:

```yaml
console-migration:
  adminPassword: "your-firebrand-password" # Same as postgresql.firebrandPassword
```

The password should match your `postgresql.firebrandPassword` since the migration runs as the `firebrand` database user.

### Complete Example

**values.yaml:**

```yaml
postgresql:
  enabled: true
  auth:
    database: "firefoundry"
  firebrandPassword: "" # Set in secrets.yaml

ff-broker:
  enabled: true
  # ... broker configuration

context-service:
  enabled: true
  # ... context service configuration

# Enable console integration
console-migration:
  enabled: true
  adminUsername: "firebrand"
```

**secrets.yaml:**

```yaml
postgresql:
  auth:
    postgresPassword: "secure-admin-password"
  firebrandPassword: "secure-firebrand-password"
  fireinsertPassword: "secure-insert-password"
  firereadPassword: "secure-read-password"

console-migration:
  adminPassword: "secure-firebrand-password" # Must match firebrandPassword
```

### Configuration Reference

| Value                             | Default                   | Description                                  |
| --------------------------------- | ------------------------- | -------------------------------------------- |
| `console-migration.enabled`       | `false`                   | Enable the console schema migration          |
| `console-migration.adminUsername` | `firebrand`               | Database user for running migrations         |
| `console-migration.adminPassword` | `""`                      | **Required** when enabled. Database password |
| `console-migration.secretName`    | `console-db-admin-secret` | Name of the Kubernetes secret                |
| `console-migration.flywayImage`   | `flyway/flyway:10-alpine` | Flyway image for migrations                  |
| `console-migration.backoffLimit`  | `3`                       | Job retry attempts on failure                |

## Installation

### New Installation

```bash
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  --namespace my-environment \
  --version 0.12.0 \
  -f core-values.yaml \
  -f secrets.yaml
```

### Upgrading Existing Installation

```bash
helm upgrade firefoundry-core firebrandanalytics/firefoundry-core \
  --namespace my-environment \
  --version 0.12.0 \
  -f core-values.yaml \
  -f secrets.yaml
```

The migration runs as a Helm post-install/post-upgrade hook and waits for the required dependencies (entity schema and broker tables) before executing.

## Verification

After installation, verify the migration completed:

```bash
# Check the migration job status
kubectl get jobs -n <namespace> | grep console-migration

# Expected output:
# firefoundry-core-console-migration   Complete   1/1   ...
```

Verify the console schema was created:

```bash
kubectl exec -n <namespace> firefoundry-core-postgresql-0 -- \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d firefoundry -c "
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = '\''console'\''
    ORDER BY table_name"'
```

Expected output:

```
          table_name
-------------------------------
 broker_graph_edge
 broker_graph_node
 broker_node_io
 flyway_schema_history_console
 user
 user_action_log
```

## Configuring FF Console

Once the migration completes, configure FF Console to connect to this environment's database.

### Option 1: Update Console ConfigMap

If Console is deployed separately (e.g., in a Control Plane namespace):

```bash
kubectl patch configmap <console-configmap> -n <console-namespace> --type merge -p '{
  "data": {
    "PG_HOST": "firefoundry-core-postgresql.<target-namespace>.svc.cluster.local",
    "PG_DATABASE": "firefoundry"
  }
}'

# Restart console to pick up changes
kubectl rollout restart deployment <console-deployment> -n <console-namespace>
```

### Option 2: Helm Values for Console

If deploying Console via Helm:

```yaml
ff-console:
  configMap:
    data:
      PG_HOST: "firefoundry-core-postgresql.my-environment.svc.cluster.local"
      PG_DATABASE: "firefoundry"
  secret:
    data:
      PG_PASSWORD: "secure-read-password" # fireread user
      PG_INSERT_PASSWORD: "secure-insert-password" # fireinsert user
```

## Database Objects Created

The migration creates the following objects in the `console` schema:

| Object                                   | Type     | Purpose                                        |
| ---------------------------------------- | -------- | ---------------------------------------------- |
| `console.user`                           | Table    | Console user accounts                          |
| `console.user_action_log`                | Table    | Audit trail of user actions                    |
| `console.broker_graph_node`              | View     | Unified view of broker requests as graph nodes |
| `console.broker_graph_edge`              | View     | Relationships between broker requests          |
| `console.broker_node_io`                 | View     | Input/output data for broker requests          |
| `console.get_nodes_by_entity_breadcrumb` | Function | Query broker nodes by entity reference         |

The views join data from `brk_tracking.*` tables (broker request tracking) and use `entity.*` enums (interface and status types).

## Troubleshooting

### Migration Job Fails

**Check the job logs:**

```bash
kubectl logs job/firefoundry-core-console-migration -n <namespace>
```

**Common issues:**

1. **Password authentication failed** - Verify `console-migration.adminPassword` matches `postgresql.firebrandPassword`

2. **Waiting for entity enums** - The entity-service migration hasn't completed. Check:

   ```bash
   kubectl get jobs -n <namespace> | grep entity-migration
   ```

3. **Waiting for broker tables** - The ff-broker bootstrap hasn't completed. Check:
   ```bash
   kubectl get jobs -n <namespace> | grep broker-bootstrap
   ```

### Console Cannot Connect

**Verify network connectivity:**

```bash
# From console namespace, test DNS resolution
kubectl run -n <console-namespace> --rm -it --restart=Never dns-test \
  --image=busybox -- nslookup firefoundry-core-postgresql.<target-namespace>.svc.cluster.local
```

**Verify credentials:**

```bash
# Test connection with console credentials
kubectl exec -n <target-namespace> firefoundry-core-postgresql-0 -- \
  bash -c 'PGPASSWORD="<fireread-password>" psql -h localhost -U fireread -d firefoundry -c "SELECT 1"'
```

### Views Return Errors

If the Console shows errors when loading broker data:

```bash
# Verify the views exist and are accessible
kubectl exec -n <namespace> firefoundry-core-postgresql-0 -- \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d firefoundry -c "
    SELECT count(*) FROM console.broker_graph_node"'
```

If this fails with "relation does not exist", re-run the migration:

```bash
# Delete the existing job
kubectl delete job firefoundry-core-console-migration -n <namespace>

# Upgrade to re-trigger the migration
helm upgrade firefoundry-core firebrandanalytics/firefoundry-core \
  -n <namespace> -f values.yaml -f secrets.yaml
```

## Related Documentation

- [Self-Contained Deployment Overview](./README.md)
- [Context Service + MinIO Integration](./context-service-minio.md)
- [FireFoundry Platform Deployment](../deployment.md)
