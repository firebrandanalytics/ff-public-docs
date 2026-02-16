# Virtual Worker Manager (VWM)

## Overview

A **Virtual Worker** is more than a CLI coding agent running in a container. It's a **virtual team member** — an AI agent with a defined role, institutional knowledge, specialized skills, persistent workspace, and the ability to learn and improve over time. The Virtual Worker Manager (VWM) is the platform service that brings these virtual team members to life.

CLI coding agents like Claude Code, Codex, Gemini, and OpenCode are powerful, but on their own they start every interaction from scratch — no memory of your company, your codebase standards, or what they learned last time. VWM changes that by wrapping the CLI agent with everything needed to make it an effective member of your team:

- **Identity and role** — instructions that define who the worker is and how they operate
- **Institutional knowledge** — a git-backed knowledge base with company context, engineering guidelines, and tribal knowledge
- **Specialized skills** — versioned tool packages that extend the worker's capabilities
- **Persistent workspace** — sessions that survive restarts and maintain context across interactions
- **Continuous learning** — knowledge captured from each session feeds into future sessions

VWM handles all the orchestration — provisioning containers, managing sessions, routing prompts, collecting telemetry — so consumers can focus on the work, not the infrastructure.

For a deeper explanation of what makes Virtual Workers different from raw CLI agents, see [Concepts](./concepts.md).

## Key Features

- **Multi-CLI Support**: Claude Code, Codex CLI, Gemini CLI, and OpenCode through a single unified API
- **Session Management**: Create, resume, and end stateful sessions with persistent workspaces
- **Dual Repository Architecture**: Separate knowledge base (worker repo) from task workspace (session repo)
- **Auto-Learning**: Workers automatically capture knowledge at session end for future reference
- **Skills System**: Versioned tool packages distributed from blob storage
- **Communication Patterns**: Synchronous, streaming (SSE), and asynchronous prompt execution
- **Telemetry**: Request-level tracking with token usage, timing, raw CLI output, and learning metrics
- **System Instructions**: Global instructions, hot-updatable without redeployment

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Consumers                                      │
│           (Agent Bundles, Bots, External Systems)                │
└────────────────────────┬────────────────────────────────────────┘
                         │ REST API (+ SSE streaming)
┌────────────────────────▼────────────────────────────────────────┐
│                  VWM Service (ff-services-vwm)                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ Session Mgmt │  │  Job Orchestrator │  │   Admin API       │  │
│  └──────────────┘  └──────────────────┘  └───────────────────┘  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Telemetry   │  │  Auto-Learning   │  │  System Settings  │  │
│  └──────────────┘  └──────────────────┘  └───────────────────┘  │
└────────┬──────────────────┬──────────────────────┬──────────────┘
         │                  │                      │
    ┌────▼────┐   ┌────────▼────────┐    ┌───────▼───────┐
    │Database │   │  K8s Jobs/Pods  │    │ Blob Storage  │
    │         │   │                 │    │  (Skills)     │
    └─────────┘   └────────┬────────┘    └───────────────┘
                           │
              ┌────────────▼────────────┐
              │   Harness Pod           │
              │  ┌────────────────────┐ │
              │  │  Bootstrap Engine  │ │
              │  │  (git, skills, cfg)│ │
              │  ├────────────────────┤ │
              │  │   CLI Adapter      │ │
              │  │  (Claude/Codex/    │ │
              │  │   Gemini/OpenCode) │ │
              │  ├────────────────────┤ │
              │  │   File Operations  │ │
              │  ├────────────────────┤ │
              │  │  /workspace/       │ │
              │  │  ├── CLAUDE.md     │ │
              │  │  ├── worker_repo/  │ │
              │  │  └── session_repo/ │ │
              │  └────────────────────┘ │
              │       ▲ PVC mount       │
              └───────┼─────────────────┘
                      │
              ┌───────▼───────┐
              │ Persistent    │
              │ Volume (PVC)  │
              └───────────────┘
```

### Component Breakdown

| Component | Repository | Purpose |
|-----------|-----------|---------|
| **ff-services-vwm** | `ff-virtual-workers/apps/` | VWM REST API service — session management, job orchestration, admin CRUD, telemetry |
| **ff-vw-harness** | `ff-virtual-workers/packages/` | In-pod HTTP server — workspace bootstrap, CLI execution, file operations, streaming |
| **ff-vw-harness-client** | `ff-virtual-workers/packages/` | TypeScript client for VWM-to-harness communication |
| **vwm-client** | `ff-virtual-workers/packages/` | TypeScript client for SDK-to-VWM communication |

### Harness Abstraction

Different CLI tools have different interfaces. The **harness** provides a unified HTTP API that:

1. **Bootstraps** the workspace — clones repos, downloads skills, writes configuration files
2. **Executes** prompts through the underlying CLI via adapters
3. **Streams** responses back to VWM via SSE
4. **Manages files** on the workspace filesystem
5. **Shuts down** cleanly — collects transcript, commits/pushes git changes

| CLI Tool | Non-Interactive Mode | Resume Support | Output Format |
|----------|---------------------|----------------|---------------|
| Claude Code | `claude -p` | `--resume <id>` | JSON |
| Codex CLI | `codex exec` | N/A | JSON |
| Gemini CLI | `gemini -p` | N/A | JSON |
| OpenCode | Native server | Native | JSON |

## Relationship to Other FireFoundry Components

### VWM vs Bots

| Capability | Bots | Virtual Workers |
|------------|------|-----------------|
| Execution | Direct LLM calls via Broker | CLI agents in containers |
| Duration | Seconds | Minutes to hours |
| State | Stateless (or entity graph) | Persistent workspace |
| Capabilities | Prompt + tools | Full coding agent (file access, shell, etc.) |
| Use Case | Quick AI interactions | Autonomous coding tasks |

Virtual Workers are **complementary** to Bots — use Bots for quick AI interactions, Virtual Workers for autonomous coding work.

### Agent SDK Integration

The Agent SDK provides first-class virtual worker support with two layers:

- **Standalone** (`VirtualWorker` + `VWSession`): For scripts, tests, and simple integrations
- **Entity framework** (`VWSessionEntity` + `VWTurnEntity`): For production agent bundles with idempotency, crash recovery, and progress streaming

See the [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md) for SDK usage.

## Documentation

- **[Concepts](./concepts.md)** — Workers, sessions, runtimes, skills, dual repos, auto-learning
- **[Getting Started](./getting-started.md)** — Step-by-step: create a worker, run a session, execute prompts
- **[Reference](./reference.md)** — Full API reference, environment variables, error codes

## Related

- [Platform Services Overview](../README.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
