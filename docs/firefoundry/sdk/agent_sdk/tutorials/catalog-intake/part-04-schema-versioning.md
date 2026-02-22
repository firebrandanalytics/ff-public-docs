# Part 4: Schema Versioning & Auto-Detection

In Part 3, the discriminated union routes payloads based on a `supplier_schema` string field that every supplier includes. That works -- until it doesn't. In this part, you'll replace the string discriminator with a lambda that inspects data shape, handle schema evolution without breaking existing records, and update the GUI to auto-detect supplier formats.

**What you'll learn:**
- Lambda discriminators for structural format detection
- The two-phase pattern (fast path + detection path) for round-trip correctness
- Schema evolution: old and new data coexisting in the same entity graph
- Updating the GUI to support auto-detection

**What you'll build:** A `SupplierProductAutoDetect` class that routes payloads without requiring a `supplier_schema` field, plus a schema version badge in the product browser.

## Step 1: The Problem -- Schema Rigidity

Your intake pipeline from Part 3 works great -- as long as every supplier plays by the rules and includes a `supplier_schema` field. But two things are about to break that assumption.

**Problem 1: Supplier D doesn't include `supplier_schema`.**

A new supplier joins, and their payload looks like this:

```json
{
  "item_name": "Trail Blazer GTX",
  "item_type": "hiking",
  "gender": "unisex",
  "line": "outdoor",
  "wholesale_price": 95.00,
  "retail_price": 189.99,
  "colorway": "Forest Green/Black",
  "available_sizes": "7-14"
}
```

No `supplier_schema` field. No type indicator. Just data. The Part 3 pipeline would throw: `Unknown discriminator value: undefined`.

**Problem 2: Existing entities have v1 data.**

Your entity graph already contains products validated with the Part 1 flat schema -- before discriminated unions existed. That old data looks like this:

```json
{
  "product_name": "Blaze Runner",
  "category": "running",
  "base_cost": 89.99,
  "msrp": 159.99
}
```

No `supplier_schema`. No `source_format`. Just the canonical fields. If you try to load these entities through the Part 3 pipeline, the discriminator lookup fails because there's no field to inspect.

You need a pipeline that handles both problems: fresh input without a type field, and old data without a discriminator.

## Step 2: Lambda Discriminator

The solution is to replace the string discriminator with a function. Instead of `discriminator: 'supplier_schema'` (which reads a field), you pass `discriminator: (data) => string` (which inspects the data and returns a map key).

Update `packages/shared-types/src/suppliers/SupplierProductAutoDetect.ts`:

```typescript
import {
  DiscriminatedUnion,
  Serializable,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';
import { SupplierAProduct } from './SupplierAProduct.js';
import { SupplierBProduct } from './SupplierBProduct.js';
import { SupplierCProduct } from './SupplierCProduct.js';
import { SupplierDProduct } from './SupplierDProduct.js';

@DiscriminatedUnion({
  discriminator: (data: Record<string, unknown>) => {
    // Phase 1 — Fast path: serialized data has supplier_schema
    // (auto-included by @Serializable from each subclass's @Discriminator value)
    if (typeof data.supplier_schema === 'string') return data.supplier_schema;

    // Phase 2 — Detection path: inspect structure of fresh input
    if ('productInfo' in data) return 'schema_b';
    if ('PRODUCT_NAME' in data) return 'schema_c';
    if ('item_name' in data) return 'schema_d';
    return 'schema_a';
  },
  map: {
    schema_a: SupplierAProduct,
    schema_b: SupplierBProduct,
    schema_c: SupplierCProduct,
    schema_d: SupplierDProduct,
  },
})
@Serializable()
export class SupplierProductAutoDetect {
  @Copy()
  product_name!: string;
}
```

This looks simple, but there's a lot happening. Let's break down the two-phase pattern, because it's the key to making schema evolution work.

### Phase 1: The Fast Path

```typescript
if (typeof data.supplier_schema === 'string') return data.supplier_schema;
```

This line handles **serialized data** -- data that has already been validated, stored in the entity graph, and loaded back. How does `supplier_schema` get there if the original input didn't have it?

The answer is `@Discriminator` + `@Serializable`. Each subclass declares its discriminator value:

```typescript
@Serializable()
export class SupplierBProduct {
  @Discriminator('schema_b')
  supplier_schema!: string;

  // ... field decorators ...
}
```

When `@Serializable`'s `toJSON()` runs on a validated `SupplierBProduct` instance, it automatically includes the `@Discriminator` value in the JSON output -- even though the original input never had a `supplier_schema` field. The output becomes:

```json
{
  "supplier_schema": "schema_b",
  "product_name": "Blaze Runner",
  "category": "running",
  "base_cost": 89.99,
  "msrp": 159.99
}
```

This is SDK-native behavior. You don't write any code to make it happen. `@Serializable` reads the `@Discriminator` metadata and injects the value into `toJSON()` output automatically.

### Phase 2: The Detection Path

```typescript
if ('productInfo' in data) return 'schema_b';
if ('PRODUCT_NAME' in data) return 'schema_c';
if ('item_name' in data) return 'schema_d';
return 'schema_a';
```

This handles **fresh input** -- raw supplier payloads that have never been through the pipeline. There's no `supplier_schema` field, so the lambda inspects the data shape. Supplier B always has `productInfo`. Supplier C uses ALL_CAPS keys. Supplier D has `item_name`. Everything else defaults to Supplier A's flat format.

The detection logic is intentionally simple. Each check tests for a single distinctive key that uniquely identifies a format. If your formats are harder to distinguish, you can make the lambda as sophisticated as you need -- check multiple keys, inspect value types, even look at nesting depth. The only rule is that the lambda must be **synchronous** (async lambdas are not supported in `fromJSON()`).

## Step 3: The Round-Trip Mechanism

Here's the full lifecycle of a product that arrives without a `supplier_schema` field, gets stored in the entity graph, and loads back with its class identity intact.

**1. Fresh input arrives:**

```typescript
const factory = new ValidationFactory();
const result = await factory.create(SupplierProductAutoDetect, {
  productInfo: { name: 'Blaze Runner', categoryCode: 'Running' },
  pricing: { cost: '$89.99', retailPrice: '$159.99' },
});
```

The lambda runs. No `supplier_schema` in the data, so the fast path is skipped. The detection path finds `productInfo` and returns `'schema_b'`. The factory routes to `SupplierBProduct`.

**2. Validation produces a typed instance:**

```typescript
console.log(result instanceof SupplierBProduct); // true
console.log(result.product_name);                // "Blaze Runner"
console.log(result.supplier_schema);             // "schema_b"
```

The `@Discriminator('schema_b')` decorator set `supplier_schema` to `"schema_b"` during validation.

**3. Entity stores the serialized data:**

```typescript
const json = JSON.stringify(result);
// { "supplier_schema": "schema_b", "product_name": "Blaze Runner", "category": "running", ... }
```

`@Serializable`'s `toJSON()` includes the `supplier_schema` field automatically. The original nested structure (`productInfo`, `pricing`) is gone -- only the canonical flat fields remain. But the discriminator value is preserved.

**4. Entity loads -- `fromJSON()` calls the lambda:**

```typescript
import { fromJSON } from '@firebrandanalytics/shared-utils/validation';

const parsed = JSON.parse(json);
const restored = fromJSON(SupplierProductAutoDetect, parsed);
```

The lambda runs again on the parsed data. This time, `supplier_schema` is `"schema_b"` -- the fast path catches it immediately. No structural detection needed. The factory returns a `SupplierBProduct` instance.

**5. Class identity preserved:**

```typescript
console.log(restored instanceof SupplierBProduct); // true
```

The product survived a full round-trip through JSON serialization and came back as the correct class. This is what makes the entity graph work -- `dto.data` is not just raw JSON, it's a typed class instance that the SDK knows how to reconstruct.

## Step 4: Schema Evolution in Practice

Now you can see why the two-phase lambda pattern matters for schema evolution. You have three generations of data in your entity graph, and the lambda handles all of them.

### V1 entities: flat data from Part 1

These were created before discriminated unions existed. No `supplier_schema`, no `source_format`, just canonical fields:

```json
{ "product_name": "Blaze Runner", "category": "running", "base_cost": 89.99, "msrp": 159.99 }
```

The lambda runs: no `supplier_schema` (fast path skips), no `productInfo`, no `PRODUCT_NAME`, no `item_name`. Falls through to `return 'schema_a'`. Correct -- this is Supplier A's flat format.

### V2 entities: string discriminator from Part 3

These were stored with the Part 3 pipeline, which set `supplier_schema` via `@Discriminator`:

```json
{ "supplier_schema": "schema_b", "product_name": "Ember Court", "category": "basketball", "base_cost": 72.50, "msrp": 149.99 }
```

The lambda runs: `supplier_schema` is `"schema_b"`. Fast path returns immediately. No structural detection needed.

### V3 entities: new supplier D format

Fresh input from the new supplier, no discriminator field:

```json
{ "item_name": "Trail Blazer GTX", "item_type": "hiking", "wholesale_price": 95.00, "retail_price": 189.99 }
```

The lambda runs: no `supplier_schema`, no `productInfo`, no `PRODUCT_NAME`, finds `item_name`. Returns `'schema_d'`. Routes to `SupplierDProduct`.

After validation and storage, the entity has `supplier_schema: "schema_d"` baked in. Next time it loads, the fast path handles it.

### Adding V4, V5, V6...

When the next supplier shows up with yet another format, the change is minimal:

1. Write a new `SupplierEProduct` class with its field mappings
2. Add a detection case to the lambda: `if ('supplierE_field' in data) return 'schema_e';`
3. Add `schema_e: SupplierEProduct` to the map

No existing data changes. No migrations. No database updates. V1 entities still route to `schema_a`. V2 entities still hit the fast path. The lambda is the migration layer.

## Step 5: Update the Supplier D Mapping

Before updating the GUI, define the `SupplierDProduct` class for the new supplier. This follows the same pattern from Part 3 -- `@DerivedFrom` for field mappings, `@CoerceTrim` and `@CoerceType` for normalization.

Create `packages/shared-types/src/suppliers/SupplierDProduct.ts`:

```typescript
import {
  Serializable,
  Discriminator,
  DerivedFrom,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
export class SupplierDProduct {
  @Discriminator('schema_d')
  supplier_schema!: string;

  @DerivedFrom('$.item_name')
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('$.item_type')
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @DerivedFrom('$.gender')
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @DerivedFrom('$.line')
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @DerivedFrom('$.wholesale_price')
  @CoerceType('number')
  base_cost!: number;

  @DerivedFrom('$.retail_price')
  @CoerceType('number')
  msrp!: number;

  @DerivedFrom('$.colorway')
  @CoerceTrim()
  color_variant!: string;

  @DerivedFrom('$.available_sizes')
  @CoerceTrim()
  size_range!: string;
}
```

Same output shape as Suppliers A, B, and C. Different input field names. The decorator pipeline handles the translation.

## Step 6: Update the GUI

Two changes to the catalog GUI: the intake form gets an auto-detect mode, and the product browser shows a schema version badge.

### Auto-Detect Toggle on the Intake Form

In Part 3, the intake form had a manual format selector dropdown. Replace it with an auto-detect toggle. When enabled, the form skips the dropdown and lets the lambda figure out the format.

Update `apps/catalog-gui/src/components/IntakeForm.tsx`:

```tsx
'use client';
import { useState } from 'react';

interface IntakeFormProps {
  onSubmit: (payload: Record<string, unknown>, autoDetect: boolean) => void;
}

export function IntakeForm({ onSubmit }: IntakeFormProps) {
  const [rawJson, setRawJson] = useState('');
  const [autoDetect, setAutoDetect] = useState(true);
  const [format, setFormat] = useState('schema_a');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = JSON.parse(rawJson);

    if (!autoDetect) {
      // Manual mode: inject the supplier_schema field
      payload.supplier_schema = format;
    }
    // Auto-detect mode: send the raw payload as-is.
    // The lambda discriminator will inspect the data shape.

    onSubmit(payload, autoDetect);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Raw Supplier JSON
        </label>
        <textarea
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          className="w-full h-48 font-mono text-sm border rounded p-2"
          placeholder='Paste supplier payload here...'
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoDetect}
            onChange={(e) => setAutoDetect(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm">Auto-detect format</span>
        </label>

        {!autoDetect && (
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          >
            <option value="schema_a">Supplier A (flat snake_case)</option>
            <option value="schema_b">Supplier B (nested camelCase)</option>
            <option value="schema_c">Supplier C (ALL_CAPS CSV)</option>
            <option value="schema_d">Supplier D (item_name format)</option>
          </select>
        )}
      </div>

      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Submit
      </button>
    </form>
  );
}
```

When `autoDetect` is true (the default), the form sends the raw payload with no `supplier_schema` field. The lambda discriminator in `SupplierProductAutoDetect` handles detection. When `autoDetect` is false, the user manually selects a format and the form injects `supplier_schema` -- which the lambda's fast path will pick up.

### Schema Version Badge in the Product Browser

The product browser should show which schema version each product was validated through. Since every validated product has `supplier_schema` set by `@Discriminator`, you can use it directly.

Update `apps/catalog-gui/src/components/ProductCard.tsx`:

```tsx
interface ProductCardProps {
  product: {
    product_name: string;
    category: string;
    base_cost: number;
    msrp: number;
    supplier_schema?: string;
  };
}

const SCHEMA_LABELS: Record<string, { label: string; color: string }> = {
  schema_a: { label: 'A - Flat', color: 'bg-green-100 text-green-800' },
  schema_b: { label: 'B - Nested', color: 'bg-blue-100 text-blue-800' },
  schema_c: { label: 'C - CSV', color: 'bg-yellow-100 text-yellow-800' },
  schema_d: { label: 'D - Item', color: 'bg-purple-100 text-purple-800' },
};

export function ProductCard({ product }: ProductCardProps) {
  const schema = SCHEMA_LABELS[product.supplier_schema ?? ''];

  return (
    <div className="border rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-lg">{product.product_name}</h3>
        {schema && (
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${schema.color}`}>
            {schema.label}
          </span>
        )}
        {!schema && product.supplier_schema == null && (
          <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
            v1 (legacy)
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600">{product.category}</p>
      <div className="mt-2 text-sm">
        <span className="text-gray-500">Cost:</span> ${product.base_cost.toFixed(2)}
        <span className="mx-2 text-gray-300">|</span>
        <span className="text-gray-500">MSRP:</span> ${product.msrp.toFixed(2)}
      </div>
    </div>
  );
}
```

Products from v1 (no `supplier_schema`) get a "v1 (legacy)" badge. Products validated through the discriminated union pipeline show their supplier format badge. You can now browse old and new entities side by side and immediately see which schema version each one uses.

## Step 7: Compare & Contrast

This is where the architecture difference becomes stark. Let's compare what happens when Supplier D shows up with a new format.

### Without discriminated unions + lambda

```
1. Schema changes require database migrations
   - ALTER TABLE to add new columns
   - Backfill script for old rows
   - Rollback plan if something breaks

2. Version-specific if/else branches everywhere
   if (record.version === 'v1') { ... }
   else if (record.version === 'v2') { ... }
   else if (record.version === 'v3') { ... }

3. Every service that reads the data needs updating
   - The API layer
   - The admin dashboard
   - The reporting pipeline
   - The export job

4. A format change is a deployment risk
   - Coordinate timing across services
   - Feature flags for gradual rollout
   - Monitor for deserialization errors
```

### With discriminated unions + lambda

```
1. Add a case to the lambda
   if ('item_name' in data) return 'schema_d';

2. Old data -> old classes, new data -> new classes
   - v1 flat data still routes to SupplierAProduct
   - v2 data with supplier_schema hits the fast path
   - v3 data from Supplier D routes to SupplierDProduct

3. The validator IS the migration layer
   - No ALTER TABLE
   - No backfill scripts
   - No version-specific branches in business logic

4. Zero downtime, zero data transformation
   - Deploy the new class and lambda case
   - Old entities load exactly as before
   - New entities validate through the new class
```

The key insight: the lambda discriminator turns schema versioning from a database problem into a routing problem. Old data isn't "migrated" to a new schema -- it's routed to the class that already knows how to handle it. The class *is* the schema.

## What's Next

Your pipeline handles multiple supplier formats and evolves without breaking old data. But when a field value looks wrong -- say, `base_cost` is negative after coercion, or `category` got lowercased to something unexpected -- how do you know which decorator changed it? In [Part 5: The Validation Trace](./part-05-validation-trace.md), we'll make the validation pipeline fully observable with a trace viewer that shows exactly what each decorator did to every field.

---

**Next:** [Part 5: The Validation Trace](./part-05-validation-trace.md) -- Making the decorator pipeline observable

**Previous:** [Part 3: Multi-Supplier Routing](./part-03-multi-supplier-routing.md) -- Discriminated unions with string discriminators
