# Virtual Worker Manager — Getting Started

This guide walks you through creating a virtual worker, starting a session, executing prompts, and integrating with the Agent SDK.

## Prerequisites

- A FireFoundry deployment with VWM enabled (see your platform administrator for setup)
- A VW-capable runtime image available in your container registry
- API keys for the CLI tools you plan to use (e.g., Anthropic API key for Claude Code)

---

## Step 1: Create a Runtime

Runtimes are base container images. You typically need at least one VW-capable runtime with the harness and CLI tools pre-installed.

```bash
curl -X POST http://vwm-service/admin/runtimes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "python-3.11-vw",
    "description": "Python 3.11 with VW harness and CLI tools",
    "baseImage": "python:3.11-slim",
    "vwImage": "your-registry/python-3.11-vw:latest",
    "tags": ["python", "vw"]
  }'
```

**Response:**
```json
{
  "id": "rt-abc123...",
  "name": "python-3.11-vw",
  "baseImage": "python:3.11-slim",
  "vwImage": "your-registry/python-3.11-vw:latest",
  "tags": ["python", "vw"],
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

---

## Step 2: Create a Worker

Workers define how an agent should behave. Specify the CLI type, instructions, and optional repository and skills.

```bash
curl -X POST http://vwm-service/admin/workers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-reviewer",
    "description": "Security-focused code reviewer",
    "runtimeId": "rt-abc123...",
    "cliType": "claude-code",
    "agentMd": "You are a security-focused code reviewer.\nLook for OWASP Top 10 vulnerabilities.\nAlways explain your findings with severity ratings.",
    "workerRepoUrl": "https://github.com/org/code-reviewer-kb",
    "workerRepoBranch": "main",
    "autoLearn": true,
    "timeout": 3600
  }'
```

**Response:**
```json
{
  "id": "wk-def456...",
  "name": "code-reviewer",
  "cliType": "claude-code",
  "runtimeId": "rt-abc123...",
  "autoLearn": true,
  "timeout": 3600,
  "createdAt": "2025-01-15T10:05:00Z",
  "updatedAt": "2025-01-15T10:05:00Z"
}
```

### Optional: Assign Skills

```bash
# Upload a skill package
curl -X POST "http://vwm-service/admin/skills?name=security-scanner&version=1.0.0&description=SAST%20tool" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @security-scanner-1.0.0.skill

# Assign skill to worker
curl -X POST http://vwm-service/admin/workers/wk-def456.../skills/sk-ghi789...
```

---

## Step 3: Create a Session

Sessions are the primary unit of interaction. Creating a session provisions a K8s pod with the worker's configuration.

```bash
curl -X POST http://vwm-service/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workerId": "wk-def456...",
    "repository": {
      "url": "https://github.com/org/my-project",
      "branch": "feature/new-auth"
    },
    "breadcrumbs": ["ticket-123", "sprint-42"]
  }'
```

**Response:**
```json
{
  "id": "sess-jkl012...",
  "workerId": "wk-def456...",
  "status": "pending",
  "createdAt": "2025-01-15T10:10:00Z"
}
```

The session starts in `pending` status. VWM creates a K8s job, waits for the pod to start, and waits for the harness to signal readiness. Poll the session status to check when it's active:

```bash
curl http://vwm-service/sessions/sess-jkl012...
```

```json
{
  "id": "sess-jkl012...",
  "status": "active",
  "lastActivityAt": "2025-01-15T10:10:30Z"
}
```

---

## Step 4: Execute a Prompt

### Synchronous (Wait for Full Response)

```bash
curl -X POST http://vwm-service/sessions/sess-jkl012.../prompt \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Review the authentication module in src/auth/ for security vulnerabilities. Focus on session management and token validation.",
    "timeout": 120
  }'
```

**Response:**
```json
{
  "requestId": "req-mno345...",
  "response": "I've reviewed the authentication module and found 3 issues:\n\n1. **High Severity** - Session tokens are not invalidated...",
  "tokensIn": 1250,
  "tokensOut": 890,
  "durationMs": 15420
}
```

### Streaming (Real-Time Output via SSE)

```bash
curl -X POST http://vwm-service/sessions/sess-jkl012.../stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "prompt": "Review the authentication module in src/auth/ for security vulnerabilities."
  }'
```

**SSE Events:**
```
data: {"type":"text","data":"I've reviewed the authentication module..."}

data: {"type":"tool_call","data":{"name":"read_file","input":{"path":"src/auth/session.ts"}}}

data: {"type":"text","data":"Found 3 issues:\n\n1. **High Severity**..."}

data: {"type":"complete","data":{"tokensIn":1250,"tokensOut":890}}
```

### Abort an In-Flight Request

```bash
curl -X POST http://vwm-service/sessions/sess-jkl012.../abort \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Step 5: File Operations

Read, write, and manage files on the worker's filesystem.

### Read a File

```bash
curl http://vwm-service/sessions/sess-jkl012.../files/session_repo/src/auth/session.ts
```

### Write a File

```bash
curl -X PUT http://vwm-service/sessions/sess-jkl012.../files/session_repo/config.json \
  -H "Content-Type: application/json" \
  -d '{"debug": true, "logLevel": "verbose"}'
```

### Upload a Binary File

```bash
curl -X POST "http://vwm-service/sessions/sess-jkl012.../files/upload?path=session_repo/data/input.csv" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @input.csv
```

### Download a Binary File

```bash
curl -o output.pdf http://vwm-service/sessions/sess-jkl012.../files/download/session_repo/reports/analysis.pdf
```

### Delete a File

```bash
curl -X DELETE http://vwm-service/sessions/sess-jkl012.../files/session_repo/tmp/scratch.txt
```

---

## Step 6: View Telemetry

### Request History

```bash
curl http://vwm-service/sessions/sess-jkl012.../telemetry
```

```json
[
  {
    "id": "req-mno345...",
    "prompt": "Review the authentication module...",
    "response": "I've reviewed the authentication module...",
    "status": "complete",
    "tokensIn": 1250,
    "tokensOut": 890,
    "durationMs": 15420,
    "createdAt": "2025-01-15T10:11:00Z"
  }
]
```

### Aggregated Stats

```bash
curl http://vwm-service/sessions/sess-jkl012.../stats
```

```json
{
  "totalRequests": 5,
  "completedRequests": 4,
  "failedRequests": 1,
  "totalTokensIn": 6200,
  "totalTokensOut": 4100,
  "totalDurationMs": 72000,
  "avgDurationMs": 14400
}
```

---

## Step 7: End the Session

When finished, end the session to trigger cleanup. If `autoLearn` is enabled, VWM will run the learning skill before shutting down the pod.

```bash
curl -X DELETE http://vwm-service/sessions/sess-jkl012...
```

This:

1. Triggers auto-learning (if enabled) — agent extracts knowledge from the session
2. Commits and pushes git changes on session branches
3. Stores the session transcript
4. Terminates the K8s job
5. Marks the session as `ended`

---

## Using the Agent SDK

The Agent SDK provides first-class virtual worker support for building agent bundles. There are two usage patterns.

### Standalone (Non-Entity)

For scripts, tests, and simple integrations:

```typescript
import { VirtualWorker } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

// Create a factory pointed at your VWM service
const worker = new VirtualWorker({
  vwmBaseUrl: 'http://vwm-service',
  workerName: 'code-reviewer',
});

// Resolve worker metadata
await worker.resolveWorker();

// Start a session
const session = await worker.startSession({
  repository: { url: 'https://github.com/org/my-project', branch: 'main' },
});

// Execute a prompt
const result = await session.executePrompt({
  prompt: 'Review the codebase for security issues',
  timeout: 120,
});

console.log(result.response);

// End the session
await session.end();
```

### Entity Framework Integration

For production agent bundles with idempotency and crash recovery:

```typescript
import { VWSessionEntity, VWTurnEntity } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

class CodeReviewSession extends VWSessionEntity {
  get workerName() { return 'code-reviewer'; }

  async get_next_prompt(): Promise<VWTurnArgs | null> {
    const turn = this.getCurrentTurnIndex();

    if (turn === 0) {
      return { prompt: 'Review src/auth/ for OWASP Top 10 vulnerabilities' };
    }

    if (turn === 1) {
      return { prompt: 'Now review src/api/ for the same vulnerabilities' };
    }

    return null; // No more prompts — session ends
  }

  async on_turn_complete(turnEntity: VWTurnEntity): Promise<void> {
    // Process each turn result (e.g., create entities, update graph)
    const result = turnEntity.getResult();
    console.log(`Turn ${turnEntity.turnIndex}: ${result.response.substring(0, 100)}...`);
  }
}
```

### Working Memory Bridge

Transfer files between FireFoundry working memory and the virtual worker's filesystem:

```typescript
import {
  bridgeWorkingMemoriesToFiles,
  bridgeFilesToWorkingMemories,
} from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

// Upload working memory blobs to the worker's filesystem
await bridgeWorkingMemoriesToFiles(session, workingMemories, {
  basePath: 'session_repo/input/',
});

// After the worker processes files, download results back to working memory
const newMemories = await bridgeFilesToWorkingMemories(session, {
  paths: ['session_repo/output/report.md', 'session_repo/output/summary.json'],
});
```

For the complete SDK reference, see the [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md).

---

## Next Steps

- **[Concepts](./concepts.md)** — Understand workers, sessions, runtimes, skills, and the dual repo architecture in depth
- **[Reference](./reference.md)** — Full API reference with all endpoints, environment variables, and error codes
- **[Virtual Worker SDK](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)** — Complete SDK documentation for agent bundle integration

---

## Related

- [Overview](./README.md)
- [Platform Services](../README.md)
