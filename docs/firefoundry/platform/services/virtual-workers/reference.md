# Virtual Worker Manager — Reference

Complete API reference for the Virtual Worker Manager service.

---

## Session API

### Create Session

Creates a new session for a worker. VWM provisions a K8s pod and bootstraps the workspace.

```
POST /sessions
```

**Request Body:**
```json
{
  "workerId": "uuid",
  "repository": {
    "url": "https://github.com/org/repo",
    "branch": "main"
  },
  "breadcrumbs": ["ticket-123", "sprint-42"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workerId` | UUID | Yes | Worker configuration to use |
| `repository` | object | No | Session repository to clone |
| `repository.url` | URL | Yes (if repository) | Git repository URL |
| `repository.branch` | string | No | Branch to check out (default: `main`) |
| `breadcrumbs` | string[] | No | Tracing context for telemetry correlation |

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "workerId": "uuid",
  "status": "pending",
  "createdAt": "2025-01-15T10:00:00Z"
}
```

---

### Get Session

```
GET /sessions/:id
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "workerId": "uuid",
  "status": "active",
  "createdAt": "2025-01-15T10:00:00Z",
  "lastActivityAt": "2025-01-15T10:30:00Z",
  "endedAt": null
}
```

---

### End Session

Ends a session and triggers cleanup (auto-learning, git commit/push, resource teardown).

```
DELETE /sessions/:id
```

**Response:** `204 No Content`

---

### Execute Prompt (Synchronous)

Sends a prompt and waits for the complete response.

```
POST /sessions/:id/prompt
```

**Request Body:**
```json
{
  "prompt": "Review this code for security issues",
  "subsessionId": "optional-subsession-id",
  "timeout": 120,
  "breadcrumbs": ["additional-context"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The prompt to execute |
| `subsessionId` | string | No | Sub-session for parallel execution |
| `timeout` | number | No | Request timeout in seconds |
| `breadcrumbs` | string[] | No | Additional breadcrumbs for this request |

**Response:** `200 OK`
```json
{
  "requestId": "uuid",
  "response": "Clean text response",
  "artifacts": ["src/auth/fix.ts"],
  "tokensIn": 1250,
  "tokensOut": 890,
  "durationMs": 15420,
  "raw": {
    "format": "json",
    "content": { ... },
    "metadata": {
      "model": "claude-sonnet-4.5",
      "requestId": "req_abc123",
      "cliType": "claude-code"
    }
  }
}
```

---

### Execute Prompt (Streaming)

Sends a prompt and streams the response via Server-Sent Events (SSE).

```
POST /sessions/:id/stream
```

**Request Body:** Same as synchronous prompt.

**Response:** `200 OK` with `Content-Type: text/event-stream`

**Event Types:**
```
data: {"type":"text","data":"Response text chunk..."}
data: {"type":"tool_call","data":{"name":"read_file","input":{"path":"src/file.ts"}}}
data: {"type":"error","data":{"message":"Error description"}}
data: {"type":"complete","data":{"tokensIn":1250,"tokensOut":890}}
```

---

### Abort Request

Aborts an in-flight prompt execution.

```
POST /sessions/:id/abort
```

**Request Body:**
```json
{
  "subsessionId": "optional-subsession-id"
}
```

**Response:** `200 OK`
```json
{
  "status": "aborted"
}
```

---

### File Operations

#### Read File (Text)

```
GET /sessions/:id/files/<filepath>
```

**Response:** `200 OK` with `Content-Type: text/plain`

#### Write File (Text)

```
PUT /sessions/:id/files/<filepath>
```

**Request Body:** File content (string or JSON).

**Response:** `204 No Content`

#### Delete File

```
DELETE /sessions/:id/files/<filepath>
```

**Response:** `204 No Content`

#### Upload File (Binary)

```
POST /sessions/:id/files/upload?path=<filepath>
```

**Request Body:** Binary data with `Content-Type: application/octet-stream`.

**Response:** `204 No Content`

#### Download File (Binary)

```
GET /sessions/:id/files/download/<filepath>
```

**Response:** `200 OK` with `Content-Type: application/octet-stream`

---

### Session Telemetry

#### Get Telemetry

Returns the full request history for a session.

```
GET /sessions/:id/telemetry
```

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "prompt": "Review this code...",
    "response": { "response": "...", "tokensIn": 1250, "tokensOut": 890, "raw": { ... } },
    "status": "complete",
    "durationMs": 15420,
    "artifacts": ["src/auth/fix.ts"],
    "createdAt": "2025-01-15T10:11:00Z",
    "completedAt": "2025-01-15T10:11:15Z"
  }
]
```

#### Get Stats

Returns aggregated statistics for a session.

```
GET /sessions/:id/stats
```

**Response:** `200 OK`
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

## Admin API

### Workers

#### List Workers

```
GET /admin/workers
```

**Response:** `200 OK` — Array of worker objects.

#### Get Worker

```
GET /admin/workers/:id
```

#### Get Worker by Name

```
GET /admin/workers/by-name/:name
```

#### Create Worker

```
POST /admin/workers
```

**Request Body:**
```json
{
  "name": "code-reviewer",
  "description": "Security-focused code reviewer",
  "runtimeId": "uuid",
  "cliType": "claude-code",
  "agentMd": "You are a security-focused code reviewer...",
  "modelConfig": {
    "provider": "anthropic",
    "model": "claude-sonnet-4.5",
    "temperature": 0.2,
    "maxTokens": 8192
  },
  "mcpServers": [
    { "name": "ff-gateway", "url": "http://mcp-gateway:8080" }
  ],
  "workerRepoUrl": "https://github.com/org/knowledge-base",
  "workerRepoBranch": "main",
  "autoLearn": true,
  "timeout": 3600
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique name (1-100 chars) |
| `description` | string | No | Purpose description |
| `runtimeId` | UUID | Yes | Runtime to use |
| `cliType` | enum | Yes | `claude-code`, `codex`, `gemini`, `opencode` |
| `agentMd` | string | No | Worker-specific instructions |
| `modelConfig` | object | No | LLM configuration |
| `modelConfig.provider` | string | No | Provider name |
| `modelConfig.model` | string | No | Model identifier |
| `modelConfig.temperature` | number | No | Sampling temperature |
| `modelConfig.maxTokens` | number | No | Max output tokens |
| `mcpServers` | array | No | MCP server connections |
| `workerRepoUrl` | URL | No | Knowledge base repo |
| `workerRepoBranch` | string | No | Base branch (default: `main`) |
| `autoLearn` | boolean | No | Enable auto-learning (default: `false`) |
| `timeout` | number | No | Max session duration in seconds (default: `3600`) |

**Response:** `201 Created`

#### Update Worker

```
PUT /admin/workers/:id
```

**Request Body:** Partial worker fields (same schema, all fields optional).

**Response:** `200 OK`

#### Delete Worker

```
DELETE /admin/workers/:id
```

**Response:** `204 No Content`

---

### Worker Skills

#### List Worker Skills

```
GET /admin/workers/:id/skills
```

**Response:** `200 OK` — Array of skill objects assigned to the worker.

#### Assign Skill to Worker

```
POST /admin/workers/:id/skills/:skillId
```

**Response:** `204 No Content`

#### Remove Skill from Worker

```
DELETE /admin/workers/:id/skills/:skillId
```

**Response:** `204 No Content`

---

### Worker Sessions

#### List Sessions by Worker

```
GET /admin/workers/:id/sessions
```

**Response:** `200 OK` — Array of session summary objects.

---

### Runtimes

#### List Runtimes

```
GET /admin/runtimes
```

#### Get Runtime

```
GET /admin/runtimes/:id
```

#### Get Runtime by Name

```
GET /admin/runtimes/by-name/:name
```

#### Create Runtime

```
POST /admin/runtimes
```

**Request Body:**
```json
{
  "name": "python-3.11-vw",
  "description": "Python 3.11 with VW harness",
  "baseImage": "python:3.11-slim",
  "vwImage": "registry/python-3.11-vw:latest",
  "tags": ["python", "vw"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique name (1-100 chars) |
| `description` | string | No | Runtime description |
| `baseImage` | string | Yes | Base Docker image |
| `vwImage` | string | No | VW-enabled image (with harness + CLIs) |
| `tags` | string[] | No | Capability tags (default: `[]`) |

**Response:** `201 Created`

#### Update Runtime

```
PUT /admin/runtimes/:id
```

**Response:** `200 OK`

#### Delete Runtime

```
DELETE /admin/runtimes/:id
```

**Response:** `204 No Content`

---

### Skills

#### List Skills

```
GET /admin/skills
```

#### Get Skill by ID

```
GET /admin/skills/:id
```

#### Get Skill by Name and Version

```
GET /admin/skills/by-name/:name/version/:version
```

#### Upload Skill

Upload a `.skill` (zip) package with metadata as query parameters.

```
POST /admin/skills?name=<name>&version=<version>&description=<desc>&targetPath=<path>&isSystem=<bool>&defaultInclude=<bool>
Content-Type: application/octet-stream
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Skill name (1-100 chars) |
| `version` | string | Yes | Semver version |
| `description` | string | No | Skill description |
| `targetPath` | string | No | Extraction path (default: `.`) |
| `isSystem` | boolean | No | System-level skill (default: `false`) |
| `defaultInclude` | boolean | No | Auto-include for all workers (default: `false`) |

**Request Body:** Raw binary `.skill` file (max 50MB).

**Response:** `201 Created`

#### Update Skill Metadata

```
PUT /admin/skills/:id
```

**Request Body:** Partial skill fields (JSON).

**Response:** `200 OK`

#### Delete Skill

```
DELETE /admin/skills/:id
```

**Response:** `204 No Content`

---

## Health Endpoints

| Endpoint | Purpose | Success |
|----------|---------|---------|
| `GET /health` | Liveness probe | Always `200 OK` |
| `GET /ready` | Readiness probe (checks DB, K8s) | `200 OK` or `503 Service Unavailable` |
| `GET /status` | Service metadata | `200 OK` with service name, version, uptime, environment |
| `GET /` | Root | `200 OK` with service name and version |

---

## Environment Variables

### VWM Service (`ff-services-vwm`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Environment: `development`, `production`, `test` |
| `PORT` | No | HTTP port (default: `3000`) |
| `SERVICE_NAME` | No | Service identifier (default: `ff-services-vwm`) |
| `LOG_LEVEL` | No | Logging level: `debug`, `info`, `warn`, `error` |
| `PG_SERVER` | Yes | PostgreSQL host |
| `PG_DATABASE` | Yes | Database name |
| `PG_PORT` | No | PostgreSQL port (default: `5432`) |
| `PG_PASSWORD` | Yes | Read user password |
| `PG_INSERT_PASSWORD` | Yes | Write user password |
| `K8S_NAMESPACE` | Yes | Kubernetes namespace for jobs |
| `HARNESS_IMAGE` | Yes | Default harness container image |
| `BLOB_STORAGE_ACCOUNT` | Yes | Blob storage account (for skills) |
| `BLOB_STORAGE_KEY` | Yes | Blob storage access key |
| `BLOB_STORAGE_CONTAINER` | Yes | Blob storage container name |
| `MCP_GATEWAY_URL` | No | MCP gateway URL for worker access to FF services |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | Azure Application Insights |

### Harness (`ff-vw-harness`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Harness HTTP port (default: `8080`) |
| `WORKSPACE_DIR` | No | Workspace root (default: `/workspace`) |
| `CLI_TYPE` | Yes | CLI tool to use: `claude-code`, `codex`, `gemini`, `opencode` |
| `WORKER_REPO_URL` | No | Worker knowledge base repository URL |
| `WORKER_REPO_BRANCH` | No | Base branch for worker repo |
| `SESSION_REPO_URL` | No | Session repository URL |
| `SESSION_REPO_BRANCH` | No | Branch for session repo |
| `SESSION_ID` | Yes | Session identifier |
| `WORKER_ID` | Yes | Worker identifier |
| `AGENT_MD` | No | Agent instructions content |
| `MCP_GATEWAY_URL` | No | MCP gateway URL |
| `ANTHROPIC_API_KEY` | Conditional | Required for `claude-code` CLI type |
| `OPENAI_API_KEY` | Conditional | Required for `codex` CLI type |
| `GOOGLE_API_KEY` | Conditional | Required for `gemini` CLI type |

---

## Kubernetes Requirements

### Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ff-vwm-secrets
type: Opaque
data:
  PG_PASSWORD: <base64>
  PG_INSERT_PASSWORD: <base64>
  BLOB_STORAGE_KEY: <base64>
---
apiVersion: v1
kind: Secret
metadata:
  name: ff-vwm-cli-secrets
type: Opaque
data:
  ANTHROPIC_API_KEY: <base64>
  OPENAI_API_KEY: <base64>
  GOOGLE_API_KEY: <base64>
```

### RBAC

VWM needs permissions to create and manage K8s Jobs and Pods in its namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: vwm-job-manager
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["create", "get", "list", "delete"]
```

### Persistent Volume Claims

Each session gets a PVC for workspace persistence:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: vwm-session-{session-id}
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 10Gi
```

---

## Error Responses

### Validation Errors

```json
{
  "error": "Validation Error",
  "details": [
    {
      "path": "cliType",
      "message": "Invalid enum value. Expected 'claude-code' | 'codex' | 'gemini' | 'opencode'",
      "code": "invalid_enum_value"
    }
  ]
}
```

### Not Found

```json
{
  "error": "Session not found"
}
```

### Conflict

```json
{
  "error": "Session is not active"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No Content (success with no body) |
| `400` | Validation error (check `details` array) |
| `404` | Resource not found |
| `409` | Conflict (e.g., session not in expected state) |
| `500` | Internal server error |
| `503` | Service unavailable (readiness check failed) |

---

## Supported CLI Types

| CLI Type | Value | Provider | Key Features |
|----------|-------|----------|--------------|
| Claude Code | `claude-code` | Anthropic | Session resume, tool use, streaming JSON output |
| Codex CLI | `codex` | OpenAI | Code-focused execution |
| Gemini CLI | `gemini` | Google | Multi-modal capabilities |
| OpenCode | `opencode` | Various | Native server mode |

---

## Related

- [Overview](./README.md)
- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
