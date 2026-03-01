> **DEPRECATED** — See the [current tutorial](../../../agent_sdk/tutorials/catalog-intake/README.md).

# Part 8: Engine Deep Dive

Understand how the validation engine resolves property dependencies, when to choose convergent vs. single-pass execution, and how to diagnose problems using `supplier_validation_runs`.

---

## The Problem: Execution Order Matters

In Parts 1-7, the validation engine has silently handled the execution order for us. When `category` is fuzzy-matched before `size_range` conditionally validates against it, the engine knows to process `category` first. But consider what happens when we add computed fields to the supplier draft:

```typescript
class SupplierProductDraftV8 {
  // ... all the fields from V7 ...

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @UseStyle(CurrencyStyle)
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @UseStyle(CurrencyStyle)
  msrp: number;

  // NEW: Computed margin
  @DerivedFrom(
    ['base_cost', 'msrp'],
    ([wholesale, retail]) => ((retail - wholesale) / retail) * 100
  )
  margin_percent: number;

  // NEW: Margin tier classification
  @DerivedFrom('margin_percent', (margin) => {
    if (margin >= 50) return 'premium';
    if (margin >= 30) return 'standard';
    return 'clearance';
  })
  margin_tier: string;
}
```

The `margin_percent` field derives from `base_cost` and `msrp`. The `margin_tier` field derives from `margin_percent`. This creates a dependency chain:

```
base_cost ─┐
                  ├──→ margin_percent ──→ margin_tier
msrp ────┘
```

If the engine processed `margin_percent` before the prices were resolved, it would compute a margin from `undefined` values. If it processed `margin_tier` before `margin_percent`, it would classify a non-existent margin. The engine needs to understand these dependencies and process fields in the right order.

## Two Engines: Convergent and Single-Pass

The validation library provides two execution engines. Each handles dependency resolution differently.

### The Convergent Engine (Default)

The convergent engine is the default. It works by iterating:

1. **Initial pass:** Run the complete pipeline to populate all properties from input
2. **Iteration loop:** For each iteration (up to `maxIterations`, default 10):
   - Snapshot the current state of all properties
   - Process each property through its decorator pipeline
   - Compare the new state to the snapshot
   - If all values are unchanged, **convergence achieved** — exit the loop
3. **Finalization:** Apply cross-validations and object rules

This is powerful because it doesn't need to know the dependency order in advance. Even if `margin_percent` is processed before the prices on the first pass, the second pass will pick up the now-resolved prices and compute the correct margin. By the third pass, `margin_tier` will have the correct classification, and everything stabilizes.

**Here's how it resolves our margin chain:**

```
Pass 1:
  base_cost = 95          (from raw input, currency-parsed)
  msrp    = 170         (from raw input, currency-parsed)
  margin_percent  = 44.12       (computed from 95, 170)
  margin_tier     = "standard"  (computed from 44.12)

Pass 2:
  base_cost = 95          (unchanged)
  msrp    = 170         (unchanged)
  margin_percent  = 44.12       (unchanged)
  margin_tier     = "standard"  (unchanged)

→ Converged in 2 passes.
```

For this simple chain, the convergent engine resolves everything in two passes. The first pass computes all values; the second pass confirms nothing changed.

### The Single-Pass Engine

The single-pass engine processes each property exactly once, in dependency order. It builds a dependency graph before execution and topologically sorts it:

```typescript
import { UseSinglePassValidation } from '@firebrandanalytics/shared-utils/validation';

@UseSinglePassValidation()
class SupplierProductDraftV8 {
  // ... same fields as above ...
}
```

The engine sees the `@DerivedFrom` declarations, builds the dependency graph, and processes fields in order:

```
1. base_cost  (no dependencies within the class)
2. msrp     (no dependencies within the class)
3. margin_percent   (depends on base_cost, msrp)
4. margin_tier      (depends on margin_percent)
```

Every field is processed exactly once, in the right order. No iteration, no wasted passes.

### When to Use Which

```
Does your class have circular dependencies?
├─ No → Use single-pass for better performance
│   └─ Are all dependencies declared in decorators?
│       ├─ Yes → @UseSinglePassValidation()
│       └─ No  → Add @DependsOn to declare hidden dependencies, then single-pass
└─ Yes → Must use convergent (the default)
```

For the catalog intake pipeline, most validator classes have acyclic dependency chains (prices feed into margins, categories feed into conditional validation). The single-pass engine is the right choice:

```typescript
@UseSinglePassValidation()
@DefaultTransforms({
  string: LookupKeyStyle,
  number: CurrencyStyle,
})
class SupplierProductDraftV8 {
  // ...
}
```

The convergent engine is needed when properties derive from each other in a cycle — which is rare in intake scenarios. You'd see it in cases like bidirectional unit conversion (Celsius and Fahrenheit each derived from the other) or iterative pricing adjustments where a discount depends on a total that depends on the discount.

## @DependsOn — Declaring Hidden Dependencies

Most decorators automatically declare their dependencies. `@DerivedFrom('base_cost', ...)` tells the engine that the decorated property depends on `base_cost`. `@If('category', ...)` tells the engine the conditional depends on `category`. But sometimes the dependency is hidden inside a lambda or AI prompt:

```typescript
class SupplierProductDraftV8 {
  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;

  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;

  // This AI prompt references category and brand_line,
  // but the engine can't parse the string to discover that
  @DependsOn('category', 'brand_line')
  @AITransform((params) =>
    `Generate a product description for a ${params.instance.category} shoe ` +
    `from the ${params.instance.brand_line} line. The product name is: ${params.value}`
  )
  description: string;
}
```

Without `@DependsOn('category', 'brand_line')`, the single-pass engine might process `description` before `category` and `brand_line` are resolved. The AI prompt would receive empty or undefined values instead of the fuzzy-matched results.

`@DependsOn` is only needed when:
1. Your logic reads other properties indirectly (through `params.instance`, a lambda closure, or string interpolation)
2. The engine can't infer the relationship from the decorator signature

Decorators like `@DerivedFrom`, `@If`, `@Merge`, and `@CrossValidate` already declare their dependencies — you don't need `@DependsOn` for those.

## ConvergenceTimeoutError — When the Engine Can't Stabilize

The convergent engine has a safety limit: `maxIterations` (default 10). If values are still changing after 10 passes, something is wrong. The engine throws a `ConvergenceTimeoutError`:

```typescript
import { ConvergenceTimeoutError } from '@firebrandanalytics/shared-utils/validation';

try {
  await factory.create(SupplierProductDraftV8, rawPayload, {
    context: catalogContext,
  });
} catch (error) {
  if (error instanceof ConvergenceTimeoutError) {
    console.log(error.message);
    // "Validation did not converge after 10 iterations.
    //  Properties still changing: margin_percent, margin_tier"

    console.log(error.iterations);    // 10
    console.log(error.unstableProps);  // ['margin_percent', 'margin_tier']
  }
}
```

This usually means one of two things:

1. **Your dependency chain is too deep.** If you have 15 levels of derived fields, the default 10 iterations might not be enough. Increase it:

```typescript
const draft = await factory.create(SupplierProductDraftV8, rawPayload, {
  context: catalogContext,
  maxIterations: 20,
});
```

2. **Your derivations are non-deterministic.** If a `@DerivedFrom` callback returns slightly different values each time (e.g., it includes a timestamp or random component), the engine will never see stable values. Fix the derivation to be deterministic.

Most classes converge in 2-3 iterations. If you need more than 5, consider simplifying the dependency structure or switching to single-pass with explicit `@DependsOn`.

## OscillationError — When Values Flip-Flop

A more specific convergence failure is oscillation. Instead of slowly stabilizing, values alternate between two or more states:

```typescript
// DON'T do this — it oscillates
class BrokenMargin {
  @DerivedFrom('tier', (tier) => tier === 'premium' ? 50 : 30)
  margin_target: number;

  @DerivedFrom('margin_target', (target) => target >= 50 ? 'premium' : 'standard')
  tier: string;
}
```

This creates a cycle: if `tier` is `"standard"`, `margin_target` becomes 30. Since 30 < 50, `tier` stays `"standard"` and it converges. But if `tier` starts as `"premium"`, `margin_target` becomes 50, and `tier` stays `"premium"`. The problem comes when the initial state is ambiguous.

The engine detects oscillation by tracking value history across iterations. If a property returns to a value it had two iterations ago, the engine throws an `OscillationError`:

```typescript
import { OscillationError } from '@firebrandanalytics/shared-utils/validation';

try {
  await factory.create(BrokenMargin, { tier: 'premium', margin_target: 25 });
} catch (error) {
  if (error instanceof OscillationError) {
    console.log(error.message);
    // "Properties oscillating: margin_target alternates between 50 and 30;
    //  tier alternates between 'premium' and 'standard'"

    console.log(error.oscillatingProps);
    // [
    //   { property: 'margin_target', values: [50, 30] },
    //   { property: 'tier', values: ['premium', 'standard'] }
    // ]
  }
}
```

**How to fix oscillation:**

1. **Break the cycle.** Make one of the properties an input rather than a derived value
2. **Add a stabilizer.** Use `@DependsOn` and `@If` to make the derivation one-directional after the first pass
3. **Switch to single-pass.** If the dependency shouldn't be circular, force a specific execution order

In the catalog intake context, oscillation is unlikely — our fields flow from raw input through coercion to computed values in one direction. But it's important to understand when building more complex validators.

## Reading Engine Behavior from supplier_validation_runs

Every time the validation engine processes a supplier record, the run is logged in `supplier_validation_runs`. This table captures what the engine did, how many iterations it took, and what went wrong:

```sql
SELECT
  run_id,
  draft_id,
  engine,           -- 'single-pass' or 'convergent'
  status,           -- 'success', 'partial', 'failed'
  coercions_applied,
  validations_passed,
  validations_failed,
  error_details
FROM supplier_validation_runs
WHERE draft_id = 42
ORDER BY run_number;
```

### What Each Field Tells You

**`engine`** — Which engine was used. If you see `'convergent'` on a class marked `@UseSinglePassValidation()`, something overrode your choice (usually a parent class or factory setting).

**`coercions_applied`** — A JSON array of every coercion that fired:

```json
[
  { "property": "category", "decorator": "CoerceTrim", "before": "  baskeball  ", "after": "baskeball" },
  { "property": "category", "decorator": "CoerceCase", "before": "baskeball", "after": "baskeball" },
  { "property": "category", "decorator": "CoerceFromSet", "before": "baskeball", "after": "basketball", "strategy": "fuzzy", "score": 0.89 }
]
```

This trace shows the exact sequence of transformations. You can see that `CoerceTrim` stripped the whitespace, `CoerceCase` had no effect (already lowercase), and `CoerceFromSet` fuzzy-matched `"baskeball"` to `"basketball"` with a score of 0.89.

**`validations_passed`** and **`validations_failed`** — Which business rules succeeded and which didn't:

```json
// validations_passed
[
  { "property": "product_name", "rule": "ValidateRequired" },
  { "property": "base_cost", "rule": "ValidateRange", "min": 0.01 },
  { "property": "msrp", "rule": "ValidateRange", "min": 0.01 }
]

// validations_failed
[
  { "property": "msrp", "rule": "ObjectRule",
    "message": "Retail price must exceed wholesale price",
    "context": { "retail": 85, "wholesale": 95 } }
]
```

**`error_details`** — For failed runs, the full error information including stack traces, `CoercionAmbiguityError` candidates, and `ConvergenceTimeoutError` unstable properties.

### Using Validation Runs for Debugging

When a supplier submission produces unexpected results, the validation run trace is your first stop:

```sql
-- Find all failed validations for a submission
SELECT
  d.product_name,
  r.status,
  r.validations_failed,
  r.error_details
FROM supplier_product_drafts d
JOIN supplier_validation_runs r ON r.draft_id = d.draft_id
WHERE d.submission_id = 7
  AND r.status = 'failed';
```

For the convergent engine, you can also see how many iterations it took:

```sql
-- Find records that needed more than 3 convergent iterations
SELECT
  d.product_name,
  r.engine,
  r.error_details->'iterations' as iterations
FROM supplier_product_drafts d
JOIN supplier_validation_runs r ON r.draft_id = d.draft_id
WHERE r.engine = 'convergent'
  AND (r.error_details->'iterations')::int > 3;
```

Records that need many iterations are candidates for `@DependsOn` optimization or a switch to single-pass.

## Try It: Single-Pass vs. Convergent on the Same Data

Here's the same supplier record processed by both engines, with the validation run output side by side:

**Input:**

```json
{
  "product_name": "  Air Jordan 1 Retro High  ",
  "category": "baskeball",
  "brand_line": "jordon",
  "color_variant": "blk/wht",
  "base_cost": "$95.00",
  "msrp": "$170.00"
}
```

**Single-Pass Engine:**

```typescript
@UseSinglePassValidation()
@DefaultTransforms({ string: LookupKeyStyle, number: CurrencyStyle })
class DraftSinglePass {
  @ValidateRequired()
  @DerivedFrom(['$.product_name'])
  @UseStyle(DisplayNameStyle)
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;

  @DerivedFrom(['$.brand_line'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;

  @DerivedFrom(['$.color_variant'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.colors, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6,
    synonyms: { 'black/white': ['blk/wht', 'bk/wh'] }
  })
  color_variant: string;

  @DerivedFrom(['$.base_cost'])
  base_cost: number;

  @DerivedFrom(['$.msrp'])
  msrp: number;

  @DerivedFrom(
    ['base_cost', 'msrp'],
    ([w, r]) => ((r - w) / r) * 100
  )
  margin_percent: number;

  @DerivedFrom('margin_percent', (margin) =>
    margin >= 50 ? 'premium' : margin >= 30 ? 'standard' : 'clearance'
  )
  margin_tier: string;
}
```

**Execution trace (single-pass):**

| Order | Property | Action | Result |
|-------|----------|--------|--------|
| 1 | product_name | Trim + title case | `"Air Jordan 1 Retro High"` |
| 2 | category | Trim + lower + fuzzy match | `"basketball"` (0.89) |
| 3 | brand_line | Trim + lower + fuzzy match | `"jordan"` (0.83) |
| 4 | color | Trim + lower + synonym match | `"black/white"` |
| 5 | base_cost | Currency parse + range | `95` |
| 6 | msrp | Currency parse + range | `170` |
| 7 | margin_percent | Derived from prices | `44.12` |
| 8 | margin_tier | Derived from margin | `"standard"` |

One pass. Eight steps. Deterministic order.

**Convergent engine** would produce the same output but take 2 passes (the second pass confirms stability). For this acyclic class, the single-pass engine is strictly better.

## Choosing the Right Engine for Catalog Intake

For the FireKicks intake pipeline:

| Validator | Engine | Why |
|-----------|--------|-----|
| Supplier-specific formats (Part 3) | Single-pass | No inter-property dependencies — just reparenting and coercion |
| Main SupplierProductDraft (Parts 1-7) | Single-pass | Acyclic: prices feed into margins, categories feed into conditionals |
| Variant validators (Part 4) | Single-pass | Each variant is independent; parent references use `^.` which the convergent engine handles at the parent level |
| AI-enhanced validators (Part 9) | Single-pass (preferred) or Convergent | AI decorators can run single-pass if all dependencies are declared via `@DependsOn`. Use convergent only when there are implicit or cyclic dependencies |

The general rule: **start with single-pass, switch to convergent only when you need cycles.** Single-pass is faster, more predictable, and produces clearer error messages when something goes wrong.

## What's Next

The V8 validator runs efficiently with explicit engine control and dependency management. But there's one major category of supplier data we haven't handled: **unstructured text**. Some suppliers don't send structured fields at all — they send free-text product descriptions, handwritten notes, or malformed JSON that no parser can handle.

In [Part 9: AI Extraction + Classification](./part-09-ai-extraction.md), you'll learn how to use `@AIExtract` to pull structured data from free-text supplier notes, `@AIClassify` to automatically categorize products from descriptions, and `@AIJSONRepair` to fix malformed JSON payloads before they enter the validation pipeline.

---

**Next:** [Part 9: AI Extraction + Classification](./part-09-ai-extraction.md)

**Previous:** [Part 7: Reuse Patterns](./part-07-reuse-patterns.md)
