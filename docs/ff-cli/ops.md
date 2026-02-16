# Operations Commands

The `ops` commands in `ff-cli` handle building Docker images and deploying agent bundles to Kubernetes using Helm.

## Overview

Operations commands integrate with [profiles](profiles.md) to provide seamless Docker registry authentication and image management. They handle:

- **Building and deploying** agent bundles in a single step (`ops deploy`)
- Building Docker images for agent bundles
- Authenticating with container registries
- Installing agent bundles to Kubernetes using Helm
- Upgrading existing deployments
- Checking prerequisites

## Deploy Command

Build and deploy an agent bundle in one step. This is the **primary command** for development — it builds the Docker image and then either installs (first time) or upgrades (subsequent runs) the Helm release automatically.

### Basic Usage

```bash
# Build and deploy locally (most common)
ff-cli ops deploy my-bundle -y

# Deploy with explicit values file variant
ff-cli ops deploy my-bundle -y --values local

# Deploy to specific namespace
ff-cli ops deploy my-bundle -y --namespace ff-test

# Verbose output for debugging
ff-cli ops deploy my-bundle -y --verbose
```

### Command Options

```bash
ff-cli ops deploy <name> [OPTIONS]

Options:
  --namespace, -n <ns>        Kubernetes namespace (default: from values or ff-dev)
  --tag, -t <tag>             Docker image tag (default: latest)
  --values <name>             Values file variant (e.g., local, dev) — see below
  --local-chart               Use local helm chart (./apps/<name>/helm/)
  --yes                       Skip confirmation prompts
  --verbose, -v               Verbose output for debugging
```

### Values File Resolution

The `--values` flag selects environment-specific Helm values files from your agent bundle's `helm/` directory:

- `--values local` → uses `helm/values.local.yaml`
- `--values dev` → uses `helm/values.dev.yaml`
- If omitted, auto-detected from the active profile's registry type:
  - **Minikube profiles** → defaults to `local`
  - **Cloud profiles** (GCP, Azure, Standard) → defaults to `dev`

**File chaining:** If a `helm/values.yaml` base file exists alongside the variant file, both are applied in order:

```
-f values.yaml -f values.<name>.yaml
```

This lets you keep shared defaults in `values.yaml` and environment-specific overrides in the variant file.

**Secrets fallback:** The CLI also looks for secrets files, trying `secrets.<name>.yaml` first and falling back to `secrets.yaml`.

### imagePullPolicy by Environment

The scaffolded values files set `imagePullPolicy` appropriately for each environment:

- **`values.local.yaml`** — sets `imagePullPolicy: Never`. Images are loaded directly into minikube's Docker daemon, so Kubernetes should never attempt a registry pull.
- **`values.dev.yaml`** — sets `imagePullPolicy: Always`. Cloud deployments pull from a remote registry and should always fetch the latest image for a given tag.

### Deploy Process

1. **Build** the Docker image (same as `ops build`)
2. **Load** the image into minikube (for minikube profiles) or push to registry (for cloud profiles)
3. **Install or upgrade** the Helm release — if the release already exists, it upgrades; otherwise, it installs fresh
4. **Apply values** using the resolved values file chain

### Examples

**Local development (minikube):**

```bash
ff-cli ops deploy my-bundle -y
# Builds image, loads into minikube, installs/upgrades Helm release
# Auto-selects values.local.yaml for minikube profile
```

**Explicit values file:**

```bash
ff-cli ops deploy my-bundle -y --values local --namespace ff-test
```

**Verbose output for debugging:**

```bash
ff-cli ops deploy my-bundle -y --verbose
# Shows Docker build output, Helm commands, and values file resolution
```

## Build Command

Build a Docker image for an agent bundle.

### Basic Usage

```bash
# Build using current profile (auto-pushes for remote registries)
ff-cli ops build my-bundle --tag 1.0.0

# Build for minikube (local only)
ff-cli ops build my-bundle --minikube --tag 1.0.0

# Build and explicitly push
ff-cli ops build my-bundle --tag 1.0.0 --push
```

### Profile Integration

When you use `ops build` with a [profile](profiles.md):

1. **Remote registry profiles** (GCP, Azure, Standard): Images are automatically pushed after building
2. **Minikube profiles**: Images stay local, no push occurs

The command will prompt you to confirm profile usage before proceeding:

```
════════════════════════════════════════════════════════════════════════════════
  Profile:  gcp-dev
  Operation:  a docker build and push
════════════════════════════════════════════════════════════════════════════════

You are about to perform a docker build and push via the 'gcp-dev' profile. Continue?
```

### Command Options

```bash
ff-cli ops build <name> [OPTIONS]

Options:
  --tag, -t <tag>              Docker image tag (default: latest)
  --minikube                   Use minikube Docker daemon
  --minikube-profile <name>    Minikube profile name (default: minikube)
  --registry-profile <name>    Registry profile to use (overrides current)
  --registry <url>             Registry URL (overrides profile)
  --registry-username <user>   Registry username (for non-interactive mode)
  --registry-password <pass>   Registry password (for non-interactive mode)
  --yes                        Skip confirmation prompts (non-interactive)
  --push                       Explicitly push image after build
```

### Examples

**Using current profile (GCP):**

```bash
ff-cli ops build report-bundle --tag 1.0.9
# Automatically authenticates and pushes to GCP Artifact Registry
```

**Using specific profile:**

```bash
ff-cli ops build my-bundle --registry-profile gcp-prod --tag 2.0.0
```

**Minikube local build:**

```bash
ff-cli ops build my-bundle --minikube --tag local
# Image stays in minikube's Docker daemon
```

**CI/CD (non-interactive):**

```bash
ff-cli ops build my-bundle \
  --registry myregistry.io \
  --registry-username user \
  --registry-password pass \
  --tag 1.0.0 \
  --yes \
  --push
```

### Image Naming

Image names are automatically constructed based on registry type:

**GCP Artifact Registry:**

```
<location>-docker.pkg.dev/<project-id>/<repository>/<image-name>:<tag>
```

Example: `us-central1-docker.pkg.dev/my-project/my-repo/my-bundle:1.0.0`

**Standard Registries:**

```
<registry>/<image-name>:<tag>
```

Example: `ghcr.io/my-bundle:1.0.0`

**Minikube:**

```
<image-name>:<tag>
```

Example: `my-bundle:local`

### Build Process

1. **Resolve registry settings** from flags or [profile](profiles.md)
2. **Authenticate** with registry (if remote)
3. **Verify prerequisites** (Docker, workspace structure)
4. **Build Docker image** using local Docker daemon (or minikube)
5. **Push image** (if remote registry profile or `--push` flag)
6. **Display success message** with image location

### Output

After a successful build, you'll see:

```bash
Building Docker image: us-central1-docker.pkg.dev/my-project/my-repo/my-bundle:1.0.9
Authenticated with us-central1-docker.pkg.dev
Using local Docker daemon for registry build
Docker image built successfully: us-central1-docker.pkg.dev/my-project/my-repo/my-bundle:1.0.9
Image is now available at:
  us-central1-docker.pkg.dev/my-project/my-repo/my-bundle:1.0.9

Update your Helm values to use this image:
  image:
    repository: us-central1-docker.pkg.dev/my-project/my-repo/my-bundle
    tag: 1.0.9
```

## Install Command

Install an agent bundle to Kubernetes using Helm.

### Basic Usage

```bash
# Install to default namespace (ff-dev)
ff-cli ops install my-bundle

# Install to specific namespace
ff-cli ops install my-bundle --namespace production

# Install specific chart version
ff-cli ops install my-bundle --chart-version 1.2.3

# Use local helm chart
ff-cli ops install my-bundle --local-chart
```

### Command Options

```bash
ff-cli ops install <name> [OPTIONS]

Options:
  --namespace, -n <ns>        Kubernetes namespace (default: ff-dev)
  --values <name>             Values file variant (e.g., local, dev) — see Deploy Command for resolution logic
  --chart-version <version>   Helm chart version
  --yes                       Skip confirmation prompts
  --local-chart               Use local chart (./apps/<name>/helm/) instead of remote
```

### Installation Process

1. **Validates workspace** structure
2. **Resolves values files** based on `--values` flag or profile auto-detection
3. **Prompts for confirmation** (unless `--yes` is used)
4. **Adds Helm repository** (FireFoundry charts)
5. **Installs Helm chart** for the agent bundle with the resolved values
6. **Deploys to Kubernetes** namespace

## Upgrade Command

Upgrade an existing agent bundle deployment.

### Basic Usage

```bash
# Upgrade in default namespace
ff-cli ops upgrade my-bundle

# Upgrade with restart
ff-cli ops upgrade my-bundle --namespace production

# Upgrade without restart annotations
ff-cli ops upgrade my-bundle --no-restart

# Upgrade specific chart version
ff-cli ops upgrade my-bundle --chart-version 2.0.0
```

### Command Options

```bash
ff-cli ops upgrade <name> [OPTIONS]

Options:
  --namespace, -n <ns>        Kubernetes namespace (default: ff-dev)
  --values <name>             Values file variant (e.g., local, dev) — see Deploy Command for resolution logic
  --chart-version <version>   Helm chart version
  --yes                       Skip confirmation prompts
  --no-restart                Disable restart annotations
  --local-chart               Use local chart (./apps/<name>/helm/) instead of remote
```

## Uninstall Command

Remove an agent bundle deployment from Kubernetes.

### Basic Usage

```bash
# Uninstall from default namespace (ff-dev)
ff-cli ops uninstall my-bundle

# Uninstall from specific namespace
ff-cli ops uninstall my-bundle --namespace production

# Force uninstall without confirmation
ff-cli ops uninstall my-bundle --yes
```

### Command Options

```bash
ff-cli ops uninstall <name> [OPTIONS]

Options:
  --namespace, -n <ns>   Kubernetes namespace (default: ff-dev)
  --yes                  Skip confirmation prompts (force uninstall)
```

### What Gets Removed

The uninstall command removes:

- Helm release (deployment and all related Kubernetes resources)
- Service and ConfigMap
- Secrets
- Pod Disruption Budgets (if configured)

**Note**: Persistent data (databases, stored files) are NOT removed by default. Use Helm's `--delete-pvc` option if you want to also remove persistent volumes.

### Examples

**Uninstall with confirmation:**

```bash
ff-cli ops uninstall my-bundle --namespace production
# Output: Are you sure you want to uninstall 'my-bundle' from 'production'? [y/N]
```

**Force uninstall (skip confirmation):**

```bash
ff-cli ops uninstall my-bundle --namespace production --yes
```

## Doctor Command

Check prerequisites for operations commands.

### Usage

```bash
ff-cli ops doctor
```

This command verifies:

- Docker installation and daemon status
- Helm installation and FireFoundry repo configuration
- kubectl installation and Kubernetes connectivity
- Minikube status (if applicable)

## Workflow Examples

### Local Development Workflow (Recommended)

Use `ops deploy` for the fastest iteration cycle:

**1. Create minikube profile:**

```bash
ff-cli profile create minikube-local
# Select "Minikube" type
ff-cli profile select minikube-local
```

**2. Build and deploy in one step:**

```bash
ff-cli ops deploy my-bundle -y --namespace ff-dev
# Builds image, loads into minikube, installs/upgrades Helm release
# Auto-selects values.local.yaml (imagePullPolicy: Never)
```

**3. Iterate — rebuild and redeploy:**

```bash
# Make code changes, then:
ff-cli ops deploy my-bundle -y --namespace ff-dev
# Automatically upgrades the existing release
```

### Complete Deployment Workflow

For production or cloud deployments where you want more control:

**1. Create and configure profile:**

```bash
ff-cli profile create gcp-prod
# Configure GCP settings interactively
ff-cli profile select gcp-prod
```

**2. Build and push image:**

```bash
ff-cli ops build my-bundle --tag 1.0.0
# Automatically pushes to GCP using profile
```

**3. Install to Kubernetes:**

```bash
ff-cli ops install my-bundle --namespace production --values dev
```

**4. Upgrade deployment:**

```bash
# Build new version
ff-cli ops build my-bundle --tag 1.1.0

# Upgrade deployment
ff-cli ops upgrade my-bundle --namespace production --values dev
```

## Integration with Profiles

The `ops build` command integrates seamlessly with [profiles](profiles.md):

- **Current profile**: Used automatically if no flags are specified
- **Profile override**: Use `--registry-profile` to specify a different profile
- **Flag override**: Use `--registry`, `--registry-username`, `--registry-password` to bypass profile
- **Auto-push**: Remote registry profiles automatically push after build
- **Confirmation**: Interactive confirmation before using a profile

## CI/CD Usage

For CI/CD pipelines, use explicit flags with `--yes`:

```bash
ff-cli ops build my-bundle \
  --registry myregistry.io \
  --registry-username $REGISTRY_USER \
  --registry-password $REGISTRY_PASS \
  --tag $VERSION \
  --yes \
  --push
```

Profiles are not required in CI/CD - all settings can be provided via flags and environment variables.

## Troubleshooting

**Build fails**: Run `ff-cli ops doctor` to check prerequisites

**Authentication fails**: Verify your [profile](profiles.md) settings with `ff-cli profile show`

**Image not found**: Ensure the image was pushed successfully (check build output)

**Helm install fails**: Verify Kubernetes connectivity with `kubectl cluster-info`

**Wrong registry**: Check which profile is current with `ff-cli profile show` or explicitly specify with `--registry-profile`
