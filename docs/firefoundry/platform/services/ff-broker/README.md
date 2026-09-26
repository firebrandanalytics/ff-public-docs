# FF Broker Service

## Overview

The FF Broker is the service your agent bundle calls whenever it needs a model: chat completions (streaming or not), structured JSON output, tool calls, embeddings, or image generation. Instead of calling OpenAI, Azure OpenAI, Google Gemini, Anthropic, or xAI directly, your code names a **model pool**, and the broker picks a concrete model deployment from that pool, calls the provider, fails over to another deployment if the call fails, and records the call for telemetry.

## Purpose and Role in Platform

The broker sits between your agent bundle and the AI model providers. For an app builder this means:

- **No provider code in your bundle** — bots and services reference a model pool name (for example `gemini_completion`), not a provider SDK, endpoint, or API key.
- **Swap models without redeploying** — the environment's model pool configuration decides which model serves a request. Change the pool, and every bot that uses it picks up the change.
- **Built-in failover** — a pool with more than one deployment retries rate-limited or failing calls on another deployment before your code sees an error.
- **Observability for free** — every call is recorded with token usage, latency, the model that served it, your semantic label, and your breadcrumbs, and is visible through the [Telemetry Service](../telemetry-service/README.md) and the FireFoundry Console.

Most bundles never talk to the broker directly: the Agent SDK's bots use it under the hood. You use the broker client directly for embeddings, image generation, or ad-hoc calls outside a bot.

## Key Features

- **Model pools** — named groups of model deployments that your code references by name
- **Multi-provider** — Azure OpenAI, OpenAI, Google Gemini (AI Studio and Vertex AI), Anthropic Claude, and xAI Grok behind one API
- **Failover** — retryable provider errors (rate limits, timeouts, 5xx) are retried on another deployment in the pool
- **Cost/quality selection** — requests can express a preference for more capable or cheaper models within a pool
- **Streaming** — token-by-token streaming for chat completions
- **Structured output and tools** — JSON-schema-constrained responses and tool/function calling
- **Embeddings** — single and batch embedding generation
- **Image generation** — OpenAI GPT Image and Gemini image models; generated images are stored in blob storage and returned by reference
- **Request tracking** — semantic labels and breadcrumbs attach your app's context to every call
- **Mock cache** — deterministic cached responses for repeatable integration tests

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Your agent bundle                                          │
│   Bots (model_pool_name)  |  SimplifiedBrokerClient  |      │
│   ff-brk CLI (testing)                                      │
└──────────────────────────┬─────────────────────────────────┘
                           │ gRPC (port 50051)
┌──────────────────────────▼─────────────────────────────────┐
│  FF Broker                                                  │
│   model pool → deployment selection → failover              │
└──────┬───────────────────┬───────────────────────┬─────────┘
       │                   │                       │
┌──────▼───────┐   ┌───────▼────────┐     ┌────────▼────────┐
│ AI providers │   │ Telemetry /    │     │ Blob storage    │
│ OpenAI, Azure│   │ FF Console     │     │ (generated      │
│ Gemini, xAI, │   │ (call history) │     │  images)        │
│ Anthropic    │   └────────────────┘     └─────────────────┘
└──────────────┘
```

Model pools and provider credentials are configured per environment with `ff-cli env broker-config` and `ff-cli env broker-secret` (or the broker's configuration API). Your bundle only needs the broker's host and port.

### What happens on a call

1. Your bot or client sends a request naming a model pool (plus an optional semantic label and breadcrumbs).
2. The broker selects a deployment from the pool, weighing capability and cost.
3. The provider is called; streaming responses are forwarded chunk by chunk.
4. If the call fails with a retryable error, the broker tries another deployment in the pool.
5. The call is recorded for telemetry, and the response (or a gRPC error) is returned to your code.

## Documentation

- **[Concepts](./concepts.md)** — Model pools, selection and failover, semantic labels, breadcrumbs, streaming, and how to design your app around them
- **[Getting Started](./getting-started.md)** — Configure a model pool and call it from a bot, the broker client, and `ff-brk`
- **[Reference](./reference.md)** — gRPC request/response fields, configuration API, client settings, error codes
- **[Operations](./operations.md)** — Enabling and configuring the broker for your app, verifying it, limits, and troubleshooting

## Version and Maturity

- **Service version**: 6.5.0 (ff-broker Helm chart 3.12.0)
- **Maturity**: Core platform service, enabled by default in `firefoundry-core`. Required by any bundle that calls LLMs.
- Advanced capacity and routing features (capacity limits, QoS tiers, sticky routing, quotas) are off by default and enabled per environment by your environment administrator; see [Concepts — Environment-level routing features](./concepts.md#environment-level-routing-features).

## Repository

**Source Code**: [github.com/firebrandanalytics/ff_broker](https://github.com/firebrandanalytics/ff_broker) (private repository)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK Documentation](../../../sdk/agent_sdk/README.md) — Building agents that use the broker
- [Bots](../../../sdk/agent_sdk/core/bots.md) — How bots call the broker
- [ff-brk CLI](../../../sdk/cli-tools/ff-brk.md) — Send test completions to the broker
- [Telemetry Service](../telemetry-service/README.md) — Inspect broker calls
- [Context Service](../context-service/README.md) — Working memory and persistence
