# Catalog Intake Tutorial

## The Problem with Raw JSON

If you've built data pipelines in TypeScript, you've written code like this:

```typescript
const product = JSON.parse(supplierPayload) as SupplierProduct;

if (!product.product_name) throw new Error('Missing product name');
if (typeof product.base_cost !== 'number') {
  product.base_cost = parseFloat(product.base_cost as any);
}
if (product.category) {
  product.category = product.category.trim().toLowerCase();
}
// ... 50 more lines of this
```

This pattern is everywhere. It's the default way most teams handle external data in JavaScript and TypeScript. You parse the JSON, cast it to an interface, and then scatter validation logic across your codebase -- in the route handler, in the service layer, in the database model, in the frontend display logic. Every developer who touches the data adds their own defensive checks. Every new field requires hunting through every file that handles the type.

It works. Until it doesn't.

**The cast is a lie.** `as SupplierProduct` doesn't validate anything. It tells the compiler "trust me, this shape is correct" -- and the compiler believes you. At runtime, you're still working with raw JSON. If a supplier sends `"89.99"` instead of `89.99`, TypeScript won't catch it. If a field is renamed upstream, TypeScript won't catch it. If a new supplier sends nested JSON where you expected flat, TypeScript won't catch it. You'll find out in production, when something crashes or -- worse -- silently produces wrong data.

**Validation logic scatters.** The route handler checks for required fields. The service layer coerces types. The database model trims strings. The frontend checks for nulls before rendering. No single place defines what a valid product looks like. When the rules change, you update some files and miss others. When a new developer joins, they don't know which checks are authoritative and which are redundant. The "source of truth" is everywhere and nowhere.

**Serialization strips identity.** You validate a product, store it in a database, read it back -- and now it's raw JSON again. The class methods are gone. The `Date` objects are strings. The nested objects are plain `{}`. Every layer that reads the data has to reconstruct what the writing layer already knew. Or, more commonly, it doesn't -- it just casts and hopes.

These aren't edge cases. This is the normal state of most production TypeScript codebases handling external data. And it gets worse as you scale: more suppliers, more formats, more developers, more services reading and writing the same data.

## The Data Class Alternative

There's a better pattern. Instead of treating validation as something you bolt on to raw JSON, you make the data class itself the validator. The class definition *is* the validation rules. The instance *is* the validated data. One definition, used everywhere.

```typescript
@Serializable()
class SupplierProduct {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceType('number')
  @ValidateRange({ min: 0.01 })
  base_cost!: number;

  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet(['running', 'basketball', 'hiking', 'casual'], { fuzzy: true })
  category!: string;
}
```

This class is three things at once:

1. **A type definition.** TypeScript knows the shape. Your IDE autocompletes. Refactoring works.
2. **A validation pipeline.** Each decorator declares a transformation or constraint. The pipeline runs them in order -- coerce first, then validate. No scattered `if` checks.
3. **A serialization contract.** `@Serializable` adds `toJSON()` and `fromJSON()`. The class instance survives a round-trip through JSON and back. Store it in a database, load it tomorrow -- you get a class instance back, not raw JSON.

The class is the single source of truth. The agent bundle validates with it. The frontend renders with it. The database stores and reconstructs it. When a field changes, you change the decorator -- not a dozen files.

This is what FireFoundry's [validation library](../../../utils/validation/README.md) provides: a decorator-based system for defining data classes that validate, coerce, serialize, and reconstruct themselves. The decorators handle the boring parts (trimming strings, parsing currencies, fuzzy-matching against catalogs) so your application code works with clean, typed, trustworthy data.

## What This Tutorial Is

This tutorial is a hands-on argument for the data class approach. You'll build a complete application -- an agent bundle, a Next.js GUI, a shared type package -- that ingests messy supplier product data, validates it, stores it in the entity graph, and lets humans review it before import. Every part ends with a working system you can deploy and test.

But this isn't just a technical how-to. Throughout the tutorial, each part includes a **compare-and-contrast sidebar** showing what the same task looks like without data classes -- the scattered checks, the fragile casts, the silent data corruption. You'll see the raw-JSON approach and the data-class approach side by side, and you'll understand viscerally why the second one is better. Not because someone told you, but because you'll feel the difference as you build.

By the end, you'll have built a system that:

- **Ingests** supplier product submissions in any format (flat JSON, nested JSON, ALL_CAPS CSV, free text)
- **Validates** and normalizes them through a decorator pipeline with a single class as the source of truth
- **Stores** typed class instances in the entity graph -- and gets typed class instances back on read
- **Routes** to the correct supplier-specific validator via discriminated unions with auto-detection
- **Matches** messy supplier values against a real product catalog with fuzzy matching
- **Traces** every transformation so you can see exactly what happened to every field
- **Reviews** uncertain products with a human-in-the-loop workflow
- **Extracts** structured data from free text using AI -- then validates the AI's output through the same pipeline
- **Recovers** from errors gracefully instead of crashing

All of this is powered by data classes. The class is the contract. The class is the validator. The class is the serialization format. One definition, shared across the entire stack.

## What You'll Build

An agent bundle (`catalog-bundle`) with:

- Four runnable entity workflows -- API ingestion, CSV upload, PDF extraction, manual form entry
- `SupplierProductDraft` entity -- typed `dto.data` backed by validation classes with `dataClass` auto-reconstruction
- Progressive schema validators -- V1 (API), V2 (CSV), V3 (PDF), each adding fields as new suppliers arrive
- `SupplierProductCanonical` discriminated union -- auto-detects format on deserialization

A Next.js GUI (`catalog-gui`) with:

- **Intake form** -- submit supplier data manually or via file upload
- **Product browser** -- browse validated products with supplier format badges and match confidence
- **Validation trace viewer** -- see exactly what each decorator did to every field
- **Review queue** -- approve, reject, or edit products before final import
- **AI extraction panel** -- view and correct AI-extracted fields from PDF extraction

A shared type package (`shared-types`) with:

- Validation classes shared between agent bundle, frontend, and backend
- One definition, three consumers -- the type, the validator, and the serialization format in one place

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [1](./part-01-working-agent-bundle.md) | A Working Agent Bundle | Bundle anatomy, workflow, entity, V1 validator, `@ApiEndpoint`, `@Serializable`, `dataClass` |
| [2](./part-02-catalog-gui.md) | The Catalog GUI | Next.js, intake form, product browser, shared type package |
| [3](./part-03-multi-supplier-routing.md) | Multi-Supplier Routing | `@DiscriminatedUnion`, `@Discriminator`, `@DerivedFrom`, `@CoerceParse` |
| [4](./part-04-schema-versioning.md) | Schema Versioning & Auto-Detection | Lambda discriminator, two-phase pattern, schema evolution |
| [5](./part-05-validation-trace.md) | The Validation Trace | Trace capture, `@Staging`, per-field audit, trace viewer GUI |
| [6](./part-06-catalog-matching.md) | Catalog Matching & Context | `@CoerceFromSet`, fuzzy matching, `CatalogContext`, DAS integration |
| [7](./part-07-rules-variants.md) | Business Rules & Nested Variants | `@If`/`@Else`, `@ObjectRule`, `@CrossValidate`, `@ValidatedClassArray` |
| [8](./part-08-human-review.md) | Human Review Workflow | Entity states, approval flow, inline editing, review queue GUI |
| [9](./part-09-ai-extraction.md) | AI-Powered Extraction | `@AITransform`, `@AIClassify`, remote bot, two AI modalities |
| [10](./part-10-recovery-production.md) | Recovery & Production Hardening | `@Catch`, `@AICatchRepair`, `@ValidateAsync`, `@UseStyle`, engine modes |
| [12](./part-12-data-wrangling.md) | Data Wrangling Service Integration | `WrangleSpec`, `compileWrangleSpec()`, declarative column rules, fuzzy matching, three usage modes |

## Architecture Overview

```
Supplier submits data
       |
       v
  GUI (Next.js)                      Agent Bundle
  +-----------------+                +---------------------------+
  | Intake Form     |---POST------->| @ApiEndpoint handlers     |
  | Product Browser |<--GET---------|   run ingestion workflows  |
  | Trace Viewer    |               |   validate via decorators  |
  | Review Queue    |               |   store SupplierProductDraft|
  +-----------------+                +---------------------------+
       |                                        |
       |              Entity Graph              |
       +---------->  [typed dto.data]  <--------+
                   SupplierProductCanonical
                   (real class instance, not raw JSON)
```

## Source Code

The complete source code is available in the [ff-demo-apps-validation](https://github.com/firebrandanalytics/ff-demo-apps) repository under `catalog-intake/`.

## Further Reading

- [Validation Library Reference](../../../utils/validation/README.md) -- full decorator API reference, engine modes, and advanced patterns
- [News Analysis Tutorial](../news-analysis/README.md) -- web search + AI analysis agent bundle with GUI
- [Report Generator Tutorial](../report-generator/README.md) -- advanced entity/bot/prompt stack

---

**Ready to start?** Head to [Part 1: A Working Agent Bundle](./part-01-working-agent-bundle.md).
