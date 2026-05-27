# FireFoundry Platform Services

The FireFoundry platform is a collection of microservices that hosted agent bundles call to do their work — model routing, persistent memory, knowledge graph storage, code execution, document processing, telemetry, and more. Each service is independently deployable and exposes a well-defined API (gRPC or REST) that agents and applications can call directly or through the SDK client libraries.

This page is the catalog. For details on any service, follow the link to its dedicated docs.

## Services at a Glance

### Core Services

Two services form the foundation of every FireFoundry environment. They are running whenever a FireFoundry environment is running, and most agent bundles will call them directly.

- **[FF Broker](./ff-broker/README.md)** — AI model routing and orchestration across multiple providers, with automatic provider selection, failover, and cost-aware routing.
- **[Entity Service](./entity-service/README.md)** — The Entity Graph: persistent storage for entities, relationships, and embeddings. Vector-based semantic search powered by pgvector.

### Optional Services

Each is opt-in — turn it on if your application needs the capability, leave it off if not.

- **[Code Sandbox](./code-sandbox/README.md)** — Secure execution environment for agent-generated TypeScript with database adapters and Chart.js.
- **[Context Service](./context-service/README.md)** — Working memory, blob storage, and conversation persistence for chat-style agents.
- **[Data Access Service](./data-access/README.md)** — Multi-database SQL access with AST query translation, staged federation, scratch pad, and fine-grained ACL.
- **[Document Processing Service](./doc-proc-service/README.md)** — Document extraction, generation, and transformation. OCR and table extraction via the Python worker backend.
- **[Knowledge Service](./knowledge-service.md)** — CRUD for knowledge bases and document metadata, with ingestion delegated to the RAG agent bundle.
- **[Notification Service](./notification-service/README.md)** — Cloud-agnostic email and SMS delivery with pluggable provider adapters.
- **[Skills Service](./skills-service.md)** — Skill registry, versioning, and environment-scoped installation for hosted agents.
- **[Test Harness Service](./test-harness-service.md)** — Define, run, and analyze automated tests against agent bundles, with LLM-judged semantic assertions powered by the Test Evaluation Agent.
- **[Virtual Worker Manager](./virtual-workers/README.md)** — Orchestrates CLI coding agents (Claude Code, Cursor, Gemini, OpenCode) with managed sessions and persistent workspaces.
- **[Web Search Service](./web-search/README.md)** — Provider-agnostic web search with Bing integration.

### System Services

Background services that run in every environment but are not normally called by application code. App developers benefit from them indirectly — through the Console UI, CLI tools, or other services that depend on them.

- **[Telemetry Service](./telemetry-service.md)** — Captures broker LLM calls and other producer-service telemetry. Inspect via the FireFoundry Console or the `ff-telemetry-read` CLI.
- **[Document Processing Python Worker](./doc-proc-pyworker.md)** — ML-based document processing backend that the Document Processing Service delegates to for advanced OCR and table extraction.

## Service Matrix

| Service | Category | Purpose | Protocol |
|---------|----------|---------|----------|
| [FF Broker](./ff-broker/README.md) | Core | AI model routing across multiple providers | gRPC |
| [Entity Service](./entity-service/README.md) | Core | Entity graph with vector semantic search | REST |
| [Code Sandbox](./code-sandbox/README.md) | Optional | Secure code execution with database connectivity | REST |
| [Context Service](./context-service/README.md) | Optional | Working memory, blob storage, conversation persistence | gRPC |
| [Data Access Service](./data-access/README.md) | Optional | Multi-database SQL access with AST queries and ACL | gRPC + REST |
| [Document Processing](./doc-proc-service/README.md) | Optional | Document extraction, OCR, generation, transformation | REST |
| [Knowledge Service](./knowledge-service.md) | Optional | CRUD for knowledge bases; delegates ingestion to RAG agent | REST |
| [Notification Service](./notification-service/README.md) | Optional | Email and SMS delivery with pluggable providers | REST |
| [Skills Service](./skills-service.md) | Optional | Skill registry, versioning, and environment-scoped installation | REST |
| [Test Harness Service](./test-harness-service.md) | Optional | Test suite management, execution, results, scheduled runs | REST |
| [Virtual Worker Manager](./virtual-workers/README.md) | Optional | CLI coding agent orchestration with managed sessions | REST |
| [Web Search Service](./web-search/README.md) | Optional | Provider-agnostic web search with Bing integration | REST |
| [Telemetry Service](./telemetry-service.md) | System | Telemetry capture; consumed via Console UI or `ff-telemetry-read` CLI | gRPC + REST |
| [Document Processing Python Worker](./doc-proc-pyworker.md) | System | ML-based backend that Document Processing delegates to | gRPC |

## How Services Fit Together

Agent bundles are the orchestrators. They call into the platform services they need, in whatever sequence makes sense for the task at hand. The platform doesn't impose a workflow; services are independent capabilities that agents compose.

A typical request looks like this:

1. A client application calls into your agent bundle (through the API gateway).
2. Your agent bundle calls the platform services it needs — usually some combination of Broker for model calls, Entity Service for knowledge graph reads/writes, and any optional services that match the task (e.g., Code Sandbox to run analytics, Data Access for SQL, Document Processing for files, Knowledge Service for KB management).
3. System services capture telemetry in the background; you can inspect it later via the Console or `ff-telemetry-read` CLI.
4. The agent returns its response to the client.

For the architectural details of how services are deployed, networked, and discovered inside a Kubernetes environment, see [Platform Architecture](../architecture.md). For deployment procedures, see the [Deployment Guide](../deployment.md). For day-to-day operations, monitoring, and troubleshooting, see [Operations](../operations.md).

## Related Documentation

- [Platform Overview](../README.md) — High-level platform architecture
- [Platform Architecture](../architecture.md) — Namespaces, infrastructure, design decisions
- [Deployment Guide](../deployment.md) — Deploying FireFoundry environments
- [Operations](../operations.md) — Monitoring, troubleshooting, day-to-day operations
- [Agent SDK](../../sdk/agent_sdk/README.md) — Building agent bundles that consume these services
- [CLI Tools](../../sdk/cli-tools/README.md) — Customer-facing CLIs for interacting with platform services
