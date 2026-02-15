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
| POST | `/v1/connections/{conn}/query-sql` | Parse SQL to AST, then execute |
| POST | `/v1/connections/{conn}/translate-ast` | Convert AST to SQL (preview, no execution) |
| POST | `/v1/connections/{conn}/translate-sql` | Parse SQL to AST, then convert to target SQL |
| POST | `/v1/connections/{conn}/explain-ast` | Get query execution plan from AST |
| POST | `/v1/connections/{conn}/explain-sql` | Get query execution plan from SQL |
| GET | `/v1/connections/{conn}/schema` | Get table/column metadata |
| GET | `/v1/connections` | List available connections (ACL-filtered) |
| GET | `/v1/views` | List stored view definitions |
| GET | `/v1/views/{namespace}/{name}` | Get a specific stored view |

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

### QuerySQLRequest

Parse a PostgreSQL-dialect SQL string into an AST, then execute through the full AST pipeline (validation, ACL, view expansion, serialization to target dialect).

```protobuf
message QuerySQLRequest {
  string connection = 1;
  string sql = 2;                                // PostgreSQL-dialect SELECT
  repeated google.protobuf.Value params = 3;
  QueryOptions options = 4;
  string save_as = 5;
  repeated StagedQuery staged_queries = 6;
}
```

### TranslateSQLResponse

```protobuf
message TranslateSQLResponse {
  string original_sql = 1;              // Input SQL
  string output_sql = 2;               // Backend-specific SQL
  string dialect = 3;
  SelectStatement ast = 4;             // Parsed AST
  repeated string warnings = 5;
  repeated StagedQueryTranslation staged_translations = 6;
}
```

### ExplainRequest

Get the database query execution plan without returning result rows. Supports both AST and SQL input.

```protobuf
message ExplainASTRequest {
  string connection = 1;
  SelectStatement select = 2;
  repeated google.protobuf.Value params = 3;
  bool analyze = 4;                    // EXPLAIN ANALYZE (actually executes the query)
  bool verbose = 5;                    // EXPLAIN VERBOSE
}

message ExplainSQLRequest {
  string connection = 1;
  string sql = 2;
  repeated google.protobuf.Value params = 3;
  bool analyze = 4;
  bool verbose = 5;
}
```

### ExplainResponse

```protobuf
message ExplainResponse {
  repeated string plan_lines = 1;      // Raw EXPLAIN output lines
  string sql = 2;                      // The SQL that was explained
  int32 duration_ms = 3;
  string query_id = 4;
}
```

When `analyze = true`, the query is actually executed (results discarded) and the plan includes real execution statistics (actual time, rows, loops). When `analyze = false`, only the estimated plan is returned.

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

### Variable Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/variables` | List all variable definitions |
| POST | `/admin/variables` | Create or update a variable definition |
| GET | `/admin/variables/{name}` | Get a specific variable |
| DELETE | `/admin/variables/{name}` | Delete a variable |
| POST | `/admin/variables/resolve` | Test variable resolution (debug) |

### Variable Definition Body

```json
{
  "name": "customer_id",
  "description": "Resolves caller email to numeric customer ID",
  "resolution": "lookup",
  "connection": "",
  "lookupTable": "email_to_customer",
  "lookupKey": "email",
  "lookupValue": "customer_id",
  "headerName": ""
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique variable name |
| `resolution` | string | Resolution strategy: `direct`, `lookup`, or `builtin` |
| `connection` | string | Limit to specific connection (empty = all) |
| `lookupTable` | string | Mapping table name (when resolution = `lookup`) |
| `lookupKey` | string | Mapping table key column (when resolution = `lookup`) |
| `lookupValue` | string | Mapping table value column (when resolution = `lookup`) |
| `headerName` | string | Request header to read (when resolution = `direct`; default: `X-On-Behalf-Of`) |

Built-in variables (`caller_identity`, `caller_connection`) are always available and don't need definitions.

### Variable Resolve (Debug)

Test how a variable resolves for a given identity:

```bash
curl -s -X POST "$DA_HOST/admin/variables/resolve" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"variable": "customer_id", "identity": "alice@example.com", "connection": "warehouse"}'
```

Response:
```json
{"variable": "customer_id", "value": "42"}
```

### Mapping Table Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/mappings` | List all mapping tables |
| POST | `/admin/mappings` | Create or update a mapping table (with entries) |
| GET | `/admin/mappings/{name}` | Get a mapping table with entries |
| DELETE | `/admin/mappings/{name}` | Delete a mapping table (cascades entries) |

### Mapping Table Body

```json
{
  "name": "email_to_customer",
  "description": "Maps caller email to numeric customer ID",
  "keyColumn": "email",
  "valueColumn": "customer_id",
  "entries": [
    { "key": "alice@example.com", "value": "42" },
    { "key": "bob@example.com", "value": "99" }
  ]
}
```

Mapping tables are used by `lookup`-type variables to translate caller identities into database values. When a mapping table is saved, all existing entries are replaced with the new set.

### Audit API

The audit API provides read access to query execution history, backed by the telemetry service.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/audit/queries` | List audit events (paginated, filtered) |
| GET | `/admin/audit/queries/{id}` | Get a single audit event |
| GET | `/admin/audit/queries/stats` | Aggregate statistics |

#### GET /admin/audit/queries

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `connection` | string | Filter by connection name |
| `identity` | string | Filter by caller identity |
| `since` | string | Duration filter (e.g., `24h`, `7d`) |
| `errors` | bool | Only show errors |
| `page` | int | Page number (1-based) |
| `page_size` | int | Results per page (default 50, max 200) |

#### GET /admin/audit/queries/stats

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `range` | string | Time range (default `24h`) |

Response includes total queries, error rate, average duration, top connections, and top identities.

### Scratch Pad Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/scratch` | List all scratch pads |
| GET | `/admin/scratch/stats` | Aggregate scratch pad stats |
| GET | `/admin/scratch/{identity}` | Get scratch pad detail for an identity |
| GET | `/admin/scratch/{identity}/tables` | List tables in a scratch pad |
| GET | `/admin/scratch/{identity}/state` | Get hot/cold state |
| POST | `/admin/scratch/{identity}/freeze` | Move to cold storage |
| POST | `/admin/scratch/{identity}/thaw` | Restore from cold storage |
| DELETE | `/admin/scratch/{identity}` | Purge entire scratch pad |
| DELETE | `/admin/scratch/{identity}/tables/{table}` | Drop a single table |

### Ontology Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/ontology/domains` | List ontology domains |
| POST | `/admin/ontology/domains` | Create domain |
| GET | `/admin/ontology/domains/{domain}` | Get domain detail |
| PUT | `/admin/ontology/domains/{domain}` | Update domain |
| DELETE | `/admin/ontology/domains/{domain}` | Delete domain |
| GET | `/admin/ontology/domains/{domain}/entity-types` | List entity types |
| POST | `/admin/ontology/domains/{domain}/entity-types` | Create entity type |
| GET | `/admin/ontology/domains/{domain}/entity-types/{name}` | Get entity type |
| PUT | `/admin/ontology/domains/{domain}/entity-types/{name}` | Update entity type |
| DELETE | `/admin/ontology/domains/{domain}/entity-types/{name}` | Delete entity type |
| GET | `/admin/ontology/domains/{domain}/entity-types/{name}/columns` | List column mappings |
| POST | `/admin/ontology/domains/{domain}/entity-types/{name}/columns` | Create column mapping |
| DELETE | `/admin/ontology/domains/{domain}/columns/{id}` | Delete column mapping |
| GET | `/admin/ontology/domains/{domain}/concepts` | List concepts |
| POST | `/admin/ontology/domains/{domain}/concepts` | Create concept |
| GET | `/admin/ontology/domains/{domain}/concepts/{name}` | Get concept |
| DELETE | `/admin/ontology/domains/{domain}/concepts/{name}` | Delete concept |
| GET | `/admin/ontology/domains/{domain}/entity-types/{name}/relationships` | List relationships |
| POST | `/admin/ontology/domains/{domain}/relationships` | Create relationship |
| DELETE | `/admin/ontology/domains/{domain}/relationships/{id}` | Delete relationship |
| GET | `/admin/ontology/domains/{domain}/entity-types/{name}/exclusions` | List exclusions |
| POST | `/admin/ontology/domains/{domain}/exclusions` | Create exclusion |
| DELETE | `/admin/ontology/domains/{domain}/exclusions/{id}` | Delete exclusion |
| POST | `/admin/ontology/domains/{domain}/equivalences` | Create equivalence |
| GET | `/admin/ontology/domains/{domain}/export` | Export domain data |
| POST | `/admin/ontology/domains/{domain}/import` | Import domain data |
| POST | `/admin/ontology/domains/{domain}/validate` | Validate domain integrity |

### Process Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/processes/domains` | List process domains |
| POST | `/admin/processes/domains` | Create domain |
| GET | `/admin/processes/domains/{domain}` | Get domain |
| PUT | `/admin/processes/domains/{domain}` | Update domain |
| DELETE | `/admin/processes/domains/{domain}` | Delete domain |
| GET | `/admin/processes/domains/{domain}/export` | Export domain data |
| POST | `/admin/processes/domains/{domain}/import` | Import domain data |
| POST | `/admin/processes/domains/{domain}/validate` | Validate domain |
| GET | `/admin/processes/processes` | List processes |
| POST | `/admin/processes/processes` | Create process |
| GET | `/admin/processes/processes/{name}` | Get process with steps |
| PUT | `/admin/processes/processes/{name}` | Update process |
| DELETE | `/admin/processes/processes/{name}` | Delete process |
| POST | `/admin/processes/processes/{name}/steps` | Create step |
| GET | `/admin/processes/processes/{name}/steps/{step}` | Get step |
| PUT | `/admin/processes/processes/{name}/steps/{step}` | Update step |
| DELETE | `/admin/processes/processes/{name}/steps/{step}` | Delete step |
| GET | `/admin/processes/rules` | List business rules |
| POST | `/admin/processes/rules` | Create business rule |
| GET | `/admin/processes/rules/{name}` | Get rule |
| PUT | `/admin/processes/rules/{name}` | Update rule |
| DELETE | `/admin/processes/rules/{name}` | Delete rule |
| GET | `/admin/processes/annotations` | List process annotations |
| POST | `/admin/processes/annotations` | Create annotation |
| GET | `/admin/processes/annotations/{name}` | Get annotation |
| PUT | `/admin/processes/annotations/{name}` | Update annotation |
| DELETE | `/admin/processes/annotations/{name}` | Delete annotation |
| GET | `/admin/processes/calendars` | List calendar contexts |
| POST | `/admin/processes/calendars` | Create calendar |
| GET | `/admin/processes/calendars/{name}` | Get calendar |
| PUT | `/admin/processes/calendars/{name}` | Update calendar |
| DELETE | `/admin/processes/calendars/{name}` | Delete calendar |

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

- No current TTL or automatic cleanup
- No cross-identity sharing
- No storage quotas

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

## Ontology Service (gRPC)

The Ontology Service provides AI agents with structured domain knowledge — entity types, relationships, column mappings, and concept hierarchies. It enables agents to resolve natural language terms to database structures.

### Service: `ontology.v1.OntologyService`

| Method | Description |
|--------|-------------|
| `GetOntologyContext` | Get a full domain overview (entity types, concepts, connections) |
| `ResolveEntity` | Resolve a natural language term to entity type candidates |
| `BatchResolveEntity` | Batch resolve up to 10 terms |
| `GetEntityRelationships` | Get relationships and exclusions for an entity type |
| `GetEntityColumns` | Get column mappings for an entity type (filterable by role and connection) |

### GetOntologyContext

```protobuf
message GetOntologyContextRequest {
  string domain = 1;                   // Required
  string connection = 2;              // Optional: limit to specific connection
}

message GetOntologyContextResponse {
  string domain = 1;
  string description = 2;
  repeated EntityTypeSummary entity_types = 3;
  repeated ConceptSummary concepts = 4;
  repeated string connections = 5;
  int32 version = 6;                   // For cache invalidation
}
```

### ResolveEntity

```protobuf
message ResolveEntityRequest {
  string term = 1;                     // e.g., "revenue" or "Premium customers"
  string context_phrase = 2;          // Optional surrounding context
  string domain = 3;                  // Optional domain filter
  string connection = 4;             // Optional connection filter
}

message ResolveEntityResponse {
  repeated EntityCandidate candidates = 1;
  bool ambiguous = 2;
  string disambiguation_prompt = 3;   // Suggested prompt for the AI
  OntologyErrorCode error_code = 4;
}
```

Error codes: `UNSPECIFIED`, `AMBIGUOUS`, `CONFLICT_EXCLUSION`, `NOT_FOUND`, `STALE_VERSION`

### GetEntityColumns

```protobuf
message GetEntityColumnsRequest {
  string entity_type = 1;
  string domain = 2;
  string connection = 3;             // Optional: filter by connection
  string role = 4;                   // Optional: filter by role
}
```

Column roles: `name`, `id`, `amount`, `date`, `category`, `flag`

### HTTP Gateway

The Ontology Service is also available via the REST gateway:

| Method | Endpoint |
|--------|----------|
| GET | `/v1/ontology/context/{domain}` |
| POST | `/v1/ontology/resolve` |
| POST | `/v1/ontology/resolve/batch` |
| GET | `/v1/ontology/entity-types/{entity_type}/relationships` |
| GET | `/v1/ontology/entity-types/{entity_type}/columns` |

## Process Service (gRPC)

The Process Service provides AI agents with business process context — rules, calendar definitions, tribal knowledge, and process step sequences. This context helps agents generate queries that respect business logic.

### Service: `process.v1.ProcessService`

| Method | Description |
|--------|-------------|
| `GetProcessContext` | Get a full domain overview (processes, rules, annotations, calendar) |
| `GetBusinessRules` | Get rules for a domain, optionally filtered by view/table |
| `BatchGetBusinessRules` | Batch get rules for up to 20 views/tables |
| `GetAnnotations` | Get context-triggered annotations (tribal knowledge) |
| `GetCalendarContext` | Get fiscal calendar definition for a domain |
| `GetProcess` | Get a single process with full step detail |

### GetProcessContext

```protobuf
message GetProcessContextRequest {
  string domain = 1;                   // Required
  int32 page_size = 2;               // Default 50
  string page_token = 3;
  string min_importance = 4;          // "high", "medium", "low"
}
```

Returns processes, business rules, annotations, and calendar context for the domain.

### GetBusinessRules

```protobuf
message GetBusinessRulesRequest {
  string domain = 1;                   // Required
  string view_name = 2;              // Optional: filter rules by applies_to
  Enforcement min_enforcement = 3;    // Optional: minimum enforcement level
}
```

Enforcement levels:
- `ADVISORY` — Guidance only, agent may ignore
- `SOFT_ENFORCED` — Agent should follow, can override with justification
- `HARD_ENFORCED` — Agent must follow, no override

### GetCalendarContext

```protobuf
message GetCalendarContextRequest {
  string domain = 1;
}

message GetCalendarContextResponse {
  string name = 1;
  string description = 2;
  int32 fiscal_year_start_month = 3;
  string year_format = 4;             // e.g., "FY{YY}"
  map<string, QuarterDef> quarter_mapping = 5;
  int32 version = 6;
}
```

### HTTP Gateway

| Method | Endpoint |
|--------|----------|
| GET | `/v1/process/context/{domain}` |
| GET | `/v1/process/rules/{domain}` |
| POST | `/v1/process/rules/{domain}/batch` |
| GET | `/v1/process/annotations/{domain}` |
| GET | `/v1/process/calendar/{domain}` |
| GET | `/v1/process/processes/{domain}/{name}` |

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
