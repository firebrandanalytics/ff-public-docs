# Updating Agent Bundles

After making changes to your agent bundle code, you need to rebuild and redeploy to see the changes in your local cluster. This guide walks through the complete update workflow using talespring as an example.

## Prerequisites

- Agent bundle already deployed (see [Deploying Talespring](./agent-development.md))
- Code changes made in your project directory
- Local cluster running (minikube or k3d) with port-forward to Kong proxy
- [FF CLI installed and configured](./ff-cli-setup.md)

## Quick Update with FF CLI

For most updates, use these two commands:

```bash
# Rebuild Docker image
ff-cli ops build talespring --minikube --tag latest

# Upgrade the deployment (triggers rolling restart)
ff-cli ops upgrade talespring --namespace ff-dev
```

That's it! The CLI handles Docker daemon switching, image building, and Helm upgrades automatically.

For more details on these commands, see the [FF CLI Operations Guide](../../ff-cli/ops.md).

## Update Workflow Overview

The complete update cycle involves four steps:

1. **Rebuild TypeScript** - Compile your code changes
2. **Rebuild Docker image** - Package the new code into a container
3. **Upgrade deployment** - Apply the new image via Helm upgrade
4. **Verify changes** - Test that your updates are live

## Step 1: Make Code Changes

Edit your agent bundle source code as needed. For example, modifying talespring:

```bash
cd /tmp/talespring-demo  # Or wherever your project is
```

Make your changes in:
- `apps/talespring/src/` - Agent bundle implementation
- `apps/talespring/src/entities/` - Entity definitions
- `apps/talespring/src/bots/` - Bot implementations
- `packages/shared-types/` - Shared type definitions

## Step 2: Rebuild TypeScript

Compile your TypeScript changes to JavaScript:

```bash
# From project root
pnpm run build
```

**What this does:**
- Runs TypeScript compiler (`tsc`) on all changed files
- Uses Turborepo's intelligent caching to only rebuild what changed
- Outputs compiled JavaScript to `dist/` directories

**Verify the build:**
```bash
# Check for compilation errors
echo $?  # Should output: 0 (success)

# Verify compiled files exist
ls -la apps/talespring/dist/
```

## Step 3: Rebuild Docker Image

Use the FF CLI to build the Docker image:

```bash
# Build for minikube (automatically uses minikube's Docker daemon)
ff-cli ops build talespring --minikube --tag latest
```

The CLI automatically:
- Switches to minikube's Docker daemon
- Builds with the correct Dockerfile and build args
- Uses multi-stage builds with layer caching

**Alternative: Manual Docker Build**

If you need manual control or want to troubleshoot:

```bash
# Switch to minikube's Docker environment
eval $(minikube docker-env)

# Verify you're using minikube's Docker
docker info | grep -i "Name:"
# Should show: Name: minikube

# Build the Docker image from project root
docker build \
  --build-arg GITHUB_TOKEN=$GITHUB_TOKEN \
  -t talespring:latest \
  -f apps/talespring/Dockerfile \
  .
```

**Verify the new image:**
```bash
# Check image was created
docker images | grep talespring

# Check image timestamp (should be recent)
docker inspect talespring:latest | grep Created
```

## Step 4: Upgrade Kubernetes Deployment

Use the FF CLI to upgrade the deployment:

```bash
# Upgrade the deployment (triggers rolling restart)
ff-cli ops upgrade talespring --namespace ff-dev
```

This command:
- Runs `helm upgrade` with your values files
- Automatically adds restart annotations to trigger pod recreation
- Handles the rolling update process

**Alternative: Manual Restart**

If you only need to restart without changing Helm values:

```bash
# Restart the deployment (rolling update)
kubectl rollout restart deployment/talespring-agent-bundle -n ff-dev

# Watch the rollout progress
kubectl rollout status deployment/talespring-agent-bundle -n ff-dev
```

**What happens during restart:**
1. New pod is created with the updated `talespring:latest` image
2. New pod starts and passes health checks
3. Kong begins routing traffic to new pod
4. Old pod is gracefully terminated
5. Rollout completes in 30-60 seconds

**Monitor the restart:**
```bash
# Watch pods (Ctrl+C to exit)
kubectl get pods -n ff-dev -w | grep talespring

# You'll see:
# talespring-agent-bundle-<old-hash>   1/1   Running       0   <age>
# talespring-agent-bundle-<new-hash>   0/1   Running       0   5s
# talespring-agent-bundle-<new-hash>   1/1   Running       0   35s
# talespring-agent-bundle-<old-hash>   1/1   Terminating   0   <age>
```

## Step 5: Verify Changes

Test that your changes are live through Kong:

```bash
# Health check (basic connectivity)
curl http://localhost:8000/agents/ff-dev/talespring/health/ready

# Service info (verify app version/timestamp)
curl http://localhost:8000/agents/ff-dev/talespring/info

# Test your specific changes
curl -X POST http://localhost:8000/agents/ff-dev/talespring/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "entityName": "EntityTaleSpring",
    "method": "generateStory",
    "args": {
      "theme": "adventure",
      "ageGroup": "8-10"
    }
  }'
```

**Check pod logs for debugging:**
```bash
# Get the new pod name
POD_NAME=$(kubectl get pods -n ff-dev -l app.kubernetes.io/instance=talespring --no-headers -o custom-columns=":metadata.name" | head -1)

# View logs (tail last 50 lines)
kubectl logs -n ff-dev $POD_NAME --tail=50

# Follow logs in real-time (Ctrl+C to exit)
kubectl logs -n ff-dev $POD_NAME -f
```

## Quick Reference Commands

**Using FF CLI (recommended):**

```bash
# Complete rebuild and redeploy
cd /tmp/talespring-demo && \
  pnpm run build && \
  ff-cli ops build talespring --minikube --tag latest && \
  ff-cli ops upgrade talespring --namespace ff-dev
```

**Create a shell alias for frequent updates:**
```bash
# Add to ~/.zshrc or ~/.bashrc
alias ff-update-talespring='cd /tmp/talespring-demo && \
  pnpm run build && \
  ff-cli ops build talespring --minikube --tag latest && \
  ff-cli ops upgrade talespring --namespace ff-dev'

# Usage
ff-update-talespring
```

**Manual commands (for troubleshooting):**

```bash
# Complete rebuild and redeploy without FF CLI
cd /tmp/talespring-demo && \
  pnpm run build && \
  eval $(minikube docker-env) && \
  docker build --build-arg GITHUB_TOKEN=$GITHUB_TOKEN -t talespring:latest -f apps/talespring/Dockerfile . && \
  kubectl rollout restart deployment/talespring-agent-bundle -n ff-dev && \
  kubectl rollout status deployment/talespring-agent-bundle -n ff-dev
```

## Troubleshooting

### Pod Stuck in ImagePullBackOff

```bash
# Check if using minikube's Docker
eval $(minikube docker-env)
docker images | grep talespring

# Rebuild image
docker build --build-arg GITHUB_TOKEN=$GITHUB_TOKEN -t talespring:latest -f apps/talespring/Dockerfile .
```

### Changes Not Appearing

```bash
# Verify build succeeded
pnpm run build
echo $?  # Should be 0

# Force full rebuild (clear cache)
rm -rf apps/talespring/dist/
pnpm run build

# Verify Docker image timestamp
docker inspect talespring:latest | grep Created

# Hard restart (delete pod)
kubectl delete pod -n ff-dev -l app.kubernetes.io/instance=talespring
```

### Build Errors

```bash
# Check TypeScript errors
pnpm run build

# Check Docker build logs
docker build --build-arg GITHUB_TOKEN=$GITHUB_TOKEN -t talespring:latest -f apps/talespring/Dockerfile . --progress=plain

# Verify GitHub token is set
echo $GITHUB_TOKEN | wc -c  # Should be > 10 characters
```

### Pod Crash Loop

```bash
# Check pod logs
kubectl logs -n ff-dev -l app.kubernetes.io/instance=talespring --tail=100

# Check pod events
kubectl describe pod -n ff-dev -l app.kubernetes.io/instance=talespring

# Common issues:
# - Missing environment variables
# - Database connection failures
# - Missing API keys
# - Port conflicts
```

## Development Best Practices

### Fast Iteration Tips

1. **Use watch mode during development** (before Docker):
   ```bash
   pnpm run dev  # TypeScript watch mode
   ```

2. **Test locally first** before rebuilding Docker:
   ```bash
   # Run agent bundle directly on your machine
   cd apps/talespring
   node dist/index.js
   ```

3. **Keep terminal windows organized**:
   - Terminal 1: Code editor / build commands
   - Terminal 2: `kubectl logs -f` (pod logs)
   - Terminal 3: `kubectl get pods -w` (pod status)

4. **Use shell aliases** for common update commands

### Avoiding Common Pitfalls

**❌ Don't do this:**
```bash
# Using host Docker instead of minikube's
docker build -t talespring:latest .
```

**✅ Do this:**
```bash
# Use FF CLI (handles Docker daemon automatically)
ff-cli ops build talespring --minikube --tag latest

# Or manually switch to minikube's Docker daemon
eval $(minikube docker-env)
docker build -t talespring:latest .
```

**❌ Don't do this:**
```bash
# Expecting Kubernetes to auto-detect image updates
# (Won't work with pullPolicy: Never)
```

**✅ Do this:**
```bash
# Use FF CLI to upgrade (includes restart)
ff-cli ops upgrade talespring --namespace ff-dev

# Or explicitly restart deployment after rebuild
kubectl rollout restart deployment/talespring-agent-bundle -n ff-dev
```

## Multiple Agent Bundles

If you're working with multiple agent bundles, the same workflow applies to each:

```bash
# Update analytics-service
cd /path/to/my-project
pnpm run build
ff-cli ops build analytics-service --minikube --tag latest
ff-cli ops upgrade analytics-service --namespace ff-dev

# Update notification-service
ff-cli ops build notification-service --minikube --tag latest
ff-cli ops upgrade notification-service --namespace ff-dev
```

## Next Steps

Now that you can update agent bundles, explore:

- **[FF CLI Operations Guide](../../ff-cli/ops.md)** - Full reference for build, install, and upgrade commands
- **[FF CLI Profiles](../../ff-cli/profiles.md)** - Configure registries for different environments
- **[Operations & Maintenance](../platform/operations.md)** - Monitor and maintain your deployments
- **[Troubleshooting](./troubleshooting.md)** - Solve common issues
- **Agent SDK Documentation** - Learn advanced patterns and features

## Summary

The complete update workflow with FF CLI:

1. Make code changes
2. Rebuild TypeScript: `pnpm run build`
3. Rebuild Docker: `ff-cli ops build <bundle> --minikube --tag latest`
4. Upgrade deployment: `ff-cli ops upgrade <bundle> --namespace ff-dev`
5. Verify: Test endpoints through Kong

With practice, this cycle takes less than 2 minutes from code change to verified deployment!