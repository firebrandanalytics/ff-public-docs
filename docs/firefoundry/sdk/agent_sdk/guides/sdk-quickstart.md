# SDK Quick-Start Guide

Build and deploy your first FireFoundry agent bundle in under 30 minutes. This guide walks you through creating a working AI-powered service with an entity, a bot, and an API endpoint.

## Prerequisites

- **Node.js** 20+ and **pnpm** 9+
- **ff-cli** installed (`npm install -g @firebrandanalytics/ff-cli`)
- **GitHub token** with `read:packages` scope (for FireFoundry npm packages)
- A running **FireFoundry cluster** (minikube or cloud) — see [Local Development Setup](../../../ff_local_dev/README.md)

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

## Step 1: Scaffold a Project

```bash
ff-cli project create my-first-app
cd my-first-app
```

This creates a pnpm monorepo with Turborepo, Docker Compose config, and workspace structure:

```
my-first-app/
├── apps/                  # Agent bundles go here
├── packages/              # Shared libraries
├── docker-compose.yml     # Local dev environment
├── pnpm-workspace.yaml
└── turbo.json
```

## Step 2: Create an Agent Bundle

```bash
ff-cli agent-bundle create greeting-service
```

This generates the bundle scaffold at `apps/greeting-service/`:

```
apps/greeting-service/
├── src/
│   ├── index.ts           # Server entry point
│   ├── agent-bundle.ts    # Main bundle class
│   ├── constructors.ts    # Entity registry
│   ├── entities/          # Your entities
│   ├── bots/              # Your bots
│   └── prompts/           # Your prompts
├── helm/                  # Kubernetes deployment
├── package.json
├── Dockerfile
└── firefoundry.json
```

Install dependencies:

```bash
pnpm install
```

## Step 3: Define an Output Schema

Create `apps/greeting-service/src/schemas.ts`. Schemas define the structured output your bot produces, validated automatically by Zod:

```typescript
import { z } from 'zod';

export const GreetingSchema = z.object({
  greeting: z
    .string()
    .describe('A personalized greeting message'),
  fun_fact: z
    .string()
    .describe('An interesting fun fact related to the person or topic'),
  mood: z
    .enum(['cheerful', 'formal', 'playful', 'inspiring'])
    .describe('The mood of the greeting'),
});

export type GREETING_OUTPUT = z.infer<typeof GreetingSchema>;
```

## Step 4: Create a Prompt

Create `apps/greeting-service/src/prompts/GreetingPrompt.ts`. Prompts define the system instructions sent to the LLM:

```typescript
import {
  StructuredDataPrompt,
  StructuredDataPTH,
  PromptTemplateNode,
  PromptTemplateSectionNode,
} from '@firebrandanalytics/ff-agent-sdk';
import { GreetingSchema } from '../schemas.js';

const sampleOutput = {
  greeting: 'Hello Alex! Welcome to the team — excited to have you here!',
  fun_fact: 'The name Alex comes from Greek, meaning "defender of the people."',
  mood: 'cheerful' as const,
};

export type GreetingPTH = StructuredDataPTH & {
  args: { static: Record<string, never>; request: Record<string, never> };
};

export class GreetingPrompt extends StructuredDataPrompt {
  constructor() {
    super(GreetingSchema, sampleOutput, {} as GreetingPTH['args']['static']);
  }

  protected get_Task_Section(): PromptTemplateNode<GreetingPTH> {
    return new PromptTemplateSectionNode<GreetingPTH>({
      semantic_type: 'rule',
      content: 'Task:',
      children: [
        'Generate a personalized greeting for the given name or topic.',
        'Include an interesting fun fact related to the input.',
        'Match the mood to the context — be cheerful for casual, formal for business.',
      ],
    });
  }
}
```

## Step 5: Create a Bot

Create `apps/greeting-service/src/bots/GreetingBot.ts`. Bots wrap prompts with LLM execution, validation, and retry logic:

```typescript
import {
  MixinBot,
  StructuredOutputBotMixin,
  StructuredPromptGroup,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from '@firebrandanalytics/ff-agent-sdk';
import type { BotTypeHelper } from '@firebrandanalytics/ff-agent-sdk';
import type { BrokerTextContent } from '@firebrandanalytics/shared-types';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import { GreetingSchema, type GREETING_OUTPUT } from '../schemas.js';
import { GreetingPrompt, type GreetingPTH } from '../prompts/GreetingPrompt.js';

export type GreetingBTH = BotTypeHelper<
  GreetingPTH,
  GREETING_OUTPUT,
  GREETING_OUTPUT,
  any,
  BrokerTextContent
>;

class GreetingBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<GreetingBTH, [StructuredOutputBotMixin<GreetingBTH, typeof GreetingSchema>]>,
  [StructuredOutputBotMixin<GreetingBTH, typeof GreetingSchema>]
]> {
  constructor() {
    // User input prompt — forwards the input text as a user message
    const inputPrompt = new Prompt<GreetingPTH>({
      role: 'user',
      static_args: {} as Record<string, never>,
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<GreetingPTH>({
        content: (request) => request.input as string,
      })
    );

    const promptGroup = new StructuredPromptGroup<GreetingPTH>({
      base: new PromptGroup<GreetingPTH>([
        { name: 'greeting_system', prompt: new GreetingPrompt() },
      ]),
      input: new PromptGroup<GreetingPTH>([
        { name: 'user_input', prompt: inputPrompt },
      ]),
    });

    super(
      [{
        name: 'GreetingBot',
        model_pool_name: 'firebrand_completion_default',
        base_prompt_group: promptGroup,
        static_args: {} as Record<string, never>,
        max_tries: 3,
      }],
      [{ schema: GreetingSchema }]
    );
  }
}

@RegisterBot('GreetingBot')
export class GreetingBot extends GreetingBotBase {
  public override get_semantic_label_impl(): string {
    return 'GreetingBot';
  }
}
```

**Key patterns:**
- `StructuredPromptGroup` separates system instructions (`base`) from user input (`input`)
- `StructuredOutputBotMixin` handles JSON extraction, Zod validation, and retries automatically
- `@RegisterBot` makes the bot available via `FFAgentBundle.getBotOrThrow('GreetingBot')`

## Step 6: Create an Entity

Create `apps/greeting-service/src/entities/GreetingEntity.ts`. Entities store state in the persistent entity graph and connect to bots for execution:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  EntityFactory,
  Context,
} from '@firebrandanalytics/ff-agent-sdk';
import type {
  EntityNodeTypeHelper,
  EntityTypeHelper,
  RunnableEntityTypeHelper,
  BotRequestArgs,
} from '@firebrandanalytics/ff-agent-sdk';
import type { EntityNodeDTO, JSONObject, JSONValue, UUID } from '@firebrandanalytics/shared-types';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import type { GreetingBTH } from '../bots/GreetingBot.js';
import type { GREETING_OUTPUT } from '../schemas.js';

// DTO data shape — what gets persisted
export interface GreetingEntityDTOData extends JSONObject {
  name: string;
  [key: string]: JSONValue;
}

export type GreetingEntityDTO = EntityNodeDTO & { data: GreetingEntityDTOData };

type GreetingENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>, GreetingEntityDTO, 'GreetingEntity', {}, {}
>;
type GreetingRETH = RunnableEntityTypeHelper<GreetingENH, GREETING_OUTPUT>;

@EntityMixin({
  specificType: 'GreetingEntity',
  generalType: 'GreetingEntity',
  allowedConnections: {},
})
export class GreetingEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<GreetingRETH>,
  BotRunnableEntityMixin<GreetingRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | GreetingEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ['GreetingBot']  // Bot name(s) this entity uses
    );
  }

  // Connect entity data to bot input
  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<GreetingBTH>>
  ): Promise<BotRequestArgs<GreetingBTH>> {
    const dto = await this.get_dto();
    return {
      args: {} as Record<string, never>,
      input: `Generate a greeting for: ${dto.data.name}`,
      context: new Context(dto),
    };
  }
}
```

**Key patterns:**
- `RunnableEntity` + `BotRunnableEntityMixin` = entity that runs a bot when `.run()` is called
- `get_bot_request_args_impl()` bridges entity data to bot input
- `@EntityMixin` registers the entity type for the constructor registry

## Step 7: Wire It All Together

Update `apps/greeting-service/src/constructors.ts` to register your entity:

```typescript
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { GreetingEntity } from './entities/GreetingEntity.js';

// Import bots to trigger @RegisterBot registration
import './bots/GreetingBot.js';

export const GreetingServiceConstructors = {
  ...FFConstructors,
  GreetingEntity,
} as const;
```

Update `apps/greeting-service/src/agent-bundle.ts` to expose an API endpoint:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { GreetingServiceConstructors } from './constructors.js';
import { GreetingEntity } from './entities/GreetingEntity.js';

const APP_ID = 'your-generated-uuid';  // Generated by ff-cli

export class GreetingServiceBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: 'GreetingService',
        type: 'agent_bundle',
        description: 'Personalized greeting generator',
      },
      GreetingServiceConstructors,
      createEntityClient(APP_ID) as any
    );
  }

  override async init() {
    await super.init();
    logger.info('GreetingService initialized!');
  }

  @ApiEndpoint({ method: 'POST', route: 'greet' })
  async greet(data: { name: string }) {
    logger.info(`Generating greeting for: ${data.name}`);

    // Create an entity in the graph
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `greeting-${data.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      specific_type_name: 'GreetingEntity',
      general_type_name: 'GreetingEntity',
      status: 'Pending',
      data: { name: data.name },
    });

    // Run the bot via the entity
    const result = await (entity as GreetingEntity).run();

    return { success: true, greeting: result };
  }
}
```

The entry point `apps/greeting-service/src/index.ts` is already generated by the scaffold — it calls `createStandaloneAgentBundle` to start the HTTP server.

## Step 8: Build and Deploy

```bash
# Build the Docker image (from project root)
ff-cli ops build greeting-service --profile minikube

# Deploy to your cluster
ff-cli ops deploy greeting-service -y

# Or install separately
ff-cli ops install greeting-service
```

## Step 9: Test Your Service

Set up port forwarding to the Kong Gateway:

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
```

Call your endpoint:

```bash
# Health check
curl http://localhost:8080/agents/ff-dev/greeting-service/health/ready

# Call your API endpoint (note the /api/ prefix)
curl -X POST http://localhost:8080/agents/ff-dev/greeting-service/api/greet \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

Example response:

```json
{
  "success": true,
  "greeting": {
    "greeting": "Hello Alice! It's wonderful to meet you!",
    "fun_fact": "The name Alice gained popularity after Lewis Carroll's 'Alice in Wonderland' in 1865.",
    "mood": "cheerful"
  }
}
```

## What You Built

Here's what happens when you call `POST /api/greet`:

```
POST /api/greet { name: "Alice" }
  │
  ├─ Create GreetingEntity in the entity graph
  │
  ├─ entity.run()
  │    ├─ get_bot_request_args_impl() → extracts name from entity
  │    ├─ GreetingBot processes the request
  │    │    ├─ GreetingPrompt → system instructions
  │    │    ├─ User input prompt → "Generate a greeting for: Alice"
  │    │    ├─ LLM call via Broker Service
  │    │    └─ Zod validation of response
  │    └─ Returns GREETING_OUTPUT
  │
  └─ Return { success: true, greeting: {...} }
```

The four core building blocks:

| Component | Role | What it does |
|-----------|------|-------------|
| **Schema** | Contract | Defines the output structure (Zod) |
| **Prompt** | Instructions | Tells the LLM what to do (system message) |
| **Bot** | Execution | Calls the LLM, validates output, retries on failure |
| **Entity** | State + Orchestration | Persists data in the graph, connects to bots |

## Next Steps

### Learn More
- **[Core Concepts & Glossary](../fire_foundry_core_concepts_glossary_agent_sdk.md)** — terminology and mental models
- **[Prompting Tutorial](../core/prompting_tutorial.md)** — advanced prompt engineering with template nodes
- **[Bot Tutorial](../core/bot_tutorial.md)** — tool calls, custom validation, error handling
- **[Entity Guide](../core/entities.md)** — relationships, workflows, runnable entities

### Explore Demo Apps
The [demo apps](../tutorials/) show real-world patterns:

| Demo | Key Pattern |
|------|------------|
| **CRM** | CRUD entities, multiple bots, email campaigns |
| **News Analysis** | Collection entities, structured extraction |
| **Illustrated Story** | Multi-bot pipelines, parallel execution, blob storage |
| **Catalog Intake** | Data validation, fuzzy matching, human review |
| **Report Generator** | Document processing, review workflows, SSE streaming |

### Advanced Features
- **[Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md)** — multi-step AI workflows
- **[Waitable Entities](../feature_guides/waitable_guide.md)** — human-in-the-loop patterns
- **[Job Scheduling](../feature_guides/job-scheduling-work-queues.md)** — cron-based background tasks
- **[XML DSL](../dsl/README.md)** — declarative alternative to TypeScript
