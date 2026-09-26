# Frontend Development Guide for FireFoundry Agent Bundles

## Overview

This guide helps coding agents build frontends for FireFoundry agent bundle systems. FireFoundry provides **official SDK clients** that handle authentication, retries, error handling, and network complexity—you should use these instead of generic HTTP clients like axios or fetch.

### What You're Building

You're building a **frontend** that connects to one or more **agent bundles** (backend services). Agent bundles:

- Expose HTTP endpoints via `@ApiEndpoint` decorators
- Manage entities in a graph database
- Run AI-powered workflows
- Are deployed to Kubernetes and accessed through Kong Gateway (production) or directly (development)

### Key Principle: Use Official FireFoundry Clients

**DO NOT** use generic HTTP clients like `axios` or `fetch` directly to call agent bundles. Instead, use the official FireFoundry SDK clients:

- **`RemoteAgentBundleClient`** - For calling agent bundle API endpoints
- **`RemoteEntityClient`** - For querying the entity graph

These clients are located in `@firebrandanalytics/ff-sdk`.

---

## Installation

```bash
npm install @firebrandanalytics/ff-sdk
# or
pnpm add @firebrandanalytics/ff-sdk
```

**Import Statement:**

```typescript
import {
  RemoteAgentBundleClient,
  RemoteEntityClient,
} from "@firebrandanalytics/ff-sdk";
```

---

## The Two Client Types

### 1. RemoteAgentBundleClient

**Purpose:** Call agent bundle API endpoints (methods decorated with `@ApiEndpoint`)

**When to Use:**

- Creating new entities or workflows
- Calling custom API endpoints defined in agent bundles
- Invoking entity methods (RPC-style)
- Uploading files to agent bundles
- Starting long-running operations with streaming

**Example Use Cases:**

- `POST /create-report` - Create a new report entity
- `POST /analyze-article` - Trigger an analysis workflow
- `POST /upload-document` - Upload a file for processing
- `GET /get-status` - Check workflow status

### 2. RemoteEntityClient

**Purpose:** Query and manipulate the entity graph (database of application objects)

**When to Use:**

- Searching for entities by type, status, or other criteria
- Retrieving entity details
- Traversing entity relationships
- Updating entity data
- Pagination through lists of entities

**Example Use Cases:**

- `search_nodes_scoped()` - Find all ReportEntity instances
- `get_node()` - Get details of a specific entity
- `get_node_edges_from()` - Get entities connected to this one
- `update_node_data()` - Update entity properties

---

## Architecture Pattern: Next.js API Routes as Proxy

**Important:** In Next.js applications, you should **NOT** use these clients directly in client-side components. Instead:

1. **Create Next.js API routes** (`src/app/api/.../route.ts`) that use the clients server-side
2. **Call those API routes** from your React components using standard fetch or SWR

This pattern:

- Keeps API keys and sensitive configuration server-side
- Allows you to add authentication, rate limiting, and other middleware
- Provides a clean separation between frontend and backend concerns

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Architecture                      │
└─────────────────────────────────────────────────────────────┘

React Component (Client-side)
    ↓ fetch('/api/reports/create')
Next.js API Route (Server-side)
    ↓ getAgentBundleClient().call_api_endpoint(...)
RemoteAgentBundleClient
    ↓ HTTP/HTTPS
Kong Gateway (Production) or Direct Service (Development)
    ↓
Agent Bundle Service
```

---

## Setting Up Clients

### Step 1: Create Server Configuration File

Create `src/lib/serverConfig.ts` (or similar) to centralize client configuration:

```typescript
/**
 * Server-side configuration for SDK clients
 * Centralized configuration for RemoteAgentBundleClient and RemoteEntityClient
 * Supports both external (Kong Gateway) and internal (Kubernetes cluster) modes
 */

// Agent Bundle ID (from your agent-bundle.ts file)
// This is the UUID that identifies your agent bundle
export const AGENT_BUNDLE_ID = "your-bundle-uuid-here";

// Client mode: 'external' for Kong Gateway, 'internal' for direct K8s service access
export type EntityClientMode = "external" | "internal";
export const ENTITY_CLIENT_MODE: EntityClientMode =
  (process.env.ENTITY_CLIENT_MODE as EntityClientMode) || "external";

// Kong Gateway Configuration (for external mode)
export const GATEWAY_FULL_URL =
  process.env.GATEWAY_BASE_URL || "http://localhost:8000";

// Parse the gateway URL to separate host and port
const parseGatewayUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return {
      baseUrl: `${parsed.protocol}//${parsed.hostname}`,
      port: parsed.port ? parseInt(parsed.port) : 8000,
    };
  } catch {
    return { baseUrl: "http://localhost", port: 8000 };
  }
};

const { baseUrl: GATEWAY_HOST, port: GATEWAY_PORT } =
  parseGatewayUrl(GATEWAY_FULL_URL);

// API Key for external access through Kong
export const API_KEY = process.env.FIREFOUNDRY_API_KEY || "placeholder";

// Namespace (environment)
export const NAMESPACE = process.env.NAMESPACE || "ff-dev";

// Internal entity service configuration (for internal mode)
export const ENTITY_SERVICE_HOST =
  process.env.ENTITY_SERVICE_HOST || "http://entity-service";
export const ENTITY_SERVICE_PORT = parseInt(
  process.env.ENTITY_SERVICE_PORT || "8080"
);

// Agent Bundle URL (can be internal K8s service or external Kong route)
export const AGENT_BUNDLE_URL =
  process.env.BUNDLE_URL ||
  process.env.NEXT_PUBLIC_BUNDLE_URL ||
  `${GATEWAY_FULL_URL}/agents/${NAMESPACE}/your-bundle-name`;

/**
 * Remote Entity Client Configuration
 * Supports both external (through Kong) and internal (direct K8s service) modes
 */
export const ENTITY_CLIENT_CONFIG =
  ENTITY_CLIENT_MODE === "internal"
    ? {
        // Internal mode: Direct access to entity-service within K8s cluster
        baseUrl: ENTITY_SERVICE_HOST,
        appId: AGENT_BUNDLE_ID,
        options: {
          mode: "internal" as const,
          internal_port: ENTITY_SERVICE_PORT,
        },
      }
    : {
        // External mode: Access through Kong Gateway
        baseUrl: GATEWAY_HOST,
        appId: AGENT_BUNDLE_ID,
        options: {
          mode: "external" as const,
          api_key: API_KEY,
          namespace: NAMESPACE,
          external_port: GATEWAY_PORT,
        },
      };

// ============================================================================
// Singleton Client Instances (lazy initialization)
// ============================================================================

import {
  RemoteAgentBundleClient,
  RemoteEntityClient,
} from "@firebrandanalytics/ff-sdk";

let agentBundleClientInstance: RemoteAgentBundleClient | null = null;
let entityClientInstance: RemoteEntityClient | null = null;

/**
 * Get singleton RemoteAgentBundleClient instance
 * Lazy initialization ensures client is created only when first needed
 */
export function getAgentBundleClient(): RemoteAgentBundleClient {
  if (!agentBundleClientInstance) {
    agentBundleClientInstance = new RemoteAgentBundleClient(AGENT_BUNDLE_URL, {
      api_key: API_KEY, // Optional but recommended for Kong
      timeout: 200000, // 200 seconds default
    });
  }
  return agentBundleClientInstance;
}

/**
 * Get singleton RemoteEntityClient instance
 * Lazy initialization ensures client is created only when first needed
 */
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

### Step 2: Environment Variables

Create `.env.local` (for Next.js) with these variables:

```bash
# Gateway Configuration (for external mode)
GATEWAY_BASE_URL=http://localhost:8000
FIREFOUNDRY_API_KEY=your-api-key-here
NAMESPACE=ff-dev

# OR for internal mode (when running in same K8s cluster)
ENTITY_CLIENT_MODE=internal
ENTITY_SERVICE_HOST=http://entity-service
ENTITY_SERVICE_PORT=8080

# Agent Bundle URL (optional, defaults to gateway + namespace + bundle name)
BUNDLE_URL=http://localhost:8000/agents/ff-dev/your-bundle-name
```

---

## Configuring values.local.yaml for Kubernetes Deployment

When deploying your GUI to Kubernetes, you need to configure `values.local.yaml` in your GUI's directory (`apps/your-web-ui/values.local.yaml`). This file contains environment variables that will be injected into your deployed GUI pods.

### Key Configuration Values

Configure `values.local.yaml` with these values:

```yaml
configMap:
  enabled: true
  data:
    # Use internal mode for entity client (direct K8s service access)
    ENTITY_CLIENT_MODE: "internal"

    # Agent Bundle URL - See discovery steps below
    BUNDLE_URL: "http://<service-name>:3000" # or FQDN if cross-namespace

    # Entity Service - Internal Kubernetes service
    ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"
    ENTITY_SERVICE_PORT: "8080"

    # General configuration
    NODE_ENV: "production"
    WEBSITE_HOSTNAME: "dev"
```

### Discovering Agent Bundle Service Details

**Step 1: Find the Agent Bundle Service Name**

The agent bundle service name follows this pattern: `{bundle-name}-agent-bundle`

```bash
# List services in the agent bundle's namespace (typically ff-dev)
kubectl get svc -n ff-dev | grep <bundle-name>

# Example output:
# NAME                          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
# math-word-solver-agent-bundle ClusterIP   10.96.xxx.xxx   <none>        3000/TCP
```

**Step 2: Determine Namespace Strategy**

You need to know:

- What namespace the agent bundle is deployed in (e.g., `ff-dev`)
- What namespace the GUI will be deployed to (could be same or different)

```bash
# Check what namespace the agent bundle is in
kubectl get svc <bundle-name>-agent-bundle --all-namespaces

# Decide:
# - Same namespace = simpler configuration (short DNS)
# - Different namespace = requires FQDN
```

**Step 3: Configure BUNDLE_URL**

**Option A: Same Namespace (Recommended for Local Development)**

If GUI and agent bundle are in the same namespace (e.g., both in `ff-dev`):

```yaml
configMap:
  data:
    BUNDLE_URL: "http://{bundle-name}-agent-bundle:3000"
```

**Example:**

```yaml
BUNDLE_URL: "http://math-word-solver-agent-bundle:3000"
```

**Option B: Different Namespaces**

If GUI is in a different namespace (e.g., GUI in `ff-apps`, agent bundle in `ff-dev`):

```yaml
configMap:
  data:
    BUNDLE_URL: "http://{bundle-name}-agent-bundle.{agent-bundle-namespace}.svc.cluster.local:3000"
```

**Example:**

```yaml
BUNDLE_URL: "http://math-word-solver-agent-bundle.ff-dev.svc.cluster.local:3000"
```

### Configuration Steps

When configuring `values.local.yaml`, follow these steps:

1. **Discover the agent bundle service:**

   ```bash
   kubectl get svc -n ff-dev | grep <bundle-name>
   ```

2. **Determine namespace strategy:**

   - Check what namespace the agent bundle is in
   - Decide what namespace to deploy the GUI to (same or different)
   - If same namespace: use short DNS format
   - If different namespace: use FQDN format

3. **Set BUNDLE_URL accordingly:**

   - **Same namespace**: `http://{bundle-name}-agent-bundle:3000`
   - **Different namespace**: `http://{bundle-name}-agent-bundle.{namespace}.svc.cluster.local:3000`

4. **Set other required values:**
   - `ENTITY_CLIENT_MODE: "internal"` (for cluster-internal access)
   - `ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"`
   - `ENTITY_SERVICE_PORT: "8080"`
   - `NODE_ENV: "production"`

### Complete Example values.local.yaml

**For Same Namespace Deployment:**

```yaml
configMap:
  enabled: true
  data:
    ENTITY_CLIENT_MODE: "internal"
    BUNDLE_URL: "http://math-word-solver-agent-bundle:3000"
    ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"
    ENTITY_SERVICE_PORT: "8080"
    NODE_ENV: "production"
    WEBSITE_HOSTNAME: "dev"
```

**For Cross-Namespace Deployment:**

```yaml
configMap:
  enabled: true
  data:
    ENTITY_CLIENT_MODE: "internal"
    BUNDLE_URL: "http://math-word-solver-agent-bundle.ff-dev.svc.cluster.local:3000"
    ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"
    ENTITY_SERVICE_PORT: "8080"
    NODE_ENV: "production"
    WEBSITE_HOSTNAME: "dev"
```

### Important Notes

- **Service Name Pattern**: Always `{bundle-name}-agent-bundle` (Helm release name + `-agent-bundle`)
- **Port**: Usually `3000` (verify with `kubectl get svc`)
- **Namespace Discovery**: Use `kubectl get svc --all-namespaces` to find where the agent bundle is deployed
- **Default Strategy**: For local development, deploying to the same namespace (`ff-dev`) is recommended for simplicity

---

## Common Patterns

### Pattern 1: Creating Entities via Agent Bundle API

**Use Case:** User submits a form to create a new report/workflow/item

**Next.js API Route:**

```typescript
// src/app/api/reports/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAgentBundleClient } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const client = getAgentBundleClient();
  try {
    const body = await request.json();

    // Validate input
    if (!body.prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // Call agent bundle endpoint
    const response = await client.call_api_endpoint("create-report", {
      method: "POST",
      body,
    });

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[API] Create report failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create report" },
      { status: 500 }
    );
  }
}
```

**React Component:**

```typescript
// src/components/CreateReportForm.tsx
"use client";

export function CreateReportForm() {
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const data = {
      prompt: formData.get("prompt"),
      orientation: formData.get("orientation"),
    };

    const response = await fetch("/api/reports/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(`Error: ${error.error}`);
      return;
    }

    const result = await response.json();
    console.log("Report created:", result);
  };

  return <form onSubmit={handleSubmit}>{/* form fields */}</form>;
}
```

### Pattern 2: Uploading Files

**Use Case:** User uploads a document for processing

**Next.js API Route:**

```typescript
// src/app/api/reports/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAgentBundleClient } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const client = getAgentBundleClient();
  try {
    const formData = await request.formData();
    const entityId = formData.get("entity_id") as string;
    const file = formData.get("file") as File;

    if (!entityId || !file) {
      return NextResponse.json(
        { error: "entity_id and file are required" },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Call agent bundle with file upload
    // start_iterator_with_blobs is used for methods that accept binary data
    const iterator = await client.start_iterator_with_blobs(
      entityId,
      "process_document_stream", // Method name in your agent bundle
      [
        { $blob: 0 }, // Document buffer placeholder
        file.name, // Filename
      ],
      [buffer] // Array of buffers matching the $blob placeholders
    );

    try {
      // Iterate through progress updates
      let finalResult: any;

      for await (const envelope of iterator) {
        // Log progress updates
        if (envelope.type === "INTERNAL_UPDATE") {
          console.log(`[Upload Progress] ${envelope.message}`);
        }

        // Keep track of the last envelope (final result)
        finalResult = envelope;
      }

      return NextResponse.json(finalResult);
    } finally {
      // Always cleanup iterator to release server resources
      await iterator.cleanup();
    }
  } catch (error: any) {
    console.error("[API] Upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to upload document" },
      { status: 500 }
    );
  }
}
```

**React Component:**

```typescript
// src/components/FileUpload.tsx
"use client";

export function FileUpload({ entityId }: { entityId: string }) {
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("entity_id", entityId);
    formData.append("file", file);

    const response = await fetch("/api/reports/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      alert(`Upload failed: ${error.error}`);
      return;
    }

    const result = await response.json();
    console.log("Upload complete:", result);
  };

  return <input type="file" onChange={handleUpload} />;
}
```

### Pattern 3: Querying Entity Graph

**Use Case:** Display a list of all reports with pagination

**Next.js API Route:**

```typescript
// src/app/api/reports/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getEntityClient } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "25");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Convert offset/limit to page/size for Pagination type
    // Note: Server expects 1-indexed pages (page 1 = first page)
    const page = Math.floor(offset / limit) + 1;
    const size = limit;

    console.log("[API/history] Fetching report history", {
      limit,
      offset,
      page,
      size,
    });

    // Get singleton entity client
    const client = getEntityClient();

    // Search for ReportEntity instances
    // Ordered by creation date (newest first)
    const results = await client.search_nodes_scoped(
      {
        specific_type_name: "ReportEntity",
        archive: false, // Exclude archived reports
      },
      { created: "desc" }, // Sort by created date descending
      { page, size } // Pagination
    );

    console.log("[API/history] Found reports:", {
      count: results.result.length,
      total: results.total,
    });

    return NextResponse.json({
      reports: results.result,
      total: results.total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("[API/history] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch report history" },
      { status: 500 }
    );
  }
}
```

**React Component (using SWR):**

```typescript
// src/components/ReportHistory.tsx
"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function ReportHistory() {
  const { data, error, isLoading } = useSWR(
    "/api/reports/history?limit=25&offset=0",
    fetcher
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading reports</div>;

  return (
    <div>
      <h2>Reports ({data.total})</h2>
      <ul>
        {data.reports.map((report: any) => (
          <li key={report.id}>{report.data.title || report.id}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Pattern 4: Invoking Entity Methods

**Use Case:** Trigger a specific action on an existing entity

**Next.js API Route:**

```typescript
// src/app/api/reports/[id]/resume/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAgentBundleClient } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const client = getAgentBundleClient();
  try {
    const entityId = params.id;
    const body = await request.json();

    // Invoke a method on a specific entity
    const result = await client.invoke_entity_method(
      entityId,
      "resume", // Method name
      body // Arguments
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[API] Resume failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resume report" },
      { status: 500 }
    );
  }
}
```

---

## RemoteAgentBundleClient API Reference

### Calling API Endpoints

```typescript
// POST endpoint
const result = await client.call_api_endpoint("create-report", {
  method: "POST",
  body: {
    prompt: "...",
    orientation: "portrait",
  },
});

// GET endpoint with query parameters
const result = await client.call_api_endpoint("search-articles", {
  method: "GET",
  query: {
    keyword: "AI",
    limit: "10",
  },
});
```

### Entity Method Invocation

```typescript
// Call a method on a specific entity
const result = await client.invoke_entity_method(entityId, "methodName", {
  arg1: "value1",
  arg2: "value2",
});
```

### File Uploads

```typescript
// Upload files as part of an invocation
const iterator = await client.start_iterator_with_blobs(
  entityId,
  "methodName",
  [
    { $blob: 0 }, // First file placeholder
    { $blob: 1 }, // Second file placeholder
    "text argument",
  ],
  [buffer1, buffer2] // Buffers matching the placeholders
);
```

### Streaming (Long-Running Operations)

```typescript
// Start a streaming operation
const iterator = await client.start_iterator(entityId, "longRunningMethod", {
  input: "data",
});

// Iterate through progress updates
for await (const envelope of iterator) {
  if (envelope.type === "STATUS") {
    console.log(`Status: ${envelope.status} - ${envelope.message}`);
  } else if (envelope.type === "PARTIAL_VALUE") {
    console.log("Partial result:", envelope.content);
  }
}

// Always cleanup
await iterator.cleanup();
```

---

## RemoteEntityClient API Reference

### Searching Entities

```typescript
// Search with criteria, sorting, and pagination
const results = await client.search_nodes_scoped(
  {
    specific_type_name: "ReportEntity",
    status: "Completed",
    archive: false,
  },
  { created: "desc" }, // Sort by created date descending
  { page: 1, size: 25 } // Pagination (1-indexed)
);

// Results structure:
// {
//   result: EntityInstanceNodeDTO[],  // Array of entities
//   total: number                     // Total count
// }
```

### Getting Single Entity

```typescript
// Get entity by ID
const entity = await client.get_node(entityId);

// Get entity by name (if it has a unique name)
const entity = await client.get_node_by_name("my-entity-name");
```

### Traversing Relationships

```typescript
// Get edges from this entity
const edges = await client.get_node_edges_from(
  entityId,
  ["Contains", "References"] // Edge types to traverse
);

// Get edges to this entity
const edges = await client.get_node_edges_to(entityId, [
  "OwnedBy",
  "CreatedBy",
]);
```

### Updating Entity Data

```typescript
// Update entity data
await client.update_node_data(entityId, {
  status: "Completed",
  result: {
    /* ... */
  },
});
```

### Important: Pagination is 1-Indexed

The entity client uses **1-indexed pages** (first page = 1, not 0):

```typescript
// Convert from offset/limit to page/size
const page = Math.floor(offset / limit) + 1; // +1 for 1-indexed
const size = limit;

const results = await client.search_nodes_scoped(criteria, sort, {
  page,
  size,
});
```

---

## Error Handling

Both clients throw `FFError` instances that include:

- `message`: Human-readable error message
- `status`: HTTP status code (if applicable)
- `code`: Error code
- `details`: Additional error context

**Error Handling Pattern:**

```typescript
try {
  const result = await client.call_api_endpoint("create-report", {
    method: "POST",
    body: data,
  });
  return NextResponse.json(result);
} catch (error: any) {
  console.error("[API] Error:", error);

  // FFError has a message property
  const errorMessage = error.message || "Unknown error";

  // Check for specific error types
  if (error.status === 401) {
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 401 }
    );
  }

  return NextResponse.json(
    { error: errorMessage },
    { status: error.status || 500 }
  );
}
```

---

## Configuration Modes

### External Mode (Production - Kong Gateway)

```typescript
// For external access through Kong Gateway
const client = new RemoteEntityClient(
  "http://gateway", // Gateway hostname (no port)
  app_id,
  {
    mode: "external",
    api_key: "your-api-key", // Required for Kong
    namespace: "ff-dev", // Required for Kong
    external_port: 30080, // Optional, defaults to 30080
    coreServiceRoutePrefix: "core", // Optional, defaults to 'core'
    serviceName: "entity-service", // Optional, defaults to 'entity-service'
  }
);
```

**URL Pattern:**

```
http://gateway:30080/core/{namespace}/entity-service/api/{endpoint}
```

### Internal Mode (Same Kubernetes Cluster)

```typescript
// For internal access within K8s cluster
const client = new RemoteEntityClient(
  "http://entity-service", // K8s service name
  app_id,
  {
    mode: "internal",
    internal_port: 8080, // Optional, defaults to 8080
  }
);
```

**URL Pattern:**

```
http://entity-service:8080/api/{endpoint}
```

---

## Best Practices

### 1. Always Use Server-Side API Routes

❌ **Don't:** Use clients directly in React components

```typescript
// BAD - Don't do this in client components
'use client';
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

export function MyComponent() {
  const client = new RemoteAgentBundleClient(...);  // ❌ Exposes API keys
  // ...
}
```

✅ **Do:** Use Next.js API routes as a proxy

```typescript
// GOOD - Create API route
// src/app/api/endpoint/route.ts
import { getAgentBundleClient } from '@/lib/serverConfig';

export async function POST(request: NextRequest) {
  const client = getAgentBundleClient();  // ✅ Server-side only
  // ...
}

// Then call from client component
'use client';
const response = await fetch('/api/endpoint', { ... });  // ✅ Safe
```

### 2. Use Singleton Pattern for Clients

✅ **Do:** Create singleton instances

```typescript
let clientInstance: RemoteAgentBundleClient | null = null;

export function getAgentBundleClient(): RemoteAgentBundleClient {
  if (!clientInstance) {
    clientInstance = new RemoteAgentBundleClient(...);
  }
  return clientInstance;
}
```

### 3. Handle Errors Gracefully

✅ **Do:** Always wrap client calls in try-catch

```typescript
try {
  const result = await client.call_api_endpoint(...);
  return NextResponse.json(result);
} catch (error: any) {
  console.error('Error:', error);
  return NextResponse.json(
    { error: error.message || 'Operation failed' },
    { status: error.status || 500 }
  );
}
```

### 4. Clean Up Iterators

✅ **Do:** Always cleanup streaming iterators

```typescript
const iterator = await client.start_iterator(...);
try {
  for await (const envelope of iterator) {
    // Process updates
  }
} finally {
  await iterator.cleanup();  // ✅ Always cleanup
}
```

### 5. Use TypeScript Types

✅ **Do:** Define types for request/response bodies

```typescript
interface CreateReportRequest {
  prompt: string;
  orientation: "portrait" | "landscape";
}

interface CreateReportResponse {
  reportId: string;
  status: string;
}

const result = await client.call_api_endpoint<CreateReportResponse>(
  "create-report",
  {
    method: "POST",
    body: request as CreateReportRequest,
  }
);
```

---

## Concrete Example: report-gui

A complete working example of this architecture can be found at:

**`/Users/doug/dev/ff-demo-report-generator/apps/report-gui`**

This example demonstrates:

- ✅ Server-side client configuration (`src/lib/serverConfig.ts`)
- ✅ Next.js API routes using both clients
- ✅ File uploads with streaming
- ✅ Entity graph queries with pagination
- ✅ Error handling
- ✅ TypeScript types

**Key Files to Review:**

- `src/lib/serverConfig.ts` - Client configuration
- `src/app/api/reports/create/route.ts` - Creating entities
- `src/app/api/reports/upload/route.ts` - File uploads
- `src/app/api/reports/history/route.ts` - Entity queries

---

## Summary

### Key Takeaways

1. **Use Official Clients**: Always use `RemoteAgentBundleClient` and `RemoteEntityClient` from `@firebrandanalytics/ff-sdk`
2. **Server-Side Only**: Configure clients in Next.js API routes, not client components
3. **Two Client Types**:
   - `RemoteAgentBundleClient` - For API endpoints and entity method invocations
   - `RemoteEntityClient` - For querying the entity graph
4. **Configuration**: Support both external (Kong) and internal (K8s) modes via environment variables
5. **Kubernetes Deployment**: Configure `values.local.yaml` with proper `BUNDLE_URL` based on namespace discovery (see [Configuring values.local.yaml](#configuring-valueslocalyaml-for-kubernetes-deployment))
6. **Error Handling**: Always wrap client calls in try-catch and return structured errors
7. **Pagination**: Entity client uses 1-indexed pages (page 1 = first page)

### Quick Reference

```typescript
// Import
import { RemoteAgentBundleClient, RemoteEntityClient } from '@firebrandanalytics/ff-sdk';

// Agent Bundle Client
const bundleClient = new RemoteAgentBundleClient(url, { api_key: '...' });
await bundleClient.call_api_endpoint('route', { method: 'POST', body: {...} });

// Entity Client
const entityClient = new RemoteEntityClient(baseUrl, appId, options);
const results = await entityClient.search_nodes_scoped(criteria, sort, pagination);
```

### Next Steps

- Review the `report-gui` example application for a complete implementation
- Read [FF SDK Tutorial](./ff_sdk_tutorial.md) for more details
- Check [News Analysis Consumer Example](./news_analysis_consumer.md) for additional patterns

---

## Questions?

If you're uncertain about any aspect of frontend development with FireFoundry:

1. **Agent Bundle Concepts**: See [Agent Bundles Guide](../agent_sdk/core/agent_bundles.md)
2. **SDK Details**: See [FF SDK Tutorial](./ff_sdk_tutorial.md)
3. **Concrete Example**: Review `report-gui` source code
4. **API Patterns**: See [Express Middleware Tutorial](./express_middleware_tutorial.md)

The key is: **Use the official FireFoundry clients. They handle the complexity so you don't have to.**
