# FF Broker Service

## Overview

The FF Broker is a high-performance gRPC service that acts as an intelligent middleware layer for AI model orchestration. It provides automatic model selection, load balancing, and failover capabilities across multiple AI providers including Azure OpenAI, OpenAI, Google Gemini, xAI, and Anthropic Claude. The broker optimizes requests based on cost/intelligence scoring while ensuring reliability through built-in failover policies and comprehensive request tracking.

## Purpose and Role in Platform

The FF Broker serves as the central routing hub in the FireFoundry platform, sitting between agent bundles and AI model providers. When an agent needs to generate text, embeddings, images, or structured outputs, it sends requests to the broker rather than directly to providers. The broker then:

- Selects the optimal model based on intelligence, cost, and performance scoring
- Routes requests to the appropriate provider deployment
- Handles failures gracefully with automatic failover
- Tracks all requests for observability and cost monitoring
- Manages provider authentication and API key rotation
- Enforces capacity limits and quota policies
- Provides QoS tiering for priority workloads

This abstraction allows agent developers to focus on agent logic rather than model selection, provider management, and failure handling.

## Key Features

- **Intelligent Model Selection**: Automatic model selection using weighted scoring across intelligence, cost, and performance dimensions
- **Multi-Provider Support**: Native support for Azure OpenAI, OpenAI, Google Gemini, Anthropic Claude, and xAI models
- **Failover and Load Balancing**: Automatic failover between model deployments with configurable failover policies
- **Streaming Support**: Real-time streaming responses for chat completions with full token-by-token streaming
- **Structured Output**: JSON schema-constrained responses with native provider support where available
- **Embedding Generation**: Single and batch embedding operations with model group management
- **Image Generation**: Multi-provider image generation with blob storage integration (OpenAI GPT Image, Gemini)
- **Cost Optimization**: Weighted scoring algorithm to balance cost, intelligence, and performance requirements
- **Request Tracking**: Comprehensive telemetry with request/response logging, breadcrumbs, and correlation IDs
- **Provider Registry**: Factory-based provider instantiation with caching, TTL expiration, and health monitoring
- **Model Context Protocol (MCP)**: Integration with MCP for advanced tool capabilities

### Industrial-Scale Features (Feature-Flagged)

The broker includes 12 production-grade subsystems for industrial-scale operations, all controlled by feature flags for gradual rollout:

- **Capacity Gating**: Per-deployment concurrency limits with real-time admission control
- **Stream Instrumentation**: PullChain pipeline with TTFT, throughput, and token metrics
- **Performance Routing**: Rolling-window latency tracking with degradation detection
- **QoS Tiering**: 4-tier quality-of-service (Economy/Standard/Premium/Critical) with resource filtering
- **Sticky Routing**: Session-to-deployment affinity for prompt cache optimization
- **Priority Routing**: Load-threshold-activated priority queues
- **Quota Enforcement**: Hierarchical TPM/RPM quota management
- **Output Prediction**: EWMA-based output token estimation from semantic labels
- **Usage Profiling**: 168-slot weekly usage profiles with anomaly detection
- **PTU Advisory**: Provisioned Throughput Unit capacity analysis and scale recommendations

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                            │
│          Agent Bundles  |  SDK  |  Direct gRPC               │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                   gRPC Service Layer                         │
│  CompletionBrokerService | EmbeddingBrokerService            │
│                | ImageGenerationBrokerService                │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│               Industrial Subsystems (Feature-Flagged)        │
│  Capacity Gate → QoS Tier → Priority Queue → Quota Check     │
│  Sticky Routing → Performance Score → Output Prediction      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                Model Selection Layer                         │
│  ModelSelectorManager → CostIntelligenceStrategy             │
│  ModelProviderRegistry → ProviderFactoryRegistry             │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  Provider Layer                               │
│  Azure OpenAI | OpenAI Direct | Google Gemini | xAI Grok     │
│  CredentialResolver → ProviderClientFactory                  │
│  FailoverPolicy → ErrorHandler                               │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│               Tracking & Persistence                         │
│  TrackingService → PostgreSQL (brk_tracking schema)          │
│  BlobStorage → Azure Blob / GCS (image generation)           │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **gRPC Request Arrives**: Client (agent bundle) sends a completion, embedding, or image generation request
2. **Industrial Checks** (if enabled): Capacity gating, QoS tier resolution, priority routing, quota enforcement
3. **Model Selection**: `ModelSelectorManager` loads the appropriate model group configuration from the database
4. **Strategy Selection**: `CostIntelligenceStrategy` calculates weighted scores for available resources
5. **Sticky Routing** (if enabled): Checks for session-to-deployment affinity
6. **Provider Instantiation**: `ProviderFactory` creates or retrieves a cached provider instance
7. **Request Execution**: Provider executes the request against the external API
8. **Stream Instrumentation** (if enabled): PullChain measures TTFT, throughput, and token counts
9. **Failover Handling**: If the request fails, `FailoverPolicy` selects an alternative resource
10. **Response Tracking**: `TrackingService` records metrics (tokens, latency, cost) to the database
11. **Post-Request**: Usage pattern collection, sticky routing recording, performance tracking

### Database Architecture

The broker uses a dual-database architecture with Foreign Data Wrapper (FDW) integration:

- **Registry Database** (`brk_registry` schema): Global model catalog shared across broker instances (models, providers, capabilities)
- **Core Database** (four schemas):
  - `brk_registry` (FDW foreign tables): Remote access to registry database without data duplication
  - `brk_customer`: Customer-specific model deployments and API credentials
  - `brk_routing`: Model groups, selection strategies, and failover configurations
  - `brk_tracking`: Request logs, completion metrics, and provider performance data

This architecture enables centralized model management while maintaining instance-specific configuration and telemetry.

## What's New

### Industrial-Scale Upgrade (feat/industrial-scale)

Major upgrade adding 12 subsystems for production-grade capacity management, intelligent routing, QoS tiering, and PTU advisory. All subsystems are feature-flagged for gradual rollout and instant rollback.

See [Industrial Subsystems](./industrial.md) for full documentation.

### Image Generation Support

Added multi-provider image generation with streaming support:
- OpenAI GPT Image 1.5
- Google Gemini image generation (Gemini 2.5 Flash, Gemini 3 Pro)
- Blob storage integration for generated images

### Multi-Provider Expansion

- **xAI Grok**: Added Grok provider for xAI model access
- **Google Gemini**: Native Google AI Studio integration (in addition to Vertex AI)
- **MCP Integration**: Model Context Protocol support for advanced tool capabilities

## Documentation

- **[Concepts](./concepts.md)** — Core concepts: model groups, selection strategies, failover, provider architecture
- **[Getting Started](./getting-started.md)** — Step-by-step tutorial from first request to production configuration
- **[Reference](./reference.md)** — API reference: gRPC services, REST endpoints, proto messages, env vars
- **[Industrial Subsystems](./industrial.md)** — Industrial-scale features: capacity, QoS, routing, quotas, PTU
- **[Operations](./operations.md)** — Operations guide: feature flags, admin APIs, monitoring, rollout planning

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK Documentation](../../../sdk/README.md) — Building agents that use the broker
- [Context Service](../context-service.md) — Working memory and persistence
