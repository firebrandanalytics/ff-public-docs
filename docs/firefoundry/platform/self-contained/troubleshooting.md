# Troubleshooting

Common issues and solutions for self-contained FireFoundry Core deployments.

## Diagnostic Commands

### Check Pod Status

```bash
# List all pods
kubectl get pods -n ff-core

# Describe a specific pod
kubectl describe pod <pod-name> -n ff-core

# Check pod logs
kubectl logs -n ff-core <pod-name>

# Follow logs in real-time
kubectl logs -n ff-core <pod-name> -f
```

### Check Services

```bash
# List services
kubectl get svc -n ff-core

# Check endpoints
kubectl get endpoints -n ff-core
```

### Check Events

```bash
# Recent events
kubectl get events -n ff-core --sort-by='.lastTimestamp'
```

## Common Issues

### Pods Stuck in Pending

**Symptom:** Pods remain in `Pending` state

**Causes:**
- Insufficient cluster resources
- PVC cannot be bound
- Node selector/affinity constraints

**Solutions:**

```bash
# Check pod events
kubectl describe pod <pod-name> -n ff-core

# Check PVC status
kubectl get pvc -n ff-core

# Check node resources
kubectl describe nodes
```

### Context Service Cannot Connect to MinIO

**Symptom:** Errors like `ECONNREFUSED` or `NoSuchBucket`

**Check:**

1. Verify MinIO is running:
   ```bash
   kubectl get pods -n ff-core | grep minio
   ```

2. Verify bucket exists:
   ```bash
   kubectl exec -n ff-core deploy/firefoundry-core-minio -- mc ls local/
   ```

3. Check Context Service environment:
   ```bash
   kubectl exec -n ff-core deploy/firefoundry-core-context-service -- env | grep AWS
   ```

4. Verify endpoint URL matches service name:
   ```bash
   kubectl get svc -n ff-core | grep minio
   # Endpoint should be: http://firefoundry-core-minio:9000
   ```

**Solution:** Ensure `AWS_S3_ENDPOINT` matches the MinIO service name in your namespace.

### Context Service Cannot Connect to PostgreSQL

**Symptom:** Database connection errors on startup

**Check:**

1. PostgreSQL is running:
   ```bash
   kubectl get pods -n ff-core | grep postgresql
   ```

2. Service is accessible:
   ```bash
   kubectl exec -n ff-core deploy/firefoundry-core-context-service -- \
     nc -zv firefoundry-core-postgresql 5432
   ```

3. Credentials are correct:
   ```bash
   kubectl get secret -n ff-core firefoundry-core-context-service -o yaml
   ```

**Solution:** Verify database connection strings in secrets match PostgreSQL credentials.

### Migration Fails on Startup

**Symptom:** Service pod crashes with migration errors

**Check:**

```bash
# Check init container logs
kubectl logs -n ff-core -l app.kubernetes.io/name=context-service -c migrate
```

**Common Causes:**
- PostgreSQL not ready when service starts
- Incorrect database credentials
- Schema already exists with conflicts

**Solutions:**
- Add init container to wait for PostgreSQL
- Verify credentials in secrets
- For conflicts, manually inspect and fix schema

### Working Memory Insert Fails

**Symptom:** `column "embedding" does not exist`

**Cause:** The Context Service schema includes an optional embedding column that requires pgvector extension.

**Solution:** Use Context Service image version 3.1.0+ which does not require the embedding column, or add pgvector to your PostgreSQL instance.

### Blobs Upload but Download Fails

**Symptom:** Upload succeeds, but download returns empty or errors

**Check:**

1. Verify blob exists in MinIO:
   ```bash
   kubectl exec -n ff-core deploy/firefoundry-core-minio -- \
     mc ls local/context-service/<blob-key>
   ```

2. Check working memory record:
   ```bash
   kubectl exec -n ff-core firefoundry-core-postgresql-0 -- \
     psql -U postgres -d firefoundry -c \
     "SELECT id, blob_key, provider FROM wm.working_memory WHERE blob_key IS NOT NULL LIMIT 5;"
   ```

### Image Pull Errors

**Symptom:** `ImagePullBackOff` or `ErrImagePull`

**Check:**

```bash
kubectl describe pod <pod-name> -n ff-core | grep -A 10 Events
```

**Solutions:**
- Verify image repository and tag exist
- Check image pull secrets are configured
- Ensure network access to container registry

### Insufficient Resources

**Symptom:** Pods are evicted or OOMKilled

**Check:**

```bash
# Check resource usage
kubectl top pods -n ff-core

# Check resource requests/limits
kubectl describe pod <pod-name> -n ff-core | grep -A 5 Limits
```

**Solution:** Adjust resource requests and limits in values.yaml.

## Service-Specific Issues

### FF Broker

<!-- TODO: Document FF Broker specific issues -->

### Code Sandbox

<!-- TODO: Document Code Sandbox specific issues -->

### Entity Service

<!-- TODO: Document Entity Service specific issues -->

## Collecting Debug Information

When reporting issues, collect:

```bash
# Export pod descriptions
kubectl describe pods -n ff-core > pods-describe.txt

# Export logs
for pod in $(kubectl get pods -n ff-core -o name); do
  kubectl logs -n ff-core $pod > "${pod##*/}.log" 2>&1
done

# Export events
kubectl get events -n ff-core --sort-by='.lastTimestamp' > events.txt

# Export Helm values
helm get values firefoundry-core -n ff-core > values-used.yaml
```

## Getting Help

- Check [FireFoundry documentation](../README.md)
- Review [Context Service + MinIO guide](./context-service-minio.md) for storage issues
- Review [Database Setup](./database-setup.md) for PostgreSQL issues

<!--
TODO: This document needs expansion with:
- Network policy troubleshooting
- TLS/certificate issues
- Ingress configuration problems
- Performance degradation diagnosis
- Service mesh issues
- Multi-replica synchronization problems
-->
