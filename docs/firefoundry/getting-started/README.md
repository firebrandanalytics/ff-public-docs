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

FireFoundry uses the `ff-cli` tool to bootstrap and manage your platform. The CLI handles cluster initialization, control plane deployment, and environment creation.

### Install the CLI

Download the FireFoundry CLI from the [releases page](https://github.com/firebrandanalytics/ff-cli-releases) and add it to your PATH. See [FF CLI Setup](../local-development/ff-cli-setup.md) for detailed platform-specific instructions.

### Bootstrap a Local Cluster

With minikube running and `ff-cli` installed:

```bash
# Initialize the cluster (installs Flux CRDs, creates registry secret)
ff-cli cluster init --license ~/.ff/license.jwt

# Install the control plane (Kong, Helm API, Flux controllers, FF Console)
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y

# Verify control plane pods are healthy
kubectl wait --for=condition=Ready pods --all -n ff-control-plane --timeout=600s

# Start Kong port-forward for API access
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &

# Create an environment with core services (Broker, Entity Service, Context Service)
ff-cli env create -t minimal-self-contained -n ff-test -y

# Wait for environment to be ready
kubectl wait helmrelease/firefoundry-core -n ff-test --for=condition=Ready --timeout=600s
```

### Cloud Deployment

See [Deployment Guide](../platform/deployment.md) for production deployment using Terraform and Kubernetes.

### Local Development

For local development, see the [Local Development Guide](../local-development/README.md).

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

1. [Local Development Setup](../local-development/environment-setup.md)
2. [Agent Development Guide](../local-development/agent-development.md)
3. [AgentSDK Documentation](../sdk/agent-sdk/README.md)
4. [Entity Modeling Tutorial](../sdk/agent-sdk/entity-graph/entity_modeling_tutorial.md)

### For Operators

1. [Platform Architecture](../platform/architecture.md)
2. [Deployment Guide](../platform/deployment.md)
3. [Operations Guide](../platform/operations.md)

### For Consumers

1. [FF SDK Documentation](../sdk/ff-sdk/README.md)
2. [Integration Tutorials](../sdk/ff-sdk/ff_sdk_tutorial.md)

## Additional Resources

- [Platform Overview](../README.md) - Comprehensive platform documentation
- [Troubleshooting](../local-development/troubleshooting.md) - Common issues and solutions
- [Glossary](../README.md#appendices) - Key terms and concepts

## Next Steps

Once you're comfortable with FireFoundry basics, explore:
- [FireIQ Suite](../../fireiq/README.md) - Pre-built applications on FireFoundry
- [Advanced Features](../sdk/agent-sdk/feature_guides/README.md) - Deep dives into specific capabilities

