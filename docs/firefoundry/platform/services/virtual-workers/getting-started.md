# Virtual Worker Manager — Getting Started

This guide walks you through defining a virtual worker, driving it from an agent bundle with the Agent SDK, and — if you need it — using the REST API directly.

## Prerequisites

- A FireFoundry environment with VWM enabled (`virtual-worker-manager.enabled: true`; see [Operations](./operations.md#enabling-vwm))
- A VW-capable runtime image available to the cluster, and CLI credentials for the engine you'll use (for example, a Claude Code token). Your environment administrator provisions both.
- Access to VWM's REST API. In-cluster the default address is `http://firefoundry-core-virtual-worker-manager:8080`. From your machine, port-forward it:

```bash
kubectl port-forward -n ff-test svc/firefoundry-core-virtual-worker-manager 8095:8080
export VWM=http://localhost:8095
```

---

## Step 1: Register a Runtime

A runtime names the container image a worker runs in. Skip this step if your environment already has one (`curl $VWM/admin/runtimes`).

```bash
curl -X POST $VWM/admin/runtimes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "python-3.11-vw",
    "description": "Python 3.11 with VW CLI tools",
    "baseImage": "python:3.11-slim",
    "vwImage": "your-registry/python-3.11-vw:latest",
    "tags": ["python", "vw"]
  }'
```

The response includes the runtime `id` you'll use next.

---

## Step 2: Define a Worker

A worker is the reusable definition: engine, instructions, knowledge base, and options.

```bash
curl -X POST $VWM/admin/workers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-reviewer",
    "description": "Security-focused code reviewer",
    "runtimeId": "<runtime-id>",
    "cliType": "claude-code",
    "agentMd": "You are a security-focused code reviewer.\nLook for OWASP Top 10 vulnerabilities.\nAlways explain your findings with severity ratings.",
    "mcpServers": [
      { "name": "ff-gateway", "url": "http://firefoundry-core-mcp-gateway.<namespace>.svc.cluster.local:8080/mcp" }
    ],
    "workerRepoUrl": "https://github.com/org/code-reviewer-kb",
    "workerRepoBranch": "main",
    "autoLearn": true,
    "timeout": 3600
  }'
```

`mcpServers` gives the worker FireFoundry platform tools through the [MCP Gateway](../mcp-gateway/README.md); omit it if the worker doesn't need them.

### Optional: add a skill

```bash
# Upload a skill package (zip, max 50MB)
curl -X POST "$VWM/admin/skills?name=security-scanner&version=1.0.0&description=SAST%20tool" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @security-scanner-1.0.0.skill

# Assign it to the worker
curl -X POST $VWM/admin/workers/<worker-id>/skills/<skill-id>
```

This installs a VWM skill package into the worker's workspace. Skills stored in the platform [Skills Service](../skills-service/README.md) reach the worker through the MCP Gateway's `skills_*` tools when `mcpServers` includes the gateway (see [Concepts — Skills](./concepts.md#skills)).

---

## Step 3: Use the Worker from Your Agent Bundle (SDK)

The Agent SDK is the recommended way to drive workers. Point it at VWM and refer to the worker by name.

### Standalone session

For scripts, tests, and simple endpoints:

```typescript
import { VirtualWorker } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';
import { VWMClient } from '@firebrandanalytics/vwm-client';

const client = new VWMClient({ baseUrl: 'http://firefoundry-core-virtual-worker-manager:8080' });
const vw = new VirtualWorker({ name: 'code-reviewer', client });

const session = await vw.startSession({
  createSessionOptions: {
    sessionRepository: { url: 'https://github.com/org/my-project.git', branch: 'main' },
  },
  breadcrumbs: ['code-review', 'ticket-123'],
});

try {
  const result = await session.executePrompt({
    prompt: 'Review src/auth/ for security vulnerabilities.',
  });
  console.log(result.promptResponse.response);
} finally {
  await session.end(); // triggers auto-learning and pushes branch changes
}
```

### Entity-driven session (production)

For bundles that need idempotency and crash recovery, extend `VWSessionEntity`. Each turn runs as a `VWTurnEntity`; after a restart, completed turns return their cached results.

```typescript
import VWSessionEntity from '@firebrandanalytics/ff-agent-sdk/virtual-worker/VWSessionEntity';
import type { VWPromptContext, VWNextPrompt } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

class CodeReviewSession extends VWSessionEntity {
  protected async get_next_prompt(ctx: VWPromptContext): Promise<VWNextPrompt> {
    if (ctx.turnIndex === 0) return { prompt: 'Review src/auth/ for OWASP Top 10 vulnerabilities' };
    if (ctx.turnIndex === 1) return { prompt: 'Now review src/api/ for the same vulnerabilities' };
    return null; // done — the session ends
  }
}
```

Streaming progress, file transfer, the working memory bridge, and lifecycle hooks are covered in the [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md).

---

## Step 4 (Alternative): Use the REST API Directly

Use this path from non-TypeScript clients or for manual testing.

### Create a session

```bash
curl -X POST $VWM/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workerId": "<worker-id>",
    "repository": { "url": "https://github.com/org/my-project", "branch": "feature/new-auth" },
    "breadcrumbs": ["ticket-123", "sprint-42"]
  }'
```

The session starts as `pending` while its workspace is provisioned. Poll until it is `active`:

```bash
curl $VWM/sessions/<session-id>
# {"id":"...","status":"active","lastActivityAt":"..."}
```

### Send a prompt

Synchronous:

```bash
curl -X POST $VWM/sessions/<session-id>/prompt \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "Review src/auth/ for security vulnerabilities.", "timeout": 120 }'
```

```json
{
  "requestId": "...",
  "response": "I've reviewed the authentication module and found 3 issues: ...",
  "tokensIn": 1250,
  "tokensOut": 890,
  "durationMs": 15420
}
```

Streaming (Server-Sent Events):

```bash
curl -N -X POST $VWM/sessions/<session-id>/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{ "prompt": "Review src/auth/ for security vulnerabilities." }'
```

```
data: {"type":"text","data":"I've reviewed the authentication module..."}
data: {"type":"tool_call","data":{"name":"read_file","input":{"path":"src/auth/session.ts"}}}
data: {"type":"complete","data":{"tokensIn":1250,"tokensOut":890}}
```

Abort an in-flight prompt:

```bash
curl -X POST $VWM/sessions/<session-id>/abort -H "Content-Type: application/json" -d '{}'
```

### Work with files

```bash
# Read / write text
curl $VWM/sessions/<session-id>/files/session_repo/src/auth/session.ts
curl -X PUT $VWM/sessions/<session-id>/files/session_repo/config.json \
  -H "Content-Type: application/json" -d '{"debug": true}'

# Upload / download binary
curl -X POST "$VWM/sessions/<session-id>/files/upload?path=session_repo/data/input.csv" \
  -H "Content-Type: application/octet-stream" --data-binary @input.csv
curl -o analysis.pdf $VWM/sessions/<session-id>/files/download/session_repo/reports/analysis.pdf

# Delete
curl -X DELETE $VWM/sessions/<session-id>/files/session_repo/tmp/scratch.txt
```

### Check usage

```bash
curl $VWM/sessions/<session-id>/telemetry   # per-request history
curl $VWM/sessions/<session-id>/stats       # totals: requests, tokens, duration
```

### End the session

```bash
curl -X DELETE $VWM/sessions/<session-id>
```

Ending a session runs auto-learning (if enabled), commits and pushes changes to the session branches, stores the transcript, releases the workspace, and marks the session `ended`.

---

## Next Steps

- **[Concepts](./concepts.md)** — Workers, sessions, knowledge bases, and app design patterns
- **[Reference](./reference.md)** — All endpoints and error codes
- **[Operations](./operations.md)** — Enabling, verifying, limits, troubleshooting
- **[Virtual Worker SDK](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)** — Complete SDK documentation

---

## Related

- [Overview](./README.md)
- [Platform Services](../README.md)
