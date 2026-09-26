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

- **[Code Sandbox](./code-sandbox/README.md)** — Runs agent-generated TypeScript and Python in an isolated container per run, with profile-based configuration and credential-free database access through the Data Access Service. *Preview.*
- **[Context Service](./context-service/README.md)** — Working memory, blob storage, and conversation persistence for chat-style agents.
- **[Browser Worker Manager](./browser-worker-manager/README.md)** — Persistent, per-session headless browser pods that agents drive step by step (navigate, snapshot, click, fill, log in, PDF, download), with mounted-secret credential fill and redaction. *Preview.*
- **[Data Access Service](./data-access/README.md)** — Multi-database SQL access with AST query translation, staged federation, scratch pad, and fine-grained ACL.
- **[Directory Service](./directory-service/README.md)** — Permissioned document namespace (drives, folders, items with per-item access control) over content stored elsewhere, with delegated read-only import from Microsoft 365 and Box. *Preview.*
- **[Document Processing Service](./doc-proc-service/README.md)** — Document extraction, generation, and transformation. OCR and table extraction via the Python worker backend.
- **[Identity Management Service (IMS)](./identity-service/README.md)** — Canonical principals, groups, roles, and permissions with a policy decision endpoint, plus per-realm OpenID Connect sign-in. *Preview.*
- **[Knowledge Service](./knowledge-service/README.md)** — CRUD for knowledge bases and document metadata over the entity graph, with ingestion delegated to the RAG agent bundle and section/page navigation of ingested documents.
- **[MCP Gateway](./mcp-gateway/README.md)** — Exposes FireFoundry services as Model Context Protocol tools, resources, and prompts for AI agents such as Claude Code and Virtual Workers. Enabled by default in `firefoundry-core`.
- **[Notification Service](./notification-service/README.md)** — Cloud-agnostic email and SMS delivery with pluggable provider adapters.
- **[Skills Service](./skills-service/README.md)** — Versioned, access-controlled skills that agents load at runtime (usually through the MCP Gateway) — and that agents can create and update themselves, making skills one of FireFoundry's main learning loops.
- **[Test Harness Service](./test-harness-service/README.md)** — Define, run, and analyze automated tests against agent bundles, and track run history. *Preview* — real bundle execution and LLM-judged assertions via the Test Evaluation Agent are in development.
- **[Virtual Worker Manager](./virtual-workers/README.md)** — Orchestrates CLI coding agents (Claude Code, Codex, Cursor, OpenCode) with managed sessions and persistent workspaces.
- **[Web Search Service](./web-search/README.md)** — Web search and page fetching for agents, backed by the Brave Search API.

### System Services

Background services that are not normally called by application code. App developers benefit from them indirectly — through the Console UI, CLI tools, or other services that depend on them.

- **[Telemetry Service](./telemetry-service/README.md)** — Captures broker LLM calls and other producer-service telemetry. Inspect via the FireFoundry Console or the `ff-telemetry-read` CLI.
- **[Document Processing Python Worker](./doc-proc-pyworker/README.md)** — Unlocks advanced Document Processing Service capabilities (PDF to images, structured and table extraction, OCR, upscaling, colorspace conversion) when enabled in your environment. Apps use these through the Document Processing Service API.
- **[Log Proxy Service](./log-proxy-service/README.md)** — Centralized log ingestion with redaction, optional encryption, durable buffering, OTLP forwarding, search, and live tail. Opt-in. *Preview.*

## Service Matrix

| Service | Category | Purpose | Protocol |
|---------|----------|---------|----------|
| [FF Broker](./ff-broker/README.md) | Core | AI model routing across multiple providers | gRPC |
| [Entity Service](./entity-service/README.md) | Core | Entity graph with vector semantic search | REST |
| [Code Sandbox](./code-sandbox/README.md) | Optional | Isolated execution of agent-generated TypeScript and Python | REST |
| [Context Service](./context-service/README.md) | Optional | Working memory, blob storage, conversation persistence | gRPC |
| [Browser Worker Manager](./browser-worker-manager/README.md) | Optional | Persistent per-session browser pods for agent site navigation | REST |
| [Data Access Service](./data-access/README.md) | Optional | Multi-database SQL access with AST queries and ACL | gRPC + REST |
| [Directory Service](./directory-service/README.md) | Optional | Permissioned document namespace with Microsoft 365 and Box import | REST |
| [Document Processing](./doc-proc-service/README.md) | Optional | Document extraction, OCR, generation, transformation | REST |
| [Identity Management Service](./identity-service/README.md) | Optional | Principals, groups, roles, permissions; policy checks; OIDC sign-in | REST + OIDC |
| [Knowledge Service](./knowledge-service/README.md) | Optional | CRUD for knowledge bases; delegates ingestion to RAG agent | REST |
| [MCP Gateway](./mcp-gateway/README.md) | Optional | FireFoundry services as MCP tools, resources, and prompts | MCP (JSON-RPC over HTTP) + REST |
| [Notification Service](./notification-service/README.md) | Optional | Email and SMS delivery with pluggable providers | REST |
| [Skills Service](./skills-service/README.md) | Optional | Versioned skills agents load at runtime and can create or update | REST |
| [Test Harness Service](./test-harness-service/README.md) | Optional | Test suite management, execution, results, run history | REST |
| [Virtual Worker Manager](./virtual-workers/README.md) | Optional | CLI coding agent orchestration with managed sessions | REST |
| [Web Search Service](./web-search/README.md) | Optional | Web search and page fetching for agents, backed by the Brave Search API | REST |
| [Telemetry Service](./telemetry-service/README.md) | System | Telemetry capture; consumed via Console UI or `ff-telemetry-read` CLI | Connect RPC + REST |
| [Document Processing Python Worker](./doc-proc-pyworker/README.md) | System | Enables advanced Document Processing capabilities (used via that service) | — |
| [Log Proxy Service](./log-proxy-service/README.md) | System | Log ingestion, redaction, buffering, OTLP forwarding, search | gRPC + REST + WebSocket |

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
