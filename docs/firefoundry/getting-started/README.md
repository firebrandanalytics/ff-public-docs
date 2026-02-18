# FireFoundry Getting Started

Welcome to FireFoundry! This guide will help you get up and running with the FireFoundry platform.

## What is FireFoundry?

FireFoundry is an Agent-as-a-Service platform for enterprises building sophisticated GenAI applications. It provides opinionated runtime services, developer tooling, and a management console in a batteries-included stack.

For a comprehensive overview, see the [FireFoundry Platform Overview](../README.md).

## Quick Start Path

1. **[Prerequisites](./prerequisites.md)** - System requirements and dependencies
2. **[Installation](#installation)** - Set up FireFoundry infrastructure
3. **[First Agent Bundle](#first-agent-bundle)** - Create and deploy your first agent

## Installation

Choose the installation path that matches your target environment:

### Local Development (Minikube)

The fastest way to get started. Sets up FireFoundry on a local Kubernetes cluster using Minikube.

**[Minikube Bootstrap Guide](../local-development/minikube-bootstrap.md)** -- complete walkthrough from zero to running environment (30-45 minutes).

### Cloud Deployment (AKS)

Deploy FireFoundry on Azure Kubernetes Service for team or production use.

**[AKS Bootstrap Guide](./aks-bootstrap.md)** -- step-by-step AKS cluster creation and FireFoundry deployment.

### Other Deployment Options

- [Deployment Guide](../platform/deployment.md) -- general production deployment guidance
- [Self-Contained Deployment](../platform/self-contained/README.md) -- single Helm release with bundled dependencies

## First Agent Bundle

Create and deploy a simple agent bundle in under 10 minutes.

### 1. Scaffold the project

```bash
# Create a new application monorepo
ff-cli application create my-app
cd my-app

# Create an agent bundle inside the monorepo
ff-cli agent-bundle create my-service
```

This generates a Turborepo monorepo with your agent bundle at `apps/my-service/`, including a Dockerfile, Helm chart, and TypeScript source.

### 2. Configure and build

Edit `apps/my-service/helm/values.local.yaml` to set `global.environment` to your environment namespace (e.g., `ff-test`) and add database credentials from the cluster. See the [Agent Development Guide](../local-development/agent-development.md) for full configuration details.

```bash
pnpm install
pnpm run build
```

### 3. Build, deploy, and test

```bash
# Build Docker image (auto-loads into minikube)
ff-cli ops build my-service

# Deploy to your environment
ff-cli ops install my-service -y

# Enable external access through Kong
kubectl annotate svc my-service-agent-bundle -n ff-test firefoundry.ai/external-access=true

# Test through the API gateway
curl http://localhost:8000/agents/ff-test/my-service/health/ready
```

For the complete walkthrough including LLM integration, see the [Agent Development Guide](../local-development/agent-development.md).

## Learning Path

### For Developers

1. [Minikube Bootstrap Guide](../local-development/minikube-bootstrap.md)
2. [Agent Development Guide](../local-development/agent-development.md)
3. [AgentSDK Documentation](../sdk/agent-sdk/README.md)
4. [Entity Modeling Tutorial](../sdk/agent-sdk/entity-graph/entity_modeling_tutorial.md)

### For Operators

1. [Platform Architecture](../platform/architecture.md)
2. [AKS Bootstrap Guide](./aks-bootstrap.md)
3. [Deployment Guide](../platform/deployment.md)
4. [Operations Guide](../platform/operations.md)

### For Consumers

1. [FF SDK Documentation](../sdk/ff-sdk/README.md)
2. [Integration Tutorials](../sdk/ff-sdk/ff_sdk_tutorial.md)

## Additional Resources

- [Platform Overview](../README.md) - Comprehensive platform documentation
- [Troubleshooting](../local-development/troubleshooting.md) - Common issues and solutions
- [Chart Reference](../../ff_local_dev/chart-reference.md) - Helm chart configuration options
- [FF CLI Reference](../../ff-cli/README.md) - CLI command documentation
- [Glossary](../README.md#appendices) - Key terms and concepts

## Next Steps

Once you're comfortable with FireFoundry basics, explore:
- [FireIQ Suite](../../fireiq/README.md) - Pre-built applications on FireFoundry
- [Advanced Features](../sdk/agent-sdk/feature_guides/README.md) - Deep dives into specific capabilities
