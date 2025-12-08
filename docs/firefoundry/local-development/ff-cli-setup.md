# FireFoundry CLI Setup

The FireFoundry CLI (`ff-cli`) is used to manage FireFoundry environments and agent development workflows.

## Prerequisites

Before setting up the FireFoundry CLI, ensure you have completed:

1. **[Prerequisites](../getting-started/prerequisites.md)** - Core tools installed
2. **[Environment Setup](./environment-setup.md)** - Local cluster running
3. **[Deploy Services](../platform/deployment.md)** - Control plane deployed

## Installation

Download the FireFoundry CLI from the releases page:

[FireFoundry CLI Releases](https://github.com/firebrandanalytics/ff-cli-releases)

### macOS

```bash
# Download the macOS binary (Apple Silicon)
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-darwin-arm64

# Or for Intel Macs
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-darwin-amd64

# Make it executable
chmod +x ff-cli

# Move to your PATH
sudo mv ff-cli /usr/local/bin/
```

### Linux

```bash
# Download the Linux binary
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-linux-amd64

# Make it executable
chmod +x ff-cli

# Move to your PATH
sudo mv ff-cli /usr/local/bin/
```

### Windows

Download `ff-cli-windows-amd64.exe` from the releases page and add it to your PATH.

## Verify Installation

```bash
ff-cli --version
```

## Configuration

The CLI automatically detects your Kubernetes context. Ensure kubectl is configured:

```bash
# Verify kubectl context
kubectl config current-context

# Should point to your local cluster (minikube, k3d, etc.)
```

## Create a Profile

Profiles store your CLI configuration - which cluster to target, registry settings, and defaults for environment creation.

Create your first profile for local development:

```bash
ff-cli profile create local
```

When prompted:
1. **Configure registry settings?** Select **No** (or choose **Minikube** if you plan to build images)
2. **Configure kubectl context?** Select **Yes**, then choose **minikube** from the list
3. **Set as current profile?** Select **Yes**

You can verify your profile:

```bash
# List all profiles
ff-cli profile list

# Show current profile details
ff-cli profile show
```

### Profile Commands Reference

| Command | Description |
|---------|-------------|
| `ff-cli profile list` | List all profiles |
| `ff-cli profile show [name]` | Show profile details |
| `ff-cli profile create [name]` | Create a new profile |
| `ff-cli profile select [name]` | Switch to a different profile |
| `ff-cli profile edit [name]` | Edit an existing profile |
| `ff-cli profile delete <name>` | Delete a profile |

## Template Setup (Firebrand Employees)

The `ff-cli` uses templates to configure environments. Firebrand employees can download the internal template automatically:

```bash
# Ensure you're logged into Azure with access to Firebrand R&D
az login
az account set --subscription "Firebrand R&D"

# Download and install the internal template
curl -fsSL https://raw.githubusercontent.com/firebrandanalytics/firefoundry-local/main/scripts/setup-ff-template.sh | bash
```

This creates `~/.ff/environments/templates/internal.json` with the standard internal development configuration.

**Note:** You must be a member of the Firebrand security group in Azure AD to download the template.

## Environment Management

FireFoundry "environments" are namespaces containing your AI services (FF Broker, Context Service, Code Sandbox).

### Create an Environment

```bash
# Create a new environment using the internal template
ff-cli environment create --template internal --name my-env
```

This will:
- Create a new Kubernetes namespace
- Deploy a HelmRelease for FireFoundry Core services
- Configure the services with appropriate defaults

### List Environments

```bash
ff-cli environment list
```

### Check Environment Status

```bash
ff-cli environment status my-env
```

### Delete an Environment

```bash
ff-cli environment delete my-env
```

## Available Templates

| Template | Description |
|----------|-------------|
| `internal` | Standard internal development setup with all core services |

## What the CLI Does

The `ff-cli` tool provides:

- **Environment Management**: Create, list, and delete FireFoundry environments
- **Operations Commands**: Build Docker images and deploy agent bundles to Kubernetes
- **Profile Management**: Configure registries and cluster targets for different environments
- **Status Monitoring**: Check the health and status of deployed services
- **Configuration**: Manage environment-specific settings

### Operations Commands

The `ops` commands handle building and deploying agent bundles:

```bash
# Build a Docker image for your agent bundle
ff-cli ops build my-bundle --minikube --tag latest

# Install an agent bundle to Kubernetes
ff-cli ops install my-bundle --namespace ff-dev

# Upgrade an existing deployment
ff-cli ops upgrade my-bundle --namespace ff-dev

# Check prerequisites
ff-cli ops doctor
```

For complete documentation, see the **[FF CLI Operations Guide](../../ff-cli/ops.md)**.

## Troubleshooting

### CLI Can't Connect to Cluster

```bash
# Verify kubectl is working
kubectl get nodes

# Check your context
kubectl config current-context
```

### Environment Creation Fails

Ensure the control plane is running:

```bash
# Check control plane pods
kubectl get pods -n ff-control-plane

# Verify Helm API is healthy
kubectl get pods -n ff-control-plane | grep helm-api
```

### Permission Denied

Ensure the CLI binary is executable:

```bash
chmod +x /usr/local/bin/ff-cli
```

## Next Steps

With the FireFoundry CLI installed, you're ready to:

1. **[Agent Development](./agent-development.md)** - Create your first agent bundle
2. **[FF CLI Operations Guide](../../ff-cli/ops.md)** - Learn build, install, and upgrade commands
3. **[FF CLI Profiles Guide](../../ff-cli/profiles.md)** - Configure registries for different environments
4. **[Operations & Maintenance](../platform/operations.md)** - Monitor and debug your agents
5. **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
