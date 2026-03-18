# Component Architecture

This guide explains how the major components of a FireFoundry agent bundle — entities, bots, prompts, and the bundle itself — fit together. It covers the component hierarchy, registration, lifecycle, and communication patterns.

For detailed API reference on each component, see the [Core Reference Docs](../core/README.md).

---

## Table of Contents

- [Component Hierarchy](#component-hierarchy)
- [Agent Bundle: The Container](#agent-bundle-the-container)
- [Entities: State and Behavior](#entities-state-and-behavior)
- [Bots: AI Execution](#bots-ai-execution)
- [Prompts: LLM Instructions](#prompts-llm-instructions)
- [Component Registration](#component-registration)
- [Lifecycle and Initialization](#lifecycle-and-initialization)
- [Inter-Component Communication](#inter-component-communication)
- [Platform Service Integration](#platform-service-integration)
- [Composition Patterns](#composition-patterns)
- [Directory Conventions](#directory-conventions)

---

## Component Hierarchy

Every FireFoundry application follows this component hierarchy:

```
Agent Bundle (deployment unit, Kubernetes pod)
 ├── Entities (business objects with state and behavior)
 │    ├── Properties and data (persisted in Entity Graph)
 │    ├── Relationships / edges to other entities
 │    └── run_impl() — executable logic (RunnableEntity)
 ├── Bots (AI execution engines)
 │    ├── PromptGroup (what to say to the LLM)
 │    ├── Dispatch Table (tool calls the LLM can make)
 │    └── Mixins (StructuredOutput, DataValidation, Feedback, etc.)
 ├── Prompts (LLM instructions)
 │    ├── Template nodes (text, lists, code, schemas, structured data)
 │    └── Working memory references (files, artifacts)
 └── API Endpoints (HTTP surface for external callers)
```

The key relationships:

| Component | Owns | Communicates With |
|-----------|------|-------------------|
| **Bundle** | Entities, Bots, Endpoints | Platform services (Broker, Context, Entity Graph) |
| **Entity** | Data, Edges | Other entities, Bots (via mixins), Platform clients |
| **Bot** | PromptGroup, Dispatch Table | Broker (LLM calls), Entity (results) |
| **Prompt** | Template nodes | Working Memory (file access) |

---

## Agent Bundle: The Container

The `FFAgentBundle` class is the top-level container. It:

- Connects to platform services (Broker, Context Service, Entity Graph)
- Registers entity types in the constructor registry
- Exposes HTTP endpoints via `@ApiEndpoint`
- Manages the application lifecycle

```typescript
import { FFAgentBundle, ApiEndpoint } from '@firebrandanalytics/ff-agent-sdk';
import { constructors } from './constructors';

class MyBundle extends FFAgentBundle {
  constructor() {
    super({
      name: 'my-bundle',
      constructors,  // Entity type registry
    });
  }

  async init() {
    // Application initialization — runs after platform connections are established
    // Register event handlers, set up background tasks, etc.
  }

  @ApiEndpoint({ method: 'POST', path: '/analyze' })
  async analyze(req: Request) {
    // Create an entity and run it
    const entity = await this.entityFactory.create('AnalysisEntity', {
      input: req.body
    });
    return entity.run();
  }
}
```

### What the Bundle Provides

Every component in the bundle can access platform services through the bundle's connections:

| Service | Access Method | Purpose |
|---------|--------------|---------|
| Entity Graph | `entityFactory`, `entityClient` | Create, query, update entities |
| Broker | `brokerClientPool` | Send LLM requests |
| Context Service | `contextClient` | Agent bundle configuration and metadata |
| Working Memory | `workingMemoryClient` | File/blob storage |
| Telemetry | `telemetryClient` | Logging and request tracing |

---

## Entities: State and Behavior

Entities are the core abstraction. They represent business objects with:

- **Typed data** persisted in the Entity Graph
- **Relationships** (edges) to other entities
- **Executable behavior** (in `RunnableEntity` subclasses)

### Entity Type Hierarchy

```
DTOWrapper
 └── EntityNode (base — has data, edges, CRUD)
      ├── RunnableEntity (adds run_impl() execution)
      │    └── WaitableRunnableEntity (adds pause/resume)
      ├── EntityTreeNode (hierarchical parent-child)
      ├── SchedulerNode (job scheduling)
      └── EntityUser (user representation)
```

### The Entity Registration Pattern

Every entity type must be registered so the framework can instantiate it by name:

```typescript
import { EntityMixin } from '@firebrandanalytics/ff-agent-sdk';

@EntityMixin('AnalysisEntity', 'AnalysisEntity', {
  contains: ['ReportEntity'],       // Allowed child entity types
  calls: ['SummaryBot'],            // Allowed bot connections
})
class AnalysisEntity extends RunnableEntity<AnalysisRETH> {
  protected async *run_impl() {
    // Entity logic...
  }
}
```

The `@EntityMixin` decorator registers:
- **specificType / generalType** — How this entity is identified in the graph
- **allowedConnections** — Which edge types and target entities are permitted

### Entity Data and Type Helpers

Entity data is strongly typed through **RETH** (Runtime Entity Type Helper) interfaces:

```typescript
// Define the entity's data shape
interface AnalysisData {
  input_text: string;
  summary?: string;
  confidence?: number;
}

// Create the RETH (binds data type to entity)
type AnalysisRETH = {
  data: AnalysisData;
  specific_type: 'AnalysisEntity';
};

class AnalysisEntity extends RunnableEntity<AnalysisRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const data: AnalysisData = dto.data;  // Fully typed
    // ...
  }
}
```

---

## Bots: AI Execution

Bots encapsulate LLM interactions. They handle prompt rendering, broker communication, tool calls, retries, and response parsing.

### Bot Architecture

```
Bot
 ├── PromptGroup (defines what to send to the LLM)
 ├── BrokerClientPool (manages LLM communication)
 ├── Dispatch Table (tool call handlers)
 └── Mixins:
      ├── StructuredOutputBotMixin (JSON/schema output)
      ├── DataValidationBotMixin (validation library integration)
      ├── FeedbackBotMixin (human review loops)
      └── WorkingMemoryBotMixin (file context)
```

### Bot Registration

Bots are registered in the global bot registry via `@RegisterBot`:

```typescript
import { RegisterBot, ComposeMixins, MixinBot, StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk';

@RegisterBot
class SummaryBot extends ComposeMixins(MixinBot, StructuredOutputBotMixin) {
  constructor() {
    super(
      [{ name: 'SummaryBot', base_prompt_group: summaryPrompts, model_pool_name: 'default' }],
      [{ schema: SummarySchema, struct_data_language: 'json' }]
    );
  }
}
```

### The Entity–Bot Relationship

Entities run bots through the `BotRunnableEntityMixin`:

```typescript
class AnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<AnalysisRETH>, BotRunnableEntityMixin<AnalysisRETH>]> {

  protected async *run_impl() {
    // run_bot() sends entity data to the bot, streams results back
    const result = yield* this.run_bot();
    return result;
  }
}
```

The three-phase pattern for bot integration:

1. **Pre-processing** — Entity prepares data, context, and working memory
2. **Bot execution** — Bot renders prompts, calls LLM, handles tool calls
3. **Post-processing** — Entity validates output, updates state, creates child entities

---

## Prompts: LLM Instructions

Prompts define what gets sent to the LLM. The framework uses a hierarchical node structure for building prompts programmatically.

### Prompt Components

| Component | Purpose |
|-----------|---------|
| `Prompt` | Base class — renders nodes into LLM messages |
| `PromptGroup` | Collection of related prompts |
| `StructuredPromptGroup` | Organized into phases (base, input, extensions) for mixin composition |
| `PromptTemplateTextNode` | Plain text content |
| `PromptTemplateListNode` | Enumerated/bulleted lists |
| `PromptTemplateCodeBoxNode` | Code blocks with syntax highlighting |
| `PromptTemplateStructDataNode` | JSON, YAML, CSV structured data |
| `PromptTemplateSchemaNode` | Schema definitions in natural language |

### Prompt Registration

Prompts are passed to bots via `PromptGroup`:

```typescript
import { Prompt, PromptGroup, PromptTemplateTextNode, PromptTemplateSectionNode } from '@firebrandanalytics/ff-agent-sdk';

class SummaryPrompt extends Prompt {
  constructor() {
    super({
      name: 'summary',
      nodes: [
        new PromptTemplateSectionNode({
          title: 'Task',
          children: [
            new PromptTemplateTextNode('Analyze the following text and produce a structured summary.')
          ]
        }),
        new PromptTemplateSectionNode({
          title: 'Input',
          children: [
            new PromptTemplateTextNode('{{input_text}}')
          ]
        })
      ]
    });
  }
}

const summaryPrompts = new PromptGroup([
  { name: 'summary', prompt: new SummaryPrompt() }
]);
```

### Dynamic Prompts

Prompts can access entity data, working memory, and runtime context:

```typescript
class DynamicPrompt extends Prompt {
  preprocess(request: BotTryRequest) {
    // Access entity data, working memory files, etc.
    const entityData = request.input;
    const files = request.args?.files || [];

    this.setVariable('input_text', entityData.text);
    this.setVariable('file_count', files.length);
  }
}
```

---

## Component Registration

### The Constructor Registry

Entity types are collected in a `constructors` map, passed to the bundle:

```typescript
// constructors.ts
import { AnalysisEntity } from './entities/AnalysisEntity';
import { ReportEntity } from './entities/ReportEntity';

export const constructors = {
  AnalysisEntity,
  ReportEntity,
};
```

The registry enables:
- **Dynamic instantiation** — `entityFactory.create('AnalysisEntity', data)` looks up the class by name
- **Type validation** — Only registered types can be created
- **Edge validation** — `allowedConnections` is checked against registered types

### Bot Registration is Global

Unlike entities (which are per-bundle), bots registered with `@RegisterBot` go into a global registry. Any entity in the bundle can reference any registered bot.

### Prompt Registration is via Bots

Prompts don't have their own registry — they're passed to bots via `PromptGroup` in the bot constructor.

---

## Lifecycle and Initialization

### Startup Sequence

```
1. Container starts
   ↓
2. Platform connections established (gRPC to Broker, Context Service, Entity Graph)
   ↓
3. Bundle constructor runs
   • Constructor registry loaded
   • @RegisterBot decorators execute → bots registered globally
   ↓
4. Bundle.init() runs
   • Application-specific initialization
   • Background task setup
   • Event handler registration
   ↓
5. HTTP/gRPC server starts
   • @ApiEndpoint routes registered
   • Health/ready endpoints active
   ↓
6. Ready to accept requests
```

### Entity Lifecycle

```
1. Entity created (via factory or API)
   • Data stored in Entity Graph
   • Entity node has status: 'created'
   ↓
2. Entity.run() called (for RunnableEntity)
   • Status changes to 'running'
   • run_impl() executes (may yield for streaming)
   ↓
3. Bot execution (if using BotRunnableEntityMixin)
   • Pre-processing: entity prepares context
   • Bot calls LLM via Broker
   • Tool calls dispatched and handled
   • Post-processing: entity processes results
   ↓
4. Entity completes
   • Status changes to 'complete' or 'error'
   • Results stored in Entity Graph
```

### Waitable Entity Lifecycle

Waitable entities add pause/resume capability:

```
run_impl() starts → yield wait_for_input() → entity pauses (status: 'waiting')
                                                     ↓
                          external input arrives → entity resumes → continues run_impl()
```

---

## Inter-Component Communication

### Entity → Bot (via BotRunnableEntityMixin)

```typescript
// Entity runs its configured bot
const result = yield* this.run_bot();

// Or run a specific bot by name
const result = yield* this.run_bot({ botName: 'SpecificBot' });
```

### Entity → Entity (via Entity Factory)

```typescript
// Create a child entity
const child = await this.create_child('ReportEntity', {
  parent_data: this.dto.data,
  analysis_id: this.id
});

// Run the child
const childResult = await child.run();
```

### Entity → Platform Services

```typescript
// Direct broker call (bypass bot framework)
const llmResponse = await this.brokerClient.complete({
  model_pool_name: 'gpt-4o',
  messages: [{ role: 'user', content: 'Quick question...' }]
});

// Working memory
const blob = await this.workingMemoryClient.getBlob(blobId);

// Entity graph queries
const related = await this.entityClient.getRelated(this.id, 'contains');
```

### Bundle → External (via @ApiEndpoint)

```typescript
@ApiEndpoint({ method: 'POST', path: '/process' })
async processRequest(req: Request) {
  const entity = await this.entityFactory.create('ProcessEntity', req.body);
  return entity.run();
}

@ApiEndpoint({ method: 'GET', path: '/status/:id' })
async getStatus(req: Request) {
  const entity = await this.entityFactory.get(req.params.id);
  return entity.get_dto();
}
```

---

## Platform Service Integration

Agent bundle components interact with platform services through gRPC clients:

```
┌─────────────────────────────────────────────────────┐
│                  Agent Bundle                        │
│                                                      │
│  Entity ──→ Bot ──→ Broker Service (LLM routing)    │
│    │                                                 │
│    ├──→ Entity Graph Service (state persistence)     │
│    ├──→ Context Service (configuration, metadata)    │
│    ├──→ Working Memory (file/blob storage)           │
│    ├──→ Data Access Service (database queries)       │
│    ├──→ Document Processor (PDF, OCR, generation)    │
│    ├──→ Code Sandbox (secure code execution)         │
│    └──→ Web Search Service (internet search)         │
└─────────────────────────────────────────────────────┘
```

Each service has a typed client library in `@firebrandanalytics/ff-core-types`:

| Service | Client Package | Used For |
|---------|---------------|----------|
| Broker | `@firebrandanalytics/ff_broker_client` | LLM completions |
| Entity Graph | `@firebrandanalytics/entity-client` | Entity CRUD, relationships, search |
| Context Service | `@firebrandanalytics/cs-client` | Bundle config, metadata |
| Working Memory | Via entity client | Blob/record storage |
| Data Access | `@firefoundry/data-access-client` | SQL queries |
| Doc Processor | `@firebrandanalytics/doc-proc-client` | Document operations |
| Code Sandbox | `@firebrandanalytics/code-sandbox-client` | Secure code execution |
| Web Search | `@firebrandanalytics/web-search-client` | Internet search |

---

## Composition Patterns

### Mixin Composition

The SDK uses mixin-based composition for entities and bots:

```typescript
// Entities: AddMixins combines a base class with mixins
class MyEntity extends AddMixins(
  RunnableEntity,          // Base: executable entity
  BotRunnableEntityMixin,  // Mixin: bot integration
  WaitableRunnableEntityMixin  // Mixin: pause/resume
)<[
  RunnableEntity<MyRETH>,
  BotRunnableEntityMixin<MyRETH>,
  WaitableRunnableEntityMixin<MyRETH>
]> { /* ... */ }

// Bots: ComposeMixins combines MixinBot with feature mixins
class MyBot extends ComposeMixins(
  MixinBot,                    // Base: bot framework
  StructuredOutputBotMixin,    // Mixin: JSON output
  DataValidationBotMixin       // Mixin: validation library
) { /* ... */ }
```

### The Entity Dispatcher Pattern

Route work to different entity types based on input:

```typescript
@EntityDispatcherDecorator({
  dispatchField: 'document_type',
  dispatchMap: {
    'invoice': 'InvoiceEntity',
    'receipt': 'ReceiptEntity',
    'contract': 'ContractEntity',
  }
})
class DocumentDispatcher extends RunnableEntity<DispatchRETH> {
  // Automatically creates and runs the appropriate sub-entity
}
```

See [Entity Dispatcher Pattern](../feature_guides/entity-dispatcher-pattern.md) for details.

---

## Directory Conventions

The recommended project structure:

```
my-agent-bundle/
├── src/
│   ├── index.ts              # Entry point: starts the bundle
│   ├── agent-bundle.ts       # Bundle class with @ApiEndpoint methods
│   ├── constructors.ts       # Entity type registry
│   ├── entities/             # One file per entity type
│   │   ├── AnalysisEntity.ts
│   │   ├── ReportEntity.ts
│   │   └── types.ts          # RETH types, data interfaces
│   ├── bots/                 # One file per bot
│   │   ├── SummaryBot.ts
│   │   └── ClassifierBot.ts
│   └── prompts/              # One file per prompt or prompt group
│       ├── SummaryPrompt.ts
│       └── ClassifierPrompt.ts
├── package.json
├── tsconfig.json
├── Dockerfile
└── firefoundry.json          # Bundle metadata (name, version, capabilities)
```

**Conventions:**
- Entity files are named after the entity class: `AnalysisEntity.ts`
- Bot files are named after the bot class: `SummaryBot.ts`
- RETH types and shared interfaces go in a `types.ts` file
- Prompt classes typically live alongside their bot, or in a separate `prompts/` directory for complex bundles
- The `constructors.ts` file imports all entity classes and exports the registry map

---

## See Also

- [Agent Bundles Reference](../core/agent_bundles.md) — Full bundle API reference
- [Entity Modeling Guide](../core/entities.md) — Complete entity development guide
- [Bot Guide](../core/bots.md) — Comprehensive bot development guide
- [Prompting Framework](../core/prompting.md) — Prompt system in depth
- [Core Decorators Reference](./core-decorators-reference.md) — All SDK decorators
- [Entity Lifecycle & Patterns](./entity-lifecycle-patterns.md) — Mixin composition and lifecycle hooks
- [SDK Quick-Start](./sdk-quickstart.md) — Build your first agent bundle
