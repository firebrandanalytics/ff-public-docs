# FireFoundry Platform

Platform architecture, deployment, and operations documentation for FireFoundry environments.

## Contents

- **[Platform Services](./services/README.md)** — Catalog of services running in a FireFoundry environment, with links to detailed per-service documentation
- **[System Agents](./system-agents/README.md)** — Pre-built agent bundles that ship with the platform (web search, RAG, structured extraction, and more)
- **[Architecture](./architecture.md)** — Platform architecture and design
- **[Deployment](./deployment.md)** — Deploying FireFoundry environments
- **[Operations](./operations.md)** — Day-to-day operations, monitoring, and troubleshooting

## Overview

A FireFoundry environment is composed of a set of platform services running on Kubernetes, backed by PostgreSQL and blob storage, with traffic routed through Kong Gateway. Agent bundles you build run alongside these services and call them through well-defined gRPC or REST APIs.

The platform services are documented in detail in the [Platform Services](./services/README.md) catalog — start there for service-by-service references, links to per-service docs, and protocol information.

Alongside the services, FireFoundry ships a set of [System Agents](./system-agents/README.md) — pre-built agent bundles you can call directly for common tasks like web search, structured extraction, and retrieval-augmented generation.

## Related Documentation

- **[FireFoundry Platform Overview](../README.md)** — High-level platform summary
- [Local Development](../local-development/README.md) — Running platform locally
- [Getting Started](../getting-started/README.md) — Quick start guide
- [Agent SDK](../sdk/agent_sdk/README.md) — Building agent bundles

