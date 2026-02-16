# RemoteAgentBundleClient Documentation

Complete guide to using the `RemoteAgentBundleClient` for interacting with FireFoundry Agent Bundle servers.

## Table of Contents

- [Overview](#overview)
- [Installation & Setup](#installation--setup)
- [Entity Invocations](#entity-invocations)
- [Iterator Methods](#iterator-methods)
- [API Endpoint Methods](#api-endpoint-methods)
- [Unified Methods](#unified-methods)
- [Feature Matrix](#feature-matrix)
- [Binary Data Handling](#binary-data-handling)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Overview

The `RemoteAgentBundleClient` provides a complete client for interacting with FireFoundry Agent Bundle servers. It supports:

- ✅ Entity method invocations (RPC-style)
- ✅ Custom API endpoints (REST-style)
- ✅ Binary file uploads (blobs)
- ✅ Binary file downloads
- ✅ Streaming responses (iterators)
- ✅ All combinations of the above

## Installation & Setup

```typescript
import { RemoteAgentBundleClient } from "@firebrandanalytics/ff-sdk";

// Basic setup
const client = new RemoteAgentBundleClient('http://localhost:3000');

// With API key
const client = new RemoteAgentBundleClient('http://localhost:3000', {
  api_key: 'your-api-key'
});

// With custom timeout
const client = new RemoteAgentBundleClient('http://localhost:3000', {
  api_key: 'your-api-key',
  timeout: 300000  // 5 minutes
});

// Legacy: API key as second parameter (still supported)
const client = new RemoteAgentBundleClient('http://localhost:3000', 'your-api-key');
```

## Entity Invocations

Methods for calling entity methods on the server (RPC-style).

### Basic Invocation

Call an entity method with JSON arguments:

```typescript
const result = await client.invoke_entity_method(
  'entity-uuid-123',
  'processData',
  { input: 'test', mode: 'analyze' }
);
```

### With Binary File Upload

Upload files as part of the invocation using blob placeholders:

```typescript
import * as fs from 'fs';

const pdfBuffer = fs.readFileSync('document.pdf');

const result = await client.invoke_entity_method_with_blobs(
  'entity-uuid-123',
  'processDocument',
  [
    { $blob: 0 },              // First file
    { title: 'Report', year: 2024 }  // Additional arguments
  ],
  [pdfBuffer]                  // Array of file buffers
);
```

**Multiple files:**

```typescript
const file1 = fs.readFileSync('image1.jpg');
const file2 = fs.readFileSync('image2.jpg');

const result = await client.invoke_entity_method_with_blobs(
  'entity-uuid-123',
  'compareImages',
  [
    { $blob: 0 },              // First image
    { $blob: 1 },              // Second image
    { mode: 'similarity' }     // Options
  ],
  [file1, file2]
);
```

### Binary Return (Efficient for Large Files)

When the entity method returns a Buffer and you want to avoid base64 encoding overhead:

```typescript
// Returns raw Buffer (33% more efficient than default)
const pdfBuffer = await client.invoke_entity_method_binary(
  'entity-uuid-123',
  'generateLargePdf',
  { template: 'report', pages: 1000 }
);

fs.writeFileSync('output.pdf', pdfBuffer);
```

**With blob input:**

```typescript
const inputImage = fs.readFileSync('input.jpg');

const processedImage = await client.invoke_entity_method_binary_with_blobs(
  'entity-uuid-123',
  'processImage',
  [
    { $blob: 0 },
    { filter: 'sharpen', format: 'png' }
  ],
  [inputImage]
);

fs.writeFileSync('output.png', processedImage);
```

### Unified Method: `invoke()`

The `invoke()` method provides a clean, unified API for all entity invocations:

```typescript
// Simple invocation
const result = await client.invoke('entity-123', 'processData', {
  args: [{ input: 'test' }]
});

// With file upload
const result = await client.invoke('entity-123', 'processDocument', {
  args: [{ $blob: 0 }, { title: 'Doc' }],
  files: [pdfBuffer]
});

// Binary return
const buffer = await client.invoke('entity-123', 'generatePdf', {
  args: [{ pages: 100 }],
  returns: 'binary'
});

// Iterator (streaming)
const iterator = await client.invoke('entity-123', 'start', {
  args: [{ config: 'test' }],
  returns: 'iterator'
});
```

## Iterator Methods

Methods for starting and consuming streaming responses (iterators).

### Start Iterator

Start an iterator for streaming responses:

```typescript
const iterator = await client.start_iterator(
  'entity-uuid-123',
  'processLongTask',
  { steps: 100 }
);

// Consume with for-await-of
for await (const update of iterator) {
  console.log(`Progress: ${update.progress}%`);
  console.log(`Status: ${update.message}`);
}

// Cleanup
await iterator.cleanup();
```

### Start Iterator with Blobs

Start an iterator that processes uploaded files:

```typescript
const videoBuffer = fs.readFileSync('video.mp4');

const iterator = await client.start_iterator_with_blobs(
  'entity-uuid-123',
  'processVideo',
  [
    { $blob: 0 },
    { format: 'mp4', quality: 'high' }
  ],
  [videoBuffer]
);

for await (const update of iterator) {
  console.log(`${update.stage}: ${update.progress * 100}%`);
}

await iterator.cleanup();
```

### Manual Iterator Control

```typescript
const iterator = await client.start_iterator('entity-123', 'start');

while (true) {
  const { value, done } = await iterator.next();
  
  if (done) {
    console.log('Final result:', value);
    break;
  }
  
  console.log('Update:', value);
}

await iterator.cleanup();
```

## API Endpoint Methods

Methods for calling custom API endpoints (REST-style).

### Basic API Endpoint Call

```typescript
// GET request
const workflows = await client.call_api_endpoint('workflows', {
  query: { status: 'active', limit: 10 }
});

// POST request
const result = await client.call_api_endpoint('create-entity', {
  method: 'POST',
  body: { name: 'Test', type: 'sample' },
  query: { validate: true }
});
```

### Response Unwrapping

> **Important:** `call_api_endpoint()` (and `api_endpoint()`) automatically unwraps the SDK response envelope. Your code receives the **clean result directly** — not the wire format.

Agent bundle servers wrap all responses in a `{success, result}` envelope for transport. The client strips this wrapper before returning:

```typescript
// Your agent bundle endpoint returns:
//   { title: "My Poem", poem: "Roses are red...", style: "haiku" }

// Wire format (what actually goes over HTTP):
//   { success: true, result: { title: "My Poem", poem: "Roses are red...", style: "haiku" } }

// What call_api_endpoint() returns to you:
//   { title: "My Poem", poem: "Roses are red...", style: "haiku" }

const response = await client.call_api_endpoint('generate-poem', {
  method: 'POST',
  body: { style: 'haiku' }
});

// Correct:
console.log(response.title);  // "My Poem"

// Wrong — response.result is undefined:
console.log(response.result.title);  // TypeError!
```

This also applies to the unified `api_endpoint()` method and all entity invocation methods (`invoke_entity_method()`, `invoke()`).

### Health Check Endpoint

> **Note:** Agent bundle health endpoints are served at the root level (`/health`), not under `/api/`. Since `call_api_endpoint()` prepends `/api/` to the route, you **cannot** use it for health checks.

Use plain `fetch()` or the built-in `health_check()` method instead:

```typescript
// Option 1: Built-in health check
const isHealthy = await client.health_check();

// Option 2: Manual fetch (e.g., from a web UI or monitoring script)
const res = await fetch(`${baseUrl}/health`);
const health = await res.json();

// Wrong — this hits /api/health which returns 404:
const health = await client.call_api_endpoint('health');
```

### Binary Response (Download Files)

```typescript
const pdfBuffer = await client.call_api_endpoint_binary('generate-pdf', {
  query: { template: 'monthly-report', format: 'A4' }
});

fs.writeFileSync('report.pdf', pdfBuffer);

// With POST
const imageBuffer = await client.call_api_endpoint_binary('render-chart', {
  method: 'POST',
  body: { type: 'bar', data: [10, 20, 30] }
});
```

### With Binary Upload

```typescript
const documentBuffer = fs.readFileSync('document.pdf');

const result = await client.call_api_endpoint_with_blobs(
  'process-document',
  [
    { $blob: 0 },
    { title: 'My Document', author: 'John Doe' }
  ],
  [documentBuffer],
  { query: { priority: 'high' } }
);
```

### Iterator Response (Streaming)

```typescript
const iterator = await client.call_api_endpoint_iterator('stream-analysis', {
  method: 'POST',
  body: { topic: 'quantum computing' }
});

for await (const update of iterator) {
  console.log(`${update.status}: ${update.message}`);
  if (update.progress) {
    console.log(`Progress: ${(update.progress * 100).toFixed(0)}%`);
  }
}

await iterator.cleanup();
```

### Iterator with Blobs

```typescript
const videoBuffer = fs.readFileSync('video.mp4');

const iterator = await client.call_api_endpoint_iterator_with_blobs(
  'process-video',
  [
    { $blob: 0 },
    { format: 'mp4', quality: 'high' }
  ],
  [videoBuffer],
  { query: { priority: 'high' } }
);

for await (const update of iterator) {
  console.log(`Stage: ${update.stage}, Progress: ${update.progress * 100}%`);
}

await iterator.cleanup();
```

### Unified Method: `api_endpoint()`

The `api_endpoint()` method provides a unified API for all endpoint calls:

```typescript
// JSON → JSON
const result = await client.api_endpoint('create-entity', {
  method: 'POST',
  body: { name: 'test' }
});

// JSON → Binary
const pdf = await client.api_endpoint('generate-pdf', {
  responseType: 'binary',
  query: { template: 'report' }
});

// Blob → JSON
const result = await client.api_endpoint('process-document', {
  args: [{ $blob: 0 }, { title: 'Doc' }],
  files: [pdfBuffer]
});

// JSON → Iterator
const iterator = await client.api_endpoint('stream-analysis', {
  method: 'POST',
  body: { topic: 'AI' },
  responseType: 'iterator'
});

// Blob → Iterator
const iterator = await client.api_endpoint('process-video', {
  args: [{ $blob: 0 }, { format: 'mp4' }],
  files: [videoBuffer],
  responseType: 'iterator'
});
```

## Unified Methods

Two powerful methods that automatically dispatch to the appropriate specific method.

### `invoke()` - For Entity Methods

```typescript
// Signature
client.invoke<T>(
  entity_id: string,
  method_name: string,
  options?: {
    args?: any[];
    files?: Buffer[];
    returns?: 'result' | 'binary' | 'iterator';
  }
): Promise<T | Buffer | IteratorProxy<T>>
```

**Parameters:**
- `returns: 'result'` (default) - JSON response with envelope, auto base64 for Buffers
- `returns: 'binary'` - Raw binary response (efficient, no overhead)
- `returns: 'iterator'` - Streaming response

**Examples:**

```typescript
// All these work seamlessly:
await client.invoke('entity-123', 'process', { args: [...] });
await client.invoke('entity-123', 'process', { args: [...], files: [...] });
await client.invoke('entity-123', 'generate', { returns: 'binary' });
await client.invoke('entity-123', 'start', { returns: 'iterator' });
await client.invoke('entity-123', 'stream', { files: [...], returns: 'iterator' });
```

### `api_endpoint()` - For Custom API Endpoints

```typescript
// Signature
client.api_endpoint<T>(
  route: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: any;
    args?: any[];
    files?: Buffer[];
    query?: Record<string, any>;
    responseType?: 'json' | 'binary' | 'iterator';
  }
): Promise<T | Buffer | IteratorProxy<T>>
```

**Parameters:**
- `responseType: 'json'` (default) - JSON response
- `responseType: 'binary'` - Binary response
- `responseType: 'iterator'` - Streaming response

**Examples:**

```typescript
// All these work seamlessly:
await client.api_endpoint('route', { method: 'POST', body: {...} });
await client.api_endpoint('route', { args: [...], files: [...] });
await client.api_endpoint('route', { responseType: 'binary' });
await client.api_endpoint('route', { body: {...}, responseType: 'iterator' });
await client.api_endpoint('route', { files: [...], responseType: 'iterator' });
```

## Feature Matrix

### Entity Invocations

| Input → Output | Result (envelope) | Binary (raw) | Iterator |
|----------------|-------------------|--------------|----------|
| **JSON args** | `invoke_entity_method()` | `invoke_entity_method_binary()` | `start_iterator()` |
| **Blob args** | `invoke_entity_method_with_blobs()` | `invoke_entity_method_binary_with_blobs()` | `start_iterator_with_blobs()` |
| **Unified** | `invoke(..., { returns: 'result' })` | `invoke(..., { returns: 'binary' })` | `invoke(..., { returns: 'iterator' })` |

### API Endpoints

| Input → Output | JSON Response | Binary Response | Iterator Response |
|----------------|---------------|-----------------|-------------------|
| **JSON** | `call_api_endpoint()` | `call_api_endpoint_binary()` | `call_api_endpoint_iterator()` |
| **Blobs** | `call_api_endpoint_with_blobs()` | ❌ Not supported | `call_api_endpoint_iterator_with_blobs()` |
| **Unified** | `api_endpoint()` | `api_endpoint({ responseType: 'binary' })` | `api_endpoint({ responseType: 'iterator' })` |

## Binary Data Handling

### Blob Placeholders

Use `{ $blob: index }` to mark where file buffers should be injected:

```typescript
args: [
  { $blob: 0 },              // First file
  { title: 'Document' },     // Regular argument
  { $blob: 1 }               // Second file
],
files: [pdfBuffer, imageBuffer]

// Server receives: [Buffer, { title: 'Document' }, Buffer]
```

### Buffer Returns - Two Modes

**1. Envelope Mode (default)** - `returns: 'result'`
```typescript
const buffer = await client.invoke('entity-123', 'generatePdf');
// Server auto base64-encodes, client auto-decodes
// Response: { success: true, result_type: 'Buffer', result: 'base64...' }
// Returns: Buffer
// Overhead: 33% size increase
// Benefit: Consistent error handling
```

**2. Binary Mode (efficient)** - `returns: 'binary'`
```typescript
const buffer = await client.invoke('entity-123', 'generatePdf', {
  returns: 'binary'
});
// Server returns raw bytes
// No overhead, but errors come as HTTP status codes
// Best for: Large files where efficiency matters
```

### When to Use Each

| Scenario | Recommendation |
|----------|----------------|
| Small files (<1MB) | Use default (`returns: 'result'`) |
| Large files (>10MB) | Use binary mode (`returns: 'binary'`) |
| Need error details | Use default (envelope has error messages) |
| Maximum efficiency | Use binary mode |
| Streaming progress | Use iterator (`returns: 'iterator'`) |

## Error Handling

### Standard Errors

All methods throw `FFError` on failure:

```typescript
import { FFError } from "@firebrandanalytics/ff-sdk";

try {
  const result = await client.invoke_entity_method('entity-123', 'process');
} catch (error) {
  if (error instanceof FFError) {
    console.error('Remote call failed:', error.message);
  }
}
```

### Binary Mode Errors

Binary mode returns errors as HTTP status codes (no JSON envelope):

```typescript
try {
  const buffer = await client.invoke('entity-123', 'generate', {
    returns: 'binary'
  });
} catch (error) {
  // Error is still FFError, but with HTTP status info
  console.error('Binary call failed:', error.message);
  // e.g., "Binary invocation failed: 500 Internal Server Error"
}
```

### Iterator Errors

```typescript
try {
  const iterator = await client.start_iterator('entity-123', 'start');
  
  for await (const update of iterator) {
    console.log(update);
  }
} catch (error) {
  console.error('Iterator failed:', error.message);
} finally {
  await iterator.cleanup();  // Always cleanup
}
```

## Best Practices

### 1. Always Cleanup Iterators

```typescript
const iterator = await client.start_iterator('entity-123', 'start');

try {
  for await (const update of iterator) {
    console.log(update);
  }
} finally {
  await iterator.cleanup();  // Releases server resources
}
```

### 2. Use Unified Methods for Cleaner Code

**Instead of:**
```typescript
const result = await client.invoke_entity_method_with_blobs(
  'entity-123',
  'process',
  [{ $blob: 0 }, options],
  [fileBuffer]
);
```

**Prefer:**
```typescript
const result = await client.invoke('entity-123', 'process', {
  args: [{ $blob: 0 }, options],
  files: [fileBuffer]
});
```

### 3. Choose the Right Return Mode

```typescript
// Small files or need error details
const smallPdf = await client.invoke('entity-123', 'generateSmallPdf', {
  returns: 'result'  // Auto base64, error envelope
});

// Large files where efficiency matters
const largePdf = await client.invoke('entity-123', 'generateLargePdf', {
  returns: 'binary'  // No overhead, HTTP errors
});

// Long-running with progress updates
const iterator = await client.invoke('entity-123', 'processVideo', {
  returns: 'iterator'
});
```

### 4. Use TypeScript Generics

```typescript
interface ProcessResult {
  status: string;
  items: number;
}

const result = await client.invoke<ProcessResult>('entity-123', 'process', {
  args: [{ mode: 'full' }]
});

// result is typed as ProcessResult
console.log(result.status);
```

### 5. Handle Custom Classes

If a method returns a custom class, the client provides metadata:

```typescript
const response = await client.axios.post('/invoke', {
  entity_id: 'entity-123',
  method_name: 'getData'
});

if (response.data.result_type === 'MyCustomClass') {
  // Reconstruct your class
  const instance = new MyCustomClass();
  Object.assign(instance, response.data.result);
  return instance;
}
```

### 6. Set Appropriate Timeouts

```typescript
// For long-running operations
const client = new RemoteAgentBundleClient('http://localhost:3000', {
  timeout: 600000  // 10 minutes
});

// Or use iterators for operations that take a long time
const iterator = await client.invoke('entity-123', 'longProcess', {
  returns: 'iterator'
});
```

### 7. Don't Double-Unwrap API Responses

`call_api_endpoint()` and `api_endpoint()` automatically unwrap the `{success, result}` envelope. Access your data directly on the response object:

```typescript
const poem = await client.call_api_endpoint('generate-poem', {
  method: 'POST',
  body: { style: 'haiku' }
});

// Correct — data is returned directly:
console.log(poem.title);

// Wrong — the envelope has already been stripped:
console.log(poem.result.title);  // TypeError: Cannot read property 'title' of undefined
```

### 8. Use fetch() for Health Checks

Health endpoints live at `/health` (root level), but `call_api_endpoint()` prepends `/api/`. Use the built-in method or plain `fetch()`:

```typescript
// Correct:
const healthy = await client.health_check();

// Also correct (manual):
const res = await fetch(`${baseUrl}/health`);

// Wrong — 404:
await client.call_api_endpoint('health');
```

### 9. Reuse Client Instances

```typescript
// Good: Create once, reuse
class MyService {
  private client: RemoteAgentBundleClient;
  
  constructor() {
    this.client = new RemoteAgentBundleClient('http://localhost:3000', {
      api_key: process.env.API_KEY
    });
  }
  
  async processData() {
    return this.client.invoke('entity-123', 'process');
  }
}

// Avoid: Creating new client for each call (inefficient)
```

## Advanced Usage

### Extend the Client

```typescript
class CustomClient extends RemoteAgentBundleClient {
  async invokeWithRetry(
    entity_id: string,
    method_name: string,
    maxRetries = 3
  ) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.invoke_entity_method(entity_id, method_name);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.delay(1000 * (i + 1));
      }
    }
  }
  
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Custom Type Reconstruction

```typescript
class ExtendedClient extends RemoteAgentBundleClient {
  async invoke_entity_method<OUT = any>(
    entity_id: UUID,
    method_name: string,
    ...args: any[]
  ): Promise<OUT> {
    const response = await this.axios.post("/invoke", {
      entity_id,
      method_name,
      args,
    });
    
    // Custom handling based on result_type
    if (response.data.result_type === 'Date') {
      return new Date(response.data.result) as OUT;
    }
    
    if (response.data.result_type === 'MyCustomClass') {
      return MyCustomClass.fromJSON(response.data.result) as OUT;
    }
    
    return super.invoke_entity_method(entity_id, method_name, ...args);
  }
}
```

## Complete Example

```typescript
import { RemoteAgentBundleClient } from "@firebrandanalytics/ff-sdk";
import * as fs from 'fs';

async function main() {
  // Setup client
  const client = new RemoteAgentBundleClient('http://localhost:3000', {
    api_key: process.env.API_KEY,
    timeout: 300000
  });
  
  // Check server health
  const isHealthy = await client.health_check();
  if (!isHealthy) {
    throw new Error('Server not healthy');
  }
  
  // Simple invocation
  const data = await client.invoke('entity-123', 'getData', {
    args: [{ filter: 'active' }]
  });
  
  // Upload and process a file
  const pdfBuffer = fs.readFileSync('document.pdf');
  const analysis = await client.invoke('entity-123', 'analyzeDocument', {
    args: [{ $blob: 0 }, { detailed: true }],
    files: [pdfBuffer]
  });
  
  // Generate a large report (binary mode for efficiency)
  const reportBuffer = await client.invoke('entity-123', 'generateReport', {
    args: [{ pages: 1000 }],
    returns: 'binary'
  });
  fs.writeFileSync('report.pdf', reportBuffer);
  
  // Long-running task with progress updates
  const iterator = await client.invoke('entity-123', 'processLargeDataset', {
    args: [{ dataset: 'customers' }],
    returns: 'iterator'
  });
  
  try {
    for await (const update of iterator) {
      console.log(`Progress: ${update.progress}% - ${update.message}`);
    }
  } finally {
    await iterator.cleanup();
  }
  
  // Call a custom API endpoint
  const workflows = await client.api_endpoint('workflows', {
    query: { status: 'active' }
  });
  
  console.log('All operations complete!');
}

main().catch(console.error);
```

## See Also

- [Server-side documentation](../../ff-agent-sdk/src/server/README.md)
- [Blob improvement summary](../../ff-agent-sdk/notes/BLOB_IMPROVEMENT_SUMMARY.md)
- [API Endpoint documentation](../../ff-agent-sdk/src/server/README.md#binary-file-upload-support)

