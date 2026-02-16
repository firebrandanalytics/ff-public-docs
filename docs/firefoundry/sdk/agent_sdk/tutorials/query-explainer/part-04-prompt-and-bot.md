# Part 4: Prompt & Bot

In this part you'll create a structured system prompt using the SDK's prompt framework, then build the bot class that combines tool calling with structured output validation.

**What you'll learn:**
- Building prompts with `PromptTemplateSectionNode`, `PromptTemplateListNode`, and `PromptTemplateStructDataNode`
- Using semantic types (`context`, `rule`, `sample_output`) to organize prompt sections
- Using `ComposeMixins` to combine `MixinBot` with `StructuredOutputBotMixin`
- The `get_semantic_label` workaround for `ComposeMixins`
- Using `@RegisterBot` for auto-registration

**What you'll build:** A `QueryExplainerBot` that calls DAS tools, then produces a Zod-validated JSON analysis with performance and semantic sections.

## Concepts: The Prompt Framework

The SDK provides a structured prompt framework that goes beyond plain strings. Instead of a single large text block, you compose prompts from typed nodes:

| Node Type | Purpose |
|-----------|---------|
| `PromptTemplateSectionNode` | Groups related content with a `semantic_type` (e.g., `context`, `rule`, `sample_output`) |
| `PromptTemplateTextNode` | Static or dynamic text content |
| `PromptTemplateListNode` | Ordered or unordered lists with a `list_label_function` |
| `PromptTemplateStructDataNode` | JSON examples rendered from data objects |

Each section has a `semantic_type` that communicates its purpose to the framework:
- `context` — role definition, available tools, background information
- `rule` — instructions the LLM must follow
- `sample_output` — example output formats and schemas

### Why Use the Framework?

1. **Composability** — Sections can be added, removed, or overridden in subclasses
2. **Testability** — Individual sections can be validated independently
3. **Semantics** — The framework understands the purpose of each section
4. **Consistency** — All prompts across your organization follow the same patterns

## Step 1: Create the System Prompt

The prompt class extends `Prompt` and builds its sections in the constructor using protected helper methods — one per logical section.

**`apps/query-bundle/src/prompts/QueryExplainerPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateTextNode,
  PromptTemplateListNode,
  PromptTemplateStructDataNode,
  PromptTemplateNode,
} from '@firebrandanalytics/ff-agent-sdk';
import type { PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk';

export type QueryExplainerPTH = PromptTypeHelper<
  string,
  { static: Record<string, never>; request: Record<string, never> },
  any
>;

/**
 * Example tables_used item shown to the LLM so it knows the expected
 * shape of the JSON array entries.
 */
const EXAMPLE_TABLES_USED_ITEM = {
  table_name: 'customers',
  business_name: 'Customer Directory',
  role_in_query: 'Source of customer names for the aggregation',
};

export class QueryExplainerPrompt extends Prompt<QueryExplainerPTH> {
  constructor() {
    super({
      role: 'system',
      static_args: {} as any,
    });

    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Process_Section());
    this.add_section(this.get_Performance_Section());
    this.add_section(this.get_Semantic_Section());
    this.add_section(this.get_Output_Schema_Section());
  }
```

### The Context Section

The first section defines the bot's role and what tools are available. It uses `semantic_type: 'context'`:

```typescript
  /**
   * Context section — role definition and available tools.
   */
  protected get_Context_Section(): PromptTemplateNode<QueryExplainerPTH> {
    return new PromptTemplateSectionNode<QueryExplainerPTH>({
      semantic_type: 'context',
      name: 'context',
      children: [
        'You are a SQL Query Analyst that provides both performance analysis and semantic interpretation of SQL queries.',
        new PromptTemplateListNode<QueryExplainerPTH>({
          semantic_type: 'context',
          name: 'tools_context',
          content: 'You have access to tools that connect to the Data Access Service (DAS), which provides:',
          children: [
            'Query execution plans (EXPLAIN/ANALYZE)',
            'Data dictionary with table and column descriptions, business names, and tags',
            'Schema information with column types and relationships',
          ],
          list_label_function: (_req: any, _child: any, _idx: number) => '- ',
        }),
      ],
    });
  }
```

**Key points:**
- `semantic_type: 'context'` marks this as background information
- `children` accepts both plain strings and typed nodes
- The `PromptTemplateListNode`'s `content` acts as a header line before the list items
- Named children (e.g., `name: 'tools_context'`) can be targeted for overrides in subclasses

### The Process Section

Numbered steps the LLM must follow, using `PromptTemplateListNode`:

```typescript
  /**
   * Process section — numbered steps the LLM must follow.
   */
  protected get_Process_Section(): PromptTemplateNode<QueryExplainerPTH> {
    return new PromptTemplateSectionNode<QueryExplainerPTH>({
      semantic_type: 'rule',
      name: 'process',
      content: 'When given a SQL query, follow these steps:',
      children: [
        new PromptTemplateListNode<QueryExplainerPTH>({
          semantic_type: 'rule',
          children: [
            'Run EXPLAIN ANALYZE on the query using the explain_query tool to get the execution plan.',
            'Identify tables referenced in the query, then look up their semantic meaning using the get_dictionary_tables tool.',
            'Look up column details for the referenced tables using the get_dictionary_columns tool.',
            'Get the schema for type information using the get_schema tool.',
            'Synthesize your analysis into the Performance Analysis and Semantic Analysis sections described below.',
          ],
          list_label_function: (_req: any, _child: any, idx: number) => `${idx + 1}. `,
        }),
      ],
    });
  }
```

**Key points:**
- `PromptTemplateListNode` generates a numbered list using `list_label_function`
- The function receives the request context, the child node, and the zero-based index
- For bullet lists, use `() => '- '` instead

### The Performance Section

Rules for performance analysis:

```typescript
  /**
   * Performance rules section — what the performance analysis must cover.
   */
  protected get_Performance_Section(): PromptTemplateNode<QueryExplainerPTH> {
    return new PromptTemplateSectionNode<QueryExplainerPTH>({
      semantic_type: 'rule',
      name: 'performance_analysis',
      content: 'Performance Analysis:',
      children: [
        new PromptTemplateListNode<QueryExplainerPTH>({
          semantic_type: 'rule',
          children: [
            'Summarize what the execution plan reveals',
            'Identify bottlenecks (sequential scans on large tables, missing indexes, expensive joins)',
            'Provide specific, actionable optimization suggestions (e.g., "Add an index on orders.customer_id")',
            'Note the estimated cost and actual execution time if available',
          ],
          list_label_function: (_req: any, _child: any, _idx: number) => '- ',
        }),
      ],
    });
  }
```

### The Semantic Section

Rules for semantic analysis, plus important notes:

```typescript
  /**
   * Semantic rules section — what the semantic analysis must cover.
   */
  protected get_Semantic_Section(): PromptTemplateNode<QueryExplainerPTH> {
    return new PromptTemplateSectionNode<QueryExplainerPTH>({
      semantic_type: 'rule',
      name: 'semantic_analysis',
      content: 'Semantic Analysis:',
      children: [
        new PromptTemplateListNode<QueryExplainerPTH>({
          semantic_type: 'rule',
          children: [
            'State the business question this query answers in plain English',
            'Explain the business domain context (e.g., "This query operates in the sales/customer analytics domain")',
            'For each table, explain its business role in the query',
            'Identify the business entities involved and their relationships',
            'If dictionary annotations are available, use the business_name and description fields to enrich your explanation',
          ],
          list_label_function: (_req: any, _child: any, _idx: number) => '- ',
        }),
        new PromptTemplateSectionNode<QueryExplainerPTH>({
          semantic_type: 'rule',
          name: 'important_notes',
          content: 'Important Notes:',
          children: [
            new PromptTemplateListNode<QueryExplainerPTH>({
              semantic_type: 'rule',
              children: [
                'Always call tools to gather information before producing your analysis',
                'If dictionary annotations are not available for some tables, use the table and column names to infer semantic meaning',
                'Focus on practical, actionable insights',
                'The business_question should be something a non-technical stakeholder would understand',
              ],
              list_label_function: (_req: any, _child: any, _idx: number) => '- ',
            }),
          ],
        }),
      ],
    });
  }
```

### The Output Schema Section

The exact field names the LLM must use, plus a JSON example via `PromptTemplateStructDataNode`:

```typescript
  /**
   * Output schema section — exact field names required in the JSON output,
   * plus an example of the tables_used structure.
   */
  protected get_Output_Schema_Section(): PromptTemplateNode<QueryExplainerPTH> {
    return new PromptTemplateSectionNode<QueryExplainerPTH>({
      semantic_type: 'sample_output',
      name: 'output_schema',
      content: 'Output JSON Field Names (IMPORTANT — use these exact names):',
      children: [
        new PromptTemplateListNode<QueryExplainerPTH>({
          semantic_type: 'sample_output',
          name: 'field_names',
          content: 'Your JSON output MUST use these exact field names:',
          children: [
            'performance.summary, performance.bottlenecks, performance.optimization_suggestions',
            'performance.estimated_cost (optional), performance.execution_time_ms (optional)',
            'semantics.business_question, semantics.domain_context',
            'semantics.tables_used (array of objects with: table_name, business_name, role_in_query)',
            'semantics.entities_involved (array of strings)',
            'semantics.relationships (array of strings)',
          ],
          list_label_function: (_req: any, _child: any, _idx: number) => '- ',
        }),
        new PromptTemplateTextNode<QueryExplainerPTH>({
          content: 'Example tables_used item:',
        }),
        new PromptTemplateStructDataNode<QueryExplainerPTH>({
          data: EXAMPLE_TABLES_USED_ITEM,
        }),
      ],
    });
  }
}
```

**Key points:**
- `semantic_type: 'sample_output'` marks this as expected output format
- `PromptTemplateListNode` uses `content` as a header line before the list items — this avoids creating a separate `PromptTemplateTextNode` just for the heading
- `PromptTemplateStructDataNode` renders the `EXAMPLE_TABLES_USED_ITEM` object as JSON in the prompt
- This is better than embedding JSON strings manually — the framework handles formatting

## Concepts: Structured Output with Tool Calling

Our bot needs two independent capabilities:

1. **Tool calling** — `MixinBot` provides the dispatch table mechanism
2. **Structured output** — `StructuredOutputBotMixin` validates the final response against a Zod schema

To combine them, we use `ComposeMixins` from `@firebrandanalytics/shared-utils`. This merges the two mixin classes into a single base class.

### How StructuredOutputBotMixin Works

The mixin doesn't use JSON Schema mode (`response_format`). Instead, it:

1. Converts your Zod schema to a natural language description
2. Injects that description into the LLM prompt
3. After the LLM responds, parses the output as JSON
4. Validates against the Zod schema using `safeParse()`
5. If validation fails and `max_tries > 1`, retries with the error feedback

Because the schema is communicated as natural language (not a formal constraint), the LLM may produce slightly different field names. Adding explicit field name instructions to the prompt (as we did in `get_Output_Schema_Section`) dramatically improves reliability.

## Step 2: Create the User Input Prompt

The bot also needs a user-role prompt that presents the SQL query and connection name:

```typescript
// This goes in the bot constructor (Step 3)
const inputPrompt = new Prompt<QueryExplainerPTH>({
  role: 'user',
  static_args: {} as any,
});
inputPrompt.add_section(
  new PromptTemplateTextNode<QueryExplainerPTH>({
    content: (request: any) => {
      const input = request.input as string;
      const connection = request.args?.connection ?? 'firekicks';
      return `Analyze the following SQL query:\n\n\`\`\`sql\n${input}\n\`\`\`\n\nConnection name: ${connection}`;
    },
  })
);
```

The `content` function receives the bot request at runtime. It extracts the SQL from `request.input` and the connection name from `request.args`.

## Step 3: Build the Bot Class

**`apps/query-bundle/src/bots/QueryExplainerBot.ts`**:

```typescript
import {
  MixinBot,
  StructuredOutputBotMixin,
  StructuredPromptGroup,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import type { BotTypeHelper } from '@firebrandanalytics/ff-agent-sdk';
import type { BrokerTextContent } from '@firebrandanalytics/shared-types';

import { QueryAnalysisSchema, type QUERY_ANALYSIS_OUTPUT } from '../schemas.js';
import {
  QueryExplainerPrompt,
  type QueryExplainerPTH,
} from '../prompts/QueryExplainerPrompt.js';
import { dasClient } from '../das-client.js';

// ── Type helpers ────────────────────────────────────────────

export type QueryExplainerBTH = BotTypeHelper<
  QueryExplainerPTH,
  QUERY_ANALYSIS_OUTPUT,
  QUERY_ANALYSIS_OUTPUT,
  any,
  BrokerTextContent
>;

// ── Tool dispatch table (from Part 3) ───────────────────────

const queryExplainerTools: Record<string, { func: Function; spec: any }> = {
  // ... all four tools from Part 3 go here ...
  // explain_query, get_dictionary_tables, get_dictionary_columns, get_schema
};

// ── Bot class ───────────────────────────────────────────────

class QueryExplainerBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<QueryExplainerBTH, [StructuredOutputBotMixin<QueryExplainerBTH, typeof QueryAnalysisSchema>]>,
  [StructuredOutputBotMixin<QueryExplainerBTH, typeof QueryAnalysisSchema>]
]> {
  constructor() {
    // Build the user input prompt
    const inputPrompt = new Prompt<QueryExplainerPTH>({
      role: 'user',
      static_args: {} as any,
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<QueryExplainerPTH>({
        content: (request: any) => {
          const input = request.input as string;
          const connection = request.args?.connection ?? 'firekicks';
          return `Analyze the following SQL query:\n\n\`\`\`sql\n${input}\n\`\`\`\n\nConnection name: ${connection}`;
        },
      })
    );

    // Wrap prompts in a StructuredPromptGroup
    const promptGroup = new StructuredPromptGroup<QueryExplainerPTH>({
      base: new PromptGroup<QueryExplainerPTH>([
        { name: 'query_explainer_prompt', prompt: new QueryExplainerPrompt() },
      ]),
      input: new PromptGroup<QueryExplainerPTH>([
        { name: 'sql_input', prompt: inputPrompt },
      ]),
    });

    // Call super with bot config + structured output config
    super(
      [{
        name: 'QueryExplainerBot',
        model_pool_name: process.env.MODEL_POOL_NAME || 'firebrand-gpt-5.2-failover',
        base_prompt_group: promptGroup,
        static_args: {} as any,
        max_tries: 3,
        dispatch_table: queryExplainerTools as any,
      }],
      [{ schema: QueryAnalysisSchema }]
    );

    // Workaround: set semantic label on the thread_try directly
    if ((this as any).thread_try) {
      (this as any).thread_try.semantic_label_function = () => 'QueryExplainerBot';
    }
  }

  // Prototype backup for get_semantic_label
  get_semantic_label_impl(_request: any): string {
    return 'QueryExplainerBot';
  }
}

@RegisterBot('QueryExplainerBot')
export class QueryExplainerBot extends QueryExplainerBotBase {}
```

### Understanding the Constructor

The `super()` call takes **two arrays**:

**First array — Bot configuration** (for `MixinBot`):
```typescript
[{
  name: 'QueryExplainerBot',         // Must match @RegisterBot name
  model_pool_name: '...',            // Which LLM model pool to use
  base_prompt_group: promptGroup,    // System + user prompts
  static_args: {} as any,            // Static template args (none here)
  max_tries: 3,                      // Retry up to 3 times on validation failure
  dispatch_table: queryExplainerTools, // The tools the LLM can call
}]
```

**Second array — Structured output config** (for `StructuredOutputBotMixin`):
```typescript
[{ schema: QueryAnalysisSchema }]    // Zod schema for output validation
```

### The get_semantic_label Workaround

When using `ComposeMixins`, the prototype chain doesn't always propagate methods correctly. The `MixinBot` base class calls `get_semantic_label` during initialization, but the composed class may not have it.

The fix is two-pronged:

1. **Runtime fix**: Set `thread_try.semantic_label_function` directly in the constructor
2. **Prototype backup**: Define `get_semantic_label_impl` as a method on the base class

If you see `Error: get_semantic_label not implemented`, this is the fix.

### Why @RegisterBot on a Subclass?

The `@RegisterBot` decorator registers the bot class with the SDK's bot registry. We apply it to a thin subclass rather than the base class because TypeScript decorators interact poorly with `ComposeMixins` when applied directly.

## Step 4: Verify the Build

Build the project to make sure everything compiles:

```bash
pnpm build
```

You should see no TypeScript errors. The bot is now ready to be wired into an entity.

---

**Next:** [Part 5: Entity & Bundle](./part-05-entity-and-bundle.md)
