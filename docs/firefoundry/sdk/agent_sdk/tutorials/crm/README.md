# Building a CRM with FireFoundry

A 3-part tutorial series that builds a complete **AI-powered CRM** — from entity graph modeling through a running agent bundle to a consumer GUI. This tutorial features the most involved entity graph modeling exercise in the FireFoundry tutorial series, with 7 entity types, 8 edge types, and multiple behavioral patterns.

## What You'll Build

By the end of this series, you'll have a CRM system that:

- Models a contact management domain with **7 entity types** and graph relationships
- Exposes **9 REST-style API endpoints** via `@ApiEndpoint`
- Uses **4 AI bots** with structured output schemas for validated JSON responses
- Demonstrates **BotRunnableEntityMixin** for entity-driven bot invocation
- Integrates with an external **notification service** for email delivery
- Includes a **Next.js consumer GUI** with 4 workflow tabs
- Shows real-world patterns: error handling, N+1 avoidance, edge registration, and human-in-the-loop approval

## Prerequisites

- [FireFoundry local development environment](../../../local-development/README.md) or access to a deployed FireFoundry cluster
- [ff-cli installed and configured](../../../local-development/ff-cli-setup.md)
- Node.js 20+
- Basic TypeScript knowledge
- Familiarity with [FireFoundry core concepts](../../fire_foundry_core_concepts_glossary_agent_sdk.md) (recommended but not required)

## Tutorial Parts

| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|-------------|
| [1](./part-01-domain-modeling.md) | Domain Modeling & Entity Graph Design | 7 entity types with DTOs, relationships, and behavioral classification | 4-step modeling process, `allowedConnections`, HITL pattern, data vs. runnable entities |
| [2](./part-02-agent-bundle.md) | Agent Bundle — Bots, Prompts, and API Endpoints | Running bundle with 4 bots and 9 endpoints | `BotRunnableEntityMixin`, `StructuredOutputBotMixin`, prompt framework, `@ApiEndpoint`, graph traversal |
| [3](./part-03-consumer-gui.md) | Consumer GUI — Next.js Frontend | 4-tab CRM dashboard with AI workflows | API client layer, two-service integration, HITL approval UI |

## How to Use This Tutorial

**Sequential approach**: Each part builds on the previous one. Start at Part 1 and work through in order.

**Jump-in approach**: If you're already familiar with FireFoundry entity modeling, start at Part 2 for the bundle implementation, or Part 3 for the consumer frontend.

**Testing at every step**: Each part ends with verification checkpoints using `ff-sdk-cli` and `ff-eg-read`.

## How This Differs from the Report Generator Tutorial

| | Report Generator | CRM |
|---|---|---|
| **Format** | 13 progressive parts (build up from scratch) | 3 focused parts (model → bundle → GUI) |
| **Entity modeling** | Simple linear pipeline | Complex graph with 7 entities, 8 edge types, 3 behavioral categories |
| **Focus** | Document processing, working memory, streaming | Entity relationships, multi-bot coordination, campaigns |
| **Key patterns** | `ReviewableEntity`, `FeedbackBotMixin`, `WorkingMemoryProvider` | `BotRunnableEntityMixin`, `StructuredOutputBotMixin`, HITL approval |
| **External integration** | doc-proc service | Notification service (email) |
| **Consumer app** | Next.js with progress streaming | Next.js with multi-tab workflow |

Both tutorials are complementary — the Report Generator teaches progressive construction with advanced features (working memory, streaming, review cycles), while the CRM tutorial emphasizes graph modeling, multi-bot coordination, and full-stack integration.

## Diagnostic Tools

Throughout this tutorial, you'll use FireFoundry's CLI diagnostic tools to verify your work:

| Tool | Purpose |
|------|---------|
| `ff-sdk-cli` | Invoke API endpoints, check health, test workflows |
| `ff-eg-read` | Inspect the entity graph: view entities, edges, and relationships |
| `ff-telemetry-read` | Trace LLM calls, view broker requests, debug failures |

## Architecture Overview

```
┌──────────────────────────────────┐
│   CRM GUI (Next.js)              │
│   Port 3002                      │
└────────────┬──────────┬──────────┘
             │          │
  Bundle API │          │ Notification API
             ▼          ▼
┌──────────────────┐  ┌──────────────────┐
│ CRM Agent Bundle │  │ Notification Svc │
│ :3000            │  │ :8085            │
│ 9 API endpoints  │  │ /send/email      │
│ 4 AI bots        │  └──────────────────┘
│ 7 entity types   │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
Entity     Broker
Service    (LLM)
```

## Source Code

The complete source code for the finished application is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `crm/`.

---

**Ready to start?** Head to [Part 1: Domain Modeling & Entity Graph Design](./part-01-domain-modeling.md).
