# Orientation — WS#22 Session 991150

## Fresh-start vs. Resumption

**Decision: Fresh start for the primary deliverable.**

The target directory `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/` does not exist. No prior work targets this location. This session begins from zero for the tutorial series.

**Prior work in scope (keeps):** An earlier phase of this session created `docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md` — a guided tour at a *different* location. That file stays; it is not the tutorial series. It is a reference artifact, not a structured part-based tutorial.

## Repos and Branch in Scope

| Repo | Branch | Role |
|------|--------|------|
| `ff-public-docs` | `ws22/991150` | Primary — tutorial content lives here |
| `ff-demo-apps` | not provisioned | Referenced but not modified in this session |

Branch `ws22/991150` is branched off `ai/ws-22` (merge-base: `e5abd75`). All writes happen in `/workspace/sessions/991150/ff-public-docs` on this branch. PRs will target `ai/ws-22`.

## What Already Exists (Builds On)

### Source content (inputs — read-only)

| File | Purpose |
|------|---------|
| `dsl/getting-started-tutorial.md` (898 lines) | Step-by-step DSL intro: PromptML → BotML → AgentML → BundleML |
| `dsl/advanced-patterns-tutorial.md` (750 lines) | Conditionals, loops, mixins, entity orchestration, error handling |
| `dsl/examples/xml-e2e-bundle.md` | Line-by-line walkthrough of a deployed bundle (TypeScript wiring version) |
| `dsl/reference/` (5 files) | Complete element/attribute reference for all four DSLs |
| `dsl/examples/xml-dsl-demo.md` | Guided tour created earlier this session; overlaps in scope but different format and location |

### Sibling pattern to follow

`tutorials/crm/` — README.md + 6 numbered `part-XX-slug.md` files. The xml-dsl-demo tutorial follows the same structure: `README.md` + 5 numbered parts.

### Authoritative design input

`/workspace/context/ws22-xml-dsl-demo-DESIGN.md` — Worker 2 must not read source repos; all design decisions come from this file plus the actual DSL bundle files provided in the phase prompt.

## Target Structure (to be created)

```
docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/
├── README.md         — intro, what you'll build, prerequisites, parts table
├── part-01.md        — Scaffold: run it first, understand what you have
├── part-02.md        — BundleML: the manifest, endpoints, CDATA handlers
├── part-03.md        — AgentML + BotML: workflow execution and bot configuration
├── part-04.md        — PromptML: structured prompts, conditionals, interpolation
└── part-05.md        — Deploy + GUI: ConfigMap model, Helm, xml-bundle-server fleet
```

## Key Invariants (from DESIGN.md)

- `bootstrapFromBundleML()` auto-loads `.agentml` and `.botml` — does NOT load `.promptml`
- CDATA handler context: `body`, `query`, `registry`, `logger` (not `request`, `bundle`)
- BotML can embed PromptML inline — no separate `.promptml` file needed
- DESIGN.md is the sole authoritative source; source repos are not read
