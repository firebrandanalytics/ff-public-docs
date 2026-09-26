# Context Service

## Overview

The Context Service gives agent bundles two kinds of memory: **working memory** (files and blobs attached to entities) and **chat history** (conversation messages reconstructed from the entity graph). Agent bundles use it through the Agent SDK or the `@firebrandanalytics/cs-client` TypeScript client over gRPC.

## Purpose and Role in Platform

Agent bundles are stateless by design. When a bot needs a file a user uploaded, a document produced by an earlier pipeline stage, or the conversation so far in the current session, it asks the Context Service. You use it to:

- Keep binary content (PDFs, images, CSVs, generated documents, code) out of entity data while keeping it linked to the entity it belongs to
- Give chat bots conversation history without maintaining a separate message log
- Let MCP-compatible coding agents read and write working memory through tool calls

## Key Features

- **Working Memory**: Upload, retrieve, list, and delete files with JSON metadata, linked to an entity node and addressable by a `working_memory_id`
- **Streaming File I/O**: Streaming uploads and downloads for large files (the client handles chunking)
- **Manifest API**: Hierarchical view of working memory across related entities, filterable by memory type
- **Chat History**: Ordered `ChatMessage[]` for any entity node, reconstructed by traversing the entity graph
- **Named Mappings**: Register CEL-based mapping rules so history works with your own conversation entity model
- **MCP Integration**: Working memory exposed as MCP tools for Claude Code, Codex, and other MCP-compatible agents

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Your Agent Bundle                                        │
│  (SDK: WorkingMemoryProvider, ChatHistoryBotMixin,        │
│   ChatHistoryPromptGroup · or cs-client directly)         │
└───────────────┬──────────────────────────────────────────┘
                │ gRPC (Connect-RPC)          ┌─────────────────────┐
                │                             │ MCP-compatible      │
                ▼                             │ coding agents       │
┌──────────────────────────────────┐◀────────┤ (tool calls)        │
│         Context Service          │          └─────────────────────┘
│  working memory · chat history   │
└───────┬───────────────────┬──────┘
        │                   │
        ▼                   ▼
┌───────────────┐   ┌──────────────────────┐
│ Object storage│   │ Entity Service       │
│ (your env's   │   │ (conversation graph  │
│  file store)  │   │  that history reads) │
└───────────────┘   └──────────────────────┘
```

What the Context Service does **not** own:

- **The entity graph** — that belongs to the [Entity Service](../entity-service/README.md). Chat history reads whatever your bundle wrote to the graph.
- **LLM calls** — the Broker sends prompts to models; history is fetched here and injected into the prompt by the SDK.
- **Agent logic** — bots and entities live in your agent bundle.

## Documentation

- **[Concepts](./concepts.md)** — Working memory, chat history, mappings, MCP integration, and design guidance
- **[Getting Started](./getting-started.md)** — Connect the client, upload a file, retrieve chat history, register a mapping
- **[Mapping Examples](./mapping-examples.md)** — Two worked conversation graph designs and their mappings
- **[Reference](./reference.md)** — gRPC API, client library methods, error codes
- **[Operations](./operations.md)** — Enabling the service, connecting a bundle, verifying, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 3.2.1
- **Deployment**: Enabled by default in `firefoundry-core`

## Repository

Source code: `context-service` (TypeScript monorepo). Client packages: `@firebrandanalytics/cs-client` (client library) and `@firebrandanalytics/context-svc-proto` (gRPC definitions and generated types).

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
- [ff-wm-read CLI](../../../sdk/cli-tools/ff-wm-read.md) / [ff-wm-write CLI](../../../sdk/cli-tools/ff-wm-write.md) — Inspect and modify working memory
- [Entity Service](../entity-service/README.md)
