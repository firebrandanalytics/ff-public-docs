# Fuzzy Inventory Matching

Match misspelled product names, status values, and categories against a known catalog using context-driven fuzzy set coercion.

---

## The Problem

Humans misspell product names. LLMs hallucinate close-but-wrong variants. Voice-to-text produces phonetic approximations. When your system expects "MacBook Pro" and receives "macbok pro", an exact match silently fails and the order falls through the cracks. The same applies to status values ("shiped" instead of "Shipped"), category names ("eletronics" instead of "Electronics"), and price tiers (99.8 instead of 99.99).

You need a way to take messy input and snap it to the closest canonical value from a known set, without hardcoding every possible misspelling. The candidate set might come from a database, a config file, or an API call, so it cannot be baked into the class definition at compile time.

## The Strategy

**Context-driven fuzzy set coercion.** The `@CoerceFromSet` decorator matches an input value against a set of candidates provided at runtime via context. You configure the matching strategy (fuzzy, exact, numeric, etc.), a confidence threshold, and optional synonyms.

| Aspect | Approach |
|--------|----------|
| Candidate source | Runtime context passed to `factory.create` (loaded from DB, config, or API) |
| Matching strategy | `'fuzzy'` with configurable Levenshtein threshold (default 0.6) |
| Disambiguation | `ambiguityTolerance` rejects near-ties; `synonyms` map known aliases to canonical values |
| Numeric matching | `'numeric'` strategy with `numericTolerance` for price tiers and quantities |
| Type preservation | When using `selector`, the full object is returned, not just the matched string |

## Architecture

```
                        ┌─────────────────────────────┐
                        │      Runtime Context         │
                        │  (product catalog, statuses)  │
                        └──────────┬──────────────────┘
                                   │
                                   ▼
┌──────────┐    ┌──────────────────────────────┐    ┌────────────────┐
│ Raw Input │───▶│       @CoerceFromSet          │───▶│ Canonical Value│
│ "macbok"  │    │  1. Extract candidates (ctx)  │    │ "MacBook Pro"  │
└──────────┘    │  2. Run fuzzy match            │    └────────────────┘
                │  3. Score & threshold check     │
                │  4. Ambiguity check             │
                │  5. Return best match           │
                └──────────────────────────────┘
```

The pipeline for a single property flows like this:

1. **Source** -- `@Copy()` pulls the raw value from the input.
2. **Coerce** -- `@CoerceFromSet` extracts the candidate array from context, runs the configured matching strategy, applies the threshold and ambiguity tolerance, and returns the best canonical match.
3. **Validate** -- Optional `@ValidateRequired()` confirms a match was found.

Multiple properties can each have their own `@CoerceFromSet` with different strategies, thresholds, and candidate sets, all sharing the same context object.

## Implementation

### 1. Define the context and the validated class

```typescript
interface InventoryContext {
    productCatalog: string[];
    validStatuses: string[];
    priceTiers: number[];
}

class PurchaseOrder {
    @ValidateRequired()
    @Copy()
    orderId: string;

    // Fuzzy product matching: "macbok pro" → "MacBook Pro"
    @CoerceFromSet<InventoryContext>(
        ctx => ctx.productCatalog,
        { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
    )
    product: string;

    // Status matching with synonyms: "shiped" → "Shipped", "in transit" → "In Transit"
    @CoerceFromSet<InventoryContext>(
        ctx => ctx.validStatuses,
        {
            strategy: 'fuzzy',
            fuzzyThreshold: 0.6,
            synonyms: {
                'Shipped':    ['shiped', 'shipd', 'sent'],
                'In Transit': ['in transit', 'on the way', 'en route'],
                'Delivered':  ['deliverd', 'recieved', 'arrived'],
            }
        }
    )
    status: string;

    // Numeric price-tier matching: 99.8 → 99.99, 250 → 249.99
    @CoerceFromSet<InventoryContext>(
        ctx => ctx.priceTiers,
        { strategy: 'numeric', numericTolerance: 1.0 }
    )
    priceTier: number;

    @CoerceType('number')
    @ValidateRange(1, 10000)
    quantity: number;
}
```

### 2. Create and run

```typescript
const factory = new ValidationFactory();

const context: InventoryContext = {
    productCatalog: ['MacBook Pro', 'MacBook Air', 'iPad Pro', 'iPhone 15', 'AirPods Max'],
    validStatuses:  ['Pending', 'Shipped', 'In Transit', 'Delivered', 'Cancelled'],
    priceTiers:     [49.99, 99.99, 149.99, 249.99, 499.99],
};

// Messy input from an LLM or user form
const rawInput = {
    orderId:   'PO-20240315-001',
    product:   'macbok pro',
    status:    'shiped',
    priceTier: 250,
    quantity:  '12',
};

const order = await factory.create(PurchaseOrder, rawInput, { context });

console.log(order);
// {
//   orderId:   'PO-20240315-001',
//   product:   'MacBook Pro',      ← fuzzy matched
//   status:    'Shipped',          ← synonym matched
//   priceTier: 249.99,             ← numeric matched
//   quantity:  12                   ← type coerced
// }
```

### 3. Log match details

The validation engine resolves each property silently by default. To inspect what happened, wrap the call and compare before/after:

```typescript
console.log('Input product:', rawInput.product, '→ Output:', order.product);
console.log('Input status:',  rawInput.status,  '→ Output:', order.status);
console.log('Input tier:',    rawInput.priceTier,'→ Output:', order.priceTier);
```

## What to Observe

When you run the [companion example](../examples/fuzzy-inventory-matching.ts), the output shows each field before and after coercion:

```
── Demo 1: Basic Fuzzy Matching ──────────────────────
  "macbok pro"    → "MacBook Pro"       (fuzzy, threshold 0.7)
  "ipd pro"       → "iPad Pro"          (fuzzy, threshold 0.7)
  "airpods maks"  → "AirPods Max"       (fuzzy, threshold 0.7)

── Demo 2: Status Matching with Synonyms ─────────────
  "shiped"        → "Shipped"           (synonym hit)
  "on the way"    → "In Transit"        (synonym hit)
  "deliverd"      → "Delivered"         (fuzzy + synonym)

── Demo 3: Numeric Price-Tier Matching ───────────────
  250             → 249.99              (numeric, tolerance 1.0)
  100.5           → 99.99              (numeric, tolerance 1.0)
  50              → 49.99              (numeric, tolerance 1.0)
```

### Understanding the behavior

| Concept | Explanation |
|---------|-------------|
| **Fuzzy score** | A 0-to-1 similarity score based on Levenshtein distance. 1.0 is an exact match. The `fuzzyThreshold` option sets the minimum score to accept a match. |
| **Threshold rejection** | If no candidate scores above the threshold, the decorator throws a `ValidationError`. This prevents wild guesses (e.g., "keyboard" matching "MacBook Pro" at 0.3). |
| **Synonyms** | Before fuzzy matching runs, the input is checked against the `synonyms` map. A synonym hit returns the canonical value immediately with a perfect score. |
| **Ambiguity tolerance** | When two candidates score within `ambiguityTolerance` of each other (default 0.1), the decorator throws a `CoercionAmbiguityError` rather than guessing. Widen this value to be more permissive; narrow it for stricter disambiguation. |
| **Numeric tolerance** | For the `'numeric'` strategy, `numericTolerance` sets the maximum allowed absolute distance. A value of `250` matches `249.99` (distance 0.01) but would not match `149.99` (distance 100.01) with a tolerance of 1.0. |
| **Case sensitivity** | By default, matching is case-insensitive. Set `caseSensitive: true` to require exact casing. |

## Variations

### 1. Object matching with selectors

When your candidate set is an array of objects (e.g., from a database query), use `selector` to tell the decorator which property to match against. The full object is returned, not just the matched string.

```typescript
interface CatalogContext {
    products: { id: number; name: string; sku: string }[];
}

class OrderLine {
    @CoerceFromSet<CatalogContext>(
        ctx => ctx.products,
        {
            strategy: 'fuzzy',
            fuzzyThreshold: 0.7,
            selector: (product) => product.name,
        }
    )
    product: { id: number; name: string; sku: string };
}

const result = await factory.create(OrderLine,
    { product: 'macbok pro' },
    { context: { products: [
        { id: 1, name: 'MacBook Pro', sku: 'MBP-001' },
        { id: 2, name: 'MacBook Air', sku: 'MBA-001' },
    ]}}
);

console.log(result.product);
// { id: 1, name: 'MacBook Pro', sku: 'MBP-001' }
```

### 2. Custom distance functions

Replace the built-in Levenshtein scorer with a domain-specific matcher using `customMatcher`. The function receives the input and a candidate and returns a 0-to-1 score.

```typescript
class PartNumber {
    @CoerceFromSet<PartContext>(
        ctx => ctx.parts,
        {
            strategy: 'custom',
            customMatcher: (input, candidate) => {
                // Strip hyphens and compare numeric suffixes
                const inputNum  = input.replace(/\D/g, '');
                const candNum   = candidate.replace(/\D/g, '');
                return inputNum === candNum ? 1.0 : 0.0;
            },
        }
    )
    partNumber: string;
}
```

### 3. Adjusting ambiguity tolerance

Lower the tolerance to be stricter about near-ties:

```typescript
@CoerceFromSet<InventoryContext>(
    ctx => ctx.productCatalog,
    {
        strategy: 'fuzzy',
        fuzzyThreshold: 0.7,
        ambiguityTolerance: 0.02,  // very strict — almost-tied scores throw
    }
)
product: string;
```

Raise it to be more permissive (accept the top scorer even when a close second exists):

```typescript
@CoerceFromSet<InventoryContext>(
    ctx => ctx.productCatalog,
    {
        strategy: 'fuzzy',
        fuzzyThreshold: 0.6,
        ambiguityTolerance: 0.3,  // lenient — pick the winner even if close
    }
)
product: string;
```

### 4. Combining fuzzy matching with @If conditionals

Apply different matching strategies based on the value of another property:

```typescript
class FlexibleOrder {
    @Copy()
    inputSource: 'voice' | 'form' | 'api';

    @If('inputSource', 'voice')
        @CoerceFromSet<InventoryContext>(
            ctx => ctx.productCatalog,
            { strategy: 'fuzzy', fuzzyThreshold: 0.5 }  // lenient for voice input
        )
    @Else()
        @CoerceFromSet<InventoryContext>(
            ctx => ctx.productCatalog,
            { strategy: 'fuzzy', fuzzyThreshold: 0.8 }  // strict for typed input
        )
    @EndIf()
    product: string;
}
```

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, decorator pipeline model, context system
- [API Reference](../validation-library-reference.md) -- Complete `@CoerceFromSet` options, matching strategies, error types
- [Getting Started](../validation-library-getting-started.md) -- `ValidationFactory` basics, first validated class
- [Intermediate Guide](../validation-library-intermediate.md) -- Fuzzy matching introduction, context decorators, conditionals
