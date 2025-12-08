# FireFoundry Local Development Guide

Welcome to the FireFoundry local development documentation! This guide will walk you through setting up the complete FireFoundry ecosystem and developing your first agent bundle.

## Quick Start

If you're new to FireFoundry, follow these guides in order:

1. **[Prerequisites](../getting-started/prerequisites.md)** - Install tools (kubectl, helm, minikube/k3d)
2. **[Environment Setup](./environment-setup.md)** - Start your local Kubernetes cluster
3. **[Deploy Control Plane](../platform/deployment.md)** - Deploy FireFoundry infrastructure
4. **[Install FireFoundry CLI](./ff-cli-setup.md)** - Get the CLI for environment management
5. **[Agent Development](./agent-development.md)** - Create your first agent bundle

## Architecture Overview

FireFoundry uses a **two-tier architecture**:

### Control Plane (one-time setup)
Infrastructure services deployed to `ff-control-plane` namespace:
- **Kong Gateway** - API routing and authentication
- **Flux Controllers** - GitOps-based deployment management
- **Helm API** - HTTP interface for environment management
- **FF Console** - Management UI
- **PostgreSQL** - Shared database

### Environments (managed via CLI)
Your AI services deployed to separate namespaces:
- **FF Broker** - LLM orchestration service
- **Context Service** - Working memory management
- **Code Sandbox** - Secure code execution

## What is FireFoundry?

FireFoundry is a comprehensive platform for building and deploying AI agents that can interact with various services, manage context, and execute code safely.

### Key Benefits

- **Modularity**: Each agent handles specific domain responsibilities
- **Reusability**: Agent bundles can be composed into larger systems
- **Testability**: Individual agents can be tested in isolation
- **Maintainability**: Clear boundaries make debugging and updates easier
- **Scalability**: Independent scaling of runtime and control plane services

## Reference Guides

- **[FF CLI Operations](../../ff-cli/ops.md)** - Build, install, and upgrade agent bundles
- **[FF CLI Profiles](../../ff-cli/profiles.md)** - Configure registries for different environments
- **[Operations & Maintenance](../platform/operations.md)** - Monitoring, debugging, and updates
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
- **[Updating Agent Bundles](./updating-agent-bundles.md)** - Deploy new versions

## Getting Help

- **Documentation**: Check the Agent SDK docs included in generated projects
- **Logs**: Always check pod logs first when troubleshooting
- **Support**: Contact Firebrand Support
