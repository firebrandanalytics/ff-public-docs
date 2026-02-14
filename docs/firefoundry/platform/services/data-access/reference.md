# Data Access Service — Reference

## Data Plane API

### Authentication

All data plane requests require:
- **API Key**: Via `X-API-Key` or `Authorization: Bearer` header
- **Caller Identity**: Via `X-On-Behalf-Of: {type}:{name}` header (e.g., `app:my-function`, `user:alice@example.com`)

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/connections/{conn}/query` | Execute raw SQL SELECT |
| POST | `/v1/connections/{conn}/execute` | Execute INSERT/UPDATE/DELETE |
| POST | `/v1/connections/{conn}/query-ast` | Execute structured AST query |
| POST | `/v1/connections/{conn}/translate-ast` | Convert AST to SQL (preview, no execution) |
| GET | `/v1/connections/{conn}/schema` | Get table/column metadata |
| GET | `/v1/connections` | List available connections (ACL-filtered) |

### QueryRequest

```protobuf
message QueryRequest {
  string connection = 1;
  string sql = 2;
  repeated google.protobuf.Value params = 3;
  QueryOptions options = 4;
}
```

### ASTQueryRequest

```protobuf
message ASTQueryRequest {
  string connection = 1;              // Target connection for the main query
  SelectStatement select = 2;         // AST query
  repeated google.protobuf.Value params = 3;  // Bind parameters ($1, $2, ...)
  QueryOptions options = 4;           // Timeout, max rows
  string save_as = 5;                 // Save results to scratch pad with this name
  repeated StagedQuery staged_queries = 6;  // Federated pre-queries
}
```

### QueryResponse

```protobuf
message QueryResponse {
  repeated ColumnInfo columns = 1;
  repeated Row rows = 2;
  int32 row_count = 3;
  int32 duration_ms = 4;
  string query_id = 5;
  bool truncated = 6;
  StagedQueryStats staged_stats = 7;  // Staged query execution stats (if any)
  string saved_as = 8;               // Echoes back scratch pad name if saved
  string save_warning = 9;           // Error message if save_as failed
}
```

### TranslateASTResponse

```protobuf
message TranslateASTResponse {
  string sql = 1;                     // Generated SQL for main query
  string dialect = 2;                 // Target dialect (postgresql/mysql/sqlite)
  repeated string warnings = 3;
  repeated StagedQueryTranslation staged_translations = 4;
}
```

### QueryOptions

```protobuf
message QueryOptions {
  int32 timeout_ms = 1;    // Per-query timeout (capped by connection limit)
  int32 max_rows = 2;      // Max rows returned (capped by connection limit)
}
```

## Staged Query Messages

### StagedQuery

```protobuf
message StagedQuery {
  string alias = 1;                   // Name to reference in main query (CTE name)
  string connection = 2;              // Target connection
  SelectStatement query = 3;          // Full AST query
  repeated google.protobuf.Value params = 4;  // Per-query bind parameters
}
```

### StagedQueryStats

```protobuf
message StagedQueryStats {
  int32 staged_query_count = 1;
  int32 total_staged_rows = 2;
  int64 total_staged_bytes = 3;
  int32 total_staged_duration_ms = 4;
  repeated StagedQueryDetail details = 5;
}
```

### StagedQueryDetail

```protobuf
message StagedQueryDetail {
  string alias = 1;
  string connection = 2;
  int32 tier = 3;                     // Execution tier (0-based)
  int32 row_count = 4;
  int64 byte_size = 5;
  int32 duration_ms = 6;
  bool reloaded_from_cold = 7;        // For scratch pad cold reloads
  string error = 8;                   // Error if this staged query failed
  string sql_hash = 9;               // Hash for audit correlation
}
```

### StagedQueryTranslation

```protobuf
message StagedQueryTranslation {
  string alias = 1;
  string connection = 2;
  string sql = 3;                     // Generated SQL for this staged query
  string dialect = 4;                 // Target dialect
}
```

### SchemaResponse — Table Types

| Type | Description |
|------|-------------|
| `table` | Real database table |
| `view` | Real database view |
| `stored_view` | Stored view definition managed by the service |

Stored views are automatically included in schema responses when they match the requested connection and are visible to the caller's identity scope.

## Admin API

### Connection Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/connections` | List all connections (sanitized) |
| POST | `/admin/connections` | Create connection |
| GET | `/admin/connections/{name}` | Get connection detail |
| PUT | `/admin/connections/{name}` | Update connection |
| DELETE | `/admin/connections/{name}` | Delete connection |
| POST | `/admin/connections/{name}/test` | Test connection health |
| POST | `/admin/connections/{name}/rotate` | Rotate credentials (zero-downtime) |

### View Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/views` | List views (filter by namespace, connection) |
| POST | `/admin/views` | Create view definition |
| GET | `/admin/views/{namespace}/{name}` | Get view with AST |
| PUT | `/admin/views/{namespace}/{name}` | Update view |
| DELETE | `/admin/views/{namespace}/{name}` | Delete view |

### Credential Methods

| Method | Description |
|--------|-------------|
| `env` | Read username/password from environment variables |
| `service_principal` | OAuth2 client credentials (Azure AD) |
| `managed_identity` | Azure/GCP managed identity |
| `none` | No credentials (SQLite) |

### Health Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `/health` | No | Service liveness |
| `/health/live` | No | Liveness probe |
| `/health/ready` | No | Readiness (checks database connections) |
| `/debug/pools` | Yes | Connection pool statistics |

## Configuration

### Connection Configuration (YAML)

```yaml
connections:
  - name: warehouse
    type: postgresql          # postgresql | mysql | sqlite
    description: Production data warehouse
    config:
      host: warehouse.internal
      port: 5432
      database: analytics
      sslMode: require
    credentials:
      method: env
      envMappings:
        username: PG_WAREHOUSE_USER
        password: PG_WAREHOUSE_PASSWORD
    pool:
      maxOpen: 25
      maxIdle: 5
      maxLifetime: 30m
    limits:
      maxRows: 100000
      queryTimeout: 30s
```

### ACL Configuration (YAML)

```yaml
acl:
  - identity: "app:sales-agent"
    connections: ["warehouse"]
    tables_deny: ["internal_metrics"]
    columns_deny:
      customers: ["ssn"]
  - identity: "user:admin"
    connections: ["*"]

function_blacklist:
  global:
    - pg_sleep
    - pg_terminate_backend
    - pg_read_file
    - pg_write_file
    - pg_ls_dir
    - dblink
    - lo_import
    - lo_export
    - load_file
    - into_outfile
    - into_dumpfile
    - sleep
    - benchmark
    - sys_exec
    - sys_eval
    - load_extension
    - fts3_tokenizer
    - readfile
  per_identity:
    "app:restricted":
      - pg_catalog
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GRPC_PORT` | `50051` | gRPC server port |
| `HTTP_PORT` | `8080` | HTTP server port (admin + REST gateway) |
| `CONNECTIONS_FILE` | `configs/connections.yaml` | Connection configuration file |
| `ACL_FILE` | `configs/acl.yaml` | ACL rules file |
| `API_KEY` | `dev-api-key` | API key for authentication |
| `VIEWS_FILE` | — | Optional stored definitions file |
| `SCRATCH_DIR` | `/tmp/data-access-scratch` | Directory for scratch pad SQLite databases |
| `LOG_LEVEL` | `info` | Logging level (`info` or `debug`) |
| `ENABLE_REFLECTION` | `false` | Enable gRPC reflection |

## Scratch Pad Reference

### Connection Naming

Scratch pad connections follow the pattern `scratch:<identity>`:
- Identity `user:alice` → connection `scratch:user:alice`
- Identity `app:my-agent` → connection `scratch:app:my-agent`

### Behavior

- **Auto-creation**: Scratch databases are created on first `save_as`
- **Idempotent saves**: `save_as` drops and recreates the table if it exists
- **WAL mode**: SQLite databases use WAL mode for concurrent read access
- **Storage**: Files stored in `SCRATCH_DIR` as `{identity_hash}.db`
- **ACL**: Scratch connections are implicitly authorized for the owning identity

### Limits

- No current TTL or automatic cleanup (planned for Phase 3B)
- No cross-identity sharing (planned for Phase 3B)
- No storage quotas (planned for Phase 3B)

## Staged Query Execution Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Max staged queries per request | 10 | Maximum number of `staged_queries` |
| Max rows per staged query | 1,000 | Maximum rows returned by a single staged query |
| Max total staged bytes | 10 MB | Maximum total data size across all staged results |
| Cycle detection | Enabled | Circular dependencies are rejected |

## Error Codes

| gRPC Code | HTTP Status | Condition |
|-----------|------------|-----------|
| `UNAUTHENTICATED` | 401 | Missing or invalid API key |
| `PERMISSION_DENIED` | 403 | Identity not authorized for connection, table, or column |
| `INVALID_ARGUMENT` | 400 | Malformed AST, blocked function, validation failure |
| `INVALID_ARGUMENT` | 400 | Staged query cycle detected, duplicate alias, empty alias/connection |
| `NOT_FOUND` | 404 | Connection not configured |
| `RESOURCE_EXHAUSTED` | 429 | Staged query limits exceeded (rows, bytes, count) |
| `DEADLINE_EXCEEDED` | 504 | Query timeout |
| `INTERNAL` | 500 | Database error, serialization failure |

## Deployment

### Kubernetes

- **Single binary**: No runtime dependencies beyond database connectivity
- **Stateless**: All state is in target databases, config files, and scratch pad directory
- **Liveness/readiness probes**: `/health/live` and `/health/ready`
- **Credential injection**: Environment variables from Kubernetes secrets
- **Credential rotation**: Call `/admin/connections/{name}/rotate` after secret updates
- **Scratch pad**: Mount a persistent volume at `SCRATCH_DIR` for durable scratch data

### Dependencies

- **Go 1.22+** (build time only)
- **Target databases**: At least one of PostgreSQL 13+, MySQL 8+, or SQLite 3.35+

## Audit Logging

All data plane operations are logged with:
- `queryId` — Unique per request
- `identity` — Authenticated caller
- `connection` — Target connection
- `sqlHash` — SHA256 prefix of SQL (for grouping without storing raw SQL)
- `status` — success, truncated, error, denied
- `durationMs` — Execution time
- `rowCount` — Rows returned or affected

Staged query operations log each staged query individually with the same fields plus tier number.

## Troubleshooting

| Issue | Cause | Resolution |
|-------|-------|------------|
| `PermissionDenied` on query | Identity not in ACL for connection | Add identity to `acl.yaml` |
| `PermissionDenied` on table | Table in `tables_deny` list | Remove from deny list or use different identity |
| `InvalidArgument: function blocked` | Function in blacklist | Use different function or adjust blacklist |
| `InvalidArgument: AST validation` | Malformed AST structure | Check required fields, identifier format, depth |
| `InvalidArgument: duplicate staged alias` | Two staged queries with same alias | Use unique aliases |
| `InvalidArgument: cycle detected` | Circular staged query dependencies | Remove circular references |
| `ResourceExhausted: staged row limit` | Staged query returned too many rows | Add WHERE clause or increase limit |
| Connection timeout | Database unreachable | Check network, credentials, pool config |
| `NotFound: connection` | Connection not configured | Add to `connections.yaml` or create via admin API |
| `save_warning` in response | Scratch pad save failed | Check `SCRATCH_DIR` permissions and disk space |
