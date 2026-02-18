# Entity Dispatcher Pattern: Dynamic Routing & Conditional Logic

This guide explains how to use the `EntityDispatcherMixin` to create flexible, routable workflows where entities dynamically invoke other entities based on runtime logic.

## Table of Contents

1. [Overview](#overview)
2. [The Dispatcher Mixin](#the-dispatcher-mixin)
3. [Core Concepts](#core-concepts)
4. [Basic Usage](#basic-usage)
5. [Advanced Patterns](#advanced-patterns)
6. [Type Safety](#type-safety)
7. [Real-World Examples](#real-world-examples)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### What Is the Entity Dispatcher?

The `EntityDispatcherMixin` enables an entity to **dynamically route work to other entities** based on runtime decisions:

```
DispatcherEntity decides:
  ├─ If condition A → dispatch to EntityA
  ├─ If condition B → dispatch to EntityB
  └─ If condition C → dispatch to EntityC
```

### Key Benefits

- **No hardcoded entity references**: Route decisions made at runtime
- **Idempotent retries**: Dispatcher remembers previous dispatches via Dispatch edges
- **Type-safe**: Full TypeScript support with generic constraints
- **Observable**: Dispatch edges persist in the entity graph
- **Composable**: Dispatchers can dispatch to other dispatchers

### When to Use

- **Multi-tenant workflows** - Route to different entity implementations per tenant
- **A/B testing** - Route 50% to variant A, 50% to variant B
- **Fallback patterns** - Try primary service, fall back to secondary
- **Content-based routing** - Route based on input data characteristics
- **Feature flags** - Route based on enabled features
- **Load balancing** - Distribute work across entity variants

---

## The Dispatcher Mixin

### EntityDispatcherMixin Class

```typescript
import { EntityDispatcherMixin } from '@firebrandanalytics/ff-agent-sdk/entity';
import { AddMixins, ComposeMixins } from '@firebrandanalytics/shared-utils';

class MyDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
)<[
  EntityNode,
  RunnableEntityMixin<MyDispatcherRETH>,
  EntityDispatcherMixin<MyDispatcherRETH>
]> {
  // Your implementation
}
```

### Type Parameter

```typescript
EntityDispatcherMixin<
  ENH extends RunnableEntityTypeHelper<any, any, any, any, any>
>
```

- `ENH` = The entity's own RunnableEntityTypeHelper
- Contains dispatcher entity's input, output, and metadata types

### Core Methods

#### `dispatch<TReturn>(functionName, args): Promise<RunnableEntityResponseIterator<any, TReturn>>`

Dispatches to a registered function and returns an iterator for progress tracking.

```typescript
class MyDispatcher extends AddMixins(EntityNode, RunnableEntityMixin, EntityDispatcherMixin) {
  protected async *run_impl() {
    const result = yield* this._dispatch('analyzeData', {
      data: 'input'
    });
    return result;
  }
}
```

#### `run_dispatch<TReturn>(functionName, args): Promise<TReturn>`

Synchronous wrapper that waits for completion.

```typescript
class MyDispatcher extends AddMixins(EntityNode, RunnableEntityMixin, EntityDispatcherMixin) {
  protected async *run_impl() {
    const result = await this.run_dispatch('analyzeData', { data: 'input' });
    return result;
  }
}
```

---

## Core Concepts

### Dispatch Functions Map

Define which functions can be dispatched and which entity class handles each.

```typescript
interface DispatchFunctionsMap {
  [functionName: string]: {
    entityClass: new (...args: any[]) => InstanceType<...>;
    entityType: string;  // Entity type name
  };
}
```

### Registration via Decorator

```typescript
import { EntityDispatcherDecorator } from '@firebrandanalytics/ff-agent-sdk/entity';

@EntityDispatcherDecorator({
  'analyzeText': {
    entityClass: TextAnalysisEntity,
    entityType: 'TextAnalysis'
  },
  'analyzeImage': {
    entityClass: ImageAnalysisEntity,
    entityType: 'ImageAnalysis'
  },
  'synthesizeData': {
    entityClass: DataSynthesisEntity,
    entityType: 'DataSynthesis'
  }
})
class AnalysisDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {
  // Dispatcher implementation
}
```

### Dispatch Edges

When a dispatcher dispatches to another entity, a **Dispatch edge** is created:

```
DispatcherEntity
    ↓ [Dispatch edge: function_name = "analyzeText"]
TextAnalysisEntity
```

These edges:
- **Enable reuse detection** - Same function name reuses same entity
- **Provide traceability** - Track which function was called
- **Support deduplication** - Multiple dispatches to same function use same target

---

## Basic Usage

### Step 1: Define Target Entities

```typescript
// Entities that will be dispatched to

interface AnalysisOutput {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  summary: string;
}

class SentimentAnalysisEntity extends RunnableEntity<SentimentAnalysisRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const text = dto.data.text;

    const result = await analyzeSentiment(text);

    return {
      sentiment: result.sentiment,
      confidence: result.confidence,
      summary: `Text is ${result.sentiment} with ${result.confidence * 100}% confidence`
    };
  }
}

class EntityExtractionEntity extends RunnableEntity<EntityExtractionRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const text = dto.data.text;

    const entities = await extractEntities(text);

    return {
      entities: entities.map(e => ({ name: e.name, type: e.type })),
      total_count: entities.length
    };
  }
}
```

### Step 2: Create the Dispatcher

```typescript
import { EntityDispatcherDecorator } from '@firebrandanalytics/ff-agent-sdk/entity';

@EntityDispatcherDecorator({
  'sentiment': {
    entityClass: SentimentAnalysisEntity,
    entityType: 'SentimentAnalysis'
  },
  'entities': {
    entityClass: EntityExtractionEntity,
    entityType: 'EntityExtraction'
  }
})
class TextAnalysisDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
)<[
  EntityNode,
  RunnableEntityMixin<TextAnalysisDispatcherRETH>,
  EntityDispatcherMixin<TextAnalysisDispatcherRETH>
]> {

  constructor(factory: EntityFactory, idOrDto: string | EntityDTO) {
    super(
      [factory, idOrDto],
      [],
      []
    );
  }

  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as { text: string; analysis_type: string };

    // Route based on analysis_type
    if (data.analysis_type === 'sentiment') {
      const result = yield* this._dispatch('sentiment', { text: data.text });
      return { type: 'sentiment', data: result };
    } else if (data.analysis_type === 'entities') {
      const result = yield* this._dispatch('entities', { text: data.text });
      return { type: 'entities', data: result };
    } else {
      throw new Error(`Unknown analysis type: ${data.analysis_type}`);
    }
  }
}
```

### Step 3: Use the Dispatcher

```typescript
const factory = new EntityFactory();

const dispatcher = await factory.create_entity_node({
  specific_type_name: 'TextAnalysisDispatcher',
  data: {
    text: 'FireFoundry is amazing!',
    analysis_type: 'sentiment'
  }
});

const generator = dispatcher.run();
const result = await generator;  // Or iterate for progress

console.log(result);
// {
//   type: 'sentiment',
//   data: {
//     sentiment: 'positive',
//     confidence: 0.95,
//     summary: 'Text is positive with 95% confidence'
//   }
// }
```

---

## Advanced Patterns

### Pattern 1: Multi-Step Conditional Routing

```typescript
@EntityDispatcherDecorator({
  'validate': { entityClass: ValidationEntity, entityType: 'Validation' },
  'transform': { entityClass: TransformationEntity, entityType: 'Transformation' },
  'enrich': { entityClass: EnrichmentEntity, entityType: 'Enrichment' },
  'export': { entityClass: ExportEntity, entityType: 'Export' }
})
class DataProcessingPipeline extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data;

    // Step 1: Always validate
    const validated = yield* this._dispatch('validate', { data });

    if (!validated.is_valid) {
      return { status: 'failed', reason: 'validation_error', errors: validated.errors };
    }

    // Step 2: Transform
    const transformed = yield* this._dispatch('transform', {
      data: validated.data,
      config: data.transform_config
    });

    // Step 3: Conditionally enrich
    if (data.should_enrich) {
      const enriched = yield* this._dispatch('enrich', {
        data: transformed.data,
        enrichment_type: data.enrichment_type
      });

      // Step 4: Export enriched data
      const result = yield* this._dispatch('export', {
        data: enriched.data,
        format: data.export_format
      });

      return { status: 'success', exported: result };
    } else {
      // Step 4: Export without enrichment
      const result = yield* this._dispatch('export', {
        data: transformed.data,
        format: data.export_format
      });

      return { status: 'success', exported: result };
    }
  }
}
```

### Pattern 2: Dispatcher Reuse

When you dispatch to the same function multiple times, the dispatcher reuses the same target entity:

```typescript
@EntityDispatcherDecorator({
  'process': { entityClass: ProcessingEntity, entityType: 'Processing' }
})
class BatchProcessor extends AddMixins(EntityNode, RunnableEntityMixin, EntityDispatcherMixin) {

  protected async *run_impl() {
    const dto = await this.get_dto();
    const items = dto.data.items as Array<{ id: string; data: any }>;

    const results = [];

    for (const item of items) {
      // All these dispatch calls target the SAME ProcessingEntity
      // (same entity reused for each item)
      const result = yield* this._dispatch('process', { item });
      results.push(result);
    }

    return { processed: results.length, results };
  }
}
```

**Important**: Reusing the same entity for multiple dispatches means:
- Results from one dispatch might influence the next (entity state)
- If you need independence, consider separate function names or different dispatchers

### Pattern 3: Dispatcher Composition (Dispatcher Dispatching to Dispatcher)

```typescript
@EntityDispatcherDecorator({
  'analyze': { entityClass: AnalysisDispatcher, entityType: 'AnalysisDispatcher' },
  'export': { entityClass: ExportDispatcher, entityType: 'ExportDispatcher' }
})
class MasterOrchestrator extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    // Dispatch to AnalysisDispatcher (which itself dispatches)
    const analysisResult = yield* this._dispatch('analyze', {
      analysis_type: 'sentiment',
      data: 'input'
    });

    // Dispatch to ExportDispatcher (which itself dispatches)
    const exportResult = yield* this._dispatch('export', {
      format: 'json',
      data: analysisResult
    });

    return exportResult;
  }
}
```

### Pattern 4: Conditional Routing Based on Input Characteristics

```typescript
@EntityDispatcherDecorator({
  'process_text': { entityClass: TextProcessor, entityType: 'TextProcessor' },
  'process_image': { entityClass: ImageProcessor, entityType: 'ImageProcessor' },
  'process_video': { entityClass: VideoProcessor, entityType: 'VideoProcessor' }
})
class ContentTypeRouter extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const content = dto.data.content;
    const contentType = this.detectContentType(content);

    switch (contentType) {
      case 'text':
        return yield* this._dispatch('process_text', { content });
      case 'image':
        return yield* this._dispatch('process_image', { content });
      case 'video':
        return yield* this._dispatch('process_video', { content });
      default:
        throw new Error(`Unknown content type: ${contentType}`);
    }
  }

  private detectContentType(content: any): string {
    if (typeof content === 'string') return 'text';
    if (content.type?.startsWith('image')) return 'image';
    if (content.type?.startsWith('video')) return 'video';
    return 'unknown';
  }
}
```

### Pattern 5: Fallback Routing

Try primary dispatcher, fall back to secondary on failure:

```typescript
@EntityDispatcherDecorator({
  'primary': { entityClass: PrimaryService, entityType: 'PrimaryService' },
  'fallback': { entityClass: FallbackService, entityType: 'FallbackService' }
})
class ResilientRouter extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    const dto = await this.get_dto();

    try {
      // Try primary service
      return yield* this._dispatch('primary', dto.data);
    } catch (error) {
      console.log('Primary service failed, trying fallback:', error);

      // Fall back to secondary service
      return yield* this._dispatch('fallback', dto.data);
    }
  }
}
```

---

## Type Safety

### Defining Dispatcher Types

```typescript
// Input type for the dispatcher
interface ContentRouterData {
  content: any;
  routing_rules: { [key: string]: string };  // Map content type to function name
}

// Output type from the dispatcher
interface ContentRouterOutput {
  result: any;
  function_used: string;
  processing_time_ms: number;
}

// Define the type helper
type ContentRouterRETH = RunnableEntityTypeHelper<
  ContentRouterData,
  ContentRouterOutput,
  unknown,
  unknown,
  unknown
>;

// Use in dispatcher
class ContentRouter extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
)<[
  EntityNode,
  RunnableEntityMixin<ContentRouterRETH>,
  EntityDispatcherMixin<ContentRouterRETH>
]> {
  // Implementation with type safety
}
```

### Type-Safe Dispatch Function Map

```typescript
// Define target entity types
interface TextProcessorRETH extends RunnableEntityTypeHelper</* ... */> {}
interface ImageProcessorRETH extends RunnableEntityTypeHelper</* ... */> {}

// Ensure dispatcher knows about these types
type ContentProcessorEntityTypeHelper = EntityTypeHelper<
  'TextProcessor' | 'ImageProcessor',
  {
    TextProcessor: typeof TextProcessor;
    ImageProcessor: typeof ImageProcessor;
  }
>;

// Dispatcher with proper typing
@EntityDispatcherDecorator({
  'text': { entityClass: TextProcessor, entityType: 'TextProcessor' },
  'image': { entityClass: ImageProcessor, entityType: 'ImageProcessor' }
})
class ContentProcessor extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {
  // Type-safe dispatch
  protected async *run_impl() {
    const result: any = yield* this._dispatch('text', { data: 'input' });
    return result;
  }
}
```

---

## Real-World Examples

### Example 1: Multi-Tenant Analysis Service

```typescript
interface TenantRequest {
  tenant_id: string;
  data: any;
  analysis_type: string;
}

// Different analysis implementations per tenant
class TenantAAnalyzer extends RunnableEntity<TenantAAnalyzerRETH> {
  protected async *run_impl() {
    // Tenant A specific analysis logic
    const result = await tenantACustomAnalysis(this.dto.data);
    return result;
  }
}

class TenantBAnalyzer extends RunnableEntity<TenantBAnalyzerRETH> {
  protected async *run_impl() {
    // Tenant B specific analysis logic
    const result = await tenantBCustomAnalysis(this.dto.data);
    return result;
  }
}

@EntityDispatcherDecorator({
  'tenant_a_analyze': { entityClass: TenantAAnalyzer, entityType: 'TenantAAnalyzer' },
  'tenant_b_analyze': { entityClass: TenantBAnalyzer, entityType: 'TenantBAnalyzer' }
})
class MultiTenantDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as TenantRequest;

    // Route to tenant-specific implementation
    const functionName = `${data.tenant_id}_analyze`;

    const result = yield* this._dispatch(functionName, {
      data: data.data,
      analysis_type: data.analysis_type
    });

    return { tenant_id: data.tenant_id, result };
  }
}
```

### Example 2: A/B Testing Dispatcher

```typescript
interface ABTestRequest {
  user_id: string;
  variant: 'A' | 'B';
  data: any;
}

class VariantAProcessor extends RunnableEntity<VariantARETH> {
  protected async *run_impl() {
    // Variant A processing
    return processWithVariantA(this.dto.data);
  }
}

class VariantBProcessor extends RunnableEntity<VariantBRETH> {
  protected async *run_impl() {
    // Variant B processing (experimental)
    return processWithVariantB(this.dto.data);
  }
}

@EntityDispatcherDecorator({
  'process_variant_a': { entityClass: VariantAProcessor, entityType: 'VariantA' },
  'process_variant_b': { entityClass: VariantBProcessor, entityType: 'VariantB' }
})
class ABTestDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as ABTestRequest;

    const functionName = `process_variant_${data.variant.toLowerCase()}`;

    const result = yield* this._dispatch(functionName, data.data);

    // Track which variant was used for analytics
    await recordABTestEvent({
      user_id: data.user_id,
      variant: data.variant,
      result: result
    });

    return { variant: data.variant, result };
  }
}
```

### Example 3: Feature-Flag Routing

```typescript
interface FeatureFlagRequest {
  user_id: string;
  feature_flags: { [key: string]: boolean };
  data: any;
}

class EnhancedProcessor extends RunnableEntity<EnhancedProcessorRETH> {
  protected async *run_impl() {
    // New enhanced algorithm
    return await enhancedProcessing(this.dto.data);
  }
}

class LegacyProcessor extends RunnableEntity<LegacyProcessorRETH> {
  protected async *run_impl() {
    // Fallback to legacy algorithm
    return await legacyProcessing(this.dto.data);
  }
}

@EntityDispatcherDecorator({
  'process_enhanced': { entityClass: EnhancedProcessor, entityType: 'Enhanced' },
  'process_legacy': { entityClass: LegacyProcessor, entityType: 'Legacy' }
})
class FeatureFlagDispatcher extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  EntityDispatcherMixin
) {

  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as FeatureFlagRequest;

    // Check feature flag
    const useEnhanced = data.feature_flags['enhanced_algorithm'] ?? false;
    const functionName = useEnhanced ? 'process_enhanced' : 'process_legacy';

    const result = yield* this._dispatch(functionName, data.data);

    return {
      algorithm: useEnhanced ? 'enhanced' : 'legacy',
      result
    };
  }
}
```

---

## Troubleshooting

### Issue 1: "Unknown function" Error

**Problem**: Dispatcher throws error about unknown function

**Cause**: Function name not registered in `@EntityDispatcherDecorator`

**Solution**:
```typescript
@EntityDispatcherDecorator({
  'process': { entityClass: Processor, entityType: 'Processor' }
  // Add missing function:
  // 'analyze': { entityClass: Analyzer, entityType: 'Analyzer' }
})
class Dispatcher extends AddMixins(EntityNode, RunnableEntityMixin, EntityDispatcherMixin) { }
```

### Issue 2: Function Name Not Found

**Problem**: Dispatcher tries to call function that doesn't exist in decorator

**Debug**:
```typescript
protected async *run_impl() {
  const functionName = 'unknown_function';

  // Check if function exists before dispatching
  const dispatchMap = (this.constructor as any).dispatchFunctions;
  if (!dispatchMap[functionName]) {
    throw new Error(`Function not registered: ${functionName}`);
  }

  return yield* this._dispatch(functionName, {});
}
```

### Issue 3: Entity Reuse Not Happening

**Problem**: Different function names create multiple entities instead of reusing

**Expected Behavior**:
- Same function name = same entity reused
- Different function names = different entities

**Solution** - Use same function name for same target:
```typescript
// DON'T do this:
yield* this._dispatch('analyze_1', data);  // Creates entity_1
yield* this._dispatch('analyze_2', data);  // Creates entity_2

// DO this instead:
yield* this._dispatch('analyze', data);    // Reuses same entity
yield* this._dispatch('analyze', data2);   // Reuses same entity
```

### Issue 4: Dispatch Edges Not Created

**Problem**: Graph doesn't show dispatch history

**Check**:
```typescript
// Get all dispatch edges from dispatcher
const edges = await dispatcher.get_edges('from', 'Dispatch');
console.log('Dispatch edges:', edges.length);

// Check edge contains function name
for (const edge of edges) {
  const edgeDto = await edge.get_dto();
  console.log('Function:', edgeDto.data?.function_name);
}
```

### Issue 5: Memory Issues with Many Dispatches

**Problem**: Too many dispatch edges or reused entities growing in size

**Solution**:
- Limit number of unique function names
- Clean up old entities periodically
- Use separate dispatchers for different logical workflows
- Monitor entity sizes: `entity.get_dto().data.size()`

---

## Summary

The Entity Dispatcher enables dynamic, flexible routing:

- **Define functions** via `@EntityDispatcherDecorator`
- **Dispatch dynamically** with `_dispatch(functionName, args)`
- **Reuse entities** via Dispatch edge deduplication
- **Compose dispatchers** - dispatchers can dispatch to other dispatchers
- **Persist routing** - decisions tracked in graph edges

Key patterns:
1. **Conditional routing** - Route based on input/state
2. **Multi-tenant** - Different implementations per tenant
3. **Feature flags** - Route based on enabled features
4. **A/B testing** - Route to different variants
5. **Fallback** - Try primary, fall back on failure
6. **Composition** - Nested dispatchers

For more information on entities and mixins, see [Entities Guide](../core/entities.md) and [Mixins & Composition](../utils/mixins.md).
