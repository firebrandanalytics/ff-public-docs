# Part 13: Review Interaction & Report Management

In this part, you'll close the human-in-the-loop cycle by wiring the browser to the ReviewStep entity, and add report lifecycle management routes for history, download, and archiving. When combined with the SSE progress stream from Part 12, this gives the consumer application everything it needs to drive the full review workflow from a browser.

**What you'll learn:**
- Detecting the ReviewStep `WAITING` state in the SSE progress stream
- Invoking entity methods from the BFF (approve and giveFeedback)
- The feedback loop: submit feedback, reconnect to the progress stream, then trigger the next iteration
- Querying the entity graph for report history using `search_nodes_scoped`
- Downloading PDFs from working memory via `ContextServiceClient`
- Archiving reports with soft delete

**What you'll build:** Four new BFF routes -- invoke (for approve/feedback), history (entity graph queries), download (PDF retrieval from working memory), and archive (soft delete) -- plus the client-side interaction pattern that ties them together.

## Key Concepts

### The Review Interaction Pattern

In Part 8, you built a `ReportReviewWorkflowEntity` that wraps report generation in a review cycle. When the `ReviewStep` entity reaches its review point, it emits a `WAITING` envelope through the progress stream. The browser detects this envelope and presents a review UI with two actions:

1. **Approve** -- calls `approve()` on the `ReviewStep` entity. The workflow completes and returns the final result.
2. **Give feedback** -- calls `giveFeedback(feedback)` on the `ReviewStep` entity. The workflow increments the version, stores the feedback in the config column, and re-runs the wrapped entity with the new feedback context.

From the BFF, these actions map to a single generic **invoke route** that calls entity methods by name. This keeps the BFF thin -- it does not need to know the details of the review protocol, only how to forward method calls.

### Three Client Types

Parts 11--13 use three distinct client types from `@firebrandanalytics/ff-sdk`:

| Client | Connects To | Used For |
|--------|------------|----------|
| `RemoteAgentBundleClient` | Agent bundle server | Creating reports, checking status, invoking entity methods |
| `RemoteEntityClient` | Entity service | Querying the entity graph (search, get IO, archive) |
| `ContextServiceClient` | Context service | Downloading files from working memory |

Each client connects to a different backend service. The invoke route uses `RemoteAgentBundleClient` because entity method calls go through the agent bundle. The history and archive routes use `RemoteEntityClient` because they query the entity graph directly. The download route uses `ContextServiceClient` because PDFs are stored in working memory, which is managed by the context service.

### The Feedback Reconnection Pattern

The feedback flow is more nuanced than a simple request-response. When the user submits feedback, the client must:

1. **Reconnect to the progress stream first** -- Open a new SSE connection to the progress route before sending the feedback. This ensures the stream is listening before the workflow resumes.
2. **Send the feedback** -- Call `giveFeedback` on the ReviewStep entity. This unblocks the workflow, which immediately starts producing new progress events.
3. **Listen for the next WAITING or COMPLETED** -- The reconnected stream captures all progress events from the new iteration.

If you send feedback before reconnecting, the workflow may emit events that no listener captures, causing the client to miss progress updates or the next review point.

## Step 1: Create the Invoke Route

The invoke route is a generic method-calling proxy. It accepts an entity ID, a method name, and an optional payload, then forwards the call to the agent bundle using `invoke_entity_method`.

**`apps/report-gui/src/app/api/reports/invoke/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';
import { AGENT_BUNDLE_URL } from '@/lib/serverConfig';

export const dynamic = 'force-dynamic';

const client = new RemoteAgentBundleClient(AGENT_BUNDLE_URL);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entity_id, method_name, payload } = body;

    if (!entity_id || !method_name) {
      return NextResponse.json(
        { error: 'entity_id and method_name are required' },
        { status: 400 }
      );
    }

    const result = await client.invoke_entity_method(
      entity_id,
      method_name,
      payload
    );

    if (result === undefined || result === null) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API/invoke] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to invoke entity method' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser sends a JSON body with `entity_id`, `method_name`, and `payload`.
2. The route validates that `entity_id` and `method_name` are present.
3. `invoke_entity_method` forwards the call to the agent bundle, which routes it to the correct entity instance.
4. For the approve flow, the call is `invoke_entity_method(reviewStepId, 'approve', [])`. For feedback, it is `invoke_entity_method(reviewStepId, 'giveFeedback', [feedbackText])`.
5. If the method returns a value, it is passed through. If it returns nothing (like `approve`), the route returns `{ success: true }`.

Notice that the route uses `RemoteAgentBundleClient`, not `RemoteEntityClient`. Entity method invocations go through the agent bundle server because the bundle is responsible for hydrating the entity instance and dispatching the method call.

### Why a Generic Invoke Route?

You could create separate `/api/reports/approve` and `/api/reports/feedback` routes, but a single invoke route is more flexible. It works for any entity method without requiring a new route for each action. The trade-off is that the route does not validate the specific method or payload shape -- that validation happens on the agent bundle side when the entity processes the call.

## Step 2: Client-Side Review Flow

With the invoke route in place, the browser can drive the review cycle. This section explains the interaction patterns rather than React component code -- the patterns apply regardless of your UI framework.

### Detecting the WAITING State

In Part 12, you set up an SSE stream that receives progress envelopes. When the `ReviewStep` pauses, it emits an envelope with a `WAITING` status. The key fields are:

```json
{
  "type": "WAITING",
  "entity_id": "review-step-entity-id-here",
  "message": "Please review the result and either approve or provide feedback."
}
```

The `entity_id` in the waiting envelope is the **ReviewStep entity ID**, not the workflow entity ID. You need this ID to call approve or giveFeedback.

### Sending an Approval

When the user approves, the client calls the invoke route:

```typescript
const approveReport = async () => {
  if (!reviewStepEntityId) return;

  const response = await fetch('/api/reports/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_id: reviewStepEntityId,
      method_name: 'approve',
      payload: []
    })
  });

  if (!response.ok) throw new Error('Approval submission failed');
  setReviewStepEntityId(null);
};
```

After approval, the workflow completes and the existing SSE stream receives a `COMPLETED` status envelope with the final result.

### Sending Feedback (The Reconnection Pattern)

Feedback is more involved because submitting feedback causes the workflow to start a new iteration. The client must reconnect to the progress stream before sending feedback to avoid missing events:

```typescript
const submitFeedback = async (feedback: string) => {
  if (!reviewStepEntityId || !entityId) return;

  // Store feedback for after reconnection
  pendingFeedbackRef.current = feedback;
  pendingReviewStepIdRef.current = reviewStepEntityId;

  // Reset UI for new iteration
  setProgress([]);
  setResult(null);
  setReviewStepEntityId(null);
  setCurrentVersion(v => v + 1);
  setIsProcessing(true);

  // Reconnect to progress stream FIRST
  const response = await fetch(`/api/reports/${entityId}/progress`);
  await listenToStream(response);
  // The ACK handler in listenToStream sends the actual giveFeedback call
};
```

The sequence is:

1. Store the feedback text and ReviewStep ID in refs (they survive the state reset).
2. Reset the UI state -- clear progress, clear result, increment the version counter.
3. Open a new SSE connection to the progress route for the **workflow entity** (not the ReviewStep).
4. Once the stream is connected and acknowledges (ACK), send the `giveFeedback` call via the invoke route.
5. The workflow resumes and the new stream captures all events from the next iteration.

The ACK handler inside `listenToStream` looks like this:

```typescript
// Inside the SSE stream listener
if (envelope.type === 'ACK' && pendingFeedbackRef.current) {
  // Stream is connected -- now safe to send feedback
  await fetch('/api/reports/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_id: pendingReviewStepIdRef.current,
      method_name: 'giveFeedback',
      payload: [pendingFeedbackRef.current]
    })
  });
  pendingFeedbackRef.current = null;
  pendingReviewStepIdRef.current = null;
}
```

This ordering guarantee -- reconnect first, then send feedback -- prevents a race condition where the workflow emits progress events before any listener is attached.

## Step 3: Create the History Route

The history route queries the entity graph for completed report workflows. It uses `RemoteEntityClient` (not `RemoteAgentBundleClient`) because it queries the entity service directly rather than going through the agent bundle.

**`apps/report-gui/src/app/api/reports/history/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getEntityClient } from '@/lib/serverConfig';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '25');
    const offset = parseInt(searchParams.get('offset') || '0');

    const page = Math.floor(offset / limit) + 1;
    const size = limit;

    const client = getEntityClient();

    // Search for completed workflow entities
    const results = await client.search_nodes_scoped(
      {
        specific_type_name: 'ReportReviewWorkflowEntity',
        status: 'Completed',
        archive: false,
      },
      { created: 'desc' },
      { page, size },
    );

    // Enrich each report with return value and progress
    const reportsWithDetails = await Promise.all(
      results.result.map(async (report) => {
        const [io, progressData] = await Promise.all([
          client.get_node_io(report.id),
          client.get_node_progress(report.id),
        ]);
        return {
          ...report,
          return_value: io?.output || null,
          progress: progressData?.progress || [],
        };
      }),
    );

    return NextResponse.json({
      reports: reportsWithDetails,
      total: results.total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[API/history] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch report history' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser sends `GET /api/reports/history?limit=10&offset=0`.
2. The route converts offset-based pagination to page-based pagination (the entity service uses `{ page, size }`).
3. `search_nodes_scoped` queries the entity graph with three filters:
   - `specific_type_name: 'ReportReviewWorkflowEntity'` -- only report workflow entities
   - `status: 'Completed'` -- only finished workflows
   - `archive: false` -- exclude archived (soft-deleted) reports
4. Results are sorted by `created: 'desc'` so the most recent reports appear first.
5. For each report, the route fetches additional detail in parallel:
   - `get_node_io(report.id)` -- retrieves the entity's return value, which contains `pdf_working_memory_id`, `reasoning`, and `html_content`
   - `get_node_progress(report.id)` -- retrieves the progress event history
6. The enriched results are returned with pagination metadata.

### Why `RemoteEntityClient` Instead of `RemoteAgentBundleClient`?

The agent bundle's API endpoints (from Part 9) are designed for specific workflows: creating a report and checking its status. History browsing is a cross-cutting concern that queries the entity graph directly. `RemoteEntityClient` provides `search_nodes_scoped` for exactly this purpose -- it filters by entity type, status, and archive flag, with sorting and pagination.

Using the entity client also means the history route works even if the agent bundle is temporarily unavailable, because the entity graph is a separate service.

### The `search_nodes_scoped` Method

This method takes three arguments:

```typescript
search_nodes_scoped(
  filter: {
    specific_type_name?: string;  // Entity type to search for
    status?: string;              // Entity status (Pending, Running, Completed, Failed)
    archive?: boolean;            // Whether to include archived entities
  },
  sort: {
    created?: 'asc' | 'desc';    // Sort by creation time
  },
  pagination: {
    page: number;                 // 1-based page number
    size: number;                 // Results per page
  }
)
```

The response includes `result` (an array of entity DTOs) and `total` (the total count for pagination).

## Step 4: Create the Download Route

The download route fetches a PDF from working memory and streams it to the browser as a file download. It uses `ContextServiceClient`, the third client type in the series.

**`apps/report-gui/src/app/api/reports/download/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ContextServiceClient } from '@firebrandanalytics/ff-sdk';

export const dynamic = 'force-dynamic';

const CONTEXT_BASE_URL =
  process.env.KONG_BASE_URL ||
  process.env.NEXT_PUBLIC_KONG_BASE_URL ||
  'http://localhost:8000';
const CONTEXT_SERVICE_API_KEY =
  process.env.CONTEXT_SERVICE_API_KEY || '';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const workingMemoryId = searchParams.get('working_memory_id');
    const filename = searchParams.get('filename') || 'report.pdf';

    if (!workingMemoryId) {
      return NextResponse.json(
        { error: 'working_memory_id is required' },
        { status: 400 }
      );
    }

    const contextClient = new ContextServiceClient({
      address: CONTEXT_BASE_URL,
      environment: 'ff-dev',
      apiKey: CONTEXT_SERVICE_API_KEY,
    });

    const { buffer, contentType, totalSize } =
      await contextClient.getContentAsBuffer({
        workingMemoryId: workingMemoryId,
        includeMetadata: true,
      });

    if (!buffer) {
      return NextResponse.json(
        { error: 'PDF not found in working memory' },
        { status: 404 }
      );
    }

    const uint8Array = new Uint8Array(buffer);

    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(totalSize || buffer.length),
      },
    });
  } catch (error: any) {
    console.error('[API/download] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to download PDF' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser navigates to `GET /api/reports/download?working_memory_id=wm-abc123&filename=Q3-Report.pdf`.
2. The route creates a `ContextServiceClient` configured with the context service address and API key.
3. `getContentAsBuffer` fetches the file content from working memory. The `includeMetadata: true` flag returns the content type and total size alongside the buffer.
4. If the buffer is null (the working memory ID does not exist or the content was deleted), the route returns a 404.
5. The response is a binary download with appropriate headers:
   - `Content-Type` from the stored metadata (typically `application/pdf`)
   - `Content-Disposition: attachment` triggers a file download in the browser
   - `Content-Length` for progress indicators

### Why `ContextServiceClient`?

Working memory is managed by the context service, a separate infrastructure service from the entity graph. The `ContextServiceClient` speaks the context service protocol and handles authentication, content negotiation, and streaming. Neither `RemoteAgentBundleClient` nor `RemoteEntityClient` can access working memory content directly.

The `working_memory_id` comes from the workflow's return value. When the report workflow completes, it returns an object containing `pdf_working_memory_id`. The history route (Step 3) enriches each report with this return value via `get_node_io`, so the browser has the ID available for download links.

## Step 5: Create the Archive Route

The archive route performs a soft delete on a report entity. The entity remains in the graph but is excluded from `search_nodes_scoped` queries when `archive: false` is specified (as in the history route).

**`apps/report-gui/src/app/api/reports/[id]/archive/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getEntityClient } from '@/lib/serverConfig';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: entityId } = await params;

    const client = getEntityClient();
    await client.archive_node(entityId, true);

    return NextResponse.json({
      success: true,
      entity_id: entityId,
      archived: true,
    });
  } catch (error: any) {
    console.error('[API/archive] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to archive report' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser sends `POST /api/reports/<entity-id>/archive`.
2. The entity ID comes from the dynamic route segment `[id]`.
3. `archive_node(entityId, true)` sets the archive flag on the entity. Passing `false` would un-archive it.
4. The response confirms the operation.

This route uses `RemoteEntityClient` because archiving is a direct entity graph operation. The agent bundle does not need to be involved -- there is no workflow to run, just a metadata update on the entity node.

### Why Soft Delete?

Hard deleting entities from the entity graph would break referential integrity -- child entities, edges, and working memory references would become orphaned. Soft delete (archiving) preserves the full audit trail while hiding the entity from normal queries. If needed, you can query for archived entities by setting `archive: true` in `search_nodes_scoped`.

## Step 6: Test the Complete Flow

Start the Next.js development server and the agent bundle (or port-forward to your cluster), then test each route with curl.

### Test the Invoke Route (Approve)

First, create a report and wait for it to reach the WAITING state (using the SSE progress route from Part 12 or by polling status). Then approve:

```bash
curl -X POST http://localhost:3000/api/reports/invoke \
  -H "Content-Type: application/json" \
  -d '{"entity_id":"<review-step-id>","method_name":"approve","payload":[]}'
```

Expected response:

```json
{
  "success": true
}
```

### Test the Invoke Route (Give Feedback)

Instead of approving, submit feedback to trigger a revision cycle:

```bash
curl -X POST http://localhost:3000/api/reports/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "<review-step-id>",
    "method_name": "giveFeedback",
    "payload": ["Make the title larger and add an executive summary section at the top"]
  }'
```

The workflow will re-run with the feedback. Reconnect to the SSE progress stream to see the new iteration's events.

### Test the History Route

Query completed reports:

```bash
curl http://localhost:3000/api/reports/history?limit=10
```

Expected response:

```json
{
  "reports": [
    {
      "id": "a1b2c3d4-...",
      "specific_type_name": "ReportReviewWorkflowEntity",
      "status": "Completed",
      "created": "2026-02-11T10:30:00Z",
      "data": {
        "wrappedEntityArgs": {
          "prompt": "Create an executive summary",
          "orientation": "portrait"
        },
        "currentVersion": 1
      },
      "return_value": {
        "pdf_working_memory_id": "wm-abc123-...",
        "reasoning": "I structured the report with...",
        "html_content": "<!DOCTYPE html>..."
      },
      "progress": [...]
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

With pagination:

```bash
curl "http://localhost:3000/api/reports/history?limit=5&offset=5"
```

### Test the Download Route

Use the `pdf_working_memory_id` from the history response to download a PDF:

```bash
curl -o report.pdf \
  "http://localhost:3000/api/reports/download?working_memory_id=wm-abc123-...&filename=Q3-Report.pdf"
```

The file is saved as `report.pdf`. Open it to verify the generated report content.

### Test the Archive Route

Archive a completed report:

```bash
curl -X POST http://localhost:3000/api/reports/a1b2c3d4-.../archive
```

Expected response:

```json
{
  "success": true,
  "entity_id": "a1b2c3d4-...",
  "archived": true
}
```

Verify that the archived report no longer appears in history:

```bash
curl http://localhost:3000/api/reports/history?limit=10
```

The report should be absent from the results because the history route filters with `archive: false`.

### Validate Input Handling

Test the invoke route with missing fields:

```bash
# Missing method_name -- should return 400
curl -s -X POST http://localhost:3000/api/reports/invoke \
  -H "Content-Type: application/json" \
  -d '{"entity_id":"abc-123"}' | jq .
```

```json
{
  "error": "entity_id and method_name are required"
}
```

Test the download route with a missing working memory ID:

```bash
# Missing working_memory_id -- should return 400
curl -s "http://localhost:3000/api/reports/download" | jq .
```

```json
{
  "error": "working_memory_id is required"
}
```

## Key Takeaways

1. **The invoke route is a thin generic proxy** -- It forwards entity method calls by name without encoding knowledge of the review protocol. This keeps the BFF simple and extensible. Any new entity method (not just approve and giveFeedback) works without a new route.
2. **Feedback requires reconnect-before-send** -- Open the SSE progress stream before calling `giveFeedback`. This prevents a race condition where the workflow emits events that no listener captures.
3. **Three client types serve three services** -- `RemoteAgentBundleClient` talks to the agent bundle (method invocation), `RemoteEntityClient` talks to the entity service (graph queries, archiving), and `ContextServiceClient` talks to the context service (file downloads from working memory).
4. **`search_nodes_scoped` is the entity graph query API** -- Filter by entity type, status, and archive flag. Sort by creation time. Paginate with page and size. This is how you build list views, dashboards, and admin panels.
5. **Soft delete preserves the audit trail** -- `archive_node` sets a flag without removing data. Archived entities are excluded from queries by default but can be retrieved if needed.
6. **Working memory IDs flow through entity return values** -- The workflow returns `pdf_working_memory_id` in its result. The history route retrieves it via `get_node_io`. The download route uses it to fetch the file from the context service. This chain connects entity graph data to file storage without coupling the two systems.

## Series Complete

Over 13 parts, you have built a complete document-to-report generation system from scratch -- from a single entity that stores text to a production-deployed pipeline with human review, real-time progress streaming, and a consumer backend.

### What You Built

**Parts 1--10: The Agent Bundle**

| Part | What You Built |
|------|---------------|
| 1 | A `TextDocumentEntity` that stores and retrieves text |
| 2 | A `ReportGenerationBot` that summarizes text using an LLM |
| 3 | A `ReportGenerationPrompt` with conditional layout logic |
| 4 | File storage with `WorkingMemoryProvider` |
| 5 | Document processing pipeline with `DocProcClient` |
| 6 | Multi-entity orchestration with `appendOrRetrieveCall` and `yield*` |
| 7 | Structured output with `StructuredOutputBotMixin` and Zod validation |
| 8 | Human review with `ReviewableEntity`, `FeedbackBotMixin`, and the config column |
| 9 | REST API endpoints with `@ApiEndpoint` and `acceptsBlobs` |
| 10 | Deployment with `ff ops` and end-to-end verification |

**Parts 11--13: The Consumer Backend**

| Part | What You Built |
|------|---------------|
| 11 | BFF setup with `RemoteAgentBundleClient`, create and status routes |
| 12 | SSE progress streaming with real-time event forwarding |
| 13 | Review interaction, report history, PDF download, and archiving |

### The Three Client Types

The consumer backend uses three distinct SDK client types, each connecting to a different FireFoundry service:

```
Browser
  |
  v
Next.js BFF (API Routes)
  |
  |-- RemoteAgentBundleClient  -->  Agent Bundle Server
  |     create, status, invoke       (your code from Parts 1-10)
  |
  |-- RemoteEntityClient       -->  Entity Service
  |     search, get IO, archive      (FireFoundry infrastructure)
  |
  |-- ContextServiceClient     -->  Context Service
        download files               (FireFoundry infrastructure)
```

- **`RemoteAgentBundleClient`** is for operations that need your application logic -- creating reports (which triggers the workflow), checking status (which reads from your custom endpoint), and invoking entity methods (which dispatches to entity instances running in your bundle).
- **`RemoteEntityClient`** is for direct entity graph operations that do not require application logic -- searching for entities by type and status, reading entity IO (return values), and archiving.
- **`ContextServiceClient`** is for file operations in working memory -- downloading PDFs and other stored documents.

### Key Patterns

These patterns recur throughout the series and apply to any FireFoundry application:

- **Entity-Bot-Prompt separation** -- Entities manage state and workflow. Bots manage LLM interaction. Prompts manage text generation. Each layer is independently composable and testable.
- **The config column for system metadata** -- User data goes in `data`. Framework metadata (feedback, version, previous result) goes in `config`. Mixins read from config automatically.
- **Named nodes for idempotency** -- `appendOrRetrieveCall` with a unique name means interrupted workflows resume from where they stopped, and every iteration is preserved as an audit trail.
- **BFF as a thin proxy** -- The consumer backend validates inputs and forwards requests. It does not duplicate business logic from the agent bundle.
- **Reconnect-before-action for streaming** -- When an action will trigger new events, establish the stream connection before triggering the action.

### Where to Go From Here

- **[API Reference](../../api-reference/README.md)** -- Complete reference for all SDK classes and decorators
- **[Core Concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md)** -- Deeper dive into the Entity-Bot-Prompt architecture
- **[ff-demo-report-generator](https://github.com/firebrandanalytics/ff-demo-report-generator)** -- The complete source code for this tutorial
- **Build your own** -- Use `ff application create` and `ff agent-bundle create` to start a new project from scratch
