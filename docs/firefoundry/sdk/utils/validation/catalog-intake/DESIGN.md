# Catalog Intake — Architecture & Design

This document describes the architecture, data model, and tutorial progression for the FireKicks Catalog Intake demo application.

---

## 1. Problem Statement

FireKicks sources products from dozens of suppliers, each with their own data format. A single product — say a "Nike Air Max 90" — might arrive as:

- **Supplier A (CSV):** `PRODUCT_NAME,CATEGORY,PRICE` → `"nike air max 90","RUNNING","89.99"`
- **Supplier B (JSON):** `{ "productInfo": { "name": "Nike Air Max 90", "category": "Running" }, "pricing": { "retail": 89.99 } }`
- **Supplier C (spreadsheet):** `Product: Nke Air Max 90 | Cat: runing | Price: 89.99 USD`

Before any of this data can enter the FireKicks product catalog, it must be:

1. **Parsed** — extract values from nested structures, currency strings, and inconsistent field names
2. **Normalized** — trim whitespace, fix casing, coerce types
3. **Validated** — enforce business rules (positive prices, required fields, valid categories)
4. **Matched** — resolve fuzzy product names and categories against the existing catalog
5. **Reviewed** — surface ambiguities for human review before final approval

This makes catalog intake an ideal showcase for the validation library: every feature — from basic `@CoerceTrim` to AI-powered `@AIExtract` — has a natural, motivated use case.

---

## 1b. Canonical Supplier Payloads

The tutorial uses these canonical payload shapes for each supplier format. All parts reference these structures.

**Supplier A** (`schema_a` / `flat_json_snake`):

```json
{
  "product_name": "Nike Air Max 90",
  "category": "running",
  "subcategory": "road running",
  "brand_line": "nike air",
  "base_cost": 45.50,
  "msrp": 89.99,
  "color_variant": "white/black",
  "size_range": "7-13"
}
```

**Supplier B** (`schema_b` / `nested_json_camel`):

```json
{
  "productInfo": {
    "name": "Nike Air Max 90",
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

**Supplier C** (`schema_c` / `flat_json_caps`):

```json
{
  "PRODUCT_NAME": "NIKE AIR MAX 90",
  "CATEGORY": "RUNNING",
  "SUBCATEGORY": "ROAD RUNNING",
  "BRAND": "NIKE AIR LINE",
  "BASE_COST": "$45.50",
  "MSRP": "$89.99",
  "COLOR": "WHT/BLK",
  "SIZES": "7-13"
}
```

**Supplier D** (`schema_d` / `free_text`):

```json
{
  "description": "Nike Air Max 90 in White/Black. Road running shoe from the Nike Air line. Wholesale $45.50, retail $89.99. Sizes 7-13."
}
```

---

## 2. Schema Diagram

Five new tables extend the existing FireKicks schema. All foreign keys reference existing FireKicks tables (`products`, `brands`, `categories`).

```
┌─────────────────────────┐
│   product_suppliers     │
├─────────────────────────┤
│ supplier_id       (PK)  │
│ supplier_name           │
│ supplier_code           │
│ contact_email           │
│ schema_format           │  ── 'schema_a' (flat_json_snake) | 'schema_b' (nested_json_camel) | 'schema_c' (flat_json_caps) | 'schema_d' (free_text)
│ is_active               │
│ created_at              │
│ updated_at              │
└────────┬────────────────┘
         │ 1
         │
         │ N
┌────────┴────────────────┐
│  supplier_submissions   │
├─────────────────────────┤
│ submission_id     (PK)  │
│ supplier_id       (FK)  │ ──→ product_suppliers
│ submitted_at            │
│ raw_payload      (JSON) │  ── the original supplier data, untouched
│ status                  │  ── 'pending' | 'processing' | 'validated' | 'failed'
│ error_summary           │
│ record_count            │
└────────┬────────────────┘
         │ 1
         │
         │ N
┌────────┴────────────────┐       ┌──────────────────────────────┐
│ supplier_product_drafts │       │  supplier_validation_runs    │
├─────────────────────────┤       ├──────────────────────────────┤
│ draft_id          (PK)  │       │ run_id               (PK)   │
│ submission_id     (FK)  │ ──→   │ draft_id             (FK)   │ ──→ supplier_product_drafts
│ product_name            │       │ run_number                   │
│ category                │       │ started_at                   │
│ subcategory             │       │ completed_at                 │
│ brand_line              │       │ engine                       │ ── 'single-pass' | 'convergent'
│ sku                     │       │ status                       │ ── 'success' | 'partial' | 'failed'
│ base_cost               │       │ coercions_applied     (JSON) │
│ msrp                    │       │ validations_passed    (JSON) │
│ size_range              │       │ validations_failed    (JSON) │
│ color_variant           │       │ ai_transforms_used    (JSON) │
│ material                │       │ error_details         (JSON) │
│ description             │       └──────────────────────────────┘
│ review_status           │  ── 'draft' | 'review' | 'approved' | 'rejected'
│ matched_product_id (FK) │  ──→ products (existing FireKicks table)
│ matched_brand_id   (FK) │  ──→ brands (existing FireKicks table)
│ matched_category_id(FK) │  ──→ categories (existing FireKicks table)
│ confidence_score        │
│ created_at              │
│ updated_at              │
└─────────┬───────────────┘
          │ 1
          │
          │ N
┌─────────┴───────────────┐
│ supplier_product_variants│
├─────────────────────────┤
│ variant_id        (PK)  │
│ draft_id          (FK)  │ ──→ supplier_product_drafts
│ size                    │
│ color                   │
│ sku_suffix              │
│ additional_price        │
│ stock_quantity          │
│ created_at              │
└─────────────────────────┘
```

---

## 3. Data Flow

```
Supplier Payload                  FireKicks Catalog
(CSV / JSON / XML)                (products, brands, categories)
        │                                    │
        ▼                                    │
┌───────────────┐                            │
│  Raw Ingest   │  Store raw_payload         │
│  (submission) │  in supplier_submissions   │
└───────┬───────┘                            │
        │                                    │
        ▼                                    │
┌───────────────┐                            │
│  Validation   │  Run decorator pipeline    │
│   Engine      │  per record:               │
│               │  1. Parse (@CoerceParse)   │
│               │  2. Reparent (@DerivedFrom)│
│               │  3. Coerce (@CoerceTrim,   │
│               │     @CoerceCase, etc.)     │
│               │  4. Validate (@Validate*,  │
│               │     @ObjectRule)           │
│               │  5. Match (@CoerceFromSet) │
│               │  6. AI (@AIExtract, etc.)  │
└───────┬───────┘                            │
        │                                    │
        ▼                                    │
┌───────────────┐  Log each run in           │
│  Validation   │  supplier_validation_runs  │
│   Runs        │  (coercions, passes,       │
│               │   failures, AI calls)      │
└───────┬───────┘                            │
        │                                    │
        ▼                                    │
┌───────────────┐                            │
│  Draft        │  Create/update             │
│  Records      │  supplier_product_drafts   │
│               │  with cleaned data         │
└───────┬───────┘                            │
        │                                    │
        ▼                                    │
┌───────────────┐                            │
│  Human        │  Review ambiguous matches, │
│  Review       │  low-confidence scores,    │
│  (GUI)        │  validation warnings       │
└───────┬───────┘                            │
        │                                    │
        ▼                                    ▼
┌───────────────────────────────────────────────┐
│  Approved → Insert into products table        │
│  (matched_product_id links draft to catalog)  │
└───────────────────────────────────────────────┘
```

---

## 4. Tutorial Progression Map

Each tutorial part adds new decorator capabilities to the `SupplierProductDraft` validator class. The table below shows what each part introduces and which fields are affected.

| Part | Validator Version | New Decorators | Fields Affected | What Changes |
|------|-------------------|----------------|-----------------|--------------|
| 1 | `SupplierProductDraftV1` | `@ValidateRequired`, `@CoerceTrim`, `@CoerceCase`, `@CoerceType`, `@ValidateRange` | product_name, category, subcategory, brand_line, base_cost, msrp | Basic cleanup: trim, case-normalize, type-coerce prices |
| 2 | `SupplierProductDraftV2` | `@CoerceParse`, `@Copy`, `@Staging`, `@DerivedFrom`, `@ValidatePattern` | sku, size_range, color_variant, all price fields | Parse currency strings, extract from nested supplier payloads via JSONPath |
| 3 | `SupplierProductDraftV3` | `@DiscriminatedUnion`, `@Discriminator` | (class-level) | Route different supplier schemas to format-specific validator classes |
| 4 | `SupplierProductDraftV4` | `@ValidatedClass`, `@ValidatedClassArray`, `@CollectProperties` | variants (nested), material, description | Validate nested variant arrays, collect unmapped metadata |
| 5 | `SupplierProductDraftV5` | `@CoerceFromSet` (fuzzy + context) | category, subcategory, brand_line, color_variant | Fuzzy-match supplier values against the FireKicks catalog |
| 6 | `SupplierProductDraftV6` | `@If`/`@ElseIf`/`@Else`/`@EndIf`, `@ObjectRule`, `@CrossValidate` | base_cost vs msrp, size_range by category | Conditional validation: prices must be consistent, size formats depend on category |
| 7 | `SupplierProductDraftV7` | `@UseStyle`, `@DefaultTransforms`, `@ManageAll` | All string fields, all price fields | Extract repeated patterns into reusable styles, apply class-level defaults |
| 8 | `SupplierProductDraftV8` | `@UseSinglePassValidation`, `@UseConvergentValidation`, `@DependsOn` | (engine-level) | Explore engine tradeoffs, explicit dependency declaration |
| 9 | `SupplierProductDraftV9` | `@AIExtract`, `@AIClassify`, `@AIJSONRepair` | description, category (from free-text), malformed JSON payloads | AI-powered extraction from unstructured supplier notes |
| 10 | `SupplierProductDraftV10` | `@Catch`, `@AICatchRepair`, `@ValidateAsync` | All fields (error recovery), sku (async uniqueness check) | Graceful degradation, async validation against live services |

---

## 5. Application Architecture

The catalog intake application follows the standard FireFoundry three-layer architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    GUI (Next.js)                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Submission   │  │   Draft      │  │   Review     │  │
│  │  Upload       │  │   Browser    │  │   Queue      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ REST / WebSocket
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Bundle (FireFoundry Agent)                  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Intake Bot                                      │   │
│  │  - Receives supplier submissions                 │   │
│  │  - Runs validation pipeline (this tutorial!)     │   │
│  │  - Creates draft records                         │   │
│  │  - Triggers review workflows                     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Review Bot                                      │   │
│  │  - Surfaces ambiguous matches for human review   │   │
│  │  - Applies approved changes to drafts            │   │
│  │  - Promotes approved drafts to catalog           │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Validator Classes (Parts 1-10 of this tutorial) │   │
│  │  - SupplierProductDraftV1 through V10            │   │
│  │  - Supplier-specific discriminated unions        │   │
│  │  - Reusable validation styles                    │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │ DAS Queries
                         ▼
┌─────────────────────────────────────────────────────────┐
│                DAS (Data Access Service)                 │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  firekicks connection                            │   │
│  │  - products, brands, categories (existing)       │   │
│  │  - product_suppliers (new)                       │   │
│  │  - supplier_submissions (new)                    │   │
│  │  - supplier_product_drafts (new)                 │   │
│  │  - supplier_product_variants (new)               │   │
│  │  - supplier_validation_runs (new)                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Raw payload preservation:** The original supplier data is stored verbatim in `supplier_submissions.raw_payload`. The validation pipeline never mutates the source — it reads from raw and writes to drafts.
- **Validation run logging:** Every run of the validation engine is recorded in `supplier_validation_runs`, including which coercions fired, which validations passed or failed, and which AI transforms were invoked. This provides full auditability and is useful for debugging decorator pipelines.
- **Progressive enhancement:** The validator classes are versioned (V1 through V10) to match the tutorial progression. In production, you would use the latest version. The tutorial versions are preserved so readers can see each incremental addition.
- **Review workflow:** Low-confidence fuzzy matches and validation warnings are surfaced in the GUI review queue. A human reviewer approves or rejects each draft before it enters the main catalog.
