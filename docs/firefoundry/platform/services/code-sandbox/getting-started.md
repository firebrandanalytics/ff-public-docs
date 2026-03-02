# Code Sandbox — Getting Started

This guide walks you through executing code in the sandbox, configuring database access, and processing results.

## Prerequisites

- A running Code Sandbox instance
- An API key configured (via `API_KEY` environment variable)
- Database connection strings configured (if using database features)

## Step 1: Verify the Service is Running

```bash
curl http://localhost:3000/health
# Expected: "OK"
```

## Step 2: Execute Simple Code

Send a basic code execution request:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "code": "export const analyze = async () => { return { message: \"Hello from sandbox!\" }; };",
    "language": "typescript",
    "harness": "finance"
  }'
```

**Response:**
```json
{
  "success": true,
  "stdout": "",
  "stderr": "",
  "returnData": { "message": "Hello from sandbox!" },
  "errors": []
}
```

## Step 3: Execute Code with Database Access

Specify database requirements and the harness will establish connections:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "code": "export const analyze = async (dbs) => {\n  const result = await dbs.analytics.executeQuery(\"SELECT COUNT(*) as total FROM users\");\n  return result.rows[0];\n};",
    "language": "typescript",
    "harness": "finance",
    "databases": [
      { "name": "analytics", "type": "postgres" }
    ]
  }'
```

The `dbs` parameter is automatically populated with pre-authenticated database adapters.

## Step 4: Use a Run Script

For more complex execution, provide a separate run script:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "code": "export const analyze = async (dbs) => {\n  const orders = await dbs.analytics.executeQuery(\"SELECT * FROM orders LIMIT 100\");\n  return { count: orders.rows.length, sample: orders.rows[0] };\n};",
    "runScript": "export const run = async () => { const result = await analyze(dbs); console.log(JSON.stringify(result)); return result; };",
    "language": "typescript",
    "harness": "finance",
    "databases": [
      { "name": "analytics", "type": "postgres" }
    ]
  }'
```

## Step 5: Use Streaming for Progress Updates

For long-running operations, the sandbox streams progress events:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "Accept: text/event-stream" \
  -d '{
    "code": "export const analyze = async (dbs) => { /* long analysis */ };",
    "language": "typescript",
    "harness": "finance",
    "databases": [{ "name": "analytics", "type": "postgres" }]
  }'
```

Stream events:
```json
{"type":"compilation_complete","success":true,"data":{}}
{"type":"execution_started"}
{"type":"execution_complete","success":true,"result":{"returnData":{}}}
```

## Step 6: Reference Code from Working Memory

Instead of inlining code, reference a working memory document:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "codeWorkingMemoryId": "wm-12345-uuid",
    "language": "typescript",
    "harness": "finance",
    "databases": [{ "name": "analytics", "type": "postgres" }]
  }'
```

## Using the Client SDK

For programmatic access from agent bundles:

```typescript
import { CodeSandboxClient } from '@firebrandanalytics/cs-client';

const client = CodeSandboxClient.create({
  baseUrl: 'https://code-sandbox.firefoundry.com',
  apiKey: process.env.SANDBOX_API_KEY
});

// Simple execution
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
  databases: [{ name: 'analytics', type: 'postgres' }]
});

console.log('Result:', result.returnData);
```

### Streaming with the Client SDK

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

## Next Steps

- Read [Concepts](./concepts.md) for the execution model, harness system, and security model
- See [Reference](./reference.md) for the complete API specification
- See [Operations](./operations.md) for deployment and configuration guidance
