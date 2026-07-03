# XML DSL Content Analyzer — Guided Tour

*Zero TypeScript. Just XML.*

This is a guided tour of the **XML DSL Content Analyzer** — a complete FireFoundry agent bundle that runs entirely from XML files with no hand-written TypeScript bundle code. You'll see the demo running, then walk through each of the four DSL files to understand how they fit together.

**What the demo does**: Accept a text snippet, run it through a FireFoundry AI workflow, and return structured analysis — topic classification, sentiment, key findings, and a confidence score.

**Why it matters**: The same bundle logic that would normally require ~180 lines of TypeScript wiring is expressed in four XML files deployed via a ConfigMap. One xml-bundle-server image, swap the ConfigMap, get a different bundle.

---

## Part 1 — Run It, See It, Believe It

### What you need

- Docker (to run the xml-bundle-server)
- curl (to test the endpoints)
- Access to the FireFoundry infrastructure (PostgreSQL + LLM Broker)

### Start the bundle

```bash
cd apps/xml-dsl-bundle

docker run \
  -v $(pwd)/dsl:/config \
  -e BUNDLE_PATH=/config/bundle.bundleml \
  -e PG_SERVER=localhost \
  -e PG_DATABASE=ff_dev \
  -e PG_PASSWORD=your-password \
  -e LLM_BROKER_HOST=broker.ff-dev.internal \
  -e LLM_BROKER_PORT=8080 \
  -e USE_REMOTE_ENTITY_CLIENT=true \
  -p 3000:3000 \
  firebrandanalytics/xml-bundle-server:latest
```

That's all. There is no `npm run build`. No TypeScript compilation. The `xml-bundle-server` image reads `bundle.bundleml` from the mount, parses all four DSL files, registers the entity and bot, compiles the endpoint handlers, and starts the HTTP server — in under two seconds.

### Confirm the DSLs loaded

```bash
curl http://localhost:3000/api/dsl-info
```

```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

### Run your first analysis

```bash
curl -X POST http://localhost:3000/api/run-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The new product launch exceeded expectations, driving a 40% increase in quarterly revenue.",
    "analysis_type": "sentiment",
    "requested_by": "demo-user"
  }'
```

Expected response (LLM output varies slightly):

```json
{
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
```

That result came from four XML files. No TypeScript was compiled, no SDK class was subclassed, no decorator was invoked. Let's understand how.

---

## Part 2 — The Bundle Manifest: BundleML

Every agent bundle starts with a BundleML file. Think of it as the `package.json` of your bundle — it declares what components exist, what HTTP routes are exposed, and any custom methods the bundle needs.

**File**: `apps/xml-dsl-bundle/dsl/bundle.bundleml`

```xml
<bundle id="558707ed-d548-4a68-a384-1bf18f6da676"
        name="XML DSL Content Analyzer"
        description="Zero-TypeScript content analysis bundle demonstrating all four FireFoundry XML DSLs">
  <config>
    <port>3000</port>
  </config>
  <constructors>
    <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
    <bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="/run-analysis" method="POST" response-type="json">
      <handler><![CDATA[
        const { text, analysis_type, requested_by } = body;
        const entity = await registry.createEntity('AnalysisWorkflow', {
          topic: text,
          analysis_type: analysis_type || 'general',
          requested_by: requested_by || 'demo-user'
        });
        const result = await entity.start();
        return result;
      ]]></handler>
    </endpoint>
    <endpoint route="/dsl-info" method="GET" response-type="json">
      <handler><![CDATA[
        return {
          bundle: 'xml-dsl-content-analyzer',
          dsls_loaded: ['PromptML', 'BotML', 'AgentML', 'BundleML'],
          deployment: 'xml-bundle-server (zero TypeScript)'
        };
      ]]></handler>
    </endpoint>
  </endpoints>
  <methods>
    <method name="getLatestResult"><![CDATA[
      return await registry.getWorkingMemory('analysis/latest-result');
    ]]></method>
  </methods>
</bundle>
```

### What each section does

**`<bundle id="...">`** — The UUID identifies this bundle across environments. The `name` and `description` appear in logs and the Console UI.

**`<config>`** — Runtime configuration. `<port>3000</port>` is the only setting needed here. Other available options include file size limits for upload endpoints.

**`<constructors>`** — This is the key. It tells the bootstrap loader which files define which components:
- `<entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>` — entities of type `AnalysisWorkflow` are defined by the AgentML file
- `<bot type="AnalyzerBot" ref="analyzer-bot.botml"/>` — the `AnalyzerBot` is defined by the BotML file

The `ref` attribute is resolved relative to the directory containing `bundle.bundleml`. All sibling files must be in the same directory.

**`<endpoints>`** — HTTP routes. Each `<endpoint>` declares a `route`, `method`, and `response-type`. The handler is inline JavaScript in a CDATA block.

> **Important**: In xml-bundle-server mode, the CDATA handler receives `body`, `query`, `registry`, and `logger`. It does **not** receive `request` or `bundle` — those are TypeScript-wiring mode variables. The `registry` object is the `ComponentRegistry` singleton.

**`<methods>`** — Custom methods on the bundle, also as inline JavaScript. These can be called programmatically or from within endpoint handlers.

### DSL composition map

```
bundle.bundleml
  └─ <constructors>
       ├─ <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml">
       │    analysis-workflow.agentml
       │      └─ <call-bot name="AnalyzerBot">
       │           analyzer-bot.botml
       │             └─ <structured-prompt-group>  ← inline PromptML
       └─ <bot type="AnalyzerBot" ref="analyzer-bot.botml">
```

---

## Part 3 — The Workflow: AgentML

AgentML defines runnable entity workflows as sequential programs. The interpreter executes each instruction as an async generator, yielding progress envelopes at each `<yield-status>` — enabling real-time status streaming to the client.

**File**: `apps/xml-dsl-bundle/dsl/analysis-workflow.agentml`

```xml
<agent id="AnalysisWorkflow">
  <static-args>
    <arg name="topic" type="string"/>
    <arg name="analysis_type" type="string"/>
    <arg name="requested_by" type="string"/>
  </static-args>
  <run-impl>
    <yield-status message="Starting content analysis workflow"/>

    <yield-status message="Calling AnalyzerBot"/>

    <call-bot name="AnalyzerBot" result="analysis_result">
      <arg name="topic" value="args.topic"/>
      <arg name="analysis_type" value="args.analysis_type"/>
      <arg name="requested_by" value="args.requested_by"/>
      <arg name="mode">"detailed"</arg>
    </call-bot>

    <yield-status message="Saving results to working memory"/>

    <wm-set key="analysis/latest-result" value="analysis_result"/>
    <wm-set key="analysis/latest-topic" value="args.topic"/>

    <yield-status message="Updating entity graph"/>

    <graph-append edge-type="ProducedAnalysis" target="self">
      <data>
        <field name="topic" value="args.topic"/>
        <field name="analysis_type" value="args.analysis_type"/>
        <field name="timestamp">
          <expr>new Date().toISOString()</expr>
        </field>
      </data>
    </graph-append>

    <yield-status message="Content analysis workflow complete"/>

    <return value="analysis_result"/>
  </run-impl>
</agent>
```

### Tracing the execution sequence

The workflow runs 9 instructions in order, with 5 progress yields:

| Step | Instruction | What happens |
|------|-------------|--------------|
| 1 | `<yield-status>` | Emits "Starting content analysis workflow" to the caller |
| 2 | `<yield-status>` | Emits "Calling AnalyzerBot" |
| 3 | `<call-bot>` | Invokes AnalyzerBot, stores JSON result in `analysis_result` |
| 4 | `<yield-status>` | Emits "Saving results to working memory" |
| 5 | `<wm-set>` | Persists the result to entity working memory at `analysis/latest-result` |
| 6 | `<wm-set>` | Persists the topic at `analysis/latest-topic` |
| 7 | `<yield-status>` | Emits "Updating entity graph" |
| 8 | `<graph-append>` | Creates a `ProducedAnalysis` edge on the entity graph with topic, type, and timestamp |
| 9 | `<yield-status>` | Emits "Content analysis workflow complete" |
| 10 | `<return>` | Returns `analysis_result` as the final output |

### Key elements explained

**`<agent id="AnalysisWorkflow">`** — The `id` must exactly match the `type` attribute in the BundleML `<entity type="AnalysisWorkflow">` constructor. This is how the bootstrap loader connects the entity type to its program.

**`<static-args>`** — Declares typed inputs. Each `<arg name="..." type="..."/>` becomes available as `args.topic`, `args.analysis_type`, etc. within the `<run-impl>` body.

**`<call-bot name="AnalyzerBot" result="analysis_result">`** — Looks up `AnalyzerBot` in the `ComponentRegistry` (where BundleML registered it), calls it with the specified arguments, and stores the return value in the local variable `analysis_result`. All subsequent instructions can reference `analysis_result`.

There are two forms for `<arg>` children:
- `value="args.topic"` — the `value` attribute is evaluated as a JavaScript expression
- `<arg name="mode">"detailed"</arg>` — the text content form; the body is also evaluated as an expression, so the quotes produce the string literal `"detailed"`

**`<wm-set key="..." value="...">`** — Writes to the entity's working memory. The `key` is a literal path string; the `value` is an expression. Working memory persists across entity invocations.

**`<graph-append edge-type="ProducedAnalysis" target="self">`** — Adds an edge to the entity graph. `target="self"` creates a self-referential edge on the current entity. The `<data>` block specifies the edge payload as `<field>` elements. The `timestamp` field uses a nested `<expr>` element for complex expressions.

**`<return value="analysis_result"/>`** — Terminates the generator and returns the final result. The interpreter propagates this value through any nested scopes back to the caller.

---

## Part 4 — The Bot and Its Prompt: BotML + PromptML

BotML configures LLM behavior: which model pool to use, how many retries, and what prompt to send. The prompt is defined using PromptML syntax embedded directly in the BotML file.

### The Bot: analyzer-bot.botml

**File**: `apps/xml-dsl-bundle/dsl/analyzer-bot.botml`

```xml
<bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">
  <llm-options temperature="0.3">
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
    <semantic-label>xml-dsl-analyzer</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a content analysis assistant for the FireFoundry platform.</text>
        <text>Your job is to analyze the provided text and return a structured JSON response.</text>
        <text>Always respond with valid JSON containing keys: summary (string), topic (string), sentiment (string: "positive"|"negative"|"neutral"), findings (array of strings), and confidence (number 0-1).</text>
        <if condition="args.mode === 'detailed'">
          <text>Provide detailed analysis with explanations for each finding.</text>
        </if>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Analyze the following content: {{input.topic}}</text>
        <section name="context">
          <text>Analysis type: {{input.analysis_type}}</text>
          <text>Requested by: {{input.requested_by}}</text>
        </section>
        <text>Return your analysis as a JSON object with keys: summary, topic, sentiment, findings (array), and confidence (number 0-1).</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

**`<bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">`** — The `id` and `name` must match the `<call-bot name="AnalyzerBot">` instruction in the AgentML file. `max-tries="2"` means the LLM call will retry once on failure before propagating an error.

**`<llm-options temperature="0.3">`** — Low temperature produces deterministic JSON output (good for structured data extraction). The `<model-pool>` routes calls through the `firebrand-gpt-5.2-failover` pool, which provides automatic failover across model providers. The `<semantic-label>` tags telemetry for this bot so you can identify it in the Console.

**`<structured-prompt-group>`** — Organizes prompts into two sections that mirror the SDK's `StructuredPromptGroup`:
- `<base>` — stable system prompts; changes infrequently and benefits from prompt caching
- `<input>` — per-request user prompts; changes on every call

**The `<if>` conditional** — Inside the `<base>` system prompt, `<if condition="args.mode === 'detailed'">` adds an extra instruction when the caller passes `mode: "detailed"`. The AgentML workflow passes `<arg name="mode">"detailed"</arg>` to every `<call-bot>` invocation, so this branch always fires for this demo. You could make it conditional on the analysis type or any other runtime value.

**`input.*` vs `args.*`** — Inside a BotML `<structured-prompt-group>`, the arguments passed by the calling `<call-bot>` instruction arrive under the `input` namespace. The `topic`, `analysis_type`, and `requested_by` values in the user prompt are accessed as `{{input.topic}}`, `{{input.analysis_type}}`, `{{input.requested_by}}`. The `mode` argument (used in the `<if>` condition) is accessed as `args.mode` because it's used in a boolean condition expression, not in interpolation — a subtle distinction in how the interpreter evaluates context.

### The standalone prompt: analyzer-prompt.promptml

**File**: `apps/xml-dsl-bundle/dsl/analyzer-prompt.promptml`

```xml
<prompt-group>
  <prompt role="system">
    <text>You are a content analysis assistant for the FireFoundry platform.</text>
    <text>Your job is to analyze the provided text and return a structured JSON response.</text>
    <if condition="args.mode === 'detailed'">
      <text>Provide detailed analysis with explanations for each finding.</text>
    </if>
  </prompt>
  <prompt role="user">
    <text>Analyze the following content: {{input.topic}}</text>
    <section name="context">
      <text>Analysis type: {{args.analysis_type}}</text>
      <text>Requested by: {{args.requested_by}}</text>
    </section>
    <text>Return your analysis as a JSON object with keys: summary, topic, sentiment, findings (array), and confidence (number 0-1).</text>
  </prompt>
</prompt-group>
```

This file is included in the demo for documentation completeness and TypeScript-wiring compatibility — it is **not** loaded at runtime in the xml-bundle-server deployment. The `bootstrapFromBundleML()` function only processes `<entity>` and `<bot>` constructors from the BundleML file. It does not auto-discover standalone `.promptml` files.

The active prompt definition is the one embedded in `<structured-prompt-group>` inside `analyzer-bot.botml`. The standalone file is useful if you later migrate to TypeScript wiring (where you would load it explicitly) or if you want a clean, standalone reference of the prompt definition separate from the bot configuration.

---

## Part 5 — Ship It: xml-bundle-server and the Fleet Model

In a traditional FireFoundry bundle deployment, you would write a TypeScript class, compile it, build a Docker image, and push it. The xml-dsl-demo eliminates all of that for the bundle itself.

### The zero-TypeScript deployment model

```
┌─────────────────┐    HTTP     ┌─────────────────────────────┐
│  xml-dsl-gui    │ ──────────► │  xml-bundle-server           │
│  Next.js app    │             │  image: xml-bundle-server    │
│  Port 4000      │             │  BUNDLE_PATH=/config/bundle  │
│                 │             │  Port 3000                   │
└─────────────────┘             └────────────┬────────────────┘
                                             │ reads
                                    ┌────────▼────────┐
                                    │  ConfigMap       │
                                    │  /config/        │
                                    │  bundle.bundleml │
                                    │  analysis-*.agentml
                                    │  analyzer-*.botml│
                                    │  analyzer-*.promptml
                                    └─────────────────┘
```

The bundle app (`@apps/xml-dsl-bundle`) contains only DSL files and Kubernetes manifests. There is no `src/` directory, no `tsconfig.json`, no compiled output.

### The ConfigMap is the bundle

All four DSL files are embedded as keys in a Kubernetes ConfigMap:

```yaml
# apps/xml-dsl-bundle/deploy/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: xml-dsl-demo-bundle
  namespace: ff-dev
data:
  bundle.bundleml: |
    <bundle id="558707ed-d548-4a68-a384-1bf18f6da676" ...>
      ...
    </bundle>
  analysis-workflow.agentml: |
    <agent id="AnalysisWorkflow">
      ...
    </agent>
  analyzer-bot.botml: |
    <bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">
      ...
    </bot>
  analyzer-prompt.promptml: |
    <prompt-group>
      ...
    </prompt-group>
```

### Kubernetes deployment

The Deployment spec mounts the ConfigMap as a volume and points `BUNDLE_PATH` at the BundleML file:

```yaml
# apps/xml-dsl-bundle/deploy/deployment.yaml (excerpt)
containers:
  - name: xml-bundle-server
    image: firebrandanalytics/xml-bundle-server:latest
    env:
      - name: BUNDLE_PATH
        value: /config/bundle.bundleml
    volumeMounts:
      - name: bundle-config
        mountPath: /config
    livenessProbe:
      httpGet:
        path: /health
        port: 3000
    readinessProbe:
      httpGet:
        path: /ready
        port: 3000
volumes:
  - name: bundle-config
    configMap:
      name: xml-dsl-demo-bundle
```

`BUNDLE_PATH` is the only required configuration to swap bundles. The `xml-bundle-server` resolves all `ref` attributes in `<constructors>` relative to the directory containing the BundleML file — so all sibling DSL files must be in the same ConfigMap directory.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BUNDLE_PATH` | **yes** | Path to BundleML file; sibling DSL files resolved relative to this dir |
| `PG_SERVER` | yes | PostgreSQL host for entity persistence |
| `PG_DATABASE` | yes | Database name |
| `PG_PASSWORD` | yes | Database password |
| `LLM_BROKER_HOST` | yes | LLM broker hostname |
| `LLM_BROKER_PORT` | yes | LLM broker port |
| `USE_REMOTE_ENTITY_CLIENT` | yes | Set to `"true"` |
| `PORT` | no | HTTP server port (default 3000) |

### The fleet value proposition

The same `xml-bundle-server` image can run any bundle. To deploy a different bundle:
1. Write your XML files
2. Create a ConfigMap
3. Deploy with `BUNDLE_PATH` pointing at your BundleML

No image rebuild. No TypeScript compilation. Iterate on bundle behavior by editing XML and redeploying the ConfigMap.

### Helm deployment

The demo ships a Helm chart following the same conventions as `xml-bundle-server`:

```bash
# Standard deployment
helm install xml-dsl-demo ./helm \
  --namespace ff-dev \
  -f helm/values.yaml \
  -f helm/values.local.yaml

# Or with ff ops (if available)
ff ops deploy -f helm/values.local.yaml
```

---

## Part 6 (Optional) — Fork It: Making This Bundle Your Own

The XML DSL demo is designed to be adapted. Since all behavior is in XML, you can change the bundle's purpose without touching any TypeScript.

### Change the analysis task

Edit `analyzer-bot.botml` to replace the system prompt with a new persona and task:

```xml
<base>
  <prompt role="system">
    <text>You are a customer support triage assistant.</text>
    <text>Classify incoming support tickets by urgency and department.</text>
    <text>Respond with valid JSON: { "urgency": "high"|"medium"|"low", "department": string, "summary": string }</text>
  </prompt>
</base>
```

No TypeScript changes. Update the ConfigMap, redeploy.

### Change the workflow inputs

Edit `<static-args>` in `analysis-workflow.agentml` to accept different fields:

```xml
<static-args>
  <arg name="ticket_text" type="string"/>
  <arg name="customer_tier" type="string"/>
  <arg name="submitted_by" type="string"/>
</static-args>
```

Then update `<call-bot>` arguments to match:

```xml
<call-bot name="AnalyzerBot" result="triage_result">
  <arg name="topic" value="args.ticket_text"/>
  <arg name="analysis_type" value="args.customer_tier"/>
  <arg name="requested_by" value="args.submitted_by"/>
</call-bot>
```

### Add a new endpoint

Add a new `<endpoint>` to `bundle.bundleml` to expose a different API surface:

```xml
<endpoint route="/latest" method="GET" response-type="json">
  <handler><![CDATA[
    return await registry.getWorkingMemory('analysis/latest-result') || null;
  ]]></handler>
</endpoint>
```

No image rebuild. No TypeScript. Edit the ConfigMap, redeploy.

### When to eject to TypeScript

The XML DSL covers the vast majority of agent bundle patterns. Reach for TypeScript when you need:
- Custom initialization logic during bundle startup
- Complex multi-file SDK integrations
- Custom bot mixin composition at startup time
- Advanced patterns not yet expressible in DSL (see [Advanced Patterns Tutorial](../advanced-patterns-tutorial.md))

The [getting-started-tutorial.md](../getting-started-tutorial.md) builds a similar Sentiment Analyzer from scratch using the SDK directly — a useful reference for seeing what the DSL is doing under the hood.

---

## See Also

- **[DSL Overview](../README.md)** — Architecture and design rationale for all four DSLs
- **[Getting Started Tutorial](../getting-started-tutorial.md)** — Build a complete bundle from scratch using the DSL system
- **[Advanced Patterns Tutorial](../advanced-patterns-tutorial.md)** — Conditionals, loops, mixins, entity orchestration, error handling
- **[XML E2E Bundle Walkthrough](xml-e2e-bundle.md)** — Line-by-line walkthrough of the same scenario with TypeScript wiring
- **[BundleML Reference](../reference/bundleml-reference.md)** — Complete element and attribute reference
- **[AgentML Reference](../reference/agentml-reference.md)** — Complete instruction reference
- **[BotML Reference](../reference/botml-reference.md)** — Complete bot configuration reference
- **[PromptML Reference](../reference/promptml-reference.md)** — Complete prompt element reference
