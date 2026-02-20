# Part 3: The Bot

In this part, you'll create `DemoCoderBot` and `DemoDataScienceBot` using `GeneralCoderBot`'s profile-driven constructor.

## Understanding GeneralCoderBot

`GeneralCoderBot` is a ready-made CoderBot variant designed for profile-driven code generation. It handles:

- **Profile metadata** -- fetches language, harness, DAS connections, and run script contract from the sandbox manager at initialization
- **SandboxClient** -- self-creates from environment variables (`CODE_SANDBOX_URL`)
- **Intrinsic prompts** -- output format and `run()` contract (built automatically)
- **Result processing** -- extracts `{ description, result, stdout, metadata }`

You don't need to implement the 9-stage postprocessing pipeline -- that's inherited from `CoderBot`. You just need to:

1. Choose a profile (determines language, runtime, harness, DAS connections)
2. Optionally provide domain prompt sections (for domain-specific context)
3. Register with `@RegisterBot` so entities can look it up

## Creating DemoCoderBot

Create the file `apps/coder-bundle/src/bots/DemoCoderBot.ts`:

```typescript
import { GeneralCoderBot, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";

/**
 * DemoCoderBot -- TypeScript code generation and execution.
 *
 * Profile-driven: the `finance-typescript` profile resolves runtime,
 * harness, and execution environment. No domain prompt needed for
 * general-purpose TypeScript computation — users submit any problem
 * and the AI writes code to solve it.
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

Three constructor args: `name`, `modelPoolName`, and `profile`. For general-purpose TypeScript, no domain prompt is needed — the AI can solve whatever computational problem users submit using just the intrinsic prompt.

## Creating DemoDataScienceBot

The data science bot is more interesting. It needs to:

1. **Fetch the database schema from DAS** at initialization
2. **Build a domain prompt** with the live schema, DAS query instructions, and data handling rules
3. **Add the prompt sections** to the bot's prompt group

This means schema changes in the database are picked up automatically on the next bot init — no code redeployment needed.

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
import { logger } from "@firebrandanalytics/shared-utils";
import {
  buildFireKicksDomainSections,
  type DasSchemaInfo,
} from "../prompts/FireKicksDomainPrompt.js";

/**
 * DemoDataScienceBot -- Python data science code generation and execution.
 *
 * At init, fetches the database schema from DAS and builds a domain prompt
 * dynamically. Users submit data science questions and the AI writes Python
 * code that queries the FireKicks database to answer them.
 */
@RegisterBot("DemoDataScienceBot")
export class DemoDataScienceBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "DemoDataScienceBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_DS_PROFILE || "firekicks-datascience",
      // Domain prompt is added during init() after fetching schema from DAS
    });
  }

  override async init(): Promise<void> {
    await super.init(); // fetches profile metadata (language, harness, DAS connections)

    // Fetch the database schema from DAS
    const dasUrl = process.env.DATA_ACCESS_URL || "http://ff-data-access:8080";
    const connectionName = "firekicks";

    logger.info(`${this.name}: fetching schema from DAS connection "${connectionName}"`);
    const resp = await fetch(`${dasUrl}/v1/connections/${connectionName}/schema`);
    if (!resp.ok) {
      throw new Error(`Failed to fetch DAS schema for "${connectionName}": ${resp.status}`);
    }
    const schema: DasSchemaInfo = await resp.json();
    logger.info(`${this.name}: loaded schema with ${schema.tables.length} tables`);

    // Add domain prompt sections to the system prompt with live schema
    const systemPrompt = this.base_prompt_group.get_prompt("system") as Prompt<CODER_PTH>;
    for (const section of buildFireKicksDomainSections(schema)) {
      systemPrompt.add_section(section);
    }
  }
}
```

### How the DAS Schema Fetch Works

```
Bot construction
  |
  v
super.init()
  |-- fetches profile metadata from sandbox manager
  |-- resolves: language=python, harness=datascience, dasConnections=["firekicks"]
  |
  v
fetch DAS schema
  |-- GET /v1/connections/firekicks/schema
  |-- returns: { tables: [{ name: "customers", columns: [...] }, ...] }
  |
  v
buildFireKicksDomainSections(schema)
  |-- formats each table into a prompt-friendly string
  |-- wraps in PromptTemplateSectionNode sections
  |
  v
systemPrompt.add_section(...)
  |-- adds domain sections AFTER the intrinsic output format sections
  |-- prompt is now complete: intrinsic + domain
```

The key pattern is that domain prompt sections are added during `init()`, not during construction. This lets the bot fetch live data (schema, metadata) before building the prompt. The `base_prompt_group` is accessible on any bot subclass and provides `get_prompt("system")` to access the system prompt, which supports `add_section()` for appending new sections.

### Key Differences

| | DemoCoderBot | DemoDataScienceBot |
|---|---|---|
| **Profile** | `finance-typescript` | `firekicks-datascience` |
| **Language** | TypeScript (from profile) | Python (from profile) |
| **Domain prompt** | None | Fetched from DAS at init |
| **Database access** | None | Via DAS (`das['firekicks']`) |

## Configuration Options

The `GeneralCoderBotConstructorArgs` accepts:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Bot name identifier |
| `modelPoolName` | `string` | required | LLM model pool to use |
| `profile` | `string` | required | Named sandbox profile (resolves language, harness, DAS, run script) |
| `domainPrompt` | `PromptTemplateNode \| PromptTemplateNode[] \| string` | -- | Domain-specific prompt sections (can also be added in `init()`) |
| `maxTries` | `number` | `8` | Max LLM retry attempts |
| `maxSandboxRetries` | `number` | `3` | Max sandbox execution retries |
| `errorPromptProviders` | `CoderErrorPromptProviders` | SDK defaults | Custom error handling prompts |

## Understanding Profiles

Profiles are a key concept in the Code Sandbox architecture. Instead of passing database credentials, runtime configuration, and harness details with every execution request, you create a **named profile** on the sandbox manager that bundles all of this:

```
Profile: "firekicks-datascience"
  +-- Runtime: python-datascience-runtime (resource limits, timeout, image)
  +-- Harness: datascience
  +-- DAS connections: firekicks -> Data Access Service
  +-- Run script: (default for datascience harness)
```

The bot just sends `profile: "firekicks-datascience"` with the execution request, and the sandbox manager resolves everything. This keeps credentials out of the bot code and makes it easy to change runtime configuration without redeploying.

At init time, GeneralCoderBot also fetches **profile metadata** to build its intrinsic prompt, including the `runScriptPrompt` -- a natural language description of the entry point contract that the LLM needs to follow.

## Build and Verify

```bash
pnpm run build
```

Both bots compile. They don't execute anything yet -- that happens when an entity triggers `run()` in Part 4.

## Key Points

> **Profile is the single source of truth** -- Language, harness, DAS connections, and run script contract all come from the profile.

> **Fetch schema from DAS at init** -- Override `init()` to fetch live schema from DAS, then build domain prompt sections with the result. Schema changes are picked up automatically.

> **Domain prompt uses the prompt framework** -- Build structured prompts with `PromptTemplateSectionNode` and `PromptTemplateListNode`. Semantic types (`"context"`, `"rule"`) make prompts composable and meaningful to the rendering engine.

> **SandboxClient is self-managed** -- GeneralCoderBot creates its own client from the `CODE_SANDBOX_URL` environment variable.

> **@RegisterBot enables entity-bot wiring** -- Entities look up the bot by name from the global registry via `BotRunnableEntityMixin`.

---

**Next:** [Part 4: Entity & Bundle](./part-04-entity-and-bundle.md) -- Create entities, wire API endpoints, and connect everything.
