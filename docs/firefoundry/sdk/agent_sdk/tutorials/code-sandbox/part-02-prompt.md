# Part 2: The Domain Prompt

In this part, you'll learn how `GeneralCoderBot` handles prompt construction and how to write a **domain prompt** using the prompt framework.

## What GeneralCoderBot Handles for You

`GeneralCoderBot` owns two key prompt responsibilities:

1. **Output format instructions** -- the two-block format (JSON metadata + code block) that CoderBot's postprocessor expects
2. **The `run()` function contract** -- telling the LLM how to structure its entry point

These are **intrinsic** to CoderBot and built automatically from the profile metadata at initialization.

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

CoderBot's `postprocess_generator` parses both blocks, stores them in working memory, and executes the code in the Code Sandbox.

## What You Provide: The Domain Prompt

Your job is to write a **domain prompt** that describes:

- What domain the bot operates in
- What data sources are available and how to access them
- Database schemas, table definitions, column types
- Business rules, conventions, and constraints
- Any domain-specific patterns the LLM should follow

The domain prompt is appended after the intrinsic prompt sections, giving the LLM both the structural rules (from CoderBot) and the domain context (from you).

For general-purpose computation (math, string processing, algorithms), no domain prompt is needed at all. This is the case for our TypeScript bot -- `DemoCoderBot` has no domain prompt.

## Building the FireKicks Domain Prompt

For the data science bot, we need a domain prompt that teaches the LLM about the FireKicks database and how to query it via DAS. We build this using the **prompt framework** -- `PromptTemplateSectionNode` and `PromptTemplateListNode` -- which provides structured, composable prompts with semantic types.

Create the file `apps/coder-bundle/src/prompts/FireKicksDomainPrompt.ts`:

```typescript
import {
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";

/**
 * Build the domain prompt sections for the FireKicks data science bot.
 *
 * Each section is a PromptTemplateSectionNode with a semantic_type
 * that helps the rendering engine understand its purpose:
 *   - "context" — background information the LLM needs
 *   - "rule" — instructions the LLM must follow
 */
export function buildFireKicksDomainSections(): PromptTemplateSectionNode<CODER_PTH>[] {
  return [
    // Role and purpose
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Role:",
      children: [
        "You are a data science assistant for FireKicks, an athletic footwear company.",
        "You receive natural language questions about the FireKicks business and produce Python code that queries the database and performs analysis.",
      ],
    }),

    // How to query data via DAS
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Querying Data:",
      children: [
        "Use the DAS (Data Access Service) client for all database queries:",
        "`das['firekicks'].query_df('SELECT ...')` returns a pandas DataFrame.",
        "`das['firekicks'].query_rows('SELECT ...')` returns a list of dicts.",
        "Do NOT use `dbs[]` or any direct database connection — always use `das[]`.",
        "Import packages you need at the top of your code (e.g., `import pandas as pd`).",
      ],
    }),

    // Database schema
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Database Schema (FireKicks - PostgreSQL):",
      children: [
        "customers (customer_id PK, first_name, last_name, email, customer_segment [premium|athlete|bargain-hunter|regular], lifetime_value, city, state)",
        "orders (order_id PK, customer_id FK→customers, order_date, total_amount, order_status)",
        "order_items (order_item_id PK, order_id FK→orders, product_id FK→products, quantity, unit_price, line_total)",
        "products (product_id PK, product_name, category, subcategory, base_cost, msrp)",
        "product_reviews (review_id PK, product_id FK→products, customer_id FK→customers, rating [1-5], review_text)",
        "returns (return_id PK, order_id FK→orders, product_id FK→products, return_date, reason, refund_amount)",
        "",
        "~10,000 customers, ~131,000 orders, ~200 products, ~50,000 reviews, ~10,000 returns.",
      ],
    }),

    // Data handling rules
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "rule",
      content: "Data Handling Rules:",
      children: [
        new PromptTemplateListNode<CODER_PTH>({
          semantic_type: "rule",
          children: [
            "Return JSON-serializable results. Use `.to_dict('records')` for DataFrames.",
            "Cast Decimal/numeric columns with `.astype(float)` before calculations.",
            "For statistical analysis, use scipy.stats (e.g., `scipy.stats.pearsonr`).",
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

### Understanding the Prompt Components

**`PromptTemplateSectionNode`** creates a section with a heading and child content. The `semantic_type` field categorizes the section:
- `"context"` -- background information (role, schema, data access patterns)
- `"rule"` -- instructions the LLM must follow (data handling, output format)

**`PromptTemplateListNode`** renders its children as a numbered list. The `list_label_function` controls the prefix format.

**`CODER_PTH`** is the prompt type helper for CoderBot. It defines the type signature for the prompt rendering pipeline.

### How Sections Render

When the prompt is rendered for the LLM, the tree of nodes becomes structured text:

```
Role:
You are a data science assistant for FireKicks, an athletic footwear company.
You receive natural language questions about the FireKicks business...

Querying Data:
Use the DAS (Data Access Service) client for all database queries:
...

Database Schema (FireKicks - PostgreSQL):
customers (customer_id PK, ...)
...

Data Handling Rules:
1. Return JSON-serializable results. Use `.to_dict('records')` for DataFrames.
2. Cast Decimal/numeric columns with `.astype(float)` before calculations.
...
```

### Why Use the Prompt Framework?

The prompt framework provides advantages over plain text strings:

- **Semantic types** -- the rendering engine can filter, reorder, or transform sections based on their type
- **Composability** -- sections can be reused, conditionally included, or data-driven
- **Dynamic content** -- sections can use content functions that resolve at render time based on the request
- **Consistency** -- all FireFoundry prompts follow the same structured pattern

## Build and Verify

```bash
pnpm run build
```

The prompt file compiles as a standalone module. It doesn't connect to anything yet -- we'll wire it into the bot in Part 3.

## Key Points

> **CoderBot owns the format, you own the domain** -- GeneralCoderBot handles output format and `run()` contract automatically. Your domain prompt describes the problem space: schemas, business rules, data access patterns.

> **Use the prompt framework** -- Build domain prompts with `PromptTemplateSectionNode` and `PromptTemplateListNode` for structured, composable prompts. This is a core pattern in FireFoundry.

> **Not every bot needs a domain prompt** -- For general-purpose computation, the profile and intrinsic prompt are sufficient.

---

**Next:** [Part 3: The Bot](./part-03-bot.md) -- Create DemoCoderBot and DemoDataScienceBot using the profile-driven GeneralCoderBot constructor.
