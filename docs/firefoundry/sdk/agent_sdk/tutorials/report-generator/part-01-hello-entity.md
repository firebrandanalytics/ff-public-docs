# Part 1: Your First Entity

In this part, you'll create a minimal FireFoundry agent bundle with a single entity that stores and retrieves text. This establishes the foundation that every subsequent part builds on.

**What you'll learn:**
- Scaffolding an agent bundle project with `ff-cli`
- Creating a custom entity with typed data
- Registering entities with the bundle's constructor map
- Deploying and testing with `ff-sdk-cli`

**What you'll build:** An agent bundle with a `TextDocumentEntity` that stores a text string and returns it on request.

## Step 1: Scaffold the Project

Use `ff-cli` to create a new agent bundle project:

```bash
ff project create report-generator
cd report-generator
ff agent-bundle create report-bundle
```

This creates a monorepo with:
```
report-generator/
├── firefoundry.json              # Application-level config (lists components)
├── apps/
│   └── report-bundle/            # Your agent bundle
│       ├── firefoundry.json      # Bundle-level config (port, resources, health)
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── shared-types/             # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### firefoundry.json Files

FireFoundry uses `firefoundry.json` files at two levels:

**Root level** (`report-generator/firefoundry.json`) -- declares the application and its components:

```json
{
  "name": "report-generator",
  "version": "1.0.0",
  "type": "application",
  "components": [
    { "name": "report-bundle", "path": "apps/report-bundle" }
  ]
}
```

**Bundle level** (`apps/report-bundle/firefoundry.json`) -- configures the agent bundle for deployment:

```json
{
  "name": "report-bundle",
  "version": "1.0.0",
  "description": "report-bundle agent bundle",
  "type": "agent-bundle",
  "runtime": "node",
  "entry": "dist/index.js",
  "port": 3000,
  "health": {
    "endpoint": "/health",
    "interval": 30,
    "timeout": 3
  },
  "readiness": {
    "endpoint": "/ready",
    "initialDelay": 5
  }
}
```

The `ff ops build` and `ff ops deploy` commands read these files to know how to build and deploy your bundle.

Install dependencies:

```bash
pnpm install
```

## Step 2: Define Your Entity's Data Shape

Every entity stores its state in a `data` field. Define the shape of that data in your shared types package.

**`packages/shared-types/src/reportTypes.ts`**:

```typescript
/**
 * Data stored in the TextDocumentEntity
 */
export interface TextDocumentDTOData {
  text: string;
  created_at?: string;
}
```

**`packages/shared-types/src/index.ts`**:

```typescript
export * from "./reportTypes.js";
```

## Step 3: Create the Entity

Entities are the core building blocks of FireFoundry. They represent persistent business objects stored in the entity graph.

**`apps/report-bundle/src/entities/TextDocumentEntity.ts`**:

```typescript
import {
  RunnableEntity,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  EntityFactory,
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';

/**
 * Data stored in this entity's graph node
 */
interface TextDocumentDTOData {
  text: string;
  created_at?: string;
}

/**
 * DTO type for this entity (combines data shape with node metadata)
 */
type TextDocumentDTO = EntityInstanceNodeDTO<TextDocumentDTOData>;

/**
 * Type helpers for the entity framework
 */
type TextDocumentENH = EntityNodeTypeHelper<any, TextDocumentDTO, 'TextDocumentEntity', {}, {}>;
type TextDocumentRETH = RunnableEntityTypeHelper<TextDocumentENH, string>;

/**
 * A simple entity that stores and returns text content.
 *
 * @EntityMixin registers this entity type so the framework
 * can instantiate it from the entity graph.
 */
@EntityMixin({
  specificType: 'TextDocumentEntity',
  generalType: 'TextDocumentEntity',
  allowedConnections: {}
})
export class TextDocumentEntity extends RunnableEntity<TextDocumentRETH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | TextDocumentDTO) {
    super(factory, idOrDto);
  }

  /**
   * The run implementation - called when the entity is started.
   * Returns the stored text content.
   */
  protected override async *run_impl(): AsyncGenerator<any, string, never> {
    const dto = await this.get_dto();

    logger.info('[TextDocumentEntity] Returning stored text', {
      entity_id: this.id,
      text_length: dto.data.text?.length ?? 0
    });

    yield {
      type: "INTERNAL_UPDATE",
      message: "Processing text document",
      metadata: { text_length: dto.data.text?.length ?? 0 }
    };

    return dto.data.text;
  }
}
```

**Key concepts:**
- `@EntityMixin` registers the entity type name. This must match the `specific_type_name` used when creating instances.
- `RunnableEntity` means this entity can be "started" to execute a workflow.
- `run_impl()` is an async generator. It can `yield` progress updates and `return` a final result.
- `get_dto()` retrieves the entity's persisted data from the entity graph.

## Step 4: Register the Entity

Add your entity to the constructor map so the bundle knows about it.

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { TextDocumentEntity } from './entities/TextDocumentEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  TextDocumentEntity: TextDocumentEntity,
} as const;
```

`FFConstructors` includes built-in entity types (like `ReviewStep`). You spread it and add your own.

## Step 5: Configure the Agent Bundle

**`apps/report-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { ReportBundleConstructors } from "./constructors.js";

const APP_ID = "1ba3a4a6-4df4-49b5-9291-c0bacfe46201";

export class ReportBundleAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "ReportGenerator",
        type: "agent_bundle",
        description: "Document-to-report generation service"
      },
      ReportBundleConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("ReportBundle initialized!");
  }
}
```

**Key details:**
- `application_id` links this bundle to a FireFoundry application. It must match the `id` you assign.
- `createEntityClient(APP_ID)` creates an entity client scoped to this application for entity graph operations.

**`apps/report-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { ReportBundleAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    const server = await createStandaloneAgentBundle(
      ReportBundleAgentBundle,
      { port }
    );
    logger.info(`ReportBundle server running on port ${port}`);
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

## Step 6: Build and Deploy

Build the project:

```bash
pnpm run build
```

Deploy to your cluster:

```bash
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 7: Test with ff-sdk-cli

Once deployed, use `ff-sdk-cli` to interact with your bundle.

### Check Health

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }

ff-sdk-cli info --url http://localhost:3001
# { "app_name": "ReportGenerator", ... }
```

### Create an Entity

Use `invoke` to call the entity factory's `create` method:

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{"type": "TextDocumentEntity", "data": {"text": "Hello, FireFoundry!", "created_at": "2026-01-01T00:00:00Z"}}' \
  --url http://localhost:3001
```

This returns an entity ID:

```json
{ "entity_id": "a1b2c3d4-..." }
```

### Start the Entity

Use an iterator to run the entity and get streaming results:

```bash
# Start the entity's run_impl
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

You should see:
1. A `STATUS` event with `"status": "STARTED"`
2. An `INTERNAL_UPDATE` with the text length
3. A `VALUE` event with the stored text as the return value
4. A `STATUS` event with `"status": "COMPLETED"`

### Inspect the Entity Graph

Use `ff-eg-read` to verify the entity was created in the graph:

```bash
ff-eg-read node get <entity-id> --mode=internal --gateway=http://localhost --internal-port=8180
```

## What You've Built

You now have:
- A deployable agent bundle with a custom entity
- An entity that stores data in the entity graph and returns it when started
- Experience using `ff-sdk-cli` for testing
- Understanding of the entity lifecycle: create -> start -> yield progress -> return result

## Key Takeaways

1. **Entities are persistent** - they live in the entity graph and survive restarts
2. **RunnableEntity provides the async generator pattern** - yield progress, return results
3. **@EntityMixin registers the type** - the name must match between creation and the decorator
4. **Constructor map is the registry** - every entity type must be registered here
5. **ff-sdk-cli is your testing tool** - no GUI needed during development

## Next Steps

In [Part 2: Adding AI with Bots](./part-02-add-ai.md), we'll add an LLM-powered bot that can analyze and summarize the stored text, introducing the separation of structure (entities) from behavior (bots).
