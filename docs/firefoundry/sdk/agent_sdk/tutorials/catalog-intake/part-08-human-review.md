# Part 8: Human Review & Form Entry

High-confidence products should import automatically, but fuzzy matches need human eyes. A category match at 0.78 -- is "Trail Runner" really "Trail Running Shoes," or a completely different product? A margin of 80% -- premium shoe or data entry error? Your validation pipeline produces confidence scores for exactly this reason. Now you need to act on them.

In this part, you'll add the fourth intake pipeline (human form entry via the GUI), make the system idempotent through product ID normalization, and build an approval workflow that routes products to `draft`, `review`, or `approved` based on validation confidence.

**What you'll learn:**
- Treating the GUI form as a fourth intake source with its own workflow
- Using `@CoerceTrim` and `@CoerceCase` on identifiers for idempotency
- Routing products through a state machine based on confidence scores
- Building a review queue with inline editing and re-validation

**Starting point:** Completed code from [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md). You should have a working pipeline with cross-field rules and nested variants.

---

## The Fourth Pipeline: Human Entry

So far, products enter the system through three automated pipelines: API submissions, CSV uploads, and webhook pushes. Each one feeds raw supplier data into the validation pipeline. But there's a fourth source you've already built the infrastructure for -- the GUI intake form from Part 2.

The form is just another intake source. It produces a payload, that payload needs validation, and the validated result becomes an entity. The difference is that the human filling out the form is also the one who can fix errors immediately. That changes the workflow.

Create a `ManualEntryWorkflow` that handles form submissions:

```typescript
import { validationFactory } from '../validation.js';

@EntityMixin({
  specificType: 'ManualEntryWorkflow',
  generalType: 'SupplierProductDraft',
})
export class ManualEntryWorkflow extends RunnableEntity<any> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const rawPayload = dto.data?.raw_payload;

    if (!rawPayload) {
      throw new Error('No raw_payload found on entity data');
    }

    yield { type: 'PROGRESS', message: 'Validating form data...' };

    // Use the canonical discriminated union — auto-detects format
    const validated = await validationFactory.create(SupplierProductCanonical, rawPayload);

    await this.update_data({
      ...dto.data,
      source_type: 'manual',
      status: 'draft',
      validated_product: (validated as any).toJSON(),
      validation_trace: validationFactory.getLastTrace?.() ?? null,
    });

    yield { type: 'PROGRESS', message: 'Validation complete' };
    return validated;
  }
}
```

The workflow imports the shared `validationFactory` singleton rather than constructing a new `ValidationFactory` per request. This is the same factory instance every other pipeline uses, so configuration and caching stay consistent. The call to `validationFactory.create(SupplierProductCanonical, rawPayload)` runs the canonical discriminated union -- auto-detecting the payload format. Manual entry data gets the same `@CoerceTrim`, `@CoerceFromSet`, and `@ObjectRule` treatment as an API submission. No special path, no different guarantees.

After validation, `this.update_data(...)` persists the result onto the entity. The workflow sets `source_type: 'manual'` and `status: 'draft'` -- every manually entered product starts as a draft. The validated output and its trace are stored alongside the original data so the review queue can display both.

> **Extending with confidence-based routing:** The demo starts every manual entry as `draft`, but you could use the validation trace to route high-confidence entries directly to `review` or `approved`. Compute `validationFactory.getLastTrace().overallConfidence` and set `status` based on thresholds (e.g., > 0.95 for `approved`, > 0.7 for `review`). The Entity State Machine section below shows how.

> **Without the validation class:** You'd write separate validation logic for the form -- one set of checks in the API handler, another in the form submit handler. When you add a new business rule, you'd need to remember to add it in both places. With the shared validator, there's one definition of "valid."

---

## Product ID Normalization for Idempotency

Before adding review states, you need to solve a more fundamental problem. What happens when the same product is submitted twice?

Without normalization, these three submissions create three separate entities:

| Submission | product_id value | Result |
|-----------|-----------------|--------|
| API call | `"FK-BLZ-001"` | Entity A |
| CSV upload | `" fk-blz-001 "` | Entity B |
| Form entry | `"Fk-Blz-001"` | Entity C |

Three entities for the same product. Three entries in the review queue. Three potential catalog records. This is the idempotency problem -- the system can't tell that these are the same product because the identifiers differ in casing and whitespace.

The fix is two decorators on `product_id`:

```typescript
class SupplierProductCanonical {
  @Copy()
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  product_id: string;

  // ... other fields
}
```

Now all three inputs normalize to `"fk-blz-001"` before the entity is created. The workflow can look up existing entities by normalized product ID:

```typescript
// In the workflow, after validation:
const existingEntity = await this.entity_factory.find_by_data({
  specificType: 'SupplierProductDraft',
  query: { product_id: validated.product_id },
});

if (existingEntity) {
  // Update existing entity instead of creating a new one
  yield* this.update_entity(existingEntity.id, {
    ...validated,
    reviewStatus: determineReviewStatus(trace),
    lastUpdatedAt: new Date().toISOString(),
  });
} else {
  // Create new entity
  yield* this.create_entity({
    ...validated,
    reviewStatus: determineReviewStatus(trace),
    createdAt: new Date().toISOString(),
  });
}
```

This is why normalization belongs in the validation class, not in the workflow. If `@CoerceTrim` and `@CoerceCase` run on `product_id` during validation, then by the time the workflow does its lookup, the ID is already canonical. Every intake source -- API, CSV, webhook, form -- produces the same normalized ID for the same product. The entity graph becomes the single source of truth.

### Why Not Normalize at Query Time?

You could lowercase the ID only when querying. But then you'd need to remember to normalize everywhere you look up a product -- in the review queue, in the import flow, in the duplicate checker, in the API endpoint. Miss one spot and you get duplicates. Normalizing at write time means the data is canonical the moment it enters the system.

---

## Entity State Machine

Products move through states based on validation confidence and human decisions:

```
draft ──(edit + revalidate)──> review ──(approve)──> approved
  ^                              |
  └──────(reject with reason)────┘
```

| State | How You Get Here | What Happens Next |
|-------|-----------------|-------------------|
| `draft` | Validation errors, very low confidence (< 0.7), or rejected by reviewer | Fix the data and resubmit through the validation pipeline |
| `review` | Medium confidence (0.7 -- 0.95), or manual entry | Human reviews, then approves or rejects |
| `approved` | High confidence (> 0.95), or human approved | Ready for import to final catalog |

### Setting Status Based on Confidence

The workflow assigns the initial state using the validation trace's overall confidence. This is the decision point where the pipeline splits:

```typescript
function determineReviewStatus(trace: ValidationTrace): ReviewStatus {
  // Any validation errors -> draft, regardless of confidence
  if (trace.hasErrors()) {
    return 'draft';
  }

  const confidence = trace.overallConfidence;

  if (confidence > 0.95) {
    return 'approved';
  }
  if (confidence > 0.7) {
    return 'review';
  }
  return 'draft';
}
```

High-confidence products skip the review queue entirely. This matters at scale. If you're importing 10,000 products and 8,000 of them are clean API submissions with exact catalog matches, you don't want reviewers wading through 8,000 rubber-stamp approvals. They should see only the 2,000 that actually need attention.

The thresholds are tunable. After running the pipeline on real data, you'll adjust them. If the review queue is too long, raise the lower threshold. If bad products are getting auto-approved, lower the upper one. The validation trace gives you the data to make this decision.

### State Transition Validation

Enforce valid transitions with a simple lookup table:

```typescript
const VALID_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft:    ['review', 'approved'],
  review:   ['draft', 'approved'],
  approved: ['imported'],
  imported: [],  // terminal
};

export function assertTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid state transition: ${from} -> ${to}. ` +
      `Valid from "${from}": ${VALID_TRANSITIONS[from].join(', ') || 'none'}`
    );
  }
}
```

No state machine library needed. A record and a function. Products can't skip from `draft` to `imported` -- they must pass through `approved` first, either by human review or by editing and revalidating to high confidence.

---

## The Review Queue

The review queue is a GUI page showing products that need human attention. For each product, the reviewer sees:

- **Raw input vs validated output side-by-side.** What the supplier sent vs what the pipeline produced. This is where a reviewer spots that "Trail Runner" was matched to "Trail Running Shoes" and decides whether that's correct.
- **Confidence indicators per field.** Color-coded badges: green (> 0.9), amber (0.7 -- 0.9), red (< 0.7). The reviewer's eye goes straight to the amber and red fields.
- **Approve / Reject / Edit buttons.** Three actions, each with different consequences.

### Fetching the Queue

The bundle exposes products by review status. The GUI fetches and displays them sorted by confidence (lowest first), so the riskiest products are at the top:

```typescript
// Bundle endpoint
@ApiEndpoint({ method: 'GET', route: 'review/queue' })
async getReviewQueue(query: { status?: string; sortBy?: string }) {
  const status = query.status || 'review';
  const sortBy = query.sortBy || 'confidence';

  const products = await this.entity_factory.query_entities({
    specific_type: 'SupplierProductDraft',
    data_filter: { reviewStatus: status },
  });

  if (sortBy === 'confidence') {
    products.sort((a, b) => a.data.overallConfidence - b.data.overallConfidence);
  }

  return { products };
}
```

### What the Queue Shows

Each row gives the reviewer just enough context to decide whether to open the detail page:

| Column | Source | Purpose |
|--------|--------|---------|
| Product | `product_name` | What's being reviewed |
| Supplier | `supplier_name` | Different suppliers have different error patterns. Reviewers learn which ones need more scrutiny. |
| Confidence | `overallConfidence` | Color-coded badge. Lowest-confidence products sort to the top. |
| Flagged Fields | `lowConfidenceFields` | Tells the reviewer exactly where to look. "category, product_name" means verify the catalog match and the fuzzy name match. |

Sorting by confidence (low first) means reviewers spend their time on the cases that actually need attention, not rubber-stamping obvious matches.

### Approve and Reject

Approve moves a product from `review` to `approved`. Reject moves it back to `draft` with a reason:

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/approve' })
async approveProduct(body: { entityId: string; reviewerId: string }) {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  assertTransition(data.reviewStatus, 'approved');

  await this.entity_factory.update_entity_data(body.entityId, {
    ...data,
    reviewStatus: 'approved',
    reviewedBy: body.reviewerId,
    reviewedAt: new Date().toISOString(),
  });
}

@ApiEndpoint({ method: 'POST', route: 'review/reject' })
async rejectProduct(body: { entityId: string; reviewerId: string; reason: string }) {
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
}
```

The `assertTransition` call prevents invalid state changes. You can't approve a product that's already imported, and you can't reject a product that's in draft. The state machine enforces the rules; the endpoint just calls through.

---

## Inline Editing with Re-Validation

This is the most interesting part of the review workflow. When a reviewer clicks a field in the review detail page, it becomes editable. They fix the value, press Enter, and the edited data goes back through the full validation pipeline.

The same decorators that processed the original submission process the edit:

- An edited `product_name` gets re-matched against the catalog via `@CoerceFromSet`
- An edited `price` triggers margin recalculation via `@DerivedFrom` and business rule checks via `@ObjectRule`
- An edited `category` gets re-mapped through the category normalizer and conditional size validation via `@If`

```typescript
@ApiEndpoint({ method: 'POST', route: 'review/edit' })
async editProduct(
  body: { entityId: string; reviewerId: string; updates: Partial<ProductEntityData> }
) {
  const entity = await this.entity_factory.get_entity_node(body.entityId);
  const data = entity.data as ProductEntityData;

  // Merge edits into existing data
  const editedData = { ...data, ...body.updates };

  // Re-validate through the full pipeline
  const factory = new ValidationFactory();
  const revalidated = await factory.create(
    SupplierProductCanonical,
    editedData,
    { context: await loadCatalogContext() }
  );
  const trace = factory.getLastTrace();

  // Recompute confidence and review status from fresh trace
  const newStatus = determineReviewStatus(trace);

  await this.entity_factory.update_entity_data(body.entityId, {
    ...revalidated,
    reviewStatus: newStatus,
    reviewedBy: body.reviewerId,
    overallConfidence: trace.overallConfidence,
    lowConfidenceFields: trace.getLowConfidenceFields(0.8),
    rejectionReason: undefined,  // clear previous rejection
  });

  return { newReviewStatus: newStatus };
}
```

The result is a new validation trace and a new confidence score, which determines the new `reviewStatus`. An edited product might move from `review` to `approved` if the reviewer fixes all the low-confidence fields. Or it might stay in `review` if the edit introduces a new ambiguity.

### Why Re-Validate Instead of Accepting Edits at Face Value?

The alternative is to skip validation on human edits. This creates two paths through your system: the automated path (validated) and the manual path (unvalidated). Now you have two classes of data with different guarantees. Every downstream consumer needs to handle both.

Re-validation through the same pipeline means every product in the `approved` state has identical guarantees, regardless of whether it was auto-approved from an API submission or manually edited by a reviewer. One path, one set of guarantees, one definition of "valid."

### The Inline Editing Flow

When a reviewer clicks a field value in the detail page:

1. The display switches to an input element (text or number based on the field type).
2. The reviewer types a new value and presses Enter (Escape cancels).
3. The GUI sends the edit to the bundle's `/review/edit` endpoint.
4. The bundle merges the edit, re-runs the validation pipeline, recomputes confidence.
5. The response includes the new `reviewStatus` -- which may have changed.
6. The page reloads the product to show revalidated data, updated confidence, and the new state.

Only one field can be edited at a time. This keeps re-validation requests sequential and predictable. If you allowed batch edits, you'd need to decide which order to apply them in -- and the validation trace would be harder to interpret.

### Visual Treatment of Low-Confidence Fields

Fields in `lowConfidenceFields` get two visual cues in the review detail page:
- A "(low confidence)" label next to the field name
- An amber left border on the value

This draws the reviewer's eye to the fields that actually need attention. A product with 15 fields but only 2 low-confidence ones should take 30 seconds to review, not 5 minutes. The visual treatment says "look here, skip the rest."

---

## Putting It All Together

Here's how the four intake pipelines feed into the review workflow:

```
API submission ──┐
CSV upload ──────┤
Webhook push ────┤──> Validation Pipeline (same for all)
GUI form entry ──┘            |
                              v
                    Compute overallConfidence
                              |
              ┌───────────────┼───────────────┐
              v               v               v
          > 0.95          0.7 - 0.95        < 0.7
         "approved"       "review"          "draft"
              |               |               |
              v               v               v
         Auto-import    Review Queue     Fix & resubmit
                         |       |
                      Approve  Reject ──> back to "draft"
                         |
                         v
                     "approved"
                         |
                         v
                    Import to catalog
```

Every product follows this flow. The validation pipeline is the single source of truth for data quality. The review workflow adds a human checkpoint for uncertain data. The state machine enforces valid transitions. Product ID normalization ensures idempotency across all four intake sources. The entity graph records every step.

---

## Key Takeaways

1. **The GUI form is just another intake source.** It produces a payload that goes through the same validation pipeline as API, CSV, and webhook data. No special path means no divergent guarantees.

2. **Normalize identifiers at write time, not query time.** `@CoerceTrim` + `@CoerceCase('lower')` on `product_id` ensures that "FK-BLZ-001", " fk-blz-001 ", and "Fk-Blz-001" all resolve to the same entity. Miss this and you get duplicates.

3. **Confidence scores drive routing, not binary pass/fail.** The validation trace already computes per-field confidence. Using those scores to route products turns the review queue into a priority-sorted list of edge cases instead of a firehose.

4. **Re-validation on edit gives you one path.** Edited data goes through the same decorator pipeline as the original submission. Every `approved` product has the same validation guarantees.

5. **State transitions are a lookup table, not a framework.** A `Record<ReviewStatus, ReviewStatus[]>` and a validation function. That's the whole state machine.

---

## What's Next

In [Part 9: AI-Powered Extraction](./part-09-ai-extraction.md), we'll add the third supplier -- one that sends PDF catalogs instead of structured data. You'll use `@AIExtract` and `@AIClassify` decorators to pull typed product fields out of unstructured text.

---

**Previous:** [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md) | **Next:** [Part 9: AI-Powered Extraction](./part-09-ai-extraction.md)
