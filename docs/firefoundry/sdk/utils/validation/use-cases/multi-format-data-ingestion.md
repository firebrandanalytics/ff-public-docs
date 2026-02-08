# Multi-Format Data Ingestion

Parse JSON, currency, and locale-specific number formats from heterogeneous data sources.

---

## The Problem

Real-world data pipelines receive values in wildly inconsistent formats. A single "price" field might arrive as:

- `"$1,234.56"` from a US payment gateway
- `"1.234,56"` from a European ERP system
- `"(1,234.56)"` in accounting-format reports (parentheses mean negative)
- `1234.56` as a raw number from an internal API

Dates are no better: `"2024-01-15"`, `"Jan 15, 2024"`, and `1705276800000` (Unix timestamp) all mean the same thing. Embedded JSON strings like `"{\"region\":\"EMEA\"}"` need parsing before you can use them. Every consumer of this data writes its own ad-hoc normalization code, which drifts across teams and breaks silently when a new source appears.

You need a single, declarative pipeline that accepts all of these formats and produces clean, typed, consistently formatted output.

## The Strategy

The library handles this with a **Parse -> Coerce -> Format** pipeline. Each stage has a dedicated set of decorators:

| Stage | Decorator | Purpose |
|-------|-----------|---------|
| **Parse** | `@CoerceParse('currency')` | Strip currency symbols, handle locale-specific grouping separators, convert to number |
| | `@CoerceParse('number', { locale })` | Parse locale-formatted number strings (e.g., `"1.234,56"` in `de-DE`) |
| | `@CoerceParse('json')` | Deserialize embedded JSON strings into objects |
| **Coerce** | `@CoerceType('number')` | Ensure the value is a JavaScript number |
| | `@CoerceType('date', { format })` | Parse date strings and timestamps into `Date` objects |
| | `@CoerceRound({ precision })` | Round to fixed decimal places for financial accuracy |
| **Format** | `@CoerceFormat('date', { format })` | Render dates as ISO strings, short dates, or locale-specific formats |
| | `@CoerceFormat('number', { numberOptions })` | Render numbers with locale-aware formatting (currency, percent, decimal) |

Decorators execute top-to-bottom, so the order you write them is the order they run. Parse first to get a usable value, coerce to the target type, then format for output.

## Architecture

```
                        Mixed-Format Input
                               |
             "$1,234.56"  "1.234,56"  "(500.00)"  '{"region":"EMEA"}'
                               |
                     +---------+---------+
                     |   @CoerceParse    |   Parse strings into raw values
                     +---------+---------+
                               |
                    1234.56   1234.56   -500.00   { region: "EMEA" }
                               |
                     +---------+---------+
                     |   @CoerceType     |   Normalize to target JS types
                     +---------+---------+
                               |
                     +---------+---------+
                     |   @CoerceRound    |   Round for financial precision
                     +---------+---------+
                               |
                     +---------+---------+
                     |   @CoerceFormat   |   Render to consistent output strings
                     +---------+---------+
                               |
                      Clean Typed Output
```

## Implementation

### Financial record with multi-format currency and embedded JSON

```typescript
import {
    ValidationFactory,
    CoerceParse, CoerceType, CoerceRound, CoerceFormat,
    CoerceTrim, CoerceCase, ValidateRequired, ValidateRange,
    NormalizeText,
} from '@firebrandanalytics/shared-utils/validation';

class FinancialRecord {
    @ValidateRequired()
    @CoerceTrim()
    transactionId: string;

    // US currency: "$1,234.56" -> 1234.56
    @CoerceParse('currency', { locale: 'en-US' })
    @CoerceRound({ precision: 2 })
    @ValidateRange(0)
    amount: number;

    // European number: "1.234,56" -> 1234.56
    @CoerceParse('number', { locale: 'de-DE' })
    @CoerceRound({ precision: 2 })
    europeanTotal: number;

    // Accounting format: "(500.00)" -> -500.00
    @CoerceParse('currency', { allowParentheses: true })
    @CoerceRound({ precision: 2 })
    adjustment: number;

    // Embedded JSON: '{"region":"EMEA","priority":1}' -> { region: "EMEA", priority: 1 }
    @CoerceParse('json', { allowNonString: true })
    metadata: Record<string, any>;

    // Date normalization: accepts "2024-01-15", "Jan 15, 2024", or timestamps
    @CoerceType('date', { format: 'loose', allowTimestamps: true })
    @CoerceFormat('date', { format: 'iso-date', timezone: 'utc' })
    transactionDate: string;
}

const factory = new ValidationFactory();

// US payment gateway data
const usRecord = await factory.create(FinancialRecord, {
    transactionId: '  TXN-001  ',
    amount: '$1,234.56',
    europeanTotal: '1.234,56',
    adjustment: '(500.00)',
    metadata: '{"region":"NA","priority":1}',
    transactionDate: 'Jan 15, 2024',
});

// European ERP data
const euRecord = await factory.create(FinancialRecord, {
    transactionId: 'TXN-002',
    amount: '$2,500.00',
    europeanTotal: '2.500,00',
    adjustment: '0.00',
    metadata: { region: 'EMEA', priority: 2 },   // already parsed -- allowNonString passes it through
    transactionDate: '2024-01-15',
});
```

Both records produce the same clean structure: numeric amounts rounded to two decimal places, parsed metadata objects, and ISO-formatted date strings.

### Sales report with locale-aware number output

```typescript
class SalesReport {
    @ValidateRequired()
    @CoerceTrim()
    @CoerceCase('upper')
    region: string;

    // Parse any currency format, round, then re-format as US dollars
    @CoerceParse('currency', { locale: 'en-US' })
    @CoerceRound({ precision: 2 })
    @CoerceFormat('number', {
        numberOptions: { style: 'currency', currency: 'USD' }
    })
    revenue: string;

    // Parse a European decimal, round, format as percentage
    @CoerceParse('number', { locale: 'de-DE' })
    @CoerceRound({ precision: 1 })
    @CoerceFormat('number', {
        numberOptions: { style: 'percent', minimumFractionDigits: 1 }
    })
    growthRate: string;

    // Flexible date input -> consistent medium-date output
    @CoerceType('date', { format: 'loose', allowTimestamps: true })
    @CoerceFormat('date', { format: 'medium-date', timezone: 'utc' })
    reportDate: string;

    // Contact email normalization
    @NormalizeText('email')
    contactEmail: string;
}

const report = await factory.create(SalesReport, {
    region: '  emea  ',
    revenue: '$1,234,567.89',
    growthRate: '12,5',            // European format for 12.5
    reportDate: 1705276800000,     // Unix timestamp
    contactEmail: '  SALES@EXAMPLE.COM  ',
});
// {
//   region: 'EMEA',
//   revenue: '$1,234,567.89',
//   growthRate: '12.5%',
//   reportDate: 'Jan 15, 2024',
//   contactEmail: 'sales@example.com'
// }
```

## What to Observe

Given diverse input formats, every record normalizes to identical output shapes:

```
Input: amount = "$1,234.56"     ->  Output: amount = 1234.56
Input: amount = "1.234,56" (DE) ->  Output: amount = 1234.56
Input: amount = "(500.00)"      ->  Output: amount = -500.00

Input: date = "Jan 15, 2024"    ->  Output: transactionDate = "2024-01-15"
Input: date = "2024-01-15"      ->  Output: transactionDate = "2024-01-15"
Input: date = 1705276800000     ->  Output: transactionDate = "2024-01-15"

Input: metadata = '{"region":"NA"}'  ->  Output: metadata = { region: "NA" }
Input: metadata = { region: "EMEA" } ->  Output: metadata = { region: "EMEA" }

Input: growthRate = "12,5" (DE) ->  Output: growthRate = "12.5%"
Input: revenue = "$1,234,567.89" -> Output: revenue = "$1,234,567.89"
```

The decorator pipeline is fully declarative. Adding a new source format is a matter of adjusting decorator options on the class -- no imperative parsing code to maintain.

## Variations

1. **Locale-aware currency conversion chains** -- Chain `@CoerceParse('currency', { locale: 'ja-JP', currency: 'JPY' })` with `@CoerceFormat('number', { numberOptions: { style: 'currency', currency: 'USD' } })` to parse one currency and display as another (conversion rate logic in a `@Coerce` lambda between them).

2. **Parse -> Transform -> Format pipelines for dates** -- Use `@CoerceType('date')` to parse, `@Coerce(d => addDays(d, 30))` for business logic, then `@CoerceFormat('date', { format: 'long-date' })` for human-readable output.

3. **Custom parser registration** -- Register domain-specific parsers with `ParserRegistry` for formats like SWIFT MT messages or HL7 segments, then use them with `@CoerceParse('swift')` like any built-in parser.

4. **Handling mixed numeric formats with fallback** -- When you cannot predict the locale, chain `@CoerceParse('number', { locale: 'en-US' })` inside a `@Catch` that falls back to `@CoerceParse('number', { locale: 'de-DE' })`, letting the library try US format first and European format on failure.

## See Also

- [API Reference -- @CoerceParse](../validation-library-reference.md#coerceparseformatorfn-options) -- Full parser options and custom parser registration
- [API Reference -- @CoerceFormat](../validation-library-reference.md#coerceformattargettype-format) -- Date and number formatting options
- [API Reference -- @CoerceType](../validation-library-reference.md#coercetypetargettype-options) -- Type coercion with date/boolean/number details
- [Conceptual Guide -- Decorator Pipeline](../concepts.md#1-the-decorator-pipeline-top-to-bottom-transformation) -- How decorators chain top-to-bottom
- [Error Recovery and Repair](./error-recovery-and-repair.md) -- Using `@Catch` for graceful fallback when parsing fails
- [Runnable Example](../examples/multi-format-data-ingestion.ts) -- Self-contained TypeScript program demonstrating these patterns
