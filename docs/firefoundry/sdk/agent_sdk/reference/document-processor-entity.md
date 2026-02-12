# DocumentProcessorEntity

`DocumentProcessorEntity` is a base class for entities that handle binary file uploads. It extends `EntityNode` and provides built-in Working Memory integration, automatically storing uploaded files in blob storage and returning a `working_memory_id` for retrieval.

**Import:**

```typescript
import { DocumentProcessorEntity } from "@firebrandanalytics/ff-agent-sdk";
```

**Source:** `packages/ff-agent-sdk/src/entity/classes/DocumentProcessorEntity.ts`

---

## Class Definition

```typescript
export class DocumentProcessorEntity<
  ENH extends EntityNodeTypeHelper<any, any, any, any, any> = EntityNodeTypeHelper<
    EntityTypeHelper<any, any>,
    DocumentProcessorEntityDTO,
    "DocumentProcessorEntity",
    {},
    {}
  >
> extends EntityNode<ENH>
```

`DocumentProcessorEntity` is generic over its entity node type helper, defaulting to the standard `DocumentProcessorEntityDTO`. When subclassing, you can either use the default or provide your own type helper.

### Constructor

```typescript
constructor(factory: EntityFactory<any>, idOrDto: UUID | ENH["dto"])
```

Initializes the entity and creates a `WorkingMemoryProvider` using `ContextServiceClient`. The context service connection is configured through environment variables (see [Configuration](#configuration)).

---

## Methods

### process_document

The primary method for handling file uploads. Stores the file in Working Memory and returns a result with the `working_memory_id`.

```typescript
public async process_document(
  document_buffer: Buffer,
  filename: string,
  metadata?: Record<string, unknown>
): Promise<DocumentProcessingResult>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `document_buffer` | `Buffer` | Raw file bytes. When called via the `/invoke/multipart` endpoint, this comes from the `{"$blob": 0}` placeholder. |
| `filename` | `string` | Original filename, used for content-type detection and metadata. |
| `metadata` | `Record<string, unknown>` | Optional key-value metadata stored alongside the file in Working Memory. |

**Returns:** `DocumentProcessingResult`

**Behavior:**

1. Calls `upload_to_working_memory()` to store the file
2. Logs the upload with entity ID, filename, and file size
3. Returns the working memory ID, success status, and file info
4. Throws `Error` if the upload fails

**Override pattern:** Call `super.process_document()` to store the file, then add your own logic (tracking, validation, post-processing):

```typescript
public async process_document(
  document_buffer: Buffer,
  filename: string,
  metadata?: Record<string, unknown>
) {
  // Store in Working Memory via parent
  const result = await super.process_document(document_buffer, filename, {
    ...metadata,
    uploaded_via: "MyEntity",
  });

  // Track the upload in entity data
  const dto = await this.get_dto();
  const uploads = dto.data.uploads || [];
  uploads.push({
    filename,
    working_memory_id: result.working_memory_id,
    size: result.file_info.size,
  });
  await this.update_data({ ...dto.data, uploads });

  return result;
}
```

### upload_to_working_memory (protected)

Stores a buffer in Working Memory. Override this to customize storage behavior.

```typescript
protected async upload_to_working_memory(
  buffer: Buffer,
  filename: string,
  metadata?: Record<string, unknown>
): Promise<{ working_memory_id: string }>
```

Calls `working_memory_provider.add_memory_from_buffer()` with the entity's ID, filename, detected content type, memory type, and merged metadata.

### detect_content_type (protected)

Returns a MIME type string based on file extension. Override to add custom detection (e.g., magic byte inspection).

```typescript
protected detect_content_type(buffer: Buffer, filename: string): string
```

**Built-in mappings:**

| Extension | Content Type |
|-----------|-------------|
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| `.csv` | `text/csv` |
| `.xml` | `application/xml` |
| `.pdf` | `application/pdf` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| *(other)* | `application/octet-stream` |

### get_memory_type (protected)

Returns the Working Memory type used for categorization. Override to customize.

```typescript
protected get_memory_type(buffer: Buffer, filename: string): WorkingMemoryType
```

**Default logic:**
- Images (`image/*`) -> `"image/png"`
- JSON (`application/json`) -> `"data/json"`
- Everything else -> `"file"`

---

## Types

### DocumentProcessingResult

```typescript
export interface DocumentProcessingResult {
  working_memory_id: string;
  success: boolean;
  file_info: {
    size: number;
    name: string;
  };
}
```

### DocumentProcessorEntityDTOData

```typescript
export interface DocumentProcessorEntityDTOData {
  [key: string]: JSONValue;
}
```

### DocumentProcessorEntityDTO

```typescript
export type DocumentProcessorEntityDTO =
  EntityInstanceNodeDTO<DocumentProcessorEntityDTOData> & {
    node_type: "DocumentProcessorEntity";
  };
```

---

## Configuration

`DocumentProcessorEntity` connects to the Context Service on construction. Set these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTEXT_SERVICE_ADDRESS` | Context service URL (include protocol) | *(from shared-utils)* |
| `CONTEXT_SERVICE_API_KEY` | API key for context service authentication | *(from shared-utils)* |

In a cluster deployment, these are typically set via the Helm chart's `configMap`. For local development, port-forward the context service:

```bash
kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051
```

Then set:

```bash
CONTEXT_SERVICE_ADDRESS=http://localhost:50051
```

---

## Usage with EntityMixin

Register your subclass with `@EntityMixin`:

```typescript
import {
  DocumentProcessorEntity,
  EntityMixin,
  EntityFactory,
} from "@firebrandanalytics/ff-agent-sdk";
import { type UUID } from "@firebrandanalytics/shared-types";

@EntityMixin({
  specificType: "MyFileEntity",
  generalType: "MyFileEntity",
  allowedConnections: {},
})
export class MyFileEntity extends DocumentProcessorEntity {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | any) {
    super(factory, idOrDto);
  }
}
```

## Usage with Multipart Uploads

Files are sent to the entity via the `/invoke/multipart` endpoint. The `{"$blob": N}` placeholder in the args array is replaced with the Nth uploaded file as a `Buffer`.

**ff-sdk-cli:**

```bash
ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./document.pdf \
  --url http://localhost:3001
```

**RemoteAgentBundleClient:**

```typescript
const result = await client.invoke_entity_method_with_blobs(
  entityId,
  "process_document",
  [{ $blob: 0 }, "document.pdf", { source: "upload" }],
  [fileBuffer]
);
```

---

## Related

- [Working Memory Guide](../guides/working-memory.md) -- concepts and SDK integration for Working Memory
- [File Upload Patterns](../feature_guides/file-upload-patterns.md) -- comprehensive patterns including retrieval, pipelines, error handling, and client examples
- [File Upload Tutorial](../tutorials/file-upload/README.md) -- step-by-step tutorial building a file upload agent bundle with web UI
- [Report Generator Part 4](../tutorials/report-generator/part-04-working-memory.md) -- Working Memory in the context of a multi-stage pipeline
- [Context Service](../../../platform/services/context-service.md) -- platform service documentation
