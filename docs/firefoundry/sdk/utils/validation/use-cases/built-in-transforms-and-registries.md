# Built-In Transforms and Extensible Registries

Normalize phones, emails, currencies, dates, and more using the library's built-in transform registries — then register your own when the built-ins aren't enough.

---

## The Problem

User-facing data arrives in every format imaginable. Phone numbers come as `"(555) 867-5309"`, `"555-867-5309"`, `"+15558675309"`, or `"555.867.5309"`. Emails arrive with mixed casing and leading spaces. Currency values show up as `"$1,234.56"`, `"1.234,56 €"`, or `"(1,234.56)"`. Dates come in ISO, US, European, and natural-language formats.

Writing one-off coercion functions for each property is tedious and error-prone. Worse, you end up with dozens of slightly different normalizers scattered across your codebase, each handling a subset of edge cases differently.

You need a catalog of battle-tested normalizers that you can apply declaratively, chain together, and extend when your domain requires something custom.

## The Strategy

**Three extensible registries for different transformation needs:**

| Registry | Purpose | Built-ins | Decorator | Extension Point |
|----------|---------|-----------|-----------|-----------------|
| **TextNormalizerRegistry** | String cleaning and formatting | 19 normalizers (phone, email, URL, SSN, credit card, currency, unicode, etc.) | `@NormalizeText('name')`, `@NormalizeTextChain([...])` | `TextNormalizerRegistry.register(normalizer)` |
| **ParserRegistry** | String-to-structured-data parsing | JSON (+ optional YAML, XML, HTML) | `@CoerceParse('format')` | `ParserRegistry.register(parser)` |
| **CoerceFormat** | Structured-data-to-string formatting | Date and number formatters via `Intl` | `@CoerceFormat('date')`, `@CoerceFormat('number')` | Custom function via `@Coerce(fn)` |

Each system follows the same pattern: built-in transforms ship with the library, a decorator applies them declaratively, and a registration API lets you add custom ones.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Raw Input                                 │
│  { phone: "(555) 867-5309", email: "  BOB@CO.COM  ",       │
│    price: "$1,234.56", config: '{"debug": true}' }          │
└────────────────────────┬────────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────────────┐
    ▼                    ▼                             ▼
┌──────────┐     ┌──────────────┐              ┌─────────────┐
│ @Normalize│     │ @CoerceParse │              │@CoerceFormat│
│  Text     │     │              │              │             │
│           │     │ 'json'   ──▶ JSON.parse     │ 'date' ──▶ │
│ 'phone'──▶│     │ 'number' ──▶ Intl parser    │   Intl.Date │
│   strip   │     │ 'currency'▶ locale-aware    │ 'number'──▶│
│ 'email'──▶│     │ 'yaml'  ──▶ (optional)      │   Intl.Num  │
│   lower   │     │ 'xml'   ──▶ (optional)      │             │
│ 'url'  ──▶│     │ custom  ──▶ your parser     │             │
│   proto   │     └──────────────┘              └─────────────┘
└──────────┘
    │                    │                             │
    ▼                    ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Validated Instance                         │
│  { phone: "5558675309", email: "bob@co.com",                │
│    price: 1234.56, config: { debug: true } }                │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Built-in text normalizers

The library ships with 19 normalizers that cover the most common string cleaning tasks. Apply them with `@NormalizeText('name')`:

```typescript
class ContactForm {
    @NormalizeText('email')             // trim + lowercase
    email!: string;

    @NormalizeText('phone')             // strip non-digits
    phone!: string;

    @NormalizeText('phone-formatted')   // format as (XXX) XXX-XXXX
    displayPhone!: string;

    @NormalizeText('url')               // add protocol, lowercase domain
    website!: string;

    @NormalizeText('us-zip')            // pad/truncate to 5 digits
    zip!: string;

    @NormalizeText('slug')              // lowercase, dash-separated, ASCII-folded
    username!: string;

    @NormalizeText('whitespace')        // collapse whitespace, trim
    bio!: string;

    @NormalizeText('currency')          // strip symbols → numeric string
    salary!: string;
}
```

#### Complete list of built-in normalizers

| Name | Description | Example Input | Example Output |
|------|-------------|---------------|----------------|
| `email` | Trim + lowercase | `"  Bob@CO.COM  "` | `"bob@co.com"` |
| `phone` | Strip non-digits | `"(555) 867-5309"` | `"5558675309"` |
| `phone-formatted` | Format as (XXX) XXX-XXXX | `"5558675309"` | `"(555) 867-5309"` |
| `url` | Add protocol, lowercase domain | `"Example.COM/Path"` | `"https://example.com/Path"` |
| `us-zip` | Pad to 5 digits | `"7701"` | `"07701"` |
| `slug` | URL-friendly slug | `"Hello World! Ça va?"` | `"hello-world-ca-va"` |
| `whitespace` | Collapse spaces, trim | `"  too   many   spaces  "` | `"too many spaces"` |
| `line-endings` | CRLF/CR to LF | `"line1\r\nline2"` | `"line1\nline2"` |
| `currency` | Strip symbols | `"$1,234.56"` | `"1234.56"` |
| `credit-card` | Remove spaces/dashes | `"4111-1111-1111-1111"` | `"4111111111111111"` |
| `credit-card-formatted` | Group by 4 digits | `"4111111111111111"` | `"4111 1111 1111 1111"` |
| `ssn` | Strip non-digits | `"123-45-6789"` | `"123456789"` |
| `ssn-formatted` | Format as XXX-XX-XXXX | `"123456789"` | `"123-45-6789"` |
| `unicode-nfc` | NFC normalization | `"e\u0301"` (decomposed é) | `"é"` (composed) |
| `unicode-nfd` | NFD decomposition | `"é"` | `"e\u0301"` |
| `remove-diacritics` | Strip accents | `"résumé"` | `"resume"` |
| `html-entities` | Decode entities | `"&lt;b&gt;hi&lt;/b&gt;"` | `"<b>hi</b>"` |
| `control-strip` | Remove control chars | `"hello\u200Bworld"` | `"helloworld"` |
| `control-visualize` | Show control chars | `"hello\u200Bworld"` | `"hello\u200bworld"` |

### 2. Chaining normalizers

Apply multiple normalizers in sequence with `@NormalizeTextChain`:

```typescript
class InternationalContact {
    // Unicode normalize → remove diacritics → collapse whitespace → lowercase
    @NormalizeTextChain(['unicode-nfc', 'remove-diacritics', 'whitespace', 'email'])
    email!: string;
}
```

The normalizers execute left-to-right. Each one receives the output of the previous one.

### 3. Built-in parsers with @CoerceParse

Parse structured data from strings:

```typescript
class APIPayload {
    @CoerceParse('json')
    config!: Record<string, any>;

    // Locale-aware number parsing: "1.234,56" → 1234.56
    @CoerceParse('number', { locale: 'de-DE' })
    quantity!: number;

    // Currency parsing: "$1,234.56" or "(1,234.56)" → 1234.56
    @CoerceParse('currency', { locale: 'en-US', currency: 'USD' })
    price!: number;
}
```

**Built-in parsers:**

| Name | Description | Notes |
|------|-------------|-------|
| `json` | `JSON.parse` | Passes through if already an object |
| `number` | Locale-aware number parsing | Handles group/decimal separators per locale |
| `currency` | Locale-aware currency parsing | Strips currency symbols, handles parentheses for negatives |

**Optional parsers** (require separate packages):

```typescript
import { registerYAMLParser } from '@firebrandanalytics/shared-utils/validation';
registerYAMLParser();  // requires 'yaml' package

class Config {
    @CoerceParse('yaml')
    settings!: any;
}
```

### 4. Formatting with @CoerceFormat

Convert structured data back into display-ready strings:

```typescript
class Receipt {
    @CoerceFormat('date', { format: 'medium-date', locales: 'en-US' })
    orderDate!: string;  // "2024-03-15" → "Mar 15, 2024"

    @CoerceFormat('number', {
        locales: 'en-US',
        numberOptions: { style: 'currency', currency: 'USD' }
    })
    total!: string;  // 1234.56 → "$1,234.56"
}
```

**Date format options:** `'iso-date'`, `'iso-datetime'`, `'short-date'`, `'medium-date'`, `'long-date'`, `'full-date'`, `'short-datetime'`, `'medium-datetime'`, `'long-datetime'`

### 5. Registering custom transforms

When the built-ins don't cover your domain, register your own.

**Custom text normalizer:**

```typescript
import { TextNormalizerRegistry } from '@firebrandanalytics/shared-utils/validation';

TextNormalizerRegistry.register({
    name: 'company-code',
    description: 'Normalize company codes to uppercase with dashes',
    normalize(input: string): string {
        return input.trim().toUpperCase().replace(/[\s_]+/g, '-');
    },
});

// Now use it like any built-in
class Order {
    @NormalizeText('company-code')
    vendorCode!: string;  // "acme corp" → "ACME-CORP"
}
```

**Custom parser:**

```typescript
import { ParserRegistry } from '@firebrandanalytics/shared-utils/validation';

ParserRegistry.register({
    name: 'csv-row',
    description: 'Parse a single CSV row into an array',
    parse(input: string): string[] {
        return input.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
    },
});

class ImportRow {
    @CoerceParse('csv-row')
    fields!: string[];
}
```

## What to Observe

When you run the [companion example](../examples/built-in-transforms-and-registries.ts), the output shows each registry in action:

```
── Demo 1: Text Normalizers ───────────────────────────────
  19 built-in normalizers available.
    email:       "  Alice.Smith@EXAMPLE.COM  "  → "alice.smith@example.com"
    phone:       "(555) 867-5309"               → "5558675309"
    phone-fmt:   "5558675309"                   → "(555) 867-5309"
    url:         "example.COM/About"            → "https://example.com/About"
    slug:        "Héllo Wörld! 2024"            → "hello-world-2024"
    zip:         "7701"                         → "07701"

── Demo 2: Normalizer Chaining ────────────────────────────
    unicode → diacritics → whitespace → slug:
    "  Ça  fait  plaisir,  José!  " → "ca-fait-plaisir-jose"

── Demo 3: Parsers ────────────────────────────────────────
    json:       '{"active":true}' → { active: true }
    number:     "1.234,56"  (de-DE) → 1234.56
    currency:   "($1,234.56)" → -1234.56

── Demo 4: Custom Normalizer ──────────────────────────────
    company-code: "acme  corp_intl"  → "ACME-CORP-INTL"

── Demo 5: Custom Parser ─────────────────────────────────
    csv-row: '"Alice","Smith","Engineer"' → ["Alice","Smith","Engineer"]
```

### Understanding the behavior

| Concept | Explanation |
|---------|-------------|
| **Normalizer vs. Parser** | Normalizers transform strings into different strings. Parsers transform strings into structured data (objects, arrays, numbers). |
| **Auto-registration** | All 19 built-in normalizers register automatically when you import from `@firebrandanalytics/shared-utils/validation`. No setup needed. |
| **Chaining** | `@NormalizeTextChain(['a', 'b', 'c'])` runs normalizers in order, each receiving the previous output. Useful for multi-step pipelines. |
| **Locale-aware parsing** | `@CoerceParse('number')` and `@CoerceParse('currency')` use `Intl.NumberFormat` to detect group/decimal separators for any locale. |
| **Negative currencies** | `@CoerceParse('currency')` handles parenthesized negatives: `"(1,234.56)"` parses to `-1234.56`. |
| **Custom registration** | Both `TextNormalizerRegistry.register()` and `ParserRegistry.register()` accept an object with `name`, `description`, and the transform function. Register before decorator evaluation (i.e., at module top level). |
| **Optional parsers** | YAML, XML, and HTML parsers are not bundled — call `registerYAMLParser()` etc. to add them. This keeps the core bundle small. |

## Variations

### 1. Combining normalizers with validation

Normalize first, then validate:

```typescript
class RegistrationForm {
    @NormalizeText('email')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    email!: string;

    @NormalizeText('phone')
    @ValidateLength(10, 11)
    phone!: string;

    @NormalizeText('us-zip')
    @ValidatePattern(/^\d{5}$/)
    zip!: string;
}
```

The normalizer runs first (it's a coercion), then the validator checks the cleaned value.

### 2. Format pipeline: parse → transform → format

A full round-trip from raw string to display-ready output:

```typescript
class PriceDisplay {
    // Parse locale string to number, then format as USD
    @CoerceParse('currency', { locale: 'en-US' })
    @CoerceFormat('number', {
        locales: 'en-US',
        numberOptions: { style: 'currency', currency: 'USD' }
    })
    price!: string;  // "$1,234.56" → 1234.56 → "$1,234.56"
}
```

### 3. Normalizers inside style classes

Combine normalizers with the [CSS-like cascade](./css-like-style-cascade.md) for organization-wide standards:

```typescript
class EmailFieldStyle {
    @NormalizeText('email')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    value!: string;
}

class PhoneFieldStyle {
    @NormalizeText('phone-formatted')
    @ValidateLength(14, 18)
    value!: string;
}

@DefaultTransforms({ string: TrimStyle })
class Contact {
    @UseStyle(EmailFieldStyle)
    email!: string;

    @UseStyle(PhoneFieldStyle)
    phone!: string;

    @Copy()
    name!: string;  // Gets TrimStyle from class default
}
```

### 4. Listing available normalizers at runtime

Discover what's registered — useful for building dynamic UIs or debugging:

```typescript
import { TextNormalizerRegistry, ParserRegistry } from
    '@firebrandanalytics/shared-utils/validation';

console.log('Normalizers:', TextNormalizerRegistry.list());
// ['control-visualize', 'control-strip', 'credit-card', ...]

console.log('Parsers:', ParserRegistry.list());
// ['json']
```

## See Also

- [CSS-Like Style Cascade](./css-like-style-cascade.md) -- Using normalizers inside reusable styles
- [LLM Output Canonicalization](./llm-output-canonicalization.md) -- Cleaning LLM-generated strings
- [Multi-Format Data Ingestion](./multi-format-data-ingestion.md) -- Parsing JSON, YAML, XML inputs
- [API Reference](../validation-library-reference.md) -- `@NormalizeText`, `@CoerceParse`, `@CoerceFormat` full options
