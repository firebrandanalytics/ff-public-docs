# ff-wm-read — Working Memory Read Operations

Read working memory content from the FireFoundry platform. Retrieve records, download blobs (files), inspect manifests, and review chat history attached to entities.

## Installation

```bash
npm install -g @firebrandanalytics/ff-wm-read
```

Verify:

```bash
ff-wm-read --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose |
|----------|---------|
| `FF_WM_URL` | Working Memory service URL |

## Command Reference

### record — Structured Data Records

Working memory records store structured data (JSON or plain text) attached to entities.

#### record get

Get a single record by its working memory record ID.

```bash
ff-wm-read record get <wm-record-id>
```

Content and metadata fields use safe JSON parsing — if the content isn't valid JSON, it returns the raw string instead of failing.

```bash
# Get a specific record
ff-wm-read record get "wm-record-uuid"

# Extract the content
ff-wm-read record get "wm-record-uuid" | jq '.content'
```

#### record list

List all records for an entity.

```bash
ff-wm-read record list <entity-node-id>
```

```bash
# List all records
ff-wm-read record list "entity-uuid"

# Extract record names
ff-wm-read record list "entity-uuid" | jq '.records[].name'
```

### blob — Binary Files

Blob storage holds binary files (PDFs, images, CSVs, etc.) attached to entities.

#### blob list

List all blobs for an entity.

```bash
ff-wm-read blob list <entity-node-id>
```

```bash
ff-wm-read blob list "entity-uuid"
ff-wm-read blob list "entity-uuid" | jq '.[] | {name, content_type}'
```

#### blob get

Get blob content by its storage key.

```bash
ff-wm-read blob get <key> [options]
```

| Option | Purpose |
|--------|---------|
| `-o, --output-file <path>` | Write binary content to a file |
| `-r, --raw` | Output text content directly (errors if binary) |

Output behavior:

| Mode | Output |
|------|--------|
| Default (no flags) | Base64-encoded JSON to stdout |
| `--raw` | Text content direct to stdout (errors if content is binary) |
| `--output-file` | Binary content written to file |

Text content types detected for `--raw`:
- `text/*` (text/plain, text/markdown, text/html, etc.)
- `application/json`, `application/xml`, `application/javascript`
- Any type ending in `+json` or `+xml`

```bash
# Get blob as base64 JSON (safe for any content type)
ff-wm-read blob get "blob-key"

# Get text content directly (for code, JSON, markdown, etc.)
ff-wm-read blob get "blob-key" --raw

# Download any blob to file
ff-wm-read blob get "blob-key" --output-file ./downloaded.png

# Pipe JSON blob through jq
ff-wm-read blob get "blob-key" --raw | jq .
```

#### blob content

Get blob content by its working memory record ID (alternative to using the storage key).

```bash
ff-wm-read blob content <working-memory-id> [options]
```

Same options as `blob get` (`-o`, `-r`).

```bash
# Download a document by working memory ID
ff-wm-read blob content "wm-record-uuid" -o ./document.pdf

# View JSON blob directly
ff-wm-read blob content "wm-record-uuid" --raw | jq .
```

### manifest — Entity Data Overview

Get the working memory manifest for a root node, showing all attached records and blobs with optional filtering.

```bash
ff-wm-read manifest <root-node-id> [options]
```

| Option | Purpose |
|--------|---------|
| `--memory-types <types...>` | Filter by memory types (e.g., `code/typescript`, `data/json`) |
| `--subtypes <types...>` | Filter by subtypes |
| `--semantic-purposes <purposes...>` | Filter by semantic purposes |

```bash
# Get full manifest
ff-wm-read manifest "root-node-uuid"

# Only code files
ff-wm-read manifest "root-uuid" --memory-types code/typescript code/javascript

# Only data records
ff-wm-read manifest "root-uuid" --memory-types data/json

# Filter by semantic purpose
ff-wm-read manifest "root-uuid" --semantic-purposes context reference
```

### chat-history — Conversation Logs

Get the chat history for a node.

```bash
ff-wm-read chat-history <node-id>
```

```bash
ff-wm-read chat-history "node-uuid"
```

## Common Workflows

### View Documents Attached to an Entity

```bash
# 1. List all blobs for the entity
ff-wm-read blob list "entity-uuid"

# 2. Download a specific file
ff-wm-read blob get "blob-key" --output-file ./document.pdf

# Or by working memory ID
ff-wm-read blob content "wm-record-uuid" -o ./document.pdf
```

### Inspect Entity Data

```bash
# 1. Check what records exist
ff-wm-read record list "entity-uuid" | jq '.records[].name'

# 2. Read a specific record
ff-wm-read record get "wm-record-uuid" | jq '.content'

# 3. Get the full manifest
ff-wm-read manifest "entity-uuid"
```

### Debug File Processing Issues

```bash
# 1. Check if a file was uploaded
ff-wm-read blob list "entity-uuid"

# 2. Check the manifest for the entity
ff-wm-read manifest "entity-uuid"

# 3. Review chat history for processing context
ff-wm-read chat-history "entity-uuid"
```

### Combine with Entity Graph Queries

Use `ff-eg-read` to find the entity, then `ff-wm-read` to examine its data:

```bash
# Get entity details
ff-eg-read node get "entity-uuid" | jq '{status, entity_type}'

# See what files it processed
ff-wm-read blob list "entity-uuid"

# See what structured output it stored
ff-wm-read record list "entity-uuid"
```

## See Also

- [ff-eg-read](ff-eg-read.md) — Query the entity graph
- [ff-eg-write](ff-eg-write.md) — Modify the entity graph
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
