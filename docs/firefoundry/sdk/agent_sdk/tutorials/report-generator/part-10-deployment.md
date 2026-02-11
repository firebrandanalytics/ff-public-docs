# Part 10: Deployment & Testing

In this final part, you'll configure your agent bundle for production deployment and run a complete end-to-end test. You'll set up the Docker multi-stage build, configure Helm values and environment variables, deploy with `ff ops`, and then verify every stage of the pipeline using FireFoundry's diagnostic tools.

**What you'll learn:**
- Configuring a Dockerfile with turbo prune and multi-stage builds
- Setting up Helm values for Kubernetes deployment
- Configuring environment variables for FireFoundry services
- Deploying with `ff ops build` and `ff ops deploy`
- Running a complete end-to-end test from entity creation to final PDF
- Using `ff-eg-read`, `ff-wm-read`, and `ff-telemetry-read` for diagnostics

**What you'll build:** A production-ready deployment of the report generator, verified end-to-end.

## Step 1: Configure the Dockerfile

The Dockerfile uses a three-stage build optimized for monorepo projects:

1. **Pruner** -- Uses `turbo prune` to extract only the packages needed by `report-bundle`
2. **Builder** -- Installs dependencies and builds the pruned workspace
3. **Runtime** -- Minimal image with only the built artifacts

**`apps/report-bundle/Dockerfile`**:

```dockerfile
# Stage 1: Pruner
# Use turbo prune to create a minimal production-ready monorepo
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN npm install -g turbo
WORKDIR /app
COPY . .
RUN turbo prune --scope=@apps/report-bundle --docker
```

The pruner stage copies the entire monorepo, then runs `turbo prune --scope=@apps/report-bundle --docker`. This produces an `out/` directory with:
- `out/json/` -- only the `package.json` files for the target app and its workspace dependencies
- `out/pnpm-lock.yaml` -- a pruned lockfile
- `out/full/` -- only the source code for the relevant packages

```dockerfile
# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy the pruned files and lockfile
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Install ALL dependencies (including devDependencies for build)
ARG FF_NPM_TOKEN
ARG GITHUB_TOKEN
RUN echo "@firebrandanalytics:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${FF_NPM_TOKEN:-${GITHUB_TOKEN}}" >> .npmrc
RUN pnpm install

# Copy the pruned source code
COPY --from=pruner /app/out/full/ .

# Build the application
RUN pnpm run build --filter=@apps/report-bundle
```

The builder stage copies the pruned `package.json` files first (for better Docker layer caching), installs dependencies, then copies source code and builds. The `.npmrc` is overwritten (not appended) to ensure the auth token resolves correctly in Docker.

The `ARG FF_NPM_TOKEN` and `ARG GITHUB_TOKEN` build args provide authentication for the `@firebrandanalytics` GitHub Packages registry. `ff ops build` passes these automatically.

```dockerfile
# Stage 3: Runtime
FROM node:20-alpine
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy the built app from the builder
COPY --from=builder --chown=nodejs:nodejs /app/ .

USER nodejs

# Expose port and set health check
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["node", "apps/report-bundle/dist/index.js"]
```

The runtime stage runs as a non-root user and includes a health check that the Kubernetes readiness probe will use.

### Why Turbo Prune?

In a monorepo, a naive `COPY . .` would include every package, every GUI app, and every unrelated dependency. `turbo prune` creates a minimal workspace containing only:

- `@apps/report-bundle` (your agent bundle)
- `@shared/types` (workspace dependency)
- Their transitive dependencies

This dramatically reduces the Docker image size and build time.

## Step 2: Configure firefoundry.json

The `firefoundry.json` file tells `ff ops` how to build and deploy your agent bundle.

**`apps/report-bundle/firefoundry.json`**:

```json
{
  "name": "report-bundle",
  "version": "1.0.0",
  "description": "report-bundle agent bundle",
  "type": "agent-bundle",
  "runtime": "node",
  "entry": "dist/index.js",
  "port": 3000,
  "health": {
    "endpoint": "/health",
    "interval": 30,
    "timeout": 3
  },
  "readiness": {
    "endpoint": "/ready",
    "initialDelay": 5
  },
  "resources": {
    "requests": {
      "memory": "256Mi",
      "cpu": "100m"
    },
    "limits": {
      "memory": "512Mi",
      "cpu": "500m"
    }
  },
  "environment": {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info"
  }
}
```

Key fields:
- **`type: "agent-bundle"`** tells `ff ops` to use the agent bundle Helm chart
- **`port: 3000`** is the container port your server listens on
- **`health` and `readiness`** configure Kubernetes probes
- **`resources`** set CPU and memory requests/limits

## Step 3: Configure Helm Values

The Helm values file configures environment variables and deployment settings for your target cluster.

**`apps/report-bundle/helm/values.local.yaml`** (for development):

```yaml
global:
  environment: ff-dev
  authentication:
    required: false
    exempt: false
    aclGroups:
    - agents
  gateway:
    externalAccess: true

image:
  repository: firebranddevet.azurecr.io/report-bundle
  tag: latest
  pullPolicy: Always

serviceAccount:
  create: false
  name: default

bundleName: report-bundle

configMap:
  enabled: true
  data:
    PORT: '3001'
    NODE_ENV: development
    CONSOLE_LOG_LEVEL: debug

    # LLM Broker connection
    LLM_BROKER_HOST: firefoundry-core-ff-broker.ff-dev.svc.cluster.local
    LLM_BROKER_PORT: '50052'

    # Context service (working memory / file storage)
    CONTEXT_SERVICE_ADDRESS: http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051

    # Document processing service
    DOC_PROC_SERVICE_URL: http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:8081

    # Database
    PG_SERVER: firebrand-ai4bi-pg
    PG_DATABASE: ff_int_dev
    PG_PORT: '5432'
```

### Environment Variables Explained

| Variable | Purpose | Example |
|----------|---------|---------|
| `LLM_BROKER_HOST` | gRPC host for the LLM broker service | `firefoundry-core-ff-broker.ff-dev.svc.cluster.local` |
| `LLM_BROKER_PORT` | gRPC port for the LLM broker service | `50052` |
| `CONTEXT_SERVICE_ADDRESS` | HTTP address for the context service (working memory) | `http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051` |
| `DOC_PROC_SERVICE_URL` | HTTP address for the document processing service | `http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:8081` |
| `PG_SERVER` | PostgreSQL server hostname | `firebrand-ai4bi-pg` |
| `PG_DATABASE` | PostgreSQL database name | `ff_int_dev` |
| `PG_PORT` | PostgreSQL port | `5432` |

### Secrets Configuration

Sensitive values go in a separate secrets file that is not checked into source control.

**`apps/report-bundle/secrets.yaml`** (from `secrets.yaml.template`):

```yaml
secret:
  enabled: true
  data:
    PG_PASSWORD: "your-postgres-password"
    PG_INSERT_PASSWORD: "your-postgres-insert-password"
```

Copy the template and fill in real values:

```bash
cp apps/report-bundle/secrets.yaml.template apps/report-bundle/secrets.yaml
# Edit secrets.yaml with your actual credentials
```

The secrets file is referenced by `.gitignore` and should never be committed.

## Step 4: Build the Docker Image

Use `ff ops build` to build the Docker image and push it to your container registry:

```bash
ff ops build --app-name report-bundle
```

This command:
1. Reads `firefoundry.json` for build configuration
2. Runs `docker build` with the Dockerfile from the app directory
3. Passes `FF_NPM_TOKEN` and `GITHUB_TOKEN` as build args for npm authentication
4. Tags the image with the registry from `values.local.yaml`
5. Pushes the image to the container registry

If you are building on an ARM machine (like Apple Silicon) for an AMD64 Kubernetes cluster, ensure QEMU and buildx are configured:

```bash
# One-time setup (does not survive reboots)
docker run --privileged --rm tonistiigi/binfmt --install amd64
docker buildx rm multiarch 2>/dev/null
docker buildx create --name multiarch --driver docker-container --use
```

## Step 5: Deploy to the Cluster

```bash
ff ops deploy --app-name report-bundle
```

This command:
1. Reads Helm values from `values.local.yaml` and `secrets.yaml`
2. Deploys or upgrades the Helm release in the configured namespace
3. Waits for the pod to become ready (health check passes)

### Verify the Deployment

```bash
# Check pod status
kubectl get pods -l app=report-bundle -n ff-dev

# Check logs
kubectl logs -l app=report-bundle -n ff-dev --tail=50

# Port-forward for local testing
kubectl port-forward svc/report-bundle 3001:3001 -n ff-dev
```

## Step 6: End-to-End Test Walkthrough

With the bundle deployed and port-forwarded, run through the complete workflow.

### 6.1: Health Check

```bash
ff-sdk-cli health --url http://localhost:3001
```

Expected output:

```json
{ "healthy": true }
```

Also check the bundle info:

```bash
ff-sdk-cli info --url http://localhost:3001
```

```json
{
  "app_name": "ReportGenerator",
  "app_id": "1ba3a4a6-4df4-49b5-9291-c0bacfe46201",
  "description": "Document-to-report generation service"
}
```

### 6.2: Create a Report Entity

```bash
ff-sdk-cli api call create-report \
  --method POST \
  --body '{"prompt": "Create an executive summary highlighting key metrics and trends", "orientation": "portrait"}' \
  --url http://localhost:3001
```

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Save the entity ID for subsequent commands:

```bash
export ENTITY_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 6.3: Upload a Document

Upload a document to start the workflow:

```bash
ff-sdk-cli iterator start-blob $ENTITY_ID \
  --method process_document_stream \
  --file ./sample-financial-report.pdf \
  --url http://localhost:3001
```

This calls `ReportReviewWorkflowEntity.process_document_stream()`, which stores the document in working memory and starts the review workflow.

### 6.4: Poll for Progress

```bash
ff-sdk-cli iterator next $ENTITY_ID --url http://localhost:3001
```

Run this repeatedly. You will see events in this order:

```
STATUS     -> { status: "STARTED" }
INTERNAL_UPDATE -> { message: "Starting report generation workflow", stage: "workflow_start" }
INTERNAL_UPDATE -> { message: "Stage 1/3: Extracting text from document", stage: "text_extraction" }
INTERNAL_UPDATE -> { message: "Text extraction complete (15234 characters)", stage: "text_extraction_complete" }
INTERNAL_UPDATE -> { message: "Stage 2/3: Generating HTML report with AI", stage: "ai_generation" }
BOT_PROGRESS   -> { ... }  (LLM streaming tokens)
INTERNAL_UPDATE -> { message: "HTML generation complete (8921 characters)", stage: "ai_generation_complete" }
INTERNAL_UPDATE -> { message: "Stage 3/3: Converting HTML to PDF", stage: "pdf_conversion" }
INTERNAL_UPDATE -> { message: "Report generation complete", stage: "workflow_complete" }
WAITING    -> { message: "Please review the result and either approve or provide feedback." }
```

The `WAITING` event means the ReviewStep has paused for your input. Note the ReviewStep entity ID from the event metadata.

### 6.5: Approve the Review

```bash
ff-sdk-cli invoke <review-step-id> \
  --method sendMessage \
  --args '["approved", true]' \
  --url http://localhost:3001
```

### 6.6: Get the Final Result

```bash
ff-sdk-cli iterator next $ENTITY_ID --url http://localhost:3001
```

```
VALUE -> {
  "resultEntityId": null,
  "finalVersion": 0,
  "success": true,
  "finalResult": {
    "pdf_working_memory_id": "wm-abc123-...",
    "reasoning": "I structured the report with...",
    "html_content": "<!DOCTYPE html>..."
  }
}
STATUS -> { status: "COMPLETED" }
```

The `pdf_working_memory_id` is the key to download the generated PDF from working memory.

## Step 7: Verify with Diagnostic Tools

### 7.1: Inspect the Entity Graph with ff-eg-read

Verify the entity hierarchy was created correctly:

```bash
# Get the workflow entity
ff-eg-read node get $ENTITY_ID \
  --mode=internal \
  --gateway=http://localhost \
  --internal-port=8180
```

This shows the entity's data, status, and metadata. Check that:
- `status` is `Completed`
- `data.wrappedEntityArgs.original_document_wm_id` is set
- `data.currentVersion` reflects the number of review iterations

List child entities (the wrapped entity and review steps):

```bash
# Get outgoing edges from the workflow entity
ff-eg-read edges from $ENTITY_ID \
  --mode=internal \
  --gateway=http://localhost \
  --internal-port=8180
```

You should see `Calls` edges to:
- `wrapped_0` (ReportEntity) -- the main workflow orchestrator
- `review_0` (ReviewStep) -- the review step

If you rejected and revised, you will also see `wrapped_1`, `review_1`, etc.

Drill into the ReportEntity to see its children:

```bash
ff-eg-read edges from <wrapped-0-id> \
  --mode=internal \
  --gateway=http://localhost \
  --internal-port=8180
```

This shows the `Calls` edge to `ReportGenerationEntity` (the AI generation step).

### 7.2: Verify Stored Documents with ff-wm-read

Check that the original document, extracted text, and final PDF were stored in working memory:

```bash
# List working memory records for the workflow entity
ff-wm-read list --entity-id $ENTITY_ID \
  --gateway=http://localhost \
  --internal-port=8180
```

You should see:
- The original uploaded document (`stage: original_upload`)
- The extracted text file (`stage: text_extraction`) on the wrapped ReportEntity

```bash
# List working memory records for the ReportEntity (wrapped_0)
ff-wm-read list --entity-id <wrapped-0-id> \
  --gateway=http://localhost \
  --internal-port=8180
```

You should see:
- The extracted text (`stage: text_extraction`)
- The final PDF (`stage: final_pdf`)

Download the generated PDF to verify it:

```bash
ff-wm-read download <pdf-working-memory-id> \
  --output ./generated-report.pdf \
  --gateway=http://localhost \
  --internal-port=8180
```

Open `generated-report.pdf` to confirm the report was generated correctly with the expected content, formatting, and orientation.

### 7.3: Trace LLM Calls with ff-telemetry-read

Verify that the LLM broker was called correctly:

```bash
# List recent telemetry events for this entity
ff-telemetry-read traces --entity-id $ENTITY_ID \
  --gateway=http://localhost \
  --internal-port=8180
```

Check:
- The model pool used (`firebrand_completion_default`)
- Token counts (input and output)
- Latency of the LLM call
- Whether structured output validation succeeded

If you ran a revision cycle, you should see multiple LLM calls -- one per iteration. The second call's prompt should include the feedback section injected by `FeedbackBotMixin`.

```bash
# Get detailed trace for a specific call
ff-telemetry-read trace <trace-id> \
  --gateway=http://localhost \
  --internal-port=8180
```

This shows the full prompt that was sent to the LLM, which is invaluable for debugging prompt issues.

## Step 8: Troubleshooting Common Issues

### Bundle fails to start

**Symptom:** Pod crashes or health check fails.

```bash
kubectl logs -l app=report-bundle -n ff-dev --tail=100
```

Common causes:
- **Missing environment variables** -- Check that `LLM_BROKER_HOST`, `CONTEXT_SERVICE_ADDRESS`, and database variables are set in `values.local.yaml`.
- **Database connection failed** -- Verify `PG_SERVER`, `PG_DATABASE`, `PG_PASSWORD` are correct. The entity graph requires a working PostgreSQL connection.
- **Port conflict** -- Ensure `PORT` in the configMap matches what the service expects (default: `3001` for development, `3000` in the Dockerfile).

### Document upload fails

**Symptom:** Error during `iterator start-blob`.

Common causes:
- **Context service unreachable** -- Verify `CONTEXT_SERVICE_ADDRESS` points to a running context service. Test with: `curl http://firefoundry-core-context-service.ff-dev.svc.cluster.local:50051/health`
- **File too large** -- Default blob upload limit is 50MB. Check the file size.
- **Wrong entity type** -- Ensure you are uploading to the `ReportReviewWorkflowEntity`, not the inner `ReportEntity`.

### Text extraction fails

**Symptom:** Stage 1 error in progress events.

Common causes:
- **Doc-proc service unreachable** -- Verify `DOC_PROC_SERVICE_URL`. Test with: `curl http://firefoundry-core-doc-proc-service.ff-dev.svc.cluster.local:8081/health`
- **Unsupported file format** -- The doc-proc service supports PDF, Word, Excel, text, and HTML. Other formats will fail.

### HTML generation fails or returns invalid output

**Symptom:** Stage 2 error or Zod validation failure.

Common causes:
- **Broker connection failed** -- Verify `LLM_BROKER_HOST` and `LLM_BROKER_PORT`. The broker uses gRPC, so standard HTTP health checks will not work.
- **Model pool not found** -- Ensure the `firebrand_completion_default` model pool is configured in the broker.
- **Structured output validation** -- If the LLM returns JSON that does not match the Zod schema, the `StructuredOutputBotMixin` will retry. Check telemetry for retry attempts.

### ReviewStep hangs indefinitely

**Symptom:** Workflow stays in WAITING state.

This is expected behavior -- the ReviewStep is waiting for human input. You must explicitly approve or provide feedback:

```bash
ff-sdk-cli invoke <review-step-id> \
  --method sendMessage \
  --args '["approved", true]' \
  --url http://localhost:3001
```

If you have lost the ReviewStep entity ID, find it via the entity graph:

```bash
ff-eg-read edges from $ENTITY_ID \
  --mode=internal \
  --gateway=http://localhost \
  --internal-port=8180
```

Look for the `ReviewStep` child entity.

### PDF conversion fails

**Symptom:** Stage 3 error.

Common causes:
- **Doc-proc service HTML-to-PDF endpoint** -- The HTML-to-PDF conversion requires a headless browser in the doc-proc service. Verify the service is fully operational (not just the health endpoint).
- **Invalid HTML** -- If the LLM generated malformed HTML, the conversion may fail. Check the `html_content` in the entity data.

## What You've Built

Congratulations -- you have built and deployed a complete document-to-report generation pipeline. Here is the full architecture:

```
Client
  |
  |-- POST /api/create-report  -->  ReportReviewWorkflowEntity (created)
  |
  |-- iterator start-blob      -->  process_document_stream()
  |     |-- Stores document in Working Memory
  |     |-- Starts ReviewableEntity loop
  |           |
  |           |-- ReportEntity (wrapped_0)
  |           |     |-- Stage 1: doc-proc extract text
  |           |     |-- Stage 2: ReportGenerationEntity
  |           |     |     |-- ReportGenerationBot + FeedbackBotMixin
  |           |     |     |-- StructuredOutputBotMixin (Zod validation)
  |           |     |     |-- ReportGenerationPrompt (conditional layout)
  |           |     |-- Stage 3: doc-proc HTML -> PDF
  |           |     |-- Stores PDF in Working Memory
  |           |
  |           |-- ReviewStep (review_0)
  |           |     |-- Waits for human input
  |           |     |-- approve -> complete
  |           |     |-- feedback -> increment version, re-run
  |           |
  |           |-- (Optional: wrapped_1, review_1, ...)
  |
  |-- GET /api/report-status   -->  Entity status and data
  |
  |-- ff-wm-read download      -->  Final PDF
```

Over this 10-part series, you have used:

| SDK Feature | Where Used |
|-------------|-----------|
| `RunnableEntity` | TextDocumentEntity, ReportEntity, ReportGenerationEntity |
| `@EntityMixin` | Every entity class |
| `MixinBot` / `ComposeMixins` | ReportGenerationBot |
| `StructuredOutputBotMixin` | Zod-validated HTML output |
| `FeedbackBotMixin` | Conditional feedback prompt injection |
| `FeedbackRunnableEntityMixin` | Auto-inject feedback into bot args |
| `ReviewableEntity` | ReportReviewWorkflowEntity review loop |
| `ReviewStep` | Built-in waitable review entity |
| `Prompt` / `PromptTemplateSectionNode` | ReportGenerationPrompt |
| `WorkingMemoryProvider` | Document and PDF storage |
| `DocProcClient` | Text extraction and PDF conversion |
| `@ApiEndpoint` | create-report and report-status endpoints |
| `appendOrRetrieveCall` | Idempotent child entity delegation |
| `yield*` streaming | Progress events from child entities |
| `FFAgentBundle` | Bundle class with constructor map |
| `createStandaloneAgentBundle` | HTTP server factory |

## Key Takeaways

1. **Turbo prune keeps Docker images lean** -- Only the packages your app depends on are included in the build context.
2. **Separate config from secrets** -- `values.local.yaml` for non-sensitive config, `secrets.yaml` for credentials. Never commit secrets.
3. **Three services to configure** -- LLM Broker (gRPC), Context Service (HTTP), and Doc-Proc Service (HTTP). All are specified via environment variables.
4. **ff ops handles the build/deploy pipeline** -- `ff ops build` builds and pushes the Docker image. `ff ops deploy` installs or upgrades the Helm release.
5. **Diagnostic tools verify every layer** -- `ff-eg-read` for entity graph structure, `ff-wm-read` for stored files, `ff-telemetry-read` for LLM call traces.
6. **The entity graph is your audit trail** -- Every entity, every edge, every version is preserved. You can reconstruct exactly what happened during any workflow run.

## Series Complete

You have completed the Document-to-Report Generator tutorial series. You now have the knowledge to build production-grade agent bundles with the FireFoundry Agent SDK.

### Where to Go From Here

- **[API Reference](../../api-reference/README.md)** -- Complete reference for all SDK classes and decorators
- **[Core Concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md)** -- Deeper dive into the Entity-Bot-Prompt architecture
- **[ff-demo-report-generator](https://github.com/firebrandanalytics/ff-demo-report-generator)** -- The complete source code for this tutorial
- **Build your own** -- Use `ff project create` and `ff agent-bundle create` to start a new project from scratch
