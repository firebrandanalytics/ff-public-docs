# Database Setup

Configure PostgreSQL for self-contained FireFoundry Core deployments.

## Overview

The bundled PostgreSQL instance serves as the primary metadata store for all FireFoundry services. Each service uses its own schema within a shared database.

```mermaid
erDiagram
    firefoundry_db {
        schema wm "Working Memory (Context Service)"
        schema entity "Entity Graph (Entity Service)"
        schema broker "LLM Registry (FF Broker)"
        schema history "Chat History"
    }
```

## Database Schemas

| Schema | Service | Purpose |
|--------|---------|---------|
| `wm` | Context Service | Working memory records, blob references |
| `entity` | Entity Service | Entity nodes and edges |
| `broker` | FF Broker | LLM provider registry, routing rules |
| `history` | Context Service | Chat conversation history |

## Automatic Migrations

Each FireFoundry service runs database migrations automatically on startup using Drizzle ORM. No manual migration steps are required for standard deployments.

## Manual Database Access

### Port Forward

```bash
kubectl port-forward svc/firefoundry-core-postgresql 5432:5432 -n ff-core
```

### Connect with psql

```bash
# Connect as superuser
psql -h localhost -U postgres -d firefoundry

# Connect as application user
psql -h localhost -U fireinsert -d firefoundry
```

### Common Queries

```sql
-- List schemas
\dn

-- List tables in working memory schema
\dt wm.*

-- Check working memory records
SELECT id, name, memory_type, provider, status
FROM wm.working_memory
ORDER BY created_at DESC
LIMIT 10;

-- Check blob references
SELECT id, name, blob_key, provider
FROM wm.working_memory
WHERE blob_key IS NOT NULL;
```

## PostgreSQL Extensions

### Standard Extensions

The bundled Bitnami PostgreSQL includes common extensions:

```sql
-- Available by default
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

### pgvector (Optional)

Vector similarity search requires pgvector, which is **not included** in the standard Bitnami PostgreSQL image. If you need embedding support:

1. Use a PostgreSQL image with pgvector pre-installed:
   ```yaml
   postgresql:
     image:
       repository: pgvector/pgvector
       tag: pg16
   ```

2. Create the extension and column:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ALTER TABLE wm.working_memory ADD COLUMN embedding vector(1536);
   CREATE INDEX embedding_idx ON wm.working_memory
     USING hnsw (embedding vector_cosine_ops);
   ```

## Backup and Restore

<!-- TODO: Document backup strategies -->

### Manual Backup

```bash
# Create backup
kubectl exec -n ff-core firefoundry-core-postgresql-0 -- \
  pg_dump -U postgres firefoundry > backup.sql

# Restore from backup
kubectl exec -i -n ff-core firefoundry-core-postgresql-0 -- \
  psql -U postgres firefoundry < backup.sql
```

### Scheduled Backups

<!-- TODO: Document CronJob-based backups -->

## Connection Strings

Services connect to PostgreSQL using connection strings in this format:

```
postgresql://[user]:[password]@[host]:[port]/[database]
```

### Internal (within cluster)

```
postgresql://fireinsert:password@firefoundry-core-postgresql:5432/firefoundry
```

### External (port-forwarded)

```
postgresql://fireinsert:password@localhost:5432/firefoundry
```

## Performance Tuning

<!-- TODO: Document PostgreSQL tuning parameters -->

For production-like testing, consider adjusting:

```yaml
postgresql:
  primary:
    configuration: |
      max_connections = 200
      shared_buffers = 256MB
      effective_cache_size = 768MB
      work_mem = 4MB
      maintenance_work_mem = 64MB
```

## Troubleshooting

### Cannot Connect to Database

1. Check pod is running:
   ```bash
   kubectl get pods -n ff-core -l app.kubernetes.io/name=postgresql
   ```

2. Check logs:
   ```bash
   kubectl logs -n ff-core firefoundry-core-postgresql-0
   ```

3. Verify secret exists:
   ```bash
   kubectl get secret -n ff-core firefoundry-core-postgresql
   ```

### Migration Errors

Check migration logs in service init containers:

```bash
kubectl logs -n ff-core -l app.kubernetes.io/name=context-service -c migrate
```

### Schema Already Exists

If redeploying with existing PVCs, schemas may already exist. Drizzle migrations handle this gracefully.

<!--
TODO: This document needs expansion with:
- Complete backup/restore procedures
- High availability configuration
- Connection pooling (pgBouncer)
- Monitoring and alerting
- Performance benchmarks
- Disaster recovery procedures
-->
