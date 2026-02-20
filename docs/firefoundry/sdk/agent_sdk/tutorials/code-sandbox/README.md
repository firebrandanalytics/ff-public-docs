# Code Sandbox Tutorial

Build a code generation and execution agent bundle using the CoderBot hierarchy and Code Sandbox Service. The bundle includes two bots: a TypeScript bot for general computation and a Python data science bot that queries a database through the Data Access Service (DAS).

## What You'll Learn

- Using the `GeneralCoderBot` variant for language-configurable code generation
- Creating prompts that produce the two-block output format CoderBot expects (JSON metadata + code block)
- Building a data science prompt with database schema context and DAS query instructions
- Configuring **profiles** for sandbox execution (runtime, harness, and DAS connections)
- Wiring entities to bots with `BotRunnableEntityMixin` and `@RegisterBot`
- Configuring working memory paths for code storage before sandbox execution
- Integrating with the Code Sandbox Service via `@firebrandanalytics/ff-sandbox-client`
- Building custom API endpoints with `@ApiEndpoint`

## What You'll Build

An agent bundle with:

- **CodeTaskEntity** -- stores the user prompt and orchestrates TypeScript code generation + execution
- **DataScienceTaskEntity** -- stores the user prompt and orchestrates Python data science analysis
- **DemoCoderBot** -- a `GeneralCoderBot` that generates and executes TypeScript code using the `finance-typescript` profile
- **DemoDataScienceBot** -- a `GeneralCoderBot` that generates Python+pandas code, queries a database via DAS, and returns analysis results using the `firekicks-datascience` profile
- **CoderPrompt** -- instructs the LLM to produce JSON metadata and a TypeScript code block
- **DataScienceCoderPrompt** -- instructs the LLM to produce Python code that queries via DAS and performs data analysis

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment with Code Sandbox Service)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-setup.md) | Project Setup | Scaffolding with ff-cli, SDK dependency wiring, project structure |
| [Part 2](./part-02-prompt.md) | The Prompt | CoderBot output format, PromptTemplateSectionNode, CoderPrompt, DataScienceCoderPrompt |
| [Part 3](./part-03-bot.md) | The Bot | GeneralCoderBot, SandboxClient, profiles, @RegisterBot |
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
       |-- CoderPrompt         |-- DataScienceCoderPrompt
       |-- LLM call            |-- LLM call
       |                       |
       v                       v
Code Sandbox Service     Code Sandbox Service
  profile:                 profile:
  "finance-typescript"     "firekicks-datascience"
       |                       |
       v                       v
  TypeScript harness       Python harness
  (isolated execution)     (DAS → database queries)
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
