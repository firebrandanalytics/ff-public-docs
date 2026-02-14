# Part 5: Querying & Analysis

This part brings all five layers together — schema, dictionary, stored definitions, ontology, and process models — through hands-on querying of the FireKicks dataset. You'll work through raw SQL, structured AST queries, the scratch pad for intermediate results, and a complete context-aware analysis workflow.

## Raw SQL Queries

The simplest way to query is raw SQL via `ff-da`:

```bash
ff-da query --connection firekicks --sql "
  SELECT order_channel, COUNT(*) as orders,
         ROUND(SUM(total_amount)::numeric, 2) as revenue
  FROM orders
  WHERE order_status IN ('shipped', 'delivered')
  GROUP BY order_channel
  ORDER BY revenue DESC"
```

### Parameterized Queries

Use positional parameters (`$1`, `$2`) to avoid SQL injection:

```bash
ff-da query --connection firekicks --sql "
  SELECT product_name, category, base_price
  FROM products
  WHERE category = \$1 AND base_price > \$2
  ORDER BY base_price DESC" \
  --params '["running", 100]'
```

> **Note:** Parameter placeholders are database-specific. PostgreSQL uses `$1`, `$2`. MySQL and SQLite use `?`. The AST API handles this automatically.

### When to Use Raw SQL

Raw SQL is appropriate for:
- **Ad-hoc exploration** — Quick questions during development
- **Known schema** — You already know the tables and columns
- **Admin tasks** — DDL operations, data fixes
- **Complex queries** — Window functions, recursive CTEs, or PostgreSQL-specific syntax that the AST doesn't model

Raw SQL requires `allow_raw_sql: true` on both the connection config and the caller's ACL entry. AI agents in production typically use AST queries instead.

## AST Queries

The AST (Abstract Syntax Tree) API accepts structured JSON instead of raw SQL. The service validates the query, checks ACL, expands stored definitions, and serializes to SQL for the target database.

> **Note:** The AST examples below use the HTTP data-plane API directly with `curl` to show the raw protocol. Set up these variables for the examples:
> ```bash
> export DA_URL=http://localhost:8080
> export API_KEY=dev-api-key
> export IDENTITY=user:tutorial
> ```

### Simple SELECT

```bash
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "customer_segment" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "customers" },
        { "expr": { "function": { "name": "round", "args": [
          { "function": { "name": "avg", "args": [{ "column": { "column": "lifetime_value" } }] } },
          { "literal": { "numberValue": 2 } }
        ] } }, "alias": "avg_ltv" }
      ],
      "from": { "table": { "table": "customers" } },
      "groupBy": [{ "expr": { "column": { "column": "customer_segment" } } }],
      "orderBy": [{ "expr": { "column": { "column": "avg_ltv" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

### JOIN and Aggregation

Query product performance by joining orders and order items:

```bash
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "table": "p", "column": "category" } } },
        { "expr": { "function": { "name": "count", "distinct": true, "args": [{ "column": { "table": "o", "column": "order_id" } }] } }, "alias": "orders" },
        { "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "oi", "column": "quantity" } }] } }, "alias": "units_sold" },
        {
          "expr": { "function": { "name": "round", "args": [
            { "cast": { "expr": { "function": { "name": "sum", "args": [{
              "binary": { "op": "BINARY_OP_MUL",
                "left": { "column": { "table": "oi", "column": "quantity" } },
                "right": { "column": { "table": "oi", "column": "unit_price" } }
              }
            }] } }, "typeName": "numeric" } },
            { "literal": { "numberValue": 2 } }
          ] } },
          "alias": "revenue"
        }
      ],
      "from": { "table": { "table": "products", "alias": "p" } },
      "joins": [
        {
          "type": "JOIN_INNER",
          "table": { "table": "order_items", "alias": "oi" },
          "on": { "binary": { "op": "BINARY_OP_EQ",
            "left": { "column": { "table": "p", "column": "product_id" } },
            "right": { "column": { "table": "oi", "column": "product_id" } }
          } }
        },
        {
          "type": "JOIN_INNER",
          "table": { "table": "orders", "alias": "o" },
          "on": { "and": { "exprs": [
            { "binary": { "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "oi", "column": "order_id" } },
              "right": { "column": { "table": "o", "column": "order_id" } }
            } },
            { "in": {
              "expr": { "column": { "table": "o", "column": "order_status" } },
              "values": [
                { "literal": { "stringValue": "shipped" } },
                { "literal": { "stringValue": "delivered" } }
              ]
            } }
          ] } }
        }
      ],
      "groupBy": [{ "expr": { "column": { "table": "p", "column": "category" } } }],
      "orderBy": [{ "expr": { "column": { "column": "revenue" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

### Querying Stored Views

Stored definitions (from [Part 2](./02-stored-definitions.md)) are queried like regular tables:

```bash
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "product_name" } } },
        { "expr": { "column": { "column": "category" } } },
        { "expr": { "column": { "column": "total_revenue" } } },
        { "expr": { "column": { "column": "avg_rating" } } }
      ],
      "from": { "table": { "table": "product_performance" } },
      "orderBy": [{ "expr": { "column": { "column": "total_revenue" } }, "dir": "SORT_DESC" }],
      "limit": 10
    }
  }' | jq
```

The service recognizes `product_performance` as a stored view, expands its AST definition, and runs the resulting query. The caller doesn't need to know whether it's a real table or a stored definition.

### Preview SQL with TranslateAST

See the generated SQL without executing:

```bash
curl -s -X POST "$DA_URL/v1/connections/firekicks/translate-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{ "expr": { "star": {} } }],
      "from": { "table": { "table": "product_performance" } },
      "where": {
        "binary": {
          "op": "BINARY_OP_GT",
          "left": { "column": { "column": "total_revenue" } },
          "right": { "literal": { "numberValue": 10000 } }
        }
      }
    }
  }' | jq
```

Response:
```json
{
  "sql": "SELECT * FROM (SELECT p.\"product_id\", p.\"product_name\", ...) AS \"product_performance\" WHERE \"total_revenue\" > 10000",
  "dialect": "postgresql"
}
```

TranslateAST is useful for debugging — you can see exactly what SQL will run, including how stored views expand.

### When to Use AST vs Raw SQL

| Feature | Raw SQL | AST |
|---------|---------|-----|
| ACL enforcement | Connection-level only | Table and column-level |
| Stored view expansion | Manual | Automatic |
| SQL injection prevention | Developer responsibility | Structural guarantee |
| Parameter binding | Database-specific (`$1` vs `?`) | Consistent (`position: N`) |
| AI agent use | Requires `allow_raw_sql` | Default for agents |
| Complex syntax | Full SQL support | Covers SELECT, JOIN, GROUP, ORDER, CTE, window functions |

AI agents should use AST queries in production. Raw SQL is for admin operations and ad-hoc exploration.

## Scratch Pad

The scratch pad provides per-identity SQLite databases for persisting intermediate results. This enables multi-step analytical workflows where each step builds on previous results.

### Save Results

Add `saveAs` to any query to persist the results:

```bash
# Step 1: Save top customers by revenue
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "saveAs": "top_customers",
    "select": {
      "columns": [
        { "expr": { "column": { "column": "customer_id" } } },
        { "expr": { "column": { "column": "first_name" } } },
        { "expr": { "column": { "column": "last_name" } } },
        { "expr": { "column": { "column": "customer_segment" } } },
        { "expr": { "column": { "column": "lifetime_value" } } }
      ],
      "from": { "table": { "table": "customers" } },
      "orderBy": [{ "expr": { "column": { "column": "lifetime_value" } }, "dir": "SORT_DESC" }],
      "limit": 100
    }
  }' | jq
```

The response includes `savedAs` confirming the table name:
```json
{
  "savedAs": "top_customers",
  "rowCount": 100,
  "columns": [...],
  "rows": [...]
}
```

### Query Saved Results

Each identity gets its own scratch pad connection named `scratch:<identity>`:

```bash
# Step 2: Analyze saved results
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:tutorial" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "column": "customer_segment" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "count" },
        { "expr": { "function": { "name": "round", "args": [
          { "function": { "name": "avg", "args": [{ "column": { "column": "lifetime_value" } }] } },
          { "literal": { "numberValue": 2 } }
        ] } }, "alias": "avg_ltv" }
      ],
      "from": { "table": { "table": "top_customers" } },
      "groupBy": [{ "expr": { "column": { "column": "customer_segment" } } }],
      "orderBy": [{ "expr": { "column": { "column": "avg_ltv" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

### Multi-Step Workflow

The scratch pad enables conversational analysis workflows:

```bash
# Step 1: Save top products
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "saveAs": "top_products",
    "select": {
      "columns": [
        { "expr": { "column": { "column": "product_name" } } },
        { "expr": { "column": { "column": "category" } } },
        { "expr": { "column": { "column": "total_revenue" } } },
        { "expr": { "column": { "column": "total_orders" } } }
      ],
      "from": { "table": { "table": "product_performance" } },
      "orderBy": [{ "expr": { "column": { "column": "total_revenue" } }, "dir": "SORT_DESC" }],
      "limit": 20
    }
  }'

# Step 2: Save customer preferences for top product categories
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "saveAs": "category_preferences",
    "select": {
      "columns": [
        { "expr": { "column": { "column": "preferred_category" } } },
        { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "customer_count" },
        { "expr": { "function": { "name": "round", "args": [
          { "function": { "name": "avg", "args": [{ "column": { "column": "price_sensitivity" } }] } },
          { "literal": { "numberValue": 2 } }
        ] } }, "alias": "avg_price_sensitivity" }
      ],
      "from": { "table": { "table": "customer_preferences" } },
      "groupBy": [{ "expr": { "column": { "column": "preferred_category" } } }]
    }
  }'

# Step 3: Cross-reference in scratch pad
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "table": "tp", "column": "category" } } },
        { "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "tp", "column": "total_revenue" } }] } }, "alias": "category_revenue" },
        { "expr": { "column": { "table": "cp", "column": "customer_count" } } },
        { "expr": { "column": { "table": "cp", "column": "avg_price_sensitivity" } } }
      ],
      "from": { "table": { "table": "top_products", "alias": "tp" } },
      "joins": [{
        "type": "JOIN_LEFT",
        "table": { "table": "category_preferences", "alias": "cp" },
        "on": { "binary": { "op": "BINARY_OP_EQ",
          "left": { "column": { "table": "tp", "column": "category" } },
          "right": { "column": { "table": "cp", "column": "preferred_category" } }
        } }
      }],
      "groupBy": [
        { "expr": { "column": { "table": "tp", "column": "category" } } },
        { "expr": { "column": { "table": "cp", "column": "customer_count" } } },
        { "expr": { "column": { "table": "cp", "column": "avg_price_sensitivity" } } }
      ],
      "orderBy": [{ "expr": { "column": { "column": "category_revenue" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

The scratch pad is the AI's working memory for a conversation. Each `saveAs` is idempotent — saving to the same name overwrites the previous results.

## Context-Aware Querying

Each layer of the knowledge architecture improves the quality of AI-generated queries. Here's how the same business question — **"What's the revenue by customer segment for this quarter?"** — gets better with each layer.

### Layer 1: Schema Only

The AI sees table and column names but no meaning:

```sql
-- AI guesses: maybe total_amount? maybe subtotal?
-- What does "this quarter" mean? Calendar year? Fiscal?
SELECT customer_segment, SUM(total_amount)
FROM orders JOIN customers USING (customer_id)
GROUP BY customer_segment
-- Missing: date filter, status filter
```

Problems: No date filter. No status filter. May include cancelled orders. Might pick the wrong amount column.

### Layer 2: With Dictionary

The AI reads annotations and learns:
- `total_amount` is the correct revenue column (financial measure, includes tax/shipping)
- `order_date` is the business date (not `created_at`)
- `order_status` has 5 values; filter to shipped+delivered for revenue
- `customer_segment` has 4 values: Premium, Athlete, Regular, Bargain-Hunter

```sql
SELECT customer_segment, ROUND(SUM(total_amount)::numeric, 2) as revenue
FROM orders JOIN customers USING (customer_id)
WHERE order_date >= '2025-10-01' AND order_date < '2026-01-01'
  AND order_status IN ('shipped', 'delivered')
GROUP BY customer_segment
ORDER BY revenue DESC
```

Better: Correct columns, date filter, status filter. But the AI still had to guess Q4 = Oct-Dec.

### Layer 3: With Ontology

The AI resolves entity types:
- "Customer" → Customer entity, `customers` table, `customer_segment` is the category role
- "Revenue" → concept with calculation rule: `SUM(orders.total_amount) WHERE order_status IN ('shipped', 'delivered')`
- Relationship: Customer places Order → `customers.customer_id = orders.customer_id`

Same query, but the AI no longer guesses — it uses the ontology's explicit mappings and calculation rules.

### Layer 4: With Process Models

The AI checks business rules and calendar:
- `GetCalendarContext` → Q4 = October 1 through December 31 (confirmed, not guessed)
- `GetBusinessRules(orders)` → `exclude_cancelled_from_revenue` (hard_enforced)
- `GetAnnotations("revenue")` → "Use total_amount for revenue (includes tax and shipping)"
- `provisional_financials_warning` → "Current month figures may change until close completes"

```sql
SELECT customer_segment, ROUND(SUM(total_amount)::numeric, 2) as revenue
FROM orders JOIN customers USING (customer_id)
WHERE order_date >= '2025-10-01' AND order_date < '2026-01-01'
  AND order_status IN ('shipped', 'delivered')
GROUP BY customer_segment
ORDER BY revenue DESC
```

The query looks similar, but the AI is now **confident** in every choice:
- Q4 dates come from the fiscal calendar, not guessing
- Status filter comes from a hard-enforced business rule, not just dictionary advice
- The AI can add a footnote: "Note: December figures may be provisional if the monthly close hasn't completed"

### Layer 5: With Stored Definitions

If a `quarterly_revenue_by_segment` view existed, the query simplifies to:

```json
{
  "select": {
    "columns": [{ "expr": { "star": {} } }],
    "from": { "table": { "table": "quarterly_revenue_by_segment" } },
    "where": {
      "binary": {
        "op": "BINARY_OP_EQ",
        "left": { "column": { "column": "quarter" } },
        "right": { "literal": { "stringValue": "Q4" } }
      }
    }
  }
}
```

All the joins, filters, and aggregation are pre-encoded in the view. The AI just queries a flat table.

## The Complete Agent Workflow

Here's how an AI agent uses all five layers end-to-end:

**User asks:** "Compare revenue by product category for Premium customers vs all customers this quarter."

**Step 1: Discover available data**

```bash
# Agent queries dictionary for curated sales and product tables
ff-da dictionary tables --connection firekicks --tags sales,product --format json
```

**Step 2: Understand column semantics**

```bash
# Agent reads column annotations for the tables it will query
ff-da dictionary columns --connection firekicks --table orders --semantic-type measure --format json
```

Learns: `total_amount` (measure, financial) — "Final order total including subtotal, tax, shipping, minus discounts."

**Step 3: Resolve business concepts**

```bash
# Agent resolves "revenue" and "Premium customers"
grpcurl -plaintext -H "X-API-Key: $API_KEY" \
  -d '{"term": "revenue", "domain": "sales"}' \
  localhost:50051 ontology.v1.OntologyService/ResolveEntity

grpcurl -plaintext -H "X-API-Key: $API_KEY" \
  -d '{"term": "Premium customers", "domain": "customer"}' \
  localhost:50051 ontology.v1.OntologyService/ResolveEntity
```

Learns: Revenue → Order entity, amount role, calculation rule. Premium → Customer entity, segment category.

**Step 4: Get business rules and calendar**

```bash
# Agent checks rules for the tables it will query
grpcurl -plaintext -H "X-API-Key: $API_KEY" \
  -d '{"domain": "sales", "viewName": "orders"}' \
  localhost:50051 process.v1.ProcessService/GetBusinessRules

# Agent gets fiscal calendar for "this quarter"
grpcurl -plaintext -H "X-API-Key: $API_KEY" \
  -d '{"domain": "finance"}' \
  localhost:50051 process.v1.ProcessService/GetCalendarContext
```

Learns: Exclude cancelled (hard_enforced). Q4 = Oct 1 - Dec 31.

**Step 5: Build and execute queries**

The agent builds two AST queries:
1. Revenue by category for all customers (filtered by Q4 and status)
2. Revenue by category for Premium customers only (additional `customer_segment = 'Premium'` filter)

Both queries use `saveAs` to persist results to the scratch pad.

**Step 6: Cross-reference in scratch pad**

```bash
# Compare Premium vs All in the scratch pad
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        { "expr": { "column": { "table": "a", "column": "category" } } },
        { "expr": { "column": { "table": "a", "column": "revenue" } }, "alias": "all_revenue" },
        { "expr": { "column": { "table": "p", "column": "revenue" } }, "alias": "premium_revenue" },
        {
          "expr": { "function": { "name": "round", "args": [
            { "binary": { "op": "BINARY_OP_MUL",
              "left": { "binary": { "op": "BINARY_OP_DIV",
                "left": { "column": { "table": "p", "column": "revenue" } },
                "right": { "column": { "table": "a", "column": "revenue" } }
              } },
              "right": { "literal": { "numberValue": 100 } }
            } },
            { "literal": { "numberValue": 1 } }
          ] } },
          "alias": "premium_pct"
        }
      ],
      "from": { "table": { "table": "all_revenue_by_category", "alias": "a" } },
      "joins": [{
        "type": "JOIN_LEFT",
        "table": { "table": "premium_revenue_by_category", "alias": "p" },
        "on": { "binary": { "op": "BINARY_OP_EQ",
          "left": { "column": { "table": "a", "column": "category" } },
          "right": { "column": { "table": "p", "column": "category" } }
        } }
      }],
      "orderBy": [{ "expr": { "column": { "column": "all_revenue" } }, "dir": "SORT_DESC" }]
    }
  }' | jq
```

The agent now has a comparison table showing each category's total revenue, Premium-only revenue, and the Premium percentage — all built with correct business rules, calendar context, and entity resolution.

## Next Steps

You've completed the FireKicks tutorial. Here's what to explore next:

- **[DAS Overview](../README.md)** — Service architecture, supported databases, deployment
- **[Concepts](../concepts.md)** — Deep dive into AST queries, SQL serialization, ACL, staged queries
- **[Getting Started](../getting-started.md)** — Shorter tutorial with generic examples
- **[Reference](../reference.md)** — Full API specification for all endpoints
