# Part 5: The Validation Trace

You run a supplier payload through the pipeline and get a clean, validated product. Fields are trimmed, cased, coerced, derived -- everything looks right. Then you spot `product_name` showing "Blaze Runner" when the supplier swears they sent "BLAZE RUNNER". Which decorator changed it? Was it `@CoerceTrim`? `@CoerceCase`? `@CoerceFromSet`? You could read the validator class and mentally replay the decorator stack, but that gets old fast when you have four supplier formats with different field mappings.

In this part, you'll make the validation pipeline fully observable. Every decorator that touches a field gets recorded with before/after values. You'll store the trace alongside the entity and build a viewer for it.

---

## The Problem: A Black Box

Three scenarios that come up the moment your system has more than a handful of submissions:

1. **A supplier calls:** "I sent `'BLAZE RUNNER'` as the product name. Your system shows `'Blaze Runner'`. What happened?"
2. **A reviewer asks:** "The `base_cost` shows `89.99` but the supplier sent `'$89.99 USD'`. Which decorator parsed the currency string?"
3. **You're debugging:** A `category` value shows `'running'` but the supplier sent `'Running'`. Was that `@CoerceCase('lower')` or something else?

Without a trace, answering any of these means reading the validator class, counting decorators, and hoping you got the execution order right. For one class with eight fields, that's manageable. For a discriminated union with four supplier formats and nested extraction, it's miserable.

The fix: capture a trace of exactly what each decorator did to each field.

---

## Enabling Trace Capture

The `ValidationFactory` accepts a `trace` option. When enabled, the factory wraps each decorator execution in a recording layer -- capturing the property name, the decorator type, and the value before and after.

```typescript
const factory = new ValidationFactory({ trace: true });
const result = await factory.create(SupplierProductAutoDetect, rawData);
const trace = factory.getLastTrace();
```

That's it. One option. The factory does the rest:

1. Every time a decorator runs on a property, it records `{ property, decorator, before, after }`.
2. After `create()` completes, `getLastTrace()` returns the full array of trace entries.
3. The trace is **not** part of the validated instance -- `toJSON()` won't include it. You retrieve it separately.

Note that you can also pass `trace` as a per-call option instead of a factory-wide setting:

```typescript
const factory = new ValidationFactory();
const result = await factory.create(SupplierProductAutoDetect, rawData, { trace: true });
```

This is useful in production where you might only enable tracing for specific submissions -- say, when a supplier flags an issue or when you're investigating a batch of anomalies. Tracing adds overhead (it deep-copies values before and after each decorator), so you probably don't want it on every single request in a high-throughput pipeline.

---

## Reading the Trace

Here's what a trace looks like for the `product_name` field when a Supplier B payload comes through. The raw input had `"  blaze runner  "` nested inside `productInfo.name`:

```json
{
  "product_name": [
    {
      "decorator": "@DerivedFrom('$.productInfo.name')",
      "before": null,
      "after": "  blaze runner  "
    },
    {
      "decorator": "@CoerceTrim",
      "before": "  blaze runner  ",
      "after": "blaze runner"
    },
    {
      "decorator": "@CoerceCase('title')",
      "before": "blaze runner",
      "after": "Blaze Runner"
    },
    {
      "decorator": "@ValidateRequired",
      "before": "Blaze Runner",
      "after": "Blaze Runner",
      "passed": true
    }
  ]
}
```

Read it top-to-bottom:

1. **`@DerivedFrom`** pulled `"  blaze runner  "` from the nested path `$.productInfo.name`.
2. **`@CoerceTrim`** stripped leading and trailing whitespace.
3. **`@CoerceCase('title')`** applied title case -- and there's your answer. This is the decorator that turned `"blaze runner"` into `"Blaze Runner"`.
4. **`@ValidateRequired`** confirmed the value is non-empty. Before and after are identical because it's a validation, not a coercion.

Every field in the validated class gets its own trace array. For a class with eight decorated fields, you get eight arrays showing the full decorator chain for each one.

For decorators that carry extra context -- like `@CoerceFromSet` with a fuzzy match score -- the trace entry includes a `metadata` field with the details.

---

## @Staging -- Intermediate Values

There's one more concept that becomes important when you're tracing: staging properties.

Recall Supplier B's nested payload from Part 3. The `productInfo`, `pricing`, and `specs` objects are needed during validation as sources for `@DerivedFrom`, but they shouldn't appear in the final output. You don't want the validated product to include a raw `productInfo` object sitting next to the flattened `product_name`.

That's what `@Staging` is for:

```typescript
@Copy()
@Staging()
productInfo!: Record<string, unknown>;

@Copy()
@Staging()
pricing!: Record<string, unknown>;
```

`@Staging()` marks a property as temporary scaffolding:

- **During validation:** The property is populated from input and participates normally. Other decorators can use it as a source.
- **After validation:** The property is excluded from the instance. `toJSON()` won't include it.
- **In the trace:** The property **does** appear. You can see it being populated, used, and then removed.

That last point matters. Here's what the trace shows for a staging property:

```json
{
  "productInfo": [
    {
      "decorator": "@Copy",
      "before": null,
      "after": { "name": "  blaze runner  ", "category": "Running" }
    },
    {
      "decorator": "@Staging",
      "before": { "name": "  blaze runner  ", "category": "Running" },
      "after": null
    }
  ]
}
```

The `productInfo` object was copied from input, used as a `@DerivedFrom` source for `product_name` and `category`, and then removed by `@Staging`. The trace preserves the full audit trail even though the property itself is gone from the output.

Without `@Staging`, your validated output would look like this:

```json
{
  "productInfo": { "name": "blaze runner", "category": "Running" },
  "product_name": "Blaze Runner",
  "category": "running"
}
```

With `@Staging`:

```json
{
  "product_name": "Blaze Runner",
  "category": "running"
}
```

Clean. The scaffolding served its purpose and disappeared.

You can also use `@Staging` to hold a raw copy of a field for comparison. Say you want to keep the original `product_name` around so a reviewer can see exactly what changed:

```typescript
@DerivedFrom('$.productInfo.name')
@Staging()
raw_product_name!: string;

@DerivedFrom('$.productInfo.name')
@CoerceTrim()
@CoerceCase('title')
@ValidateRequired()
product_name!: string;
```

The `raw_product_name` staging property captures the unmodified value. It's available during validation (and visible in the trace) but excluded from the final output. The trace viewer can then show the original alongside the transformed value without polluting the product data.

---

## Storing Traces with Entities

The trace is transient by default -- it lives in memory until you retrieve it. To make it useful for debugging later, store it alongside the validated product in the entity graph.

In the bot's workflow, after validation succeeds:

```typescript
const validated = await this.factory.create(
  SupplierProductAutoDetect,
  raw_payload,
);
const trace = this.factory.getLastTrace();

await this.update_data({
  ...dto.data,
  validated_product: validated.toJSON(),
  validation_trace: trace,
});
```

Now every entity carries both the validated product data and the trace that produced it. When a supplier calls six months later asking "why did my value change?", you pull up the entity and the answer is right there.

You can also store the raw input alongside the trace for a complete picture:

```typescript
await this.update_data({
  ...dto.data,
  validated_product: validated.toJSON(),
  validation_trace: trace,
  raw_input: raw_payload,
});
```

The `raw_input` gives you the "before" snapshot, the `validation_trace` gives you the step-by-step transformation, and the `validated_product` gives you the "after". Three pieces of data that together make the pipeline completely auditable.

The trace retrieval endpoint groups entries by property for easy consumption:

```typescript
@ApiEndpoint({ method: 'GET', route: 'product-trace' })
async getProductTrace(data: { entityId: string }) {
  const entity = await this.entity_factory.get_entity(data.entityId);
  const dto = await entity.get_dto();
  const trace = dto.data.validation_trace ?? [];

  // Group by property for the viewer
  const byProperty: Record<string, TraceEntry[]> = {};
  for (const entry of trace) {
    (byProperty[entry.property] ??= []).push(entry);
  }

  return { entity_id: data.entityId, trace: byProperty };
}
```

---

## GUI: Trace Viewer

The trace viewer page displays one expandable row per property. Here's what it looks like and what it shows:

**Summary bar** at the top: total decorator executions, number of properties touched, and which properties were staging.

**Per-property rows**, sorted with regular properties first, staging properties last. Each row shows:

- The **property name** in monospace
- A **"modified"** badge if any decorator changed the value
- A **"staging"** badge if the property was marked `@Staging`
- The **final value** on the right side (or "removed" for staging properties)

Click a row to expand it. Inside, you see:

- **Raw input value** -- what the supplier originally sent for this field
- **Decorator chain** -- a numbered list of every decorator that ran, in execution order. Each entry shows:
  - A color-coded badge (yellow for coercions, purple for validations, blue for derivations, red for staging removal)
  - The **before** value with strikethrough if it changed
  - An arrow pointing to the **after** value in green
  - Any **metadata** the decorator attached (like a fuzzy match score from `@CoerceFromSet`)

For the `product_name` example above, you'd see:

```
product_name                                    "Blaze Runner"  [modified]
├─ 1  @DerivedFrom   null → "  blaze runner  "
├─ 2  @CoerceTrim    "  blaze runner  " → "blaze runner"
├─ 3  @CoerceCase    "blaze runner" → "Blaze Runner"
└─ 4  @ValidateRequired  "Blaze Runner" (passed)
```

The viewer turns a "why did my value change?" question into a 10-second lookup. Open the entity, click the field, read the chain.

---

## What's Next

You can see exactly what the pipeline did to every field. But the category values your suppliers send don't match your product catalog -- `"RUNNING"` vs `"Running Shoes"` vs `"running-road"`. In [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md), we'll query live catalog data to match messy supplier values against your real product taxonomy.

---

**Next:** [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md)

**Previous:** [Part 4: Schema Versioning & Auto-Detection](./part-04-schema-versioning.md)
