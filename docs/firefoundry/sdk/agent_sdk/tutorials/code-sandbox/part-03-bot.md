# Part 3: The Bot

In this part, you'll create `DemoCoderBot` -- a `GeneralCoderBot` variant wired to the prompt from Part 2 and the Code Sandbox Service.

## Understanding GeneralCoderBot

`GeneralCoderBot` is a ready-made CoderBot variant designed for general-purpose code generation. It provides:

- **Language configuration** -- TypeScript, Python, or SQL
- **No database dependencies** -- suitable for pure computation tasks
- **Module import preamble** -- auto-prepended to generated code
- **Run script** -- calls your generated `run()` function
- **Result processing** -- extracts `{ description, result, stdout, metadata }`

You don't need to implement the 9-stage postprocessing pipeline -- that's inherited from `CoderBot`. You just need to:

1. Create a `PromptGroup` with your system prompt and user input
2. Instantiate `GeneralCoderBot` with the prompt group and a `CodeSandboxClient`
3. Register it with `@RegisterBot` so entities can look it up

## Creating the Bot

Create the file `apps/coder-bundle/src/bots/DemoCoderBot.ts`:

```typescript
import {
  GeneralCoderBot,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";
import { CodeSandboxClient } from "@firebrandanalytics/code-sandbox-client";
import { CoderPrompt } from "../prompts/CoderPrompt.js";

// Build the prompt group.
// The system section carries the CoderPrompt instructions.
// The input section carries the user's natural language request.
const systemPrompt = new CoderPrompt("system");

const inputPrompt = new Prompt<CODER_PTH>({
  role: "user",
  static_args: {},
});
inputPrompt.add_section(
  new PromptTemplateTextNode<CODER_PTH>({
    content: (request) => request.input as string,
  })
);

const coderPromptGroup = new PromptGroup<CODER_PTH>([
  { name: "coder_system", prompt: systemPrompt as any },
  { name: "coder_input", prompt: inputPrompt },
]);

// Create the sandbox client.
// The client connects to the Code Sandbox Service.
// In a deployed environment, the service URL comes from environment variables.
const sandboxClient = new CodeSandboxClient({
  baseUrl: process.env.CODE_SANDBOX_URL || "http://localhost:3001",
});

/**
 * DemoCoderBot -- TypeScript code generation and execution bot.
 *
 * @RegisterBot makes this bot discoverable by BotRunnableEntityMixin.
 * When CodeTaskEntity calls entity.run(), the mixin looks up "DemoCoderBot"
 * from the global registry and invokes it.
 */
@RegisterBot("DemoCoderBot")
export class DemoCoderBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoCoderBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      promptGroup: coderPromptGroup,
      sandboxClient: sandboxClient,
      language: "typescript",
      maxTries: 5,
      maxSandboxRetries: 3,
    });
  }

  public override get_semantic_label_impl(): string {
    return "DemoCoderBot";
  }
}
```

### Walkthrough

**PromptGroup construction:**

The `PromptGroup` combines two prompts into a chat conversation:
1. `coder_system` -- the `CoderPrompt` from Part 2, rendered as a system message
2. `coder_input` -- a user message containing the natural language request

The `PromptTemplateTextNode` with `content: (request) => request.input as string` dynamically renders the user's input text at request time. The `request.input` comes from the entity's `get_bot_request_args()` method (covered in Part 4).

**Type casting:**

The `as any` cast on the system prompt bridges the prompt's simple `PromptTypeHelper<string, {}>` to the bot's `CODER_PTH` type. This is safe because the prompt doesn't reference any of the extra CoderPromptArgs fields.

**CodeSandboxClient:**

The client is created with a `baseUrl` pointing to the Code Sandbox Service. In production, this is a Kubernetes service URL configured via environment variables. For local development, it defaults to `localhost:3001`.

**@RegisterBot:**

The decorator registers `DemoCoderBot` in the global component registry. When `CodeTaskEntity` (Part 4) uses `BotRunnableEntityMixin` with bot name `"DemoCoderBot"`, the mixin calls `FFAgentBundle.getBotOrThrow("DemoCoderBot")` to retrieve this instance.

**get_semantic_label_impl:**

Returns a human-readable label used for logging and telemetry.

## Configuration Options

The `GeneralCoderBotConstructorArgs` accepts:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Bot name identifier |
| `modelPoolName` | `string` | required | LLM model pool to use |
| `promptGroup` | `PromptGroup<CODER_PTH>` | required | Prompt group for code generation |
| `sandboxClient` | `CodeSandboxClient` | required | Code Sandbox client instance |
| `language` | `"typescript" \| "python" \| "sql"` | `"typescript"` | Target language |
| `maxTries` | `number` | `8` | Max LLM retry attempts |
| `maxSandboxRetries` | `number` | `3` | Max sandbox execution retries |
| `errorPromptProviders` | `CoderErrorPromptProviders` | SDK defaults | Custom error handling prompts |

## Build and Verify

```bash
pnpm run build
```

The bot compiles as a standalone module. It imports the prompt from Part 2 and the `CodeSandboxClient` from the sandbox client package. It doesn't execute anything yet -- that happens when an entity triggers `run()` in Part 4.

## Key Points

> **GeneralCoderBot handles the pipeline** -- All 9 stages of code generation, validation, storage, and execution are inherited. You only configure the language, prompt, and sandbox connection.

> **@RegisterBot enables entity-bot wiring** -- Entities don't hold direct references to bots. Instead, `BotRunnableEntityMixin` looks up the bot by name from the global registry.

> **PromptGroup = chat conversation** -- Each entry in the group becomes a message in the LLM conversation. System prompts carry instructions; user prompts carry the input.

---

**Next:** [Part 4: Entity & Bundle](./part-04-entity-and-bundle.md) -- Create CodeTaskEntity with BotRunnableEntityMixin and wire everything into the agent bundle.
