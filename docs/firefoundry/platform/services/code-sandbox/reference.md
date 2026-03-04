# Code Sandbox — Reference

Complete API reference for the Code Sandbox, including endpoints, request/response schemas, supported databases, and configuration variables.

## Endpoints

### POST /process

Compile and execute code in a sandbox environment.

**Authentication**: Requires `x-api-key` header.

**Request Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes* | TypeScript source code |
| `codeWorkingMemoryId` | UUID | Yes* | Working memory reference (alternative to `code`) |
| `runScript` | string | No | Separate runner script |
| `language` | string | Yes | `typescript` (only supported value currently) |
| `harness` | string | Yes | Execution harness: `finance`, `sql` |
| `databases` | Database[] | No | Database requirements |
| `useWorkerThreads` | boolean | No | Override execution mode (default: server setting) |

*One of `code` or `codeWorkingMemoryId` is required.

**Database Object**:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Database identifier (matches env var prefix) |
| `type` | string | Database type: `postgres`, `databricks`, `sqlserver`, `mysql`, `oracle`, `snowflake` |

**Response (Non-streaming)** (200):

```json
{
  "success": true,
  "stdout": "console output from code",
  "stderr": "",
  "returnData": { "analysis": "results" },
  "errors": []
}
```

**Response (Streaming)** — chunked JSON lines:

```json
{"type": "compilation_complete", "success": true, "data": {}}
{"type": "execution_started"}
{"type": "execution_complete", "success": true, "result": {"returnData": {}}}
```

**Error Response** (4xx/5xx):

```json
{
  "success": false,
  "errors": ["Compilation failed: SyntaxError at line 5"],
  "stdout": "",
  "stderr": "error details"
}
```

### GET /health

Health check endpoint (no authentication required).

**Response**: `"OK"` (200 status)

## Supported Database Types

| Type | Driver | Connection String Pattern |
|------|--------|--------------------------|
| `postgres` | ODBC (PostgreSQL driver) | `ANALYTICS_CONNECTION_STRING=postgresql://...` |
| `databricks` | ODBC (Databricks driver) | See Databricks configuration below |
| `sqlserver` | ODBC (SQL Server driver) | Standard SQL Server ODBC connection string |
| `mysql` | ODBC (MySQL driver) | Standard MySQL ODBC connection string |
| `oracle` | ODBC (Oracle driver) | Standard Oracle ODBC connection string |
| `snowflake` | ODBC (Snowflake driver) | Standard Snowflake ODBC connection string |

### Databricks Configuration

| Variable | Purpose |
|----------|---------|
| `DATABRICKS_HOST` | Databricks instance hostname |
| `DATABRICKS_HTTP_PATH` | SQL warehouse HTTP path |
| `DATABRICKS_CLIENT_ID` | Azure AD app client ID |
| `DATABRICKS_CLIENT_SECRET` | Azure AD app secret (from KeyVault) |
| `DATABRICKS_TENANT_ID` | Azure tenant ID |
| `DATABRICKS_CATALOG` | Default catalog |
| `DATABRICKS_PORT` | Port (typically 443) |
| `DATABRICKS_DRIVER` | ODBC driver name |

## Harness Required Exports

### Finance Harness

```typescript
// Required export
export const analyze = async (
  dbs: Record<string, DatabaseAdapter>
): Promise<any> => {
  // Your analysis code
};

// Optional sanity check
export const sanityCheck = (): boolean => {
  return true;
};
```

### SQL Harness

```typescript
export const run = async (
  dbs: Record<string, DatabaseAdapter>
): Promise<any> => {
  // Your SQL execution code
};
```

## Database Adapter Interface

The injected database adapter provides:

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

## Configuration Variables

### Server

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |
| `API_KEY` | | Authentication key (omit to disable auth in dev) |

### Execution

| Variable | Default | Purpose |
|----------|---------|---------|
| `USE_WORKER_THREADS` | `false` | Use worker thread isolation |
| `NUM_WORKERS` | `1` | Worker thread count |

### Database Connections

Database connection strings follow the naming pattern `{NAME}_CONNECTION_STRING`:

```bash
ANALYTICS_CONNECTION_STRING=postgresql://...
DATAWAREHOUSE_CONNECTION_STRING=...
```

The `{NAME}` must match the `name` field in the request's `databases` array.

### Logging and Monitoring

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONSOLE_LOG_LEVEL` | `debug` | Log verbosity |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | | Azure Application Insights |
| `CONTEXT_SERVICE_ADDRESS` | | Context Service URL (for working memory) |
| `CONTEXT_SERVICE_API_KEY` | | Context Service API key |
