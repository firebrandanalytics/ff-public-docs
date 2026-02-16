# Virtual Worker Manager — Concepts

This document covers the core concepts behind the Virtual Worker Manager (VWM). For API details, see the [Reference](./reference.md).

---

## Workers

A **Worker** is a configured CLI coding agent definition. It specifies *how* an agent should behave but does not run anything itself — workers are templates for creating sessions.

### Worker Configuration

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique human-readable name (e.g., `code-reviewer`) |
| `description` | string? | Purpose description |
| `runtimeId` | UUID | Base container image to use |
| `cliType` | enum | CLI tool: `claude-code`, `codex`, `gemini`, `opencode` |
| `agentMd` | string? | Worker-specific instructions (merged with system instructions) |
| `modelConfig` | object? | Provider, model, temperature, max tokens |
| `mcpServers` | array? | MCP server connections (name + URL) |
| `workerRepoUrl` | URL? | Knowledge base repository |
| `workerRepoBranch` | string | Base branch for worker repo (default: `main`) |
| `autoLearn` | boolean | Enable automatic knowledge capture at session end |
| `skills` | array | Assigned skill packages (via worker_skills join table) |
| `timeout` | number | Max session duration in seconds (default: 3600) |

### What Makes Workers "Virtual"

Unlike a developer running Claude Code locally:

- **Managed**: VWM handles lifecycle, scaling, and cleanup
- **Stateless Definition**: Worker config is stored centrally; instances are ephemeral
- **Multiplexed**: Many sessions can use the same worker configuration
- **Observable**: All interactions are logged and traceable

---

## Sessions

A **Session** is a stateful interaction with a virtual worker. Sessions are the primary unit of work — you cannot make requests to a worker without an active session.

### Session Lifecycle

```
Create Session ──▶ pending
                      │
              (Job starts, harness bootstraps)
                      │
                      ▼
                   active ◀──────────┐
                      │              │
              (Inactivity timeout)   │ (New request arrives)
                      │              │
                      ▼              │
                  suspended ─────────┘
                      │
              (Explicit end or max timeout)
                      │
                      ▼
               ending ──▶ ended
```

| Status | Description |
|--------|-------------|
| `pending` | Session created, K8s job not yet started |
| `active` | Job running, harness ready to accept requests |
| `suspended` | Job terminated due to inactivity, can resume on next request |
| `ending` | Shutdown in progress (auto-learning, git cleanup) |
| `ended` | Session complete, resources cleaned up |
| `failed` | Session failed to start or crashed |

### Sessions vs Jobs

| Concept | Scope | Lifetime | Storage |
|---------|-------|----------|---------|
| **Session** | Client-visible | Until explicitly ended | Persistent Volume |
| **Job** | Internal | Activity-based (timeout) | Uses session's PV |

A session can span **multiple jobs**. When a job times out due to inactivity, the session moves to `suspended`. A new job starts automatically when the next request arrives, remounting the same persistent volume to preserve workspace state.

### Sub-sessions

Within a job, **sub-sessions** allow parallel prompt execution. Each sub-session tracks its own CLI conversation context. Consumers must avoid disk conflicts between parallel operations.

---

## Runtimes

A **Runtime** is a base container image that can run virtual workers.

### Runtime Hierarchy

```
Base Runtime (e.g., python:3.11-slim)
        │
        ▼
VW Runtime (e.g., python-3.11-vw)
  + Node.js
  + CLI tools (Claude Code, Codex, Gemini)
  + Harness server
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable name |
| `baseImage` | string | Docker base image (e.g., `python:3.11-slim`) |
| `vwImage` | string? | VW-enabled image with harness and CLIs installed |
| `tags` | string[] | Capability tags |

Workers reference a runtime by ID. The VWM uses the runtime's `vwImage` (or `baseImage` if no VW image exists) when creating K8s jobs.

---

## Skills

**Skills** are versioned tool packages that extend worker capabilities.

### Skill Distribution

1. Skills are packaged as `.skill` (zip) files
2. Uploaded via the Admin API and stored in blob storage
3. Downloaded and extracted to the workspace during session bootstrap

### Skill Configuration

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Skill name (e.g., `security-scanner`) |
| `version` | string | Semver version |
| `description` | string? | What the skill does |
| `blobId` | string | Reference to blob storage |
| `targetPath` | string | Extraction path relative to workspace (default: `.`) |
| `isSystem` | boolean | System-level skill managed by platform |
| `defaultInclude` | boolean | Auto-include for all workers (requires `isSystem=true`) |

### System Skills

Skills flagged as `isSystem` with `defaultInclude=true` are automatically loaded for every session, regardless of worker configuration. This enables platform-wide capabilities without per-worker configuration.

---

## Repository Architecture

Virtual workers support a **dual repository architecture** that separates long-lived knowledge from session-specific work.

### Worker Repository (`worker_repo`)

Long-lived knowledge base configured at the worker level.

| Aspect | Detail |
|--------|--------|
| **Purpose** | Tribal knowledge, best practices, company information, guidelines |
| **Lifecycle** | Persistent across all sessions for this worker |
| **Access** | Read-only (except `learnings/` directory) |
| **Branch Isolation** | Session-specific branch: `ff-vwm/{workerId}-{sessionId}` |
| **Location** | `/workspace/worker_repo/` |

**Typical structure:**
```
worker_repo/
├── COMPANY.md         # Company information
├── PRODUCTS.md        # Product documentation
├── GUIDELINES.md      # Development best practices
├── TECH_STACK.md      # Technology preferences
└── learnings/         # Writable directory
    └── session-*.md   # Auto-generated learning documents
```

### Session Repository (`session_repo`)

Task-specific work area configured per session.

| Aspect | Detail |
|--------|--------|
| **Purpose** | Task-specific code, scripts, deliverables |
| **Lifecycle** | Specific to this session |
| **Access** | Full read-write |
| **Branch Isolation** | Session-specific branch: `session-{sessionId}` |
| **Location** | `/workspace/session_repo/` |

### Branch Isolation

Each session creates a unique branch to prevent concurrent session conflicts:

- **Enforcement**: Git hooks block switching branches during a session
- **Validation**: Checked during bootstrap
- **Cleanup**: Changes committed and pushed on session end; human reviews and merges later

### System Instructions

Global system instructions are managed by the platform and apply to all workers:

- **Merging**: System instructions are merged with worker-specific `agentMd`
- **Hot Updates**: Can be updated via Admin API without redeployment
- **Location**: Written to `/workspace/CLAUDE.md` during bootstrap

---

## Auto-Learning System

Workers with `autoLearn` enabled automatically capture knowledge at the end of each session.

### How It Works

1. **Session End**: When a session is deleted, VWM triggers the learning skill before shutdown
2. **Knowledge Extraction**: The CLI agent analyzes the session transcript and extracts generalizable learnings
3. **Documentation**: Learning content is written to `worker_repo/learnings/session-{id}.md`
4. **Git Operations**: The harness commits and pushes changes to the session branch
5. **Human Review**: Changes are available on the branch for human review and merge (PR automation is future work)

### What Gets Captured

- General patterns and insights discovered during the session
- Common issues encountered and their solutions
- Best practices identified
- Knowledge applicable to future sessions

### What Doesn't Get Captured

- Session-specific details (task descriptions, filenames)
- Sensitive information
- Redundant information already in the knowledge base

### Requirements

- Worker must have `autoLearn: true`
- Worker must have a `workerRepoUrl` configured
- The `session-learning` skill handles the prompting

---

## Workspace Structure

When a harness pod bootstraps, it creates this workspace layout:

```
/workspace/
├── CLAUDE.md            # Merged system + worker instructions
├── worker_repo/         # Cloned from workerRepoUrl (if configured)
│   ├── COMPANY.md
│   ├── GUIDELINES.md
│   └── learnings/
├── session_repo/        # Cloned from session repository (if configured)
│   └── (task files)
└── .skills/             # Extracted skill packages
    └── security-scanner/
```

The bootstrap process:

1. Clone worker repository (if `workerRepoUrl` is set) → create session branch
2. Clone session repository (if session has a repository configured) → create session branch
3. Download and extract assigned skills from blob storage
4. Write merged `CLAUDE.md` from system settings + worker `agentMd`
5. Generate CLI-specific MCP configuration files
6. Signal readiness to VWM

---

## Telemetry

VWM captures comprehensive telemetry for observability, debugging, and cost analysis.

### Request Telemetry

Every prompt sent to a virtual worker is recorded, including:

- Session and worker identifiers
- Breadcrumbs for tracing and correlation
- Full prompt text and response
- Token usage (input and output)
- Execution duration
- Files created or modified (artifacts)

### Learning Telemetry

Auto-learning executions are tracked separately, capturing the generated learning content, token usage, and whether the git commit/push succeeded.

### Accessing Telemetry

Telemetry is available via the Session API:

- `GET /sessions/:id/telemetry` — Full request history for a session
- `GET /sessions/:id/stats` — Aggregated statistics (total requests, tokens, duration)

---

## MCP Integration

Virtual workers access FireFoundry services via the **MCP Gateway**.

### How It Works

1. VWM configures the harness with the MCP gateway URL
2. The harness generates CLI-specific MCP configuration files during bootstrap
3. CLI tools discover and connect to MCP servers automatically
4. All MCP auth is handled by the gateway — workers don't need credentials

### Available Capabilities

Via MCP gateway, workers can access:

- Entity graph operations (create, query, update nodes)
- Context service (working memory, blobs)
- Document processing
- Web search
- Additional FireFoundry platform services

---

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
