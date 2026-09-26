# FireFoundry Workshop Guide - November 2025

> **Welcome!** This guide will walk you through updating your FireFoundry installation, creating a new agent bundle project, and deploying both an agent bundle and its GUI to your local minikube cluster.

## Prerequisites

Before starting this workshop, ensure you have:

- ✅ **FireFoundry installed locally** - Control Plane and Core Services deployed in minikube
  - If you haven't completed this yet, follow the [Local Development Guide](../../docs/ff_local_dev/README.md)
- ✅ **minikube running** - Your local Kubernetes cluster should be active
- ✅ **ff-cli installed** - The FireFoundry CLI tool should be available in your PATH
  - Download and install from: [ff-cli Releases](https://github.com/firebrandanalytics/ff-cli-releases/releases)
  - Verify installation: `ff-cli --version`
- ✅ **Configuration files** - You should have received `ff-dev-config.zip` with updated values files

## Part 1: Updating Your FireFoundry Installation

Before starting a new project, we need to ensure your FireFoundry installation is up-to-date with the latest charts and services.

### Step 1.1: Update Helm Repository

First, make sure you have the latest FireFoundry Helm charts:

```bash
# Update Helm repository
helm repo update firebrandanalytics

# Verify charts are available
helm search repo firebrandanalytics
```

You should see charts like:

- `firebrandanalytics/firefoundry-control-plane`
- `firebrandanalytics/firefoundry-core`
- `firebrandanalytics/agent-bundle`

### Step 1.2: Extract Configuration Files

If you received a `ff-dev-config.zip` file, extract it to a convenient location:

```bash
# Extract the configuration package
unzip ff-dev-config.zip
cd ff-dev-config

# You should now have these files:
# - core-values.yaml                    (Core services configuration)
# - control-plane-values.yaml            (Control plane configuration)
# - secrets.yaml                         (API keys and credentials)
# - agent-bundle-example-values/         (Example agent bundle configs)
#   ├── values.local.yaml                (Example values file)
#   ├── secrets.yaml                     (Example secrets file)
#   └── README.md                        (Usage instructions)
```

**Important**: All helm upgrade commands in this section assume you're in the directory containing these configuration files.

### Step 1.3: Upgrade Control Plane

Update your FireFoundry Control Plane to the latest version:

```bash
helm upgrade firefoundry-control firebrandanalytics/firefoundry-control-plane \
  -f control-plane-values.yaml \
  -f secrets.yaml \
  -n ff-control-plane
```

**What this does:**

- Upgrades the Control Plane services (PostgreSQL, Kong API Gateway, Harbor, FF Console)
- Applies your configuration from the values files
- Updates to the latest chart version

### Step 1.4: Upgrade Core Services

Update your Core Services in the `ff-dev` namespace:

```bash
helm upgrade firefoundry-core firebrandanalytics/firefoundry-core \
  -f core-values.yaml \
  -f secrets.yaml \
  -n ff-dev
```

**What this does:**

- Upgrades Core Services (FF Broker, Context Service, Code Sandbox, Entity Service)
- Applies your configuration
- Updates to the latest chart version

### Step 1.5: Verify Everything is Healthy

Wait 2-3 minutes for services to restart, then verify:

```bash
# Check Control Plane pods
kubectl get pods -n ff-control-plane

# Check Core Services pods
kubectl get pods -n ff-dev

# All pods should show "Running" status
```

If any pods are stuck in `Pending` or `CrashLoopBackOff`, check the troubleshooting section at the end of this guide.

**✅ Success Checkpoint**: You should see all pods in `Running` status before proceeding.

---

## Part 2: Starting a New Project

Now that your FireFoundry installation is up-to-date, let's create a new agent bundle project.

### Step 2.1: Choose Your Development Location

**Understanding Filesystem Locations**

Before creating your project, decide where on your computer you want to store your code. This is a personal preference:

- **Some developers use**: `~/dev/` (a folder called "dev" in your home directory)
- **Others use**: `~/code/`, `~/projects/`, or `~/workspace/`
- **Or simply**: `~/Desktop/my-project/` for quick experiments

**What you need to know:**

- Your home directory (`~`) is usually `/Users/yourname` on Mac or `/home/yourname` on Linux
- You can create folders anywhere you have permission
- Choose a location that makes sense for you and is easy to find

**Example**: If you want to use `~/dev/`:

```bash
# Check if the directory exists
ls ~/dev

# If it doesn't exist, create it
mkdir -p ~/dev

# Navigate to it
cd ~/dev
```

**Workshop Note**: For this workshop, we'll use `~/dev/` as an example, but feel free to use any location you prefer!

### Step 2.2: Generate Your Agent Bundle Idea

Before creating your project, you need an idea for what your agent bundle will do! We have a helpful tool for this.

**Using the Agent Bundle Idea Generator**

FireFoundry provides a Custom GPT that helps you brainstorm and plan your agent bundle. This tool will help you:

- Brainstorm what your agent bundle should do
- Design the entity model (data structures)
- Identify bots and workflows needed
- Plan the API surface
- Create a development roadmap

**How to use it:**

1. **Open the Agent Bundle Idea Generator**: [https://chatgpt.com/g/g-68ef254c785881919734e7db0af96793-agentbundle-idea-generator](https://chatgpt.com/g/g-68ef254c785881919734e7db0af96793-agentbundle-idea-generator)

2. **Start a conversation** with something like:

   - "I want to build an agent that helps with [your use case]"
   - "I need an agent bundle for [specific problem]"
   - "Help me design an agent bundle for [your domain]"

3. **The GPT will generate**:

   - A complete project plan with entities, bots, and workflows
   - API endpoint suggestions
   - Implementation roadmap
   - Entity relationships and data flow

4. **Save the output** - The GPT will provide a detailed plan that you can reference while coding. You can:
   - Copy the plan into a markdown file in your project (e.g., `PROJECT_PLAN.md`)
   - Share it with your coding agent (like Claude, ChatGPT, etc.) to help them understand your goals
   - Use it as a reference throughout development

**Example Output**

The GPT might generate something like the example plan we have in this workshop: [`example_files/vibe-coding-plan.md`](example_files/vibe-coding-plan.md). This shows a complete plan for a "Math Word Problem Solver" agent bundle with:

- Entity model (Problem, EquationDeriver, etc.)
- API endpoints
- Implementation steps
- Time-boxed milestones

**Tips for getting good results:**

- Be specific about your problem domain
- Mention any external APIs or services you want to integrate
- Describe the user experience you want to create
- Ask for help with FireFoundry-specific patterns (entities, bots, workflows)

**Don't have an idea yet?**

That's okay! Try asking the GPT:

- "What are some good beginner agent bundle ideas?"
- "Show me examples of simple agent bundles"
- "Help me think of an agent bundle for [your job function/interest]"

**✅ Success Checkpoint**: You should have a project plan (or at least a clear idea) before proceeding to create your project.

### Step 2.3: Create Your Project

Use `ff-cli` to create a new project. You have two options:

**Option A: Create project with a web UI included**

```bash
cd ~/dev  # Or your chosen location

ff-cli project create my-agent-bundle --with-web-ui my-web-ui
```

**Note**: The `--with-web-ui` flag requires a name for the web UI application. This name should be descriptive and can differ from your project name. For example:

- Project: `math-word-solver` → Web UI: `math-solver-ui`
- Project: `news-analyzer` → Web UI: `news-dashboard`
- Project: `document-processor` → Web UI: `doc-processor-ui`

**Option B: Create project without UI (add UI later)**

```bash
cd ~/dev  # Or your chosen location

ff-cli project create my-agent-bundle
```

You can add a web UI later using: `ff-cli gui add <web-ui-name>`

**What `ff-cli project create` does:**

- Creates a new directory with your project name (`my-agent-bundle`)
- Sets up a monorepo structure with Turborepo and pnpm
- Optionally adds a NextJS GUI template (if you used `--with-web-ui`)
- Includes shared packages structure (`packages/shared-types/`)

**Important**: The project creation does **not** create the agent bundle itself. You'll create that in the next step!

**Replace `my-agent-bundle` with your own project name** - use lowercase letters, numbers, and hyphens (e.g., `news-analyzer`, `document-processor`, `story-generator`).

**Workshop Tip**: If you generated a plan with the Custom GPT, use a project name that matches your idea (e.g., `math-word-solver`, `news-analyzer`, `document-processor`).

### Step 2.4: Navigate Into Your Project

```bash
cd my-agent-bundle  # Or whatever you named your project
```

You should now see a basic directory structure like:

```
my-agent-bundle/
├── apps/                    # Empty initially, or contains web-ui if you used --with-web-ui
├── packages/
│   └── shared-types/        # Shared TypeScript types
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

If you used `--with-web-ui`, you'll also see:

```
├── apps/
│   └── my-web-ui/           # NextJS GUI application
```

### Step 2.5: Create Your Agent Bundle

Now create the actual agent bundle within your project:

```bash
# Make sure you're in your project root directory
cd ~/dev/my-agent-bundle  # Or wherever your project is

# Create the agent bundle
ff-cli agent-bundle create my-agent-bundle
```

**Note**: The agent bundle name can match your project name or be different. It should match the functionality you're building. For example:

- Project: `math-word-solver` → Agent Bundle: `math-word-solver`
- Project: `news-analyzer` → Agent Bundle: `news-analyzer`
- Or use a more specific name: `news-sentiment-analyzer`

**What `ff-cli agent-bundle create` does:**

- Creates the agent bundle directory in `apps/<bundle-name>/`
- Generates the basic agent bundle structure:
  - `src/` directory with `entities/`, `bots/`, `prompts/` subdirectories
  - `Dockerfile` for containerization
  - `values.local.yaml` and `secrets.yaml.template` for deployment configuration
  - `firefoundry.json` configuration file
  - TypeScript configuration and package.json

After running this command, your project structure should look like:

```
my-agent-bundle/
├── apps/
│   ├── my-agent-bundle/     # Your agent bundle code (newly created)
│   │   ├── src/
│   │   │   ├── entities/    # Entity definitions
│   │   │   ├── bots/        # Bot implementations
│   │   │   ├── prompts/     # Prompt templates
│   │   │   └── constructors.ts
│   │   ├── Dockerfile
│   │   ├── values.local.yaml
│   │   ├── secrets.yaml.template
│   │   └── firefoundry.json
│   └── my-web-ui/           # NextJS GUI (if you used --with-web-ui)
├── packages/
│   └── shared-types/        # Shared TypeScript types
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

**Optional**: If you generated a project plan with the Custom GPT, save it to your project:

```bash
# Copy your plan into the project (replace with your actual plan file)
cp ~/path/to/your-plan.md PROJECT_PLAN.md

# Or create it fresh
nano PROJECT_PLAN.md  # Paste your plan here
```

This will help you and your coding agent stay aligned during development.

### Step 2.6: Install Dependencies

Install all project dependencies:

```bash
# From your project root directory
pnpm install
```

This will:

- Download all required packages
- Set up workspace links between packages
- Install dependencies for both your agent bundle and GUI (if included)

**⏱️ This may take 2-5 minutes** depending on your internet connection.

### Step 2.7: Build the Project

Verify that everything compiles correctly by running the build:

```bash
# From your project root directory
pnpm run build
```

Or equivalently:

```bash
turbo build
```

**What this does:**

- Compiles TypeScript code in all packages (agent bundle, web UI, shared types)
- Builds the Next.js application for production
- Verifies that your project structure is correct and all dependencies are properly resolved

**Expected output:**

You should see successful builds for:

- `@apps/my-agent-bundle` - Agent bundle TypeScript compilation
- `@apps/my-web-ui` - Next.js application build (if you included a web UI)
- `@shared/types` - Shared TypeScript types compilation

**If you see errors:**

- Check that all dependencies installed correctly: `pnpm install`
- Verify TypeScript is configured properly: Check `tsconfig.json` files
- Common issues: Missing type definitions, workspace configuration problems

**✅ Success Checkpoint**: All packages should build without errors before proceeding.

### Step 2.8: Prepare Configuration Files

Before deploying, you need to set up your configuration files. You'll receive example configuration files in the `ff-dev-config.zip` that you extracted earlier.

**Using the Example Values Files**

The configuration package includes an `agent-bundle-example-values/` directory with:

- `values.local.yaml` - Example non-sensitive configuration
- `secrets.yaml` - Example secrets matching the dev environment
- `README.md` - Usage instructions

**Copy the example files to your agent bundle:**

```bash
# Navigate to your agent bundle directory
cd apps/my-agent-bundle  # Replace with your actual bundle name

# Copy the example values file (adjust path to where you extracted ff-dev-config)
cp /path/to/ff-dev-config/agent-bundle-example-values/values.local.yaml ./values.local.yaml

# Copy the example secrets file
cp /path/to/ff-dev-config/agent-bundle-example-values/secrets.yaml ./secrets.yaml
```

**Customize the values:**

1. **Edit `values.local.yaml`**: Update `bundleName` and `image.repository` to match your agent bundle name

   ```yaml
   bundleName: my-agent-bundle # Change to your bundle name
   image:
     repository: my-agent-bundle # Change to match your bundle name
   ```

2. **Review `secrets.yaml`**: Usually no changes needed for local dev (uses shared dev credentials)

**Alternative: Use Templates**

If you prefer to start from templates instead:

```bash
cp values.local.yaml.template values.local.yaml
cp secrets.yaml.template secrets.yaml
# Then fill in the values manually
```

**✅ Success Checkpoint**: You should have both `values.local.yaml` and `secrets.yaml` in your agent bundle directory before proceeding.

### Step 2.9: Set Up Minikube Profile for ff-cli

Before building and deploying your agent bundle, you need to configure `ff-cli` to use minikube's Docker daemon. This is done through profiles.

**Create a Minikube Profile**

```bash
# Create a profile for local minikube development
ff-cli profile create
```

When prompted:

1. Enter the name "minikube-local"
2. Select **"Minikube"** as the registry type
3. No additional configuration needed (minikube profiles don't require registry credentials)

**Set as Current Profile**

```bash
# Select the minikube profile as active
ff-cli profile select minikube-local
```

**Verify Profile Setup**

```bash
# Check that your profile is selected
ff-cli profile show

# You should see:
# Profile: minikube-local
# ──────────────────────────────────────────────────
#  Type: Minikube
#  Registry: minikube (local Docker daemon)
#  Kubectl Context: minikube
#  Current: Yes
```

**Why This Matters**

When you use `ff-cli ops build` with a minikube profile:

- Images are built using minikube's Docker daemon (not your host Docker)
- Images stay local - no push to remote registry needed
- Kubernetes can access the images directly from minikube's Docker daemon

**You can also use the `--minikube` flag** as an alternative:

```bash
# Build without a profile (uses --minikube flag)
ff-cli ops build my-agent-bundle --minikube --tag latest
```

However, using a profile is recommended as it:

- Simplifies commands (no need to remember flags)
- Makes it easy to switch between environments later
- Provides consistency across your workflow

---

## Part 3: Developing Your Agent Bundle

Now that your project is set up, it's time to implement your agent bundle functionality. Many developers use AI coding assistants (like Claude, ChatGPT, Cursor, etc.) to help with implementation - this is often called "vibe coding."

### Working with Coding Agents

If you're using an AI coding assistant to help implement your agent bundle, here are some best practices:

**1. Provide Context**

Share your project plan (from the Custom GPT) with your coding agent:

- Point them to your `PROJECT_PLAN.md` file (if you saved one)
- Include the vibe-coding plan from the Agent Bundle Idea Generator
- Reference the [Agent SDK Documentation](../../docs/firefoundry/sdk/agent_sdk/README.md) for FireFoundry patterns

**2. Encourage Regular Type Checking**

**⚠️ Important**: Many coding agents don't automatically run type checking. Always encourage your agent to:

- Run `pnpm run typecheck` frequently during development
- Run `pnpm run build` before considering code complete
- Fix TypeScript errors before moving on to new features

**Example prompt for your coding agent:**

> "Please implement the [feature] according to the plan in PROJECT_PLAN.md. After each significant change, run `pnpm run typecheck` to verify there are no TypeScript errors. Only proceed to the next feature once typechecking passes."

**3. Verify Before Deployment**

Before building Docker images or deploying:

- Always run `pnpm run typecheck` from the project root
- Fix any errors before proceeding
- Consider running `pnpm run build` to ensure everything compiles

**Quick Verification Commands:**

```bash
# Type check all packages
pnpm run typecheck

# Build all packages (also performs type checking)
pnpm run build

# Type check specific package
cd apps/my-agent-bundle
pnpm run typecheck
```

**4. Iterative Development**

Encourage your coding agent to:

- Make small, incremental changes
- Test frequently (both type checking and runtime testing)
- Use the FireFoundry documentation to understand patterns
- Ask questions if something is unclear

**5. Debugging Deployed Issues**

When debugging issues in a deployed agent bundle, help your coding agent access cluster information:

**Share Context:**

Tell your coding agent:

> "The agent bundle is deployed in my current kubectl context. You can check logs and pod status to debug issues. namespace: ff-dev"

**Iterative Debugging Workflow:**

When the agent suggests a fix:

1. **Make the code changes** (agent will update files)
2. **Rebuild TypeScript**: `pnpm run build`
3. **Rebuild Docker image**: `ff-cli ops build my-agent-bundle --tag latest`
4. **Upgrade deployment**: `ff-cli ops upgrade my-agent-bundle --namespace ff-dev`
5. **Check logs again**: Use k9s or OpenLens
6. **Share results** with the agent and iterate

---

## Part 4: Deploying Your Agent Bundle to Minikube

Now that your agent bundle is implemented and tested, it's time to deploy it to your minikube cluster. This section covers the critical BUILD → INSTALL workflow.

**⚠️ Important Pattern**: You must **BUILD** before **INSTALL**. You cannot deploy directly from source code - you need to build a Docker image first, then install it to Kubernetes.

### Step 4.1: Verify Prerequisites

Before deploying, ensure:

- ✅ Your agent bundle code is complete and typechecks (`pnpm run typecheck`)
- ✅ Configuration files are set up (`values.local.yaml` and `secrets.yaml` in your agent bundle directory)
- ✅ Minikube profile is configured (`ff-cli profile show` should show your minikube profile)
- ✅ Minikube is running (`minikube status` or `ff-cli ops doctor`)
- ✅ FireFoundry Core Services are running
- ✅ `GITHUB_TOKEN` environment variable is set to a valid token

### Step 4.2: Build the Docker Image

**Critical**: Always build your Docker image before installing or upgrading. For minikube, build using minikube's Docker daemon so Kubernetes can access the image.

**Using your minikube profile (recommended):**

```bash
# From your project root directory
cd ~/dev/my-agent-bundle  # Or wherever your project is

# Build the Docker image (uses current profile automatically)
ff-cli ops build my-agent-bundle --tag latest
```

**Or using the --minikube flag:**

```bash
# Build using minikube's Docker daemon
ff-cli ops build my-agent-bundle --minikube --tag latest
```

**What this does:**

- Builds a Docker image using minikube's Docker daemon
- Tags the image as `my-agent-bundle:latest` (or your bundle name)
- Makes the image available to Kubernetes without pushing to a registry
- The image stays local in minikube's Docker daemon

**Expected output:**

```
Building Docker image for agent bundle: my-agent-bundle
Using minikube profile: minikube-local
- Starting Docker build...
✔ Docker image built successfully: my-agent-bundle:latest

Build completed successfully!
```

**Verify the image was built:**

```bash
# Use minikube's Docker daemon to check
eval $(minikube docker-env)
docker images | grep my-agent-bundle
```

You should see your image listed.

**✅ Success Checkpoint**: The Docker image should build without errors before proceeding.

### Step 4.3: Install to Kubernetes

Now install your agent bundle to the `ff-dev` namespace:

```bash
# From your project root directory
ff-cli ops install my-agent-bundle --namespace ff-dev
```

**What this does:**

- Reads `values.local.yaml` and `secrets.yaml` from `apps/my-agent-bundle/`
- Uses the `firebrandanalytics/agent-bundle` Helm chart
- Creates a Helm release in the `ff-dev` namespace
- Deploys your agent bundle pod
- Configures Kubernetes service and ingress
- Triggers Kong API Gateway to discover and register your service

**Expected output:**

```
Installing agent bundle: my-agent-bundle
Installing Helm release "my-agent-bundle"...
Helm release "my-agent-bundle" installed successfully
Deployment "my-agent-bundle" is ready
```

**Verify deployment:**

```bash
# Check pod status
kubectl get pods -n ff-dev | grep my-agent-bundle

# Watch pod startup (wait until STATUS shows Running)
kubectl get pods -n ff-dev -w
```

The pod should transition to `Running` status within 30-60 seconds.

**Check pod logs if needed:**

```bash
# Get the pod name
POD_NAME=$(kubectl get pods -n ff-dev -l app.kubernetes.io/instance=my-agent-bundle --no-headers -o custom-columns=":metadata.name" | head -1)

# View logs
kubectl logs -n ff-dev $POD_NAME

# Follow logs in real-time (Ctrl+C to exit)
kubectl logs -n ff-dev $POD_NAME -f
```

**✅ Success Checkpoint**: Your pod should be in `Running` status before proceeding.

### Step 4.4: Verify Kong Route Registration

The agent bundle controller automatically discovers your service and creates a Kong route. Verify the route was created:

**Port-forward Kong Admin API:**

```bash
# Port-forward Kong Admin API (run in separate terminal or background)
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-admin 8001:8001 &
```

**Check Kong routes:**

```bash
# List all routes
curl -s http://localhost:8001/routes | jq '.data[] | {name, paths}'
```

You should see a route named `ff-agent-ff-dev-my-agent-bundle-route` with path `/agents/ff-dev/my-agent-bundle`.

**Route Pattern:**

Kong routes follow a predictable pattern:

```
/agents/{environment}/{bundleName}
```

Where:

- `{environment}` comes from `global.environment` in your `values.local.yaml` (e.g., `ff-dev`)
- `{bundleName}` comes from `bundleName` in your `values.local.yaml` (e.g., `my-agent-bundle`)

This pattern ensures consistent routing across all agent bundles in your cluster.

**If the route shows wrong path** (like `/agents/ff-dev/my-bundle`):

1. Check that `bundleName` in `values.local.yaml` matches your bundle name
2. Verify that `global.environment` in `values.local.yaml` matches your namespace (should be `ff-dev` for the `ff-dev` namespace)
3. Delete the wrong Kong route: `curl -X DELETE http://localhost:8001/routes/<wrong-route-name>`
4. Update `values.local.yaml` with correct `bundleName` and `global.environment`
5. Upgrade the Helm release: `ff-cli ops upgrade my-agent-bundle --namespace ff-dev`
6. Restart the agent controller: `kubectl delete pod -n ff-control-plane -l app.kubernetes.io/component=agent-bundle-controller`

**✅ Success Checkpoint**: You should see a Kong route with the correct path before proceeding.

### Step 4.5: Port-Forward Kong Proxy

Set up port-forwarding to access Kong's proxy (the API gateway):

```bash
# Port-forward Kong proxy to localhost (run in separate terminal or background)
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
```

**Note**: Keep this terminal window open - the port-forward runs until you stop it (Ctrl+C).

**Your agent bundle is now accessible at:**

```
http://localhost:8080/agents/ff-dev/my-agent-bundle
```

Replace `my-agent-bundle` with your actual bundle name.

### Step 4.6: Test Your Agent Bundle

Test your agent bundle endpoints through Kong:

**Health check:**

```bash
curl http://localhost:8080/agents/ff-dev/my-agent-bundle/health/ready

# Expected: {"status":"healthy","timestamp":"..."}
```

**Service info:**

```bash
curl http://localhost:8080/agents/ff-dev/my-agent-bundle/info

# Expected: {"app_id":"...","app_name":"...",...}
```

**Test your custom endpoints:**

```bash
# Replace with your actual endpoint
curl -X POST http://localhost:8080/agents/ff-dev/my-agent-bundle/api/your-endpoint \
  -H "Content-Type: application/json" \
  -d '{"your": "data"}'
```

**Using Postman:**

If you prefer a GUI tool, you can generate a Postman collection. The route path follows a predictable pattern based on your namespace and bundle name.

**Understanding the Route Pattern:**

Kong routes are created at:

```
/agents/{environment}/{bundleName}
```

Where:

- `{environment}` matches `global.environment` from your `values.local.yaml` (typically matches your namespace, e.g., `ff-dev`)
- `{bundleName}` matches `bundleName` from your `values.local.yaml` (e.g., `my-agent-bundle`)

**Example**: If your `global.environment` is `ff-dev` and `bundleName` is `math-word-solver`, your route will be:

```
/agents/ff-dev/math-word-solver
```

**Generate a Postman Collection:**

Ask your coding agent to generate a Postman collection:

> "The app is ready for testing through the front door. Can you generate a simple Postman collection using a variable for the base url? The path-based route it was assigned in Kong is: `/agents/ff-dev/my-agent-bundle`"

Replace `my-agent-bundle` with your actual bundle name.

**Set Up Postman:**

1. **Import the collection** - The agent will provide a JSON file you can import into Postman
2. **Create an environment variable**:
   - In Postman, create a new environment (e.g., "Local Minikube")
   - Add a variable: `base_url` = `http://localhost:8080/agents/ff-dev/my-agent-bundle`
   - The collection should reference `{{base_url}}` in all requests
3. **Select the environment** - Choose your environment from the dropdown in Postman
4. **Test your endpoints** - All requests will use the base URL variable automatically

**Example Postman Collection Structure:**

The collection should include:

- Health check endpoints (`/health/ready`, `/health/live`)
- Info endpoint (`/info`)
- Your custom API endpoints (e.g., `/api/solve-word-problem`)

All requests should use the `{{base_url}}` variable so you can easily switch between environments (local, dev, prod).

**✅ Success Checkpoint**: Your agent bundle should respond to health checks and your custom endpoints before proceeding.

### Step 4.7: Updating Your Agent Bundle

When you make code changes and need to redeploy, follow the BUILD → UPGRADE pattern:

**1. Rebuild TypeScript:**

```bash
pnpm run build
```

**2. Rebuild Docker image:**

```bash
ff-cli ops build my-agent-bundle --tag latest
```

**3. Upgrade deployment:**

```bash
ff-cli ops upgrade my-agent-bundle --namespace ff-dev
```

**Or restart the deployment:**

```bash
# Force pod restart to use new image
kubectl rollout restart deployment/my-agent-bundle-agent-bundle -n ff-dev
kubectl rollout status deployment/my-agent-bundle-agent-bundle -n ff-dev
```

**4. Verify changes:**

```bash
# Test your endpoints again
curl http://localhost:8080/agents/ff-dev/my-agent-bundle/health/ready
```

**Debugging with Coding Agents:**

If you're debugging issues with a coding agent, see [Part 3: Developing Your Agent Bundle](#part-3-developing-your-agent-bundle). The iterative workflow is:

1. Agent suggests fix → Make code changes
2. Build TypeScript → `pnpm run build`
3. Build Docker → `ff-cli ops build my-agent-bundle --tag latest`
4. Upgrade → `ff-cli ops upgrade my-agent-bundle --namespace ff-dev`
5. Check logs → `kubectl logs -n ff-dev -l app.kubernetes.io/instance=my-agent-bundle -f`
6. Share results with agent → Iterate

**Tip**: Create a helper script (see Part 3) to automate the rebuild cycle during debugging.

---

## Part 5: Developing Your GUI

Now that your agent bundle is deployed and working, it's time to build a web interface for it. If you created your project with `--with-web-ui`, you already have a Next.js application stub ready to customize.

### Step 5.1: Verify Your Web UI Setup

**If you created your project with `--with-web-ui`:**

You should already have a web UI application in `apps/your-web-ui/`. Verify it exists:

```bash
# From your project root
ls apps/your-web-ui
```

You should see a Next.js application structure with:

- `src/` directory with app structure
- `package.json` with dependencies
- `Dockerfile` for deployment
- `values.local.yaml` and `secrets.yaml` for Kubernetes configuration

**If you didn't create with `--with-web-ui`:**

You can add a web UI to your existing project:

```bash
# From your project root
ff-cli gui add your-web-ui
```

This will create the Next.js template in `apps/your-web-ui/`.

### Step 5.2: Set Up Environment Configuration

Your GUI needs to know how to connect to your agent bundle. For local development, you'll use the Kong proxy you've already port-forwarded.

**Create `.env.local` file:**

```bash
# Navigate to your web UI directory
cd apps/your-web-ui

# Create .env.local file
cat > .env.local << EOF
# FireFoundry Front Door (Kong Gateway) - Local Development
NEXT_PUBLIC_FF_GATEWAY_URL=http://localhost:8080

# Agent Bundle Route (matches your Kong route)
NEXT_PUBLIC_AGENT_BUNDLE_ROUTE=/agents/ff-dev/my-agent-bundle
EOF
```

**Important**: Replace `my-agent-bundle` with your actual bundle name.

**Environment Variables Explained:**

- `NEXT_PUBLIC_FF_GATEWAY_URL` - Base URL for Kong Gateway (your port-forwarded proxy)
- `NEXT_PUBLIC_AGENT_BUNDLE_ROUTE` - The Kong route path to your agent bundle (`/agents/{environment}/{bundleName}`)

**Note**: The `NEXT_PUBLIC_` prefix makes these variables available to client-side code in Next.js.

### Step 5.3: Vibe Code Your GUI

Now it's time to build your GUI with the help of a coding agent.

**Provide Context to Your Coding Agent:**

Share this prompt with your coding agent:

> "Let's build out the frontend using the existing 'your-web-ui' application stub (referencing the frontend_development_guide that comes with newly generated FireFoundry monorepo projects). The frontend_development_guide is located at `docs/sdk/ff_sdk/frontend_development_guide.md` in this project. The agent bundle is deployed and accessible at `/agents/ff-dev/my-agent-bundle` through the Kong Gateway (port-forwarded to localhost:8080). Use the FireFoundry SDK clients (`RemoteAgentBundleClient` and `RemoteEntityClient`) instead of generic HTTP clients. Support .env configuration and default to FireFoundry front-door access through the Kong API Gateway proxy."

**Key Points to Emphasize:**

1. **Use the Frontend Development Guide**: Point your agent to `docs/sdk/ff_sdk/frontend_development_guide.md` in your project
2. **Use Official FireFoundry Clients**: Don't use `axios` or `fetch` directly - use `RemoteAgentBundleClient` and `RemoteEntityClient` from `@firebrandanalytics/ff-sdk`
3. **Next.js API Routes Pattern**: Create API routes in `src/app/api/` that use the FireFoundry clients server-side, then call those routes from React components
4. **Environment Variables**: Use `.env.local` for configuration (already set up in Step 5.2)
5. **Route Pattern**: Your agent bundle is accessible at `/agents/ff-dev/my-agent-bundle` through Kong

**What Your Coding Agent Should Build:**

- Server-side API routes using FireFoundry SDK clients
- React components that call your API routes
- UI that matches your agent bundle's functionality
- Proper error handling and loading states
- Type-safe integration with shared types from `packages/shared-types/`

**Important: Next.js Configuration**

Your coding agent should verify that `next.config.mjs` includes `output: 'standalone'` for Docker builds:

```javascript
const nextConfig = {
  output: "standalone", // Required for Docker deployments
  // ... other config
};
```

Without this setting, Docker builds will fail when trying to copy `.next/standalone`.

### Step 5.4: Install Dependencies

Make sure your web UI has all required dependencies:

```bash
# From your project root
pnpm install

# Or install specifically for the web UI
cd apps/your-web-ui
pnpm install
```

**Required Dependencies:**

The web UI template should already include:

- `@firebrandanalytics/ff-sdk` - FireFoundry SDK clients
- Next.js and React dependencies
- Tailwind CSS for styling

### Step 5.5: Run Your GUI Locally

Start the development server:

```bash
# From your project root
pnpm run dev --filter your-web-ui

# Or from the web UI directory
cd apps/your-web-ui
pnpm run dev
```

**Prerequisites:**

- ✅ Kong proxy must be port-forwarded (from Step 4.5):
  ```bash
  kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
  ```
- ✅ Your agent bundle must be deployed and healthy
- ✅ `.env.local` file is configured correctly

**Access Your GUI:**

Open your browser to:

```
http://localhost:3000
```

(Or whatever port Next.js assigns - check the terminal output)

### Step 5.6: Test Your GUI Locally

**Verify Connectivity:**

1. **Check that your GUI loads** - You should see your application interface
2. **Test agent bundle connectivity** - Try using features that call your agent bundle
3. **Check browser console** - Look for any errors or warnings
4. **Check network tab** - Verify requests are going to `http://localhost:8080/agents/ff-dev/my-agent-bundle`

**Common Issues:**

**Connection refused errors:**

- Verify Kong proxy port-forward is running: `ps aux | grep port-forward`
- Restart port-forward if needed: `kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80`

**404 Not Found:**

- Check that `NEXT_PUBLIC_AGENT_BUNDLE_ROUTE` matches your actual Kong route
- Verify your agent bundle is deployed: `kubectl get pods -n ff-dev | grep my-agent-bundle`

**CORS errors:**

- Should not occur when using Kong Gateway - if you see CORS errors, check your API route configuration

**Debugging with Coding Agents:**

If you encounter issues while developing locally, you may need to share Next.js dev server logs with your coding agent:

- **Terminal output**: Copy the error messages from your `pnpm run dev` terminal
- **Browser console**: Share browser console errors
- **Network tab**: Share failed network requests from browser DevTools

Your coding agent can help diagnose:

- API route configuration issues
- FireFoundry SDK client setup problems
- Environment variable misconfiguration
- Type errors or runtime errors

**✅ Success Checkpoint**: Your GUI should successfully communicate with your agent bundle through Kong Gateway before proceeding to deployment.

---

## Part 6: Deploying Your GUI to Minikube

Now that your GUI is working locally, it's time to deploy it to your minikube cluster. This follows the same BUILD → INSTALL pattern as your agent bundle.

**⚠️ Important Pattern**: Just like agent bundles, you must **BUILD** before **INSTALL**. Build the Docker image first, then install it to Kubernetes.

### Step 6.1: Configure GUI Values Files

Your GUI needs different configuration when running in the cluster - it should use internal Kubernetes service URLs instead of Kong Gateway.

**Navigate to your GUI directory:**

```bash
cd apps/your-web-ui
```

**Step 6.1a: Discover Your Agent Bundle Service Details**

Before configuring, you need to know:

1. Your agent bundle's service name
2. What namespace your agent bundle is in
3. What namespace you'll deploy your GUI to

**Find your agent bundle service:**

```bash
# List all services in ff-dev namespace (or wherever your agent bundle is)
kubectl get svc -n ff-dev | grep my-agent-bundle

# You'll see something like:
# NAME                          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
# my-agent-bundle-agent-bundle  ClusterIP   10.96.xxx.xxx   <none>        3000/TCP
```

**Note the service name**: `my-agent-bundle-agent-bundle` (Helm release name + `-agent-bundle`)

**Determine namespaces:**

```bash
# Check what namespace your agent bundle is in
kubectl get svc my-agent-bundle-agent-bundle --all-namespaces

# Decide what namespace to deploy your GUI to:
# - Same namespace (ff-dev) = simpler configuration
# - Different namespace (e.g., ff-apps) = requires FQDN
```

**Step 6.1b: Configure `values.local.yaml`**

Edit `values.local.yaml` with the appropriate configuration based on your namespace choice:

**Option A: GUI in same namespace as agent bundle (recommended for workshop):**

```yaml
configMap:
  enabled: true
  data:
    # Use internal mode for entity client (direct K8s service access)
    ENTITY_CLIENT_MODE: "internal"

    # Agent Bundle URL - Short DNS (same namespace)
    # Format: http://<service-name>:<port>
    # Service name pattern: <bundle-name>-agent-bundle
    BUNDLE_URL: "http://my-agent-bundle-agent-bundle:3000"

    # Entity Service - Internal Kubernetes service
    ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"
    ENTITY_SERVICE_PORT: "8080"

    # General configuration
    NODE_ENV: "production"
    WEBSITE_HOSTNAME: "dev"
```

**Option B: GUI in different namespace:**

```yaml
configMap:
  enabled: true
  data:
    # Use internal mode for entity client (direct K8s service access)
    ENTITY_CLIENT_MODE: "internal"

    # Agent Bundle URL - FQDN (cross-namespace)
    # Format: http://<service-name>.<namespace>.svc.cluster.local:<port>
    # Replace 'ff-dev' with your agent bundle's namespace
    BUNDLE_URL: "http://my-agent-bundle-agent-bundle.ff-dev.svc.cluster.local:3000"

    # Entity Service - Internal Kubernetes service
    ENTITY_SERVICE_HOST: "http://firefoundry-core-entity-service.ff-dev.svc.cluster.local"
    ENTITY_SERVICE_PORT: "8080"

    # General configuration
    NODE_ENV: "production"
    WEBSITE_HOSTNAME: "dev"
```

**Quick Reference:**

- **Service name pattern**: `{bundle-name}-agent-bundle` (Helm release name + `-agent-bundle`)
- **Same namespace**: `http://{service-name}:{port}` (e.g., `http://math-word-solver-agent-bundle:3000`)
- **Different namespace**: `http://{service-name}.{namespace}.svc.cluster.local:{port}` (e.g., `http://math-word-solver-agent-bundle.ff-dev.svc.cluster.local:3000`)
- **Port**: Usually `3000` (check your agent bundle's service port)

**For Coding Agents:**

When configuring `values.local.yaml`, your coding agent should:

1. **Check the agent bundle service**:

   ```bash
   kubectl get svc -n ff-dev | grep <bundle-name>
   ```

2. **Determine namespace strategy**:

   - If deploying GUI to same namespace: use short DNS
   - If deploying GUI to different namespace: use FQDN

3. **Set BUNDLE_URL accordingly**:
   - Same namespace: `http://{bundle-name}-agent-bundle:3000`
   - Different namespace: `http://{bundle-name}-agent-bundle.{namespace}.svc.cluster.local:3000`

**Configure `secrets.yaml`:**

Usually no changes needed for local dev - the template should work. Review it to ensure any required secrets are present.

### Step 6.2: Build the Docker Image

Build your GUI Docker image using minikube's Docker daemon:

**Using your minikube profile:**

```bash
# From your project root directory
cd ~/dev/my-agent-bundle

# Build the GUI Docker image
ff-cli ops build your-web-ui --tag latest
```

**Or using the --minikube flag:**

```bash
ff-cli ops build your-web-ui --minikube --tag latest
```

**What this does:**

- Builds a Docker image using minikube's Docker daemon
- Tags the image as `your-web-ui:latest`
- Makes the image available to Kubernetes without pushing to a registry

**Expected output:**

```
Building Docker image for application: your-web-ui
Using minikube profile: minikube-local
- Starting Docker build...
✔ Docker image built successfully: your-web-ui:latest

Build completed successfully!
```

**✅ Success Checkpoint**: The Docker image should build without errors before proceeding.

### Step 6.3: Install to Kubernetes

Install your GUI to the `ff-dev` namespace (or your chosen namespace):

```bash
# From your project root directory
ff-cli ops install your-web-ui --namespace ff-dev
```

**What this does:**

- Reads `values.local.yaml` and `secrets.yaml` from `apps/your-web-ui/`
- Uses the appropriate Helm chart (GUI apps use a different chart than agent bundles)
- Creates a Helm release in the specified namespace
- Deploys your GUI pod
- Configures Kubernetes service

**Verify deployment:**

```bash
# Check pod status
kubectl get pods -n ff-dev | grep your-web-ui

# Watch pod startup
kubectl get pods -n ff-dev -w
```

The pod should transition to `Running` status within 30-60 seconds.

**Check pod logs if needed:**

```bash
# Get the pod name
POD_NAME=$(kubectl get pods -n ff-dev -l app.kubernetes.io/instance=your-web-ui --no-headers -o custom-columns=":metadata.name" | head -1)

# View logs
kubectl logs -n ff-dev $POD_NAME

# Follow logs in real-time
kubectl logs -n ff-dev $POD_NAME -f
```

**Debugging with Coding Agents:**

If you encounter issues, share logs with your coding agent:

> "The GUI is deployed in my current kubectl context. You can check logs and pod status to debug issues. namespace: ff-dev"

The agent can help diagnose configuration issues, connection problems, or runtime errors.

**✅ Success Checkpoint**: Your GUI pod should be in `Running` status before proceeding.

### Step 6.4: Port-Forward Your GUI

Since your GUI is running in the cluster, you need to port-forward it to access it locally:

```bash
# Port-forward GUI service to localhost
kubectl port-forward -n ff-dev svc/your-web-ui 3333:80
```

**Note**: Use an available port (e.g., 3333, 3001, 8081). Port 3000 might be in use by your local Next.js dev server.

**Access Your GUI:**

Open your browser to:

```
http://localhost:3333
```

(Or whatever port you chose)

### Step 6.5: Test Your Deployed GUI

**Verify Functionality:**

1. **Check that your GUI loads** - You should see your application interface
2. **Test agent bundle connectivity** - Try using features that call your agent bundle
3. **Check browser console** - Look for any errors or warnings
4. **Verify internal routing** - Your GUI should be using internal Kubernetes service URLs (not Kong Gateway)

**Common Issues:**

**Connection refused errors:**

- Verify port-forward is running: `ps aux | grep port-forward`
- Check GUI pod is running: `kubectl get pods -n ff-dev | grep your-web-ui`

**Agent bundle connection fails:**

- Verify `BUNDLE_URL` in `values.local.yaml` matches your agent bundle service name
- Check service exists: `kubectl get svc -n ff-dev | grep my-agent-bundle`
- Verify namespace is correct (same namespace = short DNS, different = FQDN)

**404 Not Found:**

- Check that your GUI's API routes are configured correctly
- Verify Next.js build completed successfully

**✅ Success Checkpoint**: Your deployed GUI should successfully communicate with your agent bundle using internal Kubernetes service URLs.

### Step 6.6: Updating Your GUI

When you make changes to your GUI:

**1. Rebuild TypeScript:**

```bash
pnpm run build
```

**2. Rebuild Docker image:**

```bash
ff-cli ops build your-web-ui --tag latest
```

**3. Upgrade deployment:**

```bash
ff-cli ops upgrade your-web-ui --namespace ff-dev
```

**4. Verify changes:**

```bash
# Restart port-forward if needed
kubectl port-forward -n ff-dev svc/your-web-ui 3333:80

# Test in browser
# http://localhost:3333
```

---

Now that you have:

- ✅ Updated FireFoundry installation
- ✅ Created a new project
- ✅ Installed dependencies
- ✅ Prepared configuration files
- ✅ Developed your agent bundle
- ✅ Deployed to minikube and verified it's working
- ✅ Developed your GUI and tested it locally
- ✅ Deployed your GUI to minikube and verified it's working

**Congratulations!** You've successfully deployed both an agent bundle and its GUI to your local minikube cluster.

**Optional Next Steps:**

- **Cloud deployment** - Deploy to Firebrand's dev environment (see rough workshop steps for details)
- **Further development** - Continue iterating on your agent bundle and GUI
- **Explore FireFoundry features** - Try entity graph queries, workflows, and more

Continue to explore FireFoundry's capabilities!

---

## Troubleshooting

### GUI Docker Build Fails: "standalone directory not found"

**Error:**

```
ERROR: failed to calculate checksum: "/app/apps/your-web-ui/.next/standalone": not found
```

**Cause:** Next.js isn't generating standalone output because `next.config.mjs` is missing `output: 'standalone'`.

**Solution:**

1. Edit `apps/your-web-ui/next.config.mjs`
2. Add `output: 'standalone'`:

```javascript
const nextConfig = {
  output: "standalone", // Required for Docker builds
  transpilePackages: ["lucide-react", "@firebrandanalytics/ff-sdk"],
};
```

3. Rebuild: `ff-cli ops build your-web-ui --tag latest`

**Prevention:** Your coding agent should verify this setting exists when setting up the GUI.

### GUI Can't Connect to Agent Bundle

**Symptoms:**

- GUI loads but API calls fail
- Connection refused errors in logs
- 404 errors when calling agent bundle endpoints

**Diagnosis:**

1. **Check BUNDLE_URL configuration:**

   ```bash
   # Get the GUI pod's environment variables
   kubectl exec -n ff-dev deployment/your-web-ui -- env | grep BUNDLE_URL
   ```

2. **Verify agent bundle service exists:**

   ```bash
   # List services in the agent bundle's namespace
   kubectl get svc -n ff-dev | grep <bundle-name>
   ```

3. **Check namespace configuration:**
   - Same namespace: Use short DNS (`http://service-name:port`)
   - Different namespace: Use FQDN (`http://service-name.namespace.svc.cluster.local:port`)

**Solution:**

Update `values.local.yaml` with the correct `BUNDLE_URL`:

- Same namespace: `http://{bundle-name}-agent-bundle:3000`
- Different namespace: `http://{bundle-name}-agent-bundle.{namespace}.svc.cluster.local:3000`

Then upgrade: `ff-cli ops upgrade your-web-ui --namespace ff-dev`

### Pods Stuck in ImagePullBackOff

If pods can't pull container images:

```bash
# Check registry credentials
kubectl get secret myregistrycreds -n ff-dev
kubectl get secret myregistrycreds -n ff-control-plane

# If missing, you may need to recreate registry secrets
# See the Local Development Guide for details
```

### Pods Stuck in Pending

If pods can't be scheduled:

```bash
# Check available resources
kubectl describe nodes
kubectl top nodes

# Consider restarting minikube with more resources
minikube stop
minikube start --memory=8192 --cpus=4 --disk-size=20g
```

### Services Not Starting

If services fail to start:

```bash
# Check pod events and logs
kubectl describe pod <pod-name> -n ff-dev
kubectl logs <pod-name> -n ff-dev

# Common issues: missing secrets, database connectivity, resource limits
```

### Project Creation Fails

If `ff-cli project create` fails:

```bash
# Verify ff-cli is installed
ff-cli --version

# If ff-cli is not installed, download from:
# https://github.com/firebrandanalytics/ff-cli-releases/releases

# Check GitHub token (required for private packages)
echo $GITHUB_TOKEN

# If token is missing, set it up per the FF CLI Setup guide
```

---

## Related Documentation

- **[Local Development Guide](../../docs/ff_local_dev/README.md)** - Complete setup instructions
- **[Agent SDK Documentation](../../docs/firefoundry/sdk/agent_sdk/README.md)** - Agent development reference
- **[FF CLI Documentation](../../docs/ff-cli/README.md)** - CLI command reference
- **[Frontend Development Guide](../../docs/firefoundry/sdk/ff_sdk/frontend_development_guide.md)** - GUI development guide
