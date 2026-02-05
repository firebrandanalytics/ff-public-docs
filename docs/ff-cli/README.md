# ff-cli Documentation

The `ff-cli` tool provides command-line interfaces for managing FireFoundry projects, including project scaffolding, Docker image builds, Kubernetes deployments, and configuration profiles.

## Documentation

### Platform Setup & Management
- **[Cluster Management](cluster-management.md)** - Initialize Kubernetes clusters, install control plane, check cluster status
- **[Environment Management](environment-management.md)** - Create and manage isolated development/production environments (namespaces with services)

### Project Development
- **[Project and Agent Bundle Scaffolding](project-and-bundle-scaffolding.md)** - Create new projects and agent bundles with templates and examples
- **[Profile Management](profiles.md)** - Manage Docker registry authentication profiles for different environments

### Deployment & Operations
- **[Operations Commands](ops.md)** - Build, install, upgrade, and manage agent bundle deployments using Docker and Helm

## Quick Start

### Creating Projects

Create new FireFoundry monorepos with agent bundles:

```bash
# Create a new project
ff-cli project create my-ai-project

# Create project with example agent bundle
ff-cli project create my-project --with-example haiku-service

# Add agent bundle to existing project
cd my-project/
ff-cli agent-bundle create analytics-service

# List available examples
ff-cli examples list
```

See [project-and-bundle-scaffolding.md](project-and-bundle-scaffolding.md) for complete scaffolding documentation.

### Profiles

Profiles store Docker registry authentication settings, allowing you to switch between different environments (local minikube, GCP, Azure, etc.) without manually specifying credentials each time.

```bash
# Create a profile
ff-cli profile create my-profile

# List all profiles
ff-cli profile list

# Set current profile
ff-cli profile select my-profile
```

### Operations

Build and deploy agent bundles:

```bash
# Build a Docker image (uses current profile)
ff-cli ops build my-bundle --tag 1.0.0

# Install to Kubernetes
ff-cli ops install my-bundle

# Upgrade an existing deployment
ff-cli ops upgrade my-bundle
```

## Complete Workflow

From project creation to deployment:

```bash
# 1. Create project with example
ff-cli project create my-ai-app --with-example haiku-service

# 2. Enter project and install dependencies
cd my-ai-app
pnpm install

# 3. Add another agent bundle
ff-cli agent-bundle create custom-service

# 4. Build Docker image
ff-cli profile select gcp-dev
ff-cli ops build haiku-service --tag 1.0.0

# 5. Deploy to Kubernetes
ff-cli ops install haiku-service
```

## Integration

All ff-cli commands work together seamlessly:

- **Scaffolding** creates properly structured projects and bundles
- **Profiles** manage registry authentication for builds
- **Operations** build and deploy the scaffolded bundles

See individual documentation pages for detailed usage.

