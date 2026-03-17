# Deployment & Configuration Guide

This guide covers how to configure, build, and deploy FireFoundry agent bundles to production environments. It walks through `firefoundry.json` configuration, environment variables, Docker builds, Helm deployment, health checks, and resource tuning.

**Prerequisites:** Familiarity with the [SDK Quick-Start](sdk-quickstart.md) and [Entity Lifecycle & Patterns](entity-lifecycle-patterns.md).

---

## Table of Contents

- [Configuration Files](#configuration-files)
- [Environment Variables](#environment-variables)
- [Server Entry Point](#server-entry-point)
- [Health Checks & Readiness](#health-checks--readiness)
- [Docker Build](#docker-build)
- [Helm Deployment](#helm-deployment)
- [Resource Configuration](#resource-configuration)
- [Secrets Management](#secrets-management)
- [Multi-Bundle Deployments](#multi-bundle-deployments)
- [Deployment Workflow](#deployment-workflow)
- [Troubleshooting Deployments](#troubleshooting-deployments)

---

## Configuration Files

Every agent bundle project has a `firefoundry.json` at the repository root that declares the application and its bundles.

### Root Configuration

The root `firefoundry.json` lists all bundles in the project:

```json
{
  "name": "my-agent-app",
  "version": "1.0.0",
  "bundles": [
    {
      "name": "main-bundle",
      "path": "apps/main-bundle",
      "entry": "src/index.ts"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `name` | Application name (used in Kubernetes labels) |
| `version` | Semantic version of the application |
| `bundles` | Array of bundle declarations |
| `bundles[].name` | Bundle identifier (used as Helm release name) |
| `bundles[].path` | Relative path to the bundle directory |
| `bundles[].entry` | Entry point file relative to the bundle path |

### Bundle-Level Configuration

Each bundle directory can have its own `firefoundry.json` with deployment-specific settings:

```json
{
  "port": 3000,
  "health": {
    "endpoint": "/health",
    "interval": 30,
    "timeout": 3
  },
  "readiness": {
    "endpoint": "/ready",
    "initialDelay": 5
  },
  "resources": {
    "requests": { "memory": "256Mi", "cpu": "100m" },
    "limits": { "memory": "512Mi", "cpu": "500m" }
  },
  "environment": {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `3000` | HTTP server port |
| `health.endpoint` | `/health` | Kubernetes liveness probe endpoint |
| `health.interval` | `30` | Probe interval in seconds |
| `health.timeout` | `3` | Probe timeout in seconds |
| `readiness.endpoint` | `/ready` | Kubernetes readiness probe endpoint |
| `readiness.initialDelay` | `5` | Seconds to wait before first readiness check |
| `resources.requests` | — | Minimum guaranteed resources |
| `resources.limits` | — | Maximum allowed resources |
| `environment` | — | Environment variables injected at runtime |

---

## Environment Variables

FireFoundry agent bundles connect to platform services via environment variables. These are automatically injected when deploying to a FireFoundry environment.

### Platform Service Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `LLM_BROKER_HOST` | gRPC host for LLM Broker | `ff-broker.ff-system.svc` |
| `LLM_BROKER_PORT` | gRPC port for LLM Broker | `50051` |
| `CONTEXT_SERVICE_ADDRESS` | HTTP address for Context Service (working memory, file storage) | `http://ff-context:3000` |
| `DOC_PROC_SERVICE_URL` | Document processing service URL | `http://ff-doc-proc:3000` |
| `PG_HOST` | PostgreSQL host (entity graph) | `ff-postgresql.ff-system.svc` |
| `PG_DATABASE` | PostgreSQL database name | `firefoundry` |
| `PG_PASSWORD` | PostgreSQL password | (from secret) |

### Application Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Node.js environment | `development` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `CONSOLE_LOG_LEVEL` | Console-specific log level override | inherits `LOG_LEVEL` |

### Local Development

For local development, create a `.env` file in your bundle directory:

```bash
# .env (do NOT commit this file)
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

# Platform services (from minikube port-forwards)
LLM_BROKER_HOST=localhost
LLM_BROKER_PORT=50051
CONTEXT_SERVICE_ADDRESS=http://localhost:3002
PG_HOST=localhost
PG_DATABASE=firefoundry
PG_PASSWORD=your-local-password
```

> **Tip:** Use `ff cli env` to generate a `.env` file pre-populated with your current environment's service addresses.

---

## Server Entry Point

The entry point creates and starts the bundle server:

```typescript
// src/index.ts
import { createStandaloneAgentBundle } from '@firebrandanalytics/ff-agent-sdk/server';
import { MyAgentBundle } from './agent-bundle.js';

const port = parseInt(process.env.PORT || '3000', 10);

const server = await createStandaloneAgentBundle(MyAgentBundle, { port });

console.log(`Agent bundle running on port ${port}`);
```

### Startup Options

`createStandaloneAgentBundle` accepts configuration options:

```typescript
const server = await createStandaloneAgentBundle(MyAgentBundle, {
  port: 3000,
  // Graceful shutdown timeout (ms)
  shutdownTimeout: 30_000,
});
```

### Lifecycle Hooks

The `FFAgentBundle` class provides lifecycle hooks for setup and teardown:

```typescript
export class MyAgentBundle extends FFAgentBundle {
  async init(): Promise<void> {
    // Called once on startup — initialize connections, warm caches
    await this.warmModelCache();
  }

  async shutdown(): Promise<void> {
    // Called on graceful shutdown — close connections, flush buffers
    await this.flushMetrics();
  }
}
```

---

## Health Checks & Readiness

FireFoundry bundles expose health and readiness endpoints that Kubernetes uses for pod lifecycle management.

### How They Work

```
                    ┌──────────────────────┐
  Liveness probe ──→│  GET /health         │──→ Returns 200 if server is alive
                    │                      │    Failing → Kubernetes restarts pod
                    ├──────────────────────┤
  Readiness probe ─→│  GET /ready          │──→ Returns 200 if ready for traffic
                    │                      │    Failing → Kubernetes removes from Service
                    └──────────────────────┘
```

### Default Behavior

The SDK server automatically registers both endpoints. The health endpoint returns `200 OK` when the HTTP server is running. The readiness endpoint returns `200 OK` after the bundle's `init()` method completes.

### Custom Health Checks

Override readiness to include downstream dependency checks:

```typescript
export class MyAgentBundle extends FFAgentBundle {
  async checkReady(): Promise<boolean> {
    try {
      // Verify the entity graph connection
      await this.entity_factory.ping();
      // Verify the broker connection
      await this.broker_client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## Docker Build

FireFoundry projects use a multi-stage Docker build optimized for monorepo structures with Turborepo.

### Standard Dockerfile

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/main-bundle/package.json ./apps/main-bundle/
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/main-bundle/node_modules ./apps/main-bundle/node_modules
COPY . .
RUN corepack enable && pnpm --filter main-bundle build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/main-bundle/dist ./dist
COPY --from=builder /app/apps/main-bundle/node_modules ./node_modules
COPY --from=builder /app/apps/main-bundle/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Building with ff-cli

The `ff ops build` command wraps Docker builds with FireFoundry conventions:

```bash
# Build the container image
ff ops build --bundle main-bundle

# Build for a specific platform (e.g., building on ARM Mac for AMD64 cluster)
ff ops build --bundle main-bundle --platform linux/amd64

# Tag for a specific registry
ff ops build --bundle main-bundle --tag myregistry.azurecr.io/main-bundle:v1.0.0
```

> **Tip:** If your project uses private npm packages from GitHub Packages, pass the token as a build argument: `--build-arg FF_NPM_TOKEN="$FF_NPM_TOKEN"`.

---

## Helm Deployment

FireFoundry uses Helm charts for Kubernetes deployment. Each agent bundle becomes a Helm sub-chart under the platform's umbrella chart.

### Deploy with ff-cli

```bash
# Deploy to the current environment
ff ops deploy --bundle main-bundle

# Deploy to a specific environment
ff ops deploy --bundle main-bundle --env staging

# Deploy a specific image tag
ff ops deploy --bundle main-bundle --tag v1.0.0
```

### Helm Values

Bundle-specific Helm values customize the deployment:

```yaml
# values.yaml
mainBundle:
  replicaCount: 2
  image:
    repository: myregistry.azurecr.io/main-bundle
    tag: "v1.0.0"
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "500m"
  env:
    LOG_LEVEL: "info"
```

### Environment-Specific Overrides

Use separate values files for different environments:

```bash
# Development
ff ops deploy --bundle main-bundle --values values.dev.yaml

# Production
ff ops deploy --bundle main-bundle --values values.prod.yaml
```

```yaml
# values.prod.yaml
mainBundle:
  replicaCount: 3
  resources:
    requests:
      memory: "512Mi"
      cpu: "250m"
    limits:
      memory: "1Gi"
      cpu: "1000m"
  env:
    LOG_LEVEL: "warn"
```

---

## Resource Configuration

### Memory Sizing

Agent bundles that process large documents or maintain substantial context require more memory than simple CRUD services.

| Workload Type | Recommended Requests | Recommended Limits |
|---------------|---------------------|--------------------|
| Simple bot (single entity, short prompts) | 128Mi / 100m | 256Mi / 250m |
| Standard workflow (multi-step, moderate context) | 256Mi / 100m | 512Mi / 500m |
| Heavy processing (document parsing, large graphs) | 512Mi / 250m | 1Gi / 1000m |
| Parallel execution (many concurrent bots) | 512Mi / 500m | 2Gi / 2000m |

### Scaling Replicas

Horizontal scaling is the primary scaling mechanism. Each replica handles requests independently:

```yaml
# Scale based on expected concurrent requests
mainBundle:
  replicaCount: 3  # 3 replicas for high availability

  # Optional: Horizontal Pod Autoscaler
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

> **Tip:** LLM-bound workloads are typically I/O-bound (waiting for broker responses), so CPU limits can be modest. Memory is usually the constraint.

---

## Secrets Management

### Kubernetes Secrets

Sensitive values (database passwords, API keys) should be stored as Kubernetes secrets, not in Helm values:

```bash
# Create a secret
kubectl create secret generic my-bundle-secrets \
  --from-literal=PG_PASSWORD=your-password \
  --from-literal=API_KEY=your-api-key \
  -n ff-env

# Reference in Helm values
mainBundle:
  envFrom:
    - secretRef:
        name: my-bundle-secrets
```

### SOPS Encrypted Values

For GitOps workflows, encrypt secrets with SOPS:

```bash
# Encrypt a values file
sops --encrypt --age <age-public-key> values.secrets.yaml > values.secrets.enc.yaml

# Deploy with encrypted values (ff-cli decrypts automatically)
ff ops deploy --bundle main-bundle --values values.secrets.enc.yaml
```

---

## Multi-Bundle Deployments

Applications with multiple bundles (e.g., a processing bundle and a consumer-facing API bundle) share the same root `firefoundry.json`:

```json
{
  "name": "my-agent-app",
  "version": "1.0.0",
  "bundles": [
    {
      "name": "processor",
      "path": "apps/processor",
      "entry": "src/index.ts"
    },
    {
      "name": "api",
      "path": "apps/api",
      "entry": "src/index.ts"
    }
  ]
}
```

### Inter-Bundle Communication

Bundles communicate via `AppClient`:

```typescript
import { AppClient } from '@firebrandanalytics/ff-agent-sdk/client';

// In the API bundle, call the processor bundle
const processorClient = new AppClient({
  baseUrl: process.env.PROCESSOR_BUNDLE_URL || 'http://processor:3000',
});

const result = await processorClient.call('analyze', { documentId: 'doc-123' });
```

### Deploy Order

When bundles depend on each other, deploy dependencies first:

```bash
# Deploy the processor bundle (no dependencies)
ff ops deploy --bundle processor

# Deploy the API bundle (depends on processor)
ff ops deploy --bundle api
```

---

## Deployment Workflow

A typical deployment workflow from development to production:

```
1. Develop locally
   └─ pnpm dev (hot reload)

2. Test
   └─ pnpm test (unit)
   └─ RUN_INTEGRATION_TESTS=true pnpm test (integration)

3. Build container
   └─ ff ops build --bundle main-bundle

4. Deploy to dev
   └─ ff ops deploy --bundle main-bundle --env dev

5. Verify
   └─ ff-sdk-cli health --url http://main-bundle.dev.firefoundry.local
   └─ ff-sdk-cli info --url http://main-bundle.dev.firefoundry.local

6. Deploy to production
   └─ ff ops deploy --bundle main-bundle --env prod --tag v1.0.0
```

### Post-Deploy Verification

After deploying, verify the bundle is healthy:

```bash
# Check health endpoint
ff-sdk-cli health --url http://main-bundle.firefoundry.local

# Check bundle info (entities, bots, endpoints)
ff-sdk-cli info --url http://main-bundle.firefoundry.local

# Test an endpoint
ff-sdk-cli invoke --url http://main-bundle.firefoundry.local \
  --method POST --route analyze \
  --body '{"document_id": "test-doc"}'
```

---

## Troubleshooting Deployments

### Pod Won't Start

Check pod events and logs:

```bash
# View pod status
kubectl get pods -n ff-env -l app=main-bundle

# Check events
kubectl describe pod <pod-name> -n ff-env

# View logs
kubectl logs <pod-name> -n ff-env
```

Common causes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ImagePullBackOff` | Image not found or registry auth failed | Verify image tag and registry credentials |
| `CrashLoopBackOff` | Application crashes on startup | Check logs for missing env vars or connection errors |
| `OOMKilled` | Memory limit exceeded | Increase `resources.limits.memory` |
| `Pending` | Insufficient cluster resources | Scale cluster or reduce resource requests |

### Connection Failures

If the bundle starts but can't connect to platform services:

```bash
# Verify service DNS resolution
kubectl exec <pod-name> -n ff-env -- nslookup ff-broker.ff-system.svc

# Test broker connectivity
kubectl exec <pod-name> -n ff-env -- nc -zv ff-broker.ff-system.svc 50051

# Check environment variables
kubectl exec <pod-name> -n ff-env -- env | grep -E 'LLM_|PG_|CONTEXT_'
```

### Readiness Probe Failures

If pods are running but not receiving traffic:

```bash
# Check readiness probe
kubectl describe pod <pod-name> -n ff-env | grep -A 5 Readiness

# Manually test the readiness endpoint
kubectl exec <pod-name> -n ff-env -- curl -s http://localhost:3000/ready
```

---

## Related Guides

- **[SDK Quick-Start](sdk-quickstart.md)** — scaffold, build, and deploy your first bundle
- **[Error Handling & Resilience](error-handling-resilience.md)** — handling failures in production
- **[Testing Guide](testing-guide.md)** — testing before deployment
- **[Monitoring & Debugging](monitoring-debugging.md)** — observability after deployment
- **[Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md)** — multi-step workflows that benefit from resource tuning
