# Part 4: Nested Variants -- Validating Arrays of Objects

## The Problem: Variants Live Inside the Payload

In Part 3 we solved the top-level dispatch problem: one `factory.create()` call routes to the right mapping class for each supplier format. But we glossed over a critical detail -- most supplier payloads don't just describe a single product. They include an array of **variants**: individual SKU-level records for each size/color combination.

Here's what Supplier A's full payload actually looks like:

```json
{
  "source_format": "flat_json_snake",
  "product_name": "Blaze Runner",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color_variant": "Black/White",
  "size_range": "7-13",
  "variants": [
    { "sku": "BLZ-RUN-BW-07", "size": "7",  "color": "Black/White", "quantity": 150, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-08", "size": "8",  "color": "Black/White", "quantity": 200, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-09", "size": "9",  "color": "Black/White", "quantity": 250, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-10", "size": "10", "color": "Black/White", "quantity": 300, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-11", "size": "11", "color": "Black/White", "quantity": 200, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-12", "size": "12", "color": "Black/White", "quantity": 100, "unit_cost": "89.99" },
    { "sku": "BLZ-RUN-BW-13", "size": "13", "color": "Black/White", "quantity": 50,  "unit_cost": "89.99" }
  ]
}
```

And of course, each supplier formats their variants differently:

**Supplier B** nests them under `specs.variants` with camelCase keys and prices as strings:

```json
{
  "specs": {
    "variants": [
      { "skuCode": "BLZ-RUN-BW-07", "shoeSize": "7", "colorway": "Black and White", "qty": "150", "costPerUnit": "89.99", "currencyCode": "USD" }
    ]
  }
}
```

**Supplier C** uses all-caps and dollar-sign prices:

```json
{
  "VARIANTS": [
    { "SKU_CODE": "BLZ-RUN-BW-07", "SIZE": "7", "CLR": "BLK/WHT", "QTY": "150", "UNIT_COST": "$89.99", "CURRENCY": "USD" }
  ]
}
```

The question is: how do you validate each variant in the array, apply per-supplier field mappings, and produce clean `supplier_product_variants` rows?

The naive approach is to loop over the array after the top-level mapping, manually cleaning each variant. But that defeats the purpose of declarative validation -- you'd be back to writing imperative code for the nested data.

## The Solution: `@ValidatedClassArray` for Variant Arrays

The validation library's `@ValidatedClassArray` decorator lets you declare that a property contains an array of validated objects. Each element in the array is independently validated and transformed through its own class.

### Step 1: Define the Variant Class

First, define a validated class for a single variant. This class normalizes all the fields that will end up in the `supplier_product_variants` table.

```typescript
import {
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';

class ProductVariant {
  @Copy()
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateRequired()
  sku: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  size: string;

  @Copy()
  @CoerceTrim()
  color: string;

  @Copy()
  @CoerceType('number')
  @ValidateRange(0, 100000)
  quantity: number;

  @Copy()
  @CoerceType('number')
  unit_cost: number;

  @Copy()
  @CoerceTrim()
  @CoerceCase('upper')
  currency_code: string;
}
```

This class handles Supplier A's format directly -- the field names match, so `@Copy` picks them up. The `@CoerceType('number')` decorator handles the string-to-number conversion for `unit_cost` (which Supplier A sends as `"89.99"`), and `@CoerceCase('upper')` ensures SKUs are always uppercase.

### Step 2: Attach the Array to the Submission Mapping

Now attach the variants array to the Supplier A mapping class from Part 3 using `@ValidatedClassArray`:

```typescript
import { ValidatedClassArray } from '@firebrandanalytics/shared-utils/validation';

class SupplierAMapping extends SupplierSubmissionMapping {
  @Discriminator('flat_json_snake')
  source_format: string;

  // ... all the top-level fields from Part 3 ...

  @ValidatedClassArray(ProductVariant)
  variants: ProductVariant[];
}
```

That's it. When the factory processes a Supplier A payload:

1. It maps the top-level fields using the property decorators
2. It finds `variants` in the raw input (an array of objects)
3. For each element, it creates a `ProductVariant` instance using all the decorators defined on that class
4. Each element is independently validated -- if one variant has a missing SKU, the error includes the array index

**Input:**
```json
{
  "variants": [
    { "sku": "BLZ-RUN-BW-07", "size": "7", "color": "Black/White", "quantity": 150, "unit_cost": "89.99", "currency_code": "usd" },
    { "sku": "BLZ-RUN-BW-08", "size": "8", "color": "Black/White", "quantity": 200, "unit_cost": "89.99", "currency_code": "usd" }
  ]
}
```

**Output:**
```json
{
  "variants": [
    { "sku": "BLZ-RUN-BW-07", "size": "7", "color": "Black/White", "quantity": 150, "unit_cost": 89.99, "currency_code": "USD" },
    { "sku": "BLZ-RUN-BW-08", "size": "8", "color": "Black/White", "quantity": 200, "unit_cost": 89.99, "currency_code": "USD" }
  ]
}
```

Every variant has its `unit_cost` coerced from string to number, its `currency_code` uppercased, and its `sku` trimmed and uppercased. The validation library treats each array element as a first-class validated object.

### Step 3: Per-Supplier Variant Classes

Supplier B and C send variants with different field names and structures. We handle this the same way we handled the top-level fields in Part 3 -- define a variant class per supplier with the appropriate `@DerivedFrom` mappings.

**Supplier B's Variant Class:**

```typescript
class SupplierBVariant {
  @DerivedFrom('$.skuCode')
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateRequired()
  sku: string;

  @DerivedFrom('$.shoeSize')
  @CoerceTrim()
  size: string;

  @DerivedFrom('$.colorway')
  @CoerceTrim()
  color: string;

  @DerivedFrom('$.qty')
  @CoerceType('number')
  quantity: number;

  @DerivedFrom('$.costPerUnit')
  @CoerceType('number')  // "89.99" -> 89.99
  unit_cost: number;

  @DerivedFrom('$.currencyCode')
  @CoerceTrim()
  @CoerceCase('upper')
  currency_code: string;
}
```

**Supplier C's Variant Class:**

```typescript
import { CoerceParse } from '@firebrandanalytics/shared-utils/validation';

class SupplierCVariant {
  @DerivedFrom('$.SKU_CODE')
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateRequired()
  sku: string;

  @DerivedFrom('$.SIZE')
  @CoerceTrim()
  size: string;

  @DerivedFrom('$.CLR')
  @CoerceTrim()
  color: string;

  @DerivedFrom('$.QTY')
  @CoerceType('number')
  quantity: number;

  @DerivedFrom('$.UNIT_COST')
  @CoerceParse('currency')  // "$89.99" -> 89.99
  unit_cost: number;

  @DerivedFrom('$.CURRENCY')
  @CoerceTrim()
  @CoerceCase('upper')
  currency_code: string;
}
```

Then wire each variant class into its supplier mapping:

```typescript
class SupplierBMapping extends SupplierSubmissionMapping {
  @Discriminator('nested_json_camel')
  source_format: string;

  // ... top-level fields from Part 3 ...

  @DerivedFrom('$.specs.variants')  // Variants live under specs.variants
  @ValidatedClassArray(SupplierBVariant)
  variants: SupplierBVariant[];
}

class SupplierCMapping extends SupplierSubmissionMapping {
  @Discriminator('flat_json_caps')
  source_format: string;

  // ... top-level fields from Part 3 ...

  @DerivedFrom('$.VARIANTS')  // Variants live under VARIANTS
  @ValidatedClassArray(SupplierCVariant)
  variants: SupplierCVariant[];
}
```

Notice the pattern: `@DerivedFrom` extracts the array from its supplier-specific location, then `@ValidatedClassArray` validates each element through the supplier-specific variant class. The two decorators compose naturally.

## Handling Nested Single Objects with `@ValidatedClass`

Not every nested structure is an array. Some suppliers send a single nested object for metadata or pricing details. Use `@ValidatedClass` (singular) for these.

For example, Supplier B wraps pricing in its own object:

```typescript
class SupplierBPricing {
  @DerivedFrom('$.cost')
  @CoerceType('number')
  base_cost: number;

  @DerivedFrom('$.retailPrice')
  @CoerceType('number')
  msrp: number;

  @DerivedFrom('$.wholesalePrice')
  @CoerceType('number')
  wholesale: number;
}

class SupplierBMapping extends SupplierSubmissionMapping {
  // ...

  @DerivedFrom('$.pricing')
  @ValidatedClass(SupplierBPricing)
  pricing: SupplierBPricing;
}
```

The `pricing` property receives the raw `{ "cost": "89.99", "retailPrice": 159.99 }` object and runs it through `SupplierBPricing`'s decorators, producing a clean, typed result.

**The rule of thumb:**
- `@ValidatedClass(MyClass)` for a single nested object
- `@ValidatedClassArray(MyClass)` for an array of nested objects

Both recursively apply the full validation pipeline to the nested data.

## Capturing Unmapped Fields with `@CollectProperties`

Suppliers often send extra fields that don't map to any column in your schema. Maybe it's internal metadata, maybe it's a new field they added without telling you. Rather than losing this data, you can capture it in an overflow bucket using `@CollectProperties`.

This is useful for two reasons:
1. You preserve data for debugging and auditing -- nothing is silently dropped
2. You can store it in the `raw_fields` JSONB column on `supplier_product_drafts` for later analysis

```typescript
import { CollectProperties } from '@firebrandanalytics/shared-utils/validation';

class ProductVariant {
  @Copy()
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateRequired()
  sku: string;

  @Copy()
  @CoerceTrim()
  size: string;

  @Copy()
  @CoerceTrim()
  color: string;

  @Copy()
  @CoerceType('number')
  quantity: number;

  @Copy()
  @CoerceType('number')
  unit_cost: number;

  @Copy()
  @CoerceTrim()
  @CoerceCase('upper')
  currency_code: string;

  // Capture everything that wasn't mapped above
  @CollectProperties({ sources: [{ path: '$' }] })
  extra_fields: Record<string, any>;
}
```

If a variant arrives with extra fields:

```json
{
  "sku": "BLZ-RUN-BW-07",
  "size": "7",
  "color": "Black/White",
  "quantity": 150,
  "unit_cost": "89.99",
  "currency_code": "usd",
  "weight_oz": 11.5,
  "warehouse_code": "WH-WEST",
  "seasonal_flag": true
}
```

The result includes the mapped fields plus an overflow bucket:

```json
{
  "sku": "BLZ-RUN-BW-07",
  "size": "7",
  "color": "Black/White",
  "quantity": 150,
  "unit_cost": 89.99,
  "currency_code": "USD",
  "extra_fields": {
    "weight_oz": 11.5,
    "warehouse_code": "WH-WEST",
    "seasonal_flag": true
  }
}
```

`@CollectProperties` automatically excludes any field that already has a decorator on the class. So `sku`, `size`, `color`, `quantity`, `unit_cost`, and `currency_code` are excluded from the overflow. Everything else lands in `extra_fields`.

You can also collect from specific JSONPath sources and exclude additional fields manually:

```typescript
@CollectProperties({
  sources: [
    { path: '$', exclude: ['internal_id', 'debug_info'] }
  ]
})
extra_fields: Record<string, any>;
```

## The Complete Pattern: From Raw Payload to Database Rows

Let's trace the full flow for a Supplier B submission with variants, showing how the validated output maps to the `supplier_product_variants` table.

**Raw Input:**

```json
{
  "source_format": "nested_json_camel",
  "productInfo": {
    "name": "Ember Court",
    "categoryCode": "Basketball",
    "subcategoryCode": "women's"
  },
  "pricing": {
    "cost": "72.50",
    "retailPrice": 149.99
  },
  "specs": {
    "brandLine": "premium",
    "colorway": "Navy and Gold",
    "sizes": "5 to 11",
    "variants": [
      { "skuCode": "EMB-CRT-NG-05", "shoeSize": "5",  "colorway": "Navy and Gold", "qty": "80",  "costPerUnit": "72.50", "currencyCode": "USD" },
      { "skuCode": "EMB-CRT-NG-06", "shoeSize": "6",  "colorway": "Navy and Gold", "qty": "120", "costPerUnit": "72.50", "currencyCode": "USD" },
      { "skuCode": "EMB-CRT-NG-07", "shoeSize": "7",  "colorway": "Navy and Gold", "qty": "200", "costPerUnit": "72.50", "currencyCode": "usd" },
      { "skuCode": "EMB-CRT-NG-08", "shoeSize": "8",  "colorway": "Navy and Gold", "qty": "250", "costPerUnit": "72.50", "currencyCode": "USD" },
      { "skuCode": "EMB-CRT-NG-09", "shoeSize": "9",  "colorway": "Navy and Gold", "qty": "180", "costPerUnit": "72.50", "currencyCode": "USD", "weight": "12.5oz" }
    ]
  }
}
```

**Validation call:**

```typescript
const factory = new ValidationFactory();
const result = await factory.create(SupplierSubmissionMapping, rawPayload);
```

**Validated output:**

```json
{
  "source_format": "nested_json_camel",
  "product_name": "Ember Court",
  "category": "basketball",
  "subcategory": "women's",
  "brand_line": "premium",
  "base_cost": 72.5,
  "msrp": 149.99,
  "color_variant": "Navy and Gold",
  "size_range": "5 to 11",
  "variants": [
    { "sku": "EMB-CRT-NG-05", "size": "5", "color": "Navy and Gold", "quantity": 80,  "unit_cost": 72.5, "currency_code": "USD", "extra_fields": {} },
    { "sku": "EMB-CRT-NG-06", "size": "6", "color": "Navy and Gold", "quantity": 120, "unit_cost": 72.5, "currency_code": "USD", "extra_fields": {} },
    { "sku": "EMB-CRT-NG-07", "size": "7", "color": "Navy and Gold", "quantity": 200, "unit_cost": 72.5, "currency_code": "USD", "extra_fields": {} },
    { "sku": "EMB-CRT-NG-08", "size": "8", "color": "Navy and Gold", "quantity": 250, "unit_cost": 72.5, "currency_code": "USD", "extra_fields": {} },
    { "sku": "EMB-CRT-NG-09", "size": "9", "color": "Navy and Gold", "quantity": 180, "unit_cost": 72.5, "currency_code": "USD", "extra_fields": { "weight": "12.5oz" } }
  ]
}
```

Notice that:
- All string quantities (`"80"`, `"120"`) are now numbers
- All string costs (`"72.50"`) are now numbers
- The lowercase `"usd"` in variant 3 is uppercased to `"USD"`
- Variant 5's extra `"weight"` field is captured in `extra_fields` rather than being silently dropped
- The top-level fields are all normalized as defined in Part 3

### Inserting into the Database

The validated output maps directly to database inserts. The top-level fields go into `supplier_product_drafts`, and the variants array maps to `supplier_product_variants` rows:

```typescript
// Insert the draft
const draft = await db.query(`
  INSERT INTO supplier_product_drafts
    (submission_id, raw_fields, product_name, category, subcategory,
     brand_line, base_cost, msrp, color_variant, size_range, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
  RETURNING draft_id
`, [
  submissionId,
  JSON.stringify(result.extra_fields ?? {}),
  result.product_name,
  result.category,
  result.subcategory,
  result.brand_line,
  result.base_cost,
  result.msrp,
  result.color_variant,
  result.size_range,
]);

const draftId = draft.rows[0].draft_id;

// Insert variants
for (const variant of result.variants) {
  await db.query(`
    INSERT INTO supplier_product_variants
      (draft_id, sku, size, color, quantity, unit_cost, currency_code)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    draftId,
    variant.sku,
    variant.size,
    variant.color,
    variant.quantity,
    variant.unit_cost,
    variant.currency_code,
  ]);
}
```

The validated objects map 1:1 to database columns. No additional transformation needed at the persistence layer.

## Error Handling: Per-Element Validation Errors

When validation fails on a single variant, the error includes the array index so you can identify exactly which element is problematic.

```typescript
try {
  await factory.create(SupplierSubmissionMapping, payloadWithBadVariant);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.propertyPath);
    // "variants[2].sku" -- the third variant is missing its SKU
    console.log(error.message);
    // "Value is required"
  }
}
```

This is critical for a catalog intake system. You need to report back to suppliers exactly which line item in their submission failed and why. The property path gives you that precision for free.

## Summary: The Two-Level Validation Pattern

The pattern we've built across Parts 3 and 4 handles the full complexity of multi-supplier catalog intake:

```
Raw Payload
    |
    v
@DiscriminatedUnion (Part 3)
    |-- source_format = 'flat_json_snake'  --> SupplierAMapping
    |-- source_format = 'nested_json_camel' --> SupplierBMapping
    |-- source_format = 'flat_json_caps'    --> SupplierCMapping
    |
    v
Top-level field mapping (@DerivedFrom, @CoerceType, etc.)
    |
    v
@ValidatedClassArray (Part 4)
    |-- Each variant element --> SupplierXVariant class
    |   |-- Field mapping
    |   |-- Type coercion
    |   |-- @CollectProperties for overflow
    |
    v
Clean, typed objects ready for database insert
```

**Level 1 (Part 3):** Discriminated union dispatches to the right mapping class based on `source_format`. Top-level fields are extracted and normalized.

**Level 2 (Part 4):** `@ValidatedClassArray` validates each variant in the nested array through a per-supplier variant class. `@CollectProperties` captures unmapped fields.

Both levels are fully declarative. Both levels produce typed, validated objects. Both levels report precise errors with property paths.

In Part 5, we'll tackle the next challenge: fuzzy matching category names, brand lines, and colors against canonical sets loaded from the Data Access Service at runtime.

---

**Next:** Part 5: Fuzzy Matching with Runtime Context (coming soon)

**Previous:** [Part 3: Discriminated Unions](./part-03-discriminated-unions.md)
