# FF Broker Service

## Overview

The FF Broker is a high-performance gRPC service that acts as an intelligent middleware layer for AI model orchestration. It provides automatic model selection, load balancing, and failover capabilities across multiple AI providers including Azure OpenAI, OpenAI, Google Gemini, and Anthropic Claude. The broker optimizes requests based on cost/intelligence scoring while ensuring reliability through built-in failover policies and comprehensive request tracking.

## Purpose and Role in Platform

The FF Broker serves as the central routing hub in the FireFoundry platform, sitting between agent bundles and AI model providers. When an agent needs to generate text, embeddings, or structured outputs, it sends requests to the broker rather than directly to providers. The broker then:

- Selects the optimal model based on intelligence, cost, and performance scoring
- Routes requests to the appropriate provider deployment
- Handles failures gracefully with automatic failover
- Tracks all requests for observability and cost monitoring
- Manages provider authentication and API key rotation

This abstraction allows agent developers to focus on agent logic rather than model selection, provider management, and failure handling.

## Key Features

- **Intelligent Model Selection**: Automatic model selection using weighted scoring across intelligence, cost, and performance dimensions
- **Multi-Provider Support**: Native support for Azure OpenAI, OpenAI, Google Gemini, Anthropic Claude, and xAI models
- **Failover and Load Balancing**: Automatic failover between model deployments with configurable failover policies
- **Streaming Support**: Real-time streaming responses for chat completions with full token-by-token streaming
- **Structured Output**: JSON schema-constrained responses with native provider support where available
- **Embedding Generation**: Single and batch embedding operations with model group management
- **Cost Optimization**: Weighted scoring algorithm to balance cost, intelligence, and performance requirements
- **Request Tracking**: Comprehensive telemetry with request/response logging, breadcrumbs, and correlation IDs
- **Provider Registry**: Factory-based provider instantiation with caching, TTL expiration, and health monitoring
- **Model Context Protocol (MCP)**: Integration with MCP for advanced tool capabilities

## Architecture Overview

The FF Broker uses a layered architecture with clear separation of concerns:

### Request Flow

1. **gRPC Request Arrives**: Client (agent bundle) sends a completion or embedding request
2. **Model Selection**: `ModelSelectorManager` loads the appropriate model group configuration from the database
3. **Strategy Selection**: `CostIntelligenceStrategy` calculates weighted scores for available resources
4. **Provider Instantiation**: `ProviderFactory` creates or retrieves a cached provider instance
5. **Request Execution**: Provider executes the request against the external API (Azure, OpenAI, etc.)
6. **Failover Handling**: If the request fails, `FailoverPolicy` selects an alternative resource
7. **Response Tracking**: `TrackingService` records metrics (tokens, latency, cost) to the database
8. **Response Streaming**: For streaming requests, chunks are streamed back to the client in real-time

### Key Components

- **Model Selector Manager**: Singleton managing model group configurations and selection strategies
- **Selection Strategy**: Implements scoring algorithm (e.g., `CostIntelligenceStrategy`) to rank available resources
- **Provider Factory**: Creates provider instances from deployment configurations using a registry pattern
- **Provider Registry**: Caches provider instances with TTL-based expiration and health monitoring
- **Failover Policy**: Handles provider failures with automatic fallback to alternative resources
- **Tracking Service**: Records comprehensive request/response metrics for observability and cost tracking

### Database Architecture

The broker uses a dual-database architecture with Foreign Data Wrapper (FDW) integration:

- **Registry Database** (`brk_registry` schema): Global model catalog shared across broker instances (models, providers, capabilities)
- **Core Database** (four schemas):
  - `brk_registry` (FDW foreign tables): Remote access to registry database without data duplication
  - `brk_customer`: Customer-specific model deployments and API credentials
  - `brk_routing`: Model groups, selection strategies, and failover configurations
  - `brk_tracking`: Request logs, completion metrics, and provider performance data

This architecture enables centralized model management while maintaining instance-specific configuration and telemetry.

## API and Interfaces

The broker exposes gRPC services using Protocol Buffers for strong typing and high performance:

### Chat Completion Broker Service

**Service Definition**: `firebrand.ff.completion.broker.v1.CompletionBrokerService`

**Endpoints**:

- `CreateBrokeredCompletionStream`: Streaming chat completion with automatic model selection
  - Input: `BrokeredCompletionRequest` with model pool, messages, and optional selection criteria
  - Output: Stream of `CompletionChunk` messages
  - Features: Streaming responses, structured output support, tool integration

### Embedding Broker Service

**Service Definition**: `firebrand.ff.embedding.broker.v1.EmbeddingBrokerService`

**Endpoints**:

- `CreateBrokeredEmbedding`: Single text embedding with model group selection
  - Input: `BrokeredEmbeddingRequest` with model group ID and text input
  - Output: `EmbeddingResponse` with vector embeddings
  
- `CreateBrokeredBatchEmbedding`: Batch embedding for multiple inputs
  - Input: `BrokeredBatchEmbeddingRequest` with model group ID and multiple text inputs
  - Output: `BatchEmbeddingResponse` with array of vector embeddings

### Example Request (Chat Completion)

```typescript
{
  "modelPool": "production",
  "model": "gpt-4",
  "semanticLabel": "customer_query",
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "temperature": 0.7,
  "maxTokens": 150,
  "modelSelectionCriteria": {
    "costSensitivity": 0.3,
    "qualitySensitivity": 0.7
  }
}
```

## Dependencies

### External Services

- **PostgreSQL**: Two database instances (registry and core) with FDW linking them
  - Minimum version: PostgreSQL 13+ (for FDW support)
  - Network connectivity required between registry and core databases
- **AI Provider APIs**: API access to one or more providers
  - Azure OpenAI (with Azure API key and endpoint)
  - OpenAI (with OpenAI API key)
  - Google Cloud Vertex AI (with service account credentials)
  - Anthropic Claude (with API key)

### Environment Variables

**Core Database** (required for runtime):
```bash
CORE_DATABASE_URL=postgresql://user:password@host:5432/ff_core
# OR use individual variables:
PGF_HOST=core-host
PGF_PORT=5432
PGF_DATABASE=ff_core
PGF_USER=core_user
PGF_PWD=core_password
```

**Registry Database** (optional - only for registry maintenance):
```bash
REGISTRY_DATABASE_URL=postgresql://user:password@host:5432/ff_registry
# OR use individual variables:
PGF_REGISTRY_HOST=registry-host
PGF_REGISTRY_PORT=5432
PGF_REGISTRY_DATABASE=ff_registry
PGF_REGISTRY_USER=registry_user
PGF_REGISTRY_PWD=registry_password
```

**Provider API Keys** (at least one required):
```bash
# Azure OpenAI
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com

# OpenAI
OPENAI_API_KEY=your_openai_key

# Google Cloud (for Gemini)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key
```

**Server Configuration**:
```bash
GRPC_PORT=50051                  # gRPC server port
LOG_LEVEL=info                    # Logging level (debug, info, warn, error)
NODE_ENV=production               # Environment (development, production)
```

## Configuration

### Model Groups

Model groups organize related models with automatic selection based on scoring preferences. Configure model groups in the `brk_routing.model_group` table:

```sql
INSERT INTO brk_routing.model_group (name, description) 
VALUES ('production-gpt4', 'Production GPT-4 deployments');
```

Add resources (deployed models) to the group:

```sql
INSERT INTO brk_routing.model_group_resource (model_group_id, deployed_model_id, intelligence_weight, cost_weight)
VALUES (1, 5, 0.7, 0.3);
```

### Selection Strategies

The broker supports pluggable selection strategies. The default `CostIntelligenceStrategy` calculates scores as:

```
score = (intelligence/10 × intelligence_weight) + (cost/10 × cost_weight)
```

Configure weights in the request or use model group defaults. Higher scores are preferred.

### SSL Configuration

PostgreSQL SSL settings:

```bash
PGF_SSL_ENABLED=true                     # Enable SSL (default: true)
PGF_SSL_REJECT_UNAUTHORIZED=true         # Validate certificates (default: true)
NODE_ENV=prod                            # Forces SSL in production
```

## Version and Maturity

- **Current Version**: 5.2.7
- **Status**: GA (General Availability) - Production-ready
- **Node.js Version**: 18+ required
- **Protocol Buffers**: Using ts-proto for TypeScript code generation
- **gRPC Framework**: nice-grpc for modern async/await support

## Repository

**Source Code**: [github.com/firebrandanalytics/ff_broker](https://github.com/firebrandanalytics/ts_template) (private repository)

## Related Documentation

### Platform Documentation

- [Platform Architecture](../architecture.md) - Overview of FireFoundry platform architecture
- [Platform README](../README.md) - Platform components and service endpoints
- [Deployment Guide](../deployment.md) - Production deployment procedures
- [Operations Guide](../operations.md) - Platform operations and maintenance

### Developer Resources

- [Agent SDK Documentation](../../sdk/README.md) - Building agents that use the broker
- [Context Service Guide](./context-service.md) - Working memory and persistence (complement to broker)
- [Local Development Setup](../../local-development/README.md) - Running the broker locally

### Internal Documentation (in repository)

- [Provider Architecture](https://github.com/firebrandanalytics/ff_broker/blob/main/src/providers/core/README.md) - Adding new providers
- [Model Selection Guide](https://github.com/firebrandanalytics/ff_broker/blob/main/src/model-selection/README.new.md) - Selection strategies
- [Database Schema Documentation](https://github.com/firebrandanalytics/ff_broker/blob/main/src/db/README.md) - Database layer details
- [FDW Setup Guide](https://github.com/firebrandanalytics/ff_broker/blob/main/src/db/FDW_GUIDE.md) - Foreign Data Wrapper configuration

## Usage Examples

### Example 1: Chat Completion with Automatic Model Selection

An agent bundle sends a chat completion request to the broker, which automatically selects the best model from the "production" model pool based on cost and intelligence preferences:

```typescript
// Agent code (using FF Broker client)
const response = await brokerClient.createBrokeredCompletionStream({
  modelPool: "production",
  model: "gpt-4",  // Hint, not strict requirement
  semanticLabel: "customer_support_query",
  messages: [
    { role: "system", content: "You are a helpful customer support agent." },
    { role: "user", content: "How do I reset my password?" }
  ],
  modelSelectionCriteria: {
    costSensitivity: 0.3,      // 30% weight on cost
    qualitySensitivity: 0.7     // 70% weight on quality/intelligence
  }
});

// Broker internally:
// 1. Loads "production" model pool from database
// 2. Filters models capable of chat completion
// 3. Scores each model: score = (intelligence/10 × 0.7) + (cost/10 × 0.3)
// 4. Selects highest-scoring model (e.g., gpt-4-turbo on Azure)
// 5. Routes request to that provider
// 6. Streams response back to agent
```

### Example 2: Embeddings with Failover

An agent generates embeddings for semantic search. If the primary embedding model fails, the broker automatically fails over to a backup:

```typescript
// Agent code
const embeddings = await brokerClient.createBrokeredEmbedding({
  modelGroupId: 4,  // "embedding-production" group
  embeddingRequest: {
    model: "text-embedding-3-large",
    input: "FireFoundry is an AI agent platform"
  },
  scorePreference: {
    intelligenceWeight: 0.5,
    costWeight: 0.5
  }
});

// Broker internally:
// 1. Loads model group 4 with resources:
//    - Azure OpenAI text-embedding-3-large (primary)
//    - OpenAI text-embedding-3-large (failover)
// 2. Attempts request with highest-scored resource
// 3. If Azure request fails (rate limit, timeout, etc.):
//    a. Logs failure to brk_tracking
//    b. Failover policy selects OpenAI deployment
//    c. Retries with failover resource
// 4. Returns embeddings to agent
// 5. Records metrics (latency, tokens, provider used)
```

These examples demonstrate how the broker abstracts provider complexity from agent developers while ensuring reliability and cost optimization.
