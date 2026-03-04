# Part 12: Data Wrangling Service Integration

Parts 1-10 built a decorator-based validation pipeline. You define a class, stack decorators on each property, and the engine runs them. It's powerful, expressive, and type-safe. But it requires TypeScript classes.

What if the rules come from a database? What if a product manager needs to tweak a fuzzy matching threshold without touching code? What if you have 50 vendor-specific cleanup specs and maintaining 50 TypeScript classes is unsustainable?

This part introduces `WrangleSpec` -- a declarative, JSON-serializable format for defining column-level cleanup rules. Instead of writing a class with decorators, you write a plain object. Instead of importing `ValidationFactory` and wiring up a class, you call `compileWrangleSpec()` and the library builds the class for you at runtime.

Same validation engine. Same fuzzy matching. Same coercion pipeline. Different authoring surface.

> **Prerequisite:** Complete [Part 10: Recovery & Production Hardening](./part-10-recovery-production.md). The concepts here build on the validation engine from earlier parts, but the code is standalone.

---

## When Decorators Aren't Enough

The decorator pipeline is ideal when:

- A developer maintains the rules
- The class definition is the contract between services
- You want compile-time type checking on field names and decorator parameters

But there are scenarios where a plain object is better:

- **Admin-defined specs.** A product operations team defines cleanup rules in a UI. The rules are stored as JSON in the entity graph or a database.
- **Many similar specs.** You have 50 vendors, each with slightly different column mappings and normalization rules. Maintaining 50 decorated classes creates file sprawl.
- **Runtime configurability.** A threshold needs to change from 0.7 to 0.4 for a specific vendor without a code deploy.

`WrangleSpec` handles these cases. It's a JSON object that describes column-level rules -- types, coercion, fuzzy matching, validation, defaults. The `compileWrangleSpec()` function compiles it into a decorated class at runtime, then the same `ValidationFactory` engine from Parts 1-10 processes the data.

---

## The WrangleSpec Format

A `WrangleSpec` defines a name, an engine mode, and a set of column rules:

```typescript
import type { WrangleSpec } from '@firebrandanalytics/shared-utils';

const spec: WrangleSpec = {
  name: 'VendorCatalogCleanup',
  engine: 'single-pass',
  columns: {
    product_id: {
      type: 'string',
      trim: true,
      case: 'upper',
      required: true,
    },
    product_name: {
      type: 'string',
      trim: true,
      case: 'title',
      required: true,
      length: [2, 100],
    },
    unit_price: {
      type: 'number',
      range: [0, 100000],
    },
    currency: {
      type: 'string',
      trim: true,
      case: 'upper',
      default: 'USD',
    },
    in_stock: {
      type: 'boolean',
      default: false,
    },
  },
};
```

Compare this to the equivalent decorated class:

```typescript
@Serializable()
@UseSinglePassValidation()
class VendorCatalogCleanup {
  @CoerceTrim() @CoerceCase('upper') @ValidateRequired()
  product_id!: string;

  @CoerceTrim() @CoerceCase('title') @ValidateRequired()
  @ValidateLength(2, 100)
  product_name!: string;

  @CoerceType('number') @ValidateRange(0, 100000)
  unit_price!: number;

  @CoerceTrim() @CoerceCase('upper') @DefaultValue('USD')
  currency!: string;

  @CoerceType('boolean') @DefaultValue(false)
  in_stock!: boolean;
}
```

Same rules, different encoding. The spec version can live in a database row. The class version lives in source code.

---

## Column Rule Reference

Each column in the spec accepts these properties:

| Property | Type | What it does | Decorator equivalent |
|----------|------|-------------|---------------------|
| `type` | `'string' \| 'number' \| 'boolean'` | Coerce to target type | `@CoerceType()` |
| `trim` | `boolean` | Strip leading/trailing whitespace | `@CoerceTrim()` |
| `case` | `'upper' \| 'lower' \| 'title'` | Normalize casing | `@CoerceCase()` |
| `required` | `boolean` | Reject null/undefined/empty | `@ValidateRequired()` |
| `length` | `[min, max]` | String length bounds | `@ValidateLength()` |
| `range` | `[min, max]` | Numeric range bounds | `@ValidateRange()` |
| `default` | `any` | Value when missing | `@DefaultValue()` |
| `fuzzyMatch` | `{ source, threshold, strategy }` | Match against a canonical set | `@CoerceFromSet({ fuzzy: true })` |
| `coerce` | `(value: any) => any` | Custom coercion function | Custom decorator |
| `validate` | `(value: any) => true \| string` | Custom validation function | Custom decorator |

The properties are applied in a deterministic order: `default` -> `trim` -> `case` -> `type` -> `coerce` -> `fuzzyMatch` -> `length` / `range` / `required` -> `validate`. This matches the coerce-then-validate order from the decorator pipeline.

---

## Fuzzy Matching in a Spec

Fuzzy matching works the same way as `@CoerceFromSet` from Part 6, but configured as a plain object:

```typescript
category: {
  trim: true,
  fuzzyMatch: {
    source: ['Running', 'Basketball', 'Hiking', 'Casual', 'Training', 'Soccer', 'Tennis'],
    threshold: 0.4,
    strategy: 'fuzzy',
  },
},
```

The `source` array is the canonical set. `threshold` is the minimum similarity score (0-1). `strategy` controls the matching algorithm -- `'fuzzy'` uses Levenshtein distance, the same algorithm behind `@CoerceFromSet`.

In a real deployment, the source array wouldn't be hardcoded -- it would come from a DAS value store or entity graph query, loaded at spec-construction time:

```typescript
const categories = await dasClient.query('firekicks',
  'SELECT DISTINCT name FROM categories ORDER BY name'
);

const spec: WrangleSpec = {
  name: 'VendorCatalogCleanup',
  engine: 'single-pass',
  columns: {
    category: {
      fuzzyMatch: {
        source: categories.rows.map(r => r.name),
        threshold: 0.4,
        strategy: 'fuzzy',
      },
    },
    // ...
  },
};
```

This is the same DAS integration pattern from Part 6, just applied to a spec instead of a decorator parameter. The canonical values are current, the spec is declarative, and no code changes are needed when categories change.

---

## Custom Coercion and Validation

For rules that don't fit the built-in properties, `coerce` and `validate` accept functions:

```typescript
unit_price: {
  type: 'number',
  coerce: (value: any) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const cleaned = value.replace(/[$\u20ac\u00a3\u00a5,\s]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) throw new Error(`Cannot parse price: "${value}"`);
    return num;
  },
  range: [0, 100000],
},
```

This handles the same problem as a custom `@Coerce` decorator -- stripping `$`, `EUR`, `GBP`, and `JPY` symbols before parsing. The `coerce` function runs after `trim` and `case` but before `range` validation, so the value is already cleaned of whitespace when it arrives.

For validation:

```typescript
vendor_email: {
  type: 'string',
  trim: true,
  case: 'lower',
  validate: (value: any) => {
    if (!value || value === '') return true;
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || 'Invalid email format';
  },
},
```

Return `true` for valid, or an error message string for invalid. This runs last in the pipeline, after all coercion is complete.

Note: when a spec is serialized to JSON (for storage in the entity graph or transmission over HTTP), function-valued properties like `coerce` and `validate` are dropped. The JSON-only subset -- `type`, `trim`, `case`, `required`, `length`, `range`, `default`, `fuzzyMatch` -- is fully serializable. If you need custom functions, use the in-process mode described below.

---

## compileWrangleSpec() -- In-Process Usage

The most direct way to use a spec is in-process. No HTTP service, no network call -- just compile and run:

```typescript
import {
  compileWrangleSpec,
  ValidationFactory,
} from '@firebrandanalytics/shared-utils';

const CompiledRow = compileWrangleSpec(vendorCatalogSpec);
const factory = new ValidationFactory();

const result = await factory.create(CompiledRow, rawRow, {
  engine: 'single-pass',
});
```

`compileWrangleSpec()` reads the spec and dynamically constructs a class with the equivalent decorators registered via `reflect-metadata`. The returned `CompiledRow` is a regular class constructor -- the same kind you'd write by hand in Parts 1-10. `ValidationFactory.create()` doesn't know or care that the class was generated from a spec rather than authored in source code.

### Processing a CSV batch

Here's the pattern for cleaning a batch of messy CSV rows:

```typescript
import { parse } from 'csv-parse/sync';

const rawRows = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
}) as Record<string, string>[];

const CompiledRow = compileWrangleSpec(vendorCatalogSpec);
const factory = new ValidationFactory();

const cleanRows: Record<string, unknown>[] = [];
const errors: Array<{ rowIndex: number; message: string }> = [];

for (let i = 0; i < rawRows.length; i++) {
  try {
    const result = await factory.create(CompiledRow, rawRows[i], {
      engine: 'single-pass',
    });
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(vendorCatalogSpec.columns)) {
      clean[key] = (result as any)[key];
    }
    cleanRows.push(clean);
  } catch (err) {
    errors.push({
      rowIndex: i,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
```

Each row passes through the full coercion and validation pipeline independently. Errors are collected per-row, not short-circuited -- so a bad row doesn't prevent the rest of the batch from processing. This is the same error-collection pattern you'd use with decorated classes in a batch workflow.

---

## Three Usage Modes

`WrangleSpec` can be used three ways, depending on where the spec lives and where processing happens:

### 1. Inline POST -- send spec + rows over HTTP

```
POST /wrangle
{
  "spec": { "name": "VendorCatalogCleanup", "engine": "single-pass", "columns": { ... } },
  "rows": [ { "product_id": "FK-001", ... }, ... ]
}
```

The `ff-wrangle` service compiles the spec, processes all rows, and returns clean results plus errors. Good for ad-hoc cleanup from external systems that can't run TypeScript.

### 2. Entity-graph stored -- reference by ID

```
POST /wrangle/entity/ent_abc123
{
  "rows": [ { "product_id": "FK-001", ... }, ... ]
}
```

The spec is stored as an entity in the graph. The service fetches it by ID and compiles it. Good for admin-managed specs that change without code deploys.

### 3. In-process -- compileWrangleSpec() in the agent bundle

```typescript
const CompiledRow = compileWrangleSpec(spec);
const result = await factory.create(CompiledRow, row, { engine: 'single-pass' });
```

No HTTP, no service dependency. The agent bundle compiles and runs the spec directly. Good for demos, unit tests, and bundles that need wrangling as part of a larger workflow.

All three modes use the same spec format and the same validation engine. The difference is where the spec is stored and who does the compilation.

---

## The Vendor Catalog Example

The catalog-intake demo includes a complete working example. Here's the messy input -- 10 CSV rows with the quality issues you'd see from a real vendor:

```csv
product_id,product_name,category,brand,unit_price,currency,in_stock,vendor_email,region
FK-001,  BLAZE runner  ,Runing,FIREKIKS,$89.99,USD,yes,sales@firekicks..com,north america
FK-002,sky leap PRO,Basketbal,FireKicks,EUR110.00,EUR,TRUE,  ORDERS@FIREKICKS.COM  ,euorpe
FK-003,trail blazer gtx,Hikng,firekicks,GBP95.00,GBP,Y,support@firekicks.com,asia pcific
```

Every row has problems: misspelled categories (`Runing`, `Basketbal`, `Hikng`), inconsistent brand names (`FIREKIKS`, `firekicks`, `FIRE-KICKS`), currency symbols embedded in prices (`$89.99`, `EUR110.00`), boolean variants (`yes`, `TRUE`, `Y`, `1`, `0`), extra whitespace, mixed casing, and typos in regions (`euorpe`, `asia pcific`).

After running through the spec:

| Field | Before | After | Rule Applied |
|-------|--------|-------|-------------|
| `product_id` | `"  fk-001  "` | `"FK-001"` | trim + upper |
| `product_name` | `"  BLAZE runner  "` | `"Blaze Runner"` | trim + title case |
| `category` | `"Runing"` | `"Running"` | fuzzy match (0.86 similarity) |
| `brand` | `"FIREKIKS"` | `"FireKicks"` | custom coerce (normalize misspelling) |
| `unit_price` | `"$89.99"` | `89.99` | custom coerce (strip currency symbol) |
| `currency` | `"usd"` | `"USD"` | trim + upper |
| `in_stock` | `"yes"` | `true` | boolean coercion |
| `region` | `"north america"` | `"North America"` | fuzzy match |

Missing fields get defaults: `currency` defaults to `"USD"`, `in_stock` defaults to `false`.

---

## Testing the Spec

The demo includes unit tests that verify each rule type independently:

```typescript
import { compileWrangleSpec, ValidationFactory } from '@firebrandanalytics/shared-utils';
import { vendorCatalogSpec } from './vendor-catalog-spec.js';

it('should normalize casing and trim whitespace', async () => {
  const Cls = compileWrangleSpec(vendorCatalogSpec);
  const factory = new ValidationFactory();

  const result = await factory.create(Cls, {
    product_id: '  fk-001  ',
    product_name: '  BLAZE runner  ',
    category: 'Running',
    brand: 'FIREKICKS',
    unit_price: '$89.99',
    currency: 'usd',
    in_stock: 'yes',
    vendor_email: '  Sales@FireKicks.com  ',
    region: 'North America',
  }, { engine: 'single-pass' });

  expect(result.product_id).toBe('FK-001');
  expect(result.product_name).toBe('Blaze Runner');
  expect(result.brand).toBe('FireKicks');
  expect(result.unit_price).toBe(89.99);
  expect(result.currency).toBe('USD');
  expect(result.in_stock).toBe(true);
  expect(result.vendor_email).toBe('sales@firekicks.com');
});
```

Each test compiles the spec fresh, creates a `ValidationFactory`, and processes a single row. This is the same `factory.create()` call you'd use with a hand-written decorated class. The test doesn't know the class was generated from a spec -- it just works.

Run them:

```bash
cd catalog-intake/apps/catalog-bundle
npx vitest run src/wrangling/vendor-catalog-spec.test.ts
```

---

## Decorators vs. Specs -- When to Use Which

The decorator pipeline (Parts 1-10) and the wrangling spec (this part) solve the same problem from different angles. Here's when each one fits:

| Use decorators when... | Use a WrangleSpec when... |
|----------------------|-------------------------|
| Rules are part of the application contract | Rules are admin-configurable |
| You want compile-time type safety on field names | You want JSON-serializable rules |
| Fields have complex inter-dependencies (`@DerivedFrom`, `@CrossValidate`) | Fields are independent (single-pass) |
| The class is shared between agent bundle, GUI, and backend | The spec is stored in the entity graph |
| You have a few well-defined schemas | You have many vendor-specific variations |

They're not mutually exclusive. A common pattern: use decorated classes for the core product schema (the canonical type that flows through the entity graph) and wrangling specs for the vendor-specific cleanup step that runs before the data reaches the canonical validator. The spec cleans up the vendor's mess, the decorated class validates the canonical shape.

---

## What's Next

You now have two complementary approaches to data cleanup:

1. **Decorated classes** (Parts 1-10) -- the TypeScript-native, type-safe, compile-time approach. Best for core domain types, cross-field rules, and shared contracts.
2. **WrangleSpec** (this part) -- the declarative, JSON-serializable, runtime-configurable approach. Best for vendor-specific cleanup, admin-defined rules, and high-variety scenarios.

Both run on the same validation engine. Both support fuzzy matching, type coercion, custom functions, and batch processing. The difference is authoring surface -- code vs. configuration.

The catalog-intake demo source code is in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `catalog-intake/apps/catalog-bundle/src/wrangling/`.

---

**Previous:** [Part 10: Recovery & Production Hardening](./part-10-recovery-production.md)
