# Part 8: Human Review Workflow

Your validation pipeline normalizes messy supplier data, matches against the catalog, and enforces business rules. Every product that enters the system is validated, traced, and typed. But should every product be imported automatically? A fuzzy match that scored 0.78 -- is "Trail Runner" really the same as "Trail Running Shoes"? A margin of 80% -- is that a premium product or a data entry error? The AI classified a category from free text -- should a human verify that before it hits the catalog?

In this part, you'll add an approval workflow so humans can review edge cases before products are imported. The bot assigns a review state based on validation confidence, and a review queue GUI lets operators approve, reject, or edit products before final import.

**What you'll learn:**
- Modeling entity states (`draft`, `review`, `approved`, `imported`) as a property on the entity
- Assigning initial states based on validation confidence scores
- Building a review queue page with filtering and sorting
- Inline editing with re-validation through the same decorator pipeline
- Writing approved products to the final catalog via DAS

**What you'll build:** A state machine on the product entity, bot logic that routes products to the right initial state, and two new GUI pages -- a review queue and a review detail page with inline editing.

**Starting point:** Completed code from [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md). You should have a working validation pipeline with business rules, cross-field validation, and nested variant support.

---

## Step 1: The Problem -- Not Everything Should Auto-Import

Run your pipeline from Part 7 and look at the validation traces for a few products. Some are clean:

```
product_name: "Air Max 90"          -> catalog_match: "Air Max 90" (confidence: 0.99)
category: "Running Shoes"           -> mapped to: "running" (confidence: 0.95)
margin: 45%                         -> within expected range
```

But others have ambiguity:

```
product_name: "Trail Runner"        -> catalog_match: "Trail Running Shoes" (confidence: 0.75)
category: "Athletic Footwear"       -> mapped to: "running" (confidence: 0.68)
margin: 80%                         -> above threshold (max expected: 65%)
```

The second product passed validation -- nothing is technically wrong. The fuzzy match found a candidate, the category mapper chose a value, the margin is a valid number. But the confidence scores tell you this product needs human eyes. Is "Trail Runner" actually "Trail Running Shoes," or is it a different product entirely? Is 80% margin correct for a premium shoe, or did someone type "80" instead of "08"?

Auto-importing everything works when your data is clean. Real supplier data is not clean. You need a gate between "validated" and "imported" where a human can verify the edge cases.

---

## Step 2: Entity State Machine

Add a `reviewStatus` field to the product entity that tracks where each product is in the approval pipeline.

### The States

| State | Meaning |
|-------|---------|
| `draft` | Product has validation errors or very low confidence. Needs correction before review. |
| `review` | Product passed validation but has medium-confidence fields. Needs human verification. |
| `approved` | Human reviewed and approved, or all fields were high-confidence (auto-approved). Ready for import. |
| `imported` | Product has been written to the final catalog. Terminal state. |

### State Transitions

```
draft ──(edit + re-validate)──> review
draft ──(edit + re-validate)──> approved  (if all fields now high-confidence)
review ──(approve)───────────> approved
review ──(reject)────────────> draft      (with rejection reason)
review ──(edit + re-validate)─> review    (still needs review after edit)
approved ──(import)──────────> imported
```

Products cannot skip states. You cannot go from `draft` directly to `imported` -- the product must pass through `approved` first, either by human review or auto-approval after editing.

### Update the Product Data Interface

Add `reviewStatus` and related fields to the shared type package.

**`packages/shared-types/src/product.ts`** (add to existing interface):

```typescript
export type ReviewStatus = 'draft' | 'review' | 'approved' | 'imported';

export interface ProductEntityData {
  // ... existing fields from Parts 1-7 ...
  supplier_name: string;
  product_name: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  variants?: ProductVariant[];

  // Review workflow fields
  reviewStatus: ReviewStatus;
  reviewAssignedAt?: string;         // ISO timestamp when status was last changed
  reviewedBy?: string;               // user ID of reviewer
  reviewedAt?: string;               // ISO timestamp of review action
  rejectionReason?: string;          // set when rejected back to draft
  importedAt?: string;               // ISO timestamp of final import

  // Confidence summary (computed by bot from validation trace)
  overallConfidence: number;         // min confidence across all fields
  lowConfidenceFields: string[];     // field names with confidence < 0.8
}
```

### State Transition Helper

Create a helper that enforces valid transitions. This is plain TypeScript -- no SDK dependency.

**`packages/shared-types/src/reviewStateMachine.ts`**:

```typescript
import { ReviewStatus } from './product';

const VALID_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft:    ['review', 'approved'],
  review:   ['draft', 'approved'],
  approved: ['imported'],
  imported: [],  // terminal state
};

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} -> ${to}. ` +
      `Valid transitions from "${from}": ${VALID_TRANSITIONS[from].join(', ') || 'none (terminal state)'}`
    );
  }
}
```

This is intentionally simple. The state machine is a lookup table with a validation function. No libraries, no classes, no event emitters. If the transition is invalid, throw an error with a helpful message.

---

## Step 3: Bot Workflow Logic -- Assigning Initial State

Update the bot to compute an `overallConfidence` from the validation trace and assign the initial `reviewStatus` based on confidence thresholds.

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`** (add after validation):

```typescript
// After running the validation pipeline...
const validatedProduct = await validationFactory.create(
  supplierValidator,
  rawProduct,
  context
);
const trace = validationFactory.getLastTrace();

// Compute confidence summary from the trace
const fieldConfidences = trace.getFieldConfidences();
const overallConfidence = Math.min(...Object.values(fieldConfidences));
const lowConfidenceFields = Object.entries(fieldConfidences)
  .filter(([_, confidence]) => confidence < 0.8)
  .map(([field]) => field);

// Determine initial review status
const reviewStatus = determineReviewStatus(overallConfidence, trace);

// Set review fields on the product
validatedProduct.reviewStatus = reviewStatus;
validatedProduct.reviewAssignedAt = new Date().toISOString();
validatedProduct.overallConfidence = overallConfidence;
validatedProduct.lowConfidenceFields = lowConfidenceFields;
```

### The Decision Logic

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`** (helper function):

```typescript
import { ReviewStatus } from '@catalog-intake/shared-types';
import { ValidationTrace } from '@firebrandanalytics/shared-utils';

function determineReviewStatus(
  overallConfidence: number,
  trace: ValidationTrace
): ReviewStatus {
  // Any validation errors -> draft (needs correction)
  if (trace.hasErrors()) {
    return 'draft';
  }

  // Any field below 0.6 -> draft (too uncertain for review)
  if (overallConfidence < 0.6) {
    return 'draft';
  }

  // Any field between 0.6 and 0.9 -> review (needs human eyes)
  if (overallConfidence < 0.9) {
    return 'review';
  }

  // All fields 0.9+ -> approved (auto-approve)
  return 'approved';
}
```

### Why These Thresholds

| Overall Confidence | Initial State | Rationale |
|-------------------|---------------|-----------|
| < 0.6 | `draft` | The data is too uncertain. Fuzzy match might be wrong, category mapping is a guess. Presenting this for review wastes the reviewer's time -- it needs correction first. |
| 0.6 -- 0.89 | `review` | The data is plausible but not certain. A human can quickly verify whether "Trail Runner" maps to "Trail Running Shoes." This is the sweet spot for human review. |
| >= 0.9 | `approved` | All fields are high-confidence matches. Auto-approve to keep the review queue manageable. Reviewers should spend their time on edge cases, not rubber-stamping obvious matches. |

These thresholds are starting points. After running the pipeline on real data, you will likely adjust them. If the review queue is too long, raise the lower threshold. If bad products are getting auto-approved, lower the upper threshold. The `overallConfidence` and `lowConfidenceFields` fields on the entity make this tuning data-driven.

> **Without validation classes:** You would scatter confidence checks across multiple handler functions, each with its own threshold logic. When you decide to change the auto-approve threshold from 0.9 to 0.85, you need to find every place that makes this decision. With the centralized `determineReviewStatus` function, the routing logic lives in one place.

---

## Step 4: Review Actions

The review queue supports three actions: approve, reject, and edit. Each action changes the entity state and is exposed as an API endpoint on the bundle.

### Approve

Moves a product from `review` to `approved`.

**`apps/catalog-bundle/src/agent-bundle.ts`** (add endpoint):

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/approve' })
async approveProduct(body: { entityId: string; reviewerId: string }): Promise<{ status: string }> {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  assertTransition(data.reviewStatus, 'approved');

  await this.entity_factory.update_entity_data(body.entityId, {
    ...data,
    reviewStatus: 'approved',
    reviewedBy: body.reviewerId,
    reviewedAt: new Date().toISOString(),
  });

  return { status: 'approved' };
}
```

### Reject

Moves a product from `review` back to `draft` with a reason.

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/reject' })
async rejectProduct(
  body: { entityId: string; reviewerId: string; reason: string }
): Promise<{ status: string }> {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  assertTransition(data.reviewStatus, 'draft');

  await this.entity_factory.update_entity_data(body.entityId, {
    ...data,
    reviewStatus: 'draft',
    reviewedBy: body.reviewerId,
    reviewedAt: new Date().toISOString(),
    rejectionReason: body.reason,
  });

  return { status: 'draft' };
}
```

### Edit and Re-Validate

This is the most interesting action. When a reviewer edits a field, the edited data goes back through the full validation pipeline. The same decorators that processed the original submission process the edit. This means:

- An edited `product_name` gets re-matched against the catalog
- An edited `price` triggers margin recalculation and business rule checks
- An edited `category` gets re-mapped through the category normalizer

The result is a new validation trace and a new confidence score, which determines the new `reviewStatus`.

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/edit' })
async editProduct(
  body: { entityId: string; reviewerId: string; updates: Partial<ProductEntityData> }
): Promise<{ status: string; newReviewStatus: ReviewStatus }> {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  // Merge edits into the existing product data
  const editedData = { ...data, ...body.updates };

  // Re-validate through the full pipeline
  const revalidated = await validationFactory.create(
    getValidatorForSupplier(editedData.supplier_name),
    editedData,
    await buildCatalogContext()
  );
  const trace = validationFactory.getLastTrace();

  // Recompute confidence and review status
  const fieldConfidences = trace.getFieldConfidences();
  const overallConfidence = Math.min(...Object.values(fieldConfidences));
  const lowConfidenceFields = Object.entries(fieldConfidences)
    .filter(([_, confidence]) => confidence < 0.8)
    .map(([field]) => field);
  const newReviewStatus = determineReviewStatus(overallConfidence, trace);

  // Update the entity with revalidated data
  await this.entity_factory.update_entity_data(body.entityId, {
    ...revalidated,
    reviewStatus: newReviewStatus,
    reviewAssignedAt: new Date().toISOString(),
    reviewedBy: body.reviewerId,
    overallConfidence,
    lowConfidenceFields,
    rejectionReason: undefined,  // clear any previous rejection
  });

  return { status: 'updated', newReviewStatus };
}
```

### Why Re-Validate on Edit

The alternative is to accept edits at face value and skip validation. This creates two paths through your system: the automated path (validated) and the manual path (unvalidated). Now you have two classes of data with different guarantees, and every downstream consumer needs to handle both.

Re-validation through the same pipeline means every product in the `approved` state has the same guarantees, regardless of whether it was auto-approved or manually edited. One path, one set of guarantees.

---

## Step 5: Build the Review Queue GUI

Add a new page to the catalog GUI that shows products waiting for review.

### API Route

First, add a server-side API route that fetches products by review status.

**`apps/catalog-gui/src/app/api/review/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://catalog-bundle-agent-bundle:3000';

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status') || 'review';
  const sortBy = request.nextUrl.searchParams.get('sortBy') || 'confidence';

  const response = await fetch(
    `${BUNDLE_URL}/api/products?reviewStatus=${status}&sortBy=${sortBy}`
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: 'Failed to fetch review queue' },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
```

### Review Queue Page

**`apps/catalog-gui/src/app/review/page.tsx`**:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ProductEntityData, ReviewStatus } from '@catalog-intake/shared-types';

type SortField = 'confidence' | 'supplier' | 'date';

export default function ReviewQueuePage() {
  const [products, setProducts] = useState<ProductEntityData[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReviewStatus>('review');
  const [sortBy, setSortBy] = useState<SortField>('confidence');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/review?status=${statusFilter}&sortBy=${sortBy}`)
      .then(res => res.json())
      .then(data => {
        setProducts(data.products || []);
        setLoading(false);
      });
  }, [statusFilter, sortBy]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Review Queue</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ReviewStatus)}
            className="border rounded px-3 py-2"
          >
            <option value="review">Needs Review</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="imported">Imported</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Sort By</label>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortField)}
            className="border rounded px-3 py-2"
          >
            <option value="confidence">Confidence (low first)</option>
            <option value="supplier">Supplier</option>
            <option value="date">Date</option>
          </select>
        </div>
      </div>

      {/* Product list */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products in "{statusFilter}" state.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 px-3">Product</th>
              <th className="py-2 px-3">Supplier</th>
              <th className="py-2 px-3">Confidence</th>
              <th className="py-2 px-3">Flagged Fields</th>
              <th className="py-2 px-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map(product => (
              <tr key={product.entity_id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3">{product.product_name}</td>
                <td className="py-2 px-3">{product.supplier_name}</td>
                <td className="py-2 px-3">
                  <ConfidenceBadge value={product.overallConfidence} />
                </td>
                <td className="py-2 px-3">
                  {product.lowConfidenceFields.length > 0 ? (
                    <span className="text-amber-600 text-sm">
                      {product.lowConfidenceFields.join(', ')}
                    </span>
                  ) : (
                    <span className="text-green-600 text-sm">None</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <Link
                    href={`/review/${product.entity_id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.9 ? 'bg-green-100 text-green-800' :
    value >= 0.6 ? 'bg-amber-100 text-amber-800' :
    'bg-red-100 text-red-800';

  return (
    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}
```

### What the Queue Shows

Each row displays the information a reviewer needs to decide whether to open the detail page:

| Column | Source | Why |
|--------|--------|-----|
| Product | `product_name` | The product being reviewed. |
| Supplier | `supplier_name` | Different suppliers have different data quality patterns. Reviewers learn which suppliers need more scrutiny. |
| Confidence | `overallConfidence` | Color-coded badge. Red (< 60%) = high risk. Amber (60-89%) = needs attention. Green (90%+) = probably fine. |
| Flagged Fields | `lowConfidenceFields` | Tells the reviewer exactly which fields to focus on. "category, product_name" means the reviewer should verify the category mapping and catalog match. |

Sorting by confidence (low first) puts the riskiest products at the top of the queue. Reviewers work through the list from top to bottom, spending their time where it matters most.

---

## Step 6: Build the Review Detail Page

When a reviewer clicks "Review" on a product, they see the full product with all fields, inline editing, and approve/reject buttons.

### API Routes for Actions

**`apps/catalog-gui/src/app/api/review/[id]/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://catalog-bundle-agent-bundle:3000';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const response = await fetch(`${BUNDLE_URL}/api/products/${params.id}`);
  if (!response.ok) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  return NextResponse.json(await response.json());
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { action, ...rest } = body;

  const endpoints: Record<string, string> = {
    approve: `${BUNDLE_URL}/api/review/approve`,
    reject: `${BUNDLE_URL}/api/review/reject`,
    edit: `${BUNDLE_URL}/api/review/edit`,
  };

  const url = endpoints[action];
  if (!url) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityId: params.id, ...rest }),
  });

  if (!response.ok) {
    const error = await response.json();
    return NextResponse.json(error, { status: response.status });
  }

  return NextResponse.json(await response.json());
}
```

### Review Detail Page

**`apps/catalog-gui/src/app/review/[id]/page.tsx`**:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProductEntityData } from '@catalog-intake/shared-types';

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<ProductEntityData | null>(null);
  const [editedFields, setEditedFields] = useState<Partial<ProductEntityData>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/review/${id}`)
      .then(res => res.json())
      .then(data => setProduct(data));
  }, [id]);

  if (!product) return <p className="p-6">Loading...</p>;

  const handleApprove = async () => {
    setSaving(true);
    await fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reviewerId: 'current-user' }),
    });
    router.push('/review');
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) return;
    setSaving(true);
    await fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject',
        reviewerId: 'current-user',
        reason: rejectionReason,
      }),
    });
    router.push('/review');
  };

  const handleFieldSave = async (field: string, value: string | number) => {
    setSaving(true);
    const response = await fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'edit',
        reviewerId: 'current-user',
        updates: { [field]: value },
      }),
    });
    const result = await response.json();

    // Reload the product to show revalidated data
    const updated = await fetch(`/api/review/${id}`).then(r => r.json());
    setProduct(updated);
    setEditingField(null);
    setEditedFields({});
    setSaving(false);
  };

  const reviewableFields = [
    { key: 'product_name', label: 'Product Name', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'price', label: 'Price', type: 'number' },
    { key: 'cost', label: 'Cost', type: 'number' },
    { key: 'margin', label: 'Margin', type: 'number' },
  ] as const;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{product.product_name}</h1>
        <span className={`px-3 py-1 rounded text-sm font-medium ${
          product.reviewStatus === 'review' ? 'bg-amber-100 text-amber-800' :
          product.reviewStatus === 'draft' ? 'bg-gray-100 text-gray-800' :
          product.reviewStatus === 'approved' ? 'bg-green-100 text-green-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          {product.reviewStatus}
        </span>
      </div>

      {/* Rejection reason banner */}
      {product.rejectionReason && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-6">
          <p className="text-sm text-red-800">
            <strong>Rejected:</strong> {product.rejectionReason}
          </p>
        </div>
      )}

      {/* Product fields with inline editing */}
      <div className="bg-white border rounded-lg divide-y">
        {reviewableFields.map(({ key, label, type }) => {
          const isLowConfidence = product.lowConfidenceFields.includes(key);
          const isEditing = editingField === key;
          const value = (editedFields[key] ?? product[key]) as string | number;

          return (
            <div key={key} className="flex items-center px-4 py-3">
              <div className="w-1/4">
                <span className="text-sm font-medium text-gray-700">{label}</span>
                {isLowConfidence && (
                  <span className="ml-2 text-xs text-amber-600">(low confidence)</span>
                )}
              </div>
              <div className="w-3/4">
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      type={type}
                      defaultValue={value}
                      autoFocus
                      className="border rounded px-2 py-1 flex-1"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = type === 'number'
                            ? parseFloat(e.currentTarget.value)
                            : e.currentTarget.value;
                          handleFieldSave(key, val);
                        }
                        if (e.key === 'Escape') {
                          setEditingField(null);
                        }
                      }}
                    />
                    <button
                      onClick={() => setEditingField(null)}
                      className="text-sm text-gray-500"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span
                    onClick={() => setEditingField(key)}
                    className={`cursor-pointer hover:bg-gray-100 px-2 py-1 rounded ${
                      isLowConfidence ? 'border-l-2 border-amber-400 pl-3' : ''
                    }`}
                  >
                    {type === 'number' && key === 'margin'
                      ? `${(value as number * 100).toFixed(1)}%`
                      : String(value)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Supplier and confidence info */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded p-4">
          <p className="text-sm text-gray-600">Supplier</p>
          <p className="font-medium">{product.supplier_name}</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-sm text-gray-600">Overall Confidence</p>
          <p className="font-medium">{Math.round(product.overallConfidence * 100)}%</p>
        </div>
      </div>

      {/* Audit trail */}
      {product.reviewedBy && (
        <div className="mt-6 bg-gray-50 rounded p-4">
          <p className="text-sm text-gray-600">Last reviewed by</p>
          <p className="text-sm">
            {product.reviewedBy} on{' '}
            {product.reviewedAt
              ? new Date(product.reviewedAt).toLocaleString()
              : 'unknown'}
          </p>
        </div>
      )}

      {/* Action buttons */}
      {product.reviewStatus === 'review' && (
        <div className="mt-6 flex gap-4">
          <button
            onClick={handleApprove}
            disabled={saving}
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRejectDialog(true)}
            disabled={saving}
            className="bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      {/* Reject dialog */}
      {showRejectDialog && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded p-4">
          <label className="block text-sm font-medium mb-2">Rejection Reason</label>
          <textarea
            value={rejectionReason}
            onChange={e => setRejectionReason(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-3"
            rows={3}
            placeholder="Explain why this product is being sent back to draft..."
          />
          <div className="flex gap-2">
            <button
              onClick={handleReject}
              disabled={saving || !rejectionReason.trim()}
              className="bg-red-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              Confirm Rejection
            </button>
            <button
              onClick={() => setShowRejectDialog(false)}
              className="text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Inline Editing Flow

When a reviewer clicks a field value:

1. The field switches to an input element (text or number based on the field type).
2. The reviewer types a new value and presses Enter.
3. `handleFieldSave` sends the edit to the bundle's `/review/edit` endpoint.
4. The bundle merges the edit into the existing data and re-runs the validation pipeline.
5. The response includes the new `reviewStatus` (which may change -- an edited product with all high-confidence fields might move from `review` to `approved`).
6. The page reloads the product to show the revalidated data, updated confidence, and new state.

Pressing Escape cancels the edit. Only one field can be edited at a time -- this keeps the re-validation requests sequential and predictable.

### Why Low-Confidence Fields Get Visual Treatment

Fields in `lowConfidenceFields` get two visual cues:
- A "(low confidence)" label next to the field name
- An amber left border on the value

This draws the reviewer's eye to the fields that actually need attention. A product with 15 fields but only 2 low-confidence ones should take 30 seconds to review, not 5 minutes. The visual treatment says "look here, skip the rest."

---

## Step 7: Import Flow

Once a product is approved, it can be "imported" -- written to the final products table as a permanent catalog record.

### Import Endpoint

**`apps/catalog-bundle/src/agent-bundle.ts`** (add endpoint):

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/import' })
async importProduct(
  body: { entityId: string; importedBy: string }
): Promise<{ status: string; catalogId: string }> {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  assertTransition(data.reviewStatus, 'imported');

  // Write to the final catalog via DAS
  const catalogRecord = await this.das_client.write({
    collection: 'products',
    data: {
      product_name: data.product_name,
      category: data.category,
      price: data.price,
      cost: data.cost,
      margin: data.margin,
      supplier_name: data.supplier_name,
      variants: data.variants || [],
      source_entity_id: body.entityId,
      imported_at: new Date().toISOString(),
      imported_by: body.importedBy,
    },
  });

  // Update entity state to imported
  await this.entity_factory.update_entity_data(body.entityId, {
    ...data,
    reviewStatus: 'imported',
    importedAt: new Date().toISOString(),
  });

  return { status: 'imported', catalogId: catalogRecord.id };
}
```

### What Gets Written

The DAS write creates a record in the `products` collection with:

| Field | Source | Purpose |
|-------|--------|---------|
| `product_name`, `category`, `price`, `cost`, `margin` | Validated entity data | The actual product information. |
| `variants` | Validated entity data | Nested variant data from Part 7. |
| `supplier_name` | Entity data | Provenance -- which supplier submitted this product. |
| `source_entity_id` | Import request | Links back to the intake entity. Full audit trail from raw submission through validation to final catalog record. |
| `imported_at`, `imported_by` | Import metadata | When and who imported the product. |

The `source_entity_id` is important. If a catalog record looks wrong six months later, you can trace it back to the entity, see the validation trace, see who approved it, and see exactly what the raw supplier data looked like. The entity graph is your audit trail.

### Bulk Import

For convenience, add a bulk import endpoint that imports all approved products:

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/import-all' })
async importAllApproved(
  body: { importedBy: string }
): Promise<{ imported: number; errors: string[] }> {
  const approved = await this.entity_factory.query_entities({
    specific_type: 'CatalogProductEntity',
    data_filter: { reviewStatus: 'approved' },
  });

  let imported = 0;
  const errors: string[] = [];

  for (const entity of approved) {
    try {
      await this.importProduct({
        entityId: entity.id!,
        importedBy: body.importedBy,
      });
      imported++;
    } catch (err) {
      errors.push(`${entity.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported, errors };
}
```

### Add Import Button to the Review Detail Page

In the review detail page, add an import button that appears when a product is in the `approved` state:

```tsx
{product.reviewStatus === 'approved' && (
  <div className="mt-6">
    <button
      onClick={async () => {
        setSaving(true);
        await fetch(`/api/review/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'import',
            importedBy: 'current-user',
          }),
        });
        router.push('/review');
      }}
      disabled={saving}
      className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
    >
      Import to Catalog
    </button>
  </div>
)}
```

---

## The Full Review Pipeline

Here is how the pieces fit together end-to-end:

```
Supplier submits product
       |
       v
  Validation Pipeline (Parts 1-7)
  - Normalize, route, match, validate
  - Produce validation trace with per-field confidence
       |
       v
  Bot assigns reviewStatus
  - overallConfidence >= 0.9 -> "approved" (auto)
  - overallConfidence 0.6-0.89 -> "review"
  - overallConfidence < 0.6 or errors -> "draft"
       |
       +-------> "approved" (auto) -----> Import to catalog
       |
       +-------> "review" -----> Review Queue GUI
       |                            |
       |                   Reviewer picks product
       |                            |
       |              +-------- Review Detail Page --------+
       |              |             |                      |
       |           Approve       Edit field             Reject
       |              |             |                      |
       |              v        Re-validate             Back to
       |          "approved"   through pipeline         "draft"
       |              |             |                  (with reason)
       |              v        New confidence              |
       |         Import to     -> new state                v
       |          catalog          |                   Fix + resubmit
       |                           v
       +-------> "draft" -----> Correct data, resubmit
```

Every product follows this flow. The validation pipeline is the single source of truth for data quality. The review workflow adds a human checkpoint for uncertain data. The state machine enforces valid transitions. The entity graph records every step.

---

## Key Takeaways

1. **Entity state management is a property, not a framework.** A `reviewStatus` string field and a transition validation function give you a state machine. You do not need a state machine library.

2. **Confidence scores drive routing, not binary pass/fail.** The validation pipeline already computes confidence. Using those scores to route products to `draft`, `review`, or `approved` turns the review queue into a priority-sorted list of edge cases instead of a firehose of everything.

3. **Re-validation on edit gives you one path, one set of guarantees.** Edited data goes through the same decorator pipeline as the original submission. Whether a product was auto-approved or manually edited, it has the same validation guarantees.

4. **Visual treatment focuses reviewer attention.** Color-coded confidence badges and amber borders on low-confidence fields mean reviewers spend 30 seconds on a product instead of 5 minutes. The system tells them where to look.

5. **The entity graph is your audit trail.** `source_entity_id` links the final catalog record back to the intake entity. You can trace any product from catalog to validation trace to raw supplier data.

---

## What's Next

Your pipeline handles structured data from three suppliers with human review. But Supplier D just joined -- and they send free-text product descriptions, not structured JSON. In [Part 9: AI-Powered Extraction](./part-09-ai-extraction.md), you'll add `@AIExtract` and `@AIClassify` decorators to handle unstructured data, extracting typed product fields from paragraphs of text.

---

**Previous:** [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md) | **Next:** [Part 9: AI-Powered Extraction](./part-09-ai-extraction.md)
