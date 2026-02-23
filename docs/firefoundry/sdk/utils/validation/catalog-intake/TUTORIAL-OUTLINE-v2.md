# Catalog Intake Tutorial — Restructured Outline (v2)

> **Audience:** Developer building their first FireFoundry agent bundle with a real GUI.
>
> **Strategy:** Onion — every part ends with a fully working app. GUI introduced in Part 2
> and iterated alongside the bundle from there.
>
> **Running theme:** Data classes > raw JSON. Every part reinforces why typed, validated
> class instances are better than casting `as SomeInterface`.

---

## Part 1: A Working Agent Bundle

**Goal:** Scaffold a complete agent bundle that ingests supplier data, validates it, and stores it in the entity graph. Fully deployed and testable by the end.

**What you build:**
- `CatalogIntakeBot` — accepts raw supplier JSON, validates, returns clean data
- `SupplierProductDraft` entity — stores validated product in the entity graph
- `SupplierProductValidator` (V1) — basic cleanup: `@CoerceTrim`, `@CoerceCase`, `@CoerceType`, `@ValidateRequired`, `@ValidateRange`
- Bundle entry point (`index.ts`) — wires bot + entity + validators

**Key concepts introduced:**
- Agent bundle anatomy: bots, entities, validators, entry point
- `ValidationFactory.create()` — the validation pipeline
- `BotRunnableEntityMixin` — the SDK's bot-entity wrapper (bot output → entity data, automatically)
- `@EntityDecorator({ dataClass })` — entity knows its data type
- `@Serializable` + `toJSON()`/`fromJSON()` — class instances survive the entity graph round-trip (SDK handles this natively, zero custom code)

**Compare & contrast (sidebar):**
> *Without data classes:* You'd `JSON.parse()` the supplier payload, cast it with `as SupplierProduct`, scatter validation logic across the bot handler, and hope nothing changed shape between write and read. When a field name changes or a new supplier format appears, everything breaks silently.
>
> *With data classes:* The validator is the single source of truth. The bot gets a typed class instance. The entity graph stores and reconstructs it automatically. A field rename is a decorator change, not a search-and-replace across the codebase.

**Test:** `ff-sdk-cli` end-to-end — POST raw data → bot validates → entity created → `get_dto()` returns typed instance.

---

## Part 2: The Catalog GUI

**Goal:** Add a Next.js frontend that shares type definitions with the agent bundle. Two pages: a **product intake form** and a **product database browser**.

**What you build:**
- Next.js app (`catalog-gui`) scaffolded with Tailwind
- **Intake form page** — human enters product data manually, submits to bot
- **Product browser page** — lists products from the entity graph, shows validated data
- Shared types: validation classes imported from a shared package, used in both bundle and GUI

**Key concepts introduced:**
- **Shared type package** — the validation class (e.g., `SupplierProductCanonical`) is the contract between agent bundle, frontend, and backend. One definition, three consumers.
- GUI ↔ bundle communication via bundle API endpoints
- Entity graph as the persistence layer — GUI reads what the bot wrote

**Why this matters:**
> The GUI isn't bolted on at the end. It's a first-class participant that shares the same data types as the agent. When the validator adds a field, the GUI gets it for free. When the GUI renders a product, it uses the same type the bot validated.

---

## Part 3: Multi-Supplier Routing

**Goal:** Handle three different supplier formats through a single intake pipeline. GUI shows which format was detected.

**What you build:**
- `@DiscriminatedUnion` with string discriminator (`supplier_schema` field)
- Three supplier-specific classes: `SupplierAProduct` (flat snake_case), `SupplierBProduct` (nested camelCase), `SupplierCProduct` (ALL_CAPS CSV-derived)
- `@DerivedFrom` — extract fields from nested JSON paths (Supplier B)
- `@CoerceParse('currency')` — parse `"$89.99"` → `89.99`

**GUI update:**
- Intake form gets a "supplier format" selector
- Product browser shows detected supplier format badge
- Side-by-side view: raw input → canonical output

**Key concepts introduced:**
- Discriminated unions for polymorphic validation
- `@Discriminator` — marks which subclass handles which format
- `@DerivedFrom('$.pricing.cost')` — JSONPath extraction from nested structures
- All three formats normalize to one canonical shape — downstream code doesn't care which supplier it came from

---

## Part 4: Schema Versioning & Auto-Detection

**Goal:** Evolve the data model without breaking existing records. Introduce lambda discriminators for format auto-detection.

**What you build:**
- Lambda discriminator variant (`SupplierProductAutoDetect`) — inspects data shape instead of requiring a `supplier_schema` field
- Two-phase lambda pattern: fast path (reads stored `supplier_schema` from serialized data) + detection path (structural inspection for fresh input)
- Schema version handling: old entities with v1 data coexist with v2 entities

**GUI update:**
- Intake form: auto-detect mode (no manual format selection needed)
- Product browser: version badge showing which schema version each product uses

**Key concepts introduced:**
- **Lambda discriminator** — `(data) => string` instead of a field name
- **Schema evolution** — old data keeps working because the lambda handles both old and new shapes. No migrations, no breaking changes.
- **Round-trip correctness** — `@Serializable` auto-includes `@Discriminator` values in `toJSON()`, lambda reads them back in `fromJSON()`. The class identity survives the entity graph.

**Compare & contrast (sidebar):**
> *Without discriminated unions:* Schema changes require database migrations, version-specific `if/else` branches scattered through the code, and careful coordination between every service that reads the data. A format change is a deployment risk.
>
> *With discriminated unions + lambda:* Add a new case to the lambda. Old data routes to old classes. New data routes to new classes. The validator is the migration layer. Zero downtime, zero data transformation.

---

## Part 5: The Validation Trace

**Goal:** Make the validation pipeline observable. Show exactly what happened to every field.

**What you build:**
- Validation trace capture — decorator execution order, before/after values per field
- `@Staging` — intermediate values needed during validation but excluded from final output
- Trace stored alongside the product entity

**GUI update:**
- **Trace viewer page** — expandable per-field trace showing each decorator's effect
- Visual diff: raw input value → coerced → validated → final

**Key concepts introduced:**
- `@Staging` properties — scaffolding for complex transformations, excluded from `toJSON()`
- Validation as an auditable process — every transformation is recorded
- Debugging DX: when a field value looks wrong, the trace shows exactly which decorator changed it and why

---

## Part 6: Catalog Matching & Context

**Goal:** Match messy supplier values against the real FireKicks product catalog using fuzzy matching.

**What you build:**
- `@CoerceFromSet` with fuzzy matching strategy and synonym maps
- `CatalogContext` — loads canonical categories, brands, etc. from DAS at validation time
- DAS integration: query the FireKicks database for lookup values
- Confidence scoring for fuzzy matches

**GUI update:**
- Product browser: match confidence indicators per field
- Ambiguity highlighting — "did you mean X or Y?"
- Intake form: autocomplete powered by the same catalog context

**Key concepts introduced:**
- **Runtime context injection** — validation isn't just static rules; it queries live data
- **Fuzzy matching** — Levenshtein distance, synonym maps, configurable thresholds
- **DAS (Data Access Service)** — the agent bundle's gateway to the database

---

## Part 7: Business Rules & Nested Variants

**Goal:** Enforce business invariants (margins, category-specific rules) and handle product variants (sizes, colors).

**What you build:**
- `@If`/`@ElseIf`/`@Else` — conditional validation (size format depends on category)
- `@ObjectRule` — class-level business rules (margin must be positive)
- `@CrossValidate` — multi-field dependencies
- `@ValidatedClassArray` — nested variant arrays (size/color/pricing breakdowns)

**GUI update:**
- Product browser: expandable variant table per product
- Validation badges: error/warning indicators with rule violation details
- Intake form: dynamic variant entry (add/remove size-color rows)

---

## Part 8: Human Review Workflow

**Goal:** Add approval states so humans can review, edit, and approve products before final import.

**What you build:**
- Entity state machine: `draft → review → approved → imported`
- Bot workflow logic: auto-approve high-confidence products, flag uncertain ones for review
- Review actions: approve, reject (with reason), edit and re-validate

**GUI update:**
- **Review queue page** — filterable list of products awaiting review
- Inline editing with re-validation on save
- Approve/reject buttons with audit trail

**Key concepts introduced:**
- Entity state management in the graph
- Human-in-the-loop patterns — AI does the heavy lifting, humans handle edge cases
- Re-validation: editing a reviewed product runs it back through the pipeline

---

## Part 9: AI-Powered Extraction

**Goal:** Handle Supplier D — sends free-text descriptions instead of structured data. Introduce the two AI modalities.

**What you build:**
- `@AIExtract` — LLM extracts structured fields from free-text descriptions
- `@AIClassify` — LLM categorizes products into canonical categories
- `@AIJSONRepair` — LLM fixes malformed JSON before parsing

**GUI update:**
- AI extraction panel: show what the AI extracted with confidence scores
- Human correction: override AI-extracted values, re-validate

**Key concepts — Two AI Modalities (callout):**

> **AI as Data Generator:** The LLM creates new structured data from unstructured input. `@AIExtract` takes a free-text product description and produces `{ product_name, category, base_cost, ... }`. The AI is the *source* of the data. The validation pipeline then cleans, coerces, and validates the AI's output — treating it exactly like any other supplier input.
>
> **AI as Data Transformer:** The LLM transforms existing data into a better form. `@AIClassify` takes a messy category string and maps it to the canonical taxonomy. `@AIJSONRepair` takes broken JSON and fixes it. `@AICatchRepair` (Part 10) suggests corrections for validation failures. The AI is a *tool within the pipeline*, not the source.
>
> The key insight: **AI outputs need validation just as much as human inputs do.** Whether the LLM generated the data or transformed it, the validation pipeline is the quality gate. This is why `@AIExtract` feeds its output back through the same decorator chain — the AI doesn't get a free pass.

---

## Part 10: Recovery & Production Hardening

**Goal:** Handle failures gracefully, DRY up the codebase, and prepare for production.

**What you build:**
- `@Catch` — graceful degradation (extract digits from malformed sizes instead of failing)
- `@AICatchRepair` — AI suggests closest canonical match when validation fails
- `@ValidateAsync` — async uniqueness checks against live database
- `@UseStyle` / `@DefaultTransforms` — reusable decorator patterns to eliminate repetition
- Engine modes: convergent vs single-pass, when each matters

**GUI update:**
- Recovery indicators: "this value was repaired" badges
- Async validation status: "checking uniqueness..." spinners
- Production dashboard: validation success rates, common failure patterns

**Key concepts introduced:**
- Error recovery philosophy: fix what you can, flag what you can't, never crash
- `@AICatchRepair` — AI as data transformer applied to validation failures
- Reuse patterns — DRY decorators for teams with many validators
- Engine deep-dive: dependency graphs, iteration limits, when to use single-pass

---

## Cross-Cutting Themes (reinforced throughout)

### Data Classes > Raw JSON
Every part includes a "without data classes" sidebar showing what the equivalent raw JSON approach would look like — scattered `if` checks, `as` casts, missing fields crashing at runtime, old data silently breaking.

### Shared Types Across the Stack
The validation class is the contract. Bundle validates and stores it. GUI reads and displays it. Backend queries and transforms it. One definition, everywhere.

### The Entity Graph as Typed Storage
`@EntityDecorator({ dataClass })` + `@Serializable` = typed `dto.data` automatically. The `BotRunnableEntityMixin` saves bot output → entity. `EntityNode.reconstructData()` rebuilds class instances on read. No custom serialization code.

### AI Modalities
- **Generator:** `@AIExtract` — LLM produces the data, pipeline validates it
- **Transformer:** `@AIClassify`, `@AIJSONRepair`, `@AICatchRepair` — LLM improves data within the pipeline

Both modalities go through the same validation gate. AI doesn't get special treatment.
