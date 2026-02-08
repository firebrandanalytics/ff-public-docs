# Conceptual Guide

This guide explains the core concepts and design philosophy behind the data validation library. It focuses on *why* the library is built this way and *how* to think about its abstractions, rather than exhaustive API details (see the [API Reference](./validation-library-reference.md) for that).

## 1. The Decorator Pipeline: Top-to-Bottom Transformation

The fundamental mental model is a **pipeline**. Decorators on a property execute from top to bottom, each receiving the output of the previous one. The order you write them is the order they run.

```typescript
class User {
    @CoerceTrim()          // Step 1: "  JANE@EXAMPLE.COM  " → "JANE@EXAMPLE.COM"
    @CoerceCase('lower')   // Step 2: "JANE@EXAMPLE.COM"     → "jane@example.com"
    @ValidatePattern(      // Step 3: validates the cleaned result
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    )
    email: string;
}
```

This pipeline has three phases that always execute in order:

1. **Sourcing** — Where does the value come from? (`@Copy`, `@DerivedFrom`, `@CollectProperties`)
2. **Coercion** — Transform it. (`@CoerceType`, `@CoerceTrim`, `@CoerceFromSet`, `@AITransform`)
3. **Validation** — Check it. (`@Validate`, `@ValidateRange`, `@CrossValidate`)

If no sourcing decorator is present, the library pulls the value from the raw input using the property name as a key. Explicitly using `@Copy()` is only necessary when you want to participate in features like `@ManageAll`.

## 2. Coerce First, Validate Second

The library separates **transformation** from **checking**, and transformation always runs first. This is intentional: you normalize data into the shape you want, then verify it meets your constraints.

```typescript
class Order {
    // Wrong order — validation runs on the raw string "50", fails the range check.
    // @ValidateRange(1, 100)
    // @CoerceType('number')

    // Right order — coerce to number first, then validate the number.
    @CoerceType('number')
    @ValidateRange(1, 100)
    quantity: number;
}
```

This principle extends to AI transforms. `@AITransform` is a coercion — it produces a value that flows into subsequent decorators for further coercion or validation.

## 3. The Metadata Registry: Why @Copy() and @ManageAll Exist

The library only processes properties that have at least one decorator. A property with no decorators is invisible.

```typescript
class Order {
    @CoerceType('number')
    quantity: number;     // ✓ Processed — has a decorator

    notes: string;        // ✗ Ignored — no decorators, will be undefined
}
```

This is where `@Copy()` comes in. It's the simplest sourcing decorator: it copies the value from the raw input with no transformation. If you want a property to appear in your output without any coercion or validation, use `@Copy()`.

For classes where most fields are simple pass-through, `@ManageAll()` at the class level auto-applies `@Copy()` to every property that doesn't already have a decorator:

```typescript
@ManageAll()
class Config {
    name: string;        // Auto-copied
    version: string;     // Auto-copied

    @CoerceType('number')
    timeout: number;     // Has its own decorator, not auto-copied
}
```

## 4. Two Engines: SinglePass vs Convergent

The library offers two validation engines. You choose based on whether your properties have circular dependencies.

### SinglePass Engine

Properties are processed in **topological order** — each property runs exactly once. Fast and predictable, but it cannot handle cases where property A depends on property B and B depends on A.

```typescript
@UseSinglePassValidation()
class Invoice {
    @CoerceType('number')
    price: number;

    @CoerceType('number')
    taxRate: number;

    @DerivedFrom('price', (p: number, { instance }: { instance: any }) => p * (instance.taxRate ?? 0))
    tax: number;     // Depends on price, accesses taxRate via instance — fine, it's a DAG
}
```

### Convergent Engine (Default)

Properties are processed **iteratively until the object stabilizes**. Each iteration applies all decorators to all properties. If the resulting object state is identical to the previous iteration, the engine has **converged** and stops.

```typescript
// Default — no decorator needed
class ShoppingCart {
    @CoerceType('number')
    subtotal: number;

    @DerivedFrom('subtotal', (s) => s > 100 ? 0 : 5.99)
    shipping: number;        // Depends on subtotal

    @DerivedFrom('subtotal', (s: number, { instance }: { instance: any }) => s + (instance.shipping ?? 0))
    total: number;           // Depends on subtotal, accesses shipping via instance
}
```

The convergent engine handles this naturally — it iterates until `subtotal`, `shipping`, and `total` are all consistent. Typical convergence takes 2-3 iterations.

**When does it fail?**

- **Oscillation**: If rules contradict (A sets B to 1, B sets A to 0, A sets B to 1, ...), the engine detects the cycle and throws `OscillationError`.
- **Timeout**: If convergence doesn't happen within `maxIterations` (default 10), it throws `ConvergenceTimeoutError`.

Both are developer errors in the decorator configuration, not data issues.

**Decision guide:**

| Characteristic | SinglePass | Convergent |
|---------------|------------|------------|
| Speed | ~30-40% faster | Default |
| Circular dependencies | Not supported | Handled automatically |
| Determinism | Guaranteed one pass | Iterates until stable |
| Use when | Simple objects, performance critical | Complex interdependencies (default) |

## 5. The Dependency Graph

The library automatically constructs a dependency graph from your decorators. This graph determines the processing order of properties.

Dependencies are declared implicitly by the decorators you use:

- `@DerivedFrom('price')` — this property depends on `price`
- `@If('status', v => v === 'active')` — this property depends on `status`
- `@CrossValidate(['subtotal', 'tax'])` — this property depends on `subtotal` and `tax`
- `@DependsOn(['config'])` — explicit dependency declaration

**Intra-cycle vs inter-cycle dependencies:**

- **Intra-cycle** (property name): Creates a dependency edge. The referenced property is processed first.
- **Inter-cycle** (JSONPath starting with `$`): Reads from the original raw input, not the in-progress instance. No dependency edge — the property can be processed in any order.

```typescript
class Order {
    @DerivedFrom('subtotal', (s) => s * 0.08)  // Intra-cycle: depends on subtotal
    tax: number;

    @DerivedFrom('$.metadata.source')            // Inter-cycle: reads raw input, no dependency
    source: string;
}
```

## 6. The CSS-Like Cascade

Decorator configuration follows a four-level priority system, analogous to CSS specificity:

1. **Factory defaults** (lowest priority) — Set on the `ValidationFactory` constructor
2. **Class-level `@DefaultTransforms`** — Type-based defaults applied to all properties of matching type
3. **`@UseStyle` classes** — Reusable decorator bundles applied to specific properties
4. **Property-level decorators** (highest priority) — Decorators written directly on the property

```typescript
// Level 2: Class-level defaults — all strings get trimmed
@DefaultTransforms({ string: TrimmedString })
class Order {
    // Level 3: Style — email gets the full EmailStyle treatment
    @UseStyle(EmailStyle)
    email: string;

    // Level 4: Property-level — overrides everything above
    @CoerceTrim()
    @CoerceCase('upper')
    sku: string;

    // No property decorators — gets Level 2 defaults (trimmed)
    notes: string;
}
```

This cascade lets you set organization-wide defaults at the factory level, domain-specific defaults at the class level, and override individual properties when needed.

## 7. Context: Runtime Data for Decorators

Many decorators need runtime data that isn't part of the input — a list of valid product names from a database, a user's locale, pricing tiers. This is where **context** comes in.

Context is passed at validation time and is available to any decorator via a lambda:

```typescript
interface OrderContext {
    validProducts: string[];
    pricingTier: 'standard' | 'premium';
}

class Order {
    @CoerceFromSet<OrderContext>(ctx => ctx.validProducts, { strategy: 'fuzzy' })
    product: string;

    @If<OrderContext>('pricingTier', tier => tier === 'premium')
    @Coerce(() => 0)
    @Else()
    @CoerceType('number')
    @EndIf()
    shippingCost: number;
}

const order = await factory.create(Order, rawData, {
    context: { validProducts: ['Widget A', 'Widget B'], pricingTier: 'premium' }
});
```

Context is type-safe — the generic parameter ensures your lambdas receive the correct type.

## 8. Context Decorators: Reshaping Input Structure

Sometimes raw input keys don't match your property names, or you need to operate on the *keys* or *values* of an input object rather than specific fields. Context decorators transform how the input is presented to the class:

- **`@Keys()`** — The class receives the input object's keys as an array
- **`@Values()`** — The class receives the input object's values as an array
- **`@RecursiveKeys()` / `@RecursiveValues()`** — Recursively flattens nested structures

```typescript
@Keys()
class InputKeyNormalizer {
    @UseStyle(TrimAndLowerStyle)
    key: string;
}
// Input: { " Product Name ": "Widget" }
// Receives: [" Product Name "]
// Processes each key through the style
```

These are powerful for blanket normalization of inconsistently structured data, especially from third-party APIs.

## 9. AI Integration: Decorators as LLM Calls

AI decorators (`@AITransform`, `@AIValidate`, and the presets) treat LLM calls as just another step in the decorator pipeline. The AI receives the current value, transforms it, and the result flows to the next decorator.

**The retry loop:** When an AI-transformed value fails subsequent validation, the library automatically retries with the error context injected into the prompt. This creates a self-correcting loop:

```
Value → @AITransform → @CoerceType('number') → @ValidateRange(1, 100)
                              ↑                        |
                              |    (retry with error)   |
                              +————————————————————————+
```

This means you can write simple prompts and rely on the validation pipeline to catch and correct AI mistakes.

**AI presets** are stable, tested wrappers around common transforms:

| Preset | Purpose |
|--------|---------|
| `@AITranslate(lang)` | Translate text to target language |
| `@AIRewrite(style)` | Rewrite in a style (concise, formal, friendly) |
| `@AISummarize(length)` | Summarize (short, medium, long) |
| `@AIClassify(labels)` | Classify into a label set |
| `@AIExtract(fields)` | Extract fields as JSON |
| `@AISpellCheck()` | Fix spelling and grammar |
| `@AIJSONRepair()` | Repair invalid JSON |

The `aiHandler` is provided to the `ValidationFactory` — the library doesn't bundle an LLM client. You bring your own.

## 10. Error Recovery: @Catch and @AICatchRepair

When a decorator in the pipeline throws, you have two recovery options:

**`@Catch(handler)`** — Provide a fallback value:

```typescript
class DataImport {
    @CoerceParse('json')
    @Catch((error, value) => ({}))   // If JSON parsing fails, use empty object
    metadata: Record<string, any>;
}
```

**`@AICatchRepair(prompt?)`** — Ask an AI to fix the broken value:

```typescript
class DataImport {
    @CoerceParse('json')
    @AICatchRepair()   // AI sees the error and the raw value, attempts repair
    metadata: Record<string, any>;
}
```

Both are decorator-level — they only catch errors from the decorators above them in the pipeline. This gives you fine-grained control: critical fields can fail loudly, while optional fields degrade gracefully.

## Next Steps

- **New to the library?** Start with the [Getting Started Guide](./validation-library-getting-started.md)
- **Ready for real-world patterns?** Browse the [Use Cases](./use-cases/)
- **Want to run code?** Try the [Runnable Examples](./examples/)
- **Need API details?** See the [API Reference](./validation-library-reference.md)
