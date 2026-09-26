# Environment Management

## Overview

FireFoundry environments are isolated Kubernetes namespaces containing a full deployment of the FireFoundry Core platform with all necessary services. Environment management enables developers to create, configure, and manage multiple isolated environments for development, staging, testing, and production workloads.

Each environment includes:
- A dedicated Kubernetes namespace
- The `firefoundry-core` Helm release
- Configurable FireFoundry services (broker, context service, entity service, etc.)
- Isolated database configuration
- Service-specific secrets and API keys
- Network isolation from other environments

## Concepts

### What is a FireFoundry Environment?

A FireFoundry environment is a namespace with the `firefoundry-core` Helm chart installed. The environment provides:

**Namespace Isolation**: Each environment runs in its own Kubernetes namespace, ensuring complete resource isolation between environments.

**Service Selection**: Choose which FireFoundry services to enable based on your use case:
- `ff-broker`: Routes LLM requests to different providers (OpenAI, Anthropic, etc.)
- `context-service`: Manages agent context and memory
- `entity-service`: Handles entity management and relationships
- `code-sandbox-v2`: Runs AI-generated TypeScript and Python in isolated containers ([Code Sandbox](../firefoundry/platform/services/code-sandbox/README.md)). `code-sandbox` is the deprecated legacy sandbox; don't enable it for new environments
- `doc-proc-service`: Processes and extracts information from documents

**Configuration Flexibility**: Each environment has its own database, logging, storage, and API key configuration.

### Templates

Templates are reusable environment configurations stored as JSON files. They allow you to:

- Define standard environment configurations once
- Create multiple environments with consistent settings
- Maintain separate templates for dev, staging, and production
- Version control your environment configurations
- Share environment configurations across teams

ff-cli ships three built-in templates (`minimal-self-contained`, `full-self-contained`, `external-database`), and you can add your own in `~/.ff/environments/templates/`. Templates contain placeholder values (for example `PLACEHOLDER_CONTEXT_SERVICE_API_KEY` or `REPLACE_WITH_ADMIN_PASSWORD`) that you replace by editing the template before creating an environment. ff-cli does not prompt for or substitute placeholder values.

### Service Versions

Each environment pins a version of the `firefoundry-core` chart, set with the `chartVersion` key. This allows you to:

- Select specific versions of the `firefoundry-core` chart
- Pin environments to stable versions
- Test new versions in isolated environments
- Roll back to previous versions if needed

If `chartVersion` is omitted, the latest available version is used. To see which versions your cluster's helm-api can install, run `ff-cli environment upgrade <name> --list-versions` against an existing environment.

## Creating Environments

### `ff-cli environment create` Command

#### Purpose

Create a new FireFoundry environment with core services. Use this command when you need to:
- Set up a new development environment
- Create a staging environment for testing
- Deploy a production environment
- Spin up an isolated environment for a specific project or team

#### Usage

```bash
ff-cli environment create (--template <NAME> | --file <PATH>) --name <NAME> [--yes]
```

#### Configuration Source

There is no interactive configuration wizard. The whole configuration comes from a template (`--template`) or a JSON configuration file (`--file`); exactly one of the two is required, along with `--name`. Before deploying, the command prints a summary (name, chart version, enabled services, and whether the database is bundled or external) and asks `Deploy this environment? [y/N]`, unless you pass `--yes`.

To customize an environment, edit a template or configuration file first. The configuration covers:

1. **Environment Name** (`environmentName`): The name of the environment (also the Kubernetes namespace). `--name` overrides it
2. **Chart Version** (`chartVersion`): The `firefoundry-core` chart version; omit it to use the latest
3. **Enabled Services** (`enabledServices`): Which FireFoundry services to enable
4. **Logging** (`logging`): Logging provider settings
   - Azure: `logging.azure.connectionString`
   - GCP: `logging.gcp.projectId` and `logging.gcp.serviceAccountKey`
5. **Database Configuration**: Either bundled PostgreSQL (`postgresql`) or an external database (`database`: host, name, and passwords for admin, read, insert, and broker)
6. **API Keys** (`contextServiceApiKey`, `workingMemoryStorageKey`, `mcpSqlApiKey`)
7. **Broker Secrets** (`brokerSecrets`): LLM provider API keys (e.g., `OPENAI_API_KEY`)
8. **Code Sandbox Connection Strings** (`codeSandboxConnectionStrings`): Optional, legacy `code-sandbox` service only. Code Sandbox v2 reaches databases through the Data Access Service, configured per profile

Keys are camelCase. Unrecognized keys (including snake_case spellings such as `enabled_services`) are ignored, and ff-cli prints a warning naming them. To check a configuration against the Helm API schema without creating anything, run `ff-cli environment config-schema validate --template <NAME>` (or `--file <PATH>`).

#### Options and Flags

- `-t, --template <NAME>`: Use a built-in or saved template
- `-f, --file <PATH>`: Load configuration from a JSON file
- `-n, --name <NAME>`: Environment name (required); overrides `environmentName` from the template or file
- `-y, --yes`: Skip confirmation prompt and create immediately

#### Service Configuration

Services are enabled by listing them in `enabledServices`. The most common ones:

| Service | Description | In built-in templates |
|---------|-------------|---------|
| `ff-broker` | LLM request router and provider abstraction | Yes |
| `context-service` | Agent context and memory management | Yes |
| `entity-service` | Entity management and relationships | Yes |
| `code-sandbox-v2` | Isolated TypeScript/Python code execution (Code Sandbox v2) | Yes |
| `doc-proc-service` | Document processing and extraction | Yes |

The built-in templates include the core services required for most agent workloads. `full-self-contained` also enables `websearch-service`, `mcp-gateway`, `log-proxy-service`, `virtual-worker-manager`, `knowledge-service`, `skills-service`, and `identity-service`.

#### Chart Version Selection

ff-cli does not present a version menu during creation:

1. If the configuration sets `chartVersion`, that version is deployed
2. If `chartVersion` is omitted, the latest version available from your cluster's helm-api is used, and the command reports which version was deployed
3. To list available versions, run `ff-cli environment upgrade <name> --list-versions` against an existing environment

This ensures you're always working with versions that are available in your cluster's Helm repository.

#### Examples

**Create environment from a built-in template:**
```bash
ff-cli environment create --template minimal-self-contained --name my-env
```

**Create environment from a template:**
```bash
ff-cli environment create --template production --name prod-2024-01
```

**Create environment from configuration file:**
```bash
ff-cli environment create --file dev-config.json --name dev-env
```

**Create environment with name override:**
```bash
ff-cli environment create --template dev --name alice-dev
```

**Create environment without confirmation:**
```bash
ff-cli environment create --template staging --name staging-2 --yes
```

#### Generated Artifacts

When an environment is created, the following resources are deployed to your cluster:

**Kubernetes Resources:**
- Namespace: Created with the environment name
- HelmRelease: Named `firefoundry-core` in the environment namespace
- Services: Kubernetes services for each enabled component
- Deployments: Deployments for each enabled service
- Secrets: API keys, database credentials, provider secrets
- ConfigMaps: Service configuration

**Service Endpoints:**
Each enabled service gets its own endpoint within the namespace, accessible via Kubernetes DNS.

## Using Templates

### Template Overview

Templates provide reusable environment configurations that ensure consistency across multiple deployments. Common use cases:

- **Development Template**: Minimal services, shared test database, low resource limits
- **Staging Template**: All services enabled, staging database, production-like configuration
- **Production Template**: All services, production database, high availability, resource guarantees

Templates use placeholder values (such as `REPLACE_WITH_ADMIN_PASSWORD`) for values that should differ between environments (like passwords and API keys). Replace them by editing the template; ff-cli deploys values as written.

### `ff-cli environment template create` Command

#### Creating a Template

Create a new template by copying a base configuration and opening it in your editor.

**Usage:**
```bash
ff-cli environment template create <NAME> [--from <TEMPLATE>]
```

**Behavior:**
1. Copies the base configuration to `~/.ff/environments/templates/<NAME>.json`. The base is the template named by `--from` (built-in or user), or else `~/.ff/environments/default.json` if it exists, or else the built-in `minimal-self-contained` template
2. Opens the file in your default editor (`$EDITOR`)
3. Waits for you to save and close the editor
4. Validates and saves the template

**Examples:**

Create a development template:
```bash
ff-cli environment template create dev
```

Create a production template:
```bash
ff-cli environment template create production
```

**Template Structure:**

Templates are JSON files with the following structure:

```json
{
  "environmentName": "TEMPLATE_PLACEHOLDER",
  "chartVersion": "0.9.0",
  "enabledServices": ["ff-broker", "context-service", "entity-service", "code-sandbox-v2"],
  "logging": {
    "provider": "azure",
    "azure": {
      "connectionString": "REPLACE_WITH_AZURE_CONNECTION_STRING"
    }
  },
  "database": {
    "host": "your-postgres-host.postgres.database.azure.com",
    "database": "ff_int_dev",
    "adminPassword": "REPLACE_WITH_ADMIN_PASSWORD",
    "readPassword": "REPLACE_WITH_READ_PASSWORD",
    "insertPassword": "REPLACE_WITH_INSERT_PASSWORD",
    "broker": {
      "password": "REPLACE_WITH_BROKER_PASSWORD"
    }
  },
  "contextServiceApiKey": "REPLACE_WITH_CONTEXT_SERVICE_API_KEY",
  "workingMemoryStorageKey": "REPLACE_WITH_WORKING_MEMORY_STORAGE_KEY",
  "mcpSqlApiKey": "REPLACE_WITH_MCP_SQL_API_KEY",
  "brokerSecrets": [
    {
      "name": "OPENAI_API_KEY_EUS2",
      "value": "REPLACE_WITH_OPENAI_API_KEY"
    }
  ],
  "codeSandboxConnectionStrings": []
}
```

The `environmentName` value `TEMPLATE_PLACEHOLDER` is replaced by `--name` when you create an environment. Replace the other placeholder values with real values before creating an environment; they are deployed as written. To see a complete built-in template, run `ff-cli environment template show minimal-self-contained`.

### `ff-cli environment template list` Command

List all available templates with details.

**Usage:**
```bash
ff-cli environment template list
```

**Output:**
```
┌────────────┬────────────────────────────────────────────────┬──────────┐
│ Name       │ Path                                           │ Size     │
├────────────┼────────────────────────────────────────────────┼──────────┤
│ dev        │ /home/user/.ff/environments/templates/dev.json │ 2.3 KB   │
│ production │ /home/user/.ff/environments/templates/prod.json│ 2.5 KB   │
│ staging    │ /home/user/.ff/environments/templates/stage.json│ 2.4 KB   │
└────────────┴────────────────────────────────────────────────┴──────────┘
```

### `ff-cli environment template edit` Command

Edit an existing template in your default editor.

**Usage:**
```bash
ff-cli environment template edit <NAME>
```

**Special Case:**
```bash
ff-cli environment template edit default
```
This edits the default template at `~/.ff/environments/default.json` (used as the base for new templates).

**Examples:**

Edit the development template:
```bash
ff-cli environment template edit dev
```

Update production template:
```bash
ff-cli environment template edit production
```

### `ff-cli environment template delete` Command

Delete a template permanently.

**Usage:**
```bash
ff-cli environment template delete <NAME>
```

**Examples:**

Delete an old template:
```bash
ff-cli environment template delete old-dev
```

### Using Templates for Environment Creation

Templates streamline environment creation by providing pre-configured settings.

**Create from template:**
```bash
ff-cli environment create --template dev --name dev-env
# --name is required; placeholder values must already be replaced in the template
```

**Create with name override:**
```bash
ff-cli environment create --template staging --name staging-qa
# Uses staging template but names the environment "staging-qa"
```

**Create multiple environments from the same template:**
```bash
ff-cli environment create --template dev --name alice-dev
ff-cli environment create --template dev --name bob-dev
ff-cli environment create --template dev --name carol-dev
```

## Managing Environments

### `ff-cli environment list` Command

List all FireFoundry environments in the current cluster.

**Usage:**
```bash
ff-cli environment list
```

**Behavior:**
- Connects to your cluster's helm-api
- Queries for all HelmReleases named `firefoundry-core`
- Returns the namespace names (which are the environment names)

**Output:**
```
Environments:
  - dev-alice
  - dev-bob
  - staging-qa
  - prod-2024-01
```

**Empty Cluster:**
```
No environments found
```

### `ff-cli environment get` Command

Get detailed information about a specific environment.

**Usage:**
```bash
ff-cli environment get <ENVIRONMENT_NAME>
```

**Behavior:**
- Retrieves the HelmRelease resource via kubectl
- Returns the full Kubernetes resource as JSON
- Shows status, configuration, and installed version

**Example:**
```bash
ff-cli environment get dev-alice
```

**Output:** (abbreviated)
```json
{
  "apiVersion": "helm.toolkit.fluxcd.io/v2beta1",
  "kind": "HelmRelease",
  "metadata": {
    "name": "firefoundry-core",
    "namespace": "dev-alice"
  },
  "spec": {
    "chart": {
      "spec": {
        "chart": "firefoundry-core",
        "version": "0.9.0"
      }
    },
    "values": {
      "enabledServices": ["ff-broker", "context-service", "entity-service"]
    }
  },
  "status": {
    "conditions": [
      {
        "type": "Ready",
        "status": "True"
      }
    ]
  }
}
```

### `ff-cli environment delete` Command

#### Purpose

Delete a FireFoundry environment by removing the `firefoundry-core` HelmRelease from the namespace. Use this when:
- Tearing down a temporary development environment
- Removing old staging environments
- Decommissioning test environments
- Cleaning up unused resources

**Warning:** This operation is destructive and removes all environment resources.

#### Usage

```bash
ff-cli environment delete <ENVIRONMENT_NAME>
```

#### Confirmation

The command requires confirmation before proceeding (unless `--yes` flag is used elsewhere). You'll be prompted to verify:
- The environment name
- The Kubernetes cluster context
- That you understand data will be deleted

#### Data Loss Warning

Deleting an environment removes:
- The `firefoundry-core` HelmRelease
- All Kubernetes resources in the namespace (deployments, services, secrets, etc.)
- Service data stored in cluster resources

**Note:** This does NOT delete:
- External database data (if using an external database)
- External storage buckets (if using cloud storage)
- Logs in external logging systems

#### Examples

**Delete a development environment:**
```bash
ff-cli environment delete dev-alice
```

**Output:**
```
Environment 'dev-alice' deleted successfully
```

**Delete non-existent environment:**
```bash
ff-cli environment delete does-not-exist
```

**Output:**
```
Error: Environment 'does-not-exist' not found (no firefoundry-core HelmRelease in namespace 'does-not-exist')
```

## Preview Command

### `ff-cli environment preview`

Preview environment configuration without creating it (dry-run).

**Usage:**
```bash
ff-cli environment preview [OPTIONS]
```

**Options:**
- `-f, --file <PATH>`: Preview configuration from file
- `-t, --template <NAME>`: Preview configuration from template

**Purpose:**
- Validate configuration before creating environment
- Review computed values and defaults
- Check chart configuration without cluster changes
- Debug configuration issues

**Examples:**

Preview template before creating:
```bash
ff-cli environment preview --template production
```

Preview configuration file:
```bash
ff-cli environment preview --file staging.yaml
```

**Output:**
The command returns the full configuration that would be sent to the helm-api, including all computed values and defaults:

```json
{
  "environmentName": "preview-environment",
  "chartVersion": "0.9.0",
  "enabledServices": ["ff-broker", "context-service", "entity-service"],
  "database": {
    "host": "your-postgres-host.postgres.database.azure.com",
    "database": "ff_int_dev",
    "port": 5432,
    "sslDisabled": false
  },
  "logging": {
    "provider": "azure"
  }
}
```

## Configuration

### Configuration Files

Environment configuration is provided as a JSON file (`--file`). Keys are camelCase and match the template format.

#### JSON Configuration Example

```json
{
  "environmentName": "my-dev-env",
  "chartVersion": "0.9.0",
  "enabledServices": ["ff-broker", "context-service", "entity-service"],
  "logging": {
    "provider": "azure",
    "azure": {
      "connectionString": "DefaultEndpointsProtocol=https;..."
    }
  },
  "database": {
    "host": "postgres.example.com",
    "database": "firefoundry_dev",
    "adminPassword": "admin_secret",
    "readPassword": "read_secret",
    "insertPassword": "insert_secret",
    "broker": {
      "password": "broker_secret"
    }
  },
  "contextServiceApiKey": "context_key_123",
  "workingMemoryStorageKey": "wm_key_456",
  "mcpSqlApiKey": "mcp_key_789",
  "brokerSecrets": [
    {
      "name": "OPENAI_API_KEY",
      "value": "sk-..."
    }
  ]
}
```

#### YAML Configuration Files

YAML is not supported yet. A `.yaml` or `.yml` file passed to `--file` is parsed as JSON, so use JSON configuration files.

### Environment Variables

The following environment variables affect environment management:

| Variable | Description | Default |
|----------|-------------|---------|
| `HOME` or `USERPROFILE` | User home directory for template storage | System default |
| `EDITOR` | Editor for template editing | `nano`, then `vim` or `vi` if available |

### Service Configuration

Each service in a FireFoundry environment can be configured through the environment configuration. Service-specific settings are part of the Helm chart values.

#### Database Configuration

All services share database configuration. For an external database, set `database`:
- **host**: PostgreSQL server hostname
- **database**: Database name
- **port**: Database port (default: 5432)
- **sslDisabled**: Disable SSL connections (default: false)
- **adminUsername**: Admin user name
- **adminPassword**: Admin user password
- **readPassword**: Read-only user password
- **insertPassword**: Insert-only user password
- **broker.username** / **broker.password**: Broker-specific database credentials

For a database deployed inside the environment, set `postgresql` instead (`enabled: true`, plus optional `database`, `storageSize`, and `passwords`), as the self-contained built-in templates do.

#### Logging Configuration

Centralized logging for all services:

**Azure:**
```json
{
  "logging": {
    "provider": "azure",
    "azure": {
      "connectionString": "DefaultEndpointsProtocol=...",
      "logLevel": "info"
    }
  }
}
```

**GCP:**
```json
{
  "logging": {
    "provider": "gcp",
    "gcp": {
      "projectId": "my-gcp-project",
      "logName": "firefoundry-logs",
      "serviceAccountKey": "{...}"
    }
  }
}
```

#### Storage Configuration

Object storage for artifacts is either MinIO deployed in the environment (`minio`) or external storage (`storage`):

**Bundled MinIO:**
```json
{
  "minio": {
    "enabled": true,
    "defaultBuckets": "context-service,doc-proc",
    "storageSize": "10Gi",
    "auth": {
      "rootUser": "minio_user",
      "rootPassword": "minio_password"
    }
  }
}
```

**Cloud Storage** (`provider` is `s3`, `azure`, or `gcs`; S3 uses `s3.endpoint`, `s3.bucket`, `s3.accessKeyId`, `s3.secretAccessKey`):
```json
{
  "storage": {
    "provider": "azure",
    "azure": {
      "storageKey": "REPLACE_WITH_STORAGE_KEY",
      "container": "firefoundry"
    }
  }
}
```

## Common Workflows

### Create Development Environment

**Step 1: Create a development template (one-time setup)**
```bash
ff-cli environment template create dev
```

Edit the template to:
- Set `chartVersion` to a stable development version
- Enable core services: `ff-broker`, `context-service`, `entity-service`
- Use a shared development database
- Use placeholder values for secrets

**Step 2: Create personal development environment**
```bash
ff-cli environment create --template dev --name alice-dev
```

The command will:
1. Load the dev template
2. Apply the environment name from `--name`
3. Show confirmation with environment details
4. Create the environment in your cluster

**Step 3: Verify environment**
```bash
ff-cli environment list
ff-cli environment get alice-dev
```

**Step 4: Deploy agent bundles to environment**
```bash
ff-cli agent-bundle deploy my-agent --environment alice-dev
```

### Create Environment from Template

**Scenario: Create a staging environment for QA testing**

```bash
# Use the staging template with specific name
ff-cli environment create --template staging --name staging-qa-sprint-15

# Verify creation
ff-cli environment get staging-qa-sprint-15

# Deploy agent bundles for testing
ff-cli agent-bundle deploy customer-service-agent --environment staging-qa-sprint-15
```

### Update Environment Configuration

**Scenario: Update service configuration in an existing environment**

Environment configuration is immutable once created. To update:

**Option 1: Modify the HelmRelease directly**
```bash
# Edit the HelmRelease resource
kubectl edit helmrelease firefoundry-core -n my-env

# Or update via values file
kubectl patch helmrelease firefoundry-core -n my-env --type merge -p '{"spec":{"values":{"newKey":"newValue"}}}'
```

**Option 2: Delete and recreate (for major changes)**
```bash
# Export agent bundles if needed
ff-cli agent-bundle list --environment my-env

# Delete environment
ff-cli environment delete my-env

# Recreate with updated configuration
ff-cli environment create --template updated-template --name my-env

# Redeploy agent bundles
ff-cli agent-bundle deploy my-agent --environment my-env
```

### Deploy Agent Bundle to Environment

**Scenario: Deploy an agent bundle to a specific environment**

```bash
# Create environment
ff-cli environment create --template production --name prod-2024-01

# Build agent bundle
cd my-agent-project
ff-cli agent-bundle build

# Deploy to environment
ff-cli agent-bundle deploy --environment prod-2024-01
```

The agent bundle will be deployed into the specified environment's namespace, with access to all services running in that environment.

## Troubleshooting

### Issue: "Failed to create environment via Helm API"

**Symptoms:**
```
Error: Failed to create environment via Helm API: connection refused
```

**Causes:**
- Helm API service is not running in your cluster
- Profile helm_api_endpoint is incorrect
- Network connectivity issues

**Solutions:**
1. Verify helm-api is running:
   ```bash
   kubectl get pods -n firefoundry-system | grep helm-api
   ```

2. Check profile configuration:
   ```bash
   ff-cli profile list
   ff-cli profile show <profile-name>
   ```

3. Test helm-api connectivity:
   ```bash
   ff-cli cluster status
   ```

### Issue: "Namespace already exists"

**Symptoms:**
```
Error: Cannot create environment 'my-env': namespace already exists.
Please choose a different environment name or delete the existing namespace first.
```

**Causes:**
- Environment with that name already exists
- Namespace exists from previous failed creation

**Solutions:**

1. Check existing environments:
   ```bash
   ff-cli environment list
   ```

2. Check namespace status:
   ```bash
   kubectl get namespace my-env
   ```

3. Delete namespace if safe:
   ```bash
   kubectl delete namespace my-env
   # or
   ff-cli environment delete my-env
   ```

4. Use a different name:
   ```bash
   ff-cli environment create --name my-env-2
   ```

### Issue: "Template not found"

**Symptoms:**
```
Error: Template 'production' not found at '/home/user/.ff/environments/templates/production.json'
```

**Causes:**
- Template doesn't exist
- Typo in template name
- Template directory not initialized

**Solutions:**

1. List available templates:
   ```bash
   ff-cli environment template list
   ```

2. Create the template:
   ```bash
   ff-cli environment template create production
   ```

3. Verify template path:
   ```bash
   ls -la ~/.ff/environments/templates/
   ```

### Issue: Chart version not available

**Symptoms:**
- Selected chart version fails to install
- Version not found in repository

**Causes:**
- Chart version doesn't exist in your Helm repository
- Repository not synced

**Solutions:**

1. List available versions:
   ```bash
   helm search repo firefoundry-core --versions
   ```

2. Update Helm repositories:
   ```bash
   helm repo update
   ```

3. Use latest version instead:
   ```bash
   # Remove chartVersion from the template (or file) to use the latest version
   ff-cli environment create --template dev --name my-env
   ```

### Issue: Database connection failures

**Symptoms:**
- Services fail to start
- Database connection errors in logs

**Causes:**
- Incorrect database host
- Wrong credentials
- Firewall rules blocking access
- SSL configuration mismatch

**Solutions:**

1. Verify database configuration:
   ```bash
   ff-cli environment get my-env | jq '.spec.values.database'
   ```

2. Test database connectivity from cluster:
   ```bash
   kubectl run -it --rm debug --image=postgres:14 --restart=Never -- \
     psql -h your-db-host -U fireread -d firefoundry_dev
   ```

3. Check service logs:
   ```bash
   kubectl logs -n my-env deployment/ff-broker
   ```

4. Verify SSL settings match database requirements

### Issue: Services not starting

**Symptoms:**
- Pods in CrashLoopBackOff
- Services not ready

**Causes:**
- Missing required configuration
- Invalid API keys
- Resource constraints

**Solutions:**

1. Check pod status:
   ```bash
   kubectl get pods -n my-env
   ```

2. Check pod logs:
   ```bash
   kubectl logs -n my-env <pod-name>
   ```

3. Describe pod for events:
   ```bash
   kubectl describe pod -n my-env <pod-name>
   ```

4. Verify HelmRelease status:
   ```bash
   ff-cli environment get my-env | jq '.status'
   ```

## Related Commands

Environment management integrates with other ff-cli commands:

- [`ff-cli cluster`](./cluster-management.md) - Cluster operations and connectivity
- [`ff-cli profile`](./profiles.md) - Profile management for environment defaults
- [`ff-cli ops deploy`](./ops.md) - Build and deploy agent bundles to environments

## See Also

- [Deployment Guide](../firefoundry/platform/deployment.md) - Best practices for environment deployment
- [Operations Guide](./ops.md) - Deploying agent bundles to environments
- [Profile Management](./profiles.md) - Managing profile defaults
