# Part 2: The Domain Prompt

In this part, you'll learn how `GeneralCoderBot` handles prompt construction and how to write a **domain prompt** that teaches the AI about your problem space.

## What Gets Solved at Build Time vs. Runtime

It's important to understand the separation of concerns:

- **Build time (you, the developer):** You define the *problem space* — what data is available, how to access it, what rules to follow. This is the **domain prompt**.
- **Runtime (your users):** Users submit *specific problems* — "What is the average order value by customer segment?" — and the AI writes code to solve them.

Your domain prompt is **not** the problem being solved. It's the context that enables the AI to solve *whatever problem your users submit*. You're building a reusable problem solver.

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

Your job is to write a **domain prompt** that describes the problem space your users will be working in:

- What domain the bot operates in (role)
- What data sources are available and how to query them
- Business rules, conventions, and constraints

The domain prompt is appended after the intrinsic prompt sections, giving the LLM both the structural rules (from CoderBot) and the domain context (from you).

## Building the FireKicks Domain Prompt

For the data science bot, we need a domain prompt that teaches the LLM about the FireKicks database and how to query it via DAS (Data Access Service). We build this using the **prompt framework** -- `PromptTemplateSectionNode` and `PromptTemplateListNode` -- which provides structured, composable prompts with semantic types.

A key design principle: **the database schema should be fetched dynamically from DAS**, not hardcoded. This means schema changes (new tables, renamed columns) are picked up automatically without redeploying the agent bundle.

Create the file `apps/coder-bundle/src/prompts/FireKicksDomainPrompt.ts`:

```typescript
import {
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";

// ---------------------------------------------------------------------------
// DAS schema types (matches the DAS /v1/connections/:name/schema response)
// ---------------------------------------------------------------------------

export interface DasColumnInfo {
  name: string;
  type: string;
  normalizedType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  description?: string;
}

export interface DasTableInfo {
  name: string;
  columns: DasColumnInfo[];
}

export interface DasSchemaInfo {
  tables: DasTableInfo[];
}

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

// ---------------------------------------------------------------------------
// Domain prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the domain prompt sections for the FireKicks data science bot.
 *
 * Takes a DAS schema object as input — the schema is fetched dynamically
 * during bot init, not hardcoded. Each section uses the prompt framework:
 *   - "context" — background information the LLM needs
 *   - "rule" — instructions the LLM must follow
 */
export function buildFireKicksDomainSections(
  schema: DasSchemaInfo,
): PromptTemplateSectionNode<CODER_PTH>[] {
  return [
    // Role and purpose
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Role:",
      children: [
        "You are a data science assistant for FireKicks, an athletic footwear company.",
        "Users submit natural language questions about the FireKicks business. You produce Python code that queries the database and performs analysis to answer their question.",
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
        "Import packages you need at the top of your code (e.g., `import pandas as pd`).",
      ],
    }),

    // Database schema (from DAS — not hardcoded)
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Database Schema (FireKicks):",
      children: schema.tables.map(formatTableForPrompt),
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

### Dynamic Schema — Why Not Hardcode?

Notice that `buildFireKicksDomainSections` takes a `DasSchemaInfo` parameter rather than embedding the schema as string literals. This is intentional:

- **Schema changes are automatic** -- add a table to the database and the prompt picks it up on next bot init
- **No code changes for schema updates** -- the agent bundle doesn't need redeployment
- **DAS is the single source of truth** -- the same schema definition serves both query execution and prompt generation

In Part 3, you'll see how the bot fetches this schema from DAS during initialization.

### How Sections Render

When the prompt is rendered for the LLM, the tree of nodes becomes structured text:

```
Role:
You are a data science assistant for FireKicks, an athletic footwear company.
Users submit natural language questions about the FireKicks business...

Querying Data:
Use the DAS (Data Access Service) client for all database queries:
...

Database Schema (FireKicks):
customers: customer_id PK (integer), first_name (varchar), ...
orders: order_id PK (integer), customer_id (integer), ...
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

> **CoderBot owns the format, you own the domain** -- GeneralCoderBot handles output format and `run()` contract automatically. Your domain prompt describes the problem space: data access patterns, schema, business rules.

> **Use the prompt framework** -- Build domain prompts with `PromptTemplateSectionNode` and `PromptTemplateListNode` for structured, composable prompts. This is a core pattern in FireFoundry.

> **Fetch schema dynamically** -- The domain prompt builder takes a DAS schema object as input, not hardcoded strings. DAS is the single source of truth for schema information.

---

**Next:** [Part 3: The Bot](./part-03-bot.md) -- Create DemoCoderBot and DemoDataScienceBot using the profile-driven GeneralCoderBot constructor.
