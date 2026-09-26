# MCP Gateway

## Overview

The MCP Gateway exposes FireFoundry platform capabilities as [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) tools, resources, and prompts. Any MCP-capable client — an AI coding agent such as Claude Code, a Virtual Worker session, an LLM-driven agent in your bundle, or an external MCP client — connects to one HTTP endpoint and immediately discovers and calls tools for the entity graph, working memory, document processing, telemetry, web search, data access, knowledge bases, skills, and code execution.

The gateway holds no data of its own: every tool call is translated into a call on the corresponding FireFoundry service, and the result comes back as an MCP tool result.

## Purpose and Role in Platform

Each FireFoundry service has its own API and client library. An LLM agent that wants to use several of them would otherwise need a custom integration per service. The MCP Gateway gives agents a single, standard surface:

- **One endpoint, many services** — `POST /mcp` offers every enabled service's tools, resources, and prompts
- **Standard discovery** — clients learn the tools and their JSON Schemas through `tools/list`; nothing is hard-coded in your agent
- **Service wiring stays in the environment** — service URLs and downstream credentials live in the gateway's configuration, not in each agent
- **Bring your own tools** — register your app's gRPC services or remote A2A agents and they appear as MCP tools alongside the platform's

Use the gateway when the caller is an **LLM agent** that benefits from tool discovery. Application code that already uses the FireFoundry SDK or client libraries should keep calling services directly.

## Key Features

- **Unified MCP endpoint** — `POST /mcp` serves all tools, resources, resource templates, and prompts
- **Per-adapter MCP endpoints** — `POST /mcp/<adapter>` scopes a client to one service (for example only `entity` or only `telemetry`)
- **Nine built-in service adapters** — Entity, Context, Document Processing, Telemetry, Code Sandbox, Web Search, Data Access, Knowledge Base, and Skills (55 tools in total)
- **Your own tools** — expose your gRPC services (`grpc`) and remote A2A agents (`a2a-client`) as MCP tools
- **Built-in prompts** — five workflow prompts (debug a request, explore the entity graph, ingest-and-query, data analysis, list tools)
- **Identity and trace propagation** — `X-On-Behalf-Of`, `X-Trace-Id`, and `X-Span-Id` are carried to downstream calls
- **A2A server (optional)** — publishes an Agent Card and accepts A2A tasks that call gateway tools

## Architecture Overview

```
  Your agents and clients
  ┌──────────────────────────────────────────────────────────────┐
  │ Claude Code · Virtual Workers · LLM agents in your bundle ·  │
  │ other MCP clients                      · A2A agents (opt.)   │
  └──────────────┬───────────────────────────────────┬───────────┘
                 │ MCP (JSON-RPC over HTTP)          │ A2A
                 │ X-Api-Key, X-On-Behalf-Of,        │
                 │ X-Trace-Id, X-Span-Id             │
                 ▼                                   ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                        MCP Gateway                           │
  │   /mcp  (all tools + prompts)     /mcp/<adapter>  (one svc)  │
  └──┬────────┬────────┬────────┬────────┬────────┬────────┬─────┘
     ▼        ▼        ▼        ▼        ▼        ▼        ▼
  Entity   Context  Doc Proc Telemetry  Web     Data   KB · Skills ·
  Service  Service  Service  Service   Search  Access  Code Sandbox
                                                        · your gRPC
                                                        services ·
                                                        remote A2A
                                                        agents
```

## Documentation

- **[Concepts](./concepts.md)** — Adapters, unified vs. per-adapter endpoints, results, identity, bringing your own tools, A2A, app patterns
- **[Getting Started](./getting-started.md)** — Connect, list tools, and call your first tool with curl
- **[Connecting Clients](./clients.md)** — Claude Code and other MCP clients, Virtual Workers, agent bundles, A2A clients
- **[Tools Catalog](./tools.md)** — Every MCP tool, resource template, and prompt, grouped by adapter
- **[Reference](./reference.md)** — HTTP endpoints, MCP methods, error codes, registering gRPC backends and A2A agents, settings
- **[Operations](./operations.md)** — Enabling adapters for your app, verifying, limits, troubleshooting

## Version and Maturity

- **Current Version**: 0.4.0; MCP protocol version `2024-11-05`
- **Maturity**: Beta. The MCP tool surface is stable in shape; the tool set grows as adapters are added.
- **Helm**: enabled by default in `firefoundry-core` (`mcp-gateway.enabled: true`).

## Repository

Source code: [ff-services-mcp-gateway](https://github.com/firebrandanalytics/ff-services-mcp-gateway) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Virtual Worker Manager](../virtual-workers/README.md) — Virtual Workers reach platform services through the MCP Gateway
- [FF Broker](../ff-broker/README.md) — AI model routing, with optional MCP tool integration
- [Entity Service](../entity-service/README.md), [Context Service](../context-service/README.md), [Telemetry Service](../telemetry-service/README.md) — the most commonly used backing services
