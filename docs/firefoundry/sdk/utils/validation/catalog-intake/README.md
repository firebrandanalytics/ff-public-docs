> **DEPRECATED** — This 11-part outline has been superseded by the
> [Catalog Intake Tutorial](../../../agent_sdk/tutorials/catalog-intake/README.md)
> under `sdk/agent_sdk/tutorials/catalog-intake/`. The new 10-part tutorial
> covers every validation library feature demonstrated here, integrated into a
> working agent bundle with a Next.js GUI and entity graph storage. Use the new
> tutorial for all new readers. This outline is preserved for historical
> reference only.

# FireKicks Catalog Intake — Validation Library Tutorial (Archived)

An 11-part tutorial demonstrating the `@firebrandanalytics/shared-utils/validation` decorator library through a real-world supplier product catalog intake application built on the FireKicks dataset.

## What You'll Learn

Starting from basic string cleanup and building to AI-powered data extraction, this tutorial walks you through every major feature of the validation library. Each part adds new decorators to a `SupplierProductDraft` validator class, progressively handling messier and more complex supplier data until you have a production-grade intake pipeline that can normalize any supplier's catalog submission into clean, trusted product records.

## Prerequisites

- [Architecture & Design Document](./DESIGN.md) — schema, data flow, and tutorial progression map
- FireKicks dataset loaded (firekicks connection in DAS)
- FireFoundry local dev environment running
- Basic TypeScript familiarity
- Node.js 18+

## Tutorial Parts

| Part | Title | Key Decorators |
|------|-------|----------------|
| [1](./part-01-basic-pipeline.md) | Core Coercion + Validation | `@ValidateRequired`, `@CoerceTrim`, `@CoerceCase`, `@CoerceType`, `@ValidateRange` |
| [2](./part-02-parsing-reparenting.md) | Parsing + Reparenting | `@CoerceParse`, `@Copy`, `@Staging`, `@DerivedFrom` (JSONPath) |
| [3](./part-03-discriminated-unions.md) | Discriminated Supplier Mappings | `@DiscriminatedUnion`, `@Discriminator` |
| [4](./part-04-nested-variants.md) | Nested Variants | `@ValidatedClass`, `@ValidatedClassArray`, `@CollectProperties` |
| [5](./part-05-fuzzy-matching.md) | Fuzzy Matching + Runtime Context | `@CoerceFromSet` (fuzzy + context), `CoercionAmbiguityError` |
| [6](./part-06-conditionals-rules.md) | Conditionals + Object Rules | `@If`/`@ElseIf`/`@Else`/`@EndIf`, `@ObjectRule`, `@CrossValidate` |
| [7](./part-07-reuse-patterns.md) | Reuse Patterns | `@UseStyle`, `@DefaultTransforms`, `@ManageAll` |
| [8](./part-08-engine-deep-dive.md) | Engine Deep Dive | `@UseSinglePassValidation`, `@UseConvergentValidation`, `@DependsOn` |
| [9](./part-09-ai-extraction.md) | AI Extraction + Classification | `@AIExtract`, `@AIClassify`, `@AIJSONRepair` |
| [10](./part-10-recovery-async.md) | Recovery + Async Validation | `@Catch`, `@AICatchRepair`, `@ValidateAsync` |
| [11](./part-11-entity-graph-integration.md) | Entity Graph Integration | `@Serializable`, `fromJSON`, `@EntityDecorator({ dataClass })`, lambda discriminator |

## The Application

**Application ID:** `firekicks-catalog-intake`

Suppliers submit product data in messy, inconsistent formats — some send flat CSVs with `ALL_CAPS` column names, others send deeply nested JSON with camelCase keys, and a few send hand-typed spreadsheets full of typos. This application normalizes and validates all of it before import into the main FireKicks product catalog. Each tutorial part progressively enriches the validation logic to handle more suppliers and more edge cases.

## Running the Demo

```bash
# Clone the demo apps repo
git clone https://github.com/firebrandanalytics/ff-demo-apps.git
cd ff-demo-apps/catalog-intake

# Install dependencies
npm install

# Start the FireFoundry local dev environment
ff-cli dev start

# Run the intake pipeline against sample supplier data
npx tsx src/run-intake.ts --supplier sample-supplier-a
```

## Source Code

- **Bundle (agent):** [ff-demo-apps/catalog-intake/bundle](https://github.com/firebrandanalytics/ff-demo-apps/tree/main/catalog-intake/bundle)
- **GUI (Next.js):** [ff-demo-apps/catalog-intake/gui](https://github.com/firebrandanalytics/ff-demo-apps/tree/main/catalog-intake/gui)
- **Tutorial docs:** You are here
