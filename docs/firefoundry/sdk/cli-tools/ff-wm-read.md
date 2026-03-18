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

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_WM_URL` | Working Memory service URL | `http://localhost:8080` |

### Port-Forward Setup

For remote Working Memory in Kubernetes:

```bash
kubectl port-forward -n ff-dev svc/ff-working-memory 8080:8080
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `record get <id>` | Get a single record by ID |
| `record list <entity-id>` | List all records for an entity |
| `blob list <entity-id>` | List all blobs for an entity |
| `blob get <key>` | Get blob content by storage key |
| `blob content <wm-id>` | Get blob content by working memory ID |
| `manifest <root-id>` | Get working memory manifest for a root node |
| `chat-history <node-id>` | Get conversation logs for a node |

## Command Reference

### record — Structured Data Records

Working memory records store structured data (JSON or plain text) attached to entities. Records are the primary mechanism for persisting bot outputs, configuration, and intermediate processing results.

#### record get

Get a single record by its working memory record ID.

```bash
ff-wm-read record get <wm-record-id>
```

Content and metadata fields use safe JSON parsing — if the content isn't valid JSON, it returns the raw string instead of failing.

```bash
# Get a specific record
ff-wm-read record get "wm-record-uuid"

# Extract the content field
ff-wm-read record get "wm-record-uuid" | jq '.content'

# Get content and metadata together
ff-wm-read record get "wm-record-uuid" | jq '{name: .name, content: .content, metadata: .metadata}'

# Pretty-print JSON content
ff-wm-read record get "wm-record-uuid" | jq '.content' -r | jq .
```

#### record list

List all records for an entity.

```bash
ff-wm-read record list <entity-node-id>
```

```bash
# List all records
ff-wm-read record list "entity-uuid"

# Extract record names and types
ff-wm-read record list "entity-uuid" | jq '.records[] | {name, memory_type}'

# Count records
ff-wm-read record list "entity-uuid" | jq '.records | length'

# Find records by name pattern
ff-wm-read record list "entity-uuid" | jq '.records[] | select(.name | test("output|result"; "i"))'
```

### blob — Binary Files

Blob storage holds binary files (PDFs, images, CSVs, etc.) attached to entities. Blobs can be retrieved by their storage key or working memory record ID.

#### blob list

List all blobs for an entity.

```bash
ff-wm-read blob list <entity-node-id>
```

```bash
# List all blobs
ff-wm-read blob list "entity-uuid"

# Show names and content types
ff-wm-read blob list "entity-uuid" | jq '.[] | {name, content_type}'

# Find PDFs only
ff-wm-read blob list "entity-uuid" | jq '.[] | select(.content_type == "application/pdf")'

# Count blobs
ff-wm-read blob list "entity-uuid" | jq 'length'
```

#### blob get

Get blob content by its storage key.

```bash
ff-wm-read blob get <key> [options]
```

| Option | Alias | Purpose |
|--------|-------|---------|
| `--output-file <path>` | `-o` | Write binary content to a file |
| `--raw` | `-r` | Output text content directly (errors if binary) |

Output behavior depends on the flags used:

| Mode | Output | Best For |
|------|--------|----------|
| Default (no flags) | Base64-encoded JSON to stdout | Any content type, safe default |
| `--raw` | Text content direct to stdout | Code, JSON, markdown, XML |
| `--output-file` | Binary content written to file | PDFs, images, archives |

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

# Save markdown content to file via redirect
ff-wm-read blob get "blob-key" --raw > ./output.md
```

#### blob content

Get blob content by its working memory record ID (alternative to using the storage key). Useful when you have the WM record ID from a manifest or record list.

```bash
ff-wm-read blob content <working-memory-id> [options]
```

Same options as `blob get` (`-o`, `-r`).

```bash
# Download a document by working memory ID
ff-wm-read blob content "wm-record-uuid" -o ./document.pdf

# View JSON blob directly
ff-wm-read blob content "wm-record-uuid" --raw | jq .

# Save to file
ff-wm-read blob content "wm-record-uuid" -o ./extracted-data.json
```

### manifest — Entity Data Overview

Get the working memory manifest for a root node. The manifest provides a complete inventory of all records and blobs attached to an entity and its descendants, with optional filtering.

```bash
ff-wm-read manifest <root-node-id> [options]
```

| Option | Purpose |
|--------|---------|
| `--memory-types <types...>` | Filter by memory types (space-separated) |
| `--subtypes <types...>` | Filter by subtypes (space-separated) |
| `--semantic-purposes <purposes...>` | Filter by semantic purposes (space-separated) |

Common memory types:

| Type | Content |
|------|---------|
| `code/typescript` | TypeScript source files |
| `code/javascript` | JavaScript source files |
| `data/json` | Structured JSON data |
| `file` | Generic binary files |
| `image/png` | PNG images |
| `text/markdown` | Markdown documents |

```bash
# Get full manifest
ff-wm-read manifest "root-node-uuid"

# Count total items
ff-wm-read manifest "root-node-uuid" | jq '.items | length'

# Only code files
ff-wm-read manifest "root-uuid" --memory-types code/typescript code/javascript

# Only data records
ff-wm-read manifest "root-uuid" --memory-types data/json

# Filter by semantic purpose
ff-wm-read manifest "root-uuid" --semantic-purposes context reference

# Combine filters
ff-wm-read manifest "root-uuid" --memory-types data/json --semantic-purposes output
```

### chat-history — Conversation Logs

Get the chat history for a node. Returns the sequence of messages exchanged during bot execution, including system prompts, user messages, and assistant responses.

```bash
ff-wm-read chat-history <node-id>
```

```bash
# Get full chat history
ff-wm-read chat-history "node-uuid"

# Count messages
ff-wm-read chat-history "node-uuid" | jq 'length'

# Extract just the assistant responses
ff-wm-read chat-history "node-uuid" | jq '.[] | select(.role == "assistant") | .content'

# Find messages containing a keyword
ff-wm-read chat-history "node-uuid" | jq '.[] | select(.content | test("error"; "i"))'
```

## Diagnostic Workflows

### View All Data Attached to an Entity

```bash
# 1. List structured records
ff-wm-read record list "entity-uuid" | jq '.records[] | {name, memory_type}'

# 2. List file attachments
ff-wm-read blob list "entity-uuid" | jq '.[] | {name, content_type}'

# 3. Get the complete manifest
ff-wm-read manifest "entity-uuid"
```

### Download All Documents for an Entity

```bash
# List blobs and download each one
ff-wm-read blob list "entity-uuid" | jq -r '.[].key' | while read -r key; do
  FILENAME=$(ff-wm-read blob list "entity-uuid" | jq -r ".[] | select(.key == \"$key\") | .name")
  echo "Downloading: $FILENAME"
  ff-wm-read blob get "$key" -o "./$FILENAME"
done
```

### Debug File Processing Issues

```bash
# 1. Check if a file was uploaded
ff-wm-read blob list "entity-uuid"

# 2. Check the manifest for processing artifacts
ff-wm-read manifest "entity-uuid" --memory-types data/json

# 3. Review chat history for error messages
ff-wm-read chat-history "entity-uuid" | jq '.[] | select(.content | test("error|fail"; "i"))'
```

### Trace Data Flow Through a Workflow

Combine with `ff-eg-read` to follow data through connected entities:

```bash
# 1. Get the workflow entity and its steps
ff-eg-read node connected <workflow-id> HAS_STEP | jq '.[] | {id, name, status}'

# 2. For each step, check what data it produced
for STEP_ID in $(ff-eg-read node connected <workflow-id> HAS_STEP | jq -r '.[].id'); do
  echo "=== Step: $STEP_ID ==="
  ff-wm-read record list "$STEP_ID" | jq '.records[] | {name, memory_type}'
done
```

### Compare Entity Data Across Runs

```bash
# Get records from two entities and compare
ff-wm-read record list "entity-run-1" | jq '.records[] | {name, content}' > /tmp/run1.json
ff-wm-read record list "entity-run-2" | jq '.records[] | {name, content}' > /tmp/run2.json
diff /tmp/run1.json /tmp/run2.json
```

### Inspect Bot Conversation Quality

```bash
# Get chat history and analyze
ff-wm-read chat-history "entity-uuid" | jq '
  {
    total_messages: length,
    by_role: (group_by(.role) | map({role: .[0].role, count: length})),
    avg_length: ([.[].content | length] | add / length)
  }
'
```

## See Also

- [ff-wm-write](ff-wm-write.md) — Write records and upload blobs to working memory
- [ff-eg-read](ff-eg-read.md) — Query the entity graph
- [ff-eg-write](ff-eg-write.md) — Modify the entity graph
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
