# Deploying FireFoundry Services

Deploy the FireFoundry Control Plane for local development. Once the control plane is running, you'll use the FireFoundry CLI to create environments for your AI services.

## Overview

FireFoundry uses a **two-tier architecture**:

1. **Control Plane** (one-time setup) - Infrastructure services: Kong Gateway, Flux, Helm API, FF Console
2. **Environments** (managed via CLI) - Your AI services: FF Broker, Entity Service, Context Service, Code Sandbox

This guide covers deploying the Control Plane. Environment creation is handled by the `ff-cli` tool.

## Recommended: Deploy with ff-cli

The FireFoundry CLI can handle the full cluster bootstrap, including Flux CRDs, registry secrets, and control plane services. This is the recommended approach for new installations.

### Prerequisites

- minikube (or another local Kubernetes cluster) running
- `ff-cli` installed (see [FF CLI Setup](../local-development/ff-cli-setup.md))
- A FireFoundry license file at `~/.ff/license.jwt`

### Initialize and Install

```bash
# Initialize the cluster — installs Flux CRDs and creates registry secret
ff-cli cluster init --license ~/.ff/license.jwt

# Install the control plane
# --self-serve: self-contained mode (no external dependencies)
# --cluster-type local: optimized for local development
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y
```

The install typically completes in 5-12 minutes. It deploys:
- Kong Gateway (API routing)
- Helm API (environment management)
- Flux controllers (GitOps reconciliation)
- FF Console (web UI)
- PostgreSQL (shared database)
- Source controller (Helm chart source)

### Verify Control Plane

```bash
# Wait for all pods to be ready
kubectl wait --for=condition=Ready pods --all -n ff-control-plane --timeout=600s

# Verify — expect 7 pods Running
kubectl get pods -n ff-control-plane
```

### Set Up Kong Access

Start a port-forward to access services through the Kong gateway:

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
```

Verify connectivity:

```bash
ff-cli env list
```

This should return an empty list (no environments yet), confirming the Helm API is reachable through Kong.

### Create an Environment

```bash
# Create an environment with all core services
ff-cli env create -t minimal-self-contained -n ff-test -y

# Wait for services to deploy
kubectl wait helmrelease/firefoundry-core -n ff-test --for=condition=Ready --timeout=600s

# Verify all services are running
kubectl get pods -n ff-test
```

The environment deploys: FF Broker, Entity Service, Context Service, Code Sandbox, and PostgreSQL.

After this step, you're ready to [create and deploy agent bundles](../local-development/agent-development.md).

---

## Troubleshooting

### Pods Stuck in Pending

Insufficient cluster resources:

```bash
kubectl describe nodes

# For minikube, restart with more resources
minikube stop
minikube start --memory=8192 --cpus=4
```

### Environment Creation Fails

Verify the control plane is healthy:

```bash
kubectl get pods -n ff-control-plane | grep helm-api
kubectl get pods -n ff-control-plane | grep flux
```

### Control Plane Pods Not Starting

```bash
# Check events for clues
kubectl get events -n ff-control-plane --sort-by='.lastTimestamp'

# Check specific pod
kubectl describe pod <pod-name> -n ff-control-plane
```

## Next Steps

With FireFoundry deployed, you're ready to:

1. **[Start Agent Development](../local-development/agent-development.md)** - Create your first agent bundle
2. **[Learn Operations](./operations.md)** - Monitor and maintain your deployment
3. **[Troubleshooting Guide](../local-development/troubleshooting.md)** - Common issues and solutions
