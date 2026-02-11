# Part 11: Building the Consumer Backend

In this part, you'll build a Backend-for-Frontend (BFF) layer using Next.js API routes. This layer sits between the browser and the agent bundle you deployed in Parts 1--10, handling concerns like authentication, CORS, service discovery, and error normalization so that your front-end code never talks directly to the agent bundle.

**What you'll learn:**
- Why a BFF layer is necessary between a GUI and an agent bundle
- Setting up `@firebrandanalytics/ff-sdk` in a Next.js project
- Initializing `RemoteAgentBundleClient` and `RemoteEntityClient` with server-side configuration
- Creating a `POST /api/reports/create` route that forwards file uploads to the agent bundle
- Creating a `GET /api/reports/status` route that proxies status queries
- Testing the routes with curl

**What you'll build:** Two Next.js API routes that proxy browser requests to the agent bundle's `create-report` and `report-status` endpoints.

## Key Concepts

### Why a Backend-for-Frontend?

Your agent bundle (from Parts 1--10) exposes raw API endpoints:

- `POST /api/create-report` (with `acceptsBlobs`) -- creates an entity, stores a document, and starts the workflow
- `GET /api/report-status` -- returns entity status and data

A browser **could** call these directly, but that creates several problems:

1. **Authentication** -- The agent bundle lives behind a Kong gateway that requires API keys. You cannot expose API keys in browser JavaScript.
2. **CORS** -- The bundle is a Kubernetes service, often on a different domain. Cross-origin requests require explicit CORS configuration or a same-origin proxy.
3. **Service discovery** -- The bundle URL depends on the deployment environment (local port-forward, staging gateway, production gateway). The browser should not need to know these details.
4. **Error normalization** -- The agent bundle returns raw error messages. A BFF can translate them into consistent, user-friendly responses.
5. **Request shaping** -- The BFF can add default values, transform payloads, or enrich requests with server-side context before forwarding to the bundle.

The BFF pattern solves all of these: the browser talks to Next.js API routes on the same origin, and the API routes talk to the agent bundle using server-side credentials.

```
Browser (React)
    |
    |-- POST /api/reports/create (FormData with file)
    |-- GET  /api/reports/status?entity_id=...
    |
    v
Next.js API Routes (BFF)              <-- This part
    |
    |-- RemoteAgentBundleClient.call_api_endpoint_with_blobs()
    |-- RemoteAgentBundleClient.call_api_endpoint()
    |
    v
Agent Bundle (Parts 1-10)
    |
    |-- POST /api/create-report
    |-- GET  /api/report-status
```

### The ff-sdk Client Library

The `@firebrandanalytics/ff-sdk` package provides two client classes for server-side communication with FireFoundry services:

- **`RemoteAgentBundleClient`** -- Connects to an agent bundle server. Constructor takes the bundle URL.
  - `call_api_endpoint(route, options)` -- Calls JSON API endpoints (GET/POST)
  - `call_api_endpoint_with_blobs(route, args, files, options)` -- Calls `acceptsBlobs` endpoints with file uploads. Args use `{ $blob: N }` placeholders to reference files by index.
  - `invoke_entity_method(entityId, method, payload)` -- Invokes entity methods directly
  - `start_iterator(entityId, method, args)` -- Starts a streaming iterator

- **`RemoteEntityClient`** -- Connects to the entity service for direct entity graph operations. Constructor takes baseUrl, appId, and options.
  - `search_nodes_scoped(filter, sort, pagination)` -- Search the entity graph
  - `get_node_io(entityId)` -- Get entity input/output
  - `archive_node(entityId, flag)` -- Soft delete an entity

In this part, you will primarily use `RemoteAgentBundleClient` because the consumer backend proxies requests to the agent bundle's custom API endpoints (which internally handle entity graph operations). `RemoteEntityClient` becomes useful in Part 12 when building features like report listing and deletion that query the entity graph directly.

### The Blob Placeholder Convention

When calling `call_api_endpoint_with_blobs`, file arguments use placeholder objects to reference files by their position in the files array:

```typescript
client.call_api_endpoint_with_blobs(
  'create-report',
  [{ $blob: 0 }, { prompt, orientation }],  // args array
  [buffer]                                    // files array
);
```

`{ $blob: 0 }` tells the SDK: "Replace this argument with the first file from the files array." If you had two files, you would use `{ $blob: 0 }` and `{ $blob: 1 }`. The remaining arguments in the args array are serialized as JSON.

## Step 1: Set Up the Next.js Project and Install ff-sdk

Create the consumer GUI application inside the monorepo:

```bash
cd report-generator
npx create-next-app@latest apps/report-gui \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*"
```

Install the FireFoundry SDK:

```bash
cd apps/report-gui
pnpm add @firebrandanalytics/ff-sdk
```

Update the workspace configuration so pnpm recognizes the new app.

**`pnpm-workspace.yaml`**:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Your project structure now looks like this:

```
report-generator/
├── apps/
│   ├── report-bundle/          # Agent bundle (Parts 1-10)
│   └── report-gui/             # Consumer backend + GUI (this part)
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/        # API routes (BFF layer)
│       │   │   └── page.tsx    # GUI (Part 12)
│       │   └── lib/            # Server-side utilities
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared-types/           # Shared type definitions
└── firefoundry.json
```

Add a path alias for the shared types package so you can import from `@shared/types`.

**`apps/report-gui/tsconfig.json`** -- add to `compilerOptions.paths`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@shared/types": ["../../packages/shared-types/src"]
    }
  }
}
```

## Step 2: Configure Server-Side Clients

Create a server configuration module that initializes the SDK clients as singletons. This file runs only on the server (inside Next.js API routes), never in the browser.

**`apps/report-gui/src/lib/serverConfig.ts`**:

```typescript
import {
  RemoteAgentBundleClient,
  RemoteEntityClient
} from '@firebrandanalytics/ff-sdk';

// Agent Bundle ID (must match the APP_ID in agent-bundle.ts)
export const AGENT_BUNDLE_ID = '1ba3a4a6-4df4-49b5-9291-c0bacfe46201';

// Client mode: 'external' for Kong Gateway, 'internal' for direct K8s service access
export type EntityClientMode = 'external' | 'internal';
export const ENTITY_CLIENT_MODE: EntityClientMode =
  (process.env.ENTITY_CLIENT_MODE as EntityClientMode) || 'external';

// Kong Gateway Configuration (for external mode)
export const GATEWAY_FULL_URL =
  process.env.GATEWAY_BASE_URL || 'http://localhost:8000';

const parseGatewayUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return {
      baseUrl: `${parsed.protocol}//${parsed.hostname}`,
      port: parsed.port ? parseInt(parsed.port) : 8000,
    };
  } catch {
    return { baseUrl: 'http://localhost', port: 8000 };
  }
};

const { baseUrl: GATEWAY_HOST, port: GATEWAY_PORT } =
  parseGatewayUrl(GATEWAY_FULL_URL);

export const API_KEY = process.env.FIREFOUNDRY_API_KEY || 'placeholder';
export const NAMESPACE = process.env.NAMESPACE || 'ff-dev';
export const ENTITY_SERVICE_HOST =
  process.env.ENTITY_SERVICE_HOST || 'http://entity-service';
export const ENTITY_SERVICE_PORT = parseInt(
  process.env.ENTITY_SERVICE_PORT || '8080'
);

// Agent Bundle URL
// Priority: explicit BUNDLE_URL > NEXT_PUBLIC_BUNDLE_URL > derived from gateway
export const AGENT_BUNDLE_URL =
  process.env.BUNDLE_URL ||
  process.env.NEXT_PUBLIC_BUNDLE_URL ||
  `${GATEWAY_FULL_URL}/agents/${NAMESPACE}/report-bundle`;

// Entity client config -- switches between internal (K8s) and external (gateway)
export const ENTITY_CLIENT_CONFIG =
  ENTITY_CLIENT_MODE === 'internal'
    ? {
        baseUrl: ENTITY_SERVICE_HOST,
        appId: AGENT_BUNDLE_ID,
        options: {
          mode: 'internal' as const,
          internal_port: ENTITY_SERVICE_PORT,
        },
      }
    : {
        baseUrl: GATEWAY_HOST,
        appId: AGENT_BUNDLE_ID,
        options: {
          mode: 'external' as const,
          api_key: API_KEY,
          namespace: NAMESPACE,
          external_port: GATEWAY_PORT,
        },
      };

// --- Singleton client instances ---

let agentBundleClientInstance: RemoteAgentBundleClient | null = null;
let entityClientInstance: RemoteEntityClient | null = null;

export function getAgentBundleClient(): RemoteAgentBundleClient {
  if (!agentBundleClientInstance) {
    agentBundleClientInstance = new RemoteAgentBundleClient(AGENT_BUNDLE_URL);
  }
  return agentBundleClientInstance;
}

export function getEntityClient(): RemoteEntityClient {
  if (!entityClientInstance) {
    entityClientInstance = new RemoteEntityClient(
      ENTITY_CLIENT_CONFIG.baseUrl,
      ENTITY_CLIENT_CONFIG.appId,
      ENTITY_CLIENT_CONFIG.options
    );
  }
  return entityClientInstance;
}
```

**How it works:**

- **`AGENT_BUNDLE_ID`** must match the `APP_ID` in your agent bundle's `agent-bundle.ts` from Part 1.
- **`EntityClientMode`** controls how the entity client connects. In development with port-forwarding, use `'external'` to go through the Kong gateway. In production where the GUI runs inside the same Kubernetes cluster, use `'internal'` for direct service-to-service communication.
- **`parseGatewayUrl`** extracts the host and port from the gateway URL so they can be passed separately to `RemoteEntityClient`.
- **Singleton pattern** -- `getAgentBundleClient()` and `getEntityClient()` create their instances on first call and reuse them for the lifetime of the Node.js process. This avoids creating a new HTTP connection per request.

Create a `.env.local` file for development:

**`apps/report-gui/.env.local`**:

```bash
# Kong gateway URL (local port-forward or remote)
GATEWAY_BASE_URL=http://localhost:8000

# API key for Kong gateway authentication
FIREFOUNDRY_API_KEY=your-api-key-here

# Namespace where the agent bundle is deployed
NAMESPACE=ff-dev

# Optional: direct bundle URL (overrides gateway-derived URL)
# BUNDLE_URL=http://localhost:3001
```

## Step 3: Create the Create-Report Route

This route accepts `FormData` from the browser (with a file and form fields), converts it into the format the agent bundle expects, and forwards the request using `call_api_endpoint_with_blobs`.

**`apps/report-gui/src/app/api/reports/create/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAgentBundleClient } from '@/lib/serverConfig';
import type { CreateReportResponse } from '@shared/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const client = getAgentBundleClient();

  try {
    // 1. Parse the incoming FormData from the browser
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const prompt = formData.get('prompt') as string;
    const orientation =
      (formData.get('orientation') as string) || 'portrait';

    // 2. Validate inputs
    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (!['portrait', 'landscape'].includes(orientation)) {
      return NextResponse.json(
        { error: 'Invalid orientation' },
        { status: 400 }
      );
    }

    if (!file || file.size === 0) {
      return NextResponse.json(
        { error: 'A document file is required' },
        { status: 400 }
      );
    }

    // 3. Convert the File to a Buffer for the SDK
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Forward to the agent bundle's acceptsBlobs endpoint
    const response =
      await client.call_api_endpoint_with_blobs<CreateReportResponse>(
        'create-report',
        [{ $blob: 0 }, { prompt, orientation }],
        [buffer]
      );

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[API] Create report failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create report' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser sends a `FormData` request with three fields: `file` (the document), `prompt` (the user's instruction), and `orientation` (portrait or landscape).
2. The route validates all inputs before making any remote calls. This prevents unnecessary network round-trips for obviously invalid requests.
3. The `File` object from `FormData` is converted to a `Buffer` because the SDK's `call_api_endpoint_with_blobs` expects `Buffer` arguments for file data.
4. The key line is `call_api_endpoint_with_blobs('create-report', [{ $blob: 0 }, { prompt, orientation }], [buffer])`:
   - `'create-report'` is the route name matching the `@ApiEndpoint` decorator on the agent bundle (Part 9).
   - `[{ $blob: 0 }, { prompt, orientation }]` is the args array. `{ $blob: 0 }` is a placeholder that the SDK replaces with the first file from the files array. The second element is the JSON body.
   - `[buffer]` is the files array containing the document buffer.
5. The agent bundle's `createReport` method receives the buffer as its first argument and the JSON body as its second (as you built in Part 9).

### Why `export const dynamic = 'force-dynamic'`?

Next.js aggressively caches route responses by default. `force-dynamic` tells Next.js that this route produces different results for every request and should never be cached. Without it, Next.js might serve a cached response from a previous report creation.

## Step 4: Create the Report-Status Route

This route proxies status queries from the browser to the agent bundle's `report-status` endpoint.

**`apps/report-gui/src/app/api/reports/status/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAgentBundleClient } from '@/lib/serverConfig';
import type { ReportStatusResponse } from '@shared/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const client = getAgentBundleClient();

  try {
    // 1. Extract the entity_id from query parameters
    const searchParams = request.nextUrl.searchParams;
    const entityId = searchParams.get('entity_id');

    if (!entityId) {
      return NextResponse.json(
        { error: 'entity_id query parameter is required' },
        { status: 400 }
      );
    }

    // 2. Forward to the agent bundle's report-status endpoint
    const response = await client.call_api_endpoint('report-status', {
      method: 'GET',
      query: { entity_id: entityId },
    });

    return NextResponse.json(response as ReportStatusResponse);
  } catch (error: any) {
    console.error('[API] Get status failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get report status' },
      { status: 500 }
    );
  }
}
```

**How it works:**

1. The browser calls `GET /api/reports/status?entity_id=abc-123`.
2. The route extracts `entity_id` from the query string and validates it.
3. `call_api_endpoint('report-status', { method: 'GET', query: { entity_id: entityId } })` forwards the request to the agent bundle's `GET /api/report-status` endpoint. The `query` object is serialized as URL query parameters.
4. The agent bundle's `getReportStatus` method (Part 9) retrieves the entity from the entity graph and returns its status and data.
5. The route passes the response through to the browser.

Notice the difference between the two SDK methods:
- `call_api_endpoint_with_blobs` -- for endpoints that accept file uploads (`acceptsBlobs: true`)
- `call_api_endpoint` -- for standard JSON endpoints (GET or POST)

## Step 5: Test with curl

Start the Next.js development server:

```bash
cd apps/report-gui
pnpm dev
```

The server starts on `http://localhost:3000` by default.

### Test Report Creation

Upload a file and create a report:

```bash
curl -X POST http://localhost:3000/api/reports/create \
  -F "file=@document.pdf" \
  -F "prompt=Create an executive summary highlighting key metrics and trends" \
  -F "orientation=portrait"
```

Expected response:

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

If you do not have a PDF handy, create a simple text file:

```bash
echo "Q3 2025 Revenue Report. Total revenue: $2.4M. Growth: 15% YoY." > sample.txt

curl -X POST http://localhost:3000/api/reports/create \
  -F "file=@sample.txt" \
  -F "prompt=Create an executive summary" \
  -F "orientation=portrait"
```

Save the entity ID for the next test:

```bash
export ENTITY_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### Test Input Validation

Verify that the BFF validates inputs before forwarding to the agent bundle:

```bash
# Missing prompt -- should return 400
curl -s http://localhost:3000/api/reports/create \
  -F "file=@sample.txt" \
  -F "orientation=portrait" | jq .

# Missing file -- should return 400
curl -s -X POST http://localhost:3000/api/reports/create \
  -F "prompt=Test" \
  -F "orientation=portrait" | jq .

# Invalid orientation -- should return 400
curl -s -X POST http://localhost:3000/api/reports/create \
  -F "file=@sample.txt" \
  -F "prompt=Test" \
  -F "orientation=diagonal" | jq .
```

### Test Status Polling

Check the status of the report you created:

```bash
curl "http://localhost:3000/api/reports/status?entity_id=$ENTITY_ID"
```

Expected response (immediately after creation):

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "Pending",
  "data": {
    "wrappedEntityArgs": {
      "prompt": "Create an executive summary",
      "orientation": "portrait",
      "original_document_wm_id": "wm-1234-..."
    }
  }
}
```

After the workflow completes (and the review step is approved), the status changes:

```json
{
  "entity_id": "a1b2c3d4-...",
  "status": "Completed",
  "data": {
    "wrappedEntityArgs": {
      "prompt": "Create an executive summary",
      "orientation": "portrait",
      "original_document_wm_id": "wm-1234-..."
    },
    "currentVersion": 0
  }
}
```

### Test Missing entity_id

```bash
curl -s "http://localhost:3000/api/reports/status" | jq .
```

```json
{
  "error": "entity_id query parameter is required"
}
```

## What You've Built

You now have:
- A `serverConfig.ts` module that initializes `RemoteAgentBundleClient` and `RemoteEntityClient` as singletons with environment-based configuration
- A `POST /api/reports/create` route that accepts `FormData` from the browser, validates inputs, and forwards the file to the agent bundle using `call_api_endpoint_with_blobs`
- A `GET /api/reports/status` route that proxies entity status queries to the agent bundle using `call_api_endpoint`
- Input validation at the BFF layer that catches invalid requests before they reach the agent bundle
- A clean separation: the browser knows nothing about the agent bundle URL, API keys, or the blob placeholder protocol

## Key Takeaways

1. **The BFF layer solves real problems** -- Authentication, CORS, service discovery, and error normalization all belong in a server-side proxy, not in browser code.
2. **`RemoteAgentBundleClient` is your primary proxy tool** -- Use `call_api_endpoint` for JSON endpoints and `call_api_endpoint_with_blobs` for file uploads. Both map directly to the `@ApiEndpoint` routes you built in Part 9.
3. **Blob placeholders bridge the format gap** -- The browser sends standard `FormData`. The BFF converts it to `Buffer` and uses `{ $blob: 0 }` placeholders so the SDK can reconstruct the multipart request for the agent bundle.
4. **Validate early, forward late** -- Check inputs in the BFF before making network calls to the agent bundle. This saves a round-trip and provides faster error responses.
5. **Singleton clients avoid connection overhead** -- `getAgentBundleClient()` and `getEntityClient()` create one instance per process. In a serverless environment like Vercel, this means one instance per cold start.
6. **`RemoteEntityClient` is for direct entity graph access** -- You configured it in this part but will use it in Part 12 for features like listing and archiving reports that bypass the agent bundle's API endpoints.

## Next Step

In [Part 12: Real-Time Progress Streaming](./part-12-progress-streaming.md), you'll build an SSE endpoint that bridges the agent bundle's async iterator to the browser, then create a client-side hook that consumes the stream and drives a real-time progress display.
