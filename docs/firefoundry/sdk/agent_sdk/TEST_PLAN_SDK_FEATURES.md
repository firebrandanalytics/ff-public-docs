# FireFoundry SDK Test Plan: Recent Features and Functionalities

**Version:** 1.0
**Date:** January 2026
**Scope:** SDK v3.0.0-beta.0 Features

This test plan covers the recent SDK updates including bot/prompt registration, validation library integration, advanced bot mixins, entity service enhancements, and type-safe entity patterns.

---

## Table of Contents

1. [Bot and Prompt Registration](#1-bot-and-prompt-registration)
2. [Validation Library Integration](#2-validation-library-integration)
3. [Advanced Bot Mixin Patterns](#3-advanced-bot-mixin-patterns)
4. [Entity Service Enhancements](#4-entity-service-enhancements)
5. [Type-Safe Entity Patterns](#5-type-safe-entity-patterns)
6. [Data-Driven Prompts](#6-data-driven-prompts)
7. [Component Architecture](#7-component-architecture)
8. [Error Handling Features](#8-error-handling-features)

---

## 1. Bot and Prompt Registration

### 1.1 @RegisterBot Decorator

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| BR-001 | Apply `@RegisterBot('BotName')` to a bot class without config | Bot class is registered in global metadata registry with name | High |
| BR-002 | Apply `@RegisterBot` with Zod request schema | Bot metadata includes requestSchema; schema is retrievable | High |
| BR-003 | Query registered bots via `getRegisteredBotClasses()` | Returns array of all registered bot metadata with names and configs | High |
| BR-004 | Register same bot name twice | Should either overwrite or throw error (verify expected behavior) | Medium |
| BR-005 | Verify decorator preserves bot class functionality | Bot constructor, methods, and inheritance work correctly | High |

**Test Code Example:**
```typescript
import { RegisterBot, getRegisteredBotClasses } from '@firebrandanalytics/ff-agent-sdk/app';
import { z } from 'zod';

const TestSchema = z.object({
  args: z.object({ length: z.enum(['short', 'long']) }),
  input: z.object({ text: z.string() })
});

@RegisterBot('TestBot', { requestSchema: TestSchema })
class TestBot extends Bot<TestBTH> { /* ... */ }

// Test: Verify registration
const registered = getRegisteredBotClasses();
assert(registered.find(b => b.name === 'TestBot'));
assert(registered.find(b => b.name === 'TestBot').config.requestSchema);
```

### 1.2 FFAgentBundle.registerBot() Instance Registration

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| BR-006 | Register bot instance with `FFAgentBundle.registerBot()` | Bot available via `FFAgentBundle.getBot()` | High |
| BR-007 | Query registered bot names via `getRegisteredBotNames()` | Returns array of all registered bot instance names | High |
| BR-008 | Access bot via HTTP endpoint `/bot/:name/run` | Bot executes and returns response | High |
| BR-009 | Access bot via HTTP endpoint `/bot/:name/start` | Returns iterator_id for streaming | High |
| BR-010 | Request validation with registered schema | Invalid requests return 400 with validation errors | High |
| BR-011 | Request to unregistered bot | Returns 404 error | Medium |

### 1.3 @RegisterPrompt Decorator

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| PR-001 | Apply `@RegisterPrompt('PromptName')` to prompt class | Prompt registered in global metadata registry | High |
| PR-002 | Apply with `subComponentName` config | Prompt linked to sub-component by name | Medium |
| PR-003 | Apply with `subComponentId` config | Prompt linked to sub-component by ID | Medium |
| PR-004 | Query via `getRegisteredPromptClasses()` | Returns all registered prompts with metadata | High |

### 1.4 HTTP API Endpoints

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| API-001 | POST `/bot/:bot_name/run` with valid request | Returns `{ success: true, result: {...} }` | High |
| API-002 | POST `/bot/:bot_name/run` with invalid schema | Returns 400 with validation details | High |
| API-003 | POST `/bot/:bot_name/start` for streaming | Returns `{ success: true, iterator_id: "..." }` | High |
| API-004 | Use iterator_id with `/iterator/:id/next` | Streams results correctly | High |
| API-005 | POST to non-existent bot | Returns 404 | Medium |
| API-006 | Request with optional fields (model_selection_criteria, max_tries) | Bot respects optional parameters | Medium |

---

## 2. Validation Library Integration

### 2.1 Core Decorators

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| VL-001 | Apply `@CoerceTrim()` to string field | Whitespace trimmed from input | High |
| VL-002 | Apply `@CoerceType('number')` to string input | String converted to number | High |
| VL-003 | Apply `@ValidateRange(min, max)` | Values outside range throw validation error | High |
| VL-004 | Apply `@ValidateRequired()` | Missing/null values throw validation error | High |
| VL-005 | Apply `@NormalizeText('email')` | Email normalized to lowercase | Medium |
| VL-006 | Apply `@NormalizeText('phone-formatted')` | Phone number formatted correctly | Medium |
| VL-007 | Apply `@Copy()` decorator | Value copied from source to target property | High |

### 2.2 AI-Powered Decorators

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| AI-001 | Apply `@AITransform` with prompt function | AI handler called with correct params | High |
| AI-002 | Apply `@AIValidate` with validation prompt | Returns true/false based on AI response | High |
| AI-003 | `@AITransform` with `maxRetries` option | Retries up to configured count on failure | High |
| AI-004 | Handler receives `AIHandlerParams` with all fields | params includes value, instance, context, propertyKey, attemptNumber, etc. | High |
| AI-005 | Handler receives `previousError` on retry | Error from previous attempt available | Medium |
| AI-006 | `@AITransform` with `dependsOn` option | Re-runs when dependent property changes | Medium |
| AI-007 | `@AITransform` with metadata option | Metadata passed to handler | Medium |

**Test Code Example:**
```typescript
import { ValidationFactory, AITransform, AIValidate } from '@firebrandanalytics/shared-utils';

class ContentAnalysis {
  @Copy()
  rawText: string;

  @AITransform(
    (params) => `Summarize: ${params.value}`,
    { metadata: { model: 'gpt-4o' }, maxRetries: 2 }
  )
  summary: string;
}

const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // Verify params structure
    assert(params.propertyKey === 'summary');
    assert(params.attemptNumber >= 1);
    assert(params.metadata.model === 'gpt-4o');
    return 'Summarized content';
  }
});

const result = await factory.create(ContentAnalysis, { rawText: 'Long text...' });
assert(result.summary === 'Summarized content');
```

### 2.3 ValidationFactory Configuration

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| VF-001 | Create factory with `aiHandler` | Handler used for `@AITransform` decorators | High |
| VF-002 | Create factory with `aiValidationHandler` | Handler used for `@AIValidate` decorators | High |
| VF-003 | Override handler per-request in `factory.create()` | Per-request handler takes precedence | Medium |
| VF-004 | Pass context to `factory.create()` | Context available in handler params | High |

### 2.4 DataValidationBotMixin Integration

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| DV-001 | Bot with DataValidationBotMixin produces output | Output passes through validation factory | High |
| DV-002 | Validation failure triggers bot retry | Bot re-prompts LLM with error context | High |
| DV-003 | `maxValidationRetries` configuration respected | Stops after configured retries | High |
| DV-004 | `contextExtractor` provides request context | Context available during validation | Medium |
| DV-005 | Custom `validationFactory` instance used | Provided factory instance takes precedence | Medium |

---

## 3. Advanced Bot Mixin Patterns

### 3.1 StructuredOutputBotMixin

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| SO-001 | Bot with Zod schema validates output | Invalid structure throws error | High |
| SO-002 | Valid JSON extracted from LLM response | Parsed JSON matches schema | High |
| SO-003 | Schema description included in prompt | LLM receives schema guidance | Medium |
| SO-004 | Type inference from schema | Return type matches `z.infer<Schema>` | High |

### 3.2 FeedbackBotMixin

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| FB-001 | `_ff_feedback` injected into request args | Feedback available in prompt | High |
| FB-002 | `_ff_previous_result` contains prior output | Previous bot output accessible | High |
| FB-003 | `_ff_version` increments on each iteration | Version tracks iteration count | High |
| FB-004 | Conditional feedback display via `condition` | Prompt shown only when condition true | Medium |
| FB-005 | Custom `processFeedback()` override works | Custom feedback processing applied | Medium |

**Test Code Example:**
```typescript
class IterativeBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    super({
      name: 'IterativeBot',
      schema: OutputSchema,
      base_prompt_group: promptGroup,
      model_pool_name: 'default',
      condition: (request) => (request.args?._ff_version ?? 1) > 1
    });
  }
}

// Test: First request has no feedback
const response1 = await bot.run(request1);
// Test: Second request includes feedback from first
const response2 = await bot.run({
  ...request2,
  args: {
    _ff_feedback: { score: 3, comments: 'Improve clarity' },
    _ff_previous_result: response1.output,
    _ff_version: 2
  }
});
```

### 3.3 WorkingMemoryBotMixin

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| WM-001 | `input_working_memory_paths` fetches content | Content included in prompt | High |
| WM-002 | `filterPaths` configuration respected | Only matching paths included | Medium |
| WM-003 | `getDescription` provides path descriptions | Custom descriptions in prompt | Medium |
| WM-004 | `contentTransformers` applied by extension | Content transformed before inclusion | Medium |
| WM-005 | Image files rendered correctly | Multimodal content handled | Medium |

### 3.4 Mixin Composition Order

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| MC-001 | Mixins execute pre-phase in order | First mixin's pre-phase runs first | High |
| MC-002 | All mixin capabilities available | Combined bot has all mixin methods | High |
| MC-003 | Composition with `ComposeMixins()` | Creates correct class hierarchy | High |
| MC-004 | Composition with `AddMixins()` | Adds capabilities to existing class | High |

---

## 4. Entity Service Enhancements

### 4.1 Vector Search

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| VS-001 | Create embedding via `POST /api/vector/embedding` | Embedding stored for node | High |
| VS-002 | Find similar via `GET /api/vector/similar/:node_id` | Returns similar nodes by cosine distance | High |
| VS-003 | Search by embedding `POST /api/vector/search` | Returns matching nodes | High |
| VS-004 | Similarity threshold filtering | Only results above threshold returned | High |
| VS-005 | Metadata filtering on embeddings | Filters applied correctly | Medium |
| VS-006 | Pagination with limit/offset | Results paginated correctly | Medium |
| VS-007 | 3072-dimensional embedding supported | Compatible with text-embedding-3-large | High |

### 4.2 Batch Insert

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| BI-001 | Create node with `?batch=true` | Node queued for batch insert | High |
| BI-002 | Batch flushes at `BATCH_INSERT_MAX_ROWS` | Batch inserted when row count reached | High |
| BI-003 | Batch flushes at `BATCH_INSERT_MAX_DURATION_MS` | Batch inserted after time threshold | High |
| BI-004 | Batch metrics available via `/api/batch/metrics` | Returns batch statistics | Medium |

### 4.3 Node I/O Tracking

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IO-001 | `PUT /api/node/:id/io` sets input/output | I/O envelope stored | High |
| IO-002 | `POST /api/node/:id/io/progress` appends progress | Progress appended to envelope | High |
| IO-003 | `GET /api/node/:id/io` retrieves I/O | Full I/O envelope returned | High |
| IO-004 | `GET /api/node/:id/progress` retrieves progress | Progress envelopes returned | Medium |

### 4.4 Graph Traversal

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| GT-001 | `GET /api/node/:id/edges` returns all edges | Both from and to edges returned | High |
| GT-002 | `GET /api/node/:id/connected-nodes` with edge type filter | Only specified edge types traversed | High |
| GT-003 | Recursive traversal with depth limit | Stops at configured depth | Medium |
| GT-004 | JSONPath filtering on connected nodes | Filters applied correctly | Medium |

---

## 5. Type-Safe Entity Patterns

### 5.1 EntityTypeHelper

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| TH-001 | `create_entity_node<'EntityType', DataType>` returns typed entity | Return type is entity instance, not DTO | High |
| TH-002 | `data` field type-checked against DataType | Compile-time type errors for wrong data | High |
| TH-003 | `get_entity<'EntityType'>` returns correct instance type | Async retrieval returns typed entity | High |
| TH-004 | `get_entity_known_type` returns correct instance type | Sync retrieval returns typed entity | High |

**Test Code Example:**
```typescript
interface OrderData {
  customer_id: string;
  items: Array<{ sku: string; quantity: number }>;
  total: number;
}

// Type-safe entity creation
const order = await factory.create_entity_node<'Order', OrderData>({
  app_id: app_id,
  name: `order-${Date.now()}`,
  specific_type_name: 'Order',
  general_type_name: 'Transaction',
  status: 'Pending',
  data: {
    customer_id: 'cust-123',
    items: [{ sku: 'ITEM-001', quantity: 2 }],
    total: 99.99
    // Missing required field would be compile-time error
  }
});

// Verify return type is entity, not DTO
const dto = await order.get_dto();  // Access ID through DTO
assert(dto.id !== undefined);
```

### 5.2 Entity Creation and Retrieval

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| EC-001 | Entity ID accessed via `get_dto()` | ID property protected, accessible through DTO | High |
| EC-002 | Entity methods callable on created instance | `run()`, `update_data()`, etc. work | High |
| EC-003 | `create_or_retrieve_entity_node` is idempotent | Returns existing entity if name matches | High |
| EC-004 | `create_entity_edge_with_incrementing_pos` manages position | Position auto-incremented | Medium |

---

## 6. Data-Driven Prompts

### 6.1 PromptGroup with dataDriven Configuration

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| DD-001 | Configure `dataDriven.subComponentId` | Assets loaded from sub-component | High |
| DD-002 | `cacheStrategy: 'init_once'` caches assets | Assets loaded once and cached | High |
| DD-003 | `cacheStrategy: 'always_refresh'` reloads | Assets reloaded on each render | Medium |
| DD-004 | Assets with `section` target named prompt | Messages injected into correct section | High |
| DD-005 | Assets without `section` go to root | Messages added to root prompt | Medium |

### 6.2 Asset Loading

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| AL-001 | Load `additional_messages` asset type | Messages available in prompt | High |
| AL-002 | Load `knowledge_base` asset type | Knowledge entries available | Medium |
| AL-003 | Load `template` asset type | Template content available | Medium |
| AL-004 | Load `configuration` asset type | Config values available | Medium |
| AL-005 | Load `examples` asset type | Examples available for few-shot | Medium |

**Test Code Example:**
```typescript
// Asset data structure test
const assetData = {
  section: 'context',
  messages: [
    { role: 'system', content: 'Domain-specific instructions...' }
  ]
};

// Test: Messages injected into 'context' section
const dataDrivenPromptGroup = new PromptGroup<PTH>({
  named_prompts: [
    { name: 'base', prompt: new BasePrompt() },
    { name: 'context', placeholder: true }
  ],
  dataDriven: {
    subComponentId: 'sub-component-uuid',
    componentProvider: component_provider,
    cacheStrategy: 'init_once'
  }
});

// Render and verify context section contains asset messages
```

---

## 7. Component Architecture

### 7.1 Auto Component Population

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| CP-001 | `autoPopulateComponents: true` registers bots | Bot sub-components created in DB | High |
| CP-002 | Prompt classes registered as sub-components | Prompt sub-components created | High |
| CP-003 | Entity constructors registered | Entity sub-components created | Medium |
| CP-004 | Component hierarchy created correctly | Application -> Component -> SubComponent | High |

### 7.2 ComponentProvider API

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| PA-001 | `get_agent_bundle_by_name` retrieves bundle | Returns AgentBundleDTO or undefined | High |
| PA-002 | `register_sub_components` bulk upserts | Sub-components created/updated | High |
| PA-003 | `get_assets_by_sub_component_id` retrieves assets | Returns matching assets | High |
| PA-004 | `get_assets_by_sub_component_name` retrieves assets | Returns assets by name lookup | High |

---

## 8. Error Handling Features

### 8.1 Error Classification

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| EH-001 | `CompilerError` triggers compiler error handler | Specialized handling applied | High |
| EH-002 | `RuntimeError` triggers runtime error handler | Specialized handling applied | High |
| EH-003 | `SQLError` triggers SQL error handler | Specialized handling applied | High |
| EH-004 | `InternalError` triggers automatic retry | Retried without specialized handler | High |

### 8.2 InternalError Retry Logic

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| IR-001 | `InternalError` retried up to max retries | Retries configured number of times | High |
| IR-002 | Retry yields progress update | INTERNAL_UPDATE with retry info emitted | Medium |
| IR-003 | Non-InternalError not retried | Other errors propagate immediately | High |
| IR-004 | Delay between retries | Short delay before retry attempt | Medium |

### 8.3 Direct Execution

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| DE-001 | `should_use_direct_execution` returns true | Direct execution path taken | High |
| DE-002 | `direct_execution_handler` bypasses LLM | Code executed without LLM call | High |
| DE-003 | `direct_execution_code_extractor` provides code | Code retrieved for error handlers | Medium |

---

## Test Environment Setup

### Prerequisites

1. **Database**: PostgreSQL 14+ with pgvector extension
2. **Node.js**: v20+
3. **Package Dependencies**: Latest `@firebrandanalytics/ff-agent-sdk` and `@firebrandanalytics/shared-utils`
4. **Environment Variables**:
   ```bash
   PG_DATABASE=firefoundry_test
   FF_AGENT_BUNDLE_ID=test-bundle-id
   LOG_LEVEL=debug
   ```

### Test Data Requirements

1. Test bot classes with `@RegisterBot` decorator
2. Test prompt classes with `@RegisterPrompt` decorator
3. Validation classes with AI decorators
4. Sub-components with assets in database
5. Entity nodes with embeddings for vector search tests

### Execution Order

1. Unit tests (decorators, mixins, validation)
2. Integration tests (HTTP endpoints, database operations)
3. End-to-end tests (complete workflows)

---

## Success Criteria

- All High priority tests pass
- 90%+ of Medium priority tests pass
- No critical/blocking defects
- Performance within acceptable thresholds (vector search < 500ms, batch insert handles 100+ rows)

---

## Related Documentation

- [Bot and Prompt Registration](./feature_guides/bot-prompt-registration.md)
- [Validation Integration Patterns](./feature_guides/validation-integration-patterns.md)
- [Advanced Bot Mixin Patterns](./feature_guides/advanced-bot-mixin-patterns.md)
- [Entity Service](../../platform/services/entity-service.md)
- [Entities Guide](./core/entities.md)
- [Bots Guide](./core/bots.md)
