# Part 4: Entity & Bundle

In this part, you'll create `CodeTaskEntity` to connect user prompts to the bot, update the constructors registry, wire the agent bundle with an API endpoint, and verify the full build.

## Understanding the Entity-Bot Connection

In FireFoundry, entities don't call bots directly. Instead:

1. **Entity** uses `BotRunnableEntityMixin` and specifies a bot name
2. **Mixin** looks up the bot from the global registry (populated by `@RegisterBot`)
3. **Entity** provides `get_bot_request_args_impl()` to build the bot input from entity data
4. **Mixin** handles running the bot, streaming progress, and returning the output

This decoupling means bots are stateless and reusable across different entity types.

## Creating CodeTaskEntity

Create the file `apps/coder-bundle/src/entities/CodeTaskEntity.ts`:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  EntityFactory,
  logger,
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

// Import the bot module to ensure @RegisterBot decorator executes
import "../bots/DemoCoderBot.js";

// ── DTO data shape ──────────────────────────────────────────────────────

export interface CodeTaskEntityDTOData extends JSONObject {
  prompt: string;
  [key: string]: JSONValue;
}

export type CodeTaskEntityDTO = EntityNodeDTO & {
  data: CodeTaskEntityDTOData;
};

// ── Type helpers ────────────────────────────────────────────────────────

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

// ── Entity class ────────────────────────────────────────────────────────

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
      ["DemoCoderBot"]
    );
  }

  /**
   * Build the bot request args from entity data.
   *
   * CoderBot requires `output_working_memory_paths` containing a path
   * ending with the language file extension (.ts for TypeScript).
   * This tells CoderBot where to store the generated code in working memory.
   */
  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<CODER_BTH>>
  ): Promise<BotRequestArgs<CODER_BTH>> {
    const dto = await this.get_dto();

    logger.info(`[CodeTaskEntity] Building bot request for prompt: "${dto.data.prompt.substring(0, 80)}..."`, {
      entity_id: this.id,
    });

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

### Key Details

**Side-effect import:**

```typescript
import "../bots/DemoCoderBot.js";
```

This import ensures the `@RegisterBot("DemoCoderBot")` decorator runs before any entity tries to look up the bot. Without it, the bot class might not be loaded and the registry lookup would fail.

**`output_working_memory_paths`:**

CoderBot's postprocess pipeline (stage 5) looks for a path ending with the language's file extension (`.ts` for TypeScript). This determines the filename used when storing generated code in working memory. The path `"code/analysis.ts"` means the code will be stored with the name `analysis.ts` in the entity's working memory.

**`AddMixins` pattern:**

`AddMixins(RunnableEntity, BotRunnableEntityMixin)` composes two behaviors:
- `RunnableEntity` provides the base entity with `run()` method
- `BotRunnableEntityMixin` provides bot lookup and execution

The type parameter array `[RunnableEntity<...>, BotRunnableEntityMixin<...>]` provides compile-time type safety for the composed class.

## Updating the Constructor Registry

The entity factory needs to know about `CodeTaskEntity` to create instances. Update `apps/coder-bundle/src/constructors.ts`:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { CodeTaskEntity } from "./entities/CodeTaskEntity.js";

export const CoderBundleConstructors = {
  ...FFConstructors,
  CodeTaskEntity: CodeTaskEntity,
} as const;
```

## Adding the API Endpoint

Update `apps/coder-bundle/src/agent-bundle.ts` to add an execute endpoint:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { CoderBundleConstructors } from "./constructors.js";
import type { GeneralCoderOutput } from "@firebrandanalytics/ff-agent-sdk";

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

  /**
   * Execute a code generation request.
   *
   * Creates a CodeTaskEntity with the user's prompt, runs the bot pipeline
   * (LLM generation → sandbox execution), and returns the result.
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

    // Create the entity
    const dto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `code-task-${Date.now()}`,
      specific_type_name: "CodeTaskEntity",
      general_type_name: "CodeTaskEntity",
      status: "Pending",
      data: { prompt },
    });

    logger.info(`[execute] Created CodeTaskEntity: ${dto.id}`);

    // Get the entity instance and run the bot
    const entity = await this.entity_factory.get_entity(dto.id);
    const output = await entity.run() as GeneralCoderOutput;

    logger.info(`[execute] Execution complete for entity: ${dto.id}`);

    return {
      success: true,
      output,
      entity_id: dto.id,
    };
  }
}
```

### How the Execute Flow Works

```
POST /api/execute { "prompt": "Calculate Fibonacci" }
       |
       v
  CoderBundleAgentBundle.execute()
       |
       |-- 1. Create CodeTaskEntity in entity graph
       |-- 2. entity.run()
       |        |
       |        v
       |   BotRunnableEntityMixin
       |        |-- Look up "DemoCoderBot" from registry
       |        |-- Call get_bot_request_args_impl()
       |        |     → input: user prompt
       |        |     → args.output_working_memory_paths: ["code/analysis.ts"]
       |        |-- Run bot
       |             |
       |             v
       |        DemoCoderBot (GeneralCoderBot)
       |             |-- Send prompt to LLM via broker
       |             |-- LLM returns JSON + TypeScript code
       |             |-- CoderBot postprocesses:
       |             |     extract → validate → store → execute → return
       |             |
       |             v
       |        GeneralCoderOutput { description, result, stdout }
       |
       v
  Return { success: true, output: {...}, entity_id: "..." }
```

## Build and Verify

```bash
pnpm run build
```

All packages should build with zero errors. The full agent bundle is now wired and ready for deployment.

## Key Points

> **Side-effect imports matter** -- Import the bot module in the entity file to ensure `@RegisterBot` runs before entity code tries to look up the bot.

> **`output_working_memory_paths` is required** -- CoderBot uses this to determine where to store generated code. The path must end with the correct file extension for the language (`.ts`, `.py`, `.sql`).

> **Entity factory creates entities, not constructors** -- Use `this.entity_factory.create_entity_node()` to create entity DTOs. The factory handles persistence through the Entity Service.

> **`entity.run()` drives the pipeline** -- The single `run()` call triggers the full flow: build request → run bot → LLM call → code extraction → sandbox execution → return result.

---

**Next:** [Part 5: Deploy & Test](./part-05-deploy-and-test.md) -- Deploy to a local FireFoundry cluster and test with curl.
