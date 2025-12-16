# Quick Start Guide

Deploy a self-contained FireFoundry Core instance in 15 minutes.

## Prerequisites

- Kubernetes cluster (k3d, minikube, kind, or cloud-managed)
- `kubectl` configured with cluster access
- `helm` v3.x installed
- Docker registry access (for pulling images)

## Step 1: Add Helm Repository

```bash
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update
```

## Step 2: Create Namespace

```bash
kubectl create namespace ff-core
```

## Step 3: Create Secrets

<!-- TODO: Document required secrets (database passwords, API keys, etc.) -->

```bash
# Create secrets file
cat <<EOF > secrets.yaml
# TODO: Add secrets configuration
EOF

kubectl apply -f secrets.yaml -n ff-core
```

## Step 4: Install FireFoundry Core

```bash
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  --namespace ff-core \
  --set postgresql.enabled=true \
  --set minio.enabled=true \
  --set context-service.enabled=true \
  --set ff-broker.enabled=true
```

## Step 5: Verify Installation

```bash
# Check pods are running
kubectl get pods -n ff-core

# Expected output:
# firefoundry-core-context-service-xxxxx     1/1     Running
# firefoundry-core-ff-broker-xxxxx           1/1     Running
# firefoundry-core-minio-xxxxx               1/1     Running
# firefoundry-core-postgresql-0              1/1     Running
```

## Step 6: Port Forward for Local Access

```bash
# Context Service (gRPC)
kubectl port-forward svc/firefoundry-core-context-service 50051:50051 -n ff-core

# FF Broker (HTTP/gRPC)
kubectl port-forward svc/firefoundry-core-ff-broker 8080:8080 -n ff-core

# MinIO Console (optional, for debugging)
kubectl port-forward svc/firefoundry-core-minio 9001:9001 -n ff-core
```

## Next Steps

- [Configuration Reference](./configuration.md) - Customize your deployment
- [Context Service + MinIO Integration](./context-service-minio.md) - Working memory setup
- [Database Setup](./database-setup.md) - PostgreSQL configuration
- [Troubleshooting](./troubleshooting.md) - Common issues

<!--
TODO: This guide needs expansion with:
- Complete secrets configuration examples
- Image pull secrets setup
- Resource requirements
- TLS configuration
- Ingress setup options
-->
