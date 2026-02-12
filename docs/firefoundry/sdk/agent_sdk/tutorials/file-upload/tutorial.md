# File Upload Demo

This tutorial walks you through building a file upload agent bundle with a web UI. You'll create an entity that accepts file uploads via FireFoundry's Working Memory system, then wire up a Next.js frontend with drag-and-drop support.

**What you'll learn:**
- Scaffolding an application with an agent bundle and a GUI component
- Creating a custom entity that extends `DocumentProcessorEntity` for file handling
- Storing and retrieving files through Working Memory
- Building a web UI that communicates with your agent bundle
- Testing file uploads with `ff-sdk-cli`

**What you'll build:** An agent bundle with a `FileUploadTestEntity` that handles file uploads and stores them in Working Memory, plus a Next.js web UI with drag-and-drop file uploading and file listing.

**Prerequisites:**
- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Node.js 20+
- `pnpm` package manager

---

## Step 1: Scaffold the Application

Use `ff-cli` to create a new application and agent bundle:

```bash
ff application create file-upload
cd file-upload
ff agent-bundle create file-upload-bundle
```

This creates a monorepo with:

```
file-upload/
├── firefoundry.json              # Application-level config (lists components)
├── apps/
│   └── file-upload-bundle/       # Your agent bundle
│       ├── firefoundry.json      # Bundle-level config (port, resources, health)
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── shared-types/             # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### Register the Application

Register the application with the entity service. This creates an application record in the entity graph and assigns an application ID:

```bash
ff application register
```

This writes the `applicationId` into the root `firefoundry.json`. You'll use this ID in your agent bundle class to scope all entity operations to this application.

Install dependencies:

```bash
pnpm install
```

---

## Step 2: Create the FileUploadTestEntity

The `FileUploadTestEntity` extends `DocumentProcessorEntity`, a built-in SDK base class that handles Working Memory integration. Working Memory is FireFoundry's blob storage system for entity-attached files -- when you upload a file through `DocumentProcessorEntity`, it automatically stores the binary content in Working Memory and returns a `working_memory_id` you can use to retrieve it later.

**`apps/file-upload-bundle/src/entities/FileUploadTestEntity.ts`**:

```typescript
import {
  DocumentProcessorEntity,
  EntityMixin,
  EntityFactory,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { type UUID } from "@firebrandanalytics/shared-types";

@EntityMixin({
  specificType: "FileUploadTestEntity",
  generalType: "FileUploadTestEntity",
  allowedConnections: {},
})
export class FileUploadTestEntity extends DocumentProcessorEntity {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | any) {
    super(factory, idOrDto);
  }

  public async process_document(
    document_buffer: Buffer,
    filename: string,
    metadata?: Record<string, unknown>
  ) {
    logger.info(`[FileUploadTestEntity] Upload starting`, {
      entity_id: this.id,
      filename,
      buffer_size: document_buffer.length,
    });

    // super.process_document() handles Writing Memory storage
    const result = await super.process_document(document_buffer, filename, {
      ...metadata,
      uploaded_via: "FileUploadTestEntity",
    });

    // Track uploads in entity data
    const dto = await this.get_dto();
    const uploads = Array.isArray(dto.data.uploads) ? dto.data.uploads : [];
    uploads.push({
      filename,
      working_memory_id: result.working_memory_id,
      size: result.file_info.size,
      uploaded_at: new Date().toISOString(),
    });

    await this.update_data({
      ...dto.data,
      uploads,
      last_upload: {
        filename,
        working_memory_id: result.working_memory_id,
        timestamp: new Date().toISOString(),
      },
    });

    return result;
  }

  public async list_uploads() {
    const dto = await this.get_dto();
    return {
      entity_id: this.id,
      uploads: dto.data.uploads || [],
      last_upload: dto.data.last_upload || null,
    };
  }

  public async retrieve_file(working_memory_id: string) {
    const wm = this.get_working_memory();
    const record = await wm.fetchRecord(working_memory_id);
    const content = await wm.fetchBlob(working_memory_id);
    return {
      working_memory_id,
      content,
      metadata: record,
      success: true,
    };
  }
}
```

**Key concepts:**

- `@EntityMixin` registers the entity type. Both `specificType` and `generalType` are set to `"FileUploadTestEntity"`.
- `DocumentProcessorEntity` is the SDK base class for file handling. Its `process_document()` method stores the file buffer in Working Memory and returns a `working_memory_id` along with `file_info`.
- `process_document()` overrides the base to add upload tracking. After calling `super.process_document()`, it appends an entry to the `uploads` array in entity data.
- `list_uploads()` returns the entity's upload history from `this.get_dto().data`.
- `retrieve_file()` fetches a file back from Working Memory using the `working_memory_id`.

---

## Step 3: Register and Wire Up the Bundle

### Constructor Map

Register the entity so the bundle can instantiate it.

**`apps/file-upload-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { FileUploadTestEntity } from "./entities/FileUploadTestEntity.js";

export const FileUploadBundleConstructors = {
  ...FFConstructors,
  FileUploadTestEntity: FileUploadTestEntity,
} as const;
```

`FFConstructors` includes built-in entity types. You spread it and add your own.

### Agent Bundle Class

The bundle class creates a test entity on startup and exposes it via an API endpoint.

**`apps/file-upload-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { FileUploadBundleConstructors } from "./constructors.js";

// Replace with your applicationId from firefoundry.json
const APP_ID = "YOUR_APPLICATION_ID";

export class FileUploadBundleAgentBundle extends FFAgentBundle<any> {
  private testEntityId: string | null = null;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "FileUploadBundle",
        type: "agent_bundle",
        description: "File upload demo service",
      },
      FileUploadBundleConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();

    // Create a test entity on startup
    const entity = await this.entityClient.createEntity({
      specific_type_name: "FileUploadTestEntity",
      general_type_name: "FileUploadTestEntity",
      data: { uploads: [] },
      name: "file-upload-test",
    });

    this.testEntityId = entity.id;
    logger.info(`FileUploadBundle initialized, test entity: ${entity.id}`);
  }

  @ApiEndpoint({ method: "GET", route: "test-entity" })
  async getTestEntity() {
    return { entity_id: this.testEntityId };
  }
}
```

> **Note:** `createEntityClient(APP_ID)` is the SDK 4.x pattern for creating an entity client scoped to your application. Earlier versions used `app_provider` -- if you see that in older examples, use `createEntityClient` instead.

Replace `YOUR_APPLICATION_ID` with the `applicationId` value from your root `firefoundry.json` (written by `ff application register` in Step 1).

### Server Entry Point

The entry point is typically scaffolded for you. Verify it looks like this:

**`apps/file-upload-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { FileUploadBundleAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    const server = await createStandaloneAgentBundle(
      FileUploadBundleAgentBundle,
      { port }
    );
    logger.info(`FileUploadBundle server running on port ${port}`);
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

---

## Step 4: Deploy and Test

### Build

```bash
pnpm install
npx turbo build
```

### Deploy

Build the Docker image and deploy to your cluster:

```bash
ff ops build --app-name file-upload-bundle
ff ops deploy --app-name file-upload-bundle
```

> **Note:** If you're building on an ARM host (e.g., Apple Silicon) for an AMD64 cluster, use `docker buildx build --platform linux/amd64` to cross-compile.

For local development, you can also install directly:

```bash
ff ops install --app-name file-upload-bundle
```

### Test with ff-sdk-cli

Once the bundle is running (locally or deployed), test the endpoints.

**Check health:**

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }
```

**Get the test entity ID:**

Custom API endpoints are served at `/api/ROUTE_NAME`. The `@ApiEndpoint` decorator you defined exposes a GET endpoint:

```bash
ff-sdk-cli api call test-entity --url http://localhost:3001
# { "success": true, "result": { "entity_id": "a1b2c3d4-..." } }
```

Note the `entity_id` -- you'll use it for the next commands.

**Upload a file:**

The `invoke-blob` command sends a file as a multipart upload, calling `process_document` on the entity:

```bash
ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./test.txt \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "working_memory_id": "wm-abc123-...",
    "success": true,
    "file_info": {
      "size": 1234,
      "name": "test.txt"
    }
  }
}
```

**List uploads:**

```bash
ff-sdk-cli invoke <entity-id> list_uploads --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "entity_id": "a1b2c3d4-...",
    "uploads": [
      {
        "filename": "test.txt",
        "working_memory_id": "wm-abc123-...",
        "size": 1234,
        "uploaded_at": "2026-01-15T10:30:00.000Z"
      }
    ],
    "last_upload": {
      "filename": "test.txt",
      "working_memory_id": "wm-abc123-...",
      "timestamp": "2026-01-15T10:30:00.000Z"
    }
  }
}
```

### Verify with Diagnostic Tools

If you have `ff-eg-read` and `ff-wm-read` configured (see the [Report Generator Tutorial](../report-generator/part-01-hello-entity.md) for setup), you can inspect the entity graph and Working Memory directly:

```bash
# View the entity node
ff-eg-read node get <entity-id>

# View the entity's data (includes uploads array)
ff-eg-read node get <entity-id> | jq '.data'

# View the Working Memory record
ff-wm-read record get <working-memory-id>
```

---

## Step 5: Add the Web UI

Add a GUI component to the application:

```bash
ff gui add file-upload-gui
```

This scaffolds a Next.js application in `apps/file-upload-gui/`. You'll modify it to provide a drag-and-drop upload interface.

### API Routes

The web UI communicates with the agent bundle through API routes that proxy requests. The bundle exposes two key invoke patterns:

- **Standard invoke:** `POST /invoke` with `{ entity_id, method_name, args }` -- for methods like `list_uploads`
- **Multipart invoke:** `POST /invoke/multipart` with a `payload` form field containing JSON -- for file uploads via `process_document`

Create three API route files.

**`apps/file-upload-gui/src/app/api/entity/route.ts`** -- fetches the test entity ID:

```typescript
import { NextResponse } from "next/server";

const BUNDLE_URL = process.env.BUNDLE_URL || "http://localhost:3001";

export async function GET() {
  try {
    const res = await fetch(`${BUNDLE_URL}/api/test-entity`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch entity" },
      { status: 500 }
    );
  }
}
```

**`apps/file-upload-gui/src/app/api/upload/route.ts`** -- proxies file uploads to the bundle:

```typescript
import { NextRequest, NextResponse } from "next/server";

const BUNDLE_URL = process.env.BUNDLE_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const entityId = formData.get("entity_id") as string;

    if (!file || !entityId) {
      return NextResponse.json(
        { error: "Missing file or entity_id" },
        { status: 400 }
      );
    }

    // Build multipart payload for the bundle's invoke/multipart endpoint
    const bundleForm = new FormData();
    bundleForm.append("file", file);
    bundleForm.append(
      "payload",
      JSON.stringify({
        entity_id: entityId,
        method_name: "process_document",
        args: [file.name],
      })
    );

    const res = await fetch(`${BUNDLE_URL}/invoke/multipart`, {
      method: "POST",
      body: bundleForm,
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
```

**`apps/file-upload-gui/src/app/api/files/route.ts`** -- lists uploaded files:

```typescript
import { NextRequest, NextResponse } from "next/server";

const BUNDLE_URL = process.env.BUNDLE_URL || "http://localhost:3001";

export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entity_id");

  if (!entityId) {
    return NextResponse.json(
      { error: "Missing entity_id" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${BUNDLE_URL}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_id: entityId,
        method_name: "list_uploads",
        args: [],
      }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    );
  }
}
```

### Main Page

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
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the test entity ID on mount
  useEffect(() => {
    fetch("/api/entity")
      .then((res) => res.json())
      .then((data) => {
        const id = data.result?.entity_id || data.entity_id;
        setEntityId(id);
      })
      .catch(() => setError("Failed to connect to agent bundle"));
  }, []);

  // Refresh file list
  const refreshFiles = useCallback(async () => {
    if (!entityId) return;
    try {
      const res = await fetch(`/api/files?entity_id=${entityId}`);
      const data = await res.json();
      setUploads(data.result?.uploads || []);
    } catch {
      // Silently fail on refresh
    }
  }, [entityId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Handle file upload
  const uploadFile = async (file: File) => {
    if (!entityId) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entity_id", entityId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Upload failed");
      }

      await refreshFiles();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Drag-and-drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? "#0070f3" : "#ccc"}`,
          borderRadius: 8,
          padding: "2rem",
          textAlign: "center",
          marginBottom: "2rem",
          background: dragging ? "#f0f8ff" : "#fafafa",
          cursor: "pointer",
        }}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        {uploading ? (
          <p>Uploading...</p>
        ) : (
          <p>Drag and drop a file here, or click to select</p>
        )}
        <input
          id="file-input"
          type="file"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
      </div>

      {/* File list */}
      <h2>Uploaded Files</h2>
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

### Configure the Bundle URL

Set the `BUNDLE_URL` environment variable so the GUI knows where to reach the agent bundle.

**`apps/file-upload-gui/.env.local`**:

```bash
BUNDLE_URL=http://localhost:3001
```

In a deployed environment, this would point to the bundle's cluster-internal service URL.

### Run the GUI

```bash
cd apps/file-upload-gui
pnpm dev
```

Open `http://localhost:3000` in your browser. You should see the upload interface with your entity ID displayed. Drag a file onto the drop zone -- it will be uploaded through the agent bundle to Working Memory, and the file list will update automatically.

---

## Step 6: What's Next

You now have a working file upload pipeline: files flow from the browser, through your agent bundle's `FileUploadTestEntity`, into FireFoundry Working Memory. The entity tracks every upload in its data, and you can retrieve files by their `working_memory_id`.

From here you can:

- **Add file processing.** Extend `process_document` to parse CSVs, extract text from PDFs, or run other transformations before storing.
- **Connect to other entities.** Use `allowedConnections` in `@EntityMixin` to wire the upload entity into a larger entity graph -- for example, connecting uploaded documents to an analysis entity.
- **Add LLM integration.** Attach a bot to analyze uploaded files using the prompt/bot pattern from the [Report Generator Tutorial](../report-generator/part-01-hello-entity.md).

### Further Reading

- [Report Generator Tutorial](../report-generator/part-01-hello-entity.md) -- multi-part tutorial covering entities, bots, prompts, and LLM integration
- [SDK Reference: DocumentProcessorEntity](../../reference/document-processor-entity.md) -- full API reference for the file handling base class
- [Working Memory Guide](../../guides/working-memory.md) -- how FireFoundry's blob storage system works
