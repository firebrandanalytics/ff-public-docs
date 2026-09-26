# FF Broker — Reference

Caller-facing reference for the FF Broker: gRPC request and response fields, the configuration API for model pools, client connection settings, and the errors your code can receive.

## Connecting

| Interface | In-cluster address (default `firefoundry-core` install) | Used by |
|-----------|--------------------------------------------------------|---------|
| gRPC | `firefoundry-core-ff-broker:50051` | Bots, `SimplifiedBrokerClient`, `ff-brk` |
| HTTP | `firefoundry-core-ff-broker:3000` | Configuration API, health check, `ff-cli env broker-config` |

The broker is internal to the cluster by default (not routed through the external gateway). In-cluster calls from your bundle need no credentials beyond network access.

### Client settings

| Setting | Where | Purpose |
|---------|-------|---------|
| `LLM_BROKER_HOST` | Agent bundle env (Helm `configMap.data`) | Broker gRPC host, e.g. `firefoundry-core-ff-broker` |
| `LLM_BROKER_PORT` | Agent bundle env | Broker gRPC port — must match the broker Service's gRPC port (`50051` by default) |
| `FF_BROKER_HOST` / `FF_BROKER_PORT` | `ff-brk` CLI env, or `--host` / `--port` | Where `ff-brk` sends requests |

If the SDK cannot find broker settings it falls back to a mock broker client (you'll see `MockBrokerClient` in the bundle logs) — see [Operations — Troubleshooting](./operations.md#troubleshooting).

## gRPC Services

### CompletionBrokerService

**Package**: `firebrand.ff.completion.broker.v1`

#### CreateBrokeredCompletionStream

Streaming chat completion with model selection and failover.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelPool` | string | Yes | Model pool (model group) name |
| `model` | string | No | Model hint — not a guarantee of which model serves the call |
| `semanticLabel` | string | No | Purpose label for telemetry, mock cache, and label-based routing features |
| `messages` | Message[] | Yes | Chat messages (system, user, assistant) |
| `temperature` | float | No | Sampling temperature (0.0–2.0) |
| `maxTokens` | int32 | No | Maximum tokens in the response |
| `topP` | float | No | Nucleus sampling |
| `frequencyPenalty` | float | No | -2.0 to 2.0 |
| `presencePenalty` | float | No | -2.0 to 2.0 |
| `stop` | string[] | No | Stop sequences |
| `responseFormat` | ResponseFormat | No | JSON schema for structured output |
| `tools` | Tool[] | No | Tools/functions the model may call |
| `toolChoice` | ToolChoice | No | Tool selection strategy |
| `modelSelectionCriteria` | SelectionCriteria | No | Preference toward capability vs. cost within the pool |
| `breadcrumbs` | Breadcrumb[] | No | Correlation IDs (entity type, entity ID, correlation ID) |
| `id` | string | No | Client-provided request ID |

**Response**: stream of `CompletionChunk`

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Token content |
| `role` | string | Message role |
| `finishReason` | string | Why generation stopped |
| `toolCalls` | ToolCall[] | Tool invocations |
| `usage` | Usage | Token usage (final chunk only) |

### EmbeddingBrokerService

**Package**: `firebrand.ff.embedding.broker.v1`

#### CreateBrokeredEmbedding

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelGroupId` | int32 | Yes | Numeric ID of the embedding model group |
| `embeddingRequest` | EmbeddingRequest | Yes | Model and input text |
| `scorePreference` | ScorePreference | No | Capability/cost weighting |

**Response**: `EmbeddingResponse` — `embedding` (float[]), `model`, `usage`.

#### CreateBrokeredBatchEmbedding

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelGroupId` | int32 | Yes | Numeric ID of the embedding model group |
| `inputs` | string[] | Yes | Text inputs |
| `scorePreference` | ScorePreference | No | Capability/cost weighting |

**Response**: `BatchEmbeddingResponse` — one embedding per input, in order.

Embedding calls address the model group by **numeric ID**, not name. Find the ID with `GET /api/routing/model-groups` or `ff-cli env broker-config show`.

### ImageGenerationBrokerService

**Package**: `firebrand.ff.image.broker.v1`

#### CreateBrokeredImageGeneration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelPool` | string | Yes | Model pool containing an image model |
| `prompt` | string | Yes | Image prompt |
| `size` | string | No | Dimensions, e.g. `1024x1024` |
| `quality` | string | No | Quality level |
| `n` | int32 | No | Number of images |

**Response**: generated images as blob storage references (blob ID, object key, format, size in bytes). `SimplifiedBrokerClient.generateImage()` also accepts `semanticLabel`, `quality` (`ImageQuality` enum), and `aspectRatio` (`AspectRatio` enum).

Supported image models: OpenAI GPT Image 1.5, Gemini image models (Gemini 2.5 Flash, Gemini 3 Pro).

## Configuration API

HTTP on port `3000`. `ff-cli env broker-config` wraps these endpoints and handles the port-forward for you.

### Setup (create or extend a model pool)

```
POST /api/config/setup
```

Creates the whole routing chain — provider credential reference, deployed model, model pool, and pool membership — in one atomic step. It is idempotent: existing pieces are reused and reported with `"created": false`.

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | Hosting provider code, e.g. `open-ai`, `azure-openai`, `vertex-ai` |
| `model` | Yes | Model code from the broker's model catalog, e.g. `gpt-4o`, `gemini-2.5`, `gpt-image-1.5` |
| `variant` | No | Model variant, e.g. `pro`, `mini` (default `standard`) |
| `auth.method` | Yes | `env_var`, `service_account`, or `google_adc` |
| `auth.config` | Yes | Provider-specific auth settings (below) |
| `deployment_config` | No | Extra provider-specific deployment settings |
| `model_group.name` | Yes | Pool name your code references |
| `model_group.strategy` | No | `round_robin` (default) or `failover`; ignored with a warning if the pool already exists |

**Auth config by provider**

| Provider | `auth` |
|----------|--------|
| OpenAI | `{ "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } }` |
| Google AI Studio / Gemini | `{ "method": "env_var", "config": { "env_var_name": "GOOGLE_API_KEY" } }` |
| Vertex AI | `{ "method": "google_adc", "config": { "project_id": "your-gcp-project" } }` |
| Azure OpenAI | `{ "method": "env_var", "config": { "env_var_name": "AZURE_OPENAI_API_KEY" } }` |

`env_var_name` refers to a broker secret key added with `ff-cli env broker-secret add`.

**Examples**

```jsonc
// OpenAI GPT-4o completion pool
{
  "provider": "open-ai",
  "model": "gpt-4o",
  "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
  "model_group": { "name": "openai_completion", "strategy": "round_robin" }
}

// Image generation pool
{
  "provider": "open-ai",
  "model": "gpt-image-1.5",
  "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
  "model_group": { "name": "image_generation" }
}

// Add GPT-4o mini to an existing pool as a failover option
{
  "provider": "open-ai",
  "model": "gpt-4o",
  "variant": "mini",
  "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
  "model_group": { "name": "openai_completion" }
}
```

**Response**

```json
{
  "provider_account": { "id": 1, "code": "vertex-ai-env_var", "created": true },
  "deployed_model": { "id": 1, "name": "vertex-ai-gemini-2.5-pro", "hosted_model_id": 6, "created": true },
  "model_group": { "id": 1, "name": "gemini_completion", "strategy": "round_robin", "created": true },
  "member": { "id": 1, "sequence_order": 1, "created": true },
  "warnings": []
}
```

If any step fails, nothing is created. `warnings` lists non-fatal issues (for example, a strategy ignored because the pool already existed).

### Model pools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/routing/model-groups` | List model pools (names and numeric IDs) |
| GET | `/api/routing/model-groups/:id` | Pool details |
| PUT | `/api/routing/model-groups/:id` | Update a pool |
| DELETE | `/api/routing/model-groups/:id` | Delete a pool |
| GET | `/api/routing/model-groups/:id/resources` | Deployments in a pool |
| DELETE | `/api/routing/model-groups/:id/resources/:resourceId` | Remove a deployment from a pool |

### Model catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/registry/models` | Models available to configure |
| GET | `/api/registry/providers` | Supported providers |
| GET | `/api/registry/capabilities` | Model capabilities (completion, embedding, image, structured output, …) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status":"ok", ...}` when the broker is up |

## Error Codes

Errors reach your code as gRPC status codes (the SDK surfaces them as exceptions).

| gRPC Status | Code | Meaning | What to do |
|-------------|------|---------|------------|
| `CANCELLED` | 1 | Your client cancelled the call | — |
| `INVALID_ARGUMENT` | 3 | Invalid request parameters | Fix the request; not retried by failover |
| `NOT_FOUND` | 5 | Model pool (or group ID) not found | Check the pool name/ID in this environment |
| `PERMISSION_DENIED` | 7 | Provider authentication failed on every deployment | Check the broker secret for the provider key |
| `RESOURCE_EXHAUSTED` | 8 | Provider rate limit, environment capacity limit, or quota exceeded on every eligible deployment | Retry with backoff; reduce concurrency; add deployments |
| `FAILED_PRECONDITION` | 9 | Rejected by an environment capacity check | Retry with backoff |
| `ABORTED` | 10 | Provider content filter rejected the request | Change the input; not retried |
| `INTERNAL` | 13 | Unexpected broker error | Retry; report if persistent |
| `UNAVAILABLE` | 14 | Provider temporarily unavailable on every deployment | Retry with backoff; add a deployment on another provider |
| `DATA_LOSS` | 15 | Stream corrupted | Retry |

## Related

- [Overview](./README.md)
- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
- [ff-brk CLI](../../../sdk/cli-tools/ff-brk.md)
