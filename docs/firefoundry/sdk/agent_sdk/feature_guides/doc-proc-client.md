# Document Processing Client

A TypeScript client for interacting with the FireFoundry Document Processing Service. This client provides a modern, type-safe interface for document extraction, generation, and transformation operations.

## Features

- **Fully type-safe**: Built with TypeScript and Zod for runtime validation
- **Multiple API patterns**: Generic `processDocument()` or specific convenience methods
- **Flexible input**: Support for `Buffer`, `Blob`, `File`, or working memory references
- **Working memory helpers**: Simplified methods for storing results in working memory
- **Envelope responses**: Structured response format with metadata
- **Self-contained**: Minimal dependencies

## Installation

```bash
npm install @firebrandanalytics/doc-proc-client zod
```

Or if you're using pnpm:

```bash
pnpm add @firebrandanalytics/doc-proc-client zod
```

## Authentication

The Document Processing Service requires an API key for authentication. You can provide the API key in one of two ways:

1. When creating the client:
    ```typescript
    const client = DocProcClient.create({
        baseUrl: 'https://your-doc-proc-service.example.com',
        apiKey: 'your-api-key-here',
    });
    ```

2. After client creation:
    ```typescript
    const client = DocProcClient.create();
    client.setApiKey('your-api-key-here');
    ```

## Usage

### Basic Usage with Convenience Methods

```typescript
import { DocProcClient } from '@firebrandanalytics/doc-proc-client';
import fs from 'fs';

// Create a client instance
const client = DocProcClient.create({
    baseUrl: 'http://localhost:3000',
    timeout: 60000,
});

// Extract text from a PDF
async function extractText() {
    const fileBuffer = fs.readFileSync('document.pdf');
    
    const response = await client.extractText(fileBuffer);
    
    if (response.success) {
        console.log('Extracted text:', response.data);
        console.log('Backend used:', response.metadata.backend_used);
        console.log('Processing time:', response.metadata.processing_time_ms, 'ms');
    }
}
```

### Using the Generic API

```typescript
// Generic processDocument method
async function processWithGenericAPI() {
    const fileBuffer = fs.readFileSync('document.pdf');
    
    const response = await client.processDocument({
        operation: 'extract_text',
        input: {
            file: fileBuffer,
            filename: 'document.pdf',
        },
        options: {
            pages: '1-5', // Extract only first 5 pages
        },
    });
    
    console.log('Result:', response);
}
```

### Multiple Input Formats

```typescript
// 1. Direct Buffer
const buffer = fs.readFileSync('doc.pdf');
await client.extractText(buffer);

// 2. Buffer with explicit filename
await client.extractText({ file: buffer, filename: 'document.pdf' });

// 3. Working memory reference
await client.extractText({ working_memory_id: 'wm-123' });

// 4. File object (browser)
// const file = event.target.files[0];
// await client.extractText(file);
```

### Extraction Operations

```typescript
// Extract plain text
const textResponse = await client.extractText(fileBuffer);

// Extract structured content
const structuredResponse = await client.extractStructured(fileBuffer);

// Extract metadata
const metadataResponse = await client.extractMetadata(fileBuffer);

// Perform OCR
const ocrResponse = await client.ocr(fileBuffer, {
    language: 'eng', // Tesseract language code
});
```

### Generation Operations

```typescript
// Generate PDF from HTML
const htmlBuffer = Buffer.from('<h1>Hello World</h1>');
const pdfResponse = await client.htmlToPdf(htmlBuffer, {
    format: 'Letter',
    landscape: false,
});

// Generate PDF document
const docResponse = await client.generatePdf(contentBuffer);
```

### Transformation Operations

```typescript
// Convert document format
const convertedResponse = await client.convertFormat(fileBuffer, {
    format: 'docx', // Target format
});

// Extract specific pages
const pagesResponse = await client.extractPages(fileBuffer, {
    pages: '1,3,5-10',
});

// Split document
const splitResponse = await client.splitDocument(fileBuffer);

// Merge documents
const mergedResponse = await client.mergeDocuments(filesArray);
```

### Working Memory Operations

Store results directly in the Context Service working memory:

```typescript
// Extract text and store in working memory
const response = await client.extractTextToMemory(
    fileBuffer,
    'output-memory-id-123',
    { pages: '1-5' }
);

if (response.success) {
    console.log('Result stored in memory:', response.working_memory_id);
}

// Other working memory helpers
await client.extractStructuredToMemory(input, outputMemoryId, options);
await client.generatePdfToMemory(input, outputMemoryId, options);
await client.convertFormatToMemory(input, outputMemoryId, options);

// Or use the generic API
await client.processDocument({
    operation: 'extract_text',
    input: { file: buffer, filename: 'doc.pdf' },
    output: { working_memory_id: 'output-123' },
});
```

### Response Envelope

All methods return a structured envelope response:

```typescript
interface DocProcResponse {
    success: boolean;
    working_memory_id?: string;  // If stored in working memory
    data?: Buffer | string;      // Direct result data
    format: string;              // Result format (text, pdf, json, etc.)
    metadata: {
        backend_used: string;
        processing_time_ms: number;
        cached: boolean;
    };
    error?: string;              // Error message if success is false
}
```

### Processing Options

Common options supported by various operations:

```typescript
interface ProcessingOptions {
    pages?: string;        // Page selection (e.g., "1,3,5-10")
    format?: string;       // Override format detection or specify target format
    language?: string;     // OCR language code
    dpi?: number;         // DPI for image operations
    quality?: number;     // Compression quality (0-100)
    [key: string]: any;   // Operation-specific options
}
```

### Error Handling

The client provides comprehensive error handling:

```typescript
import { HTTPError, NetworkError, TimeoutError } from '@firebrandanalytics/doc-proc-client';

try {
    const response = await client.extractText(fileBuffer);
} catch (error) {
    if (error instanceof HTTPError) {
        console.error('HTTP Error:', error.status, error.message);
    } else if (error instanceof NetworkError) {
        console.error('Network Error:', error.message);
    } else if (error instanceof TimeoutError) {
        console.error('Timeout:', error.message);
    } else {
        console.error('Unknown error:', error);
    }
}
```

### Health Checks

```typescript
// Test connection
const isConnected = await client.testConnection();
console.log('Connected:', isConnected);

// Get health status
const health = await client.getHealth();
console.log('Service health:', health);

// Get readiness status
const readiness = await client.getReadiness();
console.log('Service ready:', readiness);
```

## API Reference

### DocProcClient

The main client class for interacting with the Document Processing Service.

#### Constructor & Factory

- `static create(options?: Partial<DocProcClientOptions>): DocProcClient`

Creates a new client with the specified options:
- `baseUrl`: The base URL of the service (default: "http://localhost:3000")
- `headers`: Additional headers to include in all requests
- `timeout`: Request timeout in milliseconds (default: 150000)
- `apiKey`: API key for authentication
- `logger`: Custom logger implementation

#### Core Methods

- `processDocument(request: DocProcRequest): Promise<DocProcResponse>`
- `processDocument(operation: DocumentOperation, request: SimpleDocProcRequest): Promise<DocProcResponse>`

Generic method to process any document operation.

#### Extraction Methods

- `extractText(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `extractStructured(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `extractMetadata(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `ocr(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`

#### Generation Methods

- `generatePdf(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `htmlToPdf(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`

#### Transformation Methods

- `convertFormat(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `extractPages(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `splitDocument(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`
- `mergeDocuments(input: FileInput, options?: ProcessingOptions): Promise<DocProcResponse>`

#### Working Memory Helpers

- `extractTextToMemory(input: FileInput, outputMemoryId: string, options?: ProcessingOptions): Promise<DocProcResponse>`
- `extractStructuredToMemory(input: FileInput, outputMemoryId: string, options?: ProcessingOptions): Promise<DocProcResponse>`
- `generatePdfToMemory(input: FileInput, outputMemoryId: string, options?: ProcessingOptions): Promise<DocProcResponse>`
- `convertFormatToMemory(input: FileInput, outputMemoryId: string, options?: ProcessingOptions): Promise<DocProcResponse>`

#### Utility Methods

- `testConnection(): Promise<boolean>` - Test connection to the service
- `getHealth(): Promise<HealthResponse>` - Get service health status
- `getReadiness(): Promise<HealthResponse>` - Get service readiness status
- `getBaseUrl(): string` - Get the base URL
- `setApiKey(apiKey: string | undefined): void` - Set or clear the API key

## Supported Operations

### Extraction
- `extract_text` - Extract plain text from documents
- `extract_structured` - Extract structured content (tables, lists, etc.)
- `extract_metadata` - Extract document metadata
- `ocr` - Optical Character Recognition

### Generation
- `generate_pdf` - Generate PDF from content
- `html_to_pdf` - Convert HTML to PDF
- `create_document` - Create new document
- `render_chart` - Render charts to images

### Transformation
- `convert_format` - Convert between document formats
- `extract_pages` - Extract specific pages
- `split_document` - Split document into parts
- `merge_documents` - Merge multiple documents
- `resize_image` - Resize images
- `compress_pdf` - Compress PDF files

## Supported Formats

`pdf`, `docx`, `doc`, `xlsx`, `xls`, `pptx`, `ppt`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `html`, `md`, `txt`, `csv`, `json`

## License

MIT

