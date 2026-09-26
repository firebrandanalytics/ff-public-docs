# Code Sandbox — Reference

The HTTP API, the in-sandbox `das` API that executed code uses, and the Agent SDK settings. For how these fit together, see [Concepts](./concepts.md).

## Connecting

- **Base URL (in-cluster)**: `http://firefoundry-core-code-sandbox-v2:8080` for the default `firefoundry-core` release name. The service is not exposed outside the cluster by default.
- **Protocol**: HTTP/JSON, with optional Server-Sent Events for execution.
- **Authentication**: in-cluster calls don't need an API key.
- **App ID**: send your app's ID as `appId` in the request body or in the `X-App-Id` header. It scopes per-app rate limits and lets you filter execution history by app.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness: `{"status":"healthy"}` |
| `GET` | `/ready` | Readiness: `{"ready":true,"database":true,"kubernetes":true}`, or `503` with `ready: false` |
| `POST` | `/v2/execute` | Run code with a profile |
| `POST` | `/execute` | Same as `/v2/execute` when the body includes `profile` (this is what the SDK calls). Without `profile`, see [Profile-less execution](#profile-less-execution) |
| `GET` | `/profiles/{name}/metadata` | What a profile provides to a bot |
| `GET` | `/admin/profiles` | List profiles |
| `GET` | `/admin/profiles/{name}` | Get one profile |
| `POST` | `/admin/profiles` | Create a profile |
| `PUT` | `/admin/profiles/{name}` | Update a profile (partial) |
| `DELETE` | `/admin/profiles/{name}` | Delete a profile |
| `GET` | `/admin/runtimes` | List runtimes, to find a `runtimeId` for a profile |
| `GET` | `/admin/executions` | Execution history |
| `GET` | `/admin/executions/{id}` | One execution history record |

## POST /v2/execute

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | string (1–100) | Yes | Profile name |
| `source` | object | Yes | `{ "type": "inline", "code": "<source>" }` (code up to 1 MB) or `{ "type": "context-service", "id": "<working-memory UUID>" }` |
| `timeout` | integer (ms) | No | Overrides the profile's timeout. Maximum `300000` (5 minutes). Default: profile timeout, else `120000` |
| `stream` | boolean | No | `true` for Server-Sent Events. Default `false` |
| `appId` | string (≤255) | No | Your app ID (or use the `X-App-Id` header) |

Every profile-based run executes in its own isolated container.

### Response (`stream: false`)

```json
{
  "executionId": "b7d4…",
  "compilation": {
    "success": true,
    "errors": [{ "type": "compiler", "message": "…", "line": 3, "column": 10 }]
  },
  "execution": {
    "success": true,
    "result": { "description": "…", "result": [1, 2, 3] },
    "stdout": "…",
    "stderr": "",
    "durationMs": 12,
    "errors": [{ "type": "runtime", "message": "…", "line": 7, "stack": "…" }]
  },
  "totalDurationMs": 4210
}
```

| Field | Description |
|-------|-------------|
| `compilation.success` | `false` if TypeScript failed to compile (or Python failed its syntax check). `errors` lists the problems |
| `execution.success` | `false` if the code threw, didn't define the entry point, or exceeded its timeout. `errors` has the message and stack |
| `execution.result` | The entry point's return value |
| `execution.stdout`, `stderr` | Captured console output |
| `totalDurationMs` | Wall-clock time including container start-up |

A failed compile or failed run still returns HTTP `200`. A run that exceeds its timeout usually comes back as a failed execution whose error says it timed out.

### Response (`stream: true`)

`Content-Type: text/event-stream`. Each event is `event: <type>` followed by `data: <JSON>`.

| Event | `data` |
|-------|--------|
| `started` | `{ "executionId": "…" }` (may be sent more than once) |
| `compilation_started` | `{}` or `{ "language": "…" }` |
| `compilation_complete` | `{ "success": boolean, "errors": [...] }` |
| `execution_started` | `{}` |
| `output` | `{ "stream": "stdout" \| "stderr", "text": "…" }`, sent after the code finishes |
| `execution_complete` | `{ "success": true, "result": … }` or `{ "success": false, "error": "…" }` |
| `done` | `{ "totalDurationMs": number }`. The last `done` ends the stream |
| `error` | `{ "message": "…" }`: compile failure, runtime failure, or a sandbox error |

Closing the connection cancels the run.

## Errors

| HTTP | Body | Meaning | What to do |
|------|------|---------|------------|
| `400` | `{ "error": "Invalid request", "details": … }` | Request failed validation (missing `source`, code over 1 MB, timeout over 5 minutes, …) | Fix the request |
| `404` | `{ "error": "Profile not found: <name>" }` | Profile (or its runtime) doesn't exist in this environment | Check the name; see [Operations](./operations.md#setting-up-profiles) |
| `429` | `{ "error": "Too many requests", "message": …, "retryAfterMs": … }` | Global or per-app rate limit, or too many runs in progress | Back off and retry (after `retryAfterMs`, when present) |
| `503` | `{ "error": "Service unavailable", "message": … }` | Sandbox is restarting or has no capacity | Retry with backoff |
| `504` | `{ "error": "Gateway timeout", "message": … }` | No result arrived within the timeout | Simplify the code, reduce data volume, or raise `timeout` |
| `500` | `{ "error": "Internal server error" }` | Unexpected failure | Retry once; if it persists, contact your administrator |

In streaming mode, failures after the stream starts arrive as an `error` event rather than an HTTP status.

## GET /profiles/{name}/metadata

Used by `GeneralCoderBot` at startup. Returns `404` if the profile doesn't exist.

```json
{
  "language": "python",
  "harness": "datascience",
  "runScriptPrompt": null,
  "dasConnections": ["firekicks"]
}
```

## Profiles

### Profile Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (1–100) | Unique across the environment. Prefix with your app name |
| `description` | string | Free text |
| `runtimeId` | UUID | Required. The runtime (language and harness) to use. Find it with `GET /admin/runtimes` |
| `runScript` | string or null | Custom entry-point script. `null` uses the harness default (see [Concepts](./concepts.md#entry-points)) |
| `runScriptPrompt` | string or null | Human-readable description of the entry-point contract, returned in metadata |
| `clientConfig.das.enabled` | boolean | Inject DAS clients. Default `false` |
| `clientConfig.das.connections` | string[] | DAS connection names to inject as `das.<name>` |
| `clientConfig.das.onBehalfOf` | string | Identity DAS sees for the code's queries, e.g. `app:orders-app`. Default `app:sandbox` |
| `resourceLimits.timeout` | integer (ms) | Default timeout for runs with this profile |
| `resourceLimits.cpu`, `resourceLimits.memory` | string | Kubernetes quantities for the run's container, e.g. `"1"`, `"2Gi"` |
| `appId` | string | Owning app, for your own bookkeeping |
| `createdBy` | string | Free text |

Accepted and stored but **not yet applied**: `clientConfig.das.allowedOperations`, `clientConfig.das.hooks`, `clientConfig.webSearch`, `clientConfig.docProc`, and `accessControl` (`onBehalfOf`, `allowedCallers`). Don't rely on them to restrict what code can do. Restrict the DAS connection itself instead.

### Create a Profile

```bash
curl -X POST http://localhost:8080/admin/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "orders-app-analytics",
    "description": "Python analytics over the orders warehouse",
    "runtimeId": "<python runtime id>",
    "clientConfig": {
      "das": { "enabled": true, "connections": ["orders"], "onBehalfOf": "app:orders-app" }
    },
    "resourceLimits": { "timeout": 60000, "memory": "2Gi" },
    "appId": "orders-app"
  }'
```

Returns `201` with the profile (including its `id`). Returns `404` if `runtimeId` doesn't exist and `400` on validation errors. `PUT /admin/profiles/{name}` takes any subset of the same fields. `DELETE` returns `204`.

## Execution History

`GET /admin/executions?app_id=<appId>&limit=100&offset=0` returns recent runs, newest first. `GET /admin/executions/{id}` returns one record.

| Field | Description |
|-------|-------------|
| `id` | History record ID |
| `status` | `pending`, `compiling`, `running`, `completed`, or `failed` |
| `success`, `errorMessage` | Outcome |
| `language`, `harness`, `mode`, `sourceType` | What ran and how |
| `appId` | App ID sent with the request |
| `startedAt`, `completedAt`, `durationMs`, `createdAt` | Timing |

History is kept for a limited period (30 days by default). The `executionId` in an execute response is not the history record's `id`, so look runs up by app ID and time.

## Profile-less Execution

`POST /execute` without a `profile` field runs code by naming the language and harness directly:

| Field | Description |
|-------|-------------|
| `source` | As above |
| `language` | `typescript` or `python` |
| `harness` | `finance` or `datascience` |
| `timeout`, `stream`, `appId` | As above |
| `runScript` | Optional custom entry-point script |
| `databases` | Optional `[{ name, type: "postgres" \| "databricks", connectionString \| host/port/database/user/password }]`, exposed to TypeScript code as `dbs.<name>` |

A runtime for that language and harness must exist. This form puts database credentials in your request, so it gives up the credential isolation profiles provide. Prefer profiles with DAS connections. (`POST /execute/fast` is an experimental variant of this form that reuses pre-started containers; the SDK doesn't use it.)

## In-Sandbox DAS API

Available to executed code when the profile enables DAS. One client per configured connection.

### TypeScript: `das.<name>`

| Method | Returns |
|--------|---------|
| `query(sql, params?, options?)` | `{ columns, rows: [{ fields: {…} }], rowCount, durationMs, queryId, truncated }` |
| `queryRows(sql, params?, options?)` | Rows as plain objects |
| `getSchema(table?)` | `{ connection, tables: [{ name, schema, type, columns: [{ name, type, normalizedType, nullable, primaryKey, description }], … }] }` |
| `name` | Connection name |

`options`: `{ timeout_ms?: number, max_rows?: number }`. Queries time out after 30 seconds by default and schema lookups after 10 seconds. `truncated: true` means DAS applied a row limit.

### Python: `das['<name>']`

| Method | Returns |
|--------|---------|
| `query(sql, params=None, options=None)` | The full DAS result as a dict (as above) |
| `query_rows(sql, params=None, options=None)` | `list[dict]` |
| `query_df(sql, params=None, options=None)` | `pandas.DataFrame` (empty if no rows) |
| `get_schema(table=None)` | Schema dict |

A failed query raises an error whose message includes the DAS status and response, for example `DAS query failed (403): …`. Uncaught, it becomes the run's `execution.errors` entry.

### Runtime Environment

| Language | Runtime | Entry point | Libraries |
|----------|---------|-------------|-----------|
| TypeScript | Node.js 20, compiled to ES2022 | Export `run`, `main`, or default function (harness `finance`) | No analysis libraries in the default runtime. `fetch`, `URL`, `Buffer`, and standard globals are available |
| Python | Python 3.12 | `def run()` (harness `datascience`); `run`, `main`, or `default` (harness `finance`) | pandas, NumPy, SciPy. Import them in the code |

Other runtimes and packages depend on what your administrator has registered. `GET /admin/runtimes` lists them.

## Agent SDK

### GeneralCoderBot

From `@firebrandanalytics/ff-agent-sdk`.

| Constructor option | Description |
|--------------------|-------------|
| `name` | Bot name, used in logs and telemetry |
| `modelPoolName` | LLM model pool |
| `profile` | Code Sandbox profile name (required) |
| `domainPrompt` | Optional prompt node(s) or string describing your data, schema, and rules |
| `maxTries` | LLM attempts, including error-driven retries (default 8) |
| `maxSandboxRetries` | Re-runs after transient sandbox errors (default 3) |
| `errorPromptProviders` | Optional custom prompts for compile, runtime, and SQL errors |

The bot returns `GeneralCoderOutput`: `{ description, result, stdout?, metadata? }`. `init()` fetches profile metadata and fails if the profile doesn't exist or the sandbox is unreachable.

### Bundle Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CODE_SANDBOX_URL` | Yes | Sandbox address, e.g. `http://firefoundry-core-code-sandbox-v2:8080`. The SDK's fallback address does not match a standard deployment |
| `CODE_SANDBOX_API_KEY` | No | Sent as `X-API-Key` if set. Not needed for in-cluster calls |

Profile names are best passed as your own variables (the tutorial uses `CODE_SANDBOX_TS_PROFILE` and `CODE_SANDBOX_DS_PROFILE`).
