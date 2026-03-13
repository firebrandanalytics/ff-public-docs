# Core Decorators Reference

FireFoundry provides decorators to wire entities, bots, and API endpoints together with minimal boilerplate. This reference covers every decorator available in `@firebrandanalytics/ff-agent-sdk`.

## Quick Reference

| Decorator | Applies To | Purpose |
|-----------|-----------|---------|
| [`@EntityMixin`](#entitymixin) | Entity classes | Register entity type and allowed connections |
| [`@EntityDecorator`](#entitydecorator) | Entity classes | Register entity with typed data class support |
| [`@RegisterBot`](#registerbot) | Bot classes | Register bot in the global bot registry |
| [`@ApiEndpoint`](#apiendpoint) | Agent bundle methods | Expose methods as REST API endpoints |
| [`@MetaClassDecorator`](#metaclassdecorator) | System entity classes | Register meta-class entities (advanced) |
| [`@EntityDispatcherDecorator`](#entitydispatcherdecorator) | Dispatcher entities | Configure dynamic routing to sub-entities |
| [`@RunnableEntityBotWrapperDecorator`](#runnableentitybotwrapperdecorator) | Entity classes | Wire entity directly to a bot instance (legacy) |

All decorators are imported from the main SDK package:

```typescript
import {
  EntityMixin,
  EntityDecorator,
  RegisterBot,
  ApiEndpoint,
  MetaClassDecorator,
  EntityDispatcherDecorator,
  RunnableEntityBotWrapperDecorator,
} from '@firebrandanalytics/ff-agent-sdk';
```

---

## @EntityMixin

The primary decorator for entity classes. Registers the entity type in the constructor registry and declares which edge types and target entities are allowed.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `specificType` | `string` | Yes | Unique type name for this entity (e.g., `'ContactEntity'`) |
| `generalType` | `string` | Yes | Category type (often the same as `specificType`) |
| `allowedConnections` | `Record<string, string[]>` | Yes | Map of edge type names to allowed target entity types |

### Usage

**Simple entity with no connections:**

```typescript
import { EntityMixin, EntityNode, EntityFactory } from '@firebrandanalytics/ff-agent-sdk';
import type { UUID, EntityNodeDTO } from '@firebrandanalytics/shared-types';

@EntityMixin({
  specificType: 'NoteEntity',
  generalType: 'NoteEntity',
  allowedConnections: {},
})
export class NoteEntity extends EntityNode<any> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | EntityNodeDTO) {
    super(factory, idOrDto);
  }
}
```

**Entity with connections (from CRM demo):**

```typescript
@EntityMixin({
  specificType: 'ContactEntity',
  generalType: 'ContactEntity',
  allowedConnections: {
    HasNote: ['NoteEntity'],
    HasInteraction: ['InteractionEntity'],
    HasDraft: ['EmailDraftEntity'],
    RecipientOf: ['CampaignRecipientEntity'],
  },
})
export class ContactEntity extends EntityNode<ContactEntityENH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ContactEntityDTO) {
    super(factory, idOrDto);
  }
}
```

**Runnable entity with bot integration (from CRM demo):**

```typescript
import { RunnableEntity, BotRunnableEntityMixin, EntityMixin } from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';

@EntityMixin({
  specificType: 'NoteEntity',
  generalType: 'NoteEntity',
  allowedConnections: {},
})
export class NoteEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<NoteEntityRETH>,
  BotRunnableEntityMixin<NoteEntityRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | NoteEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ['NoteEnricherBot']  // Bot name(s) to use
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<NoteEnricherBTH>>
  ): Promise<BotRequestArgs<NoteEnricherBTH>> {
    const dto = await this.get_dto();
    return {
      args: {} as Record<string, never>,
      input: `Category: ${dto.data.category}\n\nNote:\n${dto.data.content}`,
      context: new Context(dto),
    };
  }
}
```

**Runnable entity with `Calls` connections (for multi-step workflows):**

```typescript
@EntityMixin({
  specificType: 'ReportEntity',
  generalType: 'ReportEntity',
  allowedConnections: {
    'Calls': ['ReportGenerationEntity', 'ReviewEntity'],
  },
})
export class ReportEntity extends RunnableEntity<ReportEntityRETH> {
  protected async *run_impl() {
    // appendOrRetrieveCall requires the target type in allowedConnections['Calls']
    const step = await this.appendOrRetrieveCall(ReportGenerationEntity, 'generate', {});
    const result = yield* this.doCall(step);
    return result;
  }
}
```

### Important Notes

- Every entity type you pass to `appendOrRetrieveCall()` or `appendCall()` **must** be listed in `allowedConnections['Calls']`. Missing entries cause a runtime error: `"Cannot read properties of undefined (reading 'includes')"`.
- The `specificType` must match the key used in your `constructors.ts` registry.
- `generalType` is used for entity graph categorization — it's often the same as `specificType` for application entities.

---

## @EntityDecorator

A variant of `@EntityMixin` that supports a `dataClass` option for automatic DTO data deserialization. Use this when entity data should be revived as typed class instances rather than plain objects.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `specificType` | `string` | Yes | Unique type name |
| `generalType` | `string` | Yes | Category type |
| `dataClass` | `Class` | No | TypeScript class for automatic `dto.data` deserialization |
| `allowedConnections` | `Record<string, string[]>` | No | Edge type configuration |

### Usage

**Entity with typed data class (from Catalog Intake demo):**

```typescript
import { EntityDecorator, EntityNode } from '@firebrandanalytics/ff-agent-sdk';

@EntityDecorator({
  specificType: 'SupplierProductDraft',
  generalType: 'SupplierProductDraft',
  dataClass: SupplierProductCanonical,
})
export class SupplierProductDraft extends EntityNode<any> {
  constructor(factory: EntityFactory<any>, idOrDto: any) {
    super(factory, idOrDto);
  }
}
```

When `dataClass` is set, `get_dto().data` returns an instance of the specified class instead of a plain `JSONObject`. This is useful for entities with discriminated unions, computed properties, or validation logic on the data object itself.

### When to Use `@EntityDecorator` vs `@EntityMixin`

| Use `@EntityMixin` when... | Use `@EntityDecorator` when... |
|---------------------------|-------------------------------|
| Entity data is a plain JSON object | Data needs class methods or computed properties |
| Standard entity patterns | Discriminated unions that need typed deserialization |
| Most common case | You need `dataClass` for automatic revival |

---

## @RegisterBot

Registers a bot class in the global bot registry, making it discoverable by name throughout the application.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `botName` | `string` | Yes | Unique name for the bot in the registry |

### Usage

**Standard bot registration (from CRM demo):**

```typescript
import { RegisterBot, MixinBot, StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';

class ContactSummarizerBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[/* type params */]> {
  constructor() {
    // ... prompt group setup, model pool, schema
    super(
      [{ name: 'ContactSummarizerBot', model_pool_name: 'firebrand_completion_default', /* ... */ }],
      [{ schema: ContactSummarySchema }]
    );
  }
}

@RegisterBot('ContactSummarizerBot')
export class ContactSummarizerBot extends ContactSummarizerBotBase {
  public override get_semantic_label_impl(): string {
    return 'ContactSummarizerBot';
  }
}
```

### How Registered Bots Are Used

**1. From an agent bundle (direct invocation):**

```typescript
// In your FFAgentBundle class
const bot = FFAgentBundle.getBotOrThrow('ContactSummarizerBot');
const request = new BotRequest({
  args: {},
  input: 'Summarize this contact...',
  context: new Context(contactDto),
});
const response = await bot.run(request);
```

**2. From a BotRunnableEntityMixin (automatic wiring):**

```typescript
// In entity constructor — bot is resolved by name from the registry
constructor(factory: EntityFactory<any>, idOrDto: UUID | NoteEntityDTO) {
  super(
    [factory, idOrDto] as any,
    ['NoteEnricherBot']  // Looked up in the bot registry
  );
}
```

### Important Notes

- The `@RegisterBot` name must match the name used in `BotRunnableEntityMixin` constructor and `FFAgentBundle.getBotOrThrow()` calls.
- The `get_semantic_label_impl()` method is **required** on all bot subclasses — the SDK throws at runtime if it's missing. It returns a label used for telemetry and logging.
- Import bot modules in `constructors.ts` to trigger `@RegisterBot` side-effect registration:

```typescript
// constructors.ts
import './bots/ContactSummarizerBot.js';  // Triggers @RegisterBot
import './bots/NoteEnricherBot.js';
```

---

## @ApiEndpoint

Exposes methods on `FFAgentBundle` subclasses as HTTP REST endpoints. Endpoints are accessible at `/api/{route}` when deployed behind Kong Gateway.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `method` | `string` | No | `'GET'` | HTTP method: `'GET'`, `'POST'`, `'PUT'`, `'DELETE'` |
| `route` | `string` | No | method name | URL path (supports nested paths like `'contacts/note'`) |
| `responseType` | `string` | No | — | Set to `'binary'` for file downloads or `'iterator'` for SSE streaming |
| `contentType` | `string` | No | — | MIME type for binary responses (e.g., `'application/pdf'`) |
| `filename` | `string` | No | — | Suggested filename for binary downloads |
| `acceptsBlobs` | `boolean` | No | `false` | Enable multipart file upload support |

### Usage

**Simple POST endpoint:**

```typescript
@ApiEndpoint({ method: 'POST', route: 'greet' })
async greet(data: { name: string }) {
  return { message: `Hello, ${data.name}!` };
}
// Accessible at: POST /api/greet
```

**GET endpoint with query parameters:**

```typescript
@ApiEndpoint({ method: 'GET', route: 'contacts' })
async listContacts(data?: { tag?: string }) {
  const { result } = await this.entity_client.search_nodes_scoped({
    specific_type_name: 'ContactEntity',
  });
  return { contacts: result, count: result.length };
}
// Accessible at: GET /api/contacts?tag=vip
```

**Nested resource endpoint:**

```typescript
@ApiEndpoint({ method: 'POST', route: 'contacts/note' })
async addNote(data: { contact_id: string; content: string }) {
  // Create note entity, link to contact...
  return { note_id: noteDto.id, ...noteDto.data };
}
// Accessible at: POST /api/contacts/note
```

**Workflow trigger endpoint (returns entity ID for streaming):**

```typescript
@ApiEndpoint({ method: 'POST', route: 'campaigns/execute' })
async executeCampaign(data: { campaign_id: string; actor_id: string }) {
  // Validate, prepare data, start execution...
  return {
    campaign_id: campaignDto.id,
    entity_id: campaignDto.id,
    status: 'executing',
    message: 'Use iterator run for progress streaming.',
  };
}
```

### URL Pattern

When deployed to Kubernetes behind Kong Gateway:

```
http://localhost:8080/agents/{namespace}/{bundle-name}/api/{route}
```

For example:
- `POST /agents/ff-dev/crm-bundle/api/contacts`
- `GET /agents/ff-dev/crm-bundle/api/contacts?tag=vip`
- `POST /agents/ff-dev/crm-bundle/api/contacts/note`

### Method Signature

The decorated method receives a single argument:
- **POST/PUT/DELETE**: The parsed JSON request body as an object
- **GET**: Query parameters as an object (all values are strings)

The return value is automatically serialized as JSON in the HTTP response.

---

## @MetaClassDecorator

Registers meta-class entities in the entity system. This is an advanced, system-level decorator rarely used in application code.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Fixed UUID for the meta-class entity |
| `specificType` | `string` | Yes | Meta entity type name |

### Usage

```typescript
import { MetaClassDecorator } from '@firebrandanalytics/ff-agent-sdk';

@MetaClassDecorator({
  id: 'f0000000-0000-0000-0000-000000000001',
  specificType: 'Class',
})
export class ClassMetaEntity extends EntityNode<any> {
  // System-level entity class definition
}
```

This decorator is used internally by the SDK for entity type system bootstrapping. Application developers typically don't need it.

---

## @EntityDispatcherDecorator

Configures an entity as a dispatcher that routes work to different child entity types based on a dispatch key. Used for dynamic branching in workflows.

### Parameters

A configuration object mapping dispatch keys to entity class/type pairs:

```typescript
Record<string, {
  entityClass: typeof EntityNode;
  entityType: string;
}>
```

### Usage

```typescript
import { EntityDispatcherDecorator, EntityNode } from '@firebrandanalytics/ff-agent-sdk';

@EntityDispatcherDecorator({
  'process_data': {
    entityClass: DataProcessor,
    entityType: 'DataProcessor',
  },
  'validate_input': {
    entityClass: Validator,
    entityType: 'Validator',
  },
})
export class WorkflowDispatcher extends EntityNode<any> {
  // Routes computations to appropriate entities
}

// Usage:
const result = await dispatcher.run_dispatch<ProcessResult>('process_data', { data: inputData });
```

For a complete guide, see [Entity Dispatcher Pattern](../feature_guides/entity-dispatcher-pattern.md).

---

## @RunnableEntityBotWrapperDecorator

A legacy decorator that combines entity registration with bot wiring in a single decorator. In modern SDK (v4+), prefer `@EntityMixin` with `AddMixins(RunnableEntity, BotRunnableEntityMixin)` instead.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| First arg | `{ generalType, specificType, allowedConnections }` | Entity metadata (same as `@EntityMixin`) |
| Second arg | Bot instance | The bot instance to wire to this entity |

### Usage (Legacy Pattern)

```typescript
import { RunnableEntityBotWrapperDecorator, AddInterface, EntityNode, IRunnableEntity } from '@firebrandanalytics/ff-agent-sdk';

@RunnableEntityBotWrapperDecorator(
  {
    generalType: 'ArticleEntity',
    specificType: 'ArticleEntity',
    allowedConnections: {},
  },
  new ImpactAnalysisBot()
)
export class ArticleEntity extends AddInterface<
  typeof EntityNode<ARTICLE_RETH['enh']>,
  IRunnableEntity<ARTICLE_RETH['enh']['eth']['bth'], IMPACT_ANALYSIS_OUTPUT>
>(EntityNode<ARTICLE_RETH['enh']>) {
  // Entity implementation
}
```

### Modern Equivalent

The same functionality using the current recommended pattern:

```typescript
@EntityMixin({
  specificType: 'ArticleEntity',
  generalType: 'ArticleEntity',
  allowedConnections: {},
})
export class ArticleEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<ArticleRETH>, BotRunnableEntityMixin<ArticleRETH>]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ArticleEntityDTO) {
    super([factory, idOrDto] as any, ['ImpactAnalysisBot']);
  }

  protected async get_bot_request_args_impl(preArgs) {
    const dto = await this.get_dto();
    return { args: {}, input: dto.data.article_text, context: new Context(dto) };
  }
}
```

---

## Common Patterns

### Entity + Bot Wiring Checklist

When creating a runnable entity that uses a bot:

1. **Define the schema** (Zod) in `schemas.ts`
2. **Create the prompt** extending `StructuredDataPrompt`
3. **Create the bot** using `ComposeMixins(MixinBot, StructuredOutputBotMixin)`
4. **Decorate the bot** with `@RegisterBot('MyBotName')`
5. **Create the entity** extending `AddMixins(RunnableEntity, BotRunnableEntityMixin)`
6. **Decorate the entity** with `@EntityMixin({ specificType, generalType, allowedConnections })`
7. **Register in constructors** — add entity to constructors map, import bot file for side effects
8. **Expose via API** — decorate bundle methods with `@ApiEndpoint`

### Constructor Registry Setup

```typescript
// constructors.ts
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { ContactEntity } from './entities/ContactEntity.js';
import { NoteEntity } from './entities/NoteEntity.js';

// Import bots to trigger @RegisterBot decorator registration
import './bots/ContactSummarizerBot.js';
import './bots/NoteEnricherBot.js';

export const MyConstructors = {
  ...FFConstructors,
  ContactEntity,
  NoteEntity,
} as const;
```

### Decorator Import Cheat Sheet

```typescript
// Entity decorators
import { EntityMixin, EntityDecorator, MetaClassDecorator, EntityDispatcherDecorator } from '@firebrandanalytics/ff-agent-sdk';

// Bot decorator
import { RegisterBot } from '@firebrandanalytics/ff-agent-sdk';

// API endpoint decorator
import { ApiEndpoint } from '@firebrandanalytics/ff-agent-sdk';

// Entity base classes and mixins (used with decorators)
import { EntityNode, RunnableEntity, BotRunnableEntityMixin } from '@firebrandanalytics/ff-agent-sdk';

// Mixin composition utility
import { AddMixins, ComposeMixins } from '@firebrandanalytics/shared-utils';
```
