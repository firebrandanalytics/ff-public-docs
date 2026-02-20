# Part 6: Conditionals + Object Rules

Apply validation rules that adapt based on product type, enforce cross-field relationships, and define business rules that span multiple properties.

---

## The Problem: One-Size-Fits-All Validation Doesn't Work

In Parts 1-5, every field on the validator goes through the same decorators regardless of context. That works for basic coercion and fuzzy matching — you always want to trim whitespace and match categories — but real business rules are conditional.

Consider these scenarios in the FireKicks catalog:

1. **Size format depends on category.** Running shoes use numeric sizes (`"7-13"`), but casual/lifestyle products use letter sizes (`"S-XL"`). The `@ValidatePattern` from Part 2 can't handle both.

2. **Retail price must exceed wholesale price.** This isn't a rule about one field — it's a relationship between two fields. No single-property decorator can enforce it.

3. **Description is required for new products but optional for restocks.** Whether a field is mandatory depends on another field's value.

4. **Premium brand lines require a minimum retail price.** The price threshold depends on the brand line classification.

These rules require two new capabilities: **conditional decorators** that adapt based on runtime values, and **object-level rules** that validate relationships across multiple fields.

## @If / @ElseIf / @Else / @EndIf — Conditional Decorator Blocks

Conditional decorators let you wrap any set of decorators in a condition. The wrapped decorators only execute if the condition is true.

### Basic Pattern: Validate Based on Another Property

The most common use case is changing validation based on another field's value. Here's how to enforce different size range formats based on category:

```typescript
import {
  If, ElseIf, Else, EndIf,
  ValidatePattern,
  CoerceTrim,
  CoerceCase,
  CoerceFromSet,
  DerivedFrom,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

class SupplierProductDraftV6 {
  // ... product_name, brand_line, prices from previous parts ...

  @ValidateRequired()
  @DerivedFrom(['$.category', '$.productInfo.category', '$.CATEGORY'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  category: string;

  @DerivedFrom(['$.size_range', '$.specs.sizeRange', '$.SIZE_RANGE'])
  @CoerceTrim()
  @If('category', ['running', 'basketball', 'training'])
    @ValidatePattern(
      /^\d+(\.\d+)?-\d+(\.\d+)?$/,
      'Athletic size range must be numeric, e.g. "7-13" or "7.5-12.5"'
    )
  @ElseIf('category', ['casual', 'skateboarding'])
    @ValidatePattern(
      /^(XS|S|M|L|XL|XXL)-(XS|S|M|L|XL|XXL)$/i,
      'Casual size range must use letter sizes, e.g. "S-XL"'
    )
  @Else()
    @ValidateRequired()  // Unknown category — at least require the field exists
  @EndIf()
  size_range: string;
}
```

Let's break down how this works:

1. **`@If('category', ['running', 'basketball', 'training'])`** — Check if the `category` property (after it has been fully processed — trimmed, lowered, fuzzy-matched) equals one of the listed values. When an array is passed as the expected value, the library treats it as an "in-list" check.

2. The decorators between `@If` and `@ElseIf` — in this case `@ValidatePattern` with the numeric regex — only run if the condition is true.

3. **`@ElseIf('category', ['casual', 'skateboarding'])`** — If the first condition was false, check this one. The letter-size pattern only applies to casual and skateboarding.

4. **`@Else()`** — If neither condition matched (perhaps a new category was added to the catalog), fall back to just requiring the field exists.

5. **`@EndIf()`** — Marks the end of the conditional block.

### How Conditional Dependencies Work

When you reference another property in `@If('category', ...)`, the validation engine automatically ensures `category` is fully processed before evaluating the condition on `size_range`. You don't need to declare this dependency manually — the library infers it from the conditional expression.

This means:

```
category: raw → trim → lowercase → fuzzy match → "running"
                                                      |
size_range: raw → trim → [condition: category === "running"?] → numeric pattern check
```

The `size_range` decorators wait for `category` to resolve before deciding which validation pattern to apply.

### Checking the Current Property's Value

You can also check the property's own in-progress value. This is useful for applying expensive transformations only when needed:

```typescript
class DraftWithConditionalAI {
  @CoerceTrim()
  @If((val: string) => val.length > 500)
    @AITransform('Summarize this product description to under 200 characters')
  @EndIf()
  description: string;
}
```

The lambda receives the value after previous decorators have run (in this case, after `@CoerceTrim`). If the trimmed description is longer than 500 characters, the AI summarizer runs. Otherwise, it's left as-is. This avoids unnecessary (and expensive) AI calls for short descriptions.

### Checking JSONPath in the Raw Input

Sometimes you need to check a field in the original input that isn't part of your validator class. Use a JSONPath expression starting with `$`:

```typescript
class DraftWithSourceCheck {
  @If('$.metadata.isRestock', true)
    @Copy()  // Restocks: just copy the description, don't require it
  @Else()
    @Copy()
    @ValidateRequired()  // New products: description is mandatory
  @EndIf()
  description: string;
}
```

JSONPath conditions check the **original raw input**, not the processed instance. They don't create intra-cycle dependencies, making them useful for metadata fields that aren't part of the output schema.

## @ObjectRule — Enforcing Cross-Field Relationships

Some business rules span multiple properties. "Retail price must be greater than wholesale price" isn't about either price in isolation — it's about their relationship. `@ObjectRule` validates the entire object after all property-level decorators have run.

```typescript
import { ObjectRule } from '@firebrandanalytics/shared-utils/validation';

@ObjectRule(function(this: SupplierProductDraftV6) {
  if (this.retail_price <= this.wholesale_price) {
    return `Retail price ($${this.retail_price}) must be greater than wholesale price ($${this.wholesale_price})`;
  }
  return true;
}, 'Retail > wholesale price check')
class SupplierProductDraftV6 {
  // ... all property decorators ...

  @DerivedFrom(['$.wholesale_price', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  wholesale_price: number;

  @DerivedFrom(['$.retail_price', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;

  // ... other fields ...
}
```

The `@ObjectRule` callback receives the fully validated instance via `this`. Both prices have already been parsed, coerced to numbers, and range-checked. The object rule then checks the relationship between them.

If the rule returns a string, that string becomes the error message. If it returns `true`, the rule passes. If it returns `false`, a generic error is produced (always prefer returning a descriptive string).

### Multiple Object Rules

You can stack multiple `@ObjectRule` decorators on a class. They run in order after all property validation is complete:

```typescript
@ObjectRule(function(this: SupplierProductDraftV6) {
  if (this.retail_price <= this.wholesale_price) {
    return `Retail ($${this.retail_price}) must exceed wholesale ($${this.wholesale_price})`;
  }
  return true;
}, 'Price relationship check')
@ObjectRule(function(this: SupplierProductDraftV6) {
  const margin = (this.retail_price - this.wholesale_price) / this.retail_price;
  if (margin < 0.2) {
    return `Margin ${(margin * 100).toFixed(1)}% is below minimum 20% threshold`;
  }
  return true;
}, 'Minimum margin check')
class SupplierProductDraftV6 {
  // ...
}
```

The first rule ensures retail exceeds wholesale. The second rule ensures a minimum 20% margin. Both run on the fully validated instance, so they operate on clean, typed values.

## @CrossValidate — Property-Level Cross-Field Validation

`@CrossValidate` is similar to `@ObjectRule` but is scoped to a specific property rather than the whole class. Use it when a validation depends on other properties but logically "belongs" to one field:

```typescript
import { CrossValidate } from '@firebrandanalytics/shared-utils/validation';

class SupplierProductDraftV6 {
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brandLines,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  brand_line: string;

  @DerivedFrom(['$.retail_price', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  @CrossValidate(['brand_line'], function(this: SupplierProductDraftV6) {
    const premiumBrands = ['jordan', 'premium', 'signature'];
    if (premiumBrands.includes(this.brand_line) && this.retail_price < 100) {
      return `Premium brand "${this.brand_line}" products must have retail price >= $100 (got $${this.retail_price})`;
    }
    return true;
  }, 'Premium brand minimum price')
  retail_price: number;
}
```

The first argument to `@CrossValidate` is the list of properties this validation depends on. The library ensures those properties are processed first. The callback receives the fully processed instance via `this`.

The key difference from `@ObjectRule`:
- **`@ObjectRule`** runs after ALL properties are validated. It's for rules about the object as a whole.
- **`@CrossValidate`** runs when the specific property is being processed, after its dependencies are resolved. The error is attributed to that specific property path.

## The Complete V6 Validator

Here's the full `SupplierProductDraftV6` class, bringing together conditional validation, object rules, and cross-validation with everything from Parts 1-5:

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  ValidateRange,
  ValidatePattern,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  CoerceParse,
  CoerceFromSet,
  Copy,
  DerivedFrom,
  If, ElseIf, Else, EndIf,
  ObjectRule,
  CrossValidate,
  ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

interface CatalogContext {
  categories: string[];
  subcategories: string[];
  brandLines: string[];
  colors: string[];
}

@ObjectRule(function(this: SupplierProductDraftV6) {
  if (this.retail_price <= this.wholesale_price) {
    return `Retail price ($${this.retail_price}) must exceed wholesale ($${this.wholesale_price})`;
  }
  return true;
}, 'Retail > wholesale')
@ObjectRule(function(this: SupplierProductDraftV6) {
  const margin = (this.retail_price - this.wholesale_price) / this.retail_price;
  if (margin < 0.2) {
    return `Margin ${(margin * 100).toFixed(1)}% is below 20% minimum`;
  }
  return true;
}, 'Minimum margin')
class SupplierProductDraftV6 {
  // --- Product identity (from Part 2 + Part 5 fuzzy matching) ---

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
  subcategory: string;

  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brandLines,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  brand_line: string;

  // --- Prices with cross-validation ---

  @DerivedFrom(['$.wholesale_price', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  wholesale_price: number;

  @DerivedFrom(['$.retail_price', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  @CrossValidate(['brand_line'], function(this: SupplierProductDraftV6) {
    const premiumBrands = ['jordan', 'premium', 'signature'];
    if (premiumBrands.includes(this.brand_line) && this.retail_price < 100) {
      return `Premium brand "${this.brand_line}" requires retail >= $100 (got $${this.retail_price})`;
    }
    return true;
  }, 'Premium brand minimum price')
  retail_price: number;

  // --- Size range with conditional pattern (NEW in V6) ---

  @DerivedFrom(['$.size_range', '$.specs.sizeRange', '$.SIZE_RANGE'])
  @CoerceTrim()
  @If('category', ['running', 'basketball', 'training'])
    @ValidatePattern(
      /^\d+(\.\d+)?-\d+(\.\d+)?$/,
      'Athletic size range must be numeric, e.g. "7-13" or "7.5-12.5"'
    )
  @ElseIf('category', ['casual', 'skateboarding'])
    @ValidatePattern(
      /^(XS|S|M|L|XL|XXL)-(XS|S|M|L|XL|XXL)$/i,
      'Casual/skate size range must use letter sizes, e.g. "S-XL"'
    )
  @EndIf()
  size_range: string;

  // --- Color (from Part 5) ---

  @DerivedFrom(['$.color', '$.specs.colorway', '$.COLOR'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.colors,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.6,
      synonyms: {
        'black/white': ['blk/wht', 'bk/wh', 'black and white'],
        'navy/gold': ['navy and gold', 'nvy/gld'],
      }
    }
  )
  color: string;

  // --- Description: required for new products, optional for restocks ---

  @DerivedFrom(['$.description', '$.productInfo.description', '$.DESCRIPTION'])
  @CoerceTrim()
  @If('$.metadata.isRestock', true)
    @Copy()  // Restocks: optional
  @Else()
    @ValidateRequired()  // New products: mandatory
  @EndIf()
  description: string;
}
```

## Before/After: Conditional Validation in Action

**Input (running shoe, valid):**

```json
{
  "product_name": "  Nike Pegasus 41  ",
  "category": "runing",
  "subcategory": "mens",
  "brand_line": "performnce",
  "wholesale_price": "$65.00",
  "retail_price": "$130.00",
  "size_range": "7-14",
  "color": "blk/wht",
  "description": "Latest generation daily trainer"
}
```

**Output:**

```json
{
  "product_name": "Nike Pegasus 41",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance",
  "wholesale_price": 65,
  "retail_price": 130,
  "size_range": "7-14",
  "color": "black/white",
  "description": "Latest generation daily trainer"
}
```

The size range `"7-14"` passes the numeric pattern because the fuzzy-matched category is `"running"`.

**Input (casual product with letter sizes, valid):**

```json
{
  "product_name": "  Street Classic Hoodie  ",
  "category": "lifestyle",
  "subcategory": "unisex",
  "brand_line": "performance",
  "wholesale_price": "$25.00",
  "retail_price": "$55.00",
  "size_range": "S-XXL",
  "color": "grey/black",
  "description": "Relaxed fit pullover hoodie"
}
```

**Output:**

```json
{
  "product_name": "Street Classic Hoodie",
  "category": "casual",
  "subcategory": "unisex",
  "brand_line": "performance",
  "wholesale_price": 25,
  "retail_price": 55,
  "size_range": "S-XXL",
  "color": "grey/black",
  "description": "Relaxed fit pullover hoodie"
}
```

Notice that `"lifestyle"` was synonym-matched to `"casual"`, and `"S-XXL"` passes the letter-size pattern because the condition routes to the casual branch.

**Input (fails: retail below wholesale):**

```json
{
  "product_name": "Discount Runner",
  "category": "running",
  "wholesale_price": "$80.00",
  "retail_price": "$60.00",
  "size_range": "8-12",
  "color": "black/white"
}
```

**Error:**

```
Retail price ($60) must exceed wholesale ($80)
```

The `@ObjectRule` catches this after both prices are parsed and validated individually. Each price passes its own `@ValidateRange(0.01)` check, but the relationship between them fails.

**Input (fails: premium brand, low retail):**

```json
{
  "product_name": "Jordan Low",
  "category": "basketball",
  "brand_line": "jordan",
  "wholesale_price": "$35.00",
  "retail_price": "$70.00",
  "size_range": "7-13",
  "color": "black/white"
}
```

**Error:**

```
Premium brand "jordan" requires retail >= $100 (got $70)
```

The `@CrossValidate` on `retail_price` detects that the `"jordan"` brand line demands a higher retail price.

## When to Use Each Tool

| Scenario | Decorator | Why |
|----------|-----------|-----|
| Different validation based on a field's value | `@If` / `@ElseIf` / `@Else` / `@EndIf` | Wraps decorators in conditions; the library handles dependency ordering |
| Two fields must satisfy a relationship | `@ObjectRule` | Runs after all properties; validates the whole object |
| A field's validity depends on another field | `@CrossValidate` | Runs during property processing; error attributed to the specific field |
| Skip expensive transforms for simple data | `@If` with lambda on current value | Avoids unnecessary AI calls or complex parsing |

**Rules of thumb:**
- Use **`@If`** when the *processing logic* changes (different patterns, different coercions)
- Use **`@ObjectRule`** when the *business rule* spans the whole object (price relationships, date ranges)
- Use **`@CrossValidate`** when the *business rule* logically belongs to one field but needs to see another

## What's Next

The V6 validator handles conditional logic and cross-field rules, but there's a lot of repetition. Every supplier mapping class repeats the same `@CoerceTrim()` / `@CoerceCase('lower')` stack. Every price field has the same `@CoerceParse('currency')` / `@ValidateRange(0.01)` pattern.

In [Part 7: Reuse Patterns](./part-07-reuse-patterns.md), you'll learn how to extract these repeated patterns into reusable styles with `@UseStyle`, apply class-level defaults with `@DefaultTransforms`, and auto-manage fields with `@ManageAll` — eliminating the repetition while keeping the validator readable.

---

**Next:** [Part 7: Reuse Patterns](./part-07-reuse-patterns.md)

**Previous:** [Part 5: Fuzzy Matching + Runtime Context](./part-05-fuzzy-matching.md)
