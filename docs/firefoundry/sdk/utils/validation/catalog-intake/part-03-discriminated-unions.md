# Part 3: Discriminated Unions -- One Pipeline, Many Supplier Schemas

## The Problem: Every Supplier Speaks a Different Language

In Parts 1-2 we built a basic validation class that can clean and normalize a single supplier's flat JSON payload. But FireKicks receives product data from dozens of suppliers, and each one sends data in a completely different format.

Here are three real supplier payloads for the same shoe:

**Supplier A** -- flat JSON, snake_case (the "clean" one):

```json
{
  "product_name": "Blaze Runner",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color_variant": "Black/White",
  "size_range": "7-13"
}
```

**Supplier B** -- nested camelCase JSON:

```json
{
  "productInfo": {
    "name": "Blaze Runner",
    "categoryCode": "Running",
    "subcategoryCode": "men's"
  },
  "pricing": {
    "cost": "89.99",
    "retailPrice": 159.99
  },
  "specs": {
    "brandLine": "performance",
    "colorway": "Black and White",
    "sizes": "7 to 13"
  }
}
```

**Supplier C** -- all-caps flat JSON (CSV-derived):

```json
{
  "PRODUCT_NAME": "BLAZE RUNNER",
  "CATEGORY": "RUNNING",
  "SUBCATEGORY": "MENS",
  "BRAND": "PERFORMANCE LINE",
  "BASE_COST": "$89.99",
  "MSRP": "$159.99",
  "COLOR": "BLK/WHT",
  "SIZES": "7-13"
}
```

Without a discriminated union, your intake pipeline would look like this:

```typescript
// The if/else nightmare
function normalizePayload(submission: SupplierSubmission): NormalizedProduct {
  const payload = submission.raw_payload;

  if (submission.source_format === 'flat_json_snake') {
    return {
      productName: payload.product_name,
      category: payload.category,
      baseCost: payload.base_cost,
      msrp: payload.msrp,
      // ... 8 more fields
    };
  } else if (submission.source_format === 'nested_json_camel') {
    return {
      productName: payload.productInfo?.name,
      category: payload.productInfo?.categoryCode?.toLowerCase(),
      baseCost: parseFloat(payload.pricing?.cost),
      msrp: payload.pricing?.retailPrice,
      // ... 8 more fields, different paths
    };
  } else if (submission.source_format === 'flat_json_caps') {
    return {
      productName: titleCase(payload.PRODUCT_NAME),
      category: payload.CATEGORY?.toLowerCase(),
      baseCost: parseCurrency(payload.BASE_COST),
      msrp: parseCurrency(payload.MSRP),
      // ... 8 more fields, more parsing
    };
  }
  throw new Error(`Unknown format: ${submission.source_format}`);
}
```

This grows linearly with each new supplier. Every new field means updating every branch. Every new supplier means a new branch. It's fragile, verbose, and untestable.

## The Solution: `@DiscriminatedUnion` + `@Discriminator`

The validation library lets you replace that entire if/else tree with a single `factory.create()` call. Each supplier format becomes its own class with declarative field mappings, and the library dispatches to the right one automatically.

### Step 1: Define the Base Submission Class

The base class declares the discriminator field and any shared behavior. The `@DiscriminatedUnion` decorator tells the factory which field to inspect and which class to use for each value.

```typescript
import {
  ValidationFactory,
  DiscriminatedUnion,
  Discriminator,
  Copy,
  DerivedFrom,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  CoerceParse,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

// Forward declarations -- we define these below
class SupplierAMapping {}
class SupplierBMapping {}
class SupplierCMapping {}

@DiscriminatedUnion({
  discriminator: 'source_format',
  map: {
    'flat_json_snake': SupplierAMapping,
    'nested_json_camel': SupplierBMapping,
    'flat_json_caps': SupplierCMapping,
  }
})
class SupplierSubmissionMapping {
  @Copy()
  source_format: string;
}
```

When you call `factory.create(SupplierSubmissionMapping, payload)`, the library:

1. Reads `payload.source_format`
2. Looks up the matching class in the `map`
3. Instantiates and validates using that class's decorators
4. Returns a fully typed, clean instance

The base class properties (like `source_format`) are inherited by each subclass, so they're always available on the result.

### Step 2: Map Supplier A (Flat snake_case)

Supplier A is the cleanest format. The field names almost match our target schema, so the mapping is straightforward -- mostly just `@Copy` with light normalization.

```typescript
class SupplierAMapping extends SupplierSubmissionMapping {
  @Discriminator('flat_json_snake')
  source_format: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @Copy()
  @CoerceTrim()
  subcategory: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line: string;

  @Copy()
  @CoerceType('number')
  base_cost: number;

  @Copy()
  @CoerceType('number')
  msrp: number;

  @Copy()
  @CoerceTrim()
  color_variant: string;

  @Copy()
  @CoerceTrim()
  size_range: string;
}
```

**Input:**
```json
{ "product_name": "Blaze Runner", "category": "running", "base_cost": 89.99, "msrp": 159.99, ... }
```

**Output:**
```json
{ "product_name": "Blaze Runner", "category": "running", "base_cost": 89.99, "msrp": 159.99, ... }
```

Not much changes here -- that's the point. Supplier A's format is already close to canonical. The decorators ensure type safety and trim whitespace, but don't need to do heavy lifting.

### Step 3: Map Supplier B (Nested camelCase)

This is where `@DerivedFrom` with JSONPath earns its keep. Supplier B nests everything inside `productInfo`, `pricing`, and `specs` objects, uses camelCase keys, and sends `cost` as a string.

```typescript
class SupplierBMapping extends SupplierSubmissionMapping {
  @Discriminator('nested_json_camel')
  source_format: string;

  @DerivedFrom('$.productInfo.name')
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('$.productInfo.categoryCode')
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @DerivedFrom('$.productInfo.subcategoryCode')
  @CoerceTrim()
  subcategory: string;

  @DerivedFrom('$.specs.brandLine')
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line: string;

  @DerivedFrom('$.pricing.cost')
  @CoerceType('number')  // "89.99" -> 89.99
  base_cost: number;

  @DerivedFrom('$.pricing.retailPrice')
  @CoerceType('number')
  msrp: number;

  @DerivedFrom('$.specs.colorway')
  @CoerceTrim()
  color_variant: string;

  @DerivedFrom('$.specs.sizes')
  @CoerceTrim()
  size_range: string;
}
```

Look at what just happened. There's no manual object destructuring. No `payload.productInfo?.name` chains. No `parseFloat()`. Each field declares where it lives in the raw input and how to clean it. The library handles the rest.

**Input:**
```json
{
  "productInfo": { "name": "Blaze Runner", "categoryCode": "Running" },
  "pricing": { "cost": "89.99", "retailPrice": 159.99 },
  "specs": { "brandLine": "performance", "colorway": "Black and White", "sizes": "7 to 13" }
}
```

**Output:**
```json
{
  "product_name": "Blaze Runner",
  "category": "running",
  "brand_line": "performance",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color_variant": "Black and White",
  "size_range": "7 to 13"
}
```

The nested camelCase structure is flattened into a consistent schema. The string price `"89.99"` is coerced to a number. The title-case `"Running"` is lowered to `"running"`.

### Step 4: Map Supplier C (All-Caps CSV-Derived)

Supplier C is the messiest. Everything is uppercase. Prices have dollar signs. The brand field appends "LINE" to the value. Key names don't match our schema at all.

```typescript
class SupplierCMapping extends SupplierSubmissionMapping {
  @Discriminator('flat_json_caps')
  source_format: string;

  @DerivedFrom('$.PRODUCT_NAME')
  @CoerceTrim()
  @CoerceCase('title')  // "BLAZE RUNNER" -> "Blaze Runner"
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('$.CATEGORY')
  @CoerceTrim()
  @CoerceCase('lower')  // "RUNNING" -> "running"
  category: string;

  @DerivedFrom('$.SUBCATEGORY')
  @CoerceTrim()
  @CoerceCase('lower')
  @Coerce((v: string) => {
    // "MENS" -> "men's" -- Supplier C strips apostrophes
    const map: Record<string, string> = { mens: "men's", womens: "women's" };
    return map[v] ?? v;
  })
  subcategory: string;

  @DerivedFrom('$.BRAND')
  @CoerceTrim()
  @CoerceCase('lower')
  @Coerce((v: string) => v.replace(/\s*line$/i, ''))  // "performance line" -> "performance"
  brand_line: string;

  @DerivedFrom('$.BASE_COST')
  @CoerceParse('currency')  // "$89.99" -> 89.99
  base_cost: number;

  @DerivedFrom('$.MSRP')
  @CoerceParse('currency')  // "$159.99" -> 159.99
  msrp: number;

  @DerivedFrom('$.COLOR')
  @CoerceTrim()
  color_variant: string;

  @DerivedFrom('$.SIZES')
  @CoerceTrim()
  size_range: string;
}
```

Notice the use of `@CoerceParse('currency')` to handle the dollar-sign prices. This is a built-in parser that strips currency symbols and grouping separators, handling locale-aware formatting automatically. No more `parseFloat(str.replace('$', ''))`.

The custom `@Coerce` lambdas handle Supplier C's quirks -- stripping the "LINE" suffix from brand names and restoring apostrophes in subcategories. These are short, testable transformations declared right where they're needed.

**Input:**
```json
{
  "PRODUCT_NAME": "BLAZE RUNNER",
  "CATEGORY": "RUNNING",
  "SUBCATEGORY": "MENS",
  "BRAND": "PERFORMANCE LINE",
  "BASE_COST": "$89.99",
  "MSRP": "$159.99",
  "COLOR": "BLK/WHT",
  "SIZES": "7-13"
}
```

**Output:**
```json
{
  "product_name": "Blaze Runner",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color_variant": "BLK/WHT",
  "size_range": "7-13"
}
```

Three wildly different input formats. One consistent output schema. Zero if/else branches.

## Putting It Together: The Dispatch Pipeline

Here's the full intake pipeline. The factory examines `source_format` in each payload and routes to the correct mapping class automatically.

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

const factory = new ValidationFactory();

// These could come from a database query or API
const submissions = [
  { source_format: 'flat_json_snake', product_name: 'Blaze Runner', category: 'running', base_cost: 89.99, msrp: 159.99, color_variant: 'Black/White', size_range: '7-13', subcategory: "men's", brand_line: 'performance' },
  { source_format: 'nested_json_camel', productInfo: { name: 'Ember Court', categoryCode: 'Basketball', subcategoryCode: "women's" }, pricing: { cost: '72.50', retailPrice: 149.99 }, specs: { brandLine: 'premium', colorway: 'Navy and Gold', sizes: '5 to 11' } },
  { source_format: 'flat_json_caps', PRODUCT_NAME: 'SPARK STREET', CATEGORY: 'CASUAL', SUBCATEGORY: 'UNISEX', BRAND: 'LIFESTYLE LINE', BASE_COST: '$45.00', MSRP: '$99.99', COLOR: 'GRN/BLK', SIZES: '6-12' },
];

const results = await Promise.all(
  submissions.map(s => factory.create(SupplierSubmissionMapping, s))
);

// Every result has the same shape, regardless of source format
for (const product of results) {
  console.log(`${product.product_name} | ${product.category} | $${product.base_cost} -> $${product.msrp}`);
}
```

**Output:**
```
Blaze Runner | running | $89.99 -> $159.99
Ember Court | basketball | $72.5 -> $149.99
Spark Street | casual | $45 -> $99.99
```

## Adding a New Supplier

This is where the architecture pays off. When Supplier D shows up with free-text descriptions, you don't touch any existing code. You write one new class:

```typescript
class SupplierDMapping extends SupplierSubmissionMapping {
  @Discriminator('freetext_json')
  source_format: string;

  @DerivedFrom('$.description')
  @AIExtract(['product_name', 'category', 'subcategory', 'brand_line',
              'base_cost', 'msrp', 'color_variant', 'size_range'])
  @Staging()  // Temporary -- only used to feed the properties below
  _extracted: Record<string, any>;

  @DerivedFrom('_extracted', (e) => e.product_name)
  @CoerceTrim()
  product_name: string;

  @DerivedFrom('_extracted', (e) => e.category)
  @CoerceCase('lower')
  category: string;

  // ... remaining fields follow the same pattern
}
```

Then register it in the union map:

```typescript
@DiscriminatedUnion({
  discriminator: 'source_format',
  map: {
    'flat_json_snake': SupplierAMapping,
    'nested_json_camel': SupplierBMapping,
    'flat_json_caps': SupplierCMapping,
    'freetext_json': SupplierDMapping,  // <-- one line
  }
})
class SupplierSubmissionMapping { ... }
```

No changes to Suppliers A, B, or C. No changes to the dispatch pipeline. No if/else. The library resolves the discriminator and routes to the new class.

## Why This Matters

The discriminated union pattern transforms supplier onboarding from a code change into a configuration exercise:

1. **Isolation** -- Each supplier's quirks are encapsulated in their own class. A bug in Supplier C's currency parsing can't affect Supplier A.

2. **Testability** -- Each mapping class can be unit tested independently with its own fixtures.

3. **Discoverability** -- When debugging a bad import, you know exactly where to look: the mapping class for that supplier's `source_format`.

4. **Extensibility** -- New suppliers don't require modifying existing code. Open-closed principle, enforced by the framework.

In the next part, we'll tackle the variants problem: when a single submission contains a nested array of SKU-level variant data that needs to be validated, extracted, and inserted into `supplier_product_variants`.

---

**Next:** [Part 4: Nested Variants](./part-04-nested-variants.md) -- Validating arrays of nested objects with `@ValidatedClassArray`

**Previous:** Part 2: Core Field Validation (coming soon)
