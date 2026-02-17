# Agent Development Guide

This guide covers two paths for creating FireFoundry agent bundles:

1. **[From Scratch](#creating-an-agent-bundle-from-scratch)** — Build a new agent bundle using SDK v4 patterns (recommended)
2. **[Talespring Example](#deploying-the-talespring-example)** — Deploy a pre-built example to explore Entity-Bot-Prompt architecture

## Prerequisites

Before starting, ensure you've completed:

1. **[Prerequisites](../getting-started/prerequisites.md)** - Core tools installed
2. **[Environment Setup](./environment-setup.md)** - minikube cluster running
3. **[Deploy Services](../platform/deployment.md)** - Control plane and core services deployed
4. **[FF CLI Setup](./ff-cli-setup.md)** - FireFoundry CLI installed

---

## Creating an Agent Bundle from Scratch

This section walks through creating, implementing, and deploying a new agent bundle using SDK v4, including LLM integration via the FireFoundry Broker.

### Step 1: Scaffold the Project

```bash
# Create a new application monorepo
ff-cli application create my-app
cd my-app

# Create an agent bundle
ff-cli agent-bundle create my-service
```

This creates a Turborepo monorepo with your bundle at `apps/my-service/`, including:
- `src/agent-bundle.ts` — Main bundle class
- `src/constructors.ts` — Entity type registry
- `Dockerfile` — Multi-stage Docker build
- `helm/values.local.yaml` — Local deployment configuration
- `firefoundry.json` — Bundle metadata
- `AGENTS.md` — SDK usage guide

### Step 2: Configure values.local.yaml

Edit `apps/my-service/helm/values.local.yaml`:

```yaml
global:
  environment: "ff-test"   # Your environment namespace

configMap:
  enabled: true
  data:
    # Database
    PG_HOST: firefoundry-core-postgresql
    PG_PORT: "5432"
    PG_DATABASE: firefoundry
    PG_SSL_DISABLED: "true"
    PG_SSL_MODE: disable
    # Entity service (required for SDK v4 createEntityClient)
    REMOTE_ENTITY_SERVICE_URL: http://firefoundry-core-entity-service
    REMOTE_ENTITY_SERVICE_PORT: "8080"
    # LLM Broker
    LLM_BROKER_HOST: firefoundry-core-ff-broker
    LLM_BROKER_PORT: "50051"
    # Other services
    CODE_SANDBOX_HOST: firefoundry-core-code-sandbox
    CODE_SANDBOX_PORT: "3000"
    CONTEXT_SERVICE_ADDRESS: http://firefoundry-core-context-service:50051
    # Runtime
    PORT: "3000"
    NODE_ENV: development
    CONSOLE_LOG_LEVEL: debug
    LOGGING_PROVIDER: none
    WEBSITE_HOSTNAME: dev

secret:
  enabled: true
  data:
    PG_PASSWORD: "<from-k8s-secret>"
    PG_INSERT_PASSWORD: "<from-k8s-secret>"
```

Retrieve database credentials from your environment:

```bash
# Get database config values
kubectl get configmap firefoundry-core-database-config -n ff-test -o jsonpath='{.data}'

# Get database passwords (base64-decoded)
kubectl get secret firefoundry-core-database-secret -n ff-test -o jsonpath='{.data}' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}={base64.b64decode(v).decode()}') for k,v in d.items()]"
```

### Step 3: Update Dependencies to SDK v4

Edit `apps/my-service/package.json`:

```json
{
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^4.2.0-beta.0",
    "@firebrandanalytics/shared-types": "^2.1.1",
    "@firebrandanalytics/shared-utils": "^4.2.0-beta.3",
    "express": "^4.18.2",
    "zod": "^3.22.4"
  }
}
```

### Step 4: Implement the Bundle

Edit `apps/my-service/src/agent-bundle.ts`:

```typescript
import {
  FFAgentBundle,
  ApiEndpoint,
  logger,
  createEntityClient,
} from "@firebrandanalytics/ff-agent-sdk";
import { MyServiceConstructors } from "./constructors.js";

const APP_ID = "<generate-a-uuid>";  // Use uuidgen or similar

export class MyServiceAgentBundle extends FFAgentBundle<any> {
  private startedAt: string;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "MyService",
        type: "agent_bundle",
        description: "My agent bundle",
      },
      MyServiceConstructors,
      createEntityClient(APP_ID) as any
    );
    this.startedAt = new Date().toISOString();
  }

  override async init() {
    await super.init();
    logger.info("MyService initialized!");
  }

  @ApiEndpoint({ method: "GET", route: "status" })
  async getStatus(): Promise<any> {
    return { status: "running", startedAt: this.startedAt };
  }

  @ApiEndpoint({ method: "POST", route: "echo" })
  async echo(body: any = {}): Promise<any> {
    return { received: body, timestamp: new Date().toISOString() };
  }
}
```

**Key SDK v4 changes from earlier versions:**
- `createEntityClient(APP_ID)` replaces the old `app_provider` pattern
- Constructor DTO requires `application_id` and `type: "agent_bundle"`
- `@ApiEndpoint` routes are served under `/api/` prefix (e.g., `route: "status"` becomes `/api/status`)

### Step 5: Register the Application

SDK v4 requires the application to be registered with entity-service. Port-forward and register via curl:

```bash
# Port-forward to entity-service
kubectl port-forward -n ff-test svc/firefoundry-core-entity-service 8080:8080 &

# Create the system application (one-time, if not already present)
curl -s -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{"id":"a0000000-0000-0000-0000-000000000000","name":"System","type":"system","description":"System application"}'

# Register your bundle's application (APP_ID must match your code)
curl -s -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{"id":"<your-app-uuid>","name":"my-service","type":"agent_bundle","description":"My agent bundle"}'
```

### Step 6: Build and Deploy

```bash
# Install dependencies and build TypeScript
pnpm install
pnpm run build

# Build Docker image (auto-loads into minikube)
ff-cli ops build my-service

# Deploy to Kubernetes
ff-cli ops install my-service -y

# Enable external access through Kong
kubectl annotate svc my-service-agent-bundle -n ff-test firefoundry.ai/external-access=true
```

Wait for the pod to be ready, then test:

```bash
# Health check through Kong
curl http://localhost:8000/agents/ff-test/my-service/health/ready

# Custom endpoint
curl http://localhost:8000/agents/ff-test/my-service/api/status
```

### Step 7: Add a Bot with LLM Integration

To add LLM capabilities, create a bot using the SDK v4 mixin pattern.

**Define the output schema** (`apps/my-service/src/bots/MyBotSchema.ts`):

```typescript
import { z } from "zod";

export const MyBotSchema = z.object({
  summary: z.string().describe("A concise summary"),
  keyPoints: z.array(z.string()).describe("Key points"),
});

export type MyBotOutput = z.infer<typeof MyBotSchema>;
```

**Create the bot** (`apps/my-service/src/bots/MyBot.ts`):

```typescript
import {
  MixinBot,
  Prompt,
  PromptGroup,
  StructuredPromptGroup,
  StructuredOutputBotMixin,
  PromptTemplateTextNode,
} from "@firebrandanalytics/ff-agent-sdk";
import { ComposeMixins } from "@firebrandanalytics/shared-utils";
import { MyBotSchema } from "./MyBotSchema.js";

function buildPromptGroup(input: string) {
  const systemPrompt = new Prompt("system", {});
  systemPrompt.add_section(
    new PromptTemplateTextNode({
      content: "You are a helpful assistant. Analyze the input and produce structured output.",
    })
  );

  const userPrompt = new Prompt("user", {});
  userPrompt.add_section(new PromptTemplateTextNode({ content: input }));

  return new StructuredPromptGroup({
    base: new PromptGroup([
      { name: "system", prompt: systemPrompt },
      { name: "user", prompt: userPrompt },
    ]),
    input: new PromptGroup([]),
  });
}

const MyBotBase = ComposeMixins(MixinBot, StructuredOutputBotMixin) as any;

export class MyBot extends MyBotBase {
  constructor(input: string) {
    const promptGroup = buildPromptGroup(input);
    super(
      [{ name: "MyBot", base_prompt_group: promptGroup, model_pool_name: "gemini_completion", static_args: {} }],
      [{ schema: MyBotSchema }]
    );
  }

  // Required by SDK v4 — return a label for telemetry/logging
  get_semantic_label_impl(_request: any): string {
    return "MyBot";
  }
}
```

**Add an endpoint** in `agent-bundle.ts`:

```typescript
import { BotRequest, Context } from "@firebrandanalytics/ff-agent-sdk";
import { MyBot } from "./bots/MyBot.js";

// Inside the bundle class:
@ApiEndpoint({ method: "POST", route: "analyze" })
async analyze(body: any = {}): Promise<any> {
  const { content } = body;
  if (!content) throw new Error("content is required");

  const bot = new MyBot(content);
  const request = new BotRequest({
    id: `analyze-${Date.now()}`,
    input: content,
    args: {},
    context: new Context(),
  });

  const response = await bot.run(request);
  return { result: response.output };
}
```

**Key bot implementation details:**
- `ComposeMixins(MixinBot, StructuredOutputBotMixin)` creates a base class combining core bot behavior with Zod-validated output parsing
- Constructor takes two arrays: bot configs and structured output configs
- `model_pool_name` must match a model group name configured in the broker (e.g., `"gemini_completion"`)
- `get_semantic_label_impl()` is required — SDK throws at runtime if missing
- `BotRequest` requires `{ id, input, args, context: new Context() }`

### Step 8: Configure the Broker for LLM Access

Before bots can call LLMs, configure the broker's routing chain:

```bash
# Create routing config from a JSON file
ff-cli env broker-config create ff-test -f gemini.json

# Add the provider API key
ff-cli env broker-secret add ff-test --key GEMINI_API_KEY --value "<your-key>" -y

# Verify broker is healthy
kubectl get pods -n ff-test -l app.kubernetes.io/name=ff-broker
```

Then rebuild and redeploy to test the LLM endpoint:

```bash
pnpm run build
ff-cli ops build my-service
ff-cli ops deploy my-service -y

# Force pod restart if using same image tag
kubectl rollout restart deployment/my-service-agent-bundle -n ff-test

# Test LLM endpoint
curl -s -X POST http://localhost:8000/agents/ff-test/my-service/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"content": "FireFoundry is a PaaS for AI applications."}'
```

### Rebuild Cycle

For subsequent changes after initial deploy:

```bash
pnpm run build                           # Compile TypeScript
ff-cli ops build my-service              # Build Docker image
ff-cli ops deploy my-service -y          # Upgrade Helm release
kubectl rollout restart deployment/my-service-agent-bundle -n ff-test  # Force pod restart
```

The `kubectl rollout restart` is needed when using the `latest` image tag, since Helm sees no diff when the tag hasn't changed.

---

## Deploying the Talespring Example

This section walks you through deploying and testing the **talespring** example agent bundle — a creative storytelling AI that demonstrates FireFoundry's Entity-Bot-Prompt architecture.

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
# Build for minikube (image auto-loaded into minikube)
ff-cli ops build talespring
```

This command:
- Builds the image with the correct Dockerfile
- Automatically loads the image into minikube
- Passes the FireFoundry license as `FF_NPM_TOKEN` for private package authentication

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
ff-cli ops install talespring -y
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
