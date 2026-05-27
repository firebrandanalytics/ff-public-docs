# FireFoundry Platform Services

The FireFoundry platform is a collection of microservices that hosted agent bundles call to do their work — model routing, persistent memory, knowledge graph storage, code execution, document processing, telemetry, and more. Each service is independently deployable and exposes a well-defined API (gRPC or REST) that agents and applications can call directly or through the SDK client libraries.

This page is the catalog. For details on any service, follow the link to its dedicated docs.

## Services at a Glance

### Core Services

Three services form the foundation of every FireFoundry environment. They are running whenever a FireFoundry environment is running, and most agent bundles will use all three.

- **[FF Broker](./ff-broker/README.md)** — AI model routing and orchestration across multiple providers, with automatic provider selection, failover, and cost-aware routing.
- **[Entity Service](./entity-service/README.md)** — The Entity Graph: persistent storage for entities, relationships, and embeddings. Vector-based semantic search powered by pgvector.
- **[Telemetry Service](./telemetry-service.md)** — Captures broker LLM calls, tool invocations, and operations across the platform. Customer-facing query API for debugging, audit, and analysis of agent workloads.

### Optional Services

The rest of the catalog. Each one is opt-in — turn them on if your application needs the capability, leave them off if not.

- **[Code Sandbox](./code-sandbox/README.md)** — Secure execution environment for agent-generated TypeScript with database adapters and Chart.js.
- **[Context Service](./context-service/README.md)** — Working memory, blob storage, and conversation persistence for chat-style agents.
- **[Data Access Service](./data-access/README.md)** — Multi-database SQL access with AST query translation, staged federation, scratch pad, and fine-grained ACL.
- **[Document Processing Service](./doc-proc-service/README.md)** — Document extraction, generation, and transformation. OCR and table extraction via the Python worker backend.
- **[Notification Service](./notification-service/README.md)** — Cloud-agnostic email and SMS delivery with pluggable provider adapters.
- **[Skills Service](./skills-service.md)** — Skill registry, versioning, and environment-scoped installation for hosted agents.
- **[Virtual Worker Manager](./virtual-workers/README.md)** — Orchestrates CLI coding agents (Claude Code, Cursor, Gemini, OpenCode) with managed sessions and persistent workspaces.
- **[Web Search Service](./web-search/README.md)** — Provider-agnostic web search with Bing integration.
- **[Document Processing Python Worker](./doc-proc-pyworker.md)** — ML-based document processing backend that the Document Processing Service delegates to for advanced OCR and table extraction.

## Service Matrix

| Service | Category | Purpose | Protocol |
|---------|----------|---------|----------|
| [FF Broker](./ff-broker/README.md) | Core | AI model routing across multiple providers | gRPC |
| [Entity Service](./entity-service/README.md) | Core | Entity graph with vector semantic search | REST |
| [Telemetry Service](./telemetry-service.md) | Core | Telemetry capture and query for debugging and audit | gRPC + REST |
| [Code Sandbox](./code-sandbox/README.md) | Optional | Secure code execution with database connectivity | REST |
| [Context Service](./context-service/README.md) | Optional | Working memory, blob storage, conversation persistence | gRPC |
| [Data Access Service](./data-access/README.md) | Optional | Multi-database SQL access with AST queries and ACL | gRPC + REST |
| [Document Processing](./doc-proc-service/README.md) | Optional | Document extraction, OCR, generation, transformation | REST |
| [Notification Service](./notification-service/README.md) | Optional | Email and SMS delivery with pluggable providers | REST |
| [Skills Service](./skills-service.md) | Optional | Skill registry, versioning, and environment-scoped installation | REST |
| [Virtual Worker Manager](./virtual-workers/README.md) | Optional | CLI coding agent orchestration with managed sessions | REST |
| [Web Search Service](./web-search/README.md) | Optional | Provider-agnostic web search with Bing integration | REST |
| [Document Processing Python Worker](./doc-proc-pyworker.md) | Backend | ML-based document processing (called by Document Processing) | gRPC |

## How Services Fit Together

Agent bundles are the orchestrators. They call into the platform services they need, in whatever sequence makes sense for the task at hand. The platform doesn't impose a workflow; services are independent capabilities that agents compose.

A typical request looks like this:

1. A client application calls into your agent bundle (through the API gateway).
2. Your agent bundle calls the platform services it needs — usually some combination of Broker for model calls, Entity Service for knowledge graph reads/writes, and any optional services that match the task (e.g., Code Sandbox to run analytics, Data Access for SQL, Document Processing for files).
3. The Telemetry Service records broker requests and tool calls in the background so you can inspect them later.
4. The agent returns its response to the client.

For the architectural details of how services are deployed, networked, and discovered inside a Kubernetes environment, see [Platform Architecture](../architecture.md). For deployment procedures, see the [Deployment Guide](../deployment.md). For day-to-day operations, monitoring, and troubleshooting, see [Operations](../operations.md).

## Related Documentation

- [Platform Overview](../README.md) — High-level platform architecture
- [Platform Architecture](../architecture.md) — Namespaces, infrastructure, design decisions
- [Deployment Guide](../deployment.md) — Deploying FireFoundry environments
- [Operations](../operations.md) — Monitoring, troubleshooting, day-to-day operations
- [Agent SDK](../../sdk/agent_sdk/README.md) — Building agent bundles that consume these services
- [CLI Tools](../../sdk/cli-tools/README.md) — Customer-facing CLIs for interacting with platform services
