# Part 3: CSV Ingestion & Multi-Supplier Routing

Your API pipeline works. Products flow in, validation fires, entities land in the graph. Then your second supplier sends a CSV file, and everything falls apart.

In this part you'll handle a second supplier format -- CSV with ALL_CAPS fields, dollar-sign prices, and comma-separated sizes -- by building a V2 validator and wiring both formats through a discriminated union. One entry point, two validators, zero if/else branches.

> **Prerequisite:** Complete [Part 2: The Catalog GUI](./part-02-catalog-gui.md). You should have a working intake form and product browser.

---

## The Problem: A Second Supplier

The V1 validator from Part 1 expects flat, snake_case fields like `product_name`, `base_cost`, and `size_range`. That works for Supplier A's API payloads. Now Supplier B exports from a CSV tool, and a row looks like this:

```
PRODUCT_ID,PRODUCT_NAME,CATEGORY,BRAND,GENDER,BASE_COST,MSRP,COLORWAY,SIZES
FK-BLZ-001,BLAZE RUNNER,RUNNING,FIREKICKS,MENS,$89.99,$159.99,BLACK/WHITE,"7,8,9,10,11,12,13"
```

Three things break when you feed this to V1:

1. **ALL_CAPS field names.** V1 expects `product_name`, not `PRODUCT_NAME`. `@Copy()` finds nothing -- the field names don't match.
2. **Dollar signs in prices.** `@CoerceType('number')` can handle `"89.99"` but chokes on `"$89.99"`. That's not a number, it's a string with a currency symbol.
3. **Extra fields.** The CSV has `BRAND`, `GENDER`, `COLORWAY`, and `SIZES` -- fields V1 doesn't define. V1 has `size_range` (not `SIZES`), and the other fields don't exist at all. They'll be silently dropped, losing data you actually want.

If you try it anyway, the factory gives you this:

```
ValidationError: 2 failures on SupplierProductValidator
  - product_name: required (got undefined)
  - base_cost: expected number, got "$89.99"
```

Every field that V1 looks for by name comes back `undefined` because the source names don't match. The fields V1 does find by coincidence (`BASE_COST`) fail coercion because of the dollar sign. It's not a bug in V1 -- V1 is doing exactly what it was designed to do. The data just doesn't fit.

You could patch V1 with conditionals, but that's the wrong move. V1 works perfectly for Supplier A. Changing it risks breaking a working pipeline. Instead, you'll build a second validator that speaks CSV-format natively.

---

## The V2 Validator

Create a new class, `SupplierProductV2`, that maps CSV fields to the canonical output shape. Here are the key fields:

```typescript
@Serializable()
@UseSinglePassValidation()
export class SupplierProductV2 {
  @Discriminator('v2_csv')
  supplier_schema!: string;

  @DerivedFrom('$.PRODUCT_NAME')
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('$.BASE_COST')
  @CoerceParse('currency')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @DerivedFrom('$.MSRP')
  @CoerceParse('currency')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @DerivedFrom('$.SIZES')
  @CoerceTrim()
  @ValidateRequired()
  sizes!: string;

  // ... remaining fields follow the same pattern (full class in companion repo)
}
```

Three decorators are doing the heavy lifting here:

**`@Discriminator('v2_csv')`** -- This tag tells the discriminated union (next section) that this class handles payloads tagged with `"v2_csv"`. It's a declaration, not logic.

**`@DerivedFrom('$.PRODUCT_NAME')`** -- Maps an ALL_CAPS source field to the canonical `product_name` output. The `$` is JSONPath syntax: `$.PRODUCT_NAME` means "the `PRODUCT_NAME` field at the root of the input object." This is what lets you rename fields declaratively -- no manual `obj.PRODUCT_NAME` destructuring.

**`@CoerceParse('currency')`** -- Strips the `$` and converts to a number. `"$89.99"` becomes `89.99`. This is different from `@CoerceType('number')` in V1, which only handles plain numeric strings. `CoerceParse` understands format-specific patterns like currency symbols, so you don't write `parseFloat(str.replace('$', ''))` yourself.

Compare this to the V1 approach for the same fields:

```typescript
// V1: flat snake_case, no currency symbols
@Copy()
@CoerceType('number')
@ValidateRequired()
base_cost!: number;
```

V1 uses `@Copy()` because the source field name already matches. V2 uses `@DerivedFrom()` because it doesn't. V1 uses `@CoerceType('number')` because the value is `"89.99"`. V2 uses `@CoerceParse('currency')` because the value is `"$89.99"`. Different decorators, same output type.

Notice that V1 and V2 handle sizes differently. V1 has a `size_range` field (a plain trimmed string like `"7-13"`). V2 has a `sizes` field mapped from `$.SIZES` (a comma-separated list like `"7,8,9,10,11,12,13"`). Each validator class owns the field names and rules for its format. V1 and V2 don't have to agree on how sizes are represented -- they each define the fields their supplier format actually provides.

---

## The Discriminated Union

Now you have two validators, but nothing connects them. The discriminated union is the glue:

```typescript
@DiscriminatedUnion({
  discriminator: 'supplier_schema',
  map: {
    v1_api: SupplierProductV1,
    v2_csv: SupplierProductV2,
  },
})
@Serializable()
export class SupplierProductDraft {
  @Copy()
  supplier_schema!: string;
}
```

Here's the runtime flow when a CSV payload arrives:

```
1. factory.create(SupplierProductDraft, payload)
2. Factory reads payload.supplier_schema  -->  "v2_csv"
3. Looks up "v2_csv" in the map           -->  SupplierProductV2
4. Instantiates SupplierProductV2
5. Decorators fire in order:
   - @DerivedFrom('$.PRODUCT_NAME')       -->  extracts "BLAZE RUNNER"
   - @CoerceCase('title')                 -->  "Blaze Runner"
   - @CoerceParse('currency')             -->  "$89.99" becomes 89.99
6. Returns a canonical product instance
```

The caller doesn't know which class handled the payload. It just calls `factory.create()` and gets back a validated product with the same shape regardless of source format.

An API payload with `"supplier_schema": "v1_api"` routes to V1. A CSV-derived payload with `"supplier_schema": "v2_csv"` routes to V2. One entry point, two validators.

> **Why not if/else?** Every new supplier format means another branch, and every new field means editing every branch. With the union, adding Supplier C means writing one class and adding one line to the `map`. Nothing else changes.

There's a subtlety worth noting: the `SupplierProductDraft` class itself only has one field -- `supplier_schema`. It doesn't redeclare `product_name`, `base_cost`, or any other product fields. Those live on the branch classes (V1 and V2). The draft class is purely a routing layer. The factory reads the discriminator, picks the branch, and the branch class defines the full output shape.

This means the bot works with the branch class instance directly. After `factory.create()` returns, you have a `SupplierProductV1` or `SupplierProductV2` -- complete with all fields validated and coerced. The `SupplierProductDraft` wrapper is gone.

---

## The CSV Ingestion Workflow

The API workflow from Part 1 accepted JSON over HTTP. The CSV workflow is similar but adds a parsing step: read the file, convert each row to a keyed object, tag it with `supplier_schema: 'v2_csv'`, and feed it through the same factory.

Here's the core of `CsvIngestionWorkflow`:

```typescript
async processFile(csvContent: string): Promise<ValidationResult[]> {
  const rows = parseCsv(csvContent); // each row is a Record<string, string>

  const results = await Promise.all(
    rows.map((row) =>
      this.validationFactory.create(SupplierProductDraft, {
        ...row,
        supplier_schema: 'v2_csv',
      })
    )
  );

  return results;
}
```

The `supplier_schema` tag is injected here, not expected in the CSV itself. The CSV just has data columns. The workflow knows it's processing a CSV file, so it stamps each row accordingly before handing it to the factory.

This is the same `factory.create(SupplierProductDraft, ...)` call that the API workflow uses -- the only difference is the source of the payload and the `supplier_schema` value.

A few things to notice about this pattern:

- **The CSV never contains `supplier_schema`.** That's a routing concern, not a data concern. The workflow injects it because it knows where the data came from.
- **`parseCsv` turns each row into a flat object** with the header names as keys: `{ PRODUCT_ID: "FK-BLZ-001", PRODUCT_NAME: "BLAZE RUNNER", ... }`. This is exactly the shape that `@DerivedFrom('$.PRODUCT_NAME')` expects.
- **Errors are per-row.** If row 3 has a missing product name and row 7 has a negative price, those rows fail individually. The rest succeed. You get back an array of results, each with its own validation status.

---

## GUI Updates

Three additions to the GUI: a file upload component, supplier format badges in the product browser, and a side-by-side raw-vs-canonical view.

### File upload for CSV

Add a file input that reads the CSV, parses it client-side, and submits each row through the existing intake endpoint:

```tsx
const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const res = await fetch('/api/intake/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: text,
  });

  const data = await res.json();
  setResults(data.products);
};
```

```tsx
<input
  type="file"
  accept=".csv"
  onChange={handleFileUpload}
  className="block w-full text-sm text-gray-500
    file:mr-4 file:rounded file:border-0
    file:bg-blue-50 file:px-4 file:py-2
    file:text-sm file:font-semibold file:text-blue-700
    hover:file:bg-blue-100"
/>
```

The `/api/intake/csv` route handles parsing server-side and returns the validated products. Users drag-and-drop a CSV and see results instantly.

### Supplier format badges

In the product browser, show which format each product came from:

```tsx
const SCHEMA_BADGES: Record<string, { label: string; color: string }> = {
  v1_api: { label: 'API', color: 'bg-blue-100 text-blue-800' },
  v2_csv: { label: 'CSV', color: 'bg-amber-100 text-amber-800' },
};

function SupplierBadge({ schema }: { schema: string }) {
  const badge = SCHEMA_BADGES[schema] ?? {
    label: schema,
    color: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>
      {badge.label}
    </span>
  );
}
```

Now when you browse products, you can see at a glance which ones came from the API pipeline and which came from a CSV upload.

### Side-by-side view

When a product is validated -- from either the JSON form or CSV upload -- show the raw input on the left and the canonical output on the right:

```tsx
{result && (
  <div className="mt-4 grid grid-cols-2 gap-4">
    <div>
      <h3 className="text-sm font-medium text-gray-700">Raw Input</h3>
      <pre className="mt-1 rounded bg-gray-100 p-3 text-xs overflow-auto">
        {JSON.stringify(result.raw, null, 2)}
      </pre>
    </div>
    <div>
      <h3 className="text-sm font-medium text-gray-700">Canonical Output</h3>
      <pre className="mt-1 rounded bg-green-50 p-3 text-xs overflow-auto">
        {JSON.stringify(result.product, null, 2)}
      </pre>
    </div>
  </div>
)}
```

Upload a CSV row where `BASE_COST` is `"$89.99"` and `PRODUCT_NAME` is `"BLAZE RUNNER"`. On the left you see the raw ALL_CAPS fields. On the right: `base_cost: 89.99` and `product_name: "Blaze Runner"`. The decorators did all the work.

This is the fastest way to verify your decorators are correct. If `@CoerceParse('currency')` isn't stripping the dollar sign, you'll see it immediately in the side-by-side view -- no need to dig through logs or inspect entity graph records.

---

## Putting It Together

Let's trace a full CSV upload end-to-end to make sure the pieces connect:

1. User drags `firekicks-catalog.csv` onto the upload component.
2. The browser reads the file and POSTs the raw text to `/api/intake/csv`.
3. The API route calls `CsvIngestionWorkflow.processFile()`, which parses the CSV into row objects.
4. Each row gets `supplier_schema: 'v2_csv'` injected and is passed to `factory.create(SupplierProductDraft, row)`.
5. The factory reads `"v2_csv"`, looks it up in the union map, and dispatches to `SupplierProductV2`.
6. V2's decorators fire: `@DerivedFrom` maps fields, `@CoerceParse('currency')` strips dollar signs, `@CoerceCase('title')` fixes casing.
7. The validated product is stored as a typed entity in the graph, tagged with `supplier_schema: 'v2_csv'`.
8. The response flows back to the GUI, which renders the side-by-side view and adds a "CSV" badge.

Meanwhile, the existing JSON intake form still works exactly as before -- it sends `"supplier_schema": "v1_api"` and routes to V1. The two paths share a factory call and an entity type, but nothing else.

---

## What You've Built

You now have two supplier formats flowing through one pipeline:

- **`SupplierProductV1`** handles API payloads with flat snake_case fields
- **`SupplierProductV2`** handles CSV data with ALL_CAPS fields, currency strings, and comma-separated sizes
- **`SupplierProductDraft`** is the discriminated union that routes to the right validator based on `supplier_schema`
- **The bot doesn't change** -- it still calls `factory.create()` and gets a canonical product
- **The GUI** now supports CSV file upload, shows format badges, and displays raw-vs-canonical comparisons

Adding a third supplier means writing one new class and adding one line to the union's `map`. No changes to V1, V2, the bot, or the GUI.

---

## What's Next

Both formats currently require a `supplier_schema` field -- either present in the API payload or injected by the CSV workflow. That works when you control the ingestion path, but what happens when a new supplier sends data and you don't know the format ahead of time? In [Part 4: Schema Versioning & Auto-Detection](./part-04-schema-versioning.md), we'll replace the string discriminator with a lambda that auto-detects the format by inspecting the data shape.

**Previous:** [Part 2: The Catalog GUI](./part-02-catalog-gui.md) | **Next:** [Part 4: Schema Versioning & Auto-Detection](./part-04-schema-versioning.md)
