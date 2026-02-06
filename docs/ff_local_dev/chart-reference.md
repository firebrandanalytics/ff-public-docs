# FireFoundry Core Chart Reference

This document provides comprehensive configuration options for the `firefoundry-core` Helm chart.

## Overview

The `firefoundry-core` chart deploys FireFoundry's AI application services as a cohesive stack. It includes:

- **Core Services**: FF Broker, Context Service, Code Sandbox, Entity Service
- **Optional Services**: Web Search, Document Processing, Virtual Worker Manager, MCP Gateway, Log Proxy
- **Bundled Dependencies**: PostgreSQL and MinIO (optional, for self-contained deployments)

## Chart Information

| Property | Value |
|----------|-------|
| Chart Name | `firefoundry-core` |
| Current Version | `0.19.0` |
| Repository | `https://firebrandanalytics.github.io/ff_infra` |

```bash
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update
```

---

## Services Reference

### FF Broker

The LLM orchestration service that routes requests to AI providers (OpenAI, Azure OpenAI, etc.).

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ff-broker.enabled` | Enable FF Broker | `true` |
| `ff-broker.replicaCount` | Number of replicas | `1` |
| `ff-broker.image.tag` | Image version | `6.2.0` |
| `ff-broker.configMap.data.MODEL_GROUP_ID` | Model group for routing | `200` |
| `ff-broker.configMap.data.CONSOLE_LOG_LEVEL` | Log level | `info` |
| `ff-broker.configMap.data.CONTEXT_SERVICE_ADDRESS` | Context service endpoint | Auto-configured |
| `ff-broker.secret.data.PGF_PWD` | Database password | Required |
| `ff-broker.resources.requests.memory` | Memory request | `256Mi` |
| `ff-broker.resources.limits.memory` | Memory limit | `1Gi` |

**LLM Provider Secrets** (add to `ff-broker.secret.data`):
- `AZURE_OPENAI_KEY` - Azure OpenAI API key
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key

### Context Service

Working memory and context management for AI conversations.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `context-service.enabled` | Enable Context Service | `true` |
| `context-service.replicaCount` | Number of replicas | `1` |
| `context-service.image.tag` | Image version | `3.2.0` |
| `context-service.configMap.data.WORKING_MEMORY_DATABASE_SCHEMA` | DB schema | `wm` |
| `context-service.secret.data.WORKING_MEMORY_DATABASE_URL` | Database URL | Required |
| `context-service.migration.enabled` | Run DB migrations | `true` |

**Storage Configuration** (choose one):

MinIO/S3 (recommended for local):
```yaml
context-service:
  secret:
    data:
      AWS_S3_ENDPOINT: "http://firefoundry-core-minio:9000"
      AWS_REGION: "us-east-1"
      AWS_ACCESS_KEY_ID: "admin"
      AWS_SECRET_ACCESS_KEY: "your-minio-password"
      BLOB_STORAGE_CONTAINER: "context-service"
```

Azure Blob Storage:
```yaml
context-service:
  configMap:
    data:
      WORKING_MEMORY_STORAGE_ACCOUNT: "your-storage-account"
      WORKING_MEMORY_STORAGE_CONTAINER: "context-service-files"
  secret:
    data:
      WORKING_MEMORY_STORAGE_KEY: "your-storage-key"
```

### Code Sandbox

Secure code execution environment for AI-generated code.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `code-sandbox.enabled` | Enable Code Sandbox | `true` |
| `code-sandbox.replicaCount` | Number of replicas | `1` |
| `code-sandbox.image.tag` | Image version | `2.0.0` |
| `code-sandbox.configMap.data.USE_DIRECT_EXECUTION` | Execution mode | `true` |
| `code-sandbox.secret.data.ANALYTICS_CONNECTION_STRING` | Database connection | Required |
| `code-sandbox.resources.limits.memory` | Memory limit | `2Gi` |

### Entity Service

Graph-based entity storage and persistence.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `entity-service.enabled` | Enable Entity Service | `true` |
| `entity-service.replicaCount` | Number of replicas | `1` |
| `entity-service.image.tag` | Image version | `0.3.0` |
| `entity-service.configMap.data.PG_DATABASE` | Database name | `firefoundry` |
| `entity-service.secret.data.PG_PASSWORD` | Database password | Required |
| `entity-service.migration.enabled` | Run Flyway migrations | `true` |
| `entity-service.migration.adminUsername` | Migration user | `firebrand` |
| `entity-service.migration.adminPassword` | Migration password | Required |

### Web Search Service

Brave-powered web search for AI applications.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `websearch-service.enabled` | Enable Web Search | `false` |
| `websearch-service.image.tag` | Image version | `0.2.3` |
| `websearch-service.secret.data.BRAVE_API_KEY` | Brave API key | Required |
| `websearch-service.migration.enabled` | Run migrations | `true` |

### Document Processing Service

Document ingestion and processing.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `doc-proc-service.enabled` | Enable Doc Proc | `false` |
| `doc-proc-service.image.tag` | Image version | `0.2.0` |
| `doc-proc-service.migration.enabled` | Run migrations | `true` |

### Virtual Worker Manager

CLI-based AI coding agent orchestration (Claude Code, Codex, etc.).

| Parameter | Description | Default |
|-----------|-------------|---------|
| `virtual-worker-manager.enabled` | Enable VWM | `false` |
| `virtual-worker-manager.image.tag` | Image version | `0.1.0` |
| `virtual-worker-manager.configMap.data.SESSION_INACTIVITY_MINUTES` | Session timeout | `15` |
| `virtual-worker-manager.configMap.data.HARNESS_IMAGE` | Worker image | See values |
| `virtual-worker-manager.configMap.data.DEFAULT_PVC_SIZE` | Worker storage | `10Gi` |
| `virtual-worker-manager.rbac.create` | Create RBAC resources | `true` |

### MCP Gateway

Model Context Protocol gateway for external tool integration.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `mcp-gateway.enabled` | Enable MCP Gateway | `true` |
| `mcp-gateway.image.tag` | Image version | `0.1.1` |
| `mcp-gateway.secret.data.API_KEY` | Gateway API key | Required |
| `mcp-gateway.secret.data.ENTITY_SERVICE_URL` | Entity service URL | Auto-configured |

### Log Proxy Service

Centralized log aggregation and streaming.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `log-proxy-service.enabled` | Enable Log Proxy | `false` |
| `log-proxy-service.image.tag` | Image version | `0.1.0` |
| `log-proxy-service.secret.data.ADMIN_API_KEY` | Admin API key | Required |
| `log-proxy-service.secret.data.SEARCH_API_KEY` | Search API key | Required |
| `log-proxy-service.persistence.size` | Buffer storage size | `10Gi` |

---

## Bundled Dependencies

### PostgreSQL

Bundled PostgreSQL for self-contained deployments. Automatically creates FireFoundry database users.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgresql.enabled` | Enable bundled PostgreSQL | `false` |
| `postgresql.auth.postgresPassword` | Superuser password | Required |
| `postgresql.auth.database` | Default database | `firefoundry` |
| `postgresql.firebrandPassword` | Schema owner password | Required |
| `postgresql.fireinsertPassword` | Insert user password | Required |
| `postgresql.firereadPassword` | Read-only user password | Required |
| `postgresql.firebrokerPassword` | Broker user password | Required |
| `postgresql.primary.persistence.size` | Storage size | `8Gi` |

**Database Users Created:**
- `firebrand` - Schema owner with full privileges
- `fireinsert` - Insert/update operations
- `fireread` - Read-only access
- `firebroker` - FF Broker access

### MinIO

Bundled S3-compatible object storage for working memory and file storage.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `minio.enabled` | Enable bundled MinIO | `false` |
| `minio.auth.rootUser` | Admin username | `admin` |
| `minio.auth.rootPassword` | Admin password | Required |
| `minio.defaultBuckets` | Auto-created buckets | `context-service,doc-proc,vwm` |
| `minio.persistence.size` | Storage size | `20Gi` |
| `minio.console.enabled` | Enable web console | `false` |

---

## Global Configuration

### Database Settings

When using external PostgreSQL:

```yaml
database:
  externalHost: "postgres.example.com"
  port: 5432
  database: "firefoundry"
  sslMode: "require"  # disable, require, verify-ca, verify-full
  maxPoolSize: 20
  idleTimeoutMs: 30000
  connectionTimeoutMs: 2000
```

When using bundled PostgreSQL, `database.host` is auto-configured.

### Image Pull Secrets

All services use the same registry credentials:

```yaml
# Applied to all services automatically
imagePullSecrets:
  - name: myregistrycreds
```

Create the secret before installation:
```bash
kubectl create secret docker-registry myregistrycreds \
  --docker-server=firebranddevet.azurecr.io \
  --docker-username=<username> \
  --docker-password=<password> \
  -n <namespace>
```

---

## Common Configurations

### Minimal Local Development

Self-contained deployment with bundled PostgreSQL and MinIO:

```yaml
# values-local.yaml
postgresql:
  enabled: true
  auth:
    postgresPassword: "admin-secret"
  firebrandPassword: "firebrand-secret"
  fireinsertPassword: "fireinsert-secret"
  firereadPassword: "fireread-secret"
  firebrokerPassword: "firebroker-secret"

minio:
  enabled: true
  auth:
    rootPassword: "minio-secret"

database:
  sslMode: "disable"

ff-broker:
  secret:
    data:
      PGF_PWD: "firebroker-secret"
      OPENAI_API_KEY: "sk-your-key"

context-service:
  secret:
    data:
      AWS_S3_ENDPOINT: "http://firefoundry-core-minio:9000"
      AWS_ACCESS_KEY_ID: "admin"
      AWS_SECRET_ACCESS_KEY: "minio-secret"
      BLOB_STORAGE_CONTAINER: "context-service"
      WORKING_MEMORY_DATABASE_URL: "postgresql://fireinsert:fireinsert-secret@firefoundry-core-postgresql:5432/firefoundry"

entity-service:
  secret:
    data:
      PG_PASSWORD: "fireinsert-secret"
  migration:
    adminPassword: "firebrand-secret"

code-sandbox:
  secret:
    data:
      ANALYTICS_CONNECTION_STRING: "postgresql://fireread:fireread-secret@firefoundry-core-postgresql:5432/firefoundry"
```

### Production with External Database

Using managed PostgreSQL (Azure, AWS RDS, etc.):

```yaml
# values-prod.yaml
postgresql:
  enabled: false

database:
  externalHost: "mydb.postgres.database.azure.com"
  port: 5432
  database: "firefoundry"
  sslMode: "require"

ff-broker:
  replicaCount: 2
  secret:
    data:
      PGF_PWD: "from-secret-manager"
      AZURE_OPENAI_KEY: "from-secret-manager"
  resources:
    requests:
      memory: "512Mi"
      cpu: "250m"
    limits:
      memory: "2Gi"
      cpu: "1000m"

# Similar configuration for other services...
```

### Enable Optional Services

```yaml
# Enable web search (requires Brave API key)
websearch-service:
  enabled: true
  secret:
    data:
      BRAVE_API_KEY: "your-brave-api-key"

# Enable document processing
doc-proc-service:
  enabled: true

# Enable virtual worker manager (for CLI agents)
virtual-worker-manager:
  enabled: true
  configMap:
    data:
      DEFAULT_PVC_SIZE: "20Gi"
      SESSION_INACTIVITY_MINUTES: "30"

# Enable log aggregation
log-proxy-service:
  enabled: true
  secret:
    data:
      ADMIN_API_KEY: "your-admin-key"
      SEARCH_API_KEY: "your-search-key"
```

---

## Installation

### Using ff-cli (Recommended)

```bash
# Create from template
ff-cli env create -t minimal-self-contained -n my-env -y

# Create from custom config
ff-cli env create -f my-config.json -n my-env -y
```

### Direct Helm Install

```bash
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -f values.yaml \
  -f secrets.yaml \
  --namespace ff-dev \
  --create-namespace
```

### Upgrade

```bash
helm upgrade firefoundry-core firebrandanalytics/firefoundry-core \
  -f values.yaml \
  -f secrets.yaml \
  --namespace ff-dev
```

---

## Migrations

Each service with database dependencies runs migrations automatically:

| Service | Migration Tool | Trigger |
|---------|---------------|---------|
| Entity Service | Flyway | Helm hook (pre-upgrade) |
| Context Service | Drizzle ORM | InitContainer |
| Doc Proc Service | Flyway | Helm hook |
| Web Search Service | Flyway | Helm hook |
| Virtual Worker Manager | Flyway | Helm hook |

Migrations are idempotent and safe to run repeatedly.

---

## Troubleshooting

### Check Service Health

```bash
kubectl get pods -n ff-dev
kubectl logs -n ff-dev -l app.kubernetes.io/name=ff-broker --tail=50
```

### Migration Failures

```bash
# Check migration job status
kubectl get jobs -n ff-dev

# View migration logs
kubectl logs -n ff-dev job/firefoundry-core-entity-migration
```

### Database Connectivity

```bash
# Test from a pod
kubectl exec -it -n ff-dev deploy/firefoundry-core-ff-broker -- \
  pg_isready -h firefoundry-core-postgresql -p 5432
```

### Image Pull Errors

```bash
# Verify secret exists
kubectl get secret myregistrycreds -n ff-dev

# Check secret content
kubectl get secret myregistrycreds -n ff-dev -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
```
