# Code Sandbox Service

## Overview

The Code Sandbox lets your agent bundles run TypeScript code, typically code written by an LLM, in an isolated environment. That code can query your databases, work with tabular data, and render charts. Your bundle sends code to the sandbox and gets back a structured result: the value the code returned, its console output, and any compilation or runtime errors.

## Purpose and Role in Platform

Use the Code Sandbox when an agent needs to compute an answer rather than just generate text. Typical examples:

- **Analytics assistants**: the LLM writes a query plus some post-processing, the sandbox runs it against your data, and the bot explains the result.
- **Text-to-SQL with verification**: generated SQL runs in the `sql` harness, and the rows come back for the bot to check or summarize.
- **Charts and reports**: generated code builds a Chart.js chart or Canvas image from query results.
- **Data transformation**: DataFrame-style reshaping and statistics over rows your bundle already has.

The key design property is **credential isolation**. Generated code never sees connection strings or passwords. The sandbox opens the database connections your environment has configured and passes ready-to-use adapters into the code.

## Key Features

- **TypeScript execution**: code is compiled and run, and compile errors come back as structured errors.
- **Harnesses**: predefined execution contexts (`finance` for analytical code, `sql` for query execution) that define which function your code must export.
- **Injected database access**: named, pre-authenticated database adapters (PostgreSQL, Databricks, SQL Server, MySQL, Oracle, Snowflake).
- **Bundled libraries**: `dataframe-js`, `simple-statistics`, `chart.js`, and `canvas` are available to executed code.
- **Streaming progress**: optional streamed events for compilation and execution status.
- **Working memory input**: run code stored in a Context Service working memory document instead of sending it inline.
- **Client library and MCP tool**: call it from a bundle with the TypeScript client, or from MCP-capable agents through the MCP Gateway.

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Your agent bundle (bot generates code)      │
└──────────────────┬───────────────────────────┘
                   │  POST /process (client library or REST)
                   │  or sandbox_execute_code via MCP Gateway
┌──────────────────▼───────────────────────────┐
│               Code Sandbox                    │
│  compile → run in harness → collect result   │
└───────┬───────────────────────────┬──────────┘
        │ connections configured    │ optional: load code
        │ for your environment      │ from working memory
┌───────▼──────────────────┐   ┌────▼─────────────────┐
│ Your databases           │   │ Context Service      │
│ (Postgres, Databricks,   │   │                      │
│  SQL Server, ...)        │   │                      │
└──────────────────────────┘   └──────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)**: harnesses, database injection, the security model, and app design patterns
- **[Getting Started](./getting-started.md)**: run your first code, add database access, and call it from a bundle
- **[Reference](./reference.md)**: the `/process` API, harness exports, the database adapter, and errors
- **[Operations](./operations.md)**: enabling the sandbox, configuring databases, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 2.0.0
- **Status**: GA (Generally Available, Stable)

## Repository

Source code: [code-sandbox](https://github.com/firebrandanalytics/code-sandbox) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK](../../../sdk/agent_sdk/README.md): building the agent bundles that call the Code Sandbox
- [MCP Gateway tools](../mcp-gateway/tools.md#code-sandbox-adapter): the `sandbox_execute_code` MCP tool
