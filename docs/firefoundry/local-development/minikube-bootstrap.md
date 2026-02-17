# Minikube Bootstrap Guide

A complete, step-by-step guide to bootstrapping FireFoundry on a local Minikube cluster. This guide takes you from zero to a fully running FireFoundry environment with core services deployed.

**Time estimate**: 30-45 minutes (including image pulls on first run).

**Related guides**:
- [Troubleshooting](./troubleshooting.md) -- common failures and fixes
- [AKS Bootstrap Guide](../getting-started/aks-bootstrap.md) -- cloud deployment on Azure Kubernetes Service
- [Chart Reference](../../ff_local_dev/chart-reference.md) -- full Helm values reference

---

## Prerequisites

### Required Software

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Docker Desktop | Latest stable | Container runtime for minikube |
| Minikube | v1.30+ | Local Kubernetes cluster |
| kubectl | v1.27+ | Kubernetes CLI |
| Helm | v3.12+ | Kubernetes package manager |
| ff-cli | Latest | FireFoundry CLI ([releases](https://github.com/firebrandanalytics/ff-cli-releases)) |

**macOS (Homebrew):**
```bash
brew install docker minikube kubectl helm
```

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

**Windows:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- kubectl and Helm via [Chocolatey](https://chocolatey.org/) or manual download

### ff-cli Installation

Download from the [releases page](https://github.com/firebrandanalytics/ff-cli-releases):

```bash
# macOS (Apple Silicon)
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-darwin-arm64

# macOS (Intel)
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-darwin-amd64

# Linux
curl -L -o ff-cli https://github.com/firebrandanalytics/ff-cli-releases/releases/latest/download/ff-cli-linux-amd64

chmod +x ff-cli
sudo mv ff-cli /usr/local/bin/
```

### Optional but Recommended

- **[k9s](https://k9scli.io/)** -- terminal-based Kubernetes UI for monitoring pods and logs in real time. `brew install derailed/k9s/k9s` on macOS.

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB available for minikube | 16 GB total system |
| CPU | 4 cores | 6+ cores |
| Disk | 40 GB available | 60 GB available |

### FireFoundry License

You need a `license.jwt` file provided by Firebrand. Place it at the default location:

```bash
mkdir -p ~/.ff
cp /path/to/license.jwt ~/.ff/license.jwt
```

The CLI searches for licenses in this order:
1. `--license` flag (explicit path)
2. `license_file` in your active profile (`~/.ff/profiles`)
3. `license.jwt` in the current working directory
4. `~/.ff/license.jwt` (recommended default)

---

## Step 1: Start Docker

Ensure Docker is running before starting minikube.

**macOS:**
```bash
open -a Docker
```

**Windows:**
Launch Docker Desktop from the Start menu.

**Linux:**
```bash
sudo systemctl start docker
```

**Verify Docker is running:**
```bash
docker ps
```

**What to expect:** The command completes without error. An empty container list is fine.

**Common issues:**
- "Cannot connect to the Docker daemon" -- Docker Desktop is not running. Start it and wait for it to finish loading.
- On Linux, ensure your user is in the `docker` group: `sudo usermod -aG docker $USER` (log out and back in after).

---

## Step 2: Start Minikube

Create a local Kubernetes cluster with resources sized for FireFoundry:

```bash
minikube start --memory=8192 --cpus=4 --disk-size=40g
```

**Why these resource allocations?**
- **8 GB memory**: FireFoundry runs 10+ services (PostgreSQL, Kong, FF Broker, Context Service, etc.). Each requires 256 MB-1 GB.
- **4 CPUs**: Concurrent services need parallel processing capacity.
- **40 GB disk**: Container images total 3-5 GB, plus persistent volume data for PostgreSQL and MinIO.

**Verify the cluster is running:**
```bash
kubectl get nodes
```

**What to expect:**
```
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   30s   v1.28.x
```

**Common issues:**
- "Exiting due to RSRC_INSUFFICIENT_CORES" -- close resource-heavy applications or reduce `--cpus`.
- "minikube start failed" -- try `minikube delete` and start again. See [Troubleshooting - Minikube Issues](./troubleshooting.md#minikube-issues).

---

## Step 3: Initialize the Cluster

Initialize the cluster with FireFoundry CRDs and container registry credentials:

```bash
ff-cli cluster init --license ~/.ff/license.jwt
```

If your license is at `~/.ff/license.jwt`, the `--license` flag is optional:

```bash
ff-cli cluster init
```

This command:
- Creates the `ff-control-plane` namespace
- Installs Flux CRDs (required for Helm-based environment management)
- Exchanges your license for container registry credentials
- Creates the `myregistrycreds` secret for pulling FireFoundry images

**What to expect:**
```
Flux CRDs installed
Registry credentials created via license exchange
Cluster initialized successfully
```

**Common issues:**
- "license file not found" -- verify the license path. Run `ls ~/.ff/license.jwt`.
- "unable to connect to the server" -- kubectl is not configured for minikube. Run `kubectl config use-context minikube`.
- Network errors during license exchange -- check internet connectivity. The CLI contacts the Firebrand license service.

---

## Step 4: Install the Control Plane

Install the FireFoundry control plane using self-serve mode (generates optimized config for local development):

```bash
ff-cli cluster install --self-serve --cluster-type local -y
```

This deploys the following into the `ff-control-plane` namespace:
- **PostgreSQL** -- shared database for control plane services
- **Kong Gateway** -- API gateway (NodePort for local access)
- **Flux controllers** -- source-controller and helm-controller for GitOps-style environment management
- **Helm API** -- HTTP interface for Helm operations
- **FF Console** -- management UI
- **Agent Bundle Controller** -- watches and manages agent bundle deployments

**Wait for all pods to be running (2-5 minutes):**

If you have k9s installed, run it in a separate terminal and switch to the `ff-control-plane` namespace (`:ns ff-control-plane`).

Otherwise, watch pods with kubectl:
```bash
kubectl get pods -n ff-control-plane -w
```

Press `Ctrl+C` when all pods show `Running` or `Completed`.

**What to expect:**
```
NAME                                                              READY   STATUS
ff-control-plane-postgresql-0                                     1/1     Running
firefoundry-control-*-kong-*                                      1/1     Running
firefoundry-control-*-helm-api-*                                  1/1     Running
firefoundry-control-*-ff-console-*                                1/1     Running
firefoundry-control-*-flux-helm-controller-*                      1/1     Running
firefoundry-control-*-flux-source-controller-*                    1/1     Running
firefoundry-control-*-agent-bundle-controller-*                   1/1     Running
```

You can also verify with:
```bash
ff-cli cluster status
```

**Common issues:**
- Pods stuck in `ImagePullBackOff` -- registry credentials may be missing. Re-run `ff-cli cluster init`.
- Pods stuck in `Pending` -- insufficient resources. Check `kubectl describe nodes` for resource pressure.
- Helm timeout -- the default timeout is 10 minutes. If on a slow connection, retry with `--timeout 20m`.
- See [Troubleshooting - Image Pull Errors](./troubleshooting.md#image-pull-errors) for more details.

---

## Step 5: Set Up Port Forwarding

The Helm API must be accessible for environment management. Start port forwarding in a separate terminal or background it:

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
```

**Verify the API is accessible:**
```bash
curl -s http://localhost:8000/management/helm/v1/helmreleases
```

**What to expect:**
```json
{"message":"No API key found in request"}
```

This confirms Kong is routing to the Helm API. The "no API key" message is expected -- `ff-cli` handles authentication automatically using a key generated during control plane installation.

**Common issues:**
- "Connection refused" -- the kong-proxy pod may not be ready yet. Wait a moment and retry.
- Port already in use -- another process is using port 8000. Use a different local port: `kubectl port-forward ... 8001:9080`.
- Port forwarding dies after sleep/network change -- restart the command.

---

## Step 6: Configure CLI Profile

Create a profile that tells ff-cli where to find the Helm API:

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

To make this permanent:
```bash
echo 'export FF_PROFILE=local' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc
```

Alternatively, use the interactive profile creation:
```bash
ff-cli profile create local --use
```

When prompted, select **minikube** as the kubectl context and configure registry settings as **Minikube** type.

---

## Step 7: Create Your First Environment

Deploy a FireFoundry environment with all core services:

```bash
ff-cli env create -t minimal-self-contained -n ff-dev -y
```

This creates the `ff-dev` namespace and deploys:
- **FF Broker** (v6.4.1) -- LLM orchestration service (gRPC port 50051, HTTP port 3000)
- **Context Service** (v3.2.1) -- working memory management (gRPC port 50051)
- **Entity Service** (v1.1.0) -- graph-based entity storage (HTTP port 8080)
- **MCP Gateway** (v0.1.2) -- Model Context Protocol gateway (HTTP port 8080)
- **PostgreSQL** -- environment database (port 5432)
- **MinIO** -- S3-compatible object storage for working memory

**First-time image pulls take 15-25 minutes.** FireFoundry images are 300-500 MB each across 9+ services. Subsequent deployments use cached images and are much faster.

**Wait for the environment to be ready:**

With k9s, switch to the `ff-dev` namespace (`:ns ff-dev`) and watch pods come up.

With kubectl:
```bash
kubectl wait helmrelease/firefoundry-core -n ff-dev --for=condition=Ready --timeout=1200s
```

**Verify all pods are running:**
```bash
kubectl get pods -n ff-dev
```

**What to expect:** 11+ pods in `Running` or `Completed` state.

**Common issues:**
- Image pulls are slow -- this is normal on first run. Subsequent runs use cached images.
- Pods in `CrashLoopBackOff` -- check logs with `kubectl logs <pod-name> -n ff-dev`. Common cause: database not ready yet. The pods will self-heal once PostgreSQL is running.
- See [Troubleshooting - Pod Startup Issues](./troubleshooting.md#pod-startup-issues) for detailed diagnostics.

---

## Step 8: Configure Broker Secrets

The FF Broker needs API keys for LLM providers. Add at least one:

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

The broker pod automatically restarts to pick up new configuration. This may take up to 5 minutes due to Flux reconciliation.

---

## Step 9: Verify the Complete Installation

Run through these verification checks to confirm everything is working:

```bash
# 1. Control plane healthy
ff-cli cluster status

# 2. Environment listed
ff-cli env list

# 3. All pods running in control plane
kubectl get pods -n ff-control-plane

# 4. All pods running in environment
kubectl get pods -n ff-dev

# 5. Broker has API keys
ff-cli env broker-secret list ff-dev
```

**What to expect:** All commands succeed. All pods show `Running` or `Completed`. At least one broker secret is listed.

---

## Step 10: Create and Deploy Your First Agent Bundle

With the platform running, scaffold and deploy a project:

```bash
# Create a new project
ff-cli project create my-first-agent
cd my-first-agent

# Build the Docker image (uses minikube's Docker daemon)
ff-cli ops build my-first-agent --minikube-profile minikube --tag latest -y

# Deploy to your environment
ff-cli ops install my-first-agent --namespace ff-dev --values local -y
```

**Verify the agent bundle is running:**
```bash
kubectl get pods -n ff-dev | grep my-first-agent
```

**Access the FF Console (management UI):**
```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-firefoundry-control-plane-ff-console 3001:3001 &
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ff-cli cluster init` | Initialize cluster with CRDs and registry credentials |
| `ff-cli cluster install --self-serve --cluster-type local -y` | Install control plane |
| `ff-cli cluster status` | Check control plane health |
| `ff-cli cluster uninstall -y` | Remove control plane (keeps CRDs for quick reinstall) |
| `ff-cli cluster uninstall --full -y` | Remove everything (CRDs, namespace, credentials) |
| `ff-cli env create -t <template> -n <name> -y` | Create a new environment |
| `ff-cli env list` | List all environments |
| `ff-cli env delete <name> -y` | Delete an environment |
| `ff-cli env broker-secret add <env> --key <name> --value <val> -y` | Add LLM API key |
| `ff-cli env broker-secret list <env>` | List configured API keys |
| `ff-cli env upgrade <env> --latest` | Upgrade environment to latest chart version |
| `ff-cli project create <name>` | Scaffold a new agent bundle project |
| `ff-cli ops build <bundle> --minikube-profile minikube --tag latest` | Build Docker image locally |
| `ff-cli ops install <bundle> --namespace <ns>` | Deploy agent bundle |
| `ff-cli ops upgrade <bundle> --namespace <ns>` | Upgrade agent bundle |
| `ff-cli tooling doctor` | Diagnose environment issues |

---

## Clean Up

### Remove an Environment

```bash
ff-cli env delete ff-dev -y
```

### Remove the Control Plane

```bash
# Quick uninstall (keeps CRDs and namespace for fast reinstall)
ff-cli cluster uninstall -y

# Full uninstall (removes everything)
ff-cli cluster uninstall --full -y
```

| Command | What it removes |
|---------|----------------|
| `cluster uninstall` | Helm release only. Keeps namespace, Flux CRDs, and registry secret. |
| `cluster uninstall --full` | Everything: namespace, Flux CRDs, External Secrets CRDs, and registry credentials. |

After a quick uninstall, resume from [Step 4](#step-4-install-the-control-plane).
After a full uninstall, resume from [Step 3](#step-3-initialize-the-cluster).

### Stop Minikube

```bash
minikube stop
```

### Delete Minikube Entirely

```bash
minikube delete
```

---

## Next Steps

- [Agent Development Guide](./agent-development.md) -- build and deploy agent bundles
- [Updating Agent Bundles](./updating-agent-bundles.md) -- iterative development workflow
- [FF CLI Operations Guide](../../ff-cli/ops.md) -- build, install, upgrade commands
- [Troubleshooting](./troubleshooting.md) -- common issues and fixes
- [Chart Reference](../../ff_local_dev/chart-reference.md) -- all Helm configuration options
