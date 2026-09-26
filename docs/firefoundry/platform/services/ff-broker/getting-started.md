# FF Broker — Getting Started

This guide takes you from an environment with a running broker to an agent bundle that calls a model pool. The examples use an environment (namespace) named `ff-test`; substitute your own.

## Prerequisites

- A FireFoundry environment with `firefoundry-core` installed (the broker is enabled by default)
- `ff-cli` configured for that environment ([FF CLI setup](../../../local-development/ff-cli-setup.md))
- An API key (or cloud credentials) for at least one AI provider: OpenAI, Azure OpenAI, Google Gemini, Anthropic, or xAI
- Optional: the [`ff-brk`](../../../sdk/cli-tools/ff-brk.md) CLI for sending test requests

## Step 1: Add a Provider Credential

Store your provider API key as a broker secret. The key name is what the model pool configuration will reference.

```bash
ff-cli env broker-secret add ff-test --key GEMINI_API_KEY --value "<your-key>" -y
```

Common key names: `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `GOOGLE_API_KEY` / `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`. For Vertex AI with Google application default credentials, your environment administrator provisions the service account.

## Step 2: Create a Model Pool

A model pool is the name your code will reference. Describe the provider, model, credential, and pool name in a JSON file:

```json
{
  "provider": "vertex-ai",
  "model": "gemini-2.5",
  "variant": "pro",
  "auth": { "method": "env_var", "config": { "env_var_name": "GEMINI_API_KEY" } },
  "model_group": { "name": "gemini_completion", "strategy": "round_robin" }
}
```

Create it and check the result:

```bash
ff-cli env broker-config create ff-test -f gemini.json
ff-cli env broker-config show ff-test --model-group gemini_completion
```

The same JSON is the body of the broker's `POST /api/config/setup` endpoint; see [Reference — Configuration API](./reference.md#configuration-api) for every field, the auth options per provider, and more examples (OpenAI, image generation, adding a failover model).

Configuration changes can take up to about five minutes to reach request routing; see [Operations](./operations.md#configuration-changes).

## Step 3: Send a Test Request

Before writing code, confirm the pool works with `ff-brk`:

```bash
kubectl port-forward -n ff-test svc/firefoundry-core-ff-broker 50051:50051

ff-brk complete --port 50051 \
  -m gemini_completion \
  -l "smoke-test" \
  --msg "What is the capital of France?"
```

A response with a model name and token usage means the pool, credential, and provider are all working.

## Step 4: Call the Pool from a Bot

Bots are the usual way to use the broker. Set the bot's `model_pool_name` to your pool:

```typescript
const MyBotBase = ComposeMixins(MixinBot, StructuredOutputBotMixin) as any;

export class MyBot extends MyBotBase {
  constructor(input: string) {
    super(
      [{ name: "MyBot", base_prompt_group: buildPromptGroup(input), model_pool_name: "gemini_completion", static_args: {} }],
      [{ schema: MyBotSchema }]
    );
  }

  // Required in SDK v4 — becomes the semantic label on every broker call
  get_semantic_label_impl(_request: any): string {
    return "MyBot";
  }
}
```

Point the bundle at the broker in its Helm values:

```yaml
configMap:
  data:
    LLM_BROKER_HOST: "firefoundry-core-ff-broker"
    LLM_BROKER_PORT: "50051"
```

See [Agent Development](../../../local-development/agent-development.md) for the full bot and endpoint walkthrough, and [Bots](../../../sdk/agent_sdk/core/bots.md) for the bot framework.

## Step 5: Call the Broker Directly (Embeddings, Images, Ad-hoc)

For work outside a bot, use `SimplifiedBrokerClient` from `@firebrandanalytics/ff_broker_client`:

```typescript
import { SimplifiedBrokerClient, AspectRatio, ImageQuality } from '@firebrandanalytics/ff_broker_client';

const broker = new SimplifiedBrokerClient({
  host: process.env.LLM_BROKER_HOST || 'localhost',
  port: parseInt(process.env.LLM_BROKER_PORT || '50051'),
});

// Embedding (embedding requests address the model group by numeric ID)
const emb = await broker.getEmbedding({
  input: 'FireFoundry is an AI agent platform',
  modelGroupId: 4,
  scorePreference: { intelligenceWeight: 0.5, costWeight: 0.5 },
});
const vector = emb.data[0].embedding;

// Image generation (image stored in blob storage; you get a reference back)
const img = await broker.generateImage({
  modelPool: 'image_generation',
  prompt: 'A futuristic city skyline at sunset',
  semanticLabel: 'city-illustration',
  quality: ImageQuality.IMAGE_QUALITY_MEDIUM,
  aspectRatio: AspectRatio.ASPECT_RATIO_3_2,
});
const { blobId, objectKey, format } = img.images[0];
```

Worked examples: [Vector Similarity Quickstart](../../../sdk/agent_sdk/feature_guides/vector-similarity-quickstart.md) (embeddings) and [Illustrated Story, Part 3](../../../sdk/agent_sdk/tutorials/illustrated-story/part-03-image-generation.md) (images).

## Step 6: Add Failover

Add a second deployment to the same pool so rate limits or provider outages don't reach your users. Run `broker-config create` again with the same `model_group.name` and a different provider or model:

```json
{
  "provider": "open-ai",
  "model": "gpt-4o",
  "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
  "model_group": { "name": "gemini_completion" }
}
```

The pool now has two deployments; retryable errors on one are retried on the other. (The pool's strategy is set when the pool is first created; on later calls it is ignored with a warning.) If your prompts rely on one model family's behavior, add a second deployment of the *same* model on another provider or region instead.

## Step 7: Find Your Calls in Telemetry

Every broker call is recorded with the pool, the model that served it, tokens, latency, your semantic label, and breadcrumbs. Look them up in the FireFoundry Console or with [`ff-telemetry-read`](../../../sdk/cli-tools/ff-telemetry-read.md), for example by entity:

```bash
ff-telemetry-read trace by-breadcrumb MyEntity <entity-id>
```

## Next Steps

- [Concepts](./concepts.md) — pool design, failover behavior, semantic labels
- [Reference](./reference.md) — request fields and error codes
- [Operations](./operations.md) — verifying and troubleshooting from your bundle
