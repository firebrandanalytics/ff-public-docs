# Cross-Property Validation

Validate interdependent fields like order totals, date ranges, and conditional requirements using cross-validators and the convergent engine.

---

## The Problem

Business rules rarely live on a single field. They span multiple properties and create webs of interdependency:

1. **Date ranges** -- An order's `endDate` must be after its `startDate`. Neither field is invalid on its own; only the *relationship* is wrong.

2. **Computed totals** -- An order total must equal `subtotal + tax + shipping`. If any component changes, the total must be recomputed and re-checked.

3. **Conditional requirements** -- Express shipping requires a minimum $50 order. The shipping method is valid in isolation, and the subtotal is valid in isolation, but certain combinations are not.

4. **Circular derived values** -- A bulk discount applies when `quantity > 100`, but the discount percentage affects the total, which determines the shipping tier, which feeds back into the total. These circular dependencies cannot be processed in a single pass.

Traditional per-property validators cannot express these rules. You end up with scattered `if` checks in your application code, brittle manual ordering of validations, and no clear picture of which properties depend on which.

## The Strategy

**Cross-validators with convergent resolution.** The library provides three decorator-level tools for multi-property rules, plus an engine that resolves circular dependencies automatically.

| Tool | Purpose | When to use |
|------|---------|-------------|
| `@CrossValidate(deps[], fn)` | Pairwise or small-group property checks | Date A must be before Date B, field X requires field Y |
| `@ObjectRule(fn)` | Whole-object invariants that span many fields | Total consistency checks, complex business rules |
| `@DerivedFrom(sources, fn)` | Computed fields that depend on other properties | tax = subtotal * rate, total = subtotal + tax + shipping |
| Convergent engine (default) | Iterates until all properties stabilize | Circular dependencies: total affects shipping tier affects total |

## Architecture

The dependency graph for a typical order form has a cycle. Shipping cost depends on the subtotal (free shipping above $100), but the total depends on shipping cost:

```
  quantity ──────> subtotal ──────> tax
                      |              |
                      v              |
               shippingMethod        |
                      |              |
                      v              v
                  shipping ──────> total
                      ^              |
                      |   (cycle)    |
                      +--------------+

   @CrossValidate: endDate > startDate
   @ObjectRule:     express shipping requires subtotal >= $50
```

The **convergent engine** handles this naturally. It iterates the entire property set until every derived value stabilizes. A typical order form converges in 2-3 iterations.

The **single-pass engine** (`@UseSinglePassValidation()`) processes properties in topological order -- faster, but it throws if the dependency graph contains a cycle. Use it for acyclic cases where performance matters.

## Implementation

### 1. The OrderForm class

```typescript
import {
  ValidationFactory,
  Copy,
  CoerceType,
  CoerceRound,
  CrossValidate,
  ObjectRule,
  DerivedFrom,
  ValidateRequired,
  ValidateRange,
  Validate,
  ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

const TAX_RATE = 0.08;

@ObjectRule((obj) => {
  if (obj.shippingMethod === 'express' && obj.subtotal < 50) {
    return 'Express shipping requires a minimum order of $50';
  }
  return true;
}, 'Express shipping minimum')
class OrderForm {
  // ── Inputs ────────────────────────────────────────────────

  @CoerceType('date')
  @ValidateRequired()
  startDate!: Date;

  @CoerceType('date')
  @ValidateRequired()
  @CrossValidate(['startDate'], function (this: OrderForm) {
    if (this.endDate <= this.startDate) {
      return 'End date must be after start date';
    }
    return true;
  }, 'Date range check')
  endDate!: Date;

  @CoerceType('number')
  @ValidateRange(1, 10_000)
  quantity!: number;

  @CoerceType('number')
  @ValidateRange(0.01, 99_999.99)
  unitPrice!: number;

  @Copy()
  @Validate((v: string) =>
    ['standard', 'express'].includes(v) || 'Shipping method must be "standard" or "express"'
  )
  shippingMethod!: string;

  // ── Derived fields ────────────────────────────────────────

  @DerivedFrom(
    ['quantity', 'unitPrice'],
    ([qty, price]: [number, number]) => qty * price
  )
  @CoerceRound({ precision: 2 })
  subtotal!: number;

  @DerivedFrom('subtotal', (subtotal: number) => subtotal * TAX_RATE)
  @CoerceRound({ precision: 2 })
  tax!: number;

  @DerivedFrom('subtotal', (subtotal: number) =>
    subtotal >= 100 ? 0 : 9.99
  )
  @CoerceRound({ precision: 2 })
  shipping!: number;

  @DerivedFrom(
    ['subtotal', 'tax', 'shipping'],
    ([sub, tax, ship]: [number, number, number]) => sub + tax + ship
  )
  @CoerceRound({ precision: 2 })
  total!: number;
}
```

**Line-by-line breakdown:**

1. **`@ObjectRule`** on the class -- After all properties are resolved, the engine checks that express shipping orders have at least a $50 subtotal. This is a *whole-object* rule because it spans `shippingMethod` and `subtotal`.

2. **`startDate` / `endDate`** -- Both are coerced from strings to `Date`. The `@CrossValidate` on `endDate` declares `startDate` as a dependency, so the engine ensures `startDate` is processed first. The validation function uses `this` binding to access both values.

3. **`subtotal`** -- Derived from `quantity * unitPrice`. `@CoerceRound({ precision: 2 })` ensures currency precision.

4. **`tax`** -- Derived from `subtotal * TAX_RATE`. Because `subtotal` is itself derived, the engine resolves `subtotal` first.

5. **`shipping`** -- Free for orders $100+, otherwise $9.99. This creates a dependency from `subtotal` to `shipping`.

6. **`total`** -- Sums `subtotal + tax + shipping`. The convergent engine iterates until `total` stabilizes. If `subtotal` changes (e.g., due to a bulk discount in a variation), shipping may change, which changes total, which triggers another iteration -- the engine handles this automatically.

### 2. Running the pipeline

```typescript
const factory = new ValidationFactory();

// Valid order
const order = await factory.create(OrderForm, {
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  quantity: 10,
  unitPrice: 25.00,
  shippingMethod: 'standard',
});

console.log(order.subtotal);  // 250.00
console.log(order.tax);       // 20.00
console.log(order.shipping);  // 0       (free: subtotal >= $100)
console.log(order.total);     // 270.00

// Invalid: end date before start date
try {
  await factory.create(OrderForm, {
    startDate: '2025-06-15',
    endDate: '2025-06-10',
    quantity: 5,
    unitPrice: 10.00,
    shippingMethod: 'standard',
  });
} catch (err) {
  // ValidationError: "End date must be after start date"
}

// Invalid: express shipping with subtotal < $50
try {
  await factory.create(OrderForm, {
    startDate: '2025-01-01',
    endDate: '2025-01-15',
    quantity: 2,
    unitPrice: 10.00,
    shippingMethod: 'express',
  });
} catch (err) {
  // ValidationError: "Express shipping requires a minimum order of $50"
}
```

## What to Observe

Running the [companion example](../examples/cross-property-validation.ts) produces output like this:

```
=== Cross-Property Validation ===

-- Demo 1: Valid Order (Standard Shipping, Large Order) ---
  subtotal       : $250.00
  tax            : $20.00
  shipping       : $0.00     (free: subtotal >= $100)
  total          : $270.00
  startDate      : 2025-01-01
  endDate        : 2025-01-31

-- Demo 2: Valid Order (Standard Shipping, Small Order) ---
  subtotal       : $45.00
  tax            : $3.60
  shipping       : $9.99     (under $100 threshold)
  total          : $58.59

-- Demo 3: Date Range Violation ---
  [FAIL] End date must be after start date

-- Demo 4: Express Shipping Under $50 ---
  [FAIL] Express shipping requires a minimum order of $50

-- Demo 5: Valid Express Order (Above $50) ---
  subtotal       : $75.00
  tax            : $6.00
  shipping       : $9.99
  total          : $90.99
```

**What each check tells you:**

| Check | What it validates | Decorator |
|-------|-------------------|-----------|
| Date range | `endDate > startDate` | `@CrossValidate(['startDate'], ...)` |
| Derived totals | `total = subtotal + tax + shipping` | `@DerivedFrom` chain with convergent engine |
| Free shipping threshold | `shipping = 0` when `subtotal >= 100` | `@DerivedFrom('subtotal', ...)` |
| Express minimum | Express requires `subtotal >= $50` | `@ObjectRule(...)` |
| Currency precision | All dollar amounts rounded to 2 decimal places | `@CoerceRound({ precision: 2 })` |

**Tuning knobs:**

- **Tax rate** -- Change `TAX_RATE` or derive it from context for locale-specific rates.
- **Shipping threshold** -- The $100 free-shipping cutoff is inside the `@DerivedFrom` lambda. Move it to context for runtime configurability.
- **Convergence limit** -- The default `maxIterations` is 10. For deeply nested circular dependencies, increase it via `ValidationFactory` config. If the engine detects oscillation (values flip-flopping between iterations), it throws `OscillationError`.
- **Engine choice** -- If you remove the `shipping -> total -> shipping` cycle (e.g., by making shipping a fixed cost), switch to `@UseSinglePassValidation()` for a ~30-40% speed improvement.

## Variations

### 1. Tiered shipping with @If conditionals

Replace the flat shipping rule with tiered logic based on the shipping method and order weight:

```typescript
class TieredShippingOrder {
  @CoerceType('number')
  subtotal!: number;

  @Copy()
  shippingMethod!: 'standard' | 'express' | 'overnight';

  @CoerceType('number')
  @ValidateRange(0.1, 500)
  weightKg!: number;

  @If('shippingMethod', 'express')
    @DerivedFrom('weightKg', (w: number) => w * 2.50)
  @Else()
    @If('shippingMethod', 'overnight')
      @DerivedFrom('weightKg', (w: number) => w * 5.00)
    @Else()
      @DerivedFrom('subtotal', (s: number) => s >= 100 ? 0 : 9.99)
    @EndIf()
  @EndIf()
  @CoerceRound({ precision: 2 })
  shipping!: number;
}
```

### 2. Single-pass for acyclic cases

When your derived fields form a directed acyclic graph (no cycles), the single-pass engine is faster:

```typescript
@UseSinglePassValidation()
class SimpleInvoice {
  @CoerceType('number')
  subtotal!: number;

  @DerivedFrom('subtotal', (s: number) => s * 0.08)
  @CoerceRound({ precision: 2 })
  tax!: number;

  @DerivedFrom(['subtotal', 'tax'], ([s, t]: [number, number]) => s + t)
  @CoerceRound({ precision: 2 })
  total!: number;
}
```

No shipping tier depends on total, so the graph is a simple DAG: `subtotal -> tax -> total`. The single-pass engine resolves it in one pass, roughly 30-40% faster than the convergent engine.

### 3. Derived fields with @CoerceRound for currency precision

When multiple derived fields feed into a total, floating-point drift can produce values like `$58.589999999`. Apply `@CoerceRound` at each derivation step to keep cents exact:

```typescript
class PrecisionOrder {
  @CoerceType('number')
  quantity!: number;

  @CoerceType('number')
  unitPrice!: number;

  @DerivedFrom(
    ['quantity', 'unitPrice'],
    ([q, p]: [number, number]) => q * p
  )
  @CoerceRound({ precision: 2 })
  subtotal!: number;

  @DerivedFrom('subtotal', (s: number) => s * 0.0825)
  @CoerceRound({ precision: 2 })
  tax!: number;

  @DerivedFrom(['subtotal', 'tax'], ([s, t]: [number, number]) => s + t)
  @CoerceRound({ precision: 2 })
  total!: number;
}
```

Rounding at each step ensures `subtotal`, `tax`, and `total` are all precise to the cent. Without intermediate rounding, `3 * 19.99 * 0.0825` yields `4.947525` instead of the expected `$4.95`.

### 4. Bulk discount with convergent resolution

A real-world circular dependency: the discount depends on quantity, the discounted subtotal affects shipping tier, and shipping feeds into the total. The convergent engine resolves this naturally:

```typescript
class BulkOrder {
  @CoerceType('number')
  quantity!: number;

  @CoerceType('number')
  unitPrice!: number;

  @DerivedFrom('quantity', (q: number) =>
    q > 500 ? 0.15 : q > 100 ? 0.10 : 0
  )
  discountRate!: number;

  @DerivedFrom(
    ['quantity', 'unitPrice', 'discountRate'],
    ([q, p, d]: [number, number, number]) => q * p * (1 - d)
  )
  @CoerceRound({ precision: 2 })
  subtotal!: number;

  @DerivedFrom('subtotal', (s: number) =>
    s >= 1000 ? 0 : s >= 500 ? 4.99 : 9.99
  )
  shipping!: number;

  @DerivedFrom(
    ['subtotal', 'shipping'],
    ([s, sh]: [number, number]) => s + sh
  )
  @CoerceRound({ precision: 2 })
  total!: number;
}
```

For 200 units at $10 each: `discountRate = 0.10`, `subtotal = $1800.00`, `shipping = $0.00` (over $1000), `total = $1800.00`. The engine converges in 2-3 iterations because `discountRate` is derived from `quantity` alone (no feedback loop on discount), but `shipping` depends on `subtotal` which feeds into `total`.

## See Also

- [Conceptual Guide](../concepts.md) -- Convergent vs single-pass engine, dependency graph, decorator pipeline model
- [API Reference](../validation-library-reference.md) -- Full `@CrossValidate`, `@ObjectRule`, `@DerivedFrom`, `@CoerceRound` signatures
- [Getting Started Tutorial](../validation-library-getting-started.md) -- Your first validated class
- [Intermediate Tutorial](../validation-library-intermediate.md) -- DerivedFrom, context, conditionals
- [LLM Output Canonicalization (use case)](./llm-output-canonicalization.md) -- Type coercion and string cleanup
- [Fuzzy Inventory Matching (use case)](./fuzzy-inventory-matching.md) -- Runtime context and fuzzy matching
- [Runnable example](../examples/cross-property-validation.ts) -- Self-contained TypeScript program you can execute with `npx tsx`
