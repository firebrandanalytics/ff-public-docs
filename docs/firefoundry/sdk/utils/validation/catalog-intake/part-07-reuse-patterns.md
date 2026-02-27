> **DEPRECATED** — See the [current tutorial](../../../agent_sdk/tutorials/catalog-intake/README.md).

# Part 7: Reuse Patterns

Extract repeated decorator stacks into reusable styles, apply class-level defaults, and auto-manage fields — eliminating boilerplate without losing clarity.

---

## The Problem: Repetition Everywhere

Look at the `SupplierProductDraftV6` from the last part. Count how many times you see `@CoerceTrim()` followed by `@CoerceCase('lower')`:

```typescript
class SupplierProductDraftV6 {
  @ValidateRequired()
  @DerivedFrom(['$.product_name', '$.productInfo.name', '$.PRODUCT_NAME'])
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;

  @DerivedFrom(['$.subcategory', '$.productInfo.subcategory', '$.SUBCATEGORY'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>((ctx) => ctx.subcategories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  subcategory: string;

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;

  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>((ctx) => ctx.colors, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  color_variant: string;

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  msrp: number;
}
```

Five fields have `@CoerceTrim()` / `@CoerceCase('lower')`. Two price fields repeat `@CoerceParse('currency')` / `@ValidateRange(0.01)`. If the team decides to add `@CoerceCase('lower')` to all string fields across the entire intake pipeline, you'd have to update every property in every supplier-specific class.

This isn't just annoying — it's a maintenance hazard. When the pattern for price coercion changes (say you add a max range), you need to find and update every price field in every validator. The validation library solves this with three tools: **`@UseStyle`** for named patterns, **`@DefaultTransforms`** for class-level defaults, and **`@ManageAll`** for auto-managing fields.

## @UseStyle — Named, Reusable Decorator Stacks

A style class is a plain TypeScript class with decorators on a `value` property. It packages a decorator stack into a named, reusable unit.

### Defining Styles

```typescript
import {
  CoerceTrim,
  CoerceCase,
  CoerceParse,
  ValidateRange,
  ValidatePattern,
} from '@firebrandanalytics/shared-utils/validation';

/** Trim + lowercase: the standard treatment for lookup keys. */
class LookupKeyStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  value: string;
}

/** Trim + title case: for display names. */
class DisplayNameStyle {
  @CoerceTrim()
  @CoerceCase('title')
  value: string;
}

/** Currency parsing + positive range check. */
class CurrencyStyle {
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  value: number;
}

/** SKU format: trim, uppercase, pattern check. */
class SkuStyle {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{2,4}-\d{3,6}$/)
  value: string;
}
```

The property name `value` is a convention — the library reads the decorators from the class and applies them to whatever property uses the style. Think of it like a CSS class: you define the rules once, then apply them by name.

### Applying Styles

```typescript
import { UseStyle, ValidateRequired, DerivedFrom, CoerceFromSet } from '@firebrandanalytics/shared-utils/validation';

class SupplierProductDraftV7 {
  @ValidateRequired()
  @DerivedFrom(['$.product_name', '$.productInfo.name', '$.PRODUCT_NAME'])
  @UseStyle(DisplayNameStyle)
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;

  @DerivedFrom(['$.subcategory', '$.productInfo.subcategory', '$.SUBCATEGORY'])
  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.subcategories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  subcategory: string;

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;

  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @UseStyle(LookupKeyStyle)
  @CoerceFromSet<CatalogContext>((ctx) => ctx.colors, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  color_variant: string;

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @UseStyle(CurrencyStyle)
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @UseStyle(CurrencyStyle)
  msrp: number;
}
```

Compare this to V6. Every `@CoerceTrim()` / `@CoerceCase('lower')` pair has been replaced with `@UseStyle(LookupKeyStyle)`. Every `@CoerceParse('currency')` / `@ValidateRange(0.01)` pair is now `@UseStyle(CurrencyStyle)`. The validator reads more like a specification and less like imperative code.

### Composing Styles

Styles can reference other styles, building up from simple primitives:

```typescript
/** Base hygiene: just trim. */
class TrimStyle {
  @CoerceTrim()
  value: string;
}

/** Trim + lowercase: extends TrimStyle. */
class LookupKeyStyle {
  @UseStyle(TrimStyle)
  @CoerceCase('lower')
  value: string;
}

/** Email: extends LookupKeyStyle + pattern check. */
class EmailStyle {
  @UseStyle(LookupKeyStyle)
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}
```

This mirrors CSS's approach to building from base styles. `EmailStyle` inherits trim and lowercase from `LookupKeyStyle`, which inherits trim from `TrimStyle`. Change `TrimStyle` to add Unicode normalization, and every style built on top of it picks up the change.

## @DefaultTransforms — Class-Level Defaults

`@UseStyle` eliminates repetition within a class, but you still have to write `@UseStyle(LookupKeyStyle)` on every string property. If every lookup field in your class needs the same treatment, you can set a **default transform** for the type:

```typescript
import { DefaultTransforms, Copy } from '@firebrandanalytics/shared-utils/validation';

@DefaultTransforms({
  string: LookupKeyStyle,   // All managed string properties get trim + lower
  number: CurrencyStyle,    // All managed number properties get currency parsing + range
})
class SupplierProductDraftV7b {
  @ValidateRequired()
  @DerivedFrom(['$.product_name', '$.productInfo.name', '$.PRODUCT_NAME'])
  @CoerceCase('title')  // Override: product_name needs title case, not lowercase
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;  // Gets LookupKeyStyle automatically

  @DerivedFrom(['$.subcategory', '$.productInfo.subcategory', '$.SUBCATEGORY'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.subcategories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  subcategory: string;  // Gets LookupKeyStyle automatically

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;  // Gets LookupKeyStyle automatically

  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.colors, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  color_variant: string;  // Gets LookupKeyStyle automatically

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  base_cost: number;  // Gets CurrencyStyle automatically

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  msrp: number;  // Gets CurrencyStyle automatically
}
```

Notice that `product_name` has `@CoerceCase('title')` directly on the property. This **overrides** the class default — the `LookupKeyStyle`'s lowercase coercion is replaced by title case. The cascade works like CSS specificity:

| Level | Mechanism | Priority |
|-------|-----------|----------|
| Factory | `new ValidationFactory({ defaultTransforms: ... })` | Lowest |
| Class | `@DefaultTransforms({ string: LookupKeyStyle })` | Medium |
| Property style | `@UseStyle(EmailStyle)` | High |
| Property decorator | `@CoerceCase('title')` | Highest |

More specific rules always win. A `@CoerceCase('title')` on the property beats the class-level `LookupKeyStyle`'s `@CoerceCase('lower')`.

### Factory-Level Defaults

For application-wide consistency, you can configure defaults on the `ValidationFactory` itself. Every class created by that factory inherits the defaults unless they override:

```typescript
const intakeFactory = new ValidationFactory({
  defaultTransforms: {
    string: LookupKeyStyle,  // All strings: trim + lower
    number: CurrencyStyle,   // All numbers: currency parse + positive
  },
});

// ProductListing inherits factory defaults — no @DefaultTransforms needed
class ProductListing {
  @Copy()
  title: string;  // Gets LookupKeyStyle from factory

  @Copy()
  category: string;  // Gets LookupKeyStyle from factory

  @Copy()
  price: number;  // Gets CurrencyStyle from factory
}

// ContactRecord overrides factory defaults at the class level
@DefaultTransforms({ string: DisplayNameStyle })
class ContactRecord {
  @Copy()
  name: string;  // Gets DisplayNameStyle (class override), NOT LookupKeyStyle

  @Copy()
  email: string;  // Gets DisplayNameStyle (class override)
}
```

**Important:** Class-level `@DefaultTransforms` *replaces* the factory default for that type entirely. It does not merge. `ContactRecord` gets `DisplayNameStyle` for strings, not `LookupKeyStyle` + `DisplayNameStyle`.

### Managed Properties

There's one catch: defaults only apply to **managed properties** — properties that have at least one decorator. An undecorated property is invisible to the validation engine. That's why `ProductListing` uses `@Copy()` on each field: it opts the property into the pipeline so the default can apply.

For classes where every property needs to be managed, writing `@Copy()` on each one is its own kind of repetition. That's what `@ManageAll` solves.

## @ManageAll — Auto-Managing Fields

`@ManageAll` marks fields as managed without requiring individual `@Copy()` decorators:

```typescript
import { ManageAll, DefaultTransforms } from '@firebrandanalytics/shared-utils/validation';

@ManageAll({ include: ['category', 'subcategory', 'brand_line', 'color_variant'] })
@DefaultTransforms({ string: LookupKeyStyle })
class SimpleLookupFields {
  category: string;      // Managed + gets LookupKeyStyle
  subcategory: string;   // Managed + gets LookupKeyStyle
  brand_line: string;    // Managed + gets LookupKeyStyle
  color_variant: string;         // Managed + gets LookupKeyStyle
  internal_notes: string; // NOT managed — not in the include list
}
```

Without `@ManageAll`, each property would need an explicit `@Copy()` for the `@DefaultTransforms` to kick in. With it, the four fields are automatically managed and receive the class-level default.

The `include` list is explicit by design. Rather than managing everything and hoping nothing leaks through, you declare exactly which fields are auto-managed. This prevents a new property from accidentally getting processed by the validation pipeline before you've decided how to handle it.

## Putting It All Together: The Intake Factory

Here's how the three reuse patterns combine in a production catalog intake pipeline:

### Step 1: Define the Styles

```typescript
// styles/intake-styles.ts

class TrimStyle {
  @CoerceTrim()
  value: string;
}

class LookupKeyStyle {
  @UseStyle(TrimStyle)
  @CoerceCase('lower')
  value: string;
}

class DisplayNameStyle {
  @UseStyle(TrimStyle)
  @CoerceCase('title')
  value: string;
}

class CurrencyStyle {
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  value: number;
}
```

### Step 2: Configure the Factory

```typescript
// intake-factory.ts

const intakeFactory = new ValidationFactory({
  defaultTransforms: {
    string: LookupKeyStyle,
    number: CurrencyStyle,
  },
});
```

### Step 3: Write Lean Validator Classes

```typescript
// validators/supplier-product-draft-v7.ts

@DefaultTransforms({
  string: LookupKeyStyle,
  number: CurrencyStyle,
})
class SupplierProductDraftV7 {
  @ValidateRequired()
  @DerivedFrom(['$.product_name', '$.productInfo.name', '$.PRODUCT_NAME'])
  @UseStyle(DisplayNameStyle)  // Override: title case for product names
  product_name: string;

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.categories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  category: string;

  @DerivedFrom(['$.subcategory', '$.productInfo.subcategory', '$.SUBCATEGORY'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.subcategories, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  subcategory: string;

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.brandLines, {
    strategy: 'fuzzy', fuzzyThreshold: 0.7
  })
  brand_line: string;

  @DerivedFrom(['$.color_variant', '$.specs.colorway', '$.COLOR'])
  @CoerceFromSet<CatalogContext>((ctx) => ctx.colors, {
    strategy: 'fuzzy', fuzzyThreshold: 0.6
  })
  color_variant: string;

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CrossValidate(['base_cost'], function(this: SupplierProductDraftV7) {
    return this.msrp > this.base_cost
      || `Retail price must exceed wholesale price`;
  }, 'Retail > wholesale')
  msrp: number;
}
```

Look at how clean this is compared to V6. The string lookup fields have no explicit trim/case decorators — they inherit from `@DefaultTransforms`. The price fields have no explicit parse/range decorators — same inheritance. Only `product_name` and the `@CoerceFromSet` / `@ObjectRule` decorators are explicit, because they're the parts that differ from the defaults.

### Step 4: Lean Supplier-Specific Classes

The discriminated union classes from Part 3 benefit even more. Here's Supplier A's class before and after:

**Before (V6):**

```typescript
class SupplierAFormat {
  @Copy()
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  color_variant: string;

  @Copy()
  @CoerceType('number')
  @ValidateRange(0.01)
  base_cost: number;

  @Copy()
  @CoerceType('number')
  @ValidateRange(0.01)
  msrp: number;
}
```

**After (V7):**

```typescript
@ManageAll({ include: [
  'product_name', 'category', 'subcategory',
  'brand_line', 'color_variant', 'base_cost', 'msrp'
]})
@DefaultTransforms({
  string: LookupKeyStyle,
  number: CurrencyStyle,
})
class SupplierAFormat {
  @UseStyle(DisplayNameStyle)  // Override: title case
  product_name: string;

  category: string;
  subcategory: string;
  brand_line: string;
  color_variant: string;
  base_cost: number;
  msrp: number;
}
```

Seven fields. One explicit style override. Everything else comes from defaults. If the team later decides all lookup keys need Unicode normalization, they change `LookupKeyStyle` once, and every supplier class picks it up.

## When to Use Each Pattern

| Pattern | Use When | Scope |
|---------|----------|-------|
| `@UseStyle(MyStyle)` | You have a decorator stack that repeats across multiple properties | One property at a time |
| `@DefaultTransforms` | All properties of a given type in a class need the same treatment | All managed properties of that type |
| `@ManageAll` | You want defaults to apply without sprinkling `@Copy()` everywhere | Listed properties become managed |
| Factory defaults | Application-wide formatting standards | Every class created by the factory |

**Rules of thumb:**

- Start with `@UseStyle` when you notice the same 2-3 decorators appearing on multiple fields
- Promote to `@DefaultTransforms` when every string (or every number) in a class needs the same style
- Add `@ManageAll` when you're writing `@Copy()` on many fields just to opt them into defaults
- Configure factory defaults when the same type treatment applies across your entire application

## What's Next

The V7 validator is compact and maintainable, but we've been relying on the default convergent validation engine without understanding how it works. In most cases the engine "just works" — but when you have computed fields that derive from other computed fields, execution order matters. A margin field that depends on both wholesale and retail price needs both prices resolved first.

In [Part 8: Engine Deep Dive](./part-08-engine-deep-dive.md), you'll learn how the convergent engine iterates to stability, when to switch to the faster single-pass engine with `@UseSinglePassValidation`, how to declare explicit dependencies with `@DependsOn`, and what `ConvergenceTimeoutError` and `OscillationError` mean for your intake pipeline.

---

**Next:** [Part 8: Engine Deep Dive](./part-08-engine-deep-dive.md)

**Previous:** [Part 6: Conditionals + Object Rules](./part-06-conditionals-rules.md)
