# Code Sandbox — Reference

The Code Sandbox API contract: endpoints, request and response shapes, harness exports, the database adapter, and errors.

## Endpoints

### POST /process

Compile and run code.

**Authentication**: send the sandbox API key in the `x-api-key` header when your environment configures one.

**Request body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes* | TypeScript source code |
| `codeWorkingMemoryId` | UUID | Yes* | Working memory document containing the code (alternative to `code`) |
| `runScript` | string | No | Separate driver script that calls the harness entry point |
| `language` | string | Yes | `typescript` |
| `harness` | string | Yes | `finance` or `sql` |
| `databases` | Database[] | No | Databases to open and inject as `dbs` |
| `useWorkerThreads` | boolean | No | Run in an isolated worker thread for this request. Defaults to the environment setting. |

\*Provide exactly one of `code` or `codeWorkingMemoryId`.

**Database object**:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Database name configured for your environment. Becomes the property name on `dbs`. |
| `type` | string | `postgres`, `databricks`, `sqlserver`, `mysql`, `oracle`, or `snowflake` |

**Response** (200):

```json
{
  "success": true,
  "stdout": "console output from code",
  "stderr": "",
  "returnData": { "analysis": "results" },
  "errors": []
}
```

| Field | Description |
|-------|-------------|
| `success` | `true` if the code compiled and ran without throwing |
| `returnData` | The value returned by the harness entry point |
| `stdout` / `stderr` | Console output from the code |
| `errors` | Compilation or runtime error messages |

**Streaming response**: when the request asks for streaming (`Accept: text/event-stream`, or `runCodeWithProgress` in the client), the response is a sequence of JSON events:

```json
{"type": "compilation_complete", "success": true, "data": {}}
{"type": "execution_started"}
{"type": "execution_complete", "success": true, "result": {"returnData": {}}}
```

**Error response** (4xx/5xx):

```json
{
  "success": false,
  "errors": ["Compilation failed: SyntaxError at line 5"],
  "stdout": "",
  "stderr": "error details"
}
```

Requests that fail validation (for example, no `code` or an unknown harness), lack a valid API key, or exceed the sandbox's rate limit are rejected with a 4xx status. Compilation, execution, and database connection failures return `success: false` with details in `errors` and `stderr`. Treat rate-limit rejections as retryable with backoff.

### GET /health

Reachability check. No authentication. Returns `"OK"` with status 200.

## Harness Exports

### `finance`

```typescript
// Required
export const analyze = async (
  dbs: Record<string, DatabaseAdapter>
): Promise<any> => {
  // Your analysis code; the return value becomes returnData
};

// Optional
export const sanityCheck = (): boolean => {
  return true;
};
```

### `sql`

```typescript
export const run = async (
  dbs: Record<string, DatabaseAdapter>
): Promise<any> => {
  // Your SQL execution code; the return value becomes returnData
};
```

## Database Adapter

Each entry on `dbs` provides:

```typescript
interface DatabaseAdapter {
  executeQuery(sql: string, params?: any[]): Promise<QueryResult>;
}

interface QueryResult {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
}
```

Use `params` for values that come from users or other untrusted input rather than concatenating them into the SQL string.

## Supported Database Types

| `type` | Database |
|--------|----------|
| `postgres` | PostgreSQL |
| `databricks` | Databricks SQL warehouse |
| `sqlserver` | Microsoft SQL Server |
| `mysql` | MySQL |
| `oracle` | Oracle |
| `snowflake` | Snowflake |

How a database name is configured for an environment is covered in [Operations](./operations.md#making-databases-available).

## Client Library

`@firebrandanalytics/code-sandbox-client`:

| Method | Description |
|--------|-------------|
| `CodeSandboxClient.create({ baseUrl, apiKey? })` | Create a client |
| `runCode(request)` | Run code and return the final result (same fields as the `/process` response) |
| `runCodeWithProgress(request)` | Run code and yield streamed progress events |

The request object has the same fields as the `/process` body.

## MCP Tool

Through the MCP Gateway, the sandbox is available as `sandbox_execute_code`. See [MCP Gateway tools](../mcp-gateway/tools.md#code-sandbox-adapter).
