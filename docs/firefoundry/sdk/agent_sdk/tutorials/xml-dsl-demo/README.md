# Exploring the XML DSL Content Analyzer

A guided tour of a live FireFoundry demo that runs a complete AI analysis workflow using zero hand-written TypeScript bundle code. Every behavior — HTTP endpoints, entity workflows, LLM configuration, and structured prompts — is declared in XML DSL files and served by a single pre-built Docker image.

## What You'll Learn

This is not a build-from-scratch tutorial — the [Getting Started Tutorial](../../dsl/getting-started-tutorial.md) covers that. This series tours a running system so you can see how all four FireFoundry XML DSLs compose in production.

By the end of this series, you will understand:

- How `bundle.bundleml` wires HTTP endpoints, entity constructors, and bot constructors into a runnable bundle
- How `analysis-workflow.agentml` defines a multi-step async workflow with progress streaming
- How `analyzer-bot.botml` configures the LLM and embeds prompt logic inline using PromptML elements
- How the xml-bundle-server fleet model deploys any bundle with zero code and a single `BUNDLE_PATH` environment variable

## Prerequisites

- Docker installed locally (for Part 1–4) or access to a Kubernetes cluster with Helm (for Part 5)
- A web browser for verifying GET endpoints; the demo GUI at `http://localhost:4000` for POST-based verification
- Familiarity with [FireFoundry core concepts](../../fire_foundry_core_concepts_glossary_agent_sdk.md) is helpful but not required

## Tutorial Parts

| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|-------------|
| [1](./part-01.md) | Run It, See It, Believe It | Run the demo locally and read your first async analysis result | `BUNDLE_PATH`, fleet model, async entity polling |
| [2](./part-02.md) | Wiring It All Together with BundleML | Understand every element of `bundle.bundleml` | `<constructors>`, `<endpoints>`, CDATA handler context (`body`/`query`/`registry`/`logger`) |
| [3](./part-03.md) | Orchestrating AI with AgentML | Trace the full execution path of `analysis-workflow.agentml` | `<yield-status>`, `<call-bot>`, `<wm-set>`, `<graph-append>`, `<return>` |
| [4](./part-04.md) | Configuring LLM Behavior with BotML | Read `analyzer-bot.botml` and its inline PromptML prompt | `<structured-prompt-group>`, `input.*` vs `args.*`, `<if>` conditionals |
| [5](./part-05.md) | Ship It: xml-bundle-server and the Fleet Model | Deploy the bundle to Kubernetes via ConfigMap | ConfigMap-as-bundle, `bootstrapFromBundleML()`, Helm, health probes |

## How to Use This Tutorial

**Sequential approach**: Parts 1–5 build understanding progressively. Start at Part 1 if you are new to the XML DSL system or xml-bundle-server.

**Reference approach**: Each part is self-contained by DSL. Jump to Part 2 for BundleML, Part 3 for AgentML, Part 4 for BotML and PromptML, or Part 5 for deployment details.

## Architecture Overview

```
[Browser GUI]
        |
        | POST /api/run-analysis  (returns { entity_id, status: 'pending' })
        | GET  /api/entity-status?id=<entity_id>  (poll until complete)
        v
[xml-bundle-server]
  ┌─ bundle.bundleml ──────────────────────────────────────────┐
  │  <constructors>                                             │
  │    <entity type="AnalysisWorkflow"                         │
  │            ref="analysis-workflow.agentml"/>                │
  │    <bot type="AnalyzerBot"                                  │
  │         ref="analyzer-bot.botml"/>                         │
  │  <endpoints>                                                │
  │    POST run-analysis   → entity_factory.create_entity_node │
  │    GET  entity-status  → polls entity service              │
  │    GET  latest-result  → returns cached last result         │
  │    GET  dsl-info       → lists loaded DSL components        │
  └────────────────────────────────────────────────────────────┘
        |
        | (entity runs background via runBackground())
        v
  analysis-workflow.agentml
    <yield-status> x5  (progress streaming)
    <call-bot name="AnalyzerBot"> ──────────────────────────────┐
    <wm-set>  (save result to working memory)                   │
    <graph-append>  (record ProducedAnalysis edge)              │
    <return value="analysis_result"/>                           │
                                                                │
                                          analyzer-bot.botml ◄─┘
                                            <llm-options temperature="0.3">
                                            <model-pool>firebrand_completion_default
                                            <structured-prompt-group>
                                              <base>  (system prompt — inline PromptML)
                                              <input> (user prompt — {{input.topic}})

[Kubernetes ConfigMap at /config/]
  bundle.bundleml
  analysis-workflow.agentml
  analyzer-bot.botml
  analyzer-prompt.promptml  ← included for docs; NOT auto-loaded at runtime
```

## Diagnostic Tools

Once the demo is running (see Part 1 for setup), these steps verify each layer of the stack.

**Verify the bundle is loaded and all DSLs are registered:**
Open `http://localhost:3000/api/dsl-info` in your browser. Expected:
```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

**Submit an analysis and observe the result:**
Open the demo GUI at `http://localhost:4000`. Paste sample text into the **Text** field, select an analysis type, and click **Analyze**. The GUI submits to `run-analysis`, receives `{ "entity_id": "...", "status": "pending" }` immediately, and polls `entity-status` automatically until the result appears.

Expected result fields: `summary`, `topic`, `sentiment` (one of `"positive"`, `"negative"`, `"neutral"`), `findings` (array), `confidence` (0–1).

**Retrieve the most recent result without an entity ID:**
Open `http://localhost:3000/api/latest-result` in your browser after running at least one analysis.

## Source Code

The complete bundle DSL files are available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `xml-dsl-demo/apps/xml-dsl-bundle/dsl/`.

---

**Ready to start?** Head to [Part 1: Run It, See It, Believe It](./part-01.md).
