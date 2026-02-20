# Part 1: Core Coercion + Validation

Build your first supplier product validator using the five most essential decorators.

---

## Introduction: The Supplier Problem

FireKicks sources sneakers and athletic footwear from dozens of suppliers. Each supplier sends product data in their own format, and none of it is clean. Here is a real sample from Supplier A:

```json
{
  "product_name": "  nike air MAX 90  ",
  "category": "RUNNING",
  "subcategory": "  Road Running  ",
  "brand_line": "  NIKE AIR  ",
  "wholesale_price": "45.50",
  "retail_price": "89.99"
}
```

The problems jump out immediately:

- **Whitespace:** Leading and trailing spaces on nearly every field
- **Inconsistent casing:** `"RUNNING"` is all-caps, `"Road Running"` is title case, `"NIKE AIR"` is shouting
- **Prices as strings:** Both prices arrive as `"45.50"` and `"89.99"` instead of numbers
- **No validation:** Nothing prevents a supplier from sending a negative price or omitting the product name entirely

Before this data can enter the FireKicks product catalog, every field needs cleaning and checking. You could write imperative code for each one — a `trim()` here, a `toLowerCase()` there, a `parseFloat()` and an `if` statement — but that approach doesn't scale. With 15 fields per product and 30 suppliers, you'd drown in boilerplate.

The validation library takes a different approach: **declare the rules, let the engine do the work.**

## The Philosophy: Coerce First, Validate Second

Most validation libraries reject bad data and force you to deal with it. This library is built on a different principle:

> **Fix what you can, reject only what you must.**

The decorator pipeline processes each field in two phases:

1. **Coercion phase** — transform the value toward its ideal form (trim, re-case, parse, type-convert)
2. **Validation phase** — check the coerced value against business rules (required, range, pattern)

This ordering matters. If a supplier sends `" 89.99 "` as a string, the coercion phase trims the whitespace and converts it to the number `89.99`. Only then does the validation phase check that the price is positive. If you validated first, you'd reject perfectly good data that just needed cleaning.

Decorators on a property execute **top-to-bottom** in source order. Within each phase, coercion decorators run before validation decorators regardless of their position in the source — but writing them in coerce-then-validate order keeps your code readable.

## Your First @ValidatedClass

Every validated class starts with a plain TypeScript class and a set of decorator imports:

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRange
} from '@firebrandanalytics/shared-utils/validation';
```

The simplest possible validator looks like this:

```typescript
class SupplierProductDraftV1 {
  @ValidateRequired()
  @CoerceTrim()
  product_name: string;
}

const factory = new ValidationFactory();
const draft = await factory.create(SupplierProductDraftV1, {
  product_name: '  nike air MAX 90  '
});

console.log(draft.product_name);
// "nike air MAX 90"  (trimmed, but casing untouched — we'll fix that next)
```

Two things to notice:

1. `ValidationFactory.create()` is the main entry point. It takes a class and raw input data, runs the decorator pipeline, and returns a clean instance.
2. `@ValidateRequired()` ensures the field exists and is not null, undefined, or empty string. `@CoerceTrim()` strips leading and trailing whitespace.

Now let's build the real thing.

## Building the Supplier Draft Validator

Here is the complete `SupplierProductDraftV1` class. Each decorator is explained below.

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRange
} from '@firebrandanalytics/shared-utils/validation';

class SupplierProductDraftV1 {
  // --- Required string fields: trim + case-normalize ---

  @ValidateRequired()
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @ValidateRequired()
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @CoerceTrim()
  @CoerceCase('lower')
  subcategory: string;

  @CoerceTrim()
  @CoerceCase('lower')
  brand_line: string;

  // --- Price fields: coerce to number + validate positive ---

  @CoerceType('number')
  @ValidateRange(0.01)
  wholesale_price: number;

  @CoerceType('number')
  @ValidateRange(0.01)
  retail_price: number;
}
```

Let's walk through each decorator and why it's there.

### @ValidateRequired() — Enforcing Mandatory Fields

```typescript
@ValidateRequired()
@CoerceTrim()
@CoerceCase('title')
product_name: string;
```

Every product must have a name. `@ValidateRequired()` runs before coercion and rejects the record immediately if `product_name` is null, undefined, or an empty string. Without it, a supplier could submit a blank product name and the rest of the pipeline would happily trim and title-case an empty string.

We also require `category` — every product needs a category for catalog organization. Fields like `subcategory` and `brand_line` are optional: a supplier might not provide them, and that's acceptable.

### @CoerceTrim() — Cleaning Whitespace

```typescript
@CoerceTrim()
@CoerceCase('lower')
category: string;
```

Supplier data is full of accidental whitespace: leading spaces from copy-paste, trailing spaces from fixed-width exports, and sometimes both. `@CoerceTrim()` strips it all. This is such a common need that you'll see it on virtually every string field in every validator you write.

`"  RUNNING  "` becomes `"RUNNING"` after trim (casing is handled next).

### @CoerceCase('title') and @CoerceCase('lower') — Normalizing Casing

```typescript
@CoerceCase('title')
product_name: string;

@CoerceCase('lower')
category: string;
```

Different suppliers use different casing conventions. One sends `"NIKE AIR MAX 90"`, another sends `"nike air max 90"`, and a third sends `"Nike Air Max 90"`. We need consistency.

For `product_name`, **title case** is the right choice: `"Nike Air Max 90"` reads naturally in the catalog. For `category`, `subcategory`, and `brand_line`, **lowercase** is better: these are lookup keys used for matching and grouping, where casing differences would create false duplicates.

Available case styles: `'lower'`, `'upper'`, `'title'`, `'camel'`, `'pascal'`, `'snake'`, `'kebab'`, `'constant'`.

### @CoerceType('number') — Handling Prices as Strings

```typescript
@CoerceType('number')
@ValidateRange(0.01)
wholesale_price: number;
```

Suppliers often send prices as strings — `"89.99"` instead of `89.99`. Some send them as strings because their export format is CSV (where everything is a string). Others send them as strings because their internal system stores prices as formatted text.

`@CoerceType('number')` handles the conversion: `"89.99"` becomes `89.99`, `"0"` becomes `0`, and `"not a number"` throws a coercion error. It understands common number representations including integers, decimals, and scientific notation.

### @ValidateRange(0.01) — Prices Must Be Positive

```typescript
@ValidateRange(0.01)
wholesale_price: number;
```

After type coercion, the price is a real number. Now we can validate it. `@ValidateRange(0.01)` ensures the price is at least 0.01 — no zero-dollar products and no negative prices. The first argument is the minimum; you can optionally pass a second argument for maximum: `@ValidateRange(0.01, 9999.99)`.

Notice that this decorator runs *after* `@CoerceType('number')`. If the string-to-number coercion had failed, the pipeline would have already thrown an error, so `@ValidateRange` always receives a real number.

## Running the Validator

Let's run the complete validator against the messy supplier input:

```typescript
const factory = new ValidationFactory();

const rawInput = {
  product_name: '  nike air MAX 90  ',
  category: 'RUNNING',
  subcategory: '  Road Running  ',
  brand_line: '  NIKE AIR  ',
  wholesale_price: '45.50',
  retail_price: '89.99'
};

const draft = await factory.create(SupplierProductDraftV1, rawInput);
console.log(draft);
```

**Output:**

```json
{
  "product_name": "Nike Air Max 90",
  "category": "running",
  "subcategory": "road running",
  "brand_line": "nike air",
  "wholesale_price": 45.5,
  "retail_price": 89.99
}
```

Every field has been cleaned. Let's trace what happened to each one:

| Field | Raw Input | After Trim | After Case | After Type | Final |
|-------|-----------|------------|------------|------------|-------|
| product_name | `"  nike air MAX 90  "` | `"nike air MAX 90"` | `"Nike Air Max 90"` | — | `"Nike Air Max 90"` |
| category | `"RUNNING"` | `"RUNNING"` | `"running"` | — | `"running"` |
| subcategory | `"  Road Running  "` | `"Road Running"` | `"road running"` | — | `"road running"` |
| brand_line | `"  NIKE AIR  "` | `"NIKE AIR"` | `"nike air"` | — | `"nike air"` |
| wholesale_price | `"45.50"` | — | — | `45.5` | `45.5` |
| retail_price | `"89.99"` | — | — | `89.99` | `89.99` |

## Reading the Output: What Happens When Validation Fails

What if a supplier sends bad data that can't be fixed by coercion?

```typescript
try {
  await factory.create(SupplierProductDraftV1, {
    product_name: '',           // empty — fails @ValidateRequired
    category: 'RUNNING',
    wholesale_price: '-5.00',   // negative — fails @ValidateRange after coercion to -5
    retail_price: '89.99'
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.propertyPath); // "product_name"
    console.log(error.message);      // "Value is required"
    console.log(error.rule);         // "ValidateRequired"
    console.log(error.actualValue);  // ""
  }
}
```

The `ValidationError` gives you everything you need to report back to the supplier:

- **`propertyPath`** — which field failed
- **`message`** — a human-readable description of the failure
- **`rule`** — which decorator caught the problem
- **`actualValue`** — the value that failed (after coercion, if applicable)

For the negative price, the error would be:

```typescript
{
  propertyPath: "wholesale_price",
  message: "Value must be >= 0.01",
  rule: "ValidateRange",
  actualValue: -5
}
```

Notice that `actualValue` is `-5` (a number), not `"-5.00"` (the original string). The price was successfully coerced to a number — it just failed the range check. This distinction helps you debug: if the actual value is still a string, the coercion failed. If it's the right type but wrong value, the validation caught it.

## Try It: Messy Input, Clean Output

Here is a deliberately messy supplier submission. Before reading the output below, try to predict what the validator will produce.

**Input:**

```typescript
const messyInput = {
  product_name: '   ADIDAS ultraBOOST 22   ',
  category: '   running   ',
  subcategory: '   ROAD running   ',
  brand_line: '   Adidas BOOST   ',
  wholesale_price: '62.00',
  retail_price: '119.99'
};

const draft = await factory.create(SupplierProductDraftV1, messyInput);
```

**Output:**

```json
{
  "product_name": "Adidas Ultraboost 22",
  "category": "running",
  "subcategory": "road running",
  "brand_line": "adidas boost",
  "wholesale_price": 62,
  "retail_price": 119.99
}
```

Six decorators. Zero imperative code. Every field is clean, typed, and ready for the catalog.

## What's Next

The V1 validator handles the basics — but it can't handle suppliers who send data in different structures. Supplier B wraps everything in nested objects. Supplier C sends prices as `"$89.99"` with a dollar sign. Some fields arrive with names like `productInfo.name` instead of `product_name`.

In [Part 2: Parsing + Reparenting](./part-02-parsing-reparenting.md), you'll learn how to extract values from nested payloads with `@DerivedFrom`, parse currency strings with `@CoerceParse`, and use `@Staging` fields as temporary scaffolding during transformation.
