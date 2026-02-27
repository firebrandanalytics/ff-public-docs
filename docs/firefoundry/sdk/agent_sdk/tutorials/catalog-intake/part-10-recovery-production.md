# Part 10: Recovery & Production Hardening

What happens when validation fails on a field that's almost right?

A supplier sends `"7to13"` as a size range. Your `@ValidatePattern(/^\d+(-\d+)?$/)` rejects it. Fair enough -- it doesn't match. But a human reading that value knows exactly what it means. The data isn't wrong, it's just formatted badly. Do you reject the entire product and make someone fix it by hand? Or do you try to extract "7" and "13" and fix it yourself?

Over nine parts you've been building the happy path. This part is about what happens when the path isn't happy -- and how to keep the pipeline moving anyway.

---

## Failing vs. Recovering

Here's a real payload that would crash the current pipeline:

```json
{
  "product_name": "Air Zoom Pegasus 41",
  "category": "runing shoes",
  "base_cost": "89.99",
  "msrp": "150.00",
  "size_range": "7to13"
}
```

The `size_range` field fails pattern validation. But the information is there -- it's just got `"to"` instead of `"-"`. Right now, the entire submission gets rejected. For a batch of 500 products from a supplier who always formats sizes this way, that's a workflow bottleneck.

You have three options, in order of preference:

1. **Programmatic recovery** -- extract digits mechanically. Free, fast, deterministic.
2. **AI-assisted recovery** -- ask the LLM to suggest a valid value. Costs money, slower, but handles the long tail.
3. **Reject and flag** -- give up and surface the error to a reviewer.

The decorators for options 1 and 2 are `@Catch` and `@AICatchRepair`. Option 3 is what you already have -- it's the default behavior when neither is present.

---

## @Catch -- Programmatic Recovery

`@Catch` wraps a field's validation pipeline with a fallback handler. If any decorator below it in the stack throws, your handler gets the raw value and can attempt a repair:

```typescript
@Catch({
  handler: (value) => {
    const match = String(value).match(/(\d+)\D+(\d+)/);
    return match ? `${match[1]}-${match[2]}` : undefined;
  },
})
@ValidatePattern(/^\d+(-\d+)?$/)
size_range!: string;
```

The flow for `"7to13"`:

1. `@ValidatePattern` fails -- `"7to13"` doesn't match `^\d+(-\d+)?$`.
2. `@Catch` intercepts the error and calls the handler with `"7to13"`.
3. The regex extracts `"7"` and `"13"`, returns `"7-13"`.
4. `"7-13"` goes back through `@ValidatePattern` -- this time it passes.

If the handler returns `undefined` or throws, the original validation error propagates as if `@Catch` wasn't there. And critically, the repaired value isn't silently accepted -- it goes through validation again. `@Catch` provides a second chance, not a free pass.

The philosophy: fix what you can, flag what you can't, never crash.

One important detail about placement. `@Catch` wraps everything below it in the decorator stack. Place it right above the validator you want to catch:

```typescript
// Catches only pattern failures
@Catch({ handler: repairSize })
@ValidatePattern(/^\d+(-\d+)?$/)
size_range!: string;

// Catches pattern failures AND range failures
@Catch({ handler: repairCost })
@ValidateRange(0.01)
@ValidatePattern(/^\d+(\.\d+)?$/)
base_cost!: string;
```

Repaired values are also flagged in the validation trace (Part 5). The trace records the original value, the error, and the repaired value. Reviewers in the GUI (Part 8) see exactly what changed and why -- an "Auto-Repaired" badge next to the field with the original value on hover. This means `@Catch` doesn't hide anything. The data gets fixed, the pipeline keeps moving, and humans can verify the fix later.

One more thing: `@Catch` handlers should be fast and deterministic. This is the place for regex extraction, lookup tables, string manipulation -- not HTTP calls or database queries. If you need external data to repair a value, that's what `@AICatchRepair` and `@ValidateAsync` are for.

---

## @AICatchRepair -- When Code Can't Fix It

Some failures need judgment. A supplier sends `"casual/lifestyle"` as a category, but your canonical set is `['running', 'basketball', 'hiking', 'casual']`. That's not a regex problem -- it's a domain interpretation problem. Is `"casual/lifestyle"` closest to `"casual"`? Probably. But writing `if` statements for every possible variant is a losing game.

`@AICatchRepair` sends the failed value, the error message, and your prompt to the LLM:

```typescript
@AICatchRepair({
  prompt: 'The category value failed validation. Suggest the closest canonical category.',
})
@CoerceFromSet(['running', 'basketball', 'hiking', 'casual'])
category!: string;
```

When `@CoerceFromSet` can't match `"casual/lifestyle"`, the AI gets:

- The raw value: `"casual/lifestyle"`
- The error: `"Value not found in allowed set"`
- Your prompt with context

The AI responds with `"casual"`. That candidate goes back through `@CoerceFromSet`, matches, and the field is accepted.

This is the same "AI as transformer" pattern from Part 9, applied to validation failures instead of extraction. The AI doesn't decide whether the value is valid -- the decorators below it do. The AI just suggests a repair candidate.

You can chain both decorators. `@Catch` fires first (it's cheaper), and `@AICatchRepair` fires only if the programmatic handler can't fix it:

```typescript
@Catch({
  handler: (value) => {
    const match = String(value).match(/(\d+)\D+(\d+)/);
    return match ? `${match[1]}-${match[2]}` : undefined;
  },
})
@AICatchRepair({
  prompt: 'Convert this size description to a numeric range in "X-Y" format.',
})
@ValidatePattern(/^\d+(-\d+)?$/)
size_range!: string;
```

The fallback chain unwinds bottom-to-top: pattern fails, AI tries first (closest to the failure), if the AI's suggestion also fails, `@Catch` gets a shot. Programmatic recovery as the safety net behind AI repair.

A note on costs: `@AICatchRepair` calls the LLM, which means latency and money. Always put `@Catch` above `@AICatchRepair` in the stack so programmatic fixes run first. If 90% of your size range failures are just `"to"` instead of `"-"`, the regex handler catches those for free. The AI only fires on the remaining 10% -- the weird ones like `"Small/Medium/Large"` or `"fits size 7 through 13 wide"`. Monitor how often `@AICatchRepair` actually fires per field. If it's firing on most records, the upstream data quality is bad enough to address at the source.

Both `@Catch` and `@AICatchRepair` repairs show up in the validation trace with distinct markers -- `catchApplied` for programmatic and `aiRepairApplied` for AI. The trace also records the AI's raw response before re-validation, so reviewers can see exactly what the model suggested. This audit trail matters in production: you want to know not just that a value was repaired, but how.

---

## @ValidateAsync -- Live Database Checks

Everything so far validates the value in isolation. But some checks need external data: Is this SKU already in the catalog? Does this product name duplicate an existing entry?

`@ValidateAsync` runs after all synchronous decorators complete:

```typescript
@ValidateAsync(async (value, ctx) => {
  const exists = await ctx.dasClient.query(
    `SELECT 1 FROM products WHERE sku = $1`, [value]
  );
  return !exists ? true : 'SKU already exists in the catalog';
})
sku!: string;
```

Key behaviors:

- **Runs after sync decorators.** Coercion, pattern checks, range checks -- all finish first. The async validator sees the fully coerced, sync-validated value. You're not hitting the database with garbage.
- **Multiple async validators run in parallel.** If `product_name` and `sku` both have `@ValidateAsync`, both database checks fire concurrently.
- **Errors are collected, not short-circuited.** If both checks fail, both errors appear in the result.
- **Works with `@Catch`.** If an async validator throws, catch handlers can attempt repair -- though this is less common than catching sync failures.

Async validators are the right tool for uniqueness checks, foreign key validation, and any constraint that depends on the current state of your data. They're not the right tool for format validation -- keep that synchronous.

In production, batch your async checks. Validating 500 SKUs with 500 individual queries is slow. A single bulk query is better:

```typescript
// In your workflow, before per-field validation
const existingSkus = await catalogService.bulkCheckSkus(batch.map(p => p.sku));

// Then use the pre-fetched set in the async validator
@ValidateAsync(async (value, ctx) => {
  return !ctx.existingSkus.has(value) ? true : 'SKU already exists';
})
sku!: string;
```

---

## @UseStyle / @DefaultTransforms -- DRY Patterns

Nine parts of decorator stacking has created some repetition. How many times have you written `@CoerceTrim() @CoerceCase('lower') @ValidateRequired()`? Count the fields in your validator -- it's a lot.

`UseStyle` lets you define reusable decorator combinations:

```typescript
const TrimmedLowerString = UseStyle([CoerceTrim(), CoerceCase('lower')]);

class SupplierProductValidator {
  @TrimmedLowerString
  @ValidateRequired()
  category!: string;

  @TrimmedLowerString
  subcategory!: string;
}
```

`@TrimmedLowerString` expands to `@CoerceTrim() @CoerceCase('lower')` in place. You can still stack additional decorators on top of a style. The style is a template, not a constraint.

For class-wide defaults, `@DefaultTransforms` applies baseline transforms to every field:

```typescript
@Serializable()
@DefaultTransforms({ trim: true, case: 'lower' })
export class SupplierProductValidator {
  @CoerceCase('title')  // overrides 'lower' for this field
  @ValidateRequired()
  product_name!: string;

  @ValidateRequired()   // inherits trim + lower from class defaults
  category!: string;
}
```

Fields that don't explicitly override get the class-level defaults. This works well when most of your string fields need the same baseline treatment.

The benefit is readability. Compare the before and after:

```typescript
// Before: 6 lines of decorators for 2 fields
@CoerceTrim()
@CoerceCase('lower')
@ValidateRequired()
category!: string;

@CoerceTrim()
@CoerceCase('lower')
subcategory!: string;

// After: 3 lines for 2 fields, intent is clearer
@TrimmedLowerString
@ValidateRequired()
category!: string;

@TrimmedLowerString
subcategory!: string;
```

Styles compose with other decorators. You can put `@Catch`, `@AICatchRepair`, `@ValidateAsync`, or any other decorator on a field that already uses a style. The style handles the baseline; you stack the field-specific behavior on top.

---

## Engine Modes

The validation engine has two modes. You've been using the default without thinking about it.

**Convergent** (default) re-runs the decorator pipeline until all field values stabilize. This matters when fields depend on each other -- like the `margin_pct` computed from `base_cost` and `msrp` in Part 7. If `base_cost` changes during coercion, `margin_pct` needs to recompute. The convergent engine handles this automatically, typically converging in 2-3 passes.

**Single-pass** runs the pipeline exactly once. Use it when fields don't reference each other:

```typescript
@Serializable()
@UseSinglePassValidation()
export class SupplierBValidator {
  @UseStyle(TitleStringStyle)
  product_name!: string;

  @UseStyle(LowerStringStyle)
  category!: string;

  @CoerceType('number')
  @ValidateRange(0.01)
  base_cost!: number;
}
```

When to use which: single-pass for straightforward intake -- the supplier-specific validators from Parts 3 and 4 that just extract and normalize. Convergent for the main validator where business rules and `@DerivedFrom` create field dependencies. Single-pass is faster and more predictable; convergent handles complexity you can't linearize.

How do you know if you need convergent mode? If any field uses `@DerivedFrom` or `@CrossValidate` that references other fields, use convergent. If every field's decorators only look at that field's own value, single-pass is safe. When in doubt, leave it on convergent -- the overhead is small for most validators, and it's always correct.

In practice, this maps cleanly to the architecture from Parts 3-4: supplier-specific validators (`SupplierAProduct`, `SupplierBProduct`, `SupplierCProduct`) do extraction and normalization -- single-pass is ideal. The main `SupplierProductValidator` with business rules, computed margins, and cross-field validation needs convergent. The discriminated union handles routing; each validator picks the engine mode that fits its complexity level.

---

## What You Built

Ten parts. Let's look at the full arc.

You started with a JSON payload and a few decorators (Part 1). By the end, you have:

- **4 intake pipelines**: API, CSV, PDF, human form -- all routing through a single discriminated union (Parts 3-4)
- **Progressive schema evolution**: V1, V2, V3 with lambda auto-detection -- new versions don't break old data (Part 4)
- **Observable validation**: Per-field traces showing every decorator's before/after (Part 5)
- **Fuzzy catalog matching**: `@CoerceFromSet` against live DAS data with confidence scores (Part 6)
- **Business rules and nested variants**: Conditional validation, cross-field rules, variant arrays (Part 7)
- **Human review workflow**: Entity states, inline editing, approval pipeline (Part 8)
- **AI-powered extraction and classification**: Generator mode for free text, transformer mode for reclassification (Part 9)
- **Error recovery and production hardening**: `@Catch`, `@AICatchRepair`, async validation, DRY patterns, engine modes (this part)

### The Key Takeaways

**The validation class is the single source of truth.** One `@Serializable` definition, shared across the agent bundle, the GUI, and the backend. When you added a field, changed a rule, or introduced a new supplier format, you updated one class. Every consumer got the change automatically.

**AI outputs go through the same pipeline as human inputs.** `@AIExtract`, `@AIClassify`, and `@AICatchRepair` produce candidate values. Those candidates run through coercion, validation, and business rules just like manually entered data. The AI doesn't get a free pass -- and that's why you can trust the output.

**Decorator stacking is the architecture.** Every capability -- coercion, validation, routing, tracing, matching, business rules, human review, AI extraction, recovery -- was a decorator or a combination of decorators on that same class. The validator grew from 8 fields with basic decorators to a full production pipeline, and the fundamental pattern never changed: define the shape, stack the decorators, let the engine run.

**Recovery is a first-class concern, not an afterthought.** `@Catch` and `@AICatchRepair` aren't workarounds. They're part of the decorator stack, subject to the same validation rules, visible in the same trace, and reviewable in the same GUI. Production data is messy. The pipeline should handle that messiness explicitly, not pretend it doesn't exist.

Raw supplier data goes in -- messy, inconsistent, sometimes broken. Typed, validated, reviewed product records come out.

---

## Further Reading

- [Validation Library Reference](../../../utils/validation/README.md) -- full decorator API
- [News Analysis Tutorial](../news-analysis/README.md) -- different use case, same SDK patterns
- [Report Generator Tutorial](../report-generator/README.md) -- advanced entity/bot/prompt stack

---

**Previous:** [Part 9: AI-Powered Extraction](./part-09-ai-extraction.md)
