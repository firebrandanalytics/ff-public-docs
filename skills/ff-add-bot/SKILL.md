---
name: ff-add-bot
description: Add a bot with prompt templates to an existing agent bundle (SDK v4)
user_invocable: true
argument: bot name (e.g. SummaryBot)
---

# Add a Bot to an Agent Bundle

Add a new bot class with prompt templates to an existing FireFoundry agent bundle. Bots orchestrate LLM calls through the FireFoundry broker using SDK v4 patterns.

## 1. Resolve context

Use the provided argument as the bot name. If not provided, ask the user what the bot should do.

Locate the agent bundle — look for `firefoundry.json` with `"type": "agent-bundle"`.

## 2. Read existing code

```
apps/<bundle>/src/agent-bundle.ts   — main bundle class
apps/<bundle>/src/bots/             — existing bots (if any)
apps/<bundle>/src/constructors.ts   — entity constructors
package.json                        — check for shared-utils dependency
```

## 3. Check dependencies

The bot pattern requires two SDK packages. Verify both are in `package.json`:

```json
{
  "@firebrandanalytics/ff-agent-sdk": "^4.3.0",
  "@firebrandanalytics/shared-utils": "^4.2.0"
}
```

`shared-utils` provides `ComposeMixins` which is required for the mixin bot pattern. If missing, add it:

```bash
pnpm add @firebrandanalytics/shared-utils@^4.2.0
```

## 4. Define the output schema

Create `apps/<bundle>/src/bots/<BotName>Schema.ts`:

```typescript
import { z } from "zod";

export const <BotName>Schema = z.object({
  // Define the structured output the LLM should produce
  summary: z.string().describe("A concise summary"),
  keyPoints: z.array(z.string()).describe("Key points extracted"),
  sentiment: z.enum(["positive", "negative", "neutral"]).describe("Overall sentiment"),
});

export type <BotName>Output = z.infer<typeof <BotName>Schema>;
```

## 5. Create the bot

Create `apps/<bundle>/src/bots/<BotName>.ts`:

```typescript
import {
  MixinBot,
  Prompt,
  PromptGroup,
  StructuredPromptGroup,
  StructuredOutputBotMixin,
  PromptTemplateTextNode,
} from "@firebrandanalytics/ff-agent-sdk";
import { ComposeMixins } from "@firebrandanalytics/shared-utils";
import { <BotName>Schema } from "./<BotName>Schema.js";

function buildPromptGroup(input: string) {
  const systemPrompt = new Prompt("system", {});
  systemPrompt.add_section(
    new PromptTemplateTextNode({
      content:
        "You are a specialized assistant. Analyze the provided content " +
        "and produce structured output according to the schema.",
    })
  );

  const userPrompt = new Prompt("user", {});
  userPrompt.add_section(
    new PromptTemplateTextNode({ content: input })
  );

  return new StructuredPromptGroup({
    base: new PromptGroup([
      { name: "system", prompt: systemPrompt },
      { name: "user", prompt: userPrompt },
    ]),
    input: new PromptGroup([]),
  });
}

// ComposeMixins returns a complex abstract generic; cast to any for practical use
const <BotName>Base = ComposeMixins(MixinBot, StructuredOutputBotMixin) as any;

export class <BotName> extends <BotName>Base {
  constructor(input: string) {
    const promptGroup = buildPromptGroup(input);

    // First array: bot configs (one per bot in the mixin chain)
    // Second array: structured output configs (one per StructuredOutputBotMixin)
    super(
      [{
        name: "<BotName>",
        base_prompt_group: promptGroup,
        model_pool_name: "gemini_completion",
        static_args: {},
      }],
      [{ schema: <BotName>Schema }]
    );
  }

  // Required by SDK v4 — return a label for telemetry/logging
  get_semantic_label_impl(_request: any): string {
    return "<BotName>";
  }
}
```

### Key details

- **`ComposeMixins(MixinBot, StructuredOutputBotMixin)`**: Creates a base class that combines the core bot behavior with structured (Zod-validated) output parsing. Cast to `any` because the generic types are complex.
- **Constructor takes two arrays**: The first is bot configs (name, prompt group, model pool). The second is structured output configs (Zod schema).
- **`model_pool_name`**: Routes to a model group configured in the broker. This name must match a `brk_routing.model_group.name` in the broker database.
- **`get_semantic_label_impl()`**: Required override — return the bot name. SDK throws at runtime if this is missing.
- **`StructuredPromptGroup`**: Wraps a `PromptGroup` with `base` and `input` fields. The `base` contains system/user prompts. The `input` is for additional dynamic context (can be empty).
- **`PromptTemplateTextNode`**: Used inside `Prompt.add_section()` to add text content. Takes `{ content: string }`.

## 6. Use the bot from an @ApiEndpoint

In `apps/<bundle>/src/agent-bundle.ts`, add an endpoint that creates and runs the bot:

```typescript
import { BotRequest, Context } from "@firebrandanalytics/ff-agent-sdk";
import { <BotName> } from "./bots/<BotName>.js";

// Inside the bundle class:

@ApiEndpoint({ method: "POST", route: "analyze" })
async analyze(body: any = {}): Promise<any> {
  const { content } = body;
  if (!content) throw new Error("content is required");

  const bot = new <BotName>(content);
  const request = new BotRequest({
    id: `analyze-${Date.now()}`,
    input: content,
    args: {},
    context: new Context(),
  });

  try {
    const response = await bot.run(request);
    return { result: response.output };
  } catch (err: any) {
    logger.error(`<BotName> failed: ${err.message}`);
    return { error: err.message, message: "Analysis failed" };
  }
}
```

### BotRequest fields

- **`id`**: Unique request identifier (used for logging/tracing)
- **`input`**: The primary input string
- **`args`**: Additional arguments (empty object `{}` for simple cases)
- **`context`**: A `Context` instance — required by v4, can be a fresh `new Context()`

### Response shape

`bot.run(request)` returns a response object. Access `response.output` for the Zod-parsed structured data matching your schema.

On failure, `bot.run()` throws — wrap in try/catch. The error message typically includes the broker's error detail (e.g., model resolution failure, provider config issue).

## 7. Build and test

```bash
pnpm run build
```

After deploying with `/ff-deploy-local`:

```bash
curl -s -X POST http://localhost:8000/agents/<env-name>/<bundle-name>/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"content": "FireFoundry is a Kubernetes-native PaaS for AI applications."}'
```

**Common failure modes**:
- `"No valid models found"` — model group name in bot config doesn't match broker DB, or routing chain is misconfigured
- `"get_semantic_label not implemented"` — missing `get_semantic_label_impl()` on the bot class
- `"Missing configuration: deploymentConfig.model"` — broker's deployed_model record has null config
- Provider auth errors — broker secret not configured (`ff-cli env broker-secret add`)

## File summary

After completing this skill, your bundle should have:

```
apps/<bundle>/src/
  bots/
    <BotName>.ts            — Bot class (ComposeMixins + StructuredOutputBotMixin)
    <BotName>Schema.ts      — Zod schema defining structured output
  agent-bundle.ts           — Updated with @ApiEndpoint using the bot
```
