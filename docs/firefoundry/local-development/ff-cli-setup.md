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

### License File

FireFoundry requires a license file for cluster initialization and Docker image builds (the license is used as an npm token for private package authentication). Place your license at:

```
~/.ff/license.jwt
```

Contact the FireFoundry platform team if you need a license.

### Kubectl Context

The CLI automatically detects your Kubernetes context. Ensure kubectl is configured:

```bash
# Verify kubectl context
kubectl config current-context

# Should point to your local cluster (minikube, k3d, etc.)
```

## Create a Profile

Profiles store your CLI configuration — which cluster to target, registry settings, and defaults.

Create your first profile for local development:

```bash
ff-cli profile create local --kubectl-context minikube --registry-type Minikube --use
```

Or interactively:

```bash
ff-cli profile create local
```

When prompted:
1. **Configure registry settings?** Select **Minikube** (required for `ops build` to load images into minikube)
2. **Configure kubectl context?** Select **Yes**, then choose **minikube** from the list
3. **Set as current profile?** Select **Yes**

Verify your profile:

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

## Cluster Bootstrap

Before creating environments, you must initialize the cluster and install the control plane:

```bash
# Initialize cluster (installs Flux CRDs, creates registry secret)
ff-cli cluster init --license ~/.ff/license.jwt

# Install control plane (Kong, Helm API, Flux controllers)
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y
```

See the [Deployment Guide](../platform/deployment.md) for details.

## Environment Management

FireFoundry "environments" are namespaces containing your AI services (FF Broker, Entity Service, Context Service, Code Sandbox).

### Create an Environment

```bash
ff-cli env create -t minimal-self-contained -n ff-test -y
```

This will:
- Create a new Kubernetes namespace
- Deploy a HelmRelease for FireFoundry Core services
- Configure the services with appropriate defaults

Wait for the environment to be ready:

```bash
kubectl wait helmrelease/firefoundry-core -n ff-test --for=condition=Ready --timeout=600s
```

### List Environments

```bash
ff-cli env list
```

### Delete an Environment

```bash
ff-cli environment delete my-env
```

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
# Build a Docker image for your agent bundle (auto-loads into minikube)
ff-cli ops build my-bundle

# Install/upgrade an agent bundle to Kubernetes
ff-cli ops install my-bundle -y

# Deploy with a specific values file variant
ff-cli ops deploy my-bundle -y --values local
```

The build command uses the FireFoundry license as `FF_NPM_TOKEN` for authenticating with the GitHub npm registry during Docker builds. No separate GitHub PAT is required.

**Values file selection**: The `--values` flag selects which values file variant to use:
- `--values local` uses `helm/values.local.yaml` (default for minikube profiles)
- `--values dev` uses `helm/values.dev.yaml`
- If a base `helm/values.yaml` exists, it is chained automatically

For complete documentation, see the **[FF CLI Operations Guide](../../ff-cli/ops.md)**.

### Broker Configuration Commands

Configure LLM provider routing for your environment:

```bash
# Create a broker routing chain from a JSON config file
ff-cli env broker-config create ff-test -f gemini.json

# View a model group's routing configuration
ff-cli env broker-config show ff-test --model-group gemini_completion

# Add an API key secret to the broker
ff-cli env broker-secret add ff-test --key GEMINI_API_KEY --value "<your-key>" -y
```

### Application Management

```bash
# Create a new application monorepo
ff-cli application create my-app

# Create an agent bundle inside the monorepo
ff-cli agent-bundle create my-service

# Scaffold a Next.js web UI
ff-cli gui add dashboard
```

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
