# Part 2: The Prompt

In this part, you'll learn what output format CoderBot expects from the LLM and create a prompt that instructs the LLM to produce it.

## How CoderBot Processes LLM Output

Unlike `StructuredDataBot` (which expects pure JSON), `CoderBot` expects the LLM to produce **two blocks** in its response:

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
- The code is validated, prepended with module imports, stored in working memory, and executed in the Code Sandbox

### The `run()` Function Contract

For TypeScript, GeneralCoderBot's run script expects the generated code to export an async `run()` function:

```typescript
// GeneralCoderBot's run script:
import { run } from './ai-code.js';

export default (async () => {
  const result = await run();
  return result;
})();
```

The `run()` function should return an object with at least a `description` and `result` field. The sandbox captures the return value and sends it back through the pipeline.

## Creating the Prompt

Our prompt needs to tell the LLM:
1. What role it plays (code generator)
2. The two-block output format it must follow
3. Rules for the generated code (must export `run()`, must be self-contained, etc.)

Create the file `apps/coder-bundle/src/prompts/CoderPrompt.ts`:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  RegisterPrompt,
} from "@firebrandanalytics/ff-agent-sdk";

type CODER_PROMPT_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

@RegisterPrompt("CoderPrompt")
export class CoderPrompt extends Prompt<CODER_PROMPT_PTH> {
  constructor(
    role: "system" | "user" | "assistant",
    options?: CODER_PROMPT_PTH["options"]
  ) {
    super(role, options ?? {});
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_OutputFormat_Section());
    this.add_section(this.get_CodeRules_Section());
  }

  protected get_Context_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "context",
      content: "Context:",
      children: [
        "You are a TypeScript code generation assistant.",
        "You receive natural language requests and produce executable TypeScript code.",
        "Your code will be executed in a sandboxed environment with Node.js.",
      ],
    });
  }

  protected get_OutputFormat_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Output Format:",
      children: [
        "You MUST produce exactly two fenced code blocks in your response:",
        "1. A ```json block containing metadata about the code you will generate.",
        '   It must include "description" (string) and "reasoning" (string) fields.',
        "2. A ```typescript block containing the executable TypeScript code.",
        "Do not include any other fenced code blocks in your response.",
      ],
    });
  }

  protected get_CodeRules_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Code Rules:",
      children: [
        new PromptTemplateListNode<CODER_PROMPT_PTH>({
          semantic_type: "rule",
          children: [
            'Your code MUST export an async function named "run" as the entry point.',
            "The run() function must return an object with at least { description: string, result: any }.",
            "The code must be self-contained. Do not import external packages.",
            "Use only built-in Node.js APIs and standard TypeScript features.",
            "Handle errors gracefully inside the run() function.",
            "Do not use console.log for output -- return all data from run().",
          ],
          list_label_function: (_req: any, _child: any, idx: number) =>
            `${idx + 1}. `,
        }),
      ],
    });
  }
}
```

### Understanding the Prompt Components

**`Prompt<PTH>`** is the base class for all prompts. It manages a tree of template nodes that are rendered into the final LLM message.

**`PromptTypeHelper<Input, Args>`** defines the type signature:
- `Input` (`string`) -- the user's natural language request
- `Args` (`{ static: {}; request: {} }`) -- no extra arguments needed for this prompt

**`@RegisterPrompt("CoderPrompt")`** registers the prompt class in the global registry so it can be looked up by name.

**`PromptTemplateSectionNode`** creates a section with a heading and child content items. The `semantic_type` field helps the rendering engine understand the section's purpose:
- `"context"` -- background information
- `"rule"` -- instructions the LLM must follow

**`PromptTemplateListNode`** renders its children as a numbered or bulleted list. The `list_label_function` controls the prefix format.

### How Sections Render

When the prompt is rendered for the LLM, the tree of nodes becomes a flat text block:

```
Context:
You are a TypeScript code generation assistant.
You receive natural language requests and produce executable TypeScript code.
Your code will be executed in a sandboxed environment with Node.js.

Output Format:
You MUST produce exactly two fenced code blocks in your response:
1. A ```json block containing metadata about the code you will generate.
   It must include "description" (string) and "reasoning" (string) fields.
2. A ```typescript block containing the executable TypeScript code.
Do not include any other fenced code blocks in your response.

Code Rules:
1. Your code MUST export an async function named "run" as the entry point.
2. The run() function must return an object with at least { description: string, result: any }.
3. The code must be self-contained. Do not import external packages.
4. Use only built-in Node.js APIs and standard TypeScript features.
5. Handle errors gracefully inside the run() function.
6. Do not use console.log for output -- return all data from run().
```

## Creating the Data Science Prompt

For the data science bot, we need a richer prompt that includes database schema context and instructions for querying via the Data Access Service (DAS).

Create the file `apps/coder-bundle/src/prompts/DataScienceCoderPrompt.ts`:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  RegisterPrompt,
} from "@firebrandanalytics/ff-agent-sdk";

type DS_PROMPT_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

@RegisterPrompt("DataScienceCoderPrompt")
export class DataScienceCoderPrompt extends Prompt<DS_PROMPT_PTH> {
  constructor(
    role: "system" | "user" | "assistant",
    options?: DS_PROMPT_PTH["options"]
  ) {
    super(role, options ?? {});
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Schema_Section());
    this.add_section(this.get_OutputFormat_Section());
    this.add_section(this.get_CodeRules_Section());
    this.add_section(this.get_Examples_Section());
  }

  protected get_Context_Section(): PromptTemplateNode<DS_PROMPT_PTH> {
    return new PromptTemplateSectionNode<DS_PROMPT_PTH>({
      semantic_type: "context",
      content: "Context:",
      children: [
        "You are a Python data science assistant for FireKicks, an athletic footwear company.",
        "You receive natural language questions about the FireKicks business and produce Python code that queries the database and performs analysis.",
        "Your code will be executed in a sandboxed environment with pandas (pd), numpy (np), and scipy.stats (scipy_stats) pre-imported.",
        "The DAS (Data Access Service) client is available as das['firekicks'] for database queries.",
      ],
    });
  }

  protected get_Schema_Section(): PromptTemplateNode<DS_PROMPT_PTH> {
    return new PromptTemplateSectionNode<DS_PROMPT_PTH>({
      semantic_type: "context",
      content: "Database Schema (FireKicks - PostgreSQL):",
      children: [
        `customers (customer_id PK, first_name, last_name, email, customer_segment [premium|athlete|bargain-hunter|regular], lifetime_value, city, state)`,
        `orders (order_id PK, customer_id FK→customers, order_date, total_amount, order_status)`,
        `order_items (order_item_id PK, order_id FK→orders, product_id FK→products, quantity, unit_price, line_total)`,
        `products (product_id PK, product_name, category, subcategory, base_cost, msrp)`,
        `product_reviews (review_id PK, product_id FK→products, customer_id FK→customers, rating [1-5], review_text)`,
        // ... additional tables as needed for your dataset
      ],
    });
  }

  protected get_OutputFormat_Section(): PromptTemplateNode<DS_PROMPT_PTH> {
    return new PromptTemplateSectionNode<DS_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Output Format:",
      children: [
        "You MUST produce exactly two fenced code blocks in your response:",
        '1. A ```json block containing metadata: {"description": "...", "reasoning": "..."}.',
        "2. A ```python block containing the executable Python code.",
        "Do not include any other fenced code blocks.",
      ],
    });
  }

  protected get_CodeRules_Section(): PromptTemplateNode<DS_PROMPT_PTH> {
    return new PromptTemplateSectionNode<DS_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Code Rules:",
      children: [
        new PromptTemplateListNode<DS_PROMPT_PTH>({
          semantic_type: "rule",
          children: [
            "Your code MUST define a run() function as the entry point.",
            'The run() function must return a dict with at least {"description": str, "result": ...}.',
            "Use das['firekicks'].query_df('SELECT ...') to run SQL and get a pandas DataFrame.",
            "Use das['firekicks'].query_rows('SELECT ...') to get a list of dicts instead.",
            "pandas (pd), numpy (np), and scipy.stats (scipy_stats) are pre-imported and available.",
            "Do NOT import pandas, numpy, or scipy — they are already in scope.",
            "Do NOT use dbs[] or any direct database connection — always use das[] for queries.",
            "Return JSON-serializable results. Use .to_dict('records') for DataFrames.",
            "Cast Decimal/numeric columns with .astype(float) before calculations.",
            "Round numeric results to 4 decimal places.",
            "Do not produce visualizations or plots. Return numeric/tabular results only.",
          ],
          list_label_function: (_req: any, _child: any, idx: number) =>
            `${idx + 1}. `,
        }),
      ],
    });
  }

  protected get_Examples_Section(): PromptTemplateNode<DS_PROMPT_PTH> {
    return new PromptTemplateSectionNode<DS_PROMPT_PTH>({
      semantic_type: "context",
      content: "Example Questions (for reference):",
      children: [
        '- "What is the correlation between product price and average review rating?"',
        '- "Which customer segment has the highest return rate?"',
        '- "What are the top 10 products by revenue?"',
        '- "What is the average order value by customer segment?"',
      ],
    });
  }
}
```

### Key Differences from CoderPrompt

**Database schema context:** The data science prompt includes table definitions so the LLM knows what columns and relationships are available. This is critical -- without schema context, the LLM would have to guess table and column names.

**DAS query instructions:** Instead of direct database access, the prompt instructs the LLM to use `das['firekicks'].query_df()` and `das['firekicks'].query_rows()`. These are methods on the DAS (Data Access Service) client, which mediates all database access through a secure proxy. The sandbox execution environment provides the `das` dict automatically when using a profile that configures DAS connections.

**Pre-imported libraries:** The Python harness pre-imports `pandas`, `numpy`, and `scipy.stats` into the execution scope. The prompt explicitly tells the LLM not to import them again (which would fail in the sandbox).

**Python `run()` contract:** Like TypeScript, Python code must define a `run()` function. The difference is that it returns a plain dict instead of a TypeScript object.

## Building and Verifying

After creating both prompt files, verify the project still builds:

```bash
pnpm run build
```

The prompt files compile as standalone modules. They don't connect to anything yet -- we'll wire them into the bots in Part 3.

## Key Points

> **Two-block format** -- CoderBot expects `\`\`\`json` metadata followed by a language-specific code block (e.g., `\`\`\`typescript` or `\`\`\`python`). Both must be present or the postprocessor will throw an error.

> **The `run()` contract** -- For TypeScript, the run script imports `{ run }` from the generated code file. For Python, it calls `run()` from the exec'd globals. Both must return an object/dict with `description` and `result`.

> **DAS for database access** -- Data science prompts use `das['connection_name']` for queries. The DAS client is injected by the sandbox profile configuration -- the bot never handles database credentials directly.

> **Prompt architecture** -- FireFoundry prompts are composable trees of template nodes. Each section can be conditionally included, dynamically generated, or data-driven. This is more powerful than raw string templates.

---

**Next:** [Part 3: The Bot](./part-03-bot.md) -- Create DemoCoderBot and DemoDataScienceBot using GeneralCoderBot with the sandbox client.
