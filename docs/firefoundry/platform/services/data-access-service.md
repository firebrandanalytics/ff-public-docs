# Data Access Service

## Overview

The Data Access Service is a gRPC/REST API that provides secure, multi-database SQL access for AI agents and applications. It supports both raw SQL queries and structured AST (Abstract Syntax Tree) queries, with the AST endpoint enabling AI-generated queries that are validated, dialect-translated, and access-controlled before execution.

## Purpose and Role in Platform

The Data Access Service enables FireFoundry agents and applications to:
- Query and modify data across PostgreSQL, MySQL, and SQLite databases through a single unified API
- Construct structured queries as JSON ASTs that are automatically translated to the correct SQL dialect
- Operate within fine-grained access controls (connection, table, and column level)
- Leverage stored definitions (views, UDFs, TVFs) that appear as real database objects to callers
- Preview generated SQL before execution for debugging and validation

This service acts as the secure data layer for AI agents, abstracting away database-specific SQL syntax and enforcing access controls that prevent unauthorized data access.

## Key Features

- **Multi-Database Support**: PostgreSQL, MySQL, and SQLite through a single API
- **AST Query API**: Submit structured JSON queries that are validated and translated to backend-specific SQL
- **Dialect Translation**: Automatic SQL generation for each database backend, handling syntax differences (quoting, functions, type casting)
- **Function Pass-Through**: AI agents can use any database-native function; common functions are arity-validated, others pass through
- **Function Blacklisting**: Dangerous functions (pg_sleep, load_file, etc.) are blocked globally and per-identity
- **Table/Column ACL**: Fine-grained access control at the table and column level via AST inspection
- **Stored Definitions**: Virtual views, scalar UDFs, and table-valued functions that expand at query time
- **View Expansion**: Transparent view resolution with cycle detection, namespace isolation, and recursive expansion
- **Credential Management**: Environment-variable-based credentials with support for rotation without restart
- **Admin API**: REST endpoints for connection CRUD, credential rotation, and view management
- **Audit Logging**: All operations logged with identity, connection, SQL hash, and duration

## Architecture Overview

The Data Access Service follows a layered pipeline architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                   API Layer                                  │
│           gRPC (:50051) + REST Gateway (:8080)              │
│   Query | Execute | QueryAST | TranslateAST | GetSchema    │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                 Auth & ACL Layer                             │
│   API Key Auth → Identity Extraction → Connection ACL       │
│                                      → Table/Column ACL     │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│               AST Processing Pipeline                        │
│   Validate → Blacklist Check → View/UDF Expansion →         │
│   Table/Column ACL → Serialize to Dialect SQL               │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              Database Adapter Layer                           │
│   PostgreSQL Adapter | MySQL Adapter | SQLite Adapter        │
│   (Connection pooling, type normalization, timeouts)         │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              Target Databases                                 │
│   PostgreSQL 13+ | MySQL 8+ | SQLite 3.35+                  │
└─────────────────────────────────────────────────────────────┘
```

**Core Components:**
- **gRPC Server**: Handles data plane operations (Query, Execute, QueryAST, TranslateAST, GetSchema, ListConnections)
- **Admin Server**: REST API for connection management, credential rotation, and view CRUD
- **AST Validator**: Validates query structure, enforces limits, checks function blacklists
- **AST Serializer**: Translates validated AST to PostgreSQL, MySQL, or SQLite SQL with proper quoting and dialect handling
- **AST Rewriter**: Expands stored view, UDF, and TVF references with parameter binding and cycle detection
- **ACL Checker**: Enforces connection-level, table-level, and column-level access rules
- **Database Adapters**: Backend-specific adapters with connection pooling, type normalization, and timeout management

## The AST Query Concept

### Why AST Queries?

Traditional raw SQL queries present challenges for AI-driven applications:
- Different databases use different SQL dialects (quoting, functions, type casting)
- SQL injection risks when constructing queries from AI-generated content
- No structural validation before execution
- Cannot enforce table/column-level access controls on raw SQL

The AST Query API solves this by accepting queries as **structured JSON objects** that represent SQL SELECT statements. The service validates the structure, checks access controls at the table and column level, and generates correct SQL for the target database.

### How It Works

1. **AI generates a JSON AST** representing the desired query (e.g., "SELECT name, COUNT(*) FROM users GROUP BY name")
2. **The service validates** the AST structure (required fields, expression depth limits, identifier format)
3. **Function blacklist** is checked to block dangerous functions (pg_sleep, load_file, etc.)
4. **Stored definitions** (views, UDFs, TVFs) are expanded if referenced
5. **Table/column ACL** is enforced against the caller's identity
6. **SQL is generated** for the specific database dialect
7. **Query is executed** and results returned with column metadata

### AST Structure

A query AST is a `SelectStatement` JSON object:

```json
{
  "columns": [
    { "expr": { "column": { "column": "name" } } },
    { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "total" }
  ],
  "from": { "table": { "table": "users" } },
  "where": {
    "binary": {
      "op": "BINARY_OP_EQ",
      "left": { "column": { "column": "active" } },
      "right": { "literal": { "boolValue": true } }
    }
  },
  "groupBy": [{ "expr": { "column": { "column": "name" } } }],
  "orderBy": [{ "expr": { "column": { "column": "total" } }, "dir": "SORT_DESC" }],
  "limit": 10
}
```

This generates dialect-specific SQL:
- **PostgreSQL**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = TRUE GROUP BY "name" ORDER BY "total" DESC LIMIT 10`
- **MySQL**: `` SELECT `name`, COUNT(*) AS `total` FROM `users` WHERE `active` = TRUE GROUP BY `name` ORDER BY `total` DESC LIMIT 10 ``
- **SQLite**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = 1 GROUP BY "name" ORDER BY "total" DESC LIMIT 10`

### Supported SQL Constructs

The AST supports the full range of SQL SELECT constructs:

| Construct | Description |
|-----------|-------------|
| SELECT columns | Column references, functions, literals, star, aliases |
| FROM | Tables, subqueries, table-valued functions, LATERAL |
| JOIN | INNER, LEFT, RIGHT, FULL, CROSS with ON conditions |
| WHERE | Binary/unary expressions, BETWEEN, IN, EXISTS, IS NULL |
| GROUP BY | Expressions, ROLLUP, CUBE, GROUPING SETS |
| HAVING | Aggregate filter expressions |
| ORDER BY | ASC/DESC with NULLS FIRST/LAST |
| LIMIT/OFFSET | Pagination |
| CTEs | Common Table Expressions (WITH, WITH RECURSIVE) |
| Window Functions | ROW_NUMBER, RANK, LAG/LEAD, SUM OVER, frame specs |
| Set Operations | UNION, INTERSECT, EXCEPT (with ALL) |
| CASE | Simple and searched CASE expressions |
| CAST | Type conversion with dialect mapping |
| Functions | 70+ registered functions plus pass-through for native DB functions |

### Who Generates ASTs?

While the AST format is fully documented, **AI agents are the primary AST generators**. The service provides AI skills (installed as Claude/Codex/Gemini skills) that teach AI assistants the AST format, expression types, and query patterns. Human developers typically interact through:
- The **TranslateAST** endpoint to preview generated SQL
- The **Admin API** to manage connections, views, and stored definitions
- **Raw SQL** via the Query/Execute endpoints for ad-hoc work

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

### Query Response Format

```json
{
  "columns": [
    { "name": "id", "type": "integer", "normalizedType": "integer", "nullable": false, "primaryKey": true },
    { "name": "name", "type": "varchar", "normalizedType": "text", "nullable": true }
  ],
  "rows": [
    { "fields": { "id": 1, "name": "Alice" } },
    { "fields": { "id": 2, "name": "Bob" } }
  ],
  "rowCount": 2,
  "durationMs": 12,
  "queryId": "q-abc123",
  "truncated": false
}
```

### Limits and Timeouts

Connection-level limits act as caps on request-level options:
- **Timeout**: `min(requested, config.queryTimeout)` — config default if request is 0
- **Max Rows**: `min(requested, config.maxRows)` — config default if request is 0

## Admin API

### Connection Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/connections` | List all connections (sanitized, no secrets) |
| POST | `/admin/connections` | Create connection |
| GET | `/admin/connections/{name}` | Get connection detail |
| PUT | `/admin/connections/{name}` | Update connection |
| DELETE | `/admin/connections/{name}` | Delete connection |
| POST | `/admin/connections/{name}/test` | Test connection health |
| POST | `/admin/connections/{name}/rotate` | Rotate credentials (zero-downtime) |

### Credential Methods

The service never stores credentials directly. Instead, connections reference environment variable names:

| Method | Description |
|--------|-------------|
| `env` | Read username/password from environment variables |
| `service_principal` | OAuth2 client credentials (Azure AD) |
| `managed_identity` | Azure/GCP managed identity |
| `none` | No credentials (SQLite) |

Credential rotation re-reads environment variables and atomically swaps connection pools with zero downtime.

### View Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/views` | List views (filter by namespace, connection) |
| POST | `/admin/views` | Create view definition |
| GET | `/admin/views/{namespace}/{name}` | Get view with AST |
| PUT | `/admin/views/{namespace}/{name}` | Update view |
| DELETE | `/admin/views/{namespace}/{name}` | Delete view |

Views are organized by namespace for isolation:
- `system` — Available to all callers
- `app:{name}` — Available to agents in that application
- `agent:{id}` — Available to a specific agent instance

## Access Control

### Connection-Level ACL

Each identity is granted access to specific connections:

```yaml
acl:
  - identity: "app:sales-agent"
    connections: ["warehouse", "analytics"]
  - identity: "user:admin"
    connections: ["*"]  # wildcard access
```

### Table-Level ACL

Restrict access to specific tables:

```yaml
  - identity: "app:public-agent"
    connections: ["warehouse"]
    tables_deny: ["credentials", "audit_log"]
    # or: tables_allow: ["products", "categories"]  # whitelist mode
```

### Column-Level ACL

Restrict access to specific columns:

```yaml
  - identity: "app:public-agent"
    connections: ["warehouse"]
    columns_deny:
      users: ["ssn", "password_hash"]
      "*": ["internal_notes"]  # deny across all tables
```

Table and column ACL is enforced by walking the AST to extract all table and column references, then checking against the rules. This catches restricted references in SELECT, WHERE, JOIN ON, and other clauses.

### Function Blacklisting

Dangerous database functions are blocked globally:

```yaml
function_blacklist:
  global:
    - pg_sleep
    - pg_terminate_backend
    - load_file
    - sleep
    - benchmark
```

## Stored Definitions

### Views

Stored SELECT statements that expand transparently when referenced:

```
CREATE VIEW → POST /admin/views { name, namespace, ast }
USE VIEW   → QueryAST with FROM: { table: "view_name" }
EXPANSION  → View AST is spliced as subquery
```

Views support:
- Recursive composition (views referencing other views, up to 10 levels)
- Cycle detection (circular references are rejected)
- Namespace resolution (agent → app → system priority)

### Scalar UDFs

Functions stored as AST definitions that return a single value:

```
DEFINE   → POST /admin/views { name, params: [{position: 1}], ast: <SELECT with param refs> }
CALL     → QueryAST with function: { name: "my_udf", args: [...] }
EXPANSION → Wrapped as scalar subquery with parameter binding
```

### Table-Valued Functions (TVFs)

Functions called in FROM/JOIN position that return rowsets:

```
DEFINE   → POST /admin/views { name, params, ast }
CALL     → QueryAST with from: { tableFunction: { name: "my_tvf", args: [...] } }
EXPANSION → Wrapped as subquery with parameter binding
```

## Dependencies

### Required
- **Go 1.22+** (build time)
- **Target databases**: At least one of PostgreSQL 13+, MySQL 8+, or SQLite 3.35+

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GRPC_PORT` | 50051 | gRPC server port |
| `HTTP_PORT` | 8080 | HTTP server port (admin + REST gateway) |
| `CONNECTIONS_FILE` | configs/connections.yaml | Connection configuration file |
| `ACL_FILE` | configs/acl.yaml | ACL rules file |
| `API_KEY` | dev-api-key | API key for authentication |
| `VIEWS_FILE` | — | Optional stored definitions file |
| `LOG_LEVEL` | info | Logging level (info/debug) |
| `ENABLE_REFLECTION` | false | Enable gRPC reflection |

### Health Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `/health` | No | Service liveness |
| `/health/live` | No | Liveness probe |
| `/health/ready` | No | Readiness (checks database connections) |
| `/debug/pools` | Yes | Connection pool statistics |

## Deployment

### Kubernetes

The service is designed for Kubernetes deployment:
- **Single binary**: No runtime dependencies beyond database connectivity
- **Stateless**: All state is in the target databases and config files
- **Liveness/readiness probes**: Standard health endpoints
- **Credential injection**: Environment variables from Kubernetes secrets
- **Credential rotation**: Call `/admin/connections/{name}/rotate` after secret updates

### Configuration

**Connection Configuration** (YAML):

```yaml
connections:
  - name: warehouse
    type: postgresql
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

**ACL Configuration** (YAML):

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
    - load_file
    - sleep
    - benchmark
```

## Solution Architecture Patterns

### Pattern 1: AI Agent with Database Access

An AI agent uses the AST endpoint to query a database, with the AI skill teaching it the AST format:

```
User → Agent → [AI generates AST] → QueryAST → Database
                                         ↓
                                   [Results returned as JSON]
```

The agent's identity determines which connections, tables, and columns it can access.

### Pattern 2: Multi-Database Analytics

A single agent queries across multiple databases:

```
Agent → QueryAST (connection: "warehouse") → PostgreSQL
Agent → QueryAST (connection: "cache")     → SQLite
Agent → QueryAST (connection: "legacy")    → MySQL
```

The same AST produces correct SQL for each database dialect.

### Pattern 3: Stored Views as Business Logic Layer

Administrators define business views that abstract raw tables:

```
Admin → POST /admin/views { "active_customers", ast: ... }
Agent → QueryAST { from: "active_customers" }
       → Expands to: SELECT * FROM (SELECT ... WHERE active = true) AS "active_customers"
```

Views provide a stable interface even when underlying tables change.

### Pattern 4: Translate-Then-Review

For debugging or auditing, use TranslateAST to preview SQL without executing:

```
Agent → TranslateAST { select: ... }
     → Returns: { sql: "SELECT ...", dialect: "postgresql" }
```

This allows human review of AI-generated queries before execution.

## Monitoring and Observability

### Audit Logging

All data plane operations are audit-logged with:
- `queryId` — Unique per request
- `identity` — Authenticated caller
- `connection` — Target connection
- `sqlHash` — SHA256 prefix of SQL (for grouping without storing raw SQL)
- `status` — success, truncated, error, denied
- `durationMs` — Execution time
- `rowCount` — Rows returned or affected

### Connection Pool Monitoring

The `/debug/pools` endpoint returns per-connection pool statistics:
- Active/idle connections
- Wait count and duration
- Max lifetime and idle timeout

## Security Considerations

- **No inline credentials**: The admin API rejects connections with inline passwords; all secrets must come from environment variables
- **Function blacklisting**: 17 dangerous functions blocked by default (filesystem access, process termination, sleep/benchmark)
- **Identifier validation**: All AST identifiers must match `^[a-zA-Z_][a-zA-Z0-9_]*$` to prevent injection
- **AST depth limits**: Maximum 32 nesting levels and 1000 expression nodes to prevent resource exhaustion
- **Column-level ACL**: Restricted columns are caught in all positions (SELECT, WHERE, JOIN ON, HAVING)
- **Audit trail**: All operations logged with caller identity for compliance
- **View cycle detection**: Prevents infinite expansion of circular view references

## Troubleshooting

### Common Issues

| Issue | Cause | Resolution |
|-------|-------|------------|
| `PermissionDenied` on query | Identity not in ACL for connection | Add identity to `acl.yaml` with correct connections |
| `PermissionDenied` on table | Table in `tables_deny` list | Remove from deny list or use a different identity |
| `InvalidArgument: function blocked` | Function in blacklist | Use a different function or adjust blacklist config |
| `InvalidArgument: AST validation` | Malformed AST structure | Check required fields, identifier format, expression depth |
| Connection timeout | Database unreachable | Check network, credentials, and pool configuration |
| `NotFound: connection` | Connection name not configured | Add to connections.yaml or create via admin API |

### Viewing Generated SQL

Use the TranslateAST endpoint to see exactly what SQL will be generated:

```bash
curl -X POST http://localhost:8080/v1/connections/warehouse/translate-ast \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:debug" \
  -H "Content-Type: application/json" \
  -d '{"select": {"columns": [{"expr": {"star": {}}}], "from": {"table": {"table": "users"}}}}'
```

## Related Documentation

- [Platform Services Overview](./README.md) — All FireFoundry services
- [AI Skills for Data Access](#) — Claude/Codex/Gemini skills for AST query generation (installed separately)
- [Platform Architecture](../architecture.md) — Overall platform design
