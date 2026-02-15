# Data Access Service — Getting Started

This tutorial walks through the Data Access Service from first connection to cross-database federation. Examples use `curl` (REST gateway) and `grpcurl` (gRPC). The service exposes both interfaces on the same deployment.

## Prerequisites

- Data Access Service running (gRPC on `:50051`, HTTP on `:8080`)
- API key (default: `dev-api-key` for local development)
- At least one database connection configured

Set up shell variables:

```bash
export DA_HOST=localhost:8080        # REST gateway
export DA_GRPC=localhost:50051       # gRPC
export API_KEY=dev-api-key
export IDENTITY=user:tutorial
```

## 1. List Connections

See what databases are available:

```bash
curl -s "$DA_HOST/v1/connections" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" | jq
```

Response:
```json
{
  "connections": [
    { "name": "warehouse", "description": "Production data warehouse", "type": "postgresql" },
    { "name": "analytics", "description": "Analytics SQLite", "type": "sqlite" }
  ]
}
```

Only connections the caller is authorized to access are returned.

## 2. Get Schema

Inspect tables and columns for a connection:

```bash
curl -s "$DA_HOST/v1/connections/warehouse/schema" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" | jq '.tables[] | {name, columns: [.columns[].name]}'
```

Get a specific table's schema:

```bash
curl -s "$DA_HOST/v1/connections/warehouse/schema?table=customers" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" | jq
```

## 3. Raw SQL Query

Execute a raw SQL SELECT:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/query" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT id, name, city FROM customers WHERE city = $1 LIMIT 5",
    "params": ["New York"]
  }' | jq
```

Response:
```json
{
  "columns": [
    { "name": "id", "type": "integer", "normalizedType": "integer" },
    { "name": "name", "type": "varchar", "normalizedType": "text" },
    { "name": "city", "type": "varchar", "normalizedType": "text" }
  ],
  "rows": [
    { "fields": { "id": 1, "name": "Alice", "city": "New York" } },
    { "fields": { "id": 3, "name": "Charlie", "city": "New York" } }
  ],
  "rowCount": 2,
  "durationMs": 5
}
```

## 4. AST Query — Simple SELECT

The same query as structured AST:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "id" } } },
        { "expr": { "column": { "column": "name" } } },
        { "expr": { "column": { "column": "city" } } }
      ],
      "from": { "table": { "table": "customers" } },
      "where": {
        "binary": {
          "op": "BINARY_OP_EQ",
          "left": { "column": { "column": "city" } },
          "right": { "param": { "position": 1 } }
        }
      },
      "limit": 5
    },
    "params": ["New York"]
  }' | jq
```

The service serializes the AST with the correct identifier quoting and parameter placeholders for the target database (PostgreSQL uses `$1`, MySQL uses `?`, SQLite uses `?`). SQL constructs like functions and operators are passed through to the upstream database as-is.

## 5. AST Query — JOIN and Aggregation

Query with a JOIN, GROUP BY, and ORDER BY:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "table": "c", "column": "city" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "order_count" },
        { "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "o", "column": "amount" } }] } }, "alias": "total_amount" }
      ],
      "from": { "table": { "table": "customers", "alias": "c" } },
      "joins": [
        {
          "type": "JOIN_INNER",
          "table": { "table": "orders", "alias": "o" },
          "on": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "c", "column": "id" } },
              "right": { "column": { "table": "o", "column": "customer_id" } }
            }
          }
        }
      ],
      "groupBy": [{ "expr": { "column": { "table": "c", "column": "city" } } }],
      "orderBy": [{ "expr": { "column": { "column": "total_amount" } }, "dir": "SORT_DESC" }],
      "limit": 10
    }
  }' | jq
```

## 6. Preview SQL with TranslateAST

See the generated SQL without executing:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/translate-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{ "expr": { "star": {} } }],
      "from": { "table": { "table": "customers" } },
      "where": {
        "binary": {
          "op": "BINARY_OP_GT",
          "left": { "column": { "column": "age" } },
          "right": { "literal": { "numberValue": 30 } }
        }
      }
    }
  }' | jq
```

Response:
```json
{
  "sql": "SELECT * FROM \"customers\" WHERE \"age\" > 30",
  "dialect": "postgresql"
}
```

## 7. Staged Query — Cross-Database Federation

Fetch data from PostgreSQL, then use it in a SQLite query:

```bash
curl -s -X POST "$DA_HOST/v1/connections/analytics/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "stagedQueries": [
      {
        "alias": "pg_customers",
        "connection": "warehouse",
        "query": {
          "columns": [
            { "expr": { "column": { "column": "id" } } },
            { "expr": { "column": { "column": "name" } } },
            { "expr": { "column": { "column": "city" } } }
          ],
          "from": { "table": { "table": "customers" } },
          "where": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "column": "city" } },
              "right": { "literal": { "stringValue": "New York" } }
            }
          }
        }
      }
    ],
    "select": {
      "columns": [{ "expr": { "star": {} } }],
      "from": { "table": { "table": "pg_customers" } }
    }
  }' | jq
```

The staged query runs against `warehouse` (PostgreSQL), and its results are injected as a VALUES CTE into the main query running on `analytics` (SQLite).

The response includes `stagedStats`:
```json
{
  "stagedStats": {
    "stagedQueryCount": 1,
    "totalStagedRows": 2,
    "totalStagedBytes": 156,
    "totalStagedDurationMs": 8,
    "details": [
      {
        "alias": "pg_customers",
        "connection": "warehouse",
        "tier": 0,
        "rowCount": 2,
        "byteSize": 156,
        "durationMs": 8
      }
    ]
  },
  "columns": [...],
  "rows": [...]
}
```

## 8. Save Results to Scratch Pad

Save query results for later use:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "saveAs": "top_customers",
    "select": {
      "columns": [
        { "expr": { "column": { "column": "id" } } },
        { "expr": { "column": { "column": "name" } } },
        { "expr": { "column": { "column": "city" } } }
      ],
      "from": { "table": { "table": "customers" } },
      "orderBy": [{ "expr": { "column": { "column": "name" } }, "dir": "SORT_ASC" }],
      "limit": 100
    }
  }' | jq
```

Response includes:
```json
{
  "savedAs": "top_customers",
  "rowCount": 100,
  ...
}
```

## 9. Query Saved Results

Query the scratch pad connection:

```bash
curl -s -X POST "$DA_HOST/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "city" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "cnt" }
      ],
      "from": { "table": { "table": "top_customers" } },
      "groupBy": [{ "expr": { "column": { "column": "city" } } }],
      "orderBy": [{ "expr": { "column": { "column": "cnt" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

The scratch pad connection name is `scratch:<identity>`. You can query any table that was previously saved by the same identity.

## 10. Discover Stored Views in Schema

Stored views appear in schema responses alongside real tables:

```bash
curl -s "$DA_HOST/v1/connections/warehouse/schema" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" | jq '.tables[] | select(.type == "stored_view")'
```

Response:
```json
{
  "name": "active_customers",
  "type": "stored_view",
  "columns": [
    { "name": "id", "type": "INTEGER", "normalizedType": "INTEGER", "nullable": true },
    { "name": "name", "type": "VARCHAR", "normalizedType": "VARCHAR", "nullable": true }
  ]
}
```

Stored views are created via the Admin API and auto-probed for column types. Query them like any table:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{ "expr": { "star": {} } }],
      "from": { "table": { "table": "active_customers" } }
    }
  }' | jq
```

## 11. Build a Data Dictionary

The data dictionary adds semantic meaning to your database schema. This section walks through creating annotations that help AI agents understand your data.

### Create a Table Annotation

```bash
curl -s -X POST "$DA_HOST/admin/annotations/tables" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "warehouse",
    "schema": "public",
    "table": "orders",
    "description": "Customer orders with shipping and payment details. Each row represents one order.",
    "businessName": "Customer Orders",
    "grain": "One row per order",
    "tags": ["transactional", "sales", "financial"],
    "statistics": { "rowCount": 131072, "avgRowSizeBytes": 256 },
    "relationships": [
      {
        "targetTable": "customers",
        "joinColumn": "customer_id",
        "targetColumn": "customer_id",
        "type": "many-to-one",
        "description": "Each order belongs to one customer"
      }
    ],
    "qualityNotes": { "completeness": "All required fields populated", "freshness": "Updated daily" },
    "usageNotes": "Primary table for order analysis. Use order_date for date filtering, NOT created_at."
  }'
```

### Create Column Annotations

```bash
curl -s -X POST "$DA_HOST/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "warehouse",
    "schema": "public",
    "table": "orders",
    "column": "status",
    "description": "Current order fulfillment status",
    "businessName": "Order Status",
    "semanticType": "dimension",
    "dataClassification": "public",
    "tags": ["transactional", "sales"],
    "sampleValues": ["pending", "shipped", "delivered"],
    "statistics": { "distinctCount": 5, "nullCount": 0 },
    "valuePattern": "Lowercase single-word status string",
    "constraints": { "type": "enum", "values": ["pending", "processing", "shipped", "delivered", "cancelled"] },
    "usageNotes": "Use for order pipeline analysis. Filter to shipped+delivered for revenue reports."
  }'
```

### Bulk Import Annotations

For larger datasets, use the bulk import endpoint with a JSON file:

```bash
curl -s -X POST "$DA_HOST/admin/annotations/import" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @annotations.json
```

The JSON file contains both table and column annotations:

```json
{
  "tables": [
    {
      "connection": "warehouse",
      "schema": "public",
      "table": "orders",
      "description": "Customer orders...",
      "tags": ["transactional", "sales"]
    }
  ],
  "columns": [
    {
      "connection": "warehouse",
      "schema": "public",
      "table": "orders",
      "column": "status",
      "description": "Order fulfillment status",
      "semanticType": "dimension",
      "constraints": { "type": "enum", "values": ["pending", "shipped", "delivered"] }
    }
  ]
}
```

### Query the Data Dictionary

Once annotations are created, query them using the non-admin dictionary API:

```bash
# All annotated tables for a connection
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/tables?connection=warehouse" | jq '.tables[] | {table, businessName, grain, tags}'
```

### Filter by Tags

Tags control what AI agents see. Tag dirty upstream tables as `raw` and curated views as `curated`:

```bash
# Only curated tables (what AI should see)
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/tables?connection=warehouse&tags=curated"

# Exclude raw and system tables
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/tables?connection=warehouse&excludeTags=raw,system"

# Financial columns, excluding PII
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/columns?connection=warehouse&tags=financial&excludeTags=pii"
```

### Filter by Semantic Type and Classification

Column queries support additional filters:

```bash
# All measure columns (numeric values for aggregation)
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/columns?connection=warehouse&semanticType=measure"

# All PII columns (for compliance review)
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/columns?connection=warehouse&dataClassification=pii"

# Columns for a specific table
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_HOST/v1/dictionary/columns?connection=warehouse&table=orders"
```

### Tag Taxonomy Best Practices

Design your tag taxonomy to support AI routing:

1. **Domain tags**: `sales`, `marketing`, `finance`, `hr`, `operations`
2. **Data maturity tags**: `raw`, `staged`, `curated`, `certified`
3. **Sensitivity tags**: `pii`, `financial`, `confidential`
4. **Usage tags**: `reporting`, `analytics`, `reference`, `transactional`

The key pattern: AI agents query with `excludeTags=raw,system` to see only production-ready data. Data stewards tag new tables as `raw` until they're validated, then add `curated`.

## 12. EXPLAIN Query Plans

Preview the execution plan for any AST query without running it:

```bash
curl -s -X POST "$DA_HOST/v1/connections/warehouse/explain-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "city" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "cnt" }
      ],
      "from": { "table": { "table": "customers" } },
      "groupBy": [{ "expr": { "column": { "column": "city" } } }],
      "orderBy": [{ "expr": { "column": { "column": "cnt" } }, "dir": "SORT_DESC" }],
      "limit": 10
    },
    "analyze": false,
    "verbose": false
  }' | jq
```

Response:
```json
{
  "planLines": [
    "Limit  (cost=150.00..150.03 rows=10 width=40)",
    "  ->  Sort  (cost=150.00..155.00 rows=2000 width=40)",
    "        Sort Key: (count(*)) DESC",
    "        ->  HashAggregate  (cost=100.00..120.00 rows=2000 width=40)",
    "              Group Key: city",
    "              ->  Seq Scan on customers  (cost=0.00..50.00 rows=10000 width=32)"
  ],
  "sql": "SELECT \"city\", COUNT(*) AS \"cnt\" FROM \"customers\" GROUP BY \"city\" ORDER BY \"cnt\" DESC LIMIT 10",
  "durationMs": 2
}
```

Set `analyze: true` to execute the query and get actual timing statistics in the plan.

For SQL-based explain, use `/v1/connections/{conn}/explain-sql` with a `sql` field instead of `select`.

## 13. Set Up Variables for Row-Level Security

Variables enable row-level security (RLS) by resolving caller identity into database filter values at query time.

### Create a Mapping Table

Map email identities to customer IDs:

```bash
curl -s -X POST "$DA_HOST/admin/mappings" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "email_to_customer",
    "description": "Maps email addresses to customer IDs",
    "keyColumn": "email",
    "valueColumn": "customer_id",
    "entries": [
      { "key": "alice@example.com", "value": "42" },
      { "key": "bob@example.com", "value": "99" }
    ]
  }'
```

### Create a Lookup Variable

```bash
curl -s -X POST "$DA_HOST/admin/variables" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "customer_id",
    "description": "Resolves caller email to numeric customer ID",
    "resolution": "lookup",
    "lookupTable": "email_to_customer",
    "lookupKey": "email",
    "lookupValue": "customer_id"
  }'
```

### Create a View with Security Predicate

```bash
curl -s -X POST "$DA_HOST/admin/views" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my_orders",
    "namespace": "system",
    "connection": "warehouse",
    "description": "Orders filtered by caller identity",
    "ast": {
      "columns": [
        { "expr": { "column": { "column": "id" } } },
        { "expr": { "column": { "column": "amount" } } },
        { "expr": { "column": { "column": "status" } } }
      ],
      "from": { "table": { "table": "orders" } }
    },
    "securityPredicate": {
      "binary": {
        "op": "BINARY_OP_EQ",
        "left": { "column": { "column": "customer_id" } },
        "right": { "variable": { "name": "customer_id" } }
      }
    }
  }'
```

Now when `alice@example.com` queries `my_orders`, they only see orders where `customer_id = 42`. The security predicate is injected transparently — the caller cannot bypass it.

### Test Variable Resolution

```bash
curl -s -X POST "$DA_HOST/admin/variables/resolve" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"variable": "customer_id", "identity": "alice@example.com", "connection": "warehouse"}'
```

## Next Steps

- Read [Concepts](./concepts.md) for deeper understanding of the data dictionary, ACL, staged queries, stored definitions, variables/RLS, ontology, and process models
- Read [Reference](./reference.md) for the full API specification including all admin, ontology, and process model endpoints
- Follow the [FireKicks Tutorial](./firekicks/) for a comprehensive end-to-end walkthrough using a real dataset
- Install the AI skills to enable AI agents to generate AST queries automatically
