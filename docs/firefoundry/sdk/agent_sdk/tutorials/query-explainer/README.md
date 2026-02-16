# SQL Query Analyzer Tutorial

Build a tool-calling agent that analyzes SQL queries for both performance bottlenecks and semantic meaning. The agent calls the **Data Access Service (DAS)** to get real execution plans, schema information, and data dictionary annotations, then uses an LLM to synthesize a structured analysis.

## What You'll Learn

- Building a dispatch table with real external service calls (not mock data)
- Creating an HTTP client wrapper for the Data Access Service
- Using `ComposeMixins` to combine `MixinBot` with `StructuredOutputBotMixin`
- Designing system prompts that instruct the LLM to call tools before answering
- Validating LLM output with Zod schemas
- Consuming iterator envelopes (finding the `VALUE` envelope)
- Building a Next.js GUI with async polling for results

## What You'll Build

An agent bundle with:

- **DASClient** -- HTTP client for the Data Access Service (EXPLAIN, dictionary, schema endpoints)
- **QueryExplainerBot** -- tool-calling bot that gathers DAS data and produces structured analysis
- **QueryExplainerEntity** -- entity that delegates to the bot via `BotRunnableEntityMixin`
- **Custom API endpoints** -- `POST /api/analyze-query` and `GET /api/query-status`
- **Next.js Web UI** -- SQL input form with polling-based result display

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Access to a running **Data Access Service** with the FireKicks dataset
  - See the [DAS Getting Started guide](../../../platform/services/data-access/getting-started.md)
  - See the [FireKicks Tutorial](../../../platform/services/data-access/firekicks/README.md) for the sample dataset
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-setup.md) | Project Setup | Scaffolding, monorepo structure, shared types, Zod output schema |
| [Part 2](./part-02-das-client.md) | The DAS Client | HTTP client wrapper, auth headers, DAS API endpoints, environment config |
| [Part 3](./part-03-tools.md) | Defining Tools | Dispatch table pattern, `inputSchema` format, error-as-return, four DAS tools |
| [Part 4](./part-04-prompt-and-bot.md) | Prompt & Bot | System prompt for tool use, `ComposeMixins`, `StructuredOutputBotMixin`, `get_semantic_label` workaround |
| [Part 5](./part-05-entity-and-bundle.md) | Entity & Bundle | `BotRunnableEntityMixin`, `@ApiEndpoint`, iterator VALUE envelope, fire-and-forget |
| [Part 6](./part-06-deploy-and-test.md) | Deploy & Test | Environment variables, port-forwards, curl testing, common issues |
| [Part 7](./part-07-web-ui.md) | Web UI | Next.js GUI, server-side bundle client, API route proxies, polling pattern |

## Architecture Overview

```
User submits SQL query
       |
       v
  GUI (Next.js)  ──or──  curl
       |
       v
  POST /api/analyze-query
       |
       v
QueryExplainerAgentBundle
       |
       v
QueryExplainerEntity.start()  (via BotRunnableEntityMixin)
       |
       |-- Looks up QueryExplainerBot from registry
       |-- Passes SQL + connection as input
       |
       v
QueryExplainerBot (tool-calling + structured output)
       |
       |-- Calls explain_query → DAS EXPLAIN ANALYZE
       |-- Calls get_dictionary_tables → business names, tags
       |-- Calls get_dictionary_columns → column semantics
       |-- Calls get_schema → types, keys, relationships
       |-- Synthesizes structured JSON output
       |
       v
Structured Analysis
  { performance: { summary, bottlenecks, suggestions },
    semantics: { business_question, tables_used, relationships } }
```

## Diagnostic Tools

| Tool | Purpose |
|------|---------|
| `ff-sdk-cli` | Call API endpoints, invoke entity methods, check health |
| `ff-eg-read` | Inspect QueryExplainerEntity nodes and their data |
| `ff-telemetry-read` | Trace broker requests, view tool call sequences |
| `curl` | Test bundle endpoints directly during development |

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `query-explainer/`.

## Related

- [News Analysis Tutorial](../news-analysis/README.md) -- beginner tutorial covering `StructuredOutputBotMixin` and entity relationships
- [Report Generator Tutorial](../report-generator/README.md) -- advanced tutorial covering the full entity/bot/prompt stack
- [Tool Calling Feature Guide](../../feature_guides/ad_hoc_tool_calls.md) -- reference guide for dispatch table patterns
- [Data Access Service Docs](../../../platform/services/data-access/README.md) -- DAS API reference

---

**Ready to start?** Head to [Part 1: Project Setup](./part-01-setup.md).
