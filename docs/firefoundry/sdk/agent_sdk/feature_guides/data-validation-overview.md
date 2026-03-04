# Data Validation Library Overview

## What Is It?

The FireFoundry Data Validation Library (`@firebrandanalytics/shared-utils/validation`) is a decorator-based system for transforming messy, unstructured data into clean, typed class instances. It handles the full pipeline from raw input to trusted output: coercion, normalization, validation, AI-powered transformation, and structured error reporting.

Unlike traditional validation libraries that simply reject bad data, this library **transforms first, then validates**. A string `"five"` becomes the number `5`. An email `"  JOHN@EXAMPLE.COM  "` becomes `"john@example.com"`. A misspelled category `"hikking"` fuzzy-matches to `"hiking"`. If all else fails, an AI decorator can repair the value.

The library is standalone — it works with or without the Agent SDK. But it integrates deeply with agent bundles, bots, and entities when used in the FireFoundry platform.

## When to Use It

| Scenario | Example |
|----------|---------|
| **Cleaning LLM output** | An LLM returns `{ "quantity": "five", "email": "  JOHN@EXAMPLE.COM  " }`. Coerce, trim, validate. |
| **Normalizing supplier data** | Multiple suppliers send product data in different formats. One pipeline handles all of them. |
| **Validating user input** | Form submissions need trimming, type coercion, range checks, and pattern matching. |
| **AI-powered data extraction** | Unstructured text needs to be classified, summarized, or translated as part of a validation pipeline. |
| **Cross-field business rules** | Cost must be less than MSRP. Size format depends on product category. |

## Architecture

```
Raw Input (JSON, CSV, LLM output, user form)
        │
        ▼
┌─────────────────────────────────────────────┐
│              ValidationFactory              │
│  ┌───────────────────────────────────────┐  │
│  │         Decorator Pipeline            │  │
│  │                                       │  │
│  │  1. Data Source    @DerivedFrom,       │  │
│  │     Decorators     @Copy, @Staging    │  │
│  │         │                             │  │
│  │         ▼                             │  │
│  │  2. Coercion       @CoerceTrim,       │  │
│  │     Decorators     @CoerceType,       │  │
│  │         │          @CoerceCase        │  │
│  │         ▼                             │  │
│  │  3. Normalization  @NormalizeText,     │  │
│  │     Decorators     EmailNormalizer    │  │
│  │         │                             │  │
│  │  4. AI             @AITransform,      │  │
│  │     Decorators     @AIClassify,       │  │
│  │         │          @AIExtract         │  │
│  │         ▼                             │  │
│  │  5. Validation     @ValidateRequired, │  │
│  │     Decorators     @ValidateRange,    │  │
│  │         │          @CrossValidate     │  │
│  │         ▼                             │  │
│  │  6. Conditional    @If / @Else /      │  │
│  │     Logic          @EndIf             │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌────────────────┐  ┌─────────────────┐   │
│  │  Execution     │  │  Dependency     │   │
│  │  Engine        │  │  Graph          │   │
│  │                │  │                 │   │
│  │ • Convergent   │  │ Resolves field  │   │
│  │   (default)    │  │ ordering auto-  │   │
│  │ • Single-pass  │  │ matically       │   │
│  └────────────────┘  └─────────────────┘   │
│                                             │
│  Output: Typed class instance + trace       │
└─────────────────────────────────────────────┘
```

### Key Architectural Concepts

**Decorator Pipeline.** Each property on a class gets a stack of decorators that run top-to-bottom. The pipeline transforms the raw value through coercion, normalization, and validation stages before producing the final value.

**Two Execution Engines.** The convergent engine (default) iteratively processes properties until all values stabilize — handling circular dependencies between fields. The single-pass engine (`@UseSinglePassValidation()`) processes each property exactly once in dependency order, which is faster when fields don't depend on each other cyclically.

**Automatic Dependency Graph.** When one field's validation depends on another field's value (e.g., size format depends on category), the engine automatically resolves the dependency ordering. You declare what depends on what; the engine figures out the execution order.

**CSS-Like Cascade.** Default transforms can be set at the factory level (like CSS defaults), overridden at the class level (like element styles), and specialized at the property level (like inline styles). This eliminates repetitive decorator stacks across similar properties.

**Validation Trace.** Every transformation is recorded in a trace object, showing what the raw value was, what each decorator did, and what the final value became. This is invaluable for debugging and for showing users exactly how their data was processed.

## Decorator Categories

The library organizes its 50+ decorators into six categories. Each category has a specific role in the pipeline.

### 1. Coercion Decorators — Fix the Type and Format

Transform values into the expected type and format without rejecting them.

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@CoerceType('number')` | Convert between types | `"42"` → `42` |
| `@CoerceTrim()` | Remove whitespace | `"  hello  "` → `"hello"` |
| `@CoerceCase('lower')` | Change string case | `"HELLO"` → `"hello"` |
| `@CoerceFormat(fmt)` | Apply format template | Date formatting |
| `@CoerceParse('json')` | Parse structured strings | `'{"a":1}'` → `{a: 1}` |
| `@CoerceRound(2)` | Round numbers | `3.14159` → `3.14` |
| `@CoerceFromSet(set)` | Fuzzy-match to canonical values | `"hikking"` → `"hiking"` |

**When to use:** Your data is semantically correct but in the wrong format. You want to fix it, not reject it.

See: [Getting Started Guide](../../utils/validation/validation-library-getting-started.md) for basic coercion patterns.

### 2. Validation Decorators — Reject Bad Data

Assert that values meet constraints. If they don't, the pipeline reports an error.

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@ValidateRequired()` | Field must be present | Rejects `undefined` / `null` |
| `@ValidateLength(min, max)` | String/array length bounds | `"ab"` fails `min: 3` |
| `@ValidatePattern(/regex/)` | Regex match | Email format check |
| `@ValidateRange(min, max)` | Numeric bounds | Price must be 0–9999 |
| `@CrossValidate(fn)` | Multi-field rules | Cost < MSRP |

**When to use:** The data has been coerced to the right type, now enforce business rules.

See: [Reference Guide — Validation Decorators](../../utils/validation/validation-library-reference.md#validation-decorators) for full API details.

### 3. AI Decorators — LLM-Powered Transformation

Use a large language model to transform or validate values that rule-based decorators can't handle.

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@AITransform(prompt)` | Generic AI transformation | Rewrite product description |
| `@AIClassify(categories)` | Classify into categories | Free text → `"hiking"` / `"running"` |
| `@AIExtract(schema)` | Extract structured data | Paragraph → `{name, price, color}` |
| `@AISummarize(opts)` | Summarize text | Long description → one sentence |
| `@AISpellCheck()` | Fix spelling | `"recieve"` → `"receive"` |
| `@AIJSONRepair()` | Fix malformed JSON | Missing quotes, trailing commas |
| `@AICatchRepair()` | AI-powered error recovery | Fix validation failures with LLM |

**When to use:** Rule-based decorators can't handle the transformation. You need semantic understanding.

**Cost consideration:** AI decorators call an LLM for every value they process. Use them selectively — apply rule-based decorators first and reserve AI for values that genuinely need it.

See: [Getting Started — AI Transformations](../../utils/validation/validation-library-getting-started.md) (Section 5) for setup and usage.

### 4. Data Source Decorators — Control Where Values Come From

Map properties to specific paths in the raw input or derive values from other fields.

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@DerivedFrom(path)` | Extract from nested input | `order.details.id` → `orderId` |
| `@Copy()` | Preserve original value alongside transforms | Staging raw values |
| `@Staging(name)` | Store intermediate values | Pre-coercion snapshots |
| `@JSONPath(expr)` | JSONPath extraction | `$.items[0].name` |

**When to use:** The raw input structure doesn't match your class structure.

See: [Intermediate Guide — Declarative Reparenting](../../utils/validation/validation-library-intermediate.md) for reshaping patterns.

### 5. Conditional Decorators — Branch the Pipeline

Apply different validation rules based on field values.

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@If(condition)` | Start conditional block | `@If(ctx => ctx.category === 'hiking')` |
| `@ElseIf(condition)` | Alternative condition | Different rule for running shoes |
| `@Else()` | Default branch | Fallback validation |
| `@EndIf()` | End conditional block | Required to close the block |

**When to use:** Different product types, regions, or categories need different validation rules.

See: [Catalog Intake Tutorial Part 7](../tutorials/catalog-intake/part-07-rules-variants.md) for a real-world conditional validation example.

### 6. Class-Level Decorators — Configure the Whole Class

Control how the entire class is validated, not just individual properties.

| Decorator | Purpose |
|-----------|---------|
| `@Serializable()` | Enable serialization/deserialization |
| `@UseSinglePassValidation()` | Use single-pass engine instead of convergent |
| `@Discriminator(field)` | Mark the routing field for discriminated unions |
| `@DiscriminatedUnion(map)` | Route to different classes based on discriminator value |
| `@UseStyle(name)` | Apply a named validation style |
| `@DefaultTransforms(config)` | Set type-level defaults for all properties |

**When to use:** You need to control execution mode, set up discriminated unions for multi-format pipelines, or apply consistent defaults across all properties.

See: [Advanced Guide — Validation Engines](../../utils/validation/validation-library-advanced.md) for engine selection guidance.

## Integration with Agent SDK

The validation library works standalone, but it shines when integrated with agent bundles:

### Post-Processing Bot Output

```typescript
import { ValidationFactory, CoerceTrim, ValidateRequired } from '@firebrandanalytics/shared-utils/validation';

class BotOutput {
  @CoerceTrim()
  @ValidateRequired()
  summary!: string;

  @CoerceType('number')
  @ValidateRange(0, 1)
  confidence!: number;
}

// In your entity's run_impl:
const factory = new ValidationFactory();
const raw = await this.runBot('AnalysisBot', input);
const validated = await factory.create(BotOutput, raw);
```

### Multi-Format Data Pipelines

Use discriminated unions to handle multiple input formats through one pipeline:

```typescript
@Serializable()
class SupplierProductDraft {
  @Discriminator('supplier_schema')
  supplier_schema!: string;
}

@DiscriminatedUnion({
  discriminatorField: 'supplier_schema',
  map: {
    v1_api: SupplierProductV1,
    v2_csv: SupplierProductV2,
  },
})
class SupplierProductDraft { /* ... */ }

// One factory call handles any format:
const product = await factory.create(SupplierProductDraft, rawInput);
// Returns SupplierProductV1 or V2 depending on supplier_schema
```

### Validation Trace for Debugging

```typescript
const validated = await factory.create(ProductClass, rawInput);
const trace = factory.getLastTrace();

// Store trace alongside the entity data for auditing
await entity.update_data({
  validated_product: validated,
  validation_trace: trace,
});
```

See: [Validation Integration Patterns](./validation-integration-patterns.md) for the full set of bot/entity integration patterns.

## Performance Considerations

- **Single-pass vs. convergent:** Use `@UseSinglePassValidation()` when your fields don't have circular dependencies. It processes each field exactly once, which is significantly faster for large classes.
- **AI decorator cost:** Each AI decorator invokes an LLM call. For batch processing, consider batching at a higher level rather than decorating every field with `@AITransform`.
- **Factory reuse:** Create one `ValidationFactory` instance and reuse it across validations. The factory caches class metadata after the first call.
- **Discriminated unions:** The factory only instantiates the matching branch class, so unused branches add zero runtime cost.

## Documentation Map

| Resource | Purpose | Start Here If... |
|----------|---------|-------------------|
| [Getting Started Guide](../../utils/validation/validation-library-getting-started.md) | Core concepts, first validated class, AI decorators | You're new to the library |
| [Intermediate Guide](../../utils/validation/validation-library-intermediate.md) | Reparenting, context injection, scaling patterns | You've built basic validators |
| [Advanced Guide](../../utils/validation/validation-library-advanced.md) | Engine internals, edge cases, convergent vs. single-pass | You're debugging complex pipelines |
| [API Reference](../../utils/validation/validation-library-reference.md) | Complete decorator signatures and options | You need parameter details |
| [Integration Patterns](./validation-integration-patterns.md) | Using validation with bots and entities | You're building an agent bundle |
| [Catalog Intake Tutorial](../tutorials/catalog-intake/README.md) | 10-part tutorial building a real validation pipeline | You learn best by example |

## See Also

- [Bot Tutorial](../core/bot_tutorial.md) — Building bots that produce structured output
- [Workflow Orchestration Guide](./workflow_orchestration_guide.md) — Multi-step pipelines that include validation
- [Advanced Bot Mixin Patterns](./advanced-bot-mixin-patterns.md) — DataValidationBotMixin for bot-level validation
