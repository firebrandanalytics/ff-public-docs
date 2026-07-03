# Context Gathering — WS#22 Session 991150 (P1)

## Baseline: What Exists Today

### Target location

`docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/` — **does not exist**. No files to migrate or merge. Fresh directory.

### Sibling tutorials (8 exist)

| Series | Files | Parts |
|--------|-------|-------|
| `crm/` | README.md + 6 parts | part-01 through part-06 |
| `illustrated-story/` | README.md + 10 parts | part-01 through part-10 |
| `code-sandbox/` | README.md + 5 parts | part-01 through part-05 |
| `file-upload/` | README.md + ? | — |
| `news-analysis/` | README.md + 3 parts | part-01 through part-03 |
| `query-explainer/` | README.md + ? | — |
| `report-generator/` | README.md + 13 parts | part-01 through part-13 |
| `catalog-intake/` | README.md + ? | — |

No index file at the `tutorials/` root level (no `tutorials/README.md`, no `tutorials/index.md`). The tutorials directory is a flat collection of subdirectories — discovery happens via the agent_sdk README.

### Tutorials root index check

**No root index exists.** Nothing needs to be created or updated at the `tutorials/` level to register the new series.

### agent_sdk README — DSL section (current state)

```
- [Overview](dsl/README.md) - Why XML, when to use DSLs vs TypeScript, architecture
- [Getting Started Tutorial](dsl/getting-started-tutorial.md) - Build a complete Sentiment Analyzer bundle from scratch
- [Advanced Patterns](dsl/advanced-patterns-tutorial.md) - Conditionals, loops, mixins, entity orchestration, error handling
- [Reference Guides](dsl/reference/) - Complete element and attribute documentation for all four DSLs
- [E2E Example](dsl/examples/xml-e2e-bundle.md) - Annotated walkthrough of a real deployed bundle (TypeScript wiring)
```

The new tutorial series is NOT listed here. A link to `tutorials/xml-dsl-demo/README.md` should be added under the XML DSL section.

---

## Catalog: Tutorial README Pattern (exact structure)

All 3 scouted READMEs (crm, illustrated-story, code-sandbox) follow an identical structure:

```
# [Verb phrase] (e.g., "Building a CRM with FireFoundry")

[1–2 sentence intro describing what the tutorial builds]

## What You'll Build
[bullet list of capabilities/outcomes]

## Prerequisites
[bullet list with relative links]
- [FireFoundry local development environment](...)
- [ff-cli installed and configured](...)
- Node.js 20+
- [TypeScript / Basic TypeScript knowledge]
- [Familiarity with FireFoundry core concepts]

## Tutorial Parts
| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|-------------|
| [1](./part-01-slug.md) | Part title | What you build in this part | Key SDK/DSL concepts |

## How to Use This Tutorial          ← present in crm and code-sandbox; absent in illustrated-story
**Sequential approach**: ...
**[Other approach]**: ...

## Architecture Overview
[ASCII diagram]

## Source Code
[Link to ff-demo-apps repo]

---
**Ready to start?** Head to [Part 1: Title](./part-01-slug.md).
```

**Column headers (exact):** `| Part | Title | What You Build | Key Concepts |`  
**Part cell format:** `| [1](./part-01-slug.md) |`  
**Closing line:** `**Ready to start?** Head to [Part N: Title](./part-0N-slug.md).`

### Part file pattern (exact)

```
# Part N: Title

[Hook paragraph — what you'll have by the end]

**What you'll learn:**
- bullet
- bullet

---

## Section heading
[content]
```

---

## Source Document Inventory

### DSL source docs (read-only inputs)

| File | Lines | Content scope |
|------|-------|--------------|
| `dsl/getting-started-tutorial.md` | 898 | Ch1 PromptML → Ch2 BotML → Ch3 AgentML → Ch4 BundleML → Ch5 TypeScript wiring → Ch6 Running. Builds a Sentiment Analyzer from scratch. |
| `dsl/advanced-patterns-tutorial.md` | 750 | Ch1 conditionals (`<if>/<else>`) → Ch2 loops → Ch3 mixins → Ch4 entity orchestration → Ch5 working memory → Ch6 error handling → Ch7 schema generation |
| `dsl/examples/xml-e2e-bundle.md` | 696 | Line-by-line walkthrough of xml-e2e-bundle using TypeScript wiring mode. Same DSL files as demo but different bootstrap approach. |
| `dsl/reference/bundleml-reference.md` | 1028 | Complete BundleML element reference, CDATA patterns, validation rules, AST types |
| `dsl/reference/agentml-reference.md` | 1331 | Complete AgentML element reference, all instructions, expression forms |
| `dsl/reference/botml-reference.md` | 954 | Complete BotML element reference, mixins, structured prompt groups |
| `dsl/reference/promptml-reference.md` | 857 | Complete PromptML element reference, interpolation, conditionals, for-each |
| `dsl/reference/expressions-reference.md` | 1137 | Expression evaluation, available objects, forbidden patterns |
| `dsl/reference/README.md` | 97 | Reference index |

### DESIGN.md tutorial outline (Section 6)

The DESIGN.md specifies a 5-part (+ optional Part 6) structure. This maps cleanly to the phase instructions' 5 parts, with the optional Part 6 ("Fork It") excluded per scope.

| Part (DESIGN.md) | Phase Inst. Mapping | Title | Key DSL focus |
|----------|---------------------|-------|---------------|
| Part 1 | part-01 | Run It, See It, Believe It | BundleML overview, BUNDLE_PATH, fleet model |
| Part 2 | part-02 | Wiring It All Together with BundleML | BundleML deep dive: constructors, endpoints, CDATA |
| Part 3 | part-03 | Orchestrating AI with AgentML | AgentML workflow: yield-status, call-bot, wm-set, graph-append |
| Part 4 | part-04 | Configuring LLM Behavior with BotML | BotML + inline PromptML: structured-prompt-group, conditionals, interpolation |
| Part 5 | part-05 | Ship It: xml-bundle-server and the Fleet Model | Deployment: ConfigMap, Helm, bootstrapFromBundleML() |

Note: Phase instructions say `scaffold → BundleML → AgentML+BotML → PromptML → deploy+GUI`. DESIGN.md has AgentML and BotML+PromptML in separate parts. I'm following DESIGN.md's part breakdown (which is more detailed) and treating AgentML as Part 3 and BotML+PromptML as Part 4.

### Source doc → tutorial part contribution map

For each source DSL doc, the tutorial part(s) it primarily serves and what specific content it contributes:

| Source Doc | Primary Part(s) | Specific Contribution |
|-----------|-----------------|----------------------|
| `getting-started-tutorial.md` Ch6 (Running) | Part 1 | Local docker run + curl pattern for the 5-minute quickstart; confirms command shapes and expected output |
| `getting-started-tutorial.md` Ch4 (BundleML) | Part 2 | `<bundle>`, `<constructors>`, `<endpoints>`, `<methods>` element introductions; CDATA handler context explanation (`body`/`query`/`registry`/`logger`) |
| `getting-started-tutorial.md` Ch3 (AgentML) | Part 3 | `<yield-status>`, `<call-bot result="">`, `<wm-set>`, `<return>` element introductions; variable binding pattern |
| `getting-started-tutorial.md` Ch2 (BotML) | Part 4 | `<bot>`, `<llm-options>`, `<model-pool>`, `max-tries` introductions; `<structured-prompt-group>` overview |
| `getting-started-tutorial.md` Ch1 (PromptML) | Part 4 | `<prompt>`, `<text>`, `<section>`, interpolation introductions (as background for inline PromptML in BotML) |
| `advanced-patterns-tutorial.md` Ch1 (conditionals) | Part 4 | `<if condition="...">` inside BotML embedded prompts; JS expression evaluation at prompt render time |
| `advanced-patterns-tutorial.md` Ch4 (entity orchestration) | Part 3 | `<graph-append edge-type="...">` patterns; entity graph edge data fields |
| `advanced-patterns-tutorial.md` Ch5 (working memory) | Part 3 | `<wm-set key="..." value="...">` patterns; working memory key path conventions |
| `xml-e2e-bundle.md` | Part 2, Part 5 | Part 2: same-domain TypeScript-wiring comparison for `<constructors>` and `<endpoints>`; Part 5: contrast between TypeScript bootstrap (`agent-bundle.ts`) and zero-TS `bootstrapFromBundleML()` |
| `bundleml-reference.md` | Part 2, Part 5 | Part 2: authoritative element reference for annotated `bundle.bundleml` walkthrough; Part 5: `bootstrapFromBundleML()` sibling-file resolution behavior, env var contract |
| `agentml-reference.md` | Part 3 | Authoritative reference for all AgentML instructions in `analysis-workflow.agentml`: `<yield-status>`, `<call-bot>`, `<wm-set>`, `<graph-append>`, `<return>`, `<expr>` |
| `botml-reference.md` | Part 4 | Authoritative reference for `analyzer-bot.botml`: `<bot>` attributes, `<llm-options>`, `<structured-prompt-group>` / `<base>` / `<input>` structure, mixin patterns |
| `promptml-reference.md` | Part 4 | Reference for PromptML elements used inline in BotML: `<prompt role="...">`, `<text>`, `<section>`, `<if>`, `{{interpolation}}` — same syntax inside BotML as in standalone `.promptml` files |
| `expressions-reference.md` | Part 3, Part 4 | Part 3: expression evaluation for `value="args.*"` attribute form and nested `<expr>` form in AgentML; Part 4: `{{input.*}}` vs `{{args.*}}` interpolation distinction in BotML prompt context |

### Actual DSL bundle files (authoritative — injected context)

The actual deployed files (from injected context) differ from DESIGN.md in several ways. The tutorial MUST use the actual files, not the DESIGN.md design variants.

| Property | DESIGN.md spec | Actual (injected context) |
|----------|----------------|--------------------------|
| Route format | `/run-analysis` (with leading slash) | `run-analysis` (no leading slash) |
| Handler API | `registry.createEntity()` | `entity_factory.create_entity_node()` |
| Response | Synchronous result | Async: returns `{ entity_id, status: 'pending' }` immediately |
| Additional endpoints | `/dsl-info` only | `entity-status`, `latest-result`, `dsl-info` (4 total) |
| Model pool | `firebrand-gpt-5.2-failover` | `firebrand_completion_default` |
| BotML `<arg>` in AgentML | 4 named args | 5 args including `<arg name="input" value="args"/>` |

---

## Dependencies

1. **DESIGN.md Section 6** — part titles, learning objectives, key concepts per part. Provided in phase prompt. ✓
2. **Actual DSL bundle files** — 4 XML files. Provided in injected context. ✓
3. **Source tutorial docs** — getting-started-tutorial.md, advanced-patterns-tutorial.md, xml-e2e-bundle.md. Exist in repo. ✓
4. **Reference docs** — 5 reference files. Exist in repo. ✓
5. **CRM README pattern** — exact structure cataloged above. ✓
6. **No tutorials root index** — nothing to update at tutorials/ root. ✓
7. **agent_sdk README** — needs 1-line update to DSL section to reference new tutorial. ✓

---

## Gap List

**G1 — Location discrepancy in DESIGN.md** (resolved, no action needed):  
DESIGN.md Section 6 says document location is `dsl/examples/xml-dsl-demo.md`. Phase instructions mandate `tutorials/xml-dsl-demo/` with README + 5 parts. Phase instructions take precedence — the DESIGN.md predates the decision to use per-demo tutorial series format. Using `tutorials/xml-dsl-demo/`.

**G2 — ff-demo-apps source code link** (acceptable risk):  
ff-demo-apps is not provisioned in this session. Tutorial Source Code section will link to the ff-demo-apps repo under `xml-dsl-demo/`. Path structure is confirmed from DESIGN.md Section 8. Exact commit/branch unknown. Will use: `https://github.com/firebrandanalytics/ff-demo-apps` under `xml-dsl-demo/`.

**G3 — agent_sdk README update scope** (known, minimal):  
The XML DSL section in agent_sdk README currently lists getting-started-tutorial.md and advanced-patterns-tutorial.md. The new tutorial series should be added. This is a 1-line addition: `- **[XML DSL Demo Tutorial](tutorials/xml-dsl-demo/README.md)** - Guided tour of the Content Analyzer demo bundle...`. Will include in final PR.

**G4 — dsl/README.md update scope** (known, minimal):  
The DSL README does not reference tutorials/. The Getting Started section at the bottom links to reference/ and examples/ but not to the demo tutorial series. Adding a link there is appropriate. Will include in final PR.

**G5 — Async vs synchronous tutorial flow** (design decision):  
The actual bundle runs analysis asynchronously: POST returns `{ entity_id, status: 'pending' }`, then GUI polls `entity-status`. DESIGN.md describes a synchronous flow in the user-facing walkthrough. The tutorial (Part 1 quickstart) must use the actual async pattern with polling. This affects Part 1's curl examples.

**G6 — Part 5 GUI scope** (confirmed no action in ff-public-docs):  
Part 5 covers deploy+GUI. The ff-demo-apps `xml-dsl-gui/` app is not provisioned here. Tutorial will describe the GUI architecture referencing the source code, not reproduce the full Next.js code in docs.

No gaps require ground-truth resolution before writing. All required inputs are available.

---

## context_docs

[]
