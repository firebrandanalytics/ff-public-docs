# Part 5: The Validation Trace

Your validation pipeline now routes Supplier A, B, C, and D payloads to the right validator, handles schema evolution, and normalizes everything into a clean `SupplierProductValidator` shape. But when something looks wrong in the output -- a supplier calls and says "I sent 'RUNNING' but your system shows 'running'" -- you're stuck reading decorator code and guessing. In this part you'll make the entire pipeline observable by capturing a per-field trace of every decorator execution, introducing `@Staging` for hidden scaffolding properties, and building a trace viewer in the GUI.

> **Prerequisite:** Complete [Part 4: Schema Versioning & Auto-Detection](./part-04-schema-versioning.md) first. You should have a working `@DiscriminatedUnion` with lambda auto-detection routing across all supplier formats.

---

## Step 1: The Problem -- "Why Did My Data Change?"

Three real scenarios that come up the moment your system has more than a handful of submissions:

1. **Supplier B calls:** "I sent `'RUNNING'` as the category. Your system shows `'running'`. What happened?"
2. **A product reviewer asks:** "The product name says `'Nike Air Max 90'` but the supplier sent `'  nike air MAX 90  '`. Where did the title case come from?"
3. **You're debugging:** A `base_cost` shows `89.99` but the supplier sent `"$89.99 USD"`. Which decorator parsed the currency string? Was it `@CoerceParse` or `@CoerceType`?

Without a trace, you'd answer each of these by reading the validator class, mentally replaying the decorator stack, and hoping you got the order right. That's fine for one class with eight fields. It's miserable for a discriminated union with four supplier formats and nested extraction.

The fix: capture a trace of exactly what each decorator did to each field, store it alongside the product, and build a viewer for it.

---

## Step 2: Capture the Validation Trace

The `ValidationFactory.create()` method accepts a `trace` option. When enabled, the factory records every decorator execution -- which property it touched, what the value was before and after, and what decorator type fired.

Update the bot to capture the trace:

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`** (updated):

```typescript
import {
  RegisterBot,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import {
  ValidationFactory,
} from '@firebrandanalytics/shared-utils/validation';
import { SupplierProductValidator } from '../validators/SupplierProductValidator.js';

interface CatalogIntakeRequest {
  supplier_id: string;
  raw_payload: Record<string, unknown>;
}

interface CatalogIntakeResult {
  success: boolean;
  validated_data?: Record<string, unknown>;
  trace?: TraceEntry[];
  errors?: Array<{ field: string; message: string }>;
}

interface TraceEntry {
  property: string;
  decorator: string;
  before: unknown;
  after: unknown;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

@RegisterBot('CatalogIntakeBot')
export class CatalogIntakeBot {
  private factory: ValidationFactory;

  constructor() {
    this.factory = new ValidationFactory();
  }

  async validate(request: CatalogIntakeRequest): Promise<CatalogIntakeResult> {
    const { supplier_id, raw_payload } = request;

    logger.info('[CatalogIntakeBot] Validating submission', {
      supplier_id,
    });

    try {
      const validated = await this.factory.create(
        SupplierProductValidator,
        raw_payload,
        { trace: true },
      );

      // The trace is attached to the instance after creation
      const trace = (validated as any).__trace as TraceEntry[] | undefined;

      logger.info('[CatalogIntakeBot] Validation succeeded', {
        supplier_id,
        product_name: validated.product_name,
        trace_entries: trace?.length ?? 0,
      });

      return {
        success: true,
        validated_data: validated as unknown as Record<string, unknown>,
        trace: trace ?? [],
      };
    } catch (error: any) {
      logger.warn('[CatalogIntakeBot] Validation failed', {
        supplier_id,
        error: error.message,
      });

      const errors: Array<{ field: string; message: string }> =
        Array.isArray(error.errors)
          ? error.errors.map((e: any) => ({
              field: e.propertyPath ?? e.field ?? 'unknown',
              message: e.message ?? String(e),
            }))
          : [{ field: error.propertyPath ?? 'unknown', message: error.message }];

      return {
        success: false,
        errors,
      };
    }
  }
}
```

The key change is one option: `{ trace: true }`. When enabled:

1. The factory wraps each decorator execution in a recording layer.
2. Every time a decorator runs on a property, it captures `{ property, decorator, before, after, timestamp }`.
3. The trace is attached to the resulting instance as `__trace`.
4. For decorators that include extra context (like `@CoerceFromSet` with a fuzzy match score), the `metadata` field captures it.

The trace is **not** part of the class's serializable data -- it's a transient attachment. `@Serializable`'s `toJSON()` won't include it. You need to extract and store it separately, which we'll do in Step 4.

---

## Step 3: @Staging -- Hidden Scaffolding

Before we look at the trace output, we need to talk about `@Staging`.

Recall Supplier B's nested payload:

```json
{
  "productInfo": {
    "name": "  Nike Air Max 90  ",
    "category": "Running",
    "subcategory": "Road Running",
    "brandLine": "Nike Air"
  },
  "pricing": {
    "retail": 89.99,
    "wholesale": 45.50
  },
  "specs": {
    "colorway": "White/Black",
    "sizeRange": "7-13"
  }
}
```

In the Supplier B validator, you extract values from `productInfo`, `pricing`, and `specs` using `@DerivedFrom`:

```typescript
@DerivedFrom('$.productInfo.name')
@CoerceTrim()
@CoerceCase('title')
@ValidateRequired()
product_name!: string;
```

But what about the intermediate objects themselves -- `productInfo`, `pricing`, `specs`? They're needed during validation (as sources for `@DerivedFrom`) but they shouldn't appear in the final product. You don't want the validated output to include a `productInfo` object next to the flattened `product_name`. That's what `@Staging` is for.

### What @Staging Does

`@Staging()` marks a property as temporary scaffolding:

- **During validation:** The property is populated from the raw input and participates normally in the pipeline. Other decorators can reference it as a source.
- **After validation:** The property is removed from the instance. It won't appear in the object's enumerable keys.
- **On serialization:** `@Serializable`'s `toJSON()` excludes `@Staging` properties automatically.

### Adding @Staging to Supplier B

Update the Supplier B validator to explicitly mark the nested source objects as staging:

**`apps/catalog-bundle/src/validators/SupplierBValidator.ts`** (updated):

```typescript
import {
  Serializable,
  Staging,
  DerivedFrom,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  CoerceParse,
  ValidateRequired,
  ValidateRange,
  ValidatePattern,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
export class SupplierBValidator {
  // --- Staging properties: needed for extraction, excluded from output ---

  @Copy()
  @Staging()
  productInfo!: Record<string, unknown>;

  @Copy()
  @Staging()
  pricing!: Record<string, unknown>;

  @Copy()
  @Staging()
  specs!: Record<string, unknown>;

  // --- Derived properties: extracted from staging, included in output ---

  @DerivedFrom('$.productInfo.name')
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @DerivedFrom('$.productInfo.category')
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  @DerivedFrom('$.productInfo.subcategory')
  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @DerivedFrom('$.productInfo.brandLine')
  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @DerivedFrom('$.pricing.wholesale')
  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @DerivedFrom('$.pricing.retail')
  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @DerivedFrom('$.specs.colorway')
  @CoerceTrim()
  color_variant!: string;

  @DerivedFrom('$.specs.sizeRange')
  @CoerceTrim()
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

The three `@Staging()` properties -- `productInfo`, `pricing`, `specs` -- exist during validation as extraction sources. After `factory.create()` completes, they're gone. The output only contains the flat, normalized fields.

Without `@Staging`:

```json
{
  "productInfo": { "name": "Nike Air Max 90", "category": "Running", "..." },
  "pricing": { "retail": 89.99, "wholesale": 45.50 },
  "specs": { "colorway": "White/Black", "sizeRange": "7-13" },
  "product_name": "Nike Air Max 90",
  "category": "running",
  "base_cost": 45.50,
  "msrp": 89.99,
  "..."
}
```

With `@Staging`:

```json
{
  "product_name": "Nike Air Max 90",
  "category": "running",
  "subcategory": "road running",
  "brand_line": "nike air",
  "base_cost": 45.50,
  "msrp": 89.99,
  "color_variant": "White/Black",
  "size_range": "7-13"
}
```

Clean. The nested source objects served their purpose and disappeared.

### @Staging in the Trace

Here's the important part for this tutorial: `@Staging` properties **do** appear in the trace. You can see exactly what was extracted from them and when they were removed. This is critical for debugging:

```json
[
  { "property": "productInfo", "decorator": "Copy", "before": null, "after": {"name": "  Nike Air Max 90  ", "..."}, "timestamp": "..." },
  { "property": "product_name", "decorator": "DerivedFrom", "before": null, "after": "  Nike Air Max 90  ", "timestamp": "..." },
  { "property": "product_name", "decorator": "CoerceTrim", "before": "  Nike Air Max 90  ", "after": "Nike Air Max 90", "timestamp": "..." },
  { "property": "product_name", "decorator": "CoerceCase", "before": "Nike Air Max 90", "after": "Nike Air Max 90", "timestamp": "..." },
  { "property": "productInfo", "decorator": "Staging", "before": {"name": "  Nike Air Max 90  ", "..."}, "after": null, "timestamp": "..." }
]
```

The trace shows `productInfo` being copied from input, `product_name` being derived from it, and then `productInfo` being removed by `@Staging`. The full audit trail is preserved even though the staging property is gone from the output.

---

## Step 4: Store the Trace

The trace needs to live somewhere persistent -- alongside the validated product, but separate from the product data itself. We'll store it as a dedicated field on the entity.

### Update the API Endpoint

**`apps/catalog-bundle/src/agent-bundle.ts`** (updated `intake` method):

```typescript
@ApiEndpoint({ method: 'POST', route: 'intake' })
async intake(data: {
  supplier_id: string;
  raw_payload: Record<string, unknown>;
}) {
  const { supplier_id, raw_payload } = data;

  if (!supplier_id || !raw_payload) {
    throw new Error("Missing 'supplier_id' or 'raw_payload' in request body");
  }

  logger.info(`[API] POST /api/intake - supplier: ${supplier_id}`);

  const result = await this.intakeBot.validate({
    supplier_id,
    raw_payload,
  });

  if (!result.success) {
    return result;
  }

  // Store the validated product as an entity
  const entity = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `product-${supplier_id}-${Date.now()}`,
    specific_type_name: 'SupplierProductDraft',
    general_type_name: 'SupplierProductDraft',
    status: 'Validated',
    data: {
      ...result.validated_data!,
      // Store the trace alongside the product data
      __validation_trace: result.trace,
      __raw_input: raw_payload,
    },
  });

  return {
    success: true,
    entity_id: (entity as any).id,
    validated_data: result.validated_data,
    trace_entries: result.trace?.length ?? 0,
  };
}
```

We're storing two extra fields:

- **`__validation_trace`** -- the full array of `TraceEntry` objects from the decorator pipeline
- **`__raw_input`** -- the original supplier payload, so the trace viewer can show a side-by-side comparison

The double-underscore prefix is a convention: these are metadata fields, not product data. The validator class doesn't declare them, so they pass through as unmanaged properties.

### Add a Trace Retrieval Endpoint

Add an endpoint that returns just the trace for a given product:

```typescript
@ApiEndpoint({ method: 'GET', route: 'product-trace' })
async getProductTrace(data: { entityId: string }) {
  const { entityId } = data;

  if (!entityId) {
    throw new Error("Missing 'entityId' query parameter");
  }

  const entity = await this.entity_factory.get_entity(entityId);
  const dto = await (entity as any).get_dto();
  const rawData = dto.data as Record<string, unknown>;

  const trace = rawData.__validation_trace as TraceEntry[] ?? [];
  const rawInput = rawData.__raw_input as Record<string, unknown> ?? {};

  // Group trace entries by property for the viewer
  const traceByProperty: Record<string, TraceEntry[]> = {};
  for (const entry of trace) {
    if (!traceByProperty[entry.property]) {
      traceByProperty[entry.property] = [];
    }
    traceByProperty[entry.property].push(entry);
  }

  return {
    entity_id: entityId,
    raw_input: rawInput,
    trace: traceByProperty,
    summary: {
      total_entries: trace.length,
      properties_touched: Object.keys(traceByProperty).length,
      staging_properties: trace
        .filter(e => e.decorator === 'Staging')
        .map(e => e.property),
    },
  };
}
```

The response groups trace entries by property and includes a summary -- how many decorators fired, which properties were staging, and the original raw input.

---

## Step 5: Build the Trace Viewer GUI

Now the payoff. Add a trace viewer page that shows exactly what the pipeline did to every field of a submitted product.

### Create the Trace Page

**`apps/catalog-gui/src/app/products/[id]/trace/page.tsx`**:

```tsx
import { TraceViewer } from './TraceViewer';

const BUNDLE_URL = process.env.NEXT_PUBLIC_BUNDLE_URL || 'http://localhost:3001';

async function getProductTrace(entityId: string) {
  const res = await fetch(
    `${BUNDLE_URL}/api/product-trace?entityId=${entityId}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Failed to load trace: ${res.statusText}`);
  return res.json();
}

async function getProduct(entityId: string) {
  const res = await fetch(
    `${BUNDLE_URL}/api/product?entityId=${entityId}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Failed to load product: ${res.statusText}`);
  return res.json();
}

export default async function TracePage({
  params,
}: {
  params: { id: string };
}) {
  const [traceData, productData] = await Promise.all([
    getProductTrace(params.id),
    getProduct(params.id),
  ]);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-2">Validation Trace</h1>
      <p className="text-gray-600 mb-6">
        Product: {productData.result.data.product_name ?? params.id}
      </p>

      <div className="mb-6 bg-gray-50 rounded-lg p-4 text-sm">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <span className="text-gray-500">Decorators fired:</span>{' '}
            <span className="font-mono">{traceData.result.summary.total_entries}</span>
          </div>
          <div>
            <span className="text-gray-500">Properties touched:</span>{' '}
            <span className="font-mono">{traceData.result.summary.properties_touched}</span>
          </div>
          <div>
            <span className="text-gray-500">Staging properties:</span>{' '}
            <span className="font-mono">
              {traceData.result.summary.staging_properties.length > 0
                ? traceData.result.summary.staging_properties.join(', ')
                : 'none'}
            </span>
          </div>
        </div>
      </div>

      <TraceViewer
        trace={traceData.result.trace}
        rawInput={traceData.result.raw_input}
        finalData={productData.result.data}
      />
    </div>
  );
}
```

### Build the TraceViewer Component

**`apps/catalog-gui/src/app/products/[id]/trace/TraceViewer.tsx`**:

```tsx
'use client';

import { useState } from 'react';

interface TraceEntry {
  property: string;
  decorator: string;
  before: unknown;
  after: unknown;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface TraceViewerProps {
  trace: Record<string, TraceEntry[]>;
  rawInput: Record<string, unknown>;
  finalData: Record<string, unknown>;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function ValueDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeStr = formatValue(before);
  const afterStr = formatValue(after);
  const changed = beforeStr !== afterStr;

  return (
    <div className="flex items-center gap-2 text-sm font-mono">
      <span className={changed ? 'text-red-600 line-through' : 'text-gray-600'}>
        {beforeStr}
      </span>
      {changed && (
        <>
          <span className="text-gray-400">&rarr;</span>
          <span className="text-green-700 font-semibold">{afterStr}</span>
        </>
      )}
    </div>
  );
}

function DecoratorBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    Copy: 'bg-gray-100 text-gray-700',
    DerivedFrom: 'bg-blue-100 text-blue-800',
    CoerceTrim: 'bg-yellow-100 text-yellow-800',
    CoerceCase: 'bg-yellow-100 text-yellow-800',
    CoerceType: 'bg-yellow-100 text-yellow-800',
    CoerceParse: 'bg-yellow-100 text-yellow-800',
    ValidateRequired: 'bg-purple-100 text-purple-800',
    ValidateRange: 'bg-purple-100 text-purple-800',
    ValidatePattern: 'bg-purple-100 text-purple-800',
    Staging: 'bg-red-100 text-red-800',
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
        colors[name] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      @{name}
    </span>
  );
}

function PropertyTrace({
  property,
  entries,
  rawValue,
  finalValue,
  isStaging,
}: {
  property: string;
  entries: TraceEntry[];
  rawValue: unknown;
  finalValue: unknown;
  isStaging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasChanges = entries.some(
    (e) => formatValue(e.before) !== formatValue(e.after),
  );

  return (
    <div className="border rounded-lg mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-sm">{property}</span>
          {isStaging && (
            <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">
              staging
            </span>
          )}
          {hasChanges && (
            <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded">
              modified
            </span>
          )}
          <span className="text-xs text-gray-400">
            {entries.length} decorator{entries.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {!isStaging && (
            <span className="text-sm font-mono text-gray-600">
              {formatValue(finalValue)}
            </span>
          )}
          <span className="text-gray-400">{expanded ? '−' : '+'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <div className="mt-3 mb-4 text-sm">
            <span className="text-gray-500">Raw input:</span>{' '}
            <span className="font-mono">{formatValue(rawValue)}</span>
          </div>

          <div className="space-y-2">
            {entries.map((entry, i) => (
              <div
                key={i}
                className="flex items-start gap-3 py-2 border-b border-dashed last:border-0"
              >
                <div className="w-6 text-center text-xs text-gray-400 pt-1">
                  {i + 1}
                </div>
                <div className="w-32 shrink-0">
                  <DecoratorBadge name={entry.decorator} />
                </div>
                <div className="flex-1">
                  <ValueDiff before={entry.before} after={entry.after} />
                  {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                    <div className="mt-1 text-xs text-gray-400">
                      {Object.entries(entry.metadata).map(([k, v]) => (
                        <span key={k} className="mr-3">
                          {k}: {formatValue(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isStaging && (
            <div className="mt-3 text-xs text-red-500 italic">
              This property was removed after validation (marked @Staging).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TraceViewer({ trace, rawInput, finalData }: TraceViewerProps) {
  const properties = Object.keys(trace);

  // Identify staging properties: they have a "Staging" decorator entry
  const stagingProps = new Set(
    properties.filter((prop) =>
      trace[prop].some((e) => e.decorator === 'Staging'),
    ),
  );

  // Sort: non-staging first (alphabetical), then staging
  const sorted = [
    ...properties.filter((p) => !stagingProps.has(p)).sort(),
    ...properties.filter((p) => stagingProps.has(p)).sort(),
  ];

  return (
    <div>
      {sorted.map((property) => {
        // For raw input value, handle JSONPath sources
        const rawValue = property.includes('.')
          ? undefined
          : rawInput[property];

        return (
          <PropertyTrace
            key={property}
            property={property}
            entries={trace[property]}
            rawValue={rawValue}
            finalValue={finalData[property]}
            isStaging={stagingProps.has(property)}
          />
        );
      })}
    </div>
  );
}
```

The trace viewer gives you:

- **Expandable per-field sections** showing each decorator that touched the property
- **Visual diff** with red strikethrough for the old value and green for the new value
- **Color-coded decorator badges** -- yellow for coercions, purple for validations, blue for derivations, red for staging removal
- **Metadata display** for decorators that carry extra context (like fuzzy match scores)
- **Staging indicators** that clearly mark which properties were scaffolding

---

## Step 6: Test It

Build and deploy:

```bash
pnpm install
npx turbo build
ff ops build --app-name catalog-bundle
ff ops deploy --app-name catalog-bundle
```

### Submit a Supplier B Product

Send a Supplier B payload with messy data -- extra whitespace, inconsistent casing, nested structure:

```bash
ff-sdk-cli api call intake \
  --method POST \
  --body '{
    "supplier_id": "supplier-B",
    "raw_payload": {
      "productInfo": {
        "name": "  blaze runner PRO  ",
        "category": "Running",
        "subcategory": "  Trail Running  ",
        "brandLine": "  Blaze  "
      },
      "pricing": {
        "retail": 149.99,
        "wholesale": 72.50
      },
      "specs": {
        "colorway": "  Ember Red / Black  ",
        "sizeRange": "8-12"
      }
    }
  }' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "success": true,
    "entity_id": "e5f6a7b8-...",
    "validated_data": {
      "product_name": "Blaze Runner Pro",
      "category": "running",
      "subcategory": "trail running",
      "brand_line": "blaze",
      "base_cost": 72.50,
      "msrp": 149.99,
      "color_variant": "Ember Red / Black",
      "size_range": "8-12"
    },
    "trace_entries": 27
  }
}
```

### View the Trace

Retrieve the trace for this product:

```bash
ff-sdk-cli api call product-trace \
  --query '{"entityId":"e5f6a7b8-..."}' \
  --url http://localhost:3001
```

The response shows the full per-field trace. Here's what the `product_name` field's trace looks like:

```json
{
  "product_name": [
    {
      "property": "product_name",
      "decorator": "DerivedFrom",
      "before": null,
      "after": "  blaze runner PRO  ",
      "timestamp": "2026-02-22T10:30:01.001Z",
      "metadata": { "source": "$.productInfo.name" }
    },
    {
      "property": "product_name",
      "decorator": "CoerceTrim",
      "before": "  blaze runner PRO  ",
      "after": "blaze runner PRO",
      "timestamp": "2026-02-22T10:30:01.002Z"
    },
    {
      "property": "product_name",
      "decorator": "CoerceCase",
      "before": "blaze runner PRO",
      "after": "Blaze Runner Pro",
      "timestamp": "2026-02-22T10:30:01.003Z",
      "metadata": { "case": "title" }
    },
    {
      "property": "product_name",
      "decorator": "ValidateRequired",
      "before": "Blaze Runner Pro",
      "after": "Blaze Runner Pro",
      "timestamp": "2026-02-22T10:30:01.004Z"
    }
  ]
}
```

Read it top-to-bottom:

1. **`@DerivedFrom`** extracted `"  blaze runner PRO  "` from `$.productInfo.name`
2. **`@CoerceTrim`** stripped whitespace: `"blaze runner PRO"`
3. **`@CoerceCase('title')`** applied title case: `"Blaze Runner Pro"`
4. **`@ValidateRequired`** confirmed the value is non-empty (no change)

And here's what the staging property `productInfo` looks like in the trace:

```json
{
  "productInfo": [
    {
      "property": "productInfo",
      "decorator": "Copy",
      "before": null,
      "after": { "name": "  blaze runner PRO  ", "category": "Running", "..." },
      "timestamp": "2026-02-22T10:30:01.000Z"
    },
    {
      "property": "productInfo",
      "decorator": "Staging",
      "before": { "name": "  blaze runner PRO  ", "category": "Running", "..." },
      "after": null,
      "timestamp": "2026-02-22T10:30:01.020Z"
    }
  ]
}
```

The `productInfo` object was copied from input, used as a source for `@DerivedFrom` extractions, and then removed by `@Staging`. It's in the trace but not in the final output.

### View in the GUI

Open the trace viewer in the browser:

```
http://localhost:3000/products/e5f6a7b8-.../trace
```

You'll see each property as an expandable row. Click `product_name` and you get the full decorator chain with visual diffs. The `productInfo`, `pricing`, and `specs` rows show a red "staging" badge and appear at the bottom of the list.

### Verify Staging Exclusion

Confirm that the staging properties don't appear in the product data:

```bash
ff-sdk-cli api call product \
  --query '{"entityId":"e5f6a7b8-..."}' \
  --url http://localhost:3001
```

The response should have no `productInfo`, `pricing`, or `specs` keys -- only the flat, normalized fields. The staging properties did their job and vanished.

---

## What You've Built

You now have:

- **Trace capture** -- `{ trace: true }` on `factory.create()` records every decorator execution with before/after values
- **@Staging properties** -- intermediate values that exist during validation but are excluded from the final output and serialization
- **Trace storage** -- the trace is stored alongside the entity as `__validation_trace` for persistent access
- **Trace viewer GUI** -- an expandable per-field view showing the exact decorator chain, visual diffs, and staging indicators
- **Debugging superpower** -- when a supplier asks "why did my value change?", you open the trace viewer and point to the exact decorator

The trace turns the validation pipeline from a black box into a transparent, auditable process. Every transformation is recorded. Every staging property is visible in the trace but absent from the output. When something looks wrong, the answer is one click away.

---

## What's Next

You can see exactly what the pipeline did to every field. But the category values your suppliers send don't match your product catalog -- `'RUNNING'` vs `'Running Shoes'` vs `'running-road'`. In [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md), we'll add fuzzy matching against the live FireKicks catalog using `@CoerceFromSet` with a runtime `CatalogContext` loaded from the Data Access Service.
