# Cluster Diagnostics

Inspect Kubernetes cluster state for FireFoundry deployments using `ff-cli`, `kubectl`, and `helm`.

## FireFoundry Namespace Architecture

FireFoundry uses a **two-tier namespace model**:

### Control Plane (`ff-control-plane`)

Infrastructure and development support services:

| Service | Purpose |
|---------|---------|
| **Kong Gateway** | API gateway and front door—if Kong is down, no external access works |
| **Concourse** | CI/CD pipelines for agent bundle testing and deployment |
| **Harbor** | Container registry with security scanning |
| **ff-console** | Web management UI for monitoring and debugging |

**Kong is critical**: All external traffic to agent bundles and platform services flows through Kong. Routes are automatically created when agent bundles are deployed (e.g., `/agents/ff-dev/<bundle-name>`).

### Environments (e.g., `ff-dev`)

Runtime services powering AI agents. Each environment is an isolated namespace:

| Service | Purpose |
|---------|---------|
| **ff-broker** | Request routing and orchestration |
| **context-service** | Entity graph and persistence |
| **entity-service** | Entity graph API (powers ff-eg-read) |
| **code-sandbox** | Secure code execution |
| **doc-proc-service** | Document processing |
| **Agent Bundles** | Your deployed agent applications |

*Note: This is not exhaustive—additional platform services exist and more are added over time.*

### Multiple Environments

Create additional environments for different purposes:

```bash
# List environments
ff-cli environment list

# Create a new environment
ff-cli environment create --template internal --name staging

# Check environment status
ff-cli environment status
```

Each environment gets its own namespace with isolated runtime services.

### Service DNS

Services use standard Kubernetes DNS:
```
{service-name}.{namespace}.svc.cluster.local:{port}
```

Example: `ff-broker.ff-dev.svc.cluster.local:8080`

## When to Use Cluster Diagnostics

Inspect the cluster when:
- Pods are crashing or not starting
- Resource issues (memory, CPU)
- Deployment/upgrade problems
- Network connectivity issues
- Configuration problems

## Tools Overview

| Tool | Use For |
|------|---------|
| `ff-cli` | FireFoundry-specific operations (preferred) |
| `kubectl` | Direct Kubernetes inspection |
| `helm` | Release and chart information |

## ff-cli Cluster Operations

### Check Cluster Health

```bash
# Run diagnostic checks
ff-cli ops doctor

# Check cluster status
ff-cli cluster status
```

### View Deployments

```bash
# List deployed agent bundles
ff-cli apps list

# Check specific deployment
ff-cli ops status <agent-bundle-name>
ff-cli ops status <agent-bundle-name> --namespace <namespace>
```

### View Logs via ff-cli

```bash
# If ff-cli supports log viewing
ff-cli ops logs <agent-bundle-name>
ff-cli ops logs <agent-bundle-name> --tail 100
```

## kubectl Inspection

### Pod Status

```bash
# List pods in namespace
kubectl get pods -n <namespace>

# Watch pods (real-time updates)
kubectl get pods -n <namespace> -w

# Get detailed pod info
kubectl describe pod <pod-name> -n <namespace>

# Check pod events (often shows why pods fail)
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -20
```

### Pod Logs

```bash
# View pod logs
kubectl logs <pod-name> -n <namespace>

# Tail logs
kubectl logs -f <pod-name> -n <namespace>

# Previous container (if restarted)
kubectl logs <pod-name> -n <namespace> --previous

# Specific container in multi-container pod
kubectl logs <pod-name> -n <namespace> -c <container-name>

# Last N lines
kubectl logs <pod-name> -n <namespace> --tail=100
```

### Pod Resources

```bash
# Resource usage
kubectl top pods -n <namespace>

# Detailed resource info
kubectl describe pod <pod-name> -n <namespace> | grep -A 10 "Requests\|Limits"
```

### Pod Shell Access

```bash
# Exec into pod
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh

# Run a command
kubectl exec <pod-name> -n <namespace> -- env | grep FF_
```

### Deployment Status

```bash
# List deployments
kubectl get deployments -n <namespace>

# Deployment details
kubectl describe deployment <deployment-name> -n <namespace>

# Rollout status
kubectl rollout status deployment/<deployment-name> -n <namespace>

# Rollout history
kubectl rollout history deployment/<deployment-name> -n <namespace>
```

### ConfigMaps and Secrets

```bash
# List configmaps
kubectl get configmaps -n <namespace>

# View configmap (non-sensitive config)
kubectl get configmap <name> -n <namespace> -o yaml

# List secrets (don't print values!)
kubectl get secrets -n <namespace>

# Check if secret exists and has expected keys
kubectl get secret <name> -n <namespace> -o jsonpath='{.data}' | jq 'keys'
```

### Services and Networking

```bash
# List services
kubectl get services -n <namespace>

# Service details
kubectl describe service <service-name> -n <namespace>

# Check endpoints
kubectl get endpoints -n <namespace>
```

## helm Inspection

### List Releases

```bash
# List all releases
helm list -A

# In specific namespace
helm list -n <namespace>

# Include failed releases
helm list -n <namespace> --all
```

### Release Details

```bash
# Show release status
helm status <release-name> -n <namespace>

# Show release values
helm get values <release-name> -n <namespace>

# Show all release info
helm get all <release-name> -n <namespace>

# Show manifest (what was deployed)
helm get manifest <release-name> -n <namespace>
```

### Release History

```bash
# Show revision history
helm history <release-name> -n <namespace>

# Rollback to previous version
helm rollback <release-name> <revision> -n <namespace>
```

## Common Diagnostic Patterns

### Pattern 1: Pod Not Starting

```bash
# 1. Check pod status
kubectl get pods -n <namespace>

# 2. Check events for errors
kubectl describe pod <pod-name> -n <namespace> | grep -A 20 "Events"

# 3. Check container status
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.status.containerStatuses[*].state}'

# 4. If ImagePullBackOff, check image
kubectl describe pod <pod-name> -n <namespace> | grep "Image:"

# 5. If CrashLoopBackOff, check logs
kubectl logs <pod-name> -n <namespace> --previous
```

### Pattern 2: Pod Crashing

```bash
# 1. Get restart count
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.status.containerStatuses[*].restartCount}'

# 2. Check previous container logs
kubectl logs <pod-name> -n <namespace> --previous

# 3. Check for OOMKilled
kubectl describe pod <pod-name> -n <namespace> | grep -i "OOMKilled\|memory"

# 4. Check resource limits
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Limits:"
```

### Pattern 3: Deployment Stuck

```bash
# 1. Check deployment status
kubectl rollout status deployment/<name> -n <namespace>

# 2. Check replica status
kubectl get deployment <name> -n <namespace> -o jsonpath='{.status}'

# 3. Check for pod issues
kubectl get pods -n <namespace> -l app=<app-label>

# 4. Check events
kubectl get events -n <namespace> --field-selector involvedObject.name=<deployment-name>
```

### Pattern 4: Environment/Config Issues

```bash
# 1. Check environment variables in pod
kubectl exec <pod-name> -n <namespace> -- env | sort

# 2. Check configmap
kubectl get configmap <name> -n <namespace> -o yaml

# 3. Check if secrets are mounted
kubectl exec <pod-name> -n <namespace> -- ls -la /path/to/secrets

# 4. Verify connection strings work
kubectl exec <pod-name> -n <namespace> -- curl -s http://service-name:port/health
```

### Pattern 5: Network Issues

```bash
# 1. Check service exists
kubectl get service <name> -n <namespace>

# 2. Check endpoints
kubectl get endpoints <name> -n <namespace>

# 3. Test DNS from pod
kubectl exec <pod-name> -n <namespace> -- nslookup <service-name>

# 4. Test connectivity from pod
kubectl exec <pod-name> -n <namespace> -- curl -v http://<service-name>:<port>/health
```

## FireFoundry-Specific Checks

### Kong Gateway (Critical)

Kong is the front door—if it's not working, nothing is accessible externally.

```bash
# Check Kong pods
kubectl get pods -n ff-control-plane -l app.kubernetes.io/name=kong

# Check Kong logs
kubectl logs -n ff-control-plane -l app.kubernetes.io/name=kong --tail=50

# Port-forward Kong Admin API for diagnostics
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-admin 8001:8001 &

# List all routes (requires port-forward above)
curl -s http://localhost:8001/routes | jq '.data[] | {name, paths}'

# Check if a specific agent bundle route exists
curl -s http://localhost:8001/routes | jq '.data[] | select(.paths[] | contains("/agents/ff-dev/<bundle-name>"))'

# Check Kong services
curl -s http://localhost:8001/services | jq '.data[] | {name, host, port}'

# Delete a misconfigured route (if needed)
curl -X DELETE http://localhost:8001/routes/<route-name>
```

**Common Kong issues:**
- Route not created → Agent bundle not deployed correctly or controller issue
- 502 Bad Gateway → Backend service is down or not ready
- 503 Service Unavailable → Kong can't reach the upstream service
- 404 Not Found → Route doesn't exist for this path

### Control Plane (`ff-control-plane`)

Infrastructure services:

```bash
# Check all control plane pods
kubectl get pods -n ff-control-plane

# Concourse (CI/CD)
kubectl get pods -n ff-control-plane -l app=concourse-web
kubectl logs -n ff-control-plane -l app=concourse-web --tail=50

# Harbor (container registry)
kubectl get pods -n ff-control-plane -l app=harbor
kubectl logs -n ff-control-plane -l app=harbor-core --tail=50

# ff-console (management UI)
kubectl get pods -n ff-control-plane -l app=ff-console
kubectl logs -n ff-control-plane -l app=ff-console --tail=50
```

### Environment Runtime Services (e.g., `ff-dev`)

Core runtime services:

```bash
# Check all pods in environment
kubectl get pods -n ff-dev

# ff-broker (request orchestration)
kubectl get pods -n ff-dev -l app=ff-broker
kubectl logs -n ff-dev -l app=ff-broker --tail=100

# context-service (entity graph)
kubectl get pods -n ff-dev -l app=context-service
kubectl logs -n ff-dev -l app=context-service --tail=100

# code-sandbox (code execution)
kubectl get pods -n ff-dev -l app=code-sandbox
kubectl logs -n ff-dev -l app=code-sandbox --tail=100
```

### Agent Bundle Pods

```bash
# List agent bundle pods in environment
kubectl get pods -n ff-dev -l type=agent-bundle

# Check specific agent bundle
kubectl get pods -n ff-dev -l app=<agent-bundle-name>
kubectl logs -n ff-dev -l app=<agent-bundle-name> --tail=100

# Get agent bundle deployment status
kubectl get deployment -n ff-dev -l app=<agent-bundle-name>
```

### Cross-Namespace Connectivity

Test connectivity between environment and control plane:

```bash
# From an agent bundle pod, test broker connectivity
kubectl exec -n ff-dev <agent-pod> -- curl -s http://ff-broker:8080/health

# Test context service
kubectl exec -n ff-dev <agent-pod> -- curl -s http://context-service:8080/health
```

### Environment Status via ff-cli

```bash
# Check environment health
ff-cli environment status

# List all environments
ff-cli environment list

# Check specific environment
ff-cli environment status --name ff-dev
```

## Quick Reference

### Common kubectl Commands

```bash
# Pods
kubectl get pods -n <ns>
kubectl describe pod <name> -n <ns>
kubectl logs <name> -n <ns>
kubectl exec -it <name> -n <ns> -- /bin/sh

# Deployments
kubectl get deployments -n <ns>
kubectl rollout status deployment/<name> -n <ns>
kubectl rollout restart deployment/<name> -n <ns>

# Config
kubectl get configmaps -n <ns>
kubectl get secrets -n <ns>

# Events
kubectl get events -n <ns> --sort-by='.lastTimestamp'
```

### Common helm Commands

```bash
helm list -n <ns>
helm status <release> -n <ns>
helm get values <release> -n <ns>
helm history <release> -n <ns>
```

## When to Escalate

Consider escalating when:
- Control plane components are failing
- Persistent storage issues
- Cluster-wide networking problems
- Resource quota exhaustion
- Certificate/TLS issues

Get cluster-admin help for:
- Node-level issues
- PersistentVolume problems
- Ingress/LoadBalancer configuration
- RBAC/permission issues
