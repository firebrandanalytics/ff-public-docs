# Virtual Worker Manager (VWM)

## Overview

The Virtual Worker Manager (VWM) enables FireFoundry to orchestrate CLI-based AI coding agents — Claude Code, Codex CLI, Gemini CLI, and OpenCode — as managed Kubernetes services. It brings the power of autonomous coding agents into enterprise workflows with proper lifecycle management, persistent workspaces, observability, and integration with the FireFoundry platform.

## Problem Statement

Modern CLI coding agents are powerful but challenging to operationalize:

- **Manual Management**: Each agent instance requires manual setup, configuration, and monitoring
- **No Persistence**: Agent sessions don't persist across restarts or scale events
- **Integration Gap**: Difficult to integrate into automated workflows, CI/CD, or other systems
- **Resource Management**: No automated scaling, timeout handling, or resource cleanup
- **Observability**: Limited visibility into agent behavior, costs, and outcomes

## What VWM Provides

VWM is a **mechanical orchestration layer** focused on:

- **Abstracting Complexity**: Consumers send work to named workers; VWM handles the rest
- **Managing Lifecycle**: Automatically spins up K8s pods, handles timeouts, and cleans up resources
- **Persisting Sessions**: Sessions survive pod restarts via Kubernetes persistent volumes
- **Enabling Integration**: REST API with SSE streaming for easy integration with bots, workflows, and external systems
- **Providing Observability**: Full telemetry on requests, responses, token usage, and resource consumption

**Intelligence lives elsewhere** in the FireFoundry stack. Bots decide which worker to use, entity graphs orchestrate multi-worker workflows, and the VWM doesn't make decisions about *what* work to do — it just executes requests.

## Key Features

- **Multi-CLI Support**: Claude Code, Codex CLI, Gemini CLI, and OpenCode through a single unified API
- **Session Management**: Create, resume, and end stateful sessions with persistent workspaces
- **Dual Repository Architecture**: Separate knowledge base (worker repo) from task workspace (session repo)
- **Auto-Learning**: Workers automatically capture knowledge at session end for future reference
- **Skills System**: Versioned tool packages distributed from blob storage
- **Communication Patterns**: Synchronous, streaming (SSE), and asynchronous prompt execution
- **Telemetry**: Request-level tracking with token usage, timing, raw CLI output, and learning metrics
- **System Instructions**: Database-stored global instructions, hot-updatable without redeployment

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
    │PostgreSQL│   │  K8s Jobs/Pods  │    │ Blob Storage  │
    │(vwm, tel)│   │                 │    │  (Skills)     │
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

## Database Schemas

| Schema | Tables | Purpose |
|--------|--------|---------|
| `shared` | `runtimes`, `skills` | Global resources shared across services |
| `vwm` | `workers`, `worker_skills`, `sessions`, `jobs`, `system_settings` | VWM-specific configuration and state |
| `vw_telemetry` | `requests`, `learnings` | Observability data |

## Documentation

- **[Concepts](./concepts.md)** — Workers, sessions, runtimes, skills, dual repos, auto-learning
- **[Getting Started](./getting-started.md)** — Step-by-step: create a worker, run a session, execute prompts
- **[Reference](./reference.md)** — Full API reference, environment variables, error codes

## Related

- [Platform Services Overview](../README.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
