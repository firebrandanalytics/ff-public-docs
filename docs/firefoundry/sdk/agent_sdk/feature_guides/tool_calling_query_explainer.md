# Building a Tool-Calling Agent: SQL Query Analyzer

Welcome! In previous tutorials, you learned how to build bots, entities, and agent bundles. Now we'll take your skills to the next level by building an agent that **calls real external tools** to gather data before producing its analysis.

We'll create a **Query Explainer** agent that takes a SQL query and produces both a performance analysis and a semantic explanation. The key difference from previous tutorials? Instead of using mock data, our bot calls the **Data Access Service (DAS)** to get real execution plans, schema information, and data dictionary annotations.

## The Goal

By the end of this tutorial, you'll have built:
- A **DAS client** that wraps HTTP calls to the Data Access Service
- **Four tools** that the LLM can call to gather query intelligence
- A **tool-calling bot** that combines `MixinBot` with `StructuredOutputBotMixin`
- An **entity** that delegates to the bot via `BotRunnableEntityMixin`
- An **agent bundle** with custom `@ApiEndpoint` routes for submitting and polling queries

**Key Elements:**
- Dispatch table pattern for tool calling (`{ func, spec }` objects)
- `ComposeMixins` for combining independent mixin features
- Structured output with Zod schema validation
- Async fire-and-forget entity processing with status polling

## Prerequisites

Before starting, make sure you've:
1. Completed the [Agent Bundle Tutorial](../core/agent_bundle_tutorial.md) (entities, bots, bundles)
2. Have access to a running **Data Access Service** with a configured connection
   - See the [DAS Getting Started guide](../../../platform/services/data-access/getting-started.md) for setup
   - See the [FireKicks Tutorial](../../../platform/services/data-access/firekicks/README.md) for a sample dataset
3. Familiarity with the [Tool Calling guide](./ad_hoc_tool_calls.md) for the basic dispatch table pattern

### Architecture

```
┌──────────────┐     POST /api/analyze-query      ┌──────────────────┐
│              │ ──────────────────────────────────→│                  │
│   Client     │                                   │   Agent Bundle   │
│  (curl/GUI)  │     GET /api/query-status         │                  │
│              │ ──────────────────────────────────→│  ┌────────────┐ │
└──────────────┘                                   │  │   Entity    │ │
                                                   │  │  delegates  │ │
                                                   │  │     to      │ │
                                                   │  │    Bot      │ │
                                                   │  │  ┌───────┐ │ │
                                                   │  │  │ Tools │ │ │
                                                   │  │  └───┬───┘ │ │
                                                   │  └─────┼─────┘ │
                                                   └────────┼───────┘
                                                            │
                                                   ┌────────▼───────┐
                                                   │  Data Access   │
                                                   │   Service      │
                                                   │  (EXPLAIN,     │
                                                   │   Dictionary,  │
                                                   │   Schema)      │
                                                   └────────────────┘
```

---

## Part 1: Understanding the Tool Calling Pattern

When a bot has a **dispatch table**, the broker presents the available tools to the LLM along with the prompt. The LLM can then choose to call tools before producing its final response. Here's how it works:

1. Your bot sends the prompt + tool definitions to the broker
2. The LLM decides which tools to call and with what arguments
3. The broker routes tool calls back to your dispatch table functions
4. Your functions execute (e.g., call DAS) and return results
5. The LLM receives the tool results and produces its final answer

### The Dispatch Table Structure

Each tool in the dispatch table is an object with two properties:

```typescript
const tools: Record<string, { func: Function; spec: any }> = {
  tool_name: {
    func: async (request: any, args: { param1: string }) => {
      // Your tool implementation
      return { result: 'some data' };
    },
    spec: {
      name: 'tool_name',
      description: 'What this tool does',
      inputSchema: {        // Note: inputSchema, NOT parameters
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'Description of param1' },
        },
        required: ['param1'],
      },
    },
  },
};
```

**Important:** The tool spec uses `inputSchema` (not `parameters` as in some OpenAI examples). This is the format the FireFoundry broker expects.

The `func` receives two arguments:
- `request` — the original bot request context (usually unused by tools)
- `args` — the arguments the LLM chose to pass, matching `inputSchema`

---

## Part 2: Building the DAS Client

Before we define our tools, we need a client to talk to the Data Access Service.

### Why a Client Wrapper?

The DAS requires authentication headers (`X-API-Key`, `X-On-Behalf-Of`) on every request, and its response format uses camelCase field names that we want to normalize. A thin client wrapper handles both concerns.

### Environment Configuration

The DAS can be accessed in several ways depending on your deployment:

| Pattern | `DAS_URL` value | Use case |
|---------|----------------|----------|
| Port-forward | `http://localhost:8080` | Local development |
| Kong gateway | `https://home.example.com/das` | Production / remote access |
| In-cluster | `http://ff-data-access.ff-dev.svc.cluster.local:8080` | Kubernetes pod-to-pod |

### The Client Implementation

```typescript
// das-client.ts
import axios, { type AxiosInstance } from 'axios';
import { logger } from '@firebrandanalytics/ff-agent-sdk';

export interface DASClientOptions {
  baseUrl: string;
  apiKey?: string;
  identity?: string;
  timeout?: number;
}

export interface ExplainResult {
  plan_lines: string[];
  sql: string;
  duration_ms?: number;
}

export interface DictionaryTable {
  connection: string;
  table_name: string;
  business_name: string;
  description: string;
  tags: string[];
  semantic_type: string;
}

export interface DictionaryColumn {
  connection: string;
  table_name: string;
  column_name: string;
  business_name: string;
  description: string;
  semantic_type: string;
  usage_notes?: string;
}

export interface SchemaTable {
  name: string;
  columns: { name: string; type: string; nullable: boolean; primary_key?: boolean }[];
}

export class DASClient {
  private http: AxiosInstance;

  constructor(options: DASClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': options.apiKey ?? 'dev-api-key',
        'X-On-Behalf-Of': options.identity ?? 'user:admin',
      },
    });
  }

  async explainSQL(
    connection: string,
    sql: string,
    options?: { analyze?: boolean; verbose?: boolean }
  ): Promise<ExplainResult> {
    const response = await this.http.post(
      `/v1/connections/${encodeURIComponent(connection)}/explain-sql`,
      { sql, analyze: options?.analyze ?? false, verbose: options?.verbose ?? false }
    );
    const data = response.data;
    return {
      plan_lines: data.planLines ?? data.plan_lines ?? [],
      sql: data.sql,
      duration_ms: data.durationMs ?? data.duration_ms,
    };
  }

  async getSchema(connection: string, table?: string): Promise<{ tables: SchemaTable[] }> {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    const qs = params.toString();
    const response = await this.http.get(
      `/v1/connections/${encodeURIComponent(connection)}/schema${qs ? '?' + qs : ''}`
    );
    return response.data;
  }

  async getDictionaryTables(
    connection: string,
    options?: { tags?: string }
  ): Promise<DictionaryTable[]> {
    const params = new URLSearchParams();
    params.set('connection', connection);
    if (options?.tags) params.set('tags', options.tags);
    const response = await this.http.get(`/v1/dictionary/tables?${params.toString()}`);
    return response.data.tables ?? response.data;
  }

  async getDictionaryColumns(
    connection: string,
    tables?: string[]
  ): Promise<DictionaryColumn[]> {
    const params = new URLSearchParams();
    params.set('connection', connection);
    if (tables?.length) {
      for (const t of tables) params.append('table', t);
    }
    const response = await this.http.get(`/v1/dictionary/columns?${params.toString()}`);
    return response.data.columns ?? response.data;
  }
}
```

**Key Design Decisions:**
- Response field normalization (camelCase → snake_case) happens in each method
- We use `??` fallbacks because the DAS may return either format
- Authentication headers are set once in the constructor
- Each method encodes connection names for URL safety

---

## Part 3: Defining Your Tools

Now let's define the four tools the LLM can call. Each tool wraps a DAS client method and handles errors gracefully.

### Error Handling Pattern

Tools should **return error information** rather than throwing exceptions. This lets the LLM recover — it might try a different approach or work with partial data:

```typescript
// Good: return error info
return { error: err.message, tables: [], note: 'Schema not available' };

// Bad: throw (bot aborts the entire run)
throw new Error('Schema lookup failed');
```

### The Complete Dispatch Table

```typescript
// tools section of QueryExplainerBot.ts

const DAS_URL = process.env.DAS_URL || 'http://localhost:8080';
const DAS_API_KEY = process.env.DAS_API_KEY || 'dev-api-key';
const DAS_IDENTITY = process.env.DAS_IDENTITY || 'user:admin';
const dasClient = new DASClient({
  baseUrl: DAS_URL, apiKey: DAS_API_KEY, identity: DAS_IDENTITY,
});

const queryExplainerTools: Record<string, { func: Function; spec: any }> = {
  explain_query: {
    func: async (_request: any, args: {
      sql: string; connection: string; analyze?: boolean; verbose?: boolean;
    }) => {
      logger.info('[Tool] explain_query', { connection: args.connection });
      try {
        const result = await dasClient.explainSQL(args.connection, args.sql, {
          analyze: args.analyze ?? true,
          verbose: args.verbose ?? false,
        });
        return {
          plan: result.plan_lines.join('\n'),
          sql: result.sql,
          duration_ms: result.duration_ms,
        };
      } catch (err: any) {
        return { error: err.message, plan: 'EXPLAIN not available' };
      }
    },
    spec: {
      name: 'explain_query',
      description: 'Run EXPLAIN or EXPLAIN ANALYZE on a SQL query via the Data Access Service.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The SQL SELECT statement to explain' },
          connection: { type: 'string', description: 'The DAS connection name' },
          analyze: { type: 'boolean', description: 'Run EXPLAIN ANALYZE. Default: true' },
          verbose: { type: 'boolean', description: 'Include verbose output. Default: false' },
        },
        required: ['sql', 'connection'],
      },
    },
  },

  get_dictionary_tables: {
    func: async (_request: any, args: { connection: string; tags?: string }) => {
      logger.info('[Tool] get_dictionary_tables', { connection: args.connection });
      try {
        const tables = await dasClient.getDictionaryTables(args.connection, {
          tags: args.tags,
        });
        return { tables };
      } catch (err: any) {
        return { tables: [], note: 'Dictionary annotations not available' };
      }
    },
    spec: {
      name: 'get_dictionary_tables',
      description: 'Look up data dictionary annotations for tables. Returns business names, descriptions, tags.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', description: 'The DAS connection name' },
          tags: { type: 'string', description: 'Comma-separated tags to filter by' },
        },
        required: ['connection'],
      },
    },
  },

  get_dictionary_columns: {
    func: async (_request: any, args: { connection: string; tables: string[] }) => {
      logger.info('[Tool] get_dictionary_columns', { connection: args.connection });
      try {
        const columns = await dasClient.getDictionaryColumns(args.connection, args.tables);
        return { columns };
      } catch (err: any) {
        return { columns: [], note: 'Column annotations not available' };
      }
    },
    spec: {
      name: 'get_dictionary_columns',
      description: 'Look up column annotations for specific tables. Returns business names, descriptions, semantic types.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', description: 'The DAS connection name' },
          tables: {
            type: 'array', items: { type: 'string' },
            description: 'Table names to get column annotations for',
          },
        },
        required: ['connection', 'tables'],
      },
    },
  },

  get_schema: {
    func: async (_request: any, args: { connection: string; table?: string }) => {
      logger.info('[Tool] get_schema', { connection: args.connection });
      try {
        const schema = await dasClient.getSchema(args.connection, args.table);
        return { tables: schema.tables };
      } catch (err: any) {
        return { tables: [], note: 'Schema not available' };
      }
    },
    spec: {
      name: 'get_schema',
      description: 'Get the database schema (tables, columns, types, keys) for a connection.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', description: 'The DAS connection name' },
          table: { type: 'string', description: 'Optional table name to filter to' },
        },
        required: ['connection'],
      },
    },
  },
};
```

Each tool follows the same pattern:
1. Log the invocation for debugging
2. Call the DAS client method
3. Return a simplified result object
4. On error, return a graceful fallback with a `note` or `error` field

---

## Part 4: The Bot — ComposeMixins + Structured Output

Now for the central piece: the bot that ties together tools and structured output.

### Why ComposeMixins?

Our bot needs **two independent features**:
- `MixinBot` — the standard bot with tool calling support
- `StructuredOutputBotMixin` — validates the final output against a Zod schema

`ComposeMixins` (from `@firebrandanalytics/shared-utils`) merges multiple mixin classes into a single base class, letting you combine features that don't depend on each other.

### Defining the Output Schema

First, define what the LLM's output should look like using [Zod](https://zod.dev):

```typescript
// schemas.ts
import { z } from 'zod';

export const QueryAnalysisSchema = z.object({
  performance: z.object({
    summary: z.string().describe('One-paragraph summary of query performance'),
    bottlenecks: z.array(z.string()).describe('Performance bottlenecks identified'),
    optimization_suggestions: z.array(z.string()).describe('Actionable optimization suggestions'),
    estimated_cost: z.string().optional().describe('Estimated query cost from EXPLAIN'),
    execution_time_ms: z.number().optional().describe('Actual execution time if ANALYZE was used'),
  }),
  semantics: z.object({
    business_question: z.string().describe('The business question this query answers'),
    domain_context: z.string().describe('Business domain explanation'),
    tables_used: z.array(z.object({
      table_name: z.string().describe('The database table name (e.g., "customers")'),
      business_name: z.string().optional().describe('Business-friendly name from dictionary'),
      role_in_query: z.string().describe('What role this table plays in the query'),
    })).describe('Tables referenced and their semantic meaning'),
    entities_involved: z.array(z.string()).describe('Business entities involved'),
    relationships: z.array(z.string()).describe('Key relationships between entities'),
  }),
});

export type QUERY_ANALYSIS_OUTPUT = z.infer<typeof QueryAnalysisSchema>;
```

**Important:** The `.describe()` calls on each field serve a dual purpose — they document the schema AND are included in the prompt that the `StructuredOutputBotMixin` sends to the LLM. The LLM uses these descriptions to produce correctly-named fields.

### The System Prompt

The prompt is critical for tool-calling bots. It must instruct the LLM to:
1. Call tools before producing the final answer
2. Use specific steps in a specific order
3. Output JSON with exact field names matching the Zod schema

```typescript
// prompts/QueryExplainerPrompt.ts
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
    super({ role: 'system', static_args: {} as any });

    this.add_section(
      new PromptTemplateTextNode<QueryExplainerPTH>({
        content: () => SYSTEM_PROMPT,
      })
    );
  }
}

const SYSTEM_PROMPT = `You are a SQL Query Analyst that provides both performance analysis and semantic interpretation of SQL queries.

You have access to tools that connect to the Data Access Service (DAS), which provides:
- Query execution plans (EXPLAIN/ANALYZE)
- Data dictionary with table and column descriptions, business names, and tags
- Schema information with column types and relationships

## Your Process

When given a SQL query, follow these steps:

1. **Run EXPLAIN ANALYZE** using the explain_query tool.
2. **Look up table annotations** using get_dictionary_tables.
3. **Look up column details** using get_dictionary_columns.
4. **Get the schema** using get_schema.
5. **Synthesize your analysis** into performance and semantic sections.

## Important Notes
- Always call tools to gather information before producing your analysis
- If dictionary annotations are not available, infer semantic meaning from names
- The business_question should be something a non-technical stakeholder would understand

## Output JSON Field Names (IMPORTANT)
Your JSON output MUST use these exact field names:
- performance.summary, performance.bottlenecks, performance.optimization_suggestions
- semantics.business_question, semantics.domain_context
- semantics.tables_used (array with: table_name, business_name, role_in_query)
- semantics.entities_involved, semantics.relationships

Example tables_used item: {"table_name": "customers", "business_name": "Customer Directory", "role_in_query": "Source of customer names"}`;
```

> **Lesson Learned:** The `StructuredOutputBotMixin` converts your Zod schema to natural language and includes it in the prompt. It does NOT use JSON Schema mode (`response_format`). This means the LLM may produce slightly different field names than expected. Adding explicit field name instructions to the system prompt (the "Output JSON Field Names" section) dramatically improves reliability.

### The Bot Class

Here's where it all comes together:

```typescript
// bots/QueryExplainerBot.ts
import {
  MixinBot,
  StructuredOutputBotMixin,
  StructuredPromptGroup,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import type { BotTypeHelper } from '@firebrandanalytics/ff-agent-sdk';
import type { BrokerTextContent } from '@firebrandanalytics/shared-types';

import { QueryAnalysisSchema, type QUERY_ANALYSIS_OUTPUT } from '../schemas.js';
import { QueryExplainerPrompt, type QueryExplainerPTH } from '../prompts/QueryExplainerPrompt.js';

// Type helpers
export type QueryExplainerBTH = BotTypeHelper<
  QueryExplainerPTH,
  QUERY_ANALYSIS_OUTPUT,
  QUERY_ANALYSIS_OUTPUT,
  any,
  BrokerTextContent
>;

// Build the combined base class
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

    // Call super with bot config and structured output config
    super(
      [{
        name: 'QueryExplainerBot',
        model_pool_name: process.env.MODEL_POOL_NAME || 'firebrand-gpt-5.2-failover',
        base_prompt_group: promptGroup,
        static_args: {} as any,
        max_tries: 3,
        dispatch_table: queryExplainerTools as any,  // <-- tools go here
      }],
      [{ schema: QueryAnalysisSchema }]  // <-- structured output schema
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

// Apply the @RegisterBot decorator on a final subclass
@RegisterBot('QueryExplainerBot')
export class QueryExplainerBot extends QueryExplainerBotBase {}
```

### Understanding the Constructor Arguments

The `super()` call takes two arrays:

**First array — Bot configuration:**
```typescript
[{
  name: 'QueryExplainerBot',         // Bot name (must match @RegisterBot)
  model_pool_name: '...',            // Which model pool to use
  base_prompt_group: promptGroup,    // System + user prompts
  static_args: {} as any,            // Static template args (none here)
  max_tries: 3,                      // Retry on schema validation failure
  dispatch_table: tools,             // The tool dispatch table
}]
```

**Second array — StructuredOutputBotMixin config:**
```typescript
[{ schema: QueryAnalysisSchema }]    // Zod schema for output validation
```

### The `get_semantic_label` Workaround

When using `ComposeMixins`, the prototype chain doesn't always propagate methods correctly. The `MixinBot` base class calls `get_semantic_label` during initialization, but the composed class may not have it on its prototype.

**Two-pronged fix:**
1. Set `thread_try.semantic_label_function` directly in the constructor (runtime fix)
2. Define `get_semantic_label_impl` as a method (prototype backup)

This is a known quirk of `ComposeMixins` — if you see `get_semantic_label not implemented`, this is the fix.

---

## Part 5: Entity and Agent Bundle

### The Entity

The entity delegates all its work to the bot using `BotRunnableEntityMixin`. Its main job is mapping entity data to bot request arguments:

```typescript
// entities/QueryExplainerEntity.ts
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  logger,
  Context,
} from '@firebrandanalytics/ff-agent-sdk';
import type {
  EntityFactory,
  BotRequestArgs,
} from '@firebrandanalytics/ff-agent-sdk';
import type { JSONObject, JSONValue } from '@firebrandanalytics/shared-types';
import { AddMixins } from '@firebrandanalytics/shared-utils';

export interface QueryExplainerEntityDTOData extends JSONObject {
  sql: string;
  connection: string;
  analyze: boolean;
  verbose: boolean;
  result: any | null;
  error: string | null;
  [key: string]: JSONValue;
}

@EntityMixin({
  specificType: 'QueryExplainerEntity',
  generalType: 'QueryExplainerEntity',
  allowedConnections: {},
})
export class QueryExplainerEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<any> {
  constructor(factory: EntityFactory<any>, idOrDto: any) {
    super(
      [factory, idOrDto] as any,
      ['QueryExplainerBot']  // Which bot(s) to delegate to
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: any
  ): Promise<BotRequestArgs<any>> {
    const dto = await (this as any).get_dto();
    const { sql, connection } = dto.data as QueryExplainerEntityDTOData;

    logger.info('[QueryExplainerEntity] Building bot request', {
      entity_id: (this as any).id,
      sql: sql.substring(0, 100),
      connection,
    });

    return {
      args: { connection } as any,
      input: sql,
      context: new Context(dto),
    };
  }
}
```

**Key Points:**
- `['QueryExplainerBot']` tells the mixin which bot to use (must match `@RegisterBot` name)
- `get_bot_request_args_impl` maps entity data → bot `input` + `args`
- The `input` becomes the user message; `args` are available in prompt templates

### The Constructors Registry

```typescript
// constructors.ts
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerEntity } from './entities/QueryExplainerEntity.js';

export const QueryExplainerConstructors = {
  ...FFConstructors,
  QueryExplainerEntity: QueryExplainerEntity,
} as const;
```

### The Agent Bundle

The bundle exposes two `@ApiEndpoint` routes: one to submit a query for analysis, and one to check the status/results.

```typescript
// agent-bundle.ts
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerConstructors } from './constructors.js';

const APP_ID = process.env.FF_APPLICATION_ID || 'b2c7e8a1-3d5f-4b6a-9e2c-1a8d7f6e5b4c';

export class QueryExplainerAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: 'QueryExplainer',
        type: 'agent_bundle',
        description: 'SQL query performance + semantic analysis via DAS',
      },
      QueryExplainerConstructors as any,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info('QueryExplainer bundle initialized!');
  }

  /**
   * Submit a SQL query for analysis (fire-and-forget).
   * Returns the entity_id for status polling.
   */
  @ApiEndpoint({ method: 'POST', route: 'analyze-query' })
  async analyzeQuery(body: {
    sql: string; connection: string; analyze?: boolean; verbose?: boolean;
  }): Promise<{ entity_id: string }> {
    const { sql, connection, analyze = true, verbose = false } = body;

    if (!sql?.trim()) throw new Error('sql is required');
    if (!connection?.trim()) throw new Error('connection is required');

    // Create the entity
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `query-analysis-${Date.now()}`,
      specific_type_name: 'QueryExplainerEntity',
      general_type_name: 'QueryExplainerEntity',
      status: 'Pending',
      data: { sql, connection, analyze, verbose, result: null, error: null },
    });

    const entity_id = entity.id!;

    // Start the workflow in the background
    const iterator = await entity.start();
    (async () => {
      try {
        let valueEnvelope: any = null;
        for await (const envelope of iterator) {
          if (envelope?.type === 'VALUE' && envelope?.value) {
            valueEnvelope = envelope.value;
          }
        }
        if (valueEnvelope) {
          const dto = await entity.get_dto();
          dto.data.result = valueEnvelope;
          await entity.update_data(dto.data);
        }
      } catch (err: any) {
        logger.error('[API] Analysis failed', { entity_id, error: err.message });
        try {
          const dto = await entity.get_dto();
          dto.data.error = err.message;
          await entity.update_data(dto.data);
        } catch { /* best effort */ }
      }
    })();

    return { entity_id };
  }

  /**
   * Get analysis status and results.
   */
  @ApiEndpoint({ method: 'GET', route: 'query-status' })
  async getQueryStatus(query: { entity_id?: string }): Promise<any> {
    const { entity_id } = query;
    if (!entity_id) throw new Error('entity_id query parameter is required');

    const entityDto = await this.entity_client.get_node(entity_id);
    if (!entityDto) throw new Error(`Entity ${entity_id} not found`);

    return {
      entity_id: entityDto.id!,
      status: entityDto.status!,
      data: (entityDto as any).data || {},
    };
  }
}
```

### Iterator Consumption: Finding the VALUE Envelope

When you call `entity.start()`, it returns an async iterator that yields **envelopes** of different types:

| Envelope Type | Contains | When |
|---------------|----------|------|
| `BOT_PROGRESS` | Partial bot output / streaming text | During LLM generation |
| `VALUE` | The bot's final structured output | When the bot completes |
| `STATUS` | Entity status updates | Before/after processing |
| `ERROR` | Error details | On failure |

The `VALUE` envelope contains the actual analysis result. The code filters for it:

```typescript
for await (const envelope of iterator) {
  if (envelope?.type === 'VALUE' && envelope?.value) {
    valueEnvelope = envelope.value;
  }
}
```

> **Gotcha:** Don't use `lastOutput = envelope` — the last envelope is usually `STATUS`, not `VALUE`.

### The Entry Point

```typescript
// index.ts
import { createStandaloneAgentBundle, logger } from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerAgentBundle } from './agent-bundle.js';
import './bots/QueryExplainerBot.js';  // Import for @RegisterBot side effect

const port = parseInt(process.env.PORT || '3001', 10);

async function startServer() {
  logger.info(`Starting QueryExplainer server on port ${port}`);
  await createStandaloneAgentBundle(QueryExplainerAgentBundle, { port });
  logger.info(`Server running on http://localhost:${port}`);
}

startServer();
```

**Important:** The bot file must be imported (even if unused directly) so that the `@RegisterBot` decorator runs and registers the bot class with the SDK.

---

## Part 6: Running and Testing

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Bundle HTTP port |
| `DAS_URL` | `http://localhost:8080` | Data Access Service URL |
| `DAS_API_KEY` | `dev-api-key` | DAS authentication key |
| `DAS_IDENTITY` | `user:admin` | DAS identity header |
| `MODEL_POOL_NAME` | `firebrand-gpt-5.2-failover` | LLM model pool |
| `LLM_BROKER_HOST` | `localhost` | Broker gRPC host |
| `LLM_BROKER_PORT` | `50052` | Broker gRPC port |
| `REMOTE_ENTITY_SERVICE_URL` | (required) | Entity service URL |
| `REMOTE_ENTITY_SERVICE_PORT` | `8080` | Entity service port |
| `USE_REMOTE_ENTITY_CLIENT` | `true` | Enable remote entity client |

### Connecting to Services

For local development, port-forward the platform services:

```bash
# Entity service
kubectl port-forward -n ff-dev svc/firefoundry-core-entity-service 8180:8080

# Broker
kubectl port-forward -n ff-dev svc/firefoundry-core-ff-broker 50052:50052

# Data Access Service (if running in-cluster)
kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080
```

### Starting the Bundle

```bash
# Export required environment variables
export REMOTE_ENTITY_SERVICE_URL=http://localhost
export REMOTE_ENTITY_SERVICE_PORT=8180
export USE_REMOTE_ENTITY_CLIENT=true
export LLM_BROKER_HOST=localhost
export LLM_BROKER_PORT=50052
export DAS_URL=http://localhost:8080
export PORT=3001

# Start the bundle
node dist/index.js
```

### Testing with curl

**Submit a query:**
```bash
curl -X POST http://localhost:3001/api/analyze-query \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT c.first_name, c.last_name, SUM(o.total_amount) as total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.status = '\''completed'\'' GROUP BY c.first_name, c.last_name ORDER BY total_spent DESC LIMIT 10",
    "connection": "firekicks"
  }'
```

**Response:**
```json
{ "entity_id": "abc-123-def-456" }
```

**Poll for results:**
```bash
curl "http://localhost:3001/api/query-status?entity_id=abc-123-def-456"
```

**Response (when complete):**
```json
{
  "entity_id": "abc-123-def-456",
  "status": "Completed",
  "data": {
    "sql": "SELECT ...",
    "connection": "firekicks",
    "result": {
      "performance": {
        "summary": "This query joins customers to orders...",
        "bottlenecks": ["Full scan on orders table"],
        "optimization_suggestions": ["Add index on orders.customer_id"]
      },
      "semantics": {
        "business_question": "Who are the top 10 customers by total spending?",
        "domain_context": "Sales and customer analytics domain",
        "tables_used": [
          {"table_name": "customers", "business_name": "Customer Profiles", "role_in_query": "Customer identity data"},
          {"table_name": "orders", "business_name": "Customer Orders", "role_in_query": "Transaction records"}
        ],
        "entities_involved": ["Customer", "Order"],
        "relationships": ["One Customer places many Orders"]
      }
    }
  }
}
```

### Common Issues and Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| `get_semantic_label not implemented` | `ComposeMixins` prototype chain issue | Add both `thread_try.semantic_label_function` and `get_semantic_label_impl()` |
| `MockBrokerClient` in logs | Missing broker env vars | Set `LLM_BROKER_HOST` and `LLM_BROKER_PORT` |
| Zod validation failures | LLM using wrong field names | Add explicit field name instructions to system prompt |
| `Unsupported protocol undefined:` | Missing entity service config | Set `REMOTE_ENTITY_SERVICE_URL`, `_PORT`, and `USE_REMOTE_ENTITY_CLIENT` |
| Tool calls return errors | DAS not reachable | Check `DAS_URL` and port-forward if needed |

---

## Summary

You've now built a complete tool-calling agent that:

- **Calls real external services** via a dispatch table (not just mock data)
- **Combines two mixins** using `ComposeMixins` for tool calling + structured output
- **Validates LLM output** against a Zod schema with retry
- **Processes queries asynchronously** with entity status polling
- **Handles errors gracefully** in both tools and the overall workflow

### What's Next?

- **Build a Web GUI**: See the [Next.js Query Explainer GUI Tutorial](../../ff_sdk/nextjs_query_explainer_gui.md) for building a frontend
- **Deploy to FireFoundry**: Package your bundle as a container and deploy using `ff ops build` and `ff ops deploy`
- **Explore DAS Features**: Try adding more tools for [stored definitions](../../../platform/services/data-access/firekicks/02-stored-definitions.md) or [ontology context](../../../platform/services/data-access/firekicks/03-ontology.md)
- **Review the Full Source**: The complete source code is in the [ff-demo-apps/query-explainer](https://github.com/firebrandanalytics/ff-demo-apps/tree/feat/query-explainer/query-explainer) repository
