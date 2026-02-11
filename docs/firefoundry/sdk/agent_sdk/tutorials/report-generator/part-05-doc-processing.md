# Part 5: Document Processing Pipeline

In this part, you'll integrate the FireFoundry Document Processing Service to extract text from uploaded documents and convert generated HTML into PDF files. This transforms your report generator from a text-in/text-out tool into a real document processing pipeline.

**What you'll learn:**
- Integrating `DocProcClient` from `@firebrandanalytics/doc-proc-client`
- Extracting text from documents stored in working memory
- Converting HTML content to PDF with page format options
- Storing processed artifacts back into working memory with metadata
- Yielding `INTERNAL_UPDATE` events to report multi-stage progress

**What you'll build:** An entity that takes an uploaded document, extracts its text using the doc-proc service, and converts generated HTML into a downloadable PDF -- all tracked through working memory.

**Starting point:** Completed code from [Part 4: File Storage with Working Memory](./part-04-working-memory.md). You should have an entity that can upload documents to working memory and retrieve them.

---

## Prerequisites

Before continuing, verify that your environment has access to the Document Processing Service. The service URL is configured via the `DOC_PROC_SERVICE_URL` environment variable.

For a deployed cluster, the default in-cluster address is:
```
http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:8081
```

For local development with port-forwarding:
```bash
# Forward the doc-proc service to localhost
kubectl port-forward svc/firefoundry-core-doc-proc-service -n ff-dev 8081:8081
```

Then set the env var in your `.env` file:
```
DOC_PROC_SERVICE_URL=http://localhost:8081
```

---

## Step 1: Install the Document Processing Client

Add the `doc-proc-client` package to your report-bundle:

```bash
cd apps/report-bundle
pnpm add @firebrandanalytics/doc-proc-client zod
```

The `doc-proc-client` provides a typed interface for all document operations -- extraction, generation, conversion, and more. It communicates with a dedicated service that handles the heavy lifting of parsing PDFs, running OCR, rendering HTML, and other document transformations.

---

## Step 2: Update the Entity Data Shape

Your entity needs to track working memory IDs for each stage of processing. Update the DTO data interface to include fields for the extracted text and generated PDF.

**`apps/report-bundle/src/entities/ReportEntity.ts`** (updated data interface):

```typescript
/**
 * Data stored in the ReportEntity.
 * Each stage of the pipeline writes its working memory ID here,
 * creating an audit trail of every artifact produced.
 */
interface ReportEntityDTOData {
  prompt: string;
  orientation: 'portrait' | 'landscape';
  original_document_wm_id?: string;    // Stage 0: uploaded document
  original_filename?: string;           // Original file name for content-type detection
  extracted_text_wm_id?: string;        // Stage 1: extracted plain text
  pdf_working_memory_id?: string;       // Stage 3: final PDF output
  [key: string]: any;  // Index signature for JSONObject compatibility
}
```

Each `*_wm_id` field stores a working memory ID pointing to a file in the Context Service. This pattern gives you full traceability: you can always go back and inspect the intermediate artifacts from any stage.

---

## Step 3: Initialize the DocProcClient

Add the `DocProcClient` and `WorkingMemoryProvider` as instance members of your entity. Both are initialized in the constructor.

**`apps/report-bundle/src/entities/ReportEntity.ts`** (constructor):

```typescript
import {
  RunnableEntity,
  EntityMixin,
  RunnableEntityTypeHelper,
  EntityNodeTypeHelper,
  EntityFactory,
  WorkingMemoryProvider,
  logger
} from '@firebrandanalytics/ff-agent-sdk';
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { UUID, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';

// ... (DTO types from Step 2) ...

type ReportEntityDTO = EntityInstanceNodeDTO<ReportEntityDTOData> & {
  node_type: "ReportEntity";
};

type REPORT_WORKFLOW_OUTPUT = {
  pdf_working_memory_id: string;
  extracted_text: string;
};

type ReportEntityENH = EntityNodeTypeHelper<any, ReportEntityDTO, 'ReportEntity', {}, {}>;
type ReportEntityRETH = RunnableEntityTypeHelper<ReportEntityENH, REPORT_WORKFLOW_OUTPUT>;

@EntityMixin({
  specificType: 'ReportEntity',
  generalType: 'ReportEntity',
  allowedConnections: {}
})
export class ReportEntity extends RunnableEntity<ReportEntityRETH> {
  private docProcClient: DocProcClient;
  private working_memory_provider: WorkingMemoryProvider;

  constructor(factory: EntityFactory<any>, idOrDto: UUID | ReportEntityDTO) {
    super(factory, idOrDto);

    // Initialize doc-proc client.
    // DOC_PROC_SERVICE_URL lets you point at a local instance during development
    // and the in-cluster service in production.
    const docProcUrl = process.env.DOC_PROC_SERVICE_URL ||
      'http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:8081';

    this.docProcClient = DocProcClient.create({
      baseUrl: docProcUrl
    });

    // Initialize working memory provider for storing results.
    // Uses the same Context Service client pattern from Part 4.
    const CONTEXT_SERVICE_ADDRESS = process.env.CONTEXT_SERVICE_ADDRESS ||
      'http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051';
    const CONTEXT_SERVICE_API_KEY = process.env.CONTEXT_SERVICE_API_KEY || '';

    const context_client = new ContextServiceClient({
      address: CONTEXT_SERVICE_ADDRESS,
      apiKey: CONTEXT_SERVICE_API_KEY,
    });
    this.working_memory_provider = new WorkingMemoryProvider(context_client);
  }

  // ... (run_impl and helper methods in the following steps)
}
```

**Why two clients?** The `DocProcClient` handles document transformation (text extraction, PDF rendering). The `WorkingMemoryProvider` handles blob storage in the Context Service. They serve different roles in the pipeline, but work together: doc-proc can read directly from working memory IDs, and you store doc-proc outputs back into working memory.

---

## Step 4: Implement Text Extraction (Stage 1)

The first pipeline stage extracts text from the uploaded document. The `extractGeneral` method is the most flexible extraction method -- it auto-detects the document type and uses the appropriate backend (PDF parser, DOCX reader, OCR, etc.).

```typescript
/**
 * Stage 1: Extract text from document using doc-proc service.
 *
 * The key insight here is that we pass a working_memory_id rather than
 * a raw buffer. The doc-proc service reads the file directly from working
 * memory, avoiding an extra network hop to transfer the file through our
 * entity.
 */
private async extract_document_text(working_memory_id: string): Promise<string> {
  const dto = await this.get_dto();
  const originalFilename = dto.data.original_filename || 'document';

  logger.info('[ReportEntity] Extracting text from working memory', {
    working_memory_id,
    original_filename: originalFilename
  });

  // extractGeneral auto-detects the document type and extracts text.
  // Arguments:
  //   1. Input: { working_memory_id } - tells doc-proc to read from WM
  //   2. Options: {} - no special options needed
  //   3. envelope: true - returns full response with metadata
  const extractResult = await this.docProcClient.extractGeneral(
    { working_memory_id },  // Input reference to working memory
    {},                      // Processing options (pages, language, etc.)
    true                     // Return full envelope with metadata
  );

  const extractedText = extractResult.data as string;
  logger.info('[ReportEntity] Text extraction complete', {
    text_length: extractedText.length,
    extraction_method: extractResult.metadata?.extraction_method
  });

  // Store extracted text in working memory for audit trail.
  // This is optional but valuable: it lets you inspect what the AI
  // "sees" as input, which is crucial for debugging prompt issues.
  const textBuffer = Buffer.from(extractedText, 'utf-8');
  const textWmResult = await this.working_memory_provider.add_memory_from_buffer({
    entityNodeId: this.id!,
    name: `extracted-text-${this.id}.txt`,
    description: 'Extracted text from document',
    contentType: 'text/plain',
    memoryType: 'file',
    buffer: textBuffer,
    metadata: {
      stage: 'text_extraction',
      source_wm_id: working_memory_id,
      text_length: extractedText.length,
      extracted_at: new Date().toISOString()
    },
  });

  // Update entity data with the extracted text working memory ID.
  // This creates a breadcrumb trail: at any point, you can look at
  // the entity's data to find every artifact it produced.
  const currentDto = await this.get_dto();
  await this.update_data({
    ...currentDto.data,
    extracted_text_wm_id: textWmResult.workingMemoryId
  });

  return extractedText;
}
```

### Understanding `extractGeneral`

The `extractGeneral` method accepts three arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `input` | `FileInput` | A `Buffer`, `{ file, filename }` pair, or `{ working_memory_id }` reference |
| `options` | `ProcessingOptions` | Optional settings like `pages`, `language` for OCR, etc. |
| `envelope` | `boolean` | When `true`, returns the full `DocProcResponse` with metadata |

When you pass `{ working_memory_id }`, the doc-proc service fetches the file directly from the Context Service. This is more efficient than downloading the file to your entity and re-uploading it, especially for large documents.

The response envelope includes useful metadata:
```typescript
{
  success: boolean;
  data: string;                    // The extracted text
  format: 'text';
  metadata: {
    backend_used: string;          // Which extraction engine was used
    processing_time_ms: number;    // How long extraction took
    extraction_method?: string;    // PDF parser, OCR, etc.
    cached: boolean;               // Whether result came from cache
  };
}
```

---

## Step 5: Implement HTML-to-PDF Conversion (Stage 3)

The third pipeline stage converts the AI-generated HTML report into a PDF file. The `htmlToPdf` method renders HTML using a headless browser and returns a PDF buffer.

```typescript
/**
 * Stage 3: Convert HTML to PDF using doc-proc service.
 *
 * The htmlToPdf method uses a headless browser to render the HTML,
 * then captures it as a PDF. This means your HTML can use full CSS
 * (media queries, flexbox, grid) and it will render faithfully.
 */
private async convert_to_pdf(
  html_content: string,
  orientation: 'portrait' | 'landscape'
): Promise<string> {
  const htmlBuffer = Buffer.from(html_content, 'utf-8');

  // Convert HTML to PDF with page format and orientation.
  // The file/filename pair tells doc-proc this is an HTML file.
  const pdfResult = await this.docProcClient.htmlToPdf(
    { file: htmlBuffer, filename: 'report.html' },
    {
      format: 'Letter',                           // US Letter size (8.5" x 11")
      landscape: orientation === 'landscape'       // Orientation from entity data
    }
  );

  const pdfBuffer = pdfResult.data as Buffer;
  logger.info('[ReportEntity] PDF conversion complete', {
    pdf_size: pdfBuffer.length,
    orientation
  });

  // Store PDF in working memory so it can be downloaded later
  const pdfFilename = `report-${this.id}-${Date.now()}.pdf`;
  const pdfWmResult = await this.working_memory_provider.add_memory_from_buffer({
    entityNodeId: this.id!,
    name: pdfFilename,
    description: `Generated PDF report (${orientation} orientation)`,
    contentType: 'application/pdf',
    memoryType: 'file',
    buffer: pdfBuffer,
    metadata: {
      filename: pdfFilename,
      file_size: pdfBuffer.length,
      orientation: orientation,
      stage: 'final_pdf',
      generated_at: new Date().toISOString()
    },
  });

  const pdfWorkingMemoryId = pdfWmResult.workingMemoryId;
  logger.info('[ReportEntity] PDF stored in working memory', {
    working_memory_id: pdfWorkingMemoryId,
    size: pdfBuffer.length
  });

  // Update entity data with the PDF working memory ID
  const currentDto = await this.get_dto();
  await this.update_data({
    ...currentDto.data,
    pdf_working_memory_id: pdfWorkingMemoryId
  });

  return pdfWorkingMemoryId;
}
```

### Understanding `htmlToPdf`

The `htmlToPdf` method accepts these arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `input` | `FileInput` | HTML content as `{ file: Buffer, filename: string }` |
| `options` | `ProcessingOptions` | Page settings: `format`, `landscape`, `margin`, etc. |

Common page format options:

| Option | Values | Default |
|--------|--------|---------|
| `format` | `'Letter'`, `'A4'`, `'Legal'`, `'Tabloid'` | `'Letter'` |
| `landscape` | `true` / `false` | `false` |
| `margin` | `{ top, right, bottom, left }` (CSS units) | Browser defaults |

---

## Step 6: Wire Up the Multi-Stage Pipeline with Progress Events

Now bring together the extraction and conversion stages in `run_impl`. The key pattern here is yielding `INTERNAL_UPDATE` events at each stage boundary so that clients can track progress in real time.

```typescript
protected override async *run_impl(): AsyncGenerator<any, REPORT_WORKFLOW_OUTPUT, never> {
  const startTime = Date.now();
  const dto = await this.get_dto();
  const { prompt, orientation, original_document_wm_id } = dto.data;

  if (!original_document_wm_id) {
    throw new Error('No document uploaded - original_document_wm_id is missing');
  }

  yield {
    type: "INTERNAL_UPDATE",
    message: "Starting report generation workflow",
    metadata: {
      stage: "workflow_start",
      entity_id: this.id,
      orientation,
      prompt_length: prompt.length
    }
  };

  try {
    // -- Stage 1: Extract text from document --
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 1/3: Extracting text from document",
      metadata: { stage: "text_extraction", working_memory_id: original_document_wm_id }
    };

    const extractedText = await this.extract_document_text(original_document_wm_id);

    yield {
      type: "INTERNAL_UPDATE",
      message: `Text extraction complete (${extractedText.length} characters)`,
      metadata: {
        stage: "text_extraction_complete",
        text_length: extractedText.length,
        word_count: extractedText.split(/\s+/).length
      }
    };

    // -- Stage 2: Generate HTML (placeholder for Part 6) --
    // For now, we create a simple HTML report from the extracted text.
    // In Part 6, this becomes an AI-powered generation step via a
    // child ReportGenerationEntity.
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 2/3: Generating HTML report",
      metadata: { stage: "html_generation" }
    };

    const html_content = this.generate_simple_html(extractedText, prompt, orientation);

    yield {
      type: "INTERNAL_UPDATE",
      message: `HTML generation complete (${html_content.length} characters)`,
      metadata: { stage: "html_generation_complete", html_length: html_content.length }
    };

    // -- Stage 3: Convert HTML to PDF --
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 3/3: Converting HTML to PDF",
      metadata: { stage: "pdf_conversion" }
    };

    const pdfWorkingMemoryId = await this.convert_to_pdf(html_content, orientation);

    const processingTime = Date.now() - startTime;

    yield {
      type: "INTERNAL_UPDATE",
      message: "Report generation complete",
      metadata: {
        stage: "workflow_complete",
        pdf_working_memory_id: pdfWorkingMemoryId,
        processing_time_ms: processingTime
      }
    };

    logger.info('[ReportEntity] Workflow complete', {
      entity_id: this.id,
      pdf_working_memory_id: pdfWorkingMemoryId,
      processing_time_ms: processingTime
    });

    return {
      pdf_working_memory_id: pdfWorkingMemoryId,
      extracted_text: extractedText
    };

  } catch (error) {
    logger.error('[ReportEntity] Workflow failed', { entity_id: this.id, error });

    yield {
      type: "INTERNAL_UPDATE",
      message: `Workflow failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: {
        stage: "workflow_failed",
        error: error instanceof Error ? error.message : String(error)
      }
    };

    throw error;
  }
}

/**
 * Temporary placeholder for HTML generation.
 * In Part 6, this is replaced by AI-powered generation
 * via a child ReportGenerationEntity.
 */
private generate_simple_html(
  text: string,
  prompt: string,
  orientation: 'portrait' | 'landscape'
): string {
  const width = orientation === 'landscape' ? '11in' : '8.5in';
  const height = orientation === 'landscape' ? '8.5in' : '11in';
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: ${width} ${height}; margin: 1in; }
    body { font-family: 'Georgia', serif; line-height: 1.6; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 10px; }
    .content { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Generated Report</h1>
  <p><em>Instructions: ${prompt}</em></p>
  <hr>
  <div class="content">${text}</div>
</body>
</html>`;
}
```

### The INTERNAL_UPDATE Pattern

Progress events follow a consistent structure:

```typescript
yield {
  type: "INTERNAL_UPDATE",     // Event type recognized by the framework
  message: string,             // Human-readable status message
  metadata: {                  // Machine-readable data for clients
    stage: string,             // Pipeline stage identifier
    // ... additional context
  }
};
```

Clients connected via an iterator (see Testing section below) receive these events in real time. This is what powers progress bars, status messages, and stage indicators in a UI.

---

## Step 7: Update the Constructor Map

Make sure your entity is registered. If you already have `ReportEntity` registered from Part 4, no changes are needed here.

**`apps/report-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { ReportEntity } from './entities/ReportEntity.js';

export const ReportBundleConstructors = {
  ...FFConstructors,
  ReportEntity: ReportEntity,
} as const;
```

---

## Step 8: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

Make sure `DOC_PROC_SERVICE_URL` is set in your deployment configuration (Kubernetes ConfigMap, `.env` file, or equivalent).

---

## Step 9: Test with ff-sdk-cli

### 9.1 Upload a Document and Create the Entity

First, create a ReportEntity with a reference to an already-uploaded document (from Part 4), or upload a new one:

```bash
# Create a report entity with document reference
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportEntity",
    "data": {
      "prompt": "Summarize the key findings in a professional report format",
      "orientation": "portrait",
      "original_document_wm_id": "<your-working-memory-id-from-part-4>",
      "original_filename": "quarterly-report.pdf"
    }
  }' \
  --url http://localhost:3001
```

Note the returned `entity_id`.

### 9.2 Run the Pipeline and Watch Progress

Use the iterator to start the entity and stream progress events:

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

You should see a sequence of events like this:

```
[STATUS]          status: STARTED
[INTERNAL_UPDATE] Stage 1/3: Extracting text from document
[INTERNAL_UPDATE] Text extraction complete (12847 characters)
[INTERNAL_UPDATE] Stage 2/3: Generating HTML report
[INTERNAL_UPDATE] HTML generation complete (3421 characters)
[INTERNAL_UPDATE] Stage 3/3: Converting HTML to PDF
[INTERNAL_UPDATE] Report generation complete
[VALUE]           { pdf_working_memory_id: "wm-abc123...", extracted_text: "..." }
[STATUS]          status: COMPLETED
```

### 9.3 Verify the Extracted Text

Use `ff-wm-read` to inspect the extracted text stored in working memory:

```bash
# Get the extracted_text_wm_id from the entity data
ff-eg-read node get <entity-id> --mode=internal --gateway=http://localhost --internal-port=8180

# Download and inspect the extracted text
ff-wm-read download <extracted-text-wm-id>
```

### 9.4 Download the Generated PDF

```bash
# Download the PDF from working memory
ff-wm-read download <pdf-working-memory-id> --output report.pdf

# Open it to verify the formatting
open report.pdf   # macOS
xdg-open report.pdf  # Linux
```

### 9.5 Verify the Entity's Artifact Trail

Inspect the entity to confirm all working memory IDs are tracked:

```bash
ff-eg-read node get <entity-id> --mode=internal --gateway=http://localhost --internal-port=8180
```

You should see `original_document_wm_id`, `extracted_text_wm_id`, and `pdf_working_memory_id` all populated in the entity's data.

### Inspect Progress Envelopes After Completion

After the workflow finishes, you can use `ff-eg-read` to inspect the entity's final state and see what happened during processing:

```bash
# View the entity's status, data, and metadata
ff-eg-read node get <entity-id> --mode=internal --gateway=http://localhost --internal-port=8180
```

Check that:
- `status` is `Completed`
- `data.original_document_wm_id` contains the uploaded document's working memory ID
- `data.extracted_text_wm_id` contains the extracted text's working memory ID
- `data.pdf_working_memory_id` contains the generated PDF's working memory ID

This is the "after the fact" complement to the real-time progress streaming you saw during `iterator run`. The entity graph is your audit trail -- every piece of state is persisted and inspectable.

---

## What You've Built

You now have:
- A document processing pipeline that extracts text from uploaded files using the doc-proc service
- HTML-to-PDF conversion with configurable page orientation
- Full working memory integration -- every artifact (original, extracted text, final PDF) is stored and tracked
- Real-time progress streaming via `INTERNAL_UPDATE` events at each stage boundary
- A simple HTML generation placeholder that will become AI-powered in Part 6

The pipeline architecture looks like this:

```
Working Memory (original doc)
       |
       v
extractGeneral({ working_memory_id })    <-- Stage 1
       |
       v
Working Memory (extracted text)
       |
       v
generate_simple_html(text, prompt)        <-- Stage 2 (placeholder)
       |
       v
htmlToPdf({ file, filename }, options)    <-- Stage 3
       |
       v
Working Memory (final PDF)
```

---

## Key Takeaways

1. **DocProcClient is the gateway to document operations** -- it provides `extractGeneral` for text extraction, `htmlToPdf` for rendering, and many other operations. Always initialize it from `DOC_PROC_SERVICE_URL` for environment flexibility.

2. **Working memory IDs flow through the pipeline** -- rather than passing raw buffers between stages, each stage reads from and writes to working memory. This creates an audit trail and avoids large in-memory transfers.

3. **`extractGeneral` accepts working memory references** -- passing `{ working_memory_id }` lets the doc-proc service read the file directly from the Context Service, which is more efficient than downloading it to your entity first.

4. **`htmlToPdf` renders with a headless browser** -- your HTML can use full CSS including `@page` rules, flexbox, grid, and print media queries. The result is a high-fidelity PDF.

5. **INTERNAL_UPDATE events are your progress protocol** -- yield them at stage boundaries with both human-readable messages and machine-readable metadata. Clients use these to show real-time progress.

6. **Always update entity data after each stage** -- calling `update_data` with the new working memory ID ensures the entity's state survives restarts. If the pipeline crashes mid-way, you can inspect exactly which stages completed.

---

## Next Steps

In [Part 6: Workflow Orchestration](./part-06-orchestration.md), we'll replace the placeholder HTML generation with an AI-powered child entity. You'll learn the `appendOrRetrieveCall` pattern for creating child entities, the `yield*` delegation pattern for streaming child progress upstream, and how to build a true multi-entity orchestration workflow.
