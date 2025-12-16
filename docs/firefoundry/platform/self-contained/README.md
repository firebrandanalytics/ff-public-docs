# Self-Contained FireFoundry Core

Deploy FireFoundry Core services as a single, self-contained unit using the `firefoundry-core` Helm chart. This deployment model bundles all required infrastructure (PostgreSQL, MinIO) alongside the AI services, making it ideal for development, testing, and air-gapped environments.

## Overview

The self-contained deployment differs from the standard two-tier architecture:

| Aspect | Standard Deployment | Self-Contained |
|--------|---------------------|----------------|
| **Architecture** | Control Plane + Environments | Single Helm release |
| **Database** | External PostgreSQL | Bundled PostgreSQL |
| **Blob Storage** | Azure Blob / GCS | Bundled MinIO (S3-compatible) |
| **Management** | ff-cli + Helm API | Direct Helm commands |
| **Use Case** | Production, multi-tenant | Development, testing, air-gapped |

## When to Use Self-Contained Deployment

**Recommended for:**
- Local development with k3d, minikube, or kind
- CI/CD pipeline testing
- Air-gapped or disconnected environments
- Quick proof-of-concept deployments
- Learning and experimentation

**Not recommended for:**
- Production workloads requiring high availability
- Multi-tenant deployments
- Environments requiring external managed databases

## Components

The `firefoundry-core` chart can deploy:

### Core AI Services
- **FF Broker** - LLM orchestration and routing
- **Context Service** - Working memory and blob storage management
- **Code Sandbox** - Secure code execution environment
- **Entity Service** - Entity graph management
- **Doc Proc Service** - Document processing

### Bundled Infrastructure
- **PostgreSQL** - Metadata storage for all services
- **MinIO** - S3-compatible object storage for blobs and artifacts

## Documentation

- [Quick Start Guide](./quick-start.md) - Get running in 15 minutes
- [Configuration Reference](./configuration.md) - All available options
- [Context Service + MinIO Integration](./context-service-minio.md) - Working memory with bundled storage
- [Database Setup](./database-setup.md) - PostgreSQL configuration and migrations
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Quick Start

```bash
# Add the FireFoundry Helm repository
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update

# Create namespace
kubectl create namespace ff-core

# Install with bundled PostgreSQL and MinIO
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  --namespace ff-core \
  --set postgresql.enabled=true \
  --set minio.enabled=true \
  --set context-service.enabled=true \
  --set ff-broker.enabled=true
```

See the [Quick Start Guide](./quick-start.md) for complete instructions including secrets configuration.

## Architecture Diagram

```
                    FireFoundry Core Namespace
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │   FF Broker     │  │ Context Service │  │  Code Sandbox  │  │
│  │   (gRPC/HTTP)   │  │    (gRPC)       │  │    (HTTP)      │  │
│  └────────┬────────┘  └────────┬────────┘  └───────┬────────┘  │
│           │                    │                    │          │
│           │         ┌─────────┴─────────┐          │          │
│           │         │                   │          │          │
│           ▼         ▼                   ▼          ▼          │
│  ┌─────────────────────────┐   ┌─────────────────────────┐    │
│  │      PostgreSQL         │   │         MinIO           │    │
│  │  (Metadata, Entities,   │   │   (Blobs, Artifacts,    │    │
│  │   Broker Registry)      │   │    Working Memory)      │    │
│  └─────────────────────────┘   └─────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Related Documentation

- [FireFoundry Platform Architecture](../architecture.md)
- [Standard Deployment Guide](../deployment.md) - Two-tier Control Plane + Environments
- [Context Service Client Guide](../clients/CONTEXT_CLIENT_GUIDE.md)
