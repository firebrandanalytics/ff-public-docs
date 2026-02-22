# Part 7: Business Rules & Nested Variants

Hiking shoes come in half sizes -- 7, 7.5, 8, 8.5. Basketball shoes are whole sizes only -- 8, 9, 10. Casual shoes have W-width variants. A single `@ValidatePattern` on `size_format` can't handle all three. You need conditional validation that branches based on category, cross-field rules that catch negative margins before they hit the database, and nested variant arrays where each size/color/SKU combination gets its own validation. That's what this part adds.

**Starting point:** Completed code from [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md). You should have a working pipeline with `@CoerceFromSet` fuzzy matching, `CatalogContext`, and DAS integration.

---

## The Problem: Category-Specific Rules

Open the product browser and look at a few validated products. The individual fields all pass their checks, but the data still has problems that single-field decorators can't catch:

1. **Wrong size format.** A supplier submits `size_format: "7-13"` for a hiking shoe. Valid format, but hiking shoes need half sizes like `"7-13 (half)"`. Basketball shoes need whole sizes only. The correct pattern depends on the category.

2. **Negative margins.** `base_cost: 89.99` and `msrp: 79.99` both pass their own numeric validations. But the business loses money on every sale. You need a rule that compares two fields.

3. **Kids price ceilings.** If `category` is `"kids"` and `msrp` exceeds $200, something is wrong. Neither field is invalid on its own -- the combination is the problem.

4. **Variant data.** Each product ships with an array of size/color/SKU combinations. Right now those get flattened into a comma-separated string or dropped entirely. Each variant needs its own validation.

None of these are single-field problems. They need conditional logic, multi-field rules, and nested class validation.

---

## @If / @Else -- Conditional Validation

The `@If` / `@Else` / `@EndIf` decorators let you branch the validation pipeline based on another field's value. Size format depends on category, so let's branch on it:

```typescript
@If('category', 'hiking')
  @ValidatePattern(/^\d+(\.\d)?$/, 'Hiking sizes allow half sizes (e.g., "8.5")')
@Else()
  @ValidatePattern(/^\d+$/, 'Sizes must be whole numbers')
@EndIf()
@Copy()
@CoerceTrim()
size_format!: string;
```

When `category` resolves to `'hiking'`, only the half-size pattern runs. For everything else, the `@Else` branch enforces whole numbers. The engine automatically resolves `category` before evaluating `size_format` -- you don't need to manage field ordering.

### Predicate conditions

Instead of equality checks, you can use a function:

```typescript
@If('product_name', (name: string) => name.toLowerCase().includes('collab'))
  @ValidateRequired('Collaboration products must specify a color')
@EndIf()
@Copy()
@CoerceTrim()
color: string;
```

Or check multiple fields at once:

```typescript
@If(['category', 'msrp'], ([cat, msrp]: any[]) => cat === 'kids' && msrp > 120)
  @Validate(() => 'Kids shoes over $120 require manager approval')
@EndIf()
@Copy()
approval_flag: string;
```

### Rules for conditional blocks

- **No nesting.** You can't put an `@If` inside another `@If`. Keep it flat.
- **One `@Else`.** Only one per block, and it must come last.
- **Same field.** All `@ElseIf` branches must reference the same property as the original `@If`.
- **First match wins.** Branches evaluate in order.

---

## @ObjectRule -- Class-Level Business Rules

`@ObjectRule` is a class-level decorator. It runs after all property validations complete and sees the fully resolved object. Perfect for invariants that span multiple fields.

The classic example -- MSRP must exceed base cost:

```typescript
@ObjectRule((product) => product.msrp > product.base_cost,
  'MSRP must be greater than base cost (positive margin)')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ...
}
```

Return `true` if valid. Return a string error message if not. The description (`'positive margin'`) shows up in the validation trace.

Stack multiple rules on the same class:

```typescript
@ObjectRule((product) => product.msrp > product.base_cost,
  'Positive margin check')
@ObjectRule((product) => !(product.category === 'kids' && product.msrp > 200),
  'Kids products cannot exceed $200 MSRP')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ...
}
```

Both rules fire after all fields are validated. If either fails, the error message ends up in the validation trace and the product is flagged.

---

## @CrossValidate -- Multi-Field Dependencies

`@CrossValidate` is like `@ObjectRule` but scoped to a specific property. Use it when the error logically belongs to one field, even though the rule checks another.

If `category` is `"kids"`, then `msrp` can't exceed $200. The error should attach to the `msrp` field so the GUI highlights it:

```typescript
@CrossValidate(['category'], (obj) => {
  if (obj.category === 'kids' && obj.msrp > 200) {
    return 'Kids products cannot exceed $200 MSRP';
  }
  return true;
}, 'Kids MSRP ceiling')
@Copy()
@CoerceType('number')
@ValidateRequired()
msrp: number;
```

The first argument lists dependencies -- properties that must resolve before this rule runs. The error attaches to `msrp` specifically, which means the GUI can highlight that field instead of showing a generic class-level error.

**When to use which?** `@ObjectRule` for invariants that don't belong to any single field (like "no duplicate SKUs across all variants"). `@CrossValidate` for rules where the error naturally belongs to a specific field (like "this price is too high for this category").

Another common pattern -- a derived field that computes margin from two other fields:

```typescript
@DerivedFrom(['msrp', 'base_cost'], (_, ctx) => {
  const { msrp, base_cost } = ctx.instance;
  if (msrp === 0) return 0;
  return Math.round(((msrp - base_cost) / msrp) * 10000) / 10000;
})
margin_pct: number;
```

`margin_pct` doesn't need `@Copy` because it's never read from input -- it's always computed. The engine ensures `msrp` and `base_cost` resolve first.

---

## @ValidatedClassArray -- Nested Variants

A single product has many variants. The Nike Air Max 90 comes in 6 sizes and 4 colors -- that's 24 SKUs, each with its own price. Suppliers send these as a nested array:

```json
{
  "product_name": "Air Max 90",
  "variants": [
    { "size": "9", "color": "Black/White", "sku": "AM90-BW-9", "unit_price": 130.00 },
    { "size": "9.5", "color": "Black/White", "sku": "AM90-BW-95", "unit_price": 130.00 },
    { "size": "10", "color": "University Red", "sku": "AM90-UR-10", "unit_price": 135.00 }
  ]
}
```

Each variant needs its own validation. Define a class for a single variant:

```typescript
class SupplierVariant {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^\d+(\.\d)?$/, 'Size must be numeric (e.g., "9", "10.5")')
  size: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  color: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^[A-Z0-9]+-[A-Z0-9]+-\d+/, 'SKU must match format CODE-COLOR-SIZE')
  sku: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  @Validate((v: number) => v > 0 || 'Unit price must be positive')
  unit_price: number;
}
```

`SupplierVariant` is a regular validation class -- no `@Serializable` because it's not stored independently. It's nested inside the parent.

Now wire it in with `@ValidatedClassArray`:

```typescript
@ValidatedClassArray(SupplierVariant)
variants!: SupplierVariant[];
```

That's it. When `ValidationFactory.create(SupplierBProductV2, data)` runs, it processes top-level fields as before, then for each element in the `variants` array, it creates a `SupplierVariant` instance and runs the full decorator pipeline. If variant #2 has a bad SKU, the error is scoped:

```
variants[2].sku: SKU must match format CODE-COLOR-SIZE
```

The array index makes it trivial to pinpoint the problem in both logs and the GUI.

### Variant-level rules on the parent

You can enforce uniqueness across the variant array with an `@ObjectRule` on the parent class:

```typescript
@ObjectRule(function(this: SupplierBProductV2) {
  const skus = this.variants.map(v => v.sku);
  const dupes = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (dupes.length > 0) {
    return `Duplicate variant SKUs: ${[...new Set(dupes)].join(', ')}`;
  }
  return true;
}, 'Unique variant SKUs')
```

This fires after all variants have been validated individually, so you know every `sku` is well-formed before checking for duplicates.

### Single nested objects

If a product had one nested object instead of an array -- say, `dimensions` -- use `@ValidatedClass` (no "Array"):

```typescript
@ValidatedClass(ProductDimensions)
dimensions: ProductDimensions;
```

Same pattern: define a class, decorate the field, and the engine handles recursive validation.

---

## GUI Updates

The GUI needs three additions to surface business rules and variant data.

### Expandable variant table

Add a collapsible section to each product card in the browser. Clicking it reveals a table of size/color/SKU/price rows. The variant count shows on the collapsed header (`"24 variants"`), and each row comes straight from the validated `SupplierVariant` instances. The key props:

```tsx
<VariantTable variants={product.variants} />
```

The table is expandable/collapsible -- collapsed by default since most reviewers only drill in when something is flagged.

### Validation badges

Show error and warning counts per product using color-coded badges. The validation trace already captures this data -- now you surface it:

- **Green "Valid"** badge when `errors === 0 && warnings === 0`
- **Red badge** with error count: `"3 errors"`
- **Yellow badge** with warning count: `"1 warning"`

For business rule violations specifically (like negative margin), the badge links to the rule description from the `@ObjectRule` decorator. Clicking it scrolls to the offending field or shows the rule's error message in a tooltip.

### Dynamic variant entry

The intake form needs a way to add and remove variant rows. Each row has size, color, SKU, and price inputs. A `"+ Add variant"` button appends a blank row; a `"Remove"` button on each row deletes it (disabled when only one row remains). On submit, string prices get parsed to numbers:

```tsx
const payload = {
  ...formData,
  variants: variants.map(v => ({
    ...v,
    unit_price: parseFloat(v.unit_price) || 0
  }))
};
```

The variant editor feeds directly into the same `SupplierBProductV2` validation pipeline, so each row gets the full `SupplierVariant` decorator treatment on the server side.

---

## Putting It Together

Here's a test payload that exercises all the new rules:

```bash
curl -X POST http://localhost:3001/api/catalog-intake \
  -H "Content-Type: application/json" \
  -d '{
    "supplier": "B",
    "version": "2",
    "product_name": "Air Max 90 Kids",
    "category": "kids",
    "base_cost": 45.00,
    "msrp": 89.99,
    "size_range": "1Y-7Y",
    "variants": [
      { "size": "3", "color": "White/Pink", "sku": "AM90K-WP-3", "unit_price": 89.99 },
      { "size": "5", "color": "White/Pink", "sku": "AM90K-WP-5", "unit_price": 89.99 }
    ]
  }'
```

And a bad payload to confirm error reporting:

```bash
curl -X POST http://localhost:3001/api/catalog-intake \
  -H "Content-Type: application/json" \
  -d '{
    "supplier": "B",
    "version": "2",
    "product_name": "Air Max 90 Kids",
    "category": "kids",
    "base_cost": 95.00,
    "msrp": 79.99,
    "size_range": "7-13",
    "variants": [
      { "size": "9", "color": "Black", "sku": "bad-sku", "unit_price": -5 }
    ]
  }'
```

The bad payload should produce four errors:
- `size_range`: "Kids sizes must use youth format"
- Object rule: "MSRP ($79.99) must exceed base cost ($95.00)"
- `variants[0].sku`: "SKU must match format CODE-COLOR-SIZE"
- `variants[0].unit_price`: "Unit price must be positive"

Each error is scoped to the right field (or the right array index), and the GUI badges light up accordingly.

---

## Key Takeaways

1. **`@If` / `@Else` / `@EndIf`** branch the decorator pipeline based on another property's value. The engine resolves dependencies automatically.

2. **`@ObjectRule`** fires after all properties and sees the complete instance. Use it for invariants that span the whole object.

3. **`@CrossValidate`** fires during property processing and attaches errors to a specific field. Use it when the GUI should highlight that field.

4. **`@ValidatedClassArray`** enables recursive validation on nested arrays. Errors include array indices for precise reporting.

5. **The GUI surfaces everything.** Variant tables, validation badges, and dynamic variant entry turn the raw validation data into something a reviewer can act on.

---

## What's Next

Your validation pipeline handles conditional rules, cross-field constraints, and nested variant arrays. But some products still need human eyes -- maybe the fuzzy match was uncertain, or the margin is suspiciously high. In [Part 8: Human Review Workflow](./part-08-human-review.md), we'll add human review for uncertain products and a form-based manual entry pipeline.

---

**Next:** [Part 8: Human Review Workflow](./part-08-human-review.md)

**Previous:** [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md)
