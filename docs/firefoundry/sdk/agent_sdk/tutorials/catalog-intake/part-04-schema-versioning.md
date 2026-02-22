# Part 4: Schema Versioning & Auto-Detection

Your Part 3 pipeline routes payloads by reading a `supplier_schema` string field. Clean, simple -- and about to break in two ways at once.

**What you'll learn:**
- Lambda discriminators for structural format detection
- The two-phase pattern (fast path + detection path) for round-trip correctness
- How old V1 entities and new formats coexist without migrations

**What you'll build:** A `SupplierProductAutoDetect` class that routes payloads without requiring a `supplier_schema` field, plus auto-detect mode and version badges in the GUI.

---

## The Problem: Schema Rigidity

Two things happen in the same week.

**Problem 1: Supplier D joins -- and doesn't include `supplier_schema`.**

Their payload looks like this:

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

No `supplier_schema`. No type indicator. Just data.

**Problem 2: Old V1 entities don't have `supplier_schema` either.**

Your entity graph already has products from Part 1 -- before discriminated unions existed:

```json
{
  "product_name": "Blaze Runner",
  "category": "running",
  "base_cost": 89.99,
  "msrp": 159.99
}
```

Load either of these through the Part 3 pipeline and you get:

```
Unknown discriminator value: undefined
```

The string discriminator reads `payload.supplier_schema`, gets `undefined`, looks it up in the map, and throws. Your pipeline assumes every payload declares its own format -- but neither fresh Supplier D data nor old V1 entities do that.

You need a discriminator that can figure out the format by looking at the data itself.

## Lambda Discriminator

The fix is to replace the string discriminator with a function. Instead of `discriminator: 'supplier_schema'` (which reads a field), you pass `discriminator: (data) => string` (which inspects the data and returns a map key).

```typescript
@DiscriminatedUnion({
  discriminator: (data: Record<string, unknown>) => {
    // Phase 1 -- Fast path: round-tripped data already has supplier_schema
    if (typeof data.supplier_schema === 'string') return data.supplier_schema;

    // Phase 2 -- Detection path: inspect field names on fresh input
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

Ten lines of logic, and the two problems from above are both solved. But those ten lines are doing more than they appear to. Let's break down why both phases exist.

## Why Two Phases?

The two-phase pattern -- fast path first, detection second -- isn't just an optimization. It prevents a correctness bug.

### Phase 1: The Fast Path

```typescript
if (typeof data.supplier_schema === 'string') return data.supplier_schema;
```

This handles **serialized data** -- products that have already been validated, stored in the entity graph, and loaded back. But wait: if the original input from Supplier D didn't have a `supplier_schema` field, how does serialized data have one?

The answer is `@Discriminator` + `@Serializable`. Each subclass declares its discriminator value:

```typescript
@Serializable()
export class SupplierBProduct {
  @Discriminator('schema_b')
  supplier_schema!: string;
  // ...
}
```

When `@Serializable`'s `toJSON()` runs, it automatically includes the `@Discriminator` value in the output -- even though the original input never had a `supplier_schema` field. So a Supplier B product gets serialized as:

```json
{
  "supplier_schema": "schema_b",
  "product_name": "Blaze Runner",
  "category": "running",
  "base_cost": 89.99,
  "msrp": 159.99
}
```

The original nested structure (`productInfo`, `pricing`) is gone -- only the canonical flat fields remain. But the discriminator value is preserved. On read-back, the fast path catches it immediately.

### Phase 2: The Detection Path

```typescript
if ('productInfo' in data) return 'schema_b';
if ('PRODUCT_NAME' in data) return 'schema_c';
if ('item_name' in data) return 'schema_d';
return 'schema_a';
```

This handles **fresh input** -- raw supplier payloads that have never been through the pipeline. No `supplier_schema` field exists, so the lambda inspects the data shape. Supplier B always has `productInfo`. Supplier C uses ALL_CAPS keys. Supplier D has `item_name`. Everything else defaults to Supplier A's flat format.

### The Bug Without the Fast Path

Here's why you can't just use Phase 2 alone. Consider a Supplier C product (`PRODUCT_NAME`, `CATEGORY`, etc.) after it's been validated and serialized:

```json
{
  "supplier_schema": "schema_c",
  "product_name": "Court King",
  "category": "basketball",
  "base_cost": 99.99,
  "msrp": 179.99
}
```

The ALL_CAPS field names are gone. `PRODUCT_NAME` became `product_name` during validation via `@DerivedFrom`. If the lambda only had the detection path, it wouldn't find `PRODUCT_NAME` in the serialized data. It would fall through to `return 'schema_a'` and misroute a Supplier C product as Supplier A.

The fast path prevents this: `supplier_schema` is `"schema_c"`, so the lambda returns immediately without ever reaching the detection checks.

The rule: **fast path for round-trips, detection path for fresh input.** `@Serializable` auto-includes the `@Discriminator` value in `toJSON()` output. The fast path reads it. The detection path is the fallback for data that hasn't been through the pipeline yet.

## Schema Evolution in Practice

Now you can see how three generations of data coexist in the same entity graph, and the lambda handles all of them.

**V1 entities (Part 1 era):** No `supplier_schema`, just canonical fields.

```json
{ "product_name": "Blaze Runner", "category": "running", "base_cost": 89.99, "msrp": 159.99 }
```

Lambda: no `supplier_schema` (fast path skips), no `productInfo`, no `PRODUCT_NAME`, no `item_name`. Falls through to `return 'schema_a'`. Correct -- this is Supplier A's flat format.

**V2 entities (Part 3 era):** Stored with `@Discriminator` values baked in.

```json
{ "supplier_schema": "schema_b", "product_name": "Ember Court", "category": "basketball", ... }
```

Lambda: `supplier_schema` is `"schema_b"`. Fast path returns immediately.

**V3 input (Supplier D):** Fresh data, no discriminator.

```json
{ "item_name": "Trail Blazer GTX", "item_type": "hiking", "wholesale_price": 95.00, ... }
```

Lambda: no `supplier_schema`, no `productInfo`, no `PRODUCT_NAME`, finds `item_name`. Returns `'schema_d'`. After validation and storage, the entity has `supplier_schema: "schema_d"` baked in -- next time it loads, the fast path handles it.

Adding V4, V5, V6 is the same pattern:

1. Write a new subclass with its field mappings
2. Add one detection case to the lambda
3. Add one entry to the map

No existing data changes. No migrations. No database updates. The lambda *is* the migration layer.

## Compare: Migrations vs. Discriminated Unions

> **Without discriminated unions**, schema changes require database migrations -- `ALTER TABLE` to add columns, backfill scripts for old rows, rollback plans if something breaks. Every service that reads the data needs version-specific `if/else` branches. A format change is a deployment risk: coordinate timing across services, feature-flag the rollout, monitor for deserialization errors.
>
> **With discriminated unions + lambda**, you add a case to the lambda. Old data routes to old classes. New data routes to new classes. The validator *is* the schema. Zero downtime, zero data transformation, zero coordination between services.

The key insight: the lambda discriminator turns schema versioning from a database problem into a routing problem. Old data isn't "migrated" to a new schema -- it's routed to the class that already knows how to handle it.

## GUI Updates

Two changes: the intake form gets auto-detect mode, and the product browser shows version badges.

### Auto-Detect Toggle

In Part 3, the intake form had a manual format dropdown. Replace it with an auto-detect toggle that's on by default. When enabled, the form sends the raw payload as-is and lets the lambda figure out the format.

```tsx
const [autoDetect, setAutoDetect] = useState(true);

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  const payload = JSON.parse(rawJson);

  if (!autoDetect) {
    // Manual mode: inject the supplier_schema field
    payload.supplier_schema = format;
  }
  // Auto-detect mode: send the raw payload as-is.
  // The lambda discriminator inspects the data shape.

  onSubmit(payload, autoDetect);
};
```

In the form, show the manual dropdown only when auto-detect is off:

```tsx
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
  <select value={format} onChange={(e) => setFormat(e.target.value)}
    className="text-sm border rounded px-2 py-1">
    <option value="schema_a">Supplier A (flat snake_case)</option>
    <option value="schema_b">Supplier B (nested camelCase)</option>
    <option value="schema_c">Supplier C (ALL_CAPS CSV)</option>
    <option value="schema_d">Supplier D (item_name format)</option>
  </select>
)}
```

When `autoDetect` is true (the default), the raw payload hits the lambda discriminator with no `supplier_schema` field. The detection path kicks in. When `autoDetect` is false, the form injects `supplier_schema` and the fast path catches it.

### Version Badges

Every validated product has `supplier_schema` set by `@Discriminator`. Products from V1 (before discriminated unions) don't have the field at all. Use that difference to show version badges on the product cards.

```tsx
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

Products from V1 get a gray "v1 (legacy)" badge. Products validated through the discriminated union pipeline show their supplier format -- A, B, C, or D -- color-coded. You can browse old and new entities side by side and immediately see which schema version each one uses.

## What's Next

The validation pipeline handles multiple suppliers, auto-detects formats, and evolves without breaking old data. But it's a black box. When a supplier calls and says "I sent `'RUNNING'` but your system shows `'running'`" -- which decorator changed it? In [Part 5: The Validation Trace](./part-05-validation-trace.md), we'll make the pipeline observable with a per-field trace of every decorator execution.

---

**Next:** [Part 5: The Validation Trace](./part-05-validation-trace.md) -- Making the decorator pipeline observable

**Previous:** [Part 3: Multi-Supplier Routing](./part-03-multi-supplier-routing.md) -- Discriminated unions with string discriminators
