# Data Access Service — Concepts

## Connections

A **connection** is a named reference to a database with its type, credentials, pool settings, and query limits. The service supports 7 backends: PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, and Databricks. Connections are managed via the Admin API.

Connections never store credentials directly — they reference environment variable names. This allows credential rotation without restarting the service.

```json
{
  "name": "warehouse",
  "type": "postgresql",
  "config": {
    "host": "warehouse.internal",
    "port": 5432,
    "database": "analytics",
    "sslMode": "require"
  },
  "credentials": {
    "method": "env",
    "envMappings": {
      "username": "PG_WAREHOUSE_USER",
      "password": "PG_WAREHOUSE_PASSWORD"
    }
  },
  "pool": {
    "maxOpen": 25,
    "maxIdle": 5,
    "maxLifetime": "30m"
  },
  "limits": {
    "maxRows": 100000,
    "queryTimeout": "30s"
  }
}
```

Create it via the Admin API:

```bash
curl -X POST http://localhost:8080/admin/connections \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @warehouse-connection.json
```

## AST Queries

### Why AST?

Traditional raw SQL presents challenges for AI-driven applications:
- SQL injection risks when constructing queries from AI-generated content
- No structural validation before execution
- Cannot enforce table/column-level access controls on raw SQL
- Identifier quoting and parameter placeholder styles vary between databases

The **AST Query API** accepts queries as structured JSON objects representing SQL SELECT statements. The service validates the structure, checks access controls at the table and column level, expands stored definitions, and serializes the AST to SQL with the correct identifier quoting and parameter placeholders for the target database.

> **Important:** The AST API is not a database-agnostic query language. SQL constructs (functions, syntax, type-specific operations) are passed through to the upstream database. Agents should know what database they're targeting and use the SQL constructs that database supports. The service handles mechanical serialization concerns (quoting, parameter styles, boolean literals) but does not translate SQL syntax between databases.

### How It Works

1. AI generates a JSON AST representing the desired query
2. The service validates the AST structure (required fields, depth limits, identifier format)
3. Function blacklist is checked to block dangerous functions
4. Stored definitions (views, UDFs, TVFs) are expanded if referenced
5. Table/column ACL is enforced against the caller's identity
6. AST is serialized to SQL with correct quoting and parameter placeholders for the target database
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
  "limit": 10,
  "offset": 20
}
```

The serializer produces SQL with the correct quoting and parameter style for each backend:
- **PostgreSQL**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = TRUE GROUP BY "name" ORDER BY "total" DESC LIMIT 10 OFFSET 20`
- **MySQL**: `` SELECT `name`, COUNT(*) AS `total` FROM `users` WHERE `active` = TRUE GROUP BY `name` ORDER BY `total` DESC LIMIT 10 OFFSET 20 ``
- **SQLite**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = 1 GROUP BY "name" ORDER BY "total" DESC LIMIT 10 OFFSET 20`
- **SQL Server**: `SELECT "name", COUNT(*) AS "total" FROM "users" WHERE "active" = 1 GROUP BY "name" ORDER BY "total" DESC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY`

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
| LIMIT/OFFSET | Pagination — `"limit": 10, "offset": 20` (serialized per-dialect: LIMIT/OFFSET for PG/MySQL/SQLite, TOP/OFFSET-FETCH for SQL Server, OFFSET-FETCH for Oracle) |
| CTEs | Common Table Expressions (WITH, WITH RECURSIVE) |
| Window Functions | ROW_NUMBER, RANK, LAG/LEAD, SUM OVER, frame specs |
| Set Operations | UNION, INTERSECT, EXCEPT (with ALL) |
| CASE | Simple and searched CASE expressions |
| CAST | Type conversion |
| Regex Match | First-class `regex_match` expression — pattern emitted as bind parameter, serialized per-dialect (`~` for PG, `REGEXP` for MySQL/SQLite) |
| Functions | Any database-native function (pass-through with arity validation) |

### Who Generates ASTs?

**AI agents are the primary AST generators.** The service provides AI skills (installed as Claude/Codex/Gemini/Cursor skills) that teach AI assistants the AST format, expression types, and query patterns. Human developers typically interact through:
- The **TranslateAST** endpoint to preview generated SQL
- The **Admin API** to manage connections, views, and stored definitions
- **Raw SQL** via the Query/Execute endpoints for ad-hoc work

## SQL Serialization

The service is an **unopinionated SQL gateway** — it serializes AST structures into SQL with the correct mechanical formatting for each backend, but does not attempt to translate SQL constructs between databases. Agents should know what database they're targeting and use the functions and syntax that database supports.

### What the Serializer Handles

The AST serializer handles per-backend differences in **mechanical formatting**:

| Aspect | PostgreSQL | MySQL | SQLite | SQL Server | Oracle | Snowflake | Databricks |
|--------|-----------|-------|--------|-----------|--------|-----------|------------|
| Identifier quoting | `"name"` | `` `name` `` | `"name"` | `[name]` | `"name"` | `"name"` | `` `name` `` |
| Parameter placeholders | `$1` | `?` | `?` | `@p1` | `:1` | `?` | `?` |
| Boolean literals | `TRUE`/`FALSE` | `TRUE`/`FALSE` | `1`/`0` | `1`/`0` | `1`/`0` | `TRUE`/`FALSE` | `TRUE`/`FALSE` |
| LIMIT/OFFSET | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` | `TOP n` / `OFFSET FETCH` | `FETCH FIRST n ROWS` | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` |

### What the Serializer Does NOT Handle

The service does **not** translate SQL constructs between databases. SQL functions, operators, and syntax are passed through as-is to the upstream database:

- **Functions**: If you call `pg_sleep()` on PostgreSQL, it works. If you call it on MySQL, the database returns an error. The service doesn't maintain a function translation table.
- **Operators**: If you use `||` for string concatenation, it works on PostgreSQL and SQLite but not on SQL Server (which uses `+`). The agent should use the correct operator for the target database.
- **Syntax**: Database-specific syntax (e.g., `FILTER` clauses on aggregates in PostgreSQL, `PIVOT` in SQL Server) is passed through — the upstream database accepts or rejects it.

The function blacklist blocks functions that are dangerous regardless of backend. All other functions pass through to the database.

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

Results are injected as VALUES CTEs, formatted for each backend:

- **PostgreSQL**: `WITH alias(col1,col2) AS (VALUES ($1::text,$2::integer), ...)`
- **MySQL**: `WITH alias(col1,col2) AS (VALUES ROW(?,?), ROW(?,?), ...)`
- **SQLite**: `WITH alias(col1,col2) AS (VALUES ('val1',42), ('val2',99), ...)` (inline literals)
- **SQL Server**: `WITH alias AS (SELECT col1,col2 FROM (VALUES (@p1,@p2),(@p3,@p4)) AS t(col1,col2))`
- **Oracle**: `WITH alias(col1,col2) AS (SELECT :1,:2 FROM DUAL UNION ALL SELECT :3,:4 FROM DUAL)`
- **Snowflake**: `WITH alias AS (SELECT col1,col2 FROM (VALUES (?,?),(?,?)) AS t(col1,col2))`
- **Databricks**: `WITH alias(col1,col2) AS (VALUES ROW(?,?), ROW(?,?), ...)`

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

## Dictionary Integration

### Schema Augmentation

Stored view definitions appear in `GetSchema` responses as entries with `type: "stored_view"`, alongside real database tables and views. This means AI agents can discover stored views the same way they discover tables — through the schema endpoint.

Rules:
- Only views matching the requested connection are included
- Views never shadow real tables (if a real table and a stored view share a name, the real table wins)
- Namespace visibility is enforced: `system` views are visible to all, `app:X` views only to the matching app identity, `agent:X` views only to the matching agent
- Output columns are included when available (from explicit schema or probe inference)

### Probe Queries

When a stored view is created or updated without an explicit `output_schema`, the service automatically runs a **probe query** — it executes the view's AST with `LIMIT 1` to infer the output column types from the database's response metadata.

- Parameterized views (those with `params`) are skipped — they need real arguments to execute
- Views with an explicit `output_schema` are not probed (the explicit schema is used as-is)
- Probe failures are logged but non-fatal — the view is still saved, just without column metadata

### View Discovery in Practice

```
1. Admin creates view: POST /admin/views { name: "active_users", connection: "warehouse", ast: ... }
2. Service auto-probes: SELECT * FROM (view AST) LIMIT 1 → infers columns [id: INTEGER, name: VARCHAR, ...]
3. Agent calls GetSchema("warehouse") → sees "active_users" (type: stored_view) with inferred columns
4. Agent queries: QueryAST { from: "active_users" } → view expands transparently
```

## Data Dictionary

### What Is the Data Dictionary?

The data dictionary is a semantic annotation layer that enriches raw database schema information with business meaning, usage guidance, statistics, relationships, and data quality information. While `GetSchema` tells AI agents *what tables and columns exist*, the data dictionary tells them *what those tables and columns mean, how to use them, and what to watch out for*.

### Why It Matters for AI

Without a data dictionary, AI agents must guess at:
- What each column means ("Is `amt` the order total or the line item amount?")
- Which tables to use ("Should I use `orders` or `order_history`?")
- Valid filter values ("What are the valid `status` values?")
- Data quality issues ("Are there nulls in `email`?")
- How tables relate beyond explicit foreign keys

The data dictionary answers these questions explicitly, reducing hallucination and improving query accuracy.

### Table Annotations

Each table (or stored view) can be annotated with:

| Field | Type | Description |
|-------|------|-------------|
| `description` | TEXT | What this table contains and its purpose |
| `businessName` | TEXT | Human-friendly name (e.g., "Customer Orders") |
| `grain` | TEXT | What each row represents (e.g., "One row per order line item") |
| `tags` | TEXT[] | Categorical tags for filtering and routing |
| `statistics` | JSONB | Row count, average row size, last analyzed date |
| `relationships` | JSONB | Semantic relationships to other tables with join hints |
| `qualityNotes` | JSONB | Known data quality issues, completeness, freshness |
| `usageNotes` | TEXT | When to use (and when NOT to use) this table |

### Column Annotations

Each column can be annotated with:

| Field | Type | Description |
|-------|------|-------------|
| `description` | TEXT | What this column represents |
| `businessName` | TEXT | Business-friendly name |
| `semanticType` | TEXT | Role in queries: `identifier`, `measure`, `dimension`, `temporal`, `descriptive` |
| `dataClassification` | TEXT | Sensitivity: `public`, `internal`, `financial`, `pii` |
| `tags` | TEXT[] | Categorical tags |
| `sampleValues` | TEXT[] | Example values for context |
| `statistics` | JSONB | Min, max, avg, distinct count, null count (type-appropriate) |
| `valuePattern` | TEXT | Natural language description of value patterns |
| `constraints` | JSONB | Validation rules: enum values, ranges, regex patterns |
| `relationships` | JSONB | Loose foreign keys — semantic joins without explicit FKs |
| `qualityNotes` | JSONB | Null rates, known data issues |
| `usageNotes` | TEXT | Query guidance (e.g., "Use `order_date`, NOT `created_at` for business reporting") |

### Semantic Types

Semantic types classify how a column is used in queries:

| Type | Description | Example Columns |
|------|-------------|-----------------|
| `identifier` | Primary/foreign keys, unique IDs | `order_id`, `customer_id`, `sku` |
| `measure` | Numeric values for aggregation | `total_amount`, `quantity`, `unit_price` |
| `dimension` | Categorical values for grouping/filtering | `status`, `category`, `region` |
| `temporal` | Date/time columns | `order_date`, `created_at`, `ship_date` |
| `descriptive` | Free text, names, labels | `product_name`, `notes`, `address` |

AI agents use semantic types to make better query decisions — for example, automatically applying `SUM()` to measures and `GROUP BY` to dimensions.

### Data Classifications

Data classifications indicate sensitivity level:

| Classification | Description | Handling |
|---------------|-------------|----------|
| `public` | Non-sensitive business data | No restrictions |
| `internal` | Internal-only data | May be filtered from external-facing queries |
| `financial` | Financial data (revenue, costs, margins) | May require additional authorization |
| `pii` | Personally identifiable information | Subject to data protection regulations |

### Statistics

Statistics provide quantitative metadata about data distribution:

**Table statistics** (JSONB):
```json
{
  "rowCount": 131072,
  "avgRowSizeBytes": 256
}
```

**Column statistics** (JSONB, type-appropriate):
```json
// Numeric column
{ "min": 0.99, "max": 299.99, "avg": 45.67, "distinctCount": 1500, "nullCount": 0 }

// String column
{ "distinctCount": 5, "nullCount": 12, "avgLength": 8 }

// Temporal column
{ "min": "2023-01-01", "max": "2025-12-31", "distinctCount": 1096, "nullCount": 0 }
```

### Constraints

Constraints define validation rules that the service can use to verify filter values before hitting the database:

```json
// Enum constraint — valid values for a status column
{ "type": "enum", "values": ["pending", "shipped", "delivered", "cancelled", "returned"] }

// Range constraint — valid numeric range
{ "type": "range", "min": 0, "max": 999999.99 }

// Regex constraint — value pattern
{ "type": "regex", "pattern": "^[A-Z]{2}-\\d{6}$" }
```

### Relationships

Relationships capture semantic joins that may not be represented by explicit database foreign keys:

```json
[
  {
    "targetTable": "customers",
    "targetColumn": "customer_id",
    "matchType": "exact",
    "description": "Links to customer who placed the order"
  },
  {
    "targetTable": "products",
    "targetColumn": "sku",
    "matchType": "exact",
    "description": "Product SKU lookup — join on sku for product details"
  }
]
```

### Tag-Based Filtering and AI Routing

Tags are the primary mechanism for controlling which tables and columns AI agents see. The dictionary query API supports tag inclusion and exclusion:

- **`tags=financial,sales`** — Include annotations tagged `financial` OR `sales` (union)
- **`excludeTags=raw,internal`** — Exclude annotations tagged `raw` OR `internal` (any match excludes)
- Both can be combined: `tags=financial&excludeTags=pii` — financial annotations that are NOT PII

**Common tag patterns:**

| Tag | Purpose |
|-----|---------|
| `raw` | Unprocessed upstream tables (hide from AI) |
| `curated` | Cleaned/validated views (show to AI) |
| `financial` | Revenue, cost, and financial metrics |
| `pii` | Contains personally identifiable information |
| `transactional` | Order/event-level data |
| `reference` | Lookup/dimension tables |
| `system` | Internal system tables |

**AI routing example:** When an AI agent starts a data analysis session, the application queries the dictionary with `excludeTags=raw,system,internal` to get only the curated, business-relevant tables. The AI never sees the raw upstream tables, saving tokens and preventing confusion.

### Virtual Views and the Dictionary

Stored views (virtual views) get their own dictionary entries, indistinguishable from real tables. This means:
- A virtual view `monthly_revenue` has its own description, tags, grain, statistics
- The AI sees it alongside real tables in dictionary queries
- Tag `raw` on the base table + tag `curated` on the virtual view = AI only sees the clean version
- The dictionary entry can document the view's business purpose without revealing its implementation

### Admin vs. Query API

The data dictionary has two API surfaces:

- **Admin API** (`/admin/annotations/*`) — Create, update, and delete annotations. Requires admin authentication. Used by data stewards and automated enrichment processes.
- **Query API** (`/v1/dictionary/*`) — Read-only access with tag filtering. Requires only API key authentication. Used by AI agents and applications at query time.

This separation ensures that reading the dictionary is a normal data-plane operation (fast, frequent, low-privilege), while modifying it is a controlled administrative action.

## Variables and Row-Level Security

### What Are Variables?

Variables are named values resolved at query time from the request context. They appear in AST expressions as `{ "variable": { "name": "..." } }` nodes and are resolved before the query reaches the database. Variables are the foundation for row-level security (RLS) in stored definitions.

### Resolution Strategies

| Strategy | How It Resolves | Use Case |
|----------|----------------|----------|
| `builtin` | Reads from request context | `caller_identity` (X-On-Behalf-Of header), `caller_connection` (target connection) |
| `direct` | Uses the caller identity value as-is | When the identity header matches the database column value |
| `lookup` | Translates via a mapping table | When identity format differs from database (e.g., email → customer_id) |

Built-in variables are always available. Custom variables are defined via the admin API.

### Mapping Tables

Mapping tables are DAS-managed key-value lookups that translate between identity systems. For example, if callers authenticate with email addresses but the database uses numeric customer IDs:

```
Mapping table: email_to_customer
  alice@example.com → 42
  bob@example.com   → 99

Variable: customer_id (resolution: lookup, lookupTable: email_to_customer)

Caller identity: alice@example.com
Resolved value: 42
```

### Security Predicates

A security predicate is an AST expression attached to a stored definition. It's injected as a WHERE clause whenever the view is expanded:

```json
"securityPredicate": {
  "binary": {
    "op": "BINARY_OP_EQ",
    "left": { "column": { "column": "customer_id" } },
    "right": { "variable": { "name": "caller_identity" } }
  }
}
```

When caller `user:42` queries the view, the service resolves `caller_identity` to `42` and injects `WHERE customer_id = 42`. The caller cannot bypass the predicate — it's applied transparently by the service.

### How RLS Composes

Security predicates compose with the caller's own filters and with business rules:

```sql
-- Caller queries: SELECT * FROM my_orders WHERE total > 100
-- Service expands to:
SELECT ... FROM orders
WHERE customer_id = 42              -- security predicate (injected)
  AND order_status != 'cancelled'   -- business rule (hard_enforced)
  AND total > 100                   -- caller's filter
```

### Variable Persistence

Variable definitions and mapping tables are persisted in the DAS internal PostgreSQL database (when `PG_HOST` is configured). Without PG, they exist in memory only and are lost on restart.

## Ontology

### What Is the Ontology?

The ontology (Layer 3) maps business concepts to database structures. It bridges the gap between natural language ("revenue", "Premium customers") and SQL objects (tables, columns, joins). AI agents use the ontology to resolve ambiguous terms and discover the correct database objects for a given business concept.

### Key Components

| Component | Description | Example |
|-----------|-------------|---------|
| **Domain** | A business area grouping related entities | `sales`, `customer`, `marketing` |
| **Entity Type** | A business concept with context clues for resolution | `Customer` (clues: "buyer", "account", "shopper") |
| **Concept** | A derived or composite business idea | `Revenue` — depends on Order entity, amount role |
| **Relationship** | How entity types connect, with join hints | Customer → Order (1:N, `customers.customer_id = orders.customer_id`) |
| **Column Mapping** | Maps entity types to specific database columns with roles | Customer.name → `customers.first_name` (role: `name`, is_primary: true) |
| **Exclusion** | Prevents incorrect entity resolution | "Product Supplier" excludes "Customer" (different business meaning) |

### Column Mapping Roles

Each column mapping has a role that describes how the column relates to its entity type:

| Role | Description | Example |
|------|-------------|---------|
| `id` | Primary identifier | `customers.customer_id` |
| `name` | Display name | `customers.first_name` |
| `amount` | Numeric measure | `orders.total_amount` |
| `date` | Temporal reference | `orders.order_date` |
| `category` | Categorical grouping | `customers.customer_segment` |
| `flag` | Boolean/status indicator | `products.is_active` |

### Entity Resolution

When an AI agent encounters a term like "revenue" or "Premium customers", it calls `ResolveEntity` to find matching entity types. The service scores candidates by matching context clues and returns a confidence-ranked list. If the result is ambiguous, the service provides a disambiguation prompt.

### Cross-Database Column Mappings

Column mappings can span multiple connections, enabling the ontology to describe entities that exist across different databases. The `GetEntityColumns` response includes `cross_db_mappings` that show how the same entity is represented in different systems.

## Process Models

### What Are Process Models?

Process models (Layer 4) encode business process knowledge — rules, calendar definitions, step sequences, and tribal knowledge. This context helps AI agents generate queries that respect business logic that isn't captured in the database schema.

### Key Components

| Component | Description | Example |
|-----------|-------------|---------|
| **Process** | A named business workflow with steps | "Order Fulfillment" — 5 steps from order placed to delivered |
| **Step** | A single step in a process with data touchpoints | "Ship Order" — reads `orders`, writes `shipping_performance` |
| **Business Rule** | An enforceable constraint on queries | "Exclude cancelled orders from revenue" (hard_enforced) |
| **Annotation** | Context-triggered tribal knowledge | "December financials are provisional until monthly close" |
| **Calendar Context** | Fiscal calendar definition | Q1 = Oct-Dec, fiscal year starts October 1 |

### Business Rule Enforcement

| Level | Meaning | Agent Behavior |
|-------|---------|----------------|
| `ADVISORY` | Suggestion only | Agent may choose to follow or ignore |
| `SOFT_ENFORCED` | Should follow | Agent follows by default, can override with justification |
| `HARD_ENFORCED` | Must follow | Agent always applies this rule, no override |

Rules include executable conditions (AST predicates) that the agent can inject into queries automatically.

### Calendar Context

Calendar definitions tell AI agents how to interpret time-based business terms:

- "This quarter" → Fiscal Q4 = October 1 through December 31 (not calendar Q4)
- "FY25" → October 2024 through September 2025
- Quarter boundaries defined by `quarter_mapping` with start/end months

### Process Discovery

AI agents call `GetProcessContext` to learn about business processes, rules, and calendar definitions for a domain. This is typically done at the start of a data analysis session, alongside dictionary and ontology queries, to build a complete understanding of the business context.

## Named Entity Resolution (NER)

### What Is NER?

Named Entity Resolution bridges the gap between user terms and actual database values. While the ontology resolves entity *types* (is "Chase" a Vendor, Customer, or Bank?), NER resolves entity *values* (matching "Microsoft" to the database row "MICROSOFT CORP" despite spelling differences).

### Value Stores

A value store is a searchable index of canonical values from a source database. Each value store consists of:
- A **value table** with full rows from the source database, stored in a system SQLite scratch pad
- A **search table** with all matchable terms, linked back to value rows via rowid
- An **FTS5 index** for fast candidate retrieval

Value store configs (name, source query, match columns) are persisted in PostgreSQL. The actual data values never go to PostgreSQL — they live exclusively in SQLite scratch pads.

### Fuzzy Matching

The matching engine uses six strategies implemented as SQLite custom functions: prefix matching, Levenshtein edit distance, initials comparison, reverse initials (acronym detection), word-level Jaccard similarity, and phonetic matching. A composite score (`ff_match_score`) combines all strategies with configurable weights.

Matching uses a two-pass approach: FTS5 pre-filtering narrows to ~100 candidates, then custom scoring functions rank them. This avoids full table scans on large value sets.

### Personalized Scopes

Each search entry has a `scope` controlling its visibility:
1. `user:<identity>` — personal synonyms for one user
2. `team:<name>` — shared within a team
3. `system` — universal synonyms (admin-managed or auto-promoted)
4. `primary` — from source data (rebuilt on refresh)

The caller's identity (from `X-On-Behalf-Of`) determines which scopes are visible during resolution. Learned synonyms (user, team, system scopes) survive value store refreshes — only primary scope entries are rebuilt.

### Learning Loop

When an agent confirms a match, a new entry is added to the search table with the caller's scope. After N distinct users confirm the same term-to-value mapping, it auto-promotes to system scope. This creates a feedback loop where the system gets smarter with use.

## Security Model

- **No inline credentials**: Admin API rejects connections with inline passwords
- **Function blacklisting**: 17+ dangerous functions blocked by default
- **Identifier validation**: All AST identifiers must match `^[a-zA-Z_][a-zA-Z0-9_]*$`
- **AST depth limits**: Maximum 32 nesting levels and 1000 expression nodes
- **Column-level ACL**: Restricted columns caught in all SQL positions
- **Audit trail**: All operations logged with caller identity
- **View cycle detection**: Prevents infinite expansion loops
- **Staged query limits**: Row count, byte size, and query count caps
