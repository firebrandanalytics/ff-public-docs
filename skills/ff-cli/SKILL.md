---
name: ff-cli
description: Use when running ff-cli commands for project creation, agent bundle scaffolding, building Docker images, deploying to Kubernetes, or managing FireFoundry environments and clusters.
---

# FireFoundry CLI Skill

Master the ff-cli tool for creating, building, and deploying FireFoundry agent bundle projects.

## Overview

The ff-cli is FireFoundry's command-line interface for the complete agent bundle lifecycle:

```
Project Creation -> Agent Bundle Development -> Build -> Deploy -> Operate
```

**Key capabilities:**
- Project scaffolding with monorepo structure
- Agent bundle creation from templates or examples
- Docker image building with multi-registry support
- Helm-based Kubernetes deployment
- Environment and cluster management
- Profile-based authentication

## When to Use This Skill

**Trigger phrases:**
- "Create a new FireFoundry project"
- "Add an agent bundle to my project"
- "Deploy my agent bundle"
- "Build and push the Docker image"
- "Set up a FireFoundry environment"
- "Configure ff-cli profiles"
- "Check my ff-cli setup"

**Use for:**
- New project initialization
- Agent bundle scaffolding
- Build and deployment operations
- Environment management
- Troubleshooting CLI issues

## Two Deployment Paths

The CLI has two fundamentally different deployment paths. Understanding which you're using matters:

### `ff-cli env create` — Platform Environments (Helm API + Flux)

Deploys **firefoundry-core** umbrella chart. Does NOT run Helm directly.

```
ff-cli env create → discovers Helm API endpoint (Kong or direct)
    ↓
POST /firefoundry-core with FireFoundryCoreRequest JSON
    ↓
Helm API creates: namespace + image pull secret + values Secret + HelmRelease CR
    ↓
Flux reconciles: fetches chart → renders with values → applies resources
```

**Use for:** Creating/managing core platform environments (the services that agent bundles connect to).

**Key detail:** Values are stored in a Kubernetes Secret, not files. The `FireFoundryCoreRequest` struct in `ff-cli-go/internal/clients/helmapi/types.go` defines what the CLI can pass through.

### `ff-cli ops install/deploy` — Agent Bundles (Direct Helm)

Deploys individual **agent bundle** charts. Runs Helm CLI directly.

```
ff-cli ops deploy my-agent → builds Docker image → pushes to registry
    ↓
Resolves values files: values.yaml → values.local.yaml → secrets.yaml
    ↓
helm install my-agent <chart> -f values.yaml -f values.local.yaml -f secrets.yaml
```

**Use for:** Deploying your application's agent bundles into an existing environment.

**Key detail:** Uses local Helm values files from the agent bundle's `helm/` directory. The `--values` flag adds environment-specific overrides.

## When NOT to Use This Skill

- For writing TypeScript code for agent bundles → Use the `ff-agent-sdk` skill
- For entity modeling, bot behavior, or SDK APIs → Use the `ff-agent-sdk` skill
- For first-time local setup or license questions → Use the `ff-local-dev` skill
- For Kubernetes debugging unrelated to ff-cli deployments

## Related Skills

| Skill | Use For |
|-------|---------|
| `ff-cli` (this) | Running CLI commands for projects, builds, deploys, environments |
| `ff-service-release` | Releasing a platform service change through the full chain |
| `ff-helm-charts` | Understanding chart structure and sub-chart architecture |
| `ff-helm-values` | Writing or modifying Helm values files for environments |
| `ff-local-dev` | First-time local setup, minikube bootstrap, control plane install |
| `ff-agent-sdk` | Writing TypeScript code, SDK patterns, entity/bot design |

## Prerequisites

Before using ff-cli, ensure you have:

1. **ff-cli installed**: Download from releases or build from source
   ```bash
   ff-cli --version
   ```

2. **Required tools** (check with `ff-cli tooling list`):
   - Docker (required for builds)
   - Helm (required for deployments)
   - kubectl (required for K8s operations)
   - minikube (optional, for local development)

3. **Run the doctor check**:
   ```bash
   ff-cli ops doctor
   ```

## Quick Command Reference

### Project & Agent Bundle Creation

```bash
# Create new project with default agent bundle
ff-cli project create my-project

# Create project with specific agent bundle name
ff-cli project create my-project --agent-name order-service

# Create project from example
ff-cli project create my-project --with-example talespring

# Create project with web UI
ff-cli project create my-project --with-web-ui my-ui

# Add agent bundle to existing project
ff-cli agent-bundle create payment-service

# Add agent bundle from example
ff-cli agent-bundle create my-agent --from-example news-analysis
```

### Available Examples

```bash
# List all examples
ff-cli examples list

# Get example details
ff-cli examples info talespring
```

| Example | Category | Description |
|---------|----------|-------------|
| talespring | creative | AI storytelling agent with safety checks |
| explain-analyze | data-analysis | SQL EXPLAIN plan analyzer |
| file-upload | infrastructure | Binary file upload/retrieval demo |
| news-analysis | data-analysis | News article impact analysis |

### Build Operations

```bash
# Build for local minikube
ff-cli ops build my-agent --minikube

# Build and push to registry (uses current profile)
ff-cli ops build my-agent --push

# Build with specific tag
ff-cli ops build my-agent --tag v1.2.3 --push

# Build with explicit registry (for CI/CD)
ff-cli ops build my-agent \
  --registry myregistry.azurecr.io \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --push --yes
```

### Deployment Operations

```bash
# Install to default namespace (ff-dev)
ff-cli ops install my-agent

# Install to specific namespace
ff-cli ops install my-agent --namespace production

# Upgrade existing deployment
ff-cli ops upgrade my-agent --namespace production

# Upgrade without pod restart
ff-cli ops upgrade my-agent --no-restart

# Uninstall
ff-cli ops uninstall my-agent --namespace production
```

### Profile Management

```bash
# Create new profile (interactive)
ff-cli profile create

# List profiles
ff-cli profile list

# Select active profile
ff-cli profile select my-profile

# Show profile details
ff-cli profile show my-profile
```

**Profile types:**
- `minikube` - Local development (no remote registry)
- `gcp` - Google Artifact Registry
- `azure` - Azure Container Registry
- `standard` - Docker Hub, GHCR, etc.

### Environment Management

```bash
# Create environment (interactive)
ff-cli environment create --simple

# Create from template
ff-cli environment create --template internal --name dev-env

# List environments
ff-cli environment list

# Delete environment
ff-cli environment delete dev-env
```

### Cluster Operations

```bash
# Check cluster status
ff-cli cluster status

# Initialize cluster with CRDs and registry credentials
ff-cli cluster init --license ./license.jwt --yes

# Install FireFoundry control plane (self-serve mode)
ff-cli cluster install --self-serve --license ./license.jwt --yes

# Install with custom values
ff-cli cluster install --values-dir ./config

# Uninstall (preserves data for reinstall)
ff-cli cluster uninstall --yes

# Uninstall completely (deletes everything)
ff-cli cluster uninstall --full --yes
```

**Note:** For first-time local setup, see the `ff-local-dev` skill for a complete walkthrough.

### Configuration Management

```bash
# List all config values
ff-cli config list

# Get specific value
ff-cli config get broker.model

# Set value
ff-cli config set broker.model claude-3-opus

# Edit interactively
ff-cli config edit
```

### Tooling Management

```bash
# Check tool status
ff-cli tooling check

# Interactive installation wizard
ff-cli tooling init

# Install specific tool
ff-cli tooling install helm

# Update tool
ff-cli tooling update kubectl
```

## Common Workflows

### Workflow 1: New Project from Scratch

```bash
# 1. Create project
ff-cli project create my-ai-app --agent-name recommendation-engine

# 2. Navigate to project
cd my-ai-app

# 3. Install dependencies
pnpm install

# 4. Develop your agent bundle in apps/recommendation-engine/

# 5. Build for local testing
ff-cli ops build recommendation-engine --minikube

# 6. Deploy locally
ff-cli ops install recommendation-engine --namespace ff-dev
```

### Workflow 2: Adding Agent Bundle to Existing Project

```bash
# 1. Navigate to project root (where pnpm-workspace.yaml exists)
cd my-ai-app

# 2. Add new agent bundle
ff-cli agent-bundle create notification-service --port 3001

# 3. Install dependencies
pnpm install

# 4. Implement the agent bundle
# Edit apps/notification-service/src/...
```

### Workflow 3: Production Deployment

```bash
# 1. Set up production profile
ff-cli profile create prod-acr
# Select: azure
# Enter: registry URL, credentials

# 2. Select the profile
ff-cli profile select prod-acr

# 3. Build and push
ff-cli ops build my-agent --tag v1.0.0 --push

# 4. Deploy to production namespace
ff-cli ops install my-agent --namespace production --yes
```

### Workflow 4: CI/CD Pipeline

```bash
# Non-interactive build and deploy
ff-cli ops build my-agent \
  --registry $REGISTRY_URL \
  --registry-username $REGISTRY_USER \
  --registry-password $REGISTRY_PASS \
  --tag $CI_COMMIT_SHA \
  --push \
  --yes

ff-cli ops install my-agent \
  --namespace $DEPLOY_NAMESPACE \
  --yes
```

## Project Structure

After `ff-cli project create my-project --agent-name my-agent` (based on actual templates in ff-cli-rs):

```
my-project/
├── apps/
│   └── my-agent/
│       ├── src/
│       │   ├── index.ts           # Entry point
│       │   ├── agent-bundle.ts    # Agent bundle class
│       │   └── constructors.ts    # Entity constructors
│       ├── Dockerfile
│       ├── package.json
│       ├── tsconfig.json
│       ├── values.local.yaml      # Local config
│       └── secrets.yaml.template  # Secrets template
├── packages/
│   └── shared-types/              # Shared TypeScript types
│       └── src/
│           ├── index.ts
│           └── core.ts
├── docs/                          # SDK documentation
├── scripts/
│   ├── dev.sh
│   └── build.sh
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
├── tsconfig.json
├── docker-compose.yml
└── docker-compose.env.yml
```

## Troubleshooting

### "Docker daemon not running"
```bash
# Start Docker Desktop or:
open -a Docker  # macOS

# Verify
docker info
```

### "kubectl context not found"
```bash
# List available contexts
kubectl config get-contexts

# Set context in profile
ff-cli profile edit my-profile
```

### "Helm repository not found"
```bash
# Check Helm repos
helm repo list

# Update repos
helm repo update

# The ff-cli handles Helm repo configuration automatically during ops install
```

### "Permission denied on registry push"
```bash
# Check profile credentials
ff-cli profile show

# Re-authenticate
ff-cli profile edit my-profile
```

### "Agent bundle not found in workspace"
```bash
# Ensure you're in project root
ls pnpm-workspace.yaml

# List available apps
ff-cli apps list
```

## Global Flags

All commands support:
- `-v, --verbose` - Enable verbose output for debugging
- `-h, --help` - Show help for any command
- `-V, --version` - Show CLI version

## More Information

- [COMMANDS.md](./COMMANDS.md) - Complete command reference with all options
- [WORKFLOWS.md](./WORKFLOWS.md) - Advanced workflows and CI/CD patterns
