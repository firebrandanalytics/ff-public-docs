# Database Setup

Configure PostgreSQL for self-contained FireFoundry Core deployments.

## Overview

The bundled PostgreSQL instance hosts two databases that serve all FireFoundry services:

| Database | Purpose |
|----------|---------|
| `firefoundry` | Main application database for all services |
| `broker_registry` | Model catalog and LLM provider definitions |

## Database Architecture

```mermaid
erDiagram
    firefoundry_db {
        schema wm "Working Memory"
        schema entity "Entity Graph"
        schema brk_tracking "Broker Request Logs"
        schema brk_registry "Model Catalog (read-only)"
    }
    broker_registry_db {
        schema brk_registry "Model Catalog (source)"
    }
    firefoundry_db ||--o{ broker_registry_db : "references"
```

## Schemas Reference

### firefoundry Database

| Schema | Service | Purpose |
|--------|---------|---------|
| `wm` | Context Service | Working memory records, blob references |
| `entity` | Entity Service | Entity nodes and edges |
| `brk_tracking` | FF Broker | Request/response logging, metrics |
| `brk_registry` | FF Broker | Model catalog (read-only view) |

### broker_registry Database

| Schema | Purpose |
|--------|---------|
| `brk_registry` | LLM provider definitions, model families, hosted models |

The `brk_registry` schema in the `firefoundry` database provides read-only access to the model catalog stored in `broker_registry`. This separation allows the model catalog to be updated independently.

### Model Catalog Tables

The model catalog (`brk_registry` schema) contains:

| Table | Description |
|-------|-------------|
| `hosting_provider` | LLM providers (Azure, Bedrock, Anthropic, etc.) |
| `model_maker` | Model creators (Anthropic, OpenAI, Meta, etc.) |
| `model_family` | Model families (Claude, GPT, Llama, etc.) |
| `model` | Individual models with capabilities |
| `model_snapshot` | Specific model versions/snapshots |
| `hosted_model` | Available model deployments per provider |

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

-- List available LLM providers
SELECT name, code FROM brk_registry.hosting_provider;

-- List available models by provider
SELECT m.name as model, hp.name as provider
FROM brk_registry.model m
JOIN brk_registry.hosted_model hm ON m.id = hm.model_id
JOIN brk_registry.hosting_provider hp ON hm.provider_id = hp.id
ORDER BY hp.name, m.name;

-- Check recent broker requests
SELECT id, request_id, status, created_at
FROM brk_tracking.broker_request
ORDER BY created_at DESC
LIMIT 10;
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

### Database Users

| User | Purpose | Databases |
|------|---------|-----------|
| `fireinsert` | Application services | firefoundry |
| `firebroker` | FF Broker service | firefoundry, broker_registry |
| `fireread` | Read-only access | firefoundry |

### Internal (within cluster)

```bash
# Main database (Context Service, Entity Service)
postgresql://fireinsert:password@firefoundry-core-postgresql:5432/firefoundry

# Broker connection
postgresql://firebroker:password@firefoundry-core-postgresql:5432/firefoundry
```

### External (port-forwarded)

```bash
# Main database
postgresql://fireinsert:password@localhost:5432/firefoundry

# Model catalog (read-only)
postgresql://fireread:password@localhost:5432/firefoundry
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
