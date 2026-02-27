> **DEPRECATED** — See the [current tutorial](../../../agent_sdk/tutorials/catalog-intake/README.md).

# Part 11: Entity Graph Integration — Typed Data That Survives the Round-Trip

Wire your validated classes into the FireFoundry entity graph so that `dto.data` comes back as a real class instance — not raw JSON.

---

## The Problem: Losing Type Identity

In Parts 1–10 you built a sophisticated validation pipeline. Given messy supplier input, `ValidationFactory.create()` returns a clean, typed class instance:

```typescript
const factory = new ValidationFactory();
const draft = await factory.create(SupplierProductDraftV3, {
  supplier_schema: 'schema_b',
  productInfo: {
    name: '  Air Zoom Pegasus  ', categoryCode: 'RUNNING',
    subcategory: 'Road', brandLine: 'nike',
  },
  pricing: { cost: '$89.99', retailPrice: '$129.99' },
  specs: { colorway: 'Black/White', sizes: '7-13' },
});

console.log(draft instanceof SupplierBProduct); // true
console.log(draft.product_name);                // "Air Zoom Pegasus"
console.log(draft.base_cost);                   // 89.99
```

That `draft` object is a `SupplierBProduct` instance with a real prototype chain. It's the result of all the coercion, validation, and discriminated union routing you've built across 10 tutorials.

Now you want to store it in the entity graph:

```typescript
// Create an entity with the validated data
await entity.update_data(draft);
```

Later, another part of the system loads that entity:

```typescript
const dto = await entity.get_dto();
console.log(dto.data.product_name);               // "Air Zoom Pegasus" ✓
console.log(dto.data instanceof SupplierBProduct); // false ✗
console.log(dto.data.constructor);                 // Object ✗
```

The data is there. Every field is present. But the class identity is gone. `dto.data` is a plain `Object` — whatever `JSON.parse()` returned from the database. No prototype, no methods, no `instanceof` checks.

This is the JSON serialization gap. When the entity service stores data, it calls `JSON.stringify()` which produces a plain JSON string. When it loads data back, `JSON.parse()` produces a generic object. Your carefully constructed class instance is reduced to its field values.

If you're only reading fields, you can work around this with type assertions:

```typescript
const data = dto.data as SupplierProductCanonical;
console.log(data.product_name); // works, but...
```

But assertions are lies — TypeScript believes you, but there's no runtime guarantee. And they break down with:

- **Nested classes:** `dto.data.address` won't be an `AddressData` instance even if the type says it is
- **Discriminated unions:** You can't `instanceof` check to determine which supplier format the data came from
- **Date fields:** ISO date strings stay as strings instead of `Date` objects
- **Methods:** Any methods defined on your class are missing

What you need is automatic reconstruction: when the entity loads, `dto.data` should be a real `SupplierBProduct` instance, not a raw object.

---

## @Serializable — Making Classes JSON-Friendly

The first piece is the `@Serializable()` decorator. It adds two capabilities to any validated class:

1. **`toJSON()`** — a prototype method called automatically by `JSON.stringify()`. Serializes managed properties; converts Dates to ISO strings and nested `@Serializable` classes to plain objects recursively. Excludes `@Staging` properties.

2. **`fromJSON(data)`** — a static class method. Reconstructs an instance from plain JSON without re-running validation. It's the fast path — it knows the data was already validated, so it just creates the instance, assigns fields, and reconstructs nested classes and Dates.

### Adding @Serializable to the Supplier Validators

Let's add `@Serializable()` to the V3 supplier classes from [Part 3](./part-03-discriminated-unions.md):

```typescript
import {
  Serializable,
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  CoerceParse,
  ValidateRange,
  ValidatePattern,
  Copy,
  DerivedFrom,
  Discriminator,
  DiscriminatedUnion,
  UseSinglePassValidation,
} from '@firebrandanalytics/shared-utils/validation';
```

The decorator goes at the class level, alongside the existing decorators:

```typescript
@Serializable()
@UseSinglePassValidation()
export class SupplierAProduct {
  @Discriminator('schema_a')
  supplier_schema!: string;

  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  // ... rest unchanged
}

@Serializable()
@UseSinglePassValidation()
export class SupplierBProduct {
  // ... same as before, just add @Serializable() at the top
}

@Serializable()
@UseSinglePassValidation()
export class SupplierCProduct {
  // ... same as before
}
```

Also add it to the base discriminated union class:

```typescript
@DiscriminatedUnion({
  discriminator: 'supplier_schema',
  map: {
    schema_a: SupplierAProduct,
    schema_b: SupplierBProduct,
    schema_c: SupplierCProduct,
  },
})
@Serializable()
export class SupplierProductDraftV3 {
  @Copy()
  supplier_schema!: string;
}
```

### The Round-Trip in Action

Now let's see what `@Serializable` buys us:

```typescript
const factory = new ValidationFactory();

// Step 1: Validate — produces a SupplierBProduct instance
const validated = await factory.create(SupplierProductDraftV3, {
  supplier_schema: 'schema_b',
  productInfo: { name: 'Blaze Runner', categoryCode: 'Running', subcategory: "men's", brandLine: 'performance' },
  pricing: { cost: '$89.99', retailPrice: '$159.99' },
  specs: { colorway: 'Black and White', sizes: '7-13' },
});

console.log(validated instanceof SupplierBProduct); // true
console.log(validated.product_name);                // "Blaze Runner"

// Step 2: Serialize — toJSON() called automatically
const json = JSON.stringify(validated);
console.log(json);
// {"supplier_schema":"schema_b","product_name":"Blaze Runner","category":"running",...}

// Step 3: Deserialize — fromJSON() reconstructs the class instance
const parsed = JSON.parse(json);
const restored = SupplierProductDraftV3.fromJSON(parsed);

console.log(restored instanceof SupplierBProduct); // true ✓
console.log(restored.product_name);                // "Blaze Runner" ✓
console.log(restored.base_cost);                   // 89.99 ✓
```

Notice what happened on step 3: `SupplierProductDraftV3.fromJSON()` inspected the `supplier_schema` field, recognized `"schema_b"`, and routed the reconstruction to `SupplierBProduct` — exactly like `ValidationFactory.create()` does, but without re-running any coercion or validation. The data was already clean; `fromJSON()` just restores the class identity.

There's also a standalone helper if you don't have the class reference handy:

```typescript
import { fromJSON } from '@firebrandanalytics/shared-utils';

const restored = fromJSON(SupplierProductDraftV3, parsed);
// Same result — fromJSON() is equivalent to SupplierProductDraftV3.fromJSON()
```

### What @Serializable Does NOT Do

`@Serializable()` is not a replacement for `ValidationFactory.create()`. It does **not** re-validate data. If you pass garbage to `fromJSON()`, you'll get a class instance filled with garbage. The contract is: `fromJSON()` trusts that the data was validated before serialization.

This is by design — it's the fast path for data that has already been through the pipeline. For untrusted input, always use `ValidationFactory.create()`.

---

## Lambda Discriminator — Inspecting Data Shape

In [Part 3](./part-03-discriminated-unions.md), the discriminated union uses a `supplier_schema` string field to route payloads:

```typescript
@DiscriminatedUnion({
  discriminator: 'supplier_schema',   // must be a field in the data
  map: {
    schema_a: SupplierAProduct,
    schema_b: SupplierBProduct,
    schema_c: SupplierCProduct,
  },
})
```

This works when every supplier payload includes a `supplier_schema` field. But what if the raw data doesn't have an explicit discriminator? What if you need to detect the format by looking at the shape of the data itself?

Enter the **lambda discriminator**. Instead of a string field name, you pass a function that receives the raw data and returns the map key:

```typescript
@DiscriminatedUnion({
  discriminator: (data: Record<string, unknown>) => {
    // Fast path: serialized canonical data already has supplier_schema
    // (set by @Discriminator on each subclass). This enables fromJSON()
    // round-trips without losing class identity.
    if (typeof data.supplier_schema === 'string') return data.supplier_schema;

    // Detection path: inspect the raw input shape
    if ('productInfo' in data) return 'schema_b';
    if ('PRODUCT_NAME' in data) return 'schema_c';
    return 'schema_a';
  },
  map: {
    schema_a: SupplierAProduct,
    schema_b: SupplierBProduct,
    schema_c: SupplierCProduct,
  },
})
@Serializable()
export class SupplierProductAutoDetect {
  @Copy()
  product_name!: string;
}
```

Notice the two-phase pattern in the lambda:

1. **Fast path** — check if `supplier_schema` is already set. After validation, each subclass's `@Discriminator('schema_b')` decorator sets this value, and `@Serializable` includes it in the JSON output. So when `fromJSON()` calls the lambda on serialized data, it finds `supplier_schema` and routes directly.

2. **Detection path** — inspect the raw input shape. When processing fresh supplier payloads (which don't have `supplier_schema`), fall back to structural detection.

This two-phase approach is important: the lambda must handle both the raw input format *and* the serialized canonical format for round-trips to work.

Now the pipeline doesn't require a `supplier_schema` field at all. Just throw any supplier payload at it:

```typescript
const factory = new ValidationFactory();

// Supplier B payload — no supplier_schema field
const result = await factory.create(SupplierProductAutoDetect, {
  productInfo: { name: 'Blaze Runner', categoryCode: 'Running', subcategory: "men's", brandLine: 'performance' },
  pricing: { cost: '$89.99', retailPrice: '$159.99' },
  specs: { colorway: 'Black and White', sizes: '7-13' },
});

console.log(result instanceof SupplierBProduct); // true
console.log(result.product_name);                // "Blaze Runner"
```

The lambda saw `productInfo` in the data, returned `'schema_b'`, and the factory routed to `SupplierBProduct`.

### When to Use String vs Lambda Discriminators

| Use Case | Discriminator Type |
|----------|-------------------|
| Data includes an explicit type/format field | **String** — simpler, faster, more readable |
| Data format must be inferred from structure | **Lambda** — inspects field names, values, or shape |
| Data migration (old vs new schema) | **Lambda** — `(data) => 'version' in data ? 'v2' : 'v1'` |
| Format known at call time | **Factory options** — pass `discriminatedUnion` in `factory.create()` options |

### Lambda + Serialization: How Round-Trips Work

Lambda discriminators work with `@Serializable`, but there's a subtlety. After validation and serialization, the data is in *canonical* format — flat fields like `product_name`, `category`, etc. The original nested structure (`productInfo`, `pricing`) is gone. So how does `fromJSON()` know it was a Supplier B product?

The answer is `@Discriminator`. Each subclass has `@Discriminator('schema_b') supplier_schema!: string;` in its metadata. When `@Serializable`'s `toJSON()` runs, it automatically includes the `@Discriminator` value in the output — even if the field wasn't explicitly set on the instance. This ensures the discriminator key survives serialization.

Then the lambda's fast-path (`if (typeof data.supplier_schema === 'string')`) picks it up:

```typescript
const json = JSON.stringify(result);
const parsed = JSON.parse(json);
// parsed = { supplier_schema: "schema_b", product_name: "Blaze Runner", ... }

// fromJSON calls the lambda → fast path finds supplier_schema → routes to SupplierBProduct
const restored = fromJSON(SupplierProductAutoDetect, parsed);
console.log(restored instanceof SupplierBProduct); // true
```

One caveat: **async lambdas are not supported in `fromJSON()`**. Deserialization is synchronous, so if your lambda returns a Promise, `fromJSON()` will throw an error. For round-trip scenarios, always use sync lambdas or string-based discriminators.

---

## @EntityDecorator + dataClass — Wiring to the Entity Graph

Now for the payoff. The Agent SDK's `@EntityDecorator` accepts a `dataClass` option that tells the entity system which class to reconstruct `dto.data` into:

```typescript
import { EntityDecorator, EntityNode } from '@firebrandanalytics/ff-agent-sdk';
import { SupplierProductAutoDetect } from '../validators/SupplierProductAutoDetect.js';

@EntityDecorator({
  specificType: 'CatalogDraftEntity',
  dataClass: SupplierProductAutoDetect,
})
export class CatalogDraftEntity extends EntityNode<any> {}
```

That single `dataClass` property changes everything. Here's what happens under the hood:

### On Write (Storing Data)

When you create an entity or call `update_data()` with a class instance, `JSON.stringify()` is called during the HTTP request to the entity service. The `@Serializable` decorator's `toJSON()` method fires automatically, converting the class instance to a clean JSON object. **No extra code needed.**

```typescript
// validated is a SupplierBProduct instance
const validated = await factory.create(SupplierProductAutoDetect, rawPayload);

// Storing it in the entity — toJSON() is called automatically by the HTTP layer
await entity.update_data(validated);
```

### On Read (Loading Data)

When the entity loads from the database — via `get_dto()`, `reload()`, `update_data()`, or `update_data_path()` — the SDK calls `fromJSON(dataClass, dto.data)` automatically. This is `EntityNode.reconstructData()`:

```typescript
// Inside EntityNode (you don't need to call this — it's automatic)
protected reconstructData(): void {
  if (!this._dto || !this._dto.data) return;
  const typeInfo = this.getTypeInfo();
  if (!typeInfo?.dataClass) return;
  this._dto.data = fromJSON(typeInfo.dataClass, this._dto.data);
}
```

The result: `dto.data` is a real class instance every time you access it.

### The Developer Experience

```typescript
// Create the entity
const entity = new CatalogDraftEntity(factory, entityId);

// Load it — dto.data is automatically reconstructed
const dto = await entity.get_dto();

// dto.data is a SupplierBProduct, not a plain Object
console.log(dto.data instanceof SupplierBProduct); // true
console.log(dto.data.product_name);                // "Blaze Runner"
console.log(dto.data.base_cost);                   // 89.99

// Update — still reconstructed after the round-trip
await entity.update_data({ ...dto.data, product_name: 'Updated Runner' });
const updated = await entity.get_dto();
console.log(updated.data instanceof SupplierBProduct); // true
console.log(updated.data.product_name);                // "Updated Runner"
```

### What About Entities Without dataClass?

Entities that don't specify `dataClass` work exactly as before — `dto.data` is a plain JSON object. The `reconstructData()` method is a no-op when `dataClass` is undefined. Zero breaking changes.

---

## Full Round-Trip Demo

Let's trace a complete supplier submission through the pipeline, from raw input to entity graph and back.

### Setup

```typescript
import { ValidationFactory, fromJSON } from '@firebrandanalytics/shared-utils/validation';
import {
  SupplierAProduct,
  SupplierBProduct,
  SupplierCProduct,
} from './validators/SupplierProductAutoDetect.js';

const factory = new ValidationFactory();
```

### Step 1: Supplier B Submits a Payload

```json
{
  "productInfo": {
    "name": "  Blaze Runner  ",
    "categoryCode": "Running",
    "subcategory": "men's",
    "brandLine": "performance"
  },
  "pricing": { "cost": "$89.99", "retailPrice": "$159.99" },
  "specs": { "colorway": "Black and White", "sizes": "7-13" }
}
```

### Step 2: Validation Pipeline

```typescript
const validated = await factory.create(SupplierProductAutoDetect, rawPayload);
```

The lambda discriminator detects `productInfo` in the data and routes to `SupplierBProduct`. The decorator pipeline:
- Extracts `productInfo.name` via `@DerivedFrom`
- Trims whitespace via `@CoerceTrim`
- Title-cases via `@CoerceCase('title')`
- Validates required fields via `@ValidateRequired`

Result: a clean `SupplierBProduct` instance:

```typescript
{
  supplier_schema: "schema_b",      // from @Discriminator, included by @Serializable
  product_name: "Blaze Runner",     // trimmed, title-cased
  category: "running",              // lowered
  subcategory: "men's",
  brand_line: "performance",        // lowered
  base_cost: 89.99,                 // extracted from pricing.cost, parsed from "$89.99"
  msrp: 159.99,                     // extracted from pricing.retailPrice, parsed from "$159.99"
  color_variant: "Black and White", // extracted from specs.colorway
  size_range: "7-13"                // extracted from specs.sizes
}
```

### Step 3: Store in Entity Graph

```typescript
await entity.update_data(validated);
// toJSON() fires automatically during HTTP request
// Entity service stores: {"supplier_schema":"schema_b","product_name":"Blaze Runner","category":"running",...}
```

### Step 4: Load Back From Entity Graph

```typescript
const dto = await entity.get_dto();
// reconstructData() fires automatically after database fetch
// fromJSON(SupplierProductAutoDetect, rawData) routes to SupplierBProduct
```

### Step 5: Verify

```typescript
console.log(dto.data instanceof SupplierBProduct); // true ✓
console.log(dto.data.product_name);                // "Blaze Runner" ✓
console.log(dto.data.base_cost);                   // 89.99 ✓
console.log(dto.data.constructor.name);            // "SupplierBProduct" ✓
```

The full chain: **raw input → validate → store → load → typed instance**. Zero manual casting.

### Unit Test

Here's a test you can run to verify the round-trip:

```typescript
import { describe, it, expect } from 'vitest';
import { ValidationFactory, fromJSON } from '@firebrandanalytics/shared-utils/validation';
import { SupplierProductAutoDetect, SupplierBProduct } from './validators/SupplierProductAutoDetect.js';

describe('Entity graph round-trip', () => {
  it('should preserve class identity through JSON serialization', async () => {
    const factory = new ValidationFactory();

    // Validate
    const validated = await factory.create(SupplierProductAutoDetect, {
      productInfo: { name: 'Blaze Runner', categoryCode: 'Running', subcategory: "men's", brandLine: 'performance' },
      pricing: { cost: '$89.99', retailPrice: '$159.99' },
      specs: { colorway: 'Black and White', sizes: '7-13' },
    });

    expect(validated).toBeInstanceOf(SupplierBProduct);

    // Simulate entity graph round-trip: serialize → deserialize → reconstruct
    const json = JSON.stringify(validated);
    const fromDb = JSON.parse(json);
    const reconstructed = fromJSON(SupplierProductAutoDetect, fromDb);

    expect(reconstructed).toBeInstanceOf(SupplierBProduct);
    expect(reconstructed.product_name).toBe('Blaze Runner');
    expect(reconstructed.category).toBe('running');
    expect(reconstructed.base_cost).toBe(89.99);
    expect(reconstructed.msrp).toBe(159.99);
  });

  it('should route to correct subclass for each supplier format', async () => {
    const factory = new ValidationFactory();

    // Supplier A: flat snake_case
    const a = await factory.create(SupplierProductAutoDetect, {
      product_name: 'Trail Blazer', category: 'hiking', subcategory: 'trail',
      brand_line: 'outdoor', base_cost: 79.99, msrp: 139.99,
      color_variant: 'Green/Brown', size_range: '8-12',
    });
    const aRestored = fromJSON(SupplierProductAutoDetect, JSON.parse(JSON.stringify(a)));
    expect(aRestored).toBeInstanceOf(SupplierAProduct);

    // Supplier C: ALL_CAPS
    const c = await factory.create(SupplierProductAutoDetect, {
      PRODUCT_NAME: 'COURT KING', CATEGORY: 'BASKETBALL', SUBCATEGORY: 'COURT',
      BRAND_LINE: 'HOOPS', BASE_COST: '99.99', MSRP: '179.99',
      COLOR: 'RED/BLACK', SIZES: '7-15',
    });
    const cRestored = fromJSON(SupplierProductAutoDetect, JSON.parse(JSON.stringify(c)));
    expect(cRestored).toBeInstanceOf(SupplierCProduct);
  });
});
```

---

## What's Next

With entity graph integration in place, your validated classes are no longer ephemeral — they persist with full type identity across the system. This unlocks several production patterns:

- **Multi-step workflows:** An intake entity creates validated draft entities as children. Each child's `dto.data` is automatically typed when loaded by downstream processing steps.

- **Working memory:** Store intermediate validation results in entity data. When a review bot loads the entity later, it gets the full class instance — not just fields.

- **Audit trails:** The `@Serializable` decorator's `toJSON()` excludes `@Staging` properties, so temporary transformation scaffolding never reaches the database. Only clean, validated data is persisted.

- **Schema evolution:** Lambda discriminators let you handle old and new data formats transparently. When the schema changes, add a new case to the lambda — existing entities with old data still deserialize correctly.

For more complex validation scenarios that benefit from serialization — nested variant arrays (Part 4), fuzzy matching (Part 5), AI extraction (Part 9) — refer to those parts and add `@Serializable()` to their classes following the same pattern shown here.

---

**Previous:** [Part 10: Recovery + Async Validation](./part-10-recovery-async.md)
