# Building a CRM with FireFoundry

A 6-part tutorial series that builds a complete **AI-powered CRM** — from entity graph modeling through a running agent bundle to a consumer GUI with authenticated users, email workflows, and parallel campaign execution. This tutorial features the most involved entity graph modeling exercise in the FireFoundry tutorial series, with 7 entity types, 8 edge types, and multiple behavioral patterns.

## What You'll Build

By the end of this series, you'll have a CRM system that:

- Models a contact management domain with **7 entity types** and graph relationships
- Exposes **11 REST-style API endpoints** via `@ApiEndpoint`
- Uses **4 AI bots** with structured output schemas for validated JSON responses
- Demonstrates **BotRunnableEntityMixin** for entity-driven bot invocation
- Integrates with an external **notification service** for email delivery
- Sends **AI-generated emails** from the bundle as part of entity graph workflows
- Executes **parallel campaign sends** using `RunnableEntity`, `parallelCalls()`, and `HierarchicalTaskPoolRunner`
- Includes a **Next.js consumer GUI** with 4 workflow tabs
- Implements a **Backend-for-Frontend (BFF)** layer with OIDC login — the first tutorial to cover authenticated users
- Shows real-world patterns: error handling, N+1 avoidance, edge registration, human-in-the-loop approval, and capacity-controlled parallelism

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
| [3](./part-03-consumer-gui.md) | Consumer GUI — Next.js Frontend | 4-tab CRM dashboard with AI workflows | API client layer, HITL approval UI, draft preview |
| [4](./part-04-bff-and-authentication.md) | BFF Layer & OIDC Authentication | Express backend with authenticated users | `app_backend_accelerator`, `FFExpressApp`, `BaseController`, OIDC login, session management, actor identity |
| [5](./part-05-email-workflows.md) | Email Workflows & Notification Service | AI-generated emails sent from the bundle | Bundle → notification service integration, `personalize-and-send` endpoint, `NOTIF_URL` config |
| [6](./part-06-campaign-execution.md) | Campaign Execution & Parallel Patterns | Parallel campaign sends with progress tracking | `RunnableEntity`, `parallelCalls()`, `HierarchicalTaskPoolRunner`, `CapacitySource`, SSE progress |

## How to Use This Tutorial

**Sequential approach**: Each part builds on the previous one. Start at Part 1 and work through in order.

**Jump-in approach**: If you're already familiar with FireFoundry entity modeling, start at Part 2 for the bundle implementation, or Part 3 for the consumer frontend.

**Testing at every step**: Each part ends with verification checkpoints using `ff-sdk-cli` and `ff-eg-read`.

## Diagnostic Tools

Throughout this tutorial, you'll use FireFoundry's CLI diagnostic tools to verify your work:

| Tool | Purpose |
|------|---------|
| `ff-sdk-cli` | Invoke API endpoints, check health, test workflows |
| `ff-eg-read` | Inspect the entity graph: view entities, edges, and relationships |
| `ff-telemetry-read` | Trace LLM calls, view broker requests, debug failures |

## Architecture Overview

```
┌──────────────────────────────────────────┐
│   Browser (React)                        │
│   Port 3002                              │
└────────────┬─────────────────────────────┘
             │ fetch('/api/...')
             ▼
┌──────────────────────────────────────────┐
│   Express BFF (crm-backend)              │
│   OIDC session · RemoteAgentBundleClient │
└────────────┬─────────────────────────────┘
             │ Bundle API
             ▼
┌──────────────────┐  ┌──────────────────┐
│ CRM Agent Bundle │─→│ Notification Svc │
│ :3000            │  │ :8085            │
│ 11 API endpoints │  │ /send/email      │
│ 4 AI bots        │  └──────────────────┘
│ 7 entity types   │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
Entity     Broker
Service    (LLM)
```

**Key architectural principle:** The bundle calls the notification service directly during email workflows. The GUI triggers workflows via the BFF, but never composes or sends emails directly.

## Source Code

The complete source code for the finished application is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `crm/`.

---

**Ready to start?** Head to [Part 1: Domain Modeling & Entity Graph Design](./part-01-domain-modeling.md).
