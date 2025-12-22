# Troubleshooting Guide

Common issues and solutions when working with FireFoundry.

## Image Pull Errors

### Symptoms

Pods stuck in `ImagePullBackOff` status

### Causes

- Incorrect ACR credentials
- Wrong Azure subscription context
- Missing registry secrets

### Solutions

```bash
# Verify ACR access
az acr login --name firebranddevet
docker pull firebranddevet.azurecr.io/ff-broker:latest

# Recreate registry secrets
kubectl delete secret myregistrycreds -n ff-dev
kubectl delete secret myregistrycreds -n ff-control-plane

# Follow registry setup steps again from [Deployment Guide](../platform/deployment.md)
```

## Pod Startup Issues

### Symptoms

Pods stuck in `Pending`, `CrashLoopBackOff`, or `Error` states

### Common Causes

- Insufficient resources
- Missing secrets or configmaps
- Image pull issues
- Port conflicts

### Solutions

```bash
# Check pod status and events
kubectl describe pod <pod-name> -n ff-dev

# Check resource availability
kubectl top nodes
kubectl describe node <node-name>

# Check logs
kubectl logs <pod-name> -n ff-dev --previous

# Restart problematic pods
kubectl delete pod <pod-name> -n ff-dev
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

## Helm Installation Issues

### Symptoms

Helm install/upgrade fails

### Common Causes

- Missing dependencies
- Invalid values files
- Resource conflicts

### Solutions

```bash
# Update dependencies
helm dependency update

# Check for conflicts
helm list -n ff-dev
helm list -n ff-control-plane

# Dry run to validate
helm install firefoundry-core . --dry-run --debug -n ff-dev

# Clean up failed installations
helm uninstall firefoundry-core -n ff-dev
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
