# Data Coercion Patterns

This guide covers practical patterns for using the FireFoundry Data Validation Library's coercion decorators to transform messy input data into clean, typed values. It assumes familiarity with the [Data Validation Library Overview](../feature_guides/data-validation-overview.md) and the [Conceptual Guide](../../utils/validation/concepts.md).

---

## Table of Contents

- [The Coercion Philosophy](#the-coercion-philosophy)
- [Type Coercion](#type-coercion)
- [String Normalization](#string-normalization)
- [Fuzzy Matching](#fuzzy-matching)
- [Format Coercion](#format-coercion)
- [Parsing Structured Strings](#parsing-structured-strings)
- [Composing Coercion Chains](#composing-coercion-chains)
- [Context-Driven Coercion](#context-driven-coercion)
- [AI-Powered Coercion](#ai-powered-coercion)
- [Error Recovery in Coercion](#error-recovery-in-coercion)
- [Performance Considerations](#performance-considerations)

---

## The Coercion Philosophy

Coercion transforms values into the expected type and format **without rejecting them**. The library's core principle is: *transform first, validate second*. Coercion decorators run before validation decorators in the pipeline, fixing what can be fixed before checking what must be checked.

```
Raw Input → Coercion (fix it) → Validation (check it) → Output
```

This means a value like `"42"` arriving where a number is expected doesn't need to be rejected — it can be coerced to `42` and then validated normally.

---

## Type Coercion

### Basic Type Conversion with @CoerceType

The most common coercion pattern: convert a value from one type to another.

```typescript
import { CoerceType, ValidateRange } from '@firebrandanalytics/shared-utils/validation';

class OrderLine {
  @CoerceType('number')
  @ValidateRange(1, 10000)
  quantity: number;

  @CoerceType('number')
  @ValidateRange(0.01, 99999.99)
  unit_price: number;

  @CoerceType('boolean')
  is_taxable: boolean;

  @CoerceType('string')
  notes: string;
}
```

**Supported conversions:**

| Target | Input | Result |
|--------|-------|--------|
| `'number'` | `"42"` | `42` |
| `'number'` | `"3.14"` | `3.14` |
| `'number'` | `true` | `1` |
| `'number'` | `"five"` | `NaN` (use `@CoerceFromSet` for word-to-number) |
| `'boolean'` | `"true"`, `"yes"`, `"1"`, `1` | `true` |
| `'boolean'` | `"false"`, `"no"`, `"0"`, `0` | `false` |
| `'string'` | `42` | `"42"` |
| `'string'` | `null` | `""` |

### Numeric Rounding with @CoerceRound

Control decimal precision after type coercion:

```typescript
class PricingData {
  @CoerceType('number')
  @CoerceRound(2)
  price: number;
  // "19.999" → 19.999 → 20.00

  @CoerceType('number')
  @CoerceRound(0)
  quantity: number;
  // "7.8" → 7.8 → 8
}
```

### Date Coercion

Dates arrive in many formats. Combine type coercion with format coercion:

```typescript
class EventRecord {
  @CoerceType('date')
  created_at: Date;
  // "2024-03-15" → Date object
  // "March 15, 2024" → Date object
  // 1710460800000 → Date object (epoch ms)

  @CoerceType('date')
  @CoerceFormat('YYYY-MM-DD')
  formatted_date: string;
  // Any parseable date → "2024-03-15"
}
```

---

## String Normalization

### Trimming with @CoerceTrim

Remove leading and trailing whitespace:

```typescript
class ContactInfo {
  @CoerceTrim()
  name: string;
  // "  Jane Smith  " → "Jane Smith"

  @CoerceTrim()
  email: string;
  // "  jane@example.com  " → "jane@example.com"
}
```

### Case Normalization with @CoerceCase

Standardize string casing:

```typescript
class ProductRecord {
  @CoerceTrim()
  @CoerceCase('lower')
  email: string;
  // "  JANE@EXAMPLE.COM  " → "jane@example.com"

  @CoerceTrim()
  @CoerceCase('upper')
  sku: string;
  // "  abc-123  " → "ABC-123"

  @CoerceTrim()
  @CoerceCase('title')
  display_name: string;
  // "john doe" → "John Doe"
}
```

**Available cases:** `'lower'`, `'upper'`, `'title'`

### Combined Normalization with NormalizeText

For common normalization patterns, `NormalizeText` combines multiple steps:

```typescript
import { NormalizeText } from '@firebrandanalytics/shared-utils/validation';

class UserProfile {
  @NormalizeText('email')
  email: string;
  // Trims, lowercases, validates email format

  @NormalizeText('phone-formatted')
  phone: string;
  // Strips non-digits, formats as (XXX) XXX-XXXX

  @NormalizeText('url')
  website: string;
  // Trims, lowercases, ensures https:// prefix
}
```

---

## Fuzzy Matching

### Canonical Value Matching with @CoerceFromSet

Map messy input values to canonical values using fuzzy string matching:

```typescript
import { CoerceFromSet } from '@firebrandanalytics/shared-utils/validation';

class ProductClassification {
  @CoerceFromSet(['hiking', 'running', 'cycling', 'swimming'], {
    strategy: 'fuzzy'
  })
  category: string;
  // "hikking" → "hiking"
  // "Runing" → "running"
  // "CYCLING" → "cycling"
}
```

### Configuring Match Strategy

```typescript
class SupplierProduct {
  // Exact match (case-insensitive)
  @CoerceFromSet(['S', 'M', 'L', 'XL', 'XXL'], { strategy: 'exact' })
  size: string;

  // Fuzzy match with threshold
  @CoerceFromSet(['Electronics', 'Clothing', 'Home & Garden', 'Sports'], {
    strategy: 'fuzzy',
    threshold: 0.6  // Minimum similarity score (0-1)
  })
  department: string;

  // Fuzzy match with custom distance
  @CoerceFromSet(['red', 'blue', 'green', 'black', 'white'], {
    strategy: 'fuzzy',
    maxDistance: 2  // Maximum edit distance
  })
  color: string;
}
```

### Dynamic Sets from Context

When the set of valid values comes from a database or API:

```typescript
interface CatalogContext {
  validBrands: string[];
  validCategories: string[];
}

class CatalogItem {
  @CoerceFromSet<CatalogContext>(
    ctx => ctx.validBrands,
    { strategy: 'fuzzy', threshold: 0.7 }
  )
  brand: string;

  @CoerceFromSet<CatalogContext>(
    ctx => ctx.validCategories,
    { strategy: 'fuzzy' }
  )
  category: string;
}

// Usage — pass valid values at runtime
const item = await factory.create(CatalogItem, rawData, {
  context: {
    validBrands: await db.getBrands(),
    validCategories: await db.getCategories()
  }
});
```

This pattern is used extensively in the [Catalog Intake Tutorial](../tutorials/catalog-intake/README.md).

---

## Format Coercion

### Applying Format Templates with @CoerceFormat

Transform values into a specific format:

```typescript
class InventoryRecord {
  @CoerceFormat('###-####-####')
  part_number: string;
  // "1234567890" → "123-4567-890"

  @CoerceType('number')
  @CoerceFormat('$#,##0.00')
  price: string;
  // 1234.5 → "$1,234.50"
}
```

### Custom Format Functions

For complex formatting, use a lambda:

```typescript
class AddressRecord {
  @CoerceTrim()
  zip_code: string;

  @CoerceFormat((value: string) => {
    // Normalize US ZIP codes to ZIP+4 format
    const digits = value.replace(/\D/g, '');
    if (digits.length === 9) {
      return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    }
    return digits.slice(0, 5);
  })
  formatted_zip: string;
}
```

---

## Parsing Structured Strings

### JSON Parsing with @CoerceParse

Parse stringified structured data:

```typescript
class ApiResponse {
  @CoerceParse('json')
  metadata: Record<string, any>;
  // '{"key": "value"}' → { key: "value" }

  @CoerceParse('json')
  tags: string[];
  // '["tag1", "tag2"]' → ["tag1", "tag2"]
}
```

### Handling Parse Failures

Combine with `@Catch` for graceful degradation:

```typescript
class RobustImport {
  @CoerceParse('json')
  @Catch((error, value) => ({}))
  metadata: Record<string, any>;
  // Valid JSON → parsed object
  // Invalid JSON → {} (fallback)

  @CoerceParse('json')
  @AICatchRepair()
  config: object;
  // Valid JSON → parsed object
  // Invalid JSON → AI attempts to fix it
}
```

---

## Composing Coercion Chains

Decorators execute top-to-bottom. Build chains that progressively clean data:

### The Standard Chain: Trim → Case → Type → Validate

```typescript
class CleanProduct {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[a-z0-9-]+$/)
  slug: string;
  // "  My Product  " → "My Product" → "my product" → validates against pattern

  @CoerceTrim()
  @CoerceType('number')
  @CoerceRound(2)
  @ValidateRange(0, 99999)
  price: number;
  // "  19.999  " → "19.999" → 19.999 → 20.00 → validates range
}
```

### Multi-Step Transformation

```typescript
class SupplierSKU {
  @DerivedFrom('raw_sku')         // Step 1: Extract from nested path
  @CoerceTrim()                    // Step 2: Remove whitespace
  @CoerceCase('upper')            // Step 3: Uppercase
  @CoerceFormat((v: string) =>    // Step 4: Ensure prefix
    v.startsWith('SKU-') ? v : `SKU-${v}`
  )
  @ValidatePattern(/^SKU-[A-Z0-9]{6,12}$/)  // Step 5: Validate format
  sku: string;
}
```

### Sourcing + Coercion + Validation

```typescript
class InvoiceLine {
  @DerivedFrom('$.items[0].product.name')  // Source from nested JSON path
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('$.items[0].qty')
  @CoerceType('number')
  @CoerceRound(0)
  @ValidateRange(1, 10000)
  quantity: number;

  @DerivedFrom('$.items[0].price')
  @CoerceType('number')
  @CoerceRound(2)
  @ValidateRange(0.01, 999999.99)
  unit_price: number;
}
```

---

## Context-Driven Coercion

### Conditional Coercion Based on Other Fields

Use `@If` / `@Else` / `@EndIf` to apply different coercion rules based on field values:

```typescript
class ProductSize {
  @Copy()
  category: string;

  @If('category', c => c === 'shoes')
    @CoerceFromSet(['6', '7', '8', '9', '10', '11', '12', '13'], { strategy: 'fuzzy' })
  @ElseIf('category', c => c === 'clothing')
    @CoerceFromSet(['XS', 'S', 'M', 'L', 'XL', 'XXL'], { strategy: 'fuzzy' })
  @Else()
    @CoerceTrim()
  @EndIf()
  size: string;
}
```

### Region-Specific Coercion

```typescript
interface RegionContext {
  region: 'US' | 'EU' | 'UK';
}

class PriceRecord {
  @If<RegionContext>('region', r => r === 'US')
    @CoerceFormat('$#,##0.00')
  @ElseIf<RegionContext>('region', r => r === 'EU')
    @CoerceFormat('#.##0,00 €')
  @Else()
    @CoerceFormat('£#,##0.00')
  @EndIf()
  formatted_price: string;
}
```

---

## AI-Powered Coercion

When rule-based coercion can't handle the transformation, use AI decorators. These call an LLM to transform the value.

### Basic AI Transform

```typescript
class ContentRecord {
  @Copy()
  raw_description: string;

  @AITransform(
    params => `Rewrite this product description to be concise and professional (max 100 words):\n\n${params.value}`
  )
  description: string;
}
```

### AI Classification as Coercion

```typescript
class SupportTicket {
  @Copy()
  raw_text: string;

  @AIClassify(['billing', 'technical', 'feature-request', 'complaint', 'other'])
  category: string;
  // Free-text description → canonical category

  @AITransform(
    params => `Rate the urgency of this support ticket from 1 (low) to 5 (critical):\n\n${params.value}\n\nReturn only the number.`
  )
  @CoerceType('number')
  @ValidateRange(1, 5)
  urgency: number;
  // AI rates urgency → coerce to number → validate range
}
```

### AI as Last Resort (Fallback Pattern)

Use rule-based coercion first, fall back to AI only when rules fail:

```typescript
class ProductCategory {
  @CoerceFromSet(
    ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'],
    { strategy: 'fuzzy', threshold: 0.8 }
  )
  @AICatchRepair(
    params => `The value "${params.value}" could not be matched to a product category. Valid categories: Electronics, Clothing, Home & Garden, Sports, Books. Which category best fits this value? Return only the category name.`
  )
  category: string;
  // "Hiking gear" → fuzzy match fails (no close match) → AI says "Sports"
}
```

This pattern minimizes LLM calls — most values are handled by the fast fuzzy matcher, and only edge cases hit the AI.

---

## Error Recovery in Coercion

### @Catch for Graceful Degradation

```typescript
class DataImport {
  @CoerceParse('json')
  @Catch((error, value) => ({ raw: value }))
  metadata: Record<string, any>;
  // Malformed JSON → { raw: "the original string" }

  @CoerceType('number')
  @Catch((error, value) => 0)
  quantity: number;
  // "not a number" → NaN → 0 (fallback)
}
```

### @AICatchRepair for Intelligent Recovery

```typescript
class RobustRecord {
  @CoerceParse('json')
  @AICatchRepair()
  config: object;
  // '{"key": "value",}' → JSON parse fails (trailing comma) → AI repairs to {"key": "value"}

  @CoerceType('number')
  @AICatchRepair(
    params => `Convert "${params.value}" to a number. The field is "${params.propertyKey}". Return only the number.`
  )
  quantity: number;
  // "about five dozen" → NaN → AI returns "60"
}
```

---

## Performance Considerations

### Minimize AI Decorator Usage

AI decorators invoke an LLM for every value. Use them selectively:

```typescript
// ❌ Expensive: AI for every field
class ExpensiveRecord {
  @AITransform('Clean this value: {{value}}')
  name: string;

  @AITransform('Clean this value: {{value}}')
  email: string;

  @AITransform('Clean this value: {{value}}')
  phone: string;
}

// ✅ Efficient: Rules first, AI only where needed
class EfficientRecord {
  @CoerceTrim()
  @CoerceCase('title')
  name: string;

  @NormalizeText('email')
  email: string;

  @NormalizeText('phone-formatted')
  phone: string;

  @AIClassify(['billing', 'support', 'sales'])
  category: string;  // Only this field truly needs AI
}
```

### Use SinglePass When Possible

If your coercion chains don't have circular dependencies between fields, opt into the faster single-pass engine:

```typescript
@UseSinglePassValidation()
class FastCoercion {
  @CoerceTrim()
  @CoerceCase('lower')
  email: string;

  @CoerceType('number')
  @CoerceRound(2)
  price: number;
}
```

### Reuse the ValidationFactory

Create one factory and reuse it — the factory caches class metadata after the first call:

```typescript
// ✅ Module-level factory — metadata cached after first use
const factory = new ValidationFactory();

// In your entity or processing loop:
for (const rawItem of items) {
  const clean = await factory.create(ProductRecord, rawItem);
  // Second call and beyond use cached metadata
}
```

---

## See Also

- [Data Validation Library Overview](../feature_guides/data-validation-overview.md) — Architecture and decorator catalog
- [Data Validation Patterns](./data-validation-patterns.md) — Validation (checking) patterns
- [Conceptual Guide](../../utils/validation/concepts.md) — Pipeline, engines, and dependency graph
- [API Reference](../../utils/validation/validation-library-reference.md) — Full decorator signatures
- [Catalog Intake Tutorial](../tutorials/catalog-intake/README.md) — Real-world coercion pipeline
- [Validation Integration Patterns](../feature_guides/validation-integration-patterns.md) — Bot and entity integration
