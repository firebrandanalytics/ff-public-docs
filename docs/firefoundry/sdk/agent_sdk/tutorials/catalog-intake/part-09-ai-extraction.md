# Part 9: AI-Powered Extraction

In Parts 1 through 8, every supplier -- however messy their format -- sent structured data. Fields had names. Values had types. The decorators mapped, coerced, and validated. But now Supplier D shows up, and Supplier D doesn't send structured data at all. Supplier D sends a paragraph.

In this part, you'll introduce AI decorators to handle unstructured input. You'll learn two fundamentally different ways AI fits into the validation pipeline -- as a **data generator** and as a **data transformer** -- and you'll see why the distinction matters.

**What you'll learn:**
- Using `@AIExtract` to pull structured fields from free-text descriptions
- Using `@AIClassify` to map messy values to a canonical taxonomy
- Using `@AIJSONRepair` to fix malformed JSON before parsing
- The two AI modalities: generator vs. transformer
- Auto-retry with error context when AI output fails validation
- Wiring AI-extracted data into the review workflow from Part 8

**What you'll build:** A `SupplierDProduct` validation class that extracts structured product data from free text, an AI classification layer for fuzzy category mapping, a JSON repair pipeline for malformed input, and GUI updates to show AI extraction results with confidence scores.

---

## Step 1: The Problem -- Free Text

Open the discriminated union from Part 4. It handles three suppliers: flat JSON (Supplier A), nested JSON (Supplier B), and ALL_CAPS CSV (Supplier C). All three have identifiable fields. You can point `@Copy()` or `@DerivedFrom()` at a named field and get a value.

Now look at what Supplier D sends:

```json
{
  "supplier_schema": "schema_d",
  "free_text": "Premium men's running shoe, the Blaze Runner Pro. Black and white colorway. Retail price $189.99, wholesale $95.00. Available in sizes 7 through 14. Part of the Performance Elite line."
}
```

No `product_name` field. No `category` field. No `base_cost` field. Just a description with all the information buried in prose. You can't point `@DerivedFrom('$.product_name')` at anything because there's nothing to point at.

Try feeding this to Supplier A's class:

```typescript
const result = await factory.create(SupplierAProduct, {
  supplier_schema: 'schema_d',
  free_text: 'Premium men\'s running shoe, the Blaze Runner Pro...'
});
// ValidationError: product_name is required
```

Every field comes back empty. `@Copy()` looks for `product_name` in the raw input and finds nothing. This isn't a mapping problem or a coercion problem -- there's nothing to map or coerce. You need something to **create** the structured data from scratch.

## Step 2: @AIExtract -- AI as Data Generator

`@AIExtract` sends the raw text to an LLM and asks it to pull out specific named fields. The LLM reads the description, understands the meaning, and returns structured data.

Before using any AI decorator, you need an `aiHandler` on the `ValidationFactory`. If you haven't configured one yet:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    return await broker.complete({
      messages: [{ role: 'user', content: prompt }],
      model: 'default',
    });
  }
});
```

Now build the Supplier D validation class.

**`packages/shared-types/src/validators/SupplierDProduct.ts`**:

```typescript
import {
  Serializable,
  UseSinglePassValidation,
  Discriminator,
  DerivedFrom,
  AIExtract,
  Staging,
  CoerceTrim,
  CoerceCase,
  CoerceParse,
  CoerceType,
  ValidateRequired,
  ValidateRange,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
@UseSinglePassValidation()
export class SupplierDProduct {
  @Discriminator('schema_d')
  supplier_schema!: string;

  // Step 1: Extract all fields from free text into a staging object
  @DerivedFrom('$.free_text')
  @AIExtract([
    'product_name',
    'category',
    'subcategory',
    'brand_line',
    'base_cost',
    'msrp',
    'color_variant',
    'size_range',
  ])
  @Staging()
  _extracted!: Record<string, string>;

  // Step 2: Derive each field from the extraction, then validate normally

  @DerivedFrom('_extracted', (e) => e.product_name)
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('_extracted', (e) => e.category)
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @DerivedFrom('_extracted', (e) => e.subcategory)
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @DerivedFrom('_extracted', (e) => e.brand_line)
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @DerivedFrom('_extracted', (e) => e.base_cost)
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  base_cost!: number;

  @DerivedFrom('_extracted', (e) => e.msrp)
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  msrp!: number;

  @DerivedFrom('_extracted', (e) => e.color_variant)
  @CoerceTrim()
  color_variant!: string;

  @DerivedFrom('_extracted', (e) => e.size_range)
  @CoerceTrim()
  size_range!: string;
}
```

Walk through what happens when you validate Supplier D's payload:

1. `@DerivedFrom('$.free_text')` pulls the description string from the raw input.
2. `@AIExtract([...])` sends that string to the LLM with a prompt like: "Extract the following fields from this text: product_name, category, subcategory, brand_line, base_cost, msrp, color_variant, size_range." The LLM returns a JSON object: `{ product_name: "Blaze Runner Pro", category: "running", base_cost: "$95.00", ... }`.
3. `@Staging()` marks `_extracted` as temporary -- it won't appear in the final output.
4. Each real property uses `@DerivedFrom('_extracted', (e) => e.field_name)` to pick its value from the extraction result.
5. From there, the same decorators you've been using since Part 1 take over: `@CoerceTrim()`, `@CoerceCase()`, `@CoerceParse('currency')`, `@ValidateRange()`.

Run it:

```typescript
const result = await factory.create(SupplierDProduct, {
  supplier_schema: 'schema_d',
  free_text: `Premium men's running shoe, the Blaze Runner Pro. Black and white colorway.
Retail price $189.99, wholesale $95.00. Available in sizes 7 through 14.
Part of the Performance Elite line.`
});

console.log(JSON.stringify(result, null, 2));
```

**Output:**

```json
{
  "supplier_schema": "schema_d",
  "product_name": "Blaze Runner Pro",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance elite",
  "base_cost": 95,
  "msrp": 189.99,
  "color_variant": "black and white",
  "size_range": "7-14"
}
```

The `_extracted` staging field is gone. Every value has been coerced and validated. The AI did the hard part -- understanding natural language -- and the decorator pipeline did the rest.

For more control over what the AI extracts, pass an object schema with hints instead of a plain string array:

```typescript
@AIExtract({
  product_name: 'The full product name including model, excluding brand line',
  category: 'The athletic category (e.g., running, basketball, hiking)',
  base_cost: 'The wholesale/cost price as a number',
  msrp: 'The retail/MSRP price as a number',
})
```

The object values become extraction hints in the prompt, which improves accuracy for ambiguous fields.

## Step 3: @AIClassify -- AI as Data Transformer

Extraction is one way to use AI. Classification is another -- and the two serve fundamentally different roles.

Look at the `category` field on `SupplierDProduct`. Right now, `@AIExtract` returns whatever the LLM interprets as the category. For the Blaze Runner description, it returns `"running"` -- which happens to match the canonical taxonomy. But what if the description said "high-performance road shoe"? The LLM might extract `"road running"` or `"performance"`. Neither matches the taxonomy.

`@AIClassify` solves this by constraining the LLM to pick from a specific set of values:

```typescript
import {
  AIClassify,
  CoerceFromSet,
} from '@firebrandanalytics/shared-utils/validation';

// In SupplierDProduct, replace the category decorators:

  @DerivedFrom('_extracted', (e) => e.category)
  @AIClassify(['Running Shoes', 'Basketball', 'Hiking', 'Training', 'Casual', 'Skateboarding'])
  category!: string;
```

`@AIClassify` builds a prompt that forces the LLM to choose exactly one label from the provided list. It also internally applies `@CoerceFromSet` to the LLM's response, so if the LLM returns `"running shoes"` (lowercase), the fuzzy matching resolves it to `"Running Shoes"`.

But you don't have to hardcode the list. Use the `CatalogContext` from Part 6 to supply the valid categories at runtime:

```typescript
  @DerivedFrom('_extracted', (e) => e.category)
  @AIClassify<CatalogContext>((ctx) => ctx.validCategories)
  category!: string;
```

Now the classification uses whatever categories are loaded from the DAS catalog. Add a new category to the master catalog and it's automatically available for classification -- no code changes.

Here's the difference between extraction and classification:

| | @AIExtract | @AIClassify |
|---|---|---|
| **AI role** | Creates data that didn't exist | Transforms data into a canonical form |
| **Input** | Unstructured text | A messy or ambiguous value |
| **Output** | Whatever the LLM extracts | One of the provided labels |
| **Constraint** | None -- LLM can return anything | Must choose from the label set |

## Step 4: @AIJSONRepair -- Fixing Malformed Input

Not every unstructured data problem is free text. Some suppliers send *almost*-valid JSON -- close enough that a human can read it, broken enough that `JSON.parse()` rejects it.

Common problems: trailing commas, single quotes instead of double quotes, unquoted keys, missing closing brackets. You've probably seen this from APIs that hand-build JSON strings or from copy-paste errors.

```json
{
  "supplier_schema": "schema_d_broken",
  "payload": "{ product_name: 'Velocity Sprint', category: 'running', base_cost: 85.00, msrp: 149.99, }"
}
```

`@CoerceParse('json')` throws on this. But `@AIJSONRepair` can fix it:

```typescript
import {
  DerivedFrom,
  AIJSONRepair,
  CoerceParse,
  Staging,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRequired,
  ValidateRange,
} from '@firebrandanalytics/shared-utils/validation';

class BrokenJSONProcessor {
  // Step 1: Repair the broken JSON
  @DerivedFrom('$.payload')
  @AIJSONRepair()
  @CoerceParse('json', { allowNonString: true })
  @Staging()
  _repaired!: Record<string, any>;

  // Step 2: Extract fields from the repaired object
  @DerivedFrom('_repaired', (obj) => obj.product_name)
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('_repaired', (obj) => obj.category)
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @DerivedFrom('_repaired', (obj) => obj.base_cost)
  @CoerceType('number')
  @ValidateRange(0.01)
  base_cost!: number;

  @DerivedFrom('_repaired', (obj) => obj.msrp)
  @CoerceType('number')
  @ValidateRange(0.01)
  msrp!: number;
}
```

The chain works like this:

1. `@AIJSONRepair()` sends the broken JSON to the LLM. The LLM returns valid JSON: `{"product_name": "Velocity Sprint", "category": "running", "base_cost": 85.00, "msrp": 149.99}`.
2. `@CoerceParse('json')` parses the repaired string into a JavaScript object.
3. `@Staging()` marks it as temporary scaffolding.
4. Each field is derived from the repaired object and validated normally.

The AI fixed the syntax. The pipeline validated the data. Same pattern as `@AIExtract` -- AI does the heavy lifting, decorators clean up after it.

## Step 5: The Two AI Modalities

You've now seen three AI decorators. Step back and notice the pattern. They split into two fundamentally different roles:

### AI as Data Generator

> The LLM creates new structured data from unstructured input. `@AIExtract` takes a free-text description and produces `{ product_name, category, base_cost, ... }`. The AI is the *source* of the data -- it's generating fields that didn't exist in any structured form.

### AI as Data Transformer

> The LLM transforms existing data into a better form. `@AIClassify` maps a messy category string to one of the canonical taxonomy labels. `@AIJSONRepair` fixes broken JSON syntax. The AI is a *tool within the pipeline* -- it transforms data, it doesn't create it from scratch.

### Why the Distinction Matters

The key insight:

> **AI outputs need validation just as much as human inputs do.** Whether the LLM generated the data or transformed it, the validation pipeline is the quality gate. `@AIExtract` feeds its output back through the same decorator chain -- `@CoerceTrim`, `@CoerceCase`, `@CoerceParse`, `@ValidateRange`. The AI doesn't get a free pass.

This is why you put `@AIExtract` alongside `@ValidateRequired`, `@CoerceCase`, and the rest. The AI generates, then the pipeline validates. If the AI extracts `"$95.00"` for `base_cost`, `@CoerceParse('currency')` strips the dollar sign and converts it to `95`. If the AI extracts `"running"` for category, `@AIClassify` or `@CoerceFromSet` maps it to the canonical label. If the AI returns something completely wrong, `@ValidateRequired` or `@ValidateRange` catches it.

The same principle applies to transformers. `@AIClassify` constrains the LLM to the label set, but the result still passes through `@CoerceFromSet` for exact matching. `@AIJSONRepair` fixes the syntax, but `@CoerceParse('json')` still has to parse it -- if the AI's repair is still invalid JSON, the parse fails and the retry mechanism kicks in.

In both cases, **the validation pipeline is the single source of truth**. The AI is a powerful tool in the pipeline, not a replacement for it.

### When to Use Which

| Scenario | Modality | Decorator |
|----------|----------|-----------|
| Free-text description with no fields | Generator | `@AIExtract` |
| Messy value that needs canonical mapping | Transformer | `@AIClassify` |
| Broken JSON from a flaky API | Transformer | `@AIJSONRepair` |
| Validation failure that AI can fix | Transformer | `@AICatchRepair` (Part 10) |
| Custom extraction or transformation | Either | `@AITransform` |

## Step 6: Auto-Retry with Error Context

What happens when the AI gets it wrong?

Say the LLM extracts `"running"` for the category field, but the canonical taxonomy uses `"Running Shoes"`. Without fuzzy matching, `@CoerceFromSet` would fail. But there's a built-in recovery mechanism: **auto-retry with error context**.

When a subsequent decorator fails after an AI decorator, the library automatically retries the AI call with the error message included in the prompt. The LLM sees what went wrong and can correct its output.

Here's the flow:

```
Attempt 1:
  AI extracts: { category: "running" }
  @CoerceFromSet(['Running Shoes', 'Basketball', 'Hiking', ...])
  → No exact match for "running"
  → CoercionError: "running" does not match any valid option

Attempt 2 (automatic):
  Prompt now includes: "Previous attempt returned 'running' which failed validation.
  Valid options are: Running Shoes, Basketball, Hiking, Training, Casual, Skateboarding.
  Please return a corrected value."
  AI returns: "Running Shoes"
  @CoerceFromSet → exact match → success
```

This retry loop is built into all AI decorators. You configure it with `maxRetries` (default: 2):

```typescript
@DerivedFrom('$.free_text')
@AIExtract([
  'product_name', 'category', 'subcategory', 'brand_line',
  'base_cost', 'msrp', 'color_variant', 'size_range',
], { maxRetries: 3 })
@Staging()
_extracted!: Record<string, string>;
```

The retry mechanism means you don't have to get the prompt perfect on the first try. Write the extraction, stack the validation decorators after it, and the pipeline self-corrects when the AI's output doesn't quite fit.

> **Without data classes:**
> ```typescript
> // Manual retry logic everywhere
> let category = await llm.extract(text, 'category');
> if (!validCategories.includes(category)) {
>   category = await llm.extract(text, 'category',
>     { hint: `Must be one of: ${validCategories.join(', ')}` });
>   if (!validCategories.includes(category)) {
>     throw new Error(`AI failed to extract valid category after 2 attempts`);
>   }
> }
> ```
> With the decorator pipeline, retry logic is built in. You declare what valid looks like, and the framework handles the retry loop.

## Step 7: Update the GUI

The review queue from Part 8 shows validated products. Now you need to show *how* the data was produced -- especially for AI-extracted fields where a human reviewer should verify the AI's work.

### AI Extraction Panel

Add an extraction detail panel to the review page. When a product was processed through `SupplierDProduct`, show each field with its extraction source:

**`apps/catalog-gui/src/app/review/[entityId]/AIExtractionPanel.tsx`**:

```tsx
'use client';

import { useValidationTrace } from '@/hooks/useValidationTrace';

interface AIExtractionPanelProps {
  entityId: string;
  trace: ReturnType<typeof useValidationTrace>['trace'];
}

export function AIExtractionPanel({ entityId, trace }: AIExtractionPanelProps) {
  if (!trace) return null;

  // Find fields that went through AI decorators
  const aiFields = Object.entries(trace.fields).filter(([_, fieldTrace]) =>
    fieldTrace.steps.some(step =>
      step.decorator === 'AIExtract' ||
      step.decorator === 'AIClassify' ||
      step.decorator === 'AIJSONRepair'
    )
  );

  if (aiFields.length === 0) return null;

  return (
    <div className="border rounded-lg p-4 bg-blue-50">
      <h3 className="text-sm font-semibold text-blue-800 mb-3">
        AI-Extracted Fields
      </h3>
      <p className="text-xs text-blue-600 mb-4">
        These fields were extracted by AI from unstructured text.
        Review each value and correct if needed.
      </p>
      <div className="space-y-3">
        {aiFields.map(([fieldName, fieldTrace]) => {
          const aiStep = fieldTrace.steps.find(s =>
            s.decorator.startsWith('AI')
          );
          return (
            <div key={fieldName} className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">{fieldName}</span>
                <span className="ml-2 text-xs text-blue-600">
                  via @{aiStep?.decorator}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">{fieldTrace.finalValue}</span>
                {aiStep?.retryCount && aiStep.retryCount > 0 && (
                  <span className="text-xs text-amber-600">
                    ({aiStep.retryCount} {aiStep.retryCount === 1 ? 'retry' : 'retries'})
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Inline Correction with Re-Validation

From Part 8, the review detail page already supports inline editing. When a human corrects an AI-extracted field, the correction needs to run back through validation. The existing `handleFieldEdit` function from Part 8 handles this -- re-validation runs when the reviewer saves a correction.

The key addition is visual: mark AI-extracted fields with a badge so reviewers know which fields to scrutinize:

```tsx
// In ReviewDetailPage.tsx, update the field rendering:
{trace.fields[fieldName]?.steps.some(s => s.decorator.startsWith('AI')) && (
  <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
    AI
  </span>
)}
```

This gives reviewers a clear signal: structured supplier fields (Suppliers A-C) came from mapped data. AI-badged fields (Supplier D) were generated by the LLM and deserve extra attention.

## Step 8: Add to the Discriminated Union

Supplier D plugs into the same discriminated union from Part 4. The union routes by `supplier_schema`, but Supplier D's payload has `"schema_d"` as its discriminator value. Add it to the map:

**`packages/shared-types/src/validators/ProductSubmission.ts`**:

```typescript
import {
  DiscriminatedUnion,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';
import { SupplierAProduct } from './SupplierAProduct.js';
import { SupplierBProduct } from './SupplierBProduct.js';
import { SupplierCProduct } from './SupplierCProduct.js';
import { SupplierDProduct } from './SupplierDProduct.js';

@DiscriminatedUnion({
  discriminator: 'supplier_schema',
  map: {
    'schema_a': SupplierAProduct,
    'schema_b': SupplierBProduct,
    'schema_c': SupplierCProduct,
    'schema_d': SupplierDProduct,
  }
})
export class ProductSubmission {
  @Copy()
  supplier_schema!: string;
}
```

If Supplier D doesn't always include a `supplier_schema` field, add a lambda discriminator from Part 4 that detects the free-text format:

```typescript
@DiscriminatedUnion({
  discriminator: 'supplier_schema',
  map: {
    'schema_a': SupplierAProduct,
    'schema_b': SupplierBProduct,
    'schema_c': SupplierCProduct,
    'schema_d': SupplierDProduct,
  },
  lambdaDiscriminator: (data: any) => {
    // If there's a free_text field and no product_name, it's Supplier D
    if (typeof data.free_text === 'string' && !data.product_name) {
      return 'schema_d';
    }
    return undefined; // Fall through to field-based discrimination
  }
})
export class ProductSubmission {
  @Copy()
  supplier_schema!: string;
}
```

The lambda runs before the field-based discriminator. If it returns a key, that class is used. If it returns `undefined`, the engine falls back to checking the `supplier_schema` field. This means Supplier D's payload can omit the `supplier_schema` entirely -- the lambda detects it by shape.

From the bot's perspective, nothing changes:

```typescript
const result = await factory.create(ProductSubmission, rawPayload, {
  context: catalogContext
});
// Works for all four suppliers. The union routes, the class validates.
```

Structured or unstructured, flat or nested, clean JSON or free text -- the pipeline handles it all through the same `factory.create()` call. The discriminated union routes to the right class, and each class uses whatever decorators it needs.

## What You've Built

You now have:
- **`SupplierDProduct`** -- a validation class that extracts structured product data from free-text descriptions using `@AIExtract`
- **AI classification** -- `@AIClassify` for mapping messy categories to canonical taxonomy labels
- **JSON repair** -- `@AIJSONRepair` for fixing malformed JSON before parsing
- **Auto-retry** -- built-in retry with error context when AI output fails validation
- **AI extraction panel** -- GUI component showing which fields were AI-generated, with visual badges for reviewers
- **Discriminated union integration** -- Supplier D plugged into the same routing architecture as all other suppliers

---

## What's Next

AI extraction handles unstructured data, but what about failures? A size range comes in as "seven to thirteen" -- that fails the regex pattern. A network timeout kills the AI call mid-extraction. A price value comes back as `"ninety-five dollars"` instead of a number.

In [Part 10: Recovery & Production Hardening](./part-10-recovery-production.md), you'll add graceful error recovery with `@Catch`, AI-powered repair suggestions with `@AICatchRepair`, async validation with `@ValidateAsync`, and production hardening patterns to make the entire pipeline resilient.
