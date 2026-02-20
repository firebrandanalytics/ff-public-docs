# Part 3: The Bot

In this part, you'll create `DemoCoderBot` and `DemoDataScienceBot` -- two `GeneralCoderBot` variants wired to the prompts from Part 2 and the Code Sandbox Service.

## Understanding GeneralCoderBot

`GeneralCoderBot` is a ready-made CoderBot variant designed for general-purpose code generation. It provides:

- **Language configuration** -- TypeScript or Python
- **Harness selection** -- determines the execution environment (`finance`, `datascience`)
- **Profile support** -- named configurations that bundle runtime, harness, and DAS connections
- **Module import preamble** -- auto-prepended to generated code
- **Run script** -- calls your generated `run()` function
- **Result processing** -- extracts `{ description, result, stdout, metadata }`

You don't need to implement the 9-stage postprocessing pipeline -- that's inherited from `CoderBot`. You just need to:

1. Create a `PromptGroup` with your system prompt and user input
2. Instantiate `GeneralCoderBot` with the prompt group and a `SandboxClient`
3. Configure the `profile` for sandbox execution
4. Register it with `@RegisterBot` so entities can look it up

## Creating DemoCoderBot

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
import { SandboxClient } from "@firebrandanalytics/ff-sandbox-client";
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
const sandboxClient = new SandboxClient({
  serviceUrl: process.env.CODE_SANDBOX_URL || "http://code-sandbox-manager:8080",
  apiKey: process.env.CODE_SANDBOX_API_KEY || "sandbox-dev-api-key",
});

/**
 * DemoCoderBot -- TypeScript code generation and execution bot.
 *
 * Uses the v2 profile API — the `finance-typescript` profile provides
 * the TypeScript finance harness for code execution.
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
      harness: "finance",
      profile: process.env.CODE_SANDBOX_TS_PROFILE || "finance-typescript",
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

**SandboxClient:**

The client is created with a `serviceUrl` pointing to the Code Sandbox Manager service. In production, this is a Kubernetes service URL configured via environment variables. The default points to `code-sandbox-manager:8080`.

**Profile configuration:**

The `profile` field tells the sandbox which named configuration to use for execution. Profiles are created in the Code Sandbox Manager's admin API and bundle together:
- A **runtime** (Kubernetes pod template with resource limits)
- A **harness** (TypeScript or Python execution environment)
- **DAS connections** (database access via Data Access Service)

By using profiles, the bot never handles database credentials or runtime configuration directly.

**@RegisterBot:**

The decorator registers `DemoCoderBot` in the global component registry. When `CodeTaskEntity` (Part 4) uses `BotRunnableEntityMixin` with bot name `"DemoCoderBot"`, the mixin calls `FFAgentBundle.getBotOrThrow("DemoCoderBot")` to retrieve this instance.

## Creating DemoDataScienceBot

Create the file `apps/coder-bundle/src/bots/DemoDataScienceBot.ts`:

```typescript
import {
  GeneralCoderBot,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from "@firebrandanalytics/ff-agent-sdk";
import type { CODER_PTH } from "@firebrandanalytics/ff-agent-sdk";
import { SandboxClient } from "@firebrandanalytics/ff-sandbox-client";
import { DataScienceCoderPrompt } from "../prompts/DataScienceCoderPrompt.js";

// Build the prompt group.
const systemPrompt = new DataScienceCoderPrompt("system");

const inputPrompt = new Prompt<CODER_PTH>({
  role: "user",
  static_args: {},
});
inputPrompt.add_section(
  new PromptTemplateTextNode<CODER_PTH>({
    content: (request) => request.input as string,
  })
);

const dataSciencePromptGroup = new PromptGroup<CODER_PTH>([
  { name: "datasci_system", prompt: systemPrompt as any },
  { name: "datasci_input", prompt: inputPrompt },
]);

// Create the sandbox client.
const sandboxClient = new SandboxClient({
  serviceUrl: process.env.CODE_SANDBOX_URL || "http://code-sandbox-manager:8080",
  apiKey: process.env.CODE_SANDBOX_API_KEY || "sandbox-dev-api-key",
});

/**
 * DemoDataScienceBot -- Python data science code generation and execution bot.
 *
 * Generates Python+pandas code that queries the database via DAS
 * and performs data analysis (correlations, regressions, aggregations, etc.).
 *
 * Uses the v2 profile API — the `firekicks-datascience` profile provides
 * frozen DAS clients to the execution context. No raw DB credentials needed.
 */
@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      promptGroup: dataSciencePromptGroup,
      sandboxClient: sandboxClient,
      language: "python",
      harness: "datascience",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
      maxTries: 5,
      maxSandboxRetries: 3,
    });
  }

  public override get_semantic_label_impl(): string {
    return "DemoDataScienceBot";
  }
}
```

### Key Differences from DemoCoderBot

| | DemoCoderBot | DemoDataScienceBot |
|---|---|---|
| **Language** | `typescript` | `python` |
| **Harness** | `finance` | `datascience` |
| **Profile** | `finance-typescript` | `firekicks-datascience` |
| **Prompt** | `CoderPrompt` (generic TS) | `DataScienceCoderPrompt` (schema + DAS) |
| **Database access** | None | Via DAS (`das['firekicks']`) |
| **Entry point** | `export async function run()` | `def run():` |

The `datascience` harness pre-imports `pandas`, `numpy`, and `scipy.stats` into the execution scope and provides the `das` dict with configured DAS client connections.

## Configuration Options

The `GeneralCoderBotConstructorArgs` accepts:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Bot name identifier |
| `modelPoolName` | `string` | required | LLM model pool to use |
| `promptGroup` | `PromptGroup<CODER_PTH>` | required | Prompt group for code generation |
| `sandboxClient` | `SandboxClient` | required | Code Sandbox client instance |
| `language` | `"typescript" \| "python"` | `"typescript"` | Target language |
| `harness` | `string` | -- | Harness type (`finance`, `datascience`) |
| `profile` | `string` | -- | Named sandbox profile for execution |
| `maxTries` | `number` | `8` | Max LLM retry attempts |
| `maxSandboxRetries` | `number` | `3` | Max sandbox execution retries |
| `errorPromptProviders` | `CoderErrorPromptProviders` | SDK defaults | Custom error handling prompts |

## Understanding Profiles

Profiles are a key concept in the Code Sandbox architecture. Instead of passing database credentials, runtime configuration, and harness details with every execution request, you create a **named profile** on the sandbox manager that bundles all of this:

```
Profile: "firekicks-datascience"
  ├── Runtime: python-datascience-runtime
  │     ├── Image: ff-code-sandbox-harness-python:latest
  │     ├── CPU: 500m, Memory: 512Mi
  │     └── Timeout: 120s
  ├── Harness: datascience
  ├── DAS connections:
  │     └── firekicks → das.ff-dev.svc.cluster.local:8080
  └── Run script: (default for datascience harness)
```

The bot just sends `profile: "firekicks-datascience"` with the execution request, and the sandbox manager resolves everything server-side. This keeps credentials out of the bot code and makes it easy to change runtime configuration without redeploying the bot.

## Build and Verify

```bash
pnpm run build
```

Both bots compile as standalone modules. They import their respective prompts and the `SandboxClient`. They don't execute anything yet -- that happens when an entity triggers `run()` in Part 4.

## Key Points

> **GeneralCoderBot handles the pipeline** -- All 9 stages of code generation, validation, storage, and execution are inherited. You only configure the language, harness, profile, prompt, and sandbox connection.

> **Profiles decouple configuration from code** -- The bot sends a profile name; the sandbox manager resolves runtime, harness, DAS connections, and run scripts server-side. No credentials in bot code.

> **@RegisterBot enables entity-bot wiring** -- Entities don't hold direct references to bots. Instead, `BotRunnableEntityMixin` looks up the bot by name from the global registry.

> **PromptGroup = chat conversation** -- Each entry in the group becomes a message in the LLM conversation. System prompts carry instructions; user prompts carry the input.

---

**Next:** [Part 4: Entity & Bundle](./part-04-entity-and-bundle.md) -- Create CodeTaskEntity and DataScienceTaskEntity with BotRunnableEntityMixin and wire everything into the agent bundle.
