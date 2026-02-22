# Working Memory

Working Memory is FireFoundry's persistent blob storage system for entities. It stores binary files (PDFs, images, CSVs, generated documents) alongside JSON metadata, accessible by a unique `working_memory_id`. The underlying storage is managed by the [Context Service](../../../platform/services/context-service/README.md).

## When to Use Working Memory

Entities in the entity graph store structured JSON data via `get_dto()` and `update_data()`. Working Memory handles everything else:

| Entity Data (JSON) | Working Memory (Blobs) |
|---|---|
| Structured fields (`{ prompt, status }`) | Binary files (PDF, DOCX, images) |
| Accessed via `get_dto()` / `update_data()` | Accessed via `WorkingMemoryProvider` |
| Lives in the entity node | Lives in blob storage with metadata |
| Referenced by entity ID | Referenced by working memory ID |

The standard pattern: store the file in Working Memory, then store the `working_memory_id` in entity data. Entity data stays lightweight while files live in purpose-built blob storage.

```
Entity Data (JSON)                    Working Memory (Blob Storage)
{                                     +---------------------------+
  "status": "processing",             | ID: wm-abc-123            |
  "original_doc_wm_id":        ----> | Name: report.pdf          |
    "wm-abc-123"                      | Content-Type: application/ |
}                                     |   pdf                     |
                                      | Size: 245,760 bytes       |
                                      | Metadata: { stage: ... }  |
                                      +---------------------------+
```

## Core Components

### ContextServiceClient

Low-level gRPC client that connects to the Context Service.

```typescript
import { ContextServiceClient } from "@firebrandanalytics/cs-client";

const client = new ContextServiceClient({
  address: process.env.CONTEXT_SERVICE_ADDRESS || "http://localhost:50051",
  apiKey: process.env.CONTEXT_SERVICE_API_KEY || "",
});
```

### WorkingMemoryProvider

Higher-level wrapper around `ContextServiceClient` with methods for common file operations.

```typescript
import { WorkingMemoryProvider } from "@firebrandanalytics/ff-agent-sdk";

const provider = new WorkingMemoryProvider(client);
```

### DocumentProcessorEntity

SDK base class that initializes both components automatically. Extend this for entities that handle file uploads. See [DocumentProcessorEntity Reference](../reference/document-processor-entity.md).

## Storing Files

### add_memory_from_buffer

The primary method for storing files:

```typescript
const result = await provider.add_memory_from_buffer({
  entityNodeId: entityId,          // Links the file to this entity
  name: "report.pdf",             // Display name
  description: "Quarterly report", // Human-readable description
  contentType: "application/pdf", // MIME type
  memoryType: "file",             // Working memory type
  buffer: fileBuffer,             // Node.js Buffer with file bytes
  metadata: {                     // Arbitrary JSON metadata
    stage: "original_upload",
    uploaded_at: new Date().toISOString(),
  },
});

const workingMemoryId = result.workingMemoryId;
```

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `entityNodeId` | `UUID` | Entity this file belongs to |
| `name` | `string` | File display name |
| `description` | `string` | Human-readable description |
| `contentType` | `string` | MIME type (`application/pdf`, `text/plain`, etc.) |
| `memoryType` | `WorkingMemoryType` | Category: `"file"`, `"data/json"`, `"image/png"`, `"code/typescript"`, etc. |
| `buffer` | `Buffer` | Raw file bytes |
| `metadata` | `Record<string, unknown>` | Custom metadata stored alongside the file |

**Returns:** `{ workingMemoryId: string }` -- the UUID for retrieving this file later.

### Memory Types

| Type | Use For |
|------|---------|
| `"file"` | General binary files (PDF, DOCX, etc.) |
| `"data/json"` | Structured JSON data |
| `"image/png"` | Images |
| `"code/typescript"` | Code files |

## Retrieving Files

### Fetch a record (metadata only)

```typescript
const record = await provider.fetchRecord(workingMemoryId);
// Returns: { id, name, description, contentType, memoryType, metadata, ... }
```

### Fetch file content

```typescript
const content = await provider.fetchBlob(workingMemoryId);
// Returns: Buffer with the file bytes
```

### Fetch with metadata

```typescript
const result = await provider.get_binary_file_with_metadata_rpc(workingMemoryId);
// Returns: { buffer: Buffer, metadata: Record<string, unknown> }
```

### List records for an entity

```typescript
const records = await provider.fetchRecordsByEntity(entityId);
// Returns: Array of working memory records
```

## Common Patterns

### Storing Uploads in Entity Data

After storing a file, save the `working_memory_id` in entity data so other methods or downstream stages can find it:

```typescript
const dto = await this.get_dto();
await this.update_data({
  ...dto.data,
  document_wm_id: result.workingMemoryId,
  filename: "report.pdf",
});
```

### Multi-Stage Pipelines

Each stage reads the previous stage's output via working memory ID and writes its own output:

```
Upload Stage          --> original_doc_wm_id     --> Text Extraction
Text Extraction       --> extracted_text_wm_id   --> AI Generation
AI Generation         --> generated_html_wm_id   --> PDF Conversion
PDF Conversion        --> final_pdf_wm_id        --> Delivery
```

```typescript
// Stage: Text Extraction
const originalDoc = await provider.fetchBlob(dto.data.original_doc_wm_id);
const extractedText = await extractText(originalDoc);

const textResult = await provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: "extracted-text.txt",
  contentType: "text/plain",
  memoryType: "file",
  buffer: Buffer.from(extractedText, "utf-8"),
  metadata: { stage: "text_extraction" },
});

await this.update_data({
  ...dto.data,
  extracted_text_wm_id: textResult.workingMemoryId,
});
```

### Multiple Files per Entity

Each `add_memory_from_buffer` call creates a separate record. Use metadata to distinguish them:

```typescript
// Store original
const original = await provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: "original.pdf",
  memoryType: "file",
  buffer: originalBuffer,
  metadata: { stage: "original" },
  // ...
});

// Store processed version
const processed = await provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: "processed.pdf",
  memoryType: "file",
  buffer: processedBuffer,
  metadata: { stage: "processed", original_wm_id: original.workingMemoryId },
  // ...
});
```

## Configuration

Working Memory requires connectivity to the Context Service. Set these environment variables:

| Variable | Description |
|----------|-------------|
| `CONTEXT_SERVICE_ADDRESS` | Context service URL with protocol (e.g., `http://firefoundry-core-context-service:50051`) |
| `CONTEXT_SERVICE_API_KEY` | API key for authentication (optional in some deployments) |

In cluster deployments, these are set via the Helm chart's `configMap`. For local development:

```bash
kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051
```

```bash
CONTEXT_SERVICE_ADDRESS=http://localhost:50051
```

## Verifying with CLI Tools

Use `ff-wm-read` to inspect working memory outside of code:

```bash
# List records for an entity
ff-wm-read list --entity-id <entity-id>

# Get record metadata
ff-wm-read get <working-memory-id>

# Download file
ff-wm-read download <working-memory-id> --output ./downloaded-file.pdf
```

Use `ff-wm-write` to upload files directly:

```bash
ff-wm-write upload --entity-id <entity-id> --file ./document.pdf --name "document.pdf"
```

## Related

- [DocumentProcessorEntity Reference](../reference/document-processor-entity.md) -- API reference for the file upload base class
- [File Upload Patterns](../feature_guides/file-upload-patterns.md) -- comprehensive patterns including retrieval, error handling, and client examples
- [File Upload Tutorial](../tutorials/file-upload/README.md) -- step-by-step tutorial building a file upload agent bundle
- [Report Generator Part 4](../tutorials/report-generator/part-04-working-memory.md) -- Working Memory in a multi-stage pipeline tutorial
- [Context Service](../../../platform/services/context-service/README.md) -- platform service documentation (storage backends, gRPC API, configuration)
