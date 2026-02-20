# Context Service — Concepts

---

## Working Memory

**Working Memory** is the Context Service's blob storage system for entity data. It stores binary files — PDFs, images, CSVs, generated documents, code — alongside JSON metadata, addressable by a unique `working_memory_id`.

### The Pattern: Entity Data + Working Memory

Entity nodes in the entity graph store structured JSON data (fields, status, relationships). Working Memory handles everything else:

| Entity Data (JSON) | Working Memory (Blobs) |
|---|---|
| Structured fields (`{ status, prompt_wm_id }`) | Binary files (PDF, DOCX, images, code) |
| Accessed via `get_dto()` / `update_data()` | Accessed via `ContextServiceClient` or `WorkingMemoryProvider` |
| Lives in the entity graph | Lives in blob storage with metadata |
| Lightweight — stays small | No practical size limit |

The standard pattern: store the file in Working Memory, then store the returned `working_memory_id` in entity data. Entity data stays lightweight while binary content lives in purpose-built blob storage.

```
Entity Data                           Working Memory
{                                     +----------------------------+
  "status": "complete",               | ID: wm-abc-123             |
  "report_wm_id": "wm-abc-123" ─────▶ | Name: report.pdf           |
}                                     | Content-Type: application/ |
                                      |   pdf                      |
                                      | Size: 245,760 bytes        |
                                      | Metadata: { stage: "..." } |
                                      +----------------------------+
```

### Storage Backends

The Context Service supports two cloud storage backends:

| Backend | Detection | Configuration |
|---------|-----------|---------------|
| **Azure Blob Storage** | `WORKING_MEMORY_STORAGE_ACCOUNT` is set | Account name + key + container |
| **Google Cloud Storage** | Any `GOOGLE_*` env var is set | Project ID + bucket + credentials |

Both backends implement a common `BlobStorage` interface, making agent code cloud-agnostic. Set `WORKING_MEMORY_STORAGE_PROVIDER=azure` or `=gcs` to force a specific backend when both are configured.

### Working Memory Record Types

| Memory Type | Use For |
|-------------|---------|
| `"file"` | General binary files (PDF, DOCX, ZIP, etc.) |
| `"data/json"` | Structured JSON data |
| `"image/png"` | PNG images |
| `"image/jpeg"` | JPEG images |
| `"code/typescript"` | TypeScript code files |
| `"code/python"` | Python code files |

### PostgreSQL Metadata

All working memory records are tracked in PostgreSQL:
- **Entity linkage**: every record is linked to an `entity_node_id` (typically a session or conversation ID)
- **Blob reference**: the blob key in cloud storage is stored here
- **Optional embeddings**: 1536-dimensional vectors for semantic search over memory records
- **Arbitrary metadata**: JSON field for custom key-value annotations

---

## Chat History

Chat History allows any bot to replay the conversation history of an entity session. Rather than maintaining a separate message log, the Context Service reconstructs history by traversing the entity graph — the same graph that tracks all entity relationships and interactions.

### Why Entity Graph Traversal?

Entity graph traversal, rather than a dedicated message store, provides several advantages:

- **Single source of truth**: conversation history lives in the same graph as entities, relationships, and data
- **Flexible entity models**: different apps organize conversations differently — some use `UserMessage`/`AssistantMessage` entity types, others use `ConversationTurn`, others embed messages directly in entity data
- **No double-booking**: messages aren't maintained in two places that could diverge

The Context Service walks the entity graph starting from a given node (typically a session or conversation entity), collects relevant child nodes, and applies a named mapping rule to transform graph nodes into ordered `ChatMessage[]`.

### The `simple_chat` Mapping

The default mapping, `simple_chat`, covers bots that use the standard SDK bot/entity pattern where each bot call creates entity nodes linked to the session via `Contains` edges. It extracts `user_input` and `assistant_output` from entity data fields, ordering messages chronologically.

For most new bots using `ChatHistoryBotMixin` without any additional configuration, `simple_chat` is sufficient.

### Custom Mappings

Apps with custom entity models register their own named mapping via the `RegisterMapping` RPC. A mapping is a CEL (Common Expression Language) rule set that specifies:

1. Which edge types to traverse (e.g., `Contains`, `Produces`, `HasIO`)
2. Which entity types to include
3. How to extract `role` and `content` from each entity node's data
4. How to determine message order

Custom mappings are registered at application startup and live in memory for the lifetime of the Context Service process. Each app scopes its mappings by `app_id`.

```
App A: "simple_chat"     → default traversal, extracts user_input/assistant_output
App B: "fireiq_history"  → traverses UserMessage/AssistantMessage entity types
App C: "report_chat"     → includes only ConversationTurn entities with status=complete
```

When a bot calls `GetChatHistory`, it passes the node ID and optionally the mapping name. The Context Service applies the specified mapping (or `simple_chat` if none is given) and returns ordered `ChatMessage[]`.

---

## Context Assembly

Context Assembly is the internal pipeline powering `GetChatHistory`. It uses the registered CEL mapping to:

1. **Traverse** the entity graph from a starting node, following configured edge types
2. **Filter** nodes by entity type or field conditions
3. **Transform** each node into a `ChatMessage` by applying role/content extraction rules
4. **Order** messages chronologically (by node timestamp or a configured field)
5. **Truncate** if a `maxMessages` limit is applied by the caller

The `ContextAssemblyService` calls the Entity Service gRPC API for all graph traversal — it does not access the entity database directly. This ensures the same access control and business logic enforced by the Entity Service applies to history reconstruction.

---

## MCP Integration

The Context Service optionally exposes working memory operations as **Model Context Protocol (MCP)** tools. This allows CLI coding agents (Claude Code, Codex, Gemini) to interact with working memory directly through their native tool calling interface.

### Available MCP Capabilities

When the MCP server is active, agents can:
- **List resources**: enumerate working memory records for the current entity
- **Read resources**: retrieve file contents by working memory ID
- **Execute tools**: upload files, fetch manifests, query working memory

### MCP Transport

The Context Service uses an `InMemoryTransport` when running as a single process alongside an agent bundle, avoiding network overhead for tool calls. In cluster deployments, it listens on a configurable port.

### MCP vs gRPC

| Approach | Use When |
|----------|---------|
| **gRPC / cs-client** | Agent bundle code (TypeScript), SDK integrations, high-throughput pipelines |
| **MCP** | CLI coding agents (Claude Code, Codex, Gemini) that interact with the service through their tool-calling interface |

---

## Client Library

The `@firebrandanalytics/cs-client` TypeScript package provides all client-side access to the Context Service. It wraps the gRPC transport and provides a higher-level API for common operations.

```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';

const client = new ContextServiceClient({
  address: process.env.CONTEXT_SERVICE_ADDRESS,
  apiKey: process.env.CONTEXT_SERVICE_API_KEY,
});
```

The client is used directly by agent bundles for working memory operations, and internally by the SDK's `ChatHistoryPromptGroup` for chat history retrieval.

---

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
