# Platform Service Source Correlation

Debugging FireFoundry platform services (entity-service, doc-proc-service, etc.) by correlating logs and errors back to service source code. This is primarily for internal platform development.

## Platform Service Architecture

All platform services follow a common structure:

```
ff-services-<name>/
├── src/
│   ├── Service.ts          # Express server setup, middleware, signal handlers
│   ├── index.ts            # Entry point
│   ├── config/
│   │   └── index.ts        # Environment configuration
│   ├── providers/          # Business logic (main service implementation)
│   │   └── <Name>Provider.ts
│   ├── routes/
│   │   └── RouteManager.ts # HTTP route definitions
│   ├── clients/            # External service clients (optional)
│   ├── middleware/         # Express middleware (optional)
│   └── __tests__/          # Unit tests
├── logs/                   # Local log files
├── CLAUDE.md               # Service documentation for AI
└── README.md               # Human documentation
```

## Key Components

### Service.ts

The main Express server setup:
- Middleware configuration
- Signal handlers (SIGTERM, SIGINT, etc.)
- Graceful shutdown logic

```typescript
// Common patterns in Service.ts
logger.info("Starting FireFoundry Service", { version, config });
logger.info(`Service listening on port ${config.port}`);
logger.error("Failed to start FireFoundry Service", { error });
logger.info("Shutting down FireFoundry Service...");
```

### Provider Classes

Business logic lives in `src/providers/`. These are the core implementation classes:

| Service | Provider | Purpose |
|---------|----------|---------|
| entity-service | `EntityProvider` | Entity graph operations |
| doc-proc-service | `DocProcessingProvider` | Document processing orchestration |
| doc-proc-service | `ExtractionProvider` | Text extraction |
| doc-proc-service | `GenerationProvider` | Document generation |
| doc-proc-service | `TransformationProvider` | Format conversion |

### RouteManager

Maps HTTP routes to provider methods:

```typescript
// Pattern: route → provider method
this.router.get("/api/node/:id", async (req, res, next) => {
  const node = await this.provider.get_node(req.params.id);
  // ...
});
```

## Log Entry Structure

Platform services use the same Winston logger as agent bundles:

```json
{
  "message": "[EntityProvider] get_node called with ids:",
  "level": "debug",
  "timestamp": "2025-10-11T21:56:04.458Z",
  "properties": {
    "slot": "ff_sdk",
    "version": "0.0.1",
    "ids": "7da913d3-3110-44f7-86bd-88317c9424c2"
  }
}
```

Error logs include stack traces:

```json
{
  "message": "[EntityProvider] Error in get_node: password authentication failed",
  "level": "error",
  "timestamp": "2025-10-11T21:56:04.962Z",
  "properties": {
    "slot": "ff_sdk",
    "version": "0.0.1",
    "code": "08P01",
    "stack": "error: password authentication failed\n    at .../pg-pool/index.js:45:11\n    at async EntityProvider.get_node (file:///.../EntityProvider.js:119:32)"
  }
}
```

**Note:** The `filename`, `functionName`, and `lineNumber` properties in logs are extracted from the call stack and may be unreliable. They can be missing or incorrect depending on how the code was compiled and the call stack structure at log time. Always use the `[ClassName]` prefix in log messages as the primary way to locate log origins.

## Finding Log Origins

### From Log Message to Source

Services use a `[ClassName]` prefix convention:

```bash
# Search for the log message
grep -r "\[EntityProvider\] get_node called" src/

# Search for error pattern
grep -r "Error in get_node" src/

# Find all logs in a provider
grep -r "logger\." src/providers/EntityProvider.ts
```

### From Stack Trace to Source

Stack traces reference compiled `.js` files. Map to TypeScript:

```
file:///.../dist/providers/EntityProvider.js:119:32
                 ↓
src/providers/EntityProvider.ts (around line 119)
```

Note: Line numbers may differ between `.ts` and `.js` due to compilation.

### From HTTP Error to Source

When you see an HTTP error (500, 404, etc.):

1. **Find the route in RouteManager.ts:**
   ```bash
   grep -r "GET /api/node" src/routes/RouteManager.ts
   ```

2. **Find the provider method it calls:**
   ```bash
   # RouteManager calls provider.get_node()
   grep -A20 "async get_node" src/providers/EntityProvider.ts
   ```

3. **Check the error handler:**
   ```bash
   grep -r "registerErrorHandlers\|Global error handler" src/routes/
   ```

## Common Debugging Patterns

### Pattern 1: Database Connection Errors

```bash
# Check EntityProvider initialization
grep -A30 "constructor" src/providers/EntityProvider.ts

# Check PostgresProvider usage
grep -r "PostgresProvider\|getReaderPool\|getWriterPool" src/

# Verify config
grep -r "pgDatabase\|PG_" src/config/
```

### Pattern 2: External Service Failures

For services that call other services (e.g., doc-proc → context-service):

```bash
# Find client initialization
grep -r "ContextServiceClient\|new.*Client" src/providers/

# Check client config
grep -r "CONTEXT_SERVICE_URL\|contextService" src/config/

# Find where client is used
grep -r "this.contextClient\." src/providers/
```

### Pattern 3: Request Processing Errors

```bash
# Find the route
grep -B5 -A30 'router\.(get|post|put|patch|delete).*"/api/your-route"' src/routes/

# Find the provider method
grep -A50 "async methodName" src/providers/

# Check error handling in route
grep -r "next(error)" src/routes/
```

### Pattern 4: Startup Failures

```bash
# Check Service.ts start() method
grep -A30 "async start" src/Service.ts

# Check index.ts entry point
cat src/index.ts

# Check provider constructor
grep -A50 "constructor" src/providers/*.ts
```

## Service-Specific Notes

### entity-service

Key files:
- `src/providers/EntityProvider.ts` - All entity graph operations
- `src/batch/BatchInsertManager.ts` - Batch insert logic
- `src/middleware/cache.ts` - Response caching

Key log prefixes:
- `[EntityProvider]` - Provider operations
- `[BatchInsertManager]` - Batch operations

Common issues:
- Database connection pool exhaustion
- Batch flush failures on shutdown
- Vector embedding operations

### doc-proc-service

Key files:
- `src/providers/DocProcessingProvider.ts` - Orchestration layer
- `src/providers/ExtractionProvider.ts` - Text extraction
- `src/providers/GenerationProvider.ts` - Document generation
- `src/clients/*.ts` - Individual document processors

Key log prefixes:
- `[DocProcessingProvider]` - Orchestration
- `[PdfParseClient]`, `[MammothClient]`, etc. - Individual clients
- `[PuppeteerClient]` - HTML to PDF conversion

Common issues:
- Azure Document Intelligence configuration
- Context Service connection
- Large file handling
- Puppeteer/Chrome issues

## Cluster Debugging

When services are deployed to Kubernetes:

```bash
# Check pod logs
kubectl logs -n ff-control-plane -l app=entity-service --tail=100

# Check for crashes
kubectl describe pod -n ff-control-plane -l app=entity-service

# Exec into pod for debugging
kubectl exec -it -n ff-control-plane <pod-name> -- /bin/sh
```

## Local Development Debugging

```bash
# Run service locally
pnpm dev

# Check local logs
tail -f logs/LogFile-*.log | jq '.'

# Filter by level
tail -f logs/LogFile-*.log | jq 'select(.level == "error")'

# Filter by prefix
tail -f logs/LogFile-*.log | jq 'select(.message | startswith("[EntityProvider]"))'
```

## Quick Reference

### Find All Logger Calls

```bash
grep -r "logger\." src/ --include="*.ts" | grep -v test
```

### Find All Routes

```bash
grep -E "router\.(get|post|put|patch|delete)" src/routes/RouteManager.ts
```

### Find All Provider Methods

```bash
grep -E "^\s*(async\s+)?[a-z_]+\(" src/providers/*.ts | grep -v constructor
```

### Map Route to Provider Method

```bash
# 1. Find route
grep "/api/node/:id" src/routes/RouteManager.ts

# 2. Find what it calls (e.g., this.provider.get_node)
# 3. Find that method in provider
grep -A30 "get_node\(" src/providers/EntityProvider.ts
```

### Check Environment Config

```bash
# What config is available
cat src/config/index.ts

# What env vars are used
grep -r "process\.env\." src/config/
```
