# Error Recovery and Repair

Graceful degradation with @Catch fallbacks and @AICatchRepair for AI-powered error recovery.

---

## The Problem

Data from flaky sources arrives with malformed JSON, dates in unparseable formats, missing required fields, and values outside valid ranges. Some fields are critical -- an invalid email address should reject the entire record. Others are optional -- a broken metadata blob should not prevent an otherwise valid import from succeeding. You need fine-grained, per-field error handling, not an all-or-nothing approach that either swallows every error or rejects the whole payload on the first failure.

Traditional `try/catch` around the entire validation call gives you exactly two options: succeed completely or fail completely. What you actually want is a pipeline where each field declares its own recovery strategy: deterministic fallback, AI-assisted repair, or fail loudly.

## The Strategy

**Decorator-scoped error recovery with tiered fallback.** Each property chooses its own error-handling strategy through decorators placed below the step that might fail:

| Tier | Decorator | When to use |
|------|-----------|-------------|
| **Deterministic fallback** | `@Catch(handler)` | Known failure modes with predictable defaults -- empty objects, zero values, null dates |
| **AI-powered repair** | `@AICatchRepair(prompt?)` | Complex or unpredictable failures where a language model can infer intent from the broken value |
| **AI JSON preset** | `@AIJSONRepair()` | Malformed JSON specifically -- missing quotes, trailing commas, truncated payloads |
| **No catch (fail loudly)** | _(no error decorator)_ | Critical fields where failure must propagate with a clear error message |
| **Error context** | `@Examples(values[])` | Provide sample valid values that appear in error messages and AI retry prompts |

The key insight is that `@Catch` and `@AICatchRepair` are positional. They sit below the decorators whose errors they intercept. If `@CoerceParse('json')` throws, the `@Catch` underneath catches it. Decorators below the catch continue processing with the repaired value.

## Architecture

```
                         Flawed Input
                              |
              "bad json"   "Jan 32"   "abc"   "not-an-email"
                              |
                    +---------+---------+
                    |  Decorator Pipeline |
                    |  (per property)     |
                    +---------+---------+
                              |
                       Error thrown?
                      /              \
                    Yes               No
                    /                   \
          +--------+--------+     Continue pipeline
          | Recovery layer  |           |
          +--------+--------+           |
          /        |         \          |
     @Catch   @AICatchRepair  (none)    |
     return    AI attempts     error    |
     default   repair          propagates
        \        |                |
         \       |                v
          \      |          ValidationError
           \     |          thrown to caller
            v    v
       Continue pipeline
       with repaired value
              |
              v
        Clean Output
```

## Implementation

### Data import class with mixed critical and optional fields

```typescript
import {
    ValidationFactory,
    CoerceParse, CoerceType, CoerceTrim,
    ValidateRequired, ValidatePattern, ValidateRange,
    Catch, AICatchRepair,
    Examples,
} from '@firebrandanalytics/shared-utils/validation';

class DataImport {
    @ValidateRequired()
    @CoerceTrim()
    source: string;

    // ── Optional: malformed JSON falls back to empty object ──
    @CoerceParse('json')
    @Catch((error, value, instance) => ({}))
    metadata: Record<string, any>;

    // ── Optional: weird dates get AI repair ──
    @CoerceType('date')
    @AICatchRepair('Fix this to a valid date. The value may use non-standard formatting.')
    @Examples(['2024-01-15', '2024-06-30T12:00:00Z'], 'ISO 8601 date')
    eventDate: Date;

    // ── Optional: non-numeric priority falls back to 0 ──
    @CoerceType('number')
    @Catch((error, value, instance) => 0)
    @ValidateRange(0, 10)
    priority: number;

    // ── Critical: invalid email MUST fail loudly ──
    @CoerceTrim()
    @ValidateRequired()
    @ValidatePattern(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Invalid email format'
    )
    @Examples(['user@example.com', 'admin@company.org'], 'Valid email address')
    email: string;
}
```

**Line-by-line breakdown:**

1. **`metadata`** -- `@CoerceParse('json')` attempts to parse the raw string. If it throws (malformed JSON, truncated payload, wrong type), `@Catch` intercepts the error and returns `{}`. The pipeline continues with an empty object.

2. **`eventDate`** -- `@CoerceType('date')` attempts date parsing. If it fails on a weird format like `"Jan 32nd, 2024"` or `"next Tuesday"`, `@AICatchRepair` sends the error message, the raw value, and the `@Examples` context to the AI handler. The AI returns a repaired date string, and the pipeline replays `@CoerceType('date')` on the repaired value.

3. **`priority`** -- `@CoerceType('number')` attempts numeric coercion. If the value is `"high"` or `"N/A"`, the `@Catch` handler returns `0` as a safe default. `@ValidateRange(0, 10)` then validates the fallback.

4. **`email`** -- No `@Catch` or `@AICatchRepair`. If the email is missing or malformed, `@ValidateRequired` or `@ValidatePattern` throws a `ValidationError` that propagates to the caller. The `@Examples` decorator ensures the error message includes sample valid formats.

### Processing data with various flaws

```typescript
const factory = new ValidationFactory({
    aiHandler: async (params, prompt) => {
        // Your LLM integration here
        return await llm.complete(prompt);
    },
});

// Record with recoverable flaws
const recovered = await factory.create(DataImport, {
    source: '  legacy-crm  ',
    metadata: '{name: "test",}',           // malformed JSON (unquoted key, trailing comma)
    eventDate: 'Jan 32nd, 2024',           // impossible date
    priority: 'high',                       // string instead of number
    email: 'jane@example.com',             // valid
});
// metadata  -> {}              (caught, fell back to empty object)
// eventDate -> 2024-02-01      (AI repaired "Jan 32nd" to nearest valid date)
// priority  -> 0               (caught, fell back to 0)
// email     -> "jane@example.com"  (passed validation)

// Record with a critical failure
try {
    await factory.create(DataImport, {
        source: 'external-api',
        metadata: '{"valid": true}',
        eventDate: '2024-06-15',
        priority: '5',
        email: 'not-an-email',             // critical field -- no catch
    });
} catch (err) {
    // ValidationError: Invalid email format
    // propertyPath: "email"
    // examples: ["user@example.com", "admin@company.org"]
}
```

## What to Observe

Running the [companion example](../examples/error-recovery-and-repair.ts), you will see output like this:

```
── Demo 1: Recoverable Flaws ────────────────────────────

  Input:
    source     : "  legacy-crm  "
    metadata   : "{name: \"test\",}"
    eventDate  : "Jan 32nd, 2024"
    priority   : "high"
    email      : "jane@example.com"

  Output:
    source     : "legacy-crm"                  (trimmed)
    metadata   : {}                            (caught -> fallback)
    eventDate  : 2024-02-01T00:00:00.000Z      (AI repaired)
    priority   : 0                             (caught -> fallback)
    email      : "jane@example.com"            (passed)

  Recovery log:
    metadata   : @Catch returned {} for malformed JSON
    eventDate  : @AICatchRepair repaired "Jan 32nd, 2024" -> "2024-02-01"
    priority   : @Catch returned 0 for non-numeric "high"

── Demo 2: Critical Field Failure ───────────────────────

  Input email: "not-an-email"

  Error: ValidationError
    message      : "Invalid email format"
    propertyPath : "email"
    rule         : "ValidatePattern"
    examples     : ["user@example.com", "admin@company.org"]
```

**What each outcome tells you:**

| Field | Outcome | Why |
|-------|---------|-----|
| `metadata` | `{}` (empty object) | `@Catch` intercepted the JSON parse error and returned a deterministic fallback. No AI call needed. |
| `eventDate` | Repaired date | `@AICatchRepair` sent the broken value to the AI handler, which inferred the intended date. The repaired string was replayed through `@CoerceType('date')`. |
| `priority` | `0` (default) | `@Catch` intercepted the type coercion error. The fallback value `0` passed `@ValidateRange(0, 10)`. |
| `email` | `ValidationError` thrown | No error decorator. The pattern validation failure propagated to the caller with a clear message and example values. |

## Variations

### 1. Logging errors while providing defaults

Catch handlers can perform side effects before returning a fallback. Use this to track how often fields degrade without blocking the pipeline:

```typescript
class LoggingImport {
    @CoerceParse('json')
    @Catch((error, value, instance) => {
        logger.warn('metadata parse failed', {
            source: instance.source,
            rawValue: value,
            error: error.message,
        });
        return {};
    })
    metadata: Record<string, any>;
}
```

### 2. Mixing critical and optional fields on the same class

A single class can have fields at every tier. The rule of thumb: use `@Catch` for fields with obvious safe defaults, `@AICatchRepair` for fields where AI can reasonably infer intent, and no catch for fields where silent failure would corrupt downstream logic.

```typescript
class MixedResilience {
    @Copy()
    criticalId: string;                    // fail loudly

    @CoerceType('number')
    @Catch(() => 1)
    retryCount: number;                    // safe default

    @CoerceType('date')
    @AICatchRepair()
    dueDate: Date;                         // AI repair
}
```

### 3. @AICatchRepair with custom prompts for domain-specific repair

Pass a prompt string to `@AICatchRepair` to give the AI domain-specific guidance:

```typescript
class MedicalRecord {
    @CoerceType('date')
    @AICatchRepair(
        'This is a medical record date. Common formats include "DD/MM/YYYY" (European), '
        + '"Month DDth, YYYY", and relative dates like "3 days post-op". '
        + 'Convert to ISO 8601.'
    )
    procedureDate: Date;
}
```

### 4. Nested error recovery in validated children

When a property is itself a validated class, each child property has its own recovery decorators. Errors recover at the deepest possible level:

```typescript
class Address {
    @CoerceTrim()
    @ValidateRequired()
    street: string;                        // fail loudly

    @CoerceType('number')
    @Catch(() => null)
    apartment: number | null;              // nullable fallback
}

class Contact {
    @ValidateRequired()
    name: string;

    @ValidatedChild()
    address: Address;                      // recovery happens inside Address
}
```

## See Also

- [API Reference -- @Catch and @AICatchRepair](../validation-library-reference.md#catchhandler-and-aicatchrepairprompt-options) -- Full handler signatures and options
- [API Reference -- Error Types](../validation-library-reference.md#error-types) -- `ValidationError`, `CoercionAmbiguityError`, `FFLLMFixableError`, `FFLLMNonFixableError`
- [Conceptual Guide -- Error Recovery](../concepts.md#10-error-recovery-catch-and-aicatchrepair) -- Design philosophy behind decorator-scoped error handling
- [Advanced Guide -- Error Recovery](../validation-library-advanced.md#54-error-recovery-with-catch-and-aicatchrepair) -- Production-ready handler patterns, caching, rate limiting
- [Multi-Format Data Ingestion](./multi-format-data-ingestion.md) -- Parsing pipelines that pair well with `@Catch` fallbacks
- [LLM Output Canonicalization](./llm-output-canonicalization.md) -- Cleaning AI-generated data where `@AICatchRepair` adds resilience
- [Runnable Example](../examples/error-recovery-and-repair.ts) -- Self-contained TypeScript program demonstrating these patterns
