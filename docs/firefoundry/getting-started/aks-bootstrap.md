# AKS Bootstrap Guide

A step-by-step guide to deploying FireFoundry on Azure Kubernetes Service (AKS). This guide covers creating the AKS cluster, installing the FireFoundry control plane, and deploying your first environment.

**Related guides**:
- [Minikube Bootstrap Guide](../local-development/minikube-bootstrap.md) -- local development setup
- [Troubleshooting](../local-development/troubleshooting.md) -- common failures and fixes
- [Chart Reference](../../ff_local_dev/chart-reference.md) -- full Helm values reference

---

## Prerequisites

### Required Tools

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Azure CLI (`az`) | v2.50+ | Azure resource management |
| kubectl | v1.27+ | Kubernetes CLI |
| Helm | v3.12+ | Kubernetes package manager |
| ff-cli | Latest | FireFoundry CLI ([releases](https://github.com/firebrandanalytics/ff-cli-releases)) |

Install the Azure CLI:

```bash
# macOS
brew install azure-cli

# Linux
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Windows
winget install -e --id Microsoft.AzureCLI
```

Install kubectl and Helm (if not already installed):

```bash
# macOS
brew install kubectl helm

# Linux
az aks install-cli  # installs kubectl and kubelogin
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Azure Requirements

- An Azure subscription with permissions to create resources
- A resource group (or permission to create one)
- Sufficient quota for your chosen VM sizes (see [Cluster Sizing](#cluster-sizing))

### FireFoundry License

You need a `license.jwt` file provided by Firebrand:

```bash
mkdir -p ~/.ff
cp /path/to/license.jwt ~/.ff/license.jwt
```

---

## Step 1: Authenticate with Azure

Log in to Azure and set your subscription:

```bash
az login
az account set --subscription "<your-subscription-name-or-id>"
```

Verify:
```bash
az account show --query "{name:name, id:id}" -o table
```

---

## Step 2: Create a Resource Group

Choose a region and create a resource group:

```bash
export AZ_RESOURCE_GROUP="firefoundry-rg"
export AZ_LOCATION="westus"

az group create --name $AZ_RESOURCE_GROUP --location $AZ_LOCATION
```

---

## Step 3: Create the AKS Cluster

### Cluster Sizing

FireFoundry requires a cluster with enough resources to run the control plane and at least one environment. The following table shows recommended configurations:

| Configuration | Node Pool | VM Size | vCPU | RAM | Nodes | Monthly Cost (est.) |
|---------------|-----------|---------|------|-----|-------|---------------------|
| Development | System | Standard_B4ms | 4 | 16 GB | 1 | ~$60 |
| Development | Workers | Standard_B2ms | 2 | 8 GB | 1-2 | ~$30-60 |
| Production | System | Standard_D4s_v5 | 4 | 16 GB | 2 | ~$280 |
| Production | Workers | Standard_D4s_v5 | 4 | 16 GB | 2-4 | ~$280-560 |

### Create the Cluster

For a development cluster:

```bash
export AKS_CLUSTER_NAME="firefoundry-dev"

az aks create \
  --resource-group $AZ_RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --location $AZ_LOCATION \
  --node-count 1 \
  --node-vm-size Standard_B4ms \
  --os-disk-size-gb 128 \
  --network-plugin azure \
  --service-cidr 172.17.0.0/16 \
  --dns-service-ip 172.17.0.10 \
  --enable-managed-identity \
  --enable-oidc-issuer \
  --enable-workload-identity \
  --generate-ssh-keys \
  --tier free
```

This creates a cluster with:
- Azure CNI networking (required for service mesh and network policies)
- Managed identity (preferred over service principals)
- OIDC issuer enabled (used by FireFoundry license service)
- Workload identity enabled (for secure service-to-service auth)

### Add a Worker Node Pool (recommended)

Separate the control plane workloads from agent bundles:

```bash
az aks nodepool add \
  --resource-group $AZ_RESOURCE_GROUP \
  --cluster-name $AKS_CLUSTER_NAME \
  --name workers \
  --node-count 1 \
  --node-vm-size Standard_B2ms \
  --enable-cluster-autoscaler \
  --min-count 1 \
  --max-count 3
```

**What to expect:** Cluster creation takes 5-10 minutes.

---

## Step 4: Configure kubectl

Get credentials for your new cluster:

```bash
az aks get-credentials \
  --resource-group $AZ_RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME
```

Verify connectivity:
```bash
kubectl get nodes
```

**What to expect:**
```
NAME                                STATUS   ROLES    AGE   VERSION
aks-nodepool1-12345678-vmss000000   Ready    <none>   5m    v1.28.x
```

---

## Step 5: Initialize the Cluster

Initialize the cluster with FireFoundry CRDs and container registry credentials:

```bash
ff-cli cluster init --license ~/.ff/license.jwt
```

This command:
- Creates the `ff-control-plane` namespace
- Installs Flux CRDs (required for environment management)
- Exchanges your license for container registry credentials
- Creates the `myregistrycreds` secret for pulling FireFoundry images

**What to expect:**
```
Flux CRDs installed
Registry credentials created via license exchange
Cluster initialized successfully
```

**Common issues:**
- "unable to connect to the server" -- run `az aks get-credentials` again.
- License exchange failures -- check internet connectivity and license validity.

---

## Step 6: Install the Control Plane

Install the FireFoundry control plane using self-serve mode for cloud:

```bash
ff-cli cluster install --self-serve --cluster-type cloud -y
```

The `--cluster-type cloud` flag configures:
- LoadBalancer services (instead of NodePort used for local)
- Production-appropriate resource requests
- Cloud-optimized timeouts and retry settings

**Wait for all pods to be running (3-5 minutes):**
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

Verify with:
```bash
ff-cli cluster status
```

**Common issues:**
- Pods stuck in `ImagePullBackOff` -- re-run `ff-cli cluster init`.
- Pods stuck in `Pending` -- check node resources with `kubectl describe nodes`.
- See [Troubleshooting](../local-development/troubleshooting.md#imagepullbackoff) for detailed diagnostics.

---

## Step 7: Configure Access to the Helm API

On AKS with cloud cluster type, Kong deploys as a LoadBalancer service. Get the external IP:

```bash
kubectl get svc -n ff-control-plane | grep kong-proxy
```

**What to expect:**
```
firefoundry-control-kong-proxy   LoadBalancer   10.0.x.x   <EXTERNAL-IP>   80:xxxxx/TCP,443:xxxxx/TCP
```

If the external IP shows `<pending>`, wait a minute for Azure to provision the load balancer.

**Option A: Use the LoadBalancer IP directly**

```bash
export KONG_IP=$(kubectl get svc firefoundry-control-kong-proxy -n ff-control-plane -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Kong proxy available at: http://$KONG_IP"
```

**Option B: Use port forwarding (simpler, no external exposure)**

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
export KONG_IP="localhost:8000"
```

### Configure CLI Profile

```bash
mkdir -p ~/.ff
cat > ~/.ff/profiles << EOF
[aks]
helm_api_endpoint = http://$KONG_IP/management/helm/v1
EOF

export FF_PROFILE=aks
```

To make the profile permanent:
```bash
echo 'export FF_PROFILE=aks' >> ~/.zshrc  # or ~/.bashrc
```

**Verify API access:**
```bash
curl -s http://$KONG_IP/management/helm/v1/helmreleases
```

**What to expect:** `{"message":"No API key found in request"}` -- this confirms the API is reachable.

---

## Step 8: Create Your First Environment

Deploy a FireFoundry environment:

```bash
ff-cli env create -t minimal-self-contained -n ff-dev -y
```

This creates the `ff-dev` namespace and deploys all core services (FF Broker, Context Service, Entity Service, MCP Gateway, PostgreSQL, MinIO).

**Wait for the environment to be ready:**
```bash
kubectl wait helmrelease/firefoundry-core -n ff-dev --for=condition=Ready --timeout=1200s
```

**Verify all pods are running:**
```bash
kubectl get pods -n ff-dev
```

**What to expect:** 11+ pods in `Running` or `Completed` state.

---

## Step 9: Configure Broker Secrets

Add LLM provider API keys:

```bash
# For OpenAI
ff-cli env broker-secret add ff-dev --key OPENAI_API_KEY --value "sk-your-key-here" -y

# For Azure OpenAI
ff-cli env broker-secret add ff-dev --key AZURE_OPENAI_API_KEY --value "your-azure-key" -y
```

Verify:
```bash
ff-cli env broker-secret list ff-dev
```

---

## Step 10: Verify the Installation

Run through verification checks:

```bash
# Control plane healthy
ff-cli cluster status

# Environment listed
ff-cli env list

# All pods running
kubectl get pods -n ff-control-plane
kubectl get pods -n ff-dev

# Broker secrets configured
ff-cli env broker-secret list ff-dev
```

---

## AKS-Specific Configuration

### Using Azure Database for PostgreSQL (production)

For production deployments, use Azure Database for PostgreSQL Flexible Server instead of the bundled PostgreSQL:

1. Create the database server (via Azure Portal, CLI, or Terraform)
2. Create the required databases: `firefoundry`
3. Override the Helm values to use external PostgreSQL:

```yaml
# values-override.yaml
global:
  database:
    externalHost: "your-server.postgres.database.azure.com"
    port: 5432
    database: firefoundry
    sslMode: require

postgresql:
  enabled: false  # disable bundled PostgreSQL
```

### Using Azure Blob Storage (production)

For production deployments, use Azure Blob Storage instead of the bundled MinIO:

```yaml
# values-override.yaml
minio:
  enabled: false  # disable bundled MinIO

contextService:
  storage:
    type: azure
    azure:
      accountName: "your-storage-account"
      containerName: "context-service"
```

### Network Configuration

The Firebrand dev environment uses the following network layout as a reference:

| Subnet | CIDR | Purpose |
|--------|------|---------|
| aks-subnet | 10.0.0.0/19 | AKS node pools |
| app-subnet | 10.0.32.0/19 | Application services |
| data-subnet | 10.0.64.0/19 | Data services |
| db-subnet | 10.0.96.0/19 | Database servers (with delegation for PostgreSQL Flexible Server) |

Service CIDR: `172.17.0.0/16`
DNS Service IP: `172.17.0.10`

### Ingress Configuration

To expose agent bundles externally, configure an ingress controller. Kong Gateway (deployed as part of the control plane) handles routing to agent bundles via the `/agents/<bundle-name>` path prefix.

For custom domain names, configure DNS to point to the Kong LoadBalancer IP:

```bash
# Get the Kong external IP
kubectl get svc firefoundry-control-kong-proxy -n ff-control-plane \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `az aks get-credentials --resource-group <rg> --name <cluster>` | Configure kubectl for AKS |
| `ff-cli cluster init` | Initialize cluster with CRDs and registry credentials |
| `ff-cli cluster install --self-serve --cluster-type cloud -y` | Install control plane for cloud |
| `ff-cli cluster status` | Check control plane health |
| `ff-cli env create -t <template> -n <name> -y` | Create a new environment |
| `ff-cli env list` | List all environments |
| `ff-cli env broker-secret add <env> --key <k> --value <v> -y` | Add LLM API key |
| `ff-cli env upgrade <env> --latest` | Upgrade environment |
| `ff-cli cluster uninstall -y` | Remove control plane |

---

## Clean Up

### Delete an Environment

```bash
ff-cli env delete ff-dev -y
```

### Remove the Control Plane

```bash
ff-cli cluster uninstall --full -y
```

### Delete the AKS Cluster

```bash
az aks delete --resource-group $AZ_RESOURCE_GROUP --name $AKS_CLUSTER_NAME --yes
```

### Delete the Resource Group (removes everything)

```bash
az group delete --name $AZ_RESOURCE_GROUP --yes
```

---

## Next Steps

- [Agent Development Guide](../local-development/agent-development.md) -- build and deploy agent bundles
- [FF CLI Operations Guide](../../ff-cli/ops.md) -- build, install, upgrade commands
- [Troubleshooting](../local-development/troubleshooting.md) -- common issues and fixes
- [Chart Reference](../../ff_local_dev/chart-reference.md) -- all Helm configuration options
