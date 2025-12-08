# Deploying the Talespring Example

This guide walks you through deploying and testing the **talespring** example agent bundle - a creative storytelling AI that demonstrates FireFoundry's Entity-Bot-Prompt architecture.

## Prerequisites

Before starting, ensure you've completed:

1. **[Prerequisites](../getting-started/prerequisites.md)** - Core tools installed
2. **[Environment Setup](./environment-setup.md)** - minikube cluster running
3. **[Deploy Services](../platform/deployment.md)** - Control plane and core services deployed
4. **[FF CLI Setup](./ff-cli-setup.md)** - FireFoundry CLI installed

## Step 1: Create Project with Talespring Example

First, list available examples to verify talespring is accessible:

```bash
# List available examples
ff-cli examples list
```

You should see talespring along with other examples. Now create a new project:

```bash
# Create project with talespring example
cd /tmp  # Or your preferred workspace directory
ff-cli project create talespring-demo --with-example=talespring
cd talespring-demo
```

**What you get**:

- Complete monorepo structure with Turborepo and pnpm
- Working talespring agent in `apps/talespring/`
- Pre-configured Dockerfile for containerization
- Template configuration files for deployment

## Step 2: Install Dependencies and Build

```bash
# Install all dependencies
pnpm install

# Build the project
pnpm run build
```

This compiles TypeScript and prepares the agent bundle for deployment.

## Step 3: Build Docker Image

Build the Docker image using the FireFoundry CLI:

```bash
# Build for minikube (image stays local)
ff-cli ops build talespring --minikube --tag latest
```

This command:
- Automatically switches to minikube's Docker daemon
- Builds the image with the correct Dockerfile
- Passes the `GITHUB_TOKEN` build arg for private package access

**Alternative: Manual Docker Build**

If you prefer manual control or need to troubleshoot:

```bash
# Switch to minikube's Docker environment
eval $(minikube docker-env)

# Build the Docker image from project root
docker build \
  --build-arg GITHUB_TOKEN=$GITHUB_TOKEN \
  -t talespring:latest \
  -f apps/talespring/Dockerfile \
  .
```

Verify the image was built:

```bash
docker images | grep talespring
```

For more details on build options, see the [FF CLI Operations Guide](../../ff-cli/ops.md).

## Step 4: Prepare Configuration Files

Navigate to the talespring directory and prepare configuration:

```bash
cd apps/talespring

# Copy the secrets template
cp secrets.yaml.template secrets.yaml
```

**For local development**, the default secrets template works as-is since we're connecting to shared Firebrand services. For production deployments, you would edit `secrets.yaml` with actual credentials.

Now create the local values file. The talespring example includes a `values.local.yaml.template` file. Copy and customize it:

```bash
# Copy the values template
cp values.local.yaml.template values.local.yaml
```

Edit `values.local.yaml` to configure for local minikube deployment. Update these key sections:

```yaml
# Local minikube values for talespring
bundleName: "talespring" # IMPORTANT: Must match your service name

# Image configuration
image:
  repository: talespring
  tag: "latest"
  pullPolicy: Always

# Service configuration
service:
  type: ClusterIP
  http:
    enabled: true
    port: 3001
    targetPort: 3001
# ... rest of config remains the same
```

**Critical**: The `bundleName` field determines the Kong route path (`/agents/ff-dev/talespring`). If omitted, it defaults to `my-bundle` which will create the wrong route.

## Step 5: Deploy to Kubernetes

Deploy talespring using the FireFoundry CLI:

```bash
# Deploy from the project root directory
ff-cli ops install talespring --namespace ff-dev
```

This command:
- Adds the FireFoundry Helm repository (if not already added)
- Installs the agent-bundle Helm chart with your `values.local.yaml` and `secrets.yaml`
- Deploys to the specified Kubernetes namespace

**Alternative: Manual Helm Install**

If you prefer manual control:

```bash
# Deploy from the apps/talespring directory
helm install talespring firebrandanalytics/agent-bundle \
  -f values.local.yaml \
  -f secrets.yaml \
  --namespace ff-dev
```

**Verify deployment**:

```bash
# Check pod status
kubectl get pods -n ff-dev | grep talespring

# Watch pod startup (wait until STATUS shows Running)
kubectl get pods -n ff-dev -w
```

The pod should transition to `Running` status within 30-60 seconds.

For more deployment options, see the [FF CLI Operations Guide](../../ff-cli/ops.md).

## Step 6: Verify Kong Route Registration

The agent bundle controller automatically discovers your service and creates a Kong route. Verify the route was created:

```bash
# Port-forward Kong Admin API (if not already running)
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-admin 8001:8001 &

# Check Kong routes
curl -s http://localhost:8001/routes | jq '.data[] | {name, paths}'
```

You should see a route named `ff-agent-ff-dev-talespring-route` with path `/agents/ff-dev/talespring`.

**If the route shows wrong path** (like `/agents/ff-dev/my-bundle`):

1. You forgot to set `bundleName` in values.local.yaml
2. Delete the wrong Kong route: `curl -X DELETE http://localhost:8001/routes/<wrong-route-name>`
3. Update values.local.yaml with `bundleName: "talespring"`
4. Upgrade the Helm release: `helm upgrade talespring firebrandanalytics/agent-bundle -f values.local.yaml -f secrets.yaml --namespace ff-dev`
5. Restart the agent controller: `kubectl delete pod -n ff-control-plane -l app.kubernetes.io/component=agent-bundle-controller`

## Step 7: Test Talespring Through Kong

Set up port-forwarding to access Kong's proxy (the API gateway):

```bash
# Port-forward Kong proxy to localhost (run in separate terminal or background)
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
```

**Note for macOS users**: Direct NodePort access doesn't work with Docker Desktop's minikube. You must use port-forwarding to access services.

Now test talespring endpoints:

```bash
# Health check
curl http://localhost:8080/agents/ff-dev/talespring/health/ready

# Expected: {"status":"healthy","timestamp":"..."}

# Service info
curl http://localhost:8080/agents/ff-dev/talespring/info

# Expected: {"app_id":"...","app_name":"ChildrensStories",...}
```

## Step 8: Test with Postman

Postman provides a user-friendly interface for testing your agent bundle's API endpoints. We've created a complete collection with pre-configured requests for talespring.

### Install Postman

If you don't have Postman installed:

1. Download from [postman.com/downloads](https://www.postman.com/downloads/)
2. Install and launch Postman
3. Sign in or create a free account (optional but recommended)

### Import the Talespring Collection

Download and import the pre-built collection:

1. **Download the collection**: [talespring-postman-collection.json](talespring-postman-collection.json)

   - Right-click and "Save Link As..." or download directly

2. **Import into Postman**:

   - Open Postman
   - Click **Import** button (top left)
   - Drag and drop the downloaded JSON file, or click **Upload Files**
   - Click **Import** to confirm

3. **You should see**: "TaleSpring - Children's Story Generation API" collection in your sidebar

### Configure Environment Variables

Set up the base URL to point to your local Kong gateway:

1. **Create a new environment**:

   - Click the **Environments** tab (left sidebar)
   - Click **+** to create new environment
   - Name it "Local Minikube"

2. **Add variables**:

   - Variable: `BASE_URL`
   - Initial Value: `http://localhost:8080/agents/ff-dev/talespring`
   - Current Value: `http://localhost:8080/agents/ff-dev/talespring`
   - Click **Save**

3. **Activate the environment**:
   - Select "Local Minikube" from the environment dropdown (top right)

### Test the Collection

The collection includes organized folders with all talespring endpoints:

**Health & Info**:

- `GET /health/ready` - Health check
- `GET /health/live` - Liveness probe
- `GET /info` - Service metadata

**Story Generation Workflow**:

1. `POST /createStoryRequest` - Start story generation
   - Auto-captures `workflowId` and `storyRequestId`
2. `GET /workflow/:workflowId/status` - Poll for completion
3. `GET /story/:storyRequestId` - Retrieve generated story

**Direct Invoke (Advanced)**:

- `POST /invoke` - Direct entity method invocation

### Quick Test Flow

1. **Check health**:

   - Open "Health & Info" folder
   - Click "Health Check (Readiness)"
   - Click **Send**
   - You should see: `{"status":"healthy","timestamp":"..."}`

2. **Generate a story**:

   - Open "Story Generation Workflow" folder
   - Click "Create Story Request"
   - Review the request body (pre-filled with example data)
   - Click **Send**
   - The response will auto-populate `workflowId` and `storyRequestId`

3. **Check workflow status**:

   - Click "Get Workflow Status"
   - Click **Send**
   - Wait until `status: "completed"`

4. **Get the story**:
   - Click "Get Story by ID"
   - Click **Send**
   - View the generated story in the response

### Customize Story Requests

Edit the request body in "Create Story Request" to experiment:

```json
{
  "storyDescription": "A magical adventure in a enchanted forest",
  "theme": "fantasy",
  "ageGroup": "6-8",
  "length": "medium",
  "educationalFocus": "problem-solving"
}
```

### Troubleshooting Postman

**Connection refused errors**:

```bash
# Verify Kong port-forward is running
ps aux | grep port-forward

# Restart if needed
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
```

**404 Not Found**:

- Check that `BASE_URL` environment variable is set correctly
- Verify the talespring route exists: `curl -s http://localhost:8001/routes | jq '.data[] | {name, paths}'`

**500 Internal Server Error**:

- Check pod logs: `kubectl logs -n ff-dev -l app.kubernetes.io/instance=talespring`
- Verify core services are running: `kubectl get pods -n ff-dev`

## Troubleshooting

### Pod Not Starting

```bash
# Check pod events
kubectl describe pod -n ff-dev <pod-name>

# Check logs
kubectl logs -n ff-dev <pod-name>
```

Common issues:

- **ImagePullBackOff**: Image not found - rebuild with `eval $(minikube docker-env)` first
- **CrashLoopBackOff**: Configuration error - check secrets.yaml and values.local.yaml
- **Pending**: Insufficient resources - check `minikube status` and resource allocation

### Route Not Created

```bash
# Check agent controller logs
kubectl logs -n ff-control-plane -l app.kubernetes.io/component=agent-bundle-controller --tail=100
```

Common causes:

- Service doesn't have required labels (chart should add these automatically)
- Agent controller not running - check `kubectl get pods -n ff-control-plane`
- Service discovery lag - wait 10-20 seconds after deployment

### Authentication Errors

If you see `"No API key found in request"`:

1. Authentication is enabled in your control plane configuration
2. For local development, authentication should be disabled
3. Check `~/dev/ff-configs/environments/dev/control-plane-values.yaml`:
   ```yaml
   agentBundleController:
     authentication:
       enabled: false # Should be false for local dev
   ```
4. If changed, upgrade control plane: `helm upgrade firefoundry-control ...`
5. Restart agent controller to apply changes

## What You've Accomplished

You've successfully:

- Created a FireFoundry project with the talespring example
- Built and containerized an agent bundle
- Deployed to Kubernetes using Helm
- Configured automatic Kong route registration
- Tested the agent through the API gateway

**Next Steps**:

- **[Update Agent Bundles](./updating-agent-bundles.md)** - Make changes and redeploy
- **[FF CLI Operations Guide](../../ff-cli/ops.md)** - Learn about build, install, and upgrade commands
- Explore the talespring source code in `apps/talespring/src/` to understand Entity-Bot-Prompt patterns
- Review entity definitions, bot implementations, and prompt composition
- Try creating your own agent bundle: `ff-cli agent-bundle create my-service`
- Learn about monitoring and operations: **[Operations Guide](../platform/operations.md)**

## Additional Resources

- **Entity-Bot-Prompt Architecture**: See `~/dev/CLAUDE.md` for framework overview
- **Agent SDK Documentation**: Available in generated project's README
- **Example Agents**: Use `ff-cli examples list` to discover more examples
- **Troubleshooting Guide**: **[Troubleshooting](./troubleshooting.md)** for common issues
