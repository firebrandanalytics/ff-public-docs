# Part 3: Multi-Supplier Routing

In Parts 1 and 2, we built a working agent bundle and wired up a GUI -- but everything assumed a single supplier sending flat, snake_case JSON. That was fine for getting started, but FireKicks doesn't have one supplier. It has three, and they each send data in completely different formats.

In this part, you'll replace the V1 validator with a `@DiscriminatedUnion` that routes each supplier's payload to a format-specific class. All three classes produce the same canonical output. The bot doesn't care which supplier sent the data -- it just calls `factory.create()` and gets a clean product every time.

**What you'll learn:**
- Using `@DiscriminatedUnion` and `@Discriminator` to route payloads by format
- Extracting fields from nested JSON with `@DerivedFrom` and JSONPath
- Parsing messy strings with `@CoerceParse('currency')`
- Keeping a single canonical output shape across multiple input formats

**What you'll build:** Three supplier-specific validation classes behind one discriminated union, a bot that handles all three transparently, and GUI updates to select and display the supplier format.

---

## Step 1: The Problem -- One Format Doesn't Fit All

Open the V1 validator from Part 1. It uses `@Copy()` and `@CoerceTrim()` to map flat fields like `product_name`, `category`, and `base_cost`. That works for Supplier A, whose payloads look like this:

```json
{
  "supplier_schema": "schema_a",
  "product_name": "Trail Blazer",
  "category": "hiking",
  "subcategory": "men's",
  "brand_line": "outdoor",
  "base_cost": "79.99",
  "msrp": "139.99",
  "color_variant": "Forest Green",
  "size_range": "7-13"
}
```

Now look at what Supplier B sends -- nested camelCase with dollar signs in the prices:

```json
{
  "supplier_schema": "schema_b",
  "productInfo": {
    "name": "Blaze Runner",
    "categoryCode": "Running",
    "subcategory": "men's",
    "brandLine": "performance"
  },
  "pricing": {
    "cost": "$89.99",
    "retailPrice": "$159.99"
  },
  "specs": {
    "colorway": "Black/White",
    "sizes": "7-13"
  }
}
```

And Supplier C, whose data comes from a CSV export -- everything is ALL_CAPS with dollar signs:

```json
{
  "supplier_schema": "schema_c",
  "PRODUCT_NAME": "COURT KING",
  "CATEGORY": "BASKETBALL",
  "SUBCATEGORY": "MENS",
  "BRAND_LINE": "STREET",
  "BASE_COST": "$99.99",
  "MSRP": "$179.99",
  "COLOR_VARIANT": "RED/WHITE",
  "SIZE_RANGE": "8-14"
}
```

Feed Supplier B's payload into the V1 validator and you get empty fields -- there's no `product_name` at the top level, so `@Copy()` finds nothing. Feed Supplier C's payload and you get the same problem, plus raw dollar signs where numbers should be.

You could add if/else branches:

```typescript
// Don't do this
function normalizeProduct(raw: any): CanonicalProduct {
  if (raw.supplier_schema === 'schema_a') {
    return { product_name: raw.product_name, base_cost: parseFloat(raw.base_cost), ... };
  } else if (raw.supplier_schema === 'schema_b') {
    return { product_name: raw.productInfo?.name, base_cost: parseCurrency(raw.pricing?.cost), ... };
  } else if (raw.supplier_schema === 'schema_c') {
    return { product_name: titleCase(raw.PRODUCT_NAME), base_cost: parseCurrency(raw.BASE_COST), ... };
  }
  throw new Error(`Unknown schema: ${raw.supplier_schema}`);
}
```

This grows linearly with each new supplier. Every new field means editing every branch. Every new supplier means another branch. Let's do better.

## Step 2: Create Supplier-Specific Classes

Instead of if/else, you'll create one class per supplier format. Each class uses decorators to map from that supplier's field structure to the canonical output shape. They all extend a common base and produce identical output.

### Supplier A -- Flat snake_case

Supplier A is the "clean" format. Field names already match the canonical schema, so most fields are just `@Copy()` with light normalization.

**`packages/shared-types/src/validators/SupplierAProduct.ts`**:

```typescript
import {
  Serializable,
  UseSinglePassValidation,
  Discriminator,
  Copy,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
@UseSinglePassValidation()
export class SupplierAProduct {
  @Discriminator('schema_a')
  supplier_schema!: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name!: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @Copy()
  @CoerceTrim()
  subcategory!: string;

  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @Copy()
  @CoerceType('number')
  base_cost!: number;

  @Copy()
  @CoerceType('number')
  msrp!: number;

  @Copy()
  @CoerceTrim()
  color_variant!: string;

  @Copy()
  @CoerceTrim()
  size_range!: string;
}
```

This is essentially the V1 validator from Part 1 with two additions: `@Discriminator('schema_a')` marks which union branch this class handles, and `@Serializable()` makes the output safe for entity graph storage.

### Supplier B -- Nested camelCase

Supplier B nests everything inside `productInfo`, `pricing`, and `specs` objects. The `@DerivedFrom` decorator with JSONPath expressions extracts values from deep inside the raw payload. Prices arrive as strings like `"$89.99"`, so `@CoerceParse('currency')` strips the dollar sign and converts to a number.

**`packages/shared-types/src/validators/SupplierBProduct.ts`**:

```typescript
import {
  Serializable,
  UseSinglePassValidation,
  Discriminator,
  DerivedFrom,
  CoerceTrim,
  CoerceCase,
  CoerceParse,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
@UseSinglePassValidation()
export class SupplierBProduct {
  @Discriminator('schema_b')
  supplier_schema!: string;

  @DerivedFrom('$.productInfo.name')
  @CoerceTrim()
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('$.productInfo.categoryCode')
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @DerivedFrom('$.productInfo.subcategory')
  @CoerceTrim()
  subcategory!: string;

  @DerivedFrom('$.productInfo.brandLine')
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @DerivedFrom('$.pricing.cost')
  @CoerceParse('currency')
  base_cost!: number;

  @DerivedFrom('$.pricing.retailPrice')
  @CoerceParse('currency')
  msrp!: number;

  @DerivedFrom('$.specs.colorway')
  @CoerceTrim()
  color_variant!: string;

  @DerivedFrom('$.specs.sizes')
  @CoerceTrim()
  size_range!: string;
}
```

Look at what `@DerivedFrom('$.pricing.cost')` does. The raw input has `{ pricing: { cost: "$89.99" } }`. The JSONPath expression navigates into the nested structure, pulls out `"$89.99"`, and hands it to the next decorator in the chain. Then `@CoerceParse('currency')` strips the dollar sign and converts it to `89.99`. No manual destructuring. No `parseFloat(str.replace('$', ''))`.

### Supplier C -- ALL_CAPS (CSV-derived)

Supplier C exports from a CSV tool, so everything is uppercase with dollar signs on prices. `@DerivedFrom` maps the ALL_CAPS field names to canonical output names, `@CoerceCase('title')` converts `"COURT KING"` to `"Court King"`, and `@CoerceParse('currency')` handles the price strings.

**`packages/shared-types/src/validators/SupplierCProduct.ts`**:

```typescript
import {
  Serializable,
  UseSinglePassValidation,
  Discriminator,
  DerivedFrom,
  CoerceTrim,
  CoerceCase,
  CoerceParse,
  CoerceType,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
@UseSinglePassValidation()
export class SupplierCProduct {
  @Discriminator('schema_c')
  supplier_schema!: string;

  @DerivedFrom('$.PRODUCT_NAME')
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('$.CATEGORY')
  @CoerceTrim()
  @CoerceCase('lower')
  category!: string;

  @DerivedFrom('$.SUBCATEGORY')
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @DerivedFrom('$.BRAND_LINE')
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @DerivedFrom('$.BASE_COST')
  @CoerceParse('currency')
  base_cost!: number;

  @DerivedFrom('$.MSRP')
  @CoerceParse('currency')
  msrp!: number;

  @DerivedFrom('$.COLOR_VARIANT')
  @CoerceTrim()
  color_variant!: string;

  @DerivedFrom('$.SIZE_RANGE')
  @CoerceTrim()
  size_range!: string;
}
```

Three classes, three completely different input shapes, one canonical output: `{ product_name, category, subcategory, brand_line, base_cost, msrp, color_variant, size_range }`.

### Export them

**`packages/shared-types/src/validators/index.ts`**:

```typescript
export { SupplierAProduct } from './SupplierAProduct.js';
export { SupplierBProduct } from './SupplierBProduct.js';
export { SupplierCProduct } from './SupplierCProduct.js';
export { SupplierProductDraftV3 } from './SupplierProductDraftV3.js';
```

## Step 3: Wire the Discriminated Union

The three supplier classes exist, but nothing connects them yet. The `@DiscriminatedUnion` decorator ties them together. When you call `factory.create(SupplierProductDraftV3, payload)`, the factory reads the `supplier_schema` field from the raw payload, looks it up in the `map`, and dispatches to the correct class.

**`packages/shared-types/src/validators/SupplierProductDraftV3.ts`**:

```typescript
import {
  Serializable,
  DiscriminatedUnion,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';
import { SupplierAProduct } from './SupplierAProduct.js';
import { SupplierBProduct } from './SupplierBProduct.js';
import { SupplierCProduct } from './SupplierCProduct.js';

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

Here's what happens at runtime when a Supplier B payload arrives:

```
1. factory.create(SupplierProductDraftV3, payload)
2. Factory reads payload.supplier_schema  ->  "schema_b"
3. Looks up "schema_b" in the map         ->  SupplierBProduct
4. Instantiates SupplierBProduct
5. All decorators on SupplierBProduct fire:
   - @DerivedFrom('$.productInfo.name')   ->  extracts "Blaze Runner"
   - @CoerceParse('currency')             ->  "$89.99" becomes 89.99
   - @CoerceCase('lower')                 ->  "Running" becomes "running"
   - ... every field gets mapped and cleaned
6. Returns a canonical product instance
```

The caller doesn't know or care that SupplierBProduct was used. The output has the same shape as Supplier A and Supplier C. It's the same product, just from a different source.

> **Data Classes > Raw JSON:** Without the discriminated union, your bot would need to understand every supplier's format -- spreading format-specific logic across the codebase. With the union, the bot sees one type: `SupplierProductDraftV3`. The format complexity is fully encapsulated in the validation classes.

## Step 4: Update the Bot

The bot needs exactly one change: swap the V1 validation class for `SupplierProductDraftV3`.

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`** (updated):

```typescript
import {
  RegisterBot,
  MixinBot,
  ComposeMixins,
  StructuredOutputBotMixin,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';
import { SupplierProductDraftV3 } from '@catalog-intake/shared-types';

const validationFactory = new ValidationFactory();

@RegisterBot('CatalogIntakeBot')
export class CatalogIntakeBot extends ComposeMixins(MixinBot, StructuredOutputBotMixin) {
  constructor() {
    super({
      name: 'CatalogIntakeBot',
      modelPoolName: 'default',
    });
  }

  async validateProduct(rawPayload: Record<string, any>) {
    // The factory reads supplier_schema and dispatches automatically.
    // The bot doesn't know which supplier class was used.
    const product = await validationFactory.create(
      SupplierProductDraftV3,
      rawPayload,
    );

    logger.info('[CatalogIntakeBot] Validated product', {
      product_name: product.product_name,
      supplier_schema: product.supplier_schema,
      base_cost: product.base_cost,
    });

    return product;
  }

  public override get_semantic_label_impl(): string {
    return 'CatalogIntakeBot';
  }
}
```

The raw payload must include a `supplier_schema` field (`"schema_a"`, `"schema_b"`, or `"schema_c"`). The GUI will add it via a dropdown (next step), or the system can inject it based on which supplier API sent the data.

## Step 5: Update the GUI

The GUI needs three changes: a supplier format selector on the intake form, a format badge on the product browser, and a side-by-side view showing raw input vs. canonical output.

### Intake form: add "Supplier Format" dropdown

**`apps/catalog-gui/src/components/IntakeForm.tsx`** (updated):

```tsx
'use client';

import { useState } from 'react';

const SUPPLIER_FORMATS = [
  { value: 'schema_a', label: 'Supplier A (flat snake_case)' },
  { value: 'schema_b', label: 'Supplier B (nested camelCase)' },
  { value: 'schema_c', label: 'Supplier C (ALL_CAPS CSV)' },
];

export function IntakeForm() {
  const [supplierSchema, setSupplierSchema] = useState('schema_a');
  const [rawPayload, setRawPayload] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const parsed = JSON.parse(rawPayload);
      // Inject the supplier_schema from the dropdown
      const payload = { ...parsed, supplier_schema: supplierSchema };

      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="supplier-format" className="block text-sm font-medium">
          Supplier Format
        </label>
        <select
          id="supplier-format"
          value={supplierSchema}
          onChange={(e) => setSupplierSchema(e.target.value)}
          className="mt-1 block w-full rounded border-gray-300 shadow-sm"
        >
          {SUPPLIER_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="raw-payload" className="block text-sm font-medium">
          Raw Supplier Payload (JSON)
        </label>
        <textarea
          id="raw-payload"
          value={rawPayload}
          onChange={(e) => setRawPayload(e.target.value)}
          rows={12}
          className="mt-1 block w-full rounded border-gray-300 font-mono text-sm"
          placeholder='{ "product_name": "Trail Blazer", "category": "hiking", ... }'
        />
      </div>

      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">
        Submit for Validation
      </button>

      {error && <p className="text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-medium">Raw Input</h3>
            <pre className="mt-1 rounded bg-gray-100 p-3 text-xs overflow-auto">
              {rawPayload}
            </pre>
          </div>
          <div>
            <h3 className="font-medium">Canonical Output</h3>
            <pre className="mt-1 rounded bg-green-50 p-3 text-xs overflow-auto">
              {JSON.stringify(result.product, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </form>
  );
}
```

The side-by-side view at the bottom is the key addition. When a product is validated, you see the raw input on the left and the canonical output on the right. Paste in a Supplier B nested payload, and the right side shows the same flat structure you'd get from Supplier A.

### Product browser: show supplier format badge

**`apps/catalog-gui/src/components/ProductCard.tsx`** (updated):

```tsx
const SCHEMA_LABELS: Record<string, { label: string; color: string }> = {
  schema_a: { label: 'A', color: 'bg-blue-100 text-blue-800' },
  schema_b: { label: 'B', color: 'bg-purple-100 text-purple-800' },
  schema_c: { label: 'C', color: 'bg-orange-100 text-orange-800' },
};

interface ProductCardProps {
  product: {
    product_name: string;
    category: string;
    base_cost: number;
    msrp: number;
    color_variant: string;
    supplier_schema: string;
  };
}

export function ProductCard({ product }: ProductCardProps) {
  const schema = SCHEMA_LABELS[product.supplier_schema] ?? {
    label: '?',
    color: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="rounded border p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{product.product_name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${schema.color}`}>
          {schema.label}
        </span>
      </div>
      <p className="text-sm text-gray-600">{product.category}</p>
      <p className="mt-1 text-sm">
        ${product.base_cost.toFixed(2)} / ${product.msrp.toFixed(2)}
      </p>
      <p className="text-xs text-gray-400">{product.color_variant}</p>
    </div>
  );
}
```

Every product card now shows a small badge -- "A", "B", or "C" -- so you can see at a glance which supplier it came from. The product data itself is always in canonical form.

## Step 6: Test All Three Formats

Build and deploy, then test with all three supplier formats. Each payload includes a `supplier_schema` field that tells the factory which class to use.

### Supplier A test payload

```json
{
  "supplier_schema": "schema_a",
  "product_name": "Trail Blazer",
  "category": "hiking",
  "subcategory": "men's",
  "brand_line": "outdoor",
  "base_cost": "79.99",
  "msrp": "139.99",
  "color_variant": "Forest Green",
  "size_range": "7-13"
}
```

### Supplier B test payload

```json
{
  "supplier_schema": "schema_b",
  "productInfo": {
    "name": "Blaze Runner",
    "categoryCode": "Running",
    "subcategory": "men's",
    "brandLine": "performance"
  },
  "pricing": {
    "cost": "$89.99",
    "retailPrice": "$159.99"
  },
  "specs": {
    "colorway": "Black/White",
    "sizes": "7-13"
  }
}
```

### Supplier C test payload

```json
{
  "supplier_schema": "schema_c",
  "PRODUCT_NAME": "COURT KING",
  "CATEGORY": "BASKETBALL",
  "SUBCATEGORY": "MENS",
  "BRAND_LINE": "STREET",
  "BASE_COST": "$99.99",
  "MSRP": "$179.99",
  "COLOR_VARIANT": "RED/WHITE",
  "SIZE_RANGE": "8-14"
}
```

### Expected output (all three)

All three produce the same canonical shape:

```json
{
  "supplier_schema": "schema_a",
  "product_name": "Trail Blazer",
  "category": "hiking",
  "subcategory": "men's",
  "brand_line": "outdoor",
  "base_cost": 79.99,
  "msrp": 139.99,
  "color_variant": "Forest Green",
  "size_range": "7-13"
}
```

```json
{
  "supplier_schema": "schema_b",
  "product_name": "Blaze Runner",
  "category": "running",
  "subcategory": "men's",
  "brand_line": "performance",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color_variant": "Black/White",
  "size_range": "7-13"
}
```

```json
{
  "supplier_schema": "schema_c",
  "product_name": "Court King",
  "category": "basketball",
  "subcategory": "mens",
  "brand_line": "street",
  "base_cost": 99.99,
  "msrp": 179.99,
  "color_variant": "RED/WHITE",
  "size_range": "8-14"
}
```

Notice what changed in each case:
- **Supplier A**: `base_cost` went from string `"79.99"` to number `79.99` (via `@CoerceType('number')`). Category was already lowercase.
- **Supplier B**: Nested fields were flattened (`$.productInfo.name` became `product_name`). Dollar signs were stripped (`"$89.99"` became `89.99`). `"Running"` was lowered to `"running"`.
- **Supplier C**: ALL_CAPS were title-cased (`"COURT KING"` became `"Court King"`). Dollar signs were stripped. Category was lowered.

The entity graph stores the canonical data along with the `supplier_schema` discriminator, so you always know where the data came from but never have to deal with the original format again.

### Test with ff-sdk-cli

You can also test directly against the agent bundle without the GUI:

```bash
# Supplier A
ff-sdk-cli api call intake \
  --method POST \
  --body '{"supplier_schema":"schema_a","product_name":"Trail Blazer","category":"hiking","subcategory":"men'\''s","brand_line":"outdoor","base_cost":"79.99","msrp":"139.99","color_variant":"Forest Green","size_range":"7-13"}' \
  --url http://localhost:3001

# Supplier B
ff-sdk-cli api call intake \
  --method POST \
  --body '{"supplier_schema":"schema_b","productInfo":{"name":"Blaze Runner","categoryCode":"Running","subcategory":"men'\''s","brandLine":"performance"},"pricing":{"cost":"$89.99","retailPrice":"$159.99"},"specs":{"colorway":"Black/White","sizes":"7-13"}}' \
  --url http://localhost:3001

# Supplier C
ff-sdk-cli api call intake \
  --method POST \
  --body '{"supplier_schema":"schema_c","PRODUCT_NAME":"COURT KING","CATEGORY":"BASKETBALL","SUBCATEGORY":"MENS","BRAND_LINE":"STREET","BASE_COST":"$99.99","MSRP":"$179.99","COLOR_VARIANT":"RED/WHITE","SIZE_RANGE":"8-14"}' \
  --url http://localhost:3001
```

All three should return the canonical shape. Use `ff-eg-read` to verify the entities were stored correctly:

```bash
ff-eg-read search nodes-scoped --page 1 --size 5 \
  --condition '{"specific_type_name": "SupplierProductEntity"}' \
  --order-by '{"created": "desc"}'
```

## What You've Built

You now have:
- **Three supplier-specific validation classes** -- each with its own field mappings and transformations
- **One discriminated union** -- `SupplierProductDraftV3` routes to the right class based on `supplier_schema`
- **A bot that handles all three formats transparently** -- one `factory.create()` call, no if/else
- **A GUI with format selection and side-by-side comparison** -- paste any supplier's payload and see the canonical output

Adding a fourth supplier means writing one new class and adding one line to the `map`. No changes to the bot, no changes to the GUI, no changes to Suppliers A, B, or C.

## Key Takeaways

1. **`@DiscriminatedUnion` replaces if/else trees** -- The factory reads a discriminator field and dispatches to the matching class. No branching logic in your code.
2. **`@DerivedFrom` with JSONPath handles nesting** -- `'$.productInfo.name'` navigates into nested objects declaratively. No manual destructuring.
3. **`@CoerceParse('currency')` handles messy strings** -- `"$89.99"` becomes `89.99` without any `parseFloat(str.replace('$', ''))`.
4. **Each supplier is isolated** -- A bug in Supplier C's class can't break Supplier A. Each class can be unit tested independently.
5. **The canonical shape is the contract** -- Everything downstream (the bot, the GUI, the entity graph) works with one shape. The format complexity is fully encapsulated in the validation classes.

---

## What's Next

Every product now has a `supplier_schema` field, but what happens when a new supplier joins and you don't want to require a format tag? In [Part 4: Schema Versioning & Auto-Detection](./part-04-schema-versioning.md), we'll add a lambda discriminator that auto-detects the format by inspecting the data shape -- and we'll tackle schema versioning so old entities keep working when the model evolves.

**Previous:** [Part 2: The Catalog GUI](./part-02-catalog-gui.md)
