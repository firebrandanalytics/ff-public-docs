# Context Service

## Overview

The Context Service is FireFoundry's critical working memory and blob storage service, providing persistent state management for agent bundles. It combines PostgreSQL-backed metadata storage with multi-cloud blob storage (Azure and GCS), enabling agents to maintain conversation context, store files, and access historical data through a unified gRPC API.

## Purpose and Role in Platform

In the FireFoundry platform, agents are stateless by design. The Context Service provides the essential persistence layer that transforms ephemeral agent interactions into stateful conversations and workflows. When an agent needs to remember information across interactions, store uploaded files, or access previous conversation history, it communicates with the Context Service through standardized gRPC protocols. This architectural separation allows agents to focus on logic while delegating all state management to a centralized, scalable service.

## Key Features

- **Working Memory Management**: CRUD operations for structured memory records with support for embeddings, metadata, and content storage
- **Multi-Cloud Blob Storage**: Automatic provider detection and abstraction layer supporting Azure Blob Storage and Google Cloud Storage
- **PostgreSQL Metadata Persistence**: Relational storage for working memory records with partitioning by entity node ID
- **Model Context Protocol (MCP) Integration**: Standardized interface for AI agents using Anthropic's MCP with custom InMemoryTransport for single-process efficiency
- **Streaming File Operations**: Bidirectional streaming support for efficient large file uploads and downloads
- **Entity History Tracking**: Retrieve complete conversation and interaction history for any entity
- **Manifest API**: Hierarchical view of working memory organized by entity relationships and memory types
- **Client Library**: TypeScript client (`@firebrandanalytics/cs-client`) with comprehensive examples for working memory and blob operations

## Architecture Overview

The Context Service is organized as a **monorepo** managed by pnpm workspaces and Turbo for optimized build orchestration. The repository structure includes:

**Packages:**
- `packages/transport`: gRPC Protocol Buffer definitions and generated types
- `packages/cs-client`: Client library for Context Service integration
- `packages/db`: Database client and Drizzle ORM schemas

**Services:**
- `services/context-service`: Main service implementation with MCP servers and storage adapters

The service architecture follows a layered approach:
1. **API Layer**: Fastify-based gRPC server using Connect-RPC
2. **MCP Layer**: Model Context Protocol servers (PostgreSQL, Azure Hybrid, etc.) with InMemoryTransport
3. **Storage Layer**: Provider-agnostic blob storage abstraction with auto-detection
4. **Data Layer**: PostgreSQL with Drizzle ORM for metadata and working memory records

## Storage Architecture

### Multi-Cloud Blob Storage

The Context Service implements a **BlobStorageFactory** that automatically detects the appropriate cloud provider based on environment variables:

- **Azure Blob Storage**: Detected when `WORKING_MEMORY_STORAGE_ACCOUNT` is present
- **Google Cloud Storage**: Detected when any `GOOGLE_*` environment variable exists
- **Priority**: GCS takes precedence if both configurations are present (override with `WORKING_MEMORY_STORAGE_PROVIDER`)

Each storage provider implements a common interface (`BlobStorage`) with methods for upload, download, delete, and list operations. The abstraction layer ensures agent bundles remain cloud-agnostic.

### PostgreSQL Metadata Storage

All working memory records are stored in PostgreSQL with:
- **Partitioning**: Records partitioned by `entity_node_id` (typically conversation ID)
- **Memory Types**: Structured types like `code/typescript`, `data/json`, `image/png`, `file`
- **Embeddings**: Optional 1536-dimensional vector embeddings for semantic search
- **Blob References**: Foreign key relationships linking metadata to blob storage keys
- **Metadata**: JSON metadata field for extensible key-value storage

The database schema is managed through Drizzle ORM with migrations in the `migrations/` directory.

## API and Interfaces

### gRPC Service Definition

The Context Service implements a comprehensive gRPC API defined in `context_service.proto`:

**Model Context Protocol APIs:**
- `ListTools`: Discover available tools by context type (RAG, History, WM)
- `ListResources`: Enumerate available resources
- `ExecuteTool`: Execute MCP tools with parameters

**Working Memory APIs:**
- `InsertWMRecord`: Create new working memory record
- `FetchWMRecord`: Retrieve record by UUID
- `FetchWMRecordsByEntity`: List all records for an entity node
- `DeleteWMRecord`: Remove record and associated blob
- `FetchWMManifest`: Get hierarchical memory manifest with filtering

**Blob Storage APIs:**
- `UploadBlob`: Streaming upload with metadata (bidirectional streaming)
- `GetBlob`: Streaming download (server streaming)
- `DeleteBlob`: Remove blob by working memory ID or blob key
- `ListBlobs`: Enumerate blobs for an entity node

**Additional APIs:**
- `GetContent`: Unified content retrieval without provider knowledge
- `ExecuteRAGQuery`: Execute SQL queries for RAG operations
- `FetchEntityHistory`: Retrieve complete entity interaction history
- `GetChatHistory`: Fetch conversation messages for a node

### Client Usage Examples

**Creating a Working Memory Record:**
```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';

const client = new ContextServiceClient();
const record = {
    entityNodeId: randomUUID(),
    memoryType: 'file' as const,
    name: 'Meeting Notes',
    description: 'Team sync discussion points',
    content: {
        notes: 'Discussed Q4 roadmap and resource allocation',
    },
    metadata: {
        date: new Date().toISOString(),
        participants: ['Alice', 'Bob'],
    },
};

const result = await client.insertWMRecord(record);
console.log(`Created record: ${result.id}`);
```

**Uploading a Blob:**
```typescript
const testContent = Buffer.from('File content here');
const { workingMemoryId, blobKey } = await client.uploadBlobFromBuffer({
    entityNodeId: randomUUID(),
    memoryType: 'file',
    name: 'document.txt',
    description: 'Project documentation',
    contentType: 'text/plain',
    buffer: testContent,
    metadata: {
        uploadedAt: new Date().toISOString(),
    },
});
```

## Dependencies

### Runtime Dependencies
- **PostgreSQL**: Primary metadata storage (version 12+)
- **Node.js**: Version 20.11+ required
- **Blob Storage Backend**: One of:
  - Azure Blob Storage (requires `@azure/storage-blob`, `@azure/identity`)
  - Google Cloud Storage (requires `@google-cloud/storage`)
- **MCP SDK**: `@modelcontextprotocol/sdk` for protocol implementation
- **gRPC Libraries**: `@grpc/grpc-js`, `@connectrpc/connect` ecosystem

### Development Dependencies
- **pnpm**: Version 9.15.4+ (package manager)
- **Turbo**: Version 2.3.4+ (monorepo build system)
- **TypeScript**: Version 5.3.3+
- **Drizzle ORM**: For database migrations and schema management

## Configuration

### Required Environment Variables

**Database:**
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/context_service
```

**Azure Blob Storage (Option 1):**
```bash
WORKING_MEMORY_STORAGE_ACCOUNT=yourstorageaccount
WORKING_MEMORY_STORAGE_KEY=your-access-key
WORKING_MEMORY_STORAGE_CONTAINER=your-container-name
```

**Google Cloud Storage (Option 2):**
```bash
# Application Default Credentials (recommended for GCP environments)
GOOGLE_CLOUD_PROJECT=your-project-id
WORKING_MEMORY_STORAGE_CONTAINER=your-bucket-name

# OR Service Account JSON (recommended for containers)
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
WORKING_MEMORY_STORAGE_CONTAINER=your-bucket-name
```

**Service Configuration:**
```bash
CONTEXT_SERVICE_PORT=50051  # Optional, defaults to 50051
API_KEY=your-secure-api-key  # Optional, enables authentication if set
```

**Provider Override (Optional):**
```bash
WORKING_MEMORY_STORAGE_PROVIDER=azure  # or 'gcs'
```

### Container Security Best Practices

For containerized deployments with Google Cloud Storage:

1. **Kubernetes with Workload Identity** (most secure): Use Application Default Credentials without embedding keys
2. **Environment Variable with JSON Key**: Store credentials in Kubernetes secrets referenced by `GOOGLE_APPLICATION_CREDENTIALS_JSON`

Avoid embedding service account key files directly in container images.

## Version and Maturity

- **Current Version**: 2.0.0
- **Status**: GA (General Availability) - Production-ready and stable
- **Node.js Version**: 20.11.0 or higher
- **Package Manager**: pnpm 9.15.4

## Repository

**Source Code**: [github.com/firebrandanalytics/context-service](https://github.com/firebrandanalytics/context-service)

## Related Documentation

- [Platform Overview](/docs/firefoundry/platform/overview.md)
- [Agent SDK - Working Memory](/docs/firefoundry/sdk/working-memory.md)
- [Platform Services Overview](/docs/firefoundry/platform/services/README.md)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Context Service Client Examples](https://github.com/firebrandanalytics/context-service/tree/main/packages/cs-client/src/examples)
