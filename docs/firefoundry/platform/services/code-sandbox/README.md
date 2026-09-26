# Code Sandbox Service

## Overview

The Code Sandbox lets your agent bundles run code, usually code an LLM just wrote, in an isolated, short-lived container and get back a structured result: the value the code returned, its console output, and any compilation or runtime errors. It runs **TypeScript** and **Python**, and generated code can query your databases through the [Data Access Service](../data-access/README.md) (DAS) without ever handling a credential.

You describe *how* code should run once, as a named **profile** (language, runtime, data connections, time and resource limits). Your bundle then sends code plus a profile name. The fastest way to use it from a bundle is the Agent SDK's `GeneralCoderBot`, which takes a profile name and handles prompting, code extraction, execution, and error-driven retries for you.

> **Start with the tutorial.** [Building an AI Code Execution Agent](../../../sdk/agent_sdk/tutorials/code-sandbox/README.md) walks through a complete app on this service: a TypeScript coder bot, a Python data-science bot that queries a database through DAS, dynamic schema prompts, a web GUI, and deployment.

This service (Code Sandbox v2) replaces the legacy Code Sandbox; the legacy service is deprecated.

## Purpose and Role in Platform

Use the Code Sandbox when an agent needs to *compute* an answer rather than generate text:

- **Natural-language analytics**: the LLM writes Python (pandas, NumPy, SciPy) that queries a DAS connection; the sandbox runs it and the bot explains the numbers.
- **Exact computation**: calculations, algorithms, and data transformations where an LLM doing the arithmetic itself would be unreliable.
- **Auditable answers**: the generated code is stored with the result, so every answer has an artifact a reviewer can read and re-run.

The design properties your app can rely on:

- **Isolation per run**: every execution runs in its own container, which is discarded afterward. Nothing carries over between runs.
- **No credentials in generated code**: data access goes through DAS connection objects the sandbox injects, and DAS enforces the permissions of the connection.
- **Configuration lives in profiles**: bots name a profile; changing the profile changes the language, runtime, or data access without a code change.

## Key Features

- **TypeScript and Python runtimes**, selected by profile
- **Profiles**: named execution configurations (runtime, run-script contract, DAS connections, timeout and CPU/memory limits)
- **DAS integration**: `das.<connection>` clients injected into executed code for SQL queries and schema lookups; Python gets DataFrames directly with `query_df()`
- **Structured results**: separate compilation and execution outcomes, with typed errors your bot can feed back to the LLM
- **Streaming progress**: Server-Sent Events for started, compiling, executing, output, and done
- **Working memory input**: run code already stored in working memory instead of sending it inline
- **Agent SDK integration**: `GeneralCoderBot` reads profile metadata at startup and builds the LLM's output-format and entry-point instructions for you
- **Per-app rate limiting and execution history**, keyed by your app ID

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Your agent bundle                                      │
│  GeneralCoderBot (profile: "my-app-analytics")          │
│    LLM writes code → stored in working memory           │
└───────────────┬─────────────────────────────────────────┘
                │ GET /profiles/{name}/metadata   (at bot init)
                │ POST /execute  { source, profile }  (SSE stream)
┌───────────────▼─────────────────────────────────────────┐
│  Code Sandbox (HTTP, port 8080, in-cluster)             │
│  resolves profile → starts an isolated container        │
│  → compile → run your entry point → return result       │
└───────┬───────────────────────────────┬─────────────────┘
        │ load code by working-memory ID │ das.<connection>.query(...)
┌───────▼──────────────┐       ┌────────▼────────────────┐
│ Context Service      │       │ Data Access Service     │
│ (working memory)     │       │ → your databases        │
└──────────────────────┘       └─────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)**: profiles and runtimes, how a run executes, entry points, DAS access, results and errors, security, and app design patterns
- **[Getting Started](./getting-started.md)**: check the service, run code with `curl`, then run LLM-generated code from a bundle with `GeneralCoderBot`
- **[Reference](./reference.md)**: HTTP API, request and response shapes, stream events, error codes, the in-sandbox `das` API, and SDK settings
- **[Operations](./operations.md)**: enabling the service, setting up profiles, bundle configuration, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.x (Code Sandbox v2)
- **Status**: Preview. The API and profile model are in active use, but some profile fields are accepted and not yet enforced (see [Reference](./reference.md#profile-fields)).

## Repository

Source code: [ff-code-sandbox](https://github.com/firebrandanalytics/ff-code-sandbox) (private)

## Related

- [Code Sandbox tutorial](../../../sdk/agent_sdk/tutorials/code-sandbox/README.md): build a complete code execution agent
- [Data Access Service](../data-access/README.md): the connections executed code queries
- [Context Service](../context-service/README.md) and [Working Memory](../../../sdk/agent_sdk/guides/working-memory.md): where generated code is stored
- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
