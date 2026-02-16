# Project and Agent Bundle Scaffolding

The `ff-cli` scaffolding commands provide the fastest way to start building FireFoundry agent applications. These commands create properly structured monorepos with agent bundles ready for development and deployment.

## Overview

FireFoundry scaffolding handles two primary tasks:

1. **Project Creation** - Initialize new monorepos with Turborepo, pnpm workspaces, and Docker/Kubernetes configuration
2. **Agent Bundle Creation** - Add agent bundles (services) to existing projects, either from templates or examples

All scaffolding integrates with the [FireFoundry Agent SDK](../sdk/agent_sdk/core/README.md) and follows monorepo best practices.

## Concepts

### FireFoundry Projects

A FireFoundry **project** is a monorepo containing:

- **apps/** - Agent bundles (domain-specific services)
- **packages/** - Shared libraries
- **docs/** - Documentation (auto-fetched from GitHub)
- **docker-compose.yml** - Local development environment
- **turbo.json** - Turborepo configuration
- **pnpm-workspace.yaml** - Workspace definitions

Projects use **pnpm workspaces** and **Turborepo** for efficient monorepo management, allowing you to build and test multiple services in parallel.

### Agent Bundles

An **agent bundle** is a deployable service that extends `FFAgentBundle` to provide domain-specific AI capabilities. Each bundle:

- Runs as an independent HTTP service
- Integrates with FireFoundry infrastructure (database, LLM broker, context service)
- Defines custom entities, bots, and prompts
- Deploys to Kubernetes via Helm charts

Agent bundles live in the `apps/` directory and are the primary unit of deployment in FireFoundry.

### Examples

FireFoundry provides **example agent bundles** via the `@firebrandanalytics/ff-agent-bundle-examples` npm package. Examples demonstrate:

- Entity patterns (workflows, state machines, data transformations)
- Bot orchestration (LLM integration, multi-step reasoning)
- API endpoint design
- Testing strategies

Use examples to learn patterns or as starting points for new bundles.

## Creating New Projects

### `ff-cli project create` Command

#### Purpose

Create a new FireFoundry monorepo with optional agent bundles, web UI, and CI/CD configuration.

#### Usage

```bash
ff-cli project create <project-name> [OPTIONS]
```

#### Options and Flags

| Option | Description | Default |
|--------|-------------|---------|
| `--agent-name <name>` | Name for initial agent bundle (optional) | project name |
| `--with-example <name>` | Include example agent bundle | none |
| `--with-web-ui <name>` | Include web UI package | none |
| `--internal` | Include internal CI/CD workflows | false |
| `--skip-install` | Skip dependency installation | false |
| `--skip-git` | Skip git initialization | false |
| `--verbose, -v` | Enable verbose logging | false |

#### Project Structure

When you run `ff-cli project create my-project`, it generates:

```
my-project/
├── apps/                         # Agent bundles
│   └── .gitkeep                 # Preserved for git
├── packages/                     # Shared libraries (optional)
├── docs/                        # Documentation (from GitHub)
│   ├── sdk/                    # Agent SDK docs
│   └── ff_local_dev.md         # Local development guide
├── scripts/                     # Development scripts
│   └── dev.sh                  # Docker Compose startup
├── .concourse/                  # Concourse CI configuration
├── .cursor/                     # Cursor IDE rules
├── docker-compose.yml          # Local environment
├── docker-compose.env.yml      # Environment configuration
├── package.json                # Root package (workspaces defined)
├── pnpm-workspace.yaml         # Workspace configuration
├── turbo.json                  # Turborepo build orchestration
├── tsconfig.json               # TypeScript config
├── .npmrc                      # npm registry configuration
├── .gitignore                  # Git ignore patterns
├── README.md                   # Project documentation
└── AGENTS.md                   # Agent bundle documentation
```

#### Generated Files

**package.json** (root):
```json
{
  "name": "my-project",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "clean": "turbo run clean && rm -rf node_modules .turbo"
  }
}
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**turbo.json**:
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**docker-compose.yml** - Includes PostgreSQL, LLM broker proxy, and service definitions for agent bundles.

#### Examples

**Basic project with default agent bundle:**

```bash
ff-cli project create my-ai-project
# Creates project with my-ai-project/ directory
# No agent bundles created yet (apps/ directory is empty)
```

**Project with custom-named agent bundle:**

```bash
ff-cli project create my-project --agent-name report-service
# Creates project with apps/report-service/ agent bundle
```

**Project with example agent bundle:**

```bash
ff-cli project create demo-project --with-example haiku-service
# Fetches haiku-service example from @firebrandanalytics/ff-agent-bundle-examples
# Installs to apps/haiku-service/
```

**Complete project with web UI:**

```bash
ff-cli project create full-stack-project \
  --with-example analytics-bot \
  --with-web-ui analytics-ui
# Creates project with:
# - apps/analytics-bot/ (from example)
# - apps/analytics-ui/ (web UI)
```

**Internal project with CI/CD:**

```bash
ff-cli project create enterprise-project \
  --agent-name core-service \
  --internal
# Adds .github/workflows/ for Azure Container Registry builds
```

**Non-interactive project creation (CI/CD):**

```bash
ff-cli project create automated-project \
  --with-example simple-bot \
  --skip-install \
  --skip-git
# Creates project structure without running pnpm install or git init
```

#### Integration with Examples

When using `--with-example`, the CLI:

1. **Validates GITHUB_TOKEN** - Required for private npm package access
2. **Downloads latest examples package** - From `@firebrandanalytics/ff-agent-bundle-examples`
3. **Extracts requested example** - To `apps/<example-name>/`
4. **Replaces template placeholders** - Generates unique UUIDs for agent bundles
5. **Preserves example structure** - All entities, bots, and prompts copied

#### Next Steps After Project Creation

After `ff-cli project create` completes:

```bash
cd my-project

# Install dependencies (if not skipped)
pnpm install

# Start development environment
pnpm run dev

# Or use Docker Compose
export GITHUB_TOKEN="your_token"
export PG_SERVER="localhost"
export PG_DATABASE="firefoundry"
export PG_PASSWORD="password"
export LLM_BROKER_HOST="localhost"
export LLM_BROKER_PORT="8080"

docker-compose up
```

See `docs/ff_local_dev.md` in your generated project for complete local development setup instructions.

## Creating Agent Bundles

### `ff-cli agent-bundle create` Command

#### Purpose

Add a new agent bundle to an existing FireFoundry project. This command must be run from within a project directory.

#### Usage

```bash
cd my-project/
ff-cli agent-bundle create <bundle-name> [OPTIONS]
```

#### Prerequisites

- Must be run from **within a FireFoundry project** (directory with `pnpm-workspace.yaml`)
- Project must have `apps/` directory

The CLI validates your workspace before creating bundles to prevent accidental creation outside projects.

#### Options and Flags

| Option | Description | Default |
|--------|-------------|---------|
| `--from-example <name>` | Create from example (fetches from npm) | none |
| `--description <text>` | Description for agent bundle | auto-generated |
| `--port <number>` | HTTP port for service | 3000 |
| `--verbose, -v` | Enable verbose logging | false |

#### Bundle Structure

When you run `ff-cli agent-bundle create my-service`, it generates:

```
apps/my-service/
├── src/
│   ├── index.ts              # Server entry point
│   ├── agent-bundle.ts       # Main agent bundle class
│   ├── constructors.ts       # Entity registry
│   ├── entities/            # Domain entities (empty)
│   ├── bots/                # LLM orchestration (empty)
│   └── prompts/             # Dynamic prompts (empty)
├── helm/                    # Helm chart for Kubernetes deployment
│   ├── Chart.yaml           # Helm chart metadata
│   ├── values.yaml          # Base Helm values (cloud defaults)
│   ├── values.local.yaml    # Local minikube overrides (pullPolicy: Never)
│   ├── secrets.yaml.template # Secrets template
│   └── templates/           # Kubernetes manifest templates
├── package.json             # Bundle dependencies
├── tsconfig.json            # TypeScript configuration
├── Dockerfile               # Production build
├── firefoundry.json         # FireFoundry metadata
├── README.md                # Bundle documentation
└── AGENTS.md                # Agent documentation
```

> **Note:** `agent-bundle create` generates only `values.local.yaml` by default. Create additional values files (e.g., `values.dev.yaml`) for other environments as needed. See [Values Files](#values-files) below.

#### Files Generated

**package.json**:
```json
{
  "name": "@apps/my-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^2.0.0",
    "express": "^4.18.2",
    "zod": "^3.22.4"
  }
}
```

**src/agent-bundle.ts**:
```typescript
import {
  FFAgentBundle,
  app_provider,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { MyServiceConstructors } from "./constructors.js";

export class MyServiceAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "generated-uuid",
        name: "MyService",
        description: "my-service agent bundle",
      },
      MyServiceConstructors,
      app_provider
    );
  }

  override async init() {
    await super.init();
    logger.info("MyServiceAgentBundle initialized!");
    
    // Initialize your agent bundle here
  }

  // Add custom API endpoints using @ApiEndpoint decorator
  // @ApiEndpoint({ method: 'GET', route: 'status' })
  // async getStatus(): Promise<{ status: string }> {
  //   return { status: 'running' };
  // }
}
```

**src/index.ts**:
```typescript
import { createStandaloneAgentBundle, logger } from "@firebrandanalytics/ff-agent-sdk";
import { MyServiceAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  const server = await createStandaloneAgentBundle(
    MyServiceAgentBundle,
    { port }
  );
  
  logger.info(`Server running on port ${port}`);
  logger.info(`Health: http://localhost:${port}/health`);
  logger.info(`Invoke: http://localhost:${port}/invoke`);
}

startServer();
```

**src/constructors.ts**:
```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";

export const MyServiceConstructors = {
  ...FFConstructors,
  
  // Add your custom entities here
  // MyEntity: MyEntity,
  // MyWorkflow: MyWorkflow,
  
} as const;
```

**firefoundry.json**:
```json
{
  "name": "my-service",
  "version": "1.0.0",
  "description": "my-service agent bundle",
  "type": "agent-bundle",
  "runtime": "node",
  "entry": "dist/index.js",
  "port": 3000,
  "health": {
    "endpoint": "/health",
    "interval": 30,
    "timeout": 3
  },
  "resources": {
    "requests": { "memory": "256Mi", "cpu": "100m" },
    "limits": { "memory": "512Mi", "cpu": "500m" }
  }
}
```

#### Examples

**Basic agent bundle:**

```bash
cd my-project/
ff-cli agent-bundle create analytics-service
# Creates apps/analytics-service/ from template
```

**Agent bundle with custom configuration:**

```bash
ff-cli agent-bundle create api-gateway \
  --description "API gateway for external integrations" \
  --port 8080
# Creates apps/api-gateway/ listening on port 8080
```

**Agent bundle from example:**

```bash
ff-cli agent-bundle create demo-bot --from-example haiku-service
# Fetches haiku-service example from npm
# Installs to apps/demo-bot/
```

### `ff-cli agent-bundle add` Command

The `add` command is an **alias** for `create` and behaves identically. It exists for semantic clarity when adding bundles to existing projects.

```bash
# These are equivalent:
ff-cli agent-bundle create my-service
ff-cli agent-bundle add my-service
```

#### Adding Existing Bundles

To add pre-built bundles or examples:

```bash
cd my-project/

# Add an example bundle
ff-cli agent-bundle add data-processor --from-example data-pipeline

# Add multiple bundles
ff-cli agent-bundle add service-a
ff-cli agent-bundle add service-b --port 3001
ff-cli agent-bundle add service-c --from-example workflow-engine
```

## Adding a Web UI

### `ff-cli gui add` Command

#### Purpose

Add a Next.js web UI application to an existing FireFoundry project. The web UI is created in the `apps/` directory alongside agent bundles, with its own Helm chart and Dockerfile for Kubernetes deployment.

#### Usage

```bash
cd my-project/
ff-cli gui add <name> [OPTIONS]
```

#### Prerequisites

- Must be run from **within a FireFoundry project** (directory with `pnpm-workspace.yaml`)

#### Options and Flags

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose, -v` | Enable verbose logging | false |

#### What It Generates

```
apps/<name>/
├── src/                    # Next.js application source
├── public/                 # Static assets
├── Dockerfile              # Production container build
├── package.json            # Dependencies and scripts
├── next.config.js          # Next.js configuration
├── tsconfig.json           # TypeScript configuration
└── helm/
    ├── Chart.yaml          # Helm chart metadata
    ├── values.yaml         # Base Helm values
    ├── values.local.yaml   # Local minikube overrides
    └── templates/          # Kubernetes manifests
```

#### Examples

**Add a web UI to an existing project:**

```bash
cd my-project/
ff-cli gui add dashboard --verbose
# Creates apps/dashboard/ with Next.js scaffold, Helm chart, and Dockerfile
```

**Create a project with a web UI from the start:**

```bash
ff-cli project create my-project --with-web-ui my-ui
# Creates project with apps/my-ui/ web UI included
```

**Full-stack project with agent bundle and web UI:**

```bash
ff-cli project create my-app --agent-name api-service --with-web-ui frontend
# Creates apps/api-service/ (agent bundle) and apps/frontend/ (web UI)
```

#### pnpm Monorepo Considerations

When deploying a Next.js web UI in a pnpm monorepo to Kubernetes, two configuration items are important:

- **`outputFileTracingRoot`** in `next.config.js` - Must point to the monorepo root so Next.js standalone output includes workspace dependencies
- **`shamefully-hoist=true`** in `.npmrc` - Some Next.js dependencies require hoisted `node_modules` to resolve correctly in container builds

See [ff-cli-go#43](https://github.com/user/ff-cli-go/issues/43) for details on these requirements.

#### Deployment

Web UIs are deployed the same way as agent bundles using `ops deploy`:

```bash
ff-cli ops deploy dashboard -y --namespace ff-test
```

---

## Using Examples

### `ff-cli examples` Command

The `examples` command helps you discover available agent bundles from the FireFoundry examples package.

#### Prerequisites

Set `GITHUB_TOKEN` environment variable with a GitHub personal access token that has `read:packages` scope:

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

Generate tokens at: https://github.com/settings/tokens

#### Listing Examples

```bash
ff-cli examples list
```

Output:
```
Available FireFoundry Agent Bundle Examples
══════════════════════════════════════════════════════════════════════════════

Name                 Display Name              Category        Description
────────────────────────────────────────────────────────────────────────────
haiku-service        Haiku Service             examples        Simple haiku generation bot
data-pipeline        Data Pipeline             workflows       ETL workflow example
analytics-bot        Analytics Bot             integrations    Data analytics agent
```

#### Viewing Example Details

```bash
ff-cli examples info haiku-service
```

Output:
```
Example: haiku-service
══════════════════════════════════════════════════════════════════════════════

Display Name: Haiku Service
Description:  Simple haiku generation bot demonstrating basic LLM integration
Category:     examples
Port:         3000
Public:       Yes

Features:
  • Basic LLM bot integration
  • Custom API endpoints
  • Entity state management

Entities:
  • HaikuEntity - Manages haiku generation state

Bots:
  • HaikuBot - Generates haikus using LLM

Usage:
  ff-cli project create my-project --with-example haiku-service
  # or
  ff-cli agent-bundle create my-bot --from-example haiku-service
```

#### Fetching Examples

Examples are fetched automatically when using:

- `ff-cli project create --with-example <name>`
- `ff-cli agent-bundle create --from-example <name>`

You don't need to manually download examples.

#### Examples

**Discover available examples:**

```bash
ff-cli examples list
# Shows all examples with descriptions
```

**Get details about an example:**

```bash
ff-cli examples info analytics-bot
# Shows entities, bots, features, and usage
```

**Create project with example:**

```bash
# 1. Find an example
ff-cli examples list

# 2. Create project with that example
ff-cli project create my-project --with-example haiku-service
```

**Add example to existing project:**

```bash
# 1. Check example details
ff-cli examples info data-pipeline

# 2. Add to project
cd my-project/
ff-cli agent-bundle add pipeline --from-example data-pipeline
```

## Project Structure

### Monorepo Organization

FireFoundry projects follow this structure:

```
my-project/                           # Project root
├── apps/                            # Agent bundles and web UIs (workspaces)
│   ├── service-a/                  # Agent bundle
│   │   ├── src/
│   │   ├── helm/                  # Helm chart directory
│   │   │   ├── Chart.yaml
│   │   │   ├── values.yaml        # Base values (cloud defaults)
│   │   │   ├── values.local.yaml  # Local minikube overrides
│   │   │   ├── secrets.yaml.template
│   │   │   └── templates/
│   │   ├── package.json           # Workspace package
│   │   └── Dockerfile             # Service container
│   └── service-b/                  # Another agent bundle
├── packages/                        # Shared packages (workspaces)
│   ├── shared-types/              # Shared TypeScript types
│   └── utils/                     # Shared utilities
├── docs/                           # Documentation
├── scripts/                        # Build scripts
├── package.json                   # Root package (workspaces defined)
├── pnpm-workspace.yaml            # Workspace configuration
└── turbo.json                     # Build orchestration
```

> **Note:** Web UI apps created with `ff-cli gui add` are placed in `apps/`, not `packages/`. They are full workspace members alongside agent bundles.

### Bundle Organization

Each agent bundle contains:

```
apps/my-service/
├── src/
│   ├── entities/                  # Domain entities
│   │   ├── MyEntity.ts
│   │   └── index.ts
│   ├── bots/                      # LLM orchestration
│   │   ├── MyBot.ts
│   │   └── index.ts
│   ├── prompts/                   # Prompt templates
│   │   ├── myPrompt.ts
│   │   └── index.ts
│   ├── agent-bundle.ts           # Main bundle class
│   ├── constructors.ts           # Entity registry
│   └── index.ts                  # Server entry
├── helm/                          # Helm chart for deployment
│   ├── Chart.yaml                # Chart metadata
│   ├── values.yaml               # Base values (cloud defaults)
│   ├── values.local.yaml         # Local minikube overrides
│   ├── secrets.yaml.template     # Secrets template
│   └── templates/                # Kubernetes manifests
├── package.json
├── tsconfig.json
├── Dockerfile
├── firefoundry.json              # FireFoundry metadata
└── README.md
```

### Recommended Layout

**For small projects (1-3 services):**
```
my-project/
├── apps/
│   ├── main-service/             # Primary agent bundle
│   └── worker-service/           # Background worker
└── package.json
```

**For medium projects (4-10 services):**
```
my-project/
├── apps/
│   ├── api-gateway/              # External API
│   ├── analytics/                # Analytics service
│   ├── reporting/                # Report generation
│   └── scheduler/                # Background jobs
├── packages/
│   ├── shared-types/             # Common types
│   └── utils/                    # Shared utilities
└── package.json
```

**For large projects (10+ services):**
```
my-project/
├── apps/
│   ├── api/                      # API services
│   │   ├── gateway/
│   │   └── auth/
│   ├── workers/                  # Background workers
│   │   ├── scheduler/
│   │   └── processor/
│   └── analytics/                # Analytics services
│       ├── ingestion/
│       └── reporting/
├── packages/
│   ├── shared-types/
│   ├── sdk/                      # Internal SDK
│   └── testing/                  # Test utilities
└── package.json
```

## Development Workflow

### Initial Setup

Complete walkthrough from project creation to running service:

```bash
# 1. Create project with example
ff-cli project create my-ai-app --with-example haiku-service

# 2. Enter project directory
cd my-ai-app

# 3. Install dependencies (if not auto-installed)
pnpm install

# 4. Review generated structure
ls -la apps/haiku-service/

# 5. Set environment variables
export GITHUB_TOKEN="your_token"
export PG_SERVER="localhost"
export PG_DATABASE="firefoundry"
export PG_PASSWORD="your_password"
export PG_INSERT_PASSWORD="your_password"
export LLM_BROKER_HOST="localhost"
export LLM_BROKER_PORT="8080"

# 6. Start development environment
pnpm run dev

# Or use Docker Compose
docker-compose up
```

### Adding More Bundles

Growing the monorepo with additional services:

```bash
# Add a custom service
ff-cli agent-bundle create analytics-service \
  --description "Analytics and reporting" \
  --port 3001

# Review what was created
ls -la apps/analytics-service/

# Add entities and bots
cd apps/analytics-service/src/entities/
# Create your entities here

# Run all services
cd ../../..
pnpm run dev
```

### Using Examples as Templates

Starting from example bundles and customizing:

```bash
# 1. Create bundle from example
ff-cli agent-bundle create my-service --from-example data-pipeline

# 2. Review example structure
cd apps/my-service/
cat README.md
ls -la src/

# 3. Customize for your needs
# - Modify src/entities/ - Add your domain entities
# - Modify src/bots/ - Adjust LLM orchestration
# - Update src/constructors.ts - Register new classes
# - Update package.json - Add dependencies

# 4. Test your changes
pnpm run dev
```

## Configuration

### Project Configuration

**Root package.json** - Configure workspace scripts:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rm -rf node_modules .turbo"
  }
}
```

**turbo.json** - Configure build pipeline:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    }
  }
}
```

### Bundle Configuration

**package.json** - Configure bundle scripts and dependencies:

```json
{
  "name": "@apps/my-service",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^2.0.0",
    "zod": "^3.22.4"
  }
}
```

**firefoundry.json** - Configure FireFoundry metadata:

```json
{
  "name": "my-service",
  "port": 3000,
  "health": {
    "endpoint": "/health",
    "interval": 30
  },
  "resources": {
    "requests": { "memory": "256Mi", "cpu": "100m" },
    "limits": { "memory": "512Mi", "cpu": "500m" }
  }
}
```

## Build and Deploy

### Building Bundles

Use `ff-cli ops build` with scaffolded bundles:

```bash
cd my-project/

# Build a specific bundle
ff-cli ops build my-service --tag 1.0.0

# Build with profile
ff-cli profile select gcp-dev
ff-cli ops build my-service --tag 1.0.0
# Automatically pushes to registry configured in profile
```

See [ops.md](ops.md) for complete build documentation.

### Deploying to Environments

The recommended way to build and deploy in one step is `ff-cli ops deploy`:

```bash
# Build and deploy locally (single command)
ff-cli ops deploy my-service -y

# Deploy with explicit values file variant
ff-cli ops deploy my-service -y --values local

# Deploy to specific namespace
ff-cli ops deploy my-service -y --namespace ff-test
```

Or use separate install/upgrade commands:

```bash
# Fresh install to Kubernetes
ff-cli ops install my-service --namespace ff-test

# Upgrade existing deployment
ff-cli ops upgrade my-service --namespace ff-test

# Upgrade without restarting pods
ff-cli ops upgrade my-service --no-restart
```

Each scaffolded bundle includes (under `helm/`):
- **values.yaml** - Base Helm values (cloud defaults)
- **values.local.yaml** - Local minikube overrides (`pullPolicy: Never`)
- **secrets.yaml.template** - Template for secrets
- **Dockerfile** - Production build configuration (at app root)

### Values Files

Values files live in the `helm/` subdirectory of each agent bundle and follow a naming convention:

| File | Purpose |
|------|---------|
| `helm/values.yaml` | Base values with cloud defaults. Always applied first when present. |
| `helm/values.local.yaml` | Local minikube overrides (e.g., `pullPolicy: Never`). Generated by default. |
| `helm/values.dev.yaml` | Dev cloud environment overrides. Create manually as needed. |
| `helm/values.<name>.yaml` | Any custom environment variant (e.g., `values.staging.yaml`). |
| `helm/secrets.yaml.template` | Template for secrets — copy to `secrets.yaml` and fill in values. |

The `--values` flag on `ops deploy`, `ops install`, and `ops upgrade` selects which variant to use:

```bash
# Uses helm/values.local.yaml (default for minikube profiles)
ff-cli ops deploy my-service -y --values local

# Uses helm/values.dev.yaml
ff-cli ops deploy my-service -y --values dev
```

When a base `helm/values.yaml` exists, it is chained automatically: the CLI applies `-f values.yaml -f values.<name>.yaml`, so the variant file only needs to contain overrides.

If `--values` is not specified, the CLI auto-detects the variant from the active profile's registry type (e.g., minikube profiles default to `local`).

## Best Practices

### Project Organization

**Use descriptive names:**
```bash
# Good
ff-cli agent-bundle create customer-analytics
ff-cli agent-bundle create order-processing

# Avoid
ff-cli agent-bundle create service1
ff-cli agent-bundle create app
```

**Group related bundles:**
```
apps/
├── ingestion-pipeline/       # Data ingestion
├── analytics-engine/         # Analysis
└── reporting-service/        # Reporting
```

**Share code via packages:**
```
packages/
├── shared-types/            # TypeScript types
├── common-entities/         # Reusable entities
└── testing-utils/           # Test helpers
```

### Naming Conventions

**Project names:** Use kebab-case
```bash
ff-cli project create my-ai-platform
ff-cli project create customer-analytics-suite
```

**Agent bundle names:** Use kebab-case, descriptive
```bash
ff-cli agent-bundle create order-processing
ff-cli agent-bundle create customer-engagement-bot
ff-cli agent-bundle create data-pipeline-worker
```

**Example usage:** Match example name when creating
```bash
# Example name: haiku-service
ff-cli agent-bundle create haiku --from-example haiku-service
# Creates apps/haiku/ with haiku-service content
```

### Repository Structure

**Initialize git after project creation:**

```bash
ff-cli project create my-project
cd my-project
git init
git add .
git commit -m "Initial commit from ff-cli scaffolding"
```

**Use .gitignore from template:**

The generated `.gitignore` includes:
```
node_modules/
dist/
.turbo/
*.log
.env
.env.local
secrets.yaml
```

**Monorepo branching strategies:**

```bash
# Feature branch per service
git checkout -b feature/analytics-service

# Shared changes
git checkout -b feature/shared-types-update
```

## Troubleshooting

### Project Creation Issues

**Problem:** `GITHUB_TOKEN` not set when using examples

```bash
Error: GITHUB_TOKEN environment variable is required to access FireFoundry examples.
```

**Solution:**
```bash
export GITHUB_TOKEN="ghp_your_token_here"
ff-cli project create my-project --with-example haiku-service
```

**Problem:** Directory already exists

```bash
Error: Directory already exists: /path/to/my-project
```

**Solution:** Choose a different name or remove existing directory:
```bash
ff-cli project create my-project-v2
# or
rm -rf my-project
ff-cli project create my-project
```

### Agent Bundle Creation Issues

**Problem:** Not in a FireFoundry project

```bash
Error: Not in a FireFoundry workspace. Run this command from a project root.
```

**Solution:** Ensure you're in a project directory:
```bash
cd my-project/  # Must have pnpm-workspace.yaml
ff-cli agent-bundle create my-service
```

**Problem:** Bundle already exists

```bash
Error: Directory already exists: apps/my-service
```

**Solution:** Choose different name or remove existing bundle:
```bash
ff-cli agent-bundle create my-service-v2
# or
rm -rf apps/my-service
ff-cli agent-bundle create my-service
```

### Example Issues

**Problem:** Example not found

```bash
Error: Example 'invalid-name' not found. Available examples: haiku-service, data-pipeline, analytics-bot
```

**Solution:** List available examples first:
```bash
ff-cli examples list
ff-cli agent-bundle create my-bot --from-example haiku-service
```

**Problem:** Network error fetching examples

```bash
Error: Failed to download examples package: connection refused
```

**Solution:** Check network and GitHub token:
```bash
# Verify token is valid
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://npm.pkg.github.com/@firebrandanalytics/ff-agent-bundle-examples

# Retry with verbose logging
ff-cli agent-bundle create my-bot --from-example haiku-service --verbose
```

### Build and Development Issues

**Problem:** Dependencies not installed

```bash
Error: Cannot find module '@firebrandanalytics/ff-agent-sdk'
```

**Solution:** Install dependencies:
```bash
cd my-project/
pnpm install
```

**Problem:** Port already in use

```bash
Error: Port 3000 already in use
```

**Solution:** Change port or stop conflicting service:
```bash
# Change port in bundle
ff-cli agent-bundle create my-service --port 3001

# Or update existing bundle's package.json
cd apps/my-service/
# Edit package.json: "start": "PORT=3001 node dist/index.js"
```

## Related Commands

- **[ff-cli ops build](ops.md#build-command)** - Build Docker images for scaffolded bundles
- **[ff-cli ops install](ops.md#install-command)** - Deploy bundles to Kubernetes
- **[ff-cli profile](profiles.md)** - Manage registry profiles for builds

## See Also

- **[Agent SDK Core Documentation](../sdk/agent_sdk/core/README.md)** - Learn about `FFAgentBundle` and entity patterns
- **[Agent Bundle Tutorial](../sdk/agent_sdk/core/agent_bundle_tutorial.md)** - Step-by-step guide to building agent bundles
- **[Local Development Guide](../ff_local_dev.md)** - Setting up local FireFoundry environment
- **[Operations Commands](ops.md)** - Build and deployment workflows
