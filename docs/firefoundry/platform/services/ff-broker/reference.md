# FF Broker — Reference

Complete API reference for the FF Broker including gRPC services, REST endpoints, protocol buffer messages, environment variables, and error codes.

## gRPC Services

### CompletionBrokerService

**Package**: `firebrand.ff.completion.broker.v1`

#### CreateBrokeredCompletionStream

Streaming chat completion with automatic model selection and failover.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelPool` | string | Yes | Name of the model group to use |
| `model` | string | No | Model hint (not a strict requirement) |
| `semanticLabel` | string | No | Semantic label for request categorization |
| `messages` | Message[] | Yes | Chat messages (system, user, assistant) |
| `temperature` | float | No | Sampling temperature (0.0-2.0) |
| `maxTokens` | int32 | No | Maximum tokens in response |
| `topP` | float | No | Nucleus sampling parameter |
| `frequencyPenalty` | float | No | Frequency penalty (-2.0 to 2.0) |
| `presencePenalty` | float | No | Presence penalty (-2.0 to 2.0) |
| `stop` | string[] | No | Stop sequences |
| `responseFormat` | ResponseFormat | No | Structured output schema |
| `tools` | Tool[] | No | Available tools/functions |
| `toolChoice` | ToolChoice | No | Tool selection strategy |
| `modelSelectionCriteria` | SelectionCriteria | No | Cost/intelligence weighting |
| `breadcrumbs` | Breadcrumb[] | No | Correlation IDs for tracing |
| `id` | string | No | Client-provided request ID |

**Response**: Stream of `CompletionChunk`

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

Single text embedding with model group selection.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelGroupId` | int32 | Yes | Model group ID |
| `embeddingRequest` | EmbeddingRequest | Yes | Model and input text |
| `scorePreference` | ScorePreference | No | Intelligence/cost weighting |

**Response**: `EmbeddingResponse`

| Field | Type | Description |
|-------|------|-------------|
| `embedding` | float[] | Vector embedding |
| `model` | string | Model used |
| `usage` | Usage | Token usage |

#### CreateBrokeredBatchEmbedding

Batch embedding for multiple inputs.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelGroupId` | int32 | Yes | Model group ID |
| `inputs` | string[] | Yes | Text inputs |
| `scorePreference` | ScorePreference | No | Intelligence/cost weighting |

**Response**: `BatchEmbeddingResponse` with array of embeddings.

### ImageGenerationBrokerService

**Package**: `firebrand.ff.image.broker.v1`

#### CreateBrokeredImageGeneration

Image generation with blob storage integration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelPool` | string | Yes | Model group for image generation |
| `prompt` | string | Yes | Image generation prompt |
| `size` | string | No | Image dimensions (e.g., "1024x1024") |
| `quality` | string | No | Quality level ("standard", "hd") |
| `n` | int32 | No | Number of images to generate |

## REST API (HTTP Config Server)

The HTTP Config Server provides REST endpoints for broker configuration management. Default port: `3000`.

### Customer Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/customer` | List all customers |
| POST | `/api/customer` | Create a customer |
| GET | `/api/customer/:id` | Get customer by ID |
| PUT | `/api/customer/:id` | Update customer |
| DELETE | `/api/customer/:id` | Delete customer |
| GET | `/api/customer/provider-accounts` | List provider accounts |
| POST | `/api/customer/provider-accounts` | Create provider account |
| GET | `/api/customer/deployed-models` | List deployed models |
| POST | `/api/customer/deployed-models` | Register deployed model |

### Routing Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/routing/model-groups` | List model groups |
| POST | `/api/routing/model-groups` | Create model group |
| GET | `/api/routing/model-groups/:id` | Get model group details |
| PUT | `/api/routing/model-groups/:id` | Update model group |
| DELETE | `/api/routing/model-groups/:id` | Delete model group |
| GET | `/api/routing/model-groups/:id/resources` | List group resources |
| POST | `/api/routing/model-groups/:id/resources` | Add resource to group |
| DELETE | `/api/routing/model-groups/:id/resources/:resourceId` | Remove resource |

### Registry Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/registry/models` | List all models in registry |
| GET | `/api/registry/providers` | List all providers |
| GET | `/api/registry/capabilities` | List model capabilities |

### MCP Endpoints (Optional)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mcp/servers` | List registered MCP servers |
| GET | `/api/mcp/tools` | List available MCP tools |
| POST | `/api/mcp/tools/:toolName/execute` | Execute an MCP tool |

### Industrial Endpoints

See [Operations — Admin API](./operations.md#admin-api-endpoints) for the full industrial endpoint reference.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/industrial/status` | Overall industrial status |
| GET | `/api/industrial/flags` | Feature flag states |
| PUT | `/api/industrial/flags/:flag` | Override a feature flag |
| DELETE | `/api/industrial/flags/:flag` | Clear flag override |
| POST | `/api/industrial/flags/bulk` | Bulk override flags |
| GET | `/api/industrial/capacity` | Aggregate capacity stats |
| GET | `/api/industrial/performance` | Performance metrics |
| GET | `/api/industrial/usage` | Usage pattern profiles |
| GET | `/api/industrial/qos` | QoS tier definitions |
| GET | `/api/industrial/ptu` | PTU deployment registry |

### Health Endpoint

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

## Environment Variables

### Database Configuration

```bash
# Core Database (required)
CORE_DATABASE_URL=postgresql://user:password@host:5432/ff_core
# Or use individual variables:
PGF_HOST=core-host
PGF_PORT=5432
PGF_DATABASE=ff_core
PGF_USER=core_user
PGF_PWD=core_password

# Registry Database (optional - for registry maintenance)
REGISTRY_DATABASE_URL=postgresql://user:password@host:5432/ff_registry
PGF_REGISTRY_HOST=registry-host
PGF_REGISTRY_PORT=5432
PGF_REGISTRY_DATABASE=ff_registry
PGF_REGISTRY_USER=registry_user
PGF_REGISTRY_PWD=registry_password

# SSL Configuration
PGF_SSL_ENABLED=true                     # Enable SSL (default: true)
PGF_SSL_REJECT_UNAUTHORIZED=true         # Validate certificates
```

### Server Configuration

```bash
GRPC_PORT=50051                  # gRPC server port (default: 50051)
HTTP_CONFIG_PORT=3000            # HTTP config server port (default: 3000)
LOG_LEVEL=info                   # Logging level: debug, info, warn, error
NODE_ENV=production              # Environment: development, production
```

### Provider API Keys

```bash
# Azure OpenAI
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com

# OpenAI Direct
OPENAI_API_KEY=your_openai_key

# Google Cloud (Gemini)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# Or for AI Studio:
GOOGLE_AI_STUDIO_API_KEY=your_api_key

# xAI (Grok)
XAI_API_KEY=your_xai_key

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key
```

### Feature Flags

All feature flags use the prefix `BROKER_FF_` and accept `true`/`1` to enable, `false`/`0`/absent to disable.

```bash
BROKER_FF_CAPACITY_GATING=false          # Per-deployment concurrency gating
BROKER_FF_STREAM_INSTRUMENTATION=false   # PullChain stream metrics
BROKER_FF_COMPILED_CHAIN=false           # Compiled PullChain optimization
BROKER_FF_PERFORMANCE_ROUTING=false      # Performance-aware model selection
BROKER_FF_QOS_SWITCHING=false            # Per-request QoS tiering
BROKER_FF_PRIORITY_ROUTING=false         # Priority-based request routing
BROKER_FF_STICKY_ROUTING=false           # Session-to-deployment affinity
BROKER_FF_QUOTA_ENFORCEMENT=false        # Hierarchical quota management
BROKER_FF_OUTPUT_PREDICTION=false        # Output token prediction
```

### Blob Storage (Image Generation)

```bash
# Azure Blob Storage
WORKING_MEMORY_STORAGE_ACCOUNT=yourstorageaccount
WORKING_MEMORY_STORAGE_KEY=your-access-key
WORKING_MEMORY_STORAGE_CONTAINER=your-container

# Google Cloud Storage
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
WORKING_MEMORY_STORAGE_CONTAINER=your-bucket-name
```

## Error Codes

The broker maps provider errors to gRPC status codes:

| gRPC Status | Code | Description |
|-------------|------|-------------|
| `OK` | 0 | Request completed successfully |
| `CANCELLED` | 1 | Request was cancelled by the client |
| `INVALID_ARGUMENT` | 3 | Invalid request parameters |
| `NOT_FOUND` | 5 | Model group or resource not found |
| `ALREADY_EXISTS` | 6 | Duplicate resource |
| `PERMISSION_DENIED` | 7 | Authentication failed |
| `RESOURCE_EXHAUSTED` | 8 | Rate limit or quota exceeded |
| `FAILED_PRECONDITION` | 9 | Capacity gate rejected request |
| `ABORTED` | 10 | Request aborted (content filter) |
| `INTERNAL` | 13 | Internal broker error |
| `UNAVAILABLE` | 14 | Provider temporarily unavailable |
| `DATA_LOSS` | 15 | Stream corruption detected |

## Database Schemas

### brk_customer

| Table | Description |
|-------|-------------|
| `customer` | Customer organizations |
| `provider_account` | API credentials per customer per provider |
| `deployed_model` | Model deployments with endpoints |

### brk_routing

| Table | Description |
|-------|-------------|
| `model_group` | Named model pools |
| `model_group_resource` | Model-to-group mappings with weights |
| `selection_strategy` | Strategy configurations per group |
| `failover_config` | Failover policies |

### brk_tracking

| Table | Description |
|-------|-------------|
| `completion_request` | Request telemetry records |
| `completion_metrics` | Aggregated performance metrics |

### brk_registry (FDW)

| Table | Description |
|-------|-------------|
| `model` | Global model definitions |
| `provider` | Provider metadata |
| `capability` | Model capabilities |
| `model_family` | Model family groupings |

## Version Information

- **Current Version**: 5.2.7
- **Status**: GA (General Availability) with industrial-scale features in beta
- **Node.js Version**: 18+ required
- **Protocol Buffers**: ts-proto for TypeScript code generation
- **gRPC Framework**: nice-grpc for async/await support
- **ORM**: Drizzle ORM with PostgreSQL

## Repository

**Source Code**: [github.com/firebrandanalytics/ff_broker](https://github.com/firebrandanalytics/ff_broker) (private repository)
