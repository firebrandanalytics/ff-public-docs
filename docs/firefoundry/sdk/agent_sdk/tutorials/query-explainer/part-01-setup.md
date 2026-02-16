# Part 1: Project Setup

In this part you'll scaffold a FireFoundry application, set up the monorepo structure with shared types, and define the Zod schema for the bot's structured output.

**What you'll learn:**
- Scaffolding a FireFoundry application with `ff-cli`
- Organizing shared types in a monorepo workspace package
- Defining structured output schemas with Zod and `.describe()`

**What you'll build:** A monorepo with a bundle skeleton, shared type definitions, and a Zod schema that will validate the LLM's analysis output.

## Step 1: Scaffold the Application

Use `ff-cli` to create a new application and agent bundle:

```bash
ff application create query-explainer
cd query-explainer
ff agent-bundle create query-bundle
```

This creates a monorepo:

```
query-explainer/
├── apps/
│   └── query-bundle/            # Your agent bundle
│       ├── src/
│       │   ├── index.ts         # Server entry point
│       │   ├── agent-bundle.ts  # Bundle class
│       │   └── constructors.ts  # Entity registry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── shared-types/            # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

Register the application with the entity service:

```bash
ff application register
```

Install dependencies:

```bash
pnpm install
```

## Step 2: Add Dependencies

The query bundle needs the `@firebrandanalytics/data-access-client` package for communicating with the Data Access Service, and `zod` for output schema validation:

```bash
cd apps/query-bundle
pnpm add @firebrandanalytics/data-access-client zod
```

The `data-access-client` package provides a typed HTTP client that handles authentication, URL construction, and error translation for all DAS endpoints.

## Step 3: Define Shared Types

The shared-types package defines the request/response interfaces that both the bundle and (later) the GUI will use.

**`packages/shared-types/src/index.ts`**:

```typescript
/**
 * Request to analyze a SQL query.
 */
export interface AnalyzeQueryRequest {
  /** The SQL SELECT statement to analyze */
  sql: string;
  /** DAS connection name (e.g., "firekicks") */
  connection: string;
  /** Whether to run EXPLAIN ANALYZE (true) or just EXPLAIN (false). Default: true */
  analyze?: boolean;
  /** Whether to include verbose output. Default: false */
  verbose?: boolean;
}

/**
 * Response from creating an analysis request.
 */
export interface AnalyzeQueryResponse {
  entity_id: string;
}

/**
 * Response from the status endpoint.
 */
export interface QueryStatusResponse {
  entity_id: string;
  status: string;
  data: QueryExplainerEntityData;
}

/**
 * Data stored on the entity.
 */
export interface QueryExplainerEntityData {
  sql: string;
  connection: string;
  analyze: boolean;
  verbose: boolean;
  result?: any;
  error?: string;
}
```

**`packages/shared-types/package.json`**:

```json
{
  "name": "@shared/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.1.6"
  }
}
```

Build the shared types:

```bash
cd ../../
pnpm build --filter=@shared/types
```

## Step 4: Define the Output Schema

The LLM will produce a structured JSON analysis. Define the shape using Zod so the `StructuredOutputBotMixin` can validate it automatically.

**`apps/query-bundle/src/schemas.ts`**:

```typescript
import { z } from 'zod';

export const QueryAnalysisSchema = z.object({
  performance: z.object({
    summary: z.string()
      .describe('One-paragraph summary of query performance characteristics'),
    bottlenecks: z.array(z.string())
      .describe('List of performance bottlenecks identified'),
    optimization_suggestions: z.array(z.string())
      .describe('Specific, actionable optimization suggestions'),
    estimated_cost: z.string().optional()
      .describe('Estimated query cost from EXPLAIN output'),
    execution_time_ms: z.number().optional()
      .describe('Actual execution time if ANALYZE was used'),
  }),
  semantics: z.object({
    business_question: z.string()
      .describe('The business question this query answers, in natural language'),
    domain_context: z.string()
      .describe('Explanation of the business domain this query operates in'),
    tables_used: z.array(z.object({
      table_name: z.string()
        .describe('The database table name (e.g., "customers", "orders")'),
      business_name: z.string().optional()
        .describe('Business-friendly name from dictionary, if available'),
      role_in_query: z.string()
        .describe('What role this table plays in answering the question'),
    })).describe('Tables referenced and their semantic meaning'),
    entities_involved: z.array(z.string())
      .describe('Business entities involved (e.g., Customer, Order, Product)'),
    relationships: z.array(z.string())
      .describe('Key relationships between entities used in this query'),
  }),
});

export type QUERY_ANALYSIS_OUTPUT = z.infer<typeof QueryAnalysisSchema>;
```

**Key points:**
- Every field has a `.describe()` string. The `StructuredOutputBotMixin` includes these descriptions in the LLM prompt so it knows what to produce.
- The schema has two top-level sections: `performance` (execution plan analysis) and `semantics` (business meaning).
- `tables_used` is an array of objects — the LLM must produce the exact field names (`table_name`, `business_name`, `role_in_query`).
- `estimated_cost` and `execution_time_ms` are optional since they depend on whether EXPLAIN ANALYZE was used.

## Step 5: Verify the Build

Build everything to make sure the project compiles:

```bash
pnpm build
```

You should see successful builds for both `@shared/types` and `@apps/query-bundle`.

---

**Next:** [Part 2: The DAS Client](./part-02-das-client.md)
