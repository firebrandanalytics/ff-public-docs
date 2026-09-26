# Context Service — Reference

gRPC API, client library methods, and errors for the Context Service. From an agent bundle, prefer the SDK wrappers (`WorkingMemoryProvider`, `ChatHistoryBotMixin`) or the `@firebrandanalytics/cs-client` library over raw RPCs.

---

## gRPC API

The Context Service implements a gRPC API over Connect-RPC (service `context.ContextService`, default port `50051`). Generated types are published in `@firebrandanalytics/context-svc-proto`.

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

**Response:** Full record including `name`, `description`, `content_type`, `memory_type`, `metadata`, `entity_node_id`, `created_at`.

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

**Request:** `working_memory_id` (string, UUID).

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

Registrations are not persisted. Register your mappings every time your bundle starts; an `ALREADY_EXISTS` response means the mapping is already registered and can be treated as success.

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

## Client Configuration

| Variable (in your bundle) | Description |
|----------|-------------|
| `CONTEXT_SERVICE_ADDRESS` | Service URL with protocol, e.g. `http://firefoundry-core-context-service:50051` |
| `CONTEXT_SERVICE_API_KEY` | API key, when your environment requires authentication |

See [Operations](./operations.md) for enabling the service and connecting a bundle.

---

## Error Codes

| gRPC Status | Cause |
|-------------|-------|
| `NOT_FOUND` | Working memory record does not exist |
| `INVALID_ARGUMENT` | Missing required field or invalid format |
| `UNAUTHENTICATED` | Missing or invalid API key (when auth is enabled) |
| `INTERNAL` | Server-side failure (e.g. file storage or the entity graph temporarily unavailable); retry with backoff and contact your environment administrator if it persists |
| `ALREADY_EXISTS` | Mapping name already registered for this app ID |

---

## Related

- [Overview](./README.md)
- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
- [Mapping Examples](./mapping-examples.md) — entity graph structures for default and custom chat history mappings
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
