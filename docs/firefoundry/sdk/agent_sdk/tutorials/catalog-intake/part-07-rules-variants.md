# Part 7: Business Rules & Nested Variants

Your validation pipeline handles format differences, version detection, fuzzy catalog matching, and full field-level tracing. But so far every field has been validated in isolation. Real product data has rules that span multiple fields: MSRP must exceed base cost, size formats depend on category, and each product ships with an array of size/color variants that need their own validation. This part adds cross-field business rules, conditional logic, nested variant arrays, and a catch-all for unmapped supplier fields.

**What you'll learn:**
- Enforcing business invariants with `@ObjectRule` and `@CrossValidate`
- Branching validation logic with `@If` / `@ElseIf` / `@Else` / `@EndIf`
- Computing derived fields with `@DerivedFrom`
- Validating nested objects with `@ValidatedClass` and arrays with `@ValidatedClassArray`
- Capturing unmapped supplier fields with `@CollectProperties`

**What you'll build:** A `SupplierBProductV2` validator with margin rules, category-conditional size formatting, a nested `SupplierVariant` class for size/color/SKU combinations, and a JSONB bucket for unexpected fields. Plus GUI updates: an expandable variant table, validation badges, and dynamic variant entry.

**Starting point:** Completed code from [Part 6: Catalog Matching & Context](./part-06-catalog-matching.md). You should have a working `SupplierBProductV1` with `@CoerceFromSet` matching, `CatalogContext`, and DAS integration.

---

## Step 1: The Problem -- Business Rules

Open the product browser and look at some validated products. Every field passes its own checks, but the data still has problems that single-field decorators can't catch:

1. **Negative margins.** A supplier submits `base_cost: 89.99` and `msrp: 79.99`. Each field is a valid number, but the business would lose money on every sale.

2. **Wrong size format.** Kids shoes use youth sizing (`1Y`, `3.5Y`, `7Y`), but adult shoes use standard numeric (`7`, `10.5`, `13`). A supplier submits `size_range: "7-13"` for a kids shoe -- valid format, wrong category.

3. **Missing variant data.** Each product has size/color combinations with their own SKU and price. Right now those are either flattened into a comma-separated string or ignored entirely.

4. **Extra fields.** Suppliers send data we didn't ask for -- `warehouse_code`, `country_of_origin`, `lead_time_days`. We don't have decorators for them, so they silently disappear.

None of these are field-level problems. They require rules that look at multiple fields, conditional logic based on category, nested class validation, and a catch-all for the rest.

> **Without validation classes:** You'd scatter `if (data.msrp <= data.base_cost)` checks across your bot, entity, and API layer. Each check would use slightly different error messages. When business rules change, you'd hunt through three files to update them. The validation class is the single source of truth for what "valid" means.

---

## Step 2: Conditional Validation with @If

Size format depends on product category. Kids shoes use youth sizing (`1Y-7Y`), adults use standard numeric (`7-13`). The `@If` / `@ElseIf` / `@Else` / `@EndIf` decorators let you branch the validation pipeline based on another field's value.

### 2.1 Add the Conditional Block

**`packages/catalog-types/src/validators/supplier-b-v2.ts`**:

```typescript
import {
  Copy, CoerceTrim, CoerceType, CoerceFromSet,
  ValidateRequired, ValidatePattern,
  If, ElseIf, Else, EndIf,
  ObjectRule, CrossValidate, DerivedFrom, DependsOn,
  ValidatedClassArray, CollectProperties,
  Serializable
} from '@firebrandanalytics/shared-utils';

const CATEGORIES = ['mens', 'womens', 'kids', 'unisex'] as const;
type Category = typeof CATEGORIES[number];

@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @CoerceFromSet(CATEGORIES)
  category: Category;

  // --- Conditional size validation ---
  @If('category', 'kids')
    @ValidatePattern(/^\d+(\.\d)?Y(-\d+(\.\d)?Y)?$/, 'Kids sizes must use youth format (e.g., "1Y-7Y")')
  @Else()
    @ValidatePattern(/^\d+(\.\d)?(-\d+(\.\d)?)?$/, 'Adult sizes must use numeric format (e.g., "7-13")')
  @EndIf()
  @Copy()
  @CoerceTrim()
  size_range: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  base_cost: number;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  msrp: number;

  // ... more fields below
}
```

### How It Works

The `@If` decorator checks the resolved value of `category`. If `category` is `'kids'`, only the youth-format pattern runs. For everything else, the `@Else` branch applies the adult-format pattern. The engine automatically tracks the dependency: `size_range` depends on `category`, so `category` is always resolved first.

Key rules for conditional blocks:
- **No nesting.** You cannot put an `@If` inside another `@If`. Keep conditional logic flat.
- **One `@Else`.** Only one `@Else` per block, and it must be last.
- **Same topic.** All `@ElseIf` branches must reference the same property as the original `@If`.
- **First match wins.** Branches are evaluated in order.

### 2.2 More Complex Conditions

You can use predicates instead of equality checks. Here's a conditional that validates `color` differently based on whether the product is a collaboration:

```typescript
  @If('product_name', (name: string) => name.toLowerCase().includes('collab'))
    @ValidateRequired('Collaboration products must specify a color')
  @EndIf()
  @Copy()
  @CoerceTrim()
  color: string;
```

And you can check multiple properties at once:

```typescript
  @If(['category', 'msrp'], ([cat, msrp]: any[]) => cat === 'kids' && msrp > 120)
    @Validate(() => 'Kids shoes over $120 require manager approval')
  @EndIf()
  @Copy()
  approval_flag: string;
```

---

## Step 3: Object-Level Rules

Individual field validations run in isolation. `@ObjectRule` and `@CrossValidate` let you enforce constraints that span multiple fields.

### 3.1 @ObjectRule -- Class-Wide Invariants

`@ObjectRule` is a class-level decorator. It runs after all property validations complete, and it sees the fully validated object.

```typescript
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.msrp <= this.base_cost) {
    return `MSRP ($${this.msrp}) must exceed base cost ($${this.base_cost})`;
  }
  return true;
}, 'Positive margin check')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ... fields from Step 2
}
```

The validation function receives the instance as `this`. Return `true` if valid, or a string error message if not. The description (`'Positive margin check'`) appears in the validation trace.

You can stack multiple `@ObjectRule` decorators:

```typescript
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.msrp <= this.base_cost) {
    return `MSRP ($${this.msrp}) must exceed base cost ($${this.base_cost})`;
  }
  return true;
}, 'Positive margin check')
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.category === 'kids' && this.msrp > 200) {
    return 'Kids products cannot exceed $200 MSRP';
  }
  return true;
}, 'Kids price ceiling')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ...
}
```

### 3.2 @CrossValidate -- Property-Level Multi-Field Rules

`@CrossValidate` is a property-level decorator. Unlike `@ObjectRule` (which fires after all properties are done), `@CrossValidate` fires during property processing and explicitly declares which other properties it depends on.

Use it when the rule is logically tied to a specific field:

```typescript
  @CrossValidate(['category'], (obj) => {
    if (obj.category === 'kids' && obj.msrp > 200) {
      return 'Kids products cannot exceed $200 MSRP';
    }
    return true;
  }, 'Kids MSRP ceiling')
  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  msrp: number;
```

The first argument lists the dependencies -- properties that must be resolved before this rule runs. The validation function receives the full object. The error attaches to the `msrp` field specifically, which is useful for GUI error display.

### 3.3 Derived Fields with @DerivedFrom

Some fields are computed from others. Margin percentage is a classic example -- it's always `(msrp - base_cost) / msrp`. Don't ask the supplier to submit it; compute it.

```typescript
  @DerivedFrom(['msrp', 'base_cost'], (_, ctx) => {
    const { msrp, base_cost } = ctx.instance;
    if (msrp === 0) return 0;
    return Math.round(((msrp - base_cost) / msrp) * 10000) / 10000;
  })
  margin_pct: number;
```

`@DerivedFrom` takes an array of source properties and a derivation function. The engine ensures `msrp` and `base_cost` are resolved before computing `margin_pct`. The second argument to the function is a context object with `raw` (original input) and `instance` (in-progress validated object).

Since `margin_pct` is derived, it doesn't need `@Copy` -- it's never read from the input data. It's always computed.

### 3.4 The Complete Class So Far

Here's the full `SupplierBProductV2` with all rules from Steps 2 and 3:

```typescript
import {
  Copy, CoerceTrim, CoerceType, CoerceFromSet,
  ValidateRequired, ValidatePattern, Validate,
  If, ElseIf, Else, EndIf,
  ObjectRule, CrossValidate, DerivedFrom,
  ValidatedClassArray, CollectProperties,
  Serializable
} from '@firebrandanalytics/shared-utils';

const CATEGORIES = ['mens', 'womens', 'kids', 'unisex'] as const;
type Category = typeof CATEGORIES[number];

@ObjectRule(function(this: SupplierBProductV2) {
  if (this.msrp <= this.base_cost) {
    return `MSRP ($${this.msrp}) must exceed base cost ($${this.base_cost})`;
  }
  return true;
}, 'Positive margin check')
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.category === 'kids' && this.msrp > 200) {
    return 'Kids products cannot exceed $200 MSRP';
  }
  return true;
}, 'Kids price ceiling')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @CoerceFromSet(CATEGORIES)
  category: Category;

  @If('category', 'kids')
    @ValidatePattern(/^\d+(\.\d)?Y(-\d+(\.\d)?Y)?$/, 'Kids sizes must use youth format (e.g., "1Y-7Y")')
  @Else()
    @ValidatePattern(/^\d+(\.\d)?(-\d+(\.\d)?)?$/, 'Adult sizes must use numeric format (e.g., "7-13")')
  @EndIf()
  @Copy()
  @CoerceTrim()
  size_range: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  base_cost: number;

  @CrossValidate(['category'], (obj) => {
    if (obj.category === 'kids' && obj.msrp > 200) {
      return 'Kids products cannot exceed $200 MSRP';
    }
    return true;
  }, 'Kids MSRP ceiling')
  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  msrp: number;

  @DerivedFrom(['msrp', 'base_cost'], (_, ctx) => {
    const { msrp, base_cost } = ctx.instance;
    if (msrp === 0) return 0;
    return Math.round(((msrp - base_cost) / msrp) * 10000) / 10000;
  })
  margin_pct: number;
}

export { SupplierBProductV2 };
```

---

## Step 4: Nested Variant Arrays

A single product has many variants. The Nike Air Max 90 comes in 6 sizes and 4 colors -- that's 24 SKUs, each with its own price. Suppliers send these as a nested array:

```json
{
  "product_name": "Air Max 90",
  "category": "mens",
  "base_cost": 65.00,
  "msrp": 130.00,
  "variants": [
    { "size": "9", "color": "Black/White", "sku": "AM90-BW-9", "unit_price": 130.00 },
    { "size": "9.5", "color": "Black/White", "sku": "AM90-BW-95", "unit_price": 130.00 },
    { "size": "10", "color": "University Red", "sku": "AM90-UR-10", "unit_price": 135.00 }
  ]
}
```

Each variant needs its own validation: size must be numeric, SKU must follow a pattern, price must be positive. The validation library handles this with `@ValidatedClassArray`.

### 4.1 Define the Variant Class

Create a standalone validation class for a single variant:

```typescript
class SupplierVariant {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^\d+(\.\d)?$/, 'Size must be numeric (e.g., "9", "10.5")')
  size: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  color: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^[A-Z0-9]+-[A-Z0-9]+-\d+/, 'SKU must match format CODE-COLOR-SIZE')
  sku: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  @Validate((v: number) => v > 0 || 'Unit price must be positive')
  unit_price: number;
}
```

`SupplierVariant` is a regular validation class. It has no `@Serializable` decorator because it's not stored independently in the entity graph -- it's nested inside `SupplierBProductV2`.

### 4.2 Wire It Into the Parent Class

Add a `variants` field with `@ValidatedClassArray`:

```typescript
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ... fields from Step 3

  @ValidatedClassArray(SupplierVariant)
  variants: SupplierVariant[];
}
```

That's it. When `ValidationFactory.create(SupplierBProductV2, data)` runs:

1. It processes all top-level fields as before.
2. It sees `@ValidatedClassArray(SupplierVariant)` on `variants`.
3. For each element in the `variants` array, it creates a `SupplierVariant` instance and runs that class's full decorator pipeline.
4. If any variant fails validation, the error is reported with the array index: `variants[2].sku: SKU must match format CODE-COLOR-SIZE`.

### 4.3 @ValidatedClass for Single Nested Objects

If a product had a single nested object instead of an array -- say, a `dimensions` object -- you'd use `@ValidatedClass`:

```typescript
class ProductDimensions {
  @Copy()
  @CoerceType('number')
  weight_oz: number;

  @Copy()
  @CoerceType('number')
  box_length_in: number;

  @Copy()
  @CoerceType('number')
  box_width_in: number;
}

@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ... other fields

  @ValidatedClass(ProductDimensions)
  dimensions: ProductDimensions;
}
```

The pattern is the same: define a class, decorate the field, and the engine handles recursive validation.

### 4.4 Variant-Level Rules

You can add `@ObjectRule` and `@CrossValidate` to nested classes too. For example, ensure no two variants in the same product share a SKU:

```typescript
@ObjectRule(function(this: SupplierBProductV2) {
  const skus = this.variants.map(v => v.sku);
  const duplicates = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (duplicates.length > 0) {
    return `Duplicate variant SKUs: ${[...new Set(duplicates)].join(', ')}`;
  }
  return true;
}, 'Unique variant SKUs')
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.msrp <= this.base_cost) {
    return `MSRP ($${this.msrp}) must exceed base cost ($${this.base_cost})`;
  }
  return true;
}, 'Positive margin check')
// ... rest of class
```

---

## Step 5: @CollectProperties -- Catching Extra Fields

Suppliers send fields we didn't plan for. SupplierB might include `warehouse_code`, `country_of_origin`, or `lead_time_days`. Without explicit handling, these fields vanish during validation -- the class doesn't have properties for them, so `ValidationFactory` ignores them.

`@CollectProperties` solves this by scooping up everything that wasn't explicitly handled and storing it in a JSONB-friendly bucket.

### 5.1 Add the Catch-All Field

```typescript
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  // ... all explicit fields from above

  @CollectProperties({ sources: [{ path: '$' }] })
  extra_fields: Record<string, any>;
}
```

The `sources: [{ path: '$' }]` expression means "start at the root of the input data." The decorator automatically excludes any properties that have their own decorators on this class. So `product_name`, `category`, `base_cost`, `msrp`, `variants`, and everything else you explicitly defined are excluded. Whatever remains -- `warehouse_code`, `country_of_origin`, `lead_time_days` -- goes into `extra_fields`.

### 5.2 What Gets Collected

Given this input:

```json
{
  "product_name": "Air Max 90",
  "category": "mens",
  "base_cost": 65.00,
  "msrp": 130.00,
  "size_range": "7-13",
  "variants": [{ "size": "9", "color": "Black", "sku": "AM90-BK-9", "unit_price": 130.00 }],
  "warehouse_code": "WH-PDX-03",
  "country_of_origin": "Vietnam",
  "lead_time_days": 14,
  "internal_notes": "Priority supplier"
}
```

After validation, `extra_fields` contains:

```json
{
  "warehouse_code": "WH-PDX-03",
  "country_of_origin": "Vietnam",
  "lead_time_days": 14,
  "internal_notes": "Priority supplier"
}
```

This data is stored in the entity graph alongside the validated product. When you later decide to add `country_of_origin` as an explicit field, you can backfill from `extra_fields` -- no data was lost.

### 5.3 Why Not Just Ignore Extra Fields?

Three reasons:

1. **Discovery.** When you see 500 products with `warehouse_code` in `extra_fields`, you know it's a real field you should add to the schema.
2. **Debugging.** If validation fails and the supplier says "but I sent the data," you can prove what arrived.
3. **Compliance.** Some industries require you to store everything that was submitted, even if you don't use it.

---

## Step 6: Update the GUI

The GUI needs three updates: a variant table inside the product browser, validation badges that show errors at a glance, and variant entry in the intake form.

### 6.1 Expandable Variant Table

Add a collapsible section to each product card in the browser:

**`apps/catalog-gui/src/components/VariantTable.tsx`**:

```tsx
'use client';

import { useState } from 'react';

interface Variant {
  size: string;
  color: string;
  sku: string;
  unit_price: number;
}

interface VariantTableProps {
  variants: Variant[];
}

export function VariantTable({ variants }: VariantTableProps) {
  const [expanded, setExpanded] = useState(false);

  if (!variants || variants.length === 0) {
    return <span className="text-gray-400 text-sm">No variants</span>;
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
      >
        <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>
          &#9654;
        </span>
        {variants.length} variant{variants.length !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <table className="mt-2 w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1 pr-3 font-medium text-gray-600">Size</th>
              <th className="text-left py-1 pr-3 font-medium text-gray-600">Color</th>
              <th className="text-left py-1 pr-3 font-medium text-gray-600">SKU</th>
              <th className="text-right py-1 font-medium text-gray-600">Price</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={v.sku || i} className="border-b border-gray-100">
                <td className="py-1 pr-3">{v.size}</td>
                <td className="py-1 pr-3">{v.color}</td>
                <td className="py-1 pr-3 font-mono text-xs">{v.sku}</td>
                <td className="py-1 text-right">${v.unit_price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

Use it in the product card:

```tsx
import { VariantTable } from './VariantTable';

// Inside ProductCard component
<VariantTable variants={product.variants} />
```

### 6.2 Validation Badges

Show error and warning counts per product. The validation trace from Part 5 already captures this data -- now we surface it visually.

**`apps/catalog-gui/src/components/ValidationBadge.tsx`**:

```tsx
interface ValidationBadgeProps {
  errors: number;
  warnings: number;
}

export function ValidationBadge({ errors, warnings }: ValidationBadgeProps) {
  if (errors === 0 && warnings === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Valid
      </span>
    );
  }

  return (
    <div className="flex gap-1">
      {errors > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          {errors} error{errors !== 1 ? 's' : ''}
        </span>
      )}
      {warnings > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          {warnings} warning{warnings !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
```

### 6.3 Dynamic Variant Entry

The intake form needs a way to add and remove variant rows. Each row has size, color, SKU, and price fields.

**`apps/catalog-gui/src/components/VariantEditor.tsx`**:

```tsx
'use client';

import { useState } from 'react';

interface VariantRow {
  size: string;
  color: string;
  sku: string;
  unit_price: string; // string for form input, coerced to number on submit
}

const EMPTY_VARIANT: VariantRow = { size: '', color: '', sku: '', unit_price: '' };

interface VariantEditorProps {
  onChange: (variants: VariantRow[]) => void;
}

export function VariantEditor({ onChange }: VariantEditorProps) {
  const [rows, setRows] = useState<VariantRow[]>([{ ...EMPTY_VARIANT }]);

  const updateRow = (index: number, field: keyof VariantRow, value: string) => {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row
    );
    setRows(updated);
    onChange(updated);
  };

  const addRow = () => {
    const updated = [...rows, { ...EMPTY_VARIANT }];
    setRows(updated);
    onChange(updated);
  };

  const removeRow = (index: number) => {
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Variants</label>

      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Size"
            value={row.size}
            onChange={(e) => updateRow(i, 'size', e.target.value)}
            className="w-20 px-2 py-1 border rounded text-sm"
          />
          <input
            type="text"
            placeholder="Color"
            value={row.color}
            onChange={(e) => updateRow(i, 'color', e.target.value)}
            className="flex-1 px-2 py-1 border rounded text-sm"
          />
          <input
            type="text"
            placeholder="SKU"
            value={row.sku}
            onChange={(e) => updateRow(i, 'sku', e.target.value)}
            className="w-32 px-2 py-1 border rounded text-sm font-mono"
          />
          <input
            type="text"
            placeholder="Price"
            value={row.unit_price}
            onChange={(e) => updateRow(i, 'unit_price', e.target.value)}
            className="w-24 px-2 py-1 border rounded text-sm"
          />
          <button
            onClick={() => removeRow(i)}
            disabled={rows.length === 1}
            className="text-red-500 hover:text-red-700 disabled:text-gray-300 text-sm"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        onClick={addRow}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        + Add variant
      </button>
    </div>
  );
}
```

Wire it into the intake form's submit handler:

```tsx
import { VariantEditor } from './VariantEditor';

// Inside IntakeForm component
const [variants, setVariants] = useState([]);

// In the form JSX
<VariantEditor onChange={setVariants} />

// In the submit handler
const payload = {
  ...formData,
  variants: variants.map(v => ({
    ...v,
    unit_price: parseFloat(v.unit_price) || 0
  }))
};
```

### 6.4 Build and Test

```bash
pnpm run build
ff ops build --app-name catalog-bundle
ff ops deploy --app-name catalog-bundle
```

Test with a payload that exercises all the new rules:

```bash
curl -X POST http://localhost:3001/api/catalog-intake \
  -H "Content-Type: application/json" \
  -d '{
    "supplier": "B",
    "version": "2",
    "product_name": "Air Max 90 Kids",
    "category": "kids",
    "base_cost": 45.00,
    "msrp": 89.99,
    "size_range": "1Y-7Y",
    "variants": [
      { "size": "3", "color": "White/Pink", "sku": "AM90K-WP-3", "unit_price": 89.99 },
      { "size": "5", "color": "White/Pink", "sku": "AM90K-WP-5", "unit_price": 89.99 }
    ],
    "warehouse_code": "WH-PDX-03",
    "country_of_origin": "Vietnam"
  }'
```

Verify in the product browser:
- `margin_pct` is computed as `0.4999` (about 50%)
- `size_range` passes the kids-format pattern
- Both variants appear in the expandable table
- `extra_fields` contains `warehouse_code` and `country_of_origin`
- The validation badge shows "Valid"

Now test a bad payload:

```bash
curl -X POST http://localhost:3001/api/catalog-intake \
  -H "Content-Type: application/json" \
  -d '{
    "supplier": "B",
    "version": "2",
    "product_name": "Air Max 90 Kids",
    "category": "kids",
    "base_cost": 95.00,
    "msrp": 79.99,
    "size_range": "7-13",
    "variants": [
      { "size": "9", "color": "Black", "sku": "bad-sku", "unit_price": -5 }
    ]
  }'
```

This should produce multiple errors:
- `size_range`: "Kids sizes must use youth format (e.g., '1Y-7Y')"
- Object rule: "MSRP ($79.99) must exceed base cost ($95.00)"
- `variants[0].sku`: "SKU must match format CODE-COLOR-SIZE"
- `variants[0].unit_price`: "Unit price must be positive"

---

## The Complete SupplierBProductV2

Here's the full class with all decorators from this part:

```typescript
import {
  Copy, CoerceTrim, CoerceType, CoerceFromSet,
  ValidateRequired, ValidatePattern, Validate,
  If, Else, EndIf,
  ObjectRule, CrossValidate, DerivedFrom,
  ValidatedClassArray, CollectProperties,
  Serializable
} from '@firebrandanalytics/shared-utils';

// --- Nested variant class ---

class SupplierVariant {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^\d+(\.\d)?$/, 'Size must be numeric (e.g., "9", "10.5")')
  size: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  color: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  @ValidatePattern(/^[A-Z0-9]+-[A-Z0-9]+-\d+/, 'SKU must match format CODE-COLOR-SIZE')
  sku: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  @Validate((v: number) => v > 0 || 'Unit price must be positive')
  unit_price: number;
}

// --- Product class with rules ---

const CATEGORIES = ['mens', 'womens', 'kids', 'unisex'] as const;
type Category = typeof CATEGORIES[number];

@ObjectRule(function(this: SupplierBProductV2) {
  const skus = this.variants.map(v => v.sku);
  const duplicates = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (duplicates.length > 0) {
    return `Duplicate variant SKUs: ${[...new Set(duplicates)].join(', ')}`;
  }
  return true;
}, 'Unique variant SKUs')
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.msrp <= this.base_cost) {
    return `MSRP ($${this.msrp}) must exceed base cost ($${this.base_cost})`;
  }
  return true;
}, 'Positive margin check')
@ObjectRule(function(this: SupplierBProductV2) {
  if (this.category === 'kids' && this.msrp > 200) {
    return 'Kids products cannot exceed $200 MSRP';
  }
  return true;
}, 'Kids price ceiling')
@Serializable('SupplierBProductV2')
class SupplierBProductV2 {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @CoerceFromSet(CATEGORIES)
  category: Category;

  @If('category', 'kids')
    @ValidatePattern(/^\d+(\.\d)?Y(-\d+(\.\d)?Y)?$/, 'Kids sizes must use youth format (e.g., "1Y-7Y")')
  @Else()
    @ValidatePattern(/^\d+(\.\d)?(-\d+(\.\d)?)?$/, 'Adult sizes must use numeric format (e.g., "7-13")')
  @EndIf()
  @Copy()
  @CoerceTrim()
  size_range: string;

  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  base_cost: number;

  @CrossValidate(['category'], (obj) => {
    if (obj.category === 'kids' && obj.msrp > 200) {
      return 'Kids products cannot exceed $200 MSRP';
    }
    return true;
  }, 'Kids MSRP ceiling')
  @Copy()
  @CoerceType('number')
  @ValidateRequired()
  msrp: number;

  @DerivedFrom(['msrp', 'base_cost'], (_, ctx) => {
    const { msrp, base_cost } = ctx.instance;
    if (msrp === 0) return 0;
    return Math.round(((msrp - base_cost) / msrp) * 10000) / 10000;
  })
  margin_pct: number;

  @ValidatedClassArray(SupplierVariant)
  variants: SupplierVariant[];

  @CollectProperties({ sources: [{ path: '$' }] })
  extra_fields: Record<string, any>;
}

export { SupplierBProductV2, SupplierVariant };
```

---

## Key Takeaways

1. **`@If` / `@ElseIf` / `@Else` / `@EndIf` branch the decorator pipeline** based on another property's value. The engine tracks dependencies automatically. Keep blocks flat -- no nesting.

2. **`@ObjectRule` fires after all properties** and sees the complete validated instance. Use it for invariants that span the whole object (margin checks, uniqueness constraints).

3. **`@CrossValidate` fires during property processing** and explicitly declares dependencies. Use it when the error logically belongs to a specific field -- the GUI can then highlight that field.

4. **`@DerivedFrom` computes a property from others.** Never ask users to submit data you can calculate. Derived fields don't need `@Copy`.

5. **`@ValidatedClassArray` and `@ValidatedClass` enable recursive validation.** Define a class for the nested structure, decorate the parent field, and the engine handles the rest. Errors include array indices for precise reporting.

6. **`@CollectProperties` captures unmapped input.** Store it in a JSONB column for discovery, debugging, and compliance. When a field becomes common enough, promote it to an explicit property with its own decorators.

---

## What's Next

Your validation pipeline handles complex rules and nested data. But some products need human eyes before import -- maybe the fuzzy match was uncertain, or the margin is suspiciously high. [Part 8: Human Review Workflow](./part-08-human-review.md) adds a human review workflow with approval states, inline editing, and a review queue GUI.
