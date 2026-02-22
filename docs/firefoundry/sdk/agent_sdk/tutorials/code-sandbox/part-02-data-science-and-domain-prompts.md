# Part 2: Adding Data Science with Domain Prompts

Our TypeScript bot from Part 1 can solve any computation -- Fibonacci sequences, sorting algorithms, prime numbers. But it doesn't know anything about *your* world. What if a user asks *"What is the average order value by customer segment?"* The bot has no idea what database to query, what tables exist, or how to access the data.

In this part, we'll add a second bot that generates Python code to query a real database. To make that work, we need to teach the AI about the data environment -- and that means introducing **domain prompts**.

**What you'll learn:**
- The difference between build time and runtime -- you define the problem space, users submit problems
- What domain prompts are and why they matter
- The prompt framework: `PromptTemplateSectionNode`, `PromptTemplateListNode`, semantic types
- How generated code queries databases through the Data Access Service (DAS)
- Adding a second bot, entity, and endpoint to an existing bundle

**What you'll build:** A second endpoint, `POST /api/analyze`, that takes data science questions and generates Python code to query a database.

---

## Two Kinds of Prompts

Before we write any code, let's clarify something that's easy to confuse.

When you hear "prompt" in the context of an AI agent, you might think of the question the user types in. But there are actually two layers:

| Layer | Who writes it | When | What it does |
|-------|--------------|------|-------------|
| **Domain prompt** | You, the developer | Build time | Teaches the AI about your data, tools, and rules |
| **User prompt** | Your end user | Runtime | Asks a specific question or requests a task |

The domain prompt is **not** the problem being solved. It's the *context* that enables the AI to solve whatever problem your users submit. Think of it like hiring a data analyst: you onboard them (domain prompt) by explaining the database, the business, and the rules. Then customers come in with questions (user prompts) and the analyst handles them.

In Part 1, our TypeScript bot didn't need a domain prompt because general-purpose computation doesn't require domain context. But a data science bot that queries *your specific database* needs to know how to access the data. That's what we'll build now.

## Step 1: Create the Data Science Bot

The structure is the same as `DemoCoderBot` -- extend `GeneralCoderBot`, provide a name, model pool, and profile. The difference is the profile: `firekicks-datascience` is configured for Python execution with DAS (Data Access Service) connections.

Create the file `apps/coder-bundle/src/bots/DemoDataScienceBot.ts`:

```typescript
import {
  GeneralCoderBot,
  RegisterBot,
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";

@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
    });
  }
}
```

Wait -- this looks exactly like the TypeScript bot. Where's the domain knowledge? We'll add it in `init()`. But first, let's understand the prompt framework we'll use to build it.

## Step 2: Understand the Prompt Framework

FireFoundry provides a structured way to build prompts called the **prompt framework**. Instead of concatenating strings, you build a tree of typed nodes that the framework renders into a final prompt at request time.

Why not just use strings? Three reasons:

1. **Structure** -- the framework knows which parts are context, which are rules, and which are instructions. This matters for debugging, telemetry, and future optimization.
2. **Composability** -- you can add, remove, or modify sections independently. Domain prompts and intrinsic prompts coexist without stepping on each other.
3. **Consistency** -- every bot in your organization uses the same prompt structure, making them easier to understand and maintain.

The two node types we'll use:

| Node | Purpose | Example |
|------|---------|---------|
| `PromptTemplateSectionNode` | A titled group of content | "Role:" followed by description paragraphs |
| `PromptTemplateListNode` | A numbered or bulleted list | "1. Return JSON-serializable results. 2. Cast Decimal columns..." |

Each node has a **semantic type** that categorizes it:

| Semantic Type | Meaning |
|---------------|---------|
| `"context"` | Background information -- role, environment, available data |
| `"rule"` | Behavioral constraints -- what to do and what not to do |
| `"instruction"` | Specific task directives |

These types don't change the rendered output today, but they enable the framework to reason about prompt structure -- for example, to identify which rules might be conflicting or which context sections are redundant.

## Step 3: Add the Domain Prompt

Now let's teach the bot about the FireKicks data environment. We'll override `init()` to add domain prompt sections after the bot's intrinsic prompts are set up.

Update `apps/coder-bundle/src/bots/DemoDataScienceBot.ts`:

```typescript
import {
  GeneralCoderBot,
  RegisterBot,
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";

@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
    });
  }

  override async init(): Promise<void> {
    await super.init(); // sets up intrinsic prompts from profile metadata

    // Add domain prompt sections to the system prompt
    const systemPrompt = this.base_prompt_group.get_prompt("system") as Prompt<CODER_PTH>;

    // Context: role and purpose
    systemPrompt.add_section(
      new PromptTemplateSectionNode<CODER_PTH>({
        semantic_type: "context",
        content: "Role:",
        children: [
          "You are a data science assistant for FireKicks, an athletic footwear company.",
          "Users submit natural language questions about the FireKicks business. You produce Python code that queries the database and performs analysis to answer their question.",
        ],
      })
    );

    // Context: how to query data via DAS
    systemPrompt.add_section(
      new PromptTemplateSectionNode<CODER_PTH>({
        semantic_type: "context",
        content: "Querying Data:",
        children: [
          "Use the DAS (Data Access Service) client for all database queries:",
          "`das['firekicks'].query_df('SELECT ...')` returns a pandas DataFrame.",
          "`das['firekicks'].query_rows('SELECT ...')` returns a list of dicts.",
          "Import packages you need at the top of your code (e.g., `import pandas as pd`).",
        ],
      })
    );

    // Rules: data handling
    systemPrompt.add_section(
      new PromptTemplateSectionNode<CODER_PTH>({
        semantic_type: "rule",
        content: "Data Handling Rules:",
        children: [
          new PromptTemplateListNode<CODER_PTH>({
            semantic_type: "rule",
            children: [
              "Return JSON-serializable results. Use `.to_dict('records')` for DataFrames.",
              "Cast Decimal/numeric columns with `.astype(float)` before calculations.",
              "For statistical analysis, use scipy.stats (e.g., `scipy.stats.pearsonr`, `scipy.stats.linregress`).",
              "Round numeric results to 4 decimal places.",
              "Do not produce visualizations or plots — return numeric/tabular results only.",
              "Handle edge cases (empty results, division by zero) gracefully.",
            ],
            list_label_function: (_req: any, _child: any, idx: number) =>
              `${idx + 1}. `,
          }),
        ],
      })
    );
  }
}
```

Let's walk through what's happening:

1. **`super.init()`** runs first -- this fetches profile metadata and builds the intrinsic prompts (output format, `run()` contract). Same thing the TypeScript bot does.

2. **`this.base_prompt_group.get_prompt("system")`** gives us the system prompt that already has the intrinsic sections. We're adding to it, not replacing it.

3. **Role section** (`semantic_type: "context"`) tells the AI who it is and what users will ask for. This frames every user interaction.

4. **Querying Data section** (`semantic_type: "context"`) teaches the AI how to access the database. The `das['firekicks']` client is injected into the Python runtime by the sandbox harness -- the generated code just uses it.

5. **Data Handling Rules** (`semantic_type: "rule"`) constrains the AI's output. Without these, you'd get matplotlib plots, non-serializable objects, and floating-point noise.

Notice what's *not* here: the database schema. The bot knows *how* to query the database but doesn't yet know *what's in it*. We'll fix that in Part 3.

## Step 4: Create the Data Science Entity

This follows the same pattern as `CodeTaskEntity` from Part 1 -- same structure, different bot name and working memory path.

Create the file `apps/coder-bundle/src/entities/DataScienceTaskEntity.ts`:

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

// Side-effect import -- ensures @RegisterBot("DemoDataScienceBot") executes
import "../bots/DemoDataScienceBot.js";

// -- Data shape --

export interface DataScienceTaskEntityDTOData extends JSONObject {
  prompt: string;
  [key: string]: JSONValue;
}

export type DataScienceTaskEntityDTO = EntityNodeDTO & {
  data: DataScienceTaskEntityDTOData;
};

// -- Type helpers --

export type DataScienceTaskEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  DataScienceTaskEntityDTO,
  "DataScienceTaskEntity",
  {},
  {}
>;

export type DataScienceTaskEntityRETH = RunnableEntityTypeHelper<
  DataScienceTaskEntityENH,
  GeneralCoderOutput
>;

// -- Entity class --

@EntityMixin({
  specificType: "DataScienceTaskEntity",
  generalType: "DataScienceTaskEntity",
  allowedConnections: {},
})
export class DataScienceTaskEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<DataScienceTaskEntityRETH>,
  BotRunnableEntityMixin<DataScienceTaskEntityRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | DataScienceTaskEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ["DemoDataScienceBot"]  // <-- different bot
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<CODER_BTH>>
  ): Promise<BotRequestArgs<CODER_BTH>> {
    const dto = await this.get_dto();

    return {
      args: {
        output_working_memory_paths: ["code/analysis.py"],  // <-- .py, not .ts
      },
      input: dto.data.prompt,
      context: new Context(dto),
    };
  }
}
```

Two differences from `CodeTaskEntity`:

1. **`["DemoDataScienceBot"]`** -- wires to the data science bot instead of the TypeScript bot
2. **`"code/analysis.py"`** -- the working memory path uses `.py` since this bot generates Python

Everything else -- the DTO shape, type helpers, mixin pattern -- is identical. This is the entity-bot separation at work: the entity structure doesn't change, only the bot name.

## Step 5: Register and Expose the New Endpoint

Update the constructors to include the new entity:

**`apps/coder-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { CodeTaskEntity } from "./entities/CodeTaskEntity.js";
import { DataScienceTaskEntity } from "./entities/DataScienceTaskEntity.js";

export const CoderBundleConstructors = {
  ...FFConstructors,
  CodeTaskEntity: CodeTaskEntity,
  DataScienceTaskEntity: DataScienceTaskEntity,
} as const;
```

Add the `/api/analyze` endpoint to the agent bundle. Add this method to the `CoderBundleAgentBundle` class in **`apps/coder-bundle/src/agent-bundle.ts`**:

```typescript
  /**
   * POST /api/analyze
   *
   * Takes a data science question, creates a DataScienceTaskEntity,
   * runs the Python code generation pipeline, and returns the result.
   */
  @ApiEndpoint({ method: "POST", route: "analyze" })
  async analyze(body: { prompt: string }): Promise<{
    success: boolean;
    output: GeneralCoderOutput | null;
    entity_id: string;
  }> {
    const { prompt } = body;

    if (!prompt || prompt.trim().length === 0) {
      throw new Error("prompt is required and cannot be empty");
    }

    logger.info(`[analyze] Received prompt: "${prompt.substring(0, 80)}..."`);

    const dto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `datasci-task-${Date.now()}`,
      specific_type_name: "DataScienceTaskEntity",
      general_type_name: "DataScienceTaskEntity",
      status: "Pending",
      data: { prompt },
    });

    const entity = await this.entity_factory.get_entity(dto.id);
    const output = await entity.run() as GeneralCoderOutput;

    return {
      success: true,
      output,
      entity_id: dto.id,
    };
  }
```

The pattern is identical to `execute()` -- create an entity, run it, return the result. The only differences are the entity type name and the route.

## Step 6: Build and Test

Build and deploy:

```bash
pnpm run build
ff-cli ops build coder-bundle
ff-cli ops install coder-bundle
```

Now test the new endpoint with a data science question:

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "What is the total revenue by product category?"}' \
  --url http://localhost:3001
```

You should get back something like:

```json
{
  "success": true,
  "output": {
    "description": "Total revenue by product category",
    "result": [
      { "category": "Running", "total_revenue": 245892.50 },
      { "category": "Basketball", "total_revenue": 189234.00 },
      { "category": "Training", "total_revenue": 156789.75 }
    ],
    "stdout": ""
  },
  "entity_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

The AI figured out the table names and column names well enough to produce a result. But try something more specific:

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "What is the correlation between shoe price and customer rating?"}' \
  --url http://localhost:3001
```

This one might work, or it might guess wrong about column names. The bot knows *how* to query the database and *what rules to follow*, but it doesn't know the exact table and column names. It's guessing based on the question. Sometimes it guesses right. Sometimes it doesn't.

## What Just Happened?

Let's trace the flow and see how it differs from Part 1:

```
User: "What is the total revenue by product category?"
       |
       v
POST /api/analyze { prompt: "..." }
       |
       v
CoderBundleAgentBundle.analyze()
       |-- Creates DataScienceTaskEntity
       |-- Calls entity.run()
       |
       v
BotRunnableEntityMixin
       |-- Looks up "DemoDataScienceBot"
       |-- Calls get_bot_request_args_impl()
       |
       v
DemoDataScienceBot (GeneralCoderBot)
       |-- Builds the full LLM prompt:
       |     1. Output format (intrinsic — from CoderBot)
       |     2. run() contract (intrinsic — from profile)
       |     3. Role context (domain — "data science assistant for FireKicks")
       |     4. DAS query instructions (domain — das['firekicks'].query_df())
       |     5. Data handling rules (domain — JSON serialization, rounding)
       |     6. User's question (runtime — "What is the total revenue...")
       |-- Sends to LLM
       |
       v
LLM generates Python code:
       |   import pandas as pd
       |   async def run():
       |       df = das['firekicks'].query_df('SELECT category, SUM(price * quantity) ...')
       |       return { "description": "...", "result": df.to_dict('records') }
       |
       v
Code Sandbox executes Python with DAS connection
       |
       v
Result: { description: "...", result: [...], stdout: "" }
```

Notice items 3-5 in the prompt -- those are the domain prompt sections we added. Items 1-2 are the intrinsic prompts that `GeneralCoderBot` builds automatically (same as the TypeScript bot). Item 6 is what the user typed.

The domain prompt sits between the framework's intrinsic instructions and the user's question. It's the layer *you* control.

## Key Takeaways

1. **Domain prompts teach the AI about your world** -- they provide the context that turns a generic code generator into a domain-specific assistant. Without them, the AI can write code but doesn't know your data.

2. **You define the problem space, users submit problems** -- your domain prompt describes what's available (databases, APIs, rules). The user's prompt is the specific question. This separation is what makes the agent reusable.

3. **The prompt framework gives structure** -- `PromptTemplateSectionNode` and `PromptTemplateListNode` organize prompts into typed, composable sections instead of raw string concatenation.

4. **Semantic types categorize intent** -- `"context"` for background, `"rule"` for constraints. This makes prompts self-documenting and enables future framework optimization.

5. **Adding a second bot follows the same pattern** -- new bot class, new entity class, new endpoint. The entity-bot wiring is identical; only the bot name and working memory path change.

## Next Steps

Our data science bot works, but it's guessing at table and column names. Sometimes it gets them right, sometimes it doesn't. In [Part 3: Dynamic Schema from DAS](./part-03-dynamic-schema.md), we'll fix this by having the bot fetch the actual database schema at startup and inject it into its domain prompt -- automatically, with no hardcoding.
