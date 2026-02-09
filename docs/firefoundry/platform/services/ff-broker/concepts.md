# FF Broker — Concepts

This page explains the core concepts that underpin the FF Broker's model orchestration, provider management, and request routing.

## Model Groups

A **model group** is a named collection of model deployments that can serve the same type of request. When an agent sends a request to the broker, it specifies a **model pool** name (which maps to a model group), and the broker selects the best deployment from that group.

### Why Model Groups?

Model groups decouple agent logic from specific model deployments:
- An agent requests "production" quality, not "gpt-4-turbo on Azure East US"
- The broker can add, remove, or rebalance deployments without changing agent code
- Failover happens automatically within the group

### Model Group Structure

```
Model Group: "production-gpt4"
├── Resource 1: gpt-4-turbo (Azure East US)
│   ├── intelligence_weight: 9
│   ├── cost_weight: 6
│   └── provider: Azure OpenAI
├── Resource 2: gpt-4-turbo (Azure West US)
│   ├── intelligence_weight: 9
│   ├── cost_weight: 6
│   └── provider: Azure OpenAI
└── Resource 3: gpt-4 (OpenAI Direct)
    ├── intelligence_weight: 9
    ├── cost_weight: 7
    └── provider: OpenAI
```

Each resource in a model group has:
- A **deployed model** (specific model version on a specific provider)
- **Intelligence weight** (1-10): How capable the model is
- **Cost weight** (1-10): Relative cost per token (lower = cheaper)
- **Provider account**: Authentication credentials for the provider

## Selection Strategies

When multiple models are available in a group, the broker uses a **selection strategy** to pick the best one for each request.

### CostIntelligenceStrategy (Default)

The default strategy scores each resource using a weighted formula:

```
score = (intelligence/10 × intelligence_weight) + (cost/10 × cost_weight)
```

Where `intelligence_weight` and `cost_weight` come from the request's `modelSelectionCriteria`:
- Higher `qualitySensitivity` → prefer more capable models
- Higher `costSensitivity` → prefer cheaper models

The resource with the highest score wins.

### Performance-Aware Selection

When the `PERFORMANCE_ROUTING` feature flag is enabled, the broker adjusts scores based on real-time performance data:
- Deployments with elevated error rates get score penalties
- Deployments with high latency get score penalties
- Degraded deployments may be excluded entirely

See [Industrial Subsystems — Performance Routing](./industrial.md#performance-routing) for details.

## Failover Policy

The **ProviderFailoverPolicy** handles failures automatically. When a request to the selected provider fails:

1. The error is classified (rate limit, timeout, server error, auth failure, etc.)
2. If the error is retryable, the failover policy selects the next-best resource from the group
3. The request is retried with the new provider
4. If all resources are exhausted, the error is returned to the client

### Failover Behavior by Error Type

| Error Type | Behavior |
|-----------|----------|
| Rate limit (429) | Failover to next resource |
| Timeout | Failover to next resource |
| Server error (5xx) | Failover to next resource |
| Auth failure (401/403) | Failover to next resource |
| Invalid request (400) | Return error to client (no retry) |
| Content filter | Return error to client (no retry) |

## Provider Architecture

The broker uses a factory-based provider architecture with clear separation of concerns.

### Provider Types

| Type | Description | Examples |
|------|-------------|---------|
| **Completion** | Chat completion with streaming | Azure OpenAI GPT, Gemini, Grok |
| **Embedding** | Text-to-vector embeddings | Azure OpenAI Text Embedding |
| **Image Generation** | Text-to-image with blob storage | OpenAI GPT Image, Gemini Image |

### Provider Lifecycle

```
Request arrives
    │
    ▼
ProviderFactoryRegistry
    │ (selects factory by ModelType)
    ▼
CompletionProviderFactory / EmbeddingProviderFactory / ImageGenerationProviderFactory
    │ (creates or retrieves cached provider)
    ▼
ModelProviderRegistry
    │ (caches instances with TTL)
    ▼
Concrete Provider (e.g., OpenAI_GPT_Provider)
    │ (executes request via ProviderClientFactory)
    ▼
External API (Azure, OpenAI, Google, xAI)
```

### Provider Dependencies

All providers receive a shared `ProviderDependencies` object:

- **ErrorHandler**: Maps provider-specific errors to gRPC status codes
- **CredentialResolver**: Resolves API keys from the database
- **ProviderClientFactory**: Creates HTTP/gRPC clients for external APIs
- **DatabaseConfigManager**: Loads deployment configurations from the database
- **McpRegistryService**: (Optional) MCP tool integration
- **McpExecutionService**: (Optional) MCP tool execution

## Semantic Labels

A **semantic label** is a string tag that describes the purpose of a request (e.g., `"customer_support_query"`, `"code_generation"`, `"document_summary"`). Semantic labels are used by several industrial subsystems:

- **Output Prediction**: Learns expected output token counts per label
- **Usage Profiling**: Tracks request patterns per label over time
- **Priority Routing**: Can map labels to priority tiers

Semantic labels are optional but recommended for production workloads. They enable the broker to make smarter decisions without requiring per-request configuration.

## Request Tracking

Every request through the broker is tracked with comprehensive telemetry:

### Tracked Metrics

| Metric | Description |
|--------|-------------|
| `broker_request_id` | Unique ID for the broker request |
| `model_pool` | Model group used |
| `selected_model` | Actual model selected |
| `provider` | Provider that served the request |
| `input_tokens` | Tokens in the prompt |
| `output_tokens` | Tokens in the response |
| `total_tokens` | Total tokens consumed |
| `latency_ms` | End-to-end latency |
| `ttft_ms` | Time to first token (streaming) |
| `status` | Success/failure status |
| `error_code` | gRPC error code if failed |
| `semantic_label` | Request semantic label |
| `breadcrumbs` | Correlation IDs from the client |

### Breadcrumbs

Breadcrumbs are correlation IDs passed by the client that link broker requests back to the originating agent, entity, and user. They enable end-to-end tracing across the platform.

## Streaming

The broker uses **async generators** for streaming responses. When a client requests a streaming completion:

1. The broker opens a stream to the selected provider
2. Each token chunk is yielded back to the client as it arrives
3. If stream instrumentation is enabled, metrics are collected per-chunk (TTFT, throughput, token counts)
4. On completion, final metrics are recorded to the tracking service

### PullChain Pipeline (Industrial)

When stream instrumentation is enabled, the broker wraps the provider's async generator in a **PullChain** — a composable pipeline that adds metrics collection without modifying the provider code:

```
Provider Stream → Turnstile (concurrency) → TTFT Timer → Token Counter → Client
```

See [Industrial Subsystems — Stream Instrumentation](./industrial.md#stream-instrumentation) for details.

## Database Configuration

The broker's behavior is primarily configured through the database, not environment variables. This enables runtime reconfiguration without restarts.

### Configuration Hierarchy

```
brk_registry (global)
├── Models: Available model definitions
├── Providers: Provider metadata (Azure, OpenAI, etc.)
└── Capabilities: What each model supports

brk_customer (per-instance)
├── Customer accounts
├── Provider accounts (API keys)
└── Deployed models (model + provider + endpoint)

brk_routing (per-instance)
├── Model groups (named collections)
├── Model group resources (model → group mapping)
└── Selection strategy configurations

brk_tracking (per-instance)
├── Completion requests (telemetry)
└── Completion metrics (aggregated stats)
```

The **DatabaseConfigManager** loads and caches this configuration, refreshing periodically or on demand via the HTTP admin API.
