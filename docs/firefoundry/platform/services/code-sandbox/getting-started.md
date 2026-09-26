# Code Sandbox — Getting Started

This guide takes you from a health check to running code with database access, first with `curl` and then from an agent bundle.

## Prerequisites

- The Code Sandbox enabled in your FireFoundry environment (see [Operations](./operations.md#enabling-the-code-sandbox))
- The sandbox API key, if your environment has one configured
- For database access: at least one database configured for the sandbox (see [Operations](./operations.md#making-databases-available))

Inside the cluster, the sandbox is reachable at `http://firefoundry-core-code-sandbox:3000`. To try it from your workstation, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-code-sandbox -n <namespace> 3000:3000
```

The examples below use `http://localhost:3000`.

## Step 1: Check That the Sandbox Is Reachable

```bash
curl http://localhost:3000/health
# Expected: "OK"
```

## Step 2: Run Simple Code

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

Response:

```json
{
  "success": true,
  "stdout": "",
  "stderr": "",
  "returnData": { "message": "Hello from sandbox!" },
  "errors": []
}
```

Omit the `x-api-key` header if your environment does not configure one.

## Step 3: Query a Database

List the databases the code needs. Each entry becomes a property on `dbs`:

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

`analytics` must be a database name configured for your environment.

## Step 4: Add a Run Script (Optional)

A `runScript` lets you keep the generated code separate from the code that drives it, for example to log intermediate output:

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

## Step 5: Stream Progress

For long-running code, request streamed progress events:

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

```json
{"type":"compilation_complete","success":true,"data":{}}
{"type":"execution_started"}
{"type":"execution_complete","success":true,"result":{"returnData":{}}}
```

## Step 6: Run Code Stored in Working Memory

If your bundle saved the generated code to a [Context Service](../context-service/README.md) working memory document, reference it instead of sending the code inline:

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

## Calling the Sandbox from an Agent Bundle

Use the TypeScript client, `@firebrandanalytics/code-sandbox-client`:

```typescript
import { CodeSandboxClient } from '@firebrandanalytics/code-sandbox-client';

const client = CodeSandboxClient.create({
  baseUrl: 'http://firefoundry-core-code-sandbox:3000',
  apiKey: process.env.SANDBOX_API_KEY // omit if your environment has no sandbox key
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
  databases: [{ name: 'analytics', type: 'postgres' }]
});

if (!result.success) {
  // Send result.errors back to the bot that wrote the code and ask for a fix
}
console.log('Result:', result.returnData);
```

### Streaming with the Client

```typescript
const updates = client.runCodeWithProgress({
  code: '/* your code */',
  language: 'typescript',
  harness: 'finance'
});

for await (const update of updates) {
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

### From MCP-Capable Agents

Agents that use the [MCP Gateway](../mcp-gateway/README.md) can call the `sandbox_execute_code` tool instead. See [MCP Gateway tools](../mcp-gateway/tools.md#code-sandbox-adapter).

## Next Steps

- [Concepts](./concepts.md): harnesses, the security model, and app design patterns
- [Reference](./reference.md): the full request and response contract
- [Operations](./operations.md): enabling the sandbox and configuring databases
