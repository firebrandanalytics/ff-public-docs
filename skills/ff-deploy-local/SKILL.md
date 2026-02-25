---
name: ff-deploy-local
description: Build, deploy, and verify an agent bundle on local minikube
user_invocable: true
argument: bundle name (e.g. my-bot)
---

# Deploy Agent Bundle to Local Minikube

Build a Docker image, deploy to a local FireFoundry cluster, and verify it's reachable through Kong.

## 1. Resolve context

Use the provided argument as the bundle name. If not provided, detect from the current directory (look for `firefoundry.json` with `"type": "agent-bundle"`).

Verify we're in the monorepo root (has `turbo.json` and `pnpm-workspace.yaml`). If inside `apps/<bundle>/`, cd to the monorepo root first — `ff-cli ops` commands run from the root.

## 2. Verify prerequisites

```bash
# ff-cli profile points to correct minikube context
ff-cli profile show
kubectl config current-context
```

The profile's kubectl context must match the current context. If not:

```bash
ff-cli profile create <context-name> --kubectl-context <context-name> --registry-type Minikube --use
```

Verify the environment is running:

```bash
kubectl get pods -n <env-name> --field-selector=status.phase!=Running,status.phase!=Succeeded
```

If pods are unhealthy or the namespace doesn't exist, use the `/ff-setup-cluster` skill first.

## 3. Build TypeScript

```bash
pnpm run build
```

Fix any TypeScript errors before proceeding.

## 4. Build Docker image

```bash
ff-cli ops build <bundle-name>
```

Expected: Image built and automatically loaded into minikube. Output should show "Image loaded into minikube: <bundle-name>:latest".

Verify the image is available in minikube:

```bash
minikube -p $(kubectl config current-context) image ls | grep <bundle-name>
```

If the image is NOT in minikube (pod gets `ErrImagePull`), load it manually:

```bash
minikube -p $(kubectl config current-context) image load <bundle-name>:latest
```

## 5. Deploy

```bash
ff-cli ops install <bundle-name> -y
```

The `-y` flag skips interactive confirmation prompts. Expected output: "Installed <bundle-name> (revision 1)".

If the ff-cli warns about kubectl context mismatch, ensure your ff-cli profile matches your current context:

```bash
ff-cli profile show
kubectl config current-context
# If they differ:
ff-cli profile create <context-name> --kubectl-context <context-name> --registry-type Minikube --use
```

If the release is in `failed` state from a previous attempt, uninstall first:

```bash
helm uninstall <bundle-name> -n <env-name>
# Then retry ff-cli ops install
```

For upgrades after initial deploy, use:

```bash
ff-cli ops install <bundle-name> -y
```

## 6. Verify pod is running

```bash
kubectl get pods -n <env-name> -l app.kubernetes.io/instance=<bundle-name>
```

Expected: 1/1 Running, zero restarts.

If the pod is in `CrashLoopBackOff`, check logs:

```bash
kubectl logs -n <env-name> -l app.kubernetes.io/instance=<bundle-name> --tail=50
```

Common crash causes:
- **"Database host not configured"**: PG_HOST missing from configMap — see `/ff-create-bundle` step 3
- **"Cannot find module"**: TypeScript build failed or Dockerfile issue
- **OOMKilled**: Increase memory limits in values.local.yaml

If the pod is in `ErrImagePull` or `ImagePullBackOff`:
- Image not loaded into minikube — rerun step 4's `minikube image load`
- Wrong image name — check `image.repository` in values.local.yaml matches the build output

## 7. Verify Kong route

Wait 15-30 seconds for the agent-bundle-controller to discover the service, then test:

```bash
curl -s http://localhost:8000/agents/<env-name>/<bundle-name>/health/ready
```

Expected: `{"status":"healthy","timestamp":"..."}` or similar health response.

If you get `{"message":"no Route matched"}`:
1. Check the service has the right labels:
   ```bash
   kubectl get svc -n <env-name> -l firefoundry.ai/bundle-name=<bundle-name>
   ```
2. Check the controller logs:
   ```bash
   kubectl logs -n ff-control-plane $(kubectl get pod -n ff-control-plane -l app.kubernetes.io/name=agent-bundle-controller -o name | head -1) --tail=20
   ```

## 8. Test endpoints

Test built-in endpoints:

```bash
# Info endpoint
curl -s http://localhost:8000/agents/<env-name>/<bundle-name>/info | python3 -m json.tool

# Health
curl -s http://localhost:8000/agents/<env-name>/<bundle-name>/health/ready
```

Test custom `@ApiEndpoint` endpoints (note the `/api/` prefix):

```bash
# GET endpoint
curl -s http://localhost:8000/agents/<env-name>/<bundle-name>/api/<route>

# POST endpoint
curl -s -X POST http://localhost:8000/agents/<env-name>/<bundle-name>/api/<route> \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

## 9. Rebuild cycle

For subsequent changes after the initial deploy:

```bash
# 1. Edit code
# 2. Rebuild TypeScript
pnpm run build
# 3. Rebuild Docker image (auto-loads into minikube)
ff-cli ops build <bundle-name>
# 4. Upgrade the helm release
ff-cli ops install <bundle-name> -y
# 5. Restart pod to pick up new image
kubectl rollout restart deployment/<bundle-name>-agent-bundle -n <env-name>
# 6. Wait and verify
kubectl rollout status deployment/<bundle-name>-agent-bundle -n <env-name> --timeout=120s
```
