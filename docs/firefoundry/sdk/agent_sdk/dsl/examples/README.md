# DSL Examples

This section contains annotated examples demonstrating the FireFoundry XML DSL system in practice. Each example includes the full source files, line-by-line explanations, and guidance on how to extend the patterns for your own use cases.

## Available Examples

### [XML E2E Bundle Walkthrough](xml-e2e-bundle.md)

A complete end-to-end agent bundle that exercises all four XML DSLs together. This is the primary reference example for understanding how PromptML, BotML, AgentML, and BundleML work in concert within a single deployed bundle.

**What it demonstrates:**

- A standalone PromptML prompt with conditional content and interpolation
- A BotML bot configuration with inline structured prompts and LLM settings
- An AgentML workflow that calls the bot, writes to working memory, and updates the entity graph
- A BundleML manifest declaring constructors, HTTP endpoints, and custom methods
- TypeScript wiring that parses all four DSL files, registers components, and exposes API endpoints

**Bundle architecture:**

```
POST /run-analysis
  --> XMLE2EAgentBundle.runAnalysis()
    --> EntityFactory creates XMLRunnableEntity("AnalysisWorkflow")
      --> AgentML interpreter executes analysis-workflow.agentml
        --> <call-bot name="AnalyzerBot"> invokes the BotML-defined bot
          --> Bot uses inline PromptML prompts to call the LLM
        --> <wm-set> stores results in working memory
        --> <graph-append> records the analysis in the entity graph
        --> <return> sends the result back through the async generator
```

**Source files covered:**

| File | DSL | Purpose |
|---|---|---|
| `analyzer-prompt.promptml` | PromptML | Standalone prompt with conditionals |
| `analyzer-bot.botml` | BotML | Bot with LLM settings and inline prompts |
| `analysis-workflow.agentml` | AgentML | Workflow orchestrating the analysis pipeline |
| `bundle.bundleml` | BundleML | Bundle manifest with endpoints and constructors |
| `agent-bundle.ts` | TypeScript | Wiring class that loads and registers all DSL components |

## Patterns Index

The E2E bundle walkthrough demonstrates these key patterns. Use this index to find specific patterns within the walkthrough.

**Prompt patterns:**

- **Conditional prompt content** -- using `<if condition="...">` to include or exclude prompt text based on runtime arguments (see the PromptML section)
- **Interpolation** -- using `{{variable}}` markers for runtime value substitution in text elements (see the PromptML and BotML sections)
- **Structured prompt groups** -- organizing prompts into `<base>` and `<input>` sections for prompt caching (see the BotML section)
- **Dual prompt registration** -- the same prompt logic appears both standalone and inline within BotML (see the TypeScript wiring section)

**Workflow patterns:**

- **Bot result capture** -- using `<call-bot result="variable">` to store LLM output in a workflow variable
- **Working memory persistence** -- using `<wm-set>` to persist results for later retrieval
- **Entity graph edges** -- using `<graph-append>` with dynamic data fields to record relationships
- **Progress envelopes** -- using `<yield-status>` to emit real-time status updates through the async generator
- **Expression evaluation** -- using `<expr>` for inline expressions like `new Date().toISOString()`

**Bundle patterns:**

- **BundleML validation** -- parsing and validating the bundle manifest before component registration
- **Constructor mapping** -- declaring entity-to-file and bot-to-file relationships in `<constructors>`
- **CDATA endpoint handlers** -- inline JavaScript in BundleML endpoint definitions

**Wiring patterns:**

- **Four-stage init** -- the TypeScript class loads BundleML, AgentML, BotML, and PromptML in sequence
- **ComponentRegistry convergence** -- all components register in a shared singleton and are verified at startup
- **Dual bot registration** -- registering bots in both the `ComponentRegistry` and the legacy `FFAgentBundle.registerBot` for compatibility

## See Also

- [DSL Overview](../) -- architecture, design rationale, and the quick four-file example
- [Reference Guides](../reference/) -- complete element and attribute reference for each DSL
