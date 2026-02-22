# Part 2: The Catalog GUI

In Part 1 you built an agent bundle that ingests supplier product data, validates it through a `SupplierProductValidator` class, and stores typed entities in the graph. But right now the only way to submit products is through `ff-cli`. In this part you'll add a Next.js GUI with two pages -- an intake form for submitting products and a product browser for viewing them -- and you'll wire both to the agent bundle through a shared type package.

The big idea: the same validation class that runs in the bundle also defines the types used in the GUI. One definition, two consumers, zero drift.

> **Prerequisite:** Complete [Part 1: A Working Agent Bundle](./part-01-working-agent-bundle.md) first. The bundle must be deployed and reachable.

---

## Step 1: Scaffold the GUI

Add a GUI component to the application:

```bash
ff gui add catalog-gui
```

This scaffolds a Next.js 14 application in `apps/catalog-gui/`. Install Tailwind CSS and configure the project:

```bash
cd apps/catalog-gui
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p --ts
```

Configure Tailwind to scan your source files.

**`apps/catalog-gui/tailwind.config.ts`**:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

Replace the contents of `globals.css` with the Tailwind directives:

**`apps/catalog-gui/src/app/globals.css`**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Update `next.config.mjs` for standalone output and monorepo transpilation:

**`apps/catalog-gui/next.config.mjs`**:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@firekicks/shared-types'],
};
export default nextConfig;
```

Your project structure should now look like this:

```
firekicks/
  apps/
    catalog-bundle/         # Agent bundle from Part 1
    catalog-gui/            # Next.js GUI (new)
      src/
        app/
          globals.css
          layout.tsx
          page.tsx
          intake/
          products/
        lib/
      tailwind.config.ts
      next.config.mjs
  packages/
    shared-types/           # Shared type package (new)
  pnpm-workspace.yaml
```

---

## Step 2: The Shared Type Package

This is the most important architectural decision in the entire tutorial. The `SupplierProductValidator` class you built in Part 1 doesn't just live in the bundle -- it lives in a shared package that both the bundle and the GUI consume.

Create the shared type package:

```bash
mkdir -p packages/shared-types/src
cd packages/shared-types
pnpm init
```

**`packages/shared-types/package.json`**:

```json
{
  "name": "@firekicks/shared-types",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@firebrandanalytics/shared-utils": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

Add the workspace entry to `pnpm-workspace.yaml` at the project root:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Now define the canonical product interface and the validator class.

**`packages/shared-types/src/product.ts`**:

```typescript
import {
  Serializable,
  Copy,
  CoerceType,
  CoerceTrim,
  ValidateRequired,
  ValidateRange,
  NormalizeText,
} from '@firebrandanalytics/shared-utils';

/**
 * The canonical shape all supplier products normalize to.
 * This interface is the contract between the bundle, the GUI, and any backend service.
 */
export interface SupplierProductCanonical {
  product_name: string;
  category: string;
  sku: string;
  base_cost: number;
  msrp: number;
  supplier_format: string;
  description: string;
  color: string;
  sizes_available: string[];
  weight_oz: number;
  in_stock: boolean;
}

/**
 * The validation class that normalizes raw supplier data into
 * SupplierProductCanonical. This class IS the contract -- when you
 * add a field here, the GUI gets it automatically.
 */
@Serializable()
export class SupplierProductValidator implements SupplierProductCanonical {
  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  product_name: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  category: string;

  @Copy()
  @CoerceTrim()
  @ValidateRequired()
  sku: string;

  @Copy()
  @CoerceType('number')
  @ValidateRange(0, 100000)
  base_cost: number;

  @Copy()
  @CoerceType('number')
  @ValidateRange(0, 100000)
  msrp: number;

  @Copy()
  @CoerceTrim()
  supplier_format: string = 'manual';

  @Copy()
  @CoerceTrim()
  description: string = '';

  @Copy()
  @CoerceTrim()
  color: string = '';

  @Copy()
  sizes_available: string[] = [];

  @Copy()
  @CoerceType('number')
  @ValidateRange(0, 500)
  weight_oz: number = 0;

  @Copy()
  @CoerceType('boolean')
  in_stock: boolean = true;
}
```

**`packages/shared-types/src/index.ts`**:

```typescript
export { SupplierProductValidator } from './product';
export type { SupplierProductCanonical } from './product';
```

Now install the shared package in both the bundle and the GUI:

```bash
# From the project root
cd apps/catalog-bundle
pnpm add @firekicks/shared-types@workspace:*

cd ../catalog-gui
pnpm add @firekicks/shared-types@workspace:*
```

### Why This Matters

The validator class serves three roles simultaneously:

1. **In the bundle** -- it's the validation pipeline that normalizes raw supplier data. The `ValidationFactory` instantiates it, applies decorator logic, and produces a clean object.
2. **In the GUI** -- it's the TypeScript type that the intake form and product browser reference. The `SupplierProductCanonical` interface ensures the GUI can't reference fields that don't exist.
3. **As the contract** -- when you add a field to the validator (say, `material: string`), both the bundle and the GUI see it immediately. No separate DTO definition to keep in sync.

We'll explore what happens without this pattern in the sidebar at the end of this part.

---

## Step 3: API Endpoints on the Bundle

The GUI needs HTTP endpoints to submit products and query them. Add three `@ApiEndpoint` methods to the agent bundle class.

**`apps/catalog-bundle/src/CatalogIntakeBundle.ts`** -- add these endpoints:

```typescript
import { AgentBundle, ApiEndpoint } from '@firebrandanalytics/ff-agent-sdk';
import type { SupplierProductCanonical } from '@firekicks/shared-types';

export class CatalogIntakeBundle extends AgentBundle {
  // ... existing bot and entity setup from Part 1 ...

  /**
   * Submit raw supplier data for intake processing.
   * The bot validates and normalizes the data, then stores it as an entity.
   */
  @ApiEndpoint({ method: 'POST', route: 'intake' })
  async submitProduct(body: { supplier_data: Record<string, any> }) {
    const entity = await this.entity_factory.create_entity_node(
      'SupplierProductEntity',
      {
        raw_input: body.supplier_data,
        status: 'pending',
      }
    );

    // Invoke the bot to validate and normalize
    await this.entity_client.invoke(entity.id, 'run');

    // Return the processed entity
    const result = await this.entity_client.get_node(entity.id);
    return {
      entity_id: entity.id,
      status: result.data.status,
      product: result.data.validated_product as SupplierProductCanonical,
    };
  }

  /**
   * List all validated product entities.
   */
  @ApiEndpoint({ method: 'GET', route: 'products' })
  async listProducts() {
    const entities = await this.entity_client.query_entities(
      'SupplierProductEntity',
      { status: 'validated' }
    );

    const products = entities.map((e: any) => ({
      entity_id: e.id,
      ...e.data.validated_product as SupplierProductCanonical,
      created_at: e.created_at,
    }));

    return { products, total: products.length };
  }

  /**
   * Get a single product entity by ID.
   */
  @ApiEndpoint({ method: 'GET', route: 'products-detail' })
  async getProduct(query: { id: string }) {
    const entity = await this.entity_client.get_node(query.id);
    return {
      entity_id: entity.id,
      status: entity.data.status,
      product: entity.data.validated_product as SupplierProductCanonical,
      raw_input: entity.data.raw_input,
      created_at: entity.created_at,
    };
  }
}
```

These three endpoints give the GUI everything it needs:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/intake` | POST | Submit raw supplier data to the bot |
| `/api/products` | GET | List all validated products |
| `/api/products-detail?id=...` | GET | Get a single product with its raw input |

---

## Step 4: Build the Intake Form

Create a server-side bundle client helper and the intake form page.

### Bundle Client

**`apps/catalog-gui/src/lib/bundleClient.ts`**:

```typescript
/**
 * Server-side client for the catalog-intake agent bundle.
 * Only use in API routes and Server Components -- never in client components.
 */

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3001';

export interface ProductListResponse {
  products: ProductListItem[];
  total: number;
}

export interface ProductListItem {
  entity_id: string;
  product_name: string;
  category: string;
  sku: string;
  base_cost: number;
  msrp: number;
  supplier_format: string;
  description: string;
  color: string;
  sizes_available: string[];
  weight_oz: number;
  in_stock: boolean;
  created_at: string;
}

export interface ProductDetail extends ProductListItem {
  status: string;
  raw_input: Record<string, any>;
}

export interface IntakeResponse {
  entity_id: string;
  status: string;
  product: ProductListItem;
}

async function callBundle<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${BUNDLE_URL}/api/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bundle API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.result ?? data;
}

export async function submitProduct(supplierData: Record<string, any>): Promise<IntakeResponse> {
  return callBundle<IntakeResponse>('intake', {
    method: 'POST',
    body: JSON.stringify({ supplier_data: supplierData }),
  });
}

export async function listProducts(): Promise<ProductListResponse> {
  return callBundle<ProductListResponse>('products');
}

export async function getProduct(id: string): Promise<ProductDetail> {
  return callBundle<ProductDetail>(`products-detail?id=${encodeURIComponent(id)}`);
}
```

### API Routes

The GUI proxies all bundle calls through its own API routes. This avoids CORS issues and keeps the bundle's internal URL hidden from the browser.

**`apps/catalog-gui/src/app/api/intake/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { submitProduct } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.supplier_data || typeof body.supplier_data !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid supplier_data' },
        { status: 400 }
      );
    }

    const result = await submitProduct(body.supplier_data);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /intake] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Intake failed' },
      { status: 500 }
    );
  }
}
```

**`apps/catalog-gui/src/app/api/products/route.ts`**:

```typescript
import { NextResponse } from 'next/server';
import { listProducts } from '@/lib/bundleClient';

export async function GET() {
  try {
    const result = await listProducts();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /products] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to list products' },
      { status: 500 }
    );
  }
}
```

**`apps/catalog-gui/src/app/api/products/[id]/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/bundleClient';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await getProduct(params.id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /products/:id] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to get product' },
      { status: 500 }
    );
  }
}
```

### Layout

**`apps/catalog-gui/src/app/layout.tsx`**:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'FireKicks Catalog Intake',
  description: 'Supplier product intake and catalog browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 min-h-screen">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center gap-6">
            <span className="text-lg font-bold text-gray-900">FireKicks</span>
            <Link
              href="/intake"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Intake Form
            </Link>
            <Link
              href="/products"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Product Browser
            </Link>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

### Intake Form Page

The form fields match the `SupplierProductCanonical` interface. This is intentional -- the shared type drives the shape of the form.

**`apps/catalog-gui/src/app/intake/page.tsx`**:

```tsx
'use client';

import { useState } from 'react';
import type { SupplierProductCanonical } from '@firekicks/shared-types';

type IntakeFormData = Omit<SupplierProductCanonical, 'supplier_format'>;

const CATEGORIES = [
  'Running',
  'Basketball',
  'Training',
  'Lifestyle',
  'Trail',
  'Soccer',
];

const SIZES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'];

export default function IntakePage() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ entity_id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<IntakeFormData>({
    product_name: '',
    category: 'Running',
    sku: '',
    base_cost: 0,
    msrp: 0,
    description: '',
    color: '',
    sizes_available: [],
    weight_oz: 0,
    in_stock: true,
  });

  function updateField<K extends keyof IntakeFormData>(key: K, value: IntakeFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSize(size: string) {
    setForm((prev) => ({
      ...prev,
      sizes_available: prev.sizes_available.includes(size)
        ? prev.sizes_available.filter((s) => s !== size)
        : [...prev.sizes_available, size],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_data: form }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Submission failed');
      }

      setResult({ entity_id: data.entity_id, status: data.status });
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Product Intake</h1>
      <p className="text-gray-600 mb-6">
        Submit a new product for validation. The bundle will normalize and validate
        the data using the shared <code>SupplierProductValidator</code> class.
      </p>

      {/* Success message */}
      {result && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 font-medium">Product submitted successfully</p>
          <p className="text-green-700 text-sm mt-1">
            Entity ID: <code className="bg-green-100 px-1 rounded">{result.entity_id}</code>
            {' '} -- Status: <code className="bg-green-100 px-1 rounded">{result.status}</code>
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg border border-gray-200">
        {/* Product Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
          <input
            type="text"
            required
            value={form.product_name}
            onChange={(e) => updateField('product_name', e.target.value)}
            placeholder="e.g. FireKicks Pro Runner 3"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Category + SKU */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <select
              value={form.category}
              onChange={(e) => updateField('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SKU *</label>
            <input
              type="text"
              required
              value={form.sku}
              onChange={(e) => updateField('sku', e.target.value)}
              placeholder="e.g. FK-PRO3-BLK-10"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Pricing */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base Cost ($) *</label>
            <input
              type="number"
              required
              min={0}
              step={0.01}
              value={form.base_cost || ''}
              onChange={(e) => updateField('base_cost', parseFloat(e.target.value) || 0)}
              placeholder="45.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">MSRP ($) *</label>
            <input
              type="number"
              required
              min={0}
              step={0.01}
              value={form.msrp || ''}
              onChange={(e) => updateField('msrp', parseFloat(e.target.value) || 0)}
              placeholder="129.99"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="Lightweight racing flat with carbon plate..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Color + Weight */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="text"
              value={form.color}
              onChange={(e) => updateField('color', e.target.value)}
              placeholder="e.g. Black / Volt"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weight (oz)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.weight_oz || ''}
              onChange={(e) => updateField('weight_oz', parseFloat(e.target.value) || 0)}
              placeholder="8.5"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Sizes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Available Sizes</label>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => toggleSize(size)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  form.sizes_available.includes(size)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* In Stock */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="in_stock"
            checked={form.in_stock}
            onChange={(e) => updateField('in_stock', e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded border-gray-300"
          />
          <label htmlFor="in_stock" className="text-sm text-gray-700">In Stock</label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit for Validation'}
        </button>
      </form>
    </div>
  );
}
```

Notice the type import at the top: `import type { SupplierProductCanonical } from '@firekicks/shared-types'`. The `IntakeFormData` type is derived directly from `SupplierProductCanonical`. If someone adds a required field to the validator -- say, `material: string` -- TypeScript will flag this page with a compile error until the form includes a `material` input. That's the shared type contract at work.

---

## Step 5: Build the Product Browser

The product browser lists every validated product from the entity graph. Each card shows key fields from the `SupplierProductCanonical` interface, and you can click to expand full details.

**`apps/catalog-gui/src/app/products/page.tsx`**:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SupplierProductCanonical } from '@firekicks/shared-types';

interface ProductEntry extends SupplierProductCanonical {
  entity_id: string;
  created_at: string;
}

function formatCurrency(cents: number): string {
  return `$${cents.toFixed(2)}`;
}

function FormatBadge({ format }: { format: string }) {
  const colorMap: Record<string, string> = {
    manual: 'bg-gray-100 text-gray-700',
    flat_json: 'bg-blue-100 text-blue-700',
    nested_json: 'bg-purple-100 text-purple-700',
    csv_caps: 'bg-orange-100 text-orange-700',
    free_text: 'bg-green-100 text-green-700',
  };
  const classes = colorMap[format] || 'bg-gray-100 text-gray-700';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {format.replace(/_/g, ' ')}
    </span>
  );
}

function ProductCard({ product }: { product: ProductEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900">{product.product_name}</h3>
        <FormatBadge format={product.supplier_format} />
      </div>

      {/* Key fields */}
      <div className="grid grid-cols-3 gap-4 text-sm mb-3">
        <div>
          <span className="text-gray-500">Category</span>
          <p className="font-medium text-gray-900">{product.category}</p>
        </div>
        <div>
          <span className="text-gray-500">Base Cost</span>
          <p className="font-medium text-gray-900">{formatCurrency(product.base_cost)}</p>
        </div>
        <div>
          <span className="text-gray-500">MSRP</span>
          <p className="font-medium text-gray-900">{formatCurrency(product.msrp)}</p>
        </div>
      </div>

      {/* SKU + stock indicator */}
      <div className="flex items-center gap-3 text-sm text-gray-500 mb-3">
        <span>SKU: <code className="bg-gray-100 px-1 rounded">{product.sku}</code></span>
        <span className={`flex items-center gap-1 ${product.in_stock ? 'text-green-600' : 'text-red-500'}`}>
          <span className={`w-2 h-2 rounded-full ${product.in_stock ? 'bg-green-500' : 'bg-red-400'}`} />
          {product.in_stock ? 'In Stock' : 'Out of Stock'}
        </span>
      </div>

      {/* Expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
          {product.description && (
            <div>
              <span className="text-gray-500">Description</span>
              <p className="text-gray-800">{product.description}</p>
            </div>
          )}
          {product.color && (
            <div>
              <span className="text-gray-500">Color</span>
              <p className="text-gray-800">{product.color}</p>
            </div>
          )}
          {product.sizes_available.length > 0 && (
            <div>
              <span className="text-gray-500">Sizes</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {product.sizes_available.map((size) => (
                  <span
                    key={size}
                    className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-gray-700"
                  >
                    {size}
                  </span>
                ))}
              </div>
            </div>
          )}
          {product.weight_oz > 0 && (
            <div>
              <span className="text-gray-500">Weight</span>
              <p className="text-gray-800">{product.weight_oz} oz</p>
            </div>
          )}
          <div>
            <span className="text-gray-500">Entity ID</span>
            <p className="text-gray-400 font-mono text-xs">{product.entity_id}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/products');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load products');
      }
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Browser</h1>
          <p className="text-gray-600 text-sm mt-1">
            {products.length} validated product{products.length !== 1 ? 's' : ''} in the catalog
          </p>
        </div>
        <button
          onClick={fetchProducts}
          disabled={loading}
          className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && products.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
          <p className="text-gray-500">Loading products...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">No products yet</p>
          <p className="text-sm">Submit a product through the intake form to see it here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {products.map((product) => (
            <ProductCard key={product.entity_id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Each `ProductCard` uses the `ProductEntry` type, which extends `SupplierProductCanonical`. The `FormatBadge` component renders a color-coded pill for each supplier format -- right now everything will show "manual", but in Part 3 we'll add multi-supplier routing and each format gets its own badge.

---

## Step 6: Wire and Test

Start the bundle and GUI in separate terminals.

**Terminal 1 -- Agent Bundle:**

```bash
cd apps/catalog-bundle
ff-cli agent-bundle dev
```

**Terminal 2 -- Catalog GUI:**

```bash
cd apps/catalog-gui

# Point the GUI at the bundle's local dev server
echo 'BUNDLE_URL=http://localhost:3001' > .env.local

pnpm dev
```

Open `http://localhost:3000` in your browser. You should see the FireKicks nav bar with links to the Intake Form and Product Browser.

### Walk-through

1. **Navigate to Intake Form** (`/intake`)
2. **Fill out the form:**
   - Product Name: `FireKicks Velocity Racer`
   - Category: `Running`
   - SKU: `FK-VR-BLK-10`
   - Base Cost: `55.00`
   - MSRP: `149.99`
   - Description: `Lightweight racing flat with responsive foam midsole`
   - Color: `Black / Volt`
   - Sizes: click `9`, `10`, `11`
   - Weight: `7.8`
   - In Stock: checked
3. **Click "Submit for Validation"** -- the bundle receives the data, runs it through the `SupplierProductValidator`, and saves a typed entity
4. **Navigate to Product Browser** (`/products`) -- the Velocity Racer appears with a "manual" format badge, showing the validated data

The key thing to notice: the same class definition that validated the data in the bundle (`SupplierProductValidator` with its `@Copy`, `@CoerceType`, `@ValidateRequired` decorators) also defines the type displayed in the product browser (`SupplierProductCanonical`). The form fields, the validation pipeline, and the display columns all derive from the same source.

---

## Sidebar: Why Shared Types Matter

Let's look at what happens without a shared type package.

### Without Shared Types

The bundle has its own `SupplierProduct` type:

```typescript
// apps/catalog-bundle/src/types.ts
interface SupplierProduct {
  product_name: string;
  category: string;
  sku: string;
  base_cost: number;
  msrp: number;
  // ... other fields
}
```

The GUI has a separate `ProductDTO` type:

```typescript
// apps/catalog-gui/src/types.ts
interface ProductDTO {
  product_name: string;
  category: string;
  sku: string;
  base_cost: number;
  msrp: number;
  // ... hopefully the same fields
}
```

They start identical. Then someone renames `base_cost` to `wholesale_price` in the bundle's validator. The bundle works fine. The GUI compiles fine -- TypeScript doesn't know the types are supposed to match. You find out at runtime when the product browser shows `$NaN` because `product.base_cost` is now `undefined`.

Or someone adds a `material` field to the validator. The bundle validates it, the entity stores it, but the GUI's `ProductDTO` doesn't have it. The data is there but invisible. Months later someone asks "why don't we show material?" and the answer is "we do collect it, we just forgot to add it to the frontend type."

### With Shared Types

One definition in `packages/shared-types/`:

```typescript
export interface SupplierProductCanonical {
  product_name: string;
  base_cost: number;  // Rename this? Both bundle and GUI see the change.
  material: string;   // Add this? GUI gets a compile error until it handles it.
  // ...
}
```

The rename causes a compile error in the GUI immediately. The new field causes a compile error in the form immediately. You catch both at build time, not in production.

This is the running theme of this tutorial: **data classes > raw JSON**. The validation class is the single source of truth, and the shared type package is the mechanism that enforces it across the stack.

---

## What's Next

Your app has an intake form and a product browser, but every product looks the same regardless of which supplier sent it. In [Part 3: Multi-Supplier Routing](./part-03-multi-supplier-routing.md), we'll add discriminated unions so the pipeline routes each supplier's format to a dedicated validator -- and the GUI shows which format was detected.
