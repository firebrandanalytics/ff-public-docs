# Context Service — Concepts

This page explains working memory, chat history and mappings, and MCP access, and how to design your app around them.

---

## Working Memory

**Working Memory** is where your application stores files that belong to entities. It stores binary files — PDFs, images, CSVs, generated documents, code — alongside JSON metadata, addressable by a unique `working_memory_id`.

### The Pattern: Entity Data + Working Memory

Entity nodes in the entity graph store structured JSON data (fields, status, relationships). Working Memory handles everything else:

| Entity Data (JSON) | Working Memory (Blobs) |
|---|---|
| Structured fields (`{ status, prompt_wm_id }`) | Binary files (PDF, DOCX, images, code) |
| Accessed via `get_dto()` / `update_data()` | Accessed via `WorkingMemoryProvider` (SDK) or `ContextServiceClient` |
| Lives in the entity graph | Lives in object storage, described by a record with metadata |
| Lightweight — stays small | Suited to large files (streamed in chunks) |

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

### Working Memory Record Types

| Memory Type | Use For |
|-------------|---------|
| `"file"` | General binary files (PDF, DOCX, ZIP, etc.) |
| `"data/json"` | Structured JSON data |
| `"image/png"` | PNG images |
| `"image/jpeg"` | JPEG images |
| `"code/typescript"` | TypeScript code files |
| `"code/python"` | Python code files |

### What a Record Carries

Every working memory record has:
- **Entity linkage**: an `entity_node_id` (typically the session, conversation, or document entity it belongs to). Use it to list everything attached to an entity, or to build a manifest across related entities.
- **Descriptive fields**: `name`, `description`, `content_type` (MIME type), and `memory_type`
- **Metadata**: an arbitrary JSON object for your own annotations (for example, pipeline stage or source)

File bytes are stored in the object storage configured for your environment; your code only deals with `working_memory_id`s and never with storage locations or credentials.

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

Custom mappings are scoped by `app_id` and registered by your application at startup. Registrations are **not persisted** by the Context Service: register your mappings every time your bundle starts, and treat an `ALREADY_EXISTS` response as success. If history calls start failing with an unknown-mapping error (for example after the Context Service restarts), registering again restores them.

```
App A: "simple_chat"     → default traversal, extracts user_input/assistant_output
App B: "fireiq_history"  → traverses UserMessage/AssistantMessage entity types
App C: "report_chat"     → includes only ConversationTurn entities with status=complete
```

When a bot calls `GetChatHistory`, it passes the node ID and optionally the mapping name. The Context Service applies the specified mapping (or `simple_chat` if none is given) and returns ordered `ChatMessage[]`.

For worked examples of both the default and custom mapping patterns, including entity graph diagrams and SDK code, see [Mapping Examples](./mapping-examples.md).

---

## Context Assembly

`GetChatHistory` is built on a lower-level assembly step (also exposed as `AssembleContext`) that applies a mapping to:

1. **Traverse** the entity graph from a starting node, following configured edge types
2. **Filter** nodes by entity type or field conditions
3. **Transform** each node into a `ChatMessage` using role/content extraction rules
4. **Order** messages chronologically (by node timestamp or a configured field)
5. **Truncate** to the most recent N messages if the caller passes a `max_messages` limit

History is read from the entity graph at request time, so it always reflects what your bundle has written — there is no separate log to keep in sync.

---

## MCP Integration

The Context Service optionally exposes working memory operations as **Model Context Protocol (MCP)** tools. This allows CLI coding agents (Claude Code, Codex, Gemini) to interact with working memory directly through their native tool calling interface.

### Available MCP Capabilities

When the MCP server is active, agents can:
- **List resources**: enumerate working memory records for the current entity
- **Read resources**: retrieve file contents by working memory ID
- **Execute tools**: upload files, fetch manifests, query working memory

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

Most bundles use the SDK wrappers instead (`WorkingMemoryProvider`, `ChatHistoryBotMixin`, `ChatHistoryPromptGroup`), which use this client under the hood. Use the client directly for operations the wrappers don't cover, such as registering mappings or fetching manifests.

---

## Designing Your App Around the Context Service

- **Store files in working memory, IDs in entity data.** Keep entity data small and searchable; put the `working_memory_id` in a field such as `report_wm_id`.
- **Attach records to the entity that owns them.** Linking a file to the right entity (document, session, case) makes listing and manifests work without extra bookkeeping.
- **Use metadata for pipeline stages.** Tag records with e.g. `{ stage: "original_upload" }` vs `{ stage: "extracted_text" }` so later stages can find the right version.
- **Start with the default chat model.** If your conversation entities fit the `simple_chat` pattern, you need no mapping registration at all. See [Mapping Examples](./mapping-examples.md).
- **Bound history size.** Long conversations produce long prompts; use `maxMessages` / `max_messages` to cap what goes to the model.

---

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Mapping Examples](./mapping-examples.md) — entity graph structures for default and custom chat history mappings
- [Agent SDK — Chat History Guide](../../../sdk/agent_sdk/guides/chat-history.md)
- [Agent SDK — Working Memory Guide](../../../sdk/agent_sdk/guides/working-memory.md)
