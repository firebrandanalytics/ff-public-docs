# Requirements & Specs — WS#22 Session 991150 (P4)

## Functional Requirements

| ID | Requirement | Testable Verification |
|----|-------------|----------------------|
| R01 | Directory `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/` must exist with exactly 6 files: `README.md`, `part-01.md`, `part-02.md`, `part-03.md`, `part-04.md`, `part-05.md` | `ls docs/.../tutorials/xml-dsl-demo/` returns exactly those 6 files |
| R02 | `README.md` must include all Pattern 2 (5-part) sections: title, intro, What You'll Build, Prerequisites, Tutorial Parts table, How to Use This Tutorial, Architecture Overview, Diagnostic Tools, Source Code, "Ready to start?" closing | grep each section heading in README.md |
| R03 | Tutorial Parts table must use exact column headers: `\| Part \| Title \| What You Build \| Key Concepts \|` | diff column headers against spec |
| R04 | Each part file (`part-01.md` through `part-05.md`) must be ≥ 500 words | `wc -w docs/.../tutorials/xml-dsl-demo/part-0*.md` — each ≥ 500 |
| R05 | Zero TypeScript entity/bot code in any tutorial file — all code blocks are XML DSL, shell commands, YAML, or JSON | `grep -l '```typescript\|```ts' docs/.../tutorials/xml-dsl-demo/` returns empty |
| R06 | Each part must contain at least one XML DSL code block from the actual bundle files | `grep -c '```xml' docs/.../tutorials/xml-dsl-demo/part-0*.md` — each ≥ 1 |
| R07 | Each part must contain at least one `## Run and Verify` or equivalent section with a `curl` or shell command and the exact expected output | grep "Run and Verify\|curl\|docker run" in each part file |
| R08 | `docs/firefoundry/sdk/agent_sdk/README.md` XML DSL section must include a link to `tutorials/xml-dsl-demo/README.md` | grep "xml-dsl-demo" in agent_sdk/README.md |
| R09 | `docs/firefoundry/sdk/agent_sdk/dsl/README.md` must include a reference linking to the new tutorial series | grep "xml-dsl-demo\|tutorials/" in dsl/README.md |
| R10 | All relative links within the `tutorials/xml-dsl-demo/` directory must resolve — no broken links between part files or back to README | Manual link audit; README links to `./part-01.md` through `./part-05.md`; each part's nav (if any) resolves |

---

## Domain Policies (Invariants — Must Not Be Violated)

| ID | Policy | Enforcement |
|----|--------|-------------|
| DP01 | `bootstrapFromBundleML()` does NOT auto-load standalone `.promptml` files. Part 5 must state this explicitly; Part 4 must explain that `analyzer-prompt.promptml` is NOT the active prompt — the active prompt is inside `analyzer-bot.botml`'s `<structured-prompt-group>`. | grep "does NOT\|not auto-load\|not loaded" in part-05.md and part-04.md |
| DP02 | CDATA handler context in xml-bundle-server mode is `body`, `query`, `registry`, `logger` (NOT `request`, `bundle`). Part 2 must name all four available variables and explicitly note the two unavailable ones. | grep "body.*query.*registry.*logger" in part-02.md |
| DP03 | In BotML structured prompts, `<call-bot>` arguments arrive under `input.*` (NOT `args.*`). Part 4 must explain the `{{input.topic}}` vs `{{args.*}}` distinction. | grep "input\.\*\|input\.topic" in part-04.md |
| DP04 | The actual deployed bundle files (injected context) are authoritative where they differ from DESIGN.md. Specifically: route `run-analysis` (no leading slash), `entity_factory.create_entity_node()` API, async response `{ entity_id, status: 'pending' }`, 4 endpoints, model pool `firebrand_completion_default`. Tutorial must use these actual values. | diff code block content against injected bundle files |
| DP05 | The xml-dsl-demo bundle has ZERO hand-written TypeScript entity/bot code. Tutorial must not imply any TypeScript is written for the bundle. The only TypeScript in the demo lives in the Next.js GUI (`@apps/xml-dsl-gui`) — and the tutorial references it without reproducing it. | No TypeScript bundle code blocks in any part; Part 5 may mention the GUI exists but not reproduce its code |

---

## Non-Functional Requirements

| ID | NFR | Acceptance Criteria |
|----|-----|---------------------|
| NFR01 | Tutorial tone: "here's the thing running — let's understand it" (not build-from-scratch). Parts must not instruct the reader to create DSL files from scratch. | No part says "create a new file" or "add this to your file" for DSL files — only annotated reading |
| NFR02 | Part file names: `part-01.md` through `part-05.md` (no slug suffixes, despite some sibling tutorials using slugs). The phase instructions specify this format explicitly. | `ls docs/.../tutorials/xml-dsl-demo/part-*.md` returns exactly those 5 names |
| NFR03 | Each part file begins with `# Part N: Title` (exact format) | grep "^# Part [0-9]:" at line 1 of each part file |
| NFR04 | The tutorial does NOT reproduce the Next.js GUI TypeScript code. Part 5 may reference the GUI architecture from DESIGN.md Section 4 but must link to ff-demo-apps rather than embedding the code. | No `tsx`, `jsx`, `tsx` code blocks in any tutorial file |
| NFR05 | All XML DSL code blocks must match the actual bundle files character-for-character where they reproduce those files. No DESIGN.md variant content (DESIGN.md uses `registry.createEntity()` in the handler and a leading slash on routes; the actual bundle uses `entity_factory.create_entity_node()` and no leading slash). | Diff code blocks against injected bundle file content |

---

## Contract Surface

Files produced by this phase (input to gate, consumed by P5 writing phase):

| File | Role | Consumed By |
|------|------|-------------|
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/README.md` | Tutorial series index | Users, agent_sdk/README.md link |
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-01.md` | Part 1 content | Tutorial readers |
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-02.md` | Part 2 content | Tutorial readers |
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-03.md` | Part 3 content | Tutorial readers |
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-04.md` | Part 4 content | Tutorial readers |
| `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-05.md` | Part 5 content | Tutorial readers |
| `docs/firefoundry/sdk/agent_sdk/README.md` | Updated (1-line add) | SDK entrypoint readers |
| `docs/firefoundry/sdk/agent_sdk/dsl/README.md` | Updated (reference add) | DSL overview readers |

Files NOT produced — explicitly out of scope:
- `tutorials/README.md` or `tutorials/index.md` — no root index exists; none is created (confirmed in P1)
- Any file in `ff-demo-apps` — not provisioned in this session
- `dsl/examples/xml-dsl-demo.md` — retracted in P0; not recreated

---

## README Specification (Pattern 2 — Standard Complexity, 5 Parts)

### Required Sections (in order)

```markdown
# Building a Zero-TypeScript Content Analyzer with FireFoundry

[1–2 sentence intro: This tutorial series walks through the XML DSL Content Analyzer demo...]

## What You'll Build
- [bullet] A running xml-bundle-server instance that serves a content analysis API...
- [bullet] ...

## Prerequisites
- [FireFoundry local development environment](...)
- Docker (for running xml-bundle-server locally)
- Node.js 20+ (for the optional GUI)
- Familiarity with XML syntax
- [Basic FireFoundry core concepts](fire_foundry_core_concepts_glossary_agent_sdk.md)

## Tutorial Parts
| Part | Title | What You Build | Key Concepts |
|------|-------|----------------|-------------|
| [1](./part-01.md) | Run It, See It, Believe It | A running analysis from a single docker run command | BUNDLE_PATH, fleet model, async entity pattern |
| [2](./part-02.md) | Wiring It All Together with BundleML | Full BundleML manifest walk-through | <bundle>, <constructors>, <endpoints>, CDATA handlers |
| [3](./part-03.md) | Orchestrating AI with AgentML | Traced 9-step workflow execution | <yield-status>, <call-bot>, <wm-set>, <graph-append> |
| [4](./part-04.md) | Configuring LLM Behavior with BotML | Annotated bot + inline PromptML | <structured-prompt-group>, <if>, input.* vs args.* |
| [5](./part-05.md) | Ship It: xml-bundle-server and the Fleet Model | ConfigMap deployment walkthrough | bootstrapFromBundleML(), ConfigMap-as-bundle, fleet model |

## How to Use This Tutorial
**Sequential approach**: ...
**Reference approach**: ...

## Architecture Overview
[ASCII diagram — see spec below]

## Diagnostic Tools
[curl commands for health, dsl-info, latest-result]

## Source Code
[Link to https://github.com/firebrandanalytics/ff-demo-apps under xml-dsl-demo/]

---
**Ready to start?** Head to [Part 1: Run It, See It, Believe It](./part-01.md).
```

### Architecture Overview Diagram (required content)

```
POST /api/run-analysis
       │
       ▼
┌─────────────────────────────────────────────────┐
│  xml-bundle-server                               │
│  BUNDLE_PATH=/config/bundle.bundleml             │
│                                                  │
│  bundle.bundleml                                 │
│  ├─ <entity type="AnalysisWorkflow">             │
│  │    analysis-workflow.agentml                  │
│  │      └─ <call-bot name="AnalyzerBot">         │
│  │           analyzer-bot.botml                  │
│  │             └─ <structured-prompt-group>      │
│  │                  (inline PromptML)             │
│  └─ <bot type="AnalyzerBot">                     │
│                                                  │
│  Endpoints: run-analysis, entity-status,         │
│             latest-result, dsl-info              │
└─────────────────────────────────────────────────┘
       │
       ▼
{ entity_id, status: "pending" }   (poll entity-status for result)
```

### Diagnostic Tools Section (required content)

```bash
# Liveness check
curl http://localhost:3000/health

# Verify DSLs loaded correctly
curl http://localhost:3000/api/dsl-info | jq .

# Check most recent analysis result
curl http://localhost:3000/api/latest-result | jq .
```

---

## Per-Part Tutorial Specifications

### Part 1: Run It, See It, Believe It

**Title**: Run It, See It, Believe It

**What-you-build (1 sentence)**: Start the xml-bundle-server with a single `docker run` command, submit a text snippet via curl, and poll until you receive a structured JSON analysis — demonstrating that a complete FireFoundry AI workflow runs with zero TypeScript.

**Source DSL doc sections to adapt**:
- `getting-started-tutorial.md` → "Chapter 6: Running and Testing Your Bundle" → "Build and Run", "Test with curl", "Common Errors and How to Fix Them"

**Code blocks to include**:
1. Shell: `docker run` command (from DESIGN.md Section 3/5 local dev pattern)
2. XML: `bundle.bundleml` constructors section only — 8 lines showing `<constructors>` with the 2 declarations and `<config>` port
3. Shell: `curl -X POST` to `run-analysis` with sample text
4. JSON: Expected response `{ "entity_id": "...", "status": "pending" }`
5. Shell: `curl` GET to `entity-status?id=<entity_id>` (polling step)
6. JSON: Expected complete response `{ "entity_id": "...", "status": "complete", "result": { "summary": "...", "topic": "...", "sentiment": "positive", "findings": [...], "confidence": 0.87 } }`

**Run and verify**:
```bash
# Step 1: Start the server
docker run \
  -v $(pwd)/dsl:/config \
  -e BUNDLE_PATH=/config/bundle.bundleml \
  -e PG_SERVER=localhost \
  -e PG_DATABASE=ff_dev \
  -e LLM_BROKER_HOST=broker.ff-dev.internal \
  -e LLM_BROKER_PORT=8080 \
  -e USE_REMOTE_ENTITY_CLIENT=true \
  -p 3000:3000 \
  firebrandanalytics/xml-bundle-server:latest

# Step 2: Submit a text snippet
curl -X POST http://localhost:3000/api/run-analysis \
  -H "Content-Type: application/json" \
  -d '{"text":"The new product launch exceeded expectations, driving a 40% increase in quarterly revenue.","analysis_type":"general"}' | jq .
```
Expected Step 2: `{ "entity_id": "<uuid>", "status": "pending" }`

```bash
# Step 3: Poll until complete (replace <entity_id>)
curl "http://localhost:3000/api/entity-status?id=<entity_id>" | jq '{status: .status, result: .result}'
```
Expected Step 3 (when complete): `{ "status": "complete", "result": { "summary": "...", "topic": "Financial / Product Launch", "sentiment": "positive", "findings": [...], "confidence": 0.87 } }`

**Minimum word count**: 600

**Key writing constraints**:
- Open with "By the end of this part, you'll have a live content analysis running on your machine."
- Explain the async pattern: POST returns immediately with entity_id; result is retrieved by polling. This is NOT a synchronous call — it reflects actual bundle behavior.
- Do NOT explain how to modify DSL files — this part is run-only.

---

### Part 2: Wiring It All Together with BundleML

**Title**: Wiring It All Together with BundleML

**What-you-build (1 sentence)**: Read through the complete `bundle.bundleml` manifest element by element, learning how a single XML file declares entity/bot constructors, defines HTTP endpoints with CDATA handlers, and wires together the entire bundle — with no TypeScript class written.

**Source DSL doc sections to adapt**:
- `getting-started-tutorial.md` → "Chapter 4: Bundling Everything Together with BundleML" → "Step 1: Create the Root Element", "Step 2: Add Configuration and Constructors", "Step 3: Define HTTP Endpoints", "Step 4: Add a Custom Method", "The Complete File"

**Code blocks to include**:
1. XML: `bundle.bundleml` — complete file (verbatim from injected context, not DESIGN.md variant)
2. Table (not a code block): CDATA handler context variables — `body`, `query`, `registry`, `logger` with descriptions; explicitly note `request` and `bundle` are NOT available
3. XML: The `<constructors>` section isolated and annotated with callouts explaining `type` vs `ref` attribute semantics

**Run and verify**:
```bash
curl http://localhost:3000/api/dsl-info | jq .
```
Expected:
```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

**Minimum word count**: 700

**Key writing constraints**:
- Explain `<entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>`: `type` is the registry name; `ref` is the filename that xml-bundle-server reads from the same directory as bundle.bundleml.
- CRITICAL: Use actual bundle content — route is `run-analysis` (no leading slash), handler uses `entity_factory.create_entity_node()` (not `registry.createEntity()`), response is `{ entity_id, status: 'pending' }` (not synchronous).
- CRITICAL: Name all 4 CDATA context vars. Explicitly call out that `request` and `bundle` are TypeScript-wiring-mode vars and are NOT available here.
- Note that the 4 endpoints (run-analysis, entity-status, latest-result, dsl-info) are all declared in BundleML — there is no TypeScript file defining routes.

---

### Part 3: Orchestrating AI with AgentML

**Title**: Orchestrating AI with AgentML

**What-you-build (1 sentence)**: Trace the 9-step execution sequence of `analysis-workflow.agentml` — from the 5 `<yield-status>` progress yields through the `<call-bot>` invocation, `<wm-set>` persistence, `<graph-append>` edge, and `<return>` — and verify that the live entity's progress array matches this sequence.

**Source DSL doc sections to adapt**:
- `getting-started-tutorial.md` → "Chapter 3: Orchestrating a Workflow with AgentML" → "Step 1: Create the File and Define Arguments", "Step 3: Call the Bot", "Step 4: Save Results to Working Memory", "Step 5: Record the Analysis in the Entity Graph", "Step 6: Return the Final Result", "Understanding the Execution Flow"
- `advanced-patterns-tutorial.md` → "Chapter 5: Working Memory Patterns" → "`<wm-set>` and `<wm-get>`", "Key Namespacing"
- `advanced-patterns-tutorial.md` → "Chapter 4: Entity Orchestration Patterns" → "`<call-entity>`: Creating Child Entities" (background context only — the demo uses call-bot not call-entity)

**Code blocks to include**:
1. XML: `analysis-workflow.agentml` — complete file (verbatim from injected context)
2. ASCII: 9-step execution sequence diagram (numbered steps showing yield/call/wm-set/graph-append/return order)
3. Shell: curl to verify progress in entity-status response

**Run and verify**:
```bash
# After submitting a request, poll entity-status and inspect the progress field
curl "http://localhost:3000/api/entity-status?id=<entity_id>" | jq '.progress'
```
Expected: array of 5 progress messages in order:
```json
[
  "Starting content analysis workflow",
  "Calling AnalyzerBot",
  "Saving results to working memory",
  "Updating entity graph",
  "Content analysis workflow complete"
]
```

**Minimum word count**: 750

**Key writing constraints**:
- Explain `<call-bot name="AnalyzerBot" result="analysis_result">`: the `result` attribute binds the bot's return value to the variable `analysis_result`; subsequent `<wm-set value="analysis_result"/>` references it by that name.
- Explain the actual `<call-bot>` in the bundle has 5 `<arg>` children including `<arg name="input" value="args"/>` — not just 4. The `input` arg maps the entire args object; the named args are explicit per-field copies. Explain why this matters for BotML's `input.*` interpolation (covered in Part 4).
- Explain the two expression forms: attribute form `value="args.topic"` (an expression evaluated at runtime) vs text-content form `"detailed"` (quotes make it a string literal expression).
- For `<graph-append>`: explain `target="self"` means the current entity node; `edge-type="ProducedAnalysis"` is a custom edge type stored in the entity graph.

---

### Part 4: Configuring LLM Behavior with BotML

**Title**: Configuring LLM Behavior with BotML

**What-you-build (1 sentence)**: Read through `analyzer-bot.botml` and `analyzer-prompt.promptml` to understand how BotML configures LLM temperature, model pool, and retry behavior, while embedded PromptML elements define the prompt structure — including a conditional that is always active in this demo.

**Source DSL doc sections to adapt**:
- `getting-started-tutorial.md` → "Chapter 2: Wrapping the Prompt in a Bot with BotML" → "Step 2: Configure LLM Options", "Step 3: Add the Structured Prompt Group", "The Complete File"
- `getting-started-tutorial.md` → "Chapter 1: Your First Prompt with PromptML" → "Step 3: Add a Conditional Instruction", "What This Produces"
- `advanced-patterns-tutorial.md` → "Chapter 1: Dynamic Prompts with Conditionals" → "`<if>` and `<else>`", "Conditional Text vs. Conditional Sections"

**Code blocks to include**:
1. XML: `analyzer-bot.botml` — complete file (verbatim from injected context)
2. XML: `analyzer-prompt.promptml` — complete file (verbatim), with a callout box: "This file is NOT auto-loaded by xml-bundle-server. It exists for documentation and TypeScript-wiring compatibility. The active prompt is the one inside `analyzer-bot.botml`."

**Run and verify**:
```bash
# The <if condition="args.mode === 'detailed'"> is always true in this bundle
# because analysis-workflow.agentml hardcodes <arg name="mode">"detailed"</arg>
# Verify by checking findings has explanatory detail
curl -X POST http://localhost:3000/api/run-analysis \
  -H "Content-Type: application/json" \
  -d '{"text":"The Fed raised rates by 25 basis points citing persistent inflation.","analysis_type":"general"}' | jq .
# Poll entity-status until complete, then inspect:
curl "http://localhost:3000/api/entity-status?id=<entity_id>" | jq '.result.findings'
```
Expected: array of at least 2 findings strings with explanatory content (not just labels), because `args.mode === 'detailed'` is always true.

**Minimum word count**: 800

**Key writing constraints**:
- CRITICAL: Explain `{{input.topic}}` vs `{{args.topic}}`. Inside BotML's `<structured-prompt-group>`, the `<call-bot>` arguments arrive under `input.*`. In the bundle, the AgentML passes `<arg name="input" value="args"/>` — so `input` IS the full args object, making `{{input.topic}}` resolve to the same value as `args.topic` in the AgentML context. This is a known source of confusion and must be explained clearly.
- Explain that `<structured-prompt-group>` with `<base>` and `<input>` separates stable system instructions (cacheable) from per-request user content (not cached).
- Point out the `analyzer-prompt.promptml` is a STANDALONE PromptML file showing the same prompt logic — but `bootstrapFromBundleML()` only processes `<entity>` and `<bot>` constructors, so this file is never loaded at runtime. The active prompt is embedded in the botml.
- Explain `max-tries="2"` on the `<bot>` element: if the LLM returns invalid JSON, the bot retries up to 2 times total.

---

### Part 5: Ship It — xml-bundle-server and the Fleet Model

**Title**: Ship It: xml-bundle-server and the Fleet Model

**What-you-build (1 sentence)**: Walk through the Kubernetes ConfigMap and Deployment manifests that ship all 4 DSL files to production, understand how `bootstrapFromBundleML()` bootstraps the entire server from a single `BUNDLE_PATH` environment variable, and see how the fleet model lets you swap bundles by swapping ConfigMaps — with zero image rebuilds.

**Source DSL doc sections to adapt**:
- `xml-e2e-bundle.md` → "TypeScript Wiring: agent-bundle.ts" → "The init() method — four-stage DSL loading" (for contrast — this is what the xml-dsl-demo does NOT need)
- `xml-e2e-bundle.md` → "Running the Example" → "Run locally" (command pattern reference)
- DESIGN.md Section 5 "Deployment Plan" → Kubernetes ConfigMap, Kubernetes Deployment, Helm Chart Structure, Local Development (all provided in injected context)

**Code blocks to include**:
1. YAML: `deploy/configmap.yaml` — the full ConfigMap embedding all 4 DSL files
2. YAML: `deploy/deployment.yaml` — the Deployment with `volumeMount` at `/config` and `BUNDLE_PATH` env var
3. Shell: helm install commands (from DESIGN.md Section 5)
4. Shell: health and readiness probe curl commands

**Run and verify**:
```bash
# Liveness and readiness checks (same endpoints K8s uses for probes)
curl http://localhost:3000/health | jq .
curl http://localhost:3000/ready | jq .
```
Expected:
```json
{ "status": "ok" }
```
```json
{ "status": "ready" }
```

**Minimum word count**: 650

**Key writing constraints**:
- CRITICAL: State explicitly that `bootstrapFromBundleML()` auto-loads `.agentml` and `.botml` files declared in `<constructors>`, but does NOT auto-load standalone `.promptml` files. The `analyzer-prompt.promptml` is in the ConfigMap for documentation completeness only.
- Show the fleet model concept concretely: "To deploy a different bundle, replace the ConfigMap data. The xml-bundle-server image is unchanged. Restart the pod to pick up the new ConfigMap."
- Include a concrete "no image rebuild" callout: adding a new `<endpoint>` to `bundle.bundleml`, updating the ConfigMap, and restarting the pod is the full deploy cycle — no `docker build`, no npm compile.
- Reference the GUI architecture (DESIGN.md Section 4 wireframe / component structure) by description and link to ff-demo-apps — do NOT reproduce Next.js code.

---

## Requirements Traceability Matrix

| Req ID | Intended Change | Testable Verification | Source Authority |
|--------|----------------|----------------------|-----------------|
| R01 | Create 6 new files in `tutorials/xml-dsl-demo/` | `ls` shows exactly 6 files | Phase instructions |
| R02 | README.md includes all Pattern 2 sections | grep each heading | Phase instructions (Pattern 2) |
| R03 | Tutorial Parts table column headers exact | diff against spec | P1 deliverable (02-context-gathering.md) |
| R04 | Each part ≥ 500 words | `wc -w` per file | Phase instructions |
| R05 | Zero TypeScript code blocks | grep `typescript\|\.ts` in code fences | DESIGN.md Section 7 (Zero-TS Invariant) |
| R06 | Each part ≥ 1 XML DSL code block | grep ` ```xml` count | Phase instructions |
| R07 | Each part has curl + expected output | grep curl in each part | Phase instructions |
| R08 | agent_sdk README updated | grep xml-dsl-demo | P1 deliverable (G3 gap) |
| R09 | dsl/README.md updated | grep xml-dsl-demo | P1 deliverable (G4 gap) |
| R10 | All relative links resolve | Manual link audit | Standard docs quality |
| DP01 | Part 5 states .promptml not auto-loaded | grep "NOT\|not auto" | DESIGN.md Section 2 PromptML note |
| DP02 | Part 2 names body/query/registry/logger, excludes request/bundle | grep in part-02.md | DESIGN.md Section 2 File 1 CRITICAL note |
| DP03 | Part 4 explains input.* vs args.* | grep "input\.\*" | DESIGN.md Section 3 File 3 key attributes |
| DP04 | Code blocks match actual bundle (no DESIGN.md variants) | diff against injected context | Injected actual DSL files |
| DP05 | No TypeScript bundle code reproduced | No `.ts` code blocks for bundle | DESIGN.md Section 7 |
| NFR01 | Tour tone, not build-from-scratch | No "create a new file" for DSL files | DESIGN.md Section 6 ("here's the thing running") |
| NFR02 | File names part-01.md through part-05.md (no slugs) | `ls` shows exact names | Phase instructions |
| NFR03 | Each part starts with `# Part N: Title` | grep line 1 of each file | Pattern from sibling tutorials |
| NFR04 | No GUI TypeScript code reproduced | grep `tsx\|jsx` in code fences | DP05 + DESIGN.md Section 7 |
| NFR05 | XML code blocks match actual bundle files | diff against injected content | DP04 |

---

## Removal Manifest

| Item | Status | Authorization |
|------|--------|---------------|
| `docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md` | Deleted in P0 (commit `7bf780d`) | Gate feedback P0: tutorial content prohibited before P0 orientation |
| `EVIDENCE.md` | Deleted in P0 (commit `7bf780d`) | Contained reference to retracted file |
| Reference entry from `dsl/examples/README.md` | Removed in P0 (commit `7bf780d`) | Pointed to retracted xml-dsl-demo.md |
| Reference entry from `agent_sdk/README.md` | Removed in P0 (commit `7bf780d`) | Pointed to retracted xml-dsl-demo.md |

No additional files are deleted in P5 (writing phase). The `agent_sdk/README.md` and `dsl/README.md` changes in P5 are ADDS (1-line each), not deletions.

**Anti-goal cross-check**: R08 and R09 add new entries to existing README files. No existing entries are removed. DP05 prohibits TypeScript bundle code but does NOT require removing any existing TypeScript documentation elsewhere.

---

## Module Surface Declarations

### [docs-content] terminology/glossary alignment

The following terms are used in the tutorial and must align with the existing glossary in `fire_foundry_core_concepts_glossary_agent_sdk.md`:

| Term used in tutorial | Expected glossary alignment |
|-----------------------|-----------------------------|
| entity | FireFoundry entity (persistent business object in the entity graph) |
| bot | FireFoundry bot (stateless reusable AI behavior unit) |
| bundle | Agent bundle (deployment container of entities + bots + endpoints) |
| xml-bundle-server | The zero-TypeScript bundle runtime (no glossary entry expected — explain inline) |
| working memory | Entity working memory (key-value store local to an entity instance) |
| entity graph | FireFoundry entity graph (graph database of entity nodes and edges) |
| fleet model | Term coined in DESIGN.md — "one xml-bundle-server image, many bundles via ConfigMap swap" (explain inline in Part 1 and Part 5) |
| bootstrapFromBundleML() | Internal function — not a public API. Explain behavior without implying it is user-callable. |

### [docs-content] structural spec — R@std+

The tutorial series must satisfy the following structural invariants:

1. **README → parts navigation**: README `## Tutorial Parts` table links `[1](./part-01.md)` through `[5](./part-05.md)`.
2. **Part file isolation**: Each part is self-contained. A reader starting at Part 3 must not need to have completed Parts 1–2 to understand the content. Cross-references to earlier parts are permitted but not required.
3. **No forward references to unreleased content**: Part 5 must not reference the optional Part 6 ("Fork It") — that part is out of scope.
4. **DSL composition order preserved**: The tutorial order (BundleML → AgentML → BotML+PromptML → Deployment) differs from the getting-started-tutorial.md order (PromptML → BotML → AgentML → BundleML). This is intentional: the demo tour starts from the manifest (top-down), not from primitives (bottom-up).
5. **Source Code section link**: Must link to `https://github.com/firebrandanalytics/ff-demo-apps` under `xml-dsl-demo/`. Exact commit/branch is UNKNOWN — link to the repository root, not a specific commit.

---

## context_docs

[]
