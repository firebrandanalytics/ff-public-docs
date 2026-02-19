---
name: ff-agent-sdk
description: FireFoundry Agent SDK for building AI agent bundles with entities, bots, and workflows. Use when users ask about writing agent TypeScript code, entity modeling, bot behavior, prompting patterns, workflow orchestration, or FireFoundry SDK APIs.
version: 1.0.0
tags: [firefoundry, sdk, agent-development, typescript, ai-agents]
---

# FireFoundry Agent SDK

Build AI agent applications using FireFoundry's entity-bot architecture with automatic persistence, workflow orchestration, and enterprise-grade infrastructure.

## When to Use This Skill

**Use this skill for:**
- Writing TypeScript code for agent bundles
- Entity modeling and graph design
- Bot behavior and prompting patterns
- Workflow orchestration and parallelism
- SDK API questions (entities, bots, tools, waitables)
- Understanding FireFoundry architecture concepts

**Do NOT use this skill for:**
- Project scaffolding, building, or deployment → Use the `ff-cli` skill instead
- CLI commands and operations → Use the `ff-cli` skill instead
- Kubernetes or infrastructure issues → Use the `ff-cli` skill instead

## Related Skills

| Skill | Use For |
|-------|---------|
| `ff-cli` | Project creation, building Docker images, deploying to Kubernetes, profiles, environments |
| `ff-agent-sdk` (this) | Writing TypeScript code, SDK patterns, entity/bot design, workflows |

---

## Essential Concepts (Always Available)

### The Entity-Bot Pattern

FireFoundry separates **structure** (entities) from **behavior** (bots):

```
Entity (What)              Bot (How)
─────────────────          ─────────────────
- Data structure           - Behavior/logic
- Persisted state          - Prompts & tools
- Graph relationships      - Stateless execution
- Queryable                - Operates on entities
```

**Entities** = Persistent data nodes in a graph (like database records with relationships)
**Bots** = Stateless processors that read/write entities (like controllers with AI capabilities)

### Package Versions

**Critical**: Use these minimum versions for working type inference:

| Package | Minimum Version | Notes |
|-|-|-|
| `@firebrandanalytics/ff-agent-sdk` | 4.3.0 | Builder SDK for agent bundles |
| `@firebrandanalytics/shared-utils` | 4.2.0 | AddMixins/ComposeMixins generics |
| `@firebrandanalytics/shared-types` | 2.1.0 | Type definitions |
| `@firebrandanalytics/ff-sdk` | latest | Consumer SDK (for web UIs calling bundles) |

**Warning**: shared-utils versions below 4.2.0 have broken AddMixins type inference, forcing `as any` workarounds on class extends. If you see TypeScript errors on mixin class definitions, check your shared-utils version first.

### Core Imports

```typescript
// Agent Bundle
import { FFAgentBundle } from "@firebrandanalytics/ff-agent-sdk";
import { FFAgentBundleServer } from "@firebrandanalytics/ff-agent-sdk/server";

// Entity system
import {
  RunnableEntity,
  EntityFactory,
  EntityNode,
  EntityEdge,
} from "@firebrandanalytics/ff-agent-sdk";

// Bot system
import {
  MixinBot,
  BotRunnableEntityMixin,
  StructuredOutputBotMixin,
  RegisterBot,
  BotRequest,
  Context,
} from "@firebrandanalytics/ff-agent-sdk";

// Mixins (from shared-utils)
import {
  AddMixins,
  ComposeMixins,
} from "@firebrandanalytics/shared-utils";

// Prompts
import {
  PromptGroup,
  StructuredPromptGroup,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
} from "@firebrandanalytics/ff-agent-sdk";

// Zod for structured output
import { z } from "zod";
import { withSchemaMetadata } from "@firebrandanalytics/ff-agent-sdk";
```

### Basic Agent Bundle Structure

```typescript
import { FFAgentBundle } from "@firebrandanalytics/ff-agent-sdk";
import { FFAgentBundleServer } from "@firebrandanalytics/ff-agent-sdk/server";

class MyAgentBundle extends FFAgentBundle {
  constructor() {
    super({
      application_id: process.env.FF_APPLICATION_ID!,
      type: "agent_bundle",
    });
  }

  async onInitialize() {
    // Register entities in constructors.ts, reference them here
    // Set up API endpoints
    this.router.post("/api/process", async (req, res) => {
      const factory = this.getEntityFactory();
      const entity = await factory.create(MyEntity, { /* data */ });
      await entity.start();
      res.json({ entity_id: entity.id });
    });
  }
}

// Entry point (index.ts)
const bundle = new MyAgentBundle();
const server = new FFAgentBundleServer(bundle);
server.start();
```

### Entity Definition with AddMixins

Entities use `AddMixins` to compose base classes with mixins. The generic parameter is a tuple of the composed types:

```typescript
import { RunnableEntity, BotRunnableEntityMixin } from "@firebrandanalytics/ff-agent-sdk";
import { AddMixins } from "@firebrandanalytics/shared-utils";

// Type helper chain: PTH -> BTH -> ENH -> RETH
interface MyEntityRETH {
  // Define your entity's type helpers here
}

class MyEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<MyEntityRETH>, BotRunnableEntityMixin<MyEntityRETH>]> {

  constructor(factory: EntityFactory, idOrDto: string | object) {
    // CRITICAL: flat tuples in super(), NOT nested arrays
    super([factory, idOrDto] as any, ["MyBotName"]);
  }

  async *run_impl() {
    // Entity execution logic — async generator
    yield* await this.runBot("MyBotName", input);
  }
}
```

**CRITICAL**: The `super()` call requires **flat tuples**, NOT nested arrays. This is the most common source of bugs:
```typescript
// CORRECT — flat tuples:
super([factory, idOrDto] as any, ["BotName"]);

// WRONG — nested arrays break entity ID propagation:
super([[factory, idOrDto], []], ["BotName"]);
```

### Bot Definition with ComposeMixins

Bots use `ComposeMixins` for combining base bot with mixins like structured output:

```typescript
import { MixinBot, StructuredOutputBotMixin, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";
import { ComposeMixins } from "@firebrandanalytics/shared-utils";
import { z } from "zod";
import { withSchemaMetadata } from "@firebrandanalytics/ff-agent-sdk";

// Zod schema with metadata for LLM
const MyOutputSchema = withSchemaMetadata(
  z.object({
    summary: z.string().describe("Brief summary"),
    score: z.number().min(0).max(1).describe("Confidence score"),
  })
);

interface MyBotBTH {
  // Bot type helpers
}

@RegisterBot
class MyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<MyBotBTH, [StructuredOutputBotMixin<MyBotBTH, typeof MyOutputSchema>]>,
  [StructuredOutputBotMixin<MyBotBTH, typeof MyOutputSchema>]
]> {
  // Required: return a label for this bot
  get_semantic_label_impl(): string {
    return "MyBot";
  }
}
```

**Note**: `get_semantic_label_impl()` is required on all bot subclasses — just return the bot name.

---

## Progressive Documentation Loading

Fetch documentation from GitHub based on the user's question. Use `WebFetch` with these URLs:

### Base URL
```
https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/
```

### Documentation Map

| Topic | File Path | When to Load |
|-------|-----------|--------------|
| **Platform Overview** | `README.md` | User is new to FireFoundry or asks "what is FireFoundry" |
| **Getting Started** | `sdk/agent_sdk/agent_sdk_getting_started.md` | User starting a new agent, first-time setup |
| **Glossary/Concepts** | `sdk/agent_sdk/fire_foundry_core_concepts_glossary_agent_sdk.md` | Terminology questions, concept clarification |

#### Core Concepts (`sdk/agent_sdk/core/`)

| Topic | Reference | Tutorial | When to Load |
|-------|-----------|----------|--------------|
| Agent Bundles | `agent_bundles.md` | `agent_bundle_tutorial.md` | Questions about bundle structure, lifecycle, registration |
| Bots | `bots.md` | `bot_tutorial.md` | Bot behavior, prompts, tools, bot-entity interaction |
| Entities | `entities.md` | — | Entity fields, relationships, persistence, querying |
| Prompting | `prompting.md` | `prompting_tutorial.md` | Prompt engineering, context injection, few-shot patterns |

#### Entity Graph (`sdk/agent_sdk/entity_graph/`)

| Topic | File | When to Load |
|-------|------|--------------|
| Overview | `README.md` | Introduction to entity graph concepts |
| Modeling Guide | `entity_modeling_prompt_guide.md` | Designing entity schemas, relationship patterns |
| Modeling Tutorial | `entity_modeling_tutorial.md` | Step-by-step entity modeling walkthrough |
| Intermediate Example | `intermediate_entity_graph_example.md` | Complex entity graph patterns, real-world examples |

#### Feature Guides (`sdk/agent_sdk/feature_guides/`)

| Topic | File | When to Load |
|-------|------|--------------|
| Overview | `README.md` | What advanced features are available |
| Ad-hoc Tool Calls | `ad_hoc_tool_calls.md` | Dynamic tool invocation, runtime tool creation |
| Parallelism | `advanced_parallelism.md` | Concurrent bot execution, parallel entity processing |
| Document Processing | `doc-proc-client.md` | Processing documents, PDFs, file content |
| File Uploads | `file-upload-patterns.md` | Binary file handling, upload workflows |
| Graph Traversal | `graph_traversal.md` | Querying entity relationships, navigation patterns |
| Vector Similarity | `vector-similarity-quickstart.md` | Embeddings, semantic search, vector storage |
| Waitables | `waitable_guide.md` | Async operations, background jobs, progress tracking |
| Workflow Orchestration | `workflow_orchestration_guide.md` | Multi-step workflows, state machines, error recovery |

---

## Loading Strategy

### For New Users / Bootstrapping
1. Fetch `agent_sdk_getting_started.md`
2. Fetch relevant tutorial (e.g., `agent_bundle_tutorial.md`)
3. Provide code examples with explanations

### For Existing Codebases / Specific Questions
1. Fetch the relevant reference doc (e.g., `bots.md`)
2. Only fetch tutorial if user needs a walkthrough
3. Focus on API details and patterns

### Decision Flow

```
User Question
     │
     ├─► "What is..." / "Explain..." → Reference doc
     │
     ├─► "How do I..." / "Show me..." → Tutorial first, then reference
     │
     ├─► "Why isn't... working" → Reference doc + check ff-cli for deployment issues
     │
     ├─► "Deploy" / "Build" / "CLI" → Redirect to ff-cli skill
     │
     └─► Terminology confusion → Glossary
```

### Fetching Example

When user asks about workflows:

```
1. WebFetch: https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/sdk/agent_sdk/feature_guides/workflow_orchestration_guide.md

2. If they need async patterns, also fetch:
   WebFetch: https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/sdk/agent_sdk/feature_guides/waitable_guide.md
```

---

## Common Patterns Quick Reference

### Creating Entities with EntityFactory

```typescript
// In your agent bundle or API endpoint:
const factory = this.getEntityFactory();

// Create a new entity
const entity = await factory.create(MyEntity, {
  name: "my-entity-name",
  data: { key: "value" },
});

// Start a runnable entity (async generator execution)
await entity.start();

// Create child entities within run_impl (orchestration)
async *run_impl() {
  const child = await this.appendCall(ChildEntity, "child-name", { input: data });
  yield* await child.start();
}
```

### Entity Graph Relationships

```typescript
// appendCall creates a child entity with a "Calls" edge
const child = await this.appendCall(ChildEntity, "step-1", inputData);

// appendOrRetrieveCall is idempotent — returns existing if name matches
const child = await this.appendOrRetrieveCall(ChildEntity, "step-1", inputData);

// Parallel child entities with HierarchicalTaskPoolRunner
const children = await this.parallelCalls([
  { entityClass: ImageEntity, name: "image-1", input: prompt1 },
  { entityClass: ImageEntity, name: "image-2", input: prompt2 },
]);
```

### Running Bots from Entities

```typescript
// In a BotRunnableEntityMixin entity's run_impl:
async *run_impl() {
  const request = new BotRequest({
    id: this.id,
    input: this.getEntityData(),
    args: {},
    context: new Context(),
  });

  // Delegate to the registered bot
  yield* await this.runBot("MyBotName", request);
}
```

### Structured Output with Zod

```typescript
import { z } from "zod";
import { withSchemaMetadata } from "@firebrandanalytics/ff-agent-sdk";

// Always wrap schemas with withSchemaMetadata for LLM compatibility
const AnalysisSchema = withSchemaMetadata(
  z.object({
    summary: z.string().describe("One-sentence summary"),
    confidence: z.number().min(0).max(1).describe("Confidence level"),
    categories: z.array(z.string()).describe("Relevant categories"),
  })
);
```

### Constructors Registration Pattern

```typescript
// constructors.ts — register all entity and bot classes
export const constructors = {
  entities: {
    MyEntity: MyEntity,
    ChildEntity: ChildEntity,
  },
  bots: {
    MyBot: MyBot,
  },
};
```

### Consumer SDK (for Web UIs)

```typescript
// In Next.js API routes — server-side only
import { RemoteAgentBundleClient } from "@firebrandanalytics/ff-sdk";

const client = new RemoteAgentBundleClient(process.env.BUNDLE_URL!);

// call_api_endpoint takes route WITHOUT /api/ prefix
const result = await client.call_api_endpoint("search", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});
```

---

## Troubleshooting

### TypeScript errors on AddMixins/ComposeMixins class extends
- **Most common cause**: shared-utils version below 4.2.0. Upgrade to 4.2.0+.
- Check `pnpm list @firebrandanalytics/shared-utils` to verify version
- The generic type parameter must match the composed class tuple exactly

### `this.id === undefined` in entity
- Check `super()` call uses **flat tuples**: `super([factory, idOrDto] as any, ["BotName"])`
- Nested arrays `super([[factory, idOrDto], []], ...)` silently break ID propagation
- This is a known SDK issue (ff-agent-sdk#56)

### `get_semantic_label_impl is not a function`
- All bot subclasses must implement `get_semantic_label_impl()` returning the bot name
- This method is undocumented in some SDK versions but required at runtime

### Entity not found / not registered
- Check entity class is exported from `constructors.ts`
- Verify the constructor name matches what's referenced in `runBot()` calls
- Ensure entity class is imported (not just type-imported)

### Bot structured output not parsing
- Wrap Zod schemas with `withSchemaMetadata()` before passing to ComposeMixins
- Use `.describe()` on each field — the LLM needs field descriptions
- Check broker model group is configured and routing to a capable model

### For deployment/runtime issues
Use the `ff-cli` skill and check:
- `ff-cli ops doctor` for prerequisites
- Pod logs via `ff-cli logs <name>` or `kubectl logs`
- Environment configuration in `helm/values.local.yaml`

---

## Additional Resources

When documentation isn't enough:

1. **Examples**: Ask about `ff-cli examples list` to see working agent bundles
2. **Project Structure**: Use `ff-cli` skill for scaffolding questions
3. **Deployment**: Use `ff-cli` skill for build/deploy workflows
