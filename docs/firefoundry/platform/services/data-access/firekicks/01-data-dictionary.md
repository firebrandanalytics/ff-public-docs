# Part 1: Data Dictionary

The data dictionary is a semantic annotation layer that enriches raw database schema with business meaning. While `GetSchema` tells AI agents *what tables and columns exist*, the data dictionary tells them *what those tables and columns mean, how to use them, and what to watch out for*.

This part covers designing a data dictionary from scratch — what to include, how to collect the information, and how to load it into the Data Access Service.

## What Is a Data Dictionary?

A database schema tells you that `orders.total_amount` is `NUMERIC(10,2)`. A data dictionary tells you:

- It's the **final order total** including subtotal, tax, and shipping, minus discounts
- It's a **financial measure** (semanticType: `measure`, classification: `financial`)
- It ranges from **$9.99 to $999.99** with an average of $89.45
- You should use it for **revenue calculations** — not `subtotal`, which excludes tax and shipping
- It's **never null** (0 null count across 131,000 orders)

Without this context, an AI agent might use `subtotal` instead of `total_amount` for revenue reports, include cancelled orders in financial aggregations, or filter on `created_at` instead of `order_date` for business reporting. The dictionary eliminates this guesswork.

## The Annotation Model

The Data Access Service supports two types of annotations: **table annotations** and **column annotations**.

### Table Annotations

| Field | Type | Purpose |
|-------|------|---------|
| `description` | Text | What this table contains, its scope, and approximate size |
| `businessName` | Text | Human-friendly name (e.g., "Customer Orders" vs `orders`) |
| `grain` | Text | What each row represents (e.g., "One row per order") |
| `tags` | Text[] | Categorical labels for filtering and routing |
| `statistics` | JSON | Row count, average row size |
| `relationships` | JSON | How this table joins to other tables |
| `qualityNotes` | JSON | Known data issues, completeness, freshness |
| `usageNotes` | Text | When and how to use this table — and when NOT to |

### Column Annotations

| Field | Type | Purpose |
|-------|------|---------|
| `description` | Text | What this column represents |
| `businessName` | Text | Human-friendly name |
| `semanticType` | Text | Role in queries: identifier, measure, dimension, temporal, descriptive |
| `dataClassification` | Text | Sensitivity: public, internal, financial, pii |
| `tags` | Text[] | Categorical labels |
| `sampleValues` | Text[] | Example values for context |
| `statistics` | JSON | Min, max, avg, distinct count, null count |
| `valuePattern` | Text | Natural language description of value format |
| `constraints` | JSON | Valid values: enum lists, ranges, regex patterns |
| `relationships` | JSON | Joins to other tables (loose foreign keys) |
| `qualityNotes` | JSON | Null rates, known data issues |
| `usageNotes` | Text | Query guidance — "Use X, NOT Y for business reporting" |

## Semantic Types

Semantic types classify how a column is used in queries. AI agents use them to make better decisions — automatically applying `SUM()` to measures and `GROUP BY` to dimensions.

| Type | Meaning | FireKicks Examples |
|------|---------|-------------------|
| `identifier` | Primary/foreign keys, unique IDs | `order_id`, `customer_id`, `product_id`, `sku` |
| `measure` | Numeric values meant for aggregation | `total_amount`, `quantity`, `unit_price`, `discount_amount` |
| `dimension` | Categorical values for grouping and filtering | `order_status`, `order_channel`, `customer_segment`, `category` |
| `temporal` | Date/time columns | `order_date`, `created_at`, `ship_date`, `registration_date` |
| `descriptive` | Free text, names, labels | `product_name`, `first_name`, `review_text`, `partner_name` |

When an AI sees a column typed as `measure`, it knows to use aggregate functions (`SUM`, `AVG`, `COUNT`). When it sees `dimension`, it knows to use `GROUP BY` or `WHERE` filters. When it sees `temporal`, it knows to use date functions and ranges.

## Data Classifications

Classifications indicate sensitivity level. They help AI agents (and governance systems) understand what data requires special handling.

| Classification | Meaning | FireKicks Examples |
|---------------|---------|-------------------|
| `public` | Non-sensitive business data | `order_status`, `product_name`, `category` |
| `internal` | Internal-only information | `commission_rate`, `base_cost` |
| `financial` | Revenue, cost, pricing data | `total_amount`, `subtotal`, `unit_price`, `refund_amount` |
| `pii` | Personally identifiable information | `email`, `phone`, `street_address` |

An AI agent querying with `excludeTags=pii` would never see customer email addresses, phone numbers, or street addresses — only aggregated or non-identifying data.

## How to Collect Dictionary Information

Building a data dictionary is an investigative process. Here's how to gather the information you need:

### 1. Talk to Domain Experts

The people who use the data daily know things the schema doesn't capture:
- What does each table actually represent in the business?
- What are the valid values for status/category columns?
- Which date column should reports use?
- What are the known data quality issues?
- What columns are sensitive or regulated?

### 2. Analyze the Data

Run exploratory queries to discover statistics and patterns:

```bash
# Row count and null analysis
ff-da query --connection firekicks --sql "
  SELECT COUNT(*) as rows,
         COUNT(DISTINCT order_status) as status_values,
         COUNT(*) FILTER (WHERE order_status IS NULL) as status_nulls
  FROM orders"

# Value distribution for dimension columns
ff-da query --connection firekicks --sql "
  SELECT order_status, COUNT(*) as count
  FROM orders GROUP BY order_status ORDER BY count DESC"

# Statistics for measure columns
ff-da query --connection firekicks --sql "
  SELECT MIN(total_amount), MAX(total_amount),
         ROUND(AVG(total_amount)::numeric, 2) as avg,
         COUNT(DISTINCT total_amount) as distinct_values
  FROM orders"
```

### 3. Review Existing Documentation

Check for existing data models, ERDs, wiki pages, or data governance documents. These often contain business definitions and data lineage that belong in the dictionary.

### 4. Examine Query Patterns

If you have query logs, analyze which columns are most frequently used together. This reveals natural relationships and common join patterns that should be documented.

### 5. Automate with FireIQ

[FireIQ](https://firefoundry.io/marketplace/fireiq), a product in the FireFoundry marketplace, provides AI agents that can analyze your schema, sample data, and existing documentation to bootstrap dictionary annotations automatically. The agents profile each table, detect enum values, infer semantic types, and generate draft annotations for human review.

This tutorial walks through the manual process so you understand what goes into a dictionary and why.

## Design a Tag Taxonomy

Tags are the primary mechanism for controlling what AI agents see. Before creating annotations, design a tag taxonomy that supports your routing needs.

### Domain Tags

Assign each table to one or more business domains:

| Tag | Tables |
|-----|--------|
| `sales` | orders, order_items, retail_partners, daily_sales_summary |
| `customer` | customers, customer_addresses, customer_preferences, customer_segments_history |
| `product` | products, product_reviews, product_performance (view) |
| `marketing` | campaigns, campaign_performance, email_events, customer_acquisition, website_traffic |
| `operations` | product_suppliers, inventory, shipping_performance, returns |
| `finance` | daily_sales_summary, monthly_financials |

### Nature Tags

Classify what kind of data the table holds:

| Tag | Meaning | Examples |
|-----|---------|----------|
| `transactional` | Event/fact tables with one row per event | orders, order_items, email_events |
| `master-data` | Dimension/reference tables | customers, products, product_suppliers |
| `summary` | Pre-aggregated tables | daily_sales_summary, monthly_financials |
| `events` | Time-series event data | email_events, campaign_performance |
| `view` | Computed/virtual views | product_performance, campaign_roi_summary |

### Maturity Tags

Control AI visibility based on data readiness:

| Tag | Use When |
|-----|----------|
| `raw` | Unprocessed upstream tables — hide from AI agents |
| `curated` | Cleaned, validated, AI-ready — show to AI agents |

### Sensitivity Tags

Flag data that requires special handling:

| Tag | Use When |
|-----|----------|
| `pii` | Table/column contains personally identifiable information |
| `financial` | Table/column contains revenue, cost, or pricing data |

### Tag Assignment Example

Here's how FireKicks tables map to tags:

| Table | Tags |
|-------|------|
| `orders` | `sales`, `transactional` |
| `customers` | `customer`, `master-data` |
| `products` | `product`, `catalog` |
| `daily_sales_summary` | `sales`, `finance`, `summary` |
| `product_performance` | `product`, `performance`, `view` |
| `email_events` | `marketing`, `events` |
| `customer_addresses` | `customer`, `logistics` |
| `product_suppliers` | `operations`, `supply-chain` |

## Load Table Annotations

With the design complete, load annotations into DAS. Set up the HTTP variables:

```bash
export DA_URL=http://localhost:8080
export API_KEY=dev-api-key
```

### Annotate the Orders Table

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
    "statistics": { "rowCount": 131072, "avgRowSizeBytes": 200 },
    "relationships": [
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
    ],
    "qualityNotes": {
      "completeness": "100%",
      "knownIssues": ["retail_partner_id is NULL for ~65% of orders (expected for non-retail channels)"]
    },
    "usageNotes": "Primary fact table for sales analysis. Use order_date for business date filtering, NOT created_at (which is the system timestamp). total_amount includes tax and shipping. For line-item detail, join to order_items."
  }'
```

### Annotate the Customers Table

```bash
curl -s -X POST "$DA_URL/admin/annotations/tables" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "customers",
    "description": "Customer master data with demographics, segmentation, and lifetime value. ~10,000 customers segmented into Premium, Athlete, Regular, and Bargain-Hunter tiers.",
    "businessName": "Customer Profiles",
    "grain": "One row per customer",
    "tags": ["customer", "master-data"],
    "statistics": { "rowCount": 10000, "avgRowSizeBytes": 320 },
    "qualityNotes": {
      "completeness": "99%",
      "knownIssues": ["phone is nullable, ~30% null"]
    },
    "usageNotes": "Primary customer dimension. Use customer_segment for tier analysis. lifetime_value is cumulative actual spending, not a prediction. For nearest-store analysis, use the customer_nearest_store view."
  }'
```

## Load Column Annotations

Column annotations add semantic meaning to individual fields. Here are the key columns on the `orders` table:

### Identifier Column

```bash
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
```

### Measure Column (Financial)

```bash
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "orders",
    "column": "total_amount",
    "description": "Final order total including subtotal, tax, shipping, minus discounts. This is the revenue figure for financial reporting.",
    "businessName": "Order Total",
    "semanticType": "measure",
    "dataClassification": "financial",
    "tags": ["sales", "financial"],
    "sampleValues": ["29.99", "149.50", "299.00"],
    "statistics": { "min": 9.99, "max": 999.99, "avg": 89.45, "nullCount": 0 },
    "valuePattern": "Decimal USD amount, typically 9.99 to 999.99",
    "usageNotes": "Use for revenue calculations. Includes tax and shipping. For subtotal only, use the subtotal column."
  }'
```

### Temporal Column

```bash
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
```

### Dimension Column with Constraints

```bash
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
    "constraints": {
      "type": "enum",
      "values": ["pending", "processing", "shipped", "delivered", "cancelled"]
    },
    "usageNotes": "Filter to shipped+delivered for revenue reports. Use pending+processing for pipeline analysis. Cancelled orders should be excluded from financial aggregations."
  }'
```

### PII Column

```bash
curl -s -X POST "$DA_URL/admin/annotations/columns" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "firekicks",
    "table": "customers",
    "column": "email",
    "description": "Customer email address used for account login and marketing communications",
    "businessName": "Email Address",
    "semanticType": "identifier",
    "dataClassification": "pii",
    "tags": ["customer", "pii"],
    "statistics": { "distinctCount": 10000, "nullCount": 0 },
    "valuePattern": "Standard email format (user@domain.com)"
  }'
```

## Statistics

Statistics give AI agents quantitative context about data distribution.

**Table-level** — how big is the data:

```json
{ "rowCount": 131072, "avgRowSizeBytes": 200 }
```

**Column-level** — what values exist (type-appropriate):

```json
// Numeric measure
{ "min": 9.99, "max": 999.99, "avg": 89.45, "distinctCount": 4500, "nullCount": 0 }

// Dimension
{ "distinctCount": 5, "nullCount": 0 }

// Temporal
{ "min": "2022-01-01", "max": "2025-12-31", "distinctCount": 1461, "nullCount": 0 }
```

Statistics prevent errors. An AI won't filter `total_amount > 10000` if it knows the max is 999.99. It won't expect more than 5 distinct statuses if the statistics say `distinctCount: 5`.

## Constraints

Constraints define valid values. They serve two purposes: the AI can use them to generate correct filters, and the service can validate AI-generated values before hitting the database.

```json
// Enum — fixed set of valid values
{ "type": "enum", "values": ["pending", "processing", "shipped", "delivered", "cancelled"] }

// Range — valid numeric bounds
{ "type": "range", "min": 0, "max": 999999.99 }

// Regex — value format pattern
{ "type": "regex", "pattern": "^FK-\\d{8}$" }
```

When an AI generates `WHERE order_status = 'complete'`, the constraint reveals that `complete` is not valid — the correct value is `delivered`.

## Relationships

Relationships document how tables join. This is critical for AI agents that need to build multi-table queries, especially when the database doesn't have explicit foreign key constraints.

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
  }
]
```

The `joinHint` field gives the AI the exact join condition. The `type` field indicates cardinality: `parent` means this table has children in the target (1:N), `child` means this table references a parent (N:1).

## Quality Notes and Usage Guidance

**Quality notes** warn about known data issues:

```json
{
  "completeness": "99%",
  "knownIssues": ["phone is nullable, ~30% null"],
  "freshness": "updated as customers register"
}
```

**Usage notes** provide direct guidance:

> "Use `order_date` for business reporting, NOT `created_at`. `created_at` is a system timestamp and may differ from the business date."

> "For revenue reports, filter to `order_status IN ('shipped', 'delivered')`. Cancelled orders should be excluded."

These notes are the dictionary's most valuable field for AI — they encode the tribal knowledge that would otherwise require asking a domain expert.

## Bulk Import

For the full FireKicks dataset with 23 tables and 189 columns, use the bulk import endpoint:

```bash
curl -s -X POST "$DA_URL/admin/annotations/import" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @configs/annotations-firekicks.json
```

The JSON file contains both table and column annotations:

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

The FireKicks dataset ships with a complete annotation file at `configs/annotations-firekicks.json` in the DAS repository.

## Query the Dictionary

Once annotations are loaded, query them using the dictionary API. This is the API that AI agents call at query time to discover what data is available.

### All Tables for a Connection

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks" \
  | jq '.tables[] | {table, businessName, grain}'
```

### Filter by Domain

```bash
# Sales tables only
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks&tags=sales" \
  | jq '.tables[] | .table'
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

Returns every numeric column meant for aggregation across the entire dataset.

### All PII Columns (Compliance)

```bash
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/columns?connection=firekicks&dataClassification=pii" \
  | jq '.columns[] | {table, column, description}'
```

Useful for data governance audits — shows exactly which columns contain personally identifiable information.

## AI Routing with Tags

### The Problem

When an AI agent sees 23 tables, it wastes tokens reading irrelevant schemas, gets confused between similar tables (`orders` vs `daily_sales_summary`), and may join to the wrong tables.

### The Solution

Use tags to control visibility. Tag raw tables, create curated views (covered in [Part 2](./02-stored-definitions.md)), and have agents query with `excludeTags=raw`:

```bash
# Agent only sees curated, AI-ready tables
curl -s -H "X-Api-Key: $API_KEY" \
  "$DA_URL/v1/dictionary/tables?connection=firekicks&excludeTags=raw"
```

### Token Economics

| Approach | Tables Visible | Schema Tokens | Query Accuracy |
|----------|---------------|---------------|----------------|
| No filtering | 23 tables | ~4,000 tokens | Lower — AI may pick wrong tables |
| `excludeTags=raw` | 10-15 curated | ~2,000 tokens | Higher — AI sees clean surfaces |
| Domain-specific (`tags=sales`) | 4-5 tables | ~500 tokens | Highest — minimal context |

Fewer tables means fewer tokens, faster responses, and more accurate queries. This is why the tag taxonomy design matters.

## Summary

You've learned how to:

1. **Design** a data dictionary — what fields to include and why
2. **Collect** the information — domain experts, data analysis, documentation
3. **Categorize** with a tag taxonomy — domains, nature, maturity, sensitivity
4. **Load** annotations into DAS — table-level, column-level, and bulk import
5. **Query** the dictionary — filter by tags, semantic type, and classification
6. **Route** AI agents — use tags to control what data the AI sees

The dictionary is the foundation for everything that follows. In [Part 2](./02-stored-definitions.md), you'll create stored definitions (views, UDFs, TVFs) that build on the dictionary to provide curated data surfaces for AI agents.
