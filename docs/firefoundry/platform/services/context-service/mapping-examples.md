# Chat History Mapping Examples

This page shows two concrete entity graph structures for representing conversations, and how each maps to chat history via `assembleContext`. Use these as starting points when modeling your own conversation graph.

- [Example 1: Simple chat — default mapping](#example-1-simple-chat--default-mapping)
- [Example 2: FireIQ-style — custom mapping](#example-2-fireiq-style--custom-mapping)

---

## Example 1: Simple chat — default mapping

This pattern works with the built-in `simple_chat` mapping. No custom mapping registration required.

### Entity graph structure

```
EntityConversation (root)
   │
   ├─[Contains]─▶ EntityChatTurn (role: "user",      content: "Hello!")
   ├─[Contains]─▶ EntityChatTurn (role: "assistant",  content: "Hi there!")
   ├─[Contains]─▶ EntityChatTurn (role: "user",      content: "What can you do?")
   └─[Contains]─▶ EntityChatTurn (role: "assistant",  content: "I can help you...")
```

All turns are linked to the conversation via `Contains` edges. The `simple_chat` mapping traverses `Contains` edges and reads the `role` and `content` fields from each child entity.

### EntityChatTurn data shape

```typescript
interface ChatTurnData {
  role: "user" | "assistant";
  content: string;
}
```

### EntityConversation data shape

```typescript
interface ConversationData {
  title?: string;
  // No message content here — messages live in child entities
}
```

### SDK entity definitions

```typescript
// packages/my-bundle/src/entity/EntityChatTurn.ts
import { EntityNode, EntityMixin } from "@firebrandanalytics/ff-agent-sdk";

@EntityMixin({
  specificType: "EntityChatTurn",
  generalType: "EntityChatTurn",
  allowedConnections: {},
})
export class EntityChatTurn extends EntityNode {}
```

```typescript
// packages/my-bundle/src/entity/EntityConversation.ts
import { EntityNode, EntityMixin } from "@firebrandanalytics/ff-agent-sdk";
import type { UUID } from "@firebrandanalytics/shared-types";

@EntityMixin({
  specificType: "EntityConversation",
  generalType: "EntityConversation",
  allowedConnections: {
    Contains: { to: ["EntityChatTurn"] },
  },
})
export class EntityConversation extends EntityNode {
  async addTurn(role: "user" | "assistant", content: string): Promise<void> {
    const turn = await this.factory.create(EntityChatTurn, {
      node_type: "EntityChatTurn",
      data: { role, content },
    });
    await this.create_relationship("Contains", turn.id!);
  }
}
```

### Retrieving chat history (SDK)

```typescript
const history = await chatHistoryProvider.getChatHistory({
  entityNodeId: conversationId,
  mappingName: "simple_chat",  // the default — can be omitted
});

// history.messages → ChatMessage[]
// Each message: { role: "user" | "assistant", content: string }
```

### Retrieving chat history (bot mixin)

```typescript
@BotMixin(ChatHistoryBotMixin, {
  entityIdField: "conversation_id",
  mappingName: "simple_chat",
})
export class MyChatBot extends BaseBot { ... }
```

The mixin reads the conversation entity ID from `request.data.conversation_id`, fetches history using the `simple_chat` mapping, and injects the messages into the prompt automatically.

---

## Example 2: FireIQ-style — custom mapping

The FireIQ architecture uses dedicated `EntityUserMessage` and `EntityAssistantMessage` types with a more complex graph structure. A custom mapping is needed because:

1. The message types are distinct (not a single `EntityChatTurn` with a `role` field)
2. An assistant message created inline during user message creation is linked via `InResponseTo`, not `Contains`

### Entity graph structure

```
EntityConversation (root)
   │
   ├─[Contains]─▶ EntityUserMessage      (data.content: "Hello!")
   │                   │
   │                   └─[InResponseTo]─▶ EntityAssistantMessage  (data.content: "")
   │                                      [empty until filled in]
   │
   ├─[Contains]─▶ EntityUserMessage      (data.content: "What can you do?")
   │                   │
   │                   └─[InResponseTo]─▶ EntityAssistantMessage  (data.content: "")
   │
   └─[Contains]─▶ EntityAssistantMessage (data.content: "I can help you...")
                  [created via createAssistantMessage() — linked directly via Contains]
```

Key structural difference from Example 1:
- `EntityUserMessage` and `EntityAssistantMessage` are distinct types, not a single type with a `role` field
- An assistant message can reach the conversation root via **either** a `Contains` edge **or** via an `InResponseTo` edge from a `UserMessage` — depending on which creation method was called
- Messages contain a `content` field (inherited from `EntityMessage`)

### Custom mapping registration

Because the graph structure doesn't match `simple_chat`'s expected shape, register a custom mapping that handles both edge types and maps entity types to roles.

**Register the mapping in your context service configuration or at agent startup:**

```typescript
import { MappingRegistry } from "@firebrandanalytics/cs-client";

const registry = new MappingRegistry();

registry.register("fireiq_chat", {
  // Traverse Contains edges from conversation root
  edgeTypes: ["Contains", "InResponseTo"],

  // Map entity node_type to chat role
  roleMapping: {
    EntityUserMessage: "user",
    EntityAssistantMessage: "assistant",
  },

  // Extract message content from entity data
  contentField: "content",

  // Order by creation timestamp
  ordering: "timestamp_asc",

  // Skip empty assistant messages (placeholder created at user message time)
  filter: "entity.data.content != ''",
});
```

**Or via the gRPC `RegisterMapping` RPC directly:**

```typescript
import { ContextServiceClient } from "@firebrandanalytics/cs-client";

const client = new ContextServiceClient({
  address: process.env.CONTEXT_SERVICE_ADDRESS!,
  apiKey: process.env.CONTEXT_SERVICE_API_KEY,
});

await client.registerMapping({
  name: "fireiq_chat",
  definition: {
    edgeTypes: ["Contains", "InResponseTo"],
    roleMapping: {
      EntityUserMessage: "user",
      EntityAssistantMessage: "assistant",
    },
    contentField: "content",
    ordering: "timestamp_asc",
    filter: "entity.data.content != ''",
  },
});
```

Mappings are registered per context service instance. In production, register once during service startup (or harness bootstrap) before any bot sessions begin.

### Retrieving chat history

```typescript
const history = await chatHistoryProvider.getChatHistory({
  entityNodeId: conversationId,
  mappingName: "fireiq_chat",   // custom mapping name
});
```

### Bot mixin configuration

```typescript
@BotMixin(ChatHistoryBotMixin, {
  entityIdField: "conversation_id",
  mappingName: "fireiq_chat",
})
export class FireIQChatBot extends BaseBot { ... }
```

### What the mapping produces

For the entity graph in the diagram above (after the assistant messages are filled in):

```json
[
  { "role": "user",      "content": "Hello!" },
  { "role": "assistant", "content": "Hi there!" },
  { "role": "user",      "content": "What can you do?" },
  { "role": "assistant", "content": "I can help you..." }
]
```

Empty assistant messages (created as placeholders alongside user messages before the LLM has responded) are excluded by the `filter` expression.

---

## Choosing between patterns

| | Simple chat | FireIQ-style |
|---|---|---|
| Entity types | One generic type (`EntityChatTurn`) | Distinct types per role |
| Edge types | `Contains` only | `Contains` + `InResponseTo` |
| Mapping needed | `simple_chat` (built-in) | Custom registration |
| Best for | New projects, simple bots | Complex multi-agent architectures where message creation paths vary |
| Role determined by | `role` field in entity data | Entity `node_type` |

For new projects, **start with the simple chat pattern**. Use the FireIQ-style (or a variant) when you need distinct entity types per role, or when message creation paths diverge based on whether the assistant message is pre-created alongside a user turn or created independently.

---

## Related

- [Chat History Concepts](./concepts.md#chat-history) — how entity graph traversal and mapping rules work
- [Chat History SDK Guide](../../../sdk/agent_sdk/guides/chat-history.md) — ChatHistoryBotMixin, ChatHistoryPromptGroup, and full SDK API
- [Context Service API Reference](./reference.md) — RegisterMapping RPC, GetChatHistory RPC
