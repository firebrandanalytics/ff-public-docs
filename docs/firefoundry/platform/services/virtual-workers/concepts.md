# Virtual Worker Manager — Concepts

---

## What Is a Virtual Worker?

A Virtual Worker is a **virtual team member** — a managed AI agent with a defined role, institutional knowledge, specialized skills, and the ability to learn and improve over time. It's the difference between opening a fresh AI chat session and working with a colleague who knows your company, your codebase, and your engineering standards.

The underlying CLI coding agent (Claude Code, Codex, Gemini, OpenCode) is just the execution engine — the raw capability to read code, reason about problems, and produce output. A Virtual Worker wraps that engine with everything needed to make it effective in *your* organization:

- **Identity and role** — who this worker is and what they specialize in
- **Institutional knowledge** — company context, product details, engineering guidelines, tribal knowledge
- **Specialized skills** — tools and capabilities beyond the base CLI agent
- **Persistent workspace** — a working environment that survives across interactions
- **Continuous learning** — knowledge captured from each session feeds back into future sessions

### Example: Bob the Backend Engineer

Consider "Bob," a Virtual Worker configured as a backend/DevOps engineer. Bob isn't a generic AI — Bob is a specific team member:

- **Bob has a role**: Backend/DevOps engineer specializing in Kubernetes, microservices, and CI/CD
- **Bob knows the company**: Company mission, culture, products, and how the engineering team works
- **Bob knows the tech stack**: Which languages, frameworks, databases, and tools the team uses — and *why*
- **Bob follows the team's guidelines**: Coding standards, testing philosophy, deployment procedures, security requirements
- **Bob has a personality**: Communicates like a senior engineer — clear, direct, considers tradeoffs, pushes back on bad ideas professionally
- **Bob learns**: After every session, Bob documents what he learned. A merge agent reviews these learnings, and the valuable ones get folded back into Bob's permanent knowledge base

Over time, Bob gets better at his job. He accumulates institutional knowledge. He doesn't make the same mistake twice. He's not a fresh AI session every time — he's a team member who's been here a while and knows how things work.

### How This Works Under the Hood

Bob's identity is composed from several pieces managed by VWM:

```
Worker Definition (Bob)
├── Role & Instructions (agentMd)    → "You are a backend/DevOps engineer..."
├── Knowledge Base (worker repo)     → COMPANY.md, PRODUCTS.md, GUIDELINES.md, TECH_STACK.md
├── Skills (tool packages)           → security-scanner, deployment-validator, etc.
├── MCP Connections                  → Entity graph, working memory, doc processing
├── CLI Engine                       → Claude Code (or Codex, Gemini, OpenCode)
└── Runtime Environment              → Container image with the right tools installed
```

When you start a session with Bob, VWM assembles all of these into a running workspace where the CLI agent has access to Bob's full context. When the session ends, Bob's learnings get captured and his knowledge base grows.

---

## How Virtual Workers Compare to Cloud Coding Agents

If you've used [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on claude.ai or [Codex](https://openai.com/index/introducing-codex/) on ChatGPT, you've already experienced cloud-hosted coding agents — AI that can clone a repo, read and write files, run commands, and produce working code. These are impressive tools, and we use them ourselves. But they have real limitations that become apparent in enterprise and production contexts.

Virtual Workers address those limitations while adding capabilities that cloud offerings don't provide at all.

### What cloud coding agents do well

Cloud coding agents are excellent for quick, self-contained tasks: fixing a bug in a public repo, scaffolding a new project, exploring an unfamiliar codebase. For individual developers and small teams doing general-purpose coding work that doesn't need to be part of an application, cloud agents are often the right choice.

### Where cloud coding agents fall short

**They can't reach your network.** A cloud agent can't access your internal APIs, staging databases, private package registries, or cloud resources behind a VPN. If the work requires interacting with systems that aren't publicly accessible, a cloud agent simply can't do it.

**Your code leaves your infrastructure.** Every file, every prompt, every response passes through a third-party cloud. For organizations with regulatory requirements, intellectual property concerns, or security policies around data residency, this is often a non-starter.

**You don't control the environment.** Cloud agents run in a fixed sandbox. You can't install specific system packages, pin tool versions, configure custom runtimes, or ensure the environment matches your production stack. You work within whatever the provider gives you.

**Every session starts from scratch.** Cloud agents don't carry institutional knowledge between sessions. They don't know your company's engineering standards, your product architecture, or the lessons learned from last week's work. Each interaction begins with a blank slate.

### What Virtual Workers add

| Capability | Cloud Coding Agents | Virtual Workers |
|-----------|-------------------|-----------------|
| **Network access** | Public internet only | Runs in your cluster — access internal services, databases, private repos |
| **Data residency** | Provider's cloud | Your infrastructure — code and prompts never leave |
| **Environment control** | Fixed sandbox | Custom container images with your tools, dependencies, and runtimes |
| **Institutional knowledge** | None — fresh each session | Git-backed knowledge base with company context, guidelines, tribal knowledge |
| **Learning** | None | Auto-learning captures knowledge from each session for future use |
| **Skills & tools** | Limited to what's pre-installed | Versioned skill packages, MCP integration with platform services |
| **Platform integration** | Standalone | Connects to entity graphs, working memory, document processing, and other FireFoundry services |
| **Multi-CLI support** | Single provider | Claude Code, Codex, Gemini, OpenCode through a single API |
| **Programmatic access** | Varies | Full REST API with SSE streaming, designed for automation and orchestration |

### Beyond self-hosted coding agents

It's tempting to think of Virtual Workers as just "self-hosted Claude Code" or "self-hosted Codex." That's part of the picture — and even that alone solves real problems around network access, security, and environment control. But the Virtual Worker concept goes further.

The knowledge base, auto-learning, skills system, and platform integration transform a generic coding agent into a **specialized team member**. A cloud coding agent is a tool you use; a Virtual Worker is a colleague you work with. The difference grows over time as the worker accumulates knowledge, and it compounds across your organization as different workers specialize in different domains.

VWM's CLI-agnostic architecture also means it isn't tied to any single provider's agent. As new coding agents emerge or improve, they can be added as adapters without changing how your workers, sessions, or knowledge bases operate.

---

## Workers

A **Worker** is the definition of a virtual team member. It captures everything about *who this agent is* — role, knowledge, tools, and behavior — without actually running anything. Think of it as a job description combined with the institutional knowledge someone in that role would need.

Multiple sessions can run from the same worker definition simultaneously, each with its own workspace and state. The worker is the blueprint; sessions are the instances.

Workers are configured with:

- **Name and description** — who this worker is and what they do
- **CLI type** — which coding agent engine to use (`claude-code`, `codex`, `gemini`, `opencode`)
- **Instructions** (`agentMd`) — the worker's role definition, merged with platform-wide system instructions
- **Knowledge base** (`workerRepoUrl`) — a git repository containing the worker's institutional knowledge
- **Skills** — versioned tool packages that extend the worker's capabilities
- **MCP servers** — connections to FireFoundry platform services (entity graph, working memory, etc.)
- **Model configuration** — provider, model, temperature, and token limits
- **Auto-learning** — whether to capture knowledge at the end of each session

### Supported CLI engines

| CLI engine | `cliType` | Conversation resume within a session |
|------------|-----------|--------------------------------------|
| Claude Code | `claude-code` | Yes |
| Codex CLI | `codex` | Not supported — don't rely on the CLI remembering earlier prompts (workspace files persist) |
| Gemini CLI | `gemini` | Not supported — don't rely on the CLI remembering earlier prompts (workspace files persist) |
| OpenCode | `opencode` | Yes |

If your app relies on the worker remembering earlier prompts in the same session, choose an engine with resume support, or restate the needed context in each prompt (for example, by pointing the worker at files it wrote earlier).

---

## Sessions

A **Session** is a stateful interaction with a virtual worker — it's the equivalent of sitting down with a team member to work on a task.

When you create a session, VWM provisions a container with the worker's full context: instructions, knowledge base, skills, and MCP connections. The workspace persists for the lifetime of the session, so the worker maintains context across multiple prompts and can pick up where it left off.

### Session Lifecycle

```
Create Session ──▶ pending
                      │
              (Container starts, workspace bootstraps)
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

Sessions can be **suspended** when idle and **resumed** transparently when the next request arrives. The workspace is preserved on a persistent volume, so the worker doesn't lose context even if its container is recycled.

### Sub-sessions

Within a session, you can run multiple prompts in parallel using **sub-sessions**. Each sub-session maintains its own conversation context with the CLI agent. This is useful for parallelizing independent tasks, though you need to avoid file conflicts between parallel operations.

---

## Knowledge Base (Worker Repository)

The knowledge base is what turns a generic CLI agent into a knowledgeable team member. It's a git repository containing everything the worker needs to know about your organization, products, and engineering practices.

### What Goes in a Knowledge Base

A typical knowledge base looks like this:

```
worker_repo/
├── COMPANY.md         # Company mission, culture, values
├── PRODUCTS.md        # Product details and architecture
├── GUIDELINES.md      # Engineering standards and best practices
├── TECH_STACK.md      # Technology choices and rationale
└── learnings/         # Auto-generated learning documents
    ├── session-001.md
    └── session-002.md
```

The contents are entirely up to you. Some teams include:

- Architectural decision records
- API design guidelines
- Common debugging runbooks
- Customer context for client-specific workers
- Code review checklists

The knowledge base is **read-only** during a session (except the `learnings/` directory), ensuring the worker can reference it but not accidentally modify institutional knowledge.

### Branch Isolation

Each session works on its own branch of the knowledge base, preventing concurrent sessions from conflicting. Changes (including auto-generated learnings) are pushed to the session branch for human review and merge.

---

## Session Repository

While the knowledge base carries long-lived institutional knowledge, the **session repository** is the task-specific workspace. This is where the worker does its actual work — writing code, creating deliverables, modifying project files.

The session repository is a separate git repo configured per session. It has full read-write access and its own branch isolation. Think of the knowledge base as "what the worker knows" and the session repository as "what the worker is working on."

---

## Auto-Learning

One of the most powerful aspects of Virtual Workers is their ability to **learn and improve over time**. With auto-learning enabled, the worker automatically captures generalizable knowledge at the end of each session.

### How It Works

1. When a session ends, VWM prompts the worker to reflect on what it learned
2. The worker analyzes the session and extracts knowledge that would be useful in future sessions
3. The learning is written to the knowledge base's `learnings/` directory
4. Changes are committed and pushed to the session branch
5. A human (or merge agent) reviews the learnings and decides what to fold into the permanent knowledge base

### What Gets Captured

Good learnings are **general and reusable** — patterns discovered, better approaches identified, common pitfalls and their solutions, best practices refined through experience.

What doesn't get captured: session-specific details, sensitive information, and knowledge already present in the existing knowledge base.

### The Learning Cycle

Over time, this creates a virtuous cycle:

```
Session work → Learnings captured → Human review → Knowledge base updated → Better future sessions
```

Each session makes the worker slightly more knowledgeable. A worker that's been through 50 sessions has accumulated institutional knowledge that a fresh AI session simply doesn't have.

---

## Skills

**Skills** are versioned tool packages that give workers specialized capabilities beyond what the base CLI agent provides. They're distributed as zip files, downloaded from blob storage during session bootstrap, and extracted into the workspace.

Skills can include anything the worker might need: custom scripts, configuration templates, reference data, MCP tool definitions, or specialized prompts. Platform-wide **system skills** are automatically included in every session, while other skills are assigned per worker.

These skill packages are managed through VWM's own [Admin API](./reference.md#skills) and are separate from the platform [Skills Service](../skills-service/README.md). To let a worker use Skills Service skills (including skills your agents publish and update at runtime), include the [MCP Gateway](../mcp-gateway/clients.md#virtual-workers) in the worker's `mcpServers`; the CLI agent can then call `skills_list`, `skills_read`, and `skills_read_file`. See [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md#virtual-workers).

---

## Runtimes

A **Runtime** is the container environment a worker runs in. Different workers might need different base images — a Python-focused worker needs Python installed, a Java worker needs the JDK.

Runtimes are layered: a base image (e.g., `python:3.11-slim`) is extended with the CLI tools and the VWM components needed to run virtual workers (the runtime's `vwImage`). Your environment administrator typically provides VW-capable images; you pick or register the runtime that has the languages and tools your worker needs. Workers reference a runtime, and VWM uses it when provisioning containers for sessions.

---

## System Instructions

Global system instructions apply to **all** virtual workers across the platform. They're merged with each worker's individual instructions during session bootstrap, providing consistent behavior (security policies, output formatting, communication standards) without duplicating configuration across every worker.

System instructions can be updated without redeployment, enabling platform-wide policy changes to take effect immediately.

---

## MCP Integration

Virtual Workers access FireFoundry platform services through the **MCP Gateway**. This gives workers access to the entity graph, working memory, document processing, web search, and other platform capabilities — all without managing credentials or service discovery.

MCP connections are configured per worker and automatically wired up during session bootstrap. The CLI agent discovers available tools through standard MCP protocol, so workers can use platform services naturally as part of their workflow.

---

## Telemetry

Every interaction with a virtual worker is captured for observability. This includes:

- **Request telemetry** — every prompt and response, with token usage, timing, and artifacts
- **Learning telemetry** — auto-learning results, including whether the knowledge was successfully committed

Telemetry is accessible via the Session API (`GET /sessions/:id/telemetry` and `GET /sessions/:id/stats`), enabling cost analysis, debugging, and quality monitoring.

---

## Designing Your App Around Virtual Workers

### When to use a virtual worker

Reach for a virtual worker when the step needs a filesystem, a shell, git, or long-running autonomous iteration — code generation and refactoring, running and fixing tests, repository analysis, or producing a set of files. For short, structured AI steps (classify, extract, summarize, decide), a bot is faster and cheaper.

### Common patterns

- **Entity-driven session** — model the job as a `VWSessionEntity`. Override `get_next_prompt()` to issue one prompt per turn and return `null` when done. Each turn is a `VWTurnEntity`, so a crashed bundle resumes where it left off instead of re-running completed turns.
- **Feedback loop** — inspect the previous turn's response in `get_next_prompt()` and issue a follow-up ("run the tests and fix failures") until a stop condition or a turn limit.
- **Bot plans, worker executes** — a bot turns a user request into a precise task description; the worker carries it out in the session repo; a second bot reviews or summarizes the result.
- **Files in, files out** — upload inputs (or bridge them from working memory) before the first prompt, then download outputs or bridge them back to working memory for the rest of your pipeline.
- **Specialized workers** — define one worker per role (reviewer, test writer, data analyst), each with its own instructions, knowledge base, and skills, and route work to the right one by name.

### Trade-offs to plan for

- **Start-up time** — a new session provisions a container and clones repositories, so the first prompt waits for the session to become `active`. Reuse a session for related prompts instead of creating one per prompt.
- **Duration and cost** — a single prompt can run for minutes and use many tokens. Set prompt timeouts, stream progress to your users, and check per-session stats.
- **Idle sessions suspend** — after a period of inactivity a session is suspended and resumes on the next request, with a short delay while the workspace comes back.
- **Parallelism** — sub-sessions let you run prompts in parallel within one session, but they share the filesystem; give each sub-session its own directory. For fully independent work, use separate sessions.
- **Human review** — changes land on per-session branches, and learnings are proposed, not merged. Build a review step into your workflow where it matters.

---

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
