# Context Service — Getting Started

This guide walks through the four most common integration points: connecting the client, uploading a file to working memory, retrieving chat history, and registering a custom chat history mapping.

---

## Prerequisites

- A running FireFoundry platform deployment (or local dev environment with `kubectl port-forward`)
- `@firebrandanalytics/cs-client` installed in your project
- `CONTEXT_SERVICE_ADDRESS` and (optionally) `CONTEXT_SERVICE_API_KEY` set in your environment

For local development, port-forward the service:

```bash
kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051
```

Then set:

```bash
CONTEXT_SERVICE_ADDRESS=http://localhost:50051
CONTEXT_SERVICE_API_KEY=   # leave empty if auth is disabled locally
```

---

## Step 1: Connect the Client

```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';

const client = new ContextServiceClient({
  address: process.env.CONTEXT_SERVICE_ADDRESS || 'http://localhost:50051',
  apiKey: process.env.CONTEXT_SERVICE_API_KEY || '',
});
```

The client connects over gRPC via Connect-RPC. In agent bundles, the `CONTEXT_SERVICE_ADDRESS` and `CONTEXT_SERVICE_API_KEY` environment variables are provided by the platform automatically.

---

## Step 2: Upload a File to Working Memory

Working Memory stores binary files linked to an entity node. Each upload returns a `workingMemoryId` — store this in your entity data to retrieve the file later.

```typescript
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';

// Read the file into a buffer
const buffer = await readFile('./report.pdf');
const entityNodeId = 'your-entity-node-uuid';

// Upload to working memory
const result = await client.uploadBlobFromBuffer({
  entityNodeId,
  memoryType: 'file',
  name: 'quarterly-report.pdf',
  description: 'Q4 2025 financial report',
  contentType: 'application/pdf',
  buffer,
  metadata: {
    stage: 'original_upload',
    uploaded_at: new Date().toISOString(),
  },
});

console.log('Stored with ID:', result.workingMemoryId);
// Save this ID in your entity data: await entity.update_data({ report_wm_id: result.workingMemoryId })
```

---

## Step 3: Retrieve a File from Working Memory

Use the `workingMemoryId` you stored to fetch the file bytes or just its metadata:

```typescript
// Fetch metadata only
const record = await client.fetchWMRecord(workingMemoryId);
console.log(record.name, record.contentType, record.metadata);

// Fetch the file bytes (returns Buffer)
const buffer = await client.getBlob(workingMemoryId);
await writeFile('./downloaded-report.pdf', buffer);

// List all files for an entity
const records = await client.fetchWMRecordsByEntity(entityNodeId);
for (const record of records) {
  console.log(record.id, record.name, record.memoryType);
}
```

---

## Step 4: Retrieve Chat History

The Context Service can reconstruct the conversation history for any entity node by traversing the entity graph. This is how `ChatHistoryBotMixin` works in the SDK, but you can also call it directly.

```typescript
// Fetch chat history for a session node
const history = await client.getChatHistory(sessionNodeId);

for (const message of history.messages) {
  console.log(`[${message.role}] ${message.content}`);
}
```

If your app uses a custom entity model (not the default `user_input`/`assistant_output` fields), pass your mapping name:

```typescript
const history = await client.getChatHistory(sessionNodeId, 'my_custom_mapping');
```

The default mapping (`simple_chat`) covers the standard SDK bot/entity pattern. Custom mappings are described in Step 5.

---

## Step 5: Register a Custom Chat History Mapping

If your app has a custom entity model for conversation turns, register a named CEL mapping so the Context Service knows how to reconstruct history from your graph structure.

Call `RegisterMapping` at application startup:

```typescript
// This is called once at startup — the mapping lives in memory
await client.registerMapping({
  appId: 'your-app-id',
  mappingName: 'my_custom_mapping',
  // CEL rules describing how to traverse and transform your entity graph
  // into ordered ChatMessage[]
  rules: {
    edgeTypes: ['Contains', 'HasTurn'],
    entityTypes: ['ConversationTurn'],
    roleField: 'data.role',          // CEL path to extract role
    contentField: 'data.content',    // CEL path to extract content
    orderField: 'created_at',        // Field to sort by
  },
});
```

After registration, reference the mapping by name in `getChatHistory` calls or in your `ChatHistoryBotMixin` config:

```typescript
// In your bot's entity configuration (see SDK docs):
new ChatHistoryBotMixin({ mappingName: 'my_custom_mapping' })
```

---

## Next Steps

- **SDK integration**: The most common way to use chat history in a bot — see [Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- **SDK working memory**: Higher-level `WorkingMemoryProvider` wrapper for agent bundles — see [Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
- **All APIs**: Full gRPC reference, environment variables, error codes — see [Reference](./reference.md)
