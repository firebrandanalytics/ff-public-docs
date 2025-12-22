# Configuration Reference

Complete reference for all configuration options in self-contained FireFoundry Core deployments.

## Global Settings

<!-- TODO: Document global Helm values -->

```yaml
global:
  imageRegistry: ""
  imagePullSecrets: []
  storageClass: ""
```

## PostgreSQL Configuration

The bundled PostgreSQL uses the Bitnami PostgreSQL Helm chart as a subchart.

```yaml
postgresql:
  enabled: true
  auth:
    postgresPassword: ""      # Required: superuser password
    username: "fireinsert"    # Application user
    password: ""              # Required: application user password
    database: "firefoundry"   # Default database name
  primary:
    persistence:
      enabled: true
      size: 10Gi
    resources:
      requests:
        memory: "256Mi"
        cpu: "100m"
      limits:
        memory: "1Gi"
        cpu: "500m"
```

<!-- TODO: Document connection pooling, replicas, backup configuration -->

## MinIO Configuration

S3-compatible object storage for blob data.

```yaml
minio:
  enabled: true
  mode: standalone
  auth:
    rootUser: "minioadmin"
    rootPassword: ""          # Required: change in production
  defaultBuckets: "context-service,doc-proc"
  persistence:
    enabled: true
    size: 20Gi
  service:
    type: ClusterIP
    ports:
      api: 9000
      console: 9001
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "1Gi"
      cpu: "500m"
```

<!-- TODO: Document distributed mode, TLS, access policies -->

## Context Service Configuration

See [Context Service + MinIO Integration](./context-service-minio.md) for detailed configuration.

```yaml
context-service:
  enabled: true
  replicaCount: 1
  image:
    repository: firebrandanalytics/context-service
    tag: ""                   # Defaults to chart appVersion
  configMap:
    data:
      CONTEXT_SERVICE_PORT: "50051"
      BLOB_STORAGE_PROVIDER: "s3"
      BLOB_STORAGE_CONTAINER: "context-service"
      AWS_REGION: "us-east-1"
      AWS_S3_ENDPOINT: "http://firefoundry-core-minio:9000"
      WORKING_MEMORY_DATABASE_SCHEMA: "wm"
      HISTORY_DATABASE_SCHEMA: "entity"
  secret:
    data:
      AWS_ACCESS_KEY_ID: ""
      AWS_SECRET_ACCESS_KEY: ""
      WORKING_MEMORY_DATABASE_URL: ""
      RAG_DATABASE_URL: ""
      HISTORY_DATABASE_URL: ""
```

## FF Broker Configuration

The FF Broker is the LLM orchestration service that routes requests to configured AI providers.

```yaml
ff-broker:
  enabled: true
  replicaCount: 1

  # Image configuration
  image:
    repository: firebranddevet.azurecr.io/ff-llm-broker
    tag: ""                    # Defaults to chart appVersion
    pullPolicy: IfNotPresent

  # Database connection
  configMap:
    data:
      PGF_HOST: "firefoundry-core-postgresql"
      PGF_PORT: "5432"
      PGF_DATABASE: "firefoundry"
      PGF_USER: "firebroker"
      GRPC_PORT: "50051"
      HTTP_PORT: "3000"
      CONSOLE_LOG_LEVEL: "info"
      # Context Service integration
      CONTEXT_SERVICE_ADDRESS: "firefoundry-core-context-service:50051"

  secret:
    data:
      PGF_PWD: ""              # Required: database password
      CONTEXT_SERVICE_API_KEY: ""  # Required: context service API key
      # LLM Provider credentials (configure as needed)
      AZURE_OPENAI_KEY: ""

  # Bootstrap job (self-contained deployments)
  bootstrap:
    enabled: true              # Enable for self-contained deployments
    waitForDatabase: true      # Wait for bundled PostgreSQL to be ready
    registryDatabase: "broker_registry"
    seedRegistry: true         # Seed model catalog from FireFoundry
    registrySeedUrl: ""        # Uses default FireFoundry registry backup

  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "1Gi"
      cpu: "500m"
```

### Bootstrap Job

For self-contained deployments, the bootstrap job initializes the broker's database schemas and seeds the model catalog:

| Setting | Description | Default |
|---------|-------------|---------|
| `bootstrap.enabled` | Run database initialization job | `false` |
| `bootstrap.waitForDatabase` | Wait for PostgreSQL before running | `false` |
| `bootstrap.seedRegistry` | Seed model catalog from FireFoundry | `true` |
| `bootstrap.registrySeedUrl` | URL to model catalog backup | FireFoundry hosted |

When `seedRegistry` is enabled, the bootstrap job downloads and restores the model catalog, which includes:
- Supported LLM providers (Azure OpenAI, Amazon Bedrock, Anthropic, etc.)
- Available models and their capabilities
- Model family and version information

To skip registry seeding (e.g., for air-gapped environments with manual configuration):

```yaml
ff-broker:
  bootstrap:
    enabled: true
    seedRegistry: false
```

### LLM Provider Credentials

Configure credentials for your LLM providers in the secret:

```yaml
ff-broker:
  secret:
    data:
      # Azure OpenAI
      AZURE_OPENAI_KEY: "your-azure-openai-key"

      # Additional providers configured via Provider Accounts in the database
```

Provider accounts (API endpoints, keys, and model mappings) are configured in the broker database after deployment. See the FF Console documentation for provider account management.

## Code Sandbox Configuration

<!-- TODO: Document Code Sandbox settings -->

```yaml
code-sandbox:
  enabled: false
  # TODO: Add configuration options
```

## Entity Service Configuration

<!-- TODO: Document Entity Service settings -->

```yaml
entity-service:
  enabled: false
  # TODO: Add configuration options
```

## Doc Proc Service Configuration

<!-- TODO: Document Doc Proc Service settings -->

```yaml
doc-proc-service:
  enabled: false
  # TODO: Add configuration options
```

## Ingress Configuration

<!-- TODO: Document ingress options -->

```yaml
ingress:
  enabled: false
  className: ""
  annotations: {}
  hosts: []
  tls: []
```

## Resource Recommendations

| Component | Dev/Test | Production |
|-----------|----------|------------|
| PostgreSQL | 256Mi-1Gi, 100m-500m | 2Gi-8Gi, 500m-2000m |
| MinIO | 256Mi-1Gi, 100m-500m | 2Gi-8Gi, 500m-2000m |
| Context Service | 128Mi-512Mi, 50m-200m | 512Mi-2Gi, 200m-1000m |
| FF Broker | 256Mi-1Gi, 100m-500m | 1Gi-4Gi, 500m-2000m |

## Environment Variables Reference

See each service's documentation for complete environment variable references:

- [Context Service Environment Variables](./context-service-minio.md#environment-variables-reference)

<!--
TODO: This document needs significant expansion with:
- Complete FF Broker configuration
- Code Sandbox configuration
- Entity Service configuration
- Doc Proc Service configuration
- Network policies
- Service mesh configuration
- Monitoring/observability settings
- Backup and restore configuration
-->
