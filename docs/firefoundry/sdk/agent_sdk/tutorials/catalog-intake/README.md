# Catalog Intake Tutorial

Build a supplier product intake system with an agent bundle, a Next.js GUI, and a decorator-based validation pipeline. You'll create a complete application that normalizes messy supplier data, stores typed class instances in the entity graph, and lets humans review products before import.

## What You'll Learn

- Scaffolding an agent bundle with bots, entities, and validators
- Using `BotRunnableEntityMixin` for automatic bot-to-entity data flow
- Building a shared type package so validation classes work in the bundle, GUI, and backend
- Designing discriminated unions for multi-format data and schema evolution
- Wiring a Next.js GUI to the agent bundle from Part 2 onward
- Querying live data through the Data Access Service (DAS) for fuzzy catalog matching
- Implementing a human review workflow with entity state management
- Using AI decorators for extraction (`@AIExtract`) and transformation (`@AIClassify`, `@AICatchRepair`)
- Making the validation pipeline observable, recoverable, and production-ready

## What You'll Build

An agent bundle (`catalog-bundle`) that:

- **Ingests** supplier product submissions in any format (flat JSON, nested JSON, ALL_CAPS CSV, free text)
- **Validates** and normalizes them through a decorator-based pipeline
- **Stores** typed class instances in the entity graph via `@Serializable` + `@EntityDecorator({ dataClass })`
- **Routes** to the correct supplier-specific validator via `@DiscriminatedUnion` with lambda auto-detection

Plus a Next.js GUI (`catalog-gui`) with:

- **Intake form** -- submit supplier data manually or via upload
- **Product browser** -- view validated products with supplier format badges and match confidence
- **Validation trace viewer** -- see exactly what each decorator did to every field
- **Review queue** -- approve, reject, or edit products before final import
- **AI extraction panel** -- view and correct AI-extracted fields from free-text descriptions

## Running Theme: Data Classes > Raw JSON

Every part includes a compare-and-contrast sidebar showing what the same task looks like without typed validation classes -- scattered `if` checks, `as` casts, missing fields crashing at runtime, old data silently breaking. The validation class is the single source of truth shared across the entire stack.

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [1](./part-01-working-agent-bundle.md) | A Working Agent Bundle | Bundle anatomy, bot, entity, V1 validator, `BotRunnableEntityMixin`, `@Serializable`, `dataClass` |
| [2](./part-02-catalog-gui.md) | The Catalog GUI | Next.js, intake form, product browser, shared type package |
| [3](./part-03-multi-supplier-routing.md) | Multi-Supplier Routing | `@DiscriminatedUnion`, `@Discriminator`, `@DerivedFrom`, `@CoerceParse` |
| [4](./part-04-schema-versioning.md) | Schema Versioning & Auto-Detection | Lambda discriminator, two-phase pattern, schema evolution |
| [5](./part-05-validation-trace.md) | The Validation Trace | Trace capture, `@Staging`, per-field audit, trace viewer GUI |
| [6](./part-06-catalog-matching.md) | Catalog Matching & Context | `@CoerceFromSet`, fuzzy matching, `CatalogContext`, DAS integration |
| [7](./part-07-rules-variants.md) | Business Rules & Nested Variants | `@If`/`@Else`, `@ObjectRule`, `@CrossValidate`, `@ValidatedClassArray` |
| [8](./part-08-human-review.md) | Human Review Workflow | Entity states, approval flow, inline editing, review queue GUI |
| [9](./part-09-ai-extraction.md) | AI-Powered Extraction | `@AIExtract`, `@AIClassify`, `@AIJSONRepair`, two AI modalities |
| [10](./part-10-recovery-production.md) | Recovery & Production Hardening | `@Catch`, `@AICatchRepair`, `@ValidateAsync`, `@UseStyle`, engine modes |

## Architecture Overview

```
Supplier submits data
       |
       v
  GUI (Next.js)                      Agent Bundle
  +-----------------+                +---------------------------+
  | Intake Form     |---POST------->| CatalogIntakeBot          |
  | Product Browser |<--GET---------|   validates via decorators |
  | Trace Viewer    |               |   BotRunnableEntityMixin  |
  | Review Queue    |               |   saves to entity graph   |
  +-----------------+                +---------------------------+
       |                                        |
       |              Entity Graph              |
       +---------->  [typed dto.data]  <--------+
                   SupplierBProduct instance
                   (not raw JSON)
```

## Source Code

The complete source code is available in the [ff-demo-apps-validation](https://github.com/firebrandanalytics/ff-demo-apps) repository under `catalog-intake/`.

## Related

- [News Analysis Tutorial](../news-analysis/README.md) -- web search + AI analysis agent bundle with GUI
- [Report Generator Tutorial](../report-generator/README.md) -- advanced entity/bot/prompt stack
- [Validation Library Reference](../../utils/validation/README.md) -- decorator API reference

---

**Ready to start?** Head to [Part 1: A Working Agent Bundle](./part-01-working-agent-bundle.md).
