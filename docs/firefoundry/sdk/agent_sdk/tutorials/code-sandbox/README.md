# Code Sandbox Tutorial

Imagine asking a question in plain English -- *"What is the average order value by customer segment?"* -- and getting back a precise, data-driven answer seconds later. Behind the scenes, an LLM writes Python code, executes it against a real database, and returns the result. No notebooks, no manual queries, no context-switching.

That's what you'll build in this tutorial: an AI-powered agent that turns natural language into executable code, runs it in a secure sandbox, and hands back structured results. You'll actually build two agents -- a **TypeScript bot** for general computation and a **Python data science bot** that queries a live database using pandas, numpy, and the Data Access Service (DAS).

By the end, you'll have a working REST API where you can POST a question like *"Which customer segment has the highest return rate?"* and get back a JSON response with the answer.

## What You'll Learn

- Turning natural language prompts into executable code with `GeneralCoderBot`
- Writing domain prompts that provide schema context and data access instructions
- Using **profiles** as the single source of truth for language, runtime, harness, and DAS connections
- Wiring entities to bots with `BotRunnableEntityMixin` and `@RegisterBot`
- Executing generated code safely in the Code Sandbox Service
- Building custom API endpoints with `@ApiEndpoint`

## What You'll Build

An agent bundle with two endpoints:

- **`POST /api/execute`** -- accepts a natural language prompt, generates TypeScript code, executes it, and returns the result
- **`POST /api/analyze`** -- accepts a data science question, generates Python+pandas code that queries a database via DAS, and returns the analysis

Under the hood:

| Component | Purpose |
|-----------|---------|
| **DemoCoderBot** | Generates and executes TypeScript via the `finance-typescript` profile |
| **DemoDataScienceBot** | Generates and executes Python via the `firekicks-datascience` profile, with a domain prompt providing schema and DAS context |
| **CodeTaskEntity** | Orchestrates TypeScript code generation + execution |
| **DataScienceTaskEntity** | Orchestrates Python data science analysis |

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment with Code Sandbox Service)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-setup.md) | Project Setup | Scaffolding with ff-cli, SDK dependency wiring, project structure |
| [Part 2](./part-02-prompt.md) | The Domain Prompt | CoderBot intrinsic prompts, domain prompt design, schema context, DAS instructions |
| [Part 3](./part-03-bot.md) | The Bot | GeneralCoderBot, profile-driven constructor, @RegisterBot |
| [Part 4](./part-04-entity-and-bundle.md) | Entity & Bundle | CodeTaskEntity, DataScienceTaskEntity, BotRunnableEntityMixin, agent bundle wiring, API endpoints |
| [Part 5](./part-05-deploy-and-test.md) | Deploy & Test | Local cluster setup, deployment with ff-cli, testing with curl |

## Architecture Overview

```
User sends prompt (natural language)
       |
       v
  POST /api/execute  or  POST /api/analyze
       |                       |
       v                       v
CoderBundleAgentBundle    CoderBundleAgentBundle
       |                       |
       v                       v
CodeTaskEntity.run()     DataScienceTaskEntity.run()
       |                       |
       v                       v
DemoCoderBot             DemoDataScienceBot
  (TypeScript)              (Python)
       |                       |
       |-- profile:            |-- profile:
       |   finance-typescript  |   firekicks-datascience
       |-- intrinsic prompt    |-- intrinsic prompt
       |-- LLM call            |-- domain prompt (schema)
       |                       |-- LLM call
       v                       v
Code Sandbox Service     Code Sandbox Service
  profile:                 profile:
  "finance-typescript"     "firekicks-datascience"
       |                       |
       v                       v
  TypeScript harness       Python harness
  (isolated execution)     (DAS -> database queries)
       |                       |
       v                       v
Execution Result         Execution Result
  { description,           { description,
    result,                  result,
    stdout }                 stdout }
```

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `code-sandbox/`.

## Related

- [News Analysis Tutorial](../news-analysis/README.md) -- beginner tutorial covering StructuredOutputBotMixin and entity relationships
- [Illustrated Story Tutorial](../illustrated-story/README.md) -- tutorial covering multi-step workflows and image generation
- [Bot Tutorial](../../core/bot_tutorial.md) -- comprehensive bot development guide

---

**Ready to start?** Head to [Part 1: Project Setup](./part-01-setup.md).
