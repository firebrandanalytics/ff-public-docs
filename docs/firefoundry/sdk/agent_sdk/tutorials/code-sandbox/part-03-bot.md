# Part 3: The Bot

In this part, you'll create `DemoCoderBot` and `DemoDataScienceBot` using `GeneralCoderBot`'s profile-driven constructor.

## Understanding GeneralCoderBot

`GeneralCoderBot` is a ready-made CoderBot variant designed for profile-driven code generation. It handles:

- **Profile metadata** -- fetches language, harness, DAS connections, and run script contract from the sandbox manager at initialization
- **SandboxClient** -- self-creates from environment variables (`CODE_SANDBOX_URL`)
- **Intrinsic prompts** -- output format and `run()` contract (built automatically)
- **Result processing** -- extracts `{ description, result, stdout, metadata }`

You don't need to implement the 9-stage postprocessing pipeline -- that's inherited from `CoderBot`. You just need to:

1. Choose a profile (determines language, runtime, harness, DAS connections)
2. Optionally provide a domain prompt (for domain-specific context)
3. Register with `@RegisterBot` so entities can look it up

## Creating DemoCoderBot

Create the file `apps/coder-bundle/src/bots/DemoCoderBot.ts`:

```typescript
import { GeneralCoderBot, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";

/**
 * DemoCoderBot -- TypeScript code generation and execution.
 *
 * Profile-driven: the `finance-typescript` profile resolves runtime,
 * harness, and execution environment. No domain prompt needed for
 * general-purpose TypeScript computation.
 */
@RegisterBot("DemoCoderBot")
export class DemoCoderBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoCoderBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_TS_PROFILE || "finance-typescript",
    });
  }
}
```

That's the entire bot. Three constructor args: `name`, `modelPoolName`, and `profile`.

### What the Profile Provides

When `DemoCoderBot.init()` runs, it fetches metadata from the sandbox manager:

```
GET /profiles/finance-typescript/metadata
→ {
    "language": "typescript",
    "harness": "finance",
    "runScriptPrompt": "Export an async run() function...",
    "dasConnections": []
  }
```

GeneralCoderBot uses this to:
- Set the target language for code generation
- Build intrinsic prompt sections (output format, `run()` contract from `runScriptPrompt`)
- Know which DAS connections are available (none, for TypeScript)

### What You Don't Need to Provide

Compare this to what was required before the profile-driven refactor:

| Before | Now |
|--------|-----|
| Create a `PromptGroup` with system + user prompts | Handled intrinsically |
| Instantiate `SandboxClient` with URL and API key | Self-created from env vars |
| Specify `language: "typescript"` | From profile metadata |
| Specify `harness: "finance"` | From profile metadata |
| Write output format prompt sections | Built automatically |
| Write `run()` contract instructions | From `runScriptPrompt` metadata |

### `@RegisterBot`

The decorator registers `DemoCoderBot` in the global component registry. When `CodeTaskEntity` (Part 4) uses `BotRunnableEntityMixin` with bot name `"DemoCoderBot"`, the mixin calls `FFAgentBundle.getBotOrThrow("DemoCoderBot")` to retrieve this instance.

## Creating DemoDataScienceBot

Create the file `apps/coder-bundle/src/bots/DemoDataScienceBot.ts`:

```typescript
import { GeneralCoderBot, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";

/**
 * DemoDataScienceBot -- Python data science code generation and execution.
 *
 * Profile-driven: the `firekicks-datascience` profile resolves runtime,
 * harness, DAS connections, and execution environment.
 *
 * The domain prompt provides the database schema, DAS usage patterns,
 * and data handling guidance specific to FireKicks.
 */
@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
      domainPrompt: FIREKICKS_DOMAIN_PROMPT,
    });
  }
}

// ---------------------------------------------------------------------------
// Domain prompt — FireKicks data science context
// ---------------------------------------------------------------------------

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

### Key Differences from DemoCoderBot

| | DemoCoderBot | DemoDataScienceBot |
|---|---|---|
| **Profile** | `finance-typescript` | `firekicks-datascience` |
| **Language** | TypeScript (from profile) | Python (from profile) |
| **Domain prompt** | None | FireKicks schema + DAS + rules |
| **Database access** | None | Via DAS (`das['firekicks']`) |
| **Entry point** | `export async function run()` | `def run():` |

The domain prompt describes the FireKicks data domain -- schema, query patterns, and output rules. The profile resolves the Python runtime, datascience harness, and DAS connections server-side.

## Configuration Options

The `GeneralCoderBotConstructorArgs` accepts:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Bot name identifier |
| `modelPoolName` | `string` | required | LLM model pool to use |
| `profile` | `string` | required | Named sandbox profile (resolves language, harness, DAS, run script) |
| `domainPrompt` | `string` | -- | Domain-specific prompt content (schema, business rules, package guidance) |
| `maxTries` | `number` | `8` | Max LLM retry attempts |
| `maxSandboxRetries` | `number` | `3` | Max sandbox execution retries |
| `errorPromptProviders` | `CoderErrorPromptProviders` | SDK defaults | Custom error handling prompts |

## Understanding Profiles

Profiles are a key concept in the Code Sandbox architecture. Instead of passing database credentials, runtime configuration, and harness details with every execution request, you create a **named profile** on the sandbox manager that bundles all of this:

```
Profile: "firekicks-datascience"
  +-- Runtime: python-datascience-runtime
  |     +-- Image: ff-code-sandbox-harness-python:latest
  |     +-- CPU: 500m, Memory: 512Mi
  |     +-- Timeout: 120s
  +-- Harness: datascience
  +-- DAS connections:
  |     +-- firekicks -> das.ff-dev.svc.cluster.local:8080
  +-- Run script: (default for datascience harness)
```

The bot just sends `profile: "firekicks-datascience"` with the execution request, and the sandbox manager resolves everything server-side. This keeps credentials out of the bot code and makes it easy to change runtime configuration without redeploying the bot.

At init time, GeneralCoderBot also fetches **profile metadata** to build its intrinsic prompt. The metadata includes the `runScriptPrompt` -- a natural language description of the run script contract that the LLM needs to follow (e.g., "define a `run()` function that returns..."). This is separate from the actual run script code (which is an implementation detail the LLM doesn't need to see).

## Build and Verify

```bash
pnpm run build
```

Both bots compile as standalone modules. They don't execute anything yet -- that happens when an entity triggers `run()` in Part 4.

## Key Points

> **Profile is the single source of truth** -- Language, harness, DAS connections, and run script contract all come from the profile. The bot just provides a profile name.

> **Domain prompt is optional** -- Only provide one when the LLM needs specific domain context (schemas, business rules, data access patterns). General-purpose bots work without one.

> **SandboxClient is self-managed** -- GeneralCoderBot creates its own `SandboxClient` from the `CODE_SANDBOX_URL` environment variable. No client construction in your bot code.

> **@RegisterBot enables entity-bot wiring** -- Entities don't hold direct references to bots. Instead, `BotRunnableEntityMixin` looks up the bot by name from the global registry.

---

**Next:** [Part 4: Entity & Bundle](./part-04-entity-and-bundle.md) -- Create CodeTaskEntity and DataScienceTaskEntity with BotRunnableEntityMixin and wire everything into the agent bundle.
