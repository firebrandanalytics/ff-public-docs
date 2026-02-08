# Intermediate Guide: Reshaping and Scaling Your Validations

## Introduction: Beyond Single Values

Welcome back! In the [Getting Started Guide](./validation-library-getting-started.md), you mastered the art of transforming and validating individual data fields. You learned how to turn messy inputs like `{ "quantity": "five" }` into clean, trusted class instances.

But real-world data is rarely that simple. Often, the challenge isn't just a dirty value; it's the entire *structure* of the data. You might face challenges like:

*   Data is nested in an awkward structure that doesn't match your clean domain classes.
*   You need to apply a transformation not to a property, but to every *key* or *value* within an object.
*   A single string field contains a complex, code-like list of values that needs careful parsing.
*   You find yourself repeating the same `@UseStyle` decorator across dozens of properties and want a more scalable solution.

This guide will elevate your skills from a data cleaner to a **data architect**. You'll learn how to reshape, dissect, and apply rules with surgical precision, making even the most complex data sources conform to your ideal domain model.

## 1. Reshaping Data: Declarative Reparenting

Your data source (an external API or an LLM) rarely returns data in the exact shape you need. Reparenting decorators let you define how to map a messy input structure to your clean class structure.

### The Problem: Mismatched Structures

An LLM returns this object:

```json
{
  "order_info": {
    "details": { "id": "ORD-123" }
  },
  "customer": {
    "contact": { "email": "john@example.com" }
  },
  "items": [ { "sku": "WID-001" } ],
  "notes": "Customer requested rush delivery."
}
```

But your desired `Order` class is flat and clean:

```typescript
class Order {
  orderId: string;
  customerEmail: string;
  productSku: string;
}
```

### The Solution: Pluck Data with `@DerivedFrom`

The `@DerivedFrom` decorator lets you specify a [JSONPath](https://goessner.net/articles/JsonPath/) to extract a value from the raw input.

```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  @DerivedFrom('$.customer.contact.email')
  customerEmail: string;

  @DerivedFrom('$.items[0].sku') // Access specific array elements
  productSku: string;
}

const factory = new ValidationFactory();
const order = await factory.create(Order, messyLLMOutput);

// order now contains:
// {
//   orderId: 'ORD-123',
//   customerEmail: 'john@example.com',
//   productSku: 'WID-001'
// }
```

You can also provide **fallback paths**. The first path that finds a non-undefined value wins. This is incredibly useful when an LLM's output structure is inconsistent.

```typescript
class Order {
  @DerivedFrom(['$.order_id', '$.orderId', '$.id'])
  orderId: string;
}
```

### Capturing "Everything Else" with `@CollectProperties`

Sometimes you want to map specific fields and capture all the remaining ones in a metadata property. `@CollectProperties` does this automatically.

```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  // This will collect all properties from the root ('$') of the input
  // that weren't already mapped by another decorator.
  @CollectProperties({ sources: [{ path: '$' }] })
  metadata: Record<string, any>;
}

const factory = new ValidationFactory();
const order = await factory.create(Order, messyLLMOutput);

// order.metadata will contain:
// {
//   "customer": { "contact": { "email": "..." } },
//   "items": [ { "sku": "..." } ],
//   "notes": "Customer requested rush delivery."
// }
```

## 2. Precision Targeting: Context Decorators

Context decorators (`@Keys`, `@Values`, `@Split`) change the *context* of the decorators that follow them. They allow you to "step inside" an object or array and apply transformations with precision.

### Targeting Object Keys with `@Keys` and Values with `@Values`

These decorators allow you to apply subsequent rules to the keys or values of an object (or elements of an array).

```typescript
class HttpRequest {
  @Keys() // The following decorators now apply to each KEY
  @CoerceTrim()
  @CoerceCase('lower')
  headers: Record<string, string>;
}

class Article {
  @Values() // The following decorators now apply to each ELEMENT
  @CoerceTrim()
  tags: string[];
}
```

You can also attach them to a **class** to canonicalize the raw input before property-level rules run. This is useful for messy upstream casing or delimiter issues:

```typescript
@Keys()                // Normalize incoming keys first
@CoerceCase('lower')
class Animal {
@Copy()
name!: string;
}
// Handles { "NAME": "Fido" } without extra property decorators.
```

If you need tolerant lookups **without mutating the input**, use `@MatchingStrategy` on a property or attach it inside a class-level `@Keys()` block. It adjusts how we locate the source key (case-insensitive or fuzzy) while leaving the original payload intact—handy when other decorators (or `$` JSONPath snippets) still need to see the untouched input.

```typescript
@Keys()
@MatchingStrategy('insensitive') // case-insensitive match for all properties
class Animal {
  @Copy()
  name!: string;
}

class Alias {
  @MatchingStrategy({ strategy: 'fuzzy', threshold: 0.5 })
  @Copy()
  name!: string;
}
// Finds { "NAME": "Fido" } or even { "nmae": "Fido" } without rewriting the input.
```

For nested structures, reach for `@RecursiveKeys` / `@RecursiveValues` to continuously propagate the same transforms through descendants (objects and arrays). If you only want to target nested objects conditionally, combine `@Values()` with `@If(...)` and `@UseStyle(...)` to scope the nested rules yourself.

### Parsing Strings with `@Split` and Protected Segments

`@Split` is a powerful tool for parsing delimited strings. Unlike a simple `string.split()`, it understands how to handle "protected" segments inside quotes and brackets, which is essential for parsing complex, code-like data.

**The Problem:** You need to parse a string that contains delimiters within quoted segments or function-like bracketed segments. A standard regex or split would fail.

```typescript
const input = {
  // We want to split by ';', but not inside the quotes or brackets.
  style: 'font-family: "Times New Roman", serif; color: rgb(255, 0, 0); font-weight: bold'
};
```

**The Solution:** Use `@Split` with quote and bracket definitions.

```typescript
class StyleRule {
  @Split(';', {
    quotes: ['"', "'"],
    brackets: ['()', '[]', '{}'], // Supports nested, heterogenous brackets
    stripQuotes: true,
  })
  @CoerceTrim()
  rules: string[];
}

const factory = new ValidationFactory();
const result = await factory.create(StyleRule, input);

// The result is parsed correctly:
// {
//   rules: [
//     'font-family: Times New Roman, serif', // The comma inside quotes was ignored
//     'color: rgb(255, 0, 0)',             // The content inside brackets was treated as one unit
//     'font-weight: bold'
  //   ]
  // }
```
This built-in balanced bracket support is a powerful feature not available in standard JavaScript regular expressions.

### Parsing Lists Inline with `@Delimited`

`@Delimited` splits a string, applies decorators, and rejoins. Useful when you need to normalize components but keep the value as a string.

```typescript
class UserInput {
  @Delimited(',', { stripQuotes: true })
  @CoerceTrim()
  tags!: string; // stays a string, segments normalized
}
```
This built-in balanced bracket support is a powerful feature not available in standard JavaScript regular expressions.

### Processing Arrays with `@Map`, `@Filter` and `@Join`

Often you need to process arrays element-by-element, filter out unwanted items, or join them back together.

```typescript
class ProcessedList {
  @Split(',')
  @Map((item) => item.trim().toUpperCase())
  @Filter((item) => item.length > 0)
  @Join(' | ')
  result: string;
}

// Input: "  a, , b , c  "
// Steps:
// 1. Split: ["  a", " ", " b ", " c  "]
// 2. Map: ["A", "", "B", "C"]
// 3. Filter: ["A", "B", "C"]
// 4. Join: "A | B | C"
```

### Advanced Pattern: Composing Styles and Context

Here's where the intermediate patterns start to shine. What if you want to apply a complex, reusable style (like your `EmailStyle`) to every *value* in an object?

This is where the concept of a **"hygienic macro"** comes in. Your `EmailStyle` is "hygienic"—it's self-contained and only knows how to process a single value. The `@Values()` decorator provides the context, telling the engine to apply that self-contained logic to each value in the object.

```typescript
// From the Getting Started guide
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

class UserEmailMap {
  @Values() // CONTEXT: Apply the following rules to each value of the object
  @UseStyle(EmailStyle) // RULE: The rule to apply is our reusable EmailStyle
  emails: Record<string, string>;
}

const input = {
  emails: {
    primary: '  PRIMARY@EXAMPLE.COM  ',
    secondary: '  SECONDARY@EXAMPLE.COM  '
  }
};

const factory = new ValidationFactory();
const result = await factory.create(UserEmailMap, input);

// Result: Both emails are cleaned according to the style.
// {
//   emails: {
//     primary: 'primary@example.com',
//     secondary: 'secondary@example.com'
//   }
// }
```

This pattern of composing context decorators with style decorators is incredibly powerful for keeping your validation logic clean and DRY.

## 3. Scaling Your Rules with Default Transforms

Default transforms take reusability to the next level, allowing you to define default styles for an entire class or even your entire application.

### Class-Level Defaults with `@DefaultTransforms`

Instead of applying a `@UseStyle` to every string property, you can set a default for all string properties on the class.

```typescript
class TrimStyle { @CoerceTrim() value: string; }

@DefaultTransforms({
  string: TrimStyle // Apply TrimStyle to ALL string properties in this class
})
class User {
  @Copy() name: string;
  @Copy() email: string;
}
```
*Note: You still need a decorator like `@Copy()` on each property to "opt-in" to the validation process (or use `@ManageAll` to auto-manage fields). Properties without any decorators are ignored.*

### Factory-Level Defaults and The Cascade

For ultimate scalability, you can configure defaults on the `ValidationFactory` itself. These defaults work just like CSS styles, with more specific rules overriding more general ones in a predictable cascade:

**Property Decorators > Class Defaults > Factory Defaults**

Let's see it in action.

```typescript
// --- Define reusable styles ---
class TrimLowerStyle { @CoerceTrim() @CoerceCase('lower') value: string; }
class TrimUpperStyle { @CoerceTrim() @CoerceCase('upper') value: string; }

// --- 1. FACTORY Default ---
// Our application-wide default: all strings should be trimmed and lowercased.
const factory = new ValidationFactory({
  defaultTransforms: {
    string: TrimLowerStyle
  }
});

// --- 2. CLASS Override ---
// For this specific class, we want strings to be uppercase instead.
@DefaultTransforms({
  string: TrimUpperStyle
})
class Product {
  // This property will use the CLASS default (uppercase).
  @Copy()
  name: string;

  // --- 3. PROPERTY Override ---
  // For this one property, we need title case, overriding all defaults.
  @CoerceTrim()
  @CoerceCase('title')
  description: string;

  // This property has no overrides, so it uses the CLASS default.
  @Copy()
  sku: string;
}

// Let's process some data
const input = {
  name: '  Super Widget  ',
  description: '  a truly super widget.  ',
  sku: '  wdg-123  '
};

const product = await factory.create(Product, input);

// Observe the results of the cascade:
// product.name = 'SUPER WIDGET' (Used the Class-level TrimUpperStyle)
// product.description = 'A Truly Super Widget.' (Used the Property-level decorators)
// product.sku = 'WDG-123' (Used the Class-level TrimUpperStyle)
```

This powerful cascade gives you complete control over how rules are applied, allowing you to set sensible application-wide defaults while still handling exceptions with ease at the class or property level.

### Auto-manage with `@ManageAll`

If you want defaults to apply without sprinkling `@Copy`, mark fields as managed:

```typescript
@ManageAll({ include: ['name', 'code'] })
@DefaultTransforms({ string: TrimLowerStyle })
class ProductMinimal {
  name!: string; // Managed; inherits defaults
  code!: string;
}
```

## 4. Conditional Processing: Rules That Adapt

Real-world data often requires different processing based on context. A field might need validation only when another field has a certain value, or you might need to apply different transformations depending on the input's state or structure.

Conditional decorators (`@If`, `@ElseIf`, `@Else`, `@EndIf`) let you apply rules selectively based on runtime conditions.

### The Problem: Context-Dependent Validation

Consider an e-commerce order system where processing requirements differ based on order status:

```typescript
const ORDER_STATUSES = ['draft', 'pending', 'active', 'shipped'] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

class Order {
  @CoerceFromSet(ORDER_STATUSES)
  status: OrderStatus;

  shippingDate?: Date;
  estimatedDate?: Date;
}
```

- If status is `'active'` or `'shipped'`, `shippingDate` must be a valid date
- If status is `'draft'` or `'pending'`, it should be a placeholder string
- Validation rules should only apply when appropriate

> **Note**: We use the "as const" pattern to define both the TypeScript type and runtime values from a single source. This lets `@CoerceFromSet` validate the status while TypeScript enforces type safety.

### The Solution: Conditional Decorators

Wrap decorators in conditional blocks to apply them only when conditions are met:

```typescript
const ORDER_STATUSES = ['draft', 'pending', 'active', 'shipped'] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

class Order {
  @CoerceFromSet(ORDER_STATUSES)
  status: OrderStatus;

  @If('status', ['active', 'shipped'])
    @CoerceType('date')
    @Validate((d) => d <= new Date(), 'Shipping date cannot be in the future')
  @ElseIf('pending')
    @Set('Pending shipment')
  @Else()
    @Set('Not yet scheduled')
  @EndIf()
  shippingDate: Date | string;
}
```

### Understanding Conditional Syntax

**Basic Forms:**

```typescript
// 1. Check current property value (equality)
@If('active')  // true if property value === 'active'
@CoerceType('number')
@EndIf()
status: string | number;

// 2. Check current property value (lambda)
@If((val: string) => val.length > 100)
@AITransform('Summarize this long text')
@EndIf()
description: string;

// 3. Check another property
@If('type', 'premium')
@Validate(isPremiumValid)
@EndIf()
features: string[];

// 4. Check JSONPath in raw input (doesn't create dependency)
@If('$.metadata.version', (v) => v >= 2)
@Set('NEW_FORMAT')
@Else()
@Set('OLD_FORMAT')
@EndIf()
format: string;

// 5. Check multiple properties
@If(['price', 'quantity'], ([p, q]: any[]) => p * q > 1000)
@Validate(() => 'High-value orders require approval')
@EndIf()
requiresApproval: boolean;
```

### Key Concepts

**1. Dependency Resolution**

When you reference another property in a condition, the validation library automatically ensures that property is processed first:

```typescript
class Product {
  @CoerceTrim()
  category: string;  // Processed first

  // This depends on 'category', so it processes after
  @If('category', 'electronics')
    @Validate(isValidSerialNumber)
  @EndIf()
  serialNumber: string;
}
```

**2. Self-References vs. External References**

- **Current value** (no topic): Checks the property's value *in progress* (after previous decorators)
- **Self-reference** (`'myProp'` on property `myProp`): Same as current value
- **External reference** (`'otherProp'`): Checks another property's *completed* value
- **JSONPath** (`'$.path'`): Always checks the *original input*, creating no intra-cycle dependency

```typescript
class Document {
  @CoerceTrim()
  @If((val: string) => val.length > 50)  // Checks trimmed value
    @AITransform('Summarize')
  @EndIf()
  content: string;
}
```

**3. No Nested Conditionals**

For simplicity and maintainability, the library doesn't allow nested `@If` blocks. For complex conditional logic, use a custom `@DerivedFrom` function or separate the concerns into different properties.

### Practical Example: Multi-Format Date Handling

```typescript
const DATE_FORMATS = ['iso', 'unix', 'friendly'] as const;
type DateFormat = typeof DATE_FORMATS[number];

class Event {
  @CoerceFromSet(DATE_FORMATS)
  dateFormat: DateFormat;

  @If('dateFormat', 'iso')
    @CoerceType('date')
  @ElseIf('dateFormat', 'unix')
    @Coerce((v: number) => new Date(v * 1000))
  @Else()
    // 'friendly' format like "March 15, 2024"
    @Coerce((v: string) => new Date(v))
  @EndIf()
  @Validate((d) => !isNaN(d.getTime()), 'Invalid date')
  eventDate: Date;
}
```

### When to Use Conditionals

**Good use cases:**
- Different validation rules based on record type or status
- Optional vs. required fields based on context
- Format conversions that depend on metadata
- Applying expensive transformations (like AI calls) only when needed

**Better alternatives:**
- **Simple transformations**: Use `@DerivedFrom` with a function that handles all cases
- **Complex logic**: Create separate classes for each variant and use `@ValidatedClass` with polymorphism
- **Always-applied rules**: Don't wrap in conditionals; use sequential decorators

## 5. Working with Complex Nested Structures

### The Problem: Deep Transformation Needs

Sometimes you receive deeply nested data where you need to apply the same transformation throughout the entire structure—not just at one level, but recursively through all nested objects and arrays.

Consider this API response with inconsistent casing throughout:

```typescript
const apiResponse = {
  UserProfile: {
    FirstName: 'john',
    Settings: {
      Theme: 'DARK',
      Preferences: {
        Language: 'EN-us'
      }
    },
    Tags: ['ADMIN', 'Premium', 'beta-tester']
  }
};
```

You want to normalize all string values to lowercase, regardless of how deeply nested they are.

### Recursive Transformations with `@RecursiveKeys` and `@RecursiveValues`

The `@RecursiveKeys()` and `@RecursiveValues()` decorators apply subsequent transformations recursively through the entire data structure.

**`@RecursiveKeys()`** - Transforms all keys (property names) at every level:

```typescript
class APIResponse {
  @RecursiveKeys()
  @CoerceCase('snake')
  data: any;
}

// Input:  { UserProfile: { FirstName: 'John' } }
// Output: { user_profile: { first_name: 'John' } }
```

**`@RecursiveValues()`** - Transforms all values (strings, numbers, etc.) at every level:

```typescript
class APIResponse {
  @RecursiveValues()
  @CoerceTrim()
  @CoerceCase('lower')
  data: any;
}

// Processes the apiResponse example above
// All strings become lowercase and trimmed, regardless of depth
// {
//   UserProfile: {
//     FirstName: 'john',
//     Settings: {
//       Theme: 'dark',
//       Preferences: { Language: 'en-us' }
//     },
//     Tags: ['admin', 'premium', 'beta-tester']
//   }
// }
```

### Class-Level Recursive Canonicalization

You can also apply recursive decorators at the class level to normalize raw input before property-level rules run:

```typescript
@RecursiveKeys()
@CoerceCase('camel')
class Config {
  @Copy()
  databaseUrl: string;

  @Copy()
  apiSettings: any;
}

// Handles input like:
// { DatabaseUrl: '...', ApiSettings: { MaxRetries: 3 } }
// All keys normalized before property decorators run
```

### When to Use Recursive vs. Targeted Decorators

**Use `@RecursiveKeys` / `@RecursiveValues` when:**
- You need blanket normalization across an entire unknown structure
- The data structure is highly variable or dynamic
- You're dealing with third-party APIs with inconsistent formatting

**Use `@Values()` + `@UseStyle()` when:**
- You want selective, controlled transformation
- You have a known structure with specific validation needs
- You want type safety and explicit property mappings

**Example of the targeted approach:**

```typescript
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

class Team {
  // Only transform the emails object values, not the entire structure
  @Values()
  @UseStyle(EmailStyle)
  memberEmails: Record<string, string>;
}
```

### Combining Recursive and Targeted Patterns

For complex scenarios, you can combine both approaches:

```typescript
@RecursiveKeys()  // Normalize all keys first
@CoerceCase('camel')
class DataImport {
  @Copy()
  importId: string;

  // The keys are already normalized, now apply specific value rules
  @RecursiveValues()
  @CoerceTrim()
  rawData: any;

  // Specific validation for a known structure within the data
  @ValidatedClass(ProcessedRecord)
  processedRecords: ProcessedRecord[];
}
```

## 6. Matching and Lookups

Real-world data rarely matches exactly. Users make typos, APIs change casing, and LLMs occasionally misspell. The library provides powerful matching strategies to handle these variations gracefully.

### Property Key Matching with `@MatchingStrategy`

When sourcing data from input, you can use `@MatchingStrategy` to tolerate variations in property names without mutating the original data.

**Case-insensitive matching:**

```typescript
class Product {
  @MatchingStrategy('insensitive')  // Case-insensitive
  @Copy()
  productName: string;
}

// Handles: { ProductName: 'Widget' } or { productname: 'Widget' } or { PRODUCTNAME: 'Widget' }
```

**Fuzzy matching for typos:**

```typescript
class Order {
  @MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
  @Copy()
  customerId: string;
}

// Matches 'customerId', 'custoemrId', 'cutomerId' (within threshold)
```

**Class-level matching for all properties:**

```typescript
@Keys()
@MatchingStrategy('insensitive')  // All properties now case-insensitive
class APIResponse {
  @Copy() userId: string;
  @Copy() sessionToken: string;
}

// Handles any casing: { USERID: '...', sessiontoken: '...' }
```

### Value Matching with `@CoerceFromSet`

`@CoerceFromSet` matches and corrects values against a set of valid options. It's perfect for handling enum-like values with variations.

**Exact string matching:**

```typescript
const VALID_SIZES = ['small', 'medium', 'large'];

class ShirtOrder {
  @CoerceFromSet(() => VALID_SIZES, { strategy: 'exact', caseSensitive: false })
  size: string;
}

// Input: 'MEDIUM' → Output: 'medium'
// Input: 'med' → Error (not exact match)
```

**Fuzzy string matching for typos:**

```typescript
const VALID_PRODUCTS = ['Widget', 'Gadget', 'Doohickey'];

class Order {
  @CoerceFromSet(() => VALID_PRODUCTS, { strategy: 'fuzzy', threshold: 0.7 })
  product: string;
}

// Input: 'Widgit' → Output: 'Widget' (fuzzy match)
// Input: 'Gadet' → Output: 'Gadget'
// Input: 'xyz' → Error (below threshold)
```

**Synonym mapping for alternate terms:**

When you have known alternate terms or aliases, use `synonyms` to map them to canonical values. This is more efficient and deterministic than fuzzy matching:

```typescript
class NotificationPrefs {
  @CoerceFromSet(() => ['email', 'phone', 'sms'], {
    strategy: 'fuzzy',  // Still use fuzzy for typos
    threshold: 0.7,
    synonyms: {
      sms: ['text', 'text message', 'text messages', 'texting', 'txt'],
      phone: ['call', 'calling', 'phone call', 'telephone'],
      email: ['e-mail', 'mail', 'electronic mail']
    }
  })
  contactMethod: string;
}

// Input: 'text message' → Output: 'sms' (synonym match)
// Input: 'calling' → Output: 'phone' (synonym match)
// Input: 'e-mail' → Output: 'email' (synonym match)
// Input: 'emial' → Output: 'email' (fuzzy match for typo)
```

Synonyms are checked before fuzzy matching, making them fast and predictable. They're perfect for handling variations in terminology, common abbreviations, or regional differences.

**Partial matching strategies:**

```typescript
const CATEGORIES = ['electronics', 'furniture', 'clothing'];

class Product {
  // 'contains' - candidate contains input
  @CoerceFromSet(() => CATEGORIES, { strategy: 'contains' })
  category: string;
}

// Input: 'electron' → Output: 'electronics'
// Input: 'cloth' → Output: 'clothing'
```

**Numeric matching with tolerance:**

```typescript
const PRICE_POINTS = [9.99, 19.99, 29.99, 49.99];

class Subscription {
  @CoerceFromSet(() => PRICE_POINTS, {
    strategy: 'numeric',
    numericTolerance: 1.0
  })
  monthlyPrice: number;
}

// Input: 10.50 → Output: 9.99 (closest within tolerance)
// Input: 20.00 → Output: 19.99
// Input: 15.00 → Error (ambiguous: equally close to 19.99 and 9.99)
```

**Matching complex objects with selectors:**

```typescript
interface Product {
  id: string;
  name: string;
  sku: string;
}

interface CatalogContext {
  products: Product[];
}

class OrderItem {
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.products,
    {
      selector: (p) => p.sku,  // Match based on SKU field
      strategy: 'fuzzy',
      threshold: 0.8
    }
  )
  product: Product;
}

// Input: { product: 'WDG-01' }
// Finds product with sku 'WDG-001' via fuzzy match on the selector
// Output: { product: { id: '...', name: '...', sku: 'WDG-001' } }
```

### Context-Driven Matching

Combine `@CoerceFromSet` with runtime context for dynamic validation against changing data sets:

```typescript
interface InventoryContext {
  availableProducts: string[];
  validRegions: string[];
}

class PurchaseOrder {
  @CoerceFromSet<InventoryContext>(
    (ctx) => ctx.availableProducts,
    { strategy: 'fuzzy', threshold: 0.7 }
  )
  productName: string;

  @CoerceFromSet<InventoryContext>(
    (ctx) => ctx.validRegions,
    { strategy: 'exact', caseSensitive: false }
  )
  shippingRegion: string;
}

// Usage:
const context: InventoryContext = {
  availableProducts: ['Widget', 'Gadget'],
  validRegions: ['US', 'EU', 'APAC']
};

const order = await factory.create(PurchaseOrder, orderData, { context });
```

### Using `@Examples` for Better Errors

When matching fails, provide examples to help users (and AI repair mechanisms) understand the expected format:

```typescript
const STATUSES = ['pending', 'active', 'completed', 'cancelled'];

class Task {
  @Examples(STATUSES, 'Valid task statuses')
  @CoerceFromSet(() => STATUSES, { strategy: 'fuzzy', threshold: 0.6 })
  status: string;
}

// On error, ValidationError will include the examples in its message
```

## 7. Parsing & Formatting Pipelines

Data often arrives in one format and needs to be consumed in another. The library provides parsing and formatting decorators that transform between representations while maintaining validation guarantees.

### Parsing Inbound Data with `@CoerceParse`

`@CoerceParse` converts string representations into structured data:

**JSON parsing:**

```typescript
class APIPayload {
  @CoerceParse('json')
  settings: { theme: string; notifications: boolean };
}

// Input: { settings: '{"theme":"dark","notifications":true}' }
// Output: { settings: { theme: 'dark', notifications: true } }
```

**Handling already-parsed data:**

```typescript
class FlexiblePayload {
  @CoerceParse('json', { allowNonString: true })
  data: any;
}

// Accepts both:
// { data: '{"key":"value"}' }  → parsed
// { data: { key: 'value' } }   → passed through unchanged
```

**YAML parsing:**

YAML parsing requires registration and the `yaml` package:

```typescript
import { registerYAMLParser } from '@firebrandanalytics/shared-utils/validation';

// Register once at application startup
registerYAMLParser();

class ConfigFile {
  @CoerceParse('yaml')
  settings: { database: { host: string; port: number }; cache: { enabled: boolean } };
}

// Input: { settings: 'database:\n  host: localhost\n  port: 5432\ncache:\n  enabled: true' }
// Output: { settings: { database: { host: 'localhost', port: 5432 }, cache: { enabled: true } } }
```

**XML/HTML parsing:**

XML/HTML parsing requires registration and the `@xmldom/xmldom` package:

```typescript
import { registerHTMLParser, registerXMLParser } from '@firebrandanalytics/shared-utils/validation';

// Register once at application startup
registerHTMLParser();
registerXMLParser();

class HTMLContent {
  @CoerceParse('html')
  document: Document;
}

// Parses HTML string to DOM Document
```

**Locale-aware numbers & currency:**

```typescript
class Financials {
  @CoerceParse('number', { locale: 'de-DE' })
  amount!: number; // "1.234,56" -> 1234.56

  @CoerceParse('currency', { locale: 'en-US' })
  price!: number;  // "$1,234.56" -> 1234.56
}
```

### Formatting Outbound Data with `@CoerceFormat`

`@CoerceFormat` coerces first, then renders to a formatted string:

**Date formatting with ISO:**

```typescript
class Event {
  @CoerceFormat('date', 'iso')
  startTime: string;
}

// Input: { startTime: '2024-01-15T10:30:00-05:00' }
// Output: { startTime: '2024-01-15T15:30:00.000Z' } (ISO UTC)
```

**Date formatting with locale options:**

```typescript
class Report {
  @CoerceFormat('date', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/New_York'
  })
  generatedAt: string;
}

// Input: { generatedAt: '2024-01-15T10:30:00Z' }
// Output: { generatedAt: 'Monday, January 15, 2024 at 5:30 AM' }
```

**Number formatting with Intl:**

```typescript
class Invoice {
  @CoerceFormat('number', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  })
  total: string;
}

// Input: { total: 1234.5 }
// Output: { total: '$1,234.50' }
```

### Chaining Parse → Transform → Format

The real power comes from combining parsing, transformation, and formatting in a pipeline:

**Example: Normalizing and reformatting dates**

```typescript
class CalendarEvent {
  @CoerceParse((val) => new Date(val))  // Parse various formats
  @Validate((d) => !isNaN(d.getTime()), 'Invalid date')
  @CoerceFormat('date', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  })
  eventDate: string;
}

// Input: { eventDate: '2024-01-15' } or '1705276800000' or any Date-parseable string
// Output: { eventDate: 'Jan 15, 2024' }
```

**Example: JSON validation and re-serialization**

```typescript
class ConfigField {
  @CoerceParse('json', { allowNonString: true })
  @Validate((obj) => obj.version >= 2, 'Config must be version 2+')
  @Coerce((obj) => ({ ...obj, validated: true }))  // Add metadata
  @Coerce((obj) => JSON.stringify(obj, null, 2))   // Pretty-print
  configData: string;
}

// Input: { configData: '{"version":2,"settings":{}}' }
// Output: { configData: '{\n  "version": 2,\n  "settings": {},\n  "validated": true\n}' }
```

**Example: Multi-format invoice processor**

```typescript
class Invoice {
  // Parse amount from string, round, then format as currency
  @CoerceParse((val) => parseFloat(val.replace(/[^0-9.]/g, '')))
  @CoerceRound({ precision: 2 })
  @Validate((n) => n > 0, 'Amount must be positive')
  @CoerceFormat('number', {
    style: 'currency',
    currency: 'USD'
  })
  amount: string;

  // Parse date, validate, and format consistently
  @CoerceType('date')
  @Validate((d) => d <= new Date(), 'Cannot be future date')
  @CoerceFormat('date', 'iso-date')
  invoiceDate: string;
}

// Input: { amount: '$1,234.567', invoiceDate: 1705276800000 }
// Output: { amount: '$1,234.57', invoiceDate: '2024-01-15' }
```

### Timezone Handling in Date Formatting

When formatting dates, understanding timezone behavior is crucial:

```typescript
class TimezoneSensitive {
  // Render in specific timezone without changing the instant
  @CoerceFormat('date', {
    timeZone: 'America/New_York',
    dateStyle: 'short',
    timeStyle: 'short'
  })
  localTime: string;

  // Always render in UTC
  @CoerceFormat('date', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short'
  })
  utcTime: string;
}

// Same input date rendered in different zones
// Input: { localTime: '2024-01-15T15:30:00Z', utcTime: '2024-01-15T15:30:00Z' }
// Output: { localTime: '1/15/24, 10:30 AM', utcTime: '1/15/24, 3:30 PM' }
```

## 8. AI Helpers: Presets for Common Tasks

AI helper decorators are convenient presets built on top of `@AITransform` that provide stable prompts for common transformation tasks. They handle the prompt engineering so you can focus on your domain logic.

> **Note:** All AI helpers require an `aiHandler` configured on your `ValidationFactory`. The handler performs the actual AI call.

### `@AITranslate` - Language Translation

Translate text while preserving meaning and context:

```typescript
class ProductListing {
  @Copy()
  title: string;

  @DerivedFrom('title')
  @AITranslate('Spanish')
  spanishTitle: string;

  @DerivedFrom('title')
  @AITranslate('Japanese')
  japaneseTitle: string;
}

// Input: { title: 'Premium Leather Wallet' }
// Output: {
//   title: 'Premium Leather Wallet',
//   spanishTitle: 'Cartera de Cuero Premium',
//   japaneseTitle: 'プレミアムレザーウォレット'
// }
```

### `@AIRewrite` - Style Transformation

Rewrite text in different tones or styles:

```typescript
class CustomerMessage {
  @Copy()
  originalMessage: string;

  @DerivedFrom('originalMessage')
  @AIRewrite('concise')
  shortVersion: string;

  @DerivedFrom('originalMessage')
  @AIRewrite('formal')
  formalVersion: string;

  @DerivedFrom('originalMessage')
  @AIRewrite('friendly')
  friendlyVersion: string;
}

// Input: { originalMessage: 'Hey, the product broke after 2 days!' }
// Output: {
//   originalMessage: 'Hey, the product broke after 2 days!',
//   shortVersion: 'Product failed after 2 days',
//   formalVersion: 'The product malfunctioned after two days of use',
//   friendlyVersion: 'Oh no! It looks like the product stopped working after just 2 days'
// }
```

### `@AISummarize` - Content Summarization

Condense long text to different lengths:

```typescript
class Article {
  @Copy()
  fullText: string;

  @DerivedFrom('fullText')
  @AISummarize('short')    // One sentence
  headline: string;

  @DerivedFrom('fullText')
  @AISummarize('medium')   // Brief paragraph
  abstract: string;

  @DerivedFrom('fullText')
  @AISummarize('long')     // Detailed summary
  summary: string;
}
```

### `@AIClassify` - Categorization

Classify text into predefined categories:

```typescript
class SupportTicket {
  @Copy()
  description: string;

  @DerivedFrom('description')
  @AIClassify(['technical', 'billing', 'general inquiry'])
  category: string;

  @DerivedFrom('description')
  @AIClassify(['low', 'medium', 'high', 'urgent']) // auto-coerces to one of these labels
  priority: string;
}

// Input: { description: 'My payment failed but I was charged twice!' }
// Output: {
//   description: 'My payment failed but I was charged twice!',
//   category: 'billing',
//   priority: 'high'
// }
```

### `@AIExtract` - Structured Data Extraction

Extract specific fields from unstructured text:

```typescript
class EmailParser {
  @Copy()
  emailBody: string;

  @DerivedFrom('emailBody')
  @AIExtract(['orderNumber', 'customerName', 'totalAmount'])
  extractedData: { orderNumber: string; customerName: string; totalAmount: string };
}

// Input: { emailBody: 'Hi, I'm John Smith. My order #12345 for $99.99 hasn't arrived.' }
// Output: {
//   emailBody: '...',
//   extractedData: {
//     orderNumber: '12345',
//     customerName: 'John Smith',
//     totalAmount: '$99.99'
//   }
// }
```

### `@AISpellCheck` - Grammar and Spelling Correction

Fix spelling and grammar while preserving meaning:

```typescript
class UserInput {
  @AISpellCheck()
  @CoerceTrim()
  feedback: string;
}

// Input: { feedback: 'The prodcut is grate but delivry was slow' }
// Output: { feedback: 'The product is great but delivery was slow' }
```

### `@AIJSONRepair` - Malformed JSON Recovery

Repair broken JSON strings:

```typescript
class APIResponse {
  @AIJSONRepair()
  @CoerceParse('json', { allowNonString: true })
  data: any;
}

// Input: { data: '{name: "John", age: 30, }' }  // Missing quotes, trailing comma
// Output: { data: { name: 'John', age: 30 } }
```

### Combining AI Helpers with Other Decorators

AI helpers work seamlessly in decorator pipelines:

```typescript
class BlogPost {
  @Copy()
  rawContent: string;

  // Extract, spell-check, then summarize
  @AIExtract(['mainTopic', 'keyPoints'])
  @Validate((obj) => obj.mainTopic?.length > 0, 'Must have a main topic')
  metadata: { mainTopic: string; keyPoints: string[] };

  // Spell-check then rewrite for readability
  @AISpellCheck()
  @AIRewrite('concise')
  @ValidateLength(10, 200)
  excerpt: string;
}
```

### AI Helpers with Validation and Retry

AI helpers automatically retry when output fails subsequent validation:

```typescript
const VALID_CATEGORIES = ['fiction', 'non-fiction', 'technical', 'children'];

class Book {
  @Copy()
  description: string;

  @AIClassify(VALID_CATEGORIES)
  @CoerceFromSet(() => VALID_CATEGORIES, { strategy: 'exact' })
  category: string;
}

// If AI returns 'scifi', @CoerceFromSet fails
// The library automatically retries the AI call with the error as context
// AI then returns 'fiction' which passes validation
```

### Cost-Aware AI Helper Usage

AI calls can be expensive. Use conditionals to apply them only when needed:

```typescript
class Document {
  @Copy()
  content: string;

  // Only summarize long documents
  @If((content: string) => content.length > 500)
    @AISummarize('short')
  @Else()
    @Copy()  // Just copy the content if it's already short
  @EndIf()
  summary: string;
}
```

### Error Recovery with `@AICatchRepair`

For automatic AI-based error recovery, use `@AICatchRepair`:

```typescript
class DataImport {
  @AICatchRepair()  // Repairs on any coercion/validation error
  @CoerceParse('json')
  @Validate((obj) => obj.version >= 2, 'Must be version 2+')
  configData: any;
}

// If JSON is malformed or validation fails, AI attempts to repair
// More details in the Advanced Guide
```

## 9. Examples and Better Error Messages (for humans and AI)

Use `@Examples` to attach sample values/description; these appear in `ValidationError` and help both users and AI retry flows (`AICatchRepair` or external AI retriers) understand expected formats.

## 5. Polymorphism: Discriminated Unions

When your input data can represent different types of objects based on a specific field (a discriminator), you can use `@DiscriminatedUnion`. This allows you to instantiate different classes based on the input data.

### The Problem: One Field, Many Shapes

You receive an event stream where the structure depends on the `type` field:

```json
// Event A
{ "type": "user_signup", "userId": "123", "email": "..." }

// Event B
{ "type": "order_placed", "orderId": "456", "total": 99.99 }
```

### The Solution: `@DiscriminatedUnion`

Define a base class and map values of the discriminator field to specific subclasses.

```typescript
@DiscriminatedUnion({
  discriminator: 'type',
  map: {
    'user_signup': UserSignupEvent,
    'order_placed': OrderPlacedEvent
  }
})
class BaseEvent {
  @Copy() type: string;
  @Copy() timestamp: string;
}

class UserSignupEvent extends BaseEvent {
  @Copy() userId: string;
  @UseStyle(EmailStyle) email: string;
}

class OrderPlacedEvent extends BaseEvent {
  @Copy() orderId: string;
  @CoerceType('number') total: number;
}

// Usage
const factory = new ValidationFactory();
const event = await factory.create(BaseEvent, inputData);

// If inputData.type is 'user_signup', 'event' will be an instance of UserSignupEvent.
```

This pattern supports inheritance naturally—common fields in the base class (`type`, `timestamp`) are populated correctly on the subclass instance.

You can also override the discriminator mapping at runtime via the factory options, which is useful for plugins or dynamic configurations.

```typescript
const factory = new ValidationFactory();
const event = await factory.create(BaseEvent, inputData, {
  discriminatedUnion: {
    discriminator: 'type',
    map: {
      'custom_event': CustomEvent
    }
  }
});
```

### Real-World Pattern: Data Versioning and Migration

One of the most powerful applications of discriminated unions is handling evolving data schemas. As your application grows, your data structure changes—fields are added, renamed, or restructured. The validation library can handle all schema versions declaratively, eliminating the need for manual migration code.

**The Problem:**

Your application has been storing user preferences for years. The schema has evolved:

```typescript
// Version 1 (2022): Flat structure
{ "version": 1, "theme": "dark" }

// Version 2 (2023): Added fontSize, still somewhat flat
{ "version": 2, "theme": "dark", "fontSize": "medium" }

// Version 3 (2024): Nested structure with numeric fontSize and language
{ "version": 3, "ui": { "theme": "dark", "fontSize": 14, "language": "en" } }
```

You need to read data from all three versions, but your application logic should work with a single, canonical V3 structure.

**The Traditional Approach (Manual Migration):**

Typically, you'd parse each version into its own shape, then write migration code to convert V1 → V3 and V2 → V3. This is tedious and error-prone.

**The Declarative Approach: Let Decorators Handle Migration**

Instead, define all three version classes with the **same final V3 structure**, but use different **decorator strategies** to reshape each version's input format into that structure:

```typescript
// Define the V3 structure as a type - all migration classes produce this
type UserPreferencesV3 = {
  version: number;
  ui: { theme: string; fontSize: number; language: string };
};

// Naming convention: SourceToDestination makes it clear what each class does
class UserPreferencesV1ToV3 {
  @Discriminator(1)
  version: number;

  // V1 input: { theme: "dark" }
  // Output needed: { ui: { theme: "dark", fontSize: 14, language: "en" } }
  @DerivedFrom('$.theme', (theme) => ({
    theme: theme,
    fontSize: 14,  // V1 didn't have fontSize, use default
    language: 'en' // V1 didn't have language, use default
  }))
  ui: { theme: string; fontSize: number; language: string };
}

class UserPreferencesV2ToV3 {
  @Discriminator(2)
  version: number;

  // V2 input: { theme: "dark", fontSize: "medium" }
  // Output needed: { ui: { theme: "dark", fontSize: 14, language: "en" } }
  @DerivedFrom(['$.theme', '$.fontSize'], ([theme, fontSize]) => ({
    theme: theme,
    fontSize: fontSize === 'large' ? 16 : fontSize === 'small' ? 12 : 14,
    language: 'en' // V2 didn't have language, use default
  }))
  ui: { theme: string; fontSize: number; language: string };
}

class UserPreferencesV3ToV3 {
  @Discriminator(3)
  version: number;

  // V3 input already has the right structure, just copy it
  @Copy()
  ui: { theme: string; fontSize: number; language: string };
}

// Define the migration classes array once
const USER_PREFS_MIGRATIONS = [
  UserPreferencesV1ToV3,
  UserPreferencesV2ToV3,
  UserPreferencesV3ToV3
];

// Usage: Just call create() with the migrations array
const factory = new ValidationFactory();

const v1Data = { version: 1, theme: 'dark' };
const v2Data = { version: 2, theme: 'light', fontSize: 'large' };
const v3Data = { version: 3, ui: { theme: 'dark', fontSize: 14, language: 'en' } };

const prefs1 = await factory.create(USER_PREFS_MIGRATIONS, v1Data);
const prefs2 = await factory.create(USER_PREFS_MIGRATIONS, v2Data);
const prefs3 = await factory.create(USER_PREFS_MIGRATIONS, v3Data);

// All three results have the same V3 structure:
// prefs1.ui = { theme: 'dark', fontSize: 14, language: 'en' }
// prefs2.ui = { theme: 'light', fontSize: 16, language: 'en' }
// prefs3.ui = { theme: 'dark', fontSize: 14, language: 'en' }
```

**The Power of This Pattern:**

No manual migration code! The library handles everything:

1. **Discriminator routes** to the correct version class based on `version` field
2. **Decorators reshape** the input to match the canonical V3 structure
3. **You receive** a guaranteed V3-compatible object, regardless of input version

Your application code only needs to understand one structure:

```typescript
// Use the V3 type alias - no need to repeat the union everywhere
function applyPreferences(prefs: UserPreferencesV3) {
  document.body.className = prefs.ui.theme;
  document.body.style.fontSize = `${prefs.ui.fontSize}px`;
  document.documentElement.lang = prefs.ui.language;
}
```

**Supporting Multiple Destinations**

The naming convention allows you to support any permutation:

```typescript
// Identity migrations (no transformation)
class UserPreferencesV1ToV1 {
  @Discriminator(1)
  version: number;
  @Copy() theme: string;
}

// Migrate V1 to V2 structure
class UserPreferencesV1ToV2 {
  @Discriminator(1)
  version: number;
  @DerivedFrom(['$.theme'], ([theme]) => ({ theme, fontSize: 'medium' }))
  preferences: { theme: string; fontSize: string };
}

// Different migration arrays for different needs
const TO_V1_MIGRATIONS = [UserPreferencesV1ToV1];
const TO_V2_MIGRATIONS = [UserPreferencesV1ToV2, UserPreferencesV2ToV2];
const TO_V3_MIGRATIONS = [UserPreferencesV1ToV3, UserPreferencesV2ToV3, UserPreferencesV3ToV3];
```

**AI-Powered Migration: Unstructured to Structured**

A particularly powerful pattern is using AI to extract structured data from unstructured text fields. This is common when evolving from a simple "notes" field to dedicated structured fields:

```typescript
// V1: Captured everything in a single text field
// { version: 1, customerInfo: "John Smith, 555-1234, prefers email" }

// V2: Broke it out into structured fields
// { version: 2, name: "John Smith", phone: "555-1234", contactMethod: "email" }

type CustomerV2 = {
  version: number;
  name: string;
  phone: string;
  contactMethod: string;
};

class CustomerV1ToV2 {
  @Discriminator(1)
  version: number;

  // Use AI to extract structured data from the unstructured text
  // @Staging marks this as temporary - it's deleted after object creation
  @DerivedFrom('$.customerInfo')
  @AIExtract(['name', 'phone', 'contactMethod'])
  @Staging()
  structured: { name: string; phone: string; contactMethod: string };

  // Flatten the extracted structure to top-level properties
  @DerivedFrom('structured', (s) => s.name)
  name: string;

  @DerivedFrom('structured', (s) => s.phone)
  @NormalizeText('phone')  // Remove non-digit characters: "(555) 867-5309" -> "5558675309"
  phone: string;

  @DerivedFrom('structured', (s) => s.contactMethod)
  @AIClassify(['email', 'phone', 'sms'])  // AI maps "text messages" -> "sms"
  contactMethod: string;
}

class CustomerV2ToV2 {
  @Discriminator(2)
  version: number;

  @Copy() name: string;
  @Copy() phone: string;
  @Copy() contactMethod: string;
}

const CUSTOMER_MIGRATIONS = [CustomerV1ToV2, CustomerV2ToV2];

// V1 data gets automatically structured by AI
const v1 = await factory.create(CUSTOMER_MIGRATIONS, {
  version: 1,
  customerInfo: 'Jane Doe, call her at (555) 867-5309, she prefers text messages'
});

// Result: {
//   version: 2,
//   name: 'Jane Doe',
//   phone: '5558675309',
//   contactMethod: 'sms'
// }
// Note: 'structured' property was removed due to @Staging()
```

**Complex Migration Example: Nested Restructuring**

Here's a more complex migration where field locations changed significantly:

```typescript
// V1: { version: 1, colors: { primary: "#000", accent: "#f00" } }
// V2: { version: 2, theme: { palette: { main: "#000", highlight: "#f00" }, dark: false } }
// V3: { version: 3, appearance: { colorScheme: { primary: "#000", secondary: "#f00" }, mode: "light" } }

type SettingsV3 = {
  version: number;
  appearance: { colorScheme: { primary: string; secondary: string }; mode: string };
};

class SettingsV1ToV3 {
  @Discriminator(1)
  version: number;

  @DerivedFrom('$.colors', (colors) => ({
    colorScheme: { primary: colors.primary, secondary: colors.accent },
    mode: 'light' // default
  }))
  appearance: { colorScheme: { primary: string; secondary: string }; mode: string };
}

class SettingsV2ToV3 {
  @Discriminator(2)
  version: number;

  @DerivedFrom('$.theme', (theme) => ({
    colorScheme: { primary: theme.palette.main, secondary: theme.palette.highlight },
    mode: theme.dark ? 'dark' : 'light'
  }))
  appearance: { colorScheme: { primary: string; secondary: string }; mode: string };
}

class SettingsV3ToV3 {
  @Discriminator(3)
  version: number;

  @Copy()
  appearance: { colorScheme: { primary: string; secondary: string }; mode: string };
}

const SETTINGS_MIGRATIONS = [SettingsV1ToV3, SettingsV2ToV3, SettingsV3ToV3];
```

**Combining with Validation**

You can add validation rules that apply after migration:

```typescript
class UserPreferencesV1ToV3 {
  @Discriminator(1)
  version: number;

  @DerivedFrom('$.theme', (theme) => ({
    theme: theme,
    fontSize: 14,
    language: 'en'
  }))
  @Validate((ui) => ['light', 'dark'].includes(ui.theme), 'Invalid theme')
  @Validate((ui) => ui.fontSize >= 10 && ui.fontSize <= 24, 'Font size out of range')
  ui: { theme: string; fontSize: number; language: string };
}
```

**Tagging Data with Versions**

Always include a version number in your persisted data. This makes evolution painless:

```typescript
class DataWithVersion {
  // Always write current version when creating new data
  @Set(3)
  version: number;

  // ... rest of fields
}
```

When reading data, the version field tells you exactly which schema to expect. Without it, you're forced to use heuristics or field sniffing, which is fragile and error-prone.

### The "Array of Classes" Pattern

Alternatively, if your classes don't share a common base class with the `@DiscriminatedUnion` decorator (or if you want to compose unions ad-hoc), you can use the `@Discriminator` property decorator.

1. Decorate the discriminator property on each class:

```typescript
class Cat {
  @Discriminator('cat')
  type: string;
  // ...
}

class Dog {
  @Discriminator('dog')
  type: string;
  // ...
}
```

2. Pass an **array of classes** to `factory.create()`:

```typescript
// Returns Cat | Dog
const pet = await factory.create([Cat, Dog], inputData);
```

This also works with nested validation using `@ValidatedClass`:

```typescript
class PetOwner {
  @ValidatedClass([Cat, Dog])
  pet: Cat | Dog;
}
```

## 6. Inheritance: Building on Base Classes

Inheritance allows you to define common validation rules in a base class and extend them in derived classes.

### Basic Inheritance Pattern

Decorators on parent class properties are inherited by child classes:

```typescript
class BaseUser {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  email: string;

  @CoerceType('date')
  createdAt: Date;
}

class AdminUser extends BaseUser {
  @Copy()
  @ValidateRequired()
  adminLevel: number;

  @ValidatedClassArray(Permission)
  permissions: Permission[];
}

// AdminUser instances have all BaseUser validation rules plus their own
const admin = await factory.create(AdminUser, {
  email: '  ADMIN@EXAMPLE.COM  ',
  createdAt: '2024-01-15',
  adminLevel: 5,
  permissions: [...]
});

// admin.email is trimmed and lowercased (from BaseUser)
// admin.adminLevel is validated (from AdminUser)
```

### Execution Order

Parent class decorators run first, then child class decorators:

```typescript
class Base {
  @CoerceTrim()
  value: string;
}

class Child extends Base {
  @CoerceCase('upper')
  value: string;
}

// Input: { value: '  hello  ' }
// 1. @CoerceTrim from Base: 'hello'
// 2. @CoerceCase from Child: 'HELLO'
// Output: { value: 'HELLO' }
```

### Class-Level Decorators and Inheritance

Class-level decorators (like `@DefaultTransforms`, `@ManageAll`) are also inherited:

```typescript
@DefaultTransforms({ string: TrimLowerStyle })
class BaseEntity {
  @Copy() id: string;
}

class Product extends BaseEntity {
  @Copy() name: string;  // Inherits TrimLowerStyle from parent
  @Copy() description: string;  // Inherits TrimLowerStyle from parent
}
```

### Common Patterns

**Shared Timestamp Fields:**

```typescript
class TimestampedEntity {
  @CoerceType('date')
  @ValidateRequired()
  createdAt: Date;

  @CoerceType('date')
  updatedAt: Date;
}

class Article extends TimestampedEntity {
  @Copy() title: string;
  @Copy() content: string;
}

class Comment extends TimestampedEntity {
  @Copy() text: string;
  @Copy() authorId: string;
}

// Both Article and Comment get timestamp validation
```

**Audit Trail Base:**

```typescript
class Auditable {
  @CoerceType('string')
  @ValidateRequired()
  createdBy: string;

  @CoerceType('string')
  lastModifiedBy: string;

  @CoerceType('date')
  createdAt: Date;

  @CoerceType('date')
  lastModifiedAt: Date;
}

class Order extends Auditable {
  // All audit fields inherited
  @Copy() orderId: string;
  @Copy() total: number;
}
```

### Overriding Parent Decorators

Child classes can override parent property decorators entirely by redeclaring the property with new decorators. For details on how this override mechanism works, see the Advanced Guide section on Inheritance Cascade Mechanics.

```typescript
class Base {
  @CoerceTrim()
  value: string;
}

class Child extends Base {
  // Completely replace parent decorators
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateLength(5, 20)
  value: string;
}
```

## Conclusion: You Are the Architect

You've now moved beyond simple validation into the realm of data architecture. You have the tools to:

*   **Reshape** any input structure to match your ideal domain models using reparenting.
*   **Target** transformations with precision to keys, values, or parsed segments of a string.
*   **Compose** styles and context to create powerful, hygienic patterns.
*   **Scale** your validation rules across your entire application with a predictable cascade.

With these intermediate patterns, you are well-equipped to handle the complex and messy data of modern applications. For even more advanced use cases, consult the full API reference documentation.
