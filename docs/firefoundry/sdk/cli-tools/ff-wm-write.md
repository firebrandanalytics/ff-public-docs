# ff-wm-write — Working Memory Write Operations

Write data to FireFoundry working memory. Create structured records, upload files (blobs), and associate them with entities.

**Use with caution** — these operations modify data. Write permissions are required.

## Installation

```bash
npm install -g @firebrandanalytics/ff-wm-write
```

Verify:

```bash
ff-wm-write --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_GATEWAY` | Kong gateway URL (e.g., `http://localhost`) | |
| `FF_API_KEY` | Kong API key for authentication (must have write access) | |
| `FF_NAMESPACE` | Kubernetes namespace | |
| `FF_PORT` | Gateway port | `30080` |

Command-line flags override environment variables:

| Flag | Overrides |
|------|-----------|
| `--gateway <url>` | `FF_GATEWAY` |
| `--api-key <key>` | `FF_API_KEY` |
| `--namespace <ns>` | `FF_NAMESPACE` |
| `--port <port>` | `FF_PORT` |

## Quick Reference

| Command | Purpose |
|---------|---------|
| `record create` | Create a new working memory record |
| `record delete <id>` | Delete (archive) a record |
| `blob upload <file>` | Upload a file as a blob |
| `blob delete` | Delete a blob by WM ID or blob key |

## Command Reference

### record — Structured Data Records

Create and delete working memory records (JSON or plain text) attached to entities.

#### record create

Create a new working memory record.

```bash
ff-wm-write record create [options]
```

| Option | Required | Purpose |
|--------|----------|---------|
| `--name <string>` | Yes | Record name |
| `--description <string>` | Yes | Record description |
| `--memory-type <string>` | Yes | Memory type (e.g., `data/json`, `code/typescript`, `file`) |
| `--entity-node-id <string>` | No | Entity node ID to associate with |
| `--content <json>` | No | Content as JSON string |
| `--metadata <json>` | No | Metadata as JSON string |
| `--reasoning <string>` | No | Reasoning for creating this record |

```bash
# Store JSON data for an entity
ff-wm-write record create \
  --name "Analysis Results" \
  --description "ML model analysis output" \
  --memory-type "data/json" \
  --entity-node-id "entity-uuid" \
  --content '{"accuracy": 0.95, "f1_score": 0.92}' \
  --reasoning "Storing model evaluation metrics"

# Create a minimal record
ff-wm-write record create \
  --name "Config" \
  --description "Processing config" \
  --memory-type "data/json" \
  --content '{"mode": "strict"}'

# Capture the ID of the created record
RECORD_ID=$(ff-wm-write record create \
  --name "Output" \
  --description "Processing output" \
  --memory-type "data/json" \
  --content '{"result": "success"}' | jq -r '.id')
echo "Created record: $RECORD_ID"

# Store content from a file
ff-wm-write record create \
  --name "Configuration" \
  --description "Pipeline configuration" \
  --memory-type "data/json" \
  --entity-node-id "entity-uuid" \
  --content "$(cat ./config.json)"
```

#### record delete

Delete (archive) a working memory record.

```bash
ff-wm-write record delete <wm-record-id>
```

```bash
# Delete a specific record
ff-wm-write record delete "wm-record-uuid"

# Verify deletion
ff-wm-read record get "wm-record-uuid"
# → error (record archived)
```

### blob — Binary File Upload

Upload and delete binary files (PDFs, images, CSVs, code files, etc.) in blob storage.

#### blob upload

Upload a file as a blob.

```bash
ff-wm-write blob upload <file-path> [options]
```

| Option | Required | Purpose |
|--------|----------|---------|
| `--name <string>` | Yes | Blob name |
| `--description <string>` | Yes | Blob description |
| `--memory-type <string>` | Yes | Memory type (e.g., `file`, `code/typescript`, `image/png`) |
| `--entity-node-id <string>` | No | Entity node ID to associate with |
| `--content-type <string>` | No | MIME content type (auto-detected from extension if omitted) |
| `--metadata <json>` | No | Metadata as JSON string |
| `--reasoning <string>` | No | Reasoning for uploading this blob |

Auto-detected content types:

| Extension | Content Type |
|-----------|--------------|
| `.json` | `application/json` |
| `.ts` | `text/typescript` |
| `.js` | `text/javascript` |
| `.txt` | `text/plain` |
| `.md` | `text/markdown` |
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.pdf` | `application/pdf` |
| `.zip` | `application/zip` |

```bash
# Upload a PDF document
ff-wm-write blob upload ./invoice.pdf \
  --name "Test Invoice" \
  --description "Sample invoice for testing" \
  --memory-type "file" \
  --entity-node-id "entity-uuid"

# Upload a code file
ff-wm-write blob upload ./analysis.ts \
  --name "Analysis Script" \
  --description "TypeScript analysis implementation" \
  --memory-type "code/typescript" \
  --entity-node-id "project-uuid"

# Upload with explicit content type (for unrecognized extensions)
ff-wm-write blob upload ./diagram.webp \
  --name "Architecture Diagram" \
  --description "System architecture overview" \
  --memory-type "image/png" \
  --content-type "image/webp" \
  --entity-node-id "docs-uuid"

# Capture the blob key after upload
BLOB_KEY=$(ff-wm-write blob upload ./file.pdf \
  --name "File" \
  --description "Test file" \
  --memory-type "file" | jq -r '.blob_key')
echo "Blob key: $BLOB_KEY"
```

#### blob delete

Delete a blob by working memory ID or blob key. At least one identifier is required.

```bash
ff-wm-write blob delete [options]
```

| Option | Purpose |
|--------|---------|
| `--working-memory-id <string>` | Working memory record ID |
| `--blob-key <string>` | Blob storage key |

```bash
# Delete by working memory ID
ff-wm-write blob delete --working-memory-id "wm-record-uuid"

# Delete by blob key
ff-wm-write blob delete --blob-key "blob-storage-key"
```

## Common Workflows

### Upload a Document for Processing

```bash
# 1. Upload the file
ff-wm-write blob upload ./invoice.pdf \
  --name "Invoice" \
  --description "Invoice for processing" \
  --memory-type "file" \
  --entity-node-id "entity-uuid"

# 2. Verify the upload
ff-wm-read blob list "entity-uuid"
```

### Pre-populate Entity Data

```bash
# Store structured data before triggering a workflow
ff-wm-write record create \
  --name "Input Configuration" \
  --description "Processing parameters" \
  --memory-type "data/json" \
  --entity-node-id "entity-uuid" \
  --content '{"threshold": 0.8, "max_items": 100}'

# Verify
ff-wm-read record list "entity-uuid" | jq '.records[].name'
```

### Test File Processing Pipelines

```bash
# 1. Upload test documents
ff-wm-write blob upload ./test-data/invoice-001.pdf \
  --name "Test Invoice 1" \
  --description "Test invoice with 3 line items" \
  --memory-type "file" \
  --entity-node-id "test-entity-id"

# 2. Store expected results alongside
ff-wm-write record create \
  --name "Expected Output" \
  --description "Expected extraction results" \
  --memory-type "data/json" \
  --entity-node-id "test-entity-id" \
  --content "$(cat ./expected.json)"

# 3. Verify both are attached
ff-wm-read manifest "test-entity-id"
```

### Create Entity with Data (End-to-End)

Use `ff-eg-write` to create entities, then populate them with data:

```bash
# 1. Create the entity
ENTITY_ID=$(ff-eg-write node create \
  --name "TestDocument" \
  --entity-type "DocumentEntity" \
  --properties '{"source": "test"}' | jq -r '.id')

# 2. Upload a file to it
ff-wm-write blob upload ./document.pdf \
  --name "Source Document" \
  --description "Document for analysis" \
  --memory-type "file" \
  --entity-node-id "$ENTITY_ID"

# 3. Store metadata
ff-wm-write record create \
  --name "Document Metadata" \
  --description "Extracted metadata" \
  --memory-type "data/json" \
  --entity-node-id "$ENTITY_ID" \
  --content '{"pages": 12, "language": "en"}'

# 4. Verify everything
ff-wm-read manifest "$ENTITY_ID"
```

### Bulk Upload Test Data

```bash
# Upload all PDFs in a directory
for pdf in ./test-data/*.pdf; do
  NAME=$(basename "$pdf" .pdf)
  echo "Uploading: $NAME"
  ff-wm-write blob upload "$pdf" \
    --name "$NAME" \
    --description "Test document: $NAME" \
    --memory-type "file" \
    --entity-node-id "test-entity-id"
done

# Verify all uploads
ff-wm-read blob list "test-entity-id" | jq '.[] | .name'
```

### Clean Up Working Memory

```bash
# List all blobs for an entity
ff-wm-read blob list "entity-uuid" | jq '.[] | {name, key}'

# Delete specific blobs
ff-wm-write blob delete --blob-key "old-blob-key"

# List and delete all records
ff-wm-read record list "entity-uuid" | jq -r '.records[].id' | while read -r id; do
  echo "Deleting record: $id"
  ff-wm-write record delete "$id"
done
```

## See Also

- [ff-wm-read](ff-wm-read.md) — Read working memory (files, records, manifests)
- [ff-eg-write](ff-eg-write.md) — Create and modify entities in the graph
- [ff-eg-read](ff-eg-read.md) — Query the entity graph
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
