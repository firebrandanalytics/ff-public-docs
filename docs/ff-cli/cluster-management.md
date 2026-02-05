# Cluster Management

## Overview

The ff-cli cluster management commands provide a complete workflow for initializing Kubernetes clusters with FireFoundry dependencies and deploying the control plane. These commands handle:

1. **Flux CRD Installation** - Install the Custom Resource Definitions required for Helm-based deployments
2. **Registry Secret Configuration** - Set up image pull secrets using license-based credential exchange
3. **Control Plane Deployment** - Install the FireFoundry control plane Helm chart
4. **Cluster Status Verification** - Check cluster readiness and component installation status

The cluster management workflow integrates with [ff-cli profiles](./profiles.md) for registry credentials and kubectl context management.

## Prerequisites

### Required Tools

The following tools must be installed and available in your PATH:

- **kubectl** - Kubernetes command-line tool (v1.20 or later recommended)
- **helm** - Helm package manager (v3.0 or later required)
- **docker** - Docker Engine (for building and pushing images)

You can install these tools using `ff-cli tooling install`:

```bash
ff-cli tooling status
ff-cli tooling install kubectl helm docker
```

### Required Credentials

To initialize a cluster with full functionality, you need:

1. **FireFoundry License Token (JWT)** - Used for registry credential exchange
   - Obtain from your FireFoundry license administrator
   - Can be a file path (e.g., `license.jwt`) or the JWT string directly
   - Used to automatically obtain container registry credentials

2. **Container Registry Access** (alternative to license token)
   - Registry server URL (e.g., `myregistry.azurecr.io`)
   - Registry username
   - Registry password
   - Optional: Registry email

3. **Kubernetes Cluster Access**
   - Valid kubeconfig with cluster credentials
   - Sufficient permissions to create namespaces, CRDs, and deploy workloads
   - Current kubectl context set to target cluster

### Cluster Requirements

Your Kubernetes cluster must meet these requirements:

- **Kubernetes Version**: v1.20 or later
- **Node Resources**: Minimum 2 CPUs and 4GB RAM available
- **Networking**: Cluster networking configured and accessible
- **Storage**: StorageClass available for persistent volumes (if using bundled PostgreSQL/MinIO)
- **Ingress**: Ingress controller optional but recommended for web UI access

### Profile Configuration

Cluster commands work best with a configured [ff-cli profile](./profiles.md):

```bash
# Create a profile with registry and kubectl context
ff-cli profile create production

# Select the profile
ff-cli profile select production
```

Profiles are **required** for `cluster init` and strongly recommended for all cluster operations.

## Cluster Initialization

### `ff-cli cluster init` Command

#### Purpose

The `cluster init` command prepares your Kubernetes cluster for FireFoundry deployments by:

1. Installing Flux CRDs required for HelmRelease-based deployments
2. Creating the `ff-control-plane` namespace
3. Exchanging your license token for container registry credentials
4. Creating a Kubernetes image pull secret (`myregistrycreds`) in the control plane namespace

**When to use this command:**
- Before your first FireFoundry deployment on a cluster
- When setting up a new cluster for FireFoundry
- When registry credentials need to be updated

#### Usage

```bash
ff-cli cluster init [OPTIONS]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--yes`, `-y` | Skip all confirmation prompts | `false` |
| `--timeout <SECONDS>` | Timeout for waiting on CRDs to be established | `60` |
| `--license <JWT>` | FireFoundry license JWT or path to JWT file | None (uses profile) |
| `--credentials-file <PATH>` | Path to credentials YAML file (fallback) | None |
| `--registry-server <URL>` | Registry server URL (e.g., myregistry.azurecr.io) | None |
| `--registry-username <USER>` | Registry username | None |
| `--registry-password <PASS>` | Registry password | None |
| `--registry-email <EMAIL>` | Registry email (optional) | None |
| `--skip-registry-secret` | Skip creating the registry image pull secret | `false` |

#### Profile Integration

`cluster init` requires a profile to be created and selected before running. The command will:

1. Check for available profiles and fail with guidance if none exist
2. Verify a profile is currently selected
3. Use the profile's kubectl context (or prompt to switch contexts)
4. Use the profile's license token if `--license` is not provided

**Profile credentials priority:**
1. `--license` flag (highest priority)
2. License from selected profile
3. `--credentials-file` flag
4. Individual `--registry-*` flags
5. Interactive prompts (if not in `--yes` mode)
6. Auto-discover `*.jwt` files in current directory

#### Flux CRD Installation

The command installs these Flux Custom Resource Definitions:

- **HelmRelease** - `helmreleases.helm.toolkit.fluxcd.io`
- **HelmRepository** - `helmrepositories.source.toolkit.fluxcd.io`
- **HelmChart** - `helmcharts.source.toolkit.fluxcd.io`
- **Bucket** - `buckets.source.toolkit.fluxcd.io`
- **GitRepository** - `gitrepositories.source.toolkit.fluxcd.io`
- **OCIRepository** - `ocirepositories.source.toolkit.fluxcd.io`

CRDs are fetched from the official [Flux GitHub repository](https://github.com/fluxcd/flux2) and installed using `kubectl apply`.

The command waits for critical CRDs (HelmRelease, HelmRepository, HelmChart) to be "established" before completing. If CRDs are already installed, the command skips installation and proceeds to registry secret configuration.

#### License-Based Credential Exchange

When you provide a license token (via `--license` flag or profile), ff-cli automatically exchanges it for container registry credentials:

1. **License Token Resolution**: CLI flag → Profile → Environment variable
2. **Service URL Resolution**: `FF_LICENSE_SERVICE_URL` env var → Profile → Default (`https://license.firefoundry.ai`)
3. **API Call**: POST to `/api/v1/license/credentials` with JWT
4. **Response**: Registry server, username, and time-limited password
5. **Secret Creation**: Kubernetes docker-registry secret in `ff-control-plane` namespace

**Important**: Each call to the license service regenerates the password, invalidating previous credentials. Run `cluster init` once per cluster setup, not repeatedly.

**License Token Formats:**
- File path: `--license ./my-license.jwt`
- Direct JWT string: `--license eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...`
- Profile-stored: Configured in profile settings

#### Registry Secret Configuration

If license exchange is unavailable, you can provide registry credentials manually:

**Option 1: Credentials File**
```bash
ff-cli cluster init --credentials-file ./registry-creds.yaml
```

Credentials file format:
```yaml
server: myregistry.azurecr.io
username: myuser
password: mypassword
```

**Option 2: CLI Flags**
```bash
ff-cli cluster init \
  --registry-server myregistry.azurecr.io \
  --registry-username myuser \
  --registry-password mypassword \
  --registry-email myemail@example.com
```

**Option 3: Interactive Prompts**
```bash
ff-cli cluster init
# CLI will prompt for registry details if no credentials are provided
```

The registry secret is created as a Kubernetes `docker-registry` type secret named `myregistrycreds` in the `ff-control-plane` namespace. This secret is automatically used by the control plane and environment pods for pulling images.

**Updating Registry Secrets:**
If the secret already exists, `cluster init` will prompt before overwriting (unless `--yes` mode). In `--yes` mode, existing secrets are preserved.

#### Examples

**Basic initialization with profile license:**
```bash
# Requires profile to be created and selected
ff-cli profile select production
ff-cli cluster init
```

**Non-interactive initialization with license file:**
```bash
ff-cli cluster init --license ./my-license.jwt --yes
```

**Manual registry credentials:**
```bash
ff-cli cluster init \
  --registry-server myregistry.azurecr.io \
  --registry-username robot-account \
  --registry-password 'my-secure-password' \
  --yes
```

**Skip registry secret creation (for testing):**
```bash
ff-cli cluster init --skip-registry-secret --yes
```

**Custom CRD timeout for slow networks:**
```bash
ff-cli cluster init --timeout 120
```

## Control Plane Installation

### `ff-cli cluster install` Command

#### Purpose

The `cluster install` command deploys the FireFoundry control plane to your Kubernetes cluster. The control plane includes:

- **Helm API** - REST API for managing FireFoundry Core environments
- **Control Plane Operator** - Manages FireFoundry resources
- **Internal Services** - Supporting infrastructure for environments

The control plane is installed as a Helm release named `firefoundry-control` in the `ff-control-plane` namespace.

**When to use this command:**
- After running `cluster init` to deploy the control plane
- To upgrade an existing control plane installation
- When recovering from control plane issues

#### Prerequisites

Before running `cluster install`, ensure:

1. ✅ Flux CRDs are installed (`cluster init` completed successfully)
2. ✅ `ff-control-plane` namespace exists
3. ✅ Registry secret exists (unless using public images)
4. ✅ `values.yaml` file exists with control plane configuration
5. ✅ kubectl context is set to target cluster

The command performs automatic pre-installation validation and will block with clear error messages if prerequisites are not met.

#### Usage

```bash
ff-cli cluster install [OPTIONS]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--yes`, `-y` | Skip confirmation prompts | `false` |
| `--values-dir <PATH>`, `-d` | Directory containing values.yaml and secrets.yaml | `.` (current directory) |
| `--version <VERSION>` | Chart version to install (e.g., "0.9.0") | Latest from repository |
| `--skip-crds` | Skip CRD installation (assume already installed) | `false` |
| `--force` | Force installation even if prerequisites not met | `false` |

#### Configuration Files

The command expects configuration files in the `--values-dir`:

**Required: `values.yaml`**
Main control plane configuration:
```yaml
# Example values.yaml
image:
  repository: myregistry.azurecr.io/firefoundry-control-plane
  tag: "latest"
  pullPolicy: IfNotPresent

replicaCount: 1

resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"

service:
  type: ClusterIP
  port: 8000

ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: firefoundry.example.com
      paths:
        - path: /
          pathType: Prefix
```

**Optional: `secrets.yaml`**
Sensitive configuration (not committed to version control):
```yaml
# Example secrets.yaml
apiKey: "your-api-key-here"
databasePassword: "your-db-password"
```

#### Pre-Installation Validation

Unless `--force` is used, the command performs these checks:

1. **Flux CRDs Installed**: Verifies all 6 Flux CRDs are present
2. **Namespace Exists**: Checks `ff-control-plane` namespace exists
3. **Registry Secret Exists**: Verifies `myregistrycreds` secret is present

**If validation fails**, the command displays:
```
ERROR: Cluster is not ready for installation:
  - Flux CRDs not installed (6 missing)
  - Namespace 'ff-control-plane' does not exist
  - Registry secret 'myregistrycreds' not found in namespace 'ff-control-plane'

To prepare the cluster, run:
  ff-cli cluster init --license <your-license-jwt>

Or use --force to bypass these checks (not recommended).
```

#### Helm Repository Integration

The command automatically manages the FireFoundry Helm repository:

1. **Repository Addition**: `helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra/`
2. **Repository Update**: `helm repo update firebrandanalytics`
3. **Chart Version Discovery**: Queries latest version if `--version` not specified
4. **Chart Installation**: `helm upgrade --install firefoundry-control firebrandanalytics/firefoundry-control-plane`

The Helm chart repository is hosted at: `https://firebrandanalytics.github.io/ff_infra/`

#### Installation vs Upgrade

The command uses `helm upgrade --install` pattern, which:

- **First Installation**: Creates a new release if none exists
- **Upgrade**: Updates an existing release with new configuration or version
- **Detection**: Automatically detects if control plane is already installed

When upgrading an existing installation, the command displays:
```
INFO: Control plane is already installed in namespace 'ff-control-plane'
      This will perform an upgrade.
```

#### Examples

**Basic installation with values in current directory:**
```bash
# Expects ./values.yaml in current directory
ff-cli cluster install
```

**Installation with custom values directory:**
```bash
ff-cli cluster install -d ./config/production
```

**Non-interactive installation:**
```bash
ff-cli cluster install --yes
```

**Install specific chart version:**
```bash
ff-cli cluster install --version 0.9.0
```

**Force installation bypassing checks (not recommended):**
```bash
ff-cli cluster install --force
```

**Install with CRDs already present:**
```bash
# Skips CRD installation check if you know they're already installed
ff-cli cluster install --skip-crds
```

**Upgrade existing control plane:**
```bash
# Update values.yaml with new configuration, then:
ff-cli cluster install -d ./config
# Command detects existing installation and performs upgrade
```

## Cluster Status

### `ff-cli cluster status` Command

#### Purpose

The `cluster status` command provides a comprehensive overview of your cluster's FireFoundry installation status. It checks:

1. **Kubernetes Context** - Displays current kubectl context
2. **Flux CRDs** - Installation status of all 6 Flux CRDs
3. **Namespace** - Whether `ff-control-plane` namespace exists
4. **Registry Secret** - Whether `myregistrycreds` image pull secret exists
5. **Control Plane** - Whether FireFoundry control plane is installed

This command is useful for:
- Verifying cluster readiness before deployment
- Troubleshooting installation issues
- Checking what initialization steps are still needed

#### Usage

```bash
ff-cli cluster status
```

No arguments or options are required. The command reads configuration from your active profile (if available) to determine the control plane namespace.

#### Output Format

```
Cluster Status

Context: minikube

Flux CRDs:
╔═══════════════════════════════════════════════════╤══════════════════╗
║ CRD                                               │ Status           ║
╠═══════════════════════════════════════════════════╪══════════════════╣
║ HelmRelease                                       │ Installed        ║
║ HelmRepository                                    │ Installed        ║
║ HelmChart                                         │ Installed        ║
║ Bucket                                            │ Installed        ║
║ GitRepository                                     │ Installed        ║
║ OCIRepository                                     │ Installed        ║
╚═══════════════════════════════════════════════════╧══════════════════╝

Namespace:
  Status: 'ff-control-plane' exists

Registry Secret:
  Status: 'myregistrycreds' exists in namespace 'ff-control-plane'

Control Plane:
  Status: Installed in namespace 'ff-control-plane'

Cluster is ready for FireFoundry!
```

#### Status Indicators

**Flux CRDs:**
- ✅ **Installed** (green) - CRD is installed and available
- ❌ **Not Installed** (red) - CRD is missing

**Namespace:**
- ✅ **exists** (green) - Namespace is created
- ⚠️ **does not exist** (yellow) - Run `cluster init` to create

**Registry Secret:**
- ✅ **exists** (green) - Image pull secret is configured
- ⚠️ **not found** (yellow) - Run `cluster init --license <jwt>` to create

**Control Plane:**
- ✅ **Installed** (green) - Control plane Helm release is deployed
- ⚠️ **Not installed** (yellow) - Run `cluster install` to deploy

#### Readiness Summary

At the end of the output, the command displays one of two summaries:

**Ready:**
```
Cluster is ready for FireFoundry!
```

**Not Ready:**
```
WARNING: Cluster is not ready for installation:
  - 6/6 Flux CRDs installed
  - Namespace 'ff-control-plane' does not exist
  - Registry secret 'myregistrycreds' not found

Run ff-cli cluster init --license <jwt> to prepare the cluster.
```

#### Checking Specific Components

The command checks components in this order:

1. **Prerequisites** - Verifies kubectl is available and cluster is accessible
2. **CRDs** - Checks all 6 Flux CRDs via `kubectl get crd <name>`
3. **Namespace** - Checks if `ff-control-plane` namespace exists
4. **Registry Secret** - Checks if `myregistrycreds` secret exists in namespace
5. **Control Plane** - Checks if `firefoundry-control` Helm release exists

Each check is independent, so you can see exactly which components need attention.

#### Examples

**Check cluster status:**
```bash
ff-cli cluster status
```

**Check status after initialization:**
```bash
ff-cli cluster init --yes
ff-cli cluster status
# Should show CRDs installed, namespace exists, registry secret exists
```

**Check status before control plane installation:**
```bash
ff-cli cluster status
# Verify "Cluster is ready for FireFoundry!" before proceeding
ff-cli cluster install -d ./config
```

**Check status on multiple clusters:**
```bash
kubectl config use-context staging
ff-cli cluster status

kubectl config use-context production
ff-cli cluster status
```

## Common Workflows

### Initial Cluster Setup

Complete workflow from fresh cluster to deployed control plane:

```bash
# Step 1: Create and select a profile
ff-cli profile create production
ff-cli profile select production

# Step 2: Verify tooling is installed
ff-cli tooling status
ff-cli tooling install kubectl helm docker

# Step 3: Set kubectl context (if not already set)
kubectl config use-context my-cluster

# Step 4: Initialize cluster with Flux CRDs and registry secret
ff-cli cluster init --license ./license.jwt

# Step 5: Verify cluster readiness
ff-cli cluster status

# Step 6: Prepare control plane configuration
mkdir -p ./config
cat > ./config/values.yaml << 'YAML'
image:
  repository: myregistry.azurecr.io/firefoundry-control-plane
  tag: "latest"
replicaCount: 1
YAML

# Step 7: Install control plane
ff-cli cluster install -d ./config

# Step 8: Verify control plane pods are running
kubectl get pods -n ff-control-plane

# Step 9: Check Helm release status
helm status firefoundry-control -n ff-control-plane
```

### Verifying Cluster Readiness

Before deploying environments or applications, verify cluster readiness:

```bash
# Quick readiness check
ff-cli cluster status

# Detailed verification
kubectl get crd | grep flux
kubectl get namespace ff-control-plane
kubectl get secret myregistrycreds -n ff-control-plane
kubectl get pods -n ff-control-plane

# Check control plane logs
kubectl logs -n ff-control-plane -l app=firefoundry-control-plane --tail=50
```

### Updating Control Plane

To upgrade or reconfigure the control plane:

```bash
# Step 1: Update values.yaml with new configuration
vim ./config/values.yaml

# Step 2: Run install command (automatically performs upgrade)
ff-cli cluster install -d ./config --version 0.10.0

# Step 3: Verify upgrade completed
kubectl get pods -n ff-control-plane -w

# Step 4: Check Helm release history
helm history firefoundry-control -n ff-control-plane
```

### Rotating Registry Credentials

When registry credentials expire or need rotation:

```bash
# Option 1: Re-run cluster init with new license
ff-cli cluster init --license ./new-license.jwt --yes

# Option 2: Manually update the secret
kubectl delete secret myregistrycreds -n ff-control-plane
ff-cli cluster init --license ./new-license.jwt --yes

# Step 3: Restart control plane to pick up new credentials
kubectl rollout restart deployment -n ff-control-plane

# Verify pods restarted successfully
kubectl get pods -n ff-control-plane
```

## Troubleshooting Cluster Issues

### CRD Installation Failures

**Problem:** CRDs fail to install or become established

```bash
# Check CRD status
ff-cli cluster status

# Verify CRD establishment directly
kubectl get crd helmreleases.helm.toolkit.fluxcd.io
kubectl wait --for=condition=established crd/helmreleases.helm.toolkit.fluxcd.io --timeout=60s

# Check kubectl events for errors
kubectl get events --all-namespaces --sort-by='.lastTimestamp'

# Retry with verbose output
ff-cli cluster init --verbose --timeout 120
```

**Common causes:**
- Network issues preventing manifest download from GitHub
- Insufficient cluster resources
- Conflicting CRDs from previous Flux installation
- RBAC permissions preventing CRD creation

**Solutions:**
- Manually download and apply CRD manifests from [Flux GitHub](https://github.com/fluxcd/flux2)
- Verify cluster has sufficient resources: `kubectl top nodes`
- Remove conflicting CRDs: `kubectl delete crd <name>`
- Verify RBAC: `kubectl auth can-i create customresourcedefinitions`

### License Exchange Failures

**Problem:** License exchange fails or returns errors

```bash
# Verify license token is valid
cat license.jwt
# Should be a JWT starting with "eyJ"

# Test license service connectivity
curl -X POST https://license.firefoundry.ai/api/v1/license/credentials \
  -H "Content-Type: application/json" \
  -d '{"license":"YOUR_JWT","clusterId":"test"}'

# Check for license service URL override
echo $FF_LICENSE_SERVICE_URL
```

**Common causes:**
- Invalid or expired license token
- Network connectivity issues to license service
- License service URL misconfigured in profile
- License not authorized for cluster

**Solutions:**
- Obtain a fresh license token from your administrator
- Verify network connectivity: `curl https://license.firefoundry.ai/health`
- Use manual registry credentials as fallback: `--registry-server`, `--registry-username`, `--registry-password`
- Check profile configuration: `ff-cli profile show`

### Registry Secret Issues

**Problem:** Pods cannot pull images due to authentication failures

```bash
# Check if secret exists
kubectl get secret myregistrycreds -n ff-control-plane

# Inspect secret contents (base64 encoded)
kubectl get secret myregistrycreds -n ff-control-plane -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d

# Test secret works for image pull
kubectl run test-pull --image=myregistry.azurecr.io/test:latest \
  --image-pull-secrets=myregistrycreds -n ff-control-plane

# Check pod events for ImagePullBackOff errors
kubectl describe pod <pod-name> -n ff-control-plane
```

**Common causes:**
- Secret not created in correct namespace
- Registry credentials expired or invalid
- Wrong registry server URL in secret
- Image does not exist in registry

**Solutions:**
- Recreate secret: `ff-cli cluster init --license ./license.jwt --yes`
- Verify credentials manually: `docker login myregistry.azurecr.io`
- Check image exists: `docker pull myregistry.azurecr.io/firefoundry-control-plane:latest`
- Use correct registry server format (no `https://` prefix)

### Control Plane Installation Failures

**Problem:** Control plane installation fails or pods crash

```bash
# Check Helm release status
helm status firefoundry-control -n ff-control-plane
helm history firefoundry-control -n ff-control-plane

# Check pod status and logs
kubectl get pods -n ff-control-plane
kubectl logs -n ff-control-plane -l app=firefoundry-control-plane --tail=100

# Check for resource constraints
kubectl describe pod <pod-name> -n ff-control-plane | grep -A 10 Events

# Verify prerequisites
ff-cli cluster status
```

**Common causes:**
- Missing or invalid values.yaml configuration
- Insufficient cluster resources
- Registry secret not working
- Conflicting existing resources
- Network policies blocking communication

**Solutions:**
- Validate values.yaml syntax: `helm lint ./helm/firefoundry-control-plane -f ./config/values.yaml`
- Check cluster resources: `kubectl top nodes`
- Verify registry secret: See "Registry Secret Issues" above
- Clean up previous installation: `helm uninstall firefoundry-control -n ff-control-plane`
- Check network policies: `kubectl get networkpolicies -n ff-control-plane`

### Context and Profile Issues

**Problem:** Commands fail due to wrong kubectl context or profile

```bash
# Check current kubectl context
kubectl config current-context

# List available contexts
kubectl config get-contexts

# Check active profile
ff-cli profile show

# List all profiles
ff-cli profile list
```

**Common causes:**
- kubectl context not set to target cluster
- Profile points to different cluster than current context
- No profile selected
- Profile has no kubectl context configured

**Solutions:**
- Switch kubectl context: `kubectl config use-context <name>`
- Select correct profile: `ff-cli profile select <name>`
- Create profile if needed: `ff-cli profile create <name>`
- Edit profile to add kubectl context: `ff-cli profile edit`
- Use `--yes` flag to skip context confirmation prompts

### Helm Repository Issues

**Problem:** Cannot fetch control plane chart

```bash
# Check Helm repository is added
helm repo list

# Update Helm repositories
helm repo update

# Search for FireFoundry charts
helm search repo firebrandanalytics

# Verify chart exists
helm show chart firebrandanalytics/firefoundry-control-plane
```

**Common causes:**
- Helm repository not added
- Repository URL incorrect
- Network connectivity issues
- Chart version does not exist

**Solutions:**
- Add repository manually: `helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra/`
- Update repository: `helm repo update firebrandanalytics`
- List available versions: `helm search repo firebrandanalytics/firefoundry-control-plane --versions`
- Check repository URL: Visit https://firebrandanalytics.github.io/ff_infra/ in browser

## Related Documentation

- **[Profile Management](./profiles.md)** - Configure registry credentials and kubectl contexts
- **[Operations Guide](./ops.md)** - Build, deploy, and manage agent bundles and web UIs
- **[Tooling Management](./tooling.md)** - Install and manage required development tools
- **[Environment Management](./environments.md)** - Create and manage FireFoundry Core environments

## Advanced Topics

### Custom Control Plane Namespace

By default, the control plane is installed in the `ff-control-plane` namespace. To use a custom namespace:

1. **Update Profile**: Add `control_plane_namespace` to your profile configuration
2. **Initialize**: Run `cluster init` (uses namespace from profile)
3. **Install**: Run `cluster install` (uses namespace from profile)

Note: This feature is primarily for future extensibility. The default namespace is recommended.

### Multiple Control Planes

To run multiple control planes on different clusters:

1. **Create Separate Profiles**: One profile per cluster
2. **Switch Contexts**: Use `kubectl config use-context` between operations
3. **Select Profile**: Use `ff-cli profile select` to match the context
4. **Verify Context**: Always check `kubectl config current-context` before operations

### Offline Installation

For air-gapped or restricted environments:

1. **Download CRD Manifests**: Pre-download Flux CRD YAML files
2. **Apply Manually**: `kubectl apply -f <crd-file>.yaml`
3. **Use Credentials File**: Provide registry credentials via `--credentials-file`
4. **Skip CRD Installation**: Use `--skip-crds` flag with `cluster install`

### CI/CD Integration

For automated cluster initialization in CI/CD pipelines:

```bash
# Non-interactive initialization
ff-cli cluster init \
  --license $FF_LICENSE_TOKEN \
  --yes \
  --timeout 120

# Non-interactive control plane installation
ff-cli cluster install \
  -d ./config/production \
  --version 0.9.0 \
  --yes

# Verify installation
ff-cli cluster status || exit 1
```

## See Also

- **FireFoundry Helm Repository**: https://firebrandanalytics.github.io/ff_infra/
- **Flux Documentation**: https://fluxcd.io/docs/
- **Kubernetes Documentation**: https://kubernetes.io/docs/
- **Helm Documentation**: https://helm.sh/docs/
