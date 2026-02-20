# Part 2: The Domain Prompt

In this part, you'll learn how `GeneralCoderBot` handles prompt construction and how to write a **domain prompt** for your specific use case.

## What GeneralCoderBot Handles for You

Unlike lower-level bot types where you build the entire prompt tree, `GeneralCoderBot` owns two key prompt responsibilities:

1. **Output format instructions** -- the two-block format (JSON metadata + code block) that CoderBot's postprocessor expects
2. **The `run()` function contract** -- telling the LLM how to structure its entry point

These are **intrinsic** to CoderBot and built automatically from the profile metadata at initialization. You never need to write these yourself.

### The Two-Block Output Format

CoderBot expects the LLM to produce **two blocks** in its response:

1. **A JSON metadata block** -- describes what the code does
2. **A code block** -- the actual executable code

The LLM response should look like this:

````
```json
{
  "description": "Calculates the first 10 Fibonacci numbers",
  "reasoning": "Using iterative approach for efficiency"
}
```

```typescript
export async function run() {
  const fib: number[] = [0, 1];
  for (let i = 2; i < 10; i++) {
    fib.push(fib[i - 1] + fib[i - 2]);
  }
  return {
    description: "First 10 Fibonacci numbers",
    result: fib
  };
}
```
````

CoderBot's `postprocess_generator` parses both blocks:
- The JSON metadata is stored alongside the code in working memory
- The code is validated, stored in working memory, and executed in the Code Sandbox

### The `run()` Function Contract

The generated code must define a `run()` function as the entry point. For TypeScript, this is an async function that returns an object with `description` and `result`. For Python, it's a plain function returning a dict.

GeneralCoderBot tells the LLM about this contract automatically -- you don't need to include output format or `run()` contract instructions in your domain prompt.

## What You Provide: The Domain Prompt

Your job is to write a **domain prompt** -- a plain string that describes:

- What domain the bot operates in (e.g., "data science assistant for FireKicks")
- What data sources are available and how to access them
- Database schemas, table definitions, column types
- Business rules, conventions, and constraints
- Guidance on which packages to use for common tasks
- Any domain-specific patterns the LLM should follow

The domain prompt is appended after the intrinsic prompt sections, giving the LLM both the structural rules (from CoderBot) and the domain context (from you).

## When You Don't Need a Domain Prompt

For general-purpose computation (math, string processing, algorithms), no domain prompt is needed at all. The bot's profile provides the language and runtime, and the intrinsic prompt handles the rest.

This is the case for our TypeScript bot -- `DemoCoderBot` has no domain prompt. The user's natural language request is sufficient context for the LLM to generate code.

## Writing the FireKicks Domain Prompt

For the data science bot, we need a domain prompt that teaches the LLM about the FireKicks database, how to query it via DAS, and data handling best practices.

This prompt will be passed as a string to `GeneralCoderBot`'s constructor. Here's what we'll use:

```typescript
const FIREKICKS_DOMAIN_PROMPT = `You are a data science assistant for FireKicks, an athletic footwear company.
You receive natural language questions about the FireKicks business and produce Python code that queries the database and performs analysis.

## Querying Data

Use the DAS (Data Access Service) client for all database queries:
- \`das['firekicks'].query_df('SELECT ...')\` returns a pandas DataFrame
- \`das['firekicks'].query_rows('SELECT ...')\` returns a list of dicts
- Do NOT use \`dbs[]\` or any direct database connection — always use \`das[]\`

Import packages you need at the top of your code (e.g., \`import pandas as pd\`).

## Database Schema (FireKicks - PostgreSQL)

customers (customer_id PK, first_name, last_name, email, phone, date_of_birth, gender, registration_date, customer_segment [premium|athlete|bargain-hunter|regular], lifetime_value, preferred_channel, city, state, zip_code)
orders (order_id PK, customer_id FK→customers, order_date, order_channel, retail_partner_id FK→retail_partners NULL, subtotal, tax_amount, shipping_cost, discount_amount, total_amount, order_status)
order_items (order_item_id PK, order_id FK→orders, product_id FK→products, quantity, unit_price, discount_applied, line_total)
products (product_id PK, product_name, category, subcategory, brand_line, base_cost, msrp, release_date, discontinued_date, color_variant, size_range, supplier_id FK→product_suppliers)
product_reviews (review_id PK, product_id FK→products, customer_id FK→customers, rating [1-5], review_date, review_text, verified_purchase)
returns (return_id PK, order_id FK→orders, product_id FK→products, return_date, reason, refund_amount)
inventory (inventory_id PK, product_id FK→products, warehouse_location, quantity_on_hand, reorder_point, last_restocked_date)
campaigns (campaign_id PK, campaign_name, campaign_type, start_date, end_date, budget, target_segment, channel)
campaign_performance (performance_id PK, campaign_id FK→campaigns, date, impressions, clicks, conversions, spend, revenue_attributed)
email_events (event_id PK, campaign_id FK→campaigns, customer_id FK→customers, event_type, event_timestamp)
customer_preferences (preference_id PK, customer_id FK→customers, preferred_category, shoe_size, price_sensitivity, brand_loyalty_score)
customer_segments_history (segment_history_id PK, customer_id FK→customers, segment, segment_start_date, segment_end_date, reason_for_change)
customer_acquisition (acquisition_id PK, date, channel, new_customers, acquisition_cost, first_purchase_revenue)
customer_addresses (address_id PK, customer_id FK→customers, street_address, city, state, zip_code, country, is_primary)
daily_sales_summary (summary_date PK, channel, total_orders, total_revenue, total_cost, total_profit, avg_order_value)
monthly_financials (month_date PK, revenue, cogs, marketing_expense, operations_expense, shipping_expense, net_profit, profit_margin)
shipping_performance (shipment_id PK, order_id FK→orders, ship_date, delivery_date, carrier, shipping_method, on_time)
retail_partners (retail_partner_id PK, partner_name, partner_type, city, state, commission_rate, partnership_start_date)
product_suppliers (supplier_id PK, supplier_name, country, lead_time_days, quality_rating, primary_material)
website_traffic (traffic_id PK, date, sessions, unique_visitors, page_views, bounce_rate, avg_session_duration, conversion_rate)

Views: product_performance (pre-aggregated product stats), campaign_roi_summary (campaign ROI), customer_nearest_store (spatial join).

~10,000 customers, ~131,000 orders, ~200 products, ~50,000 reviews, ~10,000 returns.

## Data Handling Rules

- Return JSON-serializable results. Use \`.to_dict('records')\` for DataFrames.
- Cast Decimal/numeric columns with \`.astype(float)\` before calculations.
- For statistical analysis, use scipy.stats (e.g., \`scipy.stats.pearsonr\`, \`scipy.stats.linregress\`).
- Round numeric results to 4 decimal places.
- Do not produce visualizations or plots — return numeric/tabular results only.
- Handle edge cases (empty results, division by zero) gracefully.`;
```

### What's in the Domain Prompt

**Context** -- tells the LLM its role and the domain it operates in.

**Data access instructions** -- how to query the database using DAS. The `das['firekicks']` client is injected by the sandbox run script at execution time. The prompt tells the LLM to use it because DAS requires harness-level setup and isn't a standard importable package.

**Database schema** -- table definitions with column names, types, primary keys, and foreign key relationships. This is critical -- without schema context, the LLM would guess table and column names.

**Data handling rules** -- conventions for serialization, numeric precision, and output format. These are domain-specific rules that apply to FireKicks analysis.

### What's NOT in the Domain Prompt

Notice what we did **not** include:

- **Output format** (two-block JSON + code) -- intrinsic to CoderBot
- **`run()` function contract** -- intrinsic to CoderBot
- **Language specification** (Python vs TypeScript) -- comes from the profile
- **Package pre-import instructions** -- packages are installed in the runtime but user code handles its own imports with standard `import` statements

## Key Points

> **CoderBot owns the format, you own the domain** -- GeneralCoderBot handles output format and `run()` contract automatically. Your domain prompt describes the problem space: schemas, business rules, data access patterns.

> **Domain prompts are plain strings** -- No `Prompt` classes, no `PromptTemplateSectionNode` trees. Just a string passed to the constructor. Keep it simple.

> **Not every bot needs a domain prompt** -- For general-purpose computation, the profile and intrinsic prompt are sufficient. Only add a domain prompt when the LLM needs specific domain context.

> **DAS access is documented in the domain prompt** -- Because `das['firekicks']` is injected by the run script (not a standard import), the domain prompt tells the LLM how to use it. Standard packages like `pandas` are imported normally by the generated code.

---

**Next:** [Part 3: The Bot](./part-03-bot.md) -- Create DemoCoderBot and DemoDataScienceBot using the simplified GeneralCoderBot constructor.
