# FireFoundry Getting Started Guide

This guide walks you through setting up FireFoundry from scratch on your local machine. By the end, you'll have a working FireFoundry environment and your first agent bundle deployed.

## Prerequisites

### Required Software

Install the following tools before proceeding:

**macOS:**
```bash
brew install docker minikube kubectl helm
```

**Windows:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- kubectl and helm (installed via chocolatey or manually)

**Linux:**
```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Minikube
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Recommended: k9s

[k9s](https://k9scli.io/) is a terminal-based UI for monitoring Kubernetes clusters. It provides a much better experience than raw kubectl commands for watching pods, viewing logs, and debugging issues.

**macOS:**
```bash
brew install derailed/k9s/k9s
```

**Linux/Windows:** See [k9s installation docs](https://k9scli.io/topics/install/)

Throughout this guide, we provide `kubectl` commands for automation and AI agents. Human users may prefer running `k9s` in a separate terminal to monitor progress visually.

### System Requirements

- **RAM**: 8GB minimum available for minikube
- **CPU**: 4 cores minimum
- **Disk**: 40GB available

### FireFoundry License

You need a FireFoundry license file (`license.jwt`) to proceed. This is provided by Firebrand when you sign up for FireFoundry access.

**Recommended location:**
```
~/.ff/license.jwt
```

The CLI automatically searches for your license in this order:
1. `--license` flag (explicit path)
2. `license_file` in your active profile (`~/.ff/profiles`)
3. `license.jwt` in the current working directory
4. `~/.ff/license.jwt` (recommended default)

If you place your license at `~/.ff/license.jwt`, you can omit the `--license` flag from most commands.

---

## Step 1: Start Docker

Ensure Docker is running before proceeding.

**macOS:**
```bash
open -a Docker
```

**Windows:**
Launch Docker Desktop from the Start menu.

**Verify Docker is running:**
```bash
docker ps
```

Expected: Command completes without error (empty list is fine).

---

## Step 2: Start Minikube

Create a local Kubernetes cluster with adequate resources:

```bash
minikube start --memory=8192 --cpus=4 --disk-size=40g
```

**Verify the cluster is running:**
```bash
kubectl get nodes
```

Expected: One node with status `Ready`.

### FireFoundry CLI

This guide assumes you have `ff-cli` installed. Verify with:

```bash
ff-cli --version
```

---

## Step 3: Initialize the Cluster

Initialize your cluster with FireFoundry CRDs and registry credentials:

```bash
ff-cli cluster init --license ~/.ff/license.jwt
```

(If your license is at `~/.ff/license.jwt`, the `--license` flag is optional.)

This command:
- Creates the `ff-control-plane` namespace
- Installs Flux CRDs (required for environment management)
- Exchanges your license for container registry credentials
- Creates the registry secret for pulling FireFoundry images

**Expected output:**
```
Flux CRDs installed
Registry credentials created via license exchange
Cluster initialized successfully
```

---

## Step 4: Install the Control Plane

Install the FireFoundry control plane using self-serve mode:

```bash
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y
```

This command:
- Generates configuration optimized for local development
- Deploys Kong Gateway, PostgreSQL, Flux controllers, Helm API, and FF Console
- Uses NodePort services (accessible without cloud load balancer)

**Wait for pods to start (2-3 minutes):**

Human users: run `k9s` and switch to the `ff-control-plane` namespace (`:ns ff-control-plane`).

For automation/AI agents:
```bash
kubectl get pods -n ff-control-plane -w
```

**Expected pods (all should be Running or Completed):**
- `ff-control-plane-postgresql-*`
- `firefoundry-control-*-kong-*`
- `firefoundry-control-*-helm-api-*`
- `firefoundry-control-*-ff-console-*`
- `firefoundry-control-*-flux-helm-controller-*`
- `firefoundry-control-*-flux-source-controller-*`
- `firefoundry-control-*-agent-bundle-controller-*`

Press `Ctrl+C` to stop watching once all pods are running.

---

## Step 5: Set Up Port Forwarding

The Helm API needs to be accessible for environment management. Start port forwarding in a separate terminal (or background it):

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
```

**Verify the API is accessible:**
```bash
curl -s http://localhost:8000/management/helm/v1/helmreleases
```

Expected: `{"items":[],"total":0}` (empty list since no environments exist yet).

---

## Step 6: Configure CLI Profile

Create a profile that tells the CLI where to find the Helm API:

```bash
mkdir -p ~/.ff
cat > ~/.ff/profiles << 'EOF'
[local]
helm_api_endpoint = http://localhost:8000/management/helm/v1
EOF
```

Set the active profile:
```bash
export FF_PROFILE=local
```

To make this permanent, add it to your shell configuration:
```bash
echo 'export FF_PROFILE=local' >> ~/.zshrc  # or ~/.bashrc for bash
source ~/.zshrc
```

---

## Step 7: Create Your First Environment

Create a FireFoundry environment with all core services:

```bash
ff-cli env create -t minimal-self-contained -n ff-dev -y
```

This deploys:
- **FF Broker** - LLM orchestration service
- **Context Service** - Working memory management
- **Code Sandbox** - Secure code execution
- **Entity Service** - Graph-based data storage
- **PostgreSQL** - Environment database
- **MinIO** - Object storage for working memory

**Wait for the environment to be ready:**

Human users: in k9s, switch to the `ff-dev` namespace (`:ns ff-dev`) and watch pods come up.

For automation/AI agents:
```bash
kubectl wait helmrelease/firefoundry-core -n ff-dev --for=condition=Ready --timeout=600s
```

**Verify all pods are running:**
```bash
kubectl get pods -n ff-dev
```

Expected: 11+ pods in Running or Completed state.

---

## Step 8: Configure Broker Secrets

The FF Broker needs API keys for LLM providers. Add your OpenAI or Azure OpenAI key:

**For OpenAI:**
```bash
ff-cli env broker-secret add ff-dev --key OPENAI_API_KEY --value "sk-your-key-here" -y
```

**For Azure OpenAI:**
```bash
ff-cli env broker-secret add ff-dev --key AZURE_OPENAI_API_KEY --value "your-azure-key" -y
```

**Verify the secret was added:**
```bash
ff-cli env broker-secret list ff-dev
```

The broker pod will automatically restart to pick up the new configuration (this may take up to 5 minutes due to Flux reconciliation).

---

## Step 9: Verify Your Environment

Check that all services are healthy:

```bash
# List environments
ff-cli env list

# Check specific environment status
kubectl get pods -n ff-dev

# Verify broker is running with your API key
kubectl get pods -n ff-dev -l app.kubernetes.io/name=ff-broker
```

---

## Customizing Your Environment

The `minimal-self-contained` template provides sensible defaults, but you may need to customize your environment.

### Using Custom Configuration

1. **Copy an existing template:**
   ```bash
   cp ~/.ff/environments/templates/minimal-self-contained.json ~/my-env-config.json
   ```

2. **Edit the configuration** to adjust services, storage sizes, or API keys:
   ```json
   {
     "environmentName": "my-custom-env",
     "chartVersion": "0.18.18",
     "enabledServices": ["ff-broker", "context-service", "code-sandbox", "entity-service"],
     "postgresql": {
       "enabled": true,
       "storageSize": "16Gi"
     },
     "minio": {
       "enabled": true,
       "storageSize": "20Gi"
     },
     "brokerSecrets": [
       {"name": "OPENAI_API_KEY", "value": "sk-..."}
     ]
   }
   ```

3. **Create the environment with your config:**
   ```bash
   ff-cli env create -f ~/my-env-config.json -n my-custom-env -y
   ```

### Available Templates

List templates in `~/.ff/environments/templates/`:
- `minimal-self-contained.json` - All services with bundled PostgreSQL and MinIO
- `bundled-pg.json` - Core services with bundled PostgreSQL
- Additional templates for specific deployment scenarios

### Advanced: Direct Helm Install

For full control over Helm values, you can bypass ff-cli and install directly:

```bash
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update

helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -f my-values.yaml \
  -f my-secrets.yaml \
  --namespace ff-dev --create-namespace
```

This approach gives you access to all chart options but requires managing Helm values files directly. See the **[Chart Reference](./chart-reference.md)** for all available configuration options.

---

## Next Steps

Your FireFoundry environment is now running. You can:

1. **Create an Agent Bundle Project**
   ```bash
   ff-cli project create my-first-agent
   cd my-first-agent
   ```

2. **Build and Deploy Your Agent**
   ```bash
   ff-cli ops build my-agent --minikube --tag latest
   ff-cli ops install my-agent --namespace ff-dev
   ```

3. **Access the FF Console** (management UI)
   ```bash
   kubectl port-forward -n ff-control-plane svc/firefoundry-control-firefoundry-control-plane-ff-console 3001:3001 &
   # Open http://localhost:3001 in your browser
   ```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ff-cli cluster status` | Check control plane health |
| `ff-cli cluster uninstall --full` | Completely reset control plane |
| `ff-cli env list` | List all environments |
| `ff-cli env create -t <template> -n <name>` | Create new environment |
| `ff-cli env delete <name>` | Delete an environment |
| `ff-cli env broker-secret list <env>` | List configured API keys |
| `ff-cli env broker-secret add <env> --key <name> --value <val>` | Add API key |
| `ff-cli env upgrade <env> --latest` | Upgrade environment to latest |
| `ff-cli project create <name>` | Scaffold new agent project |
| `ff-cli ops build <bundle>` | Build agent bundle image |
| `ff-cli ops install <bundle>` | Deploy agent bundle |

---

## Troubleshooting

### Pods stuck in ImagePullBackOff

Your license exchange may have failed or the registry secret is missing:

```bash
# Check if secret exists
kubectl get secret myregistrycreds -n ff-control-plane

# Re-run cluster init if missing
ff-cli cluster init --license ~/.ff/license.jwt
```

### Pods stuck in Pending

Insufficient cluster resources:

```bash
# Check resource usage
kubectl describe nodes

# Restart minikube with more resources
minikube stop
minikube start --memory=8192 --cpus=4 --disk-size=40g
```

### Helm API not responding

Ensure port forwarding is active:

```bash
# Check if port-forward is running
ps aux | grep port-forward

# Restart if needed
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
```

### Environment creation fails

Verify the control plane is healthy:

```bash
# Check Helm API pod
kubectl get pods -n ff-control-plane | grep helm-api

# Check Helm API logs
kubectl logs -n ff-control-plane -l app.kubernetes.io/name=helm-api --tail=50
```

### Broker pod keeps restarting

Check if API keys are configured correctly:

```bash
# View broker logs
kubectl logs -n ff-dev -l app.kubernetes.io/name=ff-broker --tail=100

# List configured secrets
ff-cli env broker-secret list ff-dev
```

---

## Clean Up

To remove everything and start fresh:

```bash
# Delete environments
ff-cli env delete ff-dev -y

# Uninstall control plane
ff-cli cluster uninstall -y

# Stop minikube
minikube stop

# Delete minikube cluster entirely (optional)
minikube delete
```

### Starting Fresh with the Control Plane

If you need to completely reset the FireFoundry control plane (e.g., after a failed installation or to test a clean setup), use:

```bash
ff-cli cluster uninstall --full -y
```

This removes all FireFoundry resources including:
- The `ff-control-plane` namespace and all its contents
- Flux CRDs and controllers
- Registry credentials

After running this, you can start over from Step 3 (Initialize the Cluster).
