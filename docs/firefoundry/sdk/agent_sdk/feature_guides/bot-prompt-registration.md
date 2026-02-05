# Bot and Prompt Registration: Complete Guide

*Register bots and prompts for metadata tracking, request validation, HTTP API exposure, and database population.*

## Introduction

The FireFoundry SDK provides two complementary registration mechanisms for bots:

1. **Decorator-based metadata registration** (`@RegisterBot`) - Attaches metadata and validation schemas to bot classes
2. **Instance-based API registration** (`FFAgentBundle.registerBot()`) - Exposes bot instances via HTTP endpoints

These mechanisms work together to enable:

- **Request Validation**: Validate bot requests against Zod schemas at runtime
- **HTTP API Exposure**: Invoke registered bots via REST endpoints
- **Metadata Tracking**: Query registered bots by name and access their configuration
- **Database Population**: Auto-populate component records on bundle initialization
- **Type Safety**: Full TypeScript support with compile-time checking

---

## Core Concepts

### Two-Step Registration

Bots in FireFoundry require two registration steps for full functionality:

```
1. @RegisterBot Decorator (Class-level)
   → Registers metadata and validation schema
   → Stored in global metadata registry
   → Optional - for validation and metadata only

2. FFAgentBundle.registerBot() (Instance-level)
   → Registers a bot instance for HTTP invocation
   → Required to expose bot via /bot/:name/* endpoints
   → Bot must be instantiated first
```

### Registration System Layers

1. **Decorator Layer** (`@RegisterBot`, `@RegisterPrompt`)
   - Applies metadata to class definitions
   - Stores validation schemas in global registry

2. **Instance Registry** (`FFAgentBundle.registerBot`)
   - Registers bot instances by name
   - Required for HTTP API exposure

3. **Query Layer** (`getRegisteredBotClasses`, `getRegisteredPromptClasses`)
   - Access registered metadata
   - Query bots by name

4. **Component Provider Layer** (`ComponentProvider`)
   - PostgreSQL persistence
   - Database lifecycle management

---

## Bot Registration

### Basic Bot Registration

Register a bot class with the `@RegisterBot` decorator:

```typescript
import { RegisterBot, FFAgentBundle } from '@firebrandanalytics/ff-agent-sdk/app';
import { Bot } from '@firebrandanalytics/ff-agent-sdk/bot';
import { PromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Step 1: Apply decorator for metadata registration
@RegisterBot('SummaryBot')
export class SummaryBot extends Bot<SummaryBTH> {
  constructor() {
    super({
      name: 'SummaryBot',
      base_prompt_group: this.getPromptGroup(),
      model_pool_name: 'azure_completion_4o'
    });
  }

  private getPromptGroup(): PromptGroup<SummaryPTH> {
    return new PromptGroup([
      // Define prompts
    ]);
  }

  override get_semantic_label_impl(request: BotTryRequest<SummaryBTH>): string {
    return 'SummaryBotSemanticLabel';
  }
}

// Step 2: Register instance for HTTP API exposure
// (typically done during bundle initialization)
const summaryBot = new SummaryBot();
FFAgentBundle.registerBot('SummaryBot', summaryBot);
```

### Decorator Signature

```typescript
@RegisterBot(name: string, config?: RegisterBotConfig)

interface RegisterBotConfig {
  requestSchema?: z.ZodType<any>;  // Optional Zod schema for request validation
}
```

### Registration with Schema Validation

Validate bot requests against a Zod schema at runtime:

```typescript
import { z } from 'zod';
import { RegisterBot, FFAgentBundle } from '@firebrandanalytics/ff-agent-sdk/app';
import { Bot } from '@firebrandanalytics/ff-agent-sdk/bot';

// Define a Zod schema for request validation
const SummaryRequestSchema = z.object({
  args: z.object({
    length: z.enum(['short', 'medium', 'long']),
    style: z.enum(['bullet-points', 'paragraph', 'outline']).optional()
  }),
  input: z.object({
    text: z.string().min(50)
  })
});

// Apply decorator with validation schema
@RegisterBot('SummaryBot', {
  requestSchema: SummaryRequestSchema
})
export class SummaryBot extends Bot<SummaryBTH> {
  // Implementation
}

// Register instance for HTTP API
const summaryBot = new SummaryBot();
FFAgentBundle.registerBot('SummaryBot', summaryBot);
```

When a bot has a registered `requestSchema`, requests to `/bot/:name/run` or `/bot/:name/start` are automatically validated. Invalid requests return a 400 error with validation details.

---

## HTTP API Endpoints for Bots

Registered bot instances are exposed via HTTP endpoints automatically.

### Run Endpoint (Final Result)

```
POST /bot/:bot_name/run
Content-Type: application/json

{
  "id": "optional-request-id",
  "args": { ... },
  "input": { ... },
  "model_selection_criteria": { ... },  // Optional
  "max_tries": 3,                        // Optional
  "semantic_label": "MyLabel",           // Optional
  "additional_messages": [],             // Optional
  "context": { ... }                     // Optional
}
```

**Response:**
```json
{
  "success": true,
  "result": { ... }
}
```

### Start Endpoint (Streaming/Iterator)

```
POST /bot/:bot_name/start
Content-Type: application/json

{
  "id": "optional-request-id",
  "args": { ... },
  "input": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "iterator_id": "uuid-for-streaming"
}
```

Use the `iterator_id` with `/iterator/:id/next` to consume streamed results.

### Error Responses

| Status | Condition |
|--------|-----------|
| 400 | Missing parameters or validation failed |
| 404 | Bot not found in registry |
| 500 | Internal error during execution |

### Client Usage

```typescript
// Using fetch
const response = await fetch('/bot/SummaryBot/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    args: { length: 'short' },
    input: { text: 'Your text to summarize...' }
  })
});

const { success, result } = await response.json();
```

---

## Querying Registered Bots

### Query Metadata Registry

```typescript
import { getRegisteredBotClasses } from '@firebrandanalytics/ff-agent-sdk/app';

// Get all registered bot metadata
const allBots = getRegisteredBotClasses();

// Each entry has: { name, constructor, config }
for (const botMeta of allBots) {
  console.log({
    name: botMeta.name,
    hasValidationSchema: !!botMeta.config?.requestSchema
  });
}

// Find by name
const summaryBotMeta = allBots.find((b) => b.name === 'SummaryBot');
```

### Query Instance Registry

```typescript
import { FFAgentBundle } from '@firebrandanalytics/ff-agent-sdk/app';

// Get registered bot names
const botNames = FFAgentBundle.getRegisteredBotNames();
// ['SummaryBot', 'AnalysisBot', ...]

// Get a specific bot instance
const summaryBot = FFAgentBundle.getBot('SummaryBot');

// Check if a bot is registered
if (FFAgentBundle.getBot('MyBot')) {
  console.log('MyBot is available for invocation');
}
```

---

## Prompt Registration

### Basic Prompt Registration

Register a prompt class with the `@RegisterPrompt` decorator:

```typescript
import { RegisterPrompt } from '@firebrandanalytics/ff-agent-sdk/app';
import { Prompt, PromptTemplateSectionNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

@RegisterPrompt('SummaryPrompt')
export class SummaryPrompt extends Prompt<SummaryPTH> {
  constructor(args: { length: 'short' | 'medium' | 'long' }) {
    super('system', args);
    this.add_section(this.getInstructions(args.length));
    this.add_section(this.getFormatting());
  }

  private getInstructions(length: string): PromptTemplateSectionNode<SummaryPTH> {
    const lengthGuide = {
      short: '2-3 sentences',
      medium: '1 paragraph',
      long: '2-3 paragraphs'
    };

    return new PromptTemplateSectionNode({
      semantic_type: 'instruction',
      content: `Summarize the provided text in ${lengthGuide[length]}`,
      children: [
        'Focus on key points and main ideas',
        'Preserve important numerical data',
        'Maintain neutral tone'
      ]
    });
  }

  private getFormatting(): PromptTemplateSectionNode<SummaryPTH> {
    return new PromptTemplateSectionNode({
      semantic_type: 'formatting',
      content: 'Format requirements:',
      children: ['Start with a summary header', 'Use clear, concise language']
    });
  }
}
```

### Decorator Signature

```typescript
@RegisterPrompt(name: string, config?: RegisterPromptConfig)

interface RegisterPromptConfig {
  subComponentName?: string;  // Links to a sub-component for data-driven behavior
  subComponentId?: string;    // Alternative: direct ID reference to sub-component
}
```

### Prompt Registration with Sub-Component Link

Link a prompt to a database sub-component:

```typescript
@RegisterPrompt('TechnicalAnalysisPrompt', {
  subComponentName: 'technical-analysis-module'
})
export class TechnicalAnalysisPrompt extends Prompt<AnalysisPTH> {
  // This prompt is linked to the 'technical-analysis-module' sub-component
}

// Or use direct ID reference
@RegisterPrompt('BusinessAnalysisPrompt', {
  subComponentId: 'uuid-of-subcomponent'
})
export class BusinessAnalysisPrompt extends Prompt<AnalysisPTH> {
  // This prompt is linked by sub-component ID
}
```

### Querying Registered Prompts

```typescript
import { getRegisteredPromptClasses } from '@firebrandanalytics/ff-agent-sdk/app';

// Get all registered prompts
const allPrompts = getRegisteredPromptClasses();

// Each entry has: { name, constructor, config }
for (const promptMeta of allPrompts) {
  console.log({
    name: promptMeta.name,
    subComponentName: promptMeta.config?.subComponentName,
    subComponentId: promptMeta.config?.subComponentId
  });
}

// Find by name
const summaryPromptMeta = allPrompts.find((p) => p.name === 'SummaryPrompt');
```

---

## Database Population

### Automatic Component Registration

When an agent bundle starts, it auto-populates components:

```typescript
import { FFAgentBundle } from '@firebrandanalytics/ff-agent-sdk/app';

export const bundle = new FFAgentBundle({
  app_id: 'my-app',
  autoPopulateComponents: true  // Auto-register on startup
});

// On initialization:
// 1. Scans for @RegisterBot and @RegisterPrompt decorators
// 2. Creates component records in PostgreSQL
// 3. Links sub-components based on metadata
// 4. Stores metadata from registries
```

### Component Hierarchy in Database

The component system uses PostgreSQL with the following schema:

```sql
-- Applications (top-level deployment units)
components.applications (
  id UUID PRIMARY KEY,
  name VARCHAR,
  description TEXT
)

-- Components (Agent Bundles as main component type)
components.components (
  id UUID PRIMARY KEY,
  application_id UUID REFERENCES applications(id),
  name VARCHAR,
  description TEXT,
  type VARCHAR,  -- 'agent_bundle'
  active BOOLEAN
)

-- Sub-components (bots, prompts, entities within a bundle)
components.sub_components (
  id UUID PRIMARY KEY,
  component_id UUID REFERENCES components(id),
  name VARCHAR,
  type sub_component_type,  -- 'entity' | 'bot' | 'prompt' | 'gui' | 'api'
  description TEXT,
  configuration JSONB,
  metadata JSONB,
  active BOOLEAN,
  created TIMESTAMP,
  modified TIMESTAMP,
  UNIQUE (component_id, name)
)

-- Assets (data/knowledge attached to sub-components)
components.assets (
  id UUID PRIMARY KEY,
  sub_component_id UUID REFERENCES sub_components(id),
  name VARCHAR,
  type VARCHAR,  -- e.g., 'additional_messages', 'knowledge_base'
  data JSONB,    -- Structured data storage
  blob_id UUID,  -- Reference to blob storage (optional)
  active BOOLEAN,
  created TIMESTAMP,
  modified TIMESTAMP
)
```

### ComponentProvider API

The `ComponentProvider` manages the component hierarchy:

```typescript
import { ComponentProvider, component_provider } from '@firebrandanalytics/ff-agent-sdk/app';

// Use the singleton instance (connects via environment variables)
const provider = component_provider;

// Or create with explicit pools
const customProvider = new ComponentProvider(readPool, writePool);
```

**Available Methods:**

```typescript
interface IComponentProvider {
  // Agent Bundle (Component) management
  get_agent_bundle_by_name(name: string): Promise<AgentBundleDTO | undefined>;
  get_agent_bundle_by_id(id: string): Promise<AgentBundleDTO | undefined>;
  create_agent_bundle(dto: AgentBundleDTO): Promise<AgentBundleDTO>;
  update_agent_bundle(dto: AgentBundleDTO): Promise<AgentBundleDTO>;
  get_all_agent_bundles(): Promise<AgentBundleDTO[]>;

  // Sub-component registration (bulk upsert)
  register_sub_components(
    component_id: string,
    sub_components: SubComponentRegistration[]
  ): Promise<void>;

  // Asset retrieval
  get_assets_by_sub_component_id(
    sub_component_id: string,
    asset_type?: string
  ): Promise<Asset[]>;

  get_assets_by_sub_component_name(
    component_id: string,
    sub_component_name: string,
    asset_type?: string
  ): Promise<Asset[]>;
}
```

### Automatic Sub-Component Registration

During bundle initialization, sub-components are automatically registered:

```typescript
// FFAgentBundle.bootstrap_sub_components() collects from:
// 1. FFAgentBundle.botRegistry (instance registry)
// 2. FFAgentBundle.promptRegistry (instance registry)
// 3. @RegisterBot decorated classes (metadata registry)
// 4. @RegisterPrompt decorated classes (metadata registry)
// 5. Entity constructors (FFAgentBundle.constructors)

// All are registered as sub-components with appropriate types
await provider.register_sub_components(bundleId, [
  { name: 'SummaryBot', type: 'bot', description: 'Bot: SummaryBot' },
  { name: 'AnalysisPrompt', type: 'prompt', description: 'Prompt Group: AnalysisPrompt' },
  { name: 'Document', type: 'entity', description: 'Entity: Document', metadata: {...} }
]);
```

---

## Working with Assets

Assets store data and knowledge that can be retrieved at runtime for data-driven behavior.

### Asset Type Definition

```typescript
type Asset = {
  id: string;
  sub_component_id: string;
  name: string;
  type: string;                    // e.g., 'additional_messages', 'knowledge_base', 'template'
  data?: Record<string, any>;      // JSONB - structured data
  blob_id?: string;                // Reference to blob storage (optional)
  active: boolean;
  created: Date;
  modified: Date;
}
```

### Retrieving Assets

```typescript
import { component_provider } from '@firebrandanalytics/ff-agent-sdk/app';

// Get assets by sub-component ID
const assets = await component_provider.get_assets_by_sub_component_id(
  'sub-component-uuid',
  'additional_messages'  // Optional: filter by asset type
);

// Get assets by sub-component name (requires component_id)
const assets = await component_provider.get_assets_by_sub_component_name(
  'bundle-component-id',
  'SummaryBot',
  'knowledge_base'  // Optional: filter by asset type
);
```

### Using Assets in Bots

```typescript
import { component_provider } from '@firebrandanalytics/ff-agent-sdk/app';
import { Bot, BotRequest } from '@firebrandanalytics/ff-agent-sdk/bot';

class AssetAwareBot extends Bot<MyBTH> {
  private bundleId: string;

  constructor(bundleId: string) {
    super({ name: 'AssetAwareBot', /* ... */ });
    this.bundleId = bundleId;
  }

  async getAdditionalMessages(): Promise<any[]> {
    // Retrieve 'additional_messages' assets for this bot
    const assets = await component_provider.get_assets_by_sub_component_name(
      this.bundleId,
      'AssetAwareBot',
      'additional_messages'
    );

    // Extract message data from assets
    return assets.flatMap(asset => asset.data?.messages ?? []);
  }

  override async run(request: BotRequest<MyBTH>) {
    // Inject additional messages from assets
    const additionalMessages = await this.getAdditionalMessages();

    const enhancedRequest = new BotRequest({
      ...request,
      additional_messages: [
        ...(request.additional_messages ?? []),
        ...additionalMessages
      ]
    });

    return super.run(enhancedRequest);
  }
}
```

### Common Asset Types

| Asset Type | Purpose | Data Structure |
|------------|---------|----------------|
| `additional_messages` | Extra context for LLM prompts | `{ messages: [...] }` |
| `knowledge_base` | Domain knowledge for grounding | `{ entries: [...] }` |
| `template` | Reusable prompt sections | `{ template: "..." }` |
| `configuration` | Runtime behavior settings | `{ key: value, ... }` |
| `examples` | Few-shot examples for LLM | `{ examples: [...] }` |

---

## Runtime Bot Selection

Select bots dynamically based on runtime criteria:

```typescript
import { FFAgentBundle, getRegisteredBotClasses } from '@firebrandanalytics/ff-agent-sdk/app';

// Pattern 1: Select from instance registry by name
function selectBotByName(botName: string) {
  const bot = FFAgentBundle.getBot(botName);
  if (!bot) {
    throw new Error(`Bot ${botName} not found`);
  }
  return bot;
}

// Pattern 2: Select from registered bot names
function selectBotByPrefix(prefix: string) {
  const botNames = FFAgentBundle.getRegisteredBotNames();
  const matchingName = botNames.find(name => name.startsWith(prefix));

  if (!matchingName) {
    throw new Error(`No bot matching prefix: ${prefix}`);
  }

  return FFAgentBundle.getBot(matchingName);
}

// Pattern 3: Use metadata registry for class information
function findBotWithSchema() {
  const registeredBots = getRegisteredBotClasses();

  // Find a bot that has request validation
  const botMeta = registeredBots.find(meta => meta.config?.requestSchema);

  if (botMeta) {
    // Instantiate the bot class
    return new botMeta.constructor();
  }

  return null;
}
```

---

## Integration with Entity System

### Entity with Asset Loading

```typescript
import { EntityNode, EntityDecorator } from '@firebrandanalytics/ff-agent-sdk/entity';
import { component_provider } from '@firebrandanalytics/ff-agent-sdk/app';

@EntityDecorator({
  generalType: 'KnowledgeBase',
  specificType: 'TechnicalGlossary'
})
export class TechnicalGlossary extends EntityNode<TechnicalGlossaryENH> {
  /**
   * Load glossary entries from assets attached to this entity type's sub-component
   */
  async loadGlossaryFromAssets(bundleId: string): Promise<GlossaryEntry[]> {
    const assets = await component_provider.get_assets_by_sub_component_name(
      bundleId,
      'TechnicalGlossary',  // Sub-component name matches entity specific type
      'knowledge_base'
    );

    if (assets.length === 0) {
      return [];
    }

    // Combine entries from all matching assets
    return assets.flatMap(asset => asset.data?.entries ?? []);
  }
}
```

### Bot with Dynamic Entity Selection

```typescript
@RunnableEntityDecorator({
  generalType: 'Analysis',
  specificType: 'ContentAnalyzer'
})
export class ContentAnalyzer extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  BotRunnableEntityMixin
) {
  protected async get_bot_request_args() {
    const dto = await this.get_dto();
    const analysisType = dto.data.analysisType;

    // Select bot based on entity data
    // Use naming convention: analysisType maps to bot name
    const botName = `${analysisType}AnalysisBot`;
    const bot = FFAgentBundle.getBot(botName);

    if (!bot) {
      // Fall back to default bot
      const defaultBot = FFAgentBundle.getBot('DefaultAnalysisBot');
      if (!defaultBot) {
        throw new Error(`No bot found for analysis type: ${analysisType}`);
      }
      this._bot = defaultBot;
    } else {
      this._bot = bot;
    }

    return {
      input: dto.data.content,
      args: { type: analysisType }
    };
  }
}
```

---

## Data-Driven Prompts using Assets

PromptGroup has built-in support for data-driven prompt content via database Assets. This enables:

- **Dynamic prompt content**: Load messages from the database at runtime
- **Non-developer configuration**: Domain experts can modify prompt content without code changes
- **A/B testing**: Swap prompt variations by updating assets
- **Multi-tenant customization**: Different asset sets per customer/use case

### PromptGroup Data-Driven Configuration

```typescript
import { PromptGroup, PromptGroupConfig } from '@firebrandanalytics/ff-agent-sdk/prompts';
import { component_provider } from '@firebrandanalytics/ff-agent-sdk/app';

// Create a data-driven prompt group
const dataDrivenPromptGroup = new PromptGroup<MyPTH>({
  named_prompts: [
    {
      name: 'base',
      prompt: new BasePrompt()
    }
  ],

  // Enable data-driven asset loading
  dataDriven: {
    subComponentId: 'sub-component-uuid',  // UUID of the sub-component
    componentProvider: component_provider,
    cacheStrategy: 'init_once'  // or 'always_refresh'
  }
});
```

### Cache Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `init_once` | Load assets once on first use, cache forever | Production with infrequent asset changes |
| `always_refresh` | Reload assets on every prompt render | Development or when assets change frequently |

### Asset Format for Additional Messages

Assets with type `additional_messages` must have this data structure:

```typescript
// Asset.data structure
{
  section?: string;              // Optional: target a named prompt section
  messages: FF_LLM_Message_Plus[]  // Array of messages to inject
}
```

**Example Asset Data:**

```json
{
  "section": "context",
  "messages": [
    {
      "role": "system",
      "content": "You are an expert in financial analysis. Always cite sources."
    },
    {
      "role": "user",
      "content": "Here is background context about the company..."
    }
  ]
}
```

**Messages with Images (via Working Memory):**

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Analyze this chart:" },
        { "type": "image_url", "working_memory_id": "wm-12345" }
      ]
    }
  ]
}
```

### Complete Data-Driven Prompt Example

```typescript
import { RegisterPrompt, component_provider } from '@firebrandanalytics/ff-agent-sdk/app';
import { PromptGroup, Prompt, PromptTemplateSectionNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Base prompt with code-defined structure
class AnalysisBasePrompt extends Prompt<AnalysisPTH> {
  constructor() {
    super('system', {});
    this.add_section(new PromptTemplateSectionNode({
      semantic_type: 'instruction',
      content: 'You are a data analyst. Analyze the provided data.',
      children: [
        'Be thorough and systematic',
        'Cite specific data points'
      ]
    }));
  }
}

// Create data-driven prompt group that loads additional content from database
@RegisterPrompt('DataDrivenAnalysisPrompt')
export class DataDrivenAnalysisPromptGroup extends PromptGroup<AnalysisPTH> {
  constructor(subComponentId: string) {
    super({
      named_prompts: [
        {
          name: 'base',
          prompt: new AnalysisBasePrompt()
        },
        {
          name: 'context',
          placeholder: true  // Content loaded from assets
        },
        {
          name: 'examples',
          placeholder: true  // Content loaded from assets
        }
      ],

      // Load additional messages from database
      dataDriven: {
        subComponentId,
        componentProvider: component_provider,
        cacheStrategy: 'init_once'
      }
    });
  }
}

// Usage in a Bot
class DataDrivenAnalysisBot extends Bot<AnalysisBTH> {
  constructor(subComponentId: string) {
    super({
      name: 'DataDrivenAnalysisBot',
      base_prompt_group: new DataDrivenAnalysisPromptGroup(subComponentId),
      model_pool_name: 'azure_completion_4o'
    });
  }
}
```

### Setting Up Assets in the Database

Assets are stored in `components.assets` and linked to sub-components:

```sql
-- Example: Insert an additional_messages asset
INSERT INTO components.assets (
  id,
  sub_component_id,
  name,
  type,
  data,
  active
) VALUES (
  gen_random_uuid(),
  'your-sub-component-uuid',
  'domain-context',
  'additional_messages',
  '{
    "section": "context",
    "messages": [
      {
        "role": "system",
        "content": "Additional domain-specific instructions..."
      }
    ]
  }'::jsonb,
  true
);
```

### How Data-Driven Loading Works

1. **During `init_preprocess()`**: PromptGroup checks if `dataDriven` is configured
2. **Asset Retrieval**: Calls `componentProvider.get_assets_by_sub_component_id()` with type `'additional_messages'`
3. **Message Injection**: Assets are converted to `AdditionalMessages` and merged with runtime messages
4. **Section Targeting**: If asset has `section` field, messages go to that named prompt; otherwise to root

```
Code-Defined Prompts  +  Database Assets  →  Final Rendered Prompt
                                              (sections merged)
```

### Benefits of This Pattern

- **Separation of concerns**: Developers define structure; domain experts define content
- **No redeployment**: Change prompt content via database updates
- **Version control**: Track asset changes in database audit logs
- **Testing**: Swap asset sets for A/B testing prompt variations
- **Multi-tenant**: Different asset content per customer/environment

---

## Advanced Registration Patterns

### Multiple Bot Versions

Register multiple versions of the same bot with different names:

```typescript
import { RegisterBot, FFAgentBundle } from '@firebrandanalytics/ff-agent-sdk/app';

@RegisterBot('SummaryBotV1')
export class SummaryBotV1 extends Bot<SummaryBTH> {
  // Original implementation
}

@RegisterBot('SummaryBotV2')
export class SummaryBotV2 extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) {
  // Improved implementation
}

// Register both versions
FFAgentBundle.registerBot('SummaryBotV1', new SummaryBotV1());
FFAgentBundle.registerBot('SummaryBotV2', new SummaryBotV2());

// Clients can choose which version to call:
// POST /bot/SummaryBotV1/run
// POST /bot/SummaryBotV2/run
```

### Runtime Bot Selection

Dynamically select which bot to use based on runtime criteria:

```typescript
import { FFAgentBundle, getRegisteredBotClasses } from '@firebrandanalytics/ff-agent-sdk/app';

// Register multiple bots
FFAgentBundle.registerBot('FastSummaryBot', new FastSummaryBot());
FFAgentBundle.registerBot('AccurateSummaryBot', new AccurateSummaryBot());

// Create a router that selects the appropriate bot
@ApiEndpoint({ method: 'POST', route: 'smart-summary' })
async smartSummary(body: { text: string; priority: 'speed' | 'accuracy' }): Promise<any> {
  const botName = body.priority === 'speed' ? 'FastSummaryBot' : 'AccurateSummaryBot';
  const bot = FFAgentBundle.getBot(botName);

  if (!bot) {
    throw new Error(`Bot ${botName} not found`);
  }

  const request = new BotRequest({
    id: `summary-${Date.now()}`,
    input: { text: body.text }
  });

  const response = await bot.run(request);
  return response.output;
}
```

### Validation Schema per Environment

Use different validation schemas based on environment:

```typescript
import { z } from 'zod';

// Stricter validation for production
const productionSchema = z.object({
  args: z.object({
    length: z.enum(['short', 'medium']),  // No 'long' in prod
  }),
  input: z.object({
    text: z.string().min(100).max(10000)  // Size limits
  })
});

// Relaxed validation for development
const developmentSchema = z.object({
  args: z.object({
    length: z.enum(['short', 'medium', 'long'])
  }),
  input: z.object({
    text: z.string().min(1)
  })
});

const schema = process.env.NODE_ENV === 'production'
  ? productionSchema
  : developmentSchema;

@RegisterBot('SummaryBot', { requestSchema: schema })
export class SummaryBot extends Bot<SummaryBTH> {
  // Implementation
}
```

---

## Complete Example

```typescript
import {
  RegisterBot,
  RegisterPrompt,
  FFAgentBundle,
  getRegisteredBotClasses,
  getRegisteredPromptClasses
} from '@firebrandanalytics/ff-agent-sdk/app';
import {
  ComposeMixins,
  MixinBot,
  StructuredOutputBotMixin,
  BotRequest
} from '@firebrandanalytics/ff-agent-sdk/bot';
import { Prompt, PromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';
import { z } from 'zod';

// Define prompt
@RegisterPrompt('ContentAnalysisPrompt')
export class ContentAnalysisPrompt extends Prompt<AnalysisPTH> {
  constructor(args: { style: string }) {
    super('system', args);
    this.add_section(
      `Analyze the content in ${args.style} style and extract key insights.`
    );
  }
}

// Define output schema
const InsightsSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  topics: z.array(z.string())
});

type Insights = z.infer<typeof InsightsSchema>;

// Define request validation schema
const ContentAnalysisRequestSchema = z.object({
  args: z.object({
    style: z.enum(['technical', 'business', 'casual'])
  }),
  input: z.object({
    content: z.string().min(100)
  })
});

// Define bot with validation
@RegisterBot('ContentAnalysisBot', {
  requestSchema: ContentAnalysisRequestSchema
})
export class ContentAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) {
  constructor() {
    super({
      name: 'ContentAnalysisBot',
      schema: InsightsSchema,
      base_prompt_group: new PromptGroup([
        {
          name: 'analysis',
          prompt: new ContentAnalysisPrompt({ style: 'thorough' })
        }
      ])
    });
  }
}

// Initialize bundle
export const bundle = new FFAgentBundle({
  app_id: 'content-analyzer',
  autoPopulateComponents: true
});

// Register bot instance for HTTP API
const contentAnalysisBot = new ContentAnalysisBot();
FFAgentBundle.registerBot('ContentAnalysisBot', contentAnalysisBot);

// Now the bot is available via:
// POST /bot/ContentAnalysisBot/run
// POST /bot/ContentAnalysisBot/start (streaming)

// You can also invoke programmatically
async function runAnalysis(content: string, style: 'technical' | 'business' | 'casual') {
  const bot = FFAgentBundle.getBot<ContentAnalysisBot>('ContentAnalysisBot');

  if (!bot) {
    throw new Error('ContentAnalysisBot not registered');
  }

  const request = new BotRequest({
    id: `analysis-${Date.now()}`,
    input: { content },
    args: { style }
  });

  const response = await bot.run(request);
  return response.output as Insights;
}

// Execute
const insights = await runAnalysis('Your content here...', 'business');
console.log(insights);
// Output: {
//   summary: 'This content discusses...',
//   keyPoints: ['point 1', 'point 2'],
//   sentiment: 'positive',
//   topics: ['topic1', 'topic2']
// }
```

---

## Best Practices

1. **Use Consistent Naming**: Use clear, descriptive names for bots (e.g., `SummaryBot`, `AnalysisBot`)
2. **Match Decorator and Registry Names**: Use the same name in `@RegisterBot('MyBot')` and `FFAgentBundle.registerBot('MyBot', instance)`
3. **Use Request Schemas**: Add Zod validation schemas to catch invalid requests early
4. **Register in Bundle Init**: Register bot instances during bundle initialization for consistent availability
5. **Test HTTP Endpoints**: Verify bots are accessible via `/bot/:name/run` after registration
6. **Handle Missing Bots**: Always check `FFAgentBundle.getBot()` return value before use
7. **Version by Name**: Use naming conventions like `SummaryBotV1`, `SummaryBotV2` for different versions
8. **Document Schemas**: Keep validation schemas well-documented for API consumers

---

## Troubleshooting

**Issue: Bot not found via HTTP API**
- Verify you called both `@RegisterBot` decorator AND `FFAgentBundle.registerBot()`
- Check the bot name matches exactly (case-sensitive)
- Ensure the bot instance was created and registered before the request
- Check logs for `[FFAgentBundle] Registered bot: <name>` confirmation

**Issue: Request validation fails**
- Verify your request matches the Zod schema structure
- Check the schema expects `args` and `input` objects, not flat structure
- Review the 400 error response for specific validation errors

**Issue: Bot available programmatically but not via HTTP**
- Ensure `FFAgentBundle.registerBot()` was called (not just the decorator)
- Verify the server started after bot registration
- Check the Express transport is configured correctly

**Issue: Database not populated**
- Check `autoPopulateComponents` is set to `true`
- Verify database connection string
- Check PostgreSQL schema exists
- Review logs for initialization errors

---

## Additional Resources

- [Bot Tutorial](../core/bots.md)
- [Entity System Guide](../core/entities.md)
- [Component Architecture](../core/agent_bundles.md)
