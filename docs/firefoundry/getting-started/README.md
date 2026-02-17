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

Once FireFoundry is running, create and deploy your first agent bundle:

```bash
# Scaffold a new project
ff-cli project create my-first-agent
cd my-first-agent

# Build the Docker image
ff-cli ops build my-first-agent --minikube-profile minikube --tag latest -y

# Deploy to your environment
ff-cli ops install my-first-agent --namespace ff-dev -y
```

For a detailed walkthrough, see the [Agent Development Guide](../local-development/agent-development.md).

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
