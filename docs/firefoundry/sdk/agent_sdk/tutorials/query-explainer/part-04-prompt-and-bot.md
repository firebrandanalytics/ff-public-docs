# Part 4: Prompt & Bot

In this part you'll create the system prompt that instructs the LLM to call tools before answering, then build the bot class that combines tool calling with structured output validation.

**What you'll learn:**
- Designing system prompts for tool-calling bots
- Using `ComposeMixins` to combine `MixinBot` with `StructuredOutputBotMixin`
- Why explicit field name instructions improve schema validation reliability
- The `get_semantic_label` workaround for `ComposeMixins`
- Using `@RegisterBot` for auto-registration

**What you'll build:** A `QueryExplainerBot` that calls DAS tools, then produces a Zod-validated JSON analysis with performance and semantic sections.

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

Because the schema is communicated as natural language (not a formal constraint), the LLM may produce slightly different field names. Adding explicit field name instructions to the prompt dramatically improves reliability.

## Step 1: Create the System Prompt

The prompt is the most important piece of a tool-calling bot. It must tell the LLM:
- What tools are available and when to call them
- The exact order of operations
- What the final output should look like (including exact field names)

**`apps/query-bundle/src/prompts/QueryExplainerPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTemplateTextNode,
} from '@firebrandanalytics/ff-agent-sdk';
import type { PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk';

export type QueryExplainerPTH = PromptTypeHelper<
  string,
  { static: Record<string, never>; request: Record<string, never> },
  any
>;

export class QueryExplainerPrompt extends Prompt<QueryExplainerPTH> {
  constructor() {
    super({
      role: 'system',
      static_args: {} as any,
    });

    this.add_section(
      new PromptTemplateTextNode<QueryExplainerPTH>({
        content: () => SYSTEM_PROMPT,
      })
    );
  }
}
```

Now define the prompt text. This is the core instruction set:

```typescript
const SYSTEM_PROMPT = `You are a SQL Query Analyst that provides both performance analysis and semantic interpretation of SQL queries.

You have access to tools that connect to the Data Access Service (DAS), which provides:
- Query execution plans (EXPLAIN/ANALYZE)
- Data dictionary with table and column descriptions, business names, and tags
- Schema information with column types and relationships

## Your Process

When given a SQL query, follow these steps:

1. **Run EXPLAIN ANALYZE** on the query using the explain_query tool to get the execution plan.

2. **Identify tables** referenced in the query, then look up their semantic meaning using the get_dictionary_tables tool.

3. **Look up column details** for the referenced tables using the get_dictionary_columns tool.

4. **Get the schema** for type information using the get_schema tool.

5. **Synthesize your analysis** into two sections:

### Performance Analysis
- Summarize what the execution plan reveals
- Identify bottlenecks (sequential scans on large tables, missing indexes, expensive joins)
- Provide specific, actionable optimization suggestions
- Note the estimated cost and actual execution time if available

### Semantic Analysis
- State the business question this query answers in plain English
- Explain the business domain context
- For each table, explain its business role in the query
- Identify the business entities involved and their relationships
- If dictionary annotations are available, use the business_name and description fields

## Important Notes
- Always call tools to gather information before producing your analysis
- If dictionary annotations are not available for some tables, use the table and column names to infer semantic meaning
- Focus on practical, actionable insights
- The business_question should be something a non-technical stakeholder would understand

## Output JSON Field Names (IMPORTANT — use these exact names)
Your JSON output MUST use these exact field names:
- performance.summary, performance.bottlenecks, performance.optimization_suggestions
- performance.estimated_cost (optional), performance.execution_time_ms (optional)
- semantics.business_question, semantics.domain_context
- semantics.tables_used (array of objects with: table_name, business_name, role_in_query)
- semantics.entities_involved (array of strings)
- semantics.relationships (array of strings)

Example tables_used item: {"table_name": "customers", "business_name": "Customer Directory", "role_in_query": "Source of customer names for the aggregation"}`;
```

**Key points:**
- The "Your Process" section with numbered steps guides the LLM to call tools in a specific order
- The "Output JSON Field Names" section is critical — without it, the LLM may use different names (e.g., `tableName` instead of `table_name`) and fail Zod validation
- The example `tables_used` item shows the LLM exactly what shape to produce

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
import { DASClient } from '../das-client.js';

// ── Type helpers ────────────────────────────────────────────

export type QueryExplainerBTH = BotTypeHelper<
  QueryExplainerPTH,
  QUERY_ANALYSIS_OUTPUT,
  QUERY_ANALYSIS_OUTPUT,
  any,
  BrokerTextContent
>;

// ── DAS Client singleton ────────────────────────────────────

const DAS_URL = process.env.DAS_URL || 'http://localhost:8080';
const DAS_API_KEY = process.env.DAS_API_KEY || 'dev-api-key';
const DAS_IDENTITY = process.env.DAS_IDENTITY || 'user:admin';
const dasClient = new DASClient({
  baseUrl: DAS_URL,
  apiKey: DAS_API_KEY,
  identity: DAS_IDENTITY,
});

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
