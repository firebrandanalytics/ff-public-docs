# Part 3: Ontology

The ontology layer models business concepts and maps them to database structures. While the data dictionary ([Part 1](./01-data-dictionary.md)) annotates individual tables and columns, and stored definitions ([Part 2](./02-stored-definitions.md)) create curated data surfaces, the ontology answers a different question: **what business entities exist, how do they relate to each other, and where do they live in the database?**

This part covers designing an ontology for the FireKicks dataset and loading it into the Data Access Service.

## What Is a Data Ontology?

A data ontology is a formal model of the business concepts in your domain. It bridges the gap between how humans talk about the business and how data is stored in databases.

Consider these business questions:
- "Show me **customer** revenue by segment" — What is a "customer"? Which tables? Which columns?
- "Compare **product** performance across categories" — What makes something a "product"? Where are categories stored?
- "What's the ROI on our **Q4 campaigns**?" — What is a "campaign"? What does "Q4" mean in your fiscal calendar?

Without an ontology, an AI agent must infer these mappings from schema and dictionary alone. With an ontology, the mappings are explicit:
- "Customer" → `customers` table, `customer_id` is the ID, `customer_segment` is the category
- "Product" → `products` table, `product_id` is the ID, `category` is the grouping
- "Campaign" → `campaigns` table, `campaign_id` is the ID, `campaign_type` is the category

### What the Ontology Adds Beyond the Dictionary

| Layer | Answers | Example |
|-------|---------|---------|
| Dictionary | "What does this column mean?" | `total_amount` is the final order total including tax |
| Ontology | "What business entity is this about?" | `total_amount` is the **amount** role on the **Order** entity |
| Dictionary | "What are the valid values?" | `order_status` has 5 values: pending, processing, shipped, delivered, cancelled |
| Ontology | "How do entities relate?" | **Customer** places **Order**, **Order** contains **OrderItem**, **OrderItem** references **Product** |
| Dictionary | "What is `customer_segment`?" | A dimension column with 4 values |
| Ontology | "When someone says 'Premium', do they mean a customer segment or a product tier?" | "Premium" → **Customer** entity (context clue: segment) |

## The Ontology Model

The Data Access Service ontology uses five node types and nine edge types, organized into domains.

### Node Types

#### Domains

Top-level groupings for related entity types and concepts. Each domain is independently versioned and can be exported/imported as a unit.

```json
{
  "name": "sales",
  "description": "Order processing, line items, and retail distribution",
  "owner": "sales-team"
}
```

#### Entity Types

Business concepts that map to one or more database tables. Each entity type has a name, description, and optional context clues for disambiguation.

```json
{
  "name": "Customer",
  "domain": "customer",
  "description": "Individual or business that purchases products",
  "contextClues": ["buyer", "purchaser", "account", "segment"],
  "isAbstract": false,
  "disambiguationPrompt": "Customer refers to end buyers, not retail partners or suppliers"
}
```

Key fields:
- **contextClues** — Words that hint at this entity type when they appear in user queries. "Show me buyer segments" → resolves to Customer.
- **isAbstract** — Abstract entity types can't be queried directly. They serve as parents in IS_A hierarchies (e.g., "Party" → Customer, Supplier).
- **disambiguationPrompt** — When the term is ambiguous, this text helps the AI choose correctly.

#### Column Mappings

Map entity types to specific database columns, with a **role** indicating how the column relates to the entity.

```json
{
  "entityType": "Customer",
  "domain": "customer",
  "connection": "firekicks",
  "table": "customers",
  "column": "customer_id",
  "role": "id",
  "isPrimary": true,
  "confidence": 1.0
}
```

Roles define how each column serves its entity:

| Role | Meaning | Example |
|------|---------|---------|
| `id` | Primary identifier | `customer_id`, `order_id` |
| `name` | Display name | `first_name`, `product_name` |
| `amount` | Monetary value | `total_amount`, `refund_amount` |
| `date` | Temporal marker | `order_date`, `registration_date` |
| `category` | Grouping dimension | `customer_segment`, `category` |
| `flag` | Boolean status | `is_active`, `on_time` |
| `status` | Lifecycle state | `order_status` |
| `quantity` | Countable measure | `quantity`, `stock_quantity` |

#### Concepts

Abstract business ideas that may or may not correspond directly to a column. Concepts capture definitions like "Revenue", "Customer Lifetime Value", or "Q4" — terms that require calculation or interpretation.

```json
{
  "name": "Revenue",
  "domain": "sales",
  "description": "Total income from shipped and delivered orders",
  "calculationRule": "SUM(orders.total_amount) WHERE order_status IN ('shipped', 'delivered')",
  "unit": "USD",
  "timeSensitive": true
}
```

Key fields:
- **calculationRule** — Human-readable formula. The AI uses this to construct the correct query.
- **timeSensitive** — If true, the concept's value changes based on the time period queried.
- **dependsOn** — Other concepts this one depends on (e.g., "Profit" depends on "Revenue" and "COGS").

### Edge Types

| Edge | From → To | Meaning |
|------|-----------|---------|
| `BELONGS_TO` | EntityType/Concept → Domain | Groups nodes into domains |
| `HAS_COLUMN` | EntityType → ColumnMapping | Links entity to its database columns |
| `IS_A` | EntityType → EntityType | Inheritance (Product IS_A CatalogItem) |
| `RELATES_TO` | EntityType → EntityType | Association with cardinality and join hints |
| `EXCLUDES` | EntityType → EntityType | Mutual exclusion (Customer EXCLUDES Supplier) |
| `EQUIVALENT_TO` | ColumnMapping → ColumnMapping | Same data in different databases |
| `PARENT_OF` | Concept → Concept | Concept hierarchy (Revenue PARENT_OF GrossRevenue) |
| `REALIZED_BY` | Concept → ColumnMapping | Links concept to its data source |
| `DEPENDS_ON` | Concept → Concept | Formula dependency (Profit DEPENDS_ON Revenue) |

## Designing the FireKicks Ontology

### Step 1: Identify Domains

Start with the business areas from the [dataset overview](./README.md):

| Domain | Description | Entity Types |
|--------|-------------|-------------|
| `sales` | Order processing and distribution | Order, OrderItem, RetailPartner |
| `customer` | Customer profiles and behavior | Customer, CustomerAddress, CustomerPreference |
| `product` | Product catalog and inventory | Product, Supplier, InventoryRecord |
| `marketing` | Campaigns and engagement | Campaign, EmailEvent |
| `finance` | Financial reporting | (uses concepts referencing sales entities) |

### Step 2: Define Entity Types

For each domain, identify the business concepts:

**Sales Domain:**

| Entity Type | Description | Primary Table | Context Clues |
|------------|-------------|---------------|---------------|
| Order | A customer purchase transaction | `orders` | order, purchase, transaction, sale |
| OrderItem | A line item within an order | `order_items` | line item, item, SKU |
| RetailPartner | A retail distribution partner | `retail_partners` | store, retailer, partner, location |

**Customer Domain:**

| Entity Type | Description | Primary Table | Context Clues |
|------------|-------------|---------------|---------------|
| Customer | An individual or business buyer | `customers` | customer, buyer, purchaser, account |
| CustomerAddress | A mailing address for a customer | `customer_addresses` | address, location, mailing |
| CustomerPreference | Category and shopping preferences | `customer_preferences` | preference, shoe size, price sensitivity |

**Product Domain:**

| Entity Type | Description | Primary Table | Context Clues |
|------------|-------------|---------------|---------------|
| Product | A product in the catalog | `products` | product, shoe, item, SKU |
| Supplier | A manufacturing partner | `product_suppliers` | supplier, manufacturer, vendor |
| InventoryRecord | Stock level at a warehouse | `inventory` | inventory, stock, warehouse |

**Marketing Domain:**

| Entity Type | Description | Primary Table | Context Clues |
|------------|-------------|---------------|---------------|
| Campaign | A marketing campaign | `campaigns` | campaign, promotion, ad |
| EmailEvent | An email interaction | `email_events` | email, open, click, unsubscribe |

### Step 3: Map Columns to Roles

For each entity type, identify which columns play which roles:

**Customer entity:**

| Column | Role | Is Primary |
|--------|------|-----------|
| `customers.customer_id` | id | yes |
| `customers.first_name` | name | yes |
| `customers.last_name` | name | no |
| `customers.email` | id | no |
| `customers.customer_segment` | category | yes |
| `customers.registration_date` | date | yes |
| `customers.lifetime_value` | amount | yes |
| `customers.is_active` | flag | yes |

**Order entity:**

| Column | Role | Is Primary |
|--------|------|-----------|
| `orders.order_id` | id | yes |
| `orders.total_amount` | amount | yes |
| `orders.order_date` | date | yes |
| `orders.order_status` | status | yes |
| `orders.order_channel` | category | yes |
| `orders.subtotal` | amount | no |
| `orders.tax_amount` | amount | no |

**Product entity:**

| Column | Role | Is Primary |
|--------|------|-----------|
| `products.product_id` | id | yes |
| `products.product_name` | name | yes |
| `products.category` | category | yes |
| `products.brand_line` | category | no |
| `products.base_price` | amount | yes |
| `products.launch_date` | date | yes |
| `products.is_active` | flag | yes |

### Step 4: Define Relationships

Map how entity types relate to each other:

| From | Verb | To | Cardinality | Join Hint |
|------|------|-----|-------------|-----------|
| Customer | places | Order | 1:N | `customers.customer_id = orders.customer_id` |
| Order | contains | OrderItem | 1:N | `orders.order_id = order_items.order_id` |
| OrderItem | references | Product | N:1 | `order_items.product_id = products.product_id` |
| Customer | has | CustomerAddress | 1:N | `customers.customer_id = customer_addresses.customer_id` |
| Customer | has | CustomerPreference | 1:1 | `customers.customer_id = customer_preferences.customer_id` |
| Campaign | targets | EmailEvent | 1:N | `campaigns.campaign_id = email_events.campaign_id` |
| Customer | receives | EmailEvent | 1:N | `customers.customer_id = email_events.customer_id` |
| Product | supplied_by | Supplier | N:1 | `products.supplier_id = product_suppliers.supplier_id` |
| Product | stocked_at | InventoryRecord | 1:N | `products.product_id = inventory.product_id` |

### Step 5: Define Concepts

Concepts capture abstract business ideas with calculation rules:

| Concept | Domain | Calculation Rule | Time Sensitive | Depends On |
|---------|--------|-----------------|----------------|------------|
| Revenue | sales | `SUM(orders.total_amount) WHERE order_status IN ('shipped','delivered')` | yes | — |
| Gross Profit | finance | `Revenue - COGS` | yes | Revenue, COGS |
| COGS | finance | `SUM(order_items.quantity * products.base_cost)` | yes | — |
| Average Order Value | sales | `AVG(orders.total_amount)` | yes | — |
| Customer Lifetime Value | customer | `customers.lifetime_value` (pre-calculated column) | no | — |
| Conversion Rate | marketing | `SUM(conversions) / SUM(clicks) * 100` | yes | — |
| Campaign ROI | marketing | `(revenue_attributed - spend) / spend * 100` | yes | — |

### Step 6: Define Disambiguation Context

When terms are ambiguous, context clues and disambiguation prompts help the AI resolve them:

| Term | Could Mean | Correct Resolution | Disambiguation |
|------|-----------|-------------------|----------------|
| "Premium" | Customer segment or product tier | Customer (context: segment) | "Premium refers to the customer segment, not a product quality tier" |
| "Running" | Product category or campaign status | Product (context: category) | "Running is a shoe category, not a campaign status" |
| "Active" | Customer is_active flag or campaign status | Depends on context | "Check surrounding words: 'active customers' → Customer.is_active; 'active campaigns' → Campaign.status" |
| "Partner" | Retail partner or supplier | RetailPartner | "Partner refers to retail distribution partners. Use 'supplier' for manufacturing partners." |

## Loading the Ontology into DAS

### Create Domains

```bash
echo '{"name":"sales","description":"Order processing, line items, and retail distribution","owner":"sales-team"}' \
  | ff-da admin ontology domains create
```

Repeat for `customer`, `product`, `marketing`, and `finance`:

```bash
echo '{"name":"customer","description":"Customer profiles, addresses, and preferences","owner":"customer-team"}' \
  | ff-da admin ontology domains create

echo '{"name":"product","description":"Product catalog, suppliers, and inventory","owner":"product-team"}' \
  | ff-da admin ontology domains create

echo '{"name":"marketing","description":"Campaigns, engagement, and acquisition","owner":"marketing-team"}' \
  | ff-da admin ontology domains create

echo '{"name":"finance","description":"Financial reporting and aggregations","owner":"finance-team"}' \
  | ff-da admin ontology domains create
```

Verify:

```bash
ff-da admin ontology domains list
```

### Create Entity Types

```bash
ff-da admin ontology entity-types create --file - <<'EOF'
{
  "name": "Customer",
  "domain": "customer",
  "description": "Individual or business that purchases FireKicks products",
  "contextClues": ["customer", "buyer", "purchaser", "account", "segment"],
  "isAbstract": false,
  "disambiguationPrompt": "Customer refers to end buyers who purchase products. Not to be confused with retail partners (stores that carry FireKicks) or suppliers (manufacturers)."
}
EOF
```

```bash
ff-da admin ontology entity-types create --file - <<'EOF'
{
  "name": "Order",
  "domain": "sales",
  "description": "A customer purchase transaction with one or more line items",
  "contextClues": ["order", "purchase", "transaction", "sale", "checkout"],
  "isAbstract": false,
  "disambiguationPrompt": "An Order is a completed purchase transaction. Use order_date for business date filtering. total_amount is the final amount including tax and shipping."
}
EOF
```

```bash
ff-da admin ontology entity-types create --file - <<'EOF'
{
  "name": "Product",
  "domain": "product",
  "description": "An athletic shoe product in the FireKicks catalog",
  "contextClues": ["product", "shoe", "sneaker", "item", "SKU", "model"],
  "isAbstract": false,
  "disambiguationPrompt": "Product refers to items in the shoe catalog. Categories: running, basketball, casual, training, kids."
}
EOF
```

### Create Column Mappings

```bash
# Customer ID mapping
echo '{"entityType":"Customer","domain":"customer","connection":"firekicks","table":"customers","column":"customer_id","role":"id","isPrimary":true,"confidence":1.0}' \
  | ff-da admin ontology columns create

# Customer segment mapping
echo '{"entityType":"Customer","domain":"customer","connection":"firekicks","table":"customers","column":"customer_segment","role":"category","isPrimary":true,"confidence":1.0}' \
  | ff-da admin ontology columns create

# Order total amount mapping
echo '{"entityType":"Order","domain":"sales","connection":"firekicks","table":"orders","column":"total_amount","role":"amount","isPrimary":true,"confidence":1.0}' \
  | ff-da admin ontology columns create
```

### Create Relationships

```bash
ff-da admin ontology relationships create --file - <<'EOF'
{
  "fromEntity": "Customer",
  "toEntity": "Order",
  "verb": "places",
  "cardinality": "1:N",
  "joinHints": [{
    "fromConnection": "firekicks",
    "fromTable": "customers",
    "fromColumn": "customer_id",
    "toConnection": "firekicks",
    "toTable": "orders",
    "toColumn": "customer_id",
    "joinType": "INNER"
  }],
  "confidence": 1.0
}
EOF
```

```bash
ff-da admin ontology relationships create --file - <<'EOF'
{
  "fromEntity": "Order",
  "toEntity": "OrderItem",
  "verb": "contains",
  "cardinality": "1:N",
  "joinHints": [{
    "fromConnection": "firekicks",
    "fromTable": "orders",
    "fromColumn": "order_id",
    "toConnection": "firekicks",
    "toTable": "order_items",
    "toColumn": "order_id",
    "joinType": "INNER"
  }],
  "confidence": 1.0
}
EOF
```

### Create Concepts

```bash
ff-da admin ontology concepts create --file - <<'EOF'
{
  "name": "Revenue",
  "domain": "sales",
  "description": "Total income from completed (shipped or delivered) orders",
  "calculationRule": "SUM(orders.total_amount) WHERE order_status IN ('shipped', 'delivered')",
  "unit": "USD",
  "timeSensitive": true
}
EOF
```

```bash
ff-da admin ontology concepts create --file - <<'EOF'
{
  "name": "Average Order Value",
  "domain": "sales",
  "description": "Mean order total across all completed orders",
  "calculationRule": "AVG(orders.total_amount) WHERE order_status IN ('shipped', 'delivered')",
  "unit": "USD",
  "timeSensitive": true,
  "dependsOn": ["Revenue"]
}
EOF
```

```bash
ff-da admin ontology concepts create --file - <<'EOF'
{
  "name": "Campaign ROI",
  "domain": "marketing",
  "description": "Return on investment for marketing campaigns",
  "calculationRule": "(SUM(campaign_performance.revenue_attributed) - SUM(campaign_performance.spend)) / SUM(campaign_performance.spend) * 100",
  "unit": "percent",
  "timeSensitive": true
}
EOF
```

### Bulk Import

For larger ontologies, use the bulk import command to load an entire domain at once:

```bash
ff-da admin ontology import --domain sales --file - <<'EOF'
{
  "domain": {
    "name": "sales",
    "description": "Order processing, line items, and retail distribution"
  },
  "entityTypes": [
    {
      "name": "Order",
      "domain": "sales",
      "description": "A customer purchase transaction",
      "contextClues": ["order", "purchase", "transaction", "sale"]
    },
    {
      "name": "OrderItem",
      "domain": "sales",
      "description": "A line item within an order",
      "contextClues": ["line item", "item", "SKU"]
    }
  ],
  "columnMappings": [
    {
      "entityType": "Order",
      "domain": "sales",
      "connection": "firekicks",
      "table": "orders",
      "column": "order_id",
      "role": "id",
      "isPrimary": true,
      "confidence": 1.0
    }
  ],
  "relationships": [
    {
      "fromEntity": "Order",
      "toEntity": "OrderItem",
      "verb": "contains",
      "cardinality": "1:N",
      "joinHints": [{
        "fromTable": "orders",
        "fromColumn": "order_id",
        "toTable": "order_items",
        "toColumn": "order_id",
        "joinType": "INNER"
      }]
    }
  ],
  "concepts": [
    {
      "name": "Revenue",
      "domain": "sales",
      "description": "Total income from completed orders",
      "calculationRule": "SUM(orders.total_amount) WHERE order_status IN ('shipped', 'delivered')",
      "unit": "USD",
      "timeSensitive": true
    }
  ]
}
EOF
```

### Validate

After loading, validate the ontology for consistency:

```bash
ff-da admin ontology validate --domain sales
```

Response:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    "EntityType 'RetailPartner' has no column mappings"
  ]
}
```

Validation checks:
- All entity types referenced in relationships exist
- Column mappings reference valid connections, tables, and columns
- Concept dependencies form a DAG (no circular references)
- Join hints reference valid tables and columns
- Abstract entity types have at least one child (IS_A relationship)

## Agent-Facing Ontology API

The admin API is for building the ontology. The agent-facing API is for querying it at runtime. AI agents use these gRPC endpoints to resolve business terms and discover data structures.

### GetOntologyContext

Returns a domain-level overview for injection into the AI's system prompt:

```bash
# gRPC
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -d '{"domain": "sales", "connection": "firekicks"}' \
  localhost:50051 ontology.v1.OntologyService/GetOntologyContext
```

Response:
```json
{
  "domain": "sales",
  "description": "Order processing, line items, and retail distribution",
  "entityTypes": [
    {
      "name": "Order",
      "description": "A customer purchase transaction",
      "contextClues": ["order", "purchase", "transaction"],
      "columnCount": 7,
      "connections": ["firekicks"]
    },
    {
      "name": "OrderItem",
      "description": "A line item within an order",
      "contextClues": ["line item", "item"],
      "columnCount": 5,
      "connections": ["firekicks"]
    }
  ],
  "concepts": [
    {
      "name": "Revenue",
      "description": "Total income from completed orders",
      "timeSensitive": true,
      "unit": "USD"
    }
  ]
}
```

This context helps the AI understand what entities exist in the domain and what concepts are available, without exposing raw database structure.

### ResolveEntity

Resolves a business term to one or more entity type candidates:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -d '{"term": "customer revenue", "domain": "sales", "connection": "firekicks"}' \
  localhost:50051 ontology.v1.OntologyService/ResolveEntity
```

Response:
```json
{
  "candidates": [
    {
      "entityType": "Customer",
      "domain": "customer",
      "confidence": 0.9,
      "matchedClues": ["customer"]
    },
    {
      "entityType": "Order",
      "domain": "sales",
      "confidence": 0.7,
      "matchedClues": ["revenue"]
    }
  ],
  "ambiguous": false
}
```

When a term is ambiguous (e.g., "active" could mean customer or campaign), the response includes `ambiguous: true` and a `disambiguationPrompt` suggesting how to clarify.

### GetEntityRelationships

Discovers join paths between entities:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -d '{"entityType": "Customer", "domain": "customer"}' \
  localhost:50051 ontology.v1.OntologyService/GetEntityRelationships
```

Response:
```json
{
  "relationships": [
    {
      "fromType": "Customer",
      "toType": "Order",
      "verb": "places",
      "cardinality": "1:N",
      "joinHints": [{
        "connection": "firekicks",
        "fromTable": "customers",
        "fromColumn": "customer_id",
        "toTable": "orders",
        "toColumn": "customer_id",
        "joinType": "INNER"
      }]
    },
    {
      "fromType": "Customer",
      "toType": "CustomerAddress",
      "verb": "has",
      "cardinality": "1:N",
      "joinHints": [{
        "connection": "firekicks",
        "fromTable": "customers",
        "fromColumn": "customer_id",
        "toTable": "customer_addresses",
        "toColumn": "customer_id",
        "joinType": "LEFT"
      }]
    }
  ],
  "exclusions": []
}
```

The AI uses join hints to construct multi-table queries. Instead of guessing join conditions from column names, it gets explicit, validated paths.

### GetEntityColumns

Returns all column mappings for an entity, including cross-database equivalences:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -d '{"entityType": "Order", "domain": "sales", "connection": "firekicks"}' \
  localhost:50051 ontology.v1.OntologyService/GetEntityColumns
```

Response:
```json
{
  "entityType": "Order",
  "columns": [
    { "connection": "firekicks", "table": "orders", "column": "order_id", "role": "id", "isPrimary": true },
    { "connection": "firekicks", "table": "orders", "column": "total_amount", "role": "amount", "isPrimary": true },
    { "connection": "firekicks", "table": "orders", "column": "order_date", "role": "date", "isPrimary": true },
    { "connection": "firekicks", "table": "orders", "column": "order_status", "role": "status", "isPrimary": true },
    { "connection": "firekicks", "table": "orders", "column": "order_channel", "role": "category", "isPrimary": true }
  ],
  "crossDbMappings": []
}
```

For multi-database environments, `crossDbMappings` would show equivalent columns across connections — enabling the AI to build cross-database queries using staged queries.

## Cross-Database Resolution

When the same entity exists in multiple databases, column equivalences enable cross-database queries. While FireKicks uses a single database, this capability becomes essential in enterprise environments.

For example, if customer data existed in both a PostgreSQL warehouse and a Snowflake analytics database:

```json
{
  "fromColumnId": "pg-customers-customer_id",
  "toColumnId": "sf-dim_customer-cust_key",
  "joinCondition": "customers.customer_id = dim_customer.source_id",
  "confidence": 0.95
}
```

The AI uses these equivalences along with [staged queries](./05-querying.md) to federate data across databases transparently.

## Summary

You've learned how to:

1. **Design** an ontology — identify domains, entity types, column roles, relationships, and concepts
2. **Map** business terms to database structures — context clues and disambiguation for accurate resolution
3. **Load** the ontology into DAS — domains, entity types, column mappings, relationships, concepts
4. **Validate** for consistency — check for missing references, circular dependencies, unmapped entities
5. **Query** at runtime — GetOntologyContext, ResolveEntity, GetEntityRelationships, GetEntityColumns

The ontology provides the structural "map" of your business domain. In [Part 4](./04-process-models.md), you'll add behavioral context — business processes, rules, tribal knowledge, and calendar information that tell the AI *how* data is used, not just *what* it is.
