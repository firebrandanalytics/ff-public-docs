# Part 1: Your First Code Execution

By the end of this part, you'll type a plain English prompt like *"Calculate the first 10 Fibonacci numbers"* and get back a real, executed result. Behind the scenes, an LLM will write TypeScript code, the Code Sandbox will execute it, and your agent bundle will return the structured output -- all from a single API call.

**What you'll learn:**
- Scaffolding an agent bundle project with `ff-cli`
- Creating a code generation bot with `GeneralCoderBot`
- What profiles are and why they matter
- Wiring a bot to an entity with `BotRunnableEntityMixin`
- Exposing an API endpoint with `@ApiEndpoint`

**What you'll build:** An agent bundle with a single `/api/execute` endpoint that generates and runs TypeScript code from natural language.

---

## Step 1: Scaffold the Project

Use `ff-cli` to create a new application and agent bundle:

```bash
ff-cli application create code-sandbox
cd code-sandbox
ff-cli agent-bundle create coder-bundle
```

This creates a monorepo with:

```
code-sandbox/
├── firefoundry.json              # Application config
├── apps/
│   └── coder-bundle/             # Your agent bundle
│       ├── firefoundry.json      # Bundle config (port, health, resources)
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared-types/             # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

Install dependencies:

```bash
pnpm install
```

## Step 2: Create the Bot

In FireFoundry, **bots** are the AI workhorses. A bot takes input, calls an LLM, and returns structured output. Bots are stateless -- they don't remember previous conversations or store data. They just do work.

For code generation, we'll use `GeneralCoderBot`, a ready-made bot that handles the entire code generation pipeline: prompting the LLM, parsing its response, sending the code to the sandbox for execution, and returning the result. All you need to tell it is *which profile to use*.

**What's a profile?** A profile is a named configuration on the Code Sandbox Service that bundles together everything needed to run code: the programming language, the runtime environment, installed packages, and database connections. Instead of configuring all of that in your bot, you just say `profile: "finance-typescript"` and the sandbox knows what to do.

Create the file `apps/coder-bundle/src/bots/DemoCoderBot.ts`:

```typescript
import { GeneralCoderBot, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";

/**
 * A bot that generates and executes TypeScript code.
 *
 * Three constructor args:
 *   - name: identifies this bot in logs and telemetry
 *   - modelPoolName: which LLM to use
 *   - profile: which Code Sandbox profile to use
 *
 * That's it. GeneralCoderBot handles everything else:
 *   - Creates its own SandboxClient from environment variables
 *   - Fetches profile metadata at startup
 *   - Builds the LLM prompt (output format, entry point contract)
 *   - Parses the LLM response and executes the code
 */
@RegisterBot("DemoCoderBot")
export class DemoCoderBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoCoderBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_TS_PROFILE || "finance-typescript",
    });
  }
}
```

`@RegisterBot("DemoCoderBot")` puts this bot into a global registry. We'll need that in the next step -- entities look up bots by name.

## Step 3: Create the Entity

**Entities** are the other half of the picture. While bots are stateless workers, entities are persistent objects that live in the entity graph. They store state, track progress, and orchestrate work.

Think of it this way:

| Concept | Role | Analogy |
|---------|------|---------|
| **Entity** | Stores the user's request, tracks status, persists the result | A work order on a clipboard |
| **Bot** | Does the actual AI work -- generates code, calls the LLM | The worker who reads the clipboard and does the work |
| **BotRunnableEntityMixin** | Connects them -- when the entity runs, it delegates to the bot | The foreman who hands the clipboard to the worker |

This separation means you can reuse the same bot across different entities, swap bots without changing entity structure, and test bots independently.

Create the file `apps/coder-bundle/src/entities/CodeTaskEntity.ts`:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  EntityFactory,
  Context,
} from "@firebrandanalytics/ff-agent-sdk";
import type {
  EntityNodeTypeHelper,
  EntityTypeHelper,
  RunnableEntityTypeHelper,
  BotRequestArgs,
  CODER_BTH,
} from "@firebrandanalytics/ff-agent-sdk";
import type {
  EntityNodeDTO,
  JSONObject,
  JSONValue,
  UUID,
} from "@firebrandanalytics/shared-types";
import { AddMixins } from "@firebrandanalytics/shared-utils";
import type { GeneralCoderOutput } from "@firebrandanalytics/ff-agent-sdk";

// This import looks like it does nothing, but it's critical.
// It ensures @RegisterBot("DemoCoderBot") runs before any entity
// tries to look up the bot. Without it, the bot won't be in the registry.
import "../bots/DemoCoderBot.js";

// -- Data shape --

export interface CodeTaskEntityDTOData extends JSONObject {
  prompt: string;
  [key: string]: JSONValue;
}

export type CodeTaskEntityDTO = EntityNodeDTO & {
  data: CodeTaskEntityDTOData;
};

// -- Type helpers --

export type CodeTaskEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  CodeTaskEntityDTO,
  "CodeTaskEntity",
  {},
  {}
>;

export type CodeTaskEntityRETH = RunnableEntityTypeHelper<
  CodeTaskEntityENH,
  GeneralCoderOutput
>;

// -- Entity class --

@EntityMixin({
  specificType: "CodeTaskEntity",
  generalType: "CodeTaskEntity",
  allowedConnections: {},
})
export class CodeTaskEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<CodeTaskEntityRETH>,
  BotRunnableEntityMixin<CodeTaskEntityRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | CodeTaskEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ["DemoCoderBot"]  // <-- bot name from @RegisterBot
    );
  }

  /**
   * This method is the bridge between entity data and bot input.
   *
   * BotRunnableEntityMixin calls this before invoking the bot.
   * You read the entity's stored data and return what the bot needs:
   *   - input: the user's prompt (becomes the "user" message to the LLM)
   *   - args: additional context (working memory path for storing generated code)
   *   - context: entity context for graph/memory access
   */
  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<CODER_BTH>>
  ): Promise<BotRequestArgs<CODER_BTH>> {
    const dto = await this.get_dto();

    return {
      args: {
        output_working_memory_paths: ["code/analysis.ts"],
      },
      input: dto.data.prompt,
      context: new Context(dto),
    };
  }
}
```

There's a lot of type machinery here. Don't worry about memorizing it -- the pattern is the same for every entity. The important parts are:

1. **`["DemoCoderBot"]`** in the constructor -- tells the mixin which bot to use
2. **`get_bot_request_args_impl()`** -- reads entity data and returns what the bot needs
3. **The side-effect import** (`import "../bots/DemoCoderBot.js"`) -- ensures the bot is registered

## Step 4: Wire the Agent Bundle

Now connect everything. Register the entity in the constructor map and add an API endpoint to the bundle.

**`apps/coder-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { CodeTaskEntity } from "./entities/CodeTaskEntity.js";

export const CoderBundleConstructors = {
  ...FFConstructors,
  CodeTaskEntity: CodeTaskEntity,
} as const;
```

**`apps/coder-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { CoderBundleConstructors } from "./constructors.js";
import type { GeneralCoderOutput } from "@firebrandanalytics/ff-agent-sdk";

const AGENT_BUNDLE_ID = "37f3b877-f486-4bb7-a86b-173b48cc094d";

export class CoderBundleAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: AGENT_BUNDLE_ID,
        application_id: AGENT_BUNDLE_ID,
        name: "CoderBundle",
        type: "agent_bundle",
        description: "Code sandbox demo",
      },
      CoderBundleConstructors,
      createEntityClient(AGENT_BUNDLE_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("CoderBundleAgentBundle initialized!");
  }

  /**
   * POST /api/execute
   *
   * Takes a natural language prompt, creates a CodeTaskEntity,
   * runs the bot pipeline, and returns the result.
   */
  @ApiEndpoint({ method: "POST", route: "execute" })
  async execute(body: { prompt: string }): Promise<{
    success: boolean;
    output: GeneralCoderOutput | null;
    entity_id: string;
  }> {
    const { prompt } = body;

    if (!prompt || prompt.trim().length === 0) {
      throw new Error("prompt is required and cannot be empty");
    }

    logger.info(`[execute] Received prompt: "${prompt.substring(0, 80)}..."`);

    // 1. Create the entity (persisted in the entity graph)
    const dto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `code-task-${Date.now()}`,
      specific_type_name: "CodeTaskEntity",
      general_type_name: "CodeTaskEntity",
      status: "Pending",
      data: { prompt },
    });

    // 2. Get the entity instance and run the full pipeline
    const entity = await this.entity_factory.get_entity(dto.id);
    const output = await entity.run() as GeneralCoderOutput;

    return {
      success: true,
      output,
      entity_id: dto.id,
    };
  }
}
```

`@ApiEndpoint` exposes this method as `POST /api/execute` on the bundle's HTTP server. The method creates an entity (persisting the user's prompt), runs it (which triggers the bot, LLM call, and sandbox execution), and returns the result.

## Step 5: Build and Deploy

```bash
pnpm run build
```

Deploy to your cluster:

```bash
ff-cli ops build coder-bundle
ff-cli ops install coder-bundle
```

Verify it's running:

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }
```

## Step 6: Test It

Send a prompt and watch the magic happen:

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Calculate the first 10 Fibonacci numbers and return them as an array"}' \
  --url http://localhost:3001
```

You should get back something like:

```json
{
  "success": true,
  "output": {
    "description": "First 10 Fibonacci numbers",
    "result": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34],
    "stdout": ""
  },
  "entity_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Try a few more:

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Generate all prime numbers less than 100"}' \
  --url http://localhost:3001
```

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Sort the array [42, 7, 13, 99, 1, 55] using quicksort and return both the sorted array and the number of comparisons"}' \
  --url http://localhost:3001
```

Each time, the AI writes TypeScript, the sandbox runs it, and you get back structured results.

## What Just Happened?

Let's trace the full execution flow for that Fibonacci request:

```
You: "Calculate the first 10 Fibonacci numbers"
       |
       v
POST /api/execute { prompt: "Calculate the first 10 Fibonacci numbers" }
       |
       v
CoderBundleAgentBundle.execute()
       |-- Creates CodeTaskEntity in the entity graph
       |-- Calls entity.run()
       |
       v
BotRunnableEntityMixin
       |-- Looks up "DemoCoderBot" from the bot registry
       |-- Calls get_bot_request_args_impl() to get the prompt
       |-- Passes the prompt to the bot
       |
       v
DemoCoderBot (GeneralCoderBot)
       |-- Builds the full LLM prompt:
       |     1. Output format instructions (two-block format)
       |     2. run() function contract (entry point rules)
       |     3. User's prompt: "Calculate the first 10 Fibonacci numbers"
       |-- Sends the prompt to the LLM via the broker
       |
       v
LLM responds with two blocks:
       |-- JSON: { "reasoning": "...", "description": "..." }
       |-- TypeScript: export async function run() { ... }
       |
       v
CoderBot postprocessor
       |-- Parses the two blocks
       |-- Stores generated code in working memory
       |-- Sends code to Code Sandbox Service for execution
       |-- Sandbox runs it in an isolated environment
       |
       v
Result: { description: "First 10 Fibonacci numbers", result: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34] }
```

### Intrinsic Prompts

You may have noticed that `DemoCoderBot` doesn't define any prompt at all -- just a name, model pool, and profile. So how does the LLM know what format to use?

`GeneralCoderBot` automatically builds **intrinsic prompts** -- instructions that are fundamental to how CoderBot works:

1. **Output format** -- tells the LLM to produce exactly two markdown blocks: a JSON metadata block and a code block
2. **Entry point contract** -- tells the LLM the code must define a `run()` function that returns `{ description, result }`

These prompts come from the CoderBot base class and the profile metadata. You don't need to write them or even think about them. They're handled for you.

### The Profile

The profile `finance-typescript` is a named configuration on the Code Sandbox Service. It tells the sandbox:
- **Language**: TypeScript
- **Runtime**: which container image to use, resource limits, timeout
- **Harness**: how to load and run the generated code
- **Packages**: what npm packages are available

When the bot sends code for execution, it includes `profile: "finance-typescript"` and the sandbox knows exactly how to run it.

## Key Takeaways

1. **GeneralCoderBot handles the complexity** -- you provide a profile name and it handles prompt building, LLM calls, response parsing, and sandbox execution.
2. **Profiles are the single source of truth** -- language, runtime, packages, and execution rules all come from the profile. Change the profile, change the behavior.
3. **Entities store state, bots do work** -- the entity persists the user's prompt and the result. The bot is stateless.
4. **BotRunnableEntityMixin bridges entities to bots** -- when the entity runs, the mixin calls the bot. `get_bot_request_args_impl()` is your bridge method.
5. **Side-effect imports matter** -- import the bot module in the entity file so `@RegisterBot` runs before any lookup.

## Next Steps

Our bot can execute any TypeScript computation, but what if we want the AI to query a real database? In [Part 2: Adding Data Science with Domain Prompts](./part-02-data-science-and-domain-prompts.md), we'll add a second bot that generates Python code, introduce **domain prompts** to teach the AI about our data, and learn the prompt framework.
