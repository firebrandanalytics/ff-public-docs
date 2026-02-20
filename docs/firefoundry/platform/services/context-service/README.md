# Context Service

## Overview

The Context Service is FireFoundry's persistence and memory layer for agent bundles. It serves two distinct roles: **working memory** (blob storage for entities) and **chat history** (conversation reconstruction from the entity graph). Both surfaces are accessible to agents via gRPC and through the `@firebrandanalytics/cs-client` TypeScript client library.

## Purpose and Role in Platform

Agents are stateless by design. The Context Service provides the persistence layer that transforms ephemeral agent interactions into stateful workflows. When a bot needs access to files uploaded by a user, documents stored across pipeline stages, or the full conversation history of the current session, it communicates with the Context Service through standardized gRPC protocols.

This architectural separation lets agents focus on logic while delegating all state management to a centralized service — one that integrates with the entity graph, cloud blob storage, and MCP-compatible tooling.

## Key Features

- **Working Memory**: Upload, retrieve, list, and delete binary files (PDFs, images, CSVs, code) alongside JSON metadata. Backed by Azure Blob Storage or GCS, with automatic provider detection.
- **Chat History**: Retrieve conversation messages for any entity node, reconstructed by traversing the entity graph. Supports named CEL-based mapping rules for apps with custom entity models.
- **Context Assembly**: Compose rich context payloads from entity graph data using registered CEL mapping pipelines. Used internally by the SDK's `ChatHistoryPromptGroup`.
- **MCP Integration**: Expose working memory and blob operations as MCP tools, accessible to Claude Code, Codex, and other MCP-compatible coding agents.
- **Streaming File I/O**: Bidirectional streaming for large file uploads; server-streaming for downloads.
- **Manifest API**: Hierarchical view of working memory organized by entity relationships and memory types.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Consumers                                  │
│         (Agent SDK, cs-client, MCP-compatible tools)         │
└───────────────────────────────┬──────────────────────────────┘
                                │ gRPC (Connect-RPC)
┌───────────────────────────────▼──────────────────────────────┐
│                  Context Service                              │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Working Memory  │  │  Chat History   │  │   Context   │  │
│  │ (WM Records +   │  │  (Entity Graph  │  │  Assembly   │  │
│  │  Blob Storage)  │  │   Traversal)    │  │ (CEL Pipel.)│  │
│  └────────┬────────┘  └───────┬─────────┘  └──────┬──────┘  │
│           │                   │                    │         │
│  ┌────────▼────────┐  ┌───────▼─────────────────── ▼──────┐  │
│  │ BlobStorage     │  │        IEntityGraphClient         │  │
│  │ (Azure / GCS)   │  │   (Entity Service REST API)       │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
│  ┌─────────────────┐  ┌───────────────────────────────────┐  │
│  │  PostgreSQL     │  │       MappingRegistry             │  │
│  │  (WM Metadata)  │  │  (Named CEL Rules per App)        │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Internal Components

| Component | Purpose |
|-----------|---------|
| **ChatHistoryService** | Traverses entity graph to reconstruct message history for a node |
| **ContextAssemblyService** | Applies named CEL mapping pipelines to produce ordered `ChatMessage[]` |
| **MappingRegistry** | In-memory per-app store of named CEL mapping rules |
| **BlobStorageFactory** | Detects cloud provider and creates the appropriate `BlobStorage` adapter |
| **MCPPostgresServer** | Exposes working memory operations as MCP tools (PostgreSQL-backed) |

### What the Context Service Does Not Own

- **The entity graph** — that belongs to the Entity Service. The Context Service calls the Entity Service gRPC API for all graph traversal.
- **Conversation routing** — the Broker handles LLM completion routing; context is assembled here but the broker sends it to the model.
- **Agent logic** — bots and entities live in agent bundles. The Context Service is passive storage + retrieval infrastructure.

## Repository Structure

The Context Service is a TypeScript monorepo managed by pnpm workspaces:

```
context-service/
├── packages/
│   ├── transport/        @firebrandanalytics/context-svc-proto — gRPC proto + generated types
│   ├── cs-client/        @firebrandanalytics/cs-client — TypeScript client library
│   └── db/               Database schema and Drizzle ORM client
└── services/
    └── context-service/  Service implementation
```

## Documentation

- **[Concepts](./concepts.md)** — Working memory, blob storage, chat history, context assembly, MCP integration
- **[Getting Started](./getting-started.md)** — Connect the client, upload a file, retrieve chat history, register a mapping
- **[Reference](./reference.md)** — Full gRPC API, environment variables, error codes

## Related

- [Platform Services Overview](../README.md)
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
- [Entity Service](../entity-service.md)
