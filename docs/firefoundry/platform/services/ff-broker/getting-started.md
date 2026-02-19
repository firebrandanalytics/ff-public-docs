# FF Broker — Getting Started

This guide walks you through configuring and using the FF Broker, from sending your first request to setting up production model groups.

## Prerequisites

- A running FF Broker instance (deployed via Helm or running locally)
- PostgreSQL with the broker schemas migrated (`brk_customer`, `brk_routing`, `brk_tracking`, `brk_registry`)
- At least one AI provider API key (Azure OpenAI, OpenAI, Gemini, or xAI)
- The `ff-brk` CLI tool or a gRPC client

## Step 1: Verify the Broker is Running

Check the broker's health endpoint:

```bash
# If using the HTTP config server
curl http://localhost:3000/health
# Expected: {"status":"ok","service":"ff_broker_config_api","timestamp":"..."}

# If using ff-brk CLI (requires port-forward to gRPC port)
ff-brk health
```

## Quick Setup (Atomic Endpoint)

The setup endpoint creates the entire model routing chain in a single atomic transaction: provider account, deployed model, model group, and member. This is what `ff-cli env broker-config create` uses under the hood.

```
POST /api/config/setup
```

### Request Schema

```json
{
  "provider": "string (required) — hosting provider code (e.g., 'open-ai', 'vertex-ai', 'azure-openai')",
  "model": "string (required) — model code from registry (e.g., 'gemini-2.5', 'gpt-4o')",
  "variant": "string (optional, default: 'standard') — model variant (e.g., 'pro', 'mini')",
  "auth": {
    "method": "string (required) — one of: 'env_var', 'service_account', 'google_adc'",
    "config": "object (required) — provider-specific auth config"
  },
  "deployment_config": "object (optional) — extra deployment config merged into deployed_model.config",
  "model_group": {
    "name": "string (required) — model group name agents reference as 'modelPool'",
    "strategy": "string (optional, default: 'round_robin') — selection strategy code"
  }
}
```

### Auth Config by Provider

**OpenAI** (`auth.method: "env_var"`):
```json
{ "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } } }
```

**Google AI Studio / Gemini** (`auth.method: "env_var"`):
```json
{ "auth": { "method": "env_var", "config": { "env_var_name": "GOOGLE_API_KEY" } } }
```

**Vertex AI** (`auth.method: "google_adc"`):
```json
{ "auth": { "method": "google_adc", "config": { "project_id": "your-gcp-project" } } }
```

**Azure OpenAI** (`auth.method: "env_var"`):
```json
{ "auth": { "method": "env_var", "config": { "env_var_name": "AZURE_OPENAI_API_KEY" } } }
```

### Complete Examples

**Gemini 2.5 Pro (text completion via Google AI Studio):**
```bash
curl -X POST http://localhost:3000/api/config/setup \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "vertex-ai",
    "model": "gemini-2.5",
    "variant": "pro",
    "auth": { "method": "env_var", "config": { "env_var_name": "GOOGLE_API_KEY" } },
    "model_group": { "name": "gemini_completion", "strategy": "round_robin" }
  }'
```

**OpenAI GPT-4o (text completion):**
```bash
curl -X POST http://localhost:3000/api/config/setup \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "open-ai",
    "model": "gpt-4o",
    "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
    "model_group": { "name": "openai_completion", "strategy": "round_robin" }
  }'
```

**OpenAI GPT Image 1.5 (image generation):**
```bash
curl -X POST http://localhost:3000/api/config/setup \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "open-ai",
    "model": "gpt-image-1.5",
    "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
    "model_group": { "name": "image_generation", "strategy": "round_robin" }
  }'
```

**Add a second model to an existing group (failover):**
```bash
curl -X POST http://localhost:3000/api/config/setup \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "open-ai",
    "model": "gpt-4o",
    "variant": "mini",
    "auth": { "method": "env_var", "config": { "env_var_name": "OPENAI_API_KEY" } },
    "model_group": { "name": "openai_completion", "strategy": "failover" }
  }'
```

Note: If the model group already exists, the strategy field is ignored and a warning is returned.

### Response

```json
{
  "provider_account": { "id": 1, "code": "vertex-ai-env_var", "created": true },
  "deployed_model": { "id": 1, "name": "vertex-ai-gemini-2.5-pro", "hosted_model_id": 6, "created": true },
  "model_group": { "id": 1, "name": "gemini_completion", "strategy": "round_robin", "created": true },
  "member": { "id": 1, "sequence_order": 1, "created": true },
  "warnings": []
}
```

The `created` fields indicate whether each resource was newly created or already existed (idempotent upsert).

### Using ff-cli

The CLI wraps the setup endpoint — it auto-discovers the broker via port-forward:

```bash
ff-cli env broker-config create --name gemini_completion
```

### What the Setup Endpoint Does (10 Steps)

1. Resolves the hosted model from the registry (provider + model + variant)
2. Validates the provider has a ProviderClassMapper implementation (warns if not)
3. Validates auth config against provider requirements
4. Validates deployment config if provided
5. Upserts provider_account (creates or updates auth config)
6. Upserts deployed_model (creates or updates config, auto-populates `{ "model": "<model>-<variant>" }`)
7. Links provider_account to deployed_model
8. Resolves the selection strategy (round_robin, failover, etc.)
9. Upserts model_group (creates or reuses existing)
10. Upserts model_group_member (links deployed_model to model_group)

All steps run in a single database transaction — if any step fails, nothing is committed.

---

## Manual Step-by-Step Setup

If you need more control over individual resources, use the granular endpoints below.

## Step 2: Register a Customer

Before routing requests, you need a customer record in the database. Use the HTTP config API:

```bash
curl -X POST http://localhost:3000/api/customer \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-org",
    "description": "My organization"
  }'
```

## Step 3: Add a Provider Account

Register an AI provider's API credentials:

```bash
curl -X POST http://localhost:3000/api/customer/provider-accounts \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "providerName": "azure-openai",
    "apiKey": "your-azure-api-key",
    "endpoint": "https://your-resource.openai.azure.com"
  }'
```

## Step 4: Register a Deployed Model

Link a specific model deployment to the provider account:

```bash
curl -X POST http://localhost:3000/api/customer/deployed-models \
  -H "Content-Type: application/json" \
  -d '{
    "providerAccountId": 1,
    "modelId": 5,
    "deploymentName": "gpt-4-turbo",
    "endpoint": "https://your-resource.openai.azure.com/openai/deployments/gpt-4-turbo"
  }'
```

## Step 5: Create a Model Group

Create a model group (model pool) that agents will reference:

```bash
curl -X POST http://localhost:3000/api/routing/model-groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production",
    "description": "Production model pool"
  }'
```

## Step 6: Add Resources to the Group

Add deployed models to the group with scoring weights:

```bash
curl -X POST http://localhost:3000/api/routing/model-groups/1/resources \
  -H "Content-Type: application/json" \
  -d '{
    "deployedModelId": 1,
    "intelligenceWeight": 9,
    "costWeight": 6
  }'
```

## Step 7: Send Your First Request

### Using ff-brk CLI

```bash
ff-brk chat \
  --pool production \
  --message "What is the capital of France?" \
  --stream
```

### Using gRPC Directly

```typescript
import { createChannel, createClient } from 'nice-grpc';
import { CompletionBrokerServiceDefinition } from './proto/completion_broker.js';

const channel = createChannel('localhost:50051');
const client = createClient(CompletionBrokerServiceDefinition, channel);

const stream = client.createBrokeredCompletionStream({
  modelPool: 'production',
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'What is the capital of France?' }
  ],
  temperature: 0.7,
  maxTokens: 150,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

### Using the Agent SDK

```typescript
import { FireFoundryClient } from '@firebrandanalytics/ff-sdk';

const client = new FireFoundryClient({
  brokerUrl: 'localhost:50051',
});

const response = await client.broker.complete({
  modelPool: 'production',
  messages: [
    { role: 'user', content: 'What is the capital of France?' }
  ],
});

console.log(response.content);
```

## Step 8: Add a Failover Resource

For production reliability, add a second resource to the model group:

```bash
# Register a second provider account (e.g., OpenAI Direct)
curl -X POST http://localhost:3000/api/customer/provider-accounts \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "providerName": "openai",
    "apiKey": "your-openai-api-key"
  }'

# Register the deployed model
curl -X POST http://localhost:3000/api/customer/deployed-models \
  -H "Content-Type: application/json" \
  -d '{
    "providerAccountId": 2,
    "modelId": 5,
    "deploymentName": "gpt-4-turbo"
  }'

# Add to model group with lower intelligence weight (failover)
curl -X POST http://localhost:3000/api/routing/model-groups/1/resources \
  -H "Content-Type: application/json" \
  -d '{
    "deployedModelId": 2,
    "intelligenceWeight": 8,
    "costWeight": 7
  }'
```

Now if the Azure deployment fails, the broker automatically retries with the OpenAI Direct deployment.

## Step 9: Add Semantic Labels

Tag your requests with semantic labels for better observability and industrial-scale features:

```typescript
const stream = client.createBrokeredCompletionStream({
  modelPool: 'production',
  semanticLabel: 'customer_support_query',  // Enables output prediction, usage profiling
  messages: [
    { role: 'user', content: 'How do I reset my password?' }
  ],
});
```

## Step 10: Enable Industrial Features

Once your basic setup is working, gradually enable industrial-scale features:

```bash
# Enable capacity gating (recommended first)
export BROKER_FF_CAPACITY_GATING=true

# Enable stream instrumentation for TTFT/throughput metrics
export BROKER_FF_STREAM_INSTRUMENTATION=true

# Enable performance-aware routing
export BROKER_FF_PERFORMANCE_ROUTING=true
```

See [Operations — Feature Flag Rollout](./operations.md#recommended-rollout-sequence) for the recommended sequence.

## Embedding Requests

### Single Embedding

```bash
ff-brk embed \
  --group-id 4 \
  --input "FireFoundry is an AI agent platform"
```

### Batch Embedding

```typescript
const response = await client.createBrokeredBatchEmbedding({
  modelGroupId: 4,
  inputs: [
    "First document text",
    "Second document text",
    "Third document text"
  ],
});

// response.embeddings is an array of float vectors
```

## Image Generation

```typescript
const response = await imageClient.createBrokeredImageGeneration({
  modelPool: 'image-production',
  prompt: 'A futuristic city skyline at sunset',
  size: '1024x1024',
  quality: 'hd',
});

// response includes blob storage URL for the generated image
```

## Troubleshooting

### "No resources available" Error

This means the model group has no resources or all resources are unhealthy:
1. Check the model group has resources: `GET /api/routing/model-groups/{id}/resources`
2. Verify provider accounts have valid credentials
3. Check the broker logs for provider connection errors

### "Rate limit exceeded" / Failover Happening

The primary provider is hitting rate limits:
1. Add more resources to the model group for better distribution
2. Enable capacity gating (`BROKER_FF_CAPACITY_GATING=true`) to prevent overloading
3. Consider enabling quota enforcement for proactive throttling

### High Latency

1. Enable stream instrumentation to measure TTFT: `BROKER_FF_STREAM_INSTRUMENTATION=true`
2. Enable performance routing to avoid slow deployments: `BROKER_FF_PERFORMANCE_ROUTING=true`
3. Check the `/api/industrial/performance` endpoint for deployment-level metrics

### Connection Refused

1. Verify the broker gRPC port is correct (default: 50051)
2. Check PostgreSQL connectivity (core and registry databases)
3. Review environment variables for correct database URLs
