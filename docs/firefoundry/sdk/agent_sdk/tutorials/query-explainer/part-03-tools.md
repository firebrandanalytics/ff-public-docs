# Part 3: Defining Tools

In this part you'll create the dispatch table — four tools that the LLM can call to gather information from the Data Access Service before producing its analysis.

**What you'll learn:**
- The dispatch table pattern: `{ func, spec }` objects
- Tool spec format with `inputSchema` (not `parameters`)
- The error-as-return pattern for graceful tool failures
- How tool functions receive arguments from the LLM

**What you'll build:** Four dispatch table entries that wrap the `DataAccessClient` methods from Part 2.

## Concepts: How Tool Calling Works

When a bot has a `dispatch_table`, the broker presents the tool definitions to the LLM alongside the prompt. The flow is:

```
1. Bot sends prompt + tool specs to broker
2. Broker forwards to LLM
3. LLM decides which tools to call and with what arguments
4. Broker routes each tool call back to your dispatch table
5. Your function executes (e.g., calls DAS) and returns results
6. Results go back to the LLM
7. LLM may call more tools or produce its final answer
```

The LLM sees your tool specs as available functions it can call. It decides the order and arguments based on the system prompt instructions and the tool descriptions.

### Dispatch Table Structure

Each entry in the dispatch table is an object with two properties:

```typescript
const tools: Record<string, { func: Function; spec: any }> = {
  tool_name: {
    func: async (request: any, args: { param1: string }) => {
      // Your implementation
      return { result: 'data' };
    },
    spec: {
      name: 'tool_name',
      description: 'What this tool does',
      inputSchema: {        // Note: inputSchema, NOT parameters
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'Description' },
        },
        required: ['param1'],
      },
    },
  },
};
```

**Important:** The tool spec uses `inputSchema` (not `parameters` as in some OpenAI documentation). This is the format the FireFoundry broker expects.

The `func` receives two arguments:
- `request` — the bot's request context (usually unused by tool functions)
- `args` — the arguments the LLM chose, matching the `inputSchema` definition

### The Error-as-Return Pattern

Tools should **return** error information rather than **throwing** exceptions. When a tool throws, the entire bot run may abort. When it returns error data, the LLM can see the error and adapt:

```typescript
// Good: return error info — LLM can work with partial data
return { error: err.message, tables: [], note: 'Schema not available' };

// Bad: throw — bot run may abort entirely
throw new Error('Schema lookup failed');
```

## Step 1: Set Up the DAS Client

Import the configured client singleton from Part 2:

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';
import { dasClient } from '../das-client.js';
```

Since the `DataAccessClient` throws typed errors, we'll catch them in each tool and return the error message to the LLM.

## Step 2: The explain_query Tool

This tool runs `EXPLAIN ANALYZE` on a SQL query. It's the core tool that provides the execution plan:

```typescript
const queryExplainerTools: Record<string, { func: Function; spec: any }> = {
  explain_query: {
    func: async (
      _request: any,
      args: { sql: string; connection: string; analyze?: boolean; verbose?: boolean }
    ) => {
      logger.info('[Tool] explain_query', {
        connection: args.connection,
        analyze: args.analyze,
      });
      try {
        const result = await dasClient.explainSQL(args.connection, {
          sql: args.sql,
          analyze: args.analyze ?? true,
          verbose: args.verbose ?? false,
        });
        return {
          plan: result.planLines.join('\n'),
          sql: result.sql,
          duration_ms: result.durationMs,
        };
      } catch (err: any) {
        logger.error('[Tool] explain_query failed', { error: err.message });
        return { error: err.message, plan: 'EXPLAIN not available' };
      }
    },
    spec: {
      name: 'explain_query',
      description:
        'Run EXPLAIN or EXPLAIN ANALYZE on a SQL SELECT statement via the Data Access Service. Returns the query execution plan.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The SQL SELECT statement to explain' },
          connection: { type: 'string', description: 'The DAS connection name (e.g., "firekicks")' },
          analyze: { type: 'boolean', description: 'Whether to run EXPLAIN ANALYZE. Default: true' },
          verbose: { type: 'boolean', description: 'Whether to include verbose output. Default: false' },
        },
        required: ['sql', 'connection'],
      },
    },
  },
```

**Key points:**
- The `func` calls `dasClient.explainSQL(connection, { sql, analyze, verbose })` — note the request object pattern
- The response uses `result.planLines` (camelCase) — the published client returns typed fields, no normalization needed
- We default `analyze` to `true` with `args.analyze ?? true`. The published client defaults to `false`, but for query analysis we almost always want the actual execution plan
- The `spec.description` tells the LLM what this tool does — be clear and specific

## Step 3: The get_dictionary_tables Tool

This tool looks up data dictionary annotations for tables — business names, descriptions, and tags:

```typescript
  get_dictionary_tables: {
    func: async (
      _request: any,
      args: { connection: string; tags?: string }
    ) => {
      logger.info('[Tool] get_dictionary_tables', { connection: args.connection });
      try {
        const result = await dasClient.dictionaryTables({
          connection: args.connection,
          tags: args.tags ? args.tags.split(',').map((t) => t.trim()) : undefined,
        });
        return { tables: result.tables };
      } catch (err: any) {
        logger.warn('[Tool] get_dictionary_tables failed', { error: err.message });
        return { tables: [], note: 'Dictionary annotations not available' };
      }
    },
    spec: {
      name: 'get_dictionary_tables',
      description:
        'Look up data dictionary annotations for tables. Returns business names, descriptions, tags, and semantic types.',
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
```

**Key points:**
- `dasClient.dictionaryTables()` takes an options object with `connection`, `tags` (string array), and `excludeTags`
- The LLM passes tags as a comma-separated string; we split it into an array for the client
- The response's `result.tables` is already a `DictionaryTable[]` — no unwrapping needed

## Step 4: The get_dictionary_columns Tool

This tool returns column-level annotations for specific tables:

```typescript
  get_dictionary_columns: {
    func: async (
      _request: any,
      args: { connection: string; tables: string[] }
    ) => {
      logger.info('[Tool] get_dictionary_columns', {
        connection: args.connection,
        tables: args.tables,
      });
      try {
        // The client's dictionaryColumns takes a single table filter,
        // so we call it for each table and merge results
        const allColumns = [];
        for (const table of args.tables) {
          const result = await dasClient.dictionaryColumns({
            connection: args.connection,
            table,
          });
          allColumns.push(...result.columns);
        }
        return { columns: allColumns };
      } catch (err: any) {
        logger.warn('[Tool] get_dictionary_columns failed', { error: err.message });
        return { columns: [], note: 'Column annotations not available' };
      }
    },
    spec: {
      name: 'get_dictionary_columns',
      description:
        'Look up data dictionary column annotations for specific tables. Returns business names, descriptions, semantic types, and usage notes.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', description: 'The DAS connection name' },
          tables: {
            type: 'array',
            items: { type: 'string' },
            description: 'Table names to get column annotations for',
          },
        },
        required: ['connection', 'tables'],
      },
    },
  },
```

**Key points:**
- The published client's `dictionaryColumns()` takes a single `table` filter, so we iterate over the requested tables and merge
- The `tables` parameter is an `array` type — the LLM passes an array of table names
- If dictionary annotations aren't configured, the tool returns an empty array with a `note`

## Step 5: The get_schema Tool

This tool returns the database schema — column types, nullability, and primary keys:

```typescript
  get_schema: {
    func: async (
      _request: any,
      args: { connection: string; table?: string }
    ) => {
      logger.info('[Tool] get_schema', {
        connection: args.connection,
        table: args.table,
      });
      try {
        if (args.table) {
          // Get columns for a specific table
          const columns = await dasClient.getColumns(args.connection, args.table);
          return {
            tables: [{
              name: args.table,
              columns: columns.map((c) => ({
                name: c.name,
                type: c.type,
                nullable: c.nullable,
                primaryKey: c.primaryKey,
              })),
            }],
          };
        }
        // Get all tables
        const schema = await dasClient.getSchema(args.connection);
        return { tables: schema.tables };
      } catch (err: any) {
        logger.warn('[Tool] get_schema failed', { error: err.message });
        return { tables: [], note: 'Schema not available' };
      }
    },
    spec: {
      name: 'get_schema',
      description:
        'Get the database schema (tables, columns, types, keys) for a connection. Optionally filter to a specific table.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', description: 'The DAS connection name' },
          table: { type: 'string', description: 'Optional table name. If omitted, returns all tables.' },
        },
        required: ['connection'],
      },
    },
  },
};
```

**Key points:**
- When `table` is provided, we use `dasClient.getColumns()` for detailed column info
- When omitted, we use `dasClient.getSchema()` to list all tables
- The published client returns `ColumnInfo` objects with `normalizedType` for cross-database compatibility

## Summary

You now have four tools in your dispatch table:

| Tool | Client Method | Returns |
|------|--------------|---------|
| `explain_query` | `dasClient.explainSQL()` | Execution plan, timing |
| `get_dictionary_tables` | `dasClient.dictionaryTables()` | Business names, descriptions, tags |
| `get_dictionary_columns` | `dasClient.dictionaryColumns()` | Column semantics, usage notes |
| `get_schema` | `dasClient.getSchema()` / `getColumns()` | Column types, keys, nullability |

All four follow the same pattern:
1. Log the invocation
2. Call the published DAS client
3. Return a simplified result
4. On error, return graceful fallback data

In Part 4, we'll wire these tools into a bot that also produces structured output.

---

**Next:** [Part 4: Prompt & Bot](./part-04-prompt-and-bot.md)
