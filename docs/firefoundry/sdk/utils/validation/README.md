# Data Validation Library

A decorator-based data validation and transformation library for TypeScript. Define clean, validated class instances from messy input data using 50+ decorators for coercion, validation, AI-powered transforms, fuzzy matching, and conditional processing.

## Installation

```typescript
import {
    ValidationFactory,
    // Coercion
    Coerce, CoerceType, CoerceTrim, CoerceCase, CoerceRound,
    CoerceFromSet, CoerceParse, CoerceFormat, CoerceArrayElements,
    // Validation
    Validate, ValidateRequired, ValidateRange, ValidateLength, ValidatePattern,
    ValidateAsync, CrossValidate, ObjectRule,
    // Data sourcing
    Copy, DerivedFrom, CollectProperties, Merge, Staging,
    // Text normalization
    NormalizeText, NormalizeTextChain,
    // AI-powered transforms
    AITransform, AIValidate,
    AITranslate, AIRewrite, AISummarize, AIClassify, AIExtract, AISpellCheck, AIJSONRepair,
    Catch, AICatchRepair,
    // Structural
    ValidatedClass, ValidatedClassArray, DiscriminatedUnion, Discriminator,
    Keys, Values, RecursiveKeys, RecursiveValues,
    If, ElseIf, Else, EndIf,
    Map, Filter, Join,
    // Configuration
    UseStyle, DefaultTransforms, ManageAll, MatchingStrategy,
    UseSinglePassValidation, UseConvergentValidation,
    DependsOn, Examples,
} from '@firebrandanalytics/shared-utils/validation';
```

## Quick Examples

**Clean messy LLM output** — normalize types, trim whitespace, fix casing:
```typescript
class Order {
    @ValidateRequired()
    @CoerceTrim()
    @CoerceCase('upper')
    sku: string;

    @CoerceType('number')
    @ValidateRange(1, 10000)
    quantity: number;

    @CoerceTrim()
    @CoerceCase('lower')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    customerEmail: string;
}

const order = await factory.create(Order, {
    sku: '  widget-a ', quantity: 'fifty', customerEmail: '  JOHN@EXAMPLE.COM  '
});
// { sku: 'WIDGET-A', quantity: 50, customerEmail: 'john@example.com' }
```

**Fuzzy-match against a known set** — correct misspellings using runtime context:
```typescript
class ProductOrder {
    @CoerceFromSet<CatalogContext>(
        ctx => ctx.productNames,
        { strategy: 'fuzzy', threshold: 0.7 }
    )
    product: string;
}

const result = await factory.create(ProductOrder, { product: 'macbok pro' }, {
    context: { productNames: ['MacBook Pro', 'MacBook Air', 'iPad Pro'] }
});
// { product: 'MacBook Pro' }
```

**AI-powered content pipeline** — classify, summarize, and translate in one class:
```typescript
class ArticleProcessing {
    @AISpellCheck()
    content: string;

    @DerivedFrom('content')
    @AISummarize('short')
    summary: string;

    @DerivedFrom('content')
    @AIClassify(['Technology', 'Business', 'Science', 'Sports'])
    category: string;

    @DerivedFrom('summary')
    @AITranslate('Spanish')
    summaryEs: string;
}
```

## Documentation

### Concepts

| Document | Description |
|----------|-------------|
| [Conceptual Guide](./concepts.md) | Design philosophy, decorator pipeline model, engine selection, dependency graphs, AI integration |

### Tutorials

| Document | Description |
|----------|-------------|
| [Getting Started](./validation-library-getting-started.md) | Your first validated class, ValidationFactory basics, error handling, domain objects |
| [Intermediate Guide](./validation-library-intermediate.md) | DerivedFrom, context decorators, conditionals, fuzzy matching, parsing, AI helpers, discriminated unions |
| [Advanced Guide](./validation-library-advanced.md) | Convergent engine, dependency graphs, advanced coercion, conditional mechanics, AI retry loops, inheritance, performance |
| [API Reference](./validation-library-reference.md) | Complete decorator reference with signatures, options, and examples |

### Use Cases

| Document | Description |
|----------|-------------|
| [LLM Output Canonicalization](./use-cases/llm-output-canonicalization.md) | Clean and normalize structured data extracted by LLMs with type coercion, trimming, and pattern validation |
| [Fuzzy Inventory Matching](./use-cases/fuzzy-inventory-matching.md) | Match misspelled product names, status values, and categories against a database using fuzzy strategies |
| [Multi-Format Data Ingestion](./use-cases/multi-format-data-ingestion.md) | Parse JSON, currency, and locale-specific number formats from heterogeneous data sources |
| [Schema Version Migration](./use-cases/schema-version-migration.md) | Handle evolving data schemas with discriminated unions and version-specific transformation classes |
| [Cross-Property Validation](./use-cases/cross-property-validation.md) | Validate interdependent fields like order totals, date ranges, and conditional requirements |
| [AI Content Pipeline](./use-cases/ai-content-pipeline.md) | Chain AI presets to translate, summarize, classify, and spell-check content in one declarative class |
| [Recursive API Normalization](./use-cases/recursive-api-normalization.md) | Normalize deeply nested third-party API responses with inconsistent key casing and whitespace |
| [Error Recovery and Repair](./use-cases/error-recovery-and-repair.md) | Graceful degradation with @Catch fallbacks and @AICatchRepair for AI-powered error recovery |

### Runnable Examples

Self-contained TypeScript programs demonstrating each use case. See the [`examples/`](./examples/) directory.

```bash
cd examples && npm install
npx tsx llm-output-canonicalization.ts
npx tsx fuzzy-inventory-matching.ts
npx tsx multi-format-data-ingestion.ts
npx tsx schema-version-migration.ts
npx tsx cross-property-validation.ts
npx tsx ai-content-pipeline.ts
npx tsx recursive-api-normalization.ts
npx tsx error-recovery-and-repair.ts
```

### Platform Integration

| Document | Description |
|----------|-------------|
| [Agent SDK Integration Patterns](../../../agent_sdk/feature_guides/validation-integration-patterns.md) | Using the validation library with FireFoundry bots, entities, and workflows |
