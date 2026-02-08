# Advanced Validation Guide

This guide covers advanced features, nuances, edge cases, and complex interactions in the validation library. It assumes you're familiar with the concepts from the [Getting Started](./validation-library-getting-started.md) and [Intermediate](./validation-library-intermediate.md) guides.

For API signatures and parameter details, refer to the [Reference Guide](./validation-library-reference.md).

---

## 1. Understanding the Validation Engines

### 1.1 Single-Pass vs. Convergent: When to Use Which

The library provides two execution engines with fundamentally different approaches to validation:

**Single-Pass Engine:**
- Processes each property exactly once in dependency order
- Fast and predictable
- Suitable when properties don't have circular dependencies
- Opt-in via `@UseSinglePassValidation()` class decorator

**Convergent Engine (default):**
- Iteratively processes properties until values stabilize
- Handles circular dependencies between properties
- Automatically detects oscillation and convergence
- Required when properties derive values from each other in cycles

**Decision Tree:**

```
Does your class have circular dependencies?
├─ No → Consider single-pass for better performance
│   └─ Are all dependencies acyclic and straightforward?
│       ├─ Yes → Use @UseSinglePassValidation()
│       └─ No → Stick with convergent (safer default)
└─ Yes → Must use convergent (the default)
```

**Example: Single-pass is sufficient**

```typescript
@UseSinglePassValidation()
class Invoice {
  @Copy() subtotal: number;

  @DerivedFrom('subtotal', (val) => val * 0.1)
  tax: number;

  @DerivedFrom(['subtotal', 'tax'], ([sub, tax]) => sub + tax)
  total: number;
}

// Dependency chain: subtotal → tax → total (acyclic)
// Single-pass processes in order: subtotal, then tax, then total
```

**Example: Convergent required**

```typescript
class Temperature {
  @Copy() celsius: number;

  @DerivedFrom('fahrenheit', (f) => (f - 32) * 5/9)
  celsius: number;

  @DerivedFrom('celsius', (c) => (c * 9/5) + 32)
  fahrenheit: number;
}

// Circular: celsius ↔ fahrenheit
// Convergent engine resolves by iteration
```

### 1.2 The Convergent Engine Deep Dive

The convergent engine uses an iterative approach to handle complex interdependencies:

**How It Works:**

1. **Initial Pass**: Run a complete sourcing pass to populate all properties from input
2. **Iteration Loop**: For each iteration (up to `maxIterations`, default 10):
   - Snapshot current state
   - Process each property in dependency order
   - Apply merge rules
   - Compare new state to snapshot
   - If unchanged → convergence achieved, exit loop
   - If oscillation detected → throw `OscillationError`
3. **Finalization**: Apply cross-validations and object rules

**State Stabilization Example:**

```typescript
class Order {
  @Copy() quantity: number;

  // Price depends on quantity (bulk discount)
  @DerivedFrom('quantity', (qty) => {
    const basePrice = 10;
    return qty > 100 ? basePrice * 0.8 : basePrice;
  })
  unitPrice: number;

  @DerivedFrom(['quantity', 'unitPrice'], ([qty, price]) => qty * price)
  total: number;
}

// Iteration 1: quantity=150, unitPrice=10, total=1500
// Iteration 2: quantity=150, unitPrice=8, total=1200
// Iteration 3: quantity=150, unitPrice=8, total=1200 → converged!
```

**Oscillation Detection:**

The engine tracks value changes across iterations. If a property alternates between two or more values without stabilizing, it throws an `OscillationError`:

```typescript
class Broken {
  @DerivedFrom('b', (val) => !val)
  a: boolean;

  @DerivedFrom('a', (val) => !val)
  b: boolean;
}

// Iteration 1: a=true, b=false
// Iteration 2: a=false, b=true
// Iteration 3: a=true, b=false
// → OscillationError: Properties a, b are oscillating
```

**Tuning `maxIterations`:**

```typescript
const factory = new ValidationFactory();

const result = await factory.create(ComplexClass, data, {
  maxIterations: 20  // Increase for classes with deep dependency chains
});
```

Most classes converge in 2-3 iterations. If you need more than 10, consider:
- Simplifying your dependency logic
- Breaking the class into smaller pieces
- Using explicit ordering with `@DependsOn`

### 1.3 Dependency Resolution and Execution Order

The library builds a dependency graph to determine execution order:

**Intra-Cycle Dependencies:**

These are dependencies *within* a single validation pass:

```typescript
class Profile {
  @Copy()
  firstName: string;

  @Copy()
  lastName: string;

  // Depends on firstName and lastName (intra-cycle)
  @Merge({ sources: ['firstName', 'lastName'] })
  fullName: string;
}

// Dependency graph: firstName, lastName → fullName
// Execution order: firstName, lastName, then fullName
```

**Inter-Cycle Dependencies:**

These span multiple convergent iterations and involve JSONPath or derived fields that change based on other properties:

```typescript
class Document {
  @AITransform('Extract word count')
  @CoerceType('number')
  wordCount: number;

  // Depends on wordCount (inter-cycle in convergent engine)
  @If('wordCount', (count: number) => count > 500)
    @AISummarize('short')
  @Else()
    @Copy()
  @EndIf()
  summary: string;
}

// First iteration: wordCount is extracted
// Second iteration: summary depends on now-stable wordCount
```

**Self-References:**

When a property references itself by name in a decorator, it accesses its "value in progress":

```typescript
class Normalizer {
  @CoerceTrim()
  @If((val: string) => val.length > 100)  // Self-reference
    @AITransform('Shorten to 100 chars')
  @EndIf()
  description: string;
}

// The @If checks the trimmed value (after @CoerceTrim)
// This is NOT a dependency—no cycle created
```

**JSONPath: No Intra-Cycle Dependency:**

JSONPath expressions always reference the *original input*, so they don't create dependencies within a cycle:

```typescript
class Config {
  @Copy()
  mode: string;

  @If('$.metadata.version', (v) => v >= 2)  // JSONPath to raw input
    @Set('v2-mode')
  @Else()
    @Set('v1-mode')
  @EndIf()
  compatMode: string;
}

// compatMode doesn't depend on any property being processed first
// It reads $.metadata.version from raw input
```

### 1.4 Parent References and Cross-Instance Dependencies

The `^.` prefix allows child instances to reference their parent instance's properties:

**Use Case: Shared Configuration**

```typescript
class OrderItem {
  @Copy() productId: string;
  @Copy() quantity: number;

  // Reference parent's currency
  @DerivedFrom('^.currency')
  currency: string;

  @DerivedFrom(['^.currency', 'quantity'], ([currency, qty]) => {
    const prices = { USD: 10, EUR: 9, GBP: 8 };
    return prices[currency] * qty;
  })
  price: number;
}

class Order {
  @Copy() currency: string;

  @ValidatedClassArray(OrderItem)
  items: OrderItem[];
}

// Parent currency flows to all child items
```

**How It Works:**

1. Parent instance is passed to child validation via `options.parent`
2. `^.propertyName` resolves to `parent.propertyName`
3. Convergent engine handles the cross-instance dependency

**Circular Parent-Child Dependencies:**

The convergent engine can handle circular dependencies between parent and child:

```typescript
class OrderItem {
  @Copy() quantity: number;

  // Child reads from parent
  @DerivedFrom('^.currency')
  currency: string;
}

class Order {
  @Copy() currency: string;

  @ValidatedClassArray(OrderItem)
  items: OrderItem[];

  // Parent derives from children
  @DerivedFrom('items', (items: OrderItem[]) =>
    items.reduce((sum, item) => sum + item.quantity, 0)
  )
  totalQuantity: number;
}

// The engine converges in multiple passes:
// Pass 1: Order.currency → OrderItem.currency for each item
// Pass 2: OrderItem.quantity → Order.totalQuantity
```

**Limitations:**

- Only direct property access (`^.propName`) is supported
- Cannot navigate deeper (`^.parent.propName`)
- Parent must be a validated instance, not raw data
- Performance cost: Each parent reference adds a convergent iteration

---

## 2. Advanced Coercion and Matching

### 2.1 CoerceFromSet Deep Dive

`@CoerceFromSet` is one of the most powerful decorators for handling messy real-world data. It matches input values to a set of valid candidates using various strategies.

**String Matching Strategies:**

```typescript
const PRODUCTS = ['Widget', 'Gadget', 'Doohickey'];

class Order {
  // Exact: Must match exactly (with optional case-insensitivity)
  @CoerceFromSet(() => PRODUCTS, {
    strategy: 'exact',
    caseSensitive: false
  })
  exactMatch: string;

  // Fuzzy: Levenshtein distance-based matching
  @CoerceFromSet(() => PRODUCTS, {
    strategy: 'fuzzy',
    threshold: 0.7  // 0.0 = must be identical, 1.0 = anything matches
  })
  fuzzyMatch: string;

  // Contains: Candidate must contain the input
  @CoerceFromSet(() => PRODUCTS, { strategy: 'contains' })
  containsMatch: string;  // 'Wid' → 'Widget'

  // BeginsWith: Candidate must start with input
  @CoerceFromSet(() => PRODUCTS, { strategy: 'beginsWith' })
  prefixMatch: string;  // 'Gad' → 'Gadget'

  // EndsWith: Candidate must end with input
  @CoerceFromSet(() => PRODUCTS, { strategy: 'endsWith' })
  suffixMatch: string;  // 'key' → 'Doohickey'
}
```

**Synonyms / Aliases:**

```typescript
class NotificationPrefs {
  @CoerceFromSet(() => ['email', 'phone', 'sms'], {
    strategy: 'fuzzy',
    synonyms: {
      sms: ['text', 'text message', 'txt'],
      phone: ['call'],
    },
  })
  channel: string;
}
```

**Numeric Matching with Tolerance:**

```typescript
const STANDARD_SIZES = [100, 250, 500, 1000];

class Package {
  @CoerceFromSet(() => STANDARD_SIZES, {
    strategy: 'numeric',
    numericTolerance: 50,      // Accept within ±50
    numericRounding: 'nearest' // or 'up', 'down'
  })
  weight: number;
}

// Input: 120 → 100 (within tolerance)
// Input: 260 → 250
// Input: 175 → Error (ambiguous: 150 to 100 and 150 to 250)
```

**Selector-Based Matching for Complex Objects:**

```typescript
interface Product {
  id: string;
  sku: string;
  name: string;
}

const catalog: Product[] = [
  { id: '1', sku: 'WDG-001', name: 'Widget' },
  { id: '2', sku: 'GAD-002', name: 'Gadget' }
];

class OrderLine {
  // Match on the SKU field with fuzzy matching
  @CoerceFromSet(() => catalog, {
    selector: (p) => p.sku,
    strategy: 'fuzzy',
    threshold: 0.8
  })
  product: Product;
}

// Input: { product: 'WDG-01' }  (missing trailing digit)
// Output: { product: { id: '1', sku: 'WDG-001', name: 'Widget' } }
```

**Custom Distance Functions:**

```typescript
class AdvancedMatch {
  @CoerceFromSet(() => candidates, {
    strategy: 'custom',
    customCompare: (input: string, candidate: string) => {
      // Return 0 for exact match, higher numbers for worse matches
      if (input === candidate) return 0;
      if (candidate.includes(input)) return 1;
      return 999; // No match
    }
  })
  value: string;
}
```

**Ambiguity Handling:**

When multiple candidates match equally well, a `CoercionAmbiguityError` is thrown:

```typescript
const COLORS = ['red', 'green', 'blue'];

class Color {
  @CoerceFromSet(() => COLORS, { strategy: 'fuzzy', threshold: 0.5 })
  color: string;
}

// Input: 'gren'
// Fuzzy scores: 'green' = 0.8, 'red' = 0.25, 'blue' = 0.0
// → Output: 'green'

// Input: 'rd'
// Fuzzy scores: 'red' = 0.5, 'green' = 0.0, 'blue' = 0.0
// But with ambiguityTolerance (default 0.1), if two candidates are within 0.1 of each other → ambiguous
```

Tune `ambiguityTolerance` to control this:

```typescript
@CoerceFromSet(() => COLORS, {
  strategy: 'fuzzy',
  threshold: 0.5,
  ambiguityTolerance: 0.2  // Allow more ambiguity
})
color: string;
```

### 2.2 Matching Strategies for Key Lookups

`@MatchingStrategy` affects how property keys are matched when sourcing from input:

**Property-Level Strategy:**

```typescript
class APIResponse {
  // Case-insensitive key matching
  @MatchingStrategy('insensitive')
  @Copy()
  userId: string;
}

// Matches: { userId: ... }, { USERID: ... }, { UserId: ... }
```

**Class-Level Strategy:**

```typescript
@Keys()
@MatchingStrategy('insensitive')
class Config {
  @Copy() databaseUrl: string;
  @Copy() apiKey: string;
}

// All properties use case-insensitive matching
```

**Fuzzy Key Matching:**

```typescript
class TolerantParse {
  @MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
  @Copy()
  customerId: string;
}

// Matches 'customerId', 'custoemrId', 'customerid', etc.
```

**Interaction with JSONPath:**

Matching strategies currently apply to:
- Simple property lookups (`@Copy()`, `@DerivedFrom('propName')`)
- JSONPath leaf access (`$.propName`)
- Discriminator field detection

They do NOT yet apply to:
- Deep JSONPath paths (`$.path.to.deep.property`)
- Array index access (`$.items[0]`)

### 2.3 Nullish Coercion and the Cascade

The `coerceNullish` option controls how `null` and `undefined` are handled in `@CoerceType`. There's a three-level cascade:

**Cascade Levels:**

1. **Decorator-level** (highest priority):
   ```typescript
   @CoerceType('string', { coerceNullish: false })
   ```

2. **Class-level**:
   ```typescript
   @CoerceTypeDefaults({ coerceNullish: true })
   class User { ... }
   ```

3. **Factory-level** (lowest priority):
   ```typescript
   new ValidationFactory({
     decoratorDefaults: {
       CoerceType: { coerceNullish: true }
     }
   })
   ```

**Default Behavior by Type:**

When `coerceNullish: true` (the default):
- `'string'`: `null`/`undefined` → `''`
- `'number'`: `null`/`undefined` → `0`
- `'boolean'`: `null`/`undefined` → `false`
- `'date'`: `null`/`undefined` → **Error** (dates have no sensible nullish default)
- `'url'`, `'bigint'`, `'regexp'`: Throw error

**Interaction with `@ValidateRequired`:**

Order matters:

```typescript
class Example {
  // Required check BEFORE coercion → null/undefined fail immediately
  @ValidateRequired()
  @CoerceType('number', { coerceNullish: true })
  strictRequired: number;

  // Coercion BEFORE required check → null becomes 0, then 0 passes required
  @CoerceType('number', { coerceNullish: true })
  @ValidateRequired()
  lenientRequired: number;
}
```

### 2.4 Advanced Type Coercion

**URL Coercion with Base:**

```typescript
class LinkParser {
  @CoerceType('url', { base: 'https://example.com' })
  link: URL;
}

// Input: '/path/to/page' → new URL('https://example.com/path/to/page')
```

**Date Format Parsing:**

```typescript
class Event {
  // Strict ISO date-only
  @CoerceType('date', {
    format: 'iso-date',  // YYYY-MM-DD only
    timezone: 'utc'      // Interpret as UTC midnight
  })
  eventDate: Date;

  // ISO datetime
  @CoerceType('date', { format: 'iso-datetime' })  // Full ISO8601
  timestamp: Date;

  // Unix timestamp (seconds)
  @CoerceType('date', {
    format: 'timestamp',
    allowTimestamps: true
  })
  unixTime: Date;

  // Custom regex pattern
  @CoerceType('date', {
    format: /^\d{4}-\d{2}-\d{2}$/,  // Validate format first
    timezone: 'local'
  })
  customDate: Date;

  // Custom parser function
  @CoerceType('date', {
    parser: (val) => {
      // Your custom date parsing logic
      return new Date(val);
    }
  })
  flexDate: Date;
}
```

**Boolean Strictness:**

```typescript
class Flags {
  // Standard mode: accepts true/false, 1/0, "true"/"false", yes/no, on/off, etc.
  @CoerceType('boolean')
  relaxed: boolean;

  // Strict mode: only true/false, 1/0, "true"/"false", "1"/"0"
  @CoerceType('boolean', { strictness: 'strict' })
  strict: boolean;

  // Custom boolean mapping
  @CoerceType('boolean', {
    customMap: (val) => {
      if (val === 'active') return true;
      if (val === 'inactive') return false;
      return undefined;  // Let default logic handle it
    }
  })
  custom: boolean;
}
```

### 2.5 Parsing and Formatting Pipelines

**Parsing Structured Data:**

```typescript
class DataImport {
  // JSON parsing
  @CoerceParse('json', { allowNonString: true })
  jsonData: any;

  // YAML parsing (requires yaml parser)
  @CoerceParse('yaml')
  yamlConfig: any;

  // XML/HTML parsing (requires xml/html parser)
  @CoerceParse('html')
  htmlContent: Document;
}
```

**Locale-Aware Number and Currency Parsing:**

Parse formatted numbers and currency strings according to locale conventions:

```typescript
class InternationalPricing {
  // Parse German-formatted numbers (1.234,56 → 1234.56)
  @CoerceParse('number', { locale: 'de-DE' })
  germanAmount: number;

  // Parse US currency ($1,234.56 → 1234.56)
  @CoerceParse('currency', { locale: 'en-US' })
  usdPrice: number;

  // Parse European currency (€1.234,56 → 1234.56)
  @CoerceParse('currency', { locale: 'de-DE' })
  euroPrice: number;
}

// Input: {
//   germanAmount: '1.234,56',
//   usdPrice: '$1,234.56',
//   euroPrice: '€1.234,56'
// }
// Output: {
//   germanAmount: 1234.56,
//   usdPrice: 1234.56,
//   euroPrice: 1234.56
// }
```

**Currency Parsing Options:**

```typescript
class CurrencyParsing {
  // Parse with specific currency (default: USD)
  @CoerceParse('currency', {
    locale: 'en-US',
    currency: 'USD'
  })
  usdAmount: number;

  // Handle accounting notation (parentheses for negatives)
  @CoerceParse('currency', {
    locale: 'en-US',
    allowParentheses: true  // ($123) → -123
  })
  accountingAmount: number;
}
```

**Multi-Stage Transformation:**

```typescript
class DataProcessor {
  // Stage 1: Parse JSON
  // Stage 2: Validate structure
  // Stage 3: Transform
  // Stage 4: Re-serialize
  @CoerceParse('json', { allowNonString: true })
  @Validate((obj) => 'version' in obj, 'Must have version field')
  @Coerce((obj) => ({ ...obj, processed: true, processedAt: Date.now() }))
  @Coerce((obj) => JSON.stringify(obj))
  data: string;
}
```

**Parse → Transform → Format:**

```typescript
class LocalizedInvoice {
  // Parse US format, validate, format to German
  @CoerceParse('currency', { locale: 'en-US' })
  @ValidateRange(0, 999999)
  @CoerceFormat('number', {
    style: 'currency',
    currency: 'EUR',
    locale: 'de-DE'
  })
  convertedPrice: string;
}

// Input: { convertedPrice: '$1,234.56' }
// After parse: 1234.56
// After validate: 1234.56 (within range)
// After format: '1.234,56 €'
```

**Format Then Validate:**

```typescript
class FormattedData {
  // Coerce to date, format to ISO, then validate the format
  @CoerceFormat('date', 'iso-date')
  @ValidatePattern(/^\d{4}-\d{2}-\d{2}$/)
  isoDate: string;
}
```

#### Custom Parsers and Parser Registry

The `@CoerceParse` decorator uses a `ParserRegistry` that allows you to register custom parsers for any data format. This makes the parsing system fully extensible.

**Built-in Parsers:**
- `json` - Always available (native JSON.parse)
- `number` - Always available (locale-aware number parsing)
- `currency` - Always available (locale-aware currency parsing)

**Optional Parsers (Require Registration):**

Optional parsers avoid heavyweight dependencies for niche use cases. Register them only when needed:

```typescript
import {
  registerYAMLParser,
  registerXMLParser,
  registerHTMLParser
} from '@firebrandanalytics/shared-utils/validation';

// Register YAML parser (requires 'yaml' package)
registerYAMLParser();

// Register XML parser (requires '@xmldom/xmldom' package)
registerXMLParser();

// Register HTML parser (requires '@xmldom/xmldom' package)
registerHTMLParser();

class DataImport {
  @CoerceParse('yaml')
  config: any;

  @CoerceParse('xml')
  xmlDoc: Document;
}
```

**Registering Custom Parsers:**

You can register parsers for any format - TOML, CSV, Protocol Buffers, etc:

```typescript
import { ParserRegistry } from '@firebrandanalytics/shared-utils/validation';
import toml from '@iarna/toml';

// Register a TOML parser
ParserRegistry.register({
  name: 'toml',
  description: 'Parse TOML configuration files',
  parse: (input: string) => toml.parse(input)
});

class Config {
  @CoerceParse('toml')
  settings: any;
}
```

**Advanced: Parser with Options Support:**

For parsers that need configuration, access the options parameter:

```typescript
ParserRegistry.register({
  name: 'csv',
  description: 'Parse CSV with configurable delimiter',
  parse: (input: string, options?: any) => {
    const delimiter = options?.delimiter ?? ',';
    return input
      .split('\n')
      .map(row => row.split(delimiter).map(cell => cell.trim()));
  }
});

class DataFile {
  @CoerceParse('csv', { delimiter: ';' })
  data: string[][];
}
```

**Listing Available Parsers:**

```typescript
const available = ParserRegistry.list();
console.log(available); // ['json', 'number', 'currency', 'yaml', 'xml', ...]
```

**Why Use ParserRegistry?**

1. **Avoid Dependencies** - Optional parsers don't bloat your bundle
2. **Extensible** - Add support for any format without modifying the library
3. **Consistent API** - All parsers work the same way with `@CoerceParse`
4. **Clear Errors** - Helpful messages when a parser isn't registered
5. **Testable** - Register mock parsers in tests

**Best Practices:**

- Register parsers once at application startup
- Use lightweight parsers for common formats (JSON is built-in)
- Register heavyweight parsers (XML, YAML) only when needed
- Create custom parsers for domain-specific formats (proprietary protocols, binary data)
- Document parser requirements in your application's README

---

## 3. Context Decorators and Pipelines

### 3.1 Context Decorator Mechanics

Context decorators change the "execution context" for subsequent decorators in the stack:

**How Context Works:**

When you apply `@Keys()` or `@Values()`:
1. The decorator marks the start of a new context
2. All decorators that follow operate in that context
3. The context continues until the end of the decorator stack

**Example: Values Context**

```typescript
class Tags {
  @Values()     // ← Context switch: now operating on array elements
  @CoerceTrim()
  @CoerceCase('lower')
  tags: string[];
}

// Equivalent to:
tags.forEach(tag => tag.trim().toLowerCase())
```

**Disallowed Decorators in Contexts:**

Some decorators don't make sense in key/value contexts:

**In `@Values()` context, these are disallowed:**
- `@DerivedFrom` (derives entire property, not individual values)
- `@CollectProperties`
- `@Merge`
- `@Copy`
- `@DependsOn`

**In `@Keys()` context, additionally disallowed:**
- `@ValidatedClass`
- `@ValidatedClassArray`

**Attempting to use disallowed decorators throws an error at runtime.**

### 3.2 Recursive Context Decorators

`@RecursiveKeys()` and `@RecursiveValues()` traverse the entire data structure:

**Traversal Behavior:**

```typescript
class DeepNormalizer {
  @RecursiveValues()
  @CoerceTrim()
  data: any;
}

const input = {
  user: {
    name: '  John  ',
    details: {
      bio: '  Developer  ',
      tags: ['  js  ', '  ts  ']
    }
  }
};

// ALL string values at ALL levels are trimmed:
{
  user: {
    name: 'John',
    details: {
      bio: 'Developer',
      tags: ['js', 'ts']
    }
  }
}
```

**Performance Implications:**

Recursive decorators traverse the entire structure. For large, deeply nested objects:
- Can be slow
- Increases memory (deep cloning)
- Consider targeting specific paths with `@Values()` + `@UseStyle()` instead

**When to Use Recursive vs. Targeted:**

| Scenario | Use Recursive | Use Targeted |
|----------|---------------|--------------|
| Unknown/dynamic structure | ✓ | |
| Need blanket normalization | ✓ | |
| Known structure | | ✓ |
| Performance-critical | | ✓ |
| Type safety matters | | ✓ |

### 3.3 Protected Splitting for Code-Like Data

The `@Split` decorator understands nested structures:

**Heterogeneous Bracket Nesting:**

```typescript
class CodeParser {
  @Split(';', {
    quotes: ['"', "'"],
    brackets: ['()', '[]', '{}'],
    stripQuotes: true
  })
  statements: string[];
}

// Input: 'func("arg;1", { key: [1, 2] }); otherFunc()'
// Splits on ';' but ONLY at the top level:
// ['func("arg;1", { key: [1, 2] })', 'otherFunc()']
```

**The bracket parser handles:**
- Nested brackets of the same type: `[[[]]]`
- Nested brackets of different types: `{[()]}`
- Quotes inside brackets: `func("(test)")`
- Escape characters: `"escaped \" quote"`

**Edge Cases:**

```typescript
// Unmatched brackets → error
'func(]'  // Error: Unmatched closing bracket

// Escape character behavior
@Split(',', { escapeChar: '\\' })
'a\\,b,c'  // ['a,b', 'c']  (the comma after 'a' is escaped)
```

### 3.4 Advanced Context Composition

**Combining Contexts with Conditionals:**

```typescript
class ConditionalArrayProcessing {
  @Values()  // Apply to each element
  @If((item: any) => typeof item === 'string')
    @CoerceTrim()
    @CoerceCase('lower')
  @ElseIf((item: any) => typeof item === 'number')
    @CoerceRound({ precision: 2 })
  @EndIf()
  mixedArray: any[];
}
```

**Contexts with Styles:**

```typescript
class TrimStyle {
  @CoerceTrim()
  value: string;
}

class Collection {
  @Values()
  @UseStyle(TrimStyle)
  items: string[];
}
```

---

## 4. Conditionals: Nuances and Gotchas

### 4.1 Conditional Execution Model

**Decorator Placement Matters:**

Conditionals are evaluated bottom-to-top (like all decorators):

```typescript
class Order {
  @If('status', 'active')  // Evaluated first
    @CoerceType('date')
  @EndIf()               // Evaluated last
  @Copy()                // Evaluated before @If
  shippedDate: Date;
}

// Execution order:
// 1. @Copy() - populates shippedDate from input
// 2. @EndIf() - marker
// 3. @If() - checks status, applies @CoerceType if true
```

**Topic Consistency Rule:**

All branches of a conditional must check the same topic:

```typescript
class Valid {
  @If('status', 'active')
    @Set('Active Status')
  @ElseIf('status', 'pending')  // ✓ Same topic
    @Set('Pending Status')
  @EndIf()
  message: string;
}

class Invalid {
  @If('status', 'active')
    @Set('Active')
  @ElseIf('otherField', 'value')  // ✗ Different topic!
    @Set('Other')
  @EndIf()
  message: string;
}
```

This ensures the dependency graph stays static and analyzable.

### 4.2 Conditional Dependencies

**How Conditionals Create Dependencies:**

```typescript
class DependentConditional {
  @Copy()
  priority: string;

  @If('priority', 'high')  // Creates dependency: message depends on priority
    @Set('URGENT')
  @Else()
    @Set('Normal')
  @EndIf()
  message: string;
}

// Dependency: priority → message
// Execution order: priority first, then message
```

**Multiple Property Conditions:**

```typescript
class MultiCheck {
  @Copy() price: number;
  @Copy() quantity: number;

  @If(['price', 'quantity'], ([p, q]) => p * q > 1000)
    @Set('High Value')
  @EndIf()
  classification: string;
}

// Dependencies: price → classification, quantity → classification
```

### 4.3 Conditional Best Practices

**When to Use Conditionals:**

✓ **Good use cases:**
- Different validation rules based on a type/status field
- Applying expensive operations (AI) only when needed
- Optional fields that become required based on context

✗ **Better alternatives:**
- **Simple transformations**: Use `@DerivedFrom` with logic
  ```typescript
  @DerivedFrom('status', (s) => s === 'active' ? 'Active' : 'Inactive')
  ```

- **Complex multi-variant logic**: Use discriminated unions
  ```typescript
  @DiscriminatedUnion({ discriminator: 'type', map: {...} })
  ```

- **Always-applied rules**: Sequential decorators without conditionals

**Avoiding Over-Nesting:**

Since nested conditionals aren't allowed, complex logic needs refactoring:

```typescript
// ✗ Can't do this:
@If('type', 'A')
  @If('subtype', 'X')  // Nested!
    @Set('A-X')
  @EndIf()
@EndIf()

// ✓ Instead, combine conditions:
@If(['type', 'subtype'], ([t, s]) => t === 'A' && s === 'X')
  @Set('A-X')
@EndIf()
```

### 4.4 Conditionals with AI Transforms

**Cost Optimization:**

```typescript
class SmartDocument {
  @Copy()
  content: string;

  // Only call AI for long documents
  @If((content: string) => content.length > 1000)
    @AISummarize('short')
  @Else()
    @Copy()  // Just use the content as-is
  @EndIf()
  summary: string;
}
```

**Conditional AI with Validation Retry:**

```typescript
const VALID_SENTIMENTS = ['positive', 'neutral', 'negative'];

class Review {
  @Copy()
  rating: number;

  // Only use AI if rating is ambiguous (3 out of 5)
  @If('rating', 3)
    @AIClassify(VALID_SENTIMENTS)
  @ElseIf('rating', (r: number) => r >= 4)
    @Set('positive')
  @Else()
    @Set('negative')
  @EndIf()
  @CoerceFromSet(() => VALID_SENTIMENTS)  // Validate & auto-retry if AI fails
  sentiment: string;
}
```

---

## 5. AI Integration Advanced Patterns

### 5.1 AI Transform Lifecycle

**Understanding the Pipeline:**

```
Input → @AITransform → AI Handler → AI Output → Subsequent Decorators → Final Value
```

The AI output is re-processed through ALL subsequent coercions and validations:

```typescript
class Extract {
  @AITransform('Extract the quantity as a number')
  @CoerceType('number')      // AI output goes through this
  @ValidateRange(1, 100)     // And this
  quantity: number;
}
```

**Automatic Retry on Failure:**

If subsequent decorators fail, the AI transform automatically retries with the error as context:

```
Attempt 1:
  AI Output: "about 50"
  @CoerceType('number'): Fails

Attempt 2 (automatic):
  Prompt: [Original Prompt] + "Previous attempt failed: [error details]"
  AI Output: "50"
  @CoerceType('number'): Success → 50
```

**Configuring Retries:**

```typescript
class SmartExtract {
  @AITransform('Extract price', {
    maxRetries: 3  // Default is 2
  })
  @CoerceType('number')
  price: number;
}
```

**Dependencies in AI Transforms:**

When an AI prompt references other properties, declare dependencies:

```typescript
class Invoice {
  @Copy() currency: string;

  @DependsOn('currency')  // Explicit dependency
  @AITransform((params, ctx) =>
    `Format this amount in ${ctx.instance.currency}: ${params.value}`
  )
  formattedTotal: string;
}
```

### 5.2 AI Validation Patterns

**AI Validation vs. AI Transform:**

| Aspect | @AIValidate | @AITransform |
|--------|-------------|--------------|
| Purpose | Check validity | Transform value |
| Modifies value? | No | Yes |
| Return type | boolean/string/Error | Transformed value |
| Use case | Content moderation | Data extraction |

**Example: Content Moderation**

```typescript
class UserPost {
  @Copy() content: string;

  @AIValidate((params) =>
    `Is this content appropriate for a general audience? Answer "valid" or explain the issue: "${params.value}"`
  )
  @ValidateLength(10, 5000)
  moderatedContent: string;
}
```

### 5.3 AI Preset Decorators in Detail

The presets are thin wrappers that build stable prompts. Understanding when to use each:

**@AITranslate:**

Best for:
- Internationalizing content
- Maintaining tone and idioms across languages

```typescript
@AITranslate('French')  // 'Hello' → 'Bonjour' (not 'Salut' or 'Coucou')
```

**@AIRewrite:**

Best for:
- Adjusting tone for different audiences
- Shortening or expanding content

```typescript
@AIRewrite('formal')    // 'Hey!' → 'Good day.'
@AIRewrite('concise')   // Long text → Short text
```

**@AISummarize:**

Best for:
- Creating abstracts or headlines
- Reducing token counts for downstream processing

```typescript
@AISummarize('short')   // Article → One-sentence summary
```

**@AIClassify:**

Best for:
- Routing (support tickets, emails)
- Sentiment analysis
- Topic detection

```typescript
@AIClassify(['bug', 'feature', 'question'])
```

**@AIExtract:**

Best for:
- Pulling structured data from unstructured text
- Form filling from natural language

```typescript
@AIExtract(['name', 'email', 'phone'])
```

**@AISpellCheck:**

Best for:
- User-generated content
- OCR post-processing

```typescript
@AISpellCheck()  // 'Teh prodcut' → 'The product'
```

**@AIJSONRepair:**

Best for:
- Fixing LLM-generated JSON
- Handling truncated API responses

```typescript
@AIJSONRepair()  // '{name:"John",}' → '{"name":"John"}'
```

### 5.4 Error Recovery with @Catch and @AICatchRepair

**The Catch Mechanism:**

`@Catch` intercepts errors on a property and gives you a chance to recover:

```typescript
class Resilient {
  @Catch((error, value, instance) => {
    console.log('Error:', error.message);
    console.log('Failed value:', value);
    return 'fallback-value';  // Recovery
  })
  @CoerceType('number')
  robustField: number;
}

// Input: { robustField: 'not-a-number' }
// @CoerceType fails
// @Catch handler returns 'fallback-value'
// Output: { robustField: 'fallback-value' }
```

**When to Use @Catch:**

✓ **Good use cases:**
- Known flaky data sources where fallbacks are acceptable
- Graceful degradation (return partial data instead of failing entirely)
- Logging errors while providing defaults

✗ **Anti-patterns:**
- Masking bugs in your own validation logic
- Over-using to avoid fixing upstream data quality issues
- Catching errors on critical fields where failures should bubble up

**@AICatchRepair:**

Automatically uses AI to repair failed values:

```typescript
class AutoRepair {
  @AICatchRepair()
  @CoerceParse('json')
  @Validate((obj) => 'id' in obj && 'name' in obj, 'Must have id and name')
  data: any;
}

// Input: { data: '{id:123,name:"Test",}' }  // Malformed JSON
// @CoerceParse fails
// @AICatchRepair sends to AI: "Repair this to valid JSON: {id:123,name:\"Test\",}"
// AI returns: {"id":123,"name":"Test"}
// @CoerceParse succeeds
// @Validate succeeds
```

**Custom Repair Prompts:**

```typescript
@AICatchRepair('Fix this date string to ISO 8601 format')
@CoerceType('date')
customDate: Date;
```

**Scope Control:**

Attach `@Catch` to specific properties, not entire classes, to limit the blast radius:

```typescript
class MixedResilience {
  @Catch(() => 'default-id')
  @Copy()
  optionalId: string;  // Failures are caught

  @Copy()
  criticalId: string;  // Failures bubble up
}
```

### 5.5 AI Handler Implementation Strategies

**Production-Ready Handler:**

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // 1. Rate limiting
    await rateLimiter.acquire();

    try {
      // 2. Call LLM with retries
      const response = await retryWithBackoff(
        () => llm.complete(prompt, {
          temperature: 0.1,  // Low temperature for consistency
          maxTokens: 500
        }),
        { maxRetries: 3, initialDelay: 1000 }
      );

      // 3. Log for debugging
      logger.debug('AI call', {
        property: params.propertyKey,
        attempt: params.attemptNumber,
        inputLength: String(params.value).length,
        outputLength: response.length
      });

      return response;

    } catch (error) {
      // 4. Graceful error handling
      if (error.code === 'RATE_LIMIT') {
        throw new Error('Rate limit exceeded, try again later');
      }
      throw error;
    }
  }
});
```

**Caching AI Responses:**

```typescript
const cache = new Map<string, string>();

const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    const cacheKey = `${params.className}.${params.propertyKey}:${params.value}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const result = await llm.complete(prompt);
    cache.set(cacheKey, result);
    return result;
  }
});
```

**Multiple AI Providers:**

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // Route by metadata or property
    const useExpensive = params.metadata?.useGPT4 ?? false;

    if (useExpensive) {
      return await gpt4.complete(prompt);
    } else {
      return await cheaperModel.complete(prompt);
    }
  }
});

class Expensive {
  @AITransform('Complex task', { metadata: { useGPT4: true } })
  result: string;
}
```

---

## 6. Advanced Patterns and Architectures

### 6.1 Discriminated Unions Deep Dive

**Inheritance and Discriminated Unions:**

When using `@DiscriminatedUnion` with inheritance, common fields are inherited:

```typescript
@DiscriminatedUnion({
  discriminator: 'eventType',
  map: {
    'click': ClickEvent,
    'scroll': ScrollEvent
  }
})
class BaseEvent {
  @Copy() eventType: string;
  @Copy() timestamp: number;
  @Copy() userId: string;
}

class ClickEvent extends BaseEvent {
  @Copy() elementId: string;
  @Copy() coordinates: { x: number; y: number };
}

// Result instance has all base properties + event-specific ones
```

**Matching Strategies for Discriminators:**

Apply matching strategies to make discriminator detection more tolerant:

```typescript
@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.8 })
@DiscriminatedUnion({
  discriminator: 'type',
  map: {
    'customer_order': CustomerOrder,
    'vendor_order': VendorOrder
  }
})
class Order {
  @Copy() type: string;
}

// Input: { type: 'cusotmer_order' } → matches 'customer_order'
```

**Edge Cases:**

```typescript
// Missing discriminator → Error
{ /* no 'type' field */ }  // Error: Discriminator 'type' not found

// Unknown discriminator value → Error
{ type: 'unknown_type' }  // Error: No class mapped for 'unknown_type'

// Ambiguous match (with fuzzy matching) → Error
{ type: 'ord' }  // Ambiguous: could be 'customer_order' or 'vendor_order'
```

### 6.2 Complex Derived Fields

**Multi-Source Derivations:**

```typescript
class ComplexCalculation {
  @Copy() basePrice: number;
  @Copy() taxRate: number;
  @Copy() discountPercent: number;

  @DerivedFrom(['basePrice', 'taxRate', 'discountPercent'], ([base, tax, disc]) => {
    const discounted = base * (1 - disc / 100);
    return discounted * (1 + tax / 100);
  })
  finalPrice: number;
}
```

**Fallback Paths with Priority:**

```typescript
class FlexibleSource {
  // Try multiple JSONPath expressions, use first non-undefined
  @DerivedFrom([
    '$.preferred.value',
    '$.fallback.value',
    '$.default'
  ])
  value: any;
}
```

**Accessing Raw Data vs. Instance:**

```typescript
class SmartDerivation {
  @Copy() processedValue: number;

  @DerivedFrom('processedValue', (processed, ctx) => {
    // ctx.instance - the partially-built validated instance
    // ctx.raw - the original input data

    const rawValue = ctx.raw?.originalValue ?? 0;
    const fallback = ctx.raw?.fallbackValue ?? 100;

    return processed > 0 ? processed : (rawValue || fallback);
  })
  finalValue: number;
}
```

**Circular Derivations with Convergent Engine:**

```typescript
class Currency {
  @DerivedFrom('euros', (e) => e * 1.1)
  dollars: number;

  @DerivedFrom('dollars', (d) => d / 1.1)
  euros: number;
}

// Whichever is provided in input becomes the source
// The other is derived and stabilizes after convergence
```

### 6.3 Collection Decorators: @CollectProperties and @Merge

**@CollectProperties with Multiple Sources:**

```typescript
class ComplexCollection {
  @Copy() id: string;
  @Copy() name: string;

  @CollectProperties({
    sources: [
      { path: '$.metadata', exclude: ['id'] },
      { path: '$.tags' },
      { path: '$.custom' }
    ],
    transformFn: (collected) => {
      // Post-process the collected data
      return { ...collected, collectedAt: Date.now() };
    }
  })
  metadata: Record<string, any>;
}
```

**@Merge Strategies:**

```typescript
class MergeExample {
  @Copy() primaryData: { a: number; b: string };
  @Copy() secondaryData: { b: string; c: boolean };

  // Default merge for objects: Object.assign
  @Merge({ sources: ['primaryData', 'secondaryData'] })
  combined: any;  // { a: number, b: string (from secondary), c: boolean }

  @Copy() list1: string[];
  @Copy() list2: string[];

  // Default merge for arrays: concat
  @Merge({ sources: ['list1', 'list2'] })
  allItems: string[];

  // Custom merge logic
  @Merge({
    sources: ['list1', 'list2'],
    mergeFunction: (arrays) => {
      // Deduplicate and sort
      const combined = arrays.flat();
      return [...new Set(combined)].sort();
    }
  })
  uniqueSortedItems: string[];
}
```

### 6.4 Cross-Property Validation

**@CrossValidate for Multi-Field Rules:**

```typescript
class DateRange {
  @CoerceType('date') startDate: Date;
  @CoerceType('date') endDate: Date;

  @CrossValidate(['startDate'], (obj) => {
    if (obj.endDate < obj.startDate) {
      return 'End date must be after start date';
    }
    return true;
  })
  @Set(true)  // Just a placeholder value
  _validation: boolean;
}
```

**@ObjectRule for Entire Instance:**

```typescript
@ObjectRule(function(this: Order) {
  if (this.shippingMethod === 'express' && this.total < 50) {
    return 'Express shipping requires minimum $50 order';
  }
  return true;
})
class Order {
  @Copy() total: number;
  @Copy() shippingMethod: string;
}
```

**Execution Order:**

1. All property coercions and validations
2. `@CrossValidate` decorators
3. `@ObjectRule` decorators

This ensures all individual properties are valid before cross-validation runs.

### 6.5 Recursive Data Structures

Self-referential types (trees, linked lists, graphs) require special handling since a class references itself:

**Tree Structures:**

```typescript
class TreeNode {
  @Copy() value: string;

  @ValidatedClass(TreeNode)  // Self-reference
  left?: TreeNode;

  @ValidatedClass(TreeNode)
  right?: TreeNode;
}

const tree = await factory.create(TreeNode, {
  value: 'root',
  left: {
    value: 'left-child',
    left: { value: 'left-left-grandchild' }
  },
  right: {
    value: 'right-child'
  }
});

// Full tree is validated recursively
```

**How It Works:**

The validation engine detects the recursive reference and handles it correctly:
1. Creates instance of TreeNode for root
2. For each `left`/`right` property with `@ValidatedClass(TreeNode)`, recursively validates nested data
3. Each level is fully validated before returning

**Circular References:**

Circular references (A references B, B references A) work but require care:

```typescript
class Person {
  @Copy() name: string;

  @ValidatedClass(Person)
  manager?: Person;

  @ValidatedClassArray(Person)
  directReports?: Person[];
}

// This works:
const ceo = await factory.create(Person, {
  name: 'CEO',
  directReports: [
    { name: 'VP1', directReports: [...] },
    { name: 'VP2', directReports: [...] }
  ]
});
```

**Limitations:**

1. **Circular object references in input data are not supported:**
   ```typescript
   // ✗ This will cause infinite recursion
   const data = { name: 'A' };
   data.manager = data;  // Circular reference
   await factory.create(Person, data);  // Error!
   ```

2. **Performance:** Deep structures can be slow due to recursive validation

3. **Stack depth:** Very deep nesting (>1000 levels) may cause stack overflow

**Linked Lists:**

```typescript
class ListNode {
  @Copy() value: number;

  @ValidatedClass(ListNode)
  next?: ListNode;
}

const head = await factory.create(ListNode, {
  value: 1,
  next: {
    value: 2,
    next: {
      value: 3,
      next: null
    }
  }
});
```

**Graph-Like Structures:**

For structures with multiple paths to the same node (DAGs), flatten the structure to avoid duplication:

```typescript
// ✗ Duplicates validation of shared nodes
class GraphNode {
  @Copy() id: string;
  @ValidatedClassArray(GraphNode) children: GraphNode[];
}

// ✓ Better: Use references by ID
class GraphNodeRef {
  @Copy() id: string;
  @Copy() childIds: string[];
}

class Graph {
  @ValidatedClassArray(GraphNodeRef) nodes: GraphNodeRef[];

  // Resolve references after validation
  getNode(id: string) {
    return this.nodes.find(n => n.id === id);
  }
}
```

### 6.6 Styles and the Cascade System

**The Complete Cascade:**

```typescript
// 1. Factory-level defaults
const factory = new ValidationFactory({
  defaultTransforms: {
    string: GlobalTrimStyle
  }
});

// 2. Class-level defaults
@DefaultTransforms({
  string: ClassTrimLowerStyle  // Overrides factory default
})
class User {
  // 3. Property-level: inherits class default
  @Copy()
  username: string;  // Uses ClassTrimLowerStyle

  // 4. Property-level: explicit override
  @CoerceTrim()
  @CoerceCase('upper')  // Overrides all defaults
  displayName: string;
}
```

**Building Style Libraries:**

```typescript
// styles/common.ts
export class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

export class PhoneStyle {
  @CoerceTrim()
  @Coerce((v) => v.replace(/\D/g, ''))
  @ValidateLength(10, 15)
  value: string;
}

export class UrlStyle {
  @CoerceTrim()
  @CoerceType('url')
  @Validate((url) => ['http:', 'https:'].includes(url.protocol))
  value: URL;
}

// Usage across your application
import { EmailStyle, PhoneStyle } from './styles/common';

class Contact {
  @UseStyle(EmailStyle) email: string;
  @UseStyle(PhoneStyle) phone: string;
}
```

### 6.7 Inheritance Cascade Mechanics

Understanding how decorators flow through inheritance hierarchies is crucial for building maintainable class hierarchies.

**The Complete Cascade with Inheritance:**

The decorator resolution follows this priority order:
1. Factory-level defaults
2. Parent class `@DefaultTransforms`
3. Child class `@DefaultTransforms`
4. Parent property decorators
5. Child property decorators (highest priority)

**How Parent Decorators Are Inherited:**

When a child class extends a parent, the validation engine builds the decorator chain by walking up the prototype chain:

```typescript
class GrandParent {
  @CoerceTrim()
  value: string;
}

class Parent extends GrandParent {
  @CoerceCase('lower')
  value: string;
}

class Child extends Parent {
  @ValidateLength(3, 50)
  value: string;
}

// Effective decorator chain for Child.value:
// 1. @CoerceTrim (from GrandParent)
// 2. @CoerceCase('lower') (from Parent)
// 3. @ValidateLength(3, 50) (from Child)
```

**Property Override Behavior:**

When a child class redeclares a property, it gets a new decorator stack but parent decorators are still inherited:

```typescript
class Base {
  @CoerceTrim()
  @CoerceCase('lower')
  email: string;
}

class Extended extends Base {
  // Redeclaring the property adds to the decorator stack
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  email: string;
}

// Decorator execution order for Extended.email:
// 1. @CoerceTrim (from Base)
// 2. @CoerceCase('lower') (from Base)
// 3. @ValidatePattern(...) (from Extended)
```

**Complete Replacement (Advanced Pattern):**

To completely replace parent decorators rather than extending them, you need to know about metadata clearing (not commonly needed):

```typescript
// Most of the time, you just add to the stack
class Child extends Parent {
  @MyDecorator()  // Adds to parent's decorators
  value: string;
}

// To truly replace, you'd need to clear metadata first
// This is an advanced pattern and rarely needed in practice
```

**Class-Level Decorator Inheritance:**

```typescript
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class BaseEntity {
  id: string;  // Gets TrimStyle + auto-managed
}

@DefaultTransforms({ string: TrimUpperStyle })  // Overrides parent
class SpecialEntity extends BaseEntity {
  id: string;  // Gets TrimUpperStyle (child wins)
  name: string;  // Gets TrimUpperStyle + auto-managed (inherited @ManageAll)
}
```

**Interaction with `@UseStyle`:**

`@UseStyle` applies its decorators at the point it appears in the chain:

```typescript
class Base {
  @CoerceTrim()
  value: string;
}

class Child extends Base {
  @UseStyle(UppercaseStyle)  // UppercaseStyle's decorators inserted here
  @ValidateLength(5, 20)
  value: string;
}

// Execution:
// 1. @CoerceTrim (from Base)
// 2. UppercaseStyle decorators (from @UseStyle in Child)
// 3. @ValidateLength (from Child)
```

**Practical Implications:**

1. **Base classes should contain the most fundamental transformations:**
   ```typescript
   class BaseUser {
     @CoerceTrim()  // Always trim first
     email: string;
   }

   class User extends BaseUser {
     @CoerceCase('lower')  // Then lowercase
     @ValidatePattern(...)  // Finally validate
     email: string;
   }
   ```

2. **Child classes add specificity:**
   ```typescript
   class Entity {
     @Copy() id: string;  // All entities have IDs
   }

   class User extends Entity {
     @ValidatePattern(/^USR-/)  // Users have specific ID format
     id: string;
   }
   ```

3. **Use class-level decorators for broad defaults:**
   ```typescript
   @ManageAll()
   @DefaultTransforms({ string: TrimStyle })
   class Base {
     // All properties auto-managed and trimmed
   }
   ```

**Debugging Inheritance Chains:**

When debugging, remember decorators execute bottom-to-top in code but parent-to-child in inheritance:

```typescript
class A {
  @D1() value: string;  // Executes 3rd
}
class B extends A {
  @D2() value: string;  // Executes 2nd
}
class C extends B {
  @D3() value: string;  // Executes 1st
}

// Reading order: D1, D2, D3
// Execution order: D3, D2, D1 (bottom-to-top within class), then up the chain
// Actual execution: D1 (A), D2 (B), D3 (C) ← parent to child
```

---

## 7. Performance and Optimization

### 7.1 Validation Performance

**Performance Characteristics:**

| Decorator Type | Relative Cost | Notes |
|----------------|---------------|-------|
| `@Copy()` | Very Low | Direct property access |
| `@CoerceTrim()`, `@CoerceCase()` | Low | String operations |
| `@CoerceType()` | Low-Medium | Type conversion |
| `@Validate()` | Low-Medium | Depends on validator complexity |
| `@DerivedFrom()` (simple) | Medium | JSONPath + function call |
| `@DerivedFrom()` (complex) | Medium-High | Complex derivation logic |
| `@CoerceFromSet()` (exact) | Medium | O(n) search |
| `@CoerceFromSet()` (fuzzy) | High | O(n × m) string comparison |
| `@AITransform()` | Very High | Network I/O + LLM latency |
| `@RecursiveValues()` | High | Deep traversal + cloning |

**Optimization Strategies:**

```typescript
// ✗ Expensive: Fuzzy matching on large sets
@CoerceFromSet(() => largeArray, { strategy: 'fuzzy' })

// ✓ Better: Exact matching when possible
@CoerceFromSet(() => largeArray, { strategy: 'exact', caseSensitive: false })

// ✗ Expensive: AI for every item
@Values()
@AITransform('Classify')
items: string[];

// ✓ Better: Conditional AI only when needed
@Values()
@If((item: string) => item.length > 100)
  @AITransform('Classify')
@Else()
  @Set('short')
@EndIf()
items: string[];
```

**Profiling Example:**

```typescript
const factory = new ValidationFactory();

const start = performance.now();
const result = await factory.create(LargeClass, data);
const duration = performance.now() - start;

console.log(`Validation took ${duration}ms`);
```

### 7.2 Memory Considerations

**Deep Cloning in Convergent Engine:**

The convergent engine clones instance state at each iteration:

```typescript
// Each iteration clones the entire instance
for (let i = 0; i < maxIterations; i++) {
  const stateBeforeIteration = cloneDeep(instance);
  // ... process properties ...
}
```

For large objects, this can be expensive. Consider:
- Using `@UseSinglePassValidation()` if possible
- Reducing `maxIterations`
- Breaking large classes into smaller pieces

**Large Payload Handling:**

```typescript
class LargeDataset {
  // ✗ Recursive processing of huge nested structure
  @RecursiveValues()
  @CoerceTrim()
  data: any;  // Can exhaust memory

  // ✓ Target specific paths
  @Values()
  @CoerceTrim()
  items: string[];
}
```

### 7.3 When to Avoid Convergence

**Classes That Don't Need Convergence:**

```typescript
// Simple linear dependency chain
@UseSinglePassValidation()
class SimpleCalculation {
  @Copy() a: number;
  @DerivedFrom('a', (v) => v * 2) b: number;
  @DerivedFrom('b', (v) => v + 10) c: number;
}

// Performance gain: ~30-40% faster than convergent
```

**Conversion Strategy:**

1. Analyze dependencies: Are they acyclic?
2. Add `@UseSinglePassValidation()`
3. Test thoroughly (single-pass is less forgiving)
4. Measure performance improvement

---

## 8. Debugging and Troubleshooting

### 8.1 Understanding Validation Errors

**ValidationError Anatomy:**

```typescript
try {
  await factory.create(User, data);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log({
      message: error.message,        // Human-readable error
      propertyPath: error.propertyPath,  // 'email' or 'address.street'
      rule: error.rule,              // 'ValidatePattern' or decorator name
      actualValue: error.actualValue,    // The value that failed
      examples: error.examples,      // From @Examples decorator
      examplesDescription: error.examplesDescription
    });
  }
}
```

**Nested Property Paths:**

```typescript
class Address {
  @ValidateRequired() street: string;
}

class User {
  @ValidatedClass(Address) address: Address;
}

// Error: propertyPath = 'address.street'
```

**Using `@Examples` for Better Errors:**

```typescript
class Order {
  @Examples(['ORD-001', 'ORD-002', 'ORD-003'], 'Order ID format')
  @ValidatePattern(/^ORD-\d{3}$/)
  orderId: string;
}

// Error message includes:
// "Validation failed for orderId: must match pattern /^ORD-\d{3}$/
//  Examples: ORD-001, ORD-002, ORD-003 (Order ID format)"
```

### 8.2 Debugging Convergence Issues

**ConvergenceTimeoutError:**

Thrown when the engine doesn't stabilize within `maxIterations`:

```typescript
// Error: Convergence timeout after 10 iterations
// Properties still changing: ['price', 'total', 'tax']
```

**Diagnosis Steps:**

1. Check for unintentional circular dependencies
2. Review derivation logic (is it deterministic?)
3. Increase `maxIterations` temporarily to see if it eventually converges
4. Add logging to see how values change:

```typescript
@DerivedFrom('quantity', (qty) => {
  const result = complexCalculation(qty);
  console.log(`Price calculation: qty=${qty} → price=${result}`);
  return result;
})
price: number;
```

**OscillationError:**

Thrown when properties alternate between values:

```typescript
// Error: Oscillation detected
// Properties oscillating: a, b
// Values: a: [true, false, true], b: [false, true, false]
```

**Common Causes:**

```typescript
// ✗ Mutual negation
@DerivedFrom('b', (v) => !v) a: boolean;
@DerivedFrom('a', (v) => !v) b: boolean;

// ✗ Unstable randomness
@DerivedFrom('input', (v) => v + Math.random()) output: number;

// ✓ Fix: Make logic deterministic
@DerivedFrom('input', (v) => v * 1.1) output: number;
```

### 8.3 Debugging AI Integration

**AI Handler Failures:**

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    try {
      return await llm.complete(prompt);
    } catch (error) {
      console.error('AI Handler Error:', {
        property: params.propertyKey,
        attempt: params.attemptNumber,
        error: error.message,
        prompt: prompt.slice(0, 200)  // Log prompt start
      });
      throw error;
    }
  }
});
```

**Retry Exhaustion:**

When AI retries are exhausted, the last error is thrown:

```typescript
// After maxRetries attempts, throws:
// "AI transform failed after 3 attempts: [last error message]"
```

**Improving AI Reliability:**

```typescript
class Reliable {
  @Examples(['5', '10', '15'], 'Valid quantities')
  @AITransform('Extract quantity as a number')
  @CoerceType('number')
  @ValidateRange(1, 100)
  quantity: number;
}

// The @Examples help the AI understand expected format
// The retry mechanism uses examples in the retry prompt
```

### 8.4 Common Pitfalls and Solutions

**Pitfall 1: Decorator Ordering**

```typescript
// ✗ Wrong: Validation before coercion
@ValidateRange(0, 100)
@CoerceType('number')
value: number;

// ✓ Correct: Coercion before validation
@CoerceType('number')
@ValidateRange(0, 100)
value: number;
```

**Pitfall 2: Forgetting @Copy or @ManageAll**

```typescript
// ✗ Fields without decorators are ignored
class User {
  username: string;  // NOT processed!
  email: string;     // NOT processed!
}

// ✓ Add @Copy or use @ManageAll
@ManageAll()
class User {
  username: string;  // Now processed
  email: string;     // Now processed
}
```

**Pitfall 3: Misunderstanding Nullish Coercion:**

```typescript
// ✗ Unexpected: null becomes 0
@CoerceType('number', { coerceNullish: true })  // Default
value: number;

// Input: { value: null }
// Output: { value: 0 }  // Surprise!

// ✓ Explicit handling
@ValidateRequired()  // Fail on null
@CoerceType('number')
value: number;
```

**Pitfall 4: JSONPath vs. Property Reference Confusion:**

```typescript
class Config {
  @Copy() mode: string;

  // Property reference - creates dependency
  @If('mode', 'production')
    @Set('strict')
  @EndIf()
  policy: string;

  // JSONPath - no dependency
  @If('$.environment.mode', 'production')
    @Set('strict')
  @EndIf()
  otherPolicy: string;
}
```

**Pitfall 5: Over-using @Catch:**

```typescript
// ✗ Masks all errors, hides bugs
class BadPractice {
  @Catch(() => 'default')
  @Copy()
  criticalField: string;  // Failures silently become 'default'
}

// ✓ Let critical fields fail
class GoodPractice {
  @Copy()
  criticalField: string;  // Failures bubble up

  @Catch(() => 'fallback')
  @Copy()
  optionalField: string;  // OK to provide fallback
}
```

---

## 9. Advanced Testing Strategies

### 9.1 Unit Testing Validated Classes

**Testing Individual Decorators:**

```typescript
describe('User validation', () => {
  it('should trim and lowercase email', async () => {
    const factory = new ValidationFactory();
    const user = await factory.create(User, {
      email: '  JOHN@EXAMPLE.COM  '
    });

    expect(user.email).toBe('john@example.com');
  });

  it('should reject invalid email format', async () => {
    const factory = new ValidationFactory();

    await expect(
      factory.create(User, { email: 'not-an-email' })
    ).rejects.toThrow(ValidationError);
  });
});
```

**Mocking AI Handlers:**

```typescript
describe('AI-powered extraction', () => {
  it('should extract quantity from text', async () => {
    const mockAI = vi.fn().mockResolvedValue('42');

    const factory = new ValidationFactory({
      aiHandler: mockAI
    });

    const order = await factory.create(Order, {
      quantityText: 'I need about forty-two items'
    });

    expect(order.quantity).toBe(42);
    expect(mockAI).toHaveBeenCalledOnce();
  });

  it('should retry AI on validation failure', async () => {
    const mockAI = vi.fn()
      .mockResolvedValueOnce('invalid')  // First attempt fails
      .mockResolvedValueOnce('42');      // Retry succeeds

    const factory = new ValidationFactory({
      aiHandler: mockAI
    });

    const order = await factory.create(Order, { quantityText: 'text' });

    expect(order.quantity).toBe(42);
    expect(mockAI).toHaveBeenCalledTimes(2);
  });
});
```

**Testing Convergence Behavior:**

```typescript
describe('Convergent calculations', () => {
  it('should converge after multiple iterations', async () => {
    const factory = new ValidationFactory();

    const result = await factory.create(PricingCalculation, {
      quantity: 150,
      basePrice: 10
    });

    // Bulk discount applied via convergence
    expect(result.unitPrice).toBe(8);
    expect(result.total).toBe(1200);
  });
});
```

**Property Isolation Testing:**

```typescript
// Test just one property's decorators
class IsolatedTest {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateLength(3, 50)
  value: string;
}

describe('Name validation', () => {
  it('should process correctly', async () => {
    const factory = new ValidationFactory();
    const result = await factory.create(IsolatedTest, {
      value: '  JOHN DOE  '
    });

    expect(result.value).toBe('john doe');
  });
});
```

### 9.2 Integration Testing

**Testing with Real AI Providers:**

```typescript
describe('AI Integration (slow)', () => {
  it('should extract data from real LLM', async () => {
    const factory = new ValidationFactory({
      aiHandler: async (params, prompt) => {
        return await openai.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'gpt-4'
        });
      }
    });

    const result = await factory.create(SmartExtractor, data);
    expect(result.extractedField).toBeDefined();
  }, 10000);  // Longer timeout for AI calls
});
```

**Context-Dependent Validation Testing:**

```typescript
describe('Context validation', () => {
  it('should validate against runtime context', async () => {
    const context = {
      availableProducts: ['Widget', 'Gadget']
    };

    const factory = new ValidationFactory();
    const order = await factory.create(Order, {
      product: 'Widget'
    }, { context });

    expect(order.product).toBe('Widget');
  });

  it('should reject invalid context values', async () => {
    const context = {
      availableProducts: ['Widget']
    };

    await expect(
      factory.create(Order, { product: 'InvalidProduct' }, { context })
    ).rejects.toThrow();
  });
});
```

---

## 10. Migration and Upgrade Patterns

### 10.1 Migrating from Simple Validation

**Incremental Adoption:**

```typescript
// Stage 1: Start with just coercion
class User {
  @CoerceType('string')
  @CoerceTrim()
  username: string;

  // Existing validation logic (unchanged)
  validateEmail() { /* ... */ }
}

// Stage 2: Add validation decorators
class User {
  @CoerceType('string')
  @CoerceTrim()
  @ValidateLength(3, 50)
  username: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+$/)
  email: string;
}

// Stage 3: Add styles for reusability
class User {
  @UseStyle(UsernameStyle)
  username: string;

  @UseStyle(EmailStyle)
  email: string;
}
```

### 10.2 Creating Reusable Validation Libraries

**Library Structure:**

```typescript
// validation-lib/styles/index.ts
export { EmailStyle } from './EmailStyle';
export { PhoneStyle } from './PhoneStyle';
export { UrlStyle } from './UrlStyle';

// validation-lib/presets/index.ts
export { createStrictFactory } from './strict-factory';
export { createLenientFactory } from './lenient-factory';

// validation-lib/index.ts
export * from './styles';
export * from './presets';
```

**Versioned Schemas:**

```typescript
// v1/User.ts
export class UserV1 {
  @Copy() username: string;
  @Copy() email: string;
}

// v2/User.ts
export class UserV2 {
  @Copy() username: string;
  @Copy() email: string;
  @Copy() displayName: string;  // Added in v2
}

// Migration
export async function migrateUser(data: any): Promise<UserV2> {
  const factory = new ValidationFactory();

  if (data.version === 1) {
    const v1 = await factory.create(UserV1, data);
    return factory.create(UserV2, {
      ...v1,
      displayName: v1.username  // Default
    });
  }

  return factory.create(UserV2, data);
}
```

---

## 11. Edge Cases and Limitations

### 11.1 Known Limitations

**1. Conditional Nesting Not Supported:**

```typescript
// ✗ Cannot nest conditionals
@If('type', 'A')
  @If('subtype', 'X')
    @Set('value')
  @EndIf()
@EndIf()

// ✓ Workaround: Combine conditions
@If(['type', 'subtype'], ([t, s]) => t === 'A' && s === 'X')
  @Set('value')
@EndIf()
```

**2. JSONPath Limitations:**

- Matching strategies don't apply to deep paths
- Cannot modify JSONPath behavior
- Always references original input

**3. Recursive Decorator Depth:**

Very deeply nested structures (>50 levels) may cause:
- Stack overflow
- Performance degradation
- Memory issues

**4. TypeScript Reflection Limitations:**

- Cannot infer types at runtime
- Decorators work with any type but TypeScript types are compile-time only
- Use explicit type validation when runtime types differ from TypeScript types

### 11.2 Workarounds and Alternatives

**For Complex Nested Conditionals:**

Use separate classes with discriminated unions:

```typescript
// Instead of nested @If
@DiscriminatedUnion({
  discriminator: 'type',
  map: {
    'A-X': TypeAX,
    'A-Y': TypeAY,
    'B-X': TypeBX
  }
})
class MultiVariant { ... }
```

**For Deep Nesting:**

Break into smaller validated classes:

```typescript
// Instead of @RecursiveValues on entire structure
class Level3 {
  @Values() @CoerceTrim() values: string[];
}

class Level2 {
  @ValidatedClass(Level3) data: Level3;
}

class Level1 {
  @ValidatedClass(Level2) nested: Level2;
}
```

---

## Conclusion

This advanced guide has covered the deep mechanics, nuances, and edge cases of the validation library. You should now understand:

- How the convergent and single-pass engines work internally
- Advanced coercion strategies and when to use each
- Complex patterns like discriminated unions and recursive decorators
- How to debug convergence issues and optimize performance
- Best practices for AI integration and error recovery
- Testing strategies and migration patterns

For day-to-day usage, refer back to the [Intermediate Guide](./validation-library-intermediate.md) for practical patterns and the [Reference Guide](./validation-library-reference.md) for API details.
