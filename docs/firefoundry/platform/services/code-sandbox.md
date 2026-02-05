# Code Sandbox Service

## Overview
The Code Sandbox is a secure code execution environment that enables AI agents to run TypeScript (and planned Python) code with access to databases, visualization tools, and data processing libraries. It provides isolated execution with comprehensive security controls and resource management.

## Purpose and Role in Platform
The Code Sandbox serves as the execution runtime for FireFoundry agent bundles, allowing AI-generated code to:
- Query databases securely via ODBC connections (PostgreSQL, Databricks, SQL Server, MySQL, Oracle, Snowflake)
- Process and analyze data using DataFrame operations
- Generate visualizations with Chart.js and Canvas
- Execute analytical workflows in controlled environments

Agent bundles invoke the Code Sandbox via REST API to compile and run code, receiving structured execution results including output, errors, and return data.

## Key Features
- **Secure Code Execution**: Isolated execution environments with VM-based sandboxing or worker thread isolation
- **Database Connectivity**: ODBC-based access to multiple database types with connection pooling
- **Data Visualization**: Built-in Canvas and Chart.js support for generating charts and graphics
- **DataFrame Processing**: Data analysis capabilities via dataframe-js and simple-statistics
- **Dual Execution Modes**: Choose between worker thread isolation (more secure) or direct execution (lower latency)
- **Streaming Progress Updates**: Chunked transfer encoding for real-time compilation and execution status
- **API Key Authentication**: Secure access control via x-api-key header validation
- **Customizable Harnesses**: Predefined execution contexts (finance, sql) with extensible architecture

## Architecture Overview

### Execution Model
The Code Sandbox uses a **harness-based execution model** where code runs in predefined contexts:

1. **Compilation Phase**: TypeScript code is compiled using the TypeScript compiler API
2. **Execution Phase**: Compiled code runs in one of two modes:
   - **Worker Threads Mode**: Code executes in Node.js worker threads (better isolation)
   - **Direct Mode**: Code executes in the main process (lower overhead, default)
3. **Database Injection**: Harnesses establish database connections and inject them into the execution context
4. **Result Collection**: Output, errors, and return values are captured and returned

### Harness System
Harnesses define the execution environment and available capabilities:
- **Finance Harness**: Provides database access for analytical workloads
- **SQL Harness**: Specialized for SQL query execution
- Harnesses manage their own database connection lifecycle
- Each harness defines required exports (e.g., `analyze`, `sanityCheck`)

### Isolation Strategy
Code isolation happens at multiple levels:
- **Process Level**: Runs in isolated Node.js process managed by PM2
- **VM Level**: Optional worker thread isolation for concurrent requests
- **Network Level**: Planned egress whitelisting to control outbound connections
- **Resource Level**: Kubernetes resource limits (CPU, memory, execution time)

## Supported Runtimes

### TypeScript (Current)
- **Runtime**: Node.js 23.x
- **Compilation**: TypeScript 5.7.2 with experimental VM modules
- **Execution**: ES modules with dynamic import support
- **Available Libraries**:
  - `dataframe-js` - DataFrame operations
  - `simple-statistics` - Statistical analysis
  - `chart.js` - Chart generation
  - `canvas` - Low-level graphics rendering
  - `odbc` - Database connectivity

### Python (Planned)
Python support is defined in type system but not yet implemented. Will support similar capabilities when added.

## Security Model

### Secrets Management
**Critical Security Principle**: AI-generated code NEVER receives secrets directly.

- **KeyVault Integration**: Database credentials stored in Azure KeyVault or environment variables
- **Connection Abstraction**: Sandbox establishes database connections before code execution
- **Connection Injection**: Pre-authenticated database adapters passed to user code
- **No Direct Access**: Code receives database connection objects, not connection strings or passwords

### Execution Security
- **API Authentication**: All `/process` requests require valid API key via `x-api-key` header
- **Rate Limiting**: Express-rate-limit middleware prevents abuse
- **Security Headers**: Helmet middleware applies security best practices
- **Input Validation**: Zod schemas validate all request parameters
- **Correlation IDs**: Request tracing via AsyncLocalStorage for audit logging

### Resource Controls
- **Execution Timeout**: Configurable timeout prevents runaway code
- **Memory Limits**: Enforced by Kubernetes container limits
- **CPU Limits**: Enforced by Kubernetes container limits
- **Planned Controls**: Egress whitelisting for outbound network access

### Idempotency Considerations
The Code Sandbox **does NOT guarantee idempotent execution**:
- Most use cases involve read-only database queries (naturally idempotent)
- Write operations may execute multiple times on retry
- **Consumer Responsibility**: Calling services must implement retry logic with appropriate safeguards
- **Best Practice**: Design agent code for idempotent operations or use transaction patterns

## API and Interfaces

### REST Endpoints

#### POST /process
Compile and execute code in a sandbox environment.

**Authentication**: Requires `x-api-key` header

**Request Body**:
```json
{
  "code": "export const analyze = (dbs) => { /* code */ }",
  "runScript": "export const run = async () => { /* runner */ }",
  "language": "typescript",
  "harness": "finance",
  "databases": [
    { "name": "analytics", "type": "postgres" },
    { "name": "datawarehouse", "type": "databricks" }
  ],
  "useWorkerThreads": false
}
```

**Alternative**: Use `codeWorkingMemoryId` (UUID) instead of inline `code` to reference code stored in working memory.

**Response** (Streaming):
```json
{"type":"compilation_complete","success":true,"data":{...}}
{"type":"execution_started"}
{"type":"execution_complete","success":true,"result":{...}}
```

**Response** (Non-streaming):
```json
{
  "success": true,
  "stdout": "console output",
  "stderr": "",
  "returnData": { "analysis": "results" },
  "errors": []
}
```

#### GET /health
Health check endpoint (no authentication required).

**Response**: `"OK"` (200 status)

### Communication Patterns
- **Agent Bundles → Code Sandbox**: Direct HTTP POST with code payload
- **Code Sandbox → KeyVault**: Credential retrieval (via environment variables currently)
- **Code Sandbox → Databases**: ODBC connections established by harness
- **Streaming Mode**: Chunked transfer encoding for progress updates

## Dependencies

### External Services
- **PostgreSQL**: Primary database connectivity
- **Azure KeyVault**: Secret management (connection string retrieval)
- **Databricks**: Data warehouse connectivity via ODBC
- **Application Insights**: Telemetry and logging

### Infrastructure
- **Docker**: Containerization (Node 23 base image)
- **PM2**: Process management for production deployment
- **Kubernetes**: Resource limits and scaling
- **Azure Container Apps**: Hosting environment

### Key Libraries
- **express**: HTTP server framework
- **helmet**: Security headers middleware
- **express-rate-limit**: Rate limiting
- **odbc**: Database driver for multiple database types
- **canvas**: Graphics rendering
- **chart.js**: Chart generation
- **dataframe-js**: DataFrame operations
- **zod**: Request validation

## Configuration

### Required Environment Variables
```bash
# Server Configuration
PORT=3000                                    # HTTP server port
API_KEY=your-api-key-here                    # Authentication key

# Execution Configuration
USE_WORKER_THREADS=false                     # Use worker threads (default: false)
NUM_WORKERS=1                                # Worker thread count

# Database Configuration (per database)
ANALYTICS_CONNECTION_STRING=postgresql://... # Database connection strings
DATAWAREHOUSE_CONNECTION_STRING=...          # Named by database requirement

# Databricks Configuration (if using Databricks)
DATABRICKS_HOST=your-instance.cloud.databricks.com
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/...
DATABRICKS_CLIENT_ID=azure-app-client-id
DATABRICKS_CLIENT_SECRET=azure-app-secret    # From KeyVault
DATABRICKS_TENANT_ID=azure-tenant-id
DATABRICKS_CATALOG=dev_nextgen
DATABRICKS_PORT=443
DATABRICKS_DRIVER=Databricks

# Logging
CONSOLE_LOG_LEVEL=debug                      # Log verbosity
APPLICATIONINSIGHTS_CONNECTION_STRING=...    # Azure monitoring

# Context Service (optional)
CONTEXT_SERVICE_ADDRESS=http://localhost:50051
CONTEXT_SERVICE_API_KEY=...
```

### Optional Configuration
```bash
# Development mode (disables API key check)
# Omit API_KEY environment variable

# Direct execution mode (default, recommended for production)
USE_WORKER_THREADS=false

# Worker thread mode (better isolation, higher overhead)
USE_WORKER_THREADS=true
NUM_WORKERS=4
```

## Deployment Considerations

### Execution Mode Selection
- **Production Recommendation**: Direct execution (`USE_WORKER_THREADS=false`) with horizontal scaling
- **High Isolation Needs**: Worker threads mode with appropriate `NUM_WORKERS` configuration
- **Horizontal Scaling**: Azure Container Apps handles concurrency at infrastructure level

### Resource Recommendations
```yaml
resources:
  limits:
    cpu: "2"
    memory: "4Gi"
  requests:
    cpu: "1"
    memory: "2Gi"
```

### Scaling Strategy
- Scale based on HTTP request concurrency
- Each container handles requests sequentially (direct mode) or via worker pool
- No shared state between containers - stateless design

## Version and Maturity
- **Current Version**: 2.0.0
- **Status**: GA (Generally Available, Stable)
- **Node.js Version**: 23.x required
- **Type**: ES Module (requires `--experimental-vm-modules` flag)

## Usage Examples

### Basic Code Execution
```typescript
import { CodeSandboxClient } from '@firebrandanalytics/cs-client';

const client = CodeSandboxClient.create({
  baseUrl: 'https://code-sandbox.firefoundry.com',
  apiKey: process.env.SANDBOX_API_KEY
});

const result = await client.runCode({
  code: `
    export const analyze = async (dbs) => {
      const result = await dbs.analytics.executeQuery(
        'SELECT COUNT(*) as total FROM users'
      );
      return result.rows[0];
    };
  `,
  language: 'typescript',
  harness: 'finance',
  databases: [
    { name: 'analytics', type: 'postgres' }
  ]
});

console.log('Result:', result.returnData);
```

### Streaming Progress Updates
```typescript
const generator = client.runCodeWithProgress({
  code: '/* your code */',
  language: 'typescript',
  harness: 'finance'
});

for await (const update of generator) {
  switch (update.type) {
    case 'compilation_complete':
      console.log('Compiled:', update.success);
      break;
    case 'execution_complete':
      console.log('Result:', update.result.returnData);
      break;
  }
}
```

## Repository
Source code: [https://github.com/firebrandanalytics/code-sandbox](https://github.com/firebrandanalytics/code-sandbox) (private)

## Related Documentation
- [Platform Architecture](../architecture.md) - Overall FireFoundry architecture
- [Agent SDK - Tool Calling](../../sdk/tool-calling.md) - How agents invoke Code Sandbox
- [Security Considerations](../operations.md#security) - Platform security model
- [Database Adapters](./database-adapters.md) - Supported database types and configuration
- [Deployment Guide](../deployment.md) - Production deployment patterns
