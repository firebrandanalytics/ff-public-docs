# Part 1: Run It, See It, Believe It

By the end of this part, you will have the XML DSL Content Analyzer running locally in Docker and will have received your first structured analysis result from the bundle. No code to write — just a `docker run` command and the demo GUI.

**What you'll learn:**
- How the xml-bundle-server turns XML files into a live HTTP API with one environment variable
- What the four DSL files look like at a glance before diving into each in later parts
- How the async entity pattern works: submit a job, poll for completion, read the result

---

## What Is the xml-bundle-server?

The xml-bundle-server is a pre-built Docker image that reads a `bundle.bundleml` file at startup, parses all referenced DSL files, registers components in the `ComponentRegistry`, and starts serving HTTP endpoints — all without any TypeScript code in the bundle itself.

You point it at a directory of XML files via the `BUNDLE_PATH` environment variable. That's the entire deployment contract.

```
BUNDLE_PATH=/config/bundle.bundleml
    │
    └── xml-bundle-server reads this file at startup
          ├── parses analysis-workflow.agentml  → registers AnalysisWorkflow entity
          ├── parses analyzer-bot.botml         → registers AnalyzerBot bot
          └── compiles CDATA endpoint handlers  → wires HTTP routes
```

This is the **fleet model**: one Docker image, many bundles. Swap the directory of XML files, get a different bundle. No image rebuild. No code change.

## Step 1: Clone the DSL Files

The bundle's XML files live in `ff-demo-apps` under `xml-dsl-demo/apps/xml-dsl-bundle/dsl/`. Clone the repo and navigate there:

```bash
git clone https://github.com/firebrandanalytics/ff-demo-apps.git
cd ff-demo-apps/xml-dsl-demo/apps/xml-dsl-bundle
```

The `dsl/` directory contains four files:

```
dsl/
  bundle.bundleml              ← bundle manifest
  analysis-workflow.agentml    ← AgentML workflow
  analyzer-bot.botml           ← BotML bot config + inline prompt
  analyzer-prompt.promptml     ← standalone PromptML (documentation only)
```

The BundleML file ties everything together. Here is the `<constructors>` block that declares both the entity and the bot — each pointing to its sibling DSL file:

```xml
<constructors>
  <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
  <bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
</constructors>
```

When `bootstrapFromBundleML()` runs at startup, it reads `ref="analysis-workflow.agentml"` and `ref="analyzer-bot.botml"`, resolves those paths relative to `bundle.bundleml`'s directory, parses each file, and registers the resulting components. The `.promptml` file is in the same directory for documentation purposes but is **not** automatically loaded — more on that in Part 4.

## Step 2: Start the Server

Run the xml-bundle-server image with the `dsl/` directory mounted at `/config`:

```bash
docker run \
  -v $(pwd)/dsl:/config \
  -e BUNDLE_PATH=/config/bundle.bundleml \
  -e PG_SERVER=localhost \
  -e PG_DATABASE=ff_dev \
  -e PG_PASSWORD=your_password \
  -e LLM_BROKER_HOST=$LLM_BROKER_HOST \
  -e LLM_BROKER_PORT=${LLM_BROKER_PORT:-8080} \
  -e USE_REMOTE_ENTITY_CLIENT=true \
  -p 3000:3000 \
  firebrandanalytics/xml-bundle-server:latest
```

Set `LLM_BROKER_HOST` to the hostname of your FireFoundry LLM broker before running. The ff-demo-apps repository also includes a `docker-compose.yml` at the project root that starts the full stack (bundle server + GUI) in one command.

Within a few seconds, the server logs will show component registration messages. The bundle is ready when you see the HTTP server start line.

## Step 3: Verify the Bundle Loaded

Confirm all four DSL components were registered by opening `http://localhost:3000/api/dsl-info` in your browser.

Expected response:

```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

This response is served directly by the `dsl-info` endpoint in `bundle.bundleml` — a CDATA handler that returns a static object. It confirms that the bundle loaded cleanly and all four DSLs were processed.

## Step 4: Submit an Analysis

The Content Analyzer accepts a `text` field in the POST body. The analysis runs asynchronously: the endpoint creates an entity in the background and returns immediately with an `entity_id` and a `status` of `pending`.

Open the demo GUI at `http://localhost:4000`. Paste the following text into the **Text** field:

```
The new product launch exceeded expectations, driving a 40% increase in quarterly revenue.
```

Select **general** from the **Analysis type** dropdown and click **Analyze**.

The GUI immediately receives a response like:

```json
{
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending"
}
```

The entity is now running the `AnalysisWorkflow` AgentML program in the background. It will yield five progress status messages, call `AnalyzerBot`, save results to working memory, append to the entity graph, and return structured JSON.

## Step 5: Observe Completion

The GUI polls `entity-status` automatically. As the workflow progresses you will see a live progress stream showing each `<yield-status>` message as it is emitted:

```
Starting content analysis workflow
Calling AnalyzerBot
Saving results to working memory
Updating entity graph
Content analysis workflow complete
```

Once the LLM responds and the workflow completes, the result panel populates with the structured output:

```json
{
  "status": "complete",
  "result": {
    "summary": "Strongly positive financial performance announcement",
    "topic": "Financial / Product Launch",
    "sentiment": "positive",
    "findings": [
      "40% increase in quarterly revenue reported",
      "Product launch described as exceeding expectations",
      "Positive forward outlook implied"
    ],
    "confidence": 0.87
  }
}
```

Five progress messages. Structured JSON result. Zero TypeScript bundle code.

## Run and Verify

Open the demo GUI at `http://localhost:4000`. Submit the text "Revenue grew strongly this quarter." with analysis type **general**.

You should see:
1. An `entity_id` appear immediately — the `run-analysis` endpoint returned `{ "entity_id": "...", "status": "pending" }` in milliseconds without waiting for the LLM.
2. Five progress stages appear in sequence: "Starting content analysis workflow" → "Calling AnalyzerBot" → "Saving results to working memory" → "Updating entity graph" → "Content analysis workflow complete".
3. A result panel showing `sentiment: "positive"`, a non-empty `findings` array, and a `confidence` value between 0 and 1.

If the result panel shows `"error"`, confirm that `LLM_BROKER_HOST` is reachable from the container (check the docker run environment variables in Step 2).

---

**Next**: [Part 2: Wiring It All Together with BundleML](./part-02.md) — walk through every element of `bundle.bundleml` and understand how the manifest wires the bundle together.
