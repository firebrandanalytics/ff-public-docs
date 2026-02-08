# LLM Output Canonicalization

Clean and normalize structured data extracted by LLMs -- fix wrong types, inconsistent casing, extra whitespace, and format violations in one declarative step.

---

## The Problem

You ask an LLM to extract order data from a customer email and it returns something like this:

```json
{
  "customer_email": "  JANE@EXAMPLE.COM  ",
  "quantity": "12",
  "sku": "  wid-001 ",
  "order_date": "January 15, 2025",
  "phone": "(555) 867-5309",
  "priority": "HIGH"
}
```

Every field has an issue. The email has leading whitespace and wrong casing. The quantity is a string, not a number. The SKU needs to be uppercase and trimmed. The date is a natural-language string instead of an ISO date. The phone number has formatting characters you want stripped to digits.

Traditional validation libraries treat this as invalid data -- they reject it and throw. But the data is *semantically correct*; it just needs normalization. Writing ad-hoc cleanup code for every field is tedious, error-prone, and scatters transformation logic across your codebase.

What you want is a single declarative description of the *desired* shape, and a library that coerces messy input into that shape or fails with a clear explanation of what could not be fixed.

## The Strategy

The decorator pipeline processes each property through a fixed sequence of phases:

```
source  -->  normalize / coerce  -->  validate
```

| Phase | Purpose | Example decorators |
|-------|---------|-------------------|
| **Source** | Determine where the raw value comes from | `@Copy()`, `@DerivedFrom()` |
| **Normalize** | Clean string formatting | `@CoerceTrim()`, `@CoerceCase()`, `@NormalizeText()` |
| **Coerce** | Convert to the target type | `@CoerceType('number')`, `@CoerceType('date')` |
| **Validate** | Assert constraints on the final value | `@ValidateRequired()`, `@ValidateRange()`, `@ValidatePattern()` |

Decorators execute top-to-bottom on each property. The output of one decorator flows into the next, so you write them in the order you want the transformations to happen: clean first, convert second, check last.

## Architecture

```
                 Raw LLM JSON
                      |
                      v
         +---------------------------+
         |    ValidationFactory      |
         |    factory.create(        |
         |      LLMOrder, rawData    |
         |    )                      |
         +---------------------------+
                      |
       per-property decorator pipeline
                      |
     +------+------+------+------+------+
     | email| qty  | sku  | date | phone|
     +------+------+------+------+------+
     | Trim | Type | Trim | Type | Norm |
     | Case | Range| Case | Req  | Pat  |
     | Pat  |      | Pat  |      |      |
     +------+------+------+------+------+
                      |
                      v
           Clean, typed LLMOrder instance
```

Each column is an independent pipeline. The factory runs them all (respecting any inter-property dependencies), collects errors, and either returns a fully validated instance or throws a `ValidationError` describing exactly what failed.

## Implementation

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceType,
  CoerceCase,
  ValidateRange,
  ValidatePattern,
  NormalizeText,
  Examples,
} from '@firebrandanalytics/shared-utils/validation';

class LLMOrder {
  // --- email: trim whitespace, lowercase, then validate format ---
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    'Invalid email format'
  )
  customer_email: string;

  // --- quantity: coerce "12" -> 12, then range-check ---
  @CoerceType('number')
  @ValidateRange(1, 10000)
  quantity: number;

  // --- sku: trim, uppercase, then validate format ---
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/, 'SKU must be AAA-999 format')
  @Examples(['WID-001', 'GAD-002'], 'Product SKU')
  sku: string;

  // --- order_date: coerce natural-language or ISO string to Date ---
  @CoerceType('date')
  @ValidateRequired()
  order_date: Date;

  // --- phone: strip to digits via built-in normalizer, then check length ---
  @NormalizeText('phone')
  @ValidatePattern(/^\d{10}$/, 'Phone must be 10 digits')
  phone: string;

  // --- priority: trim and lowercase for consistent downstream use ---
  @CoerceTrim()
  @CoerceCase('lower')
  priority: string;
}
```

**Line-by-line breakdown:**

1. **`customer_email`** -- `@CoerceTrim()` strips `"  JANE@EXAMPLE.COM  "` to `"JANE@EXAMPLE.COM"`. `@CoerceCase('lower')` yields `"jane@example.com"`. `@ValidatePattern` confirms it looks like an email.

2. **`quantity`** -- `@CoerceType('number')` converts the string `"12"` to the number `12`. `@ValidateRange(1, 10000)` rejects zero, negative values, or implausibly large orders.

3. **`sku`** -- `@CoerceTrim()` removes whitespace. `@CoerceCase('upper')` normalizes casing. `@ValidatePattern` enforces the three-letter-dash-three-digit format. `@Examples` provides sample values that appear in error messages (and in AI retry prompts if you add `@AITransform` later).

4. **`order_date`** -- `@CoerceType('date')` parses a wide range of date formats: ISO strings, natural-language dates like "January 15, 2025", and Unix timestamps. `@ValidateRequired()` ensures the field was not null or undefined in the source.

5. **`phone`** -- `@NormalizeText('phone')` is a built-in normalizer that strips all non-digit characters, turning `"(555) 867-5309"` into `"5558675309"`. `@ValidatePattern` then confirms exactly 10 digits remain.

6. **`priority`** -- A light cleanup: trim and lowercase. No validation constraint, so `"HIGH"`, `" high "`, and `"High"` all become `"high"`.

**Running the pipeline:**

```typescript
const factory = new ValidationFactory();

const rawLLMOutput = {
  customer_email: '  JANE@EXAMPLE.COM  ',
  quantity: '12',
  sku: '  wid-001 ',
  order_date: 'January 15, 2025',
  phone: '(555) 867-5309',
  priority: '  HIGH ',
};

const order = await factory.create(LLMOrder, rawLLMOutput);

console.log(order.customer_email); // "jane@example.com"
console.log(order.quantity);       // 12  (number)
console.log(order.sku);           // "WID-001"
console.log(order.order_date);    // 2025-01-15T00:00:00.000Z  (Date)
console.log(order.phone);         // "5558675309"
console.log(order.priority);      // "high"
```

## What to Observe

Running the example produces output like this:

```
=== LLM Output Canonicalization ===

--- Raw LLM output ---
  customer_email : "  JANE@EXAMPLE.COM  "
  quantity       : "12"            (string)
  sku            : "  wid-001 "
  order_date     : "January 15, 2025"
  phone          : "(555) 867-5309"
  priority       : "  HIGH "

--- After canonicalization ---
  customer_email : "jane@example.com"
  quantity       : 12              (number)
  sku            : "WID-001"
  order_date     : 2025-01-15T00:00:00.000Z
  phone          : "5558675309"
  priority       : "high"
```

**What each metric tells you:**

| Field | Transformation applied | What to watch for |
|-------|----------------------|-------------------|
| `customer_email` | Trim + lowercase + pattern check | Emails with invalid TLDs still pass the regex; add a stricter pattern or `@AIValidate` for production |
| `quantity` | String-to-number coercion + range | If the LLM returns `"twelve"` instead of `"12"`, `@CoerceType('number')` will throw -- add `@AITransform` to handle words |
| `sku` | Trim + uppercase + format validation | Typos like `"WID-0O1"` (letter O vs zero) pass the regex; consider `@CoerceFromSet` with fuzzy matching |
| `order_date` | Flexible date parsing | Ambiguous formats like `"01/02/2025"` parse as US month/day; set `format: 'iso'` if you need strict ISO |
| `phone` | Normalizer strips non-digits | International numbers with country codes will have more than 10 digits; adjust the pattern |
| `priority` | Trim + lowercase | No validation constraint; any string is accepted. Add `@CoerceFromSet` to restrict to known values |

**Tuning knobs:**

- **Strictness** -- Add `@ValidateRequired()` to any field that must not be null/undefined. Move it before coercion decorators to fail fast on missing values.
- **Type coercion** -- `@CoerceType('number')` handles `"12"` and `"12.5"` but not `"twelve"`. Chain `@AITransform` before `@CoerceType` for natural-language number extraction.
- **Date flexibility** -- Pass `{ format: 'iso' }` to `@CoerceType('date', { format: 'iso' })` to reject non-ISO strings, or leave the default `'loose'` to accept natural-language dates.
- **Error aggregation** -- By default the factory throws on the first error. The convergent engine processes all properties and can surface multiple errors in one pass.

## Variations

### 1. Adding @DefaultTransforms for app-wide string cleaning

If every string in your application should be trimmed, set a class-level default so you do not repeat `@CoerceTrim()` on every property.

```typescript
class TrimStyle {
  @CoerceTrim()
  value: string;
}

@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class LLMOrder {
  // All string properties are auto-trimmed. No need for per-field @CoerceTrim().
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  customer_email: string;

  @CoerceType('number')
  @ValidateRange(1, 10000)
  quantity: number;

  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/)
  sku: string;

  @CoerceType('date')
  order_date: Date;

  @NormalizeText('phone')
  @ValidatePattern(/^\d{10}$/)
  phone: string;

  priority: string;  // Gets trimmed via default, no other transforms needed
}
```

`@ManageAll()` ensures every property participates in the pipeline even without an explicit `@Copy()`. `@DefaultTransforms` applies `TrimStyle` to all `string`-typed properties as a baseline. Property-level decorators like `@CoerceCase('upper')` still take highest priority and stack on top.

### 2. Using @UseStyle for domain-specific patterns

Extract repeated decorator stacks into reusable style classes.

```typescript
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

class SkuStyle {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/)
  value: string;
}

class LLMOrder {
  @UseStyle(EmailStyle)
  customer_email: string;

  @UseStyle(SkuStyle)
  sku: string;

  @CoerceType('number')
  @ValidateRange(1, 10000)
  quantity: number;
}
```

Styles act like CSS classes: define the pattern once, apply it everywhere. When your email regex changes, you update `EmailStyle` and every annotated property picks up the fix.

### 3. Using @Examples for better AI retry prompts

When you pair canonicalization with `@AITransform`, the `@Examples` decorator feeds sample values into the retry prompt so the LLM knows what format you expect.

```typescript
class LLMOrder {
  @AITransform(
    (params) =>
      `Extract the quantity as a number from: "${params.value}". Return only the number.`
  )
  @CoerceType('number')
  @ValidateRange(1, 10000)
  @Examples([1, 50, 250], 'Quantity must be a positive integer')
  quantity: number;

  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/)
  @Examples(['WID-001', 'GAD-002', 'TOY-100'], 'Product SKU format')
  sku: string;
}
```

If `@ValidateRange` fails on the AI's first attempt, the retry prompt automatically includes `"Examples: 1, 50, 250 (Quantity must be a positive integer)"`, giving the LLM concrete guidance for its next attempt.

### 4. Batch processing multiple LLM outputs

When the LLM returns an array of extracted records, canonicalize them all in parallel.

```typescript
const factory = new ValidationFactory();

const rawRecords = [
  { customer_email: ' BOB@CO.COM ', quantity: '5', sku: 'gad-002' },
  { customer_email: 'alice@co.com', quantity: '20', sku: ' WID-001' },
  { customer_email: '  EVE@CO.COM', quantity: '3', sku: 'toy-100 ' },
];

const results = await Promise.allSettled(
  rawRecords.map((record) => factory.create(LLMOrder, record))
);

const succeeded = results.filter((r) => r.status === 'fulfilled');
const failed = results.filter((r) => r.status === 'rejected');

console.log(`Canonicalized: ${succeeded.length}, Failed: ${failed.length}`);
```

`Promise.allSettled` ensures one bad record does not block the rest. Inspect `failed` entries for their `ValidationError` details.

## See Also

- [Conceptual Guide](../concepts.md) -- Decorator pipeline model, coerce-first-validate-second philosophy, engine selection
- [API Reference](../validation-library-reference.md) -- Full decorator signatures and options
- [Getting Started Tutorial](../validation-library-getting-started.md) -- Your first validated class
- [Intermediate Tutorial](../validation-library-intermediate.md) -- DerivedFrom, context, conditionals, AI transforms
- [Fuzzy Inventory Matching (use case)](./fuzzy-inventory-matching.md) -- Combine canonicalization with `@CoerceFromSet` for typo correction
- [AI Content Pipeline (use case)](./ai-content-pipeline.md) -- Chain AI presets for summarization, classification, and translation
- [Runnable example](../examples/llm-output-canonicalization.ts) -- Self-contained TypeScript program you can execute with `npx tsx`
