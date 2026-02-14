# News Impact Analyzer Tutorial

Build a web search and AI analysis agent bundle with a web UI. You'll create entities that search the web for news articles on any topic, run structured AI impact analysis across business verticals, and display results in a Next.js frontend.

## What You'll Learn

- Calling platform services (web search) from entity code
- Creating entity-to-entity relationships with graph edges
- Using `StructuredOutputBotMixin` with Zod schemas for validated LLM output
- Composing entities with `AddMixins` and `BotRunnableEntityMixin` for automatic bot execution
- Designing prompts with `PromptTemplateSectionNode` and `PromptTemplateStructDataNode`
- Building custom API endpoints with `@ApiEndpoint`
- Connecting a Next.js GUI to an agent bundle

## What You'll Build

An agent bundle with two entity types:

- **SearchEntity** -- runs web searches and orchestrates article creation
- **ArticleEntity** -- stores article metadata and runs AI impact analysis via a registered bot

Plus a Next.js web UI where users enter a topic, see analyzed articles with color-coded impact badges across Healthcare, Logistics, and Technology verticals, and browse past searches.

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-bundle.md) | Bundle & Web Search | Scaffolding, SearchEntity, ArticleEntity, web search integration, entity relationships, API endpoints, deploy and test |
| [Part 2](./part-02-analysis.md) | AI Analysis | Zod schemas, ImpactAnalysisPrompt, ImpactAnalysisBot with StructuredOutputBotMixin, BotRunnableEntityMixin, bot-entity wiring |
| [Part 3](./part-03-gui.md) | Web UI | Next.js GUI, server-side bundle client, API route proxies, search page with impact badges |

## Architecture Overview

```
User enters topic
       |
       v
  GUI (Next.js)
       |
       v
  POST /api/search
       |
       v
SearchEntity.run_search(query)
       |
       |-- Calls web search service
       |-- Creates ArticleEntity per result
       |-- Creates "Contains" edges
       |-- Triggers analysis on each article
       |
       v
ArticleEntity.run()  (via BotRunnableEntityMixin)
       |
       |-- Looks up ImpactAnalysisBot from registry
       |-- Builds input from title + snippet
       |-- Runs bot → validated JSON output
       |
       v
Structured Impact Analysis
  (per-vertical scores, reasoning, key factors)
```

## Diagnostic Tools

| Tool | Purpose |
|------|---------|
| `ff-sdk-cli` | Call API endpoints, invoke entity methods, check health |
| `ff-eg-read` | Inspect SearchEntity and ArticleEntity nodes, view edges |
| `ff-telemetry-read` | Trace broker requests for LLM analysis calls |

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `news-analysis/`.

## Related

- [File Upload Tutorial](../file-upload/README.md) -- beginner tutorial covering file handling and Working Memory
- [Report Generator Tutorial](../report-generator/README.md) -- advanced tutorial covering the full entity/bot/prompt stack
- [StructuredOutputBotMixin Reference](../../reference/structured-output-bot-mixin.md) -- API reference for structured output bots

---

**Ready to start?** Head to [Part 1: Bundle & Web Search](./part-01-bundle.md).
