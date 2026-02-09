# Data Access Service — Concepts

## Connections

A **connection** is a named reference to a database with its type, credentials, pool settings, and query limits. The service currently supports PostgreSQL, MySQL, and SQLite backends, with SQL Server, Oracle, Snowflake, and Databricks planned as the next tier. Connections are defined in `connections.yaml` or managed via the Admin API.

Connections never store credentials directly — they reference environment variable names. This allows credential rotation without restarting the service.

```yaml
connections:
  - name: warehouse
    type: postgresql
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

## AST Queries

### Why AST?

Traditional raw SQL presents challenges for AI-driven applications:
- Different databases use different SQL dialects (quoting, functions, type casting)
- SQL injection risks when constructing queries from AI-generated content
- No structural validation before execution
- Cannot enforce table/column-level access controls on raw SQL

The **AST Query API** accepts queries as structured JSON objects representing SQL SELECT statements. The service validates the structure, checks access controls at the table and column level, and generates correct SQL for the target database.

### How It Works

1. AI generates a JSON AST representing the desired query
2. The service validates the AST structure (required fields, depth limits, identifier format)
3. Function blacklist is checked to block dangerous functions
4. Stored definitions (views, UDFs, TVFs) are expanded if referenced
5. Table/column ACL is enforced against the caller's identity
6. SQL is generated for the specific database dialect
7. Query is executed and results returned with column metadata

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

This produces dialect-specific SQL:
- **PostgreSQL**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = TRUE GROUP BY "name" ORDER BY "total" DESC LIMIT 10`
- **MySQL**: `` SELECT `name`, COUNT(*) AS `total` FROM `users` WHERE `active` = TRUE GROUP BY `name` ORDER BY `total` DESC LIMIT 10 ``
- **SQLite**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = 1 GROUP BY "name" ORDER BY "total" DESC LIMIT 10`

### Supported SQL Constructs

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
| Functions | Any database-native function (pass-through with arity validation) |

### Who Generates ASTs?

**AI agents are the primary AST generators.** The service provides AI skills (installed as Claude/Codex/Gemini/Cursor skills) that teach AI assistants the AST format, expression types, and query patterns. Human developers typically interact through:
- The **TranslateAST** endpoint to preview generated SQL
- The **Admin API** to manage connections, views, and stored definitions
- **Raw SQL** via the Query/Execute endpoints for ad-hoc work

## Dialect Translation

The AST serializer generates correct SQL for each backend, handling:

| Aspect | PostgreSQL | MySQL | SQLite |
|--------|-----------|-------|--------|
| Identifier quoting | `"name"` | `` `name` `` | `"name"` |
| Boolean literals | `TRUE`/`FALSE` | `TRUE`/`FALSE` | `1`/`0` |
| String escaping | `'it''s'` | `'it''s'` | `'it''s'` |
| CAST types | Native types | Native types | Mapped subset |
| LIMIT/OFFSET | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` |
| NULLS FIRST/LAST | Native | Emulated with CASE | Emulated with CASE |
| Recursive CTEs | `WITH RECURSIVE` | `WITH RECURSIVE` | `WITH RECURSIVE` |

Functions are passed through to the database — the service doesn't maintain a function translation table. If you call `pg_sleep()` on PostgreSQL, it works. If you call it on MySQL, the database returns an error. The blacklist blocks functions that are dangerous regardless of dialect.

## Staged Queries

### What Are Staged Queries?

Staged queries are **pre-queries** that execute against specific connections before the main query. Their results are automatically injected as VALUES CTEs into downstream queries, enabling cross-database federation.

### How They Work

1. You define one or more `StagedQuery` objects, each with an `alias`, `connection`, and `query` (AST)
2. The service builds a dependency graph — if staged query B references staged query A's alias, B depends on A
3. Queries are sorted into execution tiers using topological sort
4. Each tier executes in parallel; dependencies between tiers execute sequentially
5. Results from each staged query are injected as `WITH <alias> AS (VALUES ...)` CTEs
6. The main query can reference any staged alias in FROM, JOIN, WHERE, etc.

### Dependency Graph Example

```
StagedQuery "customers" → tier 0 (no dependencies)
StagedQuery "orders"    → tier 0 (no dependencies)
StagedQuery "summary"   → tier 1 (references "customers" and "orders")
Main query              → references "summary"
```

Tier 0 queries execute in parallel. Tier 1 waits for tier 0 to complete, then executes with injected results.

### Cross-Database Federation

Staged queries enable querying across different database types:

```
StagedQuery "pg_users"   (connection: "warehouse")   → PostgreSQL
StagedQuery "mysql_logs" (connection: "legacy")       → MySQL
Main query               (connection: "analytics")    → SQLite

The main SQLite query can JOIN pg_users and mysql_logs as if they were local tables.
```

### VALUES CTE Injection

Results are injected as VALUES CTEs, serialized per-dialect:

- **PostgreSQL**: `WITH alias(col1,col2) AS (VALUES ($1::text,$2::integer), ...)`
- **MySQL**: `WITH alias(col1,col2) AS (VALUES ROW(?,?), ROW(?,?), ...)`
- **SQLite**: `WITH alias(col1,col2) AS (VALUES ('val1',42), ('val2',99), ...)`

### Execution Limits

Staged queries enforce safety limits:
- Maximum 1,000 rows per staged query result
- Maximum 10MB total staged data per request
- Maximum 10 staged queries per request
- Cycle detection rejects circular dependencies

### Staged Stats

The response includes `staged_stats` with per-query execution details:
- Alias, connection, execution tier
- Row count, byte size, duration
- SQL hash for audit correlation

## Scratch Pad

### What Is the Scratch Pad?

The scratch pad provides **per-identity SQLite databases** for persisting intermediate results across requests. This enables conversational data analysis where an AI agent can save a result set, then query it in a subsequent request.

### How It Works

1. Include `save_as: "my_results"` in an `ASTQueryRequest`
2. After the query executes, results are saved to a SQLite table named `my_results` in the caller's scratch database
3. The scratch database is auto-registered as connection `scratch:<identity>` (e.g., `scratch:user:alice`)
4. Subsequent requests can query `scratch:user:alice` using QueryAST or QueryRaw
5. Saves are idempotent — if the table exists, it's dropped and recreated

### Scratch Connection Naming

The scratch connection name is derived from the caller's identity:
- Identity `user:alice` → connection `scratch:user:alice`
- Identity `app:sales-agent` → connection `scratch:app:sales-agent`

### Common Patterns

**Save and query back:**
```
Request 1: QueryAST(connection: "warehouse", save_as: "top_customers", ...)
Request 2: QueryAST(connection: "scratch:user:alice", FROM: "top_customers", ...)
```

**Save staged results for later:**
```
Staged: "pg_data" from warehouse, "mysql_data" from legacy
Main query: JOINs them, save_as: "combined"
Next request: QueryAST(connection: "scratch:...", FROM: "combined")
```

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

Restrict access to specific tables using allow-lists or deny-lists:

```yaml
  - identity: "app:public-agent"
    connections: ["warehouse"]
    tables_deny: ["credentials", "audit_log"]
    # or: tables_allow: ["products", "categories"]
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

Table and column ACL is enforced by walking the AST to extract all table and column references. This catches restricted references in SELECT, WHERE, JOIN ON, HAVING, and all other clauses.

### Function Blacklisting

Dangerous database functions are blocked:

```yaml
function_blacklist:
  global:
    - pg_sleep
    - pg_terminate_backend
    - load_file
    - sleep
    - benchmark
  per_identity:
    "app:restricted":
      - pg_catalog
```

The blacklist uses exact name matching (case-insensitive). Functions not on the blacklist pass through to the database.

### ACL for Staged Queries

Each staged query's connection is ACL-checked against the caller's identity. If any staged query targets an unauthorized connection, the entire request is rejected. Scratch connections (`scratch:<identity>`) are implicitly authorized for the owning identity.

## Stored Definitions

### Views

Stored SELECT statements that expand transparently when referenced in an AST query:

```
Admin creates: POST /admin/views { name: "active_customers", namespace: "system", ast: ... }
Agent queries: QueryAST { from: "active_customers" }
Expansion:     SELECT * FROM (SELECT ... WHERE active = true) AS "active_customers"
```

Views support:
- **Recursive composition**: Views referencing other views, up to 10 levels deep
- **Cycle detection**: Circular references are rejected at expansion time
- **Namespace isolation**: Agent → App → System priority resolution

### Scalar UDFs

Functions stored as AST definitions that return a single value. Called in expressions, expanded as scalar subqueries with parameter binding.

### Table-Valued Functions (TVFs)

Functions called in FROM/JOIN position that return rowsets. Expanded as subqueries with parameter binding.

## Security Model

- **No inline credentials**: Admin API rejects connections with inline passwords
- **Function blacklisting**: 17+ dangerous functions blocked by default
- **Identifier validation**: All AST identifiers must match `^[a-zA-Z_][a-zA-Z0-9_]*$`
- **AST depth limits**: Maximum 32 nesting levels and 1000 expression nodes
- **Column-level ACL**: Restricted columns caught in all SQL positions
- **Audit trail**: All operations logged with caller identity
- **View cycle detection**: Prevents infinite expansion loops
- **Staged query limits**: Row count, byte size, and query count caps
