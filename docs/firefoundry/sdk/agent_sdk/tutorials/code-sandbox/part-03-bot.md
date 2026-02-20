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
2. Optionally provide domain prompt sections (for domain-specific context)
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

Three constructor args: `name`, `modelPoolName`, and `profile`. No domain prompt needed for general-purpose TypeScript.

## Creating DemoDataScienceBot

Create the file `apps/coder-bundle/src/bots/DemoDataScienceBot.ts`:

```typescript
import {
  GeneralCoderBot,
  RegisterBot,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";

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
      domainPrompt: buildFireKicksDomainSections(),
    });
  }
}

// ---------------------------------------------------------------------------
// Domain prompt — FireKicks data science context (using prompt framework)
// ---------------------------------------------------------------------------

function buildFireKicksDomainSections(): PromptTemplateSectionNode<CODER_PTH>[] {
  return [
    new PromptTemplateSectionNode<CODER_PTH>({
      semantic_type: "context",
      content: "Role:",
      children: [
        "You are a data science assistant for FireKicks, an athletic footwear company.",
        "You receive natural language questions about the FireKicks business and produce Python code that queries the database and performs analysis.",
      ],
    }),

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

### Key Differences

| | DemoCoderBot | DemoDataScienceBot |
|---|---|---|
| **Profile** | `finance-typescript` | `firekicks-datascience` |
| **Language** | TypeScript (from profile) | Python (from profile) |
| **Domain prompt** | None | FireKicks schema + DAS + rules |
| **Database access** | None | Via DAS (`das['firekicks']`) |

The domain prompt uses `PromptTemplateSectionNode` with `semantic_type: "context"` for background information and `semantic_type: "rule"` for instructions. The profile resolves the Python runtime, datascience harness, and DAS connections.

## Configuration Options

The `GeneralCoderBotConstructorArgs` accepts:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Bot name identifier |
| `modelPoolName` | `string` | required | LLM model pool to use |
| `profile` | `string` | required | Named sandbox profile (resolves language, harness, DAS, run script) |
| `domainPrompt` | `PromptTemplateNode \| PromptTemplateNode[] \| string` | -- | Domain-specific prompt sections |
| `maxTries` | `number` | `8` | Max LLM retry attempts |
| `maxSandboxRetries` | `number` | `3` | Max sandbox execution retries |
| `errorPromptProviders` | `CoderErrorPromptProviders` | SDK defaults | Custom error handling prompts |

## Understanding Profiles

Profiles are a key concept in the Code Sandbox architecture. Instead of passing database credentials, runtime configuration, and harness details with every execution request, you create a **named profile** on the sandbox manager that bundles all of this:

```
Profile: "firekicks-datascience"
  +-- Runtime: python-datascience-runtime (resource limits, timeout, image)
  +-- Harness: datascience
  +-- DAS connections: firekicks -> Data Access Service
  +-- Run script: (default for datascience harness)
```

The bot just sends `profile: "firekicks-datascience"` with the execution request, and the sandbox manager resolves everything. This keeps credentials out of the bot code and makes it easy to change runtime configuration without redeploying.

At init time, GeneralCoderBot also fetches **profile metadata** to build its intrinsic prompt, including the `runScriptPrompt` -- a natural language description of the entry point contract that the LLM needs to follow.

## Build and Verify

```bash
pnpm run build
```

Both bots compile. They don't execute anything yet -- that happens when an entity triggers `run()` in Part 4.

## Key Points

> **Profile is the single source of truth** -- Language, harness, DAS connections, and run script contract all come from the profile.

> **Domain prompt uses the prompt framework** -- Build structured prompts with `PromptTemplateSectionNode` and `PromptTemplateListNode`. Semantic types (`"context"`, `"rule"`) make prompts composable and meaningful to the rendering engine.

> **SandboxClient is self-managed** -- GeneralCoderBot creates its own client from the `CODE_SANDBOX_URL` environment variable.

> **@RegisterBot enables entity-bot wiring** -- Entities look up the bot by name from the global registry via `BotRunnableEntityMixin`.

---

**Next:** [Part 4: Entity & Bundle](./part-04-entity-and-bundle.md) -- Create entities, wire API endpoints, and connect everything.
