# Part 5: Entity & Bundle

In this part you'll create the entity that delegates work to the bot, wire everything into an agent bundle, and expose custom API endpoints for submitting queries and retrieving results.

**What you'll learn:**
- Using `BotRunnableEntityMixin` to delegate entity execution to a bot
- Mapping entity data to bot request arguments with `get_bot_request_args_impl`
- Exposing custom routes with `@ApiEndpoint`
- Using `entity.run()` to execute and get results directly
- The fire-and-forget pattern for background processing

**What you'll build:** A `QueryExplainerEntity` that runs the bot, an agent bundle with `POST /api/analyze-query` and `GET /api/query-status` endpoints, and the application entry point.

## Step 1: Create the Entity

The entity's job is simple: store the query parameters, then delegate to the bot when run. `BotRunnableEntityMixin` handles the delegation — you just need to implement `get_bot_request_args_impl` to map entity data to bot input.

**`apps/query-bundle/src/entities/QueryExplainerEntity.ts`**:

```typescript
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
import type { QUERY_ANALYSIS_OUTPUT } from '../schemas.js';

// ── DTO data shape ──────────────────────────────────────────

export interface QueryExplainerEntityDTOData extends JSONObject {
  sql: string;
  connection: string;
  analyze: boolean;
  verbose: boolean;
  result: QUERY_ANALYSIS_OUTPUT | null;
  error: string | null;
  [key: string]: JSONValue;
}

// ── Entity class ────────────────────────────────────────────

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
      ['QueryExplainerBot']     // Bot name(s) to delegate to
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: any
  ): Promise<BotRequestArgs<any>> {
    const dto = await (this as any).get_dto();
    const { sql, connection } = dto.data as QueryExplainerEntityDTOData;

    logger.info('[QueryExplainerEntity] Building bot request', {
      entity_id: (this as any).id,
      sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
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

**Key points:**
- `['QueryExplainerBot']` tells the mixin which bot to look up from the registry (must match `@RegisterBot` name)
- `get_bot_request_args_impl` reads entity data and maps it:
  - `input` → becomes the user message (the SQL query text)
  - `args` → available in prompt template functions as `request.args`
  - `context` → provides the entity DTO for any context-aware operations

## Step 2: Create the Constructors Registry

The constructors registry maps entity type names to their classes. The entity factory uses this to instantiate entities from the database.

**`apps/query-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerEntity } from './entities/QueryExplainerEntity.js';

export const QueryExplainerConstructors = {
  ...FFConstructors,
  QueryExplainerEntity: QueryExplainerEntity,
} as const;
```

## Step 3: Create the Agent Bundle

The bundle exposes two API endpoints: one to submit a query, and one to check results.

**`apps/query-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerConstructors } from './constructors.js';
import type {
  AnalyzeQueryRequest,
  AnalyzeQueryResponse,
  QueryStatusResponse,
} from '@shared/types';

const APP_ID = process.env.FF_APPLICATION_ID
  || 'b2c7e8a1-3d5f-4b6a-9e2c-1a8d7f6e5b4c';

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
    logger.info('API endpoints:');
    logger.info('   POST /api/analyze-query — Submit SQL for analysis');
    logger.info('   GET  /api/query-status  — Get analysis results');
  }
```

## Step 4: The analyze-query Endpoint

This endpoint creates an entity, runs the bot in the background, and returns the entity ID for polling:

```typescript
  @ApiEndpoint({ method: 'POST', route: 'analyze-query' })
  async analyzeQuery(body: AnalyzeQueryRequest): Promise<AnalyzeQueryResponse> {
    const { sql, connection, analyze = true, verbose = false } = body;

    if (!sql?.trim()) {
      throw new Error('sql is required and cannot be empty');
    }
    if (!connection?.trim()) {
      throw new Error('connection is required');
    }

    logger.info('[API] Creating query analysis entity', {
      sql: sql.substring(0, 100),
      connection,
      analyze,
    });

    // Create the entity
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `query-analysis-${Date.now()}`,
      specific_type_name: 'QueryExplainerEntity',
      general_type_name: 'QueryExplainerEntity',
      status: 'Pending',
      data: {
        sql,
        connection,
        analyze,
        verbose,
        result: null,
        error: null,
      },
    });

    const entity_id = entity.id!;

    // Run the bot in the background (fire-and-forget).
    // entity.run() iterates the async generator internally and returns
    // the bot's final output directly — no envelope scanning needed.
    (async () => {
      try {
        const result = await entity.run();
        if (result) {
          const dto = await entity.get_dto();
          await entity.update_data({ ...dto.data, result });
          logger.info('[API] Analysis result stored', { entity_id });
        } else {
          logger.warn('[API] Bot returned no result', { entity_id });
        }
      } catch (err: any) {
        logger.error('[API] Analysis failed', { entity_id, error: err.message });
        try {
          const dto = await entity.get_dto();
          await entity.update_data({ ...dto.data, error: err.message });
        } catch { /* best effort */ }
      }
    })();

    return { entity_id };
  }
```

### run() vs start()

Entities provide two execution methods:

| Method | Returns | Use When |
|--------|---------|----------|
| `entity.run()` | The bot's final output directly | You just want the result |
| `entity.start()` | An async iterator yielding progress envelopes | You need streaming/progress updates |

`run()` calls `start()` internally and iterates through all envelopes for you, returning only the final value. For an API endpoint that stores the result and returns an entity ID, `run()` is the right choice — there's no consumer for intermediate progress events.

> **Anti-pattern:** Don't use `start()` and manually scan for `VALUE` envelopes when you only need the final result. That's what `run()` does internally.

> **When to use start():** If you need real-time progress streaming to a UI (e.g., showing the user which tools the LLM is calling as it works), use `start()` and stream the envelopes via SSE. See the [Report Generator Tutorial, Part 12: Progress Streaming](../report-generator/part-12-progress-streaming.md) for that pattern.

### The Fire-and-Forget Pattern

The background async IIFE `(async () => { ... })()` runs the bot without blocking the HTTP response. The endpoint returns immediately with the `entity_id`, and the client polls for results using the status endpoint (or uses `ff-eg-read` / `ff-sdk-cli` to inspect the entity).

## Step 5: The query-status Endpoint

```typescript
  @ApiEndpoint({ method: 'GET', route: 'query-status' })
  async getQueryStatus(
    query: { entity_id?: string }
  ): Promise<QueryStatusResponse> {
    const { entity_id } = query;

    if (!entity_id) {
      throw new Error('entity_id query parameter is required');
    }

    const entityDto = await this.entity_client.get_node(entity_id);

    if (!entityDto) {
      throw new Error(`Entity ${entity_id} not found`);
    }

    const data = (entityDto as any).data || {};

    return {
      entity_id: entityDto.id!,
      status: entityDto.status!,
      data,
    };
  }
}
```

The client checks `data.result` (analysis complete) or `data.error` (analysis failed) to determine the outcome.

## Step 6: Create the Entry Point

**`apps/query-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { QueryExplainerAgentBundle } from './agent-bundle.js';

// Import bot for @RegisterBot side effect
import './bots/QueryExplainerBot.js';

const port = parseInt(process.env.PORT || '3001', 10);

async function startServer() {
  try {
    logger.info(`Starting QueryExplainer server on port ${port}`);

    await createStandaloneAgentBundle(
      QueryExplainerAgentBundle,
      { port }
    );

    logger.info(`QueryExplainer server running on port ${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Analyze API: POST http://localhost:${port}/api/analyze-query`);
    logger.info(`Status API:  GET  http://localhost:${port}/api/query-status?entity_id=<id>`);

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down');
      process.exit(0);
    });
    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

**Key points:**
- The bot file **must be imported** (even without using any exports) so the `@RegisterBot` decorator runs and registers the bot class
- `createStandaloneAgentBundle` sets up the HTTP server, entity factory, and broker client

## Step 7: Build and Verify

```bash
pnpm build
```

You should see successful builds for all workspace packages. The bundle is now ready to deploy and test.

---

**Next:** [Part 6: Deploy & Test](./part-06-deploy-and-test.md)
