# Building an AI Code Execution Agent

A progressive tutorial that takes you from an empty project to a complete AI-powered code execution platform. Each part builds on the previous one, adding new capabilities while always resulting in a working, deployable application.

## What You'll Build

Imagine your users asking questions in plain English -- *"What is the average order value by customer segment?"* -- and getting back precise, data-driven answers seconds later. Behind the scenes, an LLM writes Python code, executes it against a real database, and returns the result. No notebooks, no manual queries, no context-switching.

By the end of this series, you'll have a complete **AI Code Execution Agent** that:

- Accepts natural language prompts from users via REST API or web GUI
- Generates TypeScript or Python code using an LLM
- Executes generated code in a secure, isolated sandbox
- Queries databases through the Data Access Service (DAS)
- Fetches database schema dynamically -- no hardcoded table definitions
- Returns structured results to the user

You define the *problem space* (what data is available, how to access it, what rules to follow). The agent handles whatever *problem* your users submit.

## Prerequisites

- [FireFoundry local development environment](../../../local-development/README.md) or access to a deployed FireFoundry cluster
- [ff-cli installed and configured](../../../local-development/ff-cli-setup.md)
- Node.js 20+
- Basic TypeScript knowledge
- Familiarity with [FireFoundry core concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md) (recommended but not required)

## Tutorial Parts

| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|--------------|
| [1](./part-01-first-code-execution.md) | Your First Code Execution | A working endpoint that generates and executes TypeScript from a prompt | GeneralCoderBot, profiles, entity-bot wiring, `@ApiEndpoint` |
| [2](./part-02-data-science-and-domain-prompts.md) | Adding Data Science with Domain Prompts | A second endpoint that generates Python to query a database via DAS | Domain prompts, prompt framework, `PromptTemplateSectionNode`, DAS |
| [3](./part-03-dynamic-schema.md) | Dynamic Schema from DAS | Bot that fetches live database schema and injects it into its prompt | DAS schema introspection, dynamic init, prompt group access |
| [4](./part-04-web-gui.md) | Building a Web GUI | Browser-based interface for entering prompts and viewing results | Next.js, API route proxying, thin-proxy pattern |
| [5](./part-05-deployment-and-testing.md) | Deployment, Testing & Troubleshooting | Full deployment with testing and diagnostics | `ff-sdk-cli`, `ff-eg-read`, `ff-telemetry-read`, troubleshooting |

## How to Use This Tutorial

**Sequential approach**: Each part builds directly on the previous one. Start at Part 1 and work through in order.

**Testing at every step**: Every part ends with a deployable application. We use `ff-sdk-cli` throughout for testing without needing a GUI.

## What is the Code Sandbox?

The **Code Sandbox Service** is a FireFoundry platform service that provides secure, isolated code execution for AI agents. When an LLM generates code, the sandbox compiles it, runs it in an isolated environment, and returns structured results -- all without exposing raw credentials or allowing untrusted code to affect other services.

Key capabilities:
- **Isolated execution** -- each code run gets its own sandboxed environment
- **Profile-based configuration** -- named profiles bundle runtime, harness, and data connections
- **Data Access Service (DAS) integration** -- generated code can query databases through the DAS proxy without handling credentials directly
- **TypeScript and Python runtimes** -- profiles specify the target language and execution harness

For architecture and configuration details, see the [Code Sandbox Service documentation](../../platform/services/code-sandbox.md).

## Architecture Overview

Here's how the final application is structured:

```
User enters prompt (natural language)
       |
       v
  Web GUI  or  ff-sdk-cli
       |
       v
  POST /api/execute  or  POST /api/analyze
       |                       |
       v                       v
CodeTaskEntity           DataScienceTaskEntity
       |                       |
       v                       v
DemoCoderBot             DemoDataScienceBot
  (TypeScript)              (Python)
       |                       |
       |-- profile:            |-- profile:
       |   finance-typescript  |   firekicks-datascience
       |-- intrinsic prompt    |-- intrinsic prompt
       |-- LLM generates code  |-- domain prompt (schema from DAS)
       |                       |-- LLM generates code
       v                       v
Code Sandbox Service     Code Sandbox Service
       |                       |
       v                       v
  TypeScript execution     Python execution
  (isolated sandbox)       (DAS -> database queries)
       |                       |
       v                       v
  Structured result        Structured result
```

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `code-sandbox/`.

## Related

- [Code Sandbox Service](../../platform/services/code-sandbox.md) -- platform service documentation
- [Report Generator Tutorial](../report-generator/README.md) -- beginner tutorial covering entities, bots, structured output, and working memory
- [Illustrated Story Tutorial](../illustrated-story/README.md) -- intermediate tutorial covering multi-bot pipelines and parallel execution

---

**Ready to start?** Head to [Part 1: Your First Code Execution](./part-01-first-code-execution.md).
