# Agent Bundles Reference Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture and Concepts](#architecture-and-concepts)
3. [FFAgentBundle Class](#ffagentbundle-class)
4. [Initialization and Lifecycle](#initialization-and-lifecycle)
5. [API Endpoints with @ApiEndpoint](#api-endpoints-with-apiendpoint)
6. [Invocation Patterns](#invocation-patterns)
7. [Consuming Agent Bundles](#consuming-agent-bundles)
8. [Platform Service Integration](#platform-service-integration)
9. [Error Handling](#error-handling)
10. [Advanced Patterns](#advanced-patterns)
11. [Cross-Bundle Communication](#cross-bundle-communication)
12. [Deployment and Configuration](#deployment-and-configuration)
13. [Best Practices](#best-practices)
14. [Security Considerations](#security-considerations)

---

## Overview

An **Agent Bundle** is the top-level application container in the FireFoundry platform. It serves as:
- The **deployment unit**: Packaged as a Docker container and deployed to Kubernetes
- The **application context**: Providing access to platform services and capabilities
- The **API surface**: Exposing endpoints for external systems to interact with your application
- The **initialization point**: Bootstrapping the application state and configuration

Agent bundles are the primary isolation boundary in FireFoundry—each bundle runs in its own process with independent resources, while still being able to communicate efficiently with other bundles and platform services via gRPC.

### Key Characteristics

- **Containerized**: Each bundle is packaged as a Docker image
- **Stateless at the bundle level**: Application state lives in the entity graph, not bundle instance variables
- **Service-oriented**: Bundles expose HTTP/gRPC endpoints for external and internal communication
- **Entity-centric**: Bundles manage collections of related entities and their behaviors
- **Observable**: Built-in health checks, metrics, and distributed tracing

---

## Architecture and Concepts

### Bundle Structure

A typical agent bundle project has this structure:

```
my-agent-bundle/
├── src/
│   ├── agent-bundle.ts         # Main bundle class
│   ├── constructors.ts         # Entity type registry
│   ├── index.ts                # Entry point
│   ├── entities/               # Entity definitions
│   │   ├── MyEntity.ts
│   │   └── MyWorkflow.ts
│   ├── bots/                   # Bot definitions
│   │   └── MyBot.ts
│   └── prompts/                # Prompt definitions
│       └── MyPrompt.ts
├── package.json
├── tsconfig.json
├── Dockerfile
└── firefoundry.json            # Bundle metadata
```

### The Bundle Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Bundle Lifecycle                          │
└─────────────────────────────────────────────────────────────┘

1. Container Start
   ↓
2. Platform Connection (gRPC to Context Service, Broker, etc.)
   ↓
3. Bundle Constructor
   ↓
4. Bundle.init() - Application initialization
   ↓
5. HTTP/gRPC Server Start
   ↓
6. Ready to Accept Requests
   │
   ├─→ @ApiEndpoint calls
   ├─→ Entity invocations
   └─→ Health/Ready checks
   │
7. Graceful Shutdown (on SIGTERM/SIGINT)
```

### Communication Patterns

```
┌──────────────────────────────────────────────────────────────┐
│                   Communication Model                         │
└──────────────────────────────────────────────────────────────┘

External Client (REST/WebSocket)
    │
    ↓
Kong Gateway (API Management)
    │
    ↓
Agent Bundle (HTTP Server)
    │
    ├─→ @ApiEndpoint methods (ID-less APIs)
    │
    └─→ /invoke/{entityId} (Entity-based invocation)
            │
            ↓
        Entity.run() or Entity method
            │
            ├─→ Bot.run() (AI processing)
            │   └─→ Broker Service (gRPC)
            │
            ├─→ Entity Factory/Client (state management)
            │   └─→ Context Service (gRPC)
            │
            └─→ Other Bundles (gRPC, internal)
```

---

## FFAgentBundle Class

### Class Definition

```typescript
import {
  FFAgentBundle,
  app_provider,
  EntityTypeHelper,
  BotTypeHelper,
  PromptTypeHelper,
} from '@firebrandanalytics/ff-agent-sdk';
import { MyConstructors, MyETH } from './constructors.js';

export class MyAgentBundle extends FFAgentBundle<MyETH> {
  constructor() {
    super(
      {
        id: string,            // Unique UUID for this bundle
        name: string,          // Human-readable name
        description: string,   // Bundle description
      },
      constructors: Record<string, any>,  // Entity type registry
      provider: any          // Platform service provider (app_provider)
    );
  }
}
```

### Constructor Parameters

#### Bundle Identity Object

```typescript
{
  id: 'b5bcb46b-5d7d-4a83-8088-639562f77bf6',  // Must be a valid UUID
  name: 'MyAgentBundle',                        // Used in logs and metrics
  description: 'Description of what this bundle does',
}
```

**Best Practices:**
- Generate the UUID once and commit it to source control
- Use a descriptive name that identifies the bundle's purpose
- Keep descriptions concise but informative

#### Constructors Registry

The constructors object maps entity type names (as strings) to their constructor classes:

```typescript
import {
  FFConstructors,
  EntityTypeHelper,
  BotTypeHelper,
  PromptTypeHelper,
} from '@firebrandanalytics/ff-agent-sdk';
import { ArticleEntity } from './entities/ArticleEntity.js';
import { AnalysisWorkflow } from './entities/AnalysisWorkflow.js';
import { CustomRunnable } from './entities/CustomRunnable.js';

export const MyConstructors = {
  ...FFConstructors,              // Include built-in types
  ArticleEntity: ArticleEntity,
  AnalysisWorkflow: AnalysisWorkflow,
  CustomRunnable: CustomRunnable,
} as const;

/**
 * Type helper for the agent bundle.
 * This provides type-safe entity factory operations.
 */
export type MyETH = EntityTypeHelper<
  BotTypeHelper<PromptTypeHelper<any, any>, any>,
  typeof MyConstructors
>;
```

**Why This Matters:**
- Enables the entity factory to deserialize entities from the database
- Required for `entity_factory.get_entity(id)` to return properly typed instances
- Supports polymorphism in the entity graph
- The `EntityTypeHelper` type parameter enables type-safe entity creation and retrieval throughout your bundle

#### Provider

The `app_provider` is a singleton that connects to platform services:

```typescript
import { app_provider } from '@firebrandanalytics/ff-agent-sdk';
```

In production, this connects via gRPC to:
- Context Service (entity persistence)
- Broker Service (LLM interactions)
- Code Sandbox (secure code execution)
- Other platform services

For testing, you can create mock providers.

### Inherited Properties and Methods

When you extend `FFAgentBundle`, you get access to these members:

```typescript
// Properties
this.entity_factory: EntityFactory    // Create and retrieve entities
this.entity_client: EntityClient      // Low-level entity operations
this.broker: BrokerClient             // Direct broker access (rare)

// Methods
this.get_app_id(): string            // Get the bundle's unique ID
this.init(): Promise<void>           // Override for initialization
```

---

## Initialization and Lifecycle

### The `init()` Method

The `init()` method is called once when the bundle starts. Use it to:
- Create bootstrap entities (root nodes in your entity graph)
- Initialize connections to external systems
- Set up caches or in-memory state
- Validate configuration

```typescript
export class MyAgentBundle extends FFAgentBundle<MyETH> {
  private rootEntityId?: string;

  override async init() {
    // ALWAYS call super.init() first
    await super.init();

    logger.info('MyAgentBundle initializing...');

    // Create or retrieve bootstrap entities
    await this.ensure_root_entities();

    // Initialize external connections
    await this.connect_external_services();

    logger.info('MyAgentBundle ready!');
  }

  private async ensure_root_entities() {
    // Check if root entity exists (idempotent)
    const existing = await this.entity_client.get_node_by_name('root-collection');

    if (existing) {
      this.rootEntityId = existing.id;
      logger.info('Root entity already exists:', this.rootEntityId);
      return;
    }

    // Create root entity - note: create_entity_node returns the entity instance
    const rootEntity = await this.entity_factory.create_entity_node<'RootCollection'>({
      app_id: this.get_app_id(),
      name: 'root-collection',
      specific_type_name: 'RootCollection',
      general_type_name: 'Collection',
      status: 'Active',
    });

    // Access the ID through get_dto() since id is a protected property
    const rootDto = await rootEntity.get_dto();
    this.rootEntityId = rootDto.id;
    logger.info('Created root entity:', this.rootEntityId);
  }

  private async connect_external_services() {
    // Example: Initialize a database connection pool
    // Note: For security, use environment variables or KeyVault for credentials
    try {
      // await this.dbClient.connect();
      logger.info('External services connected');
    } catch (error) {
      logger.error('Failed to connect to external services:', error);
      throw error;  // Fail fast if critical services are unavailable
    }
  }
}
```

### Initialization Best Practices

1. **Always call `super.init()` first**: The parent class sets up critical platform connections

2. **Be idempotent**: Check if entities already exist before creating them
   ```typescript
   const existing = await this.entity_client.get_node_by_name('my-entity');
   if (existing) return;
   ```

3. **Fail fast for critical dependencies**: If initialization fails, throw an error to prevent the bundle from starting in a broken state

4. **Log initialization steps**: Use structured logging for debugging

5. **Avoid long-running operations**: `init()` blocks the bundle from accepting requests. Defer non-critical work to background jobs

6. **Don't create too many entities**: Bootstrap entities should be root nodes only. Defer creating child entities to runtime

### Lifecycle Hooks

In addition to `init()`, you can override these methods:

```typescript
export class MyAgentBundle extends FFAgentBundle<MyETH> {
  override async init() {
    // Called once on startup
    await super.init();
  }

  override async shutdown() {
    // Called on graceful shutdown (SIGTERM/SIGINT)
    // Clean up resources, close connections
    await super.shutdown();
  }
}
```

---

## API Endpoints with @ApiEndpoint

The `@ApiEndpoint` decorator enables you to expose custom HTTP endpoints without requiring an entity ID.

### Basic Syntax

```typescript
import { ApiEndpoint } from '@firebrandanalytics/ff-agent-sdk';

@ApiEndpoint({ method: 'POST', route: 'my-endpoint' })
async myEndpoint(body: any = {}): Promise<any> {
  // Implementation
  return { success: true };
}
```

### Decorator Configuration

```typescript
@ApiEndpoint({
  method: 'GET' | 'POST',           // HTTP method (default: 'GET')
  route: string,                     // URL path (default: method name)

  // Response type options
  responseType: 'json' | 'binary' | 'iterator',  // (default: 'json')
  contentType: string,               // MIME type for binary (default: 'application/octet-stream')
  filename: string,                  // Triggers file download with this name

  // File upload option
  acceptsBlobs: boolean,             // Enable multipart file uploads (default: false)
})
```

**Basic Examples:**
- `{ method: 'POST', route: 'analyze' }` → `POST /api/analyze`
- `{ method: 'GET', route: 'status' }` → `GET /api/status`

**Advanced Examples:**
- `{ responseType: 'binary', contentType: 'application/pdf', filename: 'report.pdf' }` → File download
- `{ responseType: 'iterator' }` → Streaming response
- `{ method: 'POST', acceptsBlobs: true }` → File upload endpoint

### Method Signatures

#### POST/PUT/PATCH Endpoints

Methods receive the request body as the first parameter:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}): Promise<any> {
  const { title, content, author } = body;
  
  // Validation
  if (!title || !content) {
    throw new Error('title and content are required');
  }

  // Process...
  return { id: '...', message: 'Created' };
}
```

**Type Safety Option:**

Define an interface for better type checking:

```typescript
interface CreateArticleRequest {
  title: string;
  content: string;
  author?: string;
}

@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: CreateArticleRequest = {} as CreateArticleRequest): Promise<any> {
  const { title, content, author } = body;
  // TypeScript now knows the shape of body
}
```

#### GET Endpoints

Methods receive query parameters as the first parameter:

```typescript
@ApiEndpoint({ method: 'GET', route: 'search-articles' })
async searchArticles(query: any = {}): Promise<any> {
  const { keyword, limit = 10, offset = 0 } = query;
  
  // Query parameters are always strings, so parse as needed
  const limitNum = parseInt(limit as string, 10);
  const offsetNum = parseInt(offset as string, 10);

  // Search implementation...
  return { results: [...], total: 42 };
}
```

**Note:** Query parameters are always strings or arrays of strings. Parse and validate them as needed.

### Return Values

Return any JSON-serializable value:

```typescript
// Simple object
return { success: true, data: {...} };

// Array
return [{ id: 1 }, { id: 2 }];

// Primitive
return "OK";

// Null
return null;
```

The framework automatically:
- Serializes the return value to JSON
- Sets the `Content-Type: application/json` header
- Sends a 200 OK status code

### Error Handling

Throw errors directly—the framework catches them and returns appropriate error responses:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}): Promise<any> {
  if (!body.title) {
    throw new Error('title is required');  // Returns 400 Bad Request
  }

  try {
    // ... create article ...
  } catch (error) {
    logger.error('Failed to create article:', error);
    throw new Error(`Article creation failed: ${error.message}`);
  }
}
```

**Error Response Format:**
```json
{
  "error": "title is required",
  "status": 400
}
```

### Advanced Patterns

#### Accessing Request Context

The method receives the full request context as a second parameter (rarely needed):

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}, context?: any): Promise<any> {
  // context contains headers, request metadata, etc.
  const userId = context?.headers?.['x-user-id'];
  
  // Use in processing...
}
```

#### Paginated Responses

For large responses, consider pagination:

```typescript
@ApiEndpoint({ method: 'GET', route: 'list-articles' })
async listArticles(query: any = {}): Promise<any> {
  const { page = 1, pageSize = 20 } = query;
  const pageNum = parseInt(page as string, 10);
  const pageSizeNum = parseInt(pageSize as string, 10);

  const offset = (pageNum - 1) * pageSizeNum;
  const result = await this.entity_client.search_nodes(
    { specific_type_name: 'Article' },
    { created: 'desc' },
    { limit: pageSizeNum, offset }
  );

  return {
    data: result.result,
    pagination: {
      page: pageNum,
      pageSize: pageSizeNum,
      total: result.total,
      hasMore: offset + result.result.length < result.total,
    },
  };
}
```

#### Async Operations

For long-running operations, return immediately and let clients poll for status:

```typescript
@ApiEndpoint({ method: 'POST', route: 'start-analysis' })
async startAnalysis(body: StartAnalysisRequest): Promise<StartAnalysisResponse> {
  // Create a workflow entity - returns the entity instance, not a DTO
  // Use both type parameters: entity type name and data type
  const workflow = await this.entity_factory.create_entity_node<
    'AnalysisWorkflow',
    AnalysisWorkflowData
  >({
    app_id: this.get_app_id(),
    name: `analysis-${Date.now()}`,
    specific_type_name: 'AnalysisWorkflow',
    general_type_name: 'Workflow',
    status: 'Running',
    data: body,
  });

  // Access the ID through get_dto() since id is a protected property
  const workflowDto = await workflow.get_dto();

  // Start processing in background
  this.process_workflow_async(workflowDto.id).catch(error => {
    logger.error(`Workflow ${workflowDto.id} failed:`, error);
  });

  // Return immediately
  return {
    workflowId: workflowDto.id,
    status: 'Running',
    statusUrl: `/workflow-status?workflowId=${workflowDto.id}`,
  };
}

@ApiEndpoint({ method: 'GET', route: 'workflow-status' })
async getWorkflowStatus(query: any = {}): Promise<any> {
  const { workflowId } = query;
  const workflow = await this.entity_factory.get_entity(workflowId);
  const dto = await workflow.get_dto();
  
  return {
    workflowId: dto.id,
    status: dto.status,
    result: dto.data.result || null,
  };
}

private async process_workflow_async(workflowId: string) {
  const workflow = await this.entity_factory.get_entity(workflowId);
  await workflow.run({});
}
```

#### Binary Responses (File Downloads)

Return binary data (files, images, PDFs) using `responseType: 'binary'`:

```typescript
@ApiEndpoint({
  method: 'GET',
  route: 'download-report',
  responseType: 'binary',
  contentType: 'application/pdf',
  filename: 'report.pdf'
})
async downloadReport(query: any = {}): Promise<Buffer> {
  const { reportId } = query;

  // Generate or retrieve PDF
  const pdfBuffer = await this.generatePdfReport(reportId);

  return pdfBuffer;  // Must return Buffer
}
```

**Configuration Options for Binary Responses:**

| Option | Description | Default |
|--------|-------------|---------|
| `responseType` | Set to `'binary'` for binary output | `'json'` |
| `contentType` | MIME type for the response | `'application/octet-stream'` |
| `filename` | Adds `Content-Disposition: attachment; filename="..."` header | (none) |

**Common Content Types:**

```typescript
// PDF documents
@ApiEndpoint({ responseType: 'binary', contentType: 'application/pdf', filename: 'document.pdf' })

// Images
@ApiEndpoint({ responseType: 'binary', contentType: 'image/png', filename: 'chart.png' })
@ApiEndpoint({ responseType: 'binary', contentType: 'image/jpeg', filename: 'photo.jpg' })

// Excel files
@ApiEndpoint({ responseType: 'binary', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'data.xlsx' })

// CSV files
@ApiEndpoint({ responseType: 'binary', contentType: 'text/csv', filename: 'export.csv' })

// ZIP archives
@ApiEndpoint({ responseType: 'binary', contentType: 'application/zip', filename: 'archive.zip' })
```

**Dynamic Filename Example:**

```typescript
@ApiEndpoint({
  method: 'GET',
  route: 'export-data',
  responseType: 'binary',
  contentType: 'text/csv'
  // Note: filename not set here - set dynamically in response
})
async exportData(query: any = {}, context?: any): Promise<Buffer> {
  const { format = 'csv' } = query;
  const timestamp = new Date().toISOString().split('T')[0];

  // Generate CSV
  const csvContent = await this.generateExport();

  // For dynamic filenames, set header manually via context
  // (Implementation depends on transport layer)
  return Buffer.from(csvContent, 'utf-8');
}
```

#### Iterator Responses (Real-Time Streaming)

Return real-time progress updates using `responseType: 'iterator'`:

```typescript
@ApiEndpoint({
  method: 'POST',
  route: 'stream-analysis',
  responseType: 'iterator'
})
async *streamAnalysis(body: { topic: string }): AsyncIterableIterator<AnalysisUpdate> {
  // Yield progress updates as work happens
  yield { status: 'started', message: 'Beginning analysis', progress: 0 };

  // Step 1
  const step1Result = await this.analyzeStep1(body.topic);
  yield { status: 'progress', message: 'Initial analysis complete', progress: 0.33, data: step1Result };

  // Step 2
  const step2Result = await this.analyzeStep2(step1Result);
  yield { status: 'progress', message: 'Deep analysis complete', progress: 0.66, data: step2Result };

  // Step 3 - Final
  const finalResult = await this.synthesize(step1Result, step2Result);
  yield { status: 'completed', message: 'Analysis complete', progress: 1.0, data: finalResult };

  // Return value is also yielded as final item
  return { final: true, result: finalResult };
}
```

**Iterator Response Format:**

Each yielded value is sent to the client as a JSON object. The client receives a stream of newline-delimited JSON:

```json
{"status":"started","message":"Beginning analysis","progress":0}
{"status":"progress","message":"Initial analysis complete","progress":0.33,"data":{...}}
{"status":"progress","message":"Deep analysis complete","progress":0.66,"data":{...}}
{"status":"completed","message":"Analysis complete","progress":1.0,"data":{...}}
```

**Use Cases for Iterator Responses:**

- **Long-running AI operations** - Stream progress while LLM is working
- **Batch processing** - Update progress as items are processed
- **Search with incremental results** - Return results as they're found
- **Real-time data feeds** - Stream updates as events occur

**Client Consumption (JavaScript/TypeScript):**

```typescript
// Using fetch with ReadableStream
const response = await fetch('/api/stream-analysis', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topic: 'market trends' })
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;

  const lines = decoder.decode(value).split('\n').filter(Boolean);
  for (const line of lines) {
    const update = JSON.parse(line);
    console.log('Progress:', update.progress, update.message);

    // Update UI with progress
    progressBar.value = update.progress;
    statusText.textContent = update.message;
  }
}
```

#### File Uploads via API Endpoints

Accept binary file uploads using `acceptsBlobs: true`:

```typescript
@ApiEndpoint({
  method: 'POST',
  route: 'process-pdf',
  acceptsBlobs: true
})
async processPdf(
  pdfFile: Buffer,           // Automatically injected from upload
  metadata: { title: string } // Additional JSON data
): Promise<ProcessingResult> {
  // pdfFile is the uploaded binary content
  console.log(`Processing PDF: ${metadata.title}, size: ${pdfFile.length} bytes`);

  // Process the file
  const result = await this.extractTextFromPdf(pdfFile);

  return {
    success: true,
    title: metadata.title,
    pageCount: result.pageCount,
    extractedText: result.text
  };
}
```

**How It Works:**

1. Client sends multipart form data with files and JSON args
2. Server automatically parses uploaded files
3. `{ $blob: N }` placeholders in args are replaced with actual Buffer contents
4. Your method receives buffers directly

**Client Usage:**

```typescript
// Using FormData in browser
const formData = new FormData();
formData.append('files', pdfFile);  // File object
formData.append('args', JSON.stringify([
  { $blob: 0 },                      // Placeholder for first file
  { title: 'My Document' }           // Additional metadata
]));

const response = await fetch('/api/process-pdf', {
  method: 'POST',
  body: formData
});
```

**Using FF SDK Client:**

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const client = new RemoteAgentBundleClient('http://localhost:3000');

// Upload file via API endpoint
const result = await client.call_api_endpoint_with_blobs(
  'process-pdf',
  [
    { $blob: 0 },           // First file
    { title: 'My PDF' }     // Metadata
  ],
  [pdfBuffer]               // Array of Buffers
);
```

**Multiple File Uploads:**

```typescript
@ApiEndpoint({
  method: 'POST',
  route: 'process-batch',
  acceptsBlobs: true
})
async processBatch(
  file1: Buffer,
  file2: Buffer,
  metadata: { names: string[] }
): Promise<BatchResult> {
  // Process multiple files
  const results = await Promise.all([
    this.processFile(file1, metadata.names[0]),
    this.processFile(file2, metadata.names[1])
  ]);

  return { results };
}

// Client call
const result = await client.call_api_endpoint_with_blobs(
  'process-batch',
  [
    { $blob: 0 },                    // First file
    { $blob: 1 },                    // Second file
    { names: ['doc1.pdf', 'doc2.pdf'] }
  ],
  [buffer1, buffer2]
);
```

**Comparison: @ApiEndpoint vs Entity Methods for File Uploads:**

| Aspect | `@ApiEndpoint` with `acceptsBlobs` | Entity `invoke_with_blobs` |
|--------|-----------------------------------|----------------------------|
| Use Case | Stateless file processing | File storage with entity tracking |
| State | No automatic state | Files tracked in entity data |
| Storage | You manage storage | Working Memory integration |
| Best For | Transform & return, one-shot processing | Document management, file libraries |

See **[File Upload Patterns](../feature_guides/file-upload-patterns.md)** for comprehensive file handling with entity-based storage.

---

## Invocation Patterns

FireFoundry supports two primary patterns for invoking application logic: **ID-less invocation** via `@ApiEndpoint` and **entity-based invocation** via the standard `/invoke/{entityId}` endpoint.

### Pattern Comparison

| Aspect | @ApiEndpoint (ID-less) | Entity-Based Invocation |
|--------|------------------------|-------------------------|
| **URL Format** | `POST /my-custom-route` | `POST /invoke/{entityId}` |
| **When to Use** | Creating workflows, bulk ops, app-level queries | Processing a specific entity instance |
| **State Scope** | You manage state | Entity manages its own state |
| **Idempotency** | You implement it | Built-in via Runnable pattern |
| **Entity Context** | You fetch entities as needed | Invoked entity is the context |
| **Routing** | Custom routes per use case | Single endpoint for all entities |

### When to Use @ApiEndpoint

Use ID-less `@ApiEndpoint` for:

#### 1. Workflow Creation
When external clients don't yet have an entity ID:

```typescript
@ApiEndpoint({ method: 'POST', route: 'submit-report' })
async submitReport(body: SubmitReportRequest): Promise<SubmitReportResponse> {
  // create_entity_node returns the entity instance, not a DTO
  // Use both type parameters when the entity has custom data
  const report = await this.entity_factory.create_entity_node<'Report', ReportData>({
    app_id: this.get_app_id(),
    name: `report-${Date.now()}`,
    specific_type_name: 'Report',
    general_type_name: 'Document',
    status: 'Pending',
    data: body,
  });

  // Access id through get_dto() since it's a protected property
  const reportDto = await report.get_dto();
  return {
    reportId: reportDto.id,
    message: 'Report submitted',
  };
}
```

#### 2. Application-Level Operations
Health checks, statistics, configuration:

```typescript
@ApiEndpoint({ method: 'GET', route: 'health' })
async health(): Promise<any> {
  return {
    status: 'healthy',
    version: '1.0.0',
    uptime: process.uptime(),
  };
}

@ApiEndpoint({ method: 'GET', route: 'stats' })
async stats(): Promise<any> {
  const articleCount = await this.entity_client.count_nodes({
    specific_type_name: 'Article',
  });

  return {
    totalArticles: articleCount,
    timestamp: new Date().toISOString(),
  };
}
```

#### 3. Bulk Operations
Operating on multiple entities:

```typescript
@ApiEndpoint({ method: 'POST', route: 'bulk-analyze' })
async bulkAnalyze(body: any = {}): Promise<any> {
  const { articleIds } = body;
  
  const results = await Promise.all(
    articleIds.map(async (id: string) => {
      try {
        const article = await this.entity_factory.get_entity(id);
        const result = await article.run({});
        return { id, success: true, result };
      } catch (error) {
        return { id, success: false, error: error.message };
      }
    })
  );

  return { results };
}
```

#### 4. Search and List Operations
Querying across entities:

```typescript
@ApiEndpoint({ method: 'GET', route: 'search' })
async search(query: any = {}): Promise<any> {
  const { q, type, status } = query;
  
  const criteria: any = {};
  if (type) criteria.specific_type_name = type;
  if (status) criteria.status = status;
  if (q) {
    // Full-text search on data field (if supported by your storage)
    criteria.data_contains = q;
  }

  const result = await this.entity_client.search_nodes(
    criteria,
    { created: 'desc' }
  );

  return { results: result.result, total: result.total };
}
```

### When to Use Entity-Based Invocation

Use the standard `/invoke/{entityId}` endpoint for:

#### 1. Processing Specific Entities
When you have an entity ID and want to execute its logic:

```http
POST /invoke/abc-123-def-456
Content-Type: application/json

{
  "input": "additional context for this run"
}
```

The framework:
1. Deserializes the entity from the database
2. Calls `entity.run(args)` with the request body
3. Returns the result

#### 2. Resumable Operations
Leveraging the Runnable pattern for idempotency:

```typescript
// Entity implementation
export class AnalysisEntity extends FFBaseEntity {
  async run(args: any): Promise<any> {
    // If this entity has already completed, return cached result
    // If in progress, resume from last checkpoint
    // Implementation details in the Runnable pattern
  }
}
```

Clients can safely retry the same invocation:
```http
POST /invoke/abc-123-def-456
```

If the entity already completed, it returns the cached result.

#### 3. Entity-Scoped Operations
When the operation naturally belongs to a specific entity:

```typescript
export class ArticleEntity extends FFBaseEntity {
  async run(args: any): Promise<any> {
    // This entity knows its article text, relationships, history
    const dto = await this.get_dto();
    const articleText = dto.data.text;
    
    // Perform analysis using entity context
    const analysis = await this.analyze_impact(articleText);
    
    // Update entity state
    await this.update_data({ analysis });
    
    return analysis;
  }
}
```

### Bridging the Patterns

A common pattern is to use both approaches together:

```typescript
// Use @ApiEndpoint to create the entity
@ApiEndpoint({ method: 'POST', route: 'submit-article' })
async submitArticle(body: any = {}): Promise<any> {
  const articleDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `article-${Date.now()}`,
    specific_type_name: 'Article',
    general_type_name: 'Document',
    status: 'Pending',
    data: body,
  });

  return {
    articleId: articleDto.id,
    invokeUrl: `/invoke/${articleDto.id}`,  // Client can invoke the entity
    statusUrl: `/article-status?id=${articleDto.id}`,
  };
}

// Client then invokes the entity directly
// POST /invoke/{articleId}
```

This gives clients flexibility: they can use your custom endpoints for convenience, or invoke entities directly for standardized access.

---

## Consuming Agent Bundles

External systems consume agent bundles in different ways depending on the deployment environment. Understanding these patterns is crucial for both development and production deployment.

### Deployment and Access Patterns

There are three primary patterns for deploying and accessing agent bundles:

#### Pattern 1: Production via Kong Gateway (Recommended)

**Environment:** Production, Staging, Shared Development

```
┌─────────────┐          ┌──────────────┐          ┌───────────────┐
│   Client    │  HTTPS   │     Kong     │  HTTP    │ Agent Bundle  │
│  (FF SDK)   │─────────▶│   Gateway    │─────────▶│   Service     │
└─────────────┘          └──────────────┘          └───────────────┘
                               │                           │
                               │                           │ gRPC
                               │                           ▼
                               │                    ┌───────────────┐
                               │                    │   Platform    │
                               └───────────────────▶│   Services    │
                                      Admin/         │ (Context,     │
                                      Monitoring     │  Broker, etc) │
                                                     └───────────────┘
```

**Characteristics:**
- Kong provides routing, authentication, rate limiting, SSL/TLS termination
- Agent bundles are accessed through Kong's API management layer
- **FF SDK works in this pattern** - it expects Kong routing
- Best practice for all non-local deployments

**Client Configuration:**
```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const client = new RemoteAgentBundleClient(
  'https://api.yourcompany.com/news-analysis',  // Kong gateway URL
  {
    api_key: process.env.API_KEY,  // Kong validates this
    timeout: 60000,
  }
);
```

**When to Use:**
- ✅ Production deployments
- ✅ Staging environments
- ✅ Shared development environments
- ✅ Any multi-user environment
- ✅ When you need authentication, rate limiting, observability

#### Pattern 2: Local Development with Full Port Forwarding

**Environment:** Local development without Kubernetes

```
┌─────────────┐          ┌───────────────┐
│   Client    │  HTTP    │ Agent Bundle  │
│  (Direct)   │─────────▶│   (Local)     │
└─────────────┘          └───────────────┘
                                 │
                                 │ Port Forward
                                 ▼
                          ┌───────────────┐
                          │   Platform    │
                          │   Services    │
                          │ (Port Fwd)    │
                          └───────────────┘
```

**Characteristics:**
- Agent bundle runs locally (not in Kubernetes)
- Platform services accessed via port forwarding
- **FF SDK does NOT work** - use direct HTTP/fetch
- Suitable for debugging bundle logic in isolation

**Setup:**
```bash
# Port forward platform services
kubectl port-forward svc/context-service 50051:50051
kubectl port-forward svc/broker-service 50052:50052

# Run agent bundle locally
cd packages/agent-bundle
npm run dev  # Starts on port 3000
```

**Client Code (Direct HTTP):**
```typescript
// Use fetch or axios for direct HTTP calls
async function analyzeArticle(articleText: string) {
  const response = await fetch('http://localhost:3000/analyze-article', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}
```

**When to Use:**
- ✅ Local bundle development
- ✅ Debugging bundle-specific issues
- ✅ Rapid iteration without Kubernetes overhead
- ✅ Running without Docker/Kubernetes

**Limitations:**
- ❌ FF SDK doesn't work
- ❌ Requires manual port forwarding of all platform services
- ❌ No Kong features (auth, rate limiting, routing)
- ❌ Not representative of production environment

#### Pattern 3: Minikube Deployment with Bundle Port Forward

**Environment:** Local Kubernetes testing

```
┌─────────────┐          ┌───────────────┐
│   Client    │  HTTP    │ Agent Bundle  │
│  (Direct)   │────┬────▶│   Service     │
└─────────────┘    │     └───────────────┘
                   │            │
            Port Forward        │ gRPC (internal)
                   │            ▼
                   │     ┌───────────────┐
                   │     │   Platform    │
                   │     │   Services    │
                   │     │  (in cluster) │
                   │     └───────────────┘
                   │            ▲
                   │            │
                   └────────────┘ (Optional)
                         Direct access for
                         debugging
```

**Characteristics:**
- Agent bundle deployed to Minikube
- Platform services running in cluster (no port forwarding needed)
- Agent bundle accessed via port forwarding
- **FF SDK does NOT work** - use direct HTTP
- Good middle ground for integration testing

**Setup:**
```bash
# Deploy agent bundle to Minikube
kubectl apply -f agent-bundle-deployment.yaml

# Port forward just the agent bundle
kubectl port-forward svc/news-analysis 3000:3000

# Access at http://localhost:3000
```

**Client Code (Same as Pattern 2):**
```typescript
// Direct HTTP calls to localhost:3000
const response = await fetch('http://localhost:3000/analyze-article', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ articleText }),
});
```

**When to Use:**
- ✅ Integration testing with full platform
- ✅ Testing before deploying to shared environments
- ✅ Verifying bundle works in Kubernetes
- ✅ Testing cross-bundle communication

**Limitations:**
- ❌ FF SDK doesn't work
- ❌ Still not fully representative (no Kong)
- ❌ Requires Minikube setup

### Primary Consumption Method: FF SDK

**For all Kong-fronted deployments (Pattern 1)**, use the FireFoundry SDK:

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

// Create client
const client = new RemoteAgentBundleClient(
  process.env.AGENT_BUNDLE_URL!,  // Kong gateway URL
  {
    api_key: process.env.API_KEY,
    timeout: 60000,
  }
);

// Call custom @ApiEndpoint routes
const result = await client.call_api_endpoint('analyze-article', {
  method: 'POST',
  body: {
    articleText: 'Breaking news...',
  },
});

// GET endpoints with query parameters
const article = await client.call_api_endpoint('get-article', {
  query: { articleId: 'abc-123' },
});

// Entity-based invocation
const entityResult = await client.invoke_entity_method(
  articleEntityId,
  'run',
  { input: 'data' }
);

// Streaming for long-running operations
const iterator = await client.start_iterator(
  workflowEntityId,
  'process',
  args
);

for await (const progress of iterator) {
  console.log('Progress:', progress);
}
```

**FF SDK Features:**
- ✅ **Type safety** with TypeScript generics
- ✅ **Authentication** handled automatically
- ✅ **Retry logic** built-in
- ✅ **Error handling** with `FFError` wrapper
- ✅ **Streaming support** with async iterators
- ✅ **Binary uploads/downloads**
- ✅ **WebSocket support** for real-time updates
- ✅ **Timeout management**
- ✅ **Request correlation** for tracing

**Installation:**
```bash
npm install @firebrandanalytics/ff-sdk
```

**Full Documentation:**
- [FF SDK Tutorial](../../ff_sdk/ff_sdk_tutorial.md)
- [News Analysis Consumer Example](../../ff_sdk/news_analysis_consumer.md)
- [Express Middleware with FF SDK](../../ff_sdk/express_middleware_tutorial.md)

### Alternative: Direct HTTP (Debugging Only)

For **Patterns 2 and 3** (local development without Kong), you can use direct HTTP calls. However, there are important caveats:

**Response Wrapper**: The SDK wraps all successful `@ApiEndpoint` responses in an envelope:
```json
{ "success": true, "result": { /* your data */ } }
```

If you use raw HTTP calls, you must unwrap this envelope. The `RemoteAgentBundleClient` handles this automatically, which is why it's strongly recommended.

Direct HTTP example:

```typescript
// Helper function for direct HTTP calls
async function callBundleEndpoint<T>(
  route: string,
  options: {
    method?: string;
    body?: any;
    query?: Record<string, string>;
  } = {}
): Promise<T> {
  const baseUrl = 'http://localhost:3000';
  const method = options.method || 'GET';
  
  // Build URL with query params
  let url = `${baseUrl}/${route}`;
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  // Make request
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Handle errors
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

// Usage
const result = await callBundleEndpoint('analyze-article', {
  method: 'POST',
  body: { articleText: 'Breaking news...' },
});

const article = await callBundleEndpoint('get-article', {
  query: { articleId: 'abc-123' },
});
```

**⚠️ Important Limitations:**

Direct HTTP access should **ONLY** be used for:
- Local development and debugging
- Testing without Kong infrastructure
- Quick prototyping

**Do NOT use direct HTTP for:**
- ❌ Production deployments
- ❌ Shared environments
- ❌ Applications requiring authentication
- ❌ Long-running operations (no retry)
- ❌ Systems requiring observability

**Why FF SDK is Better:**

| Feature | FF SDK | Direct HTTP |
|---------|--------|-------------|
| Authentication | ✅ Built-in | ❌ Manual |
| Retry Logic | ✅ Automatic | ❌ Manual |
| Type Safety | ✅ Yes | ❌ No |
| Error Handling | ✅ Structured (`FFError`) | ❌ Manual |
| Streaming | ✅ Async iterators | ❌ Complex |
| Binary Upload | ✅ Simple API | ❌ Manual multipart |
| Observability | ✅ Correlation IDs | ❌ Manual |
| Documentation | ✅ Comprehensive | ❌ DIY |

### Development Workflow Recommendations

```
┌─────────────────────────────────────────────────────────────┐
│              Recommended Development Flow                    │
└─────────────────────────────────────────────────────────────┘

1. Initial Development (Pattern 2)
   ├─→ Run bundle locally
   ├─→ Port forward platform services
   ├─→ Test with curl/direct HTTP
   ├─→ Rapid iteration
   └─→ Debug bundle-specific logic

2. Integration Testing (Pattern 3)
   ├─→ Deploy to Minikube
   ├─→ Port forward bundle only
   ├─→ Test with other services
   ├─→ Verify Kubernetes configuration
   └─→ Test cross-bundle communication

3. Pre-Production (Pattern 1 - Staging)
   ├─→ Deploy to staging with Kong
   ├─→ Switch to FF SDK
   ├─→ Test authentication/authorization
   ├─→ Test rate limiting
   ├─→ Performance testing
   └─→ End-to-end testing

4. Production (Pattern 1)
   ├─→ Deploy through CI/CD
   ├─→ Consumers use FF SDK exclusively
   ├─→ Full observability enabled
   ├─→ Kong manages all traffic
   └─→ Monitor and scale
```

### Environment Variables for Multi-Environment Support

Support all three patterns with environment-based configuration:

```typescript
// config.ts
export interface BundleConfig {
  url: string;
  apiKey?: string;
  useFFSDK: boolean;
}

export function loadConfig(): BundleConfig {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return {
        url: process.env.AGENT_BUNDLE_URL!,
        apiKey: process.env.API_KEY!,
        useFFSDK: true,  // Always use FF SDK in production
      };
    
    case 'staging':
      return {
        url: process.env.AGENT_BUNDLE_URL || 'https://staging-api.example.com',
        apiKey: process.env.API_KEY,
        useFFSDK: true,
      };
    
    case 'development':
    default:
      return {
        url: process.env.AGENT_BUNDLE_URL || 'http://localhost:3000',
        apiKey: undefined,
        useFFSDK: false,  // Direct HTTP for local dev
      };
  }
}

// client.ts
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';
import { loadConfig } from './config.js';

const config = loadConfig();

// Create appropriate client
const client = config.useFFSDK
  ? new RemoteAgentBundleClient(config.url, {
      api_key: config.apiKey,
      timeout: 60000,
    })
  : null;  // Use direct HTTP helper functions

// Wrapper function that works in all environments
export async function analyzeArticle(articleText: string) {
  if (client) {
    // Use FF SDK
    return await client.call_api_endpoint('analyze-article', {
      method: 'POST',
      body: { articleText },
    });
  } else {
    // Use direct HTTP
    return await callBundleEndpoint('analyze-article', {
      method: 'POST',
      body: { articleText },
    });
  }
}
```

### Testing in Different Patterns

```typescript
// test-helper.ts
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

export async function testBundleEndpoint() {
  const pattern = process.env.TEST_PATTERN || 'direct';
  
  if (pattern === 'direct') {
    // Pattern 2 or 3: Direct HTTP
    const response = await fetch('http://localhost:3000/health');
    console.log('Health check (direct):', response.status);
  } else {
    // Pattern 1: FF SDK
    const client = new RemoteAgentBundleClient(
      process.env.AGENT_BUNDLE_URL!,
      { api_key: process.env.API_KEY }
    );
    
    const isHealthy = await client.health_check();
    console.log('Health check (FF SDK):', isHealthy);
  }
}
```

---

## Platform Service Integration

Within your agent bundle, you have full access to platform services via inherited properties.

### Entity Factory

The `entity_factory` creates and retrieves entity instances:

```typescript
// Create a new entity
const dto = await this.entity_factory.create_entity_node({
  app_id: this.get_app_id(),
  name: 'my-entity',
  specific_type_name: 'MyEntityType',
  general_type_name: 'Category',
  status: 'Pending',
  data: { key: 'value' },
});

// Get an existing entity (returns typed instance)
const entity = await this.entity_factory.get_entity(dto.id);

// Call entity methods
const result = await entity.run({ input: 'data' });

// Access entity relationships
const children = await entity.getChildren('Contains');
```

**Key Methods:**
- `create_entity_node(spec)`: Create a new entity
- `get_entity(id)`: Retrieve an entity by ID (returns class instance)
- `get_entities(ids)`: Batch retrieve entities

### Entity Client

The `entity_client` provides low-level entity operations:

```typescript
// Search for entities
const searchResult = await this.entity_client.search_nodes(
  { specific_type_name: 'Article', status: 'Completed' },
  { created: 'desc' },
  { limit: 10, offset: 0 }
);

// Get a single entity by name
const entity = await this.entity_client.get_node_by_name('my-named-entity');

// Count entities
const count = await this.entity_client.count_nodes({
  specific_type_name: 'Article',
});

// Traverse edges
const edges = await this.entity_client.get_node_edges_from(
  entityId,
  ['Contains', 'References']
);

// Create edges manually
await this.entity_client.create_edge({
  from_node_id: parentId,
  to_node_id: childId,
  edge_type: 'Contains',
  data: { position: 0 },
});

// Update entity data
await this.entity_client.update_node_data(entityId, { newKey: 'newValue' });

// Delete entities
await this.entity_client.delete_node(entityId);
```

**Key Methods:**
- `search_nodes(criteria, sort, pagination)`: Query entities
- `get_node_by_name(name)`: Retrieve by unique name
- `count_nodes(criteria)`: Count matching entities
- `get_node_edges_from/to(entityId, edgeTypes)`: Traverse relationships
- `create_edge(spec)`: Create relationships
- `update_node_data(id, data)`: Update entity data
- `delete_node(id)`: Delete entities

### Broker Client

Direct access to the Broker Service (rarely needed—use Bots instead):

```typescript
// Usually you use bots, but direct broker access is available:
const response = await this.broker.call({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

**Best Practice:** Use Bots for LLM interactions. They provide retries, error handling, structured output, and better observability.

### Application Context

Get the bundle's unique application ID:

```typescript
const appId = this.get_app_id();

// Use when creating entities
const dto = await this.entity_factory.create_entity_node({
  app_id: appId,  // Required for entity creation
  // ...
});
```

---

## Error Handling

### Exception Handling in Endpoints

Throw errors from `@ApiEndpoint` methods—the framework handles them gracefully:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}): Promise<any> {
  // Validation errors
  if (!body.title) {
    throw new Error('title is required');
  }

  try {
    const dto = await this.entity_factory.create_entity_node({
      // ...
    });
    return { id: dto.id };
  } catch (error) {
    // Log for observability
    logger.error('Failed to create article:', error);
    
    // Rethrow with context
    throw new Error(`Article creation failed: ${error.message}`);
  }
}
```

### Error Response Format

The framework returns errors in this format:

```json
{
  "error": "Error message",
  "status": 400
}
```

Status codes:
- **400**: Validation or client errors
- **500**: Server errors
- **404**: Entity not found

### Validation Patterns

Implement validation at the beginning of endpoint methods:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze' })
async analyze(body: any = {}): Promise<any> {
  // Validate required fields
  const requiredFields = ['articleText', 'analysisType'];
  for (const field of requiredFields) {
    if (!body[field]) {
      throw new Error(`${field} is required`);
    }
  }

  // Validate enums
  const validTypes = ['quick', 'detailed', 'comprehensive'];
  if (!validTypes.includes(body.analysisType)) {
    throw new Error(`analysisType must be one of: ${validTypes.join(', ')}`);
  }

  // Validate ranges
  if (body.confidence && (body.confidence < 0 || body.confidence > 1)) {
    throw new Error('confidence must be between 0 and 1');
  }

  // Proceed with validated input
  // ...
}
```

### Using Zod for Validation

For complex validation, use Zod schemas:

```typescript
import { z } from 'zod';

const CreateArticleSchema = z.object({
  title: z.string().min(1, 'title is required'),
  content: z.string().min(10, 'content must be at least 10 characters'),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}): Promise<any> {
  // Validate with Zod
  const validationResult = CreateArticleSchema.safeParse(body);
  
  if (!validationResult.success) {
    const errors = validationResult.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Validation failed: ${errors}`);
  }

  const validatedData = validationResult.data;
  // Now use validatedData with type safety
}
```

### Handling Async Errors

When starting background operations, catch errors to prevent unhandled rejections:

```typescript
@ApiEndpoint({ method: 'POST', route: 'start-workflow' })
async startWorkflow(body: any = {}): Promise<any> {
  const workflowDto = await this.entity_factory.create_entity_node({
    // ...
  });

  // Start async processing with error handling
  this.process_workflow(workflowDto.id).catch(error => {
    logger.error(`Workflow ${workflowDto.id} failed:`, error);
    
    // Update entity status to reflect error
    this.entity_client.update_node_data(workflowDto.id, {
      status: 'Failed',
      error: error.message,
    }).catch(updateError => {
      logger.error('Failed to update workflow status:', updateError);
    });
  });

  return { workflowId: workflowDto.id };
}
```

### Structured Error Responses

Return structured error information for better client handling:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze' })
async analyze(body: any = {}): Promise<any> {
  try {
    // ... process ...
    return { success: true, data: result };
  } catch (error) {
    logger.error('Analysis failed:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        type: error.constructor.name,
        recoverable: this.is_recoverable_error(error),
      },
    };
  }
}

private is_recoverable_error(error: any): boolean {
  // Determine if client should retry
  return error.message.includes('timeout') || 
         error.message.includes('rate limit');
}
```

---

## Advanced Patterns

### Pattern: Entity Factories in Bundles

Create helper methods for common entity creation patterns:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  // Helper to create analysis workflow with standard structure
  async create_analysis_workflow(
    articleText: string,
    options: { priority?: string; analysisType?: string } = {}
  ): Promise<{ requestId: string; workflowId: string }> {
    // Create request entity
    const requestDto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `request-${Date.now()}`,
      specific_type_name: 'AnalysisRequest',
      general_type_name: 'Request',
      status: 'Pending',
      data: { articleText, ...options },
    });

    // Create and connect workflow
    const request = await this.entity_factory.get_entity(requestDto.id);
    const workflow = await request.appendConnection(
      'TriggersRun',
      'AnalysisWorkflow',
      `workflow-${requestDto.id}`,
      { articleText, analysisType: options.analysisType || 'standard' }
    );

    const workflowDto = await workflow.get_dto();

    return {
      requestId: requestDto.id,
      workflowId: workflowDto.id,
    };
  }

  @ApiEndpoint({ method: 'POST', route: 'analyze' })
  async analyze(body: any = {}): Promise<any> {
    const { articleText, priority, analysisType } = body;
    
    // Use the factory helper
    const { requestId, workflowId } = await this.create_analysis_workflow(
      articleText,
      { priority, analysisType }
    );

    // Start workflow
    const workflow = await this.entity_factory.get_entity(workflowId);
    await workflow.start();

    return { requestId, workflowId };
  }
}
```

### Pattern: Caching in Bundle State

Cache frequently accessed entities in bundle instance variables:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  private rootCollectionId?: string;
  private configCache: Map<string, any> = new Map();

  override async init() {
    await super.init();
    
    // Cache root collection ID
    const collection = await this.entity_client.get_node_by_name('root-collection');
    this.rootCollectionId = collection?.id;

    // Load configuration
    await this.load_config();
  }

  private async load_config() {
    const configEntity = await this.entity_client.get_node_by_name('app-config');
    if (configEntity) {
      this.configCache.set('app-config', configEntity.data);
    }
  }

  @ApiEndpoint({ method: 'POST', route: 'create-article' })
  async createArticle(body: any = {}): Promise<any> {
    const articleDto = await this.entity_factory.create_entity_node({
      // ...
    });

    // Use cached root collection ID
    if (this.rootCollectionId) {
      await this.entity_client.create_edge({
        from_node_id: this.rootCollectionId,
        to_node_id: articleDto.id,
        edge_type: 'Contains',
      });
    }

    return { id: articleDto.id };
  }
}
```

**Caching Considerations:**
- Only cache data that rarely changes
- Be aware that bundles can restart (cache is in-memory only)
- For distributed deployments, multiple bundle instances don't share cache
- Consider cache invalidation strategies

### Pattern: Background Job Scheduling

Schedule periodic tasks in `init()`:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  private cleanupInterval?: NodeJS.Timeout;

  override async init() {
    await super.init();
    
    // Start periodic cleanup
    this.cleanupInterval = setInterval(
      () => this.cleanup_old_entities(),
      60 * 60 * 1000  // Every hour
    );
  }

  override async shutdown() {
    // Clear interval on shutdown
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    await super.shutdown();
  }

  private async cleanup_old_entities() {
    try {
      // Find entities older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const oldEntities = await this.entity_client.search_nodes(
        {
          specific_type_name: 'TemporaryEntity',
          status: 'Completed',
          created_before: thirtyDaysAgo.toISOString(),
        },
        { created: 'asc' },
        { limit: 100 }
      );

      // Delete in batches
      for (const entity of oldEntities.result) {
        await this.entity_client.delete_node(entity.id);
        logger.info(`Cleaned up entity: ${entity.id}`);
      }
    } catch (error) {
      logger.error('Cleanup job failed:', error);
    }
  }
}
```

### Pattern: Request Deduplication

Prevent duplicate requests using entity names as deduplication keys:

```typescript
@ApiEndpoint({ method: 'POST', route: 'submit-report' })
async submitReport(body: any = {}): Promise<any> {
  const { reportId, data } = body;
  
  // Use reportId as the entity name for deduplication
  const entityName = `report-${reportId}`;
  
  // Check if already exists
  const existing = await this.entity_client.get_node_by_name(entityName);
  if (existing) {
    logger.info(`Report ${reportId} already exists, returning existing`);
    return {
      reportId: existing.id,
      message: 'Report already submitted',
      duplicate: true,
    };
  }

  // Create new report
  const reportDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: entityName,  // Unique name prevents duplicates
    specific_type_name: 'Report',
    general_type_name: 'Document',
    status: 'Pending',
    data,
  });

  return {
    reportId: reportDto.id,
    message: 'Report submitted',
    duplicate: false,
  };
}
```

### Pattern: Multi-Step Workflows

Coordinate multi-step workflows from the bundle:

```typescript
@ApiEndpoint({ method: 'POST', route: 'complex-workflow' })
async complexWorkflow(body: any = {}): Promise<any> {
  const { input } = body;

  // Step 1: Create request
  const requestDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `complex-request-${Date.now()}`,
    specific_type_name: 'ComplexRequest',
    general_type_name: 'Request',
    status: 'Running',
    data: { input },
  });

  // Step 2: Create workflow
  const request = await this.entity_factory.get_entity(requestDto.id);
  const workflow = await request.appendConnection(
    'TriggersRun',
    'ComplexWorkflow',
    `workflow-${requestDto.id}`,
    { input }
  );

  // Step 3: Start workflow and process steps
  const generator = await workflow.start();
  
  // Option A: Process synchronously (blocks until done)
  // for await (const step of generator) {
  //   logger.info('Step completed:', step);
  // }
  
  // Option B: Process asynchronously (return immediately)
  (async () => {
    for await (const step of generator) {
      logger.info('Step completed:', step);
    }
    logger.info('Workflow completed');
  })().catch(error => {
    logger.error('Workflow failed:', error);
  });

  const workflowDto = await workflow.get_dto();
  
  return {
    requestId: requestDto.id,
    workflowId: workflowDto.id,
    statusUrl: `/workflow-status?id=${workflowDto.id}`,
  };
}
```

---

## Cross-Bundle Communication

Agent bundles can communicate with each other via internal gRPC.

### Calling Another Bundle

Use the entity client to invoke entities in other bundles:

```typescript
@ApiEndpoint({ method: 'POST', route: 'trigger-external-analysis' })
async triggerExternalAnalysis(body: any = {}): Promise<any> {
  const { articleId } = body;

  // Invoke an entity in another bundle
  // The entity ID determines which bundle handles it
  const result = await this.entity_client.invoke_entity(
    articleId,  // Entity ID from another bundle
    { operation: 'analyze' }
  );

  return { result };
}
```

### Bundle Discovery

Bundles are registered in the platform and can be discovered by name:

```typescript
// Get another bundle's application ID
const otherBundleAppId = await this.entity_client.get_app_id_by_name('OtherBundle');

// Search for entities in that bundle
const entities = await this.entity_client.search_nodes(
  { app_id: otherBundleAppId, specific_type_name: 'SomeType' }
);
```

### Cross-Bundle Relationships

Create edges between entities in different bundles:

```typescript
// Create relationship from this bundle's entity to another bundle's entity
await this.entity_client.create_edge({
  from_node_id: myEntityId,     // In this bundle
  to_node_id: otherEntityId,    // In another bundle
  edge_type: 'References',
});

// Query works across bundles
const edges = await this.entity_client.get_node_edges_from(
  myEntityId,
  ['References']
);
// Returns edges to entities in any bundle
```

### Communication Patterns

**Pattern: Delegation**
```typescript
// This bundle handles requests, another bundle processes
@ApiEndpoint({ method: 'POST', route: 'submit-for-processing' })
async submitForProcessing(body: any = {}): Promise<any> {
  // Create request in this bundle
  const requestDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `request-${Date.now()}`,
    specific_type_name: 'ProcessingRequest',
    general_type_name: 'Request',
    status: 'Submitted',
    data: body,
  });

  // Create processing entity in another bundle
  const processorBundleId = await this.entity_client.get_app_id_by_name('Processor');
  const processorDto = await this.entity_factory.create_entity_node({
    app_id: processorBundleId,
    name: `processor-${Date.now()}`,
    specific_type_name: 'Processor',
    general_type_name: 'Worker',
    status: 'Pending',
    data: body,
  });

  // Link them
  await this.entity_client.create_edge({
    from_node_id: requestDto.id,
    to_node_id: processorDto.id,
    edge_type: 'ProcessedBy',
  });

  // Invoke the processor
  await this.entity_client.invoke_entity(processorDto.id, {});

  return {
    requestId: requestDto.id,
    processorId: processorDto.id,
  };
}
```

---

## Deployment and Configuration

### Bundle Metadata

Define bundle metadata in `firefoundry.json`:

```json
{
  "bundleName": "my-agent-bundle",
  "version": "1.0.0",
  "description": "Description of the bundle",
  "entrypoint": "dist/index.js",
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^1.0.0"
  }
}
```

### Environment Configuration

Use environment variables for configuration:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  private readonly maxConcurrentWorkflows: number;
  private readonly enableBackgroundJobs: boolean;

  constructor() {
    super(/* ... */);
    
    // Load configuration from environment
    this.maxConcurrentWorkflows = parseInt(
      process.env.MAX_CONCURRENT_WORKFLOWS || '10',
      10
    );
    
    this.enableBackgroundJobs = 
      process.env.ENABLE_BACKGROUND_JOBS === 'true';
  }

  override async init() {
    await super.init();
    
    logger.info('Configuration:', {
      maxConcurrentWorkflows: this.maxConcurrentWorkflows,
      enableBackgroundJobs: this.enableBackgroundJobs,
    });

    if (this.enableBackgroundJobs) {
      this.start_background_jobs();
    }
  }
}
```

**Environment Variables to Consider:**
- `LOG_LEVEL`: Logging verbosity (debug, info, warn, error)
- `PORT`: HTTP server port
- Feature flags for enabling/disabling capabilities
- Resource limits (max concurrent operations, timeouts)
- External service endpoints

### Secrets Management

**Never hardcode secrets.** Use environment variables or KeyVault:

```typescript
// DON'T do this:
const apiKey = 'sk-abc123...';

// DO this:
const apiKey = process.env.EXTERNAL_API_KEY;
if (!apiKey) {
  throw new Error('EXTERNAL_API_KEY environment variable is required');
}

// Or use KeyVault for production:
const apiKey = await keyVault.getSecret('external-api-key');
```

### Health and Readiness Checks

Built-in endpoints:
- `GET /health`: Returns 200 if bundle is healthy
- `GET /ready`: Returns 200 if bundle is ready to accept requests

Add custom health checks:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  private isHealthy: boolean = false;

  override async init() {
    await super.init();
    
    // Mark healthy after successful initialization
    this.isHealthy = true;
  }

  @ApiEndpoint({ method: 'GET', route: 'health-detail' })
  async healthDetail(): Promise<any> {
    return {
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      // Add custom health indicators
    };
  }
}
```

### Graceful Shutdown

Handle SIGTERM/SIGINT for graceful shutdowns:

```typescript
// index.ts
import { createStandaloneAgentBundle, logger } from '@firebrandanalytics/ff-agent-sdk';
import { MyAgentBundle } from './agent-bundle.js';

async function startServer() {
  const server = await createStandaloneAgentBundle(MyAgentBundle, {
    port: parseInt(process.env.PORT || '3000', 10),
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    
    // Give in-flight requests time to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
```

---

## Best Practices

### Design Principles

1. **Stateless Bundle, Stateful Entities**
   - Don't store application state in bundle instance variables
   - Use the entity graph for persistent state
   - Bundle state should only be for caching or coordination

2. **Idempotent Operations**
   - Check if entities exist before creating them
   - Use unique entity names for deduplication
   - Leverage the Runnable pattern for resumable operations

3. **Clear Separation of Concerns**
   - Bundles: API routing, coordination, initialization
   - Entities: Business logic, state management
   - Bots: AI-powered behaviors
   - Prompts: AI instructions

4. **Fail Fast, Recover Gracefully**
   - Validate inputs early
   - Throw errors for irrecoverable conditions
   - Log errors with context
   - Return structured error responses

### Type-Safe Entity Operations

1. **Entity Factory Type Parameter**

   When extending `FFAgentBundle`, provide an `EntityTypeHelper` type parameter for type-safe entity factory operations:

   ```typescript
   // In constructors.ts
   import {
     FFConstructors,
     EntityTypeHelper,
     BotTypeHelper,
     PromptTypeHelper,
   } from '@firebrandanalytics/ff-agent-sdk';
   import { MyEntity } from './entities/MyEntity.js';

   export const MyConstructors = {
     ...FFConstructors,
     MyEntity: MyEntity,
   } as const;

   export type MyETH = EntityTypeHelper<
     BotTypeHelper<PromptTypeHelper<any, any>, any>,
     typeof MyConstructors
   >;
   ```

   ```typescript
   // In agent-bundle.ts
   import { MyConstructors, MyETH } from './constructors.js';

   export class MyAgentBundle extends FFAgentBundle<MyETH> {
     // entity_factory is now properly typed
   }
   ```

2. **Creating Entities with Data**

   When creating entities that have custom data, use both type parameters - the entity type name and the data type:

   ```typescript
   // Define your data type
   interface ArticleData {
     title: string;
     content: string;
     author?: string;
   }

   // Create the entity with both type parameters
   const article = await this.entity_factory.create_entity_node<'Article', ArticleData>({
     app_id: this.get_app_id(),
     name: `article-${Date.now()}`,
     specific_type_name: 'Article',
     general_type_name: 'Document',
     status: 'Pending',
     data: {
       title: 'My Article',
       content: 'Article content...',
     },
   });
   ```

   The first type parameter (`'Article'`) specifies the entity constructor type.
   The second type parameter (`ArticleData`) provides type safety for the `data` field.

3. **Accessing Entity Properties**

   `create_entity_node` returns the entity instance, not a DTO. Access the entity ID through `get_dto()`:

   ```typescript
   // create_entity_node returns the entity instance
   const article = await this.entity_factory.create_entity_node<'Article', ArticleData>({
     app_id: this.get_app_id(),
     name: `article-${Date.now()}`,
     specific_type_name: 'Article',
     general_type_name: 'Document',
     status: 'Pending',
     data: { title: 'Title', content: 'Content' },
   });

   // Access ID through get_dto() - id is a protected property
   const articleDto = await article.get_dto();
   logger.info(`Created article: ${articleDto.id}`);

   // You can immediately call entity methods
   const result = await article.run();
   ```

4. **Type-Safe Entity Retrieval**

   Use `get_entity<T>` for async database lookups:

   ```typescript
   const article = await this.entity_factory.get_entity<'Article'>(articleId);
   const dto = await article.get_dto();
   ```

   Use `get_entity_known_type<T>` when you know the type and want synchronous, lazy-loaded access:

   ```typescript
   const article = this.entity_factory.get_entity_known_type('Article', articleId);
   // DTO will be loaded on first access
   const dto = await article.get_dto();
   ```

5. **Handling Optional Status**

   Entity status may be undefined. Use nullish coalescing when returning status:

   ```typescript
   const dto = await entity.get_dto();
   return {
     id: dto.id,
     status: dto.status ?? 'Unknown',
   };
   ```

### API Design

1. **RESTful Conventions**
   ```typescript
   // Good: Clear, RESTful routes
   POST /articles
   GET /articles/{id}
   GET /articles
   POST /articles/{id}/analyze
   
   // Avoid: Ambiguous routes
   POST /create
   GET /data
   ```

2. **Consistent Response Structure**
   ```typescript
   // Success response
   {
     success: true,
     data: { ... },
     metadata: { timestamp: '...' }
   }
   
   // Error response
   {
     success: false,
     error: { message: '...', type: '...' }
   }
   ```

3. **Pagination for Lists**
   ```typescript
   @ApiEndpoint({ method: 'GET', route: 'articles' })
   async listArticles(query: any = {}): Promise<any> {
     const page = parseInt(query.page || '1', 10);
     const pageSize = parseInt(query.pageSize || '20', 10);
     // ...
     return {
       data: items,
       pagination: { page, pageSize, total, hasMore },
     };
   }
   ```

4. **Versioning (when needed)**
   ```typescript
   @ApiEndpoint({ method: 'POST', route: 'v1/analyze' })
   async analyzeV1(body: any = {}): Promise<any> { /* ... */ }
   
   @ApiEndpoint({ method: 'POST', route: 'v2/analyze' })
   async analyzeV2(body: any = {}): Promise<any> { /* ... */ }
   ```

### Performance

1. **Avoid N+1 Queries**
   ```typescript
   // Bad: N+1 queries
   const articles = await this.entity_client.search_nodes({ type: 'Article' });
   for (const article of articles.result) {
     const author = await this.entity_client.get_node(article.data.authorId);
     // ...
   }
   
   // Good: Batch queries
   const articles = await this.entity_client.search_nodes({ type: 'Article' });
   const authorIds = articles.result.map(a => a.data.authorId);
   const authors = await this.entity_factory.get_entities(authorIds);
   ```

2. **Limit Result Sets**
   ```typescript
   // Always set reasonable limits
   const result = await this.entity_client.search_nodes(
     criteria,
     sort,
     { limit: 100 }  // Prevent unbounded queries
   );
   ```

3. **Use Async Processing for Long Operations**
   ```typescript
   // Don't block the API response
   @ApiEndpoint({ method: 'POST', route: 'start-analysis' })
   async startAnalysis(body: any = {}): Promise<any> {
     const workflowDto = await this.create_workflow(body);
     
     // Process asynchronously
     this.process_workflow(workflowDto.id).catch(error => {
       logger.error('Workflow failed:', error);
     });
     
     // Return immediately
     return { workflowId: workflowDto.id, status: 'Running' };
   }
   ```

### Observability

1. **Structured Logging**
   ```typescript
   logger.info('Article created', {
     articleId: dto.id,
     userId: body.userId,
     timestamp: new Date().toISOString(),
   });
   ```

2. **Log Levels**
   - `debug`: Detailed diagnostic information
   - `info`: Normal operations, important events
   - `warn`: Warning conditions (recoverable issues)
   - `error`: Error conditions (unrecoverable for this operation)

3. **Error Context**
   ```typescript
   try {
     // ...
   } catch (error) {
     logger.error('Failed to create article', {
       error: error.message,
       stack: error.stack,
       userId: body.userId,
       timestamp: new Date().toISOString(),
     });
     throw error;
   }
   ```

---

## Security Considerations

### Input Validation

Always validate and sanitize inputs:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}): Promise<any> {
  // Validate types
  if (typeof body.title !== 'string') {
    throw new Error('title must be a string');
  }

  // Sanitize strings (prevent injection)
  const sanitizedTitle = body.title.trim().substring(0, 200);

  // Validate against allowed values
  const allowedStatuses = ['draft', 'published'];
  if (body.status && !allowedStatuses.includes(body.status)) {
    throw new Error(`status must be one of: ${allowedStatuses.join(', ')}`);
  }

  // Create with sanitized data
  const dto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `article-${Date.now()}`,
    specific_type_name: 'Article',
    general_type_name: 'Document',
    status: body.status || 'draft',
    data: {
      title: sanitizedTitle,
      // ...
    },
  });

  return { id: dto.id };
}
```

### Authentication and Authorization

Implement auth checks in endpoints:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-article' })
async createArticle(body: any = {}, context?: any): Promise<any> {
  // Extract user info from request context
  const userId = context?.headers?.['x-user-id'];
  const userRole = context?.headers?.['x-user-role'];

  if (!userId) {
    throw new Error('Authentication required');
  }

  // Check permissions
  if (userRole !== 'admin' && userRole !== 'editor') {
    throw new Error('Insufficient permissions');
  }

  // Proceed with authorized operation
  const dto = await this.entity_factory.create_entity_node({
    // ...
    data: {
      ...body,
      createdBy: userId,
    },
  });

  return { id: dto.id };
}
```

### Rate Limiting

Implement rate limiting for public endpoints:

```typescript
export class MyAgentBundle extends FFAgentBundle<any> {
  private requestCounts: Map<string, { count: number; resetAt: number }> = new Map();

  private check_rate_limit(clientId: string, maxRequests: number = 100, windowMs: number = 60000): void {
    const now = Date.now();
    const record = this.requestCounts.get(clientId);

    if (!record || now > record.resetAt) {
      // Start new window
      this.requestCounts.set(clientId, {
        count: 1,
        resetAt: now + windowMs,
      });
      return;
    }

    if (record.count >= maxRequests) {
      throw new Error('Rate limit exceeded');
    }

    record.count++;
  }

  @ApiEndpoint({ method: 'POST', route: 'public-api' })
  async publicApi(body: any = {}, context?: any): Promise<any> {
    const clientId = context?.headers?.['x-client-id'] || 'anonymous';
    
    // Check rate limit
    this.check_rate_limit(clientId, 100, 60000);

    // Process request
    return { success: true };
  }
}
```

### Data Privacy

Handle sensitive data appropriately:

```typescript
@ApiEndpoint({ method: 'GET', route: 'get-article' })
async getArticle(query: any = {}, context?: any): Promise<any> {
  const { articleId } = query;
  const userId = context?.headers?.['x-user-id'];

  const article = await this.entity_factory.get_entity(articleId);
  const dto = await article.get_dto();

  // Check ownership or permissions
  if (dto.data.isPrivate && dto.data.authorId !== userId) {
    throw new Error('Access denied');
  }

  // Return appropriate data based on permissions
  return {
    id: dto.id,
    title: dto.data.title,
    content: dto.data.content,
    // Don't include sensitive fields like email, phone, etc.
  };
}
```

---

## Conclusion

Agent bundles are the application containers that bring your entities, bots, and prompts together into a deployable service. By following the patterns and best practices in this guide, you can build robust, scalable, and maintainable AI applications on the FireFoundry platform.

### Key Takeaways

- **Agent bundles are the deployment unit**: They package your application and expose APIs
- **Use `@ApiEndpoint` for ID-less APIs**: Perfect for creation, search, and app-level operations
- **Use entity-based invocation for entity-specific operations**: Leverage the Runnable pattern for resumable workflows
- **Initialize properly**: Use `init()` to bootstrap your application state
- **Handle errors gracefully**: Validate inputs, log errors, and return structured responses
- **Design for observability**: Structured logging and health checks are critical for production
- **Follow security best practices**: Validate inputs, implement auth, and protect sensitive data

### Next Steps

- **Tutorial**: Work through the [Agent Bundle Tutorial](./agent_bundle_tutorial.md) for hands-on experience
- **Getting Started**: Build a complete application with the [Getting Started Guide](../agent_sdk_getting_started.md)
- **Deployment**: Learn how to deploy bundles to the FireFoundry platform
- **Advanced Topics**: Explore workflow orchestration, human-in-the-loop patterns, and cross-bundle communication

For additional support, refer to the FireFoundry SDK examples and API documentation.

