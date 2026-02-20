# Part 1: Project Setup

In this part, you'll scaffold a new FireFoundry application using `ff-cli`, add the required dependencies, and verify that the project builds.

## Scaffold the Application

Use `ff-cli` to create the project structure:

```bash
ff-cli application create code-sandbox
```

This generates a monorepo with:

```
code-sandbox/
  apps/                    # Agent bundle applications
  packages/                # Shared packages
    shared-types/          # Shared TypeScript types
  helm/                    # Kubernetes deployment configuration
    values.local.yaml      # Local environment settings
    secrets.yaml.template  # Secret values template
  scripts/                 # Build and development scripts
  package.json             # Root workspace configuration
  pnpm-workspace.yaml      # pnpm workspace definition
  turbo.json               # Turborepo build pipeline
  tsconfig.json            # Root TypeScript configuration
  firefoundry.json         # FireFoundry application metadata
  docker-compose.yml       # Local development services
  Dockerfile               # Container build definition
  .npmrc                   # npm registry configuration
```

## Create the Agent Bundle

Next, create the agent bundle inside the application:

```bash
cd code-sandbox
ff-cli agent-bundle create coder-bundle
```

This adds the bundle skeleton at `apps/coder-bundle/`:

```
apps/coder-bundle/
  src/
    index.ts               # Server entry point
    agent-bundle.ts        # FFAgentBundle subclass
    constructors.ts        # Entity constructor registry
  package.json
  tsconfig.json
  firefoundry.json
```

## Dependencies

The scaffolded `package.json` already includes the required dependencies. No additional packages are needed -- `GeneralCoderBot` manages its own sandbox client internally.

```json
{
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^4.2.0",
    "@firebrandanalytics/shared-types": "^2.1.1",
    "@firebrandanalytics/shared-utils": "^4.1.1",
    "express": "^4.18.2",
    "zod": "^3.22.4"
  }
}
```

> **Note**: `ff-cli application create` automatically configures npm registry access for FireFoundry packages. If you run into authentication issues during install, see the [Local Development Guide](../../guides/local_dev_setup.md) for registry setup instructions.

## Install and Build

Install dependencies and verify the scaffold compiles:

```bash
pnpm install
pnpm run build
```

You should see both packages build successfully:

```
@shared/types:build: > tsc
@apps/coder-bundle:build: > tsc

 Tasks:    2 successful, 2 total
```

## Understanding the Generated Code

Let's review the three files ff-cli generated in `apps/coder-bundle/src/`.

### `index.ts` -- Server Entry Point

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { CoderBundleAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    logger.info(`Starting CoderBundle server on port ${port}`);

    const server = await createStandaloneAgentBundle(
      CoderBundleAgentBundle,
      { port }
    );

    logger.info(`CoderBundle server running on port ${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Ready check: http://localhost:${port}/ready`);
    logger.info(`Invoke endpoint: http://localhost:${port}/invoke`);

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

`createStandaloneAgentBundle` wraps your agent bundle in an Express server with built-in health, ready, invoke, and API endpoints.

### `agent-bundle.ts` -- Bundle Class

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { CoderBundleConstructors } from "./constructors.js";

const APP_ID = "37f3b877-f486-4bb7-a86b-173b48cc094d";

export class CoderBundleAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "CoderBundle",
        type: "agent_bundle",
        description: "Code sandbox demo using GeneralCoderBot and Code Sandbox Service",
      },
      CoderBundleConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("CoderBundleAgentBundle initialized!");
  }
}
```

Key points:
- `APP_ID` is a UUID that uniquely identifies this bundle in the FireFoundry cluster
- `createEntityClient(APP_ID)` connects to the Entity Service for persistence (no direct database access)
- `CoderBundleConstructors` is where we'll register our custom entity types

### `constructors.ts` -- Entity Registry

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";

export const CoderBundleConstructors = {
  ...FFConstructors,
  // Custom entities will be registered here
} as const;
```

`FFConstructors` provides the base entity types. We'll add `CodeTaskEntity` and `DataScienceTaskEntity` here in Part 4.

## Key Points

> **ff-cli does the scaffolding** -- Always use `ff-cli application create` and `ff-cli agent-bundle create` for new projects. This ensures the correct monorepo structure, build configuration, and deployment files.

> **No direct database access** -- All entity persistence goes through `createEntityClient()` which communicates with the Entity Service. Never connect directly to PostgreSQL from your agent bundle.

---

**Next:** [Part 2: The Domain Prompt](./part-02-prompt.md) -- Learn how GeneralCoderBot handles intrinsic prompts and how to write a domain prompt for your use case.
