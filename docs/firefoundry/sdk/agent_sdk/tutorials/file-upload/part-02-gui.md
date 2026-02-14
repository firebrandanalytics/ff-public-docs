# Part 2: Web UI

In this part you'll add a Next.js web UI that communicates with the agent bundle using `RemoteAgentBundleClient`. The UI provides a drag-and-drop file upload interface and displays the upload history.

> **Prerequisite:** Complete [Part 1: Agent Bundle](./part-01-bundle.md) first. The bundle must be deployed and reachable.

## Step 1: Scaffold the GUI

Add a GUI component to the application:

```bash
ff gui add file-upload-gui
```

This scaffolds a Next.js application in `apps/file-upload-gui/`.

Add the SDK client package and configure Next.js to transpile it:

```bash
cd apps/file-upload-gui
pnpm add @firebrandanalytics/ff-sdk
```

Update `next.config.mjs`:

```javascript
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@firebrandanalytics/ff-sdk"],
};

export default nextConfig;
```

---

## Step 2: SDK Client Helper

Create a shared helper that all API routes will use.

**`apps/file-upload-gui/src/lib/api.ts`**:

```typescript
import { RemoteAgentBundleClient } from "@firebrandanalytics/ff-sdk";

const BUNDLE_URL = process.env.BUNDLE_URL || "http://localhost:3001";

export function getClient(): RemoteAgentBundleClient {
  return new RemoteAgentBundleClient(BUNDLE_URL);
}
```

`RemoteAgentBundleClient` handles the HTTP protocol for communicating with agent bundles -- entity invocation, file uploads, and custom API endpoints.

> **CRITICAL**: `RemoteAgentBundleClient` makes HTTP calls to the agent bundle, so it must only be used in server-side code (API routes, Server Components). Never import it in client components.

---

## Step 3: API Routes

The GUI uses Next.js API routes as a server-side proxy between the browser and the agent bundle. Each route creates a `RemoteAgentBundleClient` instance and calls the appropriate SDK method.

### Entity Route

Fetches the test entity ID via the custom API endpoint defined with `@ApiEndpoint` in Part 1.

**`apps/file-upload-gui/src/app/api/entity/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { getClient } from "@/lib/api";

export async function GET() {
  try {
    const client = getClient();
    const result = await client.call_api_endpoint<{ entity_id: string }>(
      "test-entity",
      { method: "GET" }
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch entity" },
      { status: 500 }
    );
  }
}
```

`call_api_endpoint` calls the bundle's custom API route (`/api/test-entity`).

### Upload Route

Proxies file uploads to the bundle, calling `process_document` on the entity.

**`apps/file-upload-gui/src/app/api/upload/route.ts`**:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const entityId = formData.get("entityId") as string;

    if (!file || !entityId) {
      return NextResponse.json(
        { error: "Missing file or entityId" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const client = getClient();
    const result = await client.invoke_entity_method_with_blobs(
      entityId,
      "process_document",
      [{ $blob: 0 }, file.name, {}],
      [buffer]
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
```

The `{ $blob: 0 }` placeholder tells the SDK to substitute the first buffer from the `files` array. This maps to the `document_buffer` parameter in `process_document(document_buffer, filename, metadata)`.

### Files Route

Lists uploaded files by invoking `list_uploads` on the entity.

**`apps/file-upload-gui/src/app/api/files/route.ts`**:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/api";

export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json(
      { error: "Missing entityId" },
      { status: 400 }
    );
  }

  try {
    const client = getClient();
    const result = await client.invoke_entity_method(
      entityId,
      "list_uploads"
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    );
  }
}
```

`invoke_entity_method` calls a method on a remote entity by ID. This is the standard pattern for entity-to-GUI communication.

---

## Step 4: Upload Page

Replace the scaffolded page with a drag-and-drop upload interface.

**`apps/file-upload-gui/src/app/page.tsx`**:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";

interface UploadRecord {
  filename: string;
  working_memory_id: string;
  size: number;
  uploaded_at: string;
}

export default function Home() {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Fetch the test entity ID on mount
  const fetchEntity = useCallback(async () => {
    try {
      const res = await fetch("/api/entity");
      const data = await res.json();
      if (data.entity_id) {
        setEntityId(data.entity_id);
      } else {
        setError("Test entity not ready. Is the agent bundle running?");
      }
    } catch {
      setError("Cannot connect to API. Is the server running?");
    }
  }, []);

  // Refresh file list
  const fetchFiles = useCallback(async () => {
    if (!entityId) return;
    try {
      const res = await fetch(`/api/files?entityId=${entityId}`);
      const data = await res.json();
      if (data.uploads) {
        setUploads(data.uploads);
      }
    } catch {
      // Silently fail on refresh
    }
  }, [entityId]);

  useEffect(() => {
    fetchEntity();
  }, [fetchEntity]);

  useEffect(() => {
    if (entityId) fetchFiles();
  }, [entityId, fetchFiles]);

  // Handle file upload
  async function handleUpload(file: File) {
    if (!entityId) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityId", entityId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        await fetchFiles();
      }
    } catch {
      setError("Upload failed. Check the console for details.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>File Upload Demo</h1>

      {error && (
        <div style={{ color: "red", marginBottom: "1rem" }}>{error}</div>
      )}

      {entityId && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Entity: <code>{entityId}</code>
        </p>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleUpload(file);
        }}
        style={{
          border: `2px dashed ${dragActive ? "#0070f3" : "#ccc"}`,
          borderRadius: 8,
          padding: "2rem",
          textAlign: "center",
          marginBottom: "2rem",
          background: dragActive ? "#f0f8ff" : "#fafafa",
        }}
      >
        {uploading ? (
          <p>Uploading...</p>
        ) : (
          <>
            <p>Drag and drop a file here, or click to select</p>
            <label style={{ cursor: "pointer", color: "#0070f3" }}>
              Choose File
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = "";
                }}
                disabled={!entityId}
              />
            </label>
          </>
        )}
      </div>

      {/* File list */}
      <h2>Uploaded Files ({uploads.length})</h2>
      {uploads.length === 0 ? (
        <p style={{ color: "#999" }}>No files uploaded yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
              <th style={{ padding: "0.5rem" }}>Filename</th>
              <th style={{ padding: "0.5rem" }}>Size</th>
              <th style={{ padding: "0.5rem" }}>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u) => (
              <tr key={u.working_memory_id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>{u.filename}</td>
                <td style={{ padding: "0.5rem" }}>
                  {(u.size / 1024).toFixed(1)} KB
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {new Date(u.uploaded_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

---

## Step 5: Configure and Run

Set the `BUNDLE_URL` environment variable so the GUI knows where to reach the agent bundle.

**`apps/file-upload-gui/.env.local`**:

```bash
BUNDLE_URL=http://localhost:3001
```

In a deployed environment, set this in `values.local.yaml` instead:

```yaml
configMap:
  enabled: true
  data:
    BUNDLE_URL: "http://file-upload-bundle:3000"
```

Run the GUI:

```bash
cd apps/file-upload-gui
pnpm dev
```

Open `http://localhost:3000` in your browser. You should see the upload interface with your entity ID displayed. Drag a file onto the drop zone -- it will be uploaded through the agent bundle to Working Memory, and the file list will update automatically.

---

## SDK Client Method Summary

Here's a quick reference for the `RemoteAgentBundleClient` methods used in this tutorial:

| Method | Purpose | Used In |
|--------|---------|---------|
| `call_api_endpoint(route, options)` | Call a custom `@ApiEndpoint` on the bundle | Entity route |
| `invoke_entity_method(id, method, ...args)` | Call a method on an entity | Files route |
| `invoke_entity_method_with_blobs(id, method, args, files)` | Call a method with file uploads | Upload route |

For binary responses (e.g., downloading files), use `invoke_entity_method_binary` or `call_api_endpoint_binary`.

---

## What's Next

You now have a working file upload pipeline: files flow from the browser, through your agent bundle's `FileUploadTestEntity`, into FireFoundry Working Memory. The entity tracks every upload in its data, and you can retrieve files by their `working_memory_id`.

From here you can:

- **Add file processing.** Extend `process_document` to parse CSVs, extract text from PDFs, or run other transformations before storing.
- **Connect to other entities.** Use `allowedConnections` in `@EntityMixin` to wire the upload entity into a larger entity graph -- for example, connecting uploaded documents to an analysis entity.
- **Add LLM integration.** Attach a bot to analyze uploaded files using the prompt/bot pattern from the [Report Generator Tutorial](../report-generator/part-01-hello-entity.md).
