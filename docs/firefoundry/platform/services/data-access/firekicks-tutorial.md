# Tutorial: Building a Data-Ready AI Layer with FireKicks

This tutorial walks through setting up the Data Access Service for the **FireKicks** synthetic shoe company dataset — from raw schema discovery through building a complete data dictionary that enables AI agents to write accurate queries autonomously.

## What You'll Learn

1. **Discover** the schema (Layer 1 — Catalog)
2. **Query** the data with raw SQL and structured AST
3. **Build** a data dictionary with rich semantic annotations (Layer 2 — Dictionary)
4. **Design** a tag taxonomy for AI routing
5. **Query** the dictionary with filters to control what AI agents see

## The FireKicks Dataset

FireKicks is a synthetic athletic shoe company with 20 tables covering 5 business domains:

| Domain | Tables | Description |
|--------|--------|-------------|
| **Sales** | orders, order_items, retail_partners | ~131K orders, ~350K line items, 50 retail partners |
| **Products** | products, product_suppliers, inventory, product_reviews | ~200 SKUs, 25 suppliers, stock by warehouse, ~25K reviews |
| **Customers** | customers, customer_addresses, customer_preferences, customer_segments_history | ~10K customers with tiers, addresses, preferences |
| **Marketing** | campaigns, campaign_performance, email_events, customer_acquisition, website_traffic | 80 campaigns, daily metrics, ~250K email events |
| **Finance** | daily_sales_summary, monthly_financials, shipping_performance, returns | Pre-aggregated summaries, ~8.5K returns |

Plus 3 computed views: `product_performance`, `campaign_roi_summary`, `customer_nearest_store`.

## Prerequisites

- Data Access Service running with FireKicks configuration
- `ff-da` CLI installed (`go build -o ~/.local/bin/ff-da ./cmd/ff-da` from the DAS repo)
- API key (default: `dev-api-key`)

```bash
# ff-da CLI uses these env vars (or --flags)
export DA_HOST=localhost
export DA_HTTP_PORT=8080
export DA_GRPC_PORT=50051
export DA_API_KEY=dev-api-key
export DA_IDENTITY=user:tutorial
```

> **Note:** This tutorial uses the `ff-da` CLI for data-plane operations (connections, schema, queries) and `curl` for admin and dictionary API calls that don't have CLI support yet.

## 1. Discover the Schema

### List Connections

```bash
ff-da connections
```

Output:
```
NAME        TYPE         DESCRIPTION
firekicks   postgresql   FireKicks synthetic shoe company dataset (20 tables, ~100K orders)
```

### Explore Tables

```bash
ff-da schema --connection firekicks
```

This returns all 20+ tables with their columns. Inspect a specific table:

```bash
ff-da schema --connection firekicks --table orders
```

For JSON output (useful for scripting):

```bash
ff-da schema --connection firekicks --table orders --format json | jq '.tables[0].columns[] | {name, type}'
```

You'll see columns like `order_id`, `customer_id`, `order_date`, `total_amount`, `order_status`, `created_at` — but the schema only tells you **types**, not **meaning**. Is `total_amount` the subtotal or the final total? Should you filter on `order_date` or `created_at`? That's what the data dictionary answers.

## 2. Query the Data

### Raw SQL

Find the top 10 customers by total spending:

```bash
ff-da query --connection firekicks --sql "
  SELECT c.first_name, c.last_name, c.customer_segment,
         COUNT(*) as order_count, SUM(o.total_amount) as total_spent
  FROM orders o
  JOIN customers c ON o.customer_id = c.customer_id
  GROUP BY c.customer_id, c.first_name, c.last_name, c.customer_segment
  ORDER BY total_spent DESC
  LIMIT 10"
```

### Revenue by Channel

```bash
ff-da query --connection firekicks --sql "
  SELECT order_channel, COUNT(*) as orders,
         SUM(total_amount) as revenue,
         AVG(total_amount) as avg_order_value
  FROM orders GROUP BY order_channel ORDER BY revenue DESC"
```

### Preview SQL from AST

Use `ff-da translate` to see what SQL the service would generate from an AST without executing:

```bash
ff-da translate --connection firekicks --ast '{
  "columns": [
    { "expr": { "column": { "table": "c", "column": "customer_segment" } } },
    { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "order_count" },
    { "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "o", "column": "total_amount" } }] } }, "alias": "total_spent" }
  ],
  "from": { "table": { "table": "orders", "alias": "o" } },
  "joins": [{
    "type": "JOIN_INNER",
    "table": { "table": "customers", "alias": "c" },
    "on": { "binary": { "op": "BINARY_OP_EQ", "left": { "column": { "table": "o", "column": "customer_id" } }, "right": { "column": { "table": "c", "column": "customer_id" } } } }
  }],
  "groupBy": [{ "expr": { "column": { "table": "c", "column": "customer_segment" } } }],
  "orderBy": [{ "expr": { "column": { "column": "total_spent" } }, "dir": "SORT_DESC" }]
}'
```

Without a data dictionary, an AI agent doesn't know whether to group by `order_channel` or `order_status`, whether `total_amount` includes tax, or what the valid channel values are. The dictionary answers all of this.

## 3. Build the Data Dictionary

The data dictionary annotates tables and columns with **business meaning** — turning raw schema metadata into actionable context for AI agents.

> **Note:** The admin annotation and dictionary query endpoints use `curl` below because `ff-da` CLI doesn't have dictionary subcommands yet. Set up the HTTP vars:
> ```bash
> export DA_URL=http://localhost:8080
> export API_KEY=dev-api-key
> ```

### Step 1: Annotate Tables

Create a table annotation for `orders`:

```bash
curl -s -X POST "$DA_URL/admin/annotations/tables" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "description": "Customer purchase orders across all sales channels. Each order has a customer, channel, and financial totals (subtotal, tax, shipping, discount, total). ~131,000 orders from 2022-2025.",
    "businessName": "Customer Orders",
    "grain": "One row per order",
    "tags": ["sales", "transactional"],
    "statistics": { "rowCount": 131072, "avgRowSizeBytes": 256 },
    "relationships": [
      { "targetTable": "customers", "type": "child", "joinHint": "orders.customer_id = customers.customer_id", "description": "Each order belongs to one customer" },
      { "targetTable": "order_items", "type": "parent", "joinHint": "orders.order_id = order_items.order_id", "description": "Each order has 1-5 line items" },
      { "targetTable": "shipping_performance", "type": "parent", "joinHint": "orders.order_id = shipping_performance.order_id", "description": "One shipment per order" }
    ],
    "qualityNotes": { "completeness": "100%", "knownIssues": [] },
    "usageNotes": "Primary fact table for sales analysis. Use order_date for business date filtering, NOT created_at (which is the system timestamp). total_amount includes tax and shipping. For line-item detail, join to order_items."
  }'
```

Do the same for `customers` and `products`:

```bash
curl -s -X POST "$DA_URL/admin/annotations/tables" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "customers",
    "description": "Customer master data with demographics, segmentation (Premium/Standard/Budget), and lifetime value. ~10,000 customers.",
    "businessName": "Customer Profiles",
    "grain": "One row per customer",
    "tags": ["customer", "master-data"],
    "statistics": { "rowCount": 10000, "avgRowSizeBytes": 320 },
    "qualityNotes": { "completeness": "99%", "knownIssues": ["phone is nullable, ~30% null"] },
    "usageNotes": "Primary customer dimension. Use customer_segment for tier analysis. lifetime_value is cumulative actual, not a prediction."
  }'
```

### Step 2: Annotate Columns

Annotate key columns on `orders` with semantic types and classifications:

```bash
# order_id — identifier
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "order_id",
    "description": "Unique order identifier (auto-increment integer)",
    "businessName": "Order ID",
    "semanticType": "identifier",
    "dataClassification": "public",
    "tags": ["sales"],
    "statistics": { "distinctCount": 131072, "nullCount": 0 }
  }'

# total_amount — measure, financial
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "total_amount",
    "description": "Final order total including subtotal, tax, shipping, minus discounts. This is the revenue figure to use for financial reporting.",
    "businessName": "Order Total",
    "semanticType": "measure",
    "dataClassification": "financial",
    "tags": ["sales", "financial"],
    "sampleValues": ["29.99", "149.50", "299.00"],
    "statistics": { "min": 9.99, "max": 999.99, "avg": 89.45, "nullCount": 0 },
    "valuePattern": "Decimal USD amount, typically 9.99 to 999.99",
    "usageNotes": "Use for revenue calculations. Includes tax and shipping. For subtotal only, use the subtotal column."
  }'

# order_date — temporal
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "order_date",
    "description": "Business date when the order was placed. Use this for all date-based analysis and reporting.",
    "businessName": "Order Date",
    "semanticType": "temporal",
    "dataClassification": "public",
    "tags": ["sales", "temporal"],
    "statistics": { "min": "2022-01-01", "max": "2025-12-31", "distinctCount": 1461, "nullCount": 0 },
    "usageNotes": "Use order_date for business reporting. Do NOT use created_at — that is a system timestamp and may differ from the business date."
  }'

# order_status — dimension with constraints
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "order_status",
    "description": "Current order fulfillment status",
    "businessName": "Order Status",
    "semanticType": "dimension",
    "dataClassification": "public",
    "tags": ["sales"],
    "sampleValues": ["shipped", "delivered", "pending"],
    "statistics": { "distinctCount": 5, "nullCount": 0 },
    "constraints": { "type": "enum", "values": ["pending", "processing", "shipped", "delivered", "cancelled"] },
    "usageNotes": "Filter to shipped+delivered for revenue reports. Use pending+processing for pipeline analysis. Cancelled orders should typically be excluded from financial aggregations."
  }'

# order_channel — dimension
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "order_channel",
    "description": "Sales channel through which the order was placed",
    "businessName": "Sales Channel",
    "semanticType": "dimension",
    "dataClassification": "public",
    "tags": ["sales", "channel"],
    "constraints": { "type": "enum", "values": ["online", "retail", "wholesale", "direct"] },
    "statistics": { "distinctCount": 4, "nullCount": 0 }
  }'
```

**Key semantic types used:**
- `identifier` — Primary/foreign keys (`order_id`, `customer_id`)
- `measure` — Numeric values for aggregation (`total_amount`, `subtotal`, `tax_amount`)
- `dimension` — Categorical values for grouping (`order_status`, `order_channel`)
- `temporal` — Date/time columns (`order_date`, `created_at`)

**Key data classifications:**
- `public` — Non-sensitive business data
- `financial` — Revenue, cost, and pricing data
- `pii` — Customer email, phone, address

### Step 3: Add Statistics

Table-level statistics give the AI a sense of data volume:

```json
{ "rowCount": 131072, "avgRowSizeBytes": 256 }
```

Column-level statistics are type-appropriate:

```json
// Numeric measure
{ "min": 9.99, "max": 999.99, "avg": 89.45, "distinctCount": 4500, "nullCount": 0 }

// Dimension
{ "distinctCount": 5, "nullCount": 0 }

// Temporal
{ "min": "2022-01-01", "max": "2025-12-31", "distinctCount": 1461, "nullCount": 0 }
```

Statistics help AI agents understand data distribution — an AI won't filter `total_amount > 10000` if it knows the max is 999.99.

### Step 4: Define Constraints

Constraints define valid values. When an AI generates `WHERE order_status = 'complete'`, the DAS can check the constraint and warn that `complete` is not a valid value — the correct value is `delivered`.

```json
// Enum — fixed set of valid values
{ "type": "enum", "values": ["pending", "processing", "shipped", "delivered", "cancelled"] }

// Range — valid numeric bounds
{ "type": "range", "min": 0, "max": 999999.99 }

// Regex — value format pattern
{ "type": "regex", "pattern": "^FK-\\d{8}$" }
```

### Step 5: Document Relationships

Relationships tell the AI how tables join, including **loose foreign keys** — semantic relationships without explicit database constraints:

```json
[
  {
    "targetTable": "customers",
    "type": "child",
    "joinHint": "orders.customer_id = customers.customer_id",
    "description": "Each order belongs to one customer"
  },
  {
    "targetTable": "order_items",
    "type": "parent",
    "joinHint": "orders.order_id = order_items.order_id",
    "description": "Each order has 1-5 line items"
  },
  {
    "targetTable": "shipping_performance",
    "type": "parent",
    "joinHint": "orders.order_id = shipping_performance.order_id",
    "description": "One shipment tracking record per order"
  }
]
```

### Step 6: Add Quality Notes and Usage Guidance

**Quality notes** warn about known data issues:

```json
{
  "completeness": "99%",
  "knownIssues": ["phone is nullable, ~30% null"],
  "freshness": "updated daily"
}
```

**Usage notes** give direct guidance to the AI:

> "Use `order_date` for business reporting, NOT `created_at`. `created_at` is a system timestamp and may differ from the business date by up to 24 hours for late-night orders."

> "For revenue reports, filter to `order_status IN ('shipped', 'delivered')`. Cancelled orders should be excluded."

### Step 7: Bulk Import

For large datasets, create a JSON file and import everything at once:

```bash
curl -s -X POST "$DA_URL/admin/annotations/import" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @annotations-firekicks.json
```

The JSON file structure:

```json
{
  "tables": [
    {
      "connection": "firekicks",
      "table": "orders",
      "description": "Customer purchase orders...",
      "businessName": "Customer Orders",
      "grain": "One row per order",
      "tags": ["sales", "transactional"],
      "statistics": { "rowCount": 131072 },
      "relationships": [...]
    }
  ],
  "columns": [
    {
      "connection": "firekicks",
      "table": "orders",
      "column": "total_amount",
      "description": "Final order total...",
      "semanticType": "measure",
      "dataClassification": "financial",
      "tags": ["sales", "financial"],
      "constraints": { "type": "range", "min": 0, "max": 999999.99 }
    }
  ]
}
```

The FireKicks dataset ships with a complete annotation file: `configs/annotations-firekicks.json` (23 tables, 189 columns).

## 4. Design a Tag Taxonomy

Tags are the primary mechanism for controlling what AI agents see. Design your taxonomy with these categories:

### Domain Tags

| Tag | Tables |
|-----|--------|
| `sales` | orders, order_items, retail_partners, daily_sales_summary |
| `customer` | customers, customer_addresses, customer_preferences, customer_segments_history |
| `product` | products, product_reviews, product_performance |
| `marketing` | campaigns, campaign_performance, email_events, customer_acquisition, website_traffic |
| `operations` | product_suppliers, inventory, shipping_performance, returns |
| `finance` | daily_sales_summary, monthly_financials |

### Nature Tags

| Tag | Meaning | Examples |
|-----|---------|----------|
| `transactional` | Event/fact tables | orders, order_items, email_events |
| `master-data` | Dimension/reference tables | customers, products, product_suppliers |
| `summary` | Pre-aggregated tables | daily_sales_summary, monthly_financials |
| `events` | Time-series event data | email_events, campaign_performance |
| `view` | Computed/virtual views | product_performance, campaign_roi_summary |

### Maturity Tags

| Tag | When to Use |
|-----|-------------|
| `raw` | Unprocessed upstream tables — hide from AI |
| `curated` | Cleaned, validated, AI-ready — show to AI |

### Sensitivity Tags

| Tag | When to Use |
|-----|-------------|
| `pii` | Contains personally identifiable information (email, phone, address) |
| `financial` | Contains revenue, cost, or pricing data |

## 5. Query the Dictionary

Once your data dictionary is populated, query it using the non-admin dictionary API.

### All Tables for a Connection

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks" | jq '.tables[] | {table, businessName, grain}'
```

### Filter by Domain

```bash
# Sales tables only
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks&tags=sales" | jq '.tables[] | .table'
```

Returns: `orders`, `order_items`, `retail_partners`, `daily_sales_summary`

### Financial Data Without PII

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&tags=financial&excludeTags=pii" \
  | jq '.columns[] | {table, column, semanticType}'
```

Returns financial columns like `subtotal`, `tax_amount`, `total_amount`, `discount_amount` — but excludes any PII-tagged columns.

### All Measure Columns

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&semanticType=measure" \
  | jq '.columns[] | {table, column, description}'
```

Returns every numeric column meant for aggregation: `total_amount`, `subtotal`, `quantity`, `unit_price`, `discount_amount`, etc.

### Columns for a Specific Table

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&table=orders" \
  | jq '.columns[] | {column, semanticType, dataClassification}'
```

### All PII Columns (Compliance Review)

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&dataClassification=pii" \
  | jq '.columns[] | {table, column, description}'
```

Returns columns like `customers.email`, `customers.phone`, `customer_addresses.street_address` — useful for data governance and compliance audits.

## 6. AI Routing with Tags

### The Problem

When an AI agent sees 23 tables, it wastes tokens reading irrelevant schemas, gets confused between similar tables (e.g., `orders` vs `daily_sales_summary`), and may join to the wrong tables.

### The Solution

Use tags to control visibility:

1. **Tag raw upstream tables** as `raw`
2. **Create curated views** that clean, aggregate, or simplify raw data
3. **Tag views** as `curated` (and/or domain tags like `product`, `sales`)
4. **Query the dictionary** with `excludeTags=raw` so the AI only sees the curated surface

### Example: Product Analytics

The FireKicks dataset has a `product_performance` view (tagged `product, performance, view`) that pre-joins `products` + `order_items` + `product_reviews` into a single clean surface with per-product metrics (total orders, units, revenue, avg rating, review count).

An AI querying with `excludeTags=raw`:
- **Sees**: `product_performance` (clean, pre-aggregated, one row per product)
- **Doesn't see**: `products` + `order_items` + `product_reviews` (three raw tables requiring complex joins)

Result: fewer tables, fewer tokens, simpler queries, more accurate results.

### Token Economics

| Approach | Tables Visible | Schema Tokens | Query Accuracy |
|----------|---------------|---------------|----------------|
| No filtering | 23 tables | ~4,000 tokens | Lower — AI may pick wrong tables |
| `excludeTags=raw` | 10-15 curated tables | ~2,000 tokens | Higher — AI sees clean surfaces |
| Domain-specific (`tags=sales`) | 4-5 tables | ~500 tokens | Highest — minimal context, precise |

## 7. Putting It Together: AI Agent Workflow

Here's the complete workflow an AI agent follows when answering a data question:

### Step 1: Discover Available Tables

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks&excludeTags=raw" \
  | jq '.tables[] | {table, businessName, grain, usageNotes}'
```

The agent learns which tables exist, what each row represents, and when to use each one.

### Step 2: Understand the Relevant Columns

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&table=orders" \
  | jq '.columns[] | {column, semanticType, description, constraints, usageNotes}'
```

The agent sees semantic types (which columns to aggregate vs. group by), valid values (constraints), and usage guidance.

### Step 3: Check Constraints Before Filtering

The agent sees `order_status` has constraint `{"type": "enum", "values": ["pending", "processing", "shipped", "delivered", "cancelled"]}`. It won't generate `WHERE order_status = 'complete'` — it knows to use `delivered`.

### Step 4: Use Relationships to Build Joins

The agent reads the relationships on `orders` and sees:
- `orders.customer_id = customers.customer_id` — join for customer info
- `orders.order_id = order_items.order_id` — join for line item detail
- `orders.order_id = shipping_performance.order_id` — join for delivery tracking

### Step 5: Build the Query

With dictionary context, the agent builds an accurate AST query:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "table": "c", "column": "customer_segment" } } },
      { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "order_count" },
      { "expr": { "function": { "name": "sum", "args": [{ "column": { "table": "o", "column": "total_amount" } }] } }, "alias": "revenue" }
    ],
    "from": { "table": { "table": "orders", "alias": "o" } },
    "joins": [{
      "type": "JOIN_INNER",
      "table": { "table": "customers", "alias": "c" },
      "on": { "binary": { "op": "BINARY_OP_EQ", "left": { "column": { "table": "o", "column": "customer_id" } }, "right": { "column": { "table": "c", "column": "customer_id" } } } }
    }],
    "where": {
      "binary": {
        "op": "BINARY_OP_IN",
        "left": { "column": { "table": "o", "column": "order_status" } },
        "right": { "list": { "items": [{ "literal": { "stringValue": "shipped" } }, { "literal": { "stringValue": "delivered" } }] } }
      }
    },
    "groupBy": [{ "expr": { "column": { "table": "c", "column": "customer_segment" } } }],
    "orderBy": [{ "expr": { "column": { "column": "revenue" } }, "dir": "SORT_DESC" }]
  }
}
```

The agent correctly:
- Uses `total_amount` (not `subtotal`) for revenue because the dictionary said it includes tax and shipping
- Filters to `shipped` and `delivered` because usage notes say to exclude cancelled for financial reports
- Joins on `customer_id` because relationships documented the join hint
- Groups by `customer_segment` (a dimension) and sums `total_amount` (a measure)

**Without the dictionary**, the same agent might use `subtotal` instead of `total_amount`, include cancelled orders, or fail to find the right join column.

## Next Steps

- **[Concepts](./concepts.md)** — Deeper coverage of dictionary annotations, tag semantics, ACL model, staged queries, and stored definitions
- **[Reference](./reference.md)** — Full API specification for dictionary query endpoints, admin annotation endpoints, and all data-plane operations
- **[Getting Started](./getting-started.md)** — Generic tutorial covering the full DAS feature set with simple examples
- **Data Dictionary Guide** — See `docs/DATA_DICTIONARY.md` in the [DAS repository](https://github.com/firebrandanalytics/ff-services-data-access) for the complete annotation specification and best practices
