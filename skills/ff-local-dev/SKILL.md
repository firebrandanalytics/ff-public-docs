---
name: ff-local-dev
description: Help users set up their local FireFoundry development environment from scratch or install firefoundry-core with custom environment overrides. Use when the user mentions "set up firefoundry locally", "bootstrap minikube", "install control plane", "first time setup", "local development environment", "firefoundry license", "helm install firefoundry-core", "firebrand-dev-all-in", "install with overrides", or needs help getting started with FireFoundry on their local machine.
version: 1.1.0
tags: [setup, local-dev, minikube, kubernetes, onboarding, helm, firefoundry-core]
---

# FireFoundry Local Development Setup

A friendly guide to help you get your local FireFoundry development environment up and running.

## Overview

This skill helps you through the complete local development setup:

```
Prerequisites -> License -> Minikube -> Cluster Init -> Control Plane Install -> Ready!
```

## When to Use This Skill

**Trigger phrases:**
- "Help me set up FireFoundry locally"
- "I'm new to FireFoundry, how do I get started?"
- "Set up my minikube for FireFoundry"
- "Install the FireFoundry control plane"
- "What is a FireFoundry license?"
- "Bootstrap my local development environment"
- "Install firefoundry-core with firebrand-dev-all-in"
- "Helm install firefoundry-core"
- "Install with custom environment overrides"
- "How do I use the environment configs?"

## Approach

When helping users with local setup, be:
- **Patient**: This may be their first time with Kubernetes
- **Clear**: Explain what each step does and why
- **Helpful**: Offer to check prerequisites and troubleshoot issues
- **Encouraging**: Local setup can feel complex, celebrate progress

## Prerequisites Check

Before starting, verify the user has these tools installed:

```bash
# Check all prerequisites at once
ff-cli ops doctor
```

Or check individually:

| Tool | Check Command | Install |
|------|---------------|---------|
| Docker | `docker --version` | [docker.com](https://docker.com) or `ff-cli tooling install docker` |
| kubectl | `kubectl version --client` | `ff-cli tooling install kubectl` |
| Helm | `helm version` | `ff-cli tooling install helm` |
| Minikube | `minikube version` | `ff-cli tooling install minikube` |
| ff-cli | `ff-cli --version` | Download from releases |

**Help the user install missing tools:**
```bash
# Interactive tool installation
ff-cli tooling init
```

## Understanding the FireFoundry License

### What is a FireFoundry License?

A FireFoundry license is a JWT (JSON Web Token) file that:
- Grants access to FireFoundry's private container registry
- Enables downloading of FireFoundry images (control plane, core services)
- Is exchanged for registry credentials during setup

### How to Get a License

1. **Contact Firebrand Analytics** to obtain a license
2. You'll receive a `.jwt` file (e.g., `license.jwt`)
3. Save this file to `~/.ff/` (recommended) or your project folder

### License File Format

The license is a text file containing a JWT token. It looks something like:
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkw...
```

**Important:** Keep your license file secure - it grants access to FireFoundry resources.

### License Auto-Discovery

When you run `cluster init` or `cluster install --self-serve` without specifying `--license`, ff-cli searches for your license JWT in the following order:

1. `--license <path>` CLI flag (explicit path or raw JWT string)
2. `license` field in your active `~/.ff/profiles` profile
3. `*.jwt` files in your current working directory (interactive selection if multiple)
4. `*.jwt` files in `~/.ff/` directory (auto-used if single file, interactive if multiple)

The recommended location is `~/.ff/license.jwt` - this allows ff-cli to find it automatically without needing the `--license` flag every time.

To set license in your profile instead:
```ini
# In ~/.ff/profiles
[my-profile]
license=/path/to/license.jwt
```

## Step-by-Step Setup Guide

### Step 1: Start Minikube

```bash
# Start minikube with recommended resources
minikube start --cpus=4 --memory=8192

# Verify it's running
minikube status
```

**Recommended resources:**
- CPUs: 4+ (minimum 2)
- Memory: 8GB+ (minimum 4GB)
- Disk: 20GB+

**If minikube is already running:**
```bash
# Check status
minikube status

# If needed, stop and restart with more resources
minikube stop
minikube start --cpus=4 --memory=8192
```

### Step 2: Initialize the Cluster

This installs required CRDs (Flux) and creates the registry secret:

```bash
# With a license file (recommended)
ff-cli cluster init --license ./license.jwt --yes

# Or interactively
ff-cli cluster init
```

**What this does:**
1. Installs Flux CRDs (HelmRelease, HelmRepository, etc.)
2. Creates the `ff-control-plane` namespace
3. Exchanges your license for registry credentials
4. Creates the registry pull secret

### Step 3: Install the Control Plane

Self-serve mode generates all configuration automatically:

```bash
# Self-serve installation (recommended)
ff-cli cluster install --self-serve --license ./license.jwt --yes
```

**What this does:**
1. Generates a secure database password
2. Creates values.yaml with sensible defaults
3. Installs the FireFoundry control plane Helm chart
4. Sets up PostgreSQL, Kong API Gateway, and Flux controllers

**During installation you'll see:**
- Registry credentials being obtained
- Cluster type selection (local vs cloud)
- Helm API configuration
- Control plane deployment progress

### Step 4: Start Minikube Tunnel

For local clusters, you need minikube tunnel to access services:

```bash
# In a separate terminal (keeps running)
minikube tunnel
```

**Note:** This requires sudo/admin privileges and must stay running while you work.

### Step 5: Verify Installation

```bash
# Check cluster status
ff-cli cluster status

# Check pods are running
kubectl get pods -n ff-control-plane

# Check HelmRepositories are ready
kubectl get helmrepository -n ff-control-plane
```

**Expected output:**
- All pods should be `Running` or `Completed`
- HelmRepositories should show `READY: True`

## Accessing the Control Plane

### Kong Gateway (API access)
- HTTP: `http://localhost:9080`
- HTTPS: `https://localhost:9443`

### FF Console (Web UI)
After tunnel is running:
```bash
# Port-forward to console
kubectl port-forward -n ff-control-plane svc/ff-console 3001:3001
```
Access at: `http://localhost:3001`

## Next Steps After Setup

Once your control plane is running:

1. **Create an environment** for deploying agent bundles:
   ```bash
   # List available templates
   ff-cli env template list

   # Create from a template (e.g., websearch-enabled)
   ff-cli env create -t <template-name>

   # Or create interactively
   ff-cli environment create --simple
   ```

   **Note**: There's no `env update` command. To change subcharts (e.g., enable websearch after the fact), you must `ff-cli env delete --purge --force` and recreate.

2. **Create the system application** (required for SDK v4):
   ```bash
   # Port-forward entity-service first
   ff-cli port-forward firefoundry-core-entity-service 8080:8080 -n ff-test --name entity

   curl -s -X POST http://localhost:8080/api/applications \
     -H "Content-Type: application/json" \
     -d '{"id":"a0000000-0000-0000-0000-000000000000","name":"System","type":"system","description":"System application"}'
   ```

3. **Create a new project**:
   ```bash
   ff-cli application create my-first-app --skip-git
   cd my-first-app
   ff-cli agent-bundle create my-bundle
   pnpm install
   ```

4. **Build and deploy**:
   ```bash
   ff-cli ops build
   ff-cli ops deploy --values local
   ```

## Troubleshooting

### "License exchange failed"

```bash
# Check network connectivity
curl -I https://home.20.59.124.75.nip.io

# Verify license file exists and is readable
cat ./license.jwt | head -c 50
```

### "Pods stuck in Pending"

```bash
# Check for resource issues
kubectl describe pod -n ff-control-plane <pod-name>

# Minikube might need more resources
minikube stop
minikube start --cpus=4 --memory=8192
```

### "Kong authentication failed"

This usually means a password mismatch after reinstall:

```bash
# Full uninstall and clean reinstall
ff-cli cluster uninstall --full --yes
ff-cli cluster init --license ./license.jwt --yes
ff-cli cluster install --self-serve --license ./license.jwt --yes
```

### "HelmRepository not ready"

```bash
# Check Flux source-controller
kubectl logs -n ff-control-plane -l app=source-controller

# Verify HelmRepositories
kubectl get helmrepository -n ff-control-plane
```

### "Minikube tunnel not working"

```bash
# Ensure tunnel is running (separate terminal)
minikube tunnel

# Check LoadBalancer services have external IPs
kubectl get svc -n ff-control-plane | grep LoadBalancer
```

## Uninstall and Reinstall

### Preserving Data (Standard Uninstall)

```bash
# Uninstall but keep database data
ff-cli cluster uninstall --yes

# Reinstall - will reuse existing credentials
ff-cli cluster install --self-serve --license ./license.jwt --yes
```

### Clean Slate (Full Uninstall)

```bash
# Delete everything including data
ff-cli cluster uninstall --full --yes

# Fresh install
ff-cli cluster init --license ./license.jwt --yes
ff-cli cluster install --self-serve --license ./license.jwt --yes
```

## Manual Helm Install with Environment Overrides

For development and testing, you may want to install `firefoundry-core` with specific environment configurations instead of using self-serve mode.

### Available Environment Configurations

Environment configurations are stored in the `ff-configs` repository under `environments/`:

| Environment | Description | PostgreSQL | Storage |
|-------------|-------------|------------|---------|
| `firebrand-dev-all-in` | Full-featured bundled setup | Bundled (in-cluster) | Bundled MinIO |
| `dev` | External Azure DB | Azure PostgreSQL | Azure Blob |
| `dev-core-db` | Bundled DB, external storage | Bundled | Azure Blob |
| `firebrand-dev-aks` | AKS with external Azure DB | Azure PostgreSQL | Azure Blob |
| `gcp-dev` | GCP Cloud SQL | Cloud SQL Proxy | GCS |

### Installing firefoundry-core with firebrand-dev-all-in

The `firebrand-dev-all-in` environment is ideal for local development - it includes bundled PostgreSQL, MinIO, and all core services including Virtual Worker Manager and WebSearch Service.

**Prerequisites:**
1. Minikube running with sufficient resources
2. Cluster initialized (`ff-cli cluster init`)
3. Helm repo added

```bash
# Ensure minikube is running
minikube status

# Add the FireFoundry Helm repository (if not already added)
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update
```

**Step 1: Initialize the target namespace with `environment init`**

Before installing firefoundry-core, you must initialize the namespace. This creates the namespace and copies the registry pull secret from the control plane:

```bash
# Initialize the namespace (copies registry credentials from ff-control-plane)
ff-cli environment init ff-dev
```

**What `environment init` does:**
1. Creates the namespace if it doesn't exist
2. Finds the `kubernetes.io/dockerconfigjson` secret in `ff-control-plane`
3. Copies it to the target namespace with tracking labels
4. Makes it available for pods to pull FireFoundry images

**Step 2: Install firefoundry-core:**

```bash
# Navigate to the configs directory
cd <ff-configs>/environments/firebrand-dev-all-in

# Install with both values files (order matters: base config first, then secrets)
# Note: No --create-namespace needed since environment init already created it
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -f core-values.yaml \
  -f secrets.yaml \
  --namespace ff-dev
```

**Why `environment init` instead of `--create-namespace`?**

Using `helm install --create-namespace` alone will fail because:
- FireFoundry images are in a private registry
- Pods need a registry pull secret (`myregistrycreds`) to download images
- `--create-namespace` creates an empty namespace without the secret
- Result: Pods stuck in `ImagePullBackOff`

The `environment init` command solves this by copying the registry credentials.

**Upgrade an existing installation:**

```bash
cd <ff-configs>/environments/firebrand-dev-all-in

helm upgrade firefoundry-core firebrandanalytics/firefoundry-core \
  -f core-values.yaml \
  -f secrets.yaml \
  --namespace ff-dev
```

### What's Included in firebrand-dev-all-in

This environment enables:

| Service | Status | Notes |
|---------|--------|-------|
| ff-broker | Enabled | LLM orchestration |
| context-service | Enabled | Working memory management |
| entity-service | Enabled | Entity graph storage |
| doc-proc-service | Enabled | Document processing |
| code-sandbox | Disabled | Can enable if needed |
| virtual-worker-manager | Enabled | AI coding agent orchestration |
| websearch-service | Enabled | Brave-powered web search |
| PostgreSQL | Bundled | In-cluster database |
| MinIO | Bundled | S3-compatible object storage |

### Verifying the Installation

```bash
# Check all pods are running
kubectl get pods -n ff-dev

# Check HelmRelease status (if using Flux)
kubectl get helmrelease -n ff-dev

# Check services
kubectl get svc -n ff-dev

# Watch pod startup
kubectl get pods -n ff-dev -w
```

### Accessing Services

With minikube tunnel running (or use `ff-cli port-forward` for managed port-forwards):

```bash
# Start tunnel (separate terminal)
minikube tunnel

# Port-forward to specific services (prefer ff-cli for managed processes)
ff-cli port-forward firefoundry-core-kong-proxy 8000:80 -n ff-test --name kong
ff-cli port-forward firefoundry-core-entity-service 8080:8080 -n ff-test --name entity
ff-cli port-forward firefoundry-core-ff-broker 50051:50051 -n ff-test --name broker

# Or with raw kubectl:
kubectl port-forward -n ff-test svc/firefoundry-core-ff-broker 50051:50051
kubectl port-forward -n ff-test svc/firefoundry-core-context-service 50051:50051
kubectl port-forward -n ff-test svc/firefoundry-core-entity-service 8080:8080
```

**Note**: The broker gRPC port is **50051** (not 50052).

### Post-Install: System Application

SDK v4 agent bundles require the system application `a0000000-0000-0000-0000-000000000000` to exist in entity-service. This is not auto-seeded (ff-services-entity#9). Create it manually after entity-service is running:

```bash
curl -s -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{"id":"a0000000-0000-0000-0000-000000000000","name":"System","type":"system","description":"System application"}'
```

### Post-Install: Broker LLM Routing

For agent bundles to make LLM calls, you need at least one model routing chain configured in the broker. Use `ff-cli env broker-config create` to set this up:

```bash
# Add your LLM provider API key
ff-cli env broker-secret add <env-name> --key GOOGLE_API_KEY --value <your-key>

# Create a model routing config
ff-cli env broker-config create --name gemini_completion
```

**Known issue**: `ff-cli env broker-secret add` may not actually update the K8s secret (ff-cli-go#48). Verify with:
```bash
kubectl get secret firefoundry-core-ff-broker-secret -n <namespace> \
  -o jsonpath='{.data.GOOGLE_API_KEY}' | base64 -d
```
If the old value persists, use `kubectl patch secret` directly.

### Environment Configuration Pattern

Each environment follows a two-file pattern:

1. **core-values.yaml** - Non-sensitive configuration:
   - Service enablement flags
   - Resource limits
   - ConfigMap data (hosts, ports, feature flags)
   - Ingress/service configuration

2. **secrets.yaml** - Sensitive configuration (git-ignored):
   - Database passwords
   - API keys
   - Storage credentials
   - Connection strings

**Important:** Never commit `secrets.yaml` to version control.

### Switching Between Environments

To switch to a different environment configuration in the same namespace:

```bash
# Uninstall current
helm uninstall firefoundry-core -n ff-dev

# Install with different environment config
cd <ff-configs>/environments/dev  # or dev-core-db, gcp-dev, etc.
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -f core-values.yaml \
  -f secrets.yaml \
  --namespace ff-dev
```

To install in a different namespace:

```bash
# Initialize the new namespace first (copies registry credentials)
ff-cli environment init my-new-env

# Install into the new namespace
cd <ff-configs>/environments/firebrand-dev-all-in
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -f core-values.yaml \
  -f secrets.yaml \
  --namespace my-new-env
```

### Troubleshooting Manual Install

**Pods stuck in ImagePullBackOff:**
```bash
# Check if registry secret exists in the target namespace
kubectl get secret myregistrycreds -n ff-dev

# If missing, initialize the namespace to copy the registry secret
ff-cli environment init ff-dev

# If the control plane doesn't have the secret either, reinitialize cluster
ff-cli cluster init --license ./license.jwt --yes
# Then initialize the environment namespace
ff-cli environment init ff-dev
```

**Database connection errors:**
```bash
# For bundled PostgreSQL, check it's running
kubectl get pods -n ff-dev | grep postgresql

# Check PostgreSQL logs
kubectl logs -n ff-dev firefoundry-core-postgresql-0
```

**MinIO not accessible:**
```bash
# Check MinIO pod
kubectl get pods -n ff-dev | grep minio

# Check MinIO logs
kubectl logs -n ff-dev -l app.kubernetes.io/name=minio
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `minikube start --cpus=4 --memory=8192` | Start minikube |
| `minikube tunnel` | Enable LoadBalancer access |
| `ff-cli cluster init --license ./license.jwt` | Initialize cluster |
| `ff-cli cluster install --self-serve` | Install control plane |
| `ff-cli environment init <name>` | Initialize namespace with registry credentials |
| `helm install firefoundry-core ... -f core-values.yaml -f secrets.yaml` | Manual install with overrides |
| `ff-cli cluster status` | Check status |
| `ff-cli cluster uninstall` | Uninstall (preserve data) |
| `ff-cli cluster uninstall --full` | Uninstall (delete everything) |

## Getting Help

If you encounter issues:

1. Check `ff-cli ops doctor` for prerequisite issues
2. Check pod logs: `kubectl logs -n ff-control-plane <pod-name>`
3. Check events: `kubectl get events -n ff-control-plane --sort-by='.lastTimestamp'`
4. Reach out to the FireFoundry team for license or access issues
