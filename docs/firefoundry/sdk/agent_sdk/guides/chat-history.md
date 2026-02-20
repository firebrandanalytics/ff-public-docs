# Chat History

The SDK provides first-class chat history support through `ChatHistoryBotMixin` and `ChatHistoryPromptGroup`. When enabled, conversation history is automatically fetched from the Context Service and injected into the bot's prompt as individual user/assistant messages — giving the LLM full conversational context on every call.

## How It Works

Chat history is reconstructed from the **entity graph**, not from a separate message log. The Context Service traverses the entity graph starting from the current session node, applies a named CEL-based mapping rule, and returns ordered `ChatMessage[]`. The SDK injects these into the prompt before the LLM call.

```
Entity Graph (session node)
         │
   entity service
         │
    graph traversal
         │
   ContextAssemblyService
   (applies CEL mapping)
         │
   getChatHistory RPC
         │
    ChatHistoryPromptGroup
    (renders each message
     with correct role)
         │
      LLM prompt
```

---

## Quick Start: ChatHistoryBotMixin

`ChatHistoryBotMixin` is the simplest way to add chat history to any bot. Add it to `ComposeMixins` and the SDK handles the rest.

```typescript
import { ComposeMixins, MixinBot, ChatHistoryBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

class SupportBot extends ComposeMixins(
  MixinBot,
  ChatHistoryBotMixin,
) {
  constructor() {
    super(
      // MixinBot config
      {
        name: 'SupportBot',
        base_prompt_group: buildPromptGroup(),
        model_pool_name: 'default',
      },
      // ChatHistoryBotMixin config
      {
        maxMessages: 20,
      },
    );
  }
}
```

With this configuration, every time the bot runs, it:
1. Looks up the entity's current session node from context
2. Calls `GetChatHistory` on the Context Service with that node ID
3. Renders the history as individual prompts with the correct `user`/`assistant` roles
4. Injects them into the `chat_history` section of the prompt group, before the current user input

---

## ChatHistoryConfig

Both `ChatHistoryBotMixin` and `ChatHistoryPromptGroup` accept the same configuration:

```typescript
interface ChatHistoryConfig {
  /**
   * Maximum number of history messages to include.
   * Keeps the most recent N messages. If 0 or omitted, all available messages are included.
   */
  maxMessages?: number;

  /**
   * Application ID for scoped mapping lookup.
   * Defaults to the agent bundle's app_id from context.
   */
  appId?: string;

  /**
   * Name of the registered context mapping to apply.
   * Defaults to "simple_chat" if not specified.
   * Apps with custom entity models should register a mapping via RegisterMapping
   * and supply its name here.
   */
  mappingName?: string;
}
```

### `maxMessages`

Controls how many history messages are injected into the prompt. The most recent N messages are kept:

```typescript
{ maxMessages: 10 }   // Keep the last 10 messages
{ maxMessages: 0 }    // Include all messages (careful with token budgets)
{}                    // Same as maxMessages: 0 — all messages
```

For production bots with long conversations, set a reasonable limit (10–30 messages) to control token usage.

### `mappingName`

Selects which named CEL mapping rule to use for history reconstruction. If your app uses the default SDK entity pattern (standard bots producing entity nodes with `user_input`/`assistant_output` fields), leave this unset — the default `"simple_chat"` mapping works automatically.

If your app has a custom entity model, see [Custom Entity Models](#custom-entity-models) below.

---

## Using ChatHistoryPromptGroup Directly

`ChatHistoryBotMixin` internally creates a `ChatHistoryPromptGroup` and adds it to the `SECTION_CHAT_HISTORY` prompt section. If you need more control over placement or want to compose it manually:

```typescript
import { ChatHistoryPromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';
import { PromptGroup } from '@firebrandanalytics/ff-agent-sdk';

const systemPrompt = new Prompt({ role: 'system', static_args: {} });
systemPrompt.add_section(/* ... */);

const chatHistoryGroup = new ChatHistoryPromptGroup(
  [],   // No static child prompts
  {
    maxMessages: 15,
    mappingName: 'my_custom_mapping',
  },
);

const inputPrompt = new Prompt({ role: 'user', static_args: {} });
inputPrompt.add_section(/* ... */);

const promptGroup = new PromptGroup([
  { name: 'system', prompt: systemPrompt },
  { name: 'history', prompt: chatHistoryGroup },  // Explicit placement
  { name: 'input', prompt: inputPrompt },
]);
```

`ChatHistoryPromptGroup` fetches and renders history in its `render_impl` phase. Each history message becomes a separate child `RenderedPromptDOM` with the correct `role` (`user`, `assistant`, or `system`).

### Lifecycle

1. **`init_preprocess`**: Fetches chat history from the Context Service using the node ID from `request.context_provider.get_context()`. Stores results in `request.state.chatHistory`.
2. **`render_impl`**: Renders any static child prompts first, then appends one `Prompt` per history message (with the correct role) as `chat_history_0`, `chat_history_1`, etc.

If no session node ID is available in context, or the Context Service returns no history, the group renders normally without history (no error is thrown).

---

## Custom Entity Models

By default, the Context Service uses the `"simple_chat"` mapping, which works for the standard SDK bot/entity pattern. If your application has custom entity types for conversation turns (e.g., `UserMessage`, `AssistantMessage`, `ConversationTurn`), you need to register a custom mapping.

### 1. Register the Mapping at Startup

Register your mapping in your agent bundle's server initialization:

```typescript
import { ContextServiceClient } from '@firebrandanalytics/cs-client';
import { CONTEXT_SERVICE_ADDRESS, CONTEXT_SERVICE_API_KEY } from '@firebrandanalytics/shared-utils';

const csClient = new ContextServiceClient({
  address: CONTEXT_SERVICE_ADDRESS,
  apiKey: CONTEXT_SERVICE_API_KEY,
});

// Call once during application startup
await csClient.registerMapping({
  appId: process.env.FF_APP_ID!,
  mappingName: 'conversation_turns',
  rules: {
    edgeTypes: ['Contains', 'HasTurn'],
    entityTypes: ['ConversationTurn'],
    roleField: 'data.turn_role',        // CEL path to extract role
    contentField: 'data.turn_content',  // CEL path to extract content
    orderField: 'created_at',
  },
});
```

### 2. Reference the Mapping Name

Pass the mapping name in your `ChatHistoryBotMixin` config:

```typescript
class ConversationBot extends ComposeMixins(
  MixinBot,
  ChatHistoryBotMixin,
) {
  constructor() {
    super(
      { name: 'ConversationBot', base_prompt_group: buildPrompts(), model_pool_name: 'default' },
      { mappingName: 'conversation_turns', maxMessages: 20 },
    );
  }
}
```

---

## Combining with Other Mixins

`ChatHistoryBotMixin` composes cleanly with other mixins. Add it before `StructuredOutputBotMixin` so history is available when structured output processing begins:

```typescript
class ChatAnalysisBot extends ComposeMixins(
  MixinBot,
  ChatHistoryBotMixin,         // Inject conversation history into prompts
  StructuredOutputBotMixin,    // Parse LLM response into a schema
) {
  constructor() {
    super(
      { name: 'ChatAnalysisBot', base_prompt_group: buildPrompts(), model_pool_name: 'default' },
      { maxMessages: 20 },
      { schema: AnalysisSchema },
    );
  }
}
```

Or with working memory:

```typescript
class MemoryAwareBot extends ComposeMixins(
  MixinBot,
  ChatHistoryBotMixin,       // Conversation context from entity graph
  WorkingMemoryBotMixin,     // Files/documents from blob storage
) {
  constructor() {
    super(
      { name: 'MemoryAwareBot', base_prompt_group: buildPrompts(), model_pool_name: 'default' },
      { maxMessages: 15 },   // ChatHistoryBotMixin config
      {},                    // WorkingMemoryBotMixin config
    );
  }
}
```

---

## Environment Variables

`ChatHistoryBotMixin` and `ChatHistoryPromptGroup` use these environment variables to connect to the Context Service. In cluster deployments these are set automatically by the platform:

| Variable | Description |
|----------|-------------|
| `CONTEXT_SERVICE_ADDRESS` | Context Service URL, e.g., `http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051` |
| `CONTEXT_SERVICE_API_KEY` | API key for authentication (optional in some deployments) |

For local development:

```bash
kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051
export CONTEXT_SERVICE_ADDRESS=http://localhost:50051
```

---

## Token Budget Considerations

Chat history increases the token cost of every LLM call. Guidelines:

- **`maxMessages: 10–20`** works well for most conversational bots
- **`maxMessages: 0`** (all history) is appropriate for very short sessions but risky for long ones
- The `ContextAssemblyService` returns only message role and content — it does not include metadata, entity IDs, or other graph data — so history is compact

If your conversations are routinely long (100+ turns), consider a summarization strategy: have a separate bot periodically summarize older turns and replace them with a summary message, keeping only the last N direct turns in working history.

---

## Troubleshooting

### No history appears in prompts

- Verify `CONTEXT_SERVICE_ADDRESS` is set and reachable
- Check that the session node ID is present in the entity context (look for `prevailing_context_node_dto` or `root_entity_node_dto` in your entity context)
- For custom mappings, ensure `registerMapping` was called at startup with the same `mappingName`

### History appears but messages are in wrong order

The Context Service orders messages by the `orderField` configured in the mapping (default: `created_at` timestamp). If your entity nodes have no timestamp or an incorrect one, ordering may be wrong. Check your CEL mapping's `orderField` configuration.

### History appears for wrong conversation

The node ID used for traversal comes from `request.context_provider.get_context()`. If `prevailing_context_node_dto?.id` is missing, it falls back to `root_entity_node_dto?.id`. Verify your entity is correctly setting the context node on each invocation.

---

## Related

- [Context Service — Concepts](../../../platform/services/context-service/concepts.md) — how history reconstruction works under the hood
- [Context Service — Getting Started](../../../platform/services/context-service/getting-started.md) — register custom mappings, call `GetChatHistory` directly
- [Working Memory Guide](./working-memory.md) — blob storage for files and documents
- [Advanced Bot Mixin Patterns](../feature_guides/advanced-bot-mixin-patterns.md) — composing mixins, custom mixin patterns
