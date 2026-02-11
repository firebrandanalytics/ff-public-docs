# Part 4: File Storage with Working Memory

In this part, you'll add the ability to receive binary file uploads and store them in FireFoundry's **working memory** system. Working memory provides persistent blob storage tied to entities, so files survive restarts and can be referenced by ID throughout a processing pipeline.

**What you'll learn:**
- Initializing the context service client with `getContextServiceClient`
- Creating a `WorkingMemoryProvider` for file operations
- Storing files with `add_memory_from_buffer` and metadata
- Receiving blob uploads via `ff-sdk-cli invoke-blob`
- Creating a `process_document` method that stores a file and saves the working memory ID
- Verifying stored files with `ff-wm-read`

**What you'll build:** A `ReportEntity` that accepts a document upload, stores it in working memory, and saves the working memory ID to entity data for use by downstream processing stages.

## Concepts: Working Memory

Working memory is FireFoundry's file storage service. It solves a specific problem: entities in the entity graph store structured JSON data, but real workflows involve binary files (PDFs, images, spreadsheets). Working memory bridges this gap.

| Entity Graph (JSON) | Working Memory (Blobs) |
|---|---|
| Stores structured data (`{ prompt, orientation }`) | Stores binary files (PDF, DOCX, images) |
| Accessed via `get_dto()` / `update_data()` | Accessed via `WorkingMemoryProvider` |
| Data lives in the entity node | Files live in blob storage with metadata |
| Referenced by entity ID | Referenced by working memory ID |

The pattern is: store the file in working memory, then store the working memory ID in entity data. This keeps entity data lightweight while files live in purpose-built blob storage.

```
Entity Data (JSON)                    Working Memory (Blob Storage)
{                                     +---------------------------+
  "prompt": "Summarize this",         | ID: wm-abc-123            |
  "orientation": "portrait",    ----> | Name: quarterly-report.pdf|
  "original_document_wm_id":         | Content-Type: application/ |
    "wm-abc-123"                      |   pdf                     |
}                                     | Size: 245,760 bytes       |
                                      | Metadata: { stage: ...}   |
                                      +---------------------------+
```

## Step 1: Add Working Memory to the Entity

Update the `ReportEntity` to initialize a `WorkingMemoryProvider` in its constructor.

**`apps/report-bundle/src/entities/ReportEntity.ts`**:

```typescript
import {
  RunnableEntity,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  EntityFactory,
  WorkingMemoryProvider,
  getContextServiceClient,
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';

/**
 * Data stored in the ReportEntity
 */
interface ReportEntityDTOData {
  prompt: string;
  orientation: 'portrait' | 'landscape';
  original_document_wm_id?: string;   // Working memory ID for uploaded doc
  original_filename?: string;          // Original name of the uploaded file
  [key: string]: any;
}

type ReportEntityDTO = EntityInstanceNodeDTO<ReportEntityDTOData> & {
  node_type: "ReportEntity";
};

type ReportEntityENH = EntityNodeTypeHelper<
  any,
  ReportEntityDTO,
  'ReportEntity',
  {},
  {}
>;

type ReportEntityRETH = RunnableEntityTypeHelper<
  ReportEntityENH,
  string  // For now, returns a confirmation string
>;

/**
 * Entity that accepts document uploads and stores them in working memory.
 * 
 * In later parts, this entity will orchestrate the full report generation
 * pipeline. For now, it handles file storage and retrieval.
 */
@EntityMixin({
  specificType: 'ReportEntity',
  generalType: 'ReportEntity',
  allowedConnections: {}
})
export class ReportEntity extends RunnableEntity<ReportEntityRETH> {
  private working_memory_provider: WorkingMemoryProvider;

  constructor(factory: EntityFactory<any>, idOrDto: UUID | ReportEntityDTO) {
    super(factory, idOrDto);

    // Initialize the context service client.
    // The context service is a gRPC service that manages working memory.
    // CONTEXT_SERVICE_ADDRESS defaults to the in-cluster service URL.
    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS ||
      'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = getContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });

    // WorkingMemoryProvider wraps the context client with
    // higher-level methods for file storage.
    this.working_memory_provider = new WorkingMemoryProvider(context_client);
  }

  /**
   * Process a document upload: store in working memory, save the ID.
   * 
   * This method is called via invoke-blob from ff-sdk-cli or
   * via the SDK client's invoke_entity_method_with_blobs.
   * 
   * @param document_buffer - The raw file bytes
   * @param filename - Original filename (used for content-type detection)
   */
  async process_document(
    document_buffer: Buffer,
    filename: string
  ): Promise<{ working_memory_id: string; filename: string; size: number }> {
    logger.info('[ReportEntity] Storing document in working memory', {
      entity_id: this.id,
      filename,
      size: document_buffer.length
    });

    // Store the file in working memory
    const wmResult = await this.working_memory_provider.add_memory_from_buffer({
      entityNodeId: this.id!,
      name: filename,
      description: `Original document uploaded: ${filename}`,
      contentType: this.getContentType(filename),
      memoryType: 'file',
      buffer: document_buffer,
      metadata: {
        original_filename: filename,
        upload_method: 'multipart_blob',
        file_size: document_buffer.length,
        stage: 'original_upload',
        uploaded_at: new Date().toISOString()
      },
    });

    const workingMemoryId = wmResult.workingMemoryId;

    logger.info('[ReportEntity] Document stored in working memory', {
      entity_id: this.id,
      working_memory_id: workingMemoryId,
      filename,
      size: document_buffer.length
    });

    // Save the working memory ID to entity data so other stages can find it
    const dto = await this.get_dto();
    await this.update_data({
      ...dto.data,
      original_document_wm_id: workingMemoryId,
      original_filename: filename
    });

    return {
      working_memory_id: workingMemoryId,
      filename,
      size: document_buffer.length
    };
  }

  /**
   * Run implementation - for now, confirms the document is stored.
   * In later parts, this will orchestrate the full pipeline.
   */
  protected override async *run_impl(): AsyncGenerator<any, string, never> {
    const dto = await this.get_dto();

    if (!dto.data.original_document_wm_id) {
      throw new Error('No document uploaded - call process_document first');
    }

    yield {
      type: "INTERNAL_UPDATE",
      message: "Document stored successfully",
      metadata: {
        working_memory_id: dto.data.original_document_wm_id,
        filename: dto.data.original_filename
      }
    };

    return `Document ${dto.data.original_filename} stored with working memory ID: ${dto.data.original_document_wm_id}`;
  }

  /**
   * Determine content type from filename extension
   */
  private getContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const contentTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'txt': 'text/plain',
      'html': 'text/html',
      'htm': 'text/html'
    };
    return contentTypes[ext || ''] || 'application/octet-stream';
  }
}
```

### Understanding getContextServiceClient

`getContextServiceClient` creates a gRPC client that connects to FireFoundry's context service. The context service manages working memory records, including blob storage and metadata.

```typescript
const context_client = getContextServiceClient({
  address: CONTEXT_SERVICE_ADDRESS,  // gRPC service address
  apiKey: CONTEXT_SERVICE_API_KEY,   // Optional API key for auth
});
```

In a cluster deployment, the address defaults to the in-cluster service URL. For local development, you can port-forward the context service or use a local address.

### Understanding add_memory_from_buffer

`add_memory_from_buffer` is the primary method for storing files:

```typescript
const wmResult = await this.working_memory_provider.add_memory_from_buffer({
  entityNodeId: this.id!,       // Links the file to this entity
  name: filename,               // Display name for the file
  description: 'Description',   // Human-readable description
  contentType: 'application/pdf', // MIME type
  memoryType: 'file',           // Working memory type (always 'file' for blobs)
  buffer: document_buffer,      // The actual file bytes (Node.js Buffer)
  metadata: {                   // Arbitrary JSON metadata stored alongside the file
    original_filename: filename,
    file_size: document_buffer.length,
    uploaded_at: new Date().toISOString()
  },
});
```

The method returns an object with `workingMemoryId` -- a UUID that uniquely identifies this file in working memory. Store this ID in entity data to reference the file later.

## Step 2: Register the Entity

Update the constructor map.

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { TextDocumentEntity } from './entities/TextDocumentEntity.js';
import { ReportGenerationEntity } from './entities/ReportGenerationEntity.js';
import { ReportEntity } from './entities/ReportEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  TextDocumentEntity: TextDocumentEntity,
  ReportGenerationEntity: ReportGenerationEntity,
  ReportEntity: ReportEntity,
} as const;
```

## Step 3: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 4: Test with ff-sdk-cli

### Create a ReportEntity

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportEntity",
    "data": {
      "prompt": "Generate a summary report from this document.",
      "orientation": "portrait"
    }
  }' \
  --url http://localhost:3001
```

Note the returned `entity_id`.

### Upload a Document via invoke-blob

`invoke-blob` sends a binary file to an entity method. The method receives the file as a `Buffer` argument.

```bash
ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./sample-document.pdf \
  --url http://localhost:3001
```

You should see a response like:

```json
{
  "working_memory_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "filename": "sample-document.pdf",
  "size": 245760
}
```

If you do not have a PDF handy, create a simple text file for testing:

```bash
echo "Q3 2025 Revenue Report. Total revenue: $2.4M. Growth: 15% YoY." > sample-document.txt

ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./sample-document.txt \
  --url http://localhost:3001
```

### Verify the Entity Data Was Updated

Check that the working memory ID was saved to entity data:

```bash
ff-eg-read node get <entity-id> --mode=internal --gateway=http://localhost --internal-port=8180
```

In the response, you should see:

```json
{
  "data": {
    "prompt": "Generate a summary report from this document.",
    "orientation": "portrait",
    "original_document_wm_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "original_filename": "sample-document.pdf"
  }
}
```

### Verify the File in Working Memory

Use `ff-wm-read` to inspect the stored file:

```bash
# List working memory records for this entity
ff-wm-read list --entity-id <entity-id> --gateway=http://localhost --internal-port=8180

# Get details for a specific working memory record
ff-wm-read get <working-memory-id> --gateway=http://localhost --internal-port=8180

# Download the stored file
ff-wm-read download <working-memory-id> --output ./downloaded-document.pdf --gateway=http://localhost --internal-port=8180
```

The `list` command shows all working memory records linked to the entity. The `get` command shows metadata including content type, file size, and custom metadata fields. The `download` command retrieves the actual file bytes.

### Run the Entity

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

You should see:
1. A `STATUS` event with `"status": "STARTED"`
2. An `INTERNAL_UPDATE` confirming the document is stored
3. A `VALUE` event with a confirmation string including the working memory ID
4. A `STATUS` event with `"status": "COMPLETED"`

## Working Memory Patterns

### Storing Multiple Files

An entity can store multiple files in working memory. Each call to `add_memory_from_buffer` creates a new record with its own ID. Use the `metadata` field to distinguish between files:

```typescript
// Store the original document
const originalResult = await this.working_memory_provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: 'original.pdf',
  contentType: 'application/pdf',
  memoryType: 'file',
  buffer: originalBuffer,
  metadata: { stage: 'original_upload' },
});

// Store extracted text
const textResult = await this.working_memory_provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: 'extracted-text.txt',
  contentType: 'text/plain',
  memoryType: 'file',
  buffer: Buffer.from(extractedText, 'utf-8'),
  metadata: { stage: 'text_extraction' },
});

// Store generated PDF
const pdfResult = await this.working_memory_provider.add_memory_from_buffer({
  entityNodeId: this.id!,
  name: 'report.pdf',
  contentType: 'application/pdf',
  memoryType: 'file',
  buffer: pdfBuffer,
  metadata: { stage: 'final_pdf' },
});
```

### Passing Files Between Stages

The working memory ID is a string that can be stored in entity data, passed as an argument to child entities, or sent to external services. This is how the report generation pipeline will work in later parts:

```
Upload      --> original_document_wm_id  --> Text Extraction
Extraction  --> extracted_text_wm_id     --> AI Generation
AI Output   --> html stored in memory    --> PDF Conversion
PDF         --> pdf_working_memory_id    --> Final Result
```

Each stage reads the previous stage's output via its working memory ID and writes its own output to a new working memory record.

## What You've Built

You now have:
- A `ReportEntity` that initializes `WorkingMemoryProvider` with the context service client
- A `process_document` method that stores uploaded files in working memory
- Entity data that tracks the working memory ID for later processing stages
- Content-type detection based on file extension
- Experience using `ff-sdk-cli invoke-blob` for file uploads and `ff-wm-read` for verification

## Key Takeaways

1. **Working memory stores binary files** -- entity data stores JSON, working memory stores blobs. Bridge them with working memory IDs.
2. **getContextServiceClient connects to the context service** -- it takes an address and optional API key, returning a gRPC client.
3. **WorkingMemoryProvider wraps the client** -- use `add_memory_from_buffer` to store files with metadata.
4. **entityNodeId links files to entities** -- every working memory record is associated with an entity node ID.
5. **Metadata is your audit trail** -- store stage, timestamps, file sizes, and source information in the metadata field for debugging and tracking.
6. **invoke-blob sends binary files** -- `ff-sdk-cli invoke-blob` sends a file to an entity method. The method receives a Buffer and the filename.
7. **ff-wm-read verifies storage** -- list, inspect, and download working memory records to confirm files are stored correctly.

## Next Steps

In [Part 5: Document Processing Pipeline](./part-05-doc-processing.md), you'll use the stored document to extract text via the doc-proc service and feed it into the `ReportGenerationEntity` from Part 2, creating a multi-stage processing pipeline.
