# Part 4: Process Models

Process models encode behavioral knowledge — how humans actually work with data, when context changes the meaning of a metric, and which business rules should govern AI-generated queries. While the ontology ([Part 3](./03-ontology.md)) tells the AI *what exists*, process models tell it *how things are used*.

This part covers designing process models for the FireKicks dataset and loading them into the Data Access Service.

## What Are Process Models?

Every organization has unwritten rules about their data:

- "Don't include cancelled orders in revenue reports"
- "Campaign ROI is only meaningful 30 days after the campaign ends"
- "Monthly financials are provisional until the close process completes"
- "Customer segments lag 30 days behind actual behavior"

These rules exist in people's heads, in Slack threads, in tribal knowledge passed between analysts. An AI agent with access to the raw data has no way to know them — and will produce incorrect results without them.

Process models capture this behavioral context as structured metadata. They are **not** a workflow engine — they don't execute processes or trigger actions. They are metadata that AI agents consult when planning and executing queries.

### Process Models vs Ontology

| Layer | What It Captures | Temporal | Example |
|-------|-----------------|----------|---------|
| Ontology | Structural constraints (always true) | Static | "Customer IS_A Entity", "Order RELATES_TO Customer" |
| Process | Behavioral context (conditional) | Dynamic | "Revenue excludes cancelled orders", "Financials are provisional during close" |

The ontology says "Revenue is `SUM(orders.total_amount)`". The process model adds: "...but only for shipped and delivered orders, and only after the month has closed."

## The Process Model

The Data Access Service process layer has five node types.

### Processes

A named business workflow with timing, actors, and optional status probes.

```json
{
  "name": "order_fulfillment",
  "domain": "sales",
  "description": "End-to-end order lifecycle from placement through delivery and return window",
  "timing": {
    "frequency": "continuous",
    "typical_period": "per-order",
    "duration_days": 14
  },
  "actors": ["order_system", "warehouse", "shipping_carrier", "customer"],
  "status_hint": "Check order_status column on orders table for current fulfillment state"
}
```

**Timing** describes how often the process runs and how long it typically takes. **Actors** list who or what participates. **StatusHint** tells the AI how to check where a particular instance stands in the process.

### Steps

Ordered stages within a process. Each step declares what data it reads and writes.

```json
{
  "name": "payment_processed",
  "process_name": "order_fulfillment",
  "domain": "sales",
  "description": "Payment is verified and captured",
  "sequence": 2,
  "actors": ["payment_system"],
  "tribal_note": "Payment processing happens within minutes of order placement. If order_status is still 'pending' after 1 hour, something went wrong.",
  "reads": [
    { "connection": "firekicks", "table": "orders", "columns": ["total_amount", "payment_method"] }
  ],
  "writes": [
    { "connection": "firekicks", "table": "orders", "columns": ["order_status", "payment_date"] }
  ]
}
```

**Data touchpoints** (`reads` and `writes`) document which tables and columns each step interacts with. This creates a data lineage map — the AI can trace which process steps affect which columns.

**Tribal notes** capture the unwritten knowledge: "if order_status is still 'pending' after 1 hour, something went wrong."

### Business Rules

Constraints that govern how data should be queried. Each rule has an **enforcement level** that determines how strictly it's applied.

```json
{
  "name": "exclude_cancelled_from_revenue",
  "domain": "sales",
  "description": "Revenue calculations must exclude cancelled orders",
  "rule_type": "filter",
  "enforcement": "hard_enforced",
  "conditions": [
    {
      "type": "exclude",
      "column": "order_status",
      "operator": "not_in",
      "list_values": ["cancelled"],
      "reason": "Cancelled orders have been refunded and should never appear in revenue figures"
    }
  ],
  "applies_to": ["orders", "daily_sales_summary"],
  "process_name": "order_fulfillment"
}
```

### Enforcement Levels

| Level | Behavior | Override | Use Case |
|-------|----------|----------|----------|
| `advisory` | Returned to the AI, which decides whether to apply | AI chooses | "Consider filtering to recent orders for performance" |
| `soft_enforced` | Auto-injected as a WHERE predicate, but user can request override | User override | "Exclude test orders from reports" |
| `hard_enforced` | Always injected, no override possible | None | "Never include cancelled orders in revenue", "Never expose PII in exports" |

Advisory rules are the most common — they inform the AI without restricting it. Hard-enforced rules are reserved for non-negotiable business constraints.

### Annotations

Contextual interpretation notes triggered by query content. Unlike business rules (which inject filters), annotations provide explanatory text.

```json
{
  "name": "campaign_roi_lag",
  "domain": "marketing",
  "description": "Campaign ROI figures are unreliable during and immediately after a campaign",
  "context_trigger": "campaign ROI",
  "applies_to": ["campaign_performance", "campaign_roi_summary"],
  "importance": "high"
}
```

When an AI query mentions "campaign ROI", this annotation is surfaced. The AI can include it in its response: "Note: Campaign ROI figures are most reliable 30 days after campaign end."

### Calendar Context

Fiscal calendar definitions that help the AI interpret time-based queries correctly.

```json
{
  "name": "firekicks_fiscal_calendar",
  "domain": "finance",
  "description": "FireKicks fiscal year runs January-December with standard quarters",
  "fiscal_year_start_month": 1,
  "year_format": "CY",
  "quarter_mapping": {
    "Q1": { "start_month": 1, "end_month": 3 },
    "Q2": { "start_month": 4, "end_month": 6 },
    "Q3": { "start_month": 7, "end_month": 9 },
    "Q4": { "start_month": 10, "end_month": 12 }
  }
}
```

When the AI sees "Q4 revenue", it knows to filter `order_date` between October 1 and December 31. Without calendar context, the AI might guess wrong — especially for companies with non-standard fiscal years (e.g., fiscal year starting in April).

## Designing FireKicks Process Models

### Order Fulfillment

The core business process that governs the lifecycle of every order.

**Steps:**

| Seq | Step | Actors | Reads | Writes |
|-----|------|--------|-------|--------|
| 1 | Order Placed | customer, order_system | products, inventory | orders, order_items |
| 2 | Payment Processed | payment_system | orders | orders (status, payment_date) |
| 3 | Picking | warehouse | order_items, inventory | inventory (stock levels) |
| 4 | Shipping | shipping_carrier | orders, order_items | shipping_performance |
| 5 | Delivery | shipping_carrier | shipping_performance | shipping_performance (delivered_date) |
| 6 | Return Window | customer | orders | returns |

**Business Rules:**

| Rule | Enforcement | Condition |
|------|------------|-----------|
| Exclude cancelled from revenue | hard_enforced | `order_status NOT IN ('cancelled')` |
| Filter to completed for financials | soft_enforced | `order_status IN ('shipped', 'delivered')` |
| Include all statuses for pipeline | advisory | No filter — show the full pipeline |

**Annotations:**

| Annotation | Trigger | Note |
|-----------|---------|------|
| Return window | "returns" | Returns are accepted within 30 days of delivery. return_date may be NULL if within window but not yet returned. |
| Shipping SLA | "on time", "shipping" | on_time flag in shipping_performance compares actual vs promised delivery date. NULL means not yet delivered. |

### Campaign Management

The marketing workflow from planning through post-analysis.

**Steps:**

| Seq | Step | Actors | Description |
|-----|------|--------|-------------|
| 1 | Planning | marketing_team | Define campaign type, target segment, budget, date range |
| 2 | Launch | marketing_team | Activate campaign, begin sending emails |
| 3 | Active Monitoring | marketing_team | Track daily impressions, clicks, conversions |
| 4 | Campaign Close | marketing_team | End date reached, final metrics captured |
| 5 | Post-Analysis | analytics_team | Calculate final ROI, attribution analysis |

**Business Rules:**

| Rule | Enforcement | Condition |
|------|------------|-----------|
| Use revenue_attributed for ROI | soft_enforced | ROI = (revenue_attributed - spend) / spend |
| Minimum campaign duration | advisory | Campaigns < 7 days may have unreliable metrics |

**Annotations:**

| Annotation | Trigger | Note |
|-----------|---------|------|
| ROI lag | "campaign ROI" | Campaign ROI is only meaningful 30 days after campaign end. During the campaign and shortly after, attribution is incomplete. |
| Attribution model | "attributed", "attribution" | revenue_attributed uses last-touch attribution. A customer who clicks a campaign email and later purchases is attributed to that campaign. |

### Monthly Financial Close

The process that produces official financial reports.

**Steps:**

| Seq | Step | Actors | Description |
|-----|------|--------|-------------|
| 1 | Data Collection | finance_system | Aggregate daily_sales_summary into monthly totals |
| 2 | Reconciliation | finance_team | Compare order-level totals with summary tables |
| 3 | Adjustments | finance_team | Apply corrections (refunds, write-offs, reclassifications) |
| 4 | Review | finance_manager | Approve adjusted figures |
| 5 | Publish | finance_system | Mark month as closed, figures become official |

**Business Rules:**

| Rule | Enforcement | Condition |
|------|------------|-----------|
| Provisional warning | advisory | monthly_financials rows for the current month are provisional until close is complete |
| Use monthly_financials for reporting | soft_enforced | For official financial figures, use monthly_financials (closed months only), not aggregated orders |

**Calendar Context:**

FireKicks uses a calendar fiscal year (January = month 1), standard quarters. The close process typically completes by the 10th business day of the following month.

### Customer Lifecycle

How customers move through segments over time.

**Business Rules:**

| Rule | Enforcement | Condition |
|------|------------|-----------|
| Segment lag | advisory | customer_segment reflects the most recent evaluation. Segment changes lag 30 days behind behavior changes. |
| Use segments_history for trends | advisory | For segment migration analysis, use customer_segments_history. The customers table only shows current segment. |

**Annotations:**

| Annotation | Trigger | Note |
|-----------|---------|------|
| LTV calculation | "lifetime value", "LTV" | lifetime_value is cumulative actual spending, updated daily. It is NOT a predicted future value. |
| Segment definitions | "segment", "tier" | Premium: top 10% by spending. Athlete: active in running/basketball/training (top 20%). Regular: middle 40%. Bargain-Hunter: bottom 30% by price sensitivity. |

## Loading Process Models into DAS

### Create the Domains

The process models span four domains. Create them all before adding processes:

```bash
echo '{"name":"sales","description":"Order processing, line items, and retail distribution","owner":"sales-team"}' \
  | ff-da admin processes domains create

echo '{"name":"marketing","description":"Campaign management, attribution, and customer engagement","owner":"marketing-team"}' \
  | ff-da admin processes domains create

echo '{"name":"finance","description":"Financial reporting, close process, and fiscal calendar","owner":"finance-team"}' \
  | ff-da admin processes domains create

echo '{"name":"customer","description":"Customer lifecycle, segmentation, and lifetime value","owner":"customer-team"}' \
  | ff-da admin processes domains create
```

### Create Processes

```bash
ff-da admin processes create --file - <<'EOF'
{
  "name": "order_fulfillment",
  "domain": "sales",
  "description": "End-to-end order lifecycle from placement through delivery and return window",
  "timing": {
    "frequency": "continuous",
    "typical_period": "per-order",
    "duration_days": 14
  },
  "actors": ["order_system", "warehouse", "shipping_carrier", "customer"],
  "status_hint": "Check orders.order_status for current state: pending → processing → shipped → delivered. Cancelled is a terminal state."
}
EOF
```

```bash
ff-da admin processes create --file - <<'EOF'
{
  "name": "monthly_financial_close",
  "domain": "finance",
  "description": "Monthly aggregation, reconciliation, and publication of financial figures",
  "timing": {
    "frequency": "monthly",
    "typical_period": "monthly",
    "duration_days": 10
  },
  "actors": ["finance_system", "finance_team", "finance_manager"],
  "status_hint": "Check monthly_financials for the month. If row exists and is_closed = true, the month is finalized. Otherwise figures are provisional."
}
EOF
```

```bash
ff-da admin processes create --file - <<'EOF'
{
  "name": "campaign_management",
  "domain": "marketing",
  "description": "Marketing campaign lifecycle from planning through post-analysis and ROI attribution",
  "timing": {
    "frequency": "on-demand",
    "typical_period": "per-campaign",
    "duration_days": 60
  },
  "actors": ["marketing_team", "analytics_team"],
  "status_hint": "Check campaign_performance for campaign status. ROI is only meaningful 30 days after campaign end."
}
EOF
```

### Create Steps

```bash
ff-da admin processes steps create --domain sales --process order_fulfillment --file - <<'EOF'
{
  "name": "order_placed",
  "process_name": "order_fulfillment",
  "domain": "sales",
  "description": "Customer submits an order through online, retail, wholesale, or direct channel",
  "sequence": 1,
  "actors": ["customer", "order_system"],
  "tribal_note": "Orders from the wholesale channel are typically bulk orders with higher quantities and negotiated pricing. Do not compare wholesale AOV with retail AOV directly.",
  "reads": [
    { "connection": "firekicks", "table": "products", "columns": ["product_id", "base_price", "is_active"] },
    { "connection": "firekicks", "table": "inventory", "columns": ["stock_quantity"] }
  ],
  "writes": [
    { "connection": "firekicks", "table": "orders", "columns": ["order_id", "customer_id", "order_date", "total_amount", "order_status"] },
    { "connection": "firekicks", "table": "order_items", "columns": ["order_item_id", "order_id", "product_id", "quantity", "unit_price"] }
  ]
}
EOF
```

```bash
ff-da admin processes steps create --domain sales --process order_fulfillment --file - <<'EOF'
{
  "name": "shipping",
  "process_name": "order_fulfillment",
  "domain": "sales",
  "description": "Order is handed to carrier for delivery",
  "sequence": 4,
  "actors": ["shipping_carrier"],
  "tribal_note": "Three carriers: FedEx (60%), UPS (30%), USPS (10%). FedEx handles priority, USPS handles economy. on_time rates differ significantly by carrier.",
  "reads": [
    { "connection": "firekicks", "table": "orders", "columns": ["order_id", "shipping_method"] }
  ],
  "writes": [
    { "connection": "firekicks", "table": "shipping_performance", "columns": ["order_id", "carrier", "ship_date", "promised_date", "on_time"] }
  ]
}
EOF
```

### Create Business Rules

```bash
ff-da admin processes rules create --file - <<'EOF'
{
  "name": "exclude_cancelled_from_revenue",
  "domain": "sales",
  "description": "Revenue calculations must exclude cancelled orders. Cancelled orders have been fully refunded.",
  "rule_type": "filter",
  "enforcement": "hard_enforced",
  "conditions": [
    {
      "type": "exclude",
      "column": "order_status",
      "operator": "not_in",
      "list_values": ["cancelled"],
      "reason": "Cancelled orders are fully refunded and must never appear in revenue calculations"
    }
  ],
  "applies_to": ["orders", "order_items"],
  "process_name": "order_fulfillment"
}
EOF
```

```bash
ff-da admin processes rules create --file - <<'EOF'
{
  "name": "use_revenue_attributed_for_roi",
  "domain": "marketing",
  "description": "Campaign ROI must use revenue_attributed column, not total order revenue",
  "rule_type": "guidance",
  "enforcement": "soft_enforced",
  "conditions": [
    {
      "type": "column_preference",
      "column": "revenue_attributed",
      "reason": "revenue_attributed uses last-touch attribution. Using total_amount from orders would double-count revenue across campaigns."
    }
  ],
  "applies_to": ["campaign_performance", "campaign_roi_summary"],
  "process_name": "campaign_management"
}
EOF
```

```bash
ff-da admin processes rules create --file - <<'EOF'
{
  "name": "provisional_financials_warning",
  "domain": "finance",
  "description": "Monthly financials for the current month are provisional and may change until close is complete",
  "rule_type": "advisory",
  "enforcement": "advisory",
  "conditions": [
    {
      "type": "temporal",
      "reason": "Figures for the current month are provisional. Only use monthly_financials for closed months in official reports. The close process typically completes by the 10th business day of the following month."
    }
  ],
  "applies_to": ["monthly_financials"],
  "process_name": "monthly_financial_close"
}
EOF
```

### Create Annotations

```bash
ff-da admin processes annotations create --file - <<'EOF'
{
  "name": "campaign_roi_lag",
  "domain": "marketing",
  "description": "Campaign ROI is only meaningful 30 days after campaign end date. During the campaign and shortly after, attribution is incomplete and ROI will appear artificially low.",
  "context_trigger": "campaign ROI",
  "applies_to": ["campaign_performance", "campaign_roi_summary"],
  "importance": "high"
}
EOF
```

```bash
ff-da admin processes annotations create --file - <<'EOF'
{
  "name": "segment_lag",
  "domain": "customer",
  "description": "Customer segment changes lag approximately 30 days behind behavioral changes. A customer who recently increased spending may still show as Bargain-Hunter until the next segment evaluation.",
  "context_trigger": "customer segment",
  "applies_to": ["customers", "customer_segments_history"],
  "importance": "medium"
}
EOF
```

```bash
ff-da admin processes annotations create --file - <<'EOF'
{
  "name": "ltv_definition",
  "domain": "customer",
  "description": "lifetime_value is cumulative actual spending updated daily. It is NOT a predicted future value or a modeled LTV. For predictive LTV, compute it from order history.",
  "context_trigger": "lifetime value",
  "applies_to": ["customers"],
  "importance": "high"
}
EOF
```

### Create Calendar Context

```bash
ff-da admin processes calendars create --file - <<'EOF'
{
  "name": "firekicks_fiscal_calendar",
  "domain": "finance",
  "description": "FireKicks uses a calendar fiscal year (Jan-Dec) with standard quarters",
  "fiscal_year_start_month": 1,
  "year_format": "CY",
  "quarter_mapping": {
    "Q1": { "start_month": 1, "end_month": 3 },
    "Q2": { "start_month": 4, "end_month": 6 },
    "Q3": { "start_month": 7, "end_month": 9 },
    "Q4": { "start_month": 10, "end_month": 12 }
  }
}
EOF
```

### Bulk Import

Load an entire domain's process models at once:

```bash
ff-da admin processes import --domain sales --file process-models-sales.json
```

The JSON file follows the `DomainExport` structure:

```json
{
  "domain": { "name": "sales", "description": "..." },
  "processes": [...],
  "steps": [...],
  "business_rules": [...],
  "annotations": [...],
  "calendar_contexts": [...]
}
```

### Validate

```bash
ff-da admin processes validate --domain sales
```

Validation checks:
- All steps reference valid processes
- Step sequences are contiguous (no gaps)
- Data touchpoints reference valid connections and tables
- Business rules reference valid tables in `applies_to`
- Calendar context has valid month ranges (1-12)
- Process names referenced by rules and annotations exist

## Agent-Facing Process API

AI agents use these gRPC endpoints to get process context at query time.

> **Setup:** The gRPC examples below use `$API_KEY` and `$IDENTITY`. Set them if you haven't already:
> ```bash
> export API_KEY=dev-api-key
> export IDENTITY=user:tutorial
> ```

### GetProcessContext

Returns a domain-level overview of processes, rules, and annotations:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "sales"}' \
  localhost:50051 process.v1.ProcessService/GetProcessContext
```

Response:
```json
{
  "processes": [
    {
      "name": "order_fulfillment",
      "description": "End-to-end order lifecycle...",
      "frequency": "continuous",
      "stepCount": 6,
      "statusHint": "Check orders.order_status...",
      "actors": ["order_system", "warehouse", "shipping_carrier", "customer"],
      "governedByRules": ["exclude_cancelled_from_revenue", "filter_completed_for_financials"]
    }
  ],
  "rules": [
    {
      "name": "exclude_cancelled_from_revenue",
      "description": "Revenue calculations must exclude cancelled orders",
      "enforcement": "ENFORCEMENT_HARD_ENFORCED",
      "isExecutable": true,
      "conditions": [...],
      "appliesTo": ["orders", "order_items"]
    }
  ],
  "annotations": [
    {
      "name": "return_window_note",
      "description": "Returns are accepted within 30 days of delivery...",
      "contextTrigger": "returns",
      "appliesTo": ["returns", "orders"]
    }
  ],
  "calendar": {...}
}
```

### GetBusinessRules

Get rules that apply to specific tables or views:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "sales", "viewName": "orders"}' \
  localhost:50051 process.v1.ProcessService/GetBusinessRules
```

The `viewName` field filters to rules whose `appliesTo` list includes the specified table. You can also filter by minimum enforcement level:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "sales", "viewName": "orders", "minEnforcement": "ENFORCEMENT_SOFT_ENFORCED"}' \
  localhost:50051 process.v1.ProcessService/GetBusinessRules
```

This returns only soft-enforced and hard-enforced rules — skipping advisory rules when token budget is tight.

### BatchGetBusinessRules

Get rules for multiple tables in a single call:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "sales", "viewNames": ["orders", "order_items", "daily_sales_summary"]}' \
  localhost:50051 process.v1.ProcessService/BatchGetBusinessRules
```

Returns a map of table name → rules, efficient for multi-table queries.

### GetAnnotations

Retrieve contextual notes triggered by a query topic:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "marketing", "contextTrigger": "campaign ROI"}' \
  localhost:50051 process.v1.ProcessService/GetAnnotations
```

The `contextTrigger` is matched as a substring against each annotation's trigger. "campaign ROI" matches annotations with triggers like "campaign ROI", "ROI", or "campaign".

### GetCalendarContext

Get the fiscal calendar for date interpretation:

```bash
grpcurl -plaintext \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"domain": "finance"}' \
  localhost:50051 process.v1.ProcessService/GetCalendarContext
```

Response:
```json
{
  "name": "firekicks_fiscal_calendar",
  "fiscalYearStartMonth": 1,
  "yearFormat": "CY",
  "quarterMapping": {
    "Q1": { "startMonth": 1, "endMonth": 3 },
    "Q2": { "startMonth": 4, "endMonth": 6 },
    "Q3": { "startMonth": 7, "endMonth": 9 },
    "Q4": { "startMonth": 10, "endMonth": 12 }
  }
}
```

## Putting It Together: How Rules Improve Queries

Consider an AI agent asked: "What's our Q4 revenue?"

**Without process models:**
```sql
SELECT SUM(total_amount) FROM orders
WHERE order_date BETWEEN '2025-10-01' AND '2025-12-31'
```

This includes cancelled orders and pending orders — both wrong for revenue.

**With process models:**

1. Agent calls `GetCalendarContext` → learns Q4 = October-December
2. Agent calls `GetBusinessRules(domain=sales, viewName=orders)` → gets:
   - `exclude_cancelled_from_revenue` (hard_enforced): `order_status != 'cancelled'`
   - `filter_completed_for_financials` (soft_enforced): `order_status IN ('shipped', 'delivered')`
3. Agent calls `GetAnnotations(contextTrigger="revenue")` → gets:
   - "Use total_amount for revenue (includes tax and shipping)"

Resulting query:
```sql
SELECT SUM(total_amount) FROM orders
WHERE order_date BETWEEN '2025-10-01' AND '2025-12-31'
  AND order_status IN ('shipped', 'delivered')
```

The business rules prevented the AI from including cancelled and pending orders. The calendar context ensured the correct date range. The annotation confirmed the right column.

## Summary

You've learned how to:

1. **Design** process models — identify processes, steps, tribal knowledge, and data touchpoints
2. **Define** business rules — filter, guidance, and advisory rules with appropriate enforcement levels
3. **Write** annotations — contextual notes triggered by query content
4. **Configure** calendar context — fiscal calendar for date-based query interpretation
5. **Load** everything into DAS — processes, steps, rules, annotations, calendars
6. **Validate** for consistency — check references, sequences, and table names

In [Part 5](./05-querying.md), you'll bring all five layers together — schema, dictionary, stored definitions, ontology, and process models — to build queries that leverage the full knowledge architecture.
