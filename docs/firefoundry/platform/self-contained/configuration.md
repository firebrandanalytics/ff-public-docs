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

<!-- TODO: Document FF Broker settings -->

```yaml
ff-broker:
  enabled: true
  replicaCount: 1
  # TODO: Add configuration options
```

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
