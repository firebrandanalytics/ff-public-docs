# Part 9: Custom API Endpoints

In this part, you'll add REST API endpoints to your agent bundle. Until now, all interaction has been through the low-level `invoke` protocol and `ff-sdk-cli iterator` commands. Custom API endpoints let you expose a clean, typed HTTP interface that front-end applications and external services can call directly.

**What you'll learn:**
- Using the `@ApiEndpoint` decorator to expose methods as HTTP endpoints
- Creating POST endpoints for entity creation and GET endpoints for status queries
- Input validation patterns for API endpoints
- Using `entity_factory.create_entity_node` to create entities with initial data
- Using `entity_client.get_node` to retrieve entity data
- The two-step pattern: API creates entity, then blob upload starts processing

**What you'll build:** Two API endpoints -- `POST /api/create-report` to create a report workflow entity and `GET /api/report-status` to check its status.

## Key Concepts

### The @ApiEndpoint Decorator

The `@ApiEndpoint` decorator marks methods on your agent bundle class as HTTP-exposable endpoints. The SDK automatically registers these as Express routes under the `/api/` prefix when the server starts.

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-report' })
// Exposed as: POST /api/create-report

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
| `acceptsBlobs` | `boolean` | `false` | Whether endpoint accepts file uploads |

### The Two-Step Blob Pattern

The `@ApiEndpoint` decorator handles JSON request/response natively, but binary file uploads require a different mechanism. The pattern for workflows that need file uploads is:

1. **API endpoint creates the entity** with initial configuration (prompt, orientation)
2. **Client uploads the file** via `invoke_entity_method_with_blobs` (or `ff-sdk-cli iterator start-blob`)

This separation keeps the API endpoint simple and lets the SDK's blob upload infrastructure handle the file transfer.

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

Open the agent bundle class and add a `createReport` method decorated with `@ApiEndpoint`.

**`apps/report-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  app_provider,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { ReportBundleConstructors } from "./constructors.js";
import type {
  CreateReportRequest,
  CreateReportResponse,
  ReportStatusResponse
} from '@shared/types';

export class ReportBundleAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "1ba3a4a6-4df4-49b5-9291-c0bacfe46201",
        name: "ReportGenerator",
        description: "Document-to-report generation service"
      },
      ReportBundleConstructors,
      app_provider
    );
  }

  override async init() {
    await super.init();
    logger.info("ReportGeneratorBundle initialized!");
    logger.info("API endpoints:");
    logger.info("   POST /api/create-report - Create report entity");
    logger.info("   GET  /api/report-status - Get report status");
  }

  /**
   * Create a new report workflow entity.
   *
   * This is step 1 of the two-step pattern:
   * 1. Create entity via this endpoint (returns entity_id)
   * 2. Upload document via iterator start-blob (triggers workflow)
   */
  @ApiEndpoint({ method: 'POST', route: 'create-report' })
  async createReport(body: CreateReportRequest): Promise<CreateReportResponse> {
    const { prompt, orientation = 'portrait' } = body;

    // Validate input
    if (!prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }

    if (!['portrait', 'landscape'].includes(orientation)) {
      throw new Error('Orientation must be "portrait" or "landscape"');
    }

    logger.info('[API] Creating report entity', { prompt, orientation });

    // Create the workflow entity with initial data
    const entityDto = await this.entity_factory.create_entity_node({
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

    logger.info('[API] Report entity created', { entity_id: entityDto.id });

    return {
      entity_id: entityDto.id
    };
  }
}
```

**How it works:**

- The `@ApiEndpoint({ method: 'POST', route: 'create-report' })` decorator registers this method as `POST /api/create-report`.
- For POST endpoints, the SDK passes the parsed JSON request body as the first argument (`body`).
- `this.entity_factory.create_entity_node()` creates a new `ReportReviewWorkflowEntity` in the entity graph with the user's prompt and orientation stored in `wrappedEntityArgs`.
- The method returns the entity ID. The client will use this ID in the next step to upload a document.

Note the `app_id: this.get_app_id()` -- this associates the entity with this agent bundle so it can be found and managed later.

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
  app_provider,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { ReportBundleConstructors } from "./constructors.js";
import type {
  CreateReportRequest,
  CreateReportResponse,
  ReportStatusResponse
} from '@shared/types';

export class ReportBundleAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "1ba3a4a6-4df4-49b5-9291-c0bacfe46201",
        name: "ReportGenerator",
        description: "Document-to-report generation service"
      },
      ReportBundleConstructors,
      app_provider
    );
  }

  override async init() {
    await super.init();
    logger.info("ReportGeneratorBundle initialized!");
    logger.info("API endpoints:");
    logger.info("   POST /api/create-report - Create report entity");
    logger.info("   GET  /api/report-status - Get report status");
  }

  @ApiEndpoint({ method: 'POST', route: 'create-report' })
  async createReport(body: CreateReportRequest): Promise<CreateReportResponse> {
    const { prompt, orientation = 'portrait' } = body;

    if (!prompt?.trim()) {
      throw new Error('Prompt is required and cannot be empty');
    }

    if (!['portrait', 'landscape'].includes(orientation)) {
      throw new Error('Orientation must be "portrait" or "landscape"');
    }

    logger.info('[API] Creating report entity', { prompt, orientation });

    const entityDto = await this.entity_factory.create_entity_node({
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

    logger.info('[API] Report entity created', { entity_id: entityDto.id });

    return {
      entity_id: entityDto.id
    };
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

### Test the Create Report Endpoint

```bash
ff-sdk-cli api call create-report \
  --method POST \
  --body '{"prompt": "Analyze and summarize the key financial metrics", "orientation": "landscape"}' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### Test Input Validation

```bash
# Missing prompt - should return error
ff-sdk-cli api call create-report \
  --method POST \
  --body '{"orientation": "portrait"}' \
  --url http://localhost:3001

# Invalid orientation - should return error
ff-sdk-cli api call create-report \
  --method POST \
  --body '{"prompt": "Test", "orientation": "diagonal"}' \
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
      "orientation": "landscape"
    }
  }
}
```

### Complete Two-Step Flow

Now test the full two-step pattern -- create entity via API, then upload document:

```bash
# Step 1: Create entity via API endpoint
ENTITY_ID=$(ff-sdk-cli api call create-report \
  --method POST \
  --body '{"prompt": "Create a summary report", "orientation": "portrait"}' \
  --url http://localhost:3001 \
  | jq -r '.entity_id')

echo "Created entity: $ENTITY_ID"

# Step 2: Upload document via blob (starts the workflow)
ff-sdk-cli iterator start-blob $ENTITY_ID \
  --method process_document_stream \
  --file ./sample-report.pdf \
  --url http://localhost:3001

# Step 3: Poll for progress
ff-sdk-cli iterator next $ENTITY_ID --url http://localhost:3001

# Step 4: Check status via API endpoint
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

The API endpoints are standard HTTP, so you can also call them with curl:

```bash
# Create report
curl -X POST http://localhost:3001/api/create-report \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Summarize findings", "orientation": "portrait"}'

# Check status
curl "http://localhost:3001/api/report-status?entity_id=<entity-id>"
```

## Understanding the Request Flow

### POST Endpoints

For POST endpoints, the SDK:

1. Parses the JSON request body
2. Passes it as the first argument to your method
3. Serializes the return value as the JSON response
4. If the method throws, returns a 400/500 error with the error message

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-report' })
async createReport(body: CreateReportRequest): Promise<CreateReportResponse> {
  //                ^^^^ parsed from request JSON body
  return { entity_id: '...' };
  //     ^^^^^^^^^^^^^^^^^^^^ serialized as response JSON
}
```

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
- A `POST /api/create-report` endpoint that creates report workflow entities with validated input
- A `GET /api/report-status` endpoint that returns entity status and data
- A clean two-step pattern: API creates the entity, blob upload starts the workflow
- Input validation that rejects invalid prompts and orientations
- Direct HTTP access to your agent bundle without needing the invoke protocol

## Key Takeaways

1. **@ApiEndpoint is a simple decorator** -- Add it to any method on your agent bundle class and it becomes an HTTP endpoint under `/api/`. No router configuration needed.
2. **POST gets the body, GET gets the query** -- The first argument to your method is automatically populated from the right source.
3. **entity_factory creates, entity_client reads** -- Both are available as `this.entity_factory` and `this.entity_client` on your agent bundle class.
4. **The two-step pattern separates concerns** -- JSON APIs handle configuration and status. Binary uploads happen through the SDK's blob infrastructure. This keeps each endpoint focused.
5. **Validation should happen early** -- Throw errors in your endpoint method before creating entities. This prevents orphaned entities from failed requests.
6. **API endpoints complement, not replace, invoke** -- The invoke protocol handles streaming, blob uploads, and entity method calls. API endpoints are for simple request/response patterns like CRUD operations and status checks.

## Next Steps

In [Part 10: Deployment & Testing](./part-10-deployment.md), we'll configure the Dockerfile, Helm values, and environment variables for production deployment, then run a complete end-to-end test using all of the diagnostic tools.
