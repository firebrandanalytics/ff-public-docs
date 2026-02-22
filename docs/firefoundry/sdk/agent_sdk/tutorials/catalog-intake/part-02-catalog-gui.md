# Part 2: The Catalog GUI

In Part 1 you built an agent bundle that validates supplier data through a decorator pipeline and stores typed entities in the graph. But you've been testing from the CLI. In this part you'll add a Next.js frontend with two pages -- an intake form and a product browser -- and wire them to the bundle through a shared type package.

The big idea here isn't the GUI itself. It's the **shared type package**. The same validation class that runs in the bundle also defines the types the GUI uses. One definition, two consumers, zero drift.

> **Prerequisite:** Complete [Part 1: A Working Agent Bundle](./part-01-working-agent-bundle.md) first. The bundle must be deployed and reachable.

---

## The Shared Type Package

This is the most important concept in this entire part -- arguably in the whole tutorial. So let's start here before we touch any GUI code.

In Part 1, `SupplierProductV1` lived inside `apps/catalog-bundle/`. That works fine when the bundle is the only consumer. But the moment a frontend needs to know what a product looks like, you have a choice:

1. **Copy the type.** Define a `ProductDTO` in the GUI that mirrors the validator fields. Hope someone remembers to update both when a field changes.
2. **Share the type.** Move the validator to a shared package. Both the bundle and the GUI import from the same source.

Option 2 is what we're doing. Create a `packages/shared-types/` directory and move the validator there.

### Wiring the Workspace

The monorepo workspace needs to know about the `packages/` directory. Your `pnpm-workspace.yaml` at the project root should include it:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

The shared-types package itself is minimal:

```json
{
  "name": "@catalog-intake/shared-types",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@firebrandanalytics/shared-utils": "workspace:*"
  }
}
```

The `main` and `types` both point at the TypeScript source. In a monorepo with `transpilePackages` configured (we'll do that in the GUI's Next config), there's no need for a separate build step -- Next.js compiles it on the fly.

Now both consumers declare the dependency:

```json
// apps/catalog-bundle/package.json
{
  "dependencies": {
    "@catalog-intake/shared-types": "workspace:*"
  }
}

// apps/catalog-gui/package.json
{
  "dependencies": {
    "@catalog-intake/shared-types": "workspace:*"
  }
}
```

Run `pnpm install` from the project root and the workspace links are live.

### The Validator in Shared-Types

Move your `SupplierProductV1` from the bundle into `packages/shared-types/src/product.ts`. It's the same class from Part 1 -- decorators and all:

```typescript
// packages/shared-types/src/product.ts
import {
  Serializable,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRequired,
  ValidateRange,
  ValidatePattern,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
export class SupplierProductV1 {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @CoerceTrim()
  color!: string;

  @CoerceTrim()
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

Export it from the package barrel:

```typescript
// packages/shared-types/src/index.ts
export { SupplierProductV1 } from './product.js';
```

Back in the bundle, update the import to point at the shared package instead of a local file:

```typescript
// apps/catalog-bundle/src/bots/CatalogIntakeBot.ts
import { SupplierProductV1 } from '@catalog-intake/shared-types';
```

Same class, same decorators, new home. The bundle's behavior doesn't change at all.

---

## Why This Matters

Let's make the payoff concrete. Today, your validator has these fields:

```
product_name, category, subcategory, brand_line,
base_cost, msrp, color, size_range
```

Next week, the business asks you to add a `material` field. You open `packages/shared-types/src/product.ts` and add:

```typescript
@CoerceTrim()
@CoerceCase('lower')
material!: string;
```

Here's what happens:

- **The bundle** validates and normalizes `material` on the next deployment. The `ValidationFactory` picks up the new field automatically because it reads the decorator metadata from the class.
- **The GUI** gets a TypeScript compile error anywhere it renders product data without handling `material`. The intake form won't compile until you add a `material` input. The product browser won't compile until you display it.
- **The entity graph** stores `material` alongside the other fields, because `@Serializable` includes it in the JSON round-trip.

One change, three consumers, zero places where the field silently goes missing.

Now picture the alternative: a `ProductDTO` interface in the GUI that was copy-pasted from the validator six months ago. Someone adds `material` to the validator. The bundle validates it. The entity stores it. The GUI compiles without errors -- because its `ProductDTO` doesn't know about `material`. The data is there but invisible. You find out months later when someone asks "why don't we show material in the catalog?"

The shared type package makes that scenario impossible.

---

## Scaffold the GUI

Add a Next.js application to the monorepo:

```bash
cd apps
npx create-next-app@latest catalog-gui --typescript --tailwind --app --src-dir
cd ..
```

Accept the defaults. The scaffolding gives you a working Next.js 14 app with the App Router and Tailwind CSS already configured.

Two things to wire up. First, tell Next.js to transpile the shared-types package (since it's raw TypeScript):

```javascript
// apps/catalog-gui/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@catalog-intake/shared-types'],
};
export default nextConfig;
```

Second, add the shared-types dependency (shown above) and run `pnpm install`.

Your project structure now looks like this:

```
catalog-intake/
  apps/
    catalog-bundle/         # Agent bundle from Part 1
    catalog-gui/            # Next.js GUI (new)
      src/app/
        intake/             # Intake form page
        products/           # Product browser page
      src/lib/
        bundleClient.ts     # Server-side bundle client
  packages/
    shared-types/           # Shared validator class
  pnpm-workspace.yaml
```

### The Bundle Client

The GUI needs to talk to the bundle's API endpoints (the `POST /api/ingest-manual` and `POST /api/ingest-api` routes from Part 1). Create a thin server-side client:

```typescript
// apps/catalog-gui/src/lib/bundleClient.ts
const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3002';

async function callBundle<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${BUNDLE_URL}/api/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bundle API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.result ?? data;
}

export async function submitProduct(
  supplierData: Record<string, unknown>,
): Promise<{ success: boolean; entity_id?: string; errors?: any[] }> {
  return callBundle('ingest-manual', {
    method: 'POST',
    body: JSON.stringify({ supplier_id: 'manual', raw_payload: supplierData }),
  });
}

export async function getProduct(
  entityId: string,
): Promise<{ entity_id: string; data: Record<string, unknown> }> {
  return callBundle(`ingest-api?entityId=${encodeURIComponent(entityId)}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'get', entity_id: entityId }),
  });
}
```

Notice this client doesn't import the shared types at all -- it's just HTTP plumbing. The type safety comes from the components that consume the responses, as you'll see next.

---

## The Intake Form

The intake form submits raw product data to the bundle for validation. The key insight: the form fields are derived directly from the `SupplierProductV1` class.

Create an API route that proxies to the bundle (this keeps the bundle URL server-side and avoids CORS):

```typescript
// apps/catalog-gui/src/app/api/intake/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { submitProduct } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = await submitProduct(body.supplier_data);
  return NextResponse.json(result);
}
```

Now the form page. Here's where the shared type earns its keep:

```tsx
// apps/catalog-gui/src/app/intake/page.tsx
'use client';

import { useState } from 'react';
import { SupplierProductV1 } from '@catalog-intake/shared-types';

// The form state mirrors the validator's fields exactly.
// If someone adds a field to SupplierProductV1,
// TypeScript will flag this initializer as incomplete.
type FormState = {
  [K in keyof SupplierProductV1]: SupplierProductV1[K];
};

const INITIAL_STATE: FormState = {
  product_name: '',
  category: '',
  subcategory: '',
  brand_line: '',
  base_cost: 0,
  msrp: 0,
  color: '',
  size_range: '',
};
```

That `FormState` type is the connection. It's a mapped type over `SupplierProductV1` -- every field the validator declares, the form must include. If the validator gains a `material` field, `INITIAL_STATE` produces a compile error until you add `material: ''`.

The rest of the form is standard React. The submit handler sends the data through the proxy route:

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSubmitting(true);

  const res = await fetch('/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supplier_data: form }),
  });

  const data = await res.json();

  if (data.success) {
    setResult({ entity_id: data.entity_id, status: 'validated' });
  } else {
    setErrors(data.errors || [{ field: 'unknown', message: 'Submission failed' }]);
  }

  setSubmitting(false);
}
```

The response tells you whether validation passed or failed. If it failed, the bundle returns per-field errors (from Part 1's `CatalogIntakeBot`), so the form can highlight exactly which fields need fixing.

Each form input maps to a validator field:

```tsx
<input
  type="text"
  value={form.product_name}
  onChange={(e) => setForm({ ...form, product_name: e.target.value })}
  placeholder="e.g. Air Max 90"
/>

<input
  type="text"
  value={form.base_cost || ''}
  onChange={(e) => setForm({ ...form, base_cost: parseFloat(e.target.value) || 0 })}
  placeholder="89.99"
/>

<input
  type="text"
  value={form.size_range}
  onChange={(e) => setForm({ ...form, size_range: e.target.value })}
  placeholder="7-13"
/>
```

You might wonder why we send `base_cost` as a number from the form when the validator's `@CoerceType('number')` can handle strings. You could send it as a string -- the bundle would coerce it just fine. But the shared type says `base_cost: number`, so TypeScript nudges you toward sending the right type from the start. The coercion decorators are a safety net, not a crutch.

---

## The Product Browser

The product browser lists validated products from the entity graph. Add a list endpoint to the bundle (or use the existing `getProduct` endpoint to fetch by ID). For a simple browser, add a `GET /api/products` endpoint:

```typescript
// In your agent bundle class
@ApiEndpoint({ method: 'GET', route: 'products' })
async listProducts() {
  const entities = await this.entity_factory.query_entities({
    specific_type_name: 'SupplierProductDraft',
    status: 'Validated',
  });

  return {
    products: entities.map((e: any) => ({
      entity_id: e.id,
      ...e.data,
    })),
  };
}
```

On the GUI side, the product browser fetches this list and renders each product. Here's the key part -- how the GUI reads typed entities:

```tsx
// apps/catalog-gui/src/app/products/page.tsx
'use client';

import { useState, useEffect } from 'react';
import type { SupplierProductV1 } from '@catalog-intake/shared-types';

interface ProductEntry {
  entity_id: string;
  // Extend the validator type -- every field the validator declares
  // is available here as a typed property.
  product: SupplierProductV1;
}
```

Because `ProductEntry.product` is typed as `SupplierProductV1`, accessing `product.product_name` or `product.base_cost` is fully type-checked. No `any` casts. No optional chaining on fields you know exist. If the validator adds `material`, the product browser can access `product.material` immediately -- and TypeScript will tell you it's a `string`.

The rendering itself is straightforward:

```tsx
function ProductCard({ product }: { product: SupplierProductV1; entityId: string }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-lg font-semibold">{product.product_name}</h3>
      <div className="grid grid-cols-3 gap-4 text-sm mt-2">
        <div>
          <span className="text-gray-500">Category</span>
          <p>{product.category}</p>
        </div>
        <div>
          <span className="text-gray-500">Base Cost</span>
          <p>${product.base_cost.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-500">MSRP</span>
          <p>${product.msrp.toFixed(2)}</p>
        </div>
      </div>
      <p className="text-sm text-gray-500 mt-2">
        {product.color} | Sizes: {product.size_range}
      </p>
    </div>
  );
}
```

Every property access -- `product.product_name`, `product.base_cost`, `product.color` -- is type-safe because the type comes from the shared validator class. You don't need to define a separate `DisplayProduct` interface and hope it matches what the bundle actually returns.

### Putting It Together

Wire up an API route for the products list (same pattern as the intake proxy), fetch it in a `useEffect`, and render the cards:

```tsx
export default function ProductsPage() {
  const [products, setProducts] = useState<ProductEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data.products || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading products...</p>;
  if (products.length === 0) return <p>No products yet. Submit one from the intake form.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Product Browser</h1>
      <p className="text-gray-600">{products.length} validated products</p>
      {products.map((p) => (
        <ProductCard key={p.entity_id} product={p.product} entityId={p.entity_id} />
      ))}
    </div>
  );
}
```

---

## Testing the Flow

Start both services:

```bash
# Terminal 1 -- Agent Bundle
cd apps/catalog-bundle
ff-cli agent-bundle dev

# Terminal 2 -- Catalog GUI
cd apps/catalog-gui
echo 'BUNDLE_URL=http://localhost:3002' > .env.local
pnpm dev
```

Open `http://localhost:3000` and walk through the full cycle:

1. **Navigate to `/intake`** -- fill out the form with some messy data. Try title-cased product names, string prices, extra whitespace. The bundle's decorators will clean it all up.
2. **Submit** -- the bundle validates through the same `SupplierProductV1` class, stores a typed entity, and returns the result.
3. **Navigate to `/products`** -- the product appears with normalized data. `"  air max 90  "` shows as `"Air Max 90"`. `"89.99"` (string) shows as `$89.99` (number, formatted).

The key observation: the validator class ran in the bundle to clean the data, and the same class definition typed the GUI components that display it. The form's field list, the bundle's validation pipeline, and the browser's display columns all derive from one source.

---

## The Three Roles of a Shared Validator

Let's zoom out and name the pattern explicitly. The `SupplierProductV1` class serves three roles simultaneously:

| Role | Where | What It Does |
|------|-------|-------------|
| **Validation pipeline** | Agent bundle | `ValidationFactory.create()` runs decorators to coerce, trim, and validate raw input |
| **TypeScript type** | GUI components | Form state, product display, and API responses are all typed against the validator's fields |
| **Serialization contract** | Entity graph | `@Serializable` ensures `toJSON()` and `fromJSON()` round-trip the class instance through storage |

One class definition. Three consumers. When the class changes, all three see it. The bundle validates the new field. The GUI gets a compile error until it handles the new field. The entity graph stores and reconstructs it automatically.

This is the data class philosophy from the README in action: **the class is the contract, the validator, and the serialization format -- all at once.**

---

## What's Next

Your app now has a GUI, but every product goes through the same flat-JSON validator. Real suppliers don't send uniform data. One sends flat snake_case JSON. Another sends nested objects. A third sends ALL_CAPS CSV exports.

In [Part 3: Multi-Supplier Routing](./part-03-multi-supplier-routing.md), you'll replace the single validator with a `@DiscriminatedUnion` that routes each supplier's format to a dedicated validation class -- and you'll see how the shared type package extends naturally to handle multiple input formats that all normalize to the same canonical shape.
