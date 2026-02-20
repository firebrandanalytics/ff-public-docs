# Code Sandbox Tutorial

Imagine asking a question in plain English -- *"What is the average order value by customer segment?"* -- and getting back a precise, data-driven answer seconds later. Behind the scenes, an LLM writes Python code, executes it against a real database, and returns the result. No notebooks, no manual queries, no context-switching.

That's what you'll build in this tutorial: an AI-powered agent that turns natural language into executable code, runs it in a secure sandbox, and hands back structured results. You'll build two agents -- a **TypeScript bot** for general computation and a **Python data science bot** that queries a live database -- plus a **web GUI** for interacting with them.

## What is the Code Sandbox?

The **Code Sandbox Service** is a FireFoundry platform service that provides secure, isolated code execution for AI agents. When an LLM generates code, the sandbox compiles it, runs it in an isolated environment, and returns structured results -- all without exposing raw credentials or allowing untrusted code to affect other services.

Key capabilities:
- **Isolated execution** -- each code run gets its own sandboxed environment
- **Profile-based configuration** -- named profiles bundle runtime, harness, and data connections
- **Data Access Service (DAS) integration** -- generated code can query databases through the DAS proxy without handling credentials directly
- **TypeScript and Python runtimes** -- profiles specify the target language and execution harness

For a deeper look at the architecture, security model, and configuration options, see the [Code Sandbox Service documentation](../../platform/services/code-sandbox.md).

## What You'll Learn

- Turning natural language prompts into executable code with `GeneralCoderBot`
- Writing structured domain prompts using the prompt framework (`PromptTemplateSectionNode`, `PromptTemplateListNode`)
- Using **profiles** as the single source of truth for language, runtime, harness, and DAS connections
- Wiring entities to bots with `BotRunnableEntityMixin` and `@RegisterBot`
- Building custom API endpoints with `@ApiEndpoint`
- Building a Next.js web GUI that communicates with the agent bundle

## What You'll Build

An agent bundle with two endpoints and a web interface:

- **`POST /api/execute`** -- accepts a natural language prompt, generates TypeScript code, executes it, and returns the result
- **`POST /api/analyze`** -- accepts a data science question, generates Python+pandas code that queries a database via DAS, and returns the analysis
- **Web GUI** -- a browser-based interface for entering prompts, switching between modes, and viewing results

Under the hood:

| Component | Purpose |
|-----------|---------|
| **DemoCoderBot** | Generates and executes TypeScript via the `finance-typescript` profile |
| **DemoDataScienceBot** | Generates and executes Python via the `firekicks-datascience` profile, with a structured domain prompt |
| **CodeTaskEntity** | Orchestrates TypeScript code generation + execution |
| **DataScienceTaskEntity** | Orchestrates Python data science analysis |

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster with Code Sandbox Service deployed
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-setup.md) | Project Setup | Scaffolding with ff-cli, project structure, first deploy |
| [Part 2](./part-02-prompt.md) | The Domain Prompt | Prompt framework, PromptTemplateSectionNode, domain prompt design |
| [Part 3](./part-03-bot.md) | The Bot | GeneralCoderBot, profile-driven constructor, @RegisterBot |
| [Part 4](./part-04-entity-and-bundle.md) | Entity & Bundle | BotRunnableEntityMixin, API endpoints, entity-bot wiring |
| [Part 5](./part-05-deploy-and-test.md) | Deploy & Test | Final deployment, testing both endpoints, troubleshooting |
| [Part 6](./part-06-gui.md) | Web GUI | Next.js interface, API route proxying, result display |

## Architecture Overview

```
User sends prompt (natural language)
       |
       v
  Web GUI  or  ff-sdk-cli
       |
       v
  POST /api/execute  or  POST /api/analyze
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

- [Code Sandbox Service](../../platform/services/code-sandbox.md) -- platform service documentation
- [News Analysis Tutorial](../news-analysis/README.md) -- beginner tutorial covering StructuredOutputBotMixin and entity relationships
- [Bot Tutorial](../../core/bot_tutorial.md) -- comprehensive bot development guide

---

**Ready to start?** Head to [Part 1: Project Setup](./part-01-setup.md).
