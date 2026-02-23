# Part 9: AI-Powered Extraction (PDF)

Supplier C doesn't send structured data -- they send a PDF catalog. Forty pages of product tables, lifestyle photos, and marketing copy. No `product_name` field. No `category` field. No JSON at all. Just a file.

In Parts 1 through 8, every supplier -- however messy their format -- sent something with identifiable fields. You could point `@Copy()` or `@DerivedFrom()` at a named path and get a value back. Even Supplier B's ALL_CAPS CSV had column headers you could map to. A PDF gives you nothing to point at.

Here's a page from Supplier C's catalog:

```
┌─────────────────────────────────────────────┐
│  FIREKICKS SPRING 2025 COLLECTION           │
│                                             │
│  Blaze Runner Pro                           │
│  Premium performance running shoe           │
│  Materials: Mesh upper, EVA midsole,        │
│  rubber outsole. Weight: 9.2 oz.            │
│                                             │
│  Wholesale: $95.00  |  MSRP: $189.99        │
│                                             │
│  SKU          Color       Size              │
│  FK-BLZ-BK10  Black      10                 │
│  FK-BLZ-BK11  Black      11                 │
│  FK-BLZ-WH10  White      10                 │
│  FK-BLZ-WH11  White      11                 │
│  ...                                        │
└─────────────────────────────────────────────┘
```

All the data is there. Product name, prices, materials, a full variant table with individual SKUs. But it's pixels on a page, not fields in a payload. You need AI to read the page and produce structured data before the validation pipeline can do anything.

This part introduces two fundamentally different ways AI fits into that process. Understanding the distinction is the most important concept in this tutorial.

---

## The Two AI Modalities

Before writing any code, understand this distinction. It shapes every design decision in this part and beyond.

> **AI as Generator**
>
> The LLM *creates* new structured data from unstructured input. A remote PDF extraction bot reads a catalog page and produces `{ product_name, category, base_cost, variants: [...] }`. The AI is the **source** of the data. Nothing structured existed before the AI ran.
>
> **AI as Transformer**
>
> The LLM *improves* existing structured data within the validation pipeline. `@AIClassify` takes a messy category string and maps it to the canonical taxonomy. `@AITransform` rewrites an ambiguous description into a clean one. The AI is a **tool** within the pipeline, not the source.
>
> **The key insight:** Both modalities go through the same validation gate. AI-generated data gets `@CoerceTrim`, `@ValidateRequired`, `@ValidateRange` -- the full decorator pipeline. AI-transformed data passes through `@CoerceFromSet` for exact matching. **The AI doesn't get a free pass.** Whether the LLM generated the data or transformed it, the validation pipeline is the quality gate.

Keep this distinction in mind as you work through the rest of the part.

---

## V3 Schema: The Richest Data

PDF extraction produces the most detailed data of any supplier. A catalog page has variant tables with colors, sizes, and individual SKUs. It has descriptions, materials, weights -- far more than Supplier A's flat JSON or Supplier B's CSV.

Define the V3 validation class to capture all of it:

```typescript
@Serializable()
export class SupplierVariant {
  @CoerceTrim()
  @ValidateRequired()
  color!: string;

  @ValidateRequired()
  sizes!: number[];

  @CoerceTrim()
  @CoerceCase('upper')
  @ValidateRequired()
  sku!: string;
}
```

```typescript
@Serializable()
export class SupplierProductV3 {
  @Discriminator('v3_pdf')
  supplier_schema!: string;

  // All the V1 + V2 fields
  @ValidateRequired()
  product_name!: string;

  @ValidateRequired()
  category!: string;

  @ValidateRange(0.01)
  base_cost!: number;

  @ValidateRange(0.01)
  msrp!: number;

  // PDF-specific richness
  description!: string;

  materials!: string[];

  weight_oz!: number;

  @ValidatedClassArray(SupplierVariant)
  variants!: SupplierVariant[];
}
```

The `variants` array is new. Previous suppliers sent a single `size_range` string like `"7-13"`. The PDF has a full table: Black / Size 10 / SKU FK-BLZ-BK10, White / Size 11 / SKU FK-BLZ-WH11, and so on. `@ValidatedClassArray` validates each variant through its own class -- the same pattern you'd use for any nested object.

Now update `SupplierProductCanonical` to include V3 in the discriminated union:

```typescript
@DiscriminatedUnion({
  discriminator: 'supplier_schema',
  map: {
    'v1_api': SupplierProductV1,
    'v2_csv': SupplierProductV2,
    'v3_pdf': SupplierProductV3,
  }
})
export class SupplierProductCanonical {
  @Copy()
  supplier_schema!: string;
}
```

Same pattern as Parts 3 and 4. The union routes by discriminator, V3 handles the rest.

One thing to note: the V3 class doesn't use `@DerivedFrom` or `@Copy` to pull fields from the raw input. It doesn't need to. The extraction bot already produces a clean JSON object with the right field names. The V3 class validates the shape and values of that object -- it doesn't need to navigate or transform the source structure. That's a direct consequence of the Generator modality: the AI already did the structural work.

---

## The PDF Extraction Workflow

Here's the fundamental difference from previous suppliers: you can't validate a PDF directly. There's no JSON payload to feed into `factory.create()`. You need a separate step that reads the PDF and produces structured data first.

That's the **AI as Generator** modality. A remote extraction bot -- a separate agent running an LLM with vision capabilities -- reads the PDF pages and outputs structured product records. Your workflow then validates those records through the same pipeline as any other supplier.

```typescript
export class PdfExtractionWorkflow extends Workflow {
  protected async *run_impl() {
    const dto = this.dto;
    const pdfBlob = dto.data.pdf_blob;

    // ------------------------------------------------------------------
    // AI as Generator: remote bot extracts structured data from PDF
    // ------------------------------------------------------------------
    // In production, this calls the remote extraction agent:
    // const result = await client.run_bot_with_blobs(
    //   'PdfExtractionBot',
    //   { catalog_id: dto.data.catalog_id },
    //   [pdfBlob]
    // );
    // const extracted = result.data.products;

    // For local dev, use mock extracted data:
    const extracted = dto.data.extracted_products;

    // ------------------------------------------------------------------
    // Validation as quality gate -- AI output through same pipeline
    // ------------------------------------------------------------------
    const validated = [];
    for (const product of extracted) {
      const result = await factory.create(SupplierProductV3, product);
      validated.push(result.toJSON());
    }

    // AI-extracted products default to 'review' -- they need human eyes
    await this.update_data({
      ...dto.data,
      validated_products: validated,
      status: 'review',
    });
  }
}
```

Three things to notice:

1. **The remote bot call is commented out.** In local development, you mock the extracted data. The `PdfExtractionBot` is a separate agent that runs in the cluster -- you don't need it running to develop the validation logic. Swap in the real call when you deploy.

2. **`factory.create(SupplierProductV3, product)` is the same call you've used since Part 1.** The AI-generated data goes through exactly the same validation pipeline as Supplier A's API payload or Supplier B's CSV row. Coercion, validation, range checks -- all of it.

3. **Status defaults to `'review'`.** AI-extracted products need human verification. The review workflow from Part 8 handles this. A human reviewer sees the extraction results, confirms or corrects them, and approves the product for import.

This is the Generator pattern in action: the AI creates the data, then the validation pipeline cleans, coerces, and validates it. The AI is the source, not the authority.

### What the Extraction Bot Returns

To make this concrete, here's what the mock data looks like. This is what `PdfExtractionBot` would return for the catalog page shown earlier:

```json
{
  "products": [
    {
      "supplier_schema": "v3_pdf",
      "product_name": "Blaze Runner Pro",
      "category": "men's performance running",
      "base_cost": 95.00,
      "msrp": 189.99,
      "description": "Premium performance running shoe with mesh upper...",
      "materials": ["mesh", "EVA", "rubber"],
      "weight_oz": 9.2,
      "variants": [
        { "color": "Black", "sizes": [10], "sku": "FK-BLZ-BK10" },
        { "color": "Black", "sizes": [11], "sku": "FK-BLZ-BK11" },
        { "color": "White", "sizes": [10], "sku": "FK-BLZ-WH10" },
        { "color": "White", "sizes": [11], "sku": "FK-BLZ-WH11" }
      ]
    }
  ],
  "confidence": {
    "product_name": 0.97,
    "category": 0.72,
    "base_cost": 0.95,
    "msrp": 0.95,
    "description": 0.88,
    "variants": 0.91
  }
}
```

Notice the `category` value: `"men's performance running"`. That's what the AI read from the PDF. It's descriptive and accurate, but it doesn't match any value in the canonical taxonomy. The validation pipeline will need to handle that -- and that's where the Transformer modality comes in.

Also notice the `confidence` object. The extraction bot reports how confident it is about each field. Category is low (0.72) because the PDF didn't have an explicit category label -- the bot inferred it from context. Product name is high (0.97) because it was a clear heading on the page. These scores drive the review workflow.

---

## @AITransform and @AIClassify: AI as Transformer

The other modality works inside the validation pipeline itself. Instead of generating data from scratch, it transforms existing data into a better form.

### @AIClassify

Say the PDF extraction bot returns `"men's performance running"` as the category. That's not in your canonical taxonomy. `@AIClassify` maps it to the closest match:

```typescript
@AIClassify({
  prompt: 'Classify this product into one of the canonical categories',
  allowedValues: ctx => ctx.categories,
})
category!: string;
```

The decorator sends the value to the LLM along with the list of allowed categories. The LLM picks the best match -- `"Running Shoes"` -- and the pipeline continues. If the LLM's pick doesn't exactly match the set (case difference, extra whitespace), the built-in `@CoerceFromSet` fuzzy matching cleans it up.

### @AITransform

For fields that need more than classification -- a rewrite, a cleanup, a format change -- use `@AITransform`:

```typescript
@AITransform({
  prompt: 'Rewrite this product description as a concise, factual summary. '
        + 'Remove marketing language. Keep materials, dimensions, and features.',
})
description!: string;
```

The LLM takes the raw extracted description (which might be three paragraphs of marketing copy from the PDF) and returns a clean, factual summary. The important thing is that `description` already has a value -- the extraction bot produced one. `@AITransform` makes it better.

You can stack these with other decorators. The AI transform runs, then `@CoerceTrim` strips whitespace, then `@ValidateRequired` confirms the result isn't empty. Same decorator chain as any other field.

### The Difference in Practice

Both `@AIClassify` and `@AITransform` take **existing data** and make it better. They don't create data from nothing. The PDF extraction bot already produced a `category` value and a `description` value. These decorators improve those values within the pipeline.

Compare that to the extraction workflow, where the LLM read raw PDF pixels and created structured fields that didn't exist before. That's the Generator modality.

| | AI as Generator | AI as Transformer |
|---|---|---|
| **Where** | Outside the validation pipeline (workflow) | Inside the validation pipeline (decorators) |
| **Input** | Unstructured (PDF, images, free text) | Structured but messy (extracted fields) |
| **Output** | New structured data | Improved structured data |
| **Example** | `PdfExtractionBot` reads a catalog page | `@AIClassify` maps a category to the taxonomy |
| **AI is the...** | Source | Tool |

Both go through the same validation gate afterward. That's the key insight.

---

## SDK Gap: Remote Bot Wrapper

> **Note:** The SDK will provide a `RemoteBotWrapper` pattern that encapsulates the remote bot call + local validation + retry-with-error-context into a reusable abstraction. When the extraction bot's output fails validation, the wrapper will automatically re-invoke the bot with the validation errors as additional context -- giving the LLM a chance to self-correct. For now, the workflow handles this manually. Watch the SDK changelog for this feature.

---

## GUI Updates

The review queue from Part 8 needs three additions for AI-extracted products.

### AI Extraction Panel

When a reviewer opens an AI-extracted product, show the extraction pipeline: raw PDF on the left, extraction results in the middle, validated output on the right. This lets the reviewer see what the AI saw and what it produced.

```tsx
// In the review detail page, add an extraction source panel:
{product.supplier_schema === 'v3_pdf' && (
  <AIExtractionPanel
    pdfBlobId={product.pdf_blob_id}
    rawExtraction={product.raw_extraction}
    validatedProduct={product}
  />
)}
```

The panel renders a three-column layout:

- **Left column:** The original PDF page, rendered as an image. The reviewer sees exactly what the AI saw.
- **Middle column:** The raw extraction output -- the JSON that `PdfExtractionBot` returned, with confidence scores per field.
- **Right column:** The validated output -- after `factory.create()` ran the decorators, coerced types, and classified categories.

Differences between the middle and right columns are highlighted. If `@AIClassify` changed `"men's performance running"` to `"Running Shoes"`, the reviewer sees both values with a visual diff. This makes it obvious what the validation pipeline changed versus what the AI originally produced.

### Confidence Scores

The extraction bot returns a confidence score per field. Display these inline so reviewers know which fields to scrutinize:

```tsx
{fieldConfidence < 0.8 && (
  <span className="text-xs text-amber-600 ml-2">
    Low confidence ({Math.round(fieldConfidence * 100)}%)
  </span>
)}
```

Fields below 80% confidence get an amber badge. This draws the reviewer's eye to the fields most likely to need correction -- a description the bot wasn't sure about, a price it guessed from context, a category it couldn't classify with certainty.

### Human Correction Interface

When a reviewer overrides an AI-extracted value, the correction runs back through the validation pipeline. This is the same re-validation flow from Part 8 -- the `handleFieldEdit` function submits the edited value through `factory.create()` and shows the updated validation trace.

The new piece is tracking overrides. When a human corrects an AI-extracted field, record both the original AI value and the human correction:

```typescript
// In the review submission handler:
const overrides = changedFields.map(field => ({
  field_name: field,
  ai_value: originalProduct[field],
  human_value: editedProduct[field],
  confidence: rawExtraction.confidence[field],
}));

await this.update_data({
  ...dto.data,
  human_overrides: overrides,
  status: 'approved',
});
```

This override log is valuable for two reasons. First, it gives you training data -- if humans consistently override the AI's category classification, the extraction bot's prompts need tuning. Second, it provides an audit trail showing exactly what the AI produced versus what a human approved.

---

## Putting It All Together

Here's the full flow for a Supplier C PDF:

1. **Ingest:** The workflow receives a PDF blob and a catalog ID.
2. **Extract (AI as Generator):** The remote `PdfExtractionBot` reads the PDF and returns an array of product objects with fields, variants, and confidence scores.
3. **Validate:** Each extracted product goes through `factory.create(SupplierProductV3, ...)`. The validation pipeline coerces types, trims strings, validates ranges -- same as any supplier.
4. **Transform (AI as Transformer):** Within the V3 class, `@AIClassify` maps categories to the taxonomy and `@AITransform` cleans up descriptions. These decorators improve the already-extracted data.
5. **Route to review:** All AI-extracted products default to `'review'` status. No auto-import.
6. **Human review:** A reviewer sees the extraction panel with confidence scores, corrects any errors, and approves.
7. **Import:** Approved products flow to the catalog via the same DAS write path as any other supplier.

The PDF never touches the validation pipeline directly. The extraction bot converts it to structured data, and from that point on it's just another supplier format flowing through the same infrastructure you built in Parts 1 through 8.

---

## What's Next

In [Part 10: Recovery & Production Hardening](./part-10-recovery-production.md), you'll add error recovery and production hardening -- `@Catch` for graceful degradation, `@AICatchRepair` for AI-powered repair suggestions, and patterns for making the entire pipeline resilient when real-world data inevitably breaks things.

---

**Previous:** [Part 8: Human Review Workflow](./part-08-human-review.md) | **Next:** [Part 10: Recovery & Production Hardening](./part-10-recovery-production.md)
