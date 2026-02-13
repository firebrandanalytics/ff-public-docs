# Part 5: Testing & Deployment

In this final part, you'll wire up your local environment to the FireFoundry cluster services, run the illustrated storybook pipeline end-to-end, verify every stage with diagnostic tools, and deploy to a Kubernetes cluster.

**What you'll learn:**
- Configuring environment variables for local development
- Port forwarding to cluster services
- Registering the application in the entity service
- Running and testing the full pipeline locally
- Verifying results with `ff-eg-read`, `ff-wm-read`, and `ff-telemetry-read`
- Deploying with `ff ops build` and `ff ops deploy`

**What you'll build:** A fully tested and deployed illustrated storybook generator, verified end-to-end.

## Step 1: Environment Setup

The agent bundle needs to connect to several FireFoundry platform services. Create a `.env` file in `apps/story-bundle/` with the following:

**`apps/story-bundle/.env`** (add to `.gitignore`):

```bash
PORT=3005

# Entity Service (SDK 4.x)
REMOTE_ENTITY_SERVICE_URL=http://localhost
REMOTE_ENTITY_SERVICE_PORT=8180
USE_REMOTE_ENTITY_CLIENT=true

# Database
PG_HOST=firebrand-ai4bi-pg.postgres.database.azure.com
PG_DATABASE=ff_int_dev_clone
PG_PORT=5432
PG_USER=fireread
PG_PASSWORD=fireread

# Broker (gRPC)
LLM_BROKER_HOST=localhost
LLM_BROKER_PORT=50052

# Context Service (working memory)
CONTEXT_SERVICE_ADDRESS=http://localhost:50051
CONTEXT_SERVICE_API_KEY=context-svc-api-key

# Doc Proc Service (HTML to PDF)
DOC_PROC_SERVICE_URL=http://localhost:8081

# Blob Storage (Azure)
BLOB_STORAGE_PROVIDER=azure
BLOB_STORAGE_ACCOUNT=firebrand
BLOB_STORAGE_KEY=<your-key>
BLOB_STORAGE_CONTAINER=image-gen

# App Identity
FF_APPLICATION_ID=e7a95bcc-7ef9-432e-9713-f040db078b14
FF_AGENT_BUNDLE_ID=3f78cd56-4ac4-4503-816d-01a0e61fd2cf
```

### What Each Group Does

| Group | Variables | Purpose |
|-------|-----------|---------|
| **Entity Service** | `REMOTE_ENTITY_SERVICE_URL`, `REMOTE_ENTITY_SERVICE_PORT`, `USE_REMOTE_ENTITY_CLIENT` | Connects the SDK's entity client to the entity service. The URL and port are separate because the SDK constructs the full address internally. `USE_REMOTE_ENTITY_CLIENT=true` tells the SDK to use HTTP calls rather than an in-process client. Without these three variables, the bundle crashes with `Unsupported protocol undefined:`. |
| **Database** | `PG_HOST`, `PG_DATABASE`, `PG_PORT`, `PG_USER`, `PG_PASSWORD` | Direct PostgreSQL connection for the entity graph. The entity service reads and writes entity nodes, edges, and metadata to this database. |
| **Broker** | `LLM_BROKER_HOST`, `LLM_BROKER_PORT` | gRPC connection to the LLM broker service. The broker routes completion and image generation requests to the appropriate model pools. The `ContentSafetyBot` and `StoryWriterBot` use it for text generation; the `ImageService` uses it for `generateImage()` calls. |
| **Context Service** | `CONTEXT_SERVICE_ADDRESS`, `CONTEXT_SERVICE_API_KEY` | HTTP connection to the context service, which provides working memory storage. The pipeline stores the final PDF and illustrated HTML here for retrieval. |
| **Doc Proc Service** | `DOC_PROC_SERVICE_URL` | HTTP connection to the document processing service. The pipeline uses its `htmlToPdf()` endpoint to convert the assembled HTML storybook into a downloadable PDF. |
| **Blob Storage** | `BLOB_STORAGE_PROVIDER`, `BLOB_STORAGE_ACCOUNT`, `BLOB_STORAGE_KEY`, `BLOB_STORAGE_CONTAINER` | Azure Blob Storage credentials for image retrieval. When the broker generates an image, it stores the result in blob storage. The `ImageService` uses these credentials to fetch the generated images and base64-encode them for inline embedding. |
| **App Identity** | `FF_APPLICATION_ID`, `FF_AGENT_BUNDLE_ID` | UUIDs that identify this application and bundle in the entity graph. These must match the values used in `agent-bundle.ts`. |

## Step 2: Port Forwarding

The environment variables above point to `localhost` because you will port-forward cluster services to your local machine. Set up the forwards to the `ff-dev` namespace:

```bash
kubectl port-forward svc/firefoundry-core-entity-service -n ff-dev 8180:8080 &
kubectl port-forward svc/firefoundry-core-ff-broker -n ff-dev 50052:50052 &
kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051 &
kubectl port-forward svc/firefoundry-core-doc-proc-service -n ff-dev 8081:3000 &
```

> **Gotcha:** The broker service name is `firefoundry-core-ff-broker`, not `firefoundry-core-broker`. The extra `ff-` prefix is a common source of "connection refused" errors. If your port forward fails to establish, double-check the service name with `kubectl get svc -n ff-dev | grep broker`.

### Persistent Port Forwarding with procman

The `kubectl port-forward` commands above die when the connection is interrupted, when your laptop sleeps, or when the pod restarts. For persistent port forwarding that auto-reconnects, use `procman`:

```bash
# Add all four forwards as managed processes
procman add entity-svc -- kubectl port-forward svc/firefoundry-core-entity-service -n ff-dev 8180:8080
procman add broker -- kubectl port-forward svc/firefoundry-core-ff-broker -n ff-dev 50052:50052
procman add context-svc -- kubectl port-forward svc/firefoundry-core-context-service -n ff-dev 50051:50051
procman add doc-proc -- kubectl port-forward svc/firefoundry-core-doc-proc-service -n ff-dev 8081:3000

# Start all
procman start --all

# Check status
procman status
```

`procman` runs the forwards as background daemons and restarts them automatically if they drop. This is strongly recommended over bare `kubectl port-forward` commands for any sustained development session.

## Step 3: Register the Application

Before starting the bundle for the first time, you must register the application UUID in the entity service. The SDK auto-registers the agent bundle component, but the parent application must already exist:

```bash
curl -s -X POST http://localhost:8180/api/applications \
  -H "Content-Type: application/json" \
  -d '{"id":"e7a95bcc-7ef9-432e-9713-f040db078b14","name":"IllustratedStory","description":"AI-powered illustrated storybook generator"}'
```

This is a one-time step. If the application already exists, the endpoint returns a conflict error that you can safely ignore. If you skip this step, the bundle will fail to start with an error about the application not being found.

> **Known Issue:** Application pre-registration is tracked in [ff-agent-sdk#44](https://github.com/firebrandanalytics/ff-agent-sdk/issues/44). A future SDK version may auto-register the application.

## Step 4: Build and Start

### Production Build

```bash
pnpm install
pnpm run build
```

Start the server with the `.env` file loaded:

```bash
cd apps/story-bundle
bash -c 'set -a && source .env && set +a && node dist/index.js'
```

The `set -a` / `set +a` pattern exports all variables from the `.env` file into the environment. This is more reliable than `dotenv` because it works identically for all processes, not just Node.js.

### Development Mode

For faster iteration with automatic TypeScript compilation:

```bash
cd apps/story-bundle
bash -c 'set -a && source .env && set +a && npx tsx src/index.ts'
```

### Health Check

Verify the bundle is running:

```bash
ff-sdk-cli health --url http://localhost:3005
```

Expected output:

```json
{ "healthy": true }
```

Also check the bundle info:

```bash
ff-sdk-cli info --url http://localhost:3005
```

```json
{
  "app_name": "IllustratedStory",
  "app_id": "e7a95bcc-7ef9-432e-9713-f040db078b14",
  "description": "AI-powered illustrated storybook generator"
}
```

## Step 5: Test the Pipeline

### 5.1: Create a Story

Trigger the pipeline via the `create-story` API endpoint:

```bash
ff-sdk-cli api call create-story --method POST \
  --body '{"topic":"A brave kitten who learns to swim"}' \
  --url http://localhost:3005
```

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Story pipeline started"
}
```

Save the entity ID:

```bash
export ENTITY_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

Or using curl directly:

```bash
curl -s -X POST http://localhost:3005/api/create-story \
  -H "Content-Type: application/json" \
  -d '{"topic":"A brave kitten who learns to swim"}' | jq .
```

### 5.2: Poll for Status

Use the `story-status` endpoint to monitor progress:

```bash
ff-sdk-cli api call story-status \
  --query '{"entity_id":"'"$ENTITY_ID"'"}' \
  --url http://localhost:3005
```

Or with curl:

```bash
curl -s "http://localhost:3005/api/story-status?entity_id=$ENTITY_ID" | jq .stage
```

### 5.3: Stage Progression

The pipeline moves through these stages in order:

```
created → safety_check → safety_passed → writing → writing_complete → generating_images → assembling → creating_pdf → completed
```

| Stage | What Happens | Service Used |
|-------|-------------|--------------|
| `created` | Entity created, pipeline starting | Entity Service |
| `safety_check` | `ContentSafetyBot` validates the topic | Broker (LLM) |
| `safety_passed` | Topic approved, proceeding | -- |
| `writing` | `StoryWriterBot` generates illustrated HTML with `{{IMAGE_N}}` placeholders | Broker (LLM) |
| `writing_complete` | Story text and image prompts extracted | -- |
| `generating_images` | `ImageService` calls `generateImage()` for each prompt, retrieves from blob storage, base64-encodes | Broker (Image Gen), Blob Storage |
| `assembling` | Placeholders replaced with `<img src="data:image/png;base64,...">` tags | -- |
| `creating_pdf` | Assembled HTML converted to PDF via `htmlToPdf()` | Doc Proc Service |
| `completed` | PDF and HTML stored in working memory | Context Service |

If the content safety check rejects the topic, the progression short-circuits:

```
created → safety_check → safety_rejected
```

The status response will include the rejection reason from the `ContentSafetyBot`.

### 5.4: Retrieve the Result

Once the status shows `completed`, the response includes the working memory IDs for the generated assets. You can download the PDF through working memory or inspect the HTML directly in the entity data.

## Step 6: Verify with Diagnostic Tools

> **Note:** The commands below assume you have the `.env` file from Step 1 in your working directory, or that you have set up the shared diagnostic tool configuration described in the [report-generator Part 1](../report-generator/part-01-hello-entity.md). All FF diagnostic tools auto-load connection settings from `.env`.

### 6.1: Inspect the Entity Graph

Verify that the pipeline created the expected entity hierarchy:

```bash
# Check the content safety check entity
ff-eg-read search nodes-scoped --page 1 --size 1 \
  --condition '{"specific_type_name": "ContentSafetyCheckEntity"}' \
  --order-by '{"created": "desc"}'
```

```bash
# Check the story writer entity
ff-eg-read search nodes-scoped --page 1 --size 1 \
  --condition '{"specific_type_name": "StoryWriterEntity"}' \
  --order-by '{"created": "desc"}'
```

For each entity, inspect the data and output:

```bash
# Get entity details
ff-eg-read node get <entity-id>

# Get the entity's return value
ff-eg-read node io <entity-id>

# Get the progress envelopes
ff-eg-read node progress <entity-id>
```

The `ContentSafetyCheckEntity` output should show the structured safety assessment (safe/unsafe, reasoning). The `StoryWriterEntity` output should contain the HTML story and the list of image prompts.

### 6.2: Trace LLM Calls with ff-telemetry-read

Verify that the broker was called correctly:

```bash
# List recent telemetry events
ff-telemetry-read recent --limit 5
```

You should see at least two LLM calls:
1. The content safety check (structured output with Zod validation)
2. The story generation (HTML output with image prompts)

Check token counts and latency to understand the cost profile of your pipeline.

### 6.3: Check Working Memory

Verify that the final PDF and HTML were stored:

```bash
ff-wm-read list --entity-id $ENTITY_ID
```

You should see working memory entries for:
- The illustrated HTML document
- The generated PDF

Download the PDF to verify it rendered correctly:

```bash
ff-wm-read download <pdf-working-memory-id> --output ./generated-story.pdf
```

Open `generated-story.pdf` to confirm the storybook contains the narrative text with inline illustrations.

## Step 7: Deployment to Cluster

Once you have verified the pipeline locally, deploy it to the Kubernetes cluster.

### 7.1: Build the Container Image

```bash
ff ops build --app illustrated-story
```

Or, if your `firefoundry.json` at the project root lists the component:

```bash
ff ops build
```

`ff ops build` reads `firefoundry.json`, builds the Docker image with the Dockerfile from the app directory, passes `FF_NPM_TOKEN` for npm authentication, and pushes to the container registry.

### 7.2: Build Prerequisites

`ff ops build` requires several environment prerequisites:

| Requirement | Why | How to Set |
|-------------|-----|-----------|
| `FF_NPM_TOKEN` | Authenticates to GitHub Packages for `@firebrandanalytics/*` dependencies during `pnpm install` inside Docker | `export FF_NPM_TOKEN="$GITHUB_TOKEN"` (from `~/.bashrc`) |
| `DOCKER_API_VERSION=1.44` | The CLI uses Docker API v1.43, but the Docker server minimum is v1.44 | `export DOCKER_API_VERSION=1.44` |
| QEMU registration | Required for cross-platform builds (ARM64 host to AMD64 cluster). Does not survive reboots. | `docker run --privileged --rm tonistiigi/binfmt --install amd64` |
| buildx builder | Multi-platform builder must exist | `docker buildx create --name multiarch --driver docker-container --use` |

If you are building on an Apple Silicon Mac (or any ARM64 machine) for an AMD64 Kubernetes cluster, run the QEMU and buildx setup before your first build:

```bash
# One-time setup (re-run after reboots)
docker run --privileged --rm tonistiigi/binfmt --install amd64
docker buildx rm multiarch 2>/dev/null
docker buildx create --name multiarch --driver docker-container --use
```

### 7.3: Deploy

```bash
ff ops deploy --app illustrated-story
```

Verify the deployment:

```bash
# Check pod status
kubectl get pods -l app=illustrated-story -n ff-dev

# Check logs
kubectl logs -l app=illustrated-story -n ff-dev --tail=50

# Port-forward for testing
kubectl port-forward svc/illustrated-story 3005:3005 -n ff-dev
```

Then run the same health check and pipeline test from Steps 4 and 5 against the deployed instance.

## Known Issues

During development of this tutorial, we encountered several platform issues that required workarounds. These are documented in `WORKAROUNDS.md` in the project root and have been filed as issues:

| Issue | Description | Impact | Workaround |
|-------|-------------|--------|------------|
| [ff-core-types#48](https://github.com/firebrandanalytics/ff-core-types/issues/48) | `broker-client` has `workspace:*` dependency that is not resolved during Docker builds | Build fails with unresolved workspace protocol | Pin the broker-client version explicitly in `package.json` overrides |
| [ff-agent-sdk#43](https://github.com/firebrandanalytics/ff-agent-sdk/issues/43) | Bot result extraction requires manual parsing of the iterator output | Extra boilerplate to get bot return values in entity `run_impl` | Use the extraction pattern shown in [Part 4](./part-04-pipeline-orchestration.md) |
| [ff-services-doc-proc#11](https://github.com/firebrandanalytics/ff-services-doc-proc/issues/11) | Puppeteer timeout during HTML-to-PDF conversion for large documents | PDF generation fails on stories with many high-resolution images | Reduce image sizes or increase timeout via service configuration |
| [ff-agent-sdk#44](https://github.com/firebrandanalytics/ff-agent-sdk/issues/44) | Application must be pre-registered before bundle startup | Bundle fails to start if the application UUID does not exist | Run the `curl` registration call from Step 3 before first startup |
| [context-service#11](https://github.com/firebrandanalytics/context-service/issues/11) | gRPC message size limit exceeded when storing large base64-encoded images | Working memory write fails for stories with many illustrations | Store images individually rather than as a single payload, or increase the gRPC max message size |

If you encounter any of these issues, check the linked GitHub issues for the latest status and recommended workarounds.

## What You've Built

Over this five-part tutorial, you built a complete **AI-powered illustrated children's storybook generator**. Here is the full architecture:

```
User sends topic
       |
       v
POST /api/create-story
       |
       v
IllustratedStoryAgentBundle.runPipeline()
       |
       |-- Stage 1: Content Safety Check
       |     ContentSafetyCheckEntity -> ContentSafetyBot
       |     (StructuredOutputBotMixin + Zod validation)
       |     Rejects inappropriate topics with explanation
       |
       |-- Stage 2: Story Writing
       |     StoryWriterEntity -> StoryWriterBot
       |     (HTML with {{IMAGE_N}} placeholders + image prompts)
       |     Complex prompt engineering for child-friendly narrative
       |
       |-- Stage 3: Image Generation
       |     ImageService -> Broker generateImage()
       |     -> Blob Storage retrieval -> base64 encoding
       |     One image per {{IMAGE_N}} placeholder
       |
       |-- Stage 4: HTML Assembly
       |     Replace {{IMAGE_N}} with <img src="data:image/png;base64,...">
       |     Fully self-contained illustrated HTML document
       |
       |-- Stage 5: PDF Generation
       |     doc-proc service htmlToPdf()
       |     Downloadable storybook PDF
       |
       |-- Stage 6: Store in Working Memory
       |     HTML and PDF available for retrieval
       |
       v
GET /api/story-status -> poll for progress
```

### SDK Features Used

| SDK Feature | Where Used |
|-------------|-----------|
| `RunnableEntity` | `ContentSafetyCheckEntity`, `StoryWriterEntity`, `IllustratedStoryEntity` |
| `@EntityMixin` | Every entity class |
| `@RegisterBot` | `ContentSafetyBot`, `StoryWriterBot` |
| `MixinBot` / `ComposeMixins` | `ContentSafetyBot` (with `StructuredOutputBotMixin`) |
| `StructuredOutputBotMixin` | Zod-validated safety assessment output |
| `Prompt` / `PromptTemplateSectionNode` | `StoryWriterPrompt` with HTML output instructions |
| `BrokerClient.generateImage()` | Image generation in `ImageService` |
| `BlobStorageClient` | Retrieving generated images from Azure Blob Storage |
| `WorkingMemoryProvider` | Storing final PDF and HTML |
| `DocProcClient.htmlToPdf()` | HTML-to-PDF conversion |
| `@ApiEndpoint` | `create-story` and `story-status` endpoints |
| `appendOrRetrieveCall` | Idempotent child entity delegation in pipeline |
| `yield*` streaming | Progress events between pipeline stages |
| `FFAgentBundle` | Bundle class with constructor map |
| `createStandaloneAgentBundle` | HTTP server factory |
| `createEntityClient` | Entity client scoped to application ID |

### Concepts Demonstrated

1. **Multi-bot pipelines** -- The content safety bot and story writer bot have distinct responsibilities, each with their own prompt and output schema. This separation makes each bot independently testable and replaceable.

2. **Structured output with Zod** -- The `ContentSafetyBot` uses `StructuredOutputBotMixin` to guarantee the LLM returns a valid safety assessment. If the LLM returns malformed JSON, the mixin retries automatically.

3. **Complex prompt engineering** -- The `StoryWriterPrompt` instructs the LLM to produce HTML with `{{IMAGE_N}}` placeholders and a separate list of image generation prompts. This requires careful prompt design to get consistent, parseable output.

4. **Image generation pipeline** -- The broker's `generateImage()` API, blob storage retrieval, and base64 encoding form a three-step pipeline that converts text prompts into inline images.

5. **Multi-stage orchestration** -- The `runPipeline()` method coordinates six stages with entity state management, where each stage depends on the previous stage's output. Progress is reported at each transition.

6. **Service integration** -- The pipeline touches four external services (broker, entity service, context service, doc-proc service) plus blob storage, demonstrating how agent bundles compose platform capabilities.

## Key Takeaways

1. **Three environment variable groups are critical for SDK 4.x** -- `REMOTE_ENTITY_SERVICE_URL`, `REMOTE_ENTITY_SERVICE_PORT`, and `USE_REMOTE_ENTITY_CLIENT=true` must all be set. Missing any one of them causes a cryptic startup crash.

2. **Port forwarding is the bridge between local and cluster** -- During development, you run the bundle locally but connect to cluster services via `kubectl port-forward`. For sustained development, use `procman` for auto-reconnecting forwards.

3. **Application pre-registration is required** -- The SDK auto-registers the agent bundle, but the parent application must exist first. This is a one-time `curl` call that is easy to forget.

4. **Diagnostic tools verify every layer** -- `ff-eg-read` for entity graph structure, `ff-wm-read` for stored files, `ff-telemetry-read` for LLM call traces. Together they provide full observability into what happened during a pipeline run.

5. **`ff ops` handles the build/deploy pipeline** -- `ff ops build` builds and pushes the Docker image. `ff ops deploy` installs or upgrades the Helm release. Both read `firefoundry.json` for configuration.

## Where to Go From Here

This tutorial focused on the agent bundle side -- the AI pipeline that generates illustrated storybooks. For deeper coverage of concepts that extend beyond what this tutorial covered, see the [report-generator tutorial](../report-generator/README.md):

- **[Part 8: Review Workflow](../report-generator/part-08-review-workflow.md)** -- Human-in-the-loop review with `ReviewableEntity` and `ReviewStep`, feedback loops with versioning
- **[Part 11: Consumer Backend](../report-generator/part-11-consumer-backend.md)** -- Building a Backend-for-Frontend (BFF) with Next.js API routes that talk to your deployed agent bundle
- **[Part 12: Progress Streaming](../report-generator/part-12-progress-streaming.md)** -- Server-Sent Events (SSE) endpoints that bridge agent bundle iterators to the browser in real time
- **[Part 13: Review & Management](../report-generator/part-13-review-and-management.md)** -- Report history, PDF downloads, and review interaction from a web UI

### Additional Resources

- **[API Reference](../../api-reference/README.md)** -- Complete reference for all SDK classes and decorators
- **[Core Concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md)** -- Deeper dive into the Entity-Bot-Prompt architecture
- **[ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps)** -- The complete source code for this tutorial under `illustrated-story/`
- **Build your own** -- Use `ff application create` and `ff agent-bundle create` to start a new project from scratch

---

**Previous:** [Part 4: Pipeline Orchestration & API Endpoints](./part-04-pipeline-orchestration.md) | **Start over:** [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md)
