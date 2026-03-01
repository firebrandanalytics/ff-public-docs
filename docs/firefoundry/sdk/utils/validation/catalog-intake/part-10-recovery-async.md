> **DEPRECATED** — See the [current tutorial](../../../agent_sdk/tutorials/catalog-intake/README.md).

# Part 10: Recovery + Async Validation

Build resilient validation pipelines with graceful error recovery, AI-powered repair, and asynchronous validation against live services.

---

## The Problem: Validation Failures Shouldn't Always Be Fatal

Throughout Parts 1-9, a single validation failure throws a `ValidationError` and halts the pipeline. For a batch import of 500 products from a supplier, this means one bad record kills the entire submission.

In practice, you want more nuance:

1. **Graceful degradation** — If the color field can't be matched, save the product anyway with a "review needed" flag rather than rejecting the entire record.
2. **AI-powered repair** — If a date format is unexpected, let an LLM try to fix it before giving up.
3. **Async validation** — Check if a SKU already exists in the database before importing. This requires an async database call, not a synchronous string check.

These scenarios require a different philosophy: **recover when possible, flag when uncertain, reject only when necessary.**

## @Catch — Graceful Fallback on Failure

`@Catch` intercepts coercion or validation errors on a property and lets you provide a fallback value or custom recovery logic instead of throwing.

### Basic Fallback Value

```typescript
import {
  Catch,
  CoerceFromSet,
  CoerceTrim,
  CoerceCase,
  DerivedFrom,
} from '@firebrandanalytics/shared-utils/validation';

class ResilientDraft {
  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.colors,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  @Catch((err, value, ctx) => {
    // Fuzzy match failed — return the raw value and flag for review
    return value;
  })
  color_variant: string;
}
```

When the fuzzy match for `color` fails (input `"neon green"` doesn't match any canonical color above the threshold), `@Catch` intercepts the error and returns the raw value. The pipeline continues with the unmatched color rather than throwing.

### Recovery with Context

The `@Catch` callback receives three arguments:

- **`err`** — The `ValidationError` that was thrown
- **`value`** — The property's current value (after coercions that succeeded)
- **`ctx`** — Context object with `{ raw, instance, context }` for accessing the full state

```typescript
@Catch((err, value, ctx) => {
  // Log the failure for the validation run record
  ctx.instance._recoveries = ctx.instance._recoveries || [];
  ctx.instance._recoveries.push({
    field: 'color_variant',
    originalValue: value,
    error: err.message,
    resolution: 'kept_raw_value'
  });
  return value;  // Return the raw value — product still gets imported
})
color: string;
```

This pattern records recovery decisions in a `_recoveries` array on the instance, which can later be written to `supplier_validation_runs.error_details` for audit purposes.

### Choosing Between Recovery and Rejection

Sometimes you want to recover for some errors but reject for others:

```typescript
@Catch((err, value, ctx) => {
  // Ambiguity errors → recover with the top candidate
  if (err instanceof CoercionAmbiguityError) {
    return err.candidates[0].value;  // Pick the best match
  }
  // Everything else → rethrow (don't recover)
  throw err;
})
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,
  { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
)
category: string;
```

If the category fuzzy match is ambiguous (two equally-close matches), we pick the top candidate and move on. If the match fails entirely (nothing above threshold), we rethrow the error and the pipeline halts.

## @AICatchRepair — AI-Powered Error Recovery

`@AICatchRepair` combines `@Catch` with `@AITransform` — when a coercion or validation error occurs, it sends the error details to an LLM and asks it to repair the value. The repaired value then re-runs through all subsequent decorators on the property.

### Basic AI Repair

```typescript
import { AICatchRepair, CoerceParse, Validate } from '@firebrandanalytics/shared-utils/validation';

class DateProcessor {
  @AICatchRepair()
  @CoerceParse((val: string) => {
    const d = new Date(val);
    if (isNaN(d.getTime())) throw new Error(`Cannot parse date: ${val}`);
    return d;
  })
  @Validate((d: Date) => d <= new Date(), 'Date cannot be in the future')
  release_date: Date;
}
```

The flow:

1. `@CoerceParse` tries to parse `"March fifteenth, twenty twenty-five"` — it fails because `new Date()` can't handle this format.
2. `@AICatchRepair` catches the error and sends the LLM a prompt like: *"The value 'March fifteenth, twenty twenty-five' failed parsing with error: 'Cannot parse date'. Please return a corrected value."*
3. The LLM returns `"2025-03-15"`.
4. The repaired value re-runs through `@CoerceParse` and `@Validate` — this time it succeeds.

### Custom Repair Prompts

You can provide a custom prompt to give the LLM more context:

```typescript
@AICatchRepair((params) =>
  `The supplier sent "${params.value}" as a size range, but it failed validation: ${params.previousError?.message}. ` +
  `Convert it to the format "min-max" (e.g., "7-13" for numeric sizes or "S-XL" for letter sizes). ` +
  `Return only the corrected size range.`
)
@ValidatePattern(
  /^(\d+(\.\d+)?-\d+(\.\d+)?|(XS|S|M|L|XL|XXL)-(XS|S|M|L|XL|XXL))$/i,
  'Size range must be numeric (7-13) or letter (S-XL) format'
)
size_range: string;
```

If a supplier sends `"sizes 7 to 13"`, the pattern validation fails. The AI repair prompt explains the expected format, and the LLM returns `"7-13"`, which passes the pattern.

### Applying AI Repair to the Full Validator

Here's how `@AICatchRepair` fits into the catalog intake pipeline for fields that commonly have format issues:

```typescript
class SupplierProductDraftV10 {
  // ... standard fields from previous parts ...

  // Size range: AI repairs common format issues
  @DerivedFrom(['$.size_range', '$.specs.sizeRange', '$.SIZE_RANGE'])
  @CoerceTrim()
  @AICatchRepair((params) =>
    `Convert "${params.value}" to a size range in "min-max" format. ` +
    `Examples: "7-13", "5.5-11", "S-XL". Return only the range.`
  )
  @If('category', ['running', 'basketball', 'training'])
    @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/, 'Numeric size range required')
  @ElseIf('category', ['casual', 'skateboarding'])
    @ValidatePattern(/^(XS|S|M|L|XL|XXL)-(XS|S|M|L|XL|XXL)$/i, 'Letter size range required')
  @EndIf()
  size_range: string;

  // Description: AI repairs truncated or garbled text
  @DerivedFrom(['$.description', '$.productInfo.description', '$.DESCRIPTION'])
  @CoerceTrim()
  @AICatchRepair()
  @ValidateLength(10, 2000)
  description: string;
}
```

## @ValidateAsync — Validation Against Live Services

All validators so far run synchronously against in-memory data. But some validations require IO — checking a database, calling an API, or querying a service. `@ValidateAsync` handles asynchronous validation.

### Checking SKU Uniqueness

The most common async validation in catalog intake: ensuring a supplier's SKU doesn't already exist in the database.

```typescript
import { ValidateAsync, CoerceTrim, CoerceCase } from '@firebrandanalytics/shared-utils/validation';

class DraftWithAsyncValidation {
  @DerivedFrom(['$.sku', '$.specs.sku', '$.SKU'])
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateAsync(async (sku, obj) => {
    const existing = await das.query(
      'SELECT draft_id FROM supplier_product_drafts WHERE sku = $1 AND review_status != $2',
      [sku, 'rejected']
    );
    if (existing.rows.length > 0) {
      return `SKU ${sku} already exists in draft ${existing.rows[0].draft_id}`;
    }
    return true;
  }, 'SKU uniqueness check')
  sku: string;
}
```

The async validator function returns a `Promise` that resolves to:
- **`true`** — validation passed
- **`string`** — validation failed with this error message
- **`Error`** — validation failed with this error

### Validating Against External APIs

You can also validate against external services:

```typescript
class DraftWithExternalValidation {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateAsync(async (sku, obj) => {
    try {
      const response = await fetch(`https://inventory-api.firekicks.internal/sku/${sku}`);
      if (response.status === 404) {
        return true;  // SKU doesn't exist yet — that's what we want for new products
      }
      if (response.status === 200) {
        const data = await response.json();
        if (data.status === 'active') {
          return `SKU ${sku} is already active in the catalog`;
        }
        return true;  // SKU exists but is inactive — OK to re-import
      }
      return `Inventory API returned unexpected status ${response.status}`;
    } catch (err) {
      return `Inventory API unreachable: ${err.message}`;
    }
  }, 'Inventory API SKU check')
  sku: string;
}
```

### Combining Async with @Catch

Async validations can fail due to network issues, not just business rule violations. Use `@Catch` to handle infrastructure failures gracefully:

```typescript
class ResilientAsyncDraft {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateAsync(async (sku) => {
    const exists = await das.query(
      'SELECT 1 FROM supplier_product_drafts WHERE sku = $1',
      [sku]
    );
    return exists.rows.length === 0 || `SKU ${sku} already exists`;
  })
  @Catch((err, value, ctx) => {
    // If the DB is unreachable, don't fail the import.
    // Flag for manual review instead.
    ctx.instance._flags = ctx.instance._flags || [];
    ctx.instance._flags.push({
      field: 'sku',
      issue: 'uniqueness_check_skipped',
      reason: err.message
    });
    return value;  // Keep the SKU, flag for review
  })
  sku: string;
}
```

If the database query fails (connection timeout, etc.), the product still gets imported with a flag indicating the uniqueness check was skipped. The review queue picks this up and a human verifies it later.

## The Complete V10 Validator: Production-Grade Pipeline

Here's the final validator class, incorporating error recovery and async validation with everything from Parts 1-9:

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  ValidateRange,
  ValidatePattern,
  ValidateLength,
  ValidateAsync,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  CoerceParse,
  CoerceFromSet,
  Copy,
  DerivedFrom,
  DependsOn,
  If, ElseIf, Else, EndIf,
  ObjectRule,
  CrossValidate,
  Catch,
  AICatchRepair,
  ValidationError,
  CoercionAmbiguityError,
} from '@firebrandanalytics/shared-utils/validation';

interface CatalogContext {
  categories: string[];
  subcategories: string[];
  brandLines: string[];
  colors: string[];
}

@ObjectRule(function(this: SupplierProductDraftV10) {
  if (this.msrp <= this.base_cost) {
    return `Retail ($${this.msrp}) must exceed wholesale ($${this.base_cost})`;
  }
  return true;
}, 'Price relationship')
@ObjectRule(function(this: SupplierProductDraftV10) {
  const margin = (this.msrp - this.base_cost) / this.msrp;
  if (margin < 0.2) {
    return `Margin ${(margin * 100).toFixed(1)}% is below 20% minimum`;
  }
  return true;
}, 'Minimum margin')
class SupplierProductDraftV10 {

  // --- Product identity with fuzzy matching + recovery ---

  @ValidateRequired()
  @DerivedFrom(['$.product_name', '$.productInfo.name', '$.PRODUCT_NAME'])
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.7,
      synonyms: {
        casual: ['lifestyle', 'everyday', 'street'],
        training: ['cross-training', 'gym', 'workout'],
        skateboarding: ['skate', 'skating'],
      }
    }
  )
  category: string;

  @DerivedFrom(['$.subcategory', '$.productInfo.subcategory', '$.SUBCATEGORY'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.subcategories,
    { strategy: 'fuzzy', fuzzyThreshold: 0.6 }
  )
  @Catch((err, value) => value)  // Non-critical: keep raw if match fails
  subcategory: string;

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brandLines,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  @Catch((err, value) => value)  // Non-critical: keep raw if match fails
  brand_line: string;

  // --- SKU with async uniqueness check ---

  @DerivedFrom(['$.sku', '$.specs.sku', '$.SKU'])
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(
    /^[A-Z]{2,5}\d{2,3}-\d{3}$/,
    'SKU must match format like "NAM90-001"'
  )
  @ValidateAsync(async (sku) => {
    const exists = await das.query(
      'SELECT 1 FROM supplier_product_drafts WHERE sku = $1 AND review_status != $2',
      [sku, 'rejected']
    );
    return exists.rows.length === 0 || `SKU ${sku} already exists`;
  }, 'SKU uniqueness')
  @Catch((err, value, ctx) => {
    // DB failures → import anyway, flag for review
    if (!(err instanceof ValidationError)) {
      ctx.instance._flags = ctx.instance._flags || [];
      ctx.instance._flags.push({ field: 'sku', issue: err.message });
      return value;
    }
    throw err;  // Rethrow actual validation errors
  })
  sku: string;

  // --- Prices with currency parsing ---

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  @CrossValidate(['brand_line'], function(this: SupplierProductDraftV10) {
    const premiumBrands = ['jordan', 'premium', 'signature'];
    if (premiumBrands.includes(this.brand_line) && this.msrp < 100) {
      return `Premium brand "${this.brand_line}" requires retail >= $100`;
    }
    return true;
  }, 'Premium brand minimum price')
  msrp: number;

  // --- Size range with conditional validation + AI repair ---

  @DerivedFrom(['$.size_range', '$.specs.sizeRange', '$.SIZE_RANGE'])
  @CoerceTrim()
  @AICatchRepair((params) =>
    `Convert "${params.value}" to "min-max" format. ` +
    `Numeric sizes: "7-13". Letter sizes: "S-XL". Return only the range.`
  )
  @If('category', ['running', 'basketball', 'training'])
    @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/, 'Numeric size range required')
  @ElseIf('category', ['casual', 'skateboarding'])
    @ValidatePattern(/^(XS|S|M|L|XL|XXL)-(XS|S|M|L|XL|XXL)$/i, 'Letter size range required')
  @EndIf()
  size_range: string;

  // --- Color with fuzzy match + recovery ---

  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.colors,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.6,
      synonyms: {
        'black/white': ['blk/wht', 'black and white'],
        'navy/gold': ['navy and gold', 'nvy/gld'],
      }
    }
  )
  @Catch((err, value) => value)  // Keep raw color if no match — reviewer will fix
  color_variant: string;

  // --- Description with AI repair ---

  @DerivedFrom(['$.description', '$.productInfo.description', '$.DESCRIPTION'])
  @CoerceTrim()
  @AICatchRepair()
  @ValidateLength(10, 2000)
  description: string;
}
```

## The Recovery Philosophy

The V10 validator embodies a clear strategy for each failure type:

| Failure Type | Strategy | Decorator | Example |
|-------------|----------|-----------|---------|
| Missing required field | **Reject** | `@ValidateRequired` | No product_name → error |
| Format mismatch (fixable) | **AI repair** | `@AICatchRepair` | "7 thru 13" → "7-13" |
| Fuzzy match failure (non-critical) | **Keep raw, flag** | `@Catch` returning value | Unknown color → kept for review |
| Fuzzy match ambiguity | **Pick best or flag** | `@Catch` on `CoercionAmbiguityError` | Two close matches → pick top |
| Cross-field rule violation | **Reject** | `@ObjectRule` | Retail < wholesale → error |
| Async validation failure (infra) | **Keep, flag** | `@Catch` on network errors | DB timeout → import anyway |
| Async validation failure (business) | **Reject** | `@ValidateAsync` | Duplicate SKU → error |

This graduated approach means:
- **Critical failures** (missing name, price violations, duplicate SKU) halt the pipeline
- **Fixable issues** (format problems) get AI-repaired automatically
- **Non-critical mismatches** (unknown color, brand) are imported with review flags
- **Infrastructure failures** (DB timeout) don't block the import

## Batch Processing with Recovery

In a real catalog intake, you process submissions in batches. The recovery patterns let you collect results and errors separately:

```typescript
interface ImportResult {
  successes: SupplierProductDraftV10[];
  failures: { index: number; error: ValidationError; rawInput: any }[];
}

async function processSubmission(
  records: any[],
  context: CatalogContext
): Promise<ImportResult> {
  const factory = new ValidationFactory({
    aiHandler: async (params, prompt) => {
      return await broker.complete({ messages: [{ role: 'user', content: prompt }] });
    }
  });

  const result: ImportResult = { successes: [], failures: [] };

  for (let i = 0; i < records.length; i++) {
    try {
      const draft = await factory.create(SupplierProductDraftV10, records[i], { context });
      result.successes.push(draft);
    } catch (error) {
      if (error instanceof ValidationError) {
        result.failures.push({ index: i, error, rawInput: records[i] });
      } else {
        throw error;  // Unexpected errors bubble up
      }
    }
  }

  return result;
}

// Usage
const { successes, failures } = await processSubmission(supplierRecords, catalogContext);
console.log(`Imported ${successes.length} products, ${failures.length} failures`);

// Write failures to supplier_validation_runs for review
for (const f of failures) {
  await db.query(
    'INSERT INTO supplier_validation_runs (draft_id, status, error_details) VALUES ($1, $2, $3)',
    [null, 'failed', JSON.stringify({
      record_index: f.index,
      error: f.error.message,
      property: f.error.propertyPath,
      raw_input: f.rawInput
    })]
  );
}
```

## Tutorial Complete

You've built a production-grade supplier catalog intake pipeline using the validation library. Starting from basic `@CoerceTrim` in Part 1, you've progressively added:

| Part | Capability | Key Insight |
|------|-----------|-------------|
| 1 | Coercion + validation | Declare the rules, let the engine do the work |
| 2 | Parsing + reparenting | Extract from any structure with JSONPath |
| 3 | Discriminated unions | One pipeline, many supplier formats |
| 4 | Nested variants | Validate arrays of objects recursively |
| 5 | Fuzzy matching | Fix typos and resolve synonyms against the catalog |
| 6 | Conditionals + rules | Adapt validation based on context |
| 7 | Reuse patterns | Eliminate repetition with styles and defaults |
| 8 | Engine deep dive | Understand convergent vs single-pass processing |
| 9 | AI extraction | Pull structure from unstructured text |
| 10 | Recovery + async | Graceful degradation and live service validation |

The validation library replaces hundreds of lines of imperative data processing code with declarative decorator pipelines. Each decorator is small, testable, and composable. The pipeline is readable — you can look at a property and immediately see every transformation and validation it goes through.

For the complete API reference, see the [Validation Library Reference](../validation-library-reference.md). For the application source code, see [ff-demo-apps/catalog-intake](https://github.com/firebrandanalytics/ff-demo-apps/tree/main/catalog-intake).

---

**Previous:** [Part 9: AI Extraction + Classification](./part-09-ai-extraction.md)

**Back to index:** [Tutorial Index](./README.md)
