# Part 3: Dynamic Schema from DAS

At the end of Part 2, our data science bot could query the FireKicks database and follow our data handling rules -- but it had to *guess* table and column names from the user's question. Ask about "revenue by category" and it might try `SELECT category, SUM(revenue)` when the actual column is `unit_price`. Ask about "customer ratings" and it might invent a `ratings` table that doesn't exist.

In this part, we'll fix that by having the bot fetch the actual database schema from DAS at startup and include it in the domain prompt. The result: the AI knows every table, every column, and every data type -- and schema changes are picked up automatically without redeploying.

**What you'll learn:**
- DAS schema introspection (`GET /v1/connections/:name/schema`)
- Dynamic prompt building: overriding `init()` to fetch live data
- Accessing the bot's prompt group to add sections after construction
- Formatting schema objects into prompt-friendly strings
- Why dynamic is better than hardcoded

**What you'll build:** An improved `DemoDataScienceBot` that fetches the database schema from DAS at startup and injects it into its domain prompt.

---

## The Problem with Hardcoded Schema

You *could* write the schema directly into the domain prompt:

```typescript
// Don't do this
systemPrompt.add_section(
  new PromptTemplateSectionNode<CODER_PTH>({
    semantic_type: "context",
    content: "Database Schema:",
    children: [
      "orders: id (int), customer_id (int), product_id (int), quantity (int), unit_price (decimal)",
      "products: id (int), name (varchar), category (varchar), price (decimal)",
      "customers: id (int), name (varchar), segment (varchar), email (varchar)",
    ],
  })
);
```

This works, but it has two problems:

1. **It goes stale.** When someone adds a column or creates a new table, the prompt doesn't know about it until you update the code and redeploy.
2. **It's manual.** Every schema change requires a developer to update a string in a TypeScript file. That's fragile and easy to forget.

The better approach: fetch the schema from the source of truth at startup.

## Step 1: Understand the DAS Schema API

The Data Access Service (DAS) provides schema introspection for any configured connection. The endpoint:

```
GET /v1/connections/{connectionName}/schema
```

Returns a JSON response like this:

```json
{
  "tables": [
    {
      "name": "orders",
      "columns": [
        { "name": "id", "type": "integer", "primaryKey": true },
        { "name": "customer_id", "type": "integer" },
        { "name": "product_id", "type": "integer" },
        { "name": "quantity", "type": "integer" },
        { "name": "unit_price", "type": "numeric(10,2)" },
        { "name": "order_date", "type": "date" }
      ]
    },
    {
      "name": "products",
      "columns": [
        { "name": "id", "type": "integer", "primaryKey": true },
        { "name": "name", "type": "varchar(255)" },
        { "name": "category", "type": "varchar(100)" },
        { "name": "price", "type": "numeric(10,2)" }
      ]
    }
  ]
}
```

Each table has a name and an array of columns, each with a name, type, and optional flags like `primaryKey`. This is exactly what we need to build a schema section for the prompt.

## Step 2: Add Schema Fetching to the Bot

We'll update `DemoDataScienceBot` to fetch the schema during `init()` and add it as a domain prompt section. Here's the complete updated file:

**`apps/coder-bundle/src/bots/DemoDataScienceBot.ts`**:

```typescript
import {
  GeneralCoderBot,
  RegisterBot,
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";
import { logger } from "@firebrandanalytics/shared-utils";

@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
    });
  }

  override async init(): Promise<void> {
    await super.init();

    // Fetch the database schema from DAS
    const dasUrl = process.env.DATA_ACCESS_URL || "http://ff-data-access:8080";
    const connectionName = "firekicks";

    logger.info(`${this.name}: fetching schema from DAS connection "${connectionName}"`);
    const resp = await fetch(`${dasUrl}/v1/connections/${connectionName}/schema`);
    if (!resp.ok) {
      throw new Error(`Failed to fetch DAS schema for "${connectionName}": ${resp.status}`);
    }
    const schema: DasSchemaInfo = await resp.json();
    logger.info(`${this.name}: loaded schema with ${schema.tables.length} tables`);

    // Add domain prompt sections to the system prompt with live schema
    const systemPrompt = this.base_prompt_group.get_prompt("system") as Prompt<CODER_PTH>;
    for (const section of buildFireKicksDomainSections(schema)) {
      systemPrompt.add_section(section);
    }
  }
}
```

Let's break down what changed from Part 2:

1. **`fetch()` to the DAS schema endpoint** -- we read the connection name from config and call DAS at startup. If DAS is unavailable, the bot fails to initialize (which is correct -- it can't work without schema knowledge).

2. **`buildFireKicksDomainSections(schema)`** -- instead of hardcoding the domain prompt sections inline, we extract them into a function that takes the live schema as input. This keeps the init method clean.

3. **Error handling** -- if the schema fetch fails, we throw immediately. A bot that initialized without schema knowledge would silently produce bad results, which is worse than failing loudly.

## Step 3: Define the Schema Types

Add these interfaces below the class in the same file. They match the DAS schema API response:

```typescript
// ---------------------------------------------------------------------------
// DAS schema types
// ---------------------------------------------------------------------------

interface DasColumnInfo {
  name: string;
  type: string;
  normalizedType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  description?: string;
}

interface DasTableInfo {
  name: string;
  columns: DasColumnInfo[];
}

interface DasSchemaInfo {
  tables: DasTableInfo[];
}
```

## Step 4: Format Schema for the Prompt

The raw schema JSON isn't ideal for an LLM prompt. We need to turn it into a concise, readable format. Add this function:

```typescript
// ---------------------------------------------------------------------------
// Schema formatting — turns DAS schema objects into prompt-friendly strings
// ---------------------------------------------------------------------------

function formatTableForPrompt(table: DasTableInfo): string {
  const cols = table.columns.map((c) => {
    let desc = c.name;
    if (c.primaryKey) desc += " PK";
    if (c.type) desc += ` (${c.type})`;
    return desc;
  });
  return `${table.name}: ${cols.join(", ")}`;
}
```

This turns a table object into a single line like:

```
orders: id PK (integer), customer_id (integer), product_id (integer), quantity (integer), unit_price (numeric(10,2)), order_date (date)
```

Compact but complete. The AI gets table names, column names, types, and primary keys -- enough to write correct SQL.

## Step 5: Build the Complete Domain Prompt

Now the function that assembles all the domain sections, including the schema:

```typescript
// ---------------------------------------------------------------------------
// Domain prompt — FireKicks data science context (using prompt framework)
// ---------------------------------------------------------------------------

function buildFireKicksDomainSections(
  schema: DasSchemaInfo,
): PromptTemplateSectionNode<CODER_PTH>[] {
  return [
    // Context: role and purpose
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Role:",
      children: [
        "You are a data science assistant for FireKicks, an athletic footwear company.",
        "Users submit natural language questions about the FireKicks business. You produce Python code that queries the database and performs analysis to answer their question.",
      ],
    }),

    // Context: how to query data via DAS
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Querying Data:",
      children: [
        "Use the DAS (Data Access Service) client for all database queries:",
        "`das['firekicks'].query_df('SELECT ...')` returns a pandas DataFrame.",
        "`das['firekicks'].query_rows('SELECT ...')` returns a list of dicts.",
        "Import packages you need at the top of your code (e.g., `import pandas as pd`).",
      ],
    }),

    // Context: database schema (fetched dynamically from DAS)
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Database Schema (FireKicks):",
      children: schema.tables.map(formatTableForPrompt),
    }),

    // Rules: data handling
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "rule",
      content: "Data Handling Rules:",
      children: [
        new PromptTemplateListNode<CODER_PTH>({
          semantic_type: "rule",
          children: [
            "Return JSON-serializable results. Use `.to_dict('records')` for DataFrames.",
            "Cast Decimal/numeric columns with `.astype(float)` before calculations.",
            "For statistical analysis, use scipy.stats (e.g., `scipy.stats.pearsonr`, `scipy.stats.linregress`).",
            "Round numeric results to 4 decimal places.",
            "Do not produce visualizations or plots — return numeric/tabular results only.",
            "Handle edge cases (empty results, division by zero) gracefully.",
          ],
          list_label_function: (_req: any, _child: any, idx: number) =>
            `${idx + 1}. `,
        }),
      ],
    }),
  ];
}
```

This is the same domain prompt from Part 2, with one crucial addition: the **Database Schema section** (the third section). Its `children` are generated dynamically from `schema.tables.map(formatTableForPrompt)` -- so every table and column in the database appears in the prompt automatically.

## Step 6: Build and Test

Build and deploy:

```bash
pnpm run build
ff-cli ops build coder-bundle
ff-cli ops install coder-bundle
```

Check the logs to confirm the schema was loaded:

```bash
ff-cli ops logs coder-bundle | grep "loaded schema"
# DemoDataScienceBot: loaded schema with 8 tables
```

Now test with the same question that was unreliable in Part 2:

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "What is the correlation between shoe price and customer rating?"}' \
  --url http://localhost:3001
```

This time, the AI knows the exact column names. No more guessing. The result should include correct table joins and column references.

Try a more complex query:

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "Which product categories have the highest repeat purchase rate? Show the top 5."}' \
  --url http://localhost:3001
```

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "Calculate the month-over-month revenue growth rate for the last 12 months"}' \
  --url http://localhost:3001
```

The AI now writes precise SQL with correct table names, column names, and join conditions -- because it can see the actual schema.

## Before and After

Here's what changed from Part 2 to Part 3, visually:

```
Part 2 prompt (no schema):                Part 3 prompt (with schema):

  [intrinsic: output format]               [intrinsic: output format]
  [intrinsic: run() contract]              [intrinsic: run() contract]
  [domain: role]                           [domain: role]
  [domain: DAS query instructions]         [domain: DAS query instructions]
  [domain: data handling rules]            [domain: database schema]      <-- NEW
  [user: "What is the correlation..."]     [domain: data handling rules]
                                           [user: "What is the correlation..."]

  AI guesses column names: ❌              AI uses exact column names: ✅
```

Same endpoint. Same entity. Same user question. The only difference is the schema section in the domain prompt -- and it's fetched live from DAS.

## Key Takeaways

1. **Dynamic beats hardcoded** -- fetching the schema from DAS means schema changes (new tables, new columns) are picked up automatically at next startup. No code changes, no redeployment.

2. **`init()` is the right place for dynamic setup** -- after `super.init()` sets up intrinsic prompts, your override can fetch external data and add domain sections. The prompt group is fully accessible at this point.

3. **`base_prompt_group.get_prompt("system").add_section()`** is how you extend the system prompt -- you're adding to the existing intrinsic prompts, not replacing them.

4. **Schema formatting matters** -- the AI needs a compact but complete representation. Table name, column names, types, and primary keys are the essentials.

5. **Fail fast on missing schema** -- if DAS is unavailable, the bot should fail to initialize rather than silently produce bad results. An LLM that guesses column names is worse than an error message.

## Next Steps

We've been testing from the command line with `ff-sdk-cli`, which is great for development but not what your end users will see. In [Part 4: Building a Web GUI](./part-04-web-gui.md), we'll build a browser-based interface where users can switch between TypeScript and data science modes, enter prompts, and see formatted results -- all backed by the same agent bundle we've been building.
