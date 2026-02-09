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
