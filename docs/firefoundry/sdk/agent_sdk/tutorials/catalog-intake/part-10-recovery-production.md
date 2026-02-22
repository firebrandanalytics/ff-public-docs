# Part 10: Recovery & Production Hardening

Over the last nine parts you built a complete catalog intake system -- validation, multi-supplier routing, schema versioning, catalog matching, business rules, human review, and AI extraction. But we've been assuming the happy path. What happens when a supplier sends `"seven to thirteen"` as a size range? Or `"TBD"` as a price? Or a brand name that doesn't match anything in your catalog?

In production, you can't just reject everything that doesn't parse cleanly. You need graceful degradation: catch failures, attempt repairs, flag uncertain values for review, and keep the pipeline moving. That's what this part is about.

We'll also DRY up the codebase -- nine parts of decorator stacking has created some repetition -- and cover engine modes and production considerations.

---

## Step 1: The Problem -- Failures Happen

Look at some real supplier data that would crash the current pipeline:

```json
{
  "product_name": "Air Zoom Pegasus 41",
  "category": "running",
  "base_cost": "TBD",
  "msrp": "call for pricing",
  "size_range": "seven to thirteen",
  "color_variant": "Black/White"
}
```

Three fields will fail:

- **`base_cost`**: `"TBD"` can't be coerced to a number by `@CoerceType('number')`. Result: `NaN`, which fails `@ValidateRange(0.01)`.
- **`msrp`**: Same problem. `"call for pricing"` is not a number.
- **`size_range`**: `"seven to thirteen"` doesn't match the pattern `/^\d+(\.\d+)?-\d+(\.\d+)?$/`.

Right now, all three fields produce validation errors, the entire submission is rejected, and someone has to manually fix the data and resubmit. For one or two records, that's fine. For a batch of 500 products from a supplier who always sends prices as `"TBD"` until contracts are finalized? That's a workflow bottleneck.

What you want instead:

1. **Try to recover automatically** -- if the regex fails on `"seven to thirteen"`, try extracting digits or converting words to numbers.
2. **Use AI as a fallback** -- if programmatic recovery fails, ask the AI to suggest a valid value.
3. **Flag repaired values** -- don't silently fix data. Mark it so reviewers know what was changed and why.
4. **Validate against live data** -- check uniqueness constraints, catalog existence, and other things you can't verify with a regex.

---

## Step 2: @Catch -- Graceful Degradation

`@Catch` wraps a field's decorator pipeline with a fallback. If any decorator in the chain throws, the catch handler gets the error and the raw value, and can attempt a repair.

Update `SupplierProductValidator` to add catch handlers:

**`apps/catalog-bundle/src/validators/SupplierProductValidator.ts`** (updated fields):

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRange,
  ValidatePattern,
  Serializable,
  Catch,
} from '@firebrandanalytics/shared-utils/validation';

// Helper: convert word-numbers to digits
function wordsToDigits(text: string): string {
  const wordMap: Record<string, string> = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    ten: '10', eleven: '11', twelve: '12', thirteen: '13',
    fourteen: '14', fifteen: '15', sixteen: '16',
  };
  let result = text.toLowerCase();
  for (const [word, digit] of Object.entries(wordMap)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }
  return result;
}

// Helper: extract a size range from messy text
function extractSizeRange(rawValue: string): string {
  const converted = wordsToDigits(rawValue);
  const digits = converted.match(/\d+(\.\d+)?/g);
  if (!digits || digits.length < 2) {
    throw new Error(`Cannot extract size range from: "${rawValue}"`);
  }
  return `${digits[0]}-${digits[digits.length - 1]}`;
}

@Serializable()
export class SupplierProductValidator {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @CoerceTrim()
  color_variant!: string;

  @CoerceTrim()
  @Catch((error, rawValue) => extractSizeRange(rawValue as string))
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

Now when `size_range` receives `"seven to thirteen"`:

1. `@CoerceTrim()` trims it -- no change.
2. `@ValidatePattern(...)` fails -- `"seven to thirteen"` doesn't match.
3. `@Catch` intercepts the error and calls `extractSizeRange("seven to thirteen")`.
4. `wordsToDigits` converts it to `"7 to 13"`.
5. The regex extracts `["7", "13"]` and returns `"7-13"`.
6. The catch result (`"7-13"`) is used as the field value.

If the catch handler itself throws (say the input is `"no sizes available"`), the original validation error propagates as if `@Catch` wasn't there.

A few things to note about `@Catch`:

- **The catch result goes through validation again.** If `extractSizeRange` returns `"7-abc"`, the `@ValidatePattern` check runs on the repaired value and rejects it. `@Catch` doesn't bypass validation -- it provides a second chance.
- **Repaired values are flagged in the trace.** The validation trace (Part 5) records that this field was caught and repaired, including the original value, the error, and the repaired value. Reviewers see it in the GUI.
- **Place `@Catch` between coercion and validation.** In the decorator stack, `@Catch` wraps everything below it. Placing it right above `@ValidatePattern` means it only catches pattern failures, not trim failures.

---

## Step 3: @AICatchRepair -- AI as Repair Tool

`@Catch` works when you can write a deterministic fallback. But some failures need judgment. What's the right size range for `"Small/Medium/Large"`? That's not a digit extraction problem -- it's a domain interpretation problem.

`@AICatchRepair` uses AI as a repair tool. When validation fails, it sends the error, the raw value, and your prompt to an LLM and asks for a suggestion:

```typescript
import {
  // ... existing imports
  AICatchRepair,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
export class SupplierProductValidator {
  // ... other fields unchanged

  @CoerceTrim()
  @Catch((error, rawValue) => extractSizeRange(rawValue as string))
  @AICatchRepair({
    prompt: 'Suggest the closest valid numeric size range in the format "X-Y" (e.g., "7-13"). If the input uses letter sizes (S, M, L, XL), convert to numeric equivalents.',
  })
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

Now the fallback chain for `size_range` is:

1. `@ValidatePattern` fails.
2. `@AICatchRepair` catches it, sends the value and prompt to the AI.
   - Input: `"Small/Medium/Large"`, error: `"does not match required pattern"`
   - AI response: `"6-10"` (mapping S=6, M=8, L=10)
3. The AI suggestion goes through `@ValidatePattern` again. If `"6-10"` matches, it's accepted.
4. If the AI suggestion also fails validation, `@Catch` catches that and tries `extractSizeRange`.
5. If everything fails, the original error propagates.

The decorator stack reads top-to-bottom, and the catch chain unwinds bottom-to-top. `@AICatchRepair` sits between `@Catch` and `@ValidatePattern`, so it fires first on a pattern failure. If the AI repair fails, `@Catch` gets a second shot.

This is the same "AI as data transformer" pattern from Part 9, applied to validation failures instead of extraction. The AI doesn't decide whether the value is valid -- the decorators below it do. The AI just suggests a repair candidate, and that candidate goes through the same validation pipeline as any other value.

> **Without @AICatchRepair:**
>
> ```typescript
> // You'd have to handle every possible format yourself
> if (value.includes('Small')) return '6-10';
> if (value.includes('Youth')) return '3.5-7';
> if (value.includes('Toddler')) return '2-10';
> // ... infinite edge cases
> ```
>
> **With @AICatchRepair:**
>
> The AI handles the long tail of formats you'd never anticipate. The validation pipeline ensures the AI's output is actually valid.

---

## Step 4: @ValidateAsync -- Live Database Checks

All the validators we've written so far are synchronous -- they check format, range, and pattern against the value itself. But some validations require external data:

- Is this SKU already in the database?
- Does this product name duplicate an existing entry?
- Is the supplier still active in the system?

`@ValidateAsync` runs asynchronous validators after all synchronous decorators complete:

```typescript
import {
  // ... existing imports
  ValidateAsync,
} from '@firebrandanalytics/shared-utils/validation';
import { catalogService } from '../services/CatalogService.js';

@Serializable()
export class SupplierProductValidator {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  @ValidateAsync(async (value: string) => {
    const exists = await catalogService.productNameExists(value);
    if (exists) {
      throw new Error(`Product "${value}" already exists in catalog`);
    }
  })
  product_name!: string;

  // ... other fields

  @CoerceTrim()
  @ValidateRequired()
  @ValidateAsync(async (value: string) => {
    const exists = await catalogService.skuExists(value);
    if (exists) {
      throw new Error(`SKU "${value}" is already registered`);
    }
  })
  sku!: string;
}
```

The catalog service is a thin wrapper around DAS queries (the same `CatalogContext` from Part 6):

```typescript
// apps/catalog-bundle/src/services/CatalogService.ts
import { CatalogContext } from '../context/CatalogContext.js';

class CatalogServiceImpl {
  private context: CatalogContext;

  constructor() {
    this.context = new CatalogContext();
  }

  async productNameExists(name: string): Promise<boolean> {
    const results = await this.context.searchProducts({
      name,
      exactMatch: true,
    });
    return results.length > 0;
  }

  async skuExists(sku: string): Promise<boolean> {
    const results = await this.context.searchBySku(sku);
    return results.length > 0;
  }
}

export const catalogService = new CatalogServiceImpl();
```

Key behavior of `@ValidateAsync`:

- **Runs after all sync decorators.** Coercion, pattern checks, range checks -- all run first. The async validator sees the fully coerced, sync-validated value. This means you're not hitting the database with garbage values.
- **Multiple async validators run in parallel.** If `product_name` and `sku` both have `@ValidateAsync`, both database checks run concurrently.
- **Errors are collected, not short-circuited.** If both `product_name` and `sku` fail uniqueness, both errors appear in the result.
- **Works with `@Catch` and `@AICatchRepair`.** If an async validator throws, catch handlers can attempt repair (though async repairs are less common).

---

## Step 5: Reuse Patterns -- DRY Decorators

After nine parts, you've probably noticed the same decorator combos appearing everywhere:

```typescript
// This pattern appears on product_name, brand_line, category_name, etc.
@CoerceTrim()
@CoerceCase('title')
@ValidateRequired()
product_name!: string;

// This pattern appears on category, subcategory, brand_line in some validators
@CoerceTrim()
@CoerceCase('lower')
@ValidateRequired()
category!: string;
```

`@UseStyle` lets you define reusable decorator combinations:

**`apps/catalog-bundle/src/validators/styles.ts`**:

```typescript
import {
  StyleDefinition,
  CoerceTrim,
  CoerceCase,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

// Title-cased required string: trim + title case + required
@StyleDefinition()
export class TitleStringStyle {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  declare value: string;
}

// Lowercased required string: trim + lowercase + required
@StyleDefinition()
export class LowerStringStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  declare value: string;
}

// Optional trimmed string: trim only, no required check
@StyleDefinition()
export class OptionalTrimmedStyle {
  @CoerceTrim()
  declare value: string;
}
```

Now the validator reads like a schema:

```typescript
import {
  Serializable,
  CoerceType,
  ValidateRange,
  ValidatePattern,
  Catch,
  AICatchRepair,
  UseStyle,
} from '@firebrandanalytics/shared-utils/validation';
import {
  TitleStringStyle,
  LowerStringStyle,
  OptionalTrimmedStyle,
} from './styles.js';

@Serializable()
export class SupplierProductValidator {
  @UseStyle(TitleStringStyle)
  product_name!: string;

  @UseStyle(LowerStringStyle)
  category!: string;

  @UseStyle(LowerStringStyle)
  subcategory!: string;

  @UseStyle(LowerStringStyle)
  brand_line!: string;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @UseStyle(OptionalTrimmedStyle)
  color_variant!: string;

  @UseStyle(OptionalTrimmedStyle)
  @Catch((error, rawValue) => extractSizeRange(rawValue as string))
  @AICatchRepair({
    prompt: 'Suggest the closest valid numeric size range in format "X-Y"',
  })
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

`@UseStyle` expands the style's decorators in place. `@UseStyle(TitleStringStyle)` is exactly equivalent to writing `@CoerceTrim() @CoerceCase('title') @ValidateRequired()`. The style class is never instantiated -- it's a decorator template.

### @DefaultTransforms -- Class-Level Defaults

If most fields in a class should be trimmed, you can set that at the class level instead of per-field:

```typescript
@Serializable()
@DefaultTransforms({ trim: true, case: 'lower' })
export class SupplierProductValidator {
  @CoerceCase('title')  // overrides the class-level 'lower' for this field
  @ValidateRequired()
  product_name!: string;

  @ValidateRequired()   // inherits trim + lower from class defaults
  category!: string;

  // ...
}
```

`@DefaultTransforms` applies to every field that doesn't explicitly override those transforms. It reduces boilerplate when you have a consistent baseline.

### @ManageAll -- Declaring Managed Fields

By default, the validation engine processes fields that have at least one decorator. `@ManageAll` explicitly lists which fields the engine should manage, even if some don't have decorators:

```typescript
@Serializable()
@ManageAll(['product_name', 'category', 'subcategory', 'brand_line',
            'base_cost', 'msrp', 'color_variant', 'size_range', 'sku'])
export class SupplierProductValidator {
  // ...
}
```

This is useful when you add fields that should appear in the trace and validation result even if they're pass-through (no coercion, no validation). Without `@ManageAll`, undecorated fields are invisible to the engine.

---

## Step 6: Engine Modes

The validation engine has two modes. Until now, we've been using the default without thinking about it.

### Convergent Engine (Default)

The convergent engine iterates the decorator pipeline until all field values stabilize. This matters when fields depend on each other.

Remember the margin calculation from Part 7?

```typescript
@ComputeFrom(['base_cost', 'msrp'], (cost, msrp) => ((msrp - cost) / msrp) * 100)
margin_pct!: number;
```

If `base_cost` changes during coercion (say `"89.99"` becomes `89.99`), then `margin_pct` needs to recompute. The convergent engine runs the pipeline again, detects that `margin_pct` changed, and iterates until nothing changes. Typically this converges in 2-3 passes.

### Single-Pass Engine

When there are no circular dependencies -- fields don't reference each other -- the convergent engine's iteration is wasted work. `@UseSinglePassValidation()` tells the engine to run the pipeline exactly once:

```typescript
import { UseSinglePassValidation } from '@firebrandanalytics/shared-utils/validation';

@Serializable()
@UseSinglePassValidation()
export class SupplierBValidator {
  // Extraction-heavy, no computed fields
  @UseStyle(TitleStringStyle)
  product_name!: string;

  @UseStyle(LowerStringStyle)
  category!: string;

  @CoerceType('number')
  @ValidateRange(0.01)
  base_cost!: number;

  // ... all independent fields
}
```

When to use which:

| Engine | Use When | Example |
|--------|----------|---------|
| **Convergent** (default) | Fields depend on each other (`@ComputeFrom`, `@DerivedFrom`, cross-field rules) | `SupplierProductValidator` with `margin_pct` |
| **Single-pass** | All fields are independent -- extraction and coercion only | `SupplierBValidator`, `SupplierCValidator` from Parts 3-4 |

Single-pass is faster and more predictable. Use it for supplier-specific validators that just extract and normalize. Use convergent for the main validator where business rules create field dependencies.

---

## Step 7: Update the GUI

The GUI needs to surface recovery information so reviewers know when values were repaired and can verify the repairs.

### Recovery Indicators

Add repair badges to the product detail view. The validation trace already contains the catch/repair metadata -- you just need to display it:

**`apps/catalog-gui/src/components/FieldDisplay.tsx`**:

```tsx
import { TraceEntry } from '@firebrandanalytics/shared-utils/validation';

interface FieldDisplayProps {
  fieldName: string;
  value: unknown;
  trace?: TraceEntry;
}

export function FieldDisplay({ fieldName, value, trace }: FieldDisplayProps) {
  const wasRepaired = trace?.catchApplied || trace?.aiRepairApplied;
  const originalValue = trace?.originalValue;

  return (
    <div className="field-row">
      <label>{fieldName}</label>
      <span className="field-value">
        {String(value)}
        {wasRepaired && (
          <span className="repair-badge" title={`Original: "${originalValue}"`}>
            {trace?.aiRepairApplied ? 'AI Repaired' : 'Auto-Repaired'}
          </span>
        )}
      </span>
      {wasRepaired && (
        <div className="repair-detail">
          <span className="original-value">
            Was: &ldquo;{String(originalValue)}&rdquo;
          </span>
          {trace?.catchError && (
            <span className="repair-reason">
              Reason: {trace.catchError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

### Async Validation Status

Async validators can take time (database queries, external API calls). Show a loading state while they run:

**`apps/catalog-gui/src/components/AsyncValidationStatus.tsx`**:

```tsx
interface AsyncStatusProps {
  field: string;
  status: 'pending' | 'checking' | 'passed' | 'failed';
  error?: string;
}

export function AsyncValidationStatus({ field, status, error }: AsyncStatusProps) {
  return (
    <div className="async-status">
      {status === 'checking' && (
        <span className="spinner">Checking {field}...</span>
      )}
      {status === 'passed' && (
        <span className="check-pass">Unique</span>
      )}
      {status === 'failed' && (
        <span className="check-fail">{error}</span>
      )}
    </div>
  );
}
```

### Summary Dashboard

Add a dashboard that shows validation health across all submissions:

**`apps/catalog-gui/src/components/ValidationDashboard.tsx`**:

```tsx
interface DashboardProps {
  stats: {
    totalSubmissions: number;
    passedClean: number;
    passedWithRepairs: number;
    failed: number;
    repairsByField: Record<string, number>;
    commonErrors: Array<{ message: string; count: number }>;
  };
}

export function ValidationDashboard({ stats }: DashboardProps) {
  const repairRate = stats.totalSubmissions > 0
    ? ((stats.passedWithRepairs / stats.totalSubmissions) * 100).toFixed(1)
    : '0';

  return (
    <div className="validation-dashboard">
      <h2>Validation Summary</h2>

      <div className="stat-cards">
        <div className="stat-card success">
          <span className="stat-value">{stats.passedClean}</span>
          <span className="stat-label">Passed Clean</span>
        </div>
        <div className="stat-card warning">
          <span className="stat-value">{stats.passedWithRepairs}</span>
          <span className="stat-label">Passed with Repairs</span>
        </div>
        <div className="stat-card error">
          <span className="stat-value">{stats.failed}</span>
          <span className="stat-label">Failed</span>
        </div>
        <div className="stat-card info">
          <span className="stat-value">{repairRate}%</span>
          <span className="stat-label">Repair Rate</span>
        </div>
      </div>

      <h3>Repairs by Field</h3>
      <ul>
        {Object.entries(stats.repairsByField)
          .sort(([, a], [, b]) => b - a)
          .map(([field, count]) => (
            <li key={field}>
              <strong>{field}</strong>: {count} repairs
            </li>
          ))}
      </ul>

      <h3>Common Errors</h3>
      <ul>
        {stats.commonErrors.map(({ message, count }) => (
          <li key={message}>
            {message} ({count} occurrences)
          </li>
        ))}
      </ul>
    </div>
  );
}
```

This dashboard tells you things like: "Supplier B's `size_range` field gets auto-repaired 40% of the time -- maybe we should talk to them about their format." Operational insight from the validation pipeline.

---

## Step 8: Production Checklist

Before deploying to production, walk through these considerations:

### Error Monitoring

Track validation outcomes in your observability stack:

```typescript
import { logger, metrics } from '@firebrandanalytics/ff-agent-sdk';

// In CatalogIntakeBot.validate()
const result = await this.factory.create(SupplierProductValidator, raw_payload);
const trace = this.factory.getLastTrace();

// Log repair events
for (const [field, entry] of Object.entries(trace.fields)) {
  if (entry.catchApplied) {
    metrics.increment('validation.repairs', {
      field,
      supplier: supplier_id,
      type: entry.aiRepairApplied ? 'ai' : 'programmatic',
    });
  }
}

// Track overall success rates
metrics.increment('validation.result', {
  outcome: result.success ? 'pass' : 'fail',
  supplier: supplier_id,
});
```

Set alerts on:
- **Repair rate spikes** -- if a supplier's repair rate jumps from 5% to 50%, their data format probably changed.
- **AI repair failures** -- if `@AICatchRepair` is failing frequently, the prompt may need tuning or the data is genuinely unparseable.
- **Async validation latency** -- database checks should be fast. If `@ValidateAsync` calls start taking seconds, check your indices.

### Performance

- **Use single-pass when possible.** Supplier-specific validators (`SupplierBValidator`, `SupplierCValidator`) that just extract and normalize don't need convergent iteration. Add `@UseSinglePassValidation()`.
- **Batch async validations.** If you're checking 500 SKUs for uniqueness, a single bulk query is better than 500 individual queries. Implement `@ValidateAsync` with batch-aware logic or use a batch validation endpoint.
- **Cache catalog data.** The `CatalogContext` from Part 6 queries DAS on every `@CoerceFromSet` call. Add a TTL cache for catalog lookups that don't change frequently.

### AI Costs

AI decorators (`@AICatchRepair`, `@AIExtract`, `@AIClassify`, `@AIJSONRepair`) call LLMs. In production:

- **Place `@Catch` before `@AICatchRepair`** in the decorator stack. Programmatic recovery is free and fast. AI recovery costs money and takes time. Only invoke the AI when your code can't handle it.
- **Monitor AI decorator invocations.** Track how often `@AICatchRepair` actually fires. If it's firing on 80% of records, the upstream data quality is bad enough that you should address it at the source.
- **Set cost budgets per supplier.** Some suppliers send clean data (low AI usage). Others send garbage (high AI usage). Track per-supplier AI costs to have informed conversations about data quality.

### Testing

Unit test your validators with edge cases, especially the recovery chain:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';
import { SupplierProductValidator } from './SupplierProductValidator.js';

describe('SupplierProductValidator', () => {
  const factory = new ValidationFactory();

  it('handles word-number size ranges', async () => {
    const result = await factory.create(SupplierProductValidator, {
      product_name: 'Test Shoe',
      category: 'running',
      base_cost: '100',
      msrp: '150',
      size_range: 'seven to thirteen',
    });
    expect(result.size_range).toBe('7-13');
  });

  it('rejects completely unparseable size ranges', async () => {
    await expect(
      factory.create(SupplierProductValidator, {
        product_name: 'Test Shoe',
        category: 'running',
        base_cost: '100',
        msrp: '150',
        size_range: 'no sizes available',
      }),
    ).rejects.toThrow(/size_range/);
  });

  it('coerces string prices to numbers', async () => {
    const result = await factory.create(SupplierProductValidator, {
      product_name: 'Test Shoe',
      category: 'running',
      base_cost: '89.99',
      msrp: '120.00',
      size_range: '7-13',
    });
    expect(result.base_cost).toBe(89.99);
    expect(typeof result.base_cost).toBe('number');
  });

  it('reports all validation errors, not just the first', async () => {
    try {
      await factory.create(SupplierProductValidator, {
        product_name: '',
        base_cost: '-5',
        msrp: '0',
        size_range: 'invalid',
      });
      fail('Expected validation to throw');
    } catch (error: any) {
      expect(error.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
```

Test the full decorator chain, not just individual validators. The interaction between `@Catch`, `@AICatchRepair`, and `@ValidatePattern` is where bugs hide.

---

## Wrapping Up

You've built a complete supplier catalog intake system across ten parts. Let's look at the full arc:

1. **[Part 1: A Working Agent Bundle](./part-01-working-agent-bundle.md)** -- Scaffolded the application, wrote the first validation class with decorators, created an entity with `@Serializable` + `dataClass`, and proved the round-trip: raw JSON in, typed class instance out, stored and reconstructed from the entity graph.

2. **[Part 2: The Catalog GUI](./part-02-catalog-gui.md)** -- Added a Next.js frontend that shares the same `SupplierProductValidator` class. One definition, three consumers: bundle, GUI, backend. The GUI provides an intake form and a product browser.

3. **[Part 3: Multi-Supplier Routing](./part-03-multi-supplier-routing.md)** -- Handled Supplier A (flat JSON), Supplier B (nested JSON), and Supplier C (ALL_CAPS CSV) with `@DiscriminatedUnion`. Each supplier gets its own validator class; the union routes automatically based on data shape.

4. **[Part 4: Schema Versioning](./part-04-schema-versioning.md)** -- Added lambda discriminators for auto-detecting schema versions. New versions don't break old data. Zero-migration evolution: old entities deserialize with their original validator, new submissions use the latest.

5. **[Part 5: The Validation Trace](./part-05-validation-trace.md)** -- Made the pipeline observable. Every decorator records what it did -- original value, coerced value, validation result -- into a per-field trace. The trace viewer in the GUI shows the full transformation history.

6. **[Part 6: Catalog Matching](./part-06-catalog-matching.md)** -- Connected to the live product catalog via DAS. `@CoerceFromSet` does fuzzy matching against real catalog data, with confidence scores and match explanations.

7. **[Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md)** -- Added conditional validation (`@If`/`@Else`), cross-field rules (`@CrossValidate`), object-level rules (`@ObjectRule`), and nested variant arrays (`@ValidatedClassArray`).

8. **[Part 8: Human Review Workflow](./part-08-human-review.md)** -- Built the approval pipeline. Products move through entity states (Draft, Pending Review, Approved, Rejected). Reviewers can edit fields inline, and changes go through the same validation pipeline.

9. **[Part 9: AI-Powered Extraction](./part-09-ai-extraction.md)** -- Used `@AIExtract` for structured data from free text and `@AIClassify` for category assignment. Two AI modalities: generator (create data from unstructured input) and transformer (reclassify existing data). AI outputs go through the same validation pipeline as human inputs.

10. **[Part 10: Recovery & Production](./part-10-recovery-production.md)** -- Added `@Catch` for programmatic recovery, `@AICatchRepair` for AI-assisted repair, `@ValidateAsync` for live database checks, and `@UseStyle` for DRY decorator patterns. Covered engine modes and production hardening.

### The Key Takeaways

**The validation class is the single source of truth.** It's shared across the agent bundle, the GUI, and any backend service that touches product data. When you add a field or change a rule, you update one class. Every consumer gets the change.

**Data classes beat raw JSON at every level.** Type safety, serialization, evolution, debugging -- typed class instances with `@Serializable` and `dataClass` give you all of it. `instanceof` checks work. Methods work. The prototype chain survives a round-trip through the entity graph.

**AI outputs go through the same validation pipeline as human inputs.** `@AIExtract`, `@AIClassify`, and `@AICatchRepair` produce candidate values. Those candidates run through coercion, validation, and business rules just like manually entered data. The AI doesn't get a free pass.

**The entity graph stores typed class instances, not raw JSON.** `@EntityDecorator({ dataClass })` and `@Serializable` handle the serialization lifecycle natively. When you load an entity, `dto.data` is a real class instance -- not a `{ product_name: "..." }` plain object.

**Decorator stacking is the architecture.** Every capability you added -- coercion, validation, routing, tracing, matching, business rules, human review, AI extraction, recovery -- was a decorator or a combination of decorators on the same class. The validation class grew from 8 fields with basic decorators to a full production pipeline, and the fundamental pattern never changed.

---

You now have a production-ready catalog intake system. Raw supplier data goes in -- messy, inconsistent, sometimes broken -- and typed, validated, reviewed product records come out. The decorators do the heavy lifting. The validation class is the contract. The entity graph is the persistence layer. And the GUI makes it all visible.

**Ready to go deeper?** Check out the [Validation Library Reference](../../utils/validation/README.md) for the complete decorator API, or explore the [News Analysis Tutorial](../news-analysis/README.md) for a different take on the agent bundle pattern.
