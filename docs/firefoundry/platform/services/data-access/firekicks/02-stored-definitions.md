# Part 2: Stored Definitions

Stored definitions are virtual database objects — views, scalar functions (UDFs), and table-valued functions (TVFs) — that simplify raw data into curated, AI-friendly surfaces. They live in the Data Access Service and are expanded at query time, so they don't require changes to the underlying database.

This part covers designing stored definitions for the FireKicks dataset, creating them via the admin API, and integrating them with the data dictionary from [Part 1](./01-data-dictionary.md).

## Why Stored Definitions?

Raw tables expose database implementation, not business intent. An AI agent trying to answer "what are our best-selling products?" must:

1. Discover that `order_items` has line-level data and `products` has product details
2. Figure out the join: `order_items.product_id = products.product_id`
3. Know to aggregate `quantity` and `unit_price * quantity` for revenue
4. Know to filter on delivered orders only (excluding cancelled)
5. Know to join `product_reviews` for rating data
6. Get the column names and aggregation logic right

That's a lot of steps where the AI can go wrong. A stored view called `product_performance` can pre-encode all of this — the joins, the aggregation, the filters — so the AI just queries a single flat table.

### Three Types of Stored Definitions

| Type | What It Does | Example |
|------|-------------|---------|
| **View** | Pre-built SELECT query that appears as a table | `product_performance` — joins products + order_items + reviews |
| **Scalar UDF** | Computes a single value from inputs | `calculate_margin(cost, price)` — returns margin percentage |
| **TVF** | Returns rows based on parameters | `customer_orders(customer_id)` — returns all orders for a customer |

Views are the most common. They create curated data surfaces that hide complexity. UDFs compute values that would otherwise require inline expressions. TVFs are parameterized rowsets — like views that take arguments.

## Design Goals

A well-designed stored definition should be:

1. **Clear grain** — What does each row represent? One product? One customer-month? One order?
2. **Self-contained** — No further joins needed for the most common questions about this topic
3. **Meaningful names** — Column names that make sense to a business user, not raw database names
4. **Appropriate aggregation** — Don't over-aggregate. A per-product view is more flexible than a per-category view, because the AI can always aggregate up.
5. **Documented** — Each definition gets its own dictionary annotation (businessName, grain, usageNotes)

### When to Use Each Type

- **View** — When you need a new "table" that pre-joins or pre-aggregates data. Most common.
- **Scalar UDF** — When a calculation appears in multiple views or queries. Avoids duplicating formulas.
- **TVF** — When the query needs a parameter (customer ID, date range) to be useful. More flexible than a view but requires the caller to provide arguments.

## Reshaping: Renaming and Computed Columns

The most common use of stored definitions isn't joins or aggregation — it's **simple reshaping**. Enterprise databases are full of tables with confusing column names, legacy abbreviations, and values that require multi-column expressions to interpret. A stored view can fix this without touching the upstream database.

### Column Renaming

Upstream tables often have names that made sense to the DBA but confuse everyone else:

```
cust_seg_cd  →  customer_segment
ord_dt       →  order_date
tot_amt      →  total_amount
shp_mthd_cd  →  shipping_method
rtl_prtnr_id →  retail_partner_id
```

A view that simply renames columns gives AI agents (and humans) an immediately understandable data surface. No joins, no aggregation — just semantic clarity.

### Computed Columns

Sometimes the information an AI needs isn't stored directly but requires combining or transforming existing columns:

- **Status flags**: `CASE WHEN ship_date IS NOT NULL AND delivered_date IS NULL THEN 'in_transit' ... END AS delivery_status`
- **Derived categories**: `CASE WHEN total_amount > 200 THEN 'high_value' WHEN total_amount > 50 THEN 'mid_value' ELSE 'low_value' END AS order_tier`
- **Formatted values**: `first_name || ' ' || last_name AS full_name`
- **Business logic**: `total_amount - subtotal AS tax_and_shipping`
- **Time-based**: `EXTRACT(YEAR FROM order_date) || '-Q' || EXTRACT(QUARTER FROM order_date) AS fiscal_quarter`

Without these computed columns, an AI agent must reconstruct the business logic inline in every query — and likely gets it wrong. A view encodes the calculation once.

### When Reshaping Matters Most

The FireKicks dataset has relatively clean, well-named columns, so reshaping is less critical here. But in enterprise environments, reshaping is often the *primary* value of stored definitions:

- **Legacy systems** with abbreviated column names (`ACT_CUST_DTL_MTD_AMT`)
- **ERP exports** with generic field names (`FIELD1`, `FIELD2`, `CUSTOM_ATTR_17`)
- **Data warehouses** with staging-layer naming conventions (`stg_fact_sales_line_item_amount_usd`)
- **Multi-source schemas** where the same concept has different names across systems

In these cases, a simple rename-and-reshape view is more valuable than any aggregation view. It makes the data *discoverable* — an AI that sees `customer_lifetime_value` knows what to do with it; an AI that sees `CUST_LTV_MTD_AGG_V2` does not.

### Example: Reshaping a Hypothetical Legacy Table

If FireKicks had a legacy `ord_hdr` table instead of the clean `orders` table:

**SQL equivalent:**
```sql
SELECT
  oh.ord_id AS order_id,
  oh.cust_id AS customer_id,
  oh.ord_dt AS order_date,
  oh.tot_amt AS total_amount,
  oh.sub_amt AS subtotal,
  oh.tx_amt AS tax_amount,
  oh.shp_amt AS shipping_amount,
  oh.disc_amt AS discount_amount,
  oh.tot_amt - oh.sub_amt AS tax_and_shipping,
  CASE oh.ord_stat_cd
    WHEN 'P' THEN 'pending'
    WHEN 'R' THEN 'processing'
    WHEN 'S' THEN 'shipped'
    WHEN 'D' THEN 'delivered'
    WHEN 'X' THEN 'cancelled'
  END AS order_status,
  CASE oh.chnl_cd
    WHEN 'ON' THEN 'online'
    WHEN 'RT' THEN 'retail'
    WHEN 'WH' THEN 'wholesale'
    WHEN 'DR' THEN 'direct'
  END AS order_channel
FROM ord_hdr oh
```

This view does no joins and no aggregation. It just renames columns, decodes status codes, and adds a computed `tax_and_shipping` column. Yet it transforms a table that an AI couldn't reason about into one it can.

## Designing Views for FireKicks

Let's walk through the design process for three views that cover different patterns.

### product_performance — Per-Product Scorecard

**Business question:** "How is each product performing?"

**Design process:**
- **Grain:** One row per product (200 rows)
- **What the AI needs:** Product details (name, category, brand), sales metrics (orders, units, revenue), quality metrics (avg rating, review count)
- **Source tables:** `products` (details), `order_items` (sales), `product_reviews` (quality)
- **Filters:** Only count completed orders (shipped + delivered) for accurate revenue
- **Key columns:** product_id, product_name, category, brand_line, total_orders, total_units, total_revenue, avg_rating, review_count

**SQL equivalent** (what the AST encodes):
```sql
SELECT
  p.product_id,
  p.product_name,
  p.category,
  p.brand_line,
  COUNT(DISTINCT oi.order_id) AS total_orders,
  SUM(oi.quantity) AS total_units,
  SUM(oi.quantity * oi.unit_price) AS total_revenue,
  AVG(pr.rating) AS avg_rating,
  COUNT(DISTINCT pr.review_id) AS review_count
FROM products p
LEFT JOIN order_items oi ON p.product_id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.order_id
  AND o.order_status IN ('shipped', 'delivered')
LEFT JOIN product_reviews pr ON p.product_id = pr.product_id
GROUP BY p.product_id, p.product_name, p.category, p.brand_line
```

**Design decisions:**
- `LEFT JOIN` ensures all 200 products appear, even those with zero orders
- Filter on `order_status` is in the JOIN condition (not WHERE) so products with only cancelled orders still appear with zero revenue
- `COUNT(DISTINCT oi.order_id)` avoids double-counting when there are multiple reviews
- Revenue is `quantity * unit_price`, not `total_amount` (which is order-level, not line-item-level)

### campaign_roi_summary — Per-Campaign ROI

**Business question:** "What's the ROI on each marketing campaign?"

**Design process:**
- **Grain:** One row per campaign (80 rows)
- **What the AI needs:** Campaign details (name, type, target segment), spend, revenue attributed, impressions, clicks, conversions, calculated ROI
- **Source tables:** `campaigns` (details), `campaign_performance` (daily metrics)
- **Key columns:** campaign_id, campaign_name, campaign_type, target_segment, total_spend, total_impressions, total_clicks, total_conversions, revenue_attributed, roi_percentage

**SQL equivalent:**
```sql
SELECT
  c.campaign_id,
  c.campaign_name,
  c.campaign_type,
  c.target_segment,
  c.budget,
  SUM(cp.spend) AS total_spend,
  SUM(cp.impressions) AS total_impressions,
  SUM(cp.clicks) AS total_clicks,
  SUM(cp.conversions) AS total_conversions,
  SUM(cp.revenue_attributed) AS revenue_attributed,
  CASE
    WHEN SUM(cp.spend) > 0
    THEN ROUND((SUM(cp.revenue_attributed) - SUM(cp.spend)) / SUM(cp.spend) * 100, 2)
    ELSE 0
  END AS roi_percentage
FROM campaigns c
LEFT JOIN campaign_performance cp ON c.campaign_id = cp.campaign_id
GROUP BY c.campaign_id, c.campaign_name, c.campaign_type, c.target_segment, c.budget
```

**Design decisions:**
- ROI is calculated in the view so the AI doesn't need to know the formula
- `LEFT JOIN` ensures campaigns with no performance data still appear
- `revenue_attributed` is the correct column for ROI (not total channel revenue)

### customer_nearest_store — Spatial Proximity

**Business question:** "Which retail store is closest to each customer?"

**Design process:**
- **Grain:** One row per customer (10,000 rows)
- **What the AI needs:** Customer ID, customer city/state, nearest partner name/type, distance
- **Source tables:** `customers` (location), `retail_partners` (store locations with PostGIS geometry)
- **Key columns:** customer_id, customer_city, customer_state, nearest_partner_id, partner_name, partner_type, distance_miles

This view uses PostGIS `ST_Distance` — a database-specific function. This is a good example of why DAS is an unopinionated SQL gateway: the AST passes `ST_Distance` through to PostgreSQL as-is.

## Creating Stored Views

Stored views are created through the admin API using AST (Abstract Syntax Tree) JSON, not raw SQL. The AST is validated, stored, and expanded at query time.

### Namespaces

Each stored definition lives in a namespace that controls visibility:

| Namespace | Pattern | Visibility | Use Case |
|-----------|---------|-----------|----------|
| `system` | `system` | All callers | Shared definitions for everyone |
| `app` | `app:sales-agent` | All agents in that app | App-specific definitions |
| `agent` | `agent:report-bot` | Only that specific agent | Agent-private definitions |

When a caller queries a view, the service resolves the name using this priority order:
1. Check the caller's agent namespace (`agent:X`)
2. Check the caller's app namespace (`app:Y`)
3. Fall back to `system`

This means an agent can override a system view with its own version without affecting other agents.

### Create product_performance

```bash
ff-da admin views create --file - <<'EOF'
{
    "name": "product_performance",
    "namespace": "system",
    "connection": "firekicks",
    "description": "Per-product scorecard: orders, units, revenue, avg rating, review count",
    "ast": {
      "columns": [
        { "expr": { "column": { "table": "p", "column": "product_id" } } },
        { "expr": { "column": { "table": "p", "column": "product_name" } } },
        { "expr": { "column": { "table": "p", "column": "category" } } },
        { "expr": { "column": { "table": "p", "column": "brand_line" } } },
        {
          "expr": { "function": { "name": "count", "distinct": true, "args": [{ "column": { "table": "oi", "column": "order_id" } }] } },
          "alias": "total_orders"
        },
        {
          "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "oi", "column": "quantity" } }] } },
          "alias": "total_units"
        },
        {
          "expr": {
            "function": {
              "name": "sum",
              "args": [{
                "binary": {
                  "op": "BINARY_OP_MUL",
                  "left": { "column": { "table": "oi", "column": "quantity" } },
                  "right": { "column": { "table": "oi", "column": "unit_price" } }
                }
              }]
            }
          },
          "alias": "total_revenue"
        },
        {
          "expr": { "function": { "name": "avg", "args": [{ "column": { "table": "pr", "column": "rating" } }] } },
          "alias": "avg_rating"
        },
        {
          "expr": { "function": { "name": "count", "distinct": true, "args": [{ "column": { "table": "pr", "column": "review_id" } }] } },
          "alias": "review_count"
        }
      ],
      "from": { "table": { "table": "products", "alias": "p" } },
      "joins": [
        {
          "type": "JOIN_LEFT",
          "table": { "table": "order_items", "alias": "oi" },
          "on": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "p", "column": "product_id" } },
              "right": { "column": { "table": "oi", "column": "product_id" } }
            }
          }
        },
        {
          "type": "JOIN_LEFT",
          "table": { "table": "orders", "alias": "o" },
          "on": {
            "and": {
              "exprs": [
                {
                  "binary": {
                    "op": "BINARY_OP_EQ",
                    "left": { "column": { "table": "oi", "column": "order_id" } },
                    "right": { "column": { "table": "o", "column": "order_id" } }
                  }
                },
                {
                  "in": {
                    "expr": { "column": { "table": "o", "column": "order_status" } },
                    "values": [
                      { "literal": { "stringValue": "shipped" } },
                      { "literal": { "stringValue": "delivered" } }
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          "type": "JOIN_LEFT",
          "table": { "table": "product_reviews", "alias": "pr" },
          "on": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "p", "column": "product_id" } },
              "right": { "column": { "table": "pr", "column": "product_id" } }
            }
          }
        }
      ],
      "groupBy": [
        { "expr": { "column": { "table": "p", "column": "product_id" } } },
        { "expr": { "column": { "table": "p", "column": "product_name" } } },
        { "expr": { "column": { "table": "p", "column": "category" } } },
        { "expr": { "column": { "table": "p", "column": "brand_line" } } }
      ]
    }
}
EOF
```

When created, the service auto-probes the view by running it with `LIMIT 1` to infer output column types. The response includes the inferred `outputSchema`:

```json
{
  "name": "product_performance",
  "namespace": "system",
  "connection": "firekicks",
  "outputSchema": [
    { "name": "product_id", "type": "INTEGER" },
    { "name": "product_name", "type": "VARCHAR" },
    { "name": "category", "type": "VARCHAR" },
    { "name": "brand_line", "type": "VARCHAR" },
    { "name": "total_orders", "type": "BIGINT" },
    { "name": "total_units", "type": "BIGINT" },
    { "name": "total_revenue", "type": "NUMERIC" },
    { "name": "avg_rating", "type": "NUMERIC" },
    { "name": "review_count", "type": "BIGINT" }
  ],
  "createdAt": "2025-06-15T10:30:00Z"
}
```

### Manage Views with ff-da CLI

```bash
# List all stored views
ff-da admin views list

# List views for a specific connection
ff-da admin views list --connection firekicks

# Get a specific view's definition
ff-da admin views get --namespace system --name product_performance

# Create from a JSON file
ff-da admin views create --file product_performance.json

# Delete a view
ff-da admin views delete --namespace system --name product_performance
```

## Creating UDFs

Scalar UDFs compute a single value from inputs. They're useful when the same calculation appears in multiple places.

### calculate_margin

A margin calculation that multiple views and ad-hoc queries need:

```bash
ff-da admin views create --file - <<'EOF'
{
    "name": "calculate_margin",
    "namespace": "system",
    "connection": "firekicks",
    "description": "Calculates margin percentage: (price - cost) / price * 100",
    "params": [
      { "name": "cost", "position": 1, "type": "float" },
      { "name": "price", "position": 2, "type": "float" }
    ],
    "ast": {
      "columns": [{
        "expr": {
          "function": {
            "name": "round",
            "args": [
              {
                "binary": {
                  "op": "BINARY_OP_MUL",
                  "left": {
                    "binary": {
                      "op": "BINARY_OP_DIV",
                      "left": {
                        "binary": {
                          "op": "BINARY_OP_SUB",
                          "left": { "param": { "position": 2 } },
                          "right": { "param": { "position": 1 } }
                        }
                      },
                      "right": { "param": { "position": 2 } }
                    }
                  },
                  "right": { "literal": { "numberValue": 100 } }
                }
              },
              { "literal": { "numberValue": 2 } }
            ]
          }
        },
        "alias": "margin_pct"
      }],
      "from": { "table": { "table": "products" } },
      "limit": 1
    }
}
EOF
```

UDFs with parameters skip auto-probing (since the service can't guess parameter values). You can optionally declare the output schema:

```json
"outputSchema": [{ "name": "margin_pct", "type": "NUMERIC" }]
```

## Creating TVFs

Table-valued functions return rowsets based on parameters. They're like parameterized views.

### customer_orders

Returns all orders for a specific customer, pre-joined with line items and shipping:

```bash
ff-da admin views create --file - <<'EOF'
{
    "name": "customer_orders",
    "namespace": "system",
    "connection": "firekicks",
    "description": "All orders for a given customer with line-item count and shipping status",
    "params": [
      { "name": "cust_id", "position": 1, "type": "integer" }
    ],
    "ast": {
      "columns": [
        { "expr": { "column": { "table": "o", "column": "order_id" } } },
        { "expr": { "column": { "table": "o", "column": "order_date" } } },
        { "expr": { "column": { "table": "o", "column": "order_status" } } },
        { "expr": { "column": { "table": "o", "column": "order_channel" } } },
        { "expr": { "column": { "table": "o", "column": "total_amount" } } },
        {
          "expr": { "function": { "name": "count", "args": [{ "column": { "table": "oi", "column": "order_item_id" } }] } },
          "alias": "item_count"
        },
        { "expr": { "column": { "table": "sp", "column": "on_time" } }, "alias": "shipped_on_time" }
      ],
      "from": { "table": { "table": "orders", "alias": "o" } },
      "joins": [
        {
          "type": "JOIN_LEFT",
          "table": { "table": "order_items", "alias": "oi" },
          "on": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "o", "column": "order_id" } },
              "right": { "column": { "table": "oi", "column": "order_id" } }
            }
          }
        },
        {
          "type": "JOIN_LEFT",
          "table": { "table": "shipping_performance", "alias": "sp" },
          "on": {
            "binary": {
              "op": "BINARY_OP_EQ",
              "left": { "column": { "table": "o", "column": "order_id" } },
              "right": { "column": { "table": "sp", "column": "order_id" } }
            }
          }
        }
      ],
      "where": {
        "binary": {
          "op": "BINARY_OP_EQ",
          "left": { "column": { "table": "o", "column": "customer_id" } },
          "right": { "param": { "position": 1 } }
        }
      },
      "groupBy": [
        { "expr": { "column": { "table": "o", "column": "order_id" } } },
        { "expr": { "column": { "table": "o", "column": "order_date" } } },
        { "expr": { "column": { "table": "o", "column": "order_status" } } },
        { "expr": { "column": { "table": "o", "column": "order_channel" } } },
        { "expr": { "column": { "table": "o", "column": "total_amount" } } },
        { "expr": { "column": { "table": "sp", "column": "on_time" } } }
      ],
      "orderBy": [{ "expr": { "column": { "table": "o", "column": "order_date" } }, "dir": "SORT_DESC" }]
    }
}
EOF
```

### Calling a TVF

TVFs are invoked using the `TableFunctionCall` syntax in the FROM clause of an AST query:

```bash
curl -s -X POST "$DA_URL/v1/connections/firekicks/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{ "expr": { "star": {} } }],
      "from": {
        "function": {
          "name": "customer_orders",
          "args": [{ "literal": { "numberValue": 42 } }]
        }
      }
    }
  }'
```

The service resolves `customer_orders`, binds `42` to parameter position 1, expands the AST, and runs the resulting query against the `firekicks` connection.

## Dictionary Integration

Stored definitions should be annotated in the data dictionary just like regular tables. This is what makes them discoverable to AI agents.

### Annotate the View

```bash
ff-da admin annotations create-table --file - <<'EOF'
{
  "connection": "firekicks",
  "table": "product_performance",
  "description": "Pre-computed product scorecard aggregating sales metrics (orders, units, revenue) and quality metrics (avg rating, review count) per product. Only counts shipped and delivered orders.",
  "businessName": "Product Performance Scorecard",
  "grain": "One row per product (200 rows)",
  "tags": ["product", "performance", "curated", "view"],
  "statistics": { "rowCount": 200 },
  "usageNotes": "Use this view instead of manually joining products + order_items + reviews. Revenue reflects shipped+delivered orders only. For all-time metrics — not date-filterable. For date-range analysis, query order_items directly."
}
EOF
```

### Tag Strategy: Raw vs Curated

The key pattern for AI routing:

1. **Tag raw tables** — Base tables that AI agents shouldn't query directly get tagged appropriately (e.g., `transactional`, `master-data`)
2. **Tag curated views** — Stored definitions designed for AI consumption get tagged `curated`
3. **Agent queries with `excludeTags=raw`** — Or positively selects `tags=curated`

This creates a two-tier data surface:

| Surface | Tables | Who Sees It |
|---------|--------|-------------|
| Raw | `orders`, `order_items`, `products`, `product_reviews` | Data engineers, admin users |
| Curated | `product_performance`, `campaign_roi_summary` | AI agents, business users |

The curated surface has fewer tables, clearer names, and pre-computed metrics — which means less context, fewer tokens, and better query accuracy.

### Views in GetSchema

Once created, stored views appear in schema responses alongside real tables:

```bash
ff-da schema --connection firekicks
```

The response includes entries with `type: "stored_view"`:

```json
{
  "name": "product_performance",
  "type": "stored_view",
  "columns": [
    { "name": "product_id", "type": "INTEGER", "normalizedType": "INTEGER" },
    { "name": "product_name", "type": "VARCHAR", "normalizedType": "VARCHAR" },
    { "name": "total_orders", "type": "BIGINT", "normalizedType": "BIGINT" },
    { "name": "total_revenue", "type": "NUMERIC", "normalizedType": "NUMERIC" }
  ]
}
```

AI agents that call `GetSchema` see these views as queryable tables. They don't need to know whether a table is a real database table or a stored definition — the service handles expansion transparently.

## Schema Augmentation in Practice

Before stored definitions, an AI agent answering "what are our top products?" would see 23 tables, need to figure out the 3-table join, and hope it gets the aggregation right.

After stored definitions:

1. Agent queries the dictionary: `tags=product&tags=curated`
2. Gets back `product_performance` with description: "Pre-computed product scorecard..."
3. Reads column annotations: `total_revenue` (measure), `category` (dimension)
4. Builds a simple query:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "product_name" } } },
      { "expr": { "column": { "column": "total_revenue" } } }
    ],
    "from": { "table": { "table": "product_performance" } },
    "orderBy": [{ "expr": { "column": { "column": "total_revenue" } }, "dir": "SORT_DESC" }],
    "limit": 10
  }
}
```

No joins. No aggregation. No guessing. The stored definition did the hard work, and the dictionary told the AI which definition to use.

## Security Predicates

Stored definitions can include an optional security predicate — a row-level security (RLS) filter that is automatically applied when the view is expanded. This ensures that the view only returns rows the caller is authorized to see.

```json
{
  "name": "my_orders",
  "namespace": "system",
  "connection": "firekicks",
  "securityPredicate": {
    "binary": {
      "op": "BINARY_OP_EQ",
      "left": { "column": { "column": "customer_id" } },
      "right": { "param": { "position": 1 } }
    }
  }
}
```

Security predicates are validated by the same AST validator that checks queries, so they can't introduce injection vulnerabilities.

## Summary

You've learned how to:

1. **Design** stored definitions — identify the right grain, joins, and aggregations
2. **Choose** the right type — views for pre-built tables, UDFs for reusable calculations, TVFs for parameterized queries
3. **Create** definitions via the admin API — AST JSON with auto-probe for output schemas
4. **Use namespaces** — system, app, and agent scoping with resolution order
5. **Integrate** with the dictionary — annotate views with tags, descriptions, and usage notes
6. **Route AI agents** — curated views as the primary query surface, raw tables hidden by tags

In [Part 3](./03-ontology.md), you'll build an ontology that maps business concepts — like "Customer", "Revenue", and "Premium segment" — to the database structures and stored definitions you've created.
