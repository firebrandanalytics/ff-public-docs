# Data Validation Patterns

This guide covers practical patterns for enforcing constraints on data using the FireFoundry Data Validation Library's validation decorators. Validation runs *after* coercion in the decorator pipeline — values are first transformed into the expected shape (see [Data Coercion Patterns](./data-coercion-patterns.md)), then checked against business rules here.

---

## Table of Contents

- [Validation Pipeline Position](#validation-pipeline-position)
- [Required Fields](#required-fields)
- [String Validation](#string-validation)
- [Numeric Validation](#numeric-validation)
- [Cross-Field Validation](#cross-field-validation)
- [Conditional Validation](#conditional-validation)
- [Custom Validators](#custom-validators)
- [AI-Powered Validation](#ai-powered-validation)
- [Structured Error Reporting](#structured-error-reporting)
- [Entity Integration Patterns](#entity-integration-patterns)
- [Batch Validation](#batch-validation)
- [Common Recipes](#common-recipes)

---

## Validation Pipeline Position

Validation decorators run after coercion decorators in the top-to-bottom pipeline:

```
1. Data Source    → @DerivedFrom, @Copy         (where does the value come from?)
2. Coercion      → @CoerceType, @CoerceTrim    (fix the value)
3. Validation    → @ValidateRequired, @ValidateRange  (check the value)
```

Always coerce before validating. A `@ValidateRange(1, 100)` decorator placed above `@CoerceType('number')` would check the raw string, not the coerced number:

```typescript
// ✅ Correct: coerce then validate
@CoerceType('number')
@ValidateRange(1, 100)
quantity: number;

// ❌ Wrong: validates the raw string "42", not the number 42
@ValidateRange(1, 100)
@CoerceType('number')
quantity: number;
```

---

## Required Fields

### @ValidateRequired

The most basic validator — reject `undefined`, `null`, and empty strings:

```typescript
import { ValidateRequired, CoerceTrim } from '@firebrandanalytics/shared-utils/validation';

class OrderSubmission {
  @CoerceTrim()
  @ValidateRequired()
  customer_name: string;

  @ValidateRequired()
  order_date: string;

  @CoerceType('number')
  @ValidateRequired()
  total: number;
  // Note: 0 passes @ValidateRequired (it's not null/undefined)
}
```

### Required with Custom Message

```typescript
class PaymentInfo {
  @ValidateRequired({ message: 'Credit card number is required for payment' })
  card_number: string;

  @ValidateRequired({ message: 'Expiration date must be provided' })
  expiration: string;
}
```

---

## String Validation

### Pattern Matching with @ValidatePattern

Validate strings against regular expressions:

```typescript
class ContactForm {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: 'Must be a valid email address'
  })
  email: string;

  @CoerceTrim()
  @ValidatePattern(/^\+?[1-9]\d{1,14}$/, {
    message: 'Must be a valid phone number in E.164 format'
  })
  phone: string;

  @CoerceTrim()
  @ValidatePattern(/^https?:\/\/.+/, {
    message: 'Must be a valid URL starting with http:// or https://'
  })
  website: string;
}
```

### Length Constraints with @ValidateLength

```typescript
class UserProfile {
  @CoerceTrim()
  @ValidateLength(2, 100, {
    message: 'Name must be between 2 and 100 characters'
  })
  display_name: string;

  @CoerceTrim()
  @ValidateLength(0, 500, {
    message: 'Bio cannot exceed 500 characters'
  })
  bio: string;

  @ValidateLength(8, 128, {
    message: 'Password must be at least 8 characters'
  })
  password: string;
}
```

### Array Length Validation

`@ValidateLength` also works on arrays:

```typescript
class TaggedContent {
  @ValidateLength(1, 10, {
    message: 'Must have between 1 and 10 tags'
  })
  tags: string[];
}
```

---

## Numeric Validation

### Range Checking with @ValidateRange

```typescript
class ProductListing {
  @CoerceType('number')
  @ValidateRange(0.01, 99999.99, {
    message: 'Price must be between $0.01 and $99,999.99'
  })
  price: number;

  @CoerceType('number')
  @CoerceRound(0)
  @ValidateRange(0, 10000, {
    message: 'Quantity must be between 0 and 10,000'
  })
  quantity: number;

  @CoerceType('number')
  @ValidateRange(0, 1, {
    message: 'Discount must be between 0% and 100%'
  })
  discount_rate: number;
}
```

### Open-Ended Ranges

```typescript
class MetricsRecord {
  @CoerceType('number')
  @ValidateRange(0, Infinity)  // Non-negative
  response_time_ms: number;

  @CoerceType('number')
  @ValidateRange(-Infinity, 100)  // At most 100
  error_rate: number;
}
```

---

## Cross-Field Validation

### @CrossValidate for Multi-Field Rules

Validate relationships between fields. Cross-validators receive the full instance:

```typescript
import { CrossValidate, CoerceType, Copy } from '@firebrandanalytics/shared-utils/validation';

class PricingRule {
  @CoerceType('number')
  cost: number;

  @CoerceType('number')
  msrp: number;

  @CoerceType('number')
  @CrossValidate(
    ['cost', 'msrp'],
    (value, instance) => {
      if (instance.cost >= instance.msrp) {
        return 'Cost must be less than MSRP';
      }
      return true;
    }
  )
  sale_price: number;
}
```

### Date Range Validation

```typescript
class EventSchedule {
  @CoerceType('date')
  start_date: Date;

  @CoerceType('date')
  @CrossValidate(
    ['start_date'],
    (endDate, instance) => {
      if (endDate <= instance.start_date) {
        return 'End date must be after start date';
      }
      return true;
    }
  )
  end_date: Date;
}
```

### Computed Field Validation

```typescript
class InvoiceTotals {
  @CoerceType('number')
  subtotal: number;

  @CoerceType('number')
  tax: number;

  @CoerceType('number')
  @CrossValidate(
    ['subtotal', 'tax'],
    (total, instance) => {
      const expected = instance.subtotal + instance.tax;
      if (Math.abs(total - expected) > 0.01) {
        return `Total (${total}) does not equal subtotal + tax (${expected})`;
      }
      return true;
    }
  )
  total: number;
}
```

---

## Conditional Validation

### Different Rules Based on Field Values

Use `@If` / `@ElseIf` / `@Else` / `@EndIf` to apply validation rules conditionally:

```typescript
import { If, ElseIf, Else, EndIf, ValidateRequired, ValidatePattern } from '@firebrandanalytics/shared-utils/validation';

class PaymentMethod {
  @Copy()
  payment_type: 'credit_card' | 'bank_transfer' | 'crypto';

  @If('payment_type', t => t === 'credit_card')
    @ValidateRequired()
    @ValidatePattern(/^\d{13,19}$/)
  @ElseIf('payment_type', t => t === 'bank_transfer')
    @ValidateRequired()
    @ValidatePattern(/^\d{8,17}$/)
  @Else()
    @ValidateRequired()
    @ValidatePattern(/^0x[a-fA-F0-9]{40}$/)
  @EndIf()
  account_identifier: string;
}
```

### Conditional Required Fields

```typescript
class ShippingInfo {
  @Copy()
  delivery_method: 'shipping' | 'pickup' | 'digital';

  @If('delivery_method', m => m === 'shipping')
    @ValidateRequired({ message: 'Street address required for shipping' })
  @EndIf()
  street_address: string;

  @If('delivery_method', m => m === 'shipping')
    @ValidateRequired()
    @ValidatePattern(/^\d{5}(-\d{4})?$/)
  @EndIf()
  zip_code: string;

  @If('delivery_method', m => m === 'pickup')
    @ValidateRequired({ message: 'Store location required for pickup' })
  @EndIf()
  store_id: string;
}
```

### Context-Driven Conditional Validation

```typescript
interface TenantContext {
  tier: 'free' | 'pro' | 'enterprise';
  maxItems: number;
}

class BatchUpload {
  @ValidateLength<TenantContext>(
    1,
    ctx => ctx.maxItems,
    { message: ctx => `Your ${ctx.tier} plan allows up to ${ctx.maxItems} items per batch` }
  )
  items: any[];
}

const result = await factory.create(BatchUpload, data, {
  context: { tier: 'free', maxItems: 100 }
});
```

---

## Custom Validators

### Inline Custom Validation

For one-off validation logic, use a lambda with `@CrossValidate`:

```typescript
class PasswordChange {
  @Copy()
  current_password: string;

  @ValidateRequired()
  @ValidateLength(8, 128)
  @CrossValidate(
    ['current_password'],
    (newPassword, instance) => {
      if (newPassword === instance.current_password) {
        return 'New password must be different from current password';
      }
      // Complexity check
      const hasUpper = /[A-Z]/.test(newPassword);
      const hasLower = /[a-z]/.test(newPassword);
      const hasDigit = /\d/.test(newPassword);
      if (!(hasUpper && hasLower && hasDigit)) {
        return 'Password must contain uppercase, lowercase, and a digit';
      }
      return true;
    }
  )
  new_password: string;
}
```

### Reusable Validation Styles

For validation rules applied to many classes, define styles:

```typescript
import { UseStyle } from '@firebrandanalytics/shared-utils/validation';

// Define reusable validation styles
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: 'Invalid email format'
  })
  static value: string;
}

class MoneyStyle {
  @CoerceType('number')
  @CoerceRound(2)
  @ValidateRange(0, 999999.99)
  static value: number;
}

// Apply styles to properties
class OrderForm {
  @UseStyle(EmailStyle)
  customer_email: string;

  @UseStyle(MoneyStyle)
  subtotal: number;

  @UseStyle(MoneyStyle)
  tax: number;

  @UseStyle(MoneyStyle)
  total: number;
}
```

### Class-Level Default Validation

Apply default transforms and validators to all properties of a given type:

```typescript
import { DefaultTransforms } from '@firebrandanalytics/shared-utils/validation';

// All string properties get trimmed; all numbers get rounded
@DefaultTransforms({
  string: TrimmedStringStyle,
  number: RoundedNumberStyle
})
class CleanRecord {
  name: string;        // Auto-trimmed
  email: string;       // Auto-trimmed
  price: number;       // Auto-rounded
  quantity: number;     // Auto-rounded

  @CoerceCase('upper')  // Override: gets uppercase + trim (from default)
  sku: string;
}
```

---

## AI-Powered Validation

### @AIValidate for Semantic Checks

When rule-based validation can't express the constraint:

```typescript
import { AIValidate } from '@firebrandanalytics/shared-utils/validation';

class ContentModeration {
  @AIValidate(
    params => `Does this text contain inappropriate content, hate speech, or personal attacks? Text: "${params.value}". Answer YES or NO.`,
    { rejectOn: 'YES' }
  )
  user_comment: string;

  @AIValidate(
    params => `Is this a real, deliverable physical address (not a PO Box)? Address: "${params.value}". Answer YES or NO.`,
    { rejectOn: 'NO' }
  )
  shipping_address: string;
}
```

### AI Validation with Retry

```typescript
class QualityCheck {
  @AITransform(
    params => `Summarize this in exactly 2 sentences:\n\n${params.value}`
  )
  @AIValidate(
    params => `Does this summary accurately represent the original text? Original: "${params.instance.original_text}". Summary: "${params.value}". Answer YES or NO.`,
    { maxRetries: 2, rejectOn: 'NO' }
  )
  summary: string;
}
```

The retry loop works: if `@AIValidate` rejects the summary, `@AITransform` re-runs with the error context, producing a better summary. This repeats up to `maxRetries` times.

---

## Structured Error Reporting

### The Validation Trace

Every validation run produces a trace showing what happened to each field:

```typescript
const factory = new ValidationFactory();
const result = await factory.create(OrderForm, rawData);
const trace = factory.getLastTrace();

// Trace structure:
// {
//   properties: {
//     customer_email: {
//       raw: "  JANE@EXAMPLE.COM  ",
//       steps: [
//         { decorator: "CoerceTrim", before: "  JANE@...", after: "JANE@..." },
//         { decorator: "CoerceCase", before: "JANE@...", after: "jane@..." },
//         { decorator: "ValidatePattern", result: "passed" }
//       ],
//       final: "jane@example.com"
//     },
//     // ...
//   }
// }
```

### Collecting All Errors

By default, validation stops at the first error. To collect all errors:

```typescript
const factory = new ValidationFactory({
  collectAllErrors: true
});

try {
  await factory.create(OrderForm, badData);
} catch (error) {
  if (error instanceof ValidationError) {
    // error.errors is an array of all failures:
    // [
    //   { property: 'email', message: 'Invalid email format', value: 'not-an-email' },
    //   { property: 'price', message: 'Price must be between $0.01 and $99,999.99', value: -5 },
    //   { property: 'quantity', message: 'Quantity must be between 0 and 10,000', value: 50000 }
    // ]
    for (const err of error.errors) {
      console.log(`${err.property}: ${err.message}`);
    }
  }
}
```

### Storing Traces for Auditing

In agent bundles, store the validation trace alongside entity data for auditability:

```typescript
class AuditableEntity extends RunnableEntity<AuditRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const factory = new ValidationFactory({ collectAllErrors: true });

    const validated = await factory.create(ImportRecord, dto.data);
    const trace = factory.getLastTrace();

    await this.update_data({
      validated_record: validated,
      validation_trace: trace,
      validated_at: new Date().toISOString()
    });

    return validated;
  }
}
```

---

## Entity Integration Patterns

### Post-Processing Bot Output

The most common integration: validate and clean LLM output before storing it:

```typescript
const factory = new ValidationFactory();

class AnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[RunnableEntity<AnalysisRETH>, BotRunnableEntityMixin<AnalysisRETH>]> {
  protected async *run_impl() {
    // Bot produces raw output
    const botOutput = yield* this.run_bot();

    // Validate and clean
    const validated = await factory.create(AnalysisOutput, botOutput);

    return validated;
  }
}
```

### Pre-Processing Inbound Data

Clean data before the entity processes it:

```typescript
const factory = new ValidationFactory();

class ImportEntity extends RunnableEntity<ImportRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Validate inbound data
    try {
      const clean = await factory.create(ImportSchema, dto.data);
      // Process clean data...
      return { status: 'success', data: clean };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { status: 'validation_failed', errors: error.errors };
      }
      throw error;
    }
  }
}
```

### DataValidationBotMixin

For bots that need integrated validation with automatic retry:

```typescript
class ValidatingBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    super(
      [{ name: 'ValidatingBot', base_prompt_group: prompts, model_pool_name: 'default' }],
      [{ schema: OutputSchema }],
      [{
        validatedClass: CleanOutput,
        validationFactory: factory,
        validationOptions: { engine: 'convergent', maxIterations: 10 }
      }]
    );
  }
}

// Flow: LLM output → Zod validates structure → ValidationFactory transforms/validates
// If validation fails → bot retries with error feedback
```

See [Validation Integration Patterns](../feature_guides/validation-integration-patterns.md) for the full set of integration patterns.

---

## Batch Validation

### Parallel Validation

Validate multiple items concurrently:

```typescript
const factory = new ValidationFactory();

class BatchImportEntity extends RunnableEntity<BatchRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const items = dto.data.items as any[];

    const results = await Promise.allSettled(
      items.map(item => factory.create(ProductRecord, item))
    );

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<ProductRecord> => r.status === 'fulfilled')
      .map(r => r.value);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r, i) => ({ index: i, error: r.reason.message }));

    return {
      total: items.length,
      succeeded: succeeded.length,
      failed: failed.length,
      errors: failed,
      data: succeeded
    };
  }
}
```

---

## Common Recipes

### Email Validation

```typescript
@CoerceTrim()
@CoerceCase('lower')
@ValidateRequired()
@ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Invalid email' })
email: string;
```

### US Phone Number

```typescript
@CoerceTrim()
@CoerceFormat((v: string) => v.replace(/\D/g, ''))
@ValidatePattern(/^\d{10,11}$/, { message: 'Must be 10-11 digits' })
phone: string;
```

### Monetary Amount

```typescript
@CoerceType('number')
@CoerceRound(2)
@ValidateRange(0, 999999.99, { message: 'Invalid amount' })
amount: number;
```

### URL Validation

```typescript
@CoerceTrim()
@ValidatePattern(/^https?:\/\/[^\s/$.?#].[^\s]*$/, { message: 'Invalid URL' })
url: string;
```

### Enum Value

```typescript
@CoerceTrim()
@CoerceCase('lower')
@CoerceFromSet(['active', 'inactive', 'pending', 'archived'], { strategy: 'exact' })
@ValidateRequired()
status: string;
```

### Non-Empty Array

```typescript
@ValidateRequired()
@ValidateLength(1, Infinity, { message: 'At least one item required' })
items: any[];
```

---

## See Also

- [Data Coercion Patterns](./data-coercion-patterns.md) — Transformation patterns (coerce first)
- [Data Validation Library Overview](../feature_guides/data-validation-overview.md) — Architecture and decorator catalog
- [Conceptual Guide](../../utils/validation/concepts.md) — Pipeline, engines, and dependency graph
- [API Reference](../../utils/validation/validation-library-reference.md) — Full decorator signatures
- [Validation Integration Patterns](../feature_guides/validation-integration-patterns.md) — All 11 integration patterns
- [Catalog Intake Tutorial](../tutorials/catalog-intake/README.md) — End-to-end validation pipeline
