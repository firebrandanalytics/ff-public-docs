# Part 2: Parsing + Reparenting

Handle multiple supplier formats by parsing currency strings, extracting values from nested payloads, and enforcing field patterns.

---

## Introduction: Every Supplier Has Different Field Names

In [Part 1](./part-01-basic-pipeline.md), we built a validator that cleans flat supplier data — trimming whitespace, normalizing casing, and coercing types. That works when every supplier sends the same field names in the same structure. In reality, they never do.

Here are three suppliers sending the exact same product:

**Supplier A (flat, snake_case):**

```json
{
  "product_name": "Nike Air Max 90",
  "category": "running",
  "sku": "NAM90-001",
  "retail_price": "89.99",
  "release_date": "2025-03-15"
}
```

**Supplier B (nested, camelCase):**

```json
{
  "productInfo": {
    "name": "Nike Air Max 90",
    "category": "Running"
  },
  "pricing": {
    "retail": "$89.99",
    "wholesale": "$45.50"
  },
  "metadata": {
    "sku": "NAM90-001",
    "releaseDate": "03/15/2025"
  }
}
```

**Supplier C (flat, ALL_CAPS):**

```json
{
  "PRODUCT_NAME": "NIKE AIR MAX 90",
  "CATEGORY": "RUNNING",
  "SKU": "NAM90-001",
  "RETAIL_PRICE": "$89.99 USD",
  "RELEASE_DATE": "March 15, 2025"
}
```

Three suppliers, three structures, three naming conventions, three price formats, three date formats — but they all describe the same product. The V1 validator from Part 1 only handles Supplier A's flat format. To handle B and C, we need to **reparent** data from arbitrary input structures into our clean validator class, and **parse** values like `"$89.99"` and `"03/15/2025"` into usable types.

## @CoerceParse — Parsing Real-World Formats

Supplier data doesn't arrive as clean `"89.99"` strings. It arrives as `"$89.99"`, `"$89.99 USD"`, `"03/15/2025"`, and worse. `@CoerceType('number')` from Part 1 can't handle dollar signs. That's where `@CoerceParse` comes in.

### Parsing Currency Strings

```typescript
import {
  CoerceParse,
  CoerceType,
  ValidateRange
} from '@firebrandanalytics/shared-utils/validation';

class PriceExample {
  @CoerceParse('currency', { locale: 'en-US' })
  @ValidateRange(0.01)
  retail_price: number;
}
```

`@CoerceParse('currency')` understands currency formatting: it strips the `$` symbol, handles thousands separators (`,`), and converts to a number. The result is a clean number ready for `@ValidateRange`.

| Input | After `@CoerceParse('currency')` |
|-------|----------------------------------|
| `"$89.99"` | `89.99` |
| `"$1,234.56"` | `1234.56` |
| `"$89.99 USD"` | `89.99` |
| `89.99` (already a number) | Error — strings only by default |

If the input might already be a number (some suppliers send clean data), add `allowNonString`:

```typescript
@CoerceParse('currency', { locale: 'en-US', allowNonString: true })
retail_price: number;
```

Now `89.99` passes through unchanged, and `"$89.99"` gets parsed. This flexibility lets one validator handle both clean and messy suppliers.

### Parsing Locale-Specific Numbers

European suppliers use different number formatting:

```typescript
class EuropeanPrice {
  @CoerceParse('number', { locale: 'de-DE' })
  @ValidateRange(0.01)
  price: number;
}

// "1.234,56" → 1234.56  (German format: dots for thousands, comma for decimal)
```

### Parsing Dates

Dates are a common pain point. Suppliers send ISO dates, US-format dates, and Unix timestamps:

```typescript
class DateExample {
  @CoerceType('date')
  iso_date: Date;         // "2025-03-15" → Date object

  @CoerceParse((val: string) => {
    const [month, day, year] = val.split('/');
    return new Date(`${year}-${month}-${day}`);
  })
  us_date: Date;          // "03/15/2025" → Date object
}
```

For the US-format date, we use `@CoerceParse` with a custom parse function. The function receives the raw string and returns the parsed value. This is more explicit than trying to make a generic date parser guess the format.

## @Copy vs @Staging — Pass-Through and Temporary Fields

Before we tackle reparenting, you need to understand two simple but important decorators.

### @Copy — Pass a Field Through

`@Copy()` tells the validator to include a field from the raw input in the output. It doesn't transform the value, but it does make the field "managed" — meaning other decorators (like class-level defaults from Part 7) will apply to it.

```typescript
import { Copy } from '@firebrandanalytics/shared-utils/validation';

class Example {
  @Copy()
  supplier_notes: string;
}

// Input:  { supplier_notes: "Ships from warehouse B" }
// Output: { supplier_notes: "Ships from warehouse B" }
```

Without `@Copy()` (or some other decorator), a field is invisible to the validation engine and won't appear in the output at all.

### @Staging — Temporary Fields

`@Staging()` marks a field as temporary: it participates in the validation pipeline (you can derive other fields from it, run coercions on it) but is **removed from the final output**. It's scaffolding that gets torn down after construction.

```typescript
import { Copy, Staging, DerivedFrom } from '@firebrandanalytics/shared-utils/validation';

class Example {
  @Copy()
  @Staging()
  raw_pricing: string;    // Temporary — will not appear in output

  @DerivedFrom('raw_pricing', (raw) => parseFloat(raw.replace('$', '')))
  @ValidateRange(0.01)
  retail_price: number;   // Derived from staging field — will appear in output
}

// Input:  { raw_pricing: "$89.99" }
// Output: { retail_price: 89.99 }
//          (raw_pricing is gone)
```

This pattern is common when a supplier sends data in a format that doesn't match your output schema. You stage the raw value, derive the clean fields from it, and the staging field disappears.

## @DerivedFrom with JSONPath — The Key to Multi-Supplier Support

`@DerivedFrom` is the workhorse of reparenting. It lets you extract a value from anywhere in the raw input using [JSONPath](https://goessner.net/articles/JsonPath/) expressions, then optionally transform it.

### Basic JSONPath Extraction

Recall Supplier B's nested structure:

```json
{
  "productInfo": {
    "name": "Nike Air Max 90",
    "category": "Running"
  },
  "pricing": {
    "retail": "$89.99"
  }
}
```

To pull `product_name` from `productInfo.name`:

```typescript
import { DerivedFrom } from '@firebrandanalytics/shared-utils/validation';

class SupplierBDraft {
  @DerivedFrom('$.productInfo.name')
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @DerivedFrom('$.productInfo.category')
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @DerivedFrom('$.pricing.retail')
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;
}
```

The `$` represents the root of the raw input. `$.productInfo.name` navigates into the nested structure and extracts the value. The extracted value then flows through the remaining decorators on the property — `@CoerceTrim()`, `@CoerceCase('title')`, etc.

### Fallback Paths for Multi-Supplier Support

Here's where it gets powerful. You can provide an **array of JSONPath expressions**, and `@DerivedFrom` will use the first one that resolves to a non-undefined value:

```typescript
class MultiSupplierDraft {
  @DerivedFrom([
    '$.product_name',           // Supplier A: flat, snake_case
    '$.productInfo.name',       // Supplier B: nested, camelCase
    '$.PRODUCT_NAME'            // Supplier C: flat, ALL_CAPS
  ])
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @DerivedFrom([
    '$.category',               // Supplier A
    '$.productInfo.category',   // Supplier B
    '$.CATEGORY'                // Supplier C
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @DerivedFrom([
    '$.retail_price',           // Supplier A: "89.99"
    '$.pricing.retail',         // Supplier B: "$89.99"
    '$.RETAIL_PRICE'            // Supplier C: "$89.99 USD"
  ])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;
}
```

Now a single class handles all three supplier formats. When Supplier A sends `{ "product_name": "..." }`, the first path matches. When Supplier B sends `{ "productInfo": { "name": "..." } }`, the second path matches. When Supplier C sends `{ "PRODUCT_NAME": "..." }`, the third path matches.

The fallback paths are tried in order, and the first non-undefined value wins. This makes the class resilient to format variations without any imperative `if/else` logic.

### Custom Derivation Functions

For more complex transformations, pass a derivation function as the second argument:

```typescript
class DraftWithDerived {
  @DerivedFrom('$.pricing', (pricing) => pricing.retail || pricing.msrp || 0)
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;
}
```

The derivation function receives the resolved value and a context object `{ raw, instance }`:

- **`raw`** — the original, untouched input object
- **`instance`** — the partially-built validator instance (fields already processed)

```typescript
@DerivedFrom('$.pricing.wholesale', (wholesale, ctx) => {
  // If wholesale price is missing, estimate it as 50% of retail
  if (wholesale == null && ctx.raw?.pricing?.retail) {
    return parseFloat(ctx.raw.pricing.retail.replace('$', '')) * 0.5;
  }
  return wholesale;
})
wholesale_price: number;
```

## @ValidatePattern — Enforcing Field Formats

Some fields have a specific format that must be enforced. SKUs follow a pattern. Size ranges have an expected notation.

```typescript
import { ValidatePattern } from '@firebrandanalytics/shared-utils/validation';

class DraftWithPatterns {
  @DerivedFrom(['$.sku', '$.metadata.sku', '$.SKU'])
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(
    /^[A-Z]{2,5}\d{2,3}-\d{3}$/,
    'SKU must match format like "NAM90-001" (2-5 letters + 2-3 digits, dash, 3 digits)'
  )
  sku: string;

  @DerivedFrom(['$.size_range', '$.metadata.sizeRange', '$.SIZE_RANGE'])
  @CoerceTrim()
  @ValidatePattern(
    /^\d+(\.\d+)?-\d+(\.\d+)?$/,
    'Size range must be "min-max" format, e.g. "7-13" or "7.5-12.5"'
  )
  size_range: string;
}
```

`@ValidatePattern` takes a regex and an optional error message. The custom message is important — a bare regex failure like `"Pattern validation failed"` doesn't help anyone. Telling the supplier `'SKU must match format like "NAM90-001"'` lets them fix the problem.

## The Updated Validator: SupplierProductDraftV2

Here is the complete V2 class, incorporating everything from this part and Part 1:

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
  Copy,
  Staging,
  DerivedFrom,
  ValidationError
} from '@firebrandanalytics/shared-utils/validation';

class SupplierProductDraftV2 {
  // --- Product identity ---

  @ValidateRequired()
  @DerivedFrom([
    '$.product_name',
    '$.productInfo.name',
    '$.PRODUCT_NAME'
  ])
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @ValidateRequired()
  @DerivedFrom([
    '$.category',
    '$.productInfo.category',
    '$.CATEGORY'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @DerivedFrom([
    '$.subcategory',
    '$.productInfo.subcategory',
    '$.SUBCATEGORY'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory: string;

  @DerivedFrom([
    '$.brand_line',
    '$.productInfo.brandLine',
    '$.BRAND_LINE'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line: string;

  // --- SKU with format enforcement ---

  @DerivedFrom([
    '$.sku',
    '$.metadata.sku',
    '$.SKU'
  ])
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(
    /^[A-Z]{2,5}\d{2,3}-\d{3}$/,
    'SKU must match format like "NAM90-001"'
  )
  sku: string;

  // --- Prices with currency parsing ---

  @DerivedFrom([
    '$.wholesale_price',
    '$.pricing.wholesale',
    '$.WHOLESALE_PRICE'
  ])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  wholesale_price: number;

  @DerivedFrom([
    '$.retail_price',
    '$.pricing.retail',
    '$.RETAIL_PRICE'
  ])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;

  // --- Size range with pattern validation ---

  @DerivedFrom([
    '$.size_range',
    '$.metadata.sizeRange',
    '$.SIZE_RANGE'
  ])
  @CoerceTrim()
  @ValidatePattern(
    /^\d+(\.\d+)?-\d+(\.\d+)?$/,
    'Size range must be "min-max" format, e.g. "7-13"'
  )
  size_range: string;

  // --- Color ---

  @DerivedFrom([
    '$.color',
    '$.productInfo.color',
    '$.COLOR'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  color: string;
}
```

## Before/After: Supplier B's Nested Input

Let's run the V2 validator against Supplier B's nested payload:

**Input (Supplier B):**

```json
{
  "productInfo": {
    "name": "  Nike Air Max 90  ",
    "category": "RUNNING",
    "subcategory": "  Road Running  ",
    "brandLine": "  Nike Air  ",
    "color": "  WHITE/BLACK  "
  },
  "pricing": {
    "wholesale": "$45.50",
    "retail": "$89.99"
  },
  "metadata": {
    "sku": "  nam90-001  ",
    "sizeRange": "7-13"
  }
}
```

**Running the validator:**

```typescript
const factory = new ValidationFactory();
const draft = await factory.create(SupplierProductDraftV2, supplierBInput);
console.log(JSON.stringify(draft, null, 2));
```

**Output:**

```json
{
  "product_name": "Nike Air Max 90",
  "category": "running",
  "subcategory": "road running",
  "brand_line": "nike air",
  "sku": "NAM90-001",
  "wholesale_price": 45.5,
  "retail_price": 89.99,
  "size_range": "7-13",
  "color": "white/black"
}
```

Let's trace the most interesting transformations:

| Field | Source Path | Raw Value | Transformations | Final |
|-------|------------|-----------|----------------|-------|
| product_name | `$.productInfo.name` | `"  Nike Air Max 90  "` | DerivedFrom → Trim → Title Case | `"Nike Air Max 90"` |
| sku | `$.metadata.sku` | `"  nam90-001  "` | DerivedFrom → Trim → Upper Case → Pattern ✓ | `"NAM90-001"` |
| wholesale_price | `$.pricing.wholesale` | `"$45.50"` | DerivedFrom → Parse Currency → Range ✓ | `45.5` |
| retail_price | `$.pricing.retail` | `"$89.99"` | DerivedFrom → Parse Currency → Range ✓ | `89.99` |
| color | `$.productInfo.color` | `"  WHITE/BLACK  "` | DerivedFrom → Trim → Lower Case | `"white/black"` |

The deeply nested input was flattened to a clean, consistent structure. The dollar signs were stripped. The casing was normalized. The SKU was upper-cased and validated against its pattern. All from declarative decorators — no imperative code.

## What's Next

The V2 validator handles three supplier formats using `@DerivedFrom` fallback paths, but there's a design problem: the fallback path list will grow with every new supplier. If Supplier D sends `{ "product_title": "..." }` and Supplier E sends `{ "item": { "display_name": "..." } }`, the list keeps growing and becomes hard to maintain.

In [Part 3: Discriminated Supplier Mappings](./part-03-discriminated-unions.md), you'll learn how to solve this properly using `@DiscriminatedUnion` and `@Discriminator` — routing each supplier's payload to a dedicated validator class that knows that supplier's exact structure, then producing the same clean output regardless of which supplier sent the data.
