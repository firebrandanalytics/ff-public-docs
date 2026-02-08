# Data Validation Library - API Reference

This document provides a complete API reference for the data validation library. For tutorials and usage patterns, see:
- [Getting Started Guide](./validation-library-getting-started.md) - Core concepts and basic usage
- [Intermediate Guide](./validation-library-intermediate.md) - Advanced patterns and scaling

## Table of Contents

- [ValidationFactory](#validationfactory)
- [Coercion Decorators](#coercion-decorators)
- [Collection Decorators](#collection-decorators)
- [Validation Decorators](#validation-decorators)
- [AI Decorators](#ai-decorators)
- [Data Source Decorators](#data-source-decorators)
- [Context Decorators](#context-decorators)
- [Conditional Decorators](#conditional-decorators)
- [Class-Level Decorators](#class-level-decorators)
- [Text Normalization](#text-normalization)
- [Matching Strategies](#matching-strategies)
- [Type Definitions](#type-definitions)
- [Error Types](#error-types)

---

## ValidationFactory

The central class for creating validated instances from raw data.

### Constructor

```typescript
new ValidationFactory(config?: ValidationConfig)
```

**ValidationConfig**

```typescript
interface ValidationConfig {
  aiHandler?: AIHandler;                    // Global AI transformation handler
  aiValidationHandler?: AIValidationHandler; // Global AI validation handler
  styles?: { [name: string]: ValidationStyle }; // Named validation styles
  globals?: GlobalValidationRule[];         // Global validation rules
  decoratorDefaults?: DecoratorDefaults;    // Default options for decorators
  defaultTransforms?: TypeDefaultTransforms; // CSS-like type defaults
}
```

### Methods

#### `create<T, Context>(targetClass, data, options?)`

Creates a validated instance from raw data.

```typescript
async create<T extends object, Context = any>(
  targetClass: new () => T,
  data: any,
  options?: ValidationOptions<Context>
): Promise<T>
```

**Parameters:**
- `targetClass` - The class to instantiate
- `data` - Raw input data (any shape)
- `options` - Validation options including context

**Example:**
```typescript
const factory = new ValidationFactory();
const user = await factory.create(UserRegistration, rawInput, {
  context: { allowedDomains: ['example.com'] }
});
```

#### `validate<T, Context>(instance, options?)`

Re-validates an existing instance.

```typescript
async validate<T extends object, Context = any>(
  instance: T,
  options?: ValidationOptions<Context>
): Promise<T>
```

#### `getMergedDecoratorOptions<T>(decoratorType, decoratorOptions?)`

Merges decorator options with factory defaults.

```typescript
getMergedDecoratorOptions<T>(
  decoratorType: string,
  decoratorOptions?: Partial<T>
): T
```

#### `getAIHandler(options)`

Gets the effective AI handler (per-request overrides global).

```typescript
getAIHandler(options: ValidationOptions): AIHandler | undefined
```

#### `getAIValidationHandler(options)`

Gets the effective AI validation handler.

```typescript
getAIValidationHandler(options: ValidationOptions): AIValidationHandler | undefined
```

### ValidationOptions

```typescript
interface ValidationOptions<Context = any> {
  context?: Context;                          // Runtime context data
  engine?: 'single-pass' | 'convergent';      // Validation engine (default: 'convergent')
  maxIterations?: number;                     // Max iterations for convergent engine
  aiHandler?: AIHandler;                      // Per-request AI handler
  aiValidationHandler?: AIValidationHandler;  // Per-request AI validation handler
}
```

---

## Coercion Decorators

Decorators that transform values. Execute top-to-bottom on each property.

### @Coerce(coercionFn, description?)

Generic coercion decorator. Multiple `@Coerce` decorators execute in order.

```typescript
@Coerce(coercionFn: (value: any) => T, description?: string)
```

**Example:**
```typescript
class Product {
  @Coerce((v) => v.toUpperCase(), 'Convert to uppercase')
  @Coerce((v) => v.trim(), 'Trim whitespace')
  sku: string;
}
```

### @Set(value)

Assigns a constant value to a property. Unlike `@Coerce`, which takes a function, `@Set` directly assigns the provided value. Particularly useful within conditional blocks.

```typescript
@Set(value: T)
```

**Example:**
```typescript
class Order {
  status: string;

  @If('status', 'pending')
    @Set('Awaiting shipment')
  @ElseIf('status', 'active')
    @Set('In transit')
  @Else()
    @Set('N/A')
  @EndIf()
  message: string;
}
```

**Note:** The value parameter can be any type, including functions themselves (not as callbacks). If you need to compute the value dynamically, use `@Coerce(() => computedValue)` instead.

### @CoerceType(targetType, options?)

Converts values to the specified type, with nullish handling and extra primitives.

```typescript
@CoerceType(
  targetType: 'string' | 'number' | 'boolean' | 'date' | 'url' | 'bigint' | 'regexp',
  options?: CoerceTypeOptions
)
```

**Shared Options:**
```typescript
interface CoerceTypeOptions {
  coerceNullish?: boolean; // Default: true (''/0/false for primitives; dates error)
}
```
- Nullish defaults cascade: decorator → class `@CoerceTypeDefaults` → factory defaults.
- With `@ValidateRequired` placed before `@CoerceType`, nullish fails fast; placed after, it observes the coerced value.

**Boolean Options:**
```typescript
interface BooleanCoercionOptions extends CoerceTypeOptions {
  strict?: boolean;                     // Shorthand for strictness: 'strict'
  strictness?: 'strict' | 'standard';   // Default: 'standard'
  customMap?: (value: any) => boolean | undefined;
}
```
- Standard: accepts true/false, 1/0, "true"/"false", "1"/"0", yes/no, y/n, on/off, t/f
- Strict: accepts only true/false, 1/0, "true"/"false", "1"/"0"

**Date/URL/RegExp Options:**
```typescript
interface DateCoercionOptions extends CoerceTypeOptions {
  format?: 'loose' | 'iso' | 'iso-datetime' | 'iso-date' | 'timestamp' | RegExp;
  timezone?: 'utc' | 'local';    // For date-only strings
  parser?: (value: unknown) => Date;
  allowTimestamps?: boolean;     // Default: true for 'loose'
}

interface UrlCoercionOptions extends CoerceTypeOptions {
  base?: string; // optional base for relative URLs
}

interface RegExpCoercionOptions extends CoerceTypeOptions {
  flags?: string; // flags used when string -> regexp
}
```

**Examples:**
```typescript
class Order {
  @CoerceType('number')
  quantity: number; // "42" -> 42

  @CoerceType('boolean', { strictness: 'strict' })
  confirmed: boolean; // "true" -> true, "yes" -> throws

  @CoerceType('date', { format: 'iso-date', timezone: 'utc' })
  orderDate: Date;

  @CoerceType('url', { base: 'https://example.com' })
  href: URL; // "/path" -> new URL("https://example.com/path")
}
```

### @CoerceParse(formatOrFn, options?)

Parses inbound strings into objects using the ParserRegistry. Built-in parsers: `'json'`, `'number'`, `'currency'`. Optional parsers (require registration): `'yaml'`, `'xml'`, `'html'`.

```typescript
@CoerceParse(
  formatOrFn: string | ((value: string) => any),
  options?: {
    allowNonString?: boolean;
    locale?: string;
    currency?: string;         // for 'currency' parser (default: 'USD')
    allowParentheses?: boolean;// treat "(123)" as -123 (default: true)
  }
)
```
- Defaults to only accepting strings; when `allowNonString` is true, already-parsed objects pass through.
- For `number`/`currency`, locale-aware separators are handled; currency symbols and grouping are stripped.
- For `yaml`/`xml`/`html`, use `registerYAMLParser()`, `registerXMLParser()`, or `registerHTMLParser()` first.

```typescript
import { registerYAMLParser } from '@firebrandanalytics/shared-utils/validation';

// Register optional parsers once at startup
registerYAMLParser();

class Payload {
  @CoerceParse('json')
  body: unknown; // "{ \"a\": 1 }" -> { a: 1 }

  @CoerceParse('yaml')
  config: any; // Requires registration

  @CoerceParse('number', { locale: 'de-DE' })
  total: number; // "1.234,56" -> 1234.56

  @CoerceParse('currency', { locale: 'en-US' })
  amount: number; // "$1,234.56" -> 1234.56
}
```

### @CoerceFormat(targetType, format)

Coerces first, then renders to a formatted string.

```typescript
@CoerceFormat(
  targetType: 'date' | 'number',
  format: 'iso' | 'iso-date' | Intl.DateTimeFormatOptions | Intl.NumberFormatOptions
)
```
- Dates honor embedded timezone but do not shift instants; use `timeZone` option to render in a specific zone.

```typescript
class LogLine {
  @CoerceFormat('date', { timeZone: 'UTC' })
  timestamp: string; // "2024-01-01T00:00:00-05:00" -> "1/1/2024, 5:00:00 AM"
}
```

### @CoerceTrim()

Removes leading and trailing whitespace from strings.

```typescript
@CoerceTrim()
```

**Example:**
```typescript
class User {
  @CoerceTrim()
  name: string; // "  John Doe  " -> "John Doe"
}
```

### @CoerceCase(style)

Transforms string casing.

```typescript
@CoerceCase(style: CaseStyle)

type CaseStyle = 'lower' | 'upper' | 'title' | 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant'
```

**Examples:**
```typescript
class Document {
  @CoerceCase('lower')
  email: string; // "JOHN@EXAMPLE.COM" -> "john@example.com"

  @CoerceCase('title')
  title: string; // "hello world" -> "Hello World"

  @CoerceCase('snake')
  fieldName: string; // "myFieldName" -> "my_field_name"

  @CoerceCase('constant')
  constant: string; // "my constant" -> "MY_CONSTANT"
}
```

### @CoerceRound(options?)

Rounds numbers to specified precision or nearest multiple.

```typescript
@CoerceRound(options?: RoundOptions)

interface RoundOptions {
  precision?: number;              // Decimal places (default: 0)
  mode?: 'round' | 'floor' | 'ceil'; // Rounding mode (default: 'round')
  toNearest?: number;              // Round to nearest multiple
}
```

**Examples:**
```typescript
class Product {
  @CoerceRound({ precision: 2 })
  price: number; // 19.999 -> 20.00

  @CoerceRound({ toNearest: 5, mode: 'ceil' })
  shippingCost: number; // 12 -> 15
}
```

### @CoerceFromSet(contextExtractor, options?)

Matches a value to the closest candidate from a context-provided set without losing the original type.

```typescript
@CoerceFromSet<Context = any>(
  contextExtractor: (context: Context) => any[],
  options?: CoercionFromSetOptions
)

interface CoercionFromSetOptions {
  strategy?: MatchingStrategy | 'numeric';   // String strategies or numeric distance
  caseSensitive?: boolean;                   // Default: false
  fuzzyThreshold?: number;                   // For fuzzy, default 0.6
  customMatcher?: (value: string, candidate: string) => number; // Custom string scorer
  selector?: (item: any) => any;             // Project a property before comparison but return original
  numericTolerance?: number;                 // Max allowed distance for numeric strategy
  numericRounding?: number;                  // Optional rounding precision
  customCompare?: (a: any, b: any) => number;// Custom distance for objects (lower is better)
  ambiguityTolerance?: number;               // Accept near-ties within tolerance
  synonyms?: Record<string, string[]>;       // Alternate labels mapping to a candidate (string strategies)
}
```
- Exact matches short-circuit; string strategies require string inputs.
- Number strategy picks the closest value and errors on ambiguity; selector/customCompare enable object matching.

**Example:**
```typescript
interface InventoryContext {
  products: { code: string; id: number }[];
}

class Order {
  @CoerceFromSet<InventoryContext>(
    (ctx) => ctx.products,
    { strategy: 'selector', selector: (p) => p.code }
  )
  product!: { code: string; id: number }; // "widgit" -> { code: "WIDGIT", id: 2 }
}
```

Use `synonyms` to accept aliases without losing your canonical values:

```typescript
class NotificationPrefs {
  @CoerceFromSet(() => ['email', 'phone', 'sms'], {
    strategy: 'fuzzy',
    synonyms: {
      sms: ['text', 'text message', 'txt'],
      phone: ['call'],
    },
  })
  channel!: 'email' | 'phone' | 'sms';
}
```

### @CoerceArrayElements(elementCoercion)

Applies a coercion function to each element in an array.

```typescript
@CoerceArrayElements(elementCoercion: (value: any) => any)
```

**Example:**
```typescript
class TagList {
  @CoerceArrayElements((tag) => tag.toLowerCase().trim())
  tags: string[];
}
```

---

## Collection Decorators

Decorators for transforming and manipulating arrays and collections.

### @Join(separator)

Joins an array of strings into a single string.

```typescript
@Join(separator: string)
```

**Example:**
```typescript
class Tags {
  @Join(',')
  @CoerceTrim()
  tags: string[]; // ["a", "b", "c"] -> "a,b,c"
}
```

### @Map(callback)

Applies a callback function to each element in an array.

```typescript
@Map(callback: (value: any, index: number, array: any[]) => any)
```

**Example:**
```typescript
class Numbers {
  @Map((n) => n * 2)
  values: number[]; // [1, 2, 3] -> [2, 4, 6]
}
```

### @Filter(callback)

Filters elements in an array based on a predicate.

```typescript
@Filter(callback: (value: any, index: number, array: any[]) => boolean)
```

**Example:**
```typescript
class Numbers {
  @Filter((n) => n > 10)
  values: number[]; // [5, 15, 8, 20] -> [15, 20]
}
```

---

## Validation Decorators

Decorators that validate values without transforming them (unless specified).

### @Validate(validationFn, description?, options?)

Generic validation decorator.

```typescript
@Validate<T = any>(
  validationFn: (value: T, obj: any) => boolean | string | Error,
  description?: string,
  options?: { canTransform?: boolean }
)
```

**Return Values:**
- `true` - Validation passed
- `false` - Validation failed (generic error)
- `string` - Validation failed with custom message
- `Error` - Validation failed with error object

**Example:**
```typescript
class User {
  @Validate(
    (age) => age >= 18 || 'Must be 18 or older',
    'Age validation'
  )
  age: number;
}
```

### @ValidateRequired(options?)

Ensures value is not null, undefined, or empty string. Runs **before** any coercions.

```typescript
@ValidateRequired(options?: CommonDecoratorOptions)

interface CommonDecoratorOptions {
  order?: number;        // Explicit execution order
  description?: string;  // Debugging description
}
```

**Example:**
```typescript
class Order {
  @ValidateRequired()
  orderId: string;
}
```

### @ValidateRange(min?, max?)

Validates that a number falls within a range (inclusive).

```typescript
@ValidateRange(min?: number, max?: number)
```

**Example:**
```typescript
class User {
  @ValidateRange(18, 120)
  age: number;

  @ValidateRange(0) // No upper limit
  balance: number;
}
```

### @ValidateLength(min?, max?)

Validates string or array length.

```typescript
@ValidateLength(min?: number, max?: number)
```

**Example:**
```typescript
class Post {
  @ValidateLength(1, 280)
  content: string;

  @ValidateLength(1, 10)
  tags: string[];
}
```

### @ValidatePattern(pattern, message?)

Validates string against a regular expression.

```typescript
@ValidatePattern(pattern: RegExp, message?: string)
```

**Example:**
```typescript
class User {
  @ValidatePattern(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    'Invalid email format'
  )
  email: string;

  @ValidatePattern(/^\d{3}-\d{3}-\d{4}$/)
  phone: string;
}
```

### @ValidateAsync(validationFn, description?, options?)

Asynchronous validation for I/O operations (database lookups, API calls).

```typescript
@ValidateAsync<T = any>(
  validationFn: (value: T, obj: any) => Promise<boolean | string | Error>,
  description?: string,
  options?: { canTransform?: boolean }
)
```

**Example:**
```typescript
class User {
  @ValidateAsync(async (email, obj) => {
    const exists = await checkEmailInDatabase(email);
    return !exists || 'Email already registered';
  })
  email: string;
}
```

---

## AI Decorators

Decorators that leverage AI/LLM capabilities for transformation and validation.

### @AITransform(prompt, options?)

Transforms property value using AI. The AI output is then re-coerced through all subsequent coercion decorators.

```typescript
@AITransform<TMetadata = any>(
  prompt: PromptDefinition,
  options?: AITransformOptions<TMetadata>
)

type PromptDefinition =
  | string
  | ((params: AIHandlerParams) => string)
  | object;

interface AITransformOptions<TMetadata = any> {
  maxRetries?: number;        // Default: 2
  order?: number;
  metadata?: TMetadata;
  description?: string;
  dependsOn?: string[];       // Property dependencies
}
```

**Example:**
```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    const response = await llm.complete(prompt);
    return response;
  }
});

class Order {
  @AITransform((params) =>
    `Extract the quantity as a number from: "${params.value}". Return only the number.`
  )
  @CoerceType('number')
  @ValidateRange(1, 1000)
  quantity: number;
}
```

**Automatic Retry:** If the AI output fails subsequent validation, the library automatically retries with the validation error as context.

### @AIValidate(prompt, options?)

Validates property value using AI without modifying it.

```typescript
@AIValidate<TMetadata = any>(
  prompt: PromptDefinition,
  options?: AIValidateOptions<TMetadata>
)

interface AIValidateOptions<TMetadata = any> {
  maxRetries?: number;        // Default: 1
  order?: number;
  metadata?: TMetadata;
  description?: string;
  dependsOn?: string[];
}
```

**Example:**
```typescript
class Review {
  @AIValidate((params) =>
    `Does this review contain inappropriate content? "${params.value}". Answer "valid" or explain the issue.`
  )
  content: string;
}
```

### AI Presets

Thin wrappers over `@AITransform` to build stable prompts for common jobs. They respect the same handler and retry behavior.

```typescript
@AITranslate(language: string)
@AIRewrite(style?: string)
@AISummarize(length?: 'short' | 'medium' | 'long')
@AIClassify(labels: string[], coerceOptions?: CoercionFromSetOptions) // auto @CoerceFromSet
@AIExtract(fields: string[] | object)
@AISpellCheck()
@AIJSONRepair()
```

```typescript
class Copy {
  @AITranslate('japanese') title!: string;
  @AISummarize('short') blurb!: string;
  @AIClassify(['news', 'opinion', 'sports'], { strategy: 'fuzzy' }) section!: string;
}
```

### @Catch(handler) and @AICatchRepair(prompt?, options?)

Attach to a property to intercept coercion/validation errors and repair the value (or rethrow).

```typescript
@Catch((err, value, ctx) => recover(value) ?? err)
@AICatchRepair(prompt?: PromptDefinition, options?: AITransformOptions)
```
- Runs once when a `ValidationError`/coercion error occurs on the property.
- Return a repaired value to continue, or throw to surface the failure.
- `@AICatchRepair` builds a repair prompt and delegates to `AITransform`; it replays subsequent decorators.

### AIHandlerParams

Parameters passed to AI handler functions.

```typescript
interface AIHandlerParams<TValue, TContext, TMetadata, TInstance> {
  value: TValue;                    // Current value
  instance: TInstance;              // Partial instance being built
  context: TContext;                // Runtime context
  propertyKey: string;              // Property name
  className: string;                // Class name
  previousError?: ValidationError; // Error from previous attempt
  attemptNumber: number;            // Current retry attempt (1-based)
  maxRetries: number;               // Maximum retries configured
  metadata: TMetadata;              // Custom metadata
  schema?: any;                     // Zod schema if available
}
```

---

## Data Source Decorators

Decorators that control where property values come from.

### @Copy(options?)

Copies property value directly from raw input data.

```typescript
@Copy(options?: CommonDecoratorOptions)
```

**Example:**
```typescript
class User {
  @Copy()
  id: string;
}
```

> Tip: Use `@ManageAll` on the class when you want every field managed without sprinkling `@Copy` everywhere.

### @Staging()

Marks a property as temporary: it participates in sourcing/coercion/validation but is removed from the final instance after validation. Useful for intermediate values (parsed payloads, helper flags).

```typescript
class Payload {
  @Copy() @Staging() raw!: string;                     // used during validation only
  @DerivedFrom('raw', (v) => v.trim()) body!: string;  // survives
}
// Result will have `body`, not `raw`
```

### @DerivedFrom(source, deriveFn?, options?)

Derives property value from one or more source properties. Supports JSONPath expressions.

```typescript
@DerivedFrom(
  source: string | string[],
  deriveFn?: (source: any, ctx: { raw: any; instance: any }) => any,
  options?: CommonDecoratorOptions
)
```

**Simple JSONPath:**
```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  @DerivedFrom('$.customer.contact.email')
  customerEmail: string;

  @DerivedFrom('$.items[0].sku')
  firstSku: string;
}
```

**Fallback Paths:**
```typescript
class Order {
  @DerivedFrom(['$.order_id', '$.orderId', '$.id'])
  orderId: string; // First non-undefined value wins
}
```

**Custom Derivation Function:**
```typescript
const PRICE_LOOKUP: Record<string, number> = {
  'WID-001': 19.99,
  'GAD-002': 49.5,
};

class Order {
  @DerivedFrom('sku', (sku, ctx) => {
    const fallback = typeof ctx.raw?.basePrice === 'number' ? ctx.raw.basePrice : 0;
    return PRICE_LOOKUP[sku] ?? fallback;
  })
  basePrice: number;
}
```

> `deriveFn` receives the resolved source value and a `{ raw, instance }` object. Use `ctx.raw` to inspect the original input or `ctx.instance` to look at already-processed properties.

### @RenameFrom(sourceKey, options?)

Simple property rename. Alias for `@DerivedFrom`.

```typescript
@RenameFrom(sourceKey: string, options?: { order?: number })
```

**Example:**
```typescript
class User {
  @RenameFrom('user_name')
  username: string;
}
```

### @JSONPath(path, options?)

Extracts value from raw input using JSONPath expression.

```typescript
@JSONPath(path: string, options?: JSONPathOptions)

interface JSONPathOptions {
  resultType?: 'value' | 'array'; // Default: 'value'
}
```

**Example:**
```typescript
class Order {
  @JSONPath('$.items[*].quantity', { resultType: 'array' })
  allQuantities: number[];
}
```

### @CollectProperties(options)

Collects properties from multiple JSONPath sources. Automatically excludes properties that have decorators on the current class.

```typescript
@CollectProperties(options: CollectPropertiesOptions)

interface CollectPropertiesOptions {
  sources: Array<{
    path: string;           // JSONPath expression
    exclude?: string[];     // Properties to exclude
  }>;
  includeDefinedProperties?: boolean; // Default: false
  transformFn?: (collected: any) => any;
  description?: string;
  order?: number;
}
```

**Example:**
```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  @CollectProperties({ sources: [{ path: '$' }] })
  metadata: Record<string, any>; // Everything except orderId
}
```

### @Merge(options)

Merges values from other properties into this one. Runs after other value-populating decorators.

```typescript
@Merge(options: MergeOptions)

interface MergeOptions {
  sources: string[];                      // Property keys to merge from
  mergeFunction?: (values: any[]) => any; // Custom merge logic
}
```

**Default Merge Strategies:**
- Objects: `Object.assign()`
- Arrays: `concat()`
- Strings: `join(' ')`
- Primitives: Last non-undefined value

**Example:**
```typescript
class Profile {
  @Copy()
  firstName: string;

  @Copy()
  lastName: string;

  @Merge({
    sources: ['firstName', 'lastName'],
    mergeFunction: ([first, last]) => `${first} ${last}`
  })
  fullName: string;
}
```

---

## Context Decorators

Decorators that change the context in which subsequent decorators operate. Contexts can be applied to properties **or to a class**; class-level usage canonicalizes the raw input before any property-level sourcing/validation (base-class canonicalization happens before discriminated-union resolution).

### @Keys()

Applies subsequent decorators to object keys. Supported as property or class decorator.

```typescript
@Keys()
```

**Example (property):**
```typescript
class HttpRequest {
  @Keys()
  @CoerceTrim()
  @CoerceCase('lower')
  headers: Record<string, string>;
  // { "  Content-Type  ": "..." } -> { "content-type": "..." }
}
```

**Example (class):**
```typescript
@Keys()
@CoerceCase('lower')
class Animal {
  @Copy()
  name!: string;
}
// Handles { "NAME": "Fido" } before property decorators run.
```

### @Values()

Applies subsequent decorators to object values or array elements. Supported as property or class decorator.

```typescript
@Values()
```

**Example:**
```typescript
class TagContainer {
  @Values()
  @CoerceTrim()
  @CoerceCase('lower')
  tags: string[];
  // ["  TAG-ONE  ", "TAG-TWO"] -> ["tag-one", "tag-two"]
}
```

### @RecursiveKeys()

Recursively applies subsequent decorators to keys of the current object/map and all descendants (objects and arrays). Available on properties or classes. Use for whole-graph canonicalization; for nested opt-in, prefer `@Values()` + `@UseStyle`.

```typescript
@RecursiveKeys()
@CoerceCase('lower')
class Config {
  @Copy()
  settings!: Record<string, unknown>;
}
```

### @RecursiveValues()

Recursively applies subsequent decorators to values (objects, arrays, primitives) from the current node downward. Works on properties or classes. Useful for “lowercase everything” normalization.

```typescript
@RecursiveValues()
@CoerceCase('lower')
class Payload {
  @Copy()
  data!: unknown;
}
```

> Note: Context pipelines disallow decorators that don’t make sense on keys/values (e.g., `@DerivedFrom`, `@CollectProperties`, `@Merge`, `@Copy` in key/value context; `@DependsOn` is ignored for error-free contexts). Coercions, validations, and string/array transforms are fair game.

### @Split(separator, options?)

Splits string by delimiter, applies subsequent decorators to segments, returns array.

```typescript
@Split(separator: string, options?: SplitOptions)

interface SplitOptions {
  emptyStringBehavior?: 'empty-array' | 'single-empty-element';
  quotes?: string | string[];           // Quote chars to protect
  brackets?: BracketPair | BracketPair[]; // Bracket pairs to protect
  escapeChar?: string;                  // Default: '\\'
  stripQuotes?: boolean;                // Default: true
  stripBrackets?: boolean;              // Default: false
  description?: string;
}

type BracketPair = '()' | '[]' | '{}' | '<>' | string;
```

**Example:**
```typescript
class StyleRule {
  @Split(';', {
    quotes: ['"', "'"],
    brackets: ['()', '[]'],
    stripQuotes: true
  })
  @CoerceTrim()
  rules: string[];
  // 'color: rgb(255, 0, 0); font: "Times New Roman"'
  // -> ['color: rgb(255, 0, 0)', 'font: Times New Roman']
}
```

### @Delimited(separator, options?)

Splits string by delimiter, applies decorators to segments, rejoins with same delimiter.

```typescript
@Delimited(separator: string, options?: DelimitedOptions)

interface DelimitedOptions {
  quotes?: string | string[];
  brackets?: BracketPair | BracketPair[];
  escapeChar?: string;        // Default: '\\'
  stripQuotes?: boolean;      // Default: true
  stripBrackets?: boolean;    // Default: false
  description?: string;
}
```

**Example:**
```typescript
class CsvRow {
  @Delimited(',', { quotes: ['"'] })
  @CoerceTrim()
  row: string;
  // '"  value1  ", value2,  value3  ' -> 'value1,value2,value3'
}
```

---

## Conditional Decorators

Decorators that apply rules conditionally based on runtime values. Conditional blocks consist of `@If`, optional `@ElseIf` and `@Else` branches, and `@EndIf` markers.

### @If(condition)

Starts a conditional block. Decorators between `@If` and the next branch marker (`@ElseIf`, `@Else`, or `@EndIf`) are applied only if the condition is true.

**Overloads:**

```typescript
// Check current value equality
@If(expectedValue: any)

// Check current value with predicate
@If(predicate: (value: any, ctx?: ConditionalContext) => boolean)

// Check referenced property/JSONPath equality
@If(topic: string, expectedValue: any)

// Check referenced property/JSONPath with predicate
@If(topic: string, predicate: (value: any, ctx?: ConditionalContext) => boolean)

// Check multiple properties with predicate
@If(topics: string[], predicate: (values: any[], ctx?: ConditionalContext) => boolean)
```

**Parameters:**
- `expectedValue` - Value to compare against (strict equality; if `expectedValue` is an array and the checked value is scalar, it is treated as an in-list check)
- `predicate` - Function returning boolean
- `topic` - Property name or JSONPath expression
- `topics` - Array of property names/JSONPath expressions
- `ctx` - Optional context object with `raw`, `instance`, and user context

**Topic Resolution:**
- **No topic**: Checks current property's value in progress
- **Property name** (e.g., `'status'`): Creates intra-cycle dependency, gets completed value
- **Self-reference** (topic === property name): Gets value in progress
- **JSONPath** (starts with `'$'`): References original input, no intra-cycle dependency

**Examples:**
```typescript
// Equality check on current value
@If('active')
@CoerceType('number')
@EndIf()
status: string | number;

// Lambda on current value
@If((val: string) => val.length > 100)
@AITransform('Summarize')
@EndIf()
text: string;

// Check another property
@If('type', (t) => t === 'premium')
@Validate(isPremiumValidator)
@EndIf()
features: string[];

// JSONPath to input
@If('$.metadata.version', (v: number) => v >= 2)
@Set('V2_FORMAT')
@EndIf()
format: string;

// Multiple properties
@If(['price', 'quantity'], ([p, q]: any[]) => p * q > 1000)
@Validate(() => 'Requires approval')
@EndIf()
orderValue: number;
```

### @ElseIf(condition)

Adds an alternative conditional branch. Evaluated if previous `@If` or `@ElseIf` conditions were false. Accepts the same overloads as `@If`.

**Important:** `@ElseIf` cannot change the topic being checked - this maintains static dependency graphs.

**Example:**
```typescript
const STATUSES = ['draft', 'pending', 'active'] as const;
type Status = typeof STATUSES[number];

class Order {
  @CoerceFromSet(STATUSES)
  status: Status;

  @If('status', 'active')
    @CoerceType('date')
  @ElseIf('status', 'pending')
    @Set('TBD')
  @Else()
    @Set('N/A')
  @EndIf()
  shippingDate: Date | string;
}
```

### @Else()

Provides a default branch when all previous conditions are false. No parameters.

**Example:**
```typescript
@If((val: number) => val > 100)
  @Validate(isHighValue)
@Else()
  @Validate(isStandardValue)
@EndIf()
amount: number;
```

### @EndIf()

Marks the end of a conditional block. Must appear after the property, closest to it in the decorator stack.

**Example:**
```typescript
@If('status', (s) => s === 'active')
  @Validate(isRequired)
@EndIf()
@Copy()
value: string;
```

### Conditional Block Constraints

1. **No nested conditionals**: You cannot have an `@If` block inside another `@If` block
2. **Single `@Else`**: Only one `@Else` allowed per block, must be last
3. **Static dependencies**: `@ElseIf` cannot reference different properties than `@If`
4. **Sequential evaluation**: Branches are checked in order; first match wins

### Practical Patterns

**Status-based processing:**
```typescript
const ORDER_STATUSES = ['draft', 'active', 'shipped'] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

class Order {
  @CoerceFromSet(ORDER_STATUSES)
  status: OrderStatus;

  @If('status', 'shipped')
    @CoerceType('date')
    @Validate((d) => d <= new Date(), 'Cannot be future date')
  @ElseIf('status', 'active')
    @Set('Pending shipment')
  @EndIf()
  shippedDate?: Date | string;
}
```

**Self-checking transformations:**
```typescript
class Document {
  @CoerceTrim()
  @If((val: string) => val.length > 1000)
    @AITransform('Provide a brief summary')
  @EndIf()
  content: string;
}
```

**Format-based coercion:**
```typescript
const FORMATS = ['iso', 'unix', 'custom'] as const;
type DateFormat = typeof FORMATS[number];

class Event {
  @CoerceFromSet(FORMATS)
  format: DateFormat;

  @If('format', 'iso')
    @CoerceType('date')
  @ElseIf('format', 'unix')
    @Coerce((v: number) => new Date(v * 1000))
  @Else()
    @Coerce((v: string) => parseCustomDate(v))
  @EndIf()
  eventDate: Date;
}
```

---

## Class-Level Decorators

Decorators applied to classes or used for nested validation.

### @ValidatedClass(dataClass)

Explicitly marks property as containing a nested validated class. Usually auto-detected.

```typescript
@ValidatedClass(dataClass: Function)
```

**Example:**
```typescript
class Address {
  @ValidateRequired() @CoerceTrim() street: string;
  @ValidateRequired() @CoerceTrim() city: string;
}

class Customer {
  @ValidatedClass(Address)
  address: Address;
}
```

### @ValidatedClassArray(elementClass)

Marks property as array of validated class instances.

```typescript
@ValidatedClassArray(elementClass: Function)
```

**Example:**
```typescript
class OrderItem {
  @ValidateRequired() productId: string;
  @CoerceType('number') quantity: number;
}

class Order {
  @ValidatedClassArray(OrderItem)
  items: OrderItem[];
}
```

### @ManageAll(options?)

Marks properties as "managed" so defaults/styles apply without adding `@Copy` on every field.

```typescript
@ManageAll(options?: { include?: string[]; exclude?: string[] })
```

- By default, all public fields are managed; `include`/`exclude` lets you scope it.
- Managed fields still honor any property-level decorators you add.

```typescript
@ManageAll({ include: ['name', 'code'] })
class Country {
  name!: string;      // Managed without @Copy
  code!: string;
  note?: string;      // Not managed
}
```

### @CoerceTypeDefaults(options)

Sets class-level defaults for `@CoerceType`, cascading below factory defaults and above per-property options.

```typescript
@CoerceTypeDefaults({ coerceNullish: false })
class Payload {
  @CoerceType('string') name!: string; // null stays null unless overridden
}
```

### @UseStyle(style)

Applies a reusable validation style to a property.

```typescript
@UseStyle(style: new () => any)
```

**Example:**
```typescript
// Define reusable style
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

// Apply to multiple properties
class User {
  @UseStyle(EmailStyle)
  email: string;

  @UseStyle(EmailStyle)
  alternateEmail: string;
}
```

### @DefaultTransforms(transforms)

Sets type-based default transforms for a class. Creates a CSS-like cascade: Factory < Class < Property decorators.

```typescript
@DefaultTransforms(transforms: TypeDefaultTransforms)

interface TypeDefaultTransforms {
  string?: Function;
  number?: Function;
  boolean?: Function;
  [key: string]: Function | undefined;
}
```

**Example:**
```typescript
class TrimStyle { @CoerceTrim() value: string; }

@DefaultTransforms({
  string: TrimStyle
})
class User {
  @Copy() name: string;    // Auto-trimmed
  @Copy() email: string;   // Auto-trimmed
}
```

### @ObjectRule(validationFn, description?)

Adds object-level validation that runs after all property validations.

```typescript
@ObjectRule(
  validationFn: (obj: any) => boolean | string | Error | void,
  description?: string
)
```

**Example:**
```typescript
@ObjectRule(function(this: Order) {
  if (this.endDate < this.startDate) {
    return 'End date must be after start date';
  }
  return true;
}, 'Date range validation')
class Order {
  @CoerceType('date') startDate: Date;
  @CoerceType('date') endDate: Date;
}
```

### @CrossValidate(dependencies, validationFn, description?)

Property-level validation that depends on multiple properties.

```typescript
@CrossValidate(
  dependencies: string[],
  validationFn: (obj: any) => boolean | string | Error | void,
  description?: string
)
```

**Example:**
```typescript
class Subscription {
  @Copy() plan: string;

  @CrossValidate(['plan'], (obj) => {
    if (obj.plan === 'premium' && obj.seats < 5) {
      return 'Premium plan requires at least 5 seats';
    }
    return true;
  })
  @CoerceType('number')
  seats: number;
}
```

### @DependsOn(...propertyKeys)

Declares manual dependencies for a property. Most decorators (e.g., `@DerivedFrom`, `@Merge`, conditionals) automatically record their dependencies. Use `@DependsOn` only when your logic references other properties indirectly (like inside an AI prompt or custom lambda) and the engine cannot infer the relationship.

```typescript
@DependsOn(...propertyKeys: string[])
```

**Example:**
```typescript
class InvoiceSummary {
  @Copy() currency: string;

  @DependsOn('currency')
  @AITransform((params, ctx) =>
    `Summarize this invoice total (${params.value}) using ${ctx.instance.currency}.`
  )
  amountSummary: string;
}
```

The `@AITransform` callback reads `currency` from the instance at runtime, so we manually declare the dependency to ensure this transform reruns whenever `currency` changes. When using decorators that already list their sources (like `@DerivedFrom('sku', ...)`), `@DependsOn` is unnecessary.

### @UseSinglePassValidation()

Uses single-pass validation engine (vs. default convergent).

```typescript
@UseSinglePassValidation()
```

### @UseConvergentValidation()

Uses convergent validation engine (default).

```typescript
@UseConvergentValidation()
```

### @ValidateClass(rules)

Applies validation styles to map keys/values.

```typescript
@ValidatedClass(rules: Array<{
  on: 'key' | 'value';
  ofType: any;
  style: new () => any;
}>)
```

### @DiscriminatedUnion(options)

Defines a discriminated union for polymorphic class creation.

```typescript
@DiscriminatedUnion(options: DiscriminatedUnionOptions)

interface DiscriminatedUnionOptions {
  discriminator: string;
  map: Record<string, new () => any>;
}
```

**Example:**
```typescript
@DiscriminatedUnion({
  discriminator: 'type',
  map: {
    'dog': Dog,
    'cat': Cat
  }
})
class Animal {
  @Copy() type: string;
  @Copy() name: string;
}
```

### @Discriminator(value)

Marks a property as the discriminator for a class. Used when passing an array of classes to `ValidationFactory.create`.

```typescript
@Discriminator(value: string)
```

**Example:**
```typescript
class Cat {
  @Discriminator('cat')
  type: string;
}

// Usage:
await factory.create([Cat, Dog], data);
```

### @Examples(examples, description?)

Provides example values for error messages and AI context.

```typescript
@Examples(examples: any[], description?: string)
```

**Example:**
```typescript
class Order {
  @Examples(['ORD-001', 'ORD-002'], 'Order ID format')
  @ValidatePattern(/^ORD-\d{3}$/)
  orderId: string;
}
```

---

## Text Normalization

Built-in text normalizers for common formats.

### @NormalizeText(normalizerName)

Applies a registered text normalizer.

```typescript
@NormalizeText(normalizerName: string)
```

### @NormalizeTextChain(normalizerNames)

Applies multiple text normalizers in sequence.

```typescript
@NormalizeTextChain(normalizerNames: string[])
```

### Built-in Normalizers

| Name | Description | Example |
|------|-------------|---------|
| `email` | Lowercase and trim | `"  JOHN@EXAMPLE.COM  "` -> `"john@example.com"` |
| `phone` | Remove non-digit characters | `"(555) 123-4567"` -> `"5551234567"` |
| `phone-formatted` | Format to standard pattern | `"5551234567"` -> `"(555) 123-4567"` |
| `credit-card` | Remove spaces/dashes, mask | `"4111-1111-1111-1111"` -> `"************1111"` |
| `currency` | Normalize currency values | `"$1,234.56"` -> `"1234.56"` |
| `ssn` | Format SSN | `"123456789"` -> `"123-45-6789"` |
| `url` | Normalize URL | Adds protocol, normalizes case |
| `unicode-nfc` | Unicode NFC normalization | Composed form |
| `unicode-nfd` | Unicode NFD normalization | Decomposed form |
| `whitespace` | Normalize whitespace | Multiple spaces -> single space |
| `zip-code` | Format ZIP code | `"123456789"` -> `"12345-6789"` |

### Custom Normalizers

```typescript
interface TextNormalizer {
  name: string;
  description: string;
  normalize(input: string): string;
}

class TextNormalizerRegistry {
  static register(normalizer: TextNormalizer): void
  static get(name: string): TextNormalizer | undefined
  static list(): string[]
}
```

**Example:**
```typescript
TextNormalizerRegistry.register({
  name: 'slug',
  description: 'Convert to URL slug',
  normalize: (input) => input.toLowerCase().replace(/\s+/g, '-')
});

class Article {
  @NormalizeText('slug')
  urlSlug: string;
}
```

---

## Matching Strategies

Strategies for matching values in `@CoerceFromSet`.

### Available Strategies

| Strategy | Description |
|----------|-------------|
| `'exact'` | Exact match (case-sensitive/insensitive) |
| `'fuzzy'` | Levenshtein distance-based fuzzy matching |
| `'contains'` | Candidate contains input |
| `'beginsWith'` | Candidate starts with input |
| `'endsWith'` | Candidate ends with input |
| `'regex'` | Input treated as regex pattern |
| `'custom'` | Custom matcher function |

### Property Matching via `@MatchingStrategy`

Attach `@MatchingStrategy` to a property (or place it inside a class-level `@Keys`/`@RecursiveKeys` context) to control how raw input keys are matched without mutating the payload. It applies to simple root lookups in `@Copy`, `@DerivedFrom('name')`, simple JSONPath leaf access like `$.name`, and discriminator detection. Deeper JSONPath paths remain exact for now. Fuzzy matching defaults to a `0.8` threshold unless overridden, and ambiguous matches throw.

```typescript
@Keys()
@MatchingStrategy('insensitive')      // case-insensitive key matching for the class
class Animal {
  @Copy()
  type!: string;

  @MatchingStrategy({ strategy: 'fuzzy', threshold: 0.5 }) // per-property override
  @Copy()
  name!: string;
}
// Matches { "TYPE": "dog", "nmae": "Fido" } without rewriting the input object.
```

### Matching Functions

```typescript
function executeMatchingStrategy(
  input: string,
  candidates: string[],
  strategy: MatchingStrategy,
  caseSensitive: boolean,
  customMatcher?: (value: string, candidate: string) => number
): MatchResult[]

interface MatchResult {
  value: string;
  score: number;  // 0-1, higher is better
}

function findBestMatches(
  results: MatchResult[],
  threshold: number,
  ambiguityTolerance?: number  // Default: 0.1
): MatchResult[]
```

**Ambiguity Handling:** If multiple candidates score within `ambiguityTolerance` of each other, a `CoercionAmbiguityError` is thrown.

---

## Type Definitions

### AIHandler

```typescript
type AIHandler<TValue = any, TContext = any, TMetadata = any, TInstance = any, TPrompt = any> =
  (
    params: AIHandlerParams<TValue, TContext, TMetadata, TInstance>,
    prompt: TPrompt
  ) => Promise<TValue>;
```

### AIValidationHandler

```typescript
type AIValidationHandler<TValue = any, TContext = any, TMetadata = any, TInstance = any, TPrompt = any> =
  (
    params: AIHandlerParams<TValue, TContext, TMetadata, TInstance>,
    prompt: TPrompt
  ) => Promise<boolean | string | Error>;
```

### CommonDecoratorOptions

```typescript
interface CommonDecoratorOptions {
  order?: number;        // Explicit execution order (lower = earlier)
  description?: string;  // Description for debugging
}
```

### CoercionFunction

```typescript
type CoercionFunction<T = any> = (value: any) => T;
```

### ValidationFunction

```typescript
type ValidationFunction<T = any> = (value: T, obj: any) => boolean | string | Error;
```

### AsyncValidationFunction

```typescript
type AsyncValidationFunction<T = any> = (value: T, obj: any) => Promise<boolean | string | Error>;
```

### ObjectValidationFunction

```typescript
type ObjectValidationFunction = (obj: any) => boolean | string | Error | void;
```

---

## Error Types

### ValidationError

Thrown when validation fails. Extends `FFLLMFixableError`.

```typescript
class ValidationError extends FFLLMFixableError {
  message: string;
  propertyPath: string;
  rule: string;
  actualValue: any;
  examples?: any[];
  examplesDescription?: string;
}
```

**Example:**
```typescript
try {
  await factory.create(User, { age: 15 });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message);      // "Age must be between 18 and 120"
    console.log(error.propertyPath); // "age"
    console.log(error.actualValue);  // 15
    console.log(error.rule);         // "ValidateRange"
  }
}
```

### FFError

Base class for all FireFoundry errors.

### FFLLMFixableError

Error that can potentially be fixed by LLM retry.

```typescript
class FFLLMFixableError extends Error {
  message: string;
  suggestedPromptAddition?: string;
}
```

### FFLLMNonFixableError

Error that cannot be fixed by LLM.

### ConvergenceTimeoutError

Thrown when convergent engine doesn't stabilize within `maxIterations`.

### OscillationError

Thrown when convergent engine detects oscillating values.

### CoercionAmbiguityError

Thrown when multiple equally valid coercion matches are found.

```typescript
class CoercionAmbiguityError extends FFLLMFixableError {
  candidates: MatchResult[];
}
```

---

## Complete Example

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceType,
  CoerceCase,
  CoerceFromSet,
  ValidatePattern,
  ValidateRange,
  AITransform,
  DerivedFrom,
  UseStyle,
  DefaultTransforms,
  ObjectRule,
  ValidationError
} from '@firebrandanalytics/shared-utils/validation';

// Define reusable styles
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

// Define price source and context type
const PRICE_LOOKUP: Record<string, number> = {
  'WID-001': 19.99,
  'GAD-002': 29.99,
};

interface OrderContext {
  validSkus: string[];
}

// Main class with validation
@DefaultTransforms({ string: class { @CoerceTrim() value: string; } })
@ObjectRule(function(this: Order) {
  if (this.quantity > 50 && !this.bulkApproved) {
    return 'Bulk orders over 50 require approval';
  }
  return true;
})
class Order {
  @ValidateRequired()
  orderId: string;

  @UseStyle(EmailStyle)
  customerEmail: string;

  @UseStyle(SkuStyle)
  @CoerceFromSet<OrderContext>(
    (ctx) => ctx.validSkus,
    { strategy: 'fuzzy', threshold: 0.7 }
  )
  sku: string;

  @AITransform((params) =>
    `Extract the quantity as a number from: "${params.value}". Return only the number.`
  )
  @CoerceType('number')
  @ValidateRange(1, 100)
  quantity: number;

  @DerivedFrom('sku', (sku, ctx) => {
    const fallback = typeof ctx.raw?.basePrice === 'number' ? ctx.raw.basePrice : 0;
    return PRICE_LOOKUP[sku] ?? fallback;
  })
  basePrice: number;

  @CoerceType('boolean')
  bulkApproved: boolean;

  // Business logic
  calculateTotal(): number {
    const discount = this.quantity > 10 ? 0.1 : 0;
    return this.basePrice * this.quantity * (1 - discount);
  }
}

// Usage
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // Your LLM integration
    return await llm.complete(prompt);
  }
});

const context: OrderContext = {
  validSkus: ['WID-001', 'GAD-002']
};

try {
  const order = await factory.create(Order, {
    orderId: 'ORD-456',
    customerEmail: '  CUSTOMER@EXAMPLE.COM  ',
    sku: 'wid-001',
    quantity: 'about eight',
    bulkApproved: 'no'
  }, { context });

  console.log(order.calculateTotal());
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(`Validation failed for ${error.propertyPath}: ${error.message}`);
  }
}
```

---

## Import Reference

```typescript
// Core
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

// Coercion decorators
import {
  Coerce,
  CoerceType,
  CoerceTrim,
  CoerceCase,
  CoerceRound,
  CoerceFromSet,
  CoerceArrayElements,
  Join,
  Map,
  Filter
} from '@firebrandanalytics/shared-utils/validation';

// Validation decorators
import {
  Validate,
  ValidateRequired,
  ValidateRange,
  ValidateLength,
  ValidatePattern,
  ValidateAsync,
  CrossValidate
} from '@firebrandanalytics/shared-utils/validation';

// AI decorators
import {
  AITransform,
  AIValidate
} from '@firebrandanalytics/shared-utils/validation';

// Data source decorators
import {
  Copy,
  DerivedFrom,
  RenameFrom,
  JSONPath,
  CollectProperties,
  Merge,
  DependsOn
} from '@firebrandanalytics/shared-utils/validation';

// Context decorators
import {
  Keys,
  Values,
  Split,
  Delimited
} from '@firebrandanalytics/shared-utils/validation';

// Class decorators
import {
  ValidatedClass,
  ValidatedClassArray,
  UseStyle,
  DefaultTransforms,
  ObjectRule,
  Examples,
  UseSinglePassValidation,
  UseConvergentValidation,
  ValidateClass,
  DiscriminatedUnion
} from '@firebrandanalytics/shared-utils/validation';

// Text normalization
import {
  NormalizeText,
  NormalizeTextChain,
  TextNormalizerRegistry
} from '@firebrandanalytics/shared-utils/validation';

// Errors
import {
  ValidationError,
  FFError,
  FFLLMFixableError,
  FFLLMNonFixableError,
  ConvergenceTimeoutError,
  OscillationError,
  CoercionAmbiguityError
} from '@firebrandanalytics/shared-utils/validation';
```
