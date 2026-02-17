# Troubleshooting Guide

Common issues and solutions when working with FireFoundry. See also the [Minikube Bootstrap Guide](./minikube-bootstrap.md) and [AKS Bootstrap Guide](../getting-started/aks-bootstrap.md) for setup-specific troubleshooting.

---

## ImagePullBackOff

### Symptoms

Pods stuck in `ImagePullBackOff` or `ErrImagePull` status:

```
NAME                              READY   STATUS             RESTARTS   AGE
firefoundry-core-ff-broker-xxx    0/1     ImagePullBackOff   0          5m
```

### Causes and Fixes

**1. Missing registry credentials (most common)**

The `myregistrycreds` secret was not created or was created in the wrong namespace. This usually means `ff-cli cluster init` was not run or did not complete successfully.

```bash
# Check if the secret exists
kubectl get secret myregistrycreds -n ff-control-plane
kubectl get secret myregistrycreds -n ff-dev

# If missing, re-run cluster init
ff-cli cluster init --license ~/.ff/license.jwt
```

**2. Expired or invalid registry credentials**

License-exchanged credentials may have expired. Re-run the license exchange:

```bash
ff-cli cluster init --license ~/.ff/license.jwt
```

**3. Image tag does not exist**

The requested image version may not exist in the registry.

```bash
# Check the exact image being pulled
kubectl describe pod <pod-name> -n <namespace> | grep "Image:"

# Verify the image exists (requires ACR access)
az acr repository show-tags --name firebranddevet --repository ff-llm-broker
```

**4. Network connectivity to registry**

The cluster cannot reach `firebranddevet.azurecr.io`. On minikube, check that Docker has network access. On AKS, check network security groups.

```bash
# Test from within the cluster
kubectl run test --image=busybox -it --rm -- wget -qO- https://firebranddevet.azurecr.io/v2/
```

---

## CrashLoopBackOff

### Symptoms

Pods restart repeatedly, showing `CrashLoopBackOff` with increasing restart counts:

```
NAME                              READY   STATUS             RESTARTS      AGE
firefoundry-core-ff-broker-xxx    0/1     CrashLoopBackOff   5 (30s ago)   10m
```

### Causes and Fixes

**1. Database not ready yet (transient)**

During initial deployment, services may start before PostgreSQL is ready. This is self-healing -- pods will stabilize after PostgreSQL accepts connections. Wait 2-3 minutes.

```bash
# Check PostgreSQL status
kubectl get pods -n ff-dev | grep postgresql

# Watch for stabilization
kubectl get pods -n ff-dev -w
```

**2. Missing environment variables or secrets**

Services crash if required configuration is missing.

```bash
# Check pod logs for the error message
kubectl logs <pod-name> -n ff-dev --previous

# Common missing vars:
# - Database connection strings
# - LLM_BROKER_HOST / LLM_BROKER_PORT
# - CONTEXT_SERVICE_ADDRESS
```

**3. Incorrect database credentials**

Default passwords in the Helm chart (`changeme-*`) must match between the PostgreSQL deployment and the service configuration.

```bash
# Check the shared database secret
kubectl get secret firefoundry-core-shared-database-secret -n ff-dev -o yaml

# Compare with the service's expected credentials
kubectl describe pod <pod-name> -n ff-dev | grep -A 2 "DB_PASSWORD\|DATABASE"
```

**4. Out-of-memory kills (OOMKilled)**

The container exceeded its memory limit.

```bash
# Check termination reason
kubectl describe pod <pod-name> -n ff-dev | grep -A 3 "Last State"

# If OOMKilled, increase memory limits in values.yaml:
# resources:
#   limits:
#     memory: 2Gi  # increase from default 1Gi
```

---

## Pending Pods

### Symptoms

Pods stay in `Pending` status indefinitely:

```
NAME                              READY   STATUS    RESTARTS   AGE
firefoundry-core-ff-broker-xxx    0/1     Pending   0          10m
```

### Causes and Fixes

**1. Insufficient CPU or memory (most common)**

The cluster does not have enough resources to schedule the pod.

```bash
# Check what's blocking scheduling
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Events"

# Check node resource availability
kubectl describe nodes | grep -A 5 "Allocated resources"

# On minikube, restart with more resources
minikube stop
minikube start --memory=8192 --cpus=4 --disk-size=40g
```

**2. Node selectors or taints**

The pod requires a node with specific labels or tolerations that don't exist.

```bash
# Check pod's node requirements
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Node-Selectors\|Tolerations"

# Check node labels
kubectl get nodes --show-labels
```

**3. Persistent volume claim (PVC) not bound**

StatefulSets (like PostgreSQL) need persistent volumes.

```bash
# Check PVC status
kubectl get pvc -n <namespace>

# If PVC is Pending, check storage class
kubectl describe pvc <pvc-name> -n <namespace>

# On minikube, the default storage class should work automatically
kubectl get storageclass
```

## Service Connectivity Issues

### Symptoms

Services can't communicate with each other

### Common Causes

- Network policies blocking traffic
- Incorrect service names or ports
- DNS resolution issues

### Solutions

```bash
# Test service connectivity
kubectl run test-pod --image=busybox -it --rm -- nslookup firefoundry-ff-broker.ff-dev.svc.cluster.local

# Check service endpoints
kubectl get endpoints -n ff-dev

# Test port forwarding
kubectl port-forward svc/firefoundry-ff-broker 50061:50061 -n ff-dev
```

## Helm Installation and Timeout Errors

### Symptoms

- `helm install` or `ff-cli cluster install` fails with timeout
- Helm release stuck in `pending-install` or `failed` state
- `ff-cli env create` hangs or fails

### Causes and Fixes

**1. Timeout during image pulls (most common on first install)**

First-time installations pull many large images. The default timeout may not be sufficient.

```bash
# For cluster install, extend the timeout
ff-cli cluster install --self-serve --cluster-type local --timeout 20m -y

# For direct Helm installs
helm install firefoundry-core firebrandanalytics/firefoundry-core \
  -n ff-dev --timeout 20m --wait
```

**2. Failed Helm release blocking reinstall**

If a previous install failed, the release may be in a broken state.

```bash
# Check release status
helm list -n ff-dev -a
helm list -n ff-control-plane -a

# If status is "failed" or "pending-install", uninstall first
helm uninstall firefoundry-core -n ff-dev

# For control plane
ff-cli cluster repair
# or
ff-cli cluster uninstall -y && ff-cli cluster install --self-serve --cluster-type local -y
```

**3. Invalid values file**

Syntax errors in custom values files cause Helm to fail.

```bash
# Validate your values file
helm template firefoundry-core firebrandanalytics/firefoundry-core \
  -f my-values.yaml --debug 2>&1 | head -50

# Common issues: wrong indentation, missing quotes around strings with special characters
```

**4. Missing Helm repository**

```bash
# Add the FireFoundry Helm repository
helm repo add firebrandanalytics https://firebrandanalytics.github.io/ff_infra
helm repo update
```

## Minikube Issues

### Symptoms

Minikube won't start or has performance issues

### Common Causes

- Insufficient system resources
- Docker not running
- Conflicting virtualization

### Solutions

```bash
# Check minikube status
minikube status

# Restart minikube
minikube stop
minikube start --memory=8192 --cpus=4

# Check system resources
docker system df
minikube ssh "df -h"

# Reset minikube (nuclear option)
minikube delete
minikube start --memory=8192 --cpus=4 --disk-size=20g
```

## FF-CLI Authentication Errors

### Symptoms

- `ff-cli` commands fail with "unauthorized", "forbidden", or "authentication failed"
- `ff-cli env create` returns API key errors
- `ff-cli cluster install` fails with license-related errors

### Causes and Fixes

**1. License file not found or invalid**

```bash
# Verify license file exists
ls -la ~/.ff/license.jwt

# Check if the license is a valid JWT (should have 3 dot-separated parts)
cat ~/.ff/license.jwt | tr '.' '\n' | wc -l
# Expected: 3

# Re-download the license from your provider if needed
```

**2. Wrong or missing FF_PROFILE**

```bash
# Check active profile
echo $FF_PROFILE
ff-cli profile current

# List available profiles
ff-cli profile list

# Set profile
export FF_PROFILE=local
```

**3. Helm API key mismatch**

After reinstalling the control plane, the API key stored in the profile may no longer match.

```bash
# Check if the Helm API is accessible
curl -s http://localhost:8000/management/helm/v1/helmreleases

# If you get "No API key found", the API is reachable but auth is needed
# ff-cli handles this automatically if the profile is configured correctly

# If profile is stale, recreate it
ff-cli profile create local --use
```

**4. Port forwarding not active**

Many `ff-cli` commands communicate through the Helm API, which requires port forwarding to be active.

```bash
# Check if port forwarding is running
ps aux | grep port-forward

# Restart if needed
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 &
```

---

## Database Connection Failures

### Symptoms

- Services fail to start with "connection refused" or "ECONNREFUSED" in logs
- PostgreSQL-related errors in pod logs: "password authentication failed", "database does not exist"
- Migration jobs fail with database errors

### Causes and Fixes

**1. PostgreSQL pod not ready**

On initial deployment, services may start before PostgreSQL is accepting connections. This is usually transient.

```bash
# Check PostgreSQL pod status
kubectl get pods -n ff-dev | grep postgresql

# Check PostgreSQL logs
kubectl logs -n ff-dev -l app.kubernetes.io/name=postgresql

# Wait for PostgreSQL to be ready
kubectl wait pod -l app.kubernetes.io/name=postgresql -n ff-dev --for=condition=Ready --timeout=120s
```

**2. Incorrect database credentials**

Default passwords in the chart (`changeme-*`) must be consistent across all services.

```bash
# Check the shared database secret
kubectl get secret -n ff-dev | grep database

# View secret contents (base64 encoded)
kubectl get secret firefoundry-core-shared-database-secret -n ff-dev -o jsonpath='{.data}' | python3 -m json.tool
```

**3. Database schema not initialized**

Migration jobs must complete before services can connect.

```bash
# Check migration job status
kubectl get jobs -n ff-dev

# If a migration job failed, check its logs
kubectl logs job/<job-name> -n ff-dev

# Restart a failed migration
kubectl delete job <job-name> -n ff-dev
# The Helm release controller will recreate it
```

**4. Network policy blocking database access**

On clusters with network policies enabled, services may not be able to reach PostgreSQL.

```bash
# Check network policies
kubectl get networkpolicy -n ff-dev

# Test connectivity from a service pod
kubectl exec -it <pod-name> -n ff-dev -- nc -zv firefoundry-core-postgresql 5432
```

---

## GitHub Token Issues

### Symptoms

ff-cli commands fail with authentication errors

### Common Causes

- Missing or invalid GITHUB_TOKEN
- Token doesn't have required scopes
- Environment variable not set

### Solutions

```bash
# Check if token is set
echo $GITHUB_TOKEN

# Test token validity
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Recreate token with correct scopes
# See [Prerequisites Guide](../getting-started/prerequisites.md) for detailed steps
```

---

## Performance Issues

### Symptoms

Slow response times, high resource usage

### Common Causes

- Insufficient resources allocated
- Memory leaks
- Inefficient queries or operations

### Solutions

```bash
# Monitor resource usage
kubectl top pods -n ff-dev
kubectl top nodes

# Check resource limits
kubectl describe pod <pod-name> -n ff-dev | grep -A 5 "Requests\|Limits"

# Scale up resources
kubectl scale deployment <deployment-name> --replicas=2 -n ff-dev
```

## Agent Bundle Issues

### LLM Broker Connection Failures

#### Symptoms

- Workflow hangs indefinitely at AI/LLM generation steps
- gRPC timeout errors when calling bots
- `Bot.run()` never returns

#### Common Causes

- Incorrect `LLM_BROKER_PORT` configuration
- Broker service not running
- Network policy blocking gRPC traffic

#### Solutions

```bash
# Verify broker is running
kubectl get pods -n ff-dev | grep broker
kubectl logs -n ff-dev deploy/firefoundry-core-ff-broker

# Check the broker port (should be 50051, NOT 50061)
kubectl get svc -n ff-dev | grep broker
# Expected: firefoundry-core-ff-broker   ClusterIP   10.x.x.x   50051/TCP

# In your agent bundle's values.yaml or environment:
LLM_BROKER_HOST: "firefoundry-core-ff-broker"
LLM_BROKER_PORT: "50051"  # Common mistake: using 50061

# Test broker connectivity from within the cluster
kubectl run test-broker --image=busybox -it --rm -- \
  nc -zv firefoundry-core-ff-broker.ff-dev.svc.cluster.local 50051
```

### Context Service / Working Memory Errors

#### Symptoms

- "Failed to get content" when retrieving files from working memory
- PostgreSQL "invalid uuid" errors (code 22P02)
- "Failed to store file in working memory"

#### Common Causes

- Invalid or undefined working memory ID being passed
- Context service not accessible
- Missing `CONTEXT_SERVICE_ADDRESS` configuration

#### Solutions

```bash
# Check context service is running
kubectl get pods -n ff-dev | grep context
kubectl logs -n ff-dev deploy/firefoundry-core-context-service

# Verify the working memory ID is valid (not "undefined" string)
# In your code, add validation:
if (!wmId || wmId === 'undefined') {
  throw new Error('Invalid working memory ID');
}

# Check environment configuration
CONTEXT_SERVICE_ADDRESS: "http://firefoundry-core-context-service:50051"
CONTEXT_SERVICE_API_KEY: "<your-key>"

# Test context service connectivity
kubectl port-forward svc/firefoundry-core-context-service 50051:50051 -n ff-dev
```

### Entity Connection Errors

#### Symptoms

- `Cannot read properties of undefined (reading 'includes')` when calling `appendOrRetrieveCall()`
- Child entities not being created

#### Cause

Missing `allowedConnections` configuration in the entity decorator.

#### Solution

Add child entity types to the `allowedConnections` in your `@RunnableEntityDecorator`:

```typescript
@RunnableEntityDecorator({
  generalType: 'Workflow',
  specificType: 'MyWorkflow',
  allowedConnections: {
    'Calls': ['ChildStepEntity', 'AnotherStepEntity'],  // List all child types
  },
})
export class MyWorkflow extends RunnableEntityClass<...> {
  // Now appendOrRetrieveCall(ChildStepEntity, ...) will work
}
```

See [Entity Troubleshooting](../sdk/agent_sdk/core/entities.md#8-troubleshooting) for more details.

### API Response Issues

#### Symptoms

- Frontend receiving `undefined` values when accessing API response fields
- Fields exist in backend logs but not in frontend

#### Cause

The SDK wraps API responses in `{ success: true, result: {...} }`. If consuming the API directly (not through `RemoteAgentBundleClient`), you must unwrap this envelope.

#### Solution

Use the `RemoteAgentBundleClient` from `@firebrandanalytics/ff-sdk`:

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const client = new RemoteAgentBundleClient('http://localhost:3000');
const result = await client.call_api_endpoint('my-endpoint', {
  method: 'POST',
  body: { data: 'test' }
});
// result is already unwrapped - no need to access .result
```

If you must use raw HTTP, unwrap manually:

```typescript
const response = await fetch(endpoint);
const data = await response.json();
const result = data.result;  // Don't forget to unwrap!
```

## Getting Additional Help

### Debug Information Collection

```bash
# Collect system information
kubectl get all -n ff-dev
kubectl get all -n ff-control-plane
kubectl describe nodes
minikube logs

# Export logs for analysis
kubectl logs deployment/firefoundry-ff-broker -n ff-dev > ff-broker.log
kubectl logs deployment/firefoundry-context-service -n ff-dev > context-service.log
```

### Support Channels

- **Documentation**: Check the Agent SDK docs included in generated projects
- **Logs**: Always check pod logs first when troubleshooting
- **Community**: Internal Teams channels and team knowledge sharing
- **Support**: Contact Firebrand Support for infrastructure issues

## Prevention Tips

1. **Regular Updates**: Keep your tools and dependencies updated
2. **Resource Monitoring**: Monitor resource usage regularly
3. **Backup Configurations**: Save your working configurations
4. **Test Changes**: Use staging environments for testing changes
5. **Document Issues**: Keep track of solutions that work for your environment
