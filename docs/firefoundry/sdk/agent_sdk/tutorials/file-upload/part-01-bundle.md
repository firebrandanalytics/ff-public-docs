# Part 1: Agent Bundle

In this part you'll scaffold a FireFoundry application, create a file-handling entity, wire it into an agent bundle, and deploy and test it.

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

    // super.process_document() handles Working Memory storage
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

**Next:** [Part 2: Web UI](./part-02-gui.md) -- add a drag-and-drop upload interface using `RemoteAgentBundleClient`.
