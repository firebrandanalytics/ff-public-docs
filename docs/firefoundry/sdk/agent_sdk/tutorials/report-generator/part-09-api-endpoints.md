# Part 9: Custom API Endpoints

In this part, you'll add REST API endpoints to your agent bundle. Until now, all interaction has been through the low-level `invoke` protocol and `ff-sdk-cli iterator` commands. Custom API endpoints let you expose a clean, typed HTTP interface that front-end applications and external services can call directly.

**What you'll learn:**
- Using the `@ApiEndpoint` decorator to expose methods as HTTP endpoints
- Creating POST endpoints with `acceptsBlobs: true` for single-call file upload and entity creation
- Creating GET endpoints for status queries
- Input validation patterns for API endpoints
- Using `entity_factory.create_entity_node` to create entities with initial data
- Using `entity_client.get_node` to retrieve entity data
- Storing uploaded files in working memory within an API endpoint

**What you'll build:** Two API endpoints -- `POST /api/create-report` to upload a document, create a report workflow entity, and start processing in a single call, and `GET /api/report-status` to check its status.

## Key Concepts

### The @ApiEndpoint Decorator

The `@ApiEndpoint` decorator marks methods on your agent bundle class as HTTP-exposable endpoints. The SDK automatically registers these as Express routes under the `/api/` prefix when the server starts.

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })
// Exposed as: POST /api/create-report (multipart form data)

@ApiEndpoint({ method: 'GET', route: 'report-status' })
// Exposed as: GET /api/report-status

@ApiEndpoint()  // Defaults: GET, route is the method name
// async getHealth() -> GET /api/getHealth
```

The decorator accepts a configuration object with these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `method` | `'GET' \| 'POST'` | `'GET'` | HTTP method |
| `route` | `string` | Method name | Custom route path (prefixed with `/api/`) |
| `responseType` | `'json' \| 'binary' \| 'iterator'` | `'json'` | Response format |
| `contentType` | `string` | `'application/octet-stream'` | Content type for binary responses |
| `filename` | `string` | -- | Filename for binary download responses |
| `acceptsBlobs` | `boolean` | `false` | Whether endpoint accepts multipart file uploads. When `true`, the SDK parses multipart form data and injects file buffers as the first argument(s), with the JSON body as the next argument. |

### Single-Call File Upload with acceptsBlobs

The `@ApiEndpoint` decorator supports file uploads directly by setting `acceptsBlobs: true`. When enabled, the SDK automatically parses multipart form data and injects file buffers into your method arguments using blob placeholders.

This means entity creation, file storage, and workflow initiation can all happen in a single API call -- no separate upload step needed.

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })
async createReport(
  document: Buffer,           // Uploaded file, injected automatically
  body: CreateReportRequest   // Parsed JSON from the form data
): Promise<CreateReportResponse> {
  // Create entity, store file in working memory, start workflow
}
```

The SDK handles the multipart parsing. Clients send the file as a `file` field and the JSON body as a `data` field in multipart form data.

### entity_factory and entity_client

Your agent bundle class inherits two key properties:

- **`this.entity_factory`** -- Creates new entity nodes in the entity graph. Use `create_entity_node()` to create an entity with initial data.
- **`this.entity_client`** -- Reads entity data from the entity graph. Use `get_node()` to retrieve an entity by ID.

## Step 1: Define Request and Response Types

Add typed interfaces for your API endpoints in the shared types package.

**`packages/shared-types/src/core.ts`** -- add these types:

```typescript
/**
 * Request body for POST /api/create-report
 */
export interface CreateReportRequest {
  prompt: string;
  orientation: 'portrait' | 'landscape';
}

/**
 * Response for POST /api/create-report
 */
export interface CreateReportResponse {
  entity_id: string;
}

/**
 * Response for GET /api/report-status
 */
export interface ReportStatusResponse {
  entity_id: string;
  status: string;
  data: {
    prompt: string;
    orientation: string;
    pdf_working_memory_id?: string;
    ai_reasoning?: string;
  };
}
```

## Step 2: Add the Create Report Endpoint

Open the agent bundle class and add a `createReport` method decorated with `@ApiEndpoint`. This endpoint uses `acceptsBlobs: true` to accept a file upload and JSON body in a single multipart request.

**`apps/report-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
  WorkingMemoryProvider,
} from "@firebrandanalytics/ff-agent-sdk";
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { ReportBundleConstructors } from "./constructors.js";
import type {
  CreateReportRequest,
  CreateReportResponse,
  ReportStatusResponse
} from '@shared/types';

const APP_ID = "1ba3a4a6-4df4-49b5-9291-c0bacfe46201";

export class ReportBundleAgentBundle extends FFAgentBundle<any> {
  private working_memory_provider!: WorkingMemoryProvider;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "ReportGenerator",
        type: "agent_bundle",
        description: "Document-to-report generation service"
      },
      ReportBundleConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();

    // Initialize working memory provider for file storage
    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS ||
      'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);

    logger.info("ReportGeneratorBundle initialized!");
    logger.info("API endpoints (single-call pattern with acceptsBlobs):");
    logger.info("   POST /api/create-report - Upload document and start report workflow");
    logger.info("   GET  /api/report-status - Get report status");
  }

  /**
   * Create a report entity, store the uploaded document in working memory,
   * and start the workflow -- all in a single API call.
   *
   * Uses acceptsBlobs: true so the SDK automatically parses multipart
   * form data and injects file buffers into the method arguments.
   */
  @ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })
  async createReport(
    document: Buffer,
    body: CreateReportRequest
  ): Promise<CreateReportResponse> {
    const { prompt, orientation = 'portrait' } = body;

    if (!prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }

    if (!['portrait', 'landscape'].includes(orientation)) {
      throw new Error('Orientation must be "portrait" or "landscape"');
    }

    if (!document || document.length === 0) {
      throw new Error('A document file is required');
    }

    logger.info('[API] Creating report entity (single-call)', {
      prompt, orientation, document_size: document.length
    });

    // 1. Create the workflow entity
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `report-${Date.now()}`,
      specific_type_name: 'ReportReviewWorkflowEntity',
      general_type_name: 'ReportReviewWorkflowEntity',
      status: 'Pending',
      data: {
        wrappedEntityArgs: {
          prompt,
          orientation
        }
      }
    });

    const entity_id = entity.id!;

    // 2. Store the document in working memory
    const wmResult = await this.working_memory_provider.add_memory_from_buffer({
      entityNodeId: entity_id,
      name: `upload-${Date.now()}.pdf`,
      description: 'Original document uploaded via single-call API',
      contentType: 'application/pdf',
      memoryType: 'file',
      buffer: document,
      metadata: {
        upload_method: 'acceptsBlobs',
        file_size: document.length,
        uploaded_at: new Date().toISOString()
      },
    });

    // 3. Update the entity's wrappedEntityArgs with the working memory ID
    const dto = await entity.get_dto();
    dto.data.wrappedEntityArgs.original_document_wm_id = wmResult.workingMemoryId;
    await entity.update_data(dto.data);

    // 4. Start the workflow via iterator (fire-and-forget)
    const iterator = await entity.start();
    (async () => {
      try {
        for await (const _envelope of iterator) {
          // Workflow progresses in the background
        }
        logger.info('[API] Workflow completed', { entity_id });
      } catch (err) {
        logger.error('[API] Workflow failed', { entity_id, error: err });
      }
    })();

    logger.info('[API] Report entity created and workflow started', { entity_id });

    // 5. Return entity_id immediately
    return { entity_id };
  }
}
```

**How it works:**

- The `@ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })` decorator registers this method as `POST /api/create-report` with multipart support.
- When `acceptsBlobs` is `true`, the SDK parses multipart form data. The uploaded file is injected as a `Buffer` in the first argument, and the parsed JSON body is injected as the second argument.
- The method creates the entity, stores the uploaded document in working memory via `WorkingMemoryProvider`, updates the entity's data with the working memory ID, and starts the workflow iterator in the background.
- The response returns immediately with the `entity_id`. Clients poll the status endpoint to track progress.

Note the `app_id: this.get_app_id()` -- this associates the entity with this agent bundle so it can be found and managed later.

### Working Memory in the Bundle

The bundle initializes a `WorkingMemoryProvider` in `init()` using the same pattern as entity classes. This lets the endpoint store uploaded files before the workflow entity starts running:

```typescript
// In init()
const context_client = new ContextServiceClient({
  address: CONTEXT_SERVICE_ADDRESS,
  apiKey: CONTEXT_SERVICE_API_KEY,
});
this.working_memory_provider = new WorkingMemoryProvider(context_client);
```

The `add_memory_from_buffer` call stores the file and returns a `workingMemoryId` that downstream workflow stages use to retrieve the document.

## Step 3: Add the Report Status Endpoint

Add a GET endpoint that retrieves entity status and data.

```typescript
  /**
   * Get the current status and data of a report entity.
   */
  @ApiEndpoint({ method: 'GET', route: 'report-status' })
  async getReportStatus(query: { entity_id?: string }): Promise<ReportStatusResponse> {
    const { entity_id } = query;

    if (!entity_id) {
      throw new Error('entity_id query parameter is required');
    }

    logger.info('[API] Getting report status', { entity_id });

    const entityDto = await this.entity_client.get_node(entity_id);

    if (!entityDto) {
      throw new Error(`Entity ${entity_id} not found`);
    }

    const data = (entityDto as any).data || {};

    return {
      entity_id: entityDto.id!,
      status: entityDto.status!,
      data: data
    };
  }
```

**How it works:**

- The `@ApiEndpoint({ method: 'GET', route: 'report-status' })` decorator registers this as `GET /api/report-status`.
- For GET endpoints, the SDK passes the parsed query parameters as the first argument (`query`).
- `this.entity_client.get_node(entity_id)` retrieves the entity's full DTO from the entity graph, including its current status and all stored data.
- The response includes the entity status (`Pending`, `InProgress`, `Completed`, `Failed`) and the data fields, which grow as the workflow progresses (eventually including `pdf_working_memory_id`).

## Step 4: Complete Agent Bundle

Here is the complete agent bundle with both endpoints:

**`apps/report-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
  WorkingMemoryProvider,
} from "@firebrandanalytics/ff-agent-sdk";
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { ReportBundleConstructors } from "./constructors.js";
import type {
  CreateReportRequest,
  CreateReportResponse,
  ReportStatusResponse
} from '@shared/types';

const APP_ID = "1ba3a4a6-4df4-49b5-9291-c0bacfe46201";

export class ReportBundleAgentBundle extends FFAgentBundle<any> {
  private working_memory_provider!: WorkingMemoryProvider;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "ReportGenerator",
        type: "agent_bundle",
        description: "Document-to-report generation service"
      },
      ReportBundleConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();

    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS ||
      'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);

    logger.info("ReportGeneratorBundle initialized!");
    logger.info("API endpoints (single-call pattern with acceptsBlobs):");
    logger.info("   POST /api/create-report - Upload document and start report workflow");
    logger.info("   GET  /api/report-status - Get report status");
  }

  @ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })
  async createReport(
    document: Buffer,
    body: CreateReportRequest
  ): Promise<CreateReportResponse> {
    const { prompt, orientation = 'portrait' } = body;

    if (!prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }

    if (!['portrait', 'landscape'].includes(orientation)) {
      throw new Error('Orientation must be "portrait" or "landscape"');
    }

    if (!document || document.length === 0) {
      throw new Error('A document file is required');
    }

    logger.info('[API] Creating report entity (single-call)', {
      prompt, orientation, document_size: document.length
    });

    // 1. Create the workflow entity
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `report-${Date.now()}`,
      specific_type_name: 'ReportReviewWorkflowEntity',
      general_type_name: 'ReportReviewWorkflowEntity',
      status: 'Pending',
      data: {
        wrappedEntityArgs: {
          prompt,
          orientation
        }
      }
    });

    const entity_id = entity.id!;

    // 2. Store the document in working memory
    const wmResult = await this.working_memory_provider.add_memory_from_buffer({
      entityNodeId: entity_id,
      name: `upload-${Date.now()}.pdf`,
      description: 'Original document uploaded via single-call API',
      contentType: 'application/pdf',
      memoryType: 'file',
      buffer: document,
      metadata: {
        upload_method: 'acceptsBlobs',
        file_size: document.length,
        uploaded_at: new Date().toISOString()
      },
    });

    // 3. Update the entity's wrappedEntityArgs with the working memory ID
    const dto = await entity.get_dto();
    dto.data.wrappedEntityArgs.original_document_wm_id = wmResult.workingMemoryId;
    await entity.update_data(dto.data);

    // 4. Start the workflow via iterator (fire-and-forget)
    const iterator = await entity.start();
    (async () => {
      try {
        for await (const _envelope of iterator) {
          // Workflow progresses in the background
        }
        logger.info('[API] Workflow completed', { entity_id });
      } catch (err) {
        logger.error('[API] Workflow failed', { entity_id, error: err });
      }
    })();

    logger.info('[API] Report entity created and workflow started', { entity_id });

    return { entity_id };
  }

  @ApiEndpoint({ method: 'GET', route: 'report-status' })
  async getReportStatus(query: { entity_id?: string }): Promise<ReportStatusResponse> {
    const { entity_id } = query;

    if (!entity_id) {
      throw new Error('entity_id query parameter is required');
    }

    logger.info('[API] Getting report status', { entity_id });

    const entityDto = await this.entity_client.get_node(entity_id);

    if (!entityDto) {
      throw new Error(`Entity ${entity_id} not found`);
    }

    const data = (entityDto as any).data || {};

    return {
      entity_id: entityDto.id!,
      status: entityDto.status!,
      data: data
    };
  }
}
```

## Step 5: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 6: Test with ff-sdk-cli

### Test the Single-Call Create Report Endpoint

Use `ff-sdk-cli api call-blob` to send a file and JSON body in one request:

```bash
ff-sdk-cli api call-blob create-report \
  --method POST \
  --body '{"prompt": "Analyze and summarize the key financial metrics", "orientation": "landscape"}' \
  --file ./sample-report.pdf \
  --url http://localhost:3001
```

Expected response:

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

The entity is created, the document is stored in working memory, and the workflow has started -- all from this single call.

### Test Input Validation

```bash
# Missing prompt - should return error
ff-sdk-cli api call-blob create-report \
  --method POST \
  --body '{"orientation": "portrait"}' \
  --file ./sample-report.pdf \
  --url http://localhost:3001

# Invalid orientation - should return error
ff-sdk-cli api call-blob create-report \
  --method POST \
  --body '{"prompt": "Test", "orientation": "diagonal"}' \
  --file ./sample-report.pdf \
  --url http://localhost:3001
```

### Test the Status Endpoint

```bash
ff-sdk-cli api call report-status \
  --method GET \
  --query 'entity_id=<entity-id-from-create>' \
  --url http://localhost:3001
```

Expected response (immediately after creation):

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "Pending",
  "data": {
    "wrappedEntityArgs": {
      "prompt": "Analyze and summarize the key financial metrics",
      "orientation": "landscape",
      "original_document_wm_id": "wm-1234-..."
    }
  }
}
```

### Complete Single-Call Flow

Test the full single-call pattern -- upload document and start the workflow, then poll for progress:

```bash
# Step 1: Upload document and create entity in one call
ENTITY_ID=$(ff-sdk-cli api call-blob create-report \
  --method POST \
  --body '{"prompt": "Create a summary report", "orientation": "portrait"}' \
  --file ./sample-report.pdf \
  --url http://localhost:3001 \
  | jq -r '.entity_id')

echo "Created entity and started workflow: $ENTITY_ID"

# Step 2: Poll for progress
ff-sdk-cli api call report-status \
  --method GET \
  --query "entity_id=$ENTITY_ID" \
  --url http://localhost:3001
```

After the workflow completes (and is approved via the review step), the status response will include the PDF working memory ID:

```json
{
  "entity_id": "a1b2c3d4-...",
  "status": "Completed",
  "data": {
    "wrappedEntityArgs": {
      "prompt": "Create a summary report",
      "orientation": "portrait",
      "original_document_wm_id": "wm-1234-...",
      "original_filename": "sample-report.pdf"
    },
    "currentVersion": 0
  }
}
```

### Test with curl (Direct HTTP)

The API endpoints are standard HTTP. With `acceptsBlobs: true`, send multipart form data:

```bash
# Create report (multipart form data with file + JSON)
curl -X POST http://localhost:3001/api/create-report \
  -F 'file=@sample-report.pdf' \
  -F 'data={"prompt": "Summarize findings", "orientation": "portrait"}'

# Check status
curl "http://localhost:3001/api/report-status?entity_id=<entity-id>"
```

> **Note:** The two-step pattern (create entity, then upload blob separately) is still useful when entity creation and file upload happen at different times -- for example, if a user fills out a form first and uploads the file later. For workflows where the file is always part of the initial request, `acceptsBlobs: true` is simpler.

## Understanding the Request Flow

### POST Endpoints with acceptsBlobs

For POST endpoints with `acceptsBlobs: true`, the SDK:

1. Parses the multipart form data (file in the `file` field, JSON in the `data` field)
2. Injects file buffer(s) as the first argument(s) to your method
3. Injects the parsed JSON body as the next argument
4. Serializes the return value as the JSON response
5. If the method throws, returns a 400/500 error with the error message

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-report', acceptsBlobs: true })
async createReport(
  document: Buffer,              // ← file from multipart 'file' field
  body: CreateReportRequest      // ← parsed from multipart 'data' field
): Promise<CreateReportResponse> {
  return { entity_id: '...' };
  //     ^^^^^^^^^^^^^^^^^^^^ serialized as response JSON
}
```

### POST Endpoints (JSON only)

For standard POST endpoints without `acceptsBlobs`, the SDK:

1. Parses the JSON request body
2. Passes it as the first argument to your method
3. Serializes the return value as the JSON response

### GET Endpoints

For GET endpoints, the SDK:

1. Parses the URL query parameters into an object
2. Passes it as the first argument to your method
3. All query parameter values are strings (parse numbers yourself if needed)

```typescript
@ApiEndpoint({ method: 'GET', route: 'report-status' })
async getReportStatus(query: { entity_id?: string }): Promise<ReportStatusResponse> {
  //                   ^^^^^ parsed from ?entity_id=abc&other=def
}
```

### Error Handling

Throwing an error from an endpoint method returns an HTTP error response:

```typescript
if (!prompt?.trim()) {
  throw new Error('Prompt is required and cannot be empty');
  // Returns: { "error": "Prompt is required and cannot be empty" }
}
```

For production use, you may want to throw errors with specific status codes. The SDK maps unhandled errors to 500 and validation errors to 400.

## What You've Built

You now have:
- A `POST /api/create-report` endpoint that accepts a file upload and JSON body in a single multipart request, stores the file in working memory, creates the workflow entity, and starts processing
- A `GET /api/report-status` endpoint that returns entity status and data
- A single-call pattern: one API request handles file upload, entity creation, and workflow initiation
- Input validation that rejects invalid prompts, orientations, and missing documents
- Direct HTTP access to your agent bundle without needing the invoke protocol

## Key Takeaways

1. **@ApiEndpoint is a simple decorator** -- Add it to any method on your agent bundle class and it becomes an HTTP endpoint under `/api/`. No router configuration needed.
2. **acceptsBlobs enables single-call file uploads** -- Set `acceptsBlobs: true` and the SDK handles multipart parsing automatically. File buffers are injected as the first arguments, JSON body as the next.
3. **POST gets the body, GET gets the query** -- The first argument to your method is automatically populated from the right source (with `acceptsBlobs`, files come first, then the body).
4. **entity_factory creates, entity_client reads** -- Both are available as `this.entity_factory` and `this.entity_client` on your agent bundle class.
5. **WorkingMemoryProvider works in the bundle too** -- Initialize it in `init()` with a `ContextServiceClient`, then use `add_memory_from_buffer` to store uploaded files before the workflow starts.
6. **Validation should happen early** -- Throw errors in your endpoint method before creating entities. This prevents orphaned entities from failed requests.
7. **API endpoints complement, not replace, invoke** -- The invoke protocol handles streaming, entity method calls, and more advanced patterns. API endpoints are for clean request/response patterns like file upload + entity creation.

## Next Steps

In [Part 10: Deployment & Testing](./part-10-deployment.md), we'll configure the Dockerfile, Helm values, and environment variables for production deployment, then run a complete end-to-end test using all of the diagnostic tools.
