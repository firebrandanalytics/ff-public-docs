# FireKicks Tutorial — Building a Complete AI Data Layer

This multi-part tutorial walks through setting up the Data Access Service for the **FireKicks** synthetic shoe company — from registering a database connection through building a complete five-layer knowledge architecture that enables AI agents to query enterprise data accurately and autonomously.

Each part combines **conceptual design** (why, how to think about it) with **mechanical steps** (how to load it into DAS), using FireKicks as the worked example throughout.

## What You'll Build

By the end of this tutorial, you'll have:

1. A registered database connection with access controls
2. A data dictionary with 23 table annotations and 189 column annotations
3. Stored definitions (views, UDFs) that simplify raw data into AI-friendly surfaces
4. An ontology mapping business concepts to database structures
5. Process models encoding business rules and tribal knowledge
6. A querying workflow that uses all five layers for context-aware analysis
7. Named entity resolution with value stores and fuzzy matching
8. CSV upload workflows for ad-hoc analysis with external data

## The FireKicks Company

FireKicks is a synthetic athletic footwear company with an e-commerce platform and retail distribution network. The dataset models a realistic mid-size retailer with:

- **~10,000 customers** segmented into Premium (10%), Athlete (20%), Regular (40%), and Bargain-Hunter (30%) tiers
- **~200 products** across 5 categories (running, basketball, casual, training, kids) and 8 brand lines
- **~131,000 orders** from 2022-2025 across online, retail, wholesale, and direct channels
- **~350,000 line items** averaging 2.7 items per order
- **50 retail partners** (specialty, big-box, boutique) with geographic distribution
- **80 marketing campaigns** with daily performance metrics and ~250K email events
- **Pre-aggregated summaries** for daily sales and monthly financials

The data includes realistic patterns: seasonal spikes (Q4 holidays, back-to-school), year-over-year growth, customer segment migrations, and geographic distribution with PostGIS spatial support.

## Dataset Overview

### Business Domains

| Domain | Tables | Description |
|--------|--------|-------------|
| **Sales** | orders, order_items, retail_partners | Core transaction data — orders, line items, retail distribution |
| **Products** | products, product_suppliers, inventory, product_reviews | Product catalog, supply chain, stock levels, customer reviews |
| **Customers** | customers, customer_addresses, customer_preferences, customer_segments_history | Customer profiles, addresses, preferences, segment tracking |
| **Marketing** | campaigns, campaign_performance, email_events, customer_acquisition, website_traffic | Campaign management, performance metrics, acquisition channels |
| **Finance & Ops** | daily_sales_summary, monthly_financials, shipping_performance, returns | Pre-aggregated summaries, shipping SLAs, return tracking |

### Computed Views

| View | Description |
|------|-------------|
| `product_performance` | Per-product metrics: orders, units, revenue, avg rating, review count |
| `campaign_roi_summary` | Per-campaign ROI: spend, revenue, impressions, clicks, conversions |
| `customer_nearest_store` | Per-customer nearest retail partner with distance (PostGIS) |

SQL source files for these views are in [`data/views/`](./data/views/).

### Core Relationships

```
customers (10K)
  ├── orders (131K)           — customer_id
  │     ├── order_items (350K)  — order_id
  │     │     └── products (200) — product_id
  │     ├── shipping_performance (131K) — order_id
  │     └── returns (8.5K)     — order_id
  ├── customer_addresses (14K) — customer_id
  ├── customer_preferences (10K) — customer_id
  └── customer_segments_history (18K) — customer_id

campaigns (80)
  ├── campaign_performance (5K) — campaign_id (daily metrics)
  └── email_events (250K)      — campaign_id + customer_id

products (200)
  ├── product_suppliers (25)   — supplier_id
  ├── inventory (800)          — product_id (per-warehouse)
  └── product_reviews (25K)    — product_id + customer_id
```

### Table Reference

| Table | Rows | Domain | Description |
|-------|------|--------|-------------|
| `orders` | 131,000 | Sales | Customer orders with channel, financials, status |
| `order_items` | 350,000 | Sales | Line items: product, quantity, price, discount |
| `retail_partners` | 50 | Sales | Retail distribution partners with locations |
| `products` | 200 | Product | Product catalog: category, brand, pricing, lifecycle |
| `product_suppliers` | 25 | Product | Manufacturing partners: country, lead time, quality |
| `inventory` | 800 | Product | Stock by product and warehouse location |
| `product_reviews` | 25,000 | Product | Customer ratings and reviews (1-5 stars) |
| `customers` | 10,000 | Customer | Profiles: demographics, segment, lifetime value, location |
| `customer_addresses` | 14,000 | Customer | Mailing addresses with primary flag |
| `customer_preferences` | 10,000 | Customer | Category preference, shoe size, price sensitivity |
| `customer_segments_history` | 18,000 | Customer | Historical segment changes with reasons |
| `campaigns` | 80 | Marketing | Campaign definitions: type, budget, target segment |
| `campaign_performance` | 5,000 | Marketing | Daily metrics: impressions, clicks, conversions, spend |
| `email_events` | 250,000 | Marketing | Email interactions: sent, opened, clicked, converted |
| `customer_acquisition` | 7,300 | Marketing | Daily acquisition by channel with cost |
| `website_traffic` | 1,461 | Marketing | Daily web analytics: sessions, bounce rate, conversions |
| `daily_sales_summary` | 4,400 | Finance | Pre-aggregated daily sales by channel |
| `monthly_financials` | 48 | Finance | Monthly P&L: revenue, COGS, expenses, profit |
| `shipping_performance` | 131,000 | Operations | Per-order shipping: carrier, method, on-time flag |
| `returns` | 8,500 | Operations | Product returns: reason, refund amount |
| `product_performance` | 200 | (view) | Aggregated product scorecard |
| `campaign_roi_summary` | 80 | (view) | Per-campaign ROI calculation |
| `customer_nearest_store` | 10,000 | (view) | Nearest retail partner per customer (PostGIS) |

## Prerequisites

- Data Access Service running (gRPC on `:50051`, HTTP on `:8080`)
- `ff-da` CLI installed (`go build -o ~/.local/bin/ff-da ./cmd/ff-da` from the DAS repo)
- PostgreSQL access to the FireKicks database

```bash
# ff-da CLI environment variables
export DA_HOST=localhost
export DA_HTTP_PORT=8080
export DA_GRPC_PORT=50051
export DA_API_KEY=dev-api-key
export DA_IDENTITY=user:tutorial

# FireKicks database credentials (for DAS connection config)
export FIREKICKS_DB_USER=fireiq_data
export FIREKICKS_DB_PASSWORD=<your-password>
```

## Register the Connection

The Data Access Service needs a connection definition to access FireKicks. The sample file is provided at [`data/firekicks-connection.json`](./data/firekicks-connection.json):

```json
{
  "name": "firekicks",
  "type": "postgresql",
  "description": "FireKicks shoe company dataset (20 tables, ~131K orders)",
  "allow_raw_sql": true,
  "config": {
    "host": "firebrand-ai4bi-pg.postgres.database.azure.com",
    "port": 5432,
    "database": "firekicks",
    "sslMode": "require"
  },
  "credentials": {
    "method": "env",
    "envMappings": {
      "username": "FIREKICKS_DB_USER",
      "password": "FIREKICKS_DB_PASSWORD"
    }
  },
  "pool": {
    "maxOpen": 5,
    "maxIdle": 2,
    "maxLifetime": "300s"
  },
  "limits": {
    "maxRows": 10000,
    "maxBytes": 10485760,
    "queryTimeout": "30s",
    "requestsPerMinute": 100
  }
}
```

Upload it via the admin API:

```bash
ff-da admin connections create --file data/firekicks-connection.json
```

```
Connection created successfully.
  Name: firekicks
```

Verify and test the connection:

```bash
ff-da admin connections test --name firekicks
```

```
Connection: firekicks
Status:     ok
Duration:   45ms
```

Key configuration decisions:

- **`allow_raw_sql: true`** — Enables direct SQL queries. Set to `false` for production agents that should only use AST queries (which enforce ACL and prevent injection).
- **`credentials.method: env`** — Credentials are read from environment variables, never stored in config files. This allows rotation without service restarts.
- **`pool`** — Conservative settings (5 open / 2 idle) appropriate for a tutorial dataset. Production would scale based on concurrency needs.
- **`limits`** — Safety guardrails. `maxRows: 10000` prevents accidental full-table scans from overwhelming the response.

## Configure Access Control

Access control is defined in [`data/firekicks-acl.json`](./data/firekicks-acl.json):

```json
{
  "acl": [
    {
      "identity": "user:admin",
      "connections": ["*"],
      "allow_raw_sql": true
    },
    {
      "identity": "app:query-explainer",
      "connections": ["firekicks"],
      "allow_raw_sql": false
    }
  ],
  "function_blacklist": {
    "global": [
      "pg_sleep",
      "pg_terminate_backend",
      "pg_cancel_backend",
      "lo_import",
      "lo_export",
      "pg_read_file",
      "pg_read_binary_file",
      "pg_ls_dir",
      "pg_stat_file",
      "dblink",
      "dblink_exec",
      "pg_advisory_lock"
    ]
  }
}
```

> **Note:** ACL configuration is loaded by the Data Access Service at startup. Place the file in the service's config directory or pass it via the `--acl-config` flag.

The ACL defines two identities:

- **`user:admin`** — Full access to all connections with raw SQL. Used for administrative tasks and this tutorial.
- **`app:query-explainer`** — Access to FireKicks only, no raw SQL. Represents a typical AI agent that must use the AST API (which enforces table/column ACL and prevents SQL injection).

The function blacklist blocks PostgreSQL functions that could be dangerous: sleep/timing attacks, process termination, file system access, and external database links.

## Explore the Schema

With the connection registered, use `ff-da` to explore:

### List Connections

```bash
ff-da connections
```

```
NAME        TYPE         DESCRIPTION
firekicks   postgresql   FireKicks shoe company dataset (20 tables, ~131K orders)
```

### Browse All Tables

```bash
ff-da schema --connection firekicks
```

This returns all 20+ tables with their columns and types.

### Inspect a Specific Table

```bash
ff-da schema --connection firekicks --table orders
```

You'll see columns like `order_id`, `customer_id`, `order_date`, `total_amount`, `order_status`, `order_channel`, `created_at` — but the schema only tells you **types**, not **meaning**.

Questions the schema doesn't answer:
- Is `total_amount` the subtotal or the final total (with tax and shipping)?
- Should you filter on `order_date` or `created_at` for business reporting?
- What are the valid values for `order_status`?
- Which columns are personally identifiable information?

That's what the data dictionary answers — and it's the subject of [Part 1](./01-data-dictionary.md).

## First Queries

Before diving into the dictionary, let's confirm the connection works:

```bash
ff-da query --connection firekicks --sql "
  SELECT order_channel, COUNT(*) as orders,
         ROUND(SUM(total_amount)::numeric, 2) as revenue
  FROM orders
  GROUP BY order_channel
  ORDER BY revenue DESC"
```

```bash
ff-da query --connection firekicks --sql "
  SELECT customer_segment, COUNT(*) as customers,
         ROUND(AVG(lifetime_value)::numeric, 2) as avg_ltv
  FROM customers
  GROUP BY customer_segment
  ORDER BY avg_ltv DESC"
```

These queries work — but an AI agent generating them would need to know that `total_amount` includes tax and shipping (not just the subtotal), that `customer_segment` has exactly 4 values, and that `order_channel` has 4 valid values. Without that context, the AI is guessing.

## Tutorial Parts

| Part | Title | Layer | What You'll Learn |
|------|-------|-------|-------------------|
| [1](./01-data-dictionary.md) | **Data Dictionary** | Layer 2 | Design and build semantic annotations — descriptions, types, tags, constraints, relationships |
| [2](./02-stored-definitions.md) | **Stored Definitions** | Layer 2+ | Create virtual views, UDFs, and TVFs that simplify raw data for AI consumption |
| [3](./03-ontology.md) | **Ontology** | Layer 3 | Model business concepts, entity types, relationships, and cross-database mappings |
| [4](./04-process-models.md) | **Process Models** | Layer 4 | Encode business processes, rules, tribal knowledge, and calendar context |
| [5](./05-querying.md) | **Querying & Analysis** | All | AST and SQL queries, scratch pad, context-aware analysis using all five layers |
| [6](./06-value-resolution.md) | **Named Entity Resolution** | NER | Value stores, fuzzy matching, personalized scopes, and the learning loop |
| [7](./07-csv-upload.md) | **CSV Upload & Ad-Hoc Data** | Scratch Pad | Upload CSV files, join with database data, system vs user scratch pads |

Each part builds on the previous — the dictionary informs stored definitions, stored definitions feed the ontology, the ontology connects to process models, and querying brings it all together.

## Related Documentation

- **[DAS Overview](../README.md)** — Service architecture and capabilities
- **[Concepts](../concepts.md)** — Core concepts: AST queries, SQL serialization, ACL, staged queries, scratch pad
- **[Getting Started](../getting-started.md)** — Generic tutorial with simple examples
- **[Reference](../reference.md)** — Full API specification
