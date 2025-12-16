# Context Service + MinIO Integration

This guide covers configuring the Context Service to use bundled MinIO for S3-compatible blob storage in a self-contained FireFoundry Core deployment.

## Overview

The Context Service implements a **hybrid storage model**:

| Data Type | Storage Location | Purpose |
|-----------|------------------|---------|
| Metadata (names, descriptions, timestamps) | PostgreSQL | Fast queries, relationships |
| Binary content (code, images, files) | MinIO (S3) | Scalable blob storage |
| Embeddings (vector search) | PostgreSQL (pgvector) | Semantic retrieval (optional) |

When MinIO is enabled, the Context Service automatically stores large binary artifacts in MinIO while keeping metadata in PostgreSQL for fast retrieval.

## Architecture

```mermaid
flowchart TB
    subgraph cs["Context Service"]
        grpc["gRPC API<br/>:50051"]
        wmops["Working<br/>Memory Ops"]
        blobprov["Blob Storage<br/>Provider"]

        grpc --> wmops --> blobprov
    end

    blobprov --> postgres[("PostgreSQL<br/>(Metadata)")]
    blobprov --> minio[("MinIO<br/>(S3 Blobs)")]
    blobprov --> cloud[("Azure/GCS<br/>(Production)")]
```

## Configuration

### Helm Values

Configure the Context Service to use bundled MinIO in your `values.yaml`:

```yaml
# Enable bundled MinIO
minio:
  enabled: true
  mode: standalone
  auth:
    rootUser: "minioadmin"
    rootPassword: "your-secure-password"  # Change in production!
  defaultBuckets: "context-service,doc-proc"
  persistence:
    enabled: true
    size: 20Gi
  service:
    type: ClusterIP
    ports:
      api: 9000
      console: 9001

# Configure Context Service to use MinIO
context-service:
  enabled: true
  configMap:
    data:
      CONTEXT_SERVICE_PORT: "50051"
      # S3/MinIO Storage Configuration
      BLOB_STORAGE_PROVIDER: "s3"
      BLOB_STORAGE_CONTAINER: "context-service"
      AWS_REGION: "us-east-1"
      AWS_S3_ENDPOINT: "http://firefoundry-core-minio:9000"
      # Database schemas
      WORKING_MEMORY_DATABASE_SCHEMA: "wm"
      HISTORY_DATABASE_SCHEMA: "entity"
  secret:
    data:
      # MinIO credentials (must match minio.auth settings)
      AWS_ACCESS_KEY_ID: "minioadmin"
      AWS_SECRET_ACCESS_KEY: "your-secure-password"
      # PostgreSQL connection strings
      WORKING_MEMORY_DATABASE_URL: "postgresql://fireinsert:password@firefoundry-core-postgresql:5432/firefoundry"
      RAG_DATABASE_URL: "postgresql://fireinsert:password@firefoundry-core-postgresql:5432/firefoundry"
      HISTORY_DATABASE_URL: "postgresql://fireinsert:password@firefoundry-core-postgresql:5432/firefoundry"
```

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `BLOB_STORAGE_PROVIDER` | Yes | Set to `s3` for MinIO |
| `BLOB_STORAGE_CONTAINER` | Yes | Bucket name (e.g., `context-service`) |
| `AWS_S3_ENDPOINT` | Yes | MinIO endpoint URL |
| `AWS_REGION` | Yes | AWS region (use `us-east-1` for MinIO) |
| `AWS_ACCESS_KEY_ID` | Yes | MinIO root user |
| `AWS_SECRET_ACCESS_KEY` | Yes | MinIO root password |
| `WORKING_MEMORY_DATABASE_URL` | Yes | PostgreSQL connection string |

### Storage Provider Selection

The Context Service supports multiple storage backends with automatic detection:

| Provider | Detection | Use Case |
|----------|-----------|----------|
| **S3/MinIO** | `BLOB_STORAGE_PROVIDER=s3` | Self-contained, AWS |
| **Azure Blob** | `WORKING_MEMORY_STORAGE_ACCOUNT` present | Azure deployments |
| **Google Cloud Storage** | `GOOGLE_CLOUD_PROJECT` present | GCP deployments |

For self-contained deployments, explicitly set `BLOB_STORAGE_PROVIDER=s3` to ensure MinIO is used.

## Bucket Configuration

MinIO automatically creates buckets on startup via the `defaultBuckets` setting:

```yaml
minio:
  defaultBuckets: "context-service,doc-proc"
```

This creates:
- `context-service` - Working memory blobs for Context Service
- `doc-proc` - Document storage for Doc Proc Service

### Manual Bucket Management

If you need to create additional buckets or manage existing ones:

```bash
# Port-forward to MinIO
kubectl port-forward svc/firefoundry-core-minio 9000:9000 -n <namespace>

# Use MinIO client (mc)
mc alias set local http://localhost:9000 minioadmin your-secure-password
mc mb local/my-new-bucket
mc ls local/
```

## Working Memory Operations

### Data Model

Working memory records are stored with this structure:

```
PostgreSQL (wm.working_memory table)
├── id (UUID)
├── entity_node_id (UUID, optional)
├── memory_type ('code/typescript', 'data/json', 'image/png', 'file')
├── name
├── description
├── reasoning (optional)
├── metadata (JSONB)
├── provider ('postgres' | 'azure_blob' | 'git')
├── blob_key (reference to MinIO object)
├── status ('active' | 'archived')
├── created_at
└── action_log (JSONB audit trail)

MinIO (context-service bucket)
└── {blob_key} → Binary content
```

### Client Usage

Use the `@firebrandanalytics/cs-client` package to interact with the Context Service:

```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';

// Create client
const client = new ContextServiceClient({
    address: 'http://localhost:50051',
    apiKey: 'your-api-key',  // Optional
    environment: 'default',   // Kubernetes namespace for Kong routing
});

// Upload a blob to MinIO
const { workingMemoryId, blobKey } = await client.uploadBlobFromBuffer({
    entityNodeId: 'entity-uuid',  // Optional parent entity
    memoryType: 'file',
    name: 'document.pdf',
    description: 'Important document',
    contentType: 'application/pdf',
    buffer: fileBuffer,
    metadata: {
        uploadedAt: new Date().toISOString(),
        source: 'user-upload',
    },
});

console.log(`Uploaded: ${blobKey}`);

// Download blob from MinIO
const { buffer, contentType, workingMemoryRecord } = await client.getBlobAsBuffer({
    key: blobKey,
    includeMetadata: true,
});

console.log(`Downloaded ${buffer.length} bytes, type: ${contentType}`);

// List blobs for an entity
const { blobKeys } = await client.listBlobs(entityNodeId);
console.log(`Found ${blobKeys.length} blobs`);

// Delete blob (soft delete - archives the record)
await client.deleteBlob({ blobKey });
```

### Streaming Large Files

For large files, use streaming upload with progress tracking:

```typescript
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

const filePath = '/path/to/large-file.zip';
const fileStats = await stat(filePath);

const { workingMemoryId, blobKey } = await client.uploadBlobFromStream({
    entityNodeId: 'entity-uuid',
    memoryType: 'file',
    name: 'large-file.zip',
    description: 'Large archive file',
    contentType: 'application/zip',
    stream: createReadStream(filePath),
    totalSize: fileStats.size,
    onProgress: (bytesUploaded) => {
        const pct = Math.round((bytesUploaded / fileStats.size) * 100);
        console.log(`Upload progress: ${pct}%`);
    },
});
```

## Database Schema

The Context Service uses Drizzle ORM for database operations. Migrations run automatically on startup.

### Working Memory Schema

```sql
-- Schema: wm
CREATE TABLE wm.working_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_node_id UUID,
    memory_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    reasoning TEXT,
    metadata JSONB,
    provider TEXT NOT NULL,  -- 'postgres', 'azure_blob', 'git'
    lookup_info JSONB,
    blob_key TEXT,           -- Reference to MinIO object
    status TEXT NOT NULL DEFAULT 'active',
    action_log JSONB NOT NULL DEFAULT '{"actions":[]}',
    created_at TIMESTAMP DEFAULT now() NOT NULL
);

CREATE TABLE wm.memory_content (
    working_memory_id UUID PRIMARY KEY REFERENCES wm.working_memory(id),
    content JSONB
);
```

### Vector Search (Optional)

Vector similarity search requires the pgvector extension, which is not included in standard Bitnami PostgreSQL. If you need embedding support:

1. Use a PostgreSQL image with pgvector (e.g., `pgvector/pgvector:pg16`)
2. Manually add the embedding column:

```sql
-- Requires pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE wm.working_memory ADD COLUMN embedding vector(1536);
CREATE INDEX embedding_idx ON wm.working_memory USING hnsw (embedding vector_cosine_ops);
```

## Testing the Integration

### Verify Services

```bash
# Check pods are running
kubectl get pods -n <namespace>

# Expected output:
# firefoundry-core-context-service-xxxxx     1/1     Running
# firefoundry-core-minio-xxxxx               1/1     Running
# firefoundry-core-postgresql-0              1/1     Running

# Check MinIO bucket exists
kubectl exec -n <namespace> deploy/firefoundry-core-minio -- \
  mc ls local/context-service
```

### Port Forward for Testing

```bash
# Forward Context Service gRPC port
kubectl port-forward svc/firefoundry-core-context-service 50051:50051 -n <namespace>

# Forward MinIO API (optional, for debugging)
kubectl port-forward svc/firefoundry-core-minio 9000:9000 -n <namespace>
```

### Run Integration Tests

Use the test script in the context-client package:

```bash
cd ff-core-types/packages/context-client

# Set environment variables
export CONTEXT_SERVICE_URL=http://localhost:50051
export CONTEXT_SERVICE_API_KEY=your-api-key

# Run tests
npx tsx src/examples/test-context-minio.ts
```

Expected output:
```
Context Service + MinIO Integration Tests
Address: http://localhost:50051
...
TEST SUMMARY
  Passed: 26
  Failed: 0
  Total:  26

All tests passed! Context Service + MinIO integration is working correctly.
```

## Troubleshooting

### Context Service Cannot Connect to MinIO

**Symptom:** Errors like `ECONNREFUSED` or `NoSuchBucket`

**Check:**
1. Verify MinIO is running:
   ```bash
   kubectl get pods -n <namespace> | grep minio
   ```

2. Verify bucket exists:
   ```bash
   kubectl exec -n <namespace> deploy/firefoundry-core-minio -- mc ls local/
   ```

3. Check Context Service environment variables:
   ```bash
   kubectl exec -n <namespace> deploy/firefoundry-core-context-service -- env | grep AWS
   ```

4. Verify endpoint URL matches service name:
   ```bash
   kubectl get svc -n <namespace> | grep minio
   # Endpoint should be: http://firefoundry-core-minio:9000
   ```

### Working Memory Insert Fails

**Symptom:** `column "embedding" does not exist`

**Cause:** The Context Service schema includes an optional embedding column that requires pgvector.

**Solution:** Use a Context Service image built without the embedding column requirement (version 3.1.0+), or add the column manually if you have pgvector.

### Blobs Upload but Download Fails

**Symptom:** Upload succeeds, but download returns empty or errors

**Check:**
1. Verify blob exists in MinIO:
   ```bash
   kubectl exec -n <namespace> deploy/firefoundry-core-minio -- \
     mc ls local/context-service/<blob-key>
   ```

2. Check working memory record in PostgreSQL:
   ```bash
   kubectl exec -n <namespace> firefoundry-core-postgresql-0 -- \
     psql -U postgres -d firefoundry -c \
     "SELECT id, blob_key, provider FROM wm.working_memory WHERE blob_key IS NOT NULL LIMIT 5;"
   ```

### Migration Fails

**Symptom:** Context Service pod crashes with migration errors

**Check migration logs:**
```bash
kubectl logs -n <namespace> -l app.kubernetes.io/name=context-service -c migrate
```

**Common fixes:**
- Ensure PostgreSQL is fully ready before Context Service starts
- Check database credentials in secrets
- Verify `WORKING_MEMORY_DATABASE_URL` is correctly formatted

## Performance Considerations

### MinIO Sizing

For development/testing, the default 20Gi is sufficient. For production-like testing:

```yaml
minio:
  persistence:
    size: 100Gi
  resources:
    requests:
      memory: "512Mi"
      cpu: "250m"
    limits:
      memory: "2Gi"
      cpu: "1000m"
```

### Connection Pooling

The Context Service maintains connection pools to both PostgreSQL and MinIO. Default settings work for most cases, but can be tuned via environment variables if needed.

## Migration to Production Storage

When moving from self-contained MinIO to production storage (Azure Blob or GCS):

1. **Export data from MinIO** (if needed):
   ```bash
   mc mirror local/context-service ./backup/
   ```

2. **Update configuration** to use production storage:
   ```yaml
   context-service:
     configMap:
       data:
         # Remove S3/MinIO settings
         # BLOB_STORAGE_PROVIDER: "s3"
         # AWS_S3_ENDPOINT: "..."
     secret:
       data:
         # Add Azure Blob settings
         WORKING_MEMORY_STORAGE_ACCOUNT: "your-storage-account"
         WORKING_MEMORY_STORAGE_KEY: "your-storage-key"
         WORKING_MEMORY_STORAGE_CONTAINER: "context-service"
   ```

3. **Disable bundled MinIO**:
   ```yaml
   minio:
     enabled: false
   ```

4. **Import data** to production storage (if migrating existing data).

## Related Documentation

- [Context Service Client Guide](../clients/CONTEXT_CLIENT_GUIDE.md)
- [Self-Contained Deployment Overview](./README.md)
- [Database Setup](./database-setup.md)
