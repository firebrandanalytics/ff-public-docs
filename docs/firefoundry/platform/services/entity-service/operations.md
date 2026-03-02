# Entity Service — Operations

Configuration, deployment, performance tuning, and monitoring for the Entity Service.

## Configuration

### Service Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Environment: `development`, `production`, `test` |
| `PORT` | `8080` | HTTP server port |
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `SERVICE_NAME` | `entity-service` | Service identifier |

### Database Connection

| Variable | Default | Purpose |
|----------|---------|---------|
| `PG_DATABASE` | `firefoundry_beta` | Database name |
| `PG_PORT` | `6432` | PostgreSQL port (5432 direct, 6432 pgbouncer) |
| `PG_PASSWORD` | | Read-only user password (fireread role) |
| `PG_INSERT_PASSWORD` | | Write user password (fireinsert role) |
| `PG_POOL_MAX` | `10` | Maximum connections per pool |
| `PG_POOL_MIN` | `2` | Minimum connections per pool |

The service maintains two separate connection pools:
- **fireread**: Read-only queries (SELECT, search, traversal)
- **fireinsert**: Write operations (INSERT, UPDATE)

### Performance Tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `CACHE_ENABLED` | `true` | Enable API response caching |
| `CACHE_TTL_SECONDS` | `2` | Cache time-to-live |
| `BATCH_INSERT_ENABLED` | `true` | Enable automatic write batching |
| `BATCH_INSERT_MAX_ROWS` | `50` | Flush batch after N rows |
| `BATCH_INSERT_MAX_DURATION_MS` | `100` | Flush batch after N milliseconds |

### FireFoundry Context

| Variable | Purpose |
|----------|---------|
| `FF_AGENT_BUNDLE_ID` | Internal agent bundle UUID for system types |

## Deployment

### Kubernetes Resources

Recommended resource limits:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

### Health Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

The `/ready` endpoint verifies database connectivity. If the database is unreachable, the service reports not ready and Kubernetes stops routing traffic to it.

### Scaling

- The service is stateless and supports horizontal scaling
- Scale based on request concurrency and database connection pool limits
- Each replica maintains its own connection pool — ensure PostgreSQL `max_connections` accommodates total replicas × `PG_POOL_MAX`

## Database Requirements

### PostgreSQL

- **Version**: PostgreSQL 14+
- **Extension**: pgvector must be installed for vector search
- **Schema**: `entity` schema with partitioned `node` and `edge` tables
- **Roles**:
  - `fireread` — SELECT-only access for read operations
  - `fireinsert` — INSERT, UPDATE access for write operations

### pgvector

The `entity.vector_similarity` table uses `vector(3072)` column type. Ensure pgvector is installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Monitoring

### Cache Statistics

```bash
curl http://localhost:8080/api/cache/stats
```

Returns hit/miss counts and hit rate. A low hit rate may indicate:
- TTL too short for your workload
- High cardinality of queries (each unique query misses cache)
- Cache disabled

### Batch Insert Metrics

```bash
curl http://localhost:8080/api/batch/metrics
```

Returns batch count, total rows batched, average batch size, and flush counts by trigger (count vs. duration).

### Key Metrics to Monitor

| Metric | Source | Threshold |
|--------|--------|-----------|
| Response latency (p50, p95) | Application logs | p95 < 100ms for reads |
| Database connection pool usage | PostgreSQL `pg_stat_activity` | < 80% of pool max |
| Cache hit rate | `/api/cache/stats` | > 50% for read-heavy workloads |
| Batch flush frequency | `/api/batch/metrics` | Watch for backpressure |
| Error rate (4xx, 5xx) | Application logs | < 1% |

### Graph Statistics

Use the admin CLI to monitor graph size:

```bash
ff-eg-admin stats | jq '.graphs[] | "\(.name): \(.node_count) nodes, \(.edge_count) edges"'
```

## Troubleshooting

### Common Issues

**Service reports not ready:**
- Check database connectivity: `PG_DATABASE`, `PG_PORT`, `PG_PASSWORD`
- Verify the `entity` schema exists and migrations have run
- Check if pgbouncer (port 6432) or direct PostgreSQL (port 5432) is expected

**Vector search returns empty results:**
- Verify embeddings exist for the target node: `ff-eg-read vector similar <id>`
- Check similarity threshold — a threshold of 0.9 may be too strict
- Confirm pgvector extension is installed

**Batch inserts not flushing:**
- Check `BATCH_INSERT_ENABLED=true`
- Verify the `?batch=true` query parameter is being sent
- Monitor `/api/batch/metrics` for flush counts

**Slow search queries:**
- Add conditions to narrow results — unscoped searches are expensive
- Use `X-Agent-Bundle-Id` header for scoped searches
- Check PostgreSQL query plans with `EXPLAIN ANALYZE`
