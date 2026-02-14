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

## Dictionary Query API

The dictionary query API provides read-only access to data dictionary annotations with tag-based filtering. These are **non-admin endpoints** — they require only API key authentication (same as data-plane), not admin auth.

### Authentication

Dictionary query requests require:
- **API Key**: Via `X-Api-Key` header

No caller identity (`X-On-Behalf-Of`) is required for dictionary queries.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/dictionary/tables` | List table annotations with optional filtering |
| GET | `/v1/dictionary/columns` | List column annotations with optional filtering |

### GET /v1/dictionary/tables

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `connection` | string | Filter by connection name |
| `tags` | string | Comma-separated tag inclusion filter (OR semantics) |
| `excludeTags` | string | Comma-separated tag exclusion filter (any match excludes) |

Response:
```json
{
  "tables": [
    {
      "connection": "firekicks",
      "schema": "public",
      "table": "orders",
      "description": "Customer orders with shipping and payment details",
      "businessName": "Customer Orders",
      "grain": "One row per order",
      "tags": ["transactional", "sales", "financial"],
      "statistics": { "rowCount": 131072, "avgRowSizeBytes": 256 },
      "relationships": [
        { "targetTable": "customers", "targetColumn": "customer_id", "joinColumn": "customer_id", "type": "many-to-one" }
      ],
      "qualityNotes": { "completeness": "All required fields populated" },
      "usageNotes": "Primary table for order analysis. Use order_date for business date filtering.",
      "updatedAt": "2026-02-14T12:00:00Z",
      "updatedBy": "data-steward"
    }
  ],
  "total": 1,
  "filters": {
    "connection": "firekicks",
    "tags": [],
    "excludeTags": []
  }
}
```

### GET /v1/dictionary/columns

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `connection` | string | Filter by connection name |
| `table` | string | Filter by table name |
| `tags` | string | Comma-separated tag inclusion filter (OR semantics) |
| `excludeTags` | string | Comma-separated tag exclusion filter (any match excludes) |
| `semanticType` | string | Filter by semantic type: `identifier`, `measure`, `dimension`, `temporal`, `descriptive` |
| `dataClassification` | string | Filter by classification: `public`, `internal`, `financial`, `pii` |

Response:
```json
{
  "columns": [
    {
      "connection": "firekicks",
      "schema": "public",
      "table": "orders",
      "column": "total_amount",
      "description": "Total order amount including tax and shipping",
      "businessName": "Order Total",
      "semanticType": "measure",
      "dataClassification": "financial",
      "tags": ["financial", "sales"],
      "sampleValues": ["29.99", "149.50", "299.00"],
      "statistics": { "min": 9.99, "max": 999.99, "avg": 89.45, "distinctCount": 4500, "nullCount": 0 },
      "valuePattern": "Decimal USD amount, typically 9.99 to 999.99",
      "constraints": { "type": "range", "min": 0, "max": 999999.99 },
      "relationships": [],
      "qualityNotes": null,
      "usageNotes": "Use for revenue calculations. Includes tax and shipping.",
      "updatedAt": "2026-02-14T12:00:00Z",
      "updatedBy": "data-steward"
    }
  ],
  "total": 1,
  "filters": {
    "connection": "firekicks",
    "table": "",
    "tags": [],
    "excludeTags": [],
    "semanticType": "",
    "dataClassification": ""
  }
}
```

### Filtering Examples

```bash
# All tables for a connection
curl -s -H "X-Api-Key: $API_KEY" "$DA_HOST/v1/dictionary/tables?connection=warehouse"

# Tables tagged "financial" but NOT "raw"
curl -s -H "X-Api-Key: $API_KEY" "$DA_HOST/v1/dictionary/tables?connection=warehouse&tags=financial&excludeTags=raw"

# All PII columns
curl -s -H "X-Api-Key: $API_KEY" "$DA_HOST/v1/dictionary/columns?connection=warehouse&dataClassification=pii"

# Measure columns for a specific table, excluding PII
curl -s -H "X-Api-Key: $API_KEY" "$DA_HOST/v1/dictionary/columns?connection=warehouse&table=orders&semanticType=measure&excludeTags=pii"
```

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

### Annotation Management (Data Dictionary)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/annotations/tables` | List all table annotations |
| POST | `/admin/annotations/tables` | Create/update a table annotation |
| POST | `/admin/annotations/tables/bulk` | Bulk upsert table annotations |
| DELETE | `/admin/annotations/tables/{connection}/{schema}/{table}` | Delete a table annotation |
| GET | `/admin/annotations/columns` | List all column annotations |
| POST | `/admin/annotations/columns` | Create/update a column annotation |
| POST | `/admin/annotations/columns/bulk` | Bulk upsert column annotations |
| DELETE | `/admin/annotations/columns/{connection}/{schema}/{table}/{column}` | Delete a column annotation |
| POST | `/admin/annotations/import` | Import annotations from JSON |
| GET | `/admin/annotations/export` | Export all annotations as JSON |

### Table Annotation Body

```json
{
  "connection": "warehouse",
  "schema": "public",
  "table": "orders",
  "description": "Customer orders with shipping and payment details",
  "businessName": "Customer Orders",
  "grain": "One row per order",
  "tags": ["transactional", "sales", "financial"],
  "statistics": { "rowCount": 131072, "avgRowSizeBytes": 256 },
  "relationships": [
    { "targetTable": "customers", "targetColumn": "customer_id", "joinColumn": "customer_id", "type": "many-to-one" }
  ],
  "qualityNotes": { "completeness": "All required fields populated" },
  "usageNotes": "Primary table for order analysis."
}
```

### Column Annotation Body

```json
{
  "connection": "warehouse",
  "schema": "public",
  "table": "orders",
  "column": "total_amount",
  "description": "Total order amount including tax and shipping",
  "businessName": "Order Total",
  "semanticType": "measure",
  "dataClassification": "financial",
  "tags": ["financial", "sales"],
  "sampleValues": ["29.99", "149.50"],
  "statistics": { "min": 9.99, "max": 999.99, "avg": 89.45, "distinctCount": 4500, "nullCount": 0 },
  "valuePattern": "Decimal USD amount, typically 9.99 to 999.99",
  "constraints": { "type": "range", "min": 0, "max": 999999.99 },
  "relationships": [
    { "targetTable": "products", "targetColumn": "sku", "matchType": "exact", "description": "Product lookup" }
  ],
  "qualityNotes": { "nullRate": 0, "notes": "No quality issues" },
  "usageNotes": "Use for revenue calculations."
}
```

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
| `ANNOTATIONS_FILE` | — | Optional annotations file (JSON seed for data dictionary) |
| `PG_HOST` | — | FireFoundry PostgreSQL host (enables PG persistence for views, annotations, connections) |
| `PG_PORT` | `5432` | FireFoundry PostgreSQL port |
| `PG_PASSWORD` | — | Password for `fireread` user (read-only operations) |
| `PG_INSERT_PASSWORD` | — | Password for `fireinsert` user (write operations) |
| `PG_DATABASE` | `ff_int_dev_clone` | FireFoundry PostgreSQL database name |
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
