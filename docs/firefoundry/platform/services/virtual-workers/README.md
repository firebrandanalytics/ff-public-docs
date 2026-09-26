# Virtual Worker Manager (VWM)

## Overview

A **Virtual Worker** is more than a CLI coding agent running in a container. It's a **virtual team member** — an AI agent with a defined role, institutional knowledge, specialized skills, a persistent workspace, and the ability to learn and improve over time. The Virtual Worker Manager (VWM) is the platform service that runs these workers for your app.

CLI coding agents like Claude Code, Codex, Cursor, and OpenCode are powerful, but on their own they start every interaction from scratch — no memory of your company, your codebase standards, or what they learned last time. VWM wraps the CLI agent with what it needs to be an effective member of your team:

- **Identity and role** — instructions that define who the worker is and how they operate
- **Institutional knowledge** — a git-backed knowledge base with company context, engineering guidelines, and tribal knowledge
- **Specialized skills** — platform [Skills Service](../skills-service/README.md) skills the worker can discover and read through the MCP Gateway
- **Persistent workspace** — sessions that survive restarts and maintain context across interactions
- **Continuous learning** — knowledge captured from each session feeds into future sessions

VWM provisions the workspace, manages sessions, routes prompts, and records telemetry, so your app only has to decide what to ask the worker to do.

## Purpose and Role in Platform

Use VWM when a step in your app needs an agent that can **work in a filesystem and shell for minutes to hours**: write and refactor code, run tests, analyze a repository, or produce multi-file deliverables. Your agent bundle drives the worker through the Agent SDK (or the REST API), feeds it files and prompts, and collects its results.

| Capability | Bots | Virtual Workers |
|------------|------|-----------------|
| Execution | Direct LLM calls via the Broker | CLI coding agents in managed containers |
| Duration | Seconds | Minutes to hours |
| State | Stateless (or entity graph) | Persistent workspace and git repositories |
| Capabilities | Prompt + tools | Full coding agent (files, shell, git, MCP tools) |
| Use case | Quick, structured AI steps | Autonomous coding and multi-step file work |

The two are complementary: a typical app uses bots for classification, extraction, and planning, and hands the heavy, open-ended work to a virtual worker.

## Key Features

- **Multi-CLI support** — Claude Code, Codex CLI, Cursor, and OpenCode through one API
- **Sessions** — create, resume, and end stateful sessions with persistent workspaces
- **Dual repositories** — a knowledge base (worker repo) separate from the task workspace (session repo)
- **Auto-learning** — workers capture reusable knowledge at session end, for human review
- **Skills via the MCP Gateway** — workers read skills from the platform [Skills Service](../skills-service/README.md) with the gateway's `skills_*` tools
- **Platform tools via MCP** — entity graph, working memory, document processing, and other services through the MCP Gateway
- **Sync, streaming (SSE), and abortable prompts**
- **File API** — read, write, upload, and download workspace files
- **Telemetry** — per-request token usage, timing, artifacts, and raw CLI output
- **Agent SDK integration** — standalone `VirtualWorker`/`VWSession` and entity-based `VWSessionEntity` with crash recovery

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Your agent bundle / app                                      │
│   VWSessionEntity  |  VirtualWorker + VWSession  |  REST       │
└──────────────────────────┬───────────────────────────────────┘
                           │ REST + SSE (port 8080)
┌──────────────────────────▼───────────────────────────────────┐
│  Virtual Worker Manager                                        │
│   workers · sessions · prompts · files · telemetry             │
└──────┬──────────────────────┬──────────────────────┬─────────┘
       │ starts one workspace │                      │
       │ per session          │                      │
┌──────▼──────────────────┐   │               ┌──────▼─────────┐
│  Worker workspace        │   │               │ Git hosting    │
│  CLI agent (Claude Code, │◄──┘               │ knowledge base │
│  Codex, Cursor, OpenCode)│──────────────────►│ + session repo │
│  worker_repo/            │                   └────────────────┘
│  session_repo/           │
└──────┬──────────────────┘
       │ MCP
┌──────▼──────────────────────────────────────────┐
│  MCP Gateway → Entity graph, working memory,     │
│  document processing, skills, web search, …      │
└─────────────────────────────────────────────────┘
```

Each session gets its own container and persistent volume. The worker's knowledge base and your session repository are cloned into the workspace, and changes are pushed back to per-session branches when the session ends.

## Documentation

- **[Concepts](./concepts.md)** — Workers, sessions, knowledge base, session repo, auto-learning, skills (via the MCP Gateway), runtimes, and app design patterns
- **[Getting Started](./getting-started.md)** — Define a worker, then drive it from the Agent SDK or the REST API
- **[Reference](./reference.md)** — Full REST API reference and error codes
- **[Operations](./operations.md)** — Enabling VWM, the settings an app team touches, verifying, limits, and troubleshooting

## Version and Maturity

- **Service version**: 0.1.x (virtual-worker-manager Helm chart 0.3.1)
- **Maturity**: Early release (0.x) — optional service, **disabled by default** in `firefoundry-core`. Expect the API to evolve between releases.

## Repository

**Source Code**: `ff-virtual-workers` (private repository). SDK packages: `@firebrandanalytics/ff-agent-sdk/virtual-worker` and `@firebrandanalytics/vwm-client`.

## Related

- [Platform Services Overview](../README.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
- [MCP Gateway](../mcp-gateway/README.md) — How workers reach platform services
- [FF Broker](../ff-broker/README.md) — Model calls for bots
