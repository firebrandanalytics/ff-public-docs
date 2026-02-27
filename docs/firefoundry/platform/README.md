# FireFoundry Platform

Platform architecture, deployment, and operations documentation.

## Contents

- [Platform Services](./services/README.md) - Comprehensive microservices overview
- [Architecture](./architecture.md) - Platform architecture and design
- [Deployment](./deployment.md) - Production deployment guide
- [Operations](./operations.md) - Platform operations and maintenance

## Overview

The FireFoundry platform consists of:

- **Kubernetes Runtime**: Microservices hosting specialized AI services
- **Platform Services**: Specialized microservices (Broker, Context Service, Code Sandbox, and extended services)
- **Infrastructure**: PostgreSQL, blob storage, Kong Gateway
- **Supporting Services**: Monitoring, logging, auto-scaling

## Platform Services

FireFoundry provides 8 specialized microservices organized by maturity:

### Tier 1 - Core Runtime (GA)
- **[Broker Service](./services/ff-broker.md)** - AI model routing and orchestration
- **[Context Service](./services/context-service/README.md)** - Working memory and blob storage
- **[Code Sandbox](./services/code-sandbox.md)** - Secure code execution

### Tier 2 - Extended Services (Beta)
- **[Entity Service](./services/entity-service.md)** - Entity graph management with vector search
- **[Data Access Service](./services/data-access-service.md)** - Multi-database SQL access with AST query translation
- **[Document Processing Service](./services/doc-proc-service.md)** - Document extraction and transformation

### Tier 3 - Supporting Services
- **[Document Processing Python Worker](./services/doc-proc-pyworker.md)** - Advanced ML-based processing
- **[Web Search Service](./services/web-search.md)** - Provider-agnostic web search with Bing integration

**For detailed service documentation, architecture, communication patterns, and deployment guidance, see the [Platform Services Overview](./services/README.md).**

## Infrastructure Components

- **PostgreSQL**: Entity graph and metadata storage
- **Blob Storage**: Binary artifacts and working memory data
- **Kong Gateway**: API management and security
- **Monitoring**: Application-aware monitoring and tracing

## Documentation

- **[Platform Services Overview](./services/README.md)** - Complete services reference, communication patterns, and data flows
- **[Individual Service Documentation](./services/)** - Detailed documentation for each microservice
- [Architecture](./architecture.md) - Detailed architecture documentation
- [Deployment](./deployment.md) - Deployment procedures and best practices
- [Operations](./operations.md) - Day-to-day operations, monitoring, and troubleshooting

## Related Documentation

- **[FireFoundry Platform Overview](../README.md)** - High-level platform summary
- [Local Development](../local-development/README.md) - Running platform locally
- [Getting Started](../getting-started/README.md) - Quick start guide
- [Agent SDK](../sdk/agent_sdk/README.md) - Building agent bundles

