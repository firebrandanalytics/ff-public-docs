# FireFoundry Prerequisites

This document outlines the prerequisites for installing and running FireFoundry.

## For Cloud Deployment (AKS)

See the [AKS Bootstrap Guide](./aks-bootstrap.md) for a complete walkthrough.

### Infrastructure

- Azure subscription with permissions to create AKS clusters
- Kubernetes v1.27+ cluster
- Azure CLI (`az`) v2.50+

### Tools

- kubectl v1.27+
- Helm v3.12+
- ff-cli ([releases](https://github.com/firebrandanalytics/ff-cli-releases))

### Cluster Sizing

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| System node pool | 4 vCPU, 16 GB RAM (1 node) | 4 vCPU, 16 GB RAM (2 nodes) |
| Worker node pool | 2 vCPU, 8 GB RAM (1 node) | 4 vCPU, 16 GB RAM (2-4 nodes) |
| OS disk | 128 GB per node | 128 GB per node |

## For Local Development

See the [Minikube Bootstrap Guide](../local-development/minikube-bootstrap.md) for a complete walkthrough.

### Required Software

- Docker Desktop or Docker Engine
- Minikube v1.30+
- kubectl v1.27+
- Helm v3.12+
- ff-cli ([releases](https://github.com/firebrandanalytics/ff-cli-releases))

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB available for minikube | 16 GB total system |
| CPU | 4 cores | 6+ cores |
| Disk | 40 GB available | 60 GB available |

## Access and Credentials

### FireFoundry License

A `license.jwt` file is required for all installations. This is provided by Firebrand when you sign up for FireFoundry access.

Place it at the default location:
```bash
mkdir -p ~/.ff
cp /path/to/license.jwt ~/.ff/license.jwt
```

### LLM Provider API Keys

At least one LLM provider API key is needed for the FF Broker:
- OpenAI API key, or
- Azure OpenAI API key

These are configured after installation via `ff-cli env broker-secret add`.

## Next Steps

Once prerequisites are met:

- **Local Development**: See [Minikube Bootstrap Guide](../local-development/minikube-bootstrap.md)
- **Cloud Deployment**: See [AKS Bootstrap Guide](./aks-bootstrap.md)
