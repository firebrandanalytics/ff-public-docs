# Building a Document-to-Report Generator

A progressive tutorial series that takes you from your first FireFoundry entity to a production-ready document processing pipeline. Each part builds on the previous one, adding new capabilities while always resulting in a working, deployable application.

## What You'll Build

By the end of this series, you'll have a complete **Document-to-Report Generator** that:

- Accepts document uploads (PDF, Word, text files)
- Extracts text content using the doc-proc service
- Generates professional HTML reports using an LLM
- Converts HTML to PDF with configurable page orientation
- Supports human review and revision cycles
- Streams real-time progress updates to clients

## Prerequisites

- [FireFoundry local development environment](../../../local-development/README.md) or access to a deployed FireFoundry cluster
- [ff-cli installed and configured](../../../local-development/ff-cli-setup.md)
- Node.js 20+
- Basic TypeScript knowledge
- Familiarity with [FireFoundry core concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md) (recommended but not required)

## Tutorial Parts

| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|--------------|
| [1](./part-01-hello-entity.md) | Your First Entity | A simple entity that stores and retrieves text | Entities, Entity Graph, Agent Bundles, `ff-sdk-cli` |
| [2](./part-02-add-ai.md) | Adding AI with Bots | Entity that summarizes text using an LLM | Bots, Prompts, Structured Output, Zod schemas |
| [3](./part-03-prompt-engineering.md) | Prompt Engineering | Configurable report generation prompt | Prompt composition, conditional logic, template nodes |
| [4](./part-04-working-memory.md) | File Storage with Working Memory | Upload and store documents via working memory | WorkingMemoryProvider, blob uploads, context service |
| [5](./part-05-doc-processing.md) | Document Processing Pipeline | Extract text from uploaded documents | doc-proc-client, multi-stage workflows, progress streaming |
| [6](./part-06-orchestration.md) | Workflow Orchestration | Multi-entity pipeline with child entities | `appendOrRetrieveCall`, entity delegation, `yield*` streaming |
| [7](./part-07-structured-output.md) | Structured Output & Validation | Validated HTML report generation | `StructuredOutputBotMixin`, Zod validation, schema metadata |
| [8](./part-08-review-workflow.md) | Human-in-the-Loop Review | ReviewableEntity with approve/reject/revise | `ReviewableEntity`, `FeedbackBotMixin`, review cycles |
| [9](./part-09-api-endpoints.md) | Custom API Endpoints | REST API for creating reports and checking status | `@ApiEndpoint` decorator, request validation |
| [10](./part-10-deployment.md) | Deployment & Testing | Deploy to a cluster and verify end-to-end | `ff ops build`, `ff ops deploy`, `ff-sdk-cli`, `ff-eg-read`, `ff-telemetry-read` |

## How to Use This Tutorial

**Sequential approach**: Each part builds directly on the previous one. Start at Part 1 and work through in order.

**Jump-in approach**: If you're already familiar with FireFoundry basics, you can start at any part. Each part includes a "Starting Point" section that links to the completed code from the previous part.

**Testing at every step**: Every part ends with a deployable application. We use `ff-sdk-cli` throughout for testing without needing a GUI.

## Diagnostic Tools

Throughout this tutorial, you'll use FireFoundry's CLI diagnostic tools to verify your work:

| Tool | Purpose |
|------|---------|
| `ff-sdk-cli` | Invoke entity methods, run bots, upload files, manage iterators |
| `ff-eg-read` | Inspect the entity graph: view entities, edges, and relationships |
| `ff-wm-read` | Read working memory records and download stored files |
| `ff-telemetry-read` | Trace LLM calls, view broker requests, debug failures |

## Architecture Overview

Here's how the final application is structured:

```
Document Upload
       |
       v
ReportReviewWorkflowEntity (ReviewableEntity)
       |
       |-- Stores document in Working Memory
       |-- Creates and delegates to ReportEntity
       |
       v
ReportEntity (RunnableEntity orchestrator)
       |
       |-- Stage 1: Extract text (doc-proc-client)
       |-- Stage 2: Generate HTML (ReportGenerationEntity -> ReportGenerationBot)
       |-- Stage 3: Convert to PDF (doc-proc-client)
       |
       v
ReviewStep
       |
       |-- Human approves or requests changes
       |-- If rejected: re-runs with feedback
       |
       v
Final Result (PDF in Working Memory)
```

## Source Code

The complete source code for the finished application is available in the [ff-demo-report-generator](https://github.com/firebrandanalytics/ff-demo-report-generator) repository.

---

**Ready to start?** Head to [Part 1: Your First Entity](./part-01-hello-entity.md).
