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

The same query as structured AST (database-agnostic):

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

The service generates the correct SQL for the target database (PostgreSQL uses `$1`, MySQL uses `?`, SQLite uses `?`).

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

## Next Steps

- Read [Concepts](./concepts.md) for deeper understanding of ACL, staged queries, and stored definitions
- Read [Reference](./reference.md) for the full API specification, proto messages, and configuration options
- Install the AI skills to enable AI agents to generate AST queries automatically
