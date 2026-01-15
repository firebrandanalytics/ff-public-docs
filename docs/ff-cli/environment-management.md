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
- `code-sandbox`: Executes code in isolated sandbox environments
- `doc-proc-service`: Processes and extracts information from documents

**Configuration Flexibility**: Each environment has its own database, logging, storage, and API key configuration.

### Templates

Templates are reusable environment configurations stored as JSON files. They allow you to:

- Define standard environment configurations once
- Create multiple environments with consistent settings
- Maintain separate templates for dev, staging, and production
- Version control your environment configurations
- Share environment configurations across teams

Templates are stored in `~/.ff/environments/templates/` and use placeholder values (e.g., `{{azure_connection_string}}`) that you can fill in when creating environments.

### Service Versions

When creating environments, ff-cli can discover available chart versions from your cluster's helm-api service. This allows you to:

- Select specific versions of the `firefoundry-core` chart
- Pin environments to stable versions
- Test new versions in isolated environments
- Roll back to previous versions if needed

Chart versions are automatically fetched and presented during the interactive creation process.

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
ff-cli environment create [OPTIONS]
```

#### Interactive Configuration

When run without options, the command launches an interactive configuration wizard that prompts for:

1. **Environment Name**: The name of the environment (also the Kubernetes namespace)
2. **Chart Version**: Select from available versions discovered from your cluster, or enter manually
3. **Enabled Services**: Multi-select which FireFoundry services to enable
4. **Logging Provider**: Choose Azure or GCP for logging
   - Azure: Requires connection string
   - GCP: Requires project ID and service account key
5. **Database Configuration**: Database host, name, and passwords (admin, read, insert, broker)
6. **API Keys**: Context service API key, working memory storage key
7. **Broker Secrets**: LLM provider API keys (e.g., `OPENAI_API_KEY`)
8. **Code Sandbox Connection Strings**: (Optional, only if code-sandbox service enabled)

The wizard uses intelligent defaults from your current profile when available.

#### Options and Flags

- `-f, --file <PATH>`: Load configuration from a JSON or YAML file instead of interactive prompts
- `-t, --template <NAME>`: Use a saved template instead of interactive prompts
- `-s, --simple`: Use simplified menu-based configuration (same as default interactive mode)
- `-n, --name <NAME>`: Override environment name from template/file, or specify directly
- `-y, --yes`: Skip confirmation prompt and create immediately

#### Service Configuration

The following services can be enabled during environment creation:

| Service | Description | Default |
|---------|-------------|---------|
| `ff-broker` | LLM request router and provider abstraction | Yes |
| `context-service` | Agent context and memory management | Yes |
| `entity-service` | Entity management and relationships | Yes |
| `code-sandbox` | Isolated code execution environment | No |
| `doc-proc-service` | Document processing and extraction | No |

The default selection includes the core services required for most agent workloads.

#### Chart Version Selection

When creating environments interactively, ff-cli:

1. Connects to the helm-api service in your cluster
2. Fetches available versions of the `firefoundry-core` chart
3. Presents versions in a selection menu, with the latest version as the default
4. Falls back to manual entry if helm-api is unavailable

This ensures you're always working with versions that are available in your cluster's Helm repository.

#### Examples

**Create environment with interactive prompts:**
```bash
ff-cli environment create
```

**Create environment from a template:**
```bash
ff-cli environment create --template production --name prod-2024-01
```

**Create environment from configuration file:**
```bash
ff-cli environment create --file dev-config.yaml
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

Templates use placeholder syntax (`{{variable_name}}`) for values that should differ between environments (like passwords and API keys).

### `ff-cli environment template create` Command

#### Creating a Template

Create a new template by copying the default configuration and opening it in your editor.

**Usage:**
```bash
ff-cli environment template create <NAME>
```

**Behavior:**
1. Copies `~/.ff/environments/default.json` to `~/.ff/environments/templates/<NAME>.json`
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
  "environment_name": "TEMPLATE_PLACEHOLDER",
  "chart_version": "0.9.0",
  "enabled_services": ["ff-broker", "context-service", "entity-service"],
  "logging": {
    "provider": "azure",
    "azure": {
      "connection_string": "{{azure_connection_string}}"
    }
  },
  "database": {
    "host": "your-postgres-host.postgres.database.azure.com",
    "database": "ff_int_dev",
    "admin_password": "{{admin_password}}",
    "read_password": "{{read_password}}",
    "insert_password": "{{insert_password}}",
    "broker": {
      "password": "{{broker_password}}"
    }
  },
  "context_service_api_key": "{{context_service_api_key}}",
  "working_memory_storage_key": "{{working_memory_storage_key}}",
  "mcp_sql_api_key": "{{mcp_sql_api_key}}",
  "broker_secrets": [
    {
      "name": "OPENAI_API_KEY_EUS2",
      "value": "{{openai_api_key}}"
    }
  ],
  "code_sandbox_connection_strings": [
    {
      "name": "ANALYTICS",
      "value": "postgresql://fireread:{{read_password}}@your-host:5432/firekicks?ssl=true"
    }
  ]
}
```

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

**Create from template with prompts for placeholders:**
```bash
ff-cli environment create --template dev
# Will prompt for environment name and any {{placeholder}} values
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
      "enabled_services": ["ff-broker", "context-service", "entity-service"]
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
  "environment_name": "preview-environment",
  "chart_version": "0.9.0",
  "enabled_services": ["ff-broker", "context-service", "entity-service"],
  "database": {
    "host": "your-postgres-host.postgres.database.azure.com",
    "database": "ff_int_dev",
    "port": 5432,
    "ssl_disabled": false
  },
  "logging": {
    "provider": "azure"
  }
}
```

## Configuration

### Configuration Files

Environment configuration can be provided via JSON or YAML files.

#### JSON Configuration Example

```json
{
  "environment_name": "my-dev-env",
  "chart_version": "0.9.0",
  "enabled_services": ["ff-broker", "context-service", "entity-service"],
  "logging": {
    "provider": "azure",
    "azure": {
      "connection_string": "DefaultEndpointsProtocol=https;..."
    }
  },
  "database": {
    "host": "postgres.example.com",
    "database": "firefoundry_dev",
    "admin_password": "admin_secret",
    "read_password": "read_secret",
    "insert_password": "insert_secret",
    "broker": {
      "password": "broker_secret"
    }
  },
  "context_service_api_key": "context_key_123",
  "working_memory_storage_key": "wm_key_456",
  "mcp_sql_api_key": "mcp_key_789",
  "broker_secrets": [
    {
      "name": "OPENAI_API_KEY",
      "value": "sk-..."
    }
  ]
}
```

#### YAML Configuration Example

```yaml
environment_name: my-dev-env
chart_version: "0.9.0"
enabled_services:
  - ff-broker
  - context-service
  - entity-service
logging:
  provider: azure
  azure:
    connection_string: "DefaultEndpointsProtocol=https;..."
database:
  host: postgres.example.com
  database: firefoundry_dev
  admin_password: admin_secret
  read_password: read_secret
  insert_password: insert_secret
  broker:
    password: broker_secret
context_service_api_key: context_key_123
working_memory_storage_key: wm_key_456
mcp_sql_api_key: mcp_key_789
broker_secrets:
  - name: OPENAI_API_KEY
    value: sk-...
```

### Environment Variables

The following environment variables affect environment management:

| Variable | Description | Default |
|----------|-------------|---------|
| `HOME` or `USERPROFILE` | User home directory for template storage | System default |
| `EDITOR` | Editor for template editing | `vim`, `vi`, or system default |

### Service Configuration

Each service in a FireFoundry environment can be configured through the environment configuration. Service-specific settings are part of the Helm chart values.

#### Database Configuration

All services share database configuration:
- **host**: PostgreSQL server hostname
- **database**: Database name
- **port**: Database port (default: 5432)
- **ssl_disabled**: Disable SSL connections (default: false)
- **admin_password**: Admin user password
- **read_password**: Read-only user password
- **insert_password**: Insert-only user password
- **broker.password**: Broker-specific database password

#### Logging Configuration

Centralized logging for all services:

**Azure:**
```json
{
  "logging": {
    "provider": "azure",
    "azure": {
      "connection_string": "DefaultEndpointsProtocol=...",
      "log_level": "info"
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
      "project_id": "my-gcp-project",
      "log_name": "firefoundry-logs",
      "service_account_key": "{...}"
    }
  }
}
```

#### Storage Configuration

Optional object storage configuration for artifacts:

**MinIO:**
```json
{
  "minio": {
    "endpoint": "minio.example.com:9000",
    "access_key": "access_key",
    "secret_key": "secret_key",
    "bucket": "firefoundry"
  }
}
```

**Cloud Storage:**
```json
{
  "storage": {
    "provider": "azure",
    "azure": {
      "connection_string": "DefaultEndpointsProtocol=...",
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
- Set `chart_version` to a stable development version
- Enable core services: `ff-broker`, `context-service`, `entity-service`
- Use a shared development database
- Use placeholder values for secrets

**Step 2: Create personal development environment**
```bash
ff-cli environment create --template dev --name alice-dev
```

The command will:
1. Load the dev template
2. Prompt for environment-specific values (passwords, API keys)
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
   ff-cli environment create --template dev
   # Select "latest" when prompted for version
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
- [`ff-cli agent-bundle deploy`](./agent-bundles.md) - Deploy agent bundles to environments
- [`ff-cli config`](./configuration.md) - Configure ff-cli settings

## See Also

- [Deployment Guide](../operations/deployment.md) - Best practices for environment deployment
- [Security Guide](../operations/security.md) - Securing environments and secrets
- [Agent Bundle Guide](./agent-bundles.md) - Deploying agents to environments
- [Profile Management](./profiles.md) - Managing profile defaults
