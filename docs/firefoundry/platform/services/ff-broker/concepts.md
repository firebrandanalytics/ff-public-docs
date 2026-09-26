# FF Broker — Concepts

This page explains the ideas you need to design an app around the FF Broker: model pools, how a deployment is chosen, what failover means for your code, and how semantic labels and breadcrumbs connect broker calls to your app.

## Model Pools

A **model pool** (also called a *model group*) is a named set of model deployments that can serve the same kind of request. Your code names the pool; the broker decides which deployment in the pool serves each call.

```
Model pool: "production-completion"
├── gpt-4o            (Azure OpenAI, East US)
├── gpt-4o            (Azure OpenAI, West US)
└── gemini-2.5-pro    (Google AI Studio)
```

Pools decouple your agent logic from specific models:

- A bot asks for `production-completion`, not "gpt-4o on Azure East US".
- Deployments can be added, removed, or swapped in the environment without changing or redeploying your bundle.
- Failover happens inside the pool, so a second deployment makes a pool more resilient.

In the Agent SDK, a bot's `model_pool_name` is the pool name. For embeddings and image generation you pass the pool (or, for embeddings, the model group ID) on the client call. See [Getting Started](./getting-started.md) for both paths.

### Designing your pools

Pools are cheap; create one per *purpose* rather than one per model:

| Pool (example) | Used by | Why separate |
|----------------|---------|--------------|
| `extraction_fast` | High-volume structured extraction bots | Small, cheap models; spread load across deployments |
| `reasoning_premium` | Planning / review bots | Most capable models; fewer calls |
| `embeddings_small` | Indexing and similarity search | Embedding models only |
| `image_generation` | Illustration features | Image models only |

Because the pool name is the contract between your code and the environment, keep the same pool names across dev, staging, and production environments, and let each environment map them to whatever models it has.

A pool can only serve requests its models support: a completion request to a pool that holds only embedding models, or an image request to a text-only pool, fails.

## Deployment Selection

When a pool has more than one deployment, the broker chooses one per request.

- **Pool strategy** — each pool is created with a selection strategy. `round_robin` spreads calls across deployments; `failover` prefers deployments in their configured order and moves down the list on failure.
- **Cost/quality preference** — a completion request can include `modelSelectionCriteria` (and an embedding request a `scorePreference`) to lean toward more capable or cheaper deployments within the pool. If your app has both "draft" and "final" quality steps, you can either use two pools or one pool with different preferences.
- **Model hint** — the `model` field on a completion request is a hint, not a guarantee. If your code depends on a specific model, put only that model in the pool.

Check which model actually served a call in the response (`model`) or in telemetry.

## Failover

When a call to the selected deployment fails, the broker classifies the error and either retries on another deployment in the pool or returns the error to you.

| Provider error | What the broker does |
|----------------|----------------------|
| Rate limit (429) | Tries another deployment |
| Timeout | Tries another deployment |
| Server error (5xx) | Tries another deployment |
| Auth failure (401/403) | Tries another deployment |
| Invalid request (400) | Returns the error (no retry) |
| Content filter | Returns the error (no retry) |

If every deployment in the pool fails, your code receives the error. What this means for your app:

- A single-deployment pool has no failover. Use at least two deployments (ideally on different providers or regions) for anything user-facing.
- Invalid requests and content-filter rejections are not retried — handle them in your code (fix the prompt, surface a message to the user).
- Failover can change which model answers. If your prompts depend on one model family's behavior, keep the pool homogeneous.

## Semantic Labels

A **semantic label** is a short string naming the purpose of a request, such as `invoice_extraction` or `customer_support_reply`. Bots supply one through `get_semantic_label_impl()` (required in SDK v4); direct client calls pass `semanticLabel`.

Labels are how you find and group your calls in telemetry, and they are the key for mock-cache lookups in tests. Some environment-level routing features also learn per label (see below). Use stable, descriptive labels — one per logical task, not per request.

## Breadcrumbs

**Breadcrumbs** are correlation IDs attached to a request — entity type, entity ID, and correlation ID. When a bot runs inside an entity, the SDK carries the entity's breadcrumbs onto the broker call. They let you trace a broker call back to the entity that caused it in the Console and with `ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>` (see [Monitoring and Debugging](../../../sdk/agent_sdk/guides/monitoring-debugging.md)).

## Streaming

Chat completions are streamed: the broker forwards each chunk from the provider as it arrives, and the final chunk carries token usage. Bots consume the stream for you; with the broker client you iterate the stream directly.

## Structured Output and Tools

- **Structured output** — supply a JSON schema as `responseFormat` and the broker requests schema-constrained output (using the provider's native support where available). The SDK's `StructuredOutputBotMixin` does this from a Zod schema and validates the result.
- **Tools** — supply `tools` and `toolChoice`; tool invocations come back as `toolCalls` on the response chunks, and your code (or the SDK's tool-calling bots) executes them and continues the conversation.

## Embeddings and Image Generation

- **Embeddings** — single and batch requests return float vectors plus usage. Store them on entities for similarity search (see the [Vector Similarity Quickstart](../../../sdk/agent_sdk/feature_guides/vector-similarity-quickstart.md)).
- **Image generation** — the broker generates images with the pool's image model, stores them in the environment's blob storage, and returns references (blob ID, object key, format, size) rather than raw bytes. See the [Illustrated Story tutorial](../../../sdk/agent_sdk/tutorials/illustrated-story/part-03-image-generation.md).

## Mock Cache

For deterministic tests, a request can carry a **mock cache ID**. The broker then returns a cached response instead of calling the provider, so integration tests get repeatable results and don't spend tokens. `ff-brk complete --mock-cache-id <id>` uses this.

## Environment-Level Routing Features

Your environment administrator can turn on additional capacity and routing features. They are off by default. You don't call them directly, but when they are on they change what your app experiences:

| Feature | Effect your app sees | Design implication |
|---------|----------------------|--------------------|
| **Capacity limits** | Each deployment accepts a bounded number of concurrent calls; excess calls are rejected immediately with `RESOURCE_EXHAUSTED` rather than queued | Bound your own fan-out (for example, parallel bot calls) and retry with backoff |
| **Quotas** | Token-per-minute / request-per-minute limits; exceeding them returns `RESOURCE_EXHAUSTED` naming the quota | Retry after the quota window resets; spread batch work over time |
| **Performance routing** | Slow or error-prone deployments are avoided automatically | None; latency improves during provider incidents |
| **Sticky routing** | Consecutive calls for the same entity go to the same deployment, improving provider prompt-cache hit rates | Pass entity breadcrumbs (the SDK does this) and keep stable prompt content (system prompt, shared context) at the start of the prompt |
| **QoS tiers** | Requests are assigned a tier — `ECONOMY`, `STANDARD` (default), `PREMIUM`, or `CRITICAL` — that limits which models are eligible | Agree with your administrator which tier your workloads need |
| **Priority routing** | Under heavy load, higher-priority requests are served first | Latency-sensitive work should use a higher tier or priority |
| **Output prediction** | The broker learns typical output size per semantic label to estimate quota use | Use consistent semantic labels |

Ask your environment administrator which of these are enabled before load-testing or sizing a high-volume workload.

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
