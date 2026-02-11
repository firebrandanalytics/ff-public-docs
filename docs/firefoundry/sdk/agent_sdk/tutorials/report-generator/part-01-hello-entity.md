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

### Set Up Diagnostic Tool Configuration

FireFoundry's CLI diagnostic tools (`ff-eg-read`, `ff-wm-read`, `ff-telemetry-read`) all share the same connection configuration. Rather than passing `--mode`, `--gateway`, and `--internal-port` flags on every command, create a `.env` file in your project root:

**`.env`** (add to `.gitignore`):

```bash
# Shared configuration for all FF diagnostic tools
FF_GATEWAY=http://localhost
FF_PORT=8180
FF_NAMESPACE=ff-dev
FF_EG_AGENT_BUNDLE_ID=1ba3a4a6-4df4-49b5-9291-c0bacfe46201

# For internal mode (direct port-forward to entity service)
FF_MODE=internal
```

> **Note:** The tools auto-load `.env` from the current working directory. With this file in place, you can run all diagnostic commands without any connection flags. The rest of this tutorial assumes this `.env` file is set up.

### Inspect the Entity Graph

Use `ff-eg-read` to verify the entity was created in the graph:

```bash
ff-eg-read node get <entity-id>
```

### Find Entities When You Don't Know the ID

The commands above require an entity ID. If you don't have it -- for example because you lost the terminal output, or something went wrong and you want to see what was created -- use `search nodes-scoped` to query the entity graph:

```bash
# List the 10 most recent entities (any type)
ff-eg-read search nodes-scoped --page 1 --size 10 --order-by '{"created": "desc"}'

# Find entities of a specific type (use the @EntityMixin name)
ff-eg-read search nodes-scoped --page 1 --size 10 \
  --condition '{"specific_type_name": "TextDocumentEntity"}'

# Find failed entities
ff-eg-read search nodes-scoped --page 1 --size 5 \
  --condition '{"status": "Failed"}'

# Combine filters: recent entities of a specific type
ff-eg-read search nodes-scoped --page 1 --size 5 \
  --condition '{"specific_type_name": "TextDocumentEntity"}' \
  --order-by '{"created": "desc"}'
```

Extract just the IDs with `jq`:

```bash
ff-eg-read search nodes-scoped --page 1 --size 5 \
  --condition '{"specific_type_name": "TextDocumentEntity"}' \
  --order-by '{"created": "desc"}' | jq '.result[].id'
```

> **Tip:** Throughout this tutorial, whenever a command requires `<entity-id>`, you can always use `search nodes-scoped` to find it. The `--condition` filter supports `specific_type_name`, `status`, `name`, and other node columns. The `--order-by` option accepts `created` or `modified` with `asc` or `desc`..

### Read the Return Value and Progress Envelopes

After a runnable entity completes, you can retrieve its output and the progress trail:

```bash
# Get the entity's return value (what run_impl returned)
ff-eg-read node io <entity-id>

# Get the progress envelopes (INTERNAL_UPDATE, STATUS, VALUE events)
ff-eg-read node progress <entity-id>
```

The `node io` command returns an object with `input` and `output` fields. The `output` is the return value from `run_impl` -- this is what you care about. The `input` field is typically empty; ignore it for now. Entity inputs live in the `data` column (visible via `node get`), not in `input`. The `input` field exists for specialized scenarios where the entity's data is a reference (like a filename) and the actual content is passed separately at start time.

The `node progress` command shows every envelope the iterator yielded during execution -- the same events you saw in real-time from `ff-sdk-cli iterator run`, but persisted in the entity graph for after-the-fact inspection.

> **Tip:** These two commands are your primary debugging tools whenever a workflow behaves unexpectedly. `node io` tells you what came out (check the `output` field); `node progress` tells you what happened in between.

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
