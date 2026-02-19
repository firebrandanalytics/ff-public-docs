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
# Deploy (install or upgrade) — auto-builds the Docker image first
ff-cli ops deploy my-agent

# Deploy with environment-specific values
ff-cli ops deploy my-agent --values local    # uses helm/values.local.yaml
ff-cli ops deploy my-agent --values dev      # uses helm/values.dev.yaml

# Deploy to specific namespace
ff-cli ops deploy my-agent --namespace ff-test

# Install (first time only, no auto-build)
ff-cli ops install my-agent

# Upgrade existing deployment
ff-cli ops upgrade my-agent

# Uninstall
ff-cli ops uninstall my-agent --namespace production
```

**The `--values` flag** selects environment-specific Helm values:
- `--values local` → chains `helm/values.yaml` + `helm/values.local.yaml` + `helm/secrets.local.yaml`
- `--values dev` → chains `helm/values.yaml` + `helm/values.dev.yaml` + `helm/secrets.dev.yaml`
- Auto-detected from profile type (minikube → `local`, cloud → `dev`)

**Note**: `ops deploy` auto-builds the Docker image with `latest` tag before deploying, regardless of what tag is set in values.yaml. On minikube with `pullPolicy: Never`, Kubernetes may not detect the new image if the tag hasn't changed. Workaround: `kubectl rollout restart deployment/<name> -n <namespace>` after deploy.

### Web UI Scaffolding

```bash
# Add a Next.js web UI to your project
ff-cli gui add my-gui-name
```

This scaffolds a complete Next.js 15 app with:
- Standalone output mode (for Docker deployment)
- `outputFileTracingRoot` configured for pnpm monorepo
- Tailwind CSS pre-configured
- Health check endpoint at `/api/health`
- Helm chart with service port 80 mapped to container port 3000
- Liveness/readiness probes

**Important**: The web-UI Helm chart maps service port **80 → container port 3000**. When port-forwarding, target port 80:
```bash
ff-cli port-forward my-gui 3005:80 -n ff-test --name my-gui
```

### Application Registration

```bash
# Register your application with entity-service
ff-cli application register --mode internal --internal-port 8081
```

**Note**: The `--mode internal --internal-port 8081` flags work around a URL construction issue. Save the returned application ID — you'll need it in your agent bundle config.

### Process Management (Port Forwards)

```bash
# Start a managed port-forward
ff-cli port-forward <service-name> <local>:<remote> -n <namespace> --name <friendly-name>

# List all managed processes
ff-cli ps

# View logs for a process
ff-cli logs <name>
ff-cli logs <name> --follow    # real-time streaming

# Stop a process
ff-cli stop <name>
```

**Tip**: Kong port-forward auto-starts after `ff-cli cluster install` on minikube. Use `ff-cli ps` to check.

### Broker Configuration

```bash
# Add API keys to broker secrets
ff-cli env broker-secret add <env-name> --key GOOGLE_API_KEY --value <key>

# Create LLM routing (model group + deployed model)
ff-cli env broker-config create --name gemini_completion

# Show broker config
ff-cli env broker-config show <name>

# List broker configs
ff-cli env broker-config list
```

**Known bug**: `ff-cli env broker-secret add` reports success but may not update the Kubernetes secret value (ff-cli-go#48). Workaround:
```bash
# Manually patch the secret
kubectl patch secret firefoundry-core-ff-broker-secret -n <namespace> \
  --type merge -p "{\"data\":{\"GOOGLE_API_KEY\":\"$(echo -n '<key>' | base64)\"}}"
kubectl rollout restart deployment/firefoundry-core-ff-broker -n <namespace>
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

### Workflow 1: New Project from Scratch (Local Minikube)

```bash
# 1. Create project
ff-cli application create my-ai-app --skip-git

# 2. Navigate to project
cd my-ai-app

# 3. Create agent bundle
ff-cli agent-bundle create my-bundle

# 4. Install dependencies
pnpm install

# 5. Register application with entity-service
ff-cli application register --mode internal --internal-port 8081
# Save the returned application ID

# 6. Develop your agent bundle in apps/my-bundle/src/

# 7. Build
ff-cli ops build

# 8. Deploy with local values
ff-cli ops deploy --values local

# 9. Port-forward to test
ff-cli port-forward my-bundle-agent-bundle 3004:3000 -n ff-test --name my-bundle

# 10. Test
curl http://localhost:3004/health
```

### Workflow 2: Adding Web UI to Existing Project

```bash
# 1. Navigate to project root (where pnpm-workspace.yaml exists)
cd my-ai-app

# 2. Add web UI
ff-cli gui add my-gui

# 3. Install dependencies
cd apps/my-gui && pnpm install && cd ../..

# 4. Create API proxy routes in apps/my-gui/src/app/api/
# Proxy to your agent bundle using cluster-internal URL

# 5. Configure values.local.yaml with bundle URL
# BUNDLE_URL: http://my-bundle-agent-bundle.<namespace>.svc.cluster.local:3000

# 6. Build and deploy
ff-cli ops build
ff-cli ops deploy --values local

# 7. Port-forward (remember: service port is 80, not 3000)
ff-cli port-forward my-gui 3005:80 -n ff-test --name my-gui
```

### Workflow 3: Adding Agent Bundle to Existing Project

```bash
# 1. Navigate to project root
cd my-ai-app

# 2. Add new agent bundle
ff-cli agent-bundle create notification-service

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

After `ff-cli application create my-project` + `ff-cli agent-bundle create my-agent`:

```
my-project/
├── apps/
│   └── my-agent/
│       ├── src/
│       │   ├── index.ts           # Entry point (FFAgentBundleServer)
│       │   ├── agent-bundle.ts    # FFAgentBundle subclass + API endpoints
│       │   ├── constructors.ts    # Entity & bot registration
│       │   ├── entities/          # Entity classes (AddMixins pattern)
│       │   ├── bots/              # Bot classes (ComposeMixins pattern)
│       │   └── prompts/           # Prompt definitions
│       ├── helm/
│       │   ├── Chart.yaml
│       │   ├── values.yaml        # Base Helm values
│       │   └── values.local.yaml  # Local/minikube overrides
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
├── packages/                      # Shared packages (optional)
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
└── tsconfig.json
```

Web UI (after `ff-cli gui add my-gui`):
```
apps/
└── my-gui/
    ├── src/app/
    │   ├── layout.tsx             # Root layout
    │   ├── page.tsx               # Main page
    │   ├── globals.css            # Tailwind imports
    │   └── api/                   # API proxy routes (Next.js Route Handlers)
    │       └── health/route.ts    # Health check (pre-configured)
    ├── helm/
    │   ├── Chart.yaml
    │   ├── values.yaml
    │   └── values.local.yaml
    ├── next.config.mjs            # standalone output + outputFileTracingRoot
    ├── tailwind.config.ts
    ├── Dockerfile
    └── package.json
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

## Known Issues

| Issue | Workaround |
|-|-|
| `env broker-secret add` doesn't update K8s secret (ff-cli-go#48) | Use `kubectl patch secret` + `kubectl rollout restart` |
| `application register` URL construction bug (ff-cli-go#28) | Use `--mode internal --internal-port 8081` |
| `ops deploy` auto-builds with `latest` tag regardless of values.yaml | Use `kubectl rollout restart` if pod doesn't pick up changes |
| System application `a0000000-...` not auto-seeded (ff-services-entity#9) | Create manually via entity-service API (see ff-local-dev skill) |

## Global Flags

All commands support:
- `-v, --verbose` - Enable verbose output for debugging
- `-h, --help` - Show help for any command
- `-V, --version` - Show CLI version

## More Information

- [COMMANDS.md](./COMMANDS.md) - Complete command reference with all options
- [WORKFLOWS.md](./WORKFLOWS.md) - Advanced workflows and CI/CD patterns
