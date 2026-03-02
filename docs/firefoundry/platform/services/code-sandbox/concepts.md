# Code Sandbox — Concepts

This page explains the core concepts underlying the Code Sandbox: the execution model, harness system, isolation strategy, and security model.

## Execution Model

The Code Sandbox uses a two-phase execution model:

1. **Compilation Phase**: TypeScript code is compiled using the TypeScript compiler API. The compiler validates syntax, resolves types, and produces executable JavaScript.
2. **Execution Phase**: Compiled code runs in one of two modes (see Isolation Strategy below). The harness establishes database connections and injects them into the execution context before code runs.

### Request Flow

```
Client Request → API Auth → Harness Selection → DB Connection Setup
    → TypeScript Compilation → Code Execution → Result Collection → Response
```

Each phase reports progress via streaming updates, allowing clients to monitor compilation and execution status in real-time.

## Harness System

A **harness** defines the execution environment and available capabilities for a code execution request. Harnesses manage:

- Which database connections are established
- What exported functions the code must provide
- What libraries and globals are available in the execution context

### Built-in Harnesses

| Harness | Purpose | Required Exports |
|---------|---------|------------------|
| `finance` | Analytical workloads with database access | `analyze(dbs)`, `sanityCheck()` |
| `sql` | SQL query execution | `run(dbs)` |

### How Harnesses Work

1. The client specifies a harness name and database requirements in the request
2. The harness establishes ODBC connections to the requested databases
3. Pre-authenticated database adapter objects are passed to the user's code
4. The user's code calls methods on the adapter (e.g., `dbs.analytics.executeQuery(...)`)
5. After execution, the harness cleans up database connections

### Database Injection

Harnesses create database connections and inject them as a `dbs` object:

```typescript
export const analyze = async (dbs: Record<string, DatabaseAdapter>) => {
  // dbs.analytics, dbs.datawarehouse, etc. are pre-authenticated
  const result = await dbs.analytics.executeQuery(
    'SELECT COUNT(*) as total FROM users'
  );
  return result.rows[0];
};
```

The code never sees connection strings, passwords, or credentials.

## Isolation Strategy

Code isolation happens at multiple levels:

### Process-Level Isolation

- The sandbox runs as an isolated Node.js process managed by PM2
- Kubernetes resource limits (CPU, memory) bound the process

### Execution Mode: Direct (Default)

- Code executes in the main process
- Lower overhead, faster startup
- Recommended for production with horizontal scaling
- Set `USE_WORKER_THREADS=false`

### Execution Mode: Worker Threads

- Code executes in Node.js worker threads
- Better isolation between concurrent requests
- Higher overhead per execution
- Set `USE_WORKER_THREADS=true` with `NUM_WORKERS=N`

### Network-Level Isolation (Planned)

- Egress whitelisting to control outbound connections
- Currently, network isolation relies on Kubernetes network policies

## Security Model

### Secrets Management

**Critical principle**: AI-generated code NEVER receives secrets directly.

The security model ensures credential isolation through:

1. **KeyVault Integration**: Database credentials stored in Azure KeyVault or environment variables
2. **Connection Abstraction**: The sandbox (not user code) establishes database connections
3. **Connection Injection**: Pre-authenticated database adapters passed to user code
4. **No Direct Access**: Code receives connection objects, not connection strings or passwords

### API Authentication

- All `/process` requests require a valid API key via `x-api-key` header
- In development mode, API key validation can be disabled by omitting the `API_KEY` variable

### Request Validation

- Zod schemas validate all request parameters
- Rate limiting via express-rate-limit prevents abuse
- Security headers applied via Helmet middleware
- Correlation IDs via AsyncLocalStorage for audit logging

### Idempotency

The Code Sandbox does **not** guarantee idempotent execution:
- Most use cases involve read-only database queries (naturally idempotent)
- Write operations may execute multiple times on retry
- Calling services must implement appropriate retry safeguards
- Design agent code for idempotent operations or use transaction patterns

## Supported Libraries

The TypeScript runtime includes these libraries in the execution context:

| Library | Purpose |
|---------|---------|
| `dataframe-js` | DataFrame operations for tabular data |
| `simple-statistics` | Statistical analysis functions |
| `chart.js` | Chart generation |
| `canvas` | Low-level graphics and image rendering |
| `odbc` | Database connectivity |

## Streaming Progress

The sandbox reports execution progress via chunked transfer encoding:

```json
{"type": "compilation_complete", "success": true, "data": {...}}
{"type": "execution_started"}
{"type": "execution_complete", "success": true, "result": {...}}
```

This allows clients to show real-time status during long-running compilations or executions.
