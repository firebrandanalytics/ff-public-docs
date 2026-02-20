# Context Service — Reference

---

## gRPC API

The Context Service implements a gRPC API over Connect-RPC. The proto definition is in `packages/transport/proto/context_service.proto`.

### Working Memory APIs

#### `InsertWMRecord`

Create a new working memory record (metadata only, no blob).

```protobuf
rpc InsertWMRecord(InsertWMRecordRequest) returns (InsertWMRecordResponse);
```

**Request fields:**

| Field | Type | Description |
|-------|------|-------------|
| `entity_node_id` | `string` (UUID) | Entity this record belongs to |
| `name` | `string` | Display name |
| `description` | `string` | Human-readable description |
| `content_type` | `string` | MIME type |
| `memory_type` | `string` | Category (e.g., `"file"`, `"data/json"`, `"image/png"`) |
| `metadata` | `string` (JSON) | Arbitrary key-value metadata |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | The working memory record ID |

---

#### `FetchWMRecord`

Retrieve a single working memory record by ID.

```protobuf
rpc FetchWMRecord(FetchWMRecordRequest) returns (FetchWMRecordResponse);
```

**Request:** `id` (string, UUID)

**Response:** Full record including `name`, `description`, `content_type`, `memory_type`, `metadata`, `blob_key`, `entity_node_id`, `created_at`.

---

#### `FetchWMRecordsByEntity`

List all working memory records for an entity node.

```protobuf
rpc FetchWMRecordsByEntity(FetchWMRecordsByEntityRequest) returns (FetchWMRecordsByEntityResponse);
```

**Request:** `entity_node_id` (string, UUID)

**Response:** `records` — array of working memory records.

---

#### `DeleteWMRecord`

Delete a working memory record and its associated blob.

```protobuf
rpc DeleteWMRecord(DeleteWMRecordRequest) returns (DeleteWMRecordResponse);
```

**Request:** `id` (string, UUID)

---

#### `FetchWMManifest`

Get a hierarchical view of working memory organized by entity relationships and memory types.

```protobuf
rpc FetchWMManifest(FetchWMManifestRequest) returns (FetchWMManifestResponse);
```

**Request fields:**

| Field | Type | Description |
|-------|------|-------------|
| `entity_node_id` | `string` (UUID) | Root entity to build manifest from |
| `memory_type_filter` | `string[]` | Only include these memory types (empty = all) |
| `max_depth` | `int32` | Max edge traversal depth (default: 3) |

---

### Blob Storage APIs

#### `UploadBlob`

Upload a file using bidirectional streaming.

```protobuf
rpc UploadBlob(stream UploadBlobRequest) returns (UploadBlobResponse);
```

The first message in the stream contains metadata; subsequent messages contain file chunks. The client library's `uploadBlobFromBuffer` method handles chunking automatically.

---

#### `GetBlob`

Download a file using server-side streaming.

```protobuf
rpc GetBlob(GetBlobRequest) returns (stream GetBlobResponse);
```

**Request:** `working_memory_id` (string, UUID)

**Response stream:** chunks of `data` (bytes). The client library's `getBlob` method reassembles chunks automatically.

---

#### `DeleteBlob`

Remove a blob from storage.

```protobuf
rpc DeleteBlob(DeleteBlobRequest) returns (DeleteBlobResponse);
```

**Request:** either `working_memory_id` or `blob_key` (string).

---

#### `ListBlobs`

Enumerate all blobs for an entity node.

```protobuf
rpc ListBlobs(ListBlobsRequest) returns (ListBlobsResponse);
```

**Request:** `entity_node_id` (string, UUID)

---

### Chat History and Context Assembly APIs

#### `GetChatHistory`

Fetch conversation messages for an entity node by traversing the entity graph.

```protobuf
rpc GetChatHistory(GetChatHistoryRequest) returns (GetChatHistoryResponse);
```

**Request fields:**

| Field | Type | Description |
|-------|------|-------------|
| `node_id` | `string` (UUID) | Entity node to reconstruct history from |
| `app_id` | `string` | Application ID for scoped mapping lookup |
| `mapping_name` | `string` (optional) | Named mapping to apply; defaults to `"simple_chat"` |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `ChatMessage[]` | Ordered list of conversation messages |

`ChatMessage`:
```
message ChatMessage {
  string role = 1;     // "user", "assistant", or "system"
  string content = 2;  // Message content
}
```

---

#### `AssembleContext`

Assemble a full context payload from the entity graph using a named mapping. Lower-level than `GetChatHistory`; returns richer intermediate data.

```protobuf
rpc AssembleContext(AssembleContextRequest) returns (AssembleContextResponse);
```

**Request fields:**

| Field | Type | Description |
|-------|------|-------------|
| `node_id` | `string` (UUID) | Starting entity node |
| `app_id` | `string` | App scope for mapping lookup |
| `mapping_name` | `string` | Named mapping to apply |
| `max_messages` | `int32` (optional) | Truncate to most recent N messages |

---

#### `RegisterMapping`

Register a named CEL mapping rule for chat history reconstruction. Called once at application startup.

```protobuf
rpc RegisterMapping(RegisterMappingRequest) returns (RegisterMappingResponse);
```

**Request fields:**

| Field | Type | Description |
|-------|------|-------------|
| `app_id` | `string` | Application ID scope |
| `mapping_name` | `string` | Unique name within the app |
| `rules` | `MappingRules` | CEL-based traversal and extraction rules |

Registered mappings are stored in memory for the process lifetime. Mappings must be re-registered on process restart (typically in application startup code).

---

### MCP APIs

#### `ListTools`

Enumerate available MCP tools for a given context type.

```protobuf
rpc ListTools(ListToolsRequest) returns (ListToolsResponse);
```

**Context types:** `"RAG"`, `"History"`, `"WM"` (Working Memory)

---

#### `ExecuteTool`

Execute an MCP tool with parameters.

```protobuf
rpc ExecuteTool(ExecuteToolRequest) returns (ExecuteToolResponse);
```

**Request:** `tool_name` (string), `args` (JSON string), `context_type` (string)

---

### Additional APIs

#### `GetContent`

Unified content retrieval without knowing the underlying storage provider.

```protobuf
rpc GetContent(GetContentRequest) returns (GetContentResponse);
```

---

#### `FetchEntityHistory`

Retrieve complete entity interaction history (all entity actions, not just chat messages).

```protobuf
rpc FetchEntityHistory(FetchEntityHistoryRequest) returns (FetchEntityHistoryResponse);
```

---

## Client Library

The `@firebrandanalytics/cs-client` package wraps the gRPC transport. Install it:

```bash
pnpm add @firebrandanalytics/cs-client
```

### Constructor

```typescript
const client = new ContextServiceClient({
  address: string;    // Service URL with protocol, e.g., "http://localhost:50051"
  apiKey?: string;    // API key for authentication (optional in some deployments)
});
```

### Key Methods

| Method | Description |
|--------|-------------|
| `uploadBlobFromBuffer(params)` | Upload a `Buffer` to working memory (handles chunking) |
| `getBlob(workingMemoryId)` | Download a file as a `Buffer` |
| `insertWMRecord(record)` | Create a working memory record (metadata only) |
| `fetchWMRecord(id)` | Get working memory record by ID |
| `fetchWMRecordsByEntity(entityNodeId)` | List all records for an entity |
| `deleteWMRecord(id)` | Delete a record and its blob |
| `fetchWMManifest(params)` | Get hierarchical working memory manifest |
| `getChatHistory(nodeId, mappingName?)` | Fetch chat history for an entity node |
| `registerMapping(params)` | Register a named CEL mapping |

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string for working memory metadata |
| `ENTITY_SERVICE_URL` | Entity Service base URL (no port), e.g., `http://firefoundry-core-entity-service.ff-dev.svc.cluster.local` |

### Storage Backend (one required)

**Azure Blob Storage:**

| Variable | Description |
|----------|-------------|
| `WORKING_MEMORY_STORAGE_ACCOUNT` | Azure Storage account name |
| `WORKING_MEMORY_STORAGE_KEY` | Azure Storage account key |
| `WORKING_MEMORY_STORAGE_CONTAINER` | Container name |

**Google Cloud Storage:**

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `WORKING_MEMORY_STORAGE_CONTAINER` | Bucket name |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Service account JSON (for containers) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_SERVICE_PORT` | `50051` | gRPC listen port |
| `API_KEY` | *(none)* | Enable API key authentication |
| `ENTITY_SERVICE_PORT` | `8080` | Entity Service port |
| `HISTORY_DATABASE_URL` | *(none)* | Separate DB for history (uses `DATABASE_URL` if not set) |
| `WORKING_MEMORY_STORAGE_PROVIDER` | Auto-detected | Force `"azure"` or `"gcs"` |

---

## Error Codes

| gRPC Status | Cause |
|-------------|-------|
| `NOT_FOUND` | Working memory record or blob key does not exist |
| `INVALID_ARGUMENT` | Missing required field or invalid format |
| `UNAUTHENTICATED` | Missing or invalid API key (when auth is enabled) |
| `INTERNAL` | Storage backend failure, entity service unavailable |
| `ALREADY_EXISTS` | Mapping name already registered for this app ID |

---

## Related

- [Overview](./README.md)
- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
