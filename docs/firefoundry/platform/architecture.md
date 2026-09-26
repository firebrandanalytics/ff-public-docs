# Architecture Overview

FireFoundry uses a **multi-namespace architecture** designed for operational excellence and clear separation of concerns.

## Core Services Namespace (`ff-dev`)

Contains the runtime services that power your AI agents:

- **ff-broker**: Routes requests between different LLM providers and manages model selection
- **context-service**: Handles conversation context, memory, and information retrieval
- **code-sandbox**: Provides secure, isolated environments for agent code execution

## Control Plane Namespace (`ff-control-plane`)

Contains the infrastructure services that support development and deployment:

- **Concourse**: CI/CD pipelines optimized for agent bundle testing and deployment
- **Harbor**: Enterprise-grade container registry with security scanning
- **ff-console**: Web-based management interface for monitoring and debugging agents

## Benefits of This Separation

This separation allows you to:

- **Develop faster**: Deploy only core services for rapid iteration
- **Scale independently**: Control plane and runtime services can scale based on different needs
- **Maintain security**: Keep infrastructure services isolated from runtime workloads
- **Debug effectively**: Troubleshoot issues in isolation without affecting other components

## Service Endpoints Reference

### Core Services (ff-dev namespace)

- **LLM Broker**: `firefoundry-core-ff-broker.ff-dev.svc.cluster.local:50051` (gRPC)

  - Routes requests to appropriate AI models
  - Handles load balancing and failover
  - Manages API rate limiting

- **Context Service**: `firefoundry-context-service.ff-dev.svc.cluster.local:50051` (gRPC)

  - Stores and retrieves conversation context
  - Manages vector embeddings for semantic search
  - Handles context windowing and summarization

- **Code Sandbox**: `firefoundry-code-sandbox.ff-dev.svc.cluster.local:3000` (HTTP)
  - Provides secure code execution environment
  - Supports multiple programming languages
  - Implements resource limits and timeout handling

### Control Plane Services (ff-control-plane namespace)

- **Concourse Web**: `firefoundry-concourse-web.ff-control-plane.svc.cluster.local:8080`
- **Harbor Core**: `firefoundry-harbor-core.ff-control-plane.svc.cluster.local:8080`
- **ff-console**: `firefoundry-control-ff-console.ff-control-plane.svc.cluster.local:3001`

## Next Steps

Now that you understand the architecture, you can:

1. **[Set up your Environment](../local-development/environment-setup.md)** - Configure your local development environment
2. **[Deploy FireFoundry Services](./deployment.md)** - Get the infrastructure running
