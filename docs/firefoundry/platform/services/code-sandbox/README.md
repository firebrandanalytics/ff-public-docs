# Code Sandbox Service

## Overview

The Code Sandbox is a secure code execution environment that enables AI agents to run TypeScript code with access to databases, visualization tools, and data processing libraries. It provides isolated execution with comprehensive security controls and resource management.

## Purpose and Role in Platform

The Code Sandbox serves as the execution runtime for FireFoundry agent bundles, allowing AI-generated code to:
- Query databases securely via ODBC connections (PostgreSQL, Databricks, SQL Server, MySQL, Oracle, Snowflake)
- Process and analyze data using DataFrame operations
- Generate visualizations with Chart.js and Canvas
- Execute analytical workflows in controlled environments

Agent bundles invoke the Code Sandbox via REST API to compile and run code, receiving structured execution results including output, errors, and return data.

## Key Features

- **Secure Code Execution**: Isolated execution environments with VM-based sandboxing or worker thread isolation
- **Database Connectivity**: ODBC-based access to multiple database types with connection pooling
- **Data Visualization**: Built-in Canvas and Chart.js support for generating charts and graphics
- **DataFrame Processing**: Data analysis capabilities via dataframe-js and simple-statistics
- **Dual Execution Modes**: Worker thread isolation (more secure) or direct execution (lower latency)
- **Streaming Progress Updates**: Chunked transfer encoding for real-time compilation and execution status
- **Customizable Harnesses**: Predefined execution contexts (finance, sql) with extensible architecture

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  REST API Layer                      │
│              POST /process endpoint                  │
│         API key authentication + rate limiting       │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Harness Selection                       │
│   Finance Harness  |  SQL Harness  |  Custom        │
│   Database injection + context setup                 │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│             TypeScript Compiler                      │
│        Compilation → Execution → Result              │
│   Worker Threads mode  |  Direct execution mode      │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│             External Services                        │
│   Databases (ODBC)  |  KeyVault  |  Blob Storage     │
└─────────────────────────────────────────────────────┘
```

## Documentation

- **[Concepts](./concepts.md)** — Execution model, harness system, isolation strategy, security model
- **[Getting Started](./getting-started.md)** — First code execution, harness configuration, database access
- **[Reference](./reference.md)** — API endpoints, request/response schemas, configuration variables
- **[Operations](./operations.md)** — Deployment, scaling, security configuration, troubleshooting

## Version and Maturity

- **Current Version**: 2.0.0
- **Status**: GA (Generally Available, Stable)
- **Node.js Version**: 23.x required (uses `--experimental-vm-modules`)

## Repository

Source code: [code-sandbox](https://github.com/firebrandanalytics/code-sandbox) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK](../../../sdk/agent_sdk/README.md) — Building agent bundles that use Code Sandbox
