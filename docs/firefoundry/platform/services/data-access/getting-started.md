# Data Access Service — Getting Started

This tutorial walks through the Data Access Service from first connection to cross-database federation using the `ff-da` CLI tool.

## Prerequisites

- Data Access Service deployed and accessible
- API key for authentication
- At least one database connection configured
- The `ff-da` CLI tool installed

### Install the CLI

```bash
go install github.com/firebrandanalytics/ff-services-data-access/cmd/ff-da@latest
```

### Configure

Set environment variables so you don't need to pass flags on every command:

```bash
export DA_BASE_URL=https://your-gateway.example.com/das   # Gateway URL
export DA_API_KEY=your-api-key                             # API key
export DA_IDENTITY=user:tutorial                           # Caller identity
```

Or pass them as flags: `ff-da --base-url ... --api-key ... --identity ...`

Verify connectivity:

```bash
ff-da health
```

## 1. List Connections

See what databases are available:

```bash
ff-da connections
```

Output:
```
NAME         TYPE          DESCRIPTION                    OPERATIONS
----         ----          -----------                    ----------
warehouse    postgresql    Production data warehouse      query,execute,schema
analytics    sqlite        Analytics SQLite               query,schema
```

Only connections the caller is authorized to access are returned. Use `--format json` for machine-readable output.

## 2. Get Schema

Inspect tables and columns for a connection:

```bash
ff-da schema --connection warehouse
```

Get a specific table's schema:

```bash
ff-da schema --connection warehouse --table customers
```

Output:
```
Connection: warehouse (postgresql)

  customers [table] (rows: 10000)
  COLUMN      TYPE       NULLABLE  PK
  ------      ----       --------  --
  id          integer    NO        PK
  name        varchar    NO
  city        varchar    YES
  age         integer    YES
```

## 3. Raw SQL Query

Execute a raw SQL SELECT:

```bash
ff-da query -c warehouse -s "SELECT id, name, city FROM customers WHERE city = 'New York' LIMIT 5"
```

Output:
```
id  name     city
--  ----     ----
1   Alice    New York
3   Charlie  New York

(2 rows, 5ms, query_id: abc123)
```

Use `--format json` to get the full response with column metadata:

```json
{
  "columns": [
    { "name": "id", "type": "integer", "normalizedType": "integer" },
    { "name": "name", "type": "varchar", "normalizedType": "text" },
    { "name": "city", "type": "varchar", "normalizedType": "text" }
  ],
  "rows": [
    { "id": 1, "name": "Alice", "city": "New York" },
    { "id": 3, "name": "Charlie", "city": "New York" }
  ],
  "row_count": 2,
  "duration_ms": 5
}
```

## 4. AST Query — Simple SELECT

The same query as a structured AST. Save the following as `simple_query.json`:

```json
{
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
}
```

Execute it:

```bash
ff-da query-ast -c warehouse -f simple_query.json
```

The service serializes the AST with the correct identifier quoting and parameter placeholders for the target database (PostgreSQL uses `$1`, MySQL uses `?`, SQLite uses `?`). SQL constructs like functions and operators are passed through to the upstream database as-is.

You can also pipe JSON directly:

```bash
echo '{"select":{"columns":[{"expr":{"star":{}}}],"from":{"table":{"table":"customers"}},"limit":5}}' \
  | ff-da query-ast -c warehouse
```

## 5. AST Query — JOIN and Aggregation

Save the following as `join_agg.json`:

```json
{
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
}
```

Execute:

```bash
ff-da query-ast -c warehouse -f join_agg.json
```

## 6. Preview SQL with TranslateAST

See the generated SQL without executing. Save the following as `translate_query.json`:

```json
{
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
}
```

```bash
ff-da translate -c warehouse -f translate_query.json
```

Output:
```
Dialect: postgresql
SQL:
  SELECT * FROM "customers" WHERE "age" > 30
```

## 7. Staged Query — Cross-Database Federation

Fetch data from PostgreSQL, then use it in a SQLite query. Save as `staged_query.json`:

```json
{
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
}
```

```bash
ff-da query-ast -c analytics -f staged_query.json --format json
```

The staged query runs against `warehouse` (PostgreSQL), and its results are injected as a VALUES CTE into the main query running on `analytics` (SQLite).

The JSON response includes `stagedStats`:
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

Save query results for later use. Save as `save_query.json`:

```json
{
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
}
```

```bash
ff-da query-ast -c warehouse --save-as top_customers -f save_query.json
```

Output includes a save confirmation:
```
id  name     city
--  ----     ----
...

(100 rows, 12ms, query_id: def456)

Saved as: top_customers
```

## 9. Query Saved Results

Query the scratch pad connection:

Save as `scratch_query.json`:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "city" } } },
      { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "cnt" }
    ],
    "from": { "table": { "table": "top_customers" } },
    "groupBy": [{ "expr": { "column": { "column": "city" } } }],
    "orderBy": [{ "expr": { "column": { "column": "cnt" } }, "dir": "SORT_DESC" }]
  }
}
```

```bash
ff-da query-ast -c "scratch:user:tutorial" -f scratch_query.json
```

The scratch pad connection name is `scratch:<identity>`. You can query any table that was previously saved by the same identity.

## 10. Discover Stored Views in Schema

Stored views appear in schema responses alongside real tables:

```bash
ff-da schema -c warehouse --format json | jq '.tables[] | select(.type == "stored_view")'
```

Response:
```json
{
  "name": "active_customers",
  "type": "stored_view",
  "columns": [
    { "name": "id", "type": "INTEGER", "normalized": "INTEGER", "nullable": true },
    { "name": "name", "type": "VARCHAR", "normalized": "VARCHAR", "nullable": true }
  ]
}
```

Stored views are created via the Admin API and auto-probed for column types. Query them like any table:

```bash
echo '{"select":{"columns":[{"expr":{"star":{}}}],"from":{"table":{"table":"active_customers"}}}}' \
  | ff-da query-ast -c warehouse
```

## 11. Build a Data Dictionary

The data dictionary adds semantic meaning to your database schema. This section walks through creating annotations that help AI agents understand your data.

### Create a Table Annotation

Save as `table_annotation.json`:

```json
{
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
}
```

```bash
ff-da admin annotations create-table -f table_annotation.json
```

### Create Column Annotations

Save as `column_annotation.json`:

```json
{
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
}
```

```bash
ff-da admin annotations create-column -f column_annotation.json
```

### Bulk Import Annotations

For larger datasets, use the bulk import command with a JSON file:

```bash
ff-da admin annotations import -f annotations.json
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

Once annotations are created, query them using the dictionary commands:

```bash
# All annotated tables for a connection
ff-da dictionary tables --connection warehouse
```

Output:
```
TABLE      BUSINESS NAME      GRAIN                TAGS
-----      -------------      -----                ----
orders     Customer Orders    One row per order     transactional,sales,financial
customers  Customer Master    One row per customer  master,sales

Total: 2 tables
```

### Filter by Tags

Tags control what AI agents see. Tag dirty upstream tables as `raw` and curated views as `curated`:

```bash
# Only curated tables (what AI should see)
ff-da dictionary tables --connection warehouse --tags curated

# Exclude raw and system tables
ff-da dictionary tables --connection warehouse --exclude-tags raw,system

# Financial columns, excluding PII
ff-da dictionary columns --connection warehouse --tags financial --exclude-tags pii
```

### Filter by Semantic Type and Classification

Column queries support additional filters:

```bash
# All measure columns (numeric values for aggregation)
ff-da dictionary columns --connection warehouse --semantic-type measure

# All PII columns (for compliance review)
ff-da dictionary columns --connection warehouse --data-classification pii

# Columns for a specific table
ff-da dictionary columns --connection warehouse --table orders
```

### Tag Taxonomy Best Practices

Design your tag taxonomy to support AI routing:

1. **Domain tags**: `sales`, `marketing`, `finance`, `hr`, `operations`
2. **Data maturity tags**: `raw`, `staged`, `curated`, `certified`
3. **Sensitivity tags**: `pii`, `financial`, `confidential`
4. **Usage tags**: `reporting`, `analytics`, `reference`, `transactional`

The key pattern: AI agents query with `--exclude-tags raw,system` to see only production-ready data. Data stewards tag new tables as `raw` until they're validated, then add `curated`.

## 12. EXPLAIN Query Plans

Preview the execution plan for any AST query without running it. Save as `explain_query.json`:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "city" } } },
      { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "cnt" }
    ],
    "from": { "table": { "table": "customers" } },
    "groupBy": [{ "expr": { "column": { "column": "city" } } }],
    "orderBy": [{ "expr": { "column": { "column": "cnt" } }, "dir": "SORT_DESC" }],
    "limit": 10
  }
}
```

```bash
ff-da explain ast -c warehouse -f explain_query.json
```

Output:
```
SQL: SELECT "city", COUNT(*) AS "cnt" FROM "customers" GROUP BY "city" ORDER BY "cnt" DESC LIMIT 10

Plan:
  Limit  (cost=150.00..150.03 rows=10 width=40)
    ->  Sort  (cost=150.00..155.00 rows=2000 width=40)
          Sort Key: (count(*)) DESC
          ->  HashAggregate  (cost=100.00..120.00 rows=2000 width=40)
                Group Key: city
                ->  Seq Scan on customers  (cost=0.00..50.00 rows=10000 width=32)

(2ms, query_id: ghi789)
```

Add `--analyze` to execute the query and get actual timing statistics in the plan.

For SQL-based explain:

```bash
ff-da explain sql -c warehouse -s "SELECT city, COUNT(*) FROM customers GROUP BY city"
```

## 13. Set Up Variables for Row-Level Security

Variables enable row-level security (RLS) by resolving caller identity into database filter values at query time.

### Create a Mapping Table

Map email identities to customer IDs. Save as `mapping.json`:

```json
{
  "name": "email_to_customer",
  "description": "Maps email addresses to customer IDs",
  "keyColumn": "email",
  "valueColumn": "customer_id",
  "entries": [
    { "key": "alice@example.com", "value": "42" },
    { "key": "bob@example.com", "value": "99" }
  ]
}
```

```bash
ff-da admin mappings create -f mapping.json
```

### Create a Lookup Variable

Save as `variable.json`:

```json
{
  "name": "customer_id",
  "description": "Resolves caller email to numeric customer ID",
  "resolution": "lookup",
  "lookupTable": "email_to_customer",
  "lookupKey": "email",
  "lookupValue": "customer_id"
}
```

```bash
ff-da admin variables create -f variable.json
```

### Create a View with Security Predicate

Save as `secure_view.json`:

```json
{
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
}
```

```bash
ff-da admin views create -f secure_view.json
```

Now when `alice@example.com` queries `my_orders`, they only see orders where `customer_id = 42`. The security predicate is injected transparently — the caller cannot bypass it.

### Test Variable Resolution

```bash
ff-da admin variables resolve --name customer_id --identity alice@example.com --connection warehouse
```

## Next Steps

- Read [Concepts](./concepts.md) for deeper understanding of the data dictionary, ACL, staged queries, stored definitions, variables/RLS, ontology, process models, and NER
- Read [Reference](./reference.md) for the full API specification including all admin, ontology, process model, NER, and CSV upload endpoints
- Follow the [FireKicks Tutorial](./firekicks/) for a comprehensive end-to-end walkthrough using a real dataset, including NER value resolution and CSV upload
- Install the AI skills to enable AI agents to generate AST queries automatically
- Run `ff-da --help` to see all available commands and `ff-da <command> --help` for detailed usage
