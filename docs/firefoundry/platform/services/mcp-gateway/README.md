# MCP Gateway

## Overview

The MCP Gateway exposes FireFoundry platform services as [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) tools, resources, and prompts. Any MCP-capable client — an AI coding agent such as Claude Code, a Virtual Worker session, or an in-cluster component — can connect to one HTTP endpoint and immediately discover and call tools for the entity graph, working memory, document processing, telemetry, web search, data access, knowledge bases, skills, and code execution.

The gateway is a thin adapter layer. It holds no domain data of its own: every tool call is translated into a call on the corresponding FireFoundry service client, and the result is returned as an MCP tool result.

## Purpose and Role in Platform

FireFoundry services each have their own API (REST or gRPC), their own client library, and their own connection details. An LLM-driven agent that wants to use several of them would otherwise need a custom integration for each. The MCP Gateway gives those agents a single, standard surface:

- **One endpoint, many services** — `POST /mcp` aggregates every connected adapter's tools, resources, and prompts
- **Standard discovery** — clients learn the available tools and their JSON Schemas through `tools/list`; nothing is hard-coded on the client side
- **Service wiring stays in the cluster** — service URLs and downstream credentials live in the gateway's configuration, not in each agent
- **Optional A2A interop** — the same tools can be offered to Agent-to-Agent (A2A) protocol clients, and remote A2A agents can be pulled in as MCP tools

## Key Features

- **Unified MCP endpoint** — `POST /mcp` serves all tools, resources, resource templates, and prompts, with cursor pagination and read-only result caching
- **Per-adapter MCP endpoints** — `POST /mcp/<adapter>` scopes a client to a single service (for example only `entity` or only `telemetry`)
- **Nine built-in service adapters** — Entity, Context, Document Processing, Telemetry, Code Sandbox, Web Search, Data Access, Knowledge Base, and Skills (55 tools in total)
- **Dynamic adapters** — register gRPC backends (`grpc`) and remote A2A agents (`a2a-client`) and expose their operations as MCP tools
- **Built-in prompts** — five workflow prompts (debug a request, explore the entity graph, ingest-and-query, data analysis, list tools)
- **Configuration-driven enablement** — each adapter turns on automatically when its service URL is configured
- **API key authentication** — a single `X-Api-Key` shared secret protects the MCP and admin routes
- **Identity propagation** — the `X-On-Behalf-Of` caller identity is carried through to downstream service calls
- **A2A server (optional)** — publishes an Agent Card and accepts A2A `message/send` / `message/stream` tasks that call gateway tools
- **Entitlement check** — MCP serving routes are gated by the `mcp.access` entitlement (report mode by default)

## Architecture Overview

```
  MCP clients                          A2A clients (optional)
  (Claude Code, Virtual Workers,       (agents speaking A2A)
   in-cluster components)                    │
        │  JSON-RPC 2.0 over HTTP             │  /.well-known/a2a-agent-card, /a2a
        ▼                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Express HTTP layer (:8080)                │
│  X-Api-Key auth · mcp.access entitlement guard · trace/     │
│  identity middleware (X-Trace-Id, X-Span-Id, X-On-Behalf-Of)│
├──────────────────────────────┬──────────────────────────────┤
│  UnifiedMcpServer  (/mcp)    │  AdapterMcpServer × N        │
│  all tools · prompts ·       │  (/mcp/<adapter>)            │
│  pagination · result cache   │  one adapter each            │
├──────────────────────────────┴──────────────────────────────┤
│                         Adapters                            │
│ entity · context · docproc · telemetry · sandbox · websearch│
│ dataaccess · knowledgebase · skills · grpc · a2a-client     │
└───────┬──────────┬──────────┬──────────┬──────────┬─────────┘
        ▼          ▼          ▼          ▼          ▼
   Entity     Context     Doc Proc   Telemetry   ... other FireFoundry
   Service    Service     Service    Service     services, gRPC backends,
   (REST)     (gRPC)      (REST)     (HTTP)      remote A2A agents
```

**Core components:**
- **McpGatewayProvider** — creates the adapters, initializes those that are configured, and builds one MCP server per connected adapter plus the unified server
- **UnifiedMcpServer** — aggregates every connected adapter behind `/mcp`; adds prompts, `completion/complete`, pagination, and a 60-second cache for read-only tools
- **AdapterMcpServer** — a lightweight MCP server scoped to one adapter, behind `/mcp/<adapter>`
- **Adapters** — each wraps one FireFoundry client library and defines its tools with typed input schemas
- **ConfigRepository** (optional) — PostgreSQL-backed store for admin configuration records (`DATABASE_ENABLED=true`)
- **A2AProvider** (optional) — builds the A2A Agent Card from the connected adapters and executes A2A tasks

## Documentation

- **[Concepts](./concepts.md)** — Adapters, the unified vs. per-adapter servers, tools/resources/prompts, identity, caching, A2A
- **[Getting Started](./getting-started.md)** — Connect, list tools, and call your first tool with curl
- **[Connecting Clients](./clients.md)** — Claude Code and other MCP clients, Virtual Workers, in-cluster callers, A2A clients
- **[Tools Catalog](./tools.md)** — Every MCP tool, resource template, and prompt, grouped by adapter
- **[Reference](./reference.md)** — HTTP endpoints, MCP methods, admin API, error codes, environment variables
- **[Operations](./operations.md)** — Helm deployment, configuration, health checks, security, monitoring, troubleshooting

## Version and Maturity

- **Current Version**: 0.4.0 (service package); MCP protocol version `2024-11-05`
- **Maturity**: Beta. The MCP tool surface is stable in shape; tool-level enable/disable and rate-limit settings in the admin API are stored but not yet enforced (see [Concepts](./concepts.md#admin-configuration-records)).
- **Helm chart**: `mcp-gateway` 0.1.2, enabled by default in `firefoundry-core`. The chart's default image tag may lag the service version — see [Operations](./operations.md#deployment).

## Repository

Source code: [ff-services-mcp-gateway](https://github.com/firebrandanalytics/ff-services-mcp-gateway) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Virtual Worker Manager](../virtual-workers/README.md) — Virtual Workers reach platform services through the MCP Gateway
- [FF Broker](../ff-broker/README.md) — AI model routing, with optional MCP tool integration
- [Entity Service](../entity-service/README.md), [Context Service](../context-service/README.md), [Telemetry Service](../telemetry-service/README.md) — the most commonly used backing services
