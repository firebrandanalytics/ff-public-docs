# XML E2E Bundle Walkthrough

This document is a line-by-line walkthrough of the `xml-e2e-bundle`, a complete agent bundle that exercises all four FireFoundry XML DSLs. The bundle defines a data analysis workflow: it accepts an analysis request via HTTP, runs it through an AgentML workflow that calls a BotML-configured bot, persists results to working memory and the entity graph, and returns structured output.

This is the primary reference example for understanding how PromptML, BotML, AgentML, and BundleML work together in a real deployed bundle.

## Overview

The xml-e2e-bundle is a self-contained agent bundle that:

1. Accepts a POST request with a topic, analysis type, and requester name
2. Creates an `XMLRunnableEntity` of type `AnalysisWorkflow`
3. Executes the AgentML program, which calls the `AnalyzerBot`
4. The bot uses an LLM (via the `firebrand-gpt-5.2-failover` model pool) to produce a JSON analysis
5. The workflow stores results in working memory and records an entity graph edge
6. Returns the analysis result through the async generator pipeline

The request flow looks like this:

```
Client POST /run-analysis { topic, analysis_type, requested_by }
  |
  v
XMLE2EAgentBundle.runAnalysis()
  |
  v
EntityFactory.create_entity_node("AnalysisWorkflow")
  |
  v
XMLRunnableEntity.start()  -->  AgentML Interpreter
  |                                     |
  |    <yield-status> "Starting..."     |
  |    <yield-status> "Calling bot..."  |
  |    <call-bot name="AnalyzerBot">    |----> Bot.run() --> LLM
  |    <wm-set key="analysis/...">      |
  |    <graph-append edge-type="...">   |
  |    <return value="analysis_result"> |
  |                                     |
  v
Response { success, entity_id, progress_count, result }
```

## File Structure

```
apps/xml-e2e-bundle/
  package.json                    # Package metadata and scripts
  tsconfig.json                   # TypeScript configuration
  Dockerfile                      # Container build definition
  src/
    index.ts                      # Entry point - starts the server
    agent-bundle.ts               # TypeScript wiring class
    dsl/
      analyzer-prompt.promptml    # Standalone prompt definition
      analyzer-bot.botml          # Bot configuration with inline prompts
      analysis-workflow.agentml   # Workflow program
      bundle.bundleml             # Bundle manifest
  dist/                           # Compiled output
  helm/
    values.local.yaml             # Local Helm values for k8s deployment
```

## The Prompt: analyzer-prompt.promptml

This file defines a standalone prompt group for the analysis bot. It demonstrates conditional content, sections, and interpolation.

```xml
<prompt-group>
  <prompt role="system">
    <text>You are a data analysis assistant for the FireFoundry platform.</text>
    <text>Your job is to analyze the provided input and return a structured JSON response.</text>
    <if condition="args.mode === 'detailed'">
      <text>Provide detailed analysis with explanations for each finding.</text>
    </if>
  </prompt>
  <prompt role="user">
    <text>Analyze the following input: {{input.topic}}</text>
    <section name="context">
      <text>Analysis type: {{args.analysis_type}}</text>
      <text>Requested by: {{args.requested_by}}</text>
    </section>
    <text>Return your analysis as a JSON object with keys: summary, findings (array), and confidence (number 0-1).</text>
  </prompt>
</prompt-group>
```

### Line-by-line annotations

**Line 1: `<prompt-group>`**
The root element for all PromptML files. A prompt group contains one or more `<prompt>` elements, typically a system prompt and a user prompt. The parser expects this as the root tag and will reject files with a different root.

**Lines 2-8: `<prompt role="system">`**
Defines a system prompt. The `role` attribute is required and must be one of `system`, `user`, or `assistant`. Inside this prompt:

- **Line 3:** A `<text>` element provides a static instruction. Multiple `<text>` elements within a prompt are concatenated with newlines.
- **Line 4:** Another `<text>` element adds to the system instructions.
- **Lines 5-7:** An `<if>` block with a `condition` attribute. The expression `args.mode === 'detailed'` is evaluated at render time against the runtime context. If true, the nested `<text>` element is included in the rendered prompt. If false, it is omitted entirely.

**Lines 9-16: `<prompt role="user">`**
Defines the user prompt containing the actual analysis request:

- **Line 10:** Uses `{{input.topic}}` interpolation. Double-brace markers are evaluated by the `ExpressionEvaluator` at render time, replacing the marker with the string value of `input.topic` from the runtime context.
- **Lines 11-14:** A `<section name="context">` groups related content. Sections are semantic containers that render their children separated by newlines. The `name` attribute is for identification and documentation purposes.
- **Lines 12-13:** `<text>` elements inside the section use `{{args.analysis_type}}` and `{{args.requested_by}}` interpolation to inject request parameters.
- **Line 15:** A final instruction to the LLM specifying the expected output format.

**Key patterns:**
- This prompt is registered standalone in the `ComponentRegistry` as `"analyzer-prompt"`. It is also duplicated (with slight variations) as inline prompts within the BotML file. This dual approach demonstrates both standalone and embedded prompt usage.
- The `<if>` conditional is evaluated at prompt render time, not at workflow execution time. The `args` object comes from the bot's input context.

## The Bot: analyzer-bot.botml

This file defines the AnalyzerBot -- an LLM orchestration blueprint with model settings and inline prompts.

```xml
<bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">
  <llm-options temperature="0.3">
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
    <semantic-label>xml-e2e-analyzer</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a data analysis assistant for the FireFoundry platform.</text>
        <text>Your job is to analyze the provided input and return a structured JSON response.</text>
        <text>Always respond with valid JSON containing keys: summary (string), findings (array of strings), and confidence (number 0-1).</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Analyze the following topic: {{input.topic}}</text>
        <section name="context">
          <text>Analysis type: {{input.analysis_type}}</text>
          <text>Requested by: {{input.requested_by}}</text>
        </section>
        <text>Return your analysis as a JSON object with keys: summary, findings (array), and confidence (number 0-1).</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

### Line-by-line annotations

**Line 1: `<bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">`**
The root element for BotML files. Three attributes:
- `id` -- unique identifier for the bot (used in the constructors manifest)
- `name` -- display name used in the SDK and logging
- `max-tries` -- maximum number of LLM retry attempts if the call fails (default is typically 1)

**Lines 2-5: `<llm-options temperature="0.3">`**
Configures the LLM call parameters:
- `temperature="0.3"` -- low temperature for deterministic, consistent output (good for structured JSON responses)
- `<model-pool>` -- specifies which model pool to route the LLM call through. The `firebrand-gpt-5.2-failover` pool provides automatic failover across model providers.
- `<semantic-label>` -- a label used for request tracking, logging, and telemetry. This helps identify which bot made which LLM call in observability dashboards.

**Lines 6-24: `<structured-prompt-group>`**
The structured prompt group organizes prompts into two sections:

**Lines 7-13: `<base>`**
Contains prompts that form the base context for every bot call. Typically system prompts that set the bot's persona, capabilities, and output format requirements. The system prompt here includes three `<text>` elements defining the assistant's role and requiring valid JSON output.

**Lines 14-23: `<input>`**
Contains prompts that carry the per-request input data. The user prompt uses `{{input.topic}}`, `{{input.analysis_type}}`, and `{{input.requested_by}}` to inject the caller's data. Note the `input.` prefix here -- in the BotML context, the bot receives its arguments via the `input` namespace, which corresponds to the arguments passed by `<call-bot>` in the AgentML workflow.

**Key patterns:**
- The `<structured-prompt-group>` with `<base>` and `<input>` sections mirrors the SDK's `StructuredPromptGroup` class, which separates stable instructions from per-request content. This is important for prompt caching strategies.
- The inline PromptML content within `<base>` and `<input>` uses the same elements (`<prompt>`, `<text>`, `<section>`) as standalone `.promptml` files. BotML reuses the PromptML schema for its embedded prompts.
- The bot uses `{{input.*}}` interpolation rather than `{{args.*}}`. Inside a BotML structured prompt group, the arguments passed to the bot are available under `input`.

## The Workflow: analysis-workflow.agentml

This file defines the analysis workflow as an AgentML program. It orchestrates the full pipeline: status reporting, bot invocation, working memory persistence, and entity graph updates.

```xml
<agent id="AnalysisWorkflow">
  <static-args>
    <arg name="topic" type="string"/>
    <arg name="analysis_type" type="string"/>
    <arg name="requested_by" type="string"/>
  </static-args>
  <run-impl>
    <yield-status message="Starting analysis workflow"/>

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

    <yield-status message="Analysis workflow complete"/>

    <return value="analysis_result"/>
  </run-impl>
</agent>
```

### Line-by-line annotations

**Line 1: `<agent id="AnalysisWorkflow">`**
The root element for AgentML files. The `id` attribute is critical -- it maps to `specific_type_name` in the entity system. When the TypeScript wiring class creates an entity of type `"AnalysisWorkflow"`, the `XMLRunnableEntity` looks up the AgentML program with this `id` from the `ComponentRegistry`.

**Lines 2-6: `<static-args>`**
Declares the typed arguments this workflow expects. Each `<arg>` has a `name` and an optional `type` (one of `string`, `number`, `boolean`, `object`, `array`). These declarations serve as documentation and can be used for validation. At runtime, the arguments are available under the `args` namespace in expressions.

**Line 8: `<yield-status message="Starting analysis workflow"/>`**
Emits a status progress envelope. The `<yield-status>` instruction creates a STATUS-type envelope and yields it through the async generator. Callers iterating over the generator receive these envelopes in real time, enabling progress tracking in UIs. The `message` attribute supports `{{interpolation}}`.

**Lines 12-17: `<call-bot name="AnalyzerBot" result="analysis_result">`**
The core instruction -- invokes the registered bot named `"AnalyzerBot"` and stores its return value in the variable `analysis_result`. The interpreter:
1. Resolves each `<arg>` child by evaluating the `value` attribute as an expression
2. Looks up `"AnalyzerBot"` in the `ComponentRegistry`
3. Calls the bot, forwarding any progress envelopes it yields
4. Stores the final result in the `analysis_result` variable

The `<arg>` children map arguments to the bot:
- `value="args.topic"` -- evaluates the expression `args.topic` and passes the result
- `"detailed"` -- a literal string expression (note the quotes inside the value)

**Lines 21-22: `<wm-set>`**
Writes values to the entity's working memory. Working memory is a key-value store scoped to the entity, persisted across invocations. The `key` uses a path-like structure (`analysis/latest-result`), and the `value` attribute is an expression that evaluates to the data to store.

**Lines 26-34: `<graph-append>`**
Adds an edge to the entity graph. The entity graph is FireFoundry's relationship model for connecting entities to each other and to external concepts. Here:
- `edge-type="ProducedAnalysis"` -- the type of relationship being recorded
- `target="self"` -- the target node (in this case, a self-referential edge)
- `<data>` contains `<field>` elements with the edge's payload data
- The `timestamp` field uses a nested `<expr>` element to evaluate `new Date().toISOString()`, demonstrating inline expression evaluation within data fields

**Line 38: `<return value="analysis_result"/>`**
Returns the value of the `analysis_result` variable as the workflow's final output. The interpreter wraps this in a `ReturnSignal` that propagates up through any nested scopes. This value becomes the final result of the async generator.

**Key patterns:**
- The workflow reads like a sequential script: status, bot call, persist, graph update, return. The async generator model means each `<yield-status>` is a real yield point -- the caller can observe progress in real time.
- Variables created by `<call-bot result="...">` are available to all subsequent instructions in the same scope.
- Working memory operations are async -- they go through the `AgentMLHost` interface to the entity's persistence layer.

## The Bundle Manifest: bundle.bundleml

This file declares the bundle's structure: what components it contains, what HTTP endpoints it exposes, and what custom methods it provides.

```xml
<bundle id="xml-e2e-bundle" name="XML E2E Test Bundle" description="End-to-end test bundle using all four XML DSLs">
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
        const { topic, analysis_type, requested_by } = request.body;
        const entity = await bundle.createEntity('AnalysisWorkflow', {
          topic, analysis_type, requested_by
        });
        const result = await entity.start();
        return result;
      ]]></handler>
    </endpoint>
    <endpoint route="/dsl-info" method="GET" response-type="json">
      <handler><![CDATA[
        return { bundle: 'xml-e2e-bundle', dsls_loaded: ['PromptML', 'BotML', 'AgentML', 'BundleML'] };
      ]]></handler>
    </endpoint>
  </endpoints>
  <methods>
    <method name="getAnalysisHistory"><![CDATA[
      return await bundle.getWorkingMemory('analysis/latest-result');
    ]]></method>
  </methods>
</bundle>
```

### Line-by-line annotations

**Line 1: `<bundle id="xml-e2e-bundle" name="XML E2E Test Bundle" ...>`**
The root element for BundleML files. Required attributes:
- `id` -- unique bundle identifier
- `name` -- display name

Optional attribute `description` provides human-readable documentation that appears in validation output and logs.

**Lines 2-4: `<config>`**
Runtime configuration for the bundle server. `<port>3000</port>` sets the HTTP server port. Other available config elements include `<file-size-limit>` (max upload size in bytes) and `<max-files>` (max files per upload request).

**Lines 5-8: `<constructors>`**
Maps component types to their DSL definition files. Each child element is either `<entity>` or `<bot>`:
- `<entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>` -- declares that entities of type `AnalysisWorkflow` are defined by the AgentML file at the given path
- `<bot type="AnalyzerBot" ref="analyzer-bot.botml"/>` -- declares the AnalyzerBot is defined by the BotML file

The `type` attribute corresponds to the component's registered name in the `ComponentRegistry`. The `ref` attribute is the relative path to the DSL file.

**Lines 9-25: `<endpoints>`**
Defines HTTP endpoints exposed by the bundle. Each `<endpoint>` has:
- `route` -- the URL path (mounted under the bundle's base path)
- `method` -- HTTP method (`GET` or `POST`)
- `response-type` -- response format (`json`, `binary`, or `iterator`)

The `<handler>` element contains inline JavaScript in a CDATA section. CDATA is required because the JavaScript contains characters (`<`, `>`, `&`) that would otherwise be interpreted as XML. The handler code has access to `request` (the HTTP request) and `bundle` (the bundle instance). It must return a value that becomes the response body.

**Lines 10-19: POST `/run-analysis` endpoint**
Destructures `topic`, `analysis_type`, and `requested_by` from the request body, creates an `AnalysisWorkflow` entity, starts it, and returns the result.

**Lines 20-24: GET `/dsl-info` endpoint**
A diagnostic endpoint that returns static information about which DSLs are loaded.

**Lines 26-30: `<methods>`**
Defines custom methods on the bundle class. Each `<method>` has a `name` attribute and inline JavaScript code. The `getAnalysisHistory` method retrieves the latest analysis result from working memory. Methods are available for internal use and can be called from endpoint handlers or other bundle code.

**Key patterns:**
- BundleML CDATA handlers are JavaScript, not TypeScript. They run in the bundle's runtime context with access to the `bundle` instance.
- The `constructors` section creates a documented mapping between types and their DSL files. This is primarily for validation and documentation -- the TypeScript wiring class handles actual registration.
- Endpoint definitions in BundleML match the `@ApiEndpoint` decorator pattern used in the TypeScript class, providing a declarative alternative.

## TypeScript Wiring: agent-bundle.ts

The TypeScript file is the bridge between DSL definitions and the SDK runtime. It extends `FFAgentBundle`, reads the XML files, parses them, and registers all components during initialization.

### Imports and setup

```typescript
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FFAgentBundle,
  ApiEndpoint,
  logger,
  createEntityClient,
  ComponentRegistry,
  XMLRunnableEntity,
  Bot,
  parseAgentML,
  bindInterpreter,
  parseBotMLToSpec,
  parseBundleML,
  validateBundleML,
  PromptML,
  ensureMixinsRegistered,
} from "@firebrandanalytics/ff-agent-sdk";

ensureMixinsRegistered();
```

The imports pull in the full DSL toolchain from the SDK: parsers for each DSL (`parseAgentML`, `parseBotMLToSpec`, `parseBundleML`, `PromptML.parsePromptML`), the validator (`validateBundleML`), the interpreter binder (`bindInterpreter`), and the runtime components (`ComponentRegistry`, `XMLRunnableEntity`, `Bot`).

`ensureMixinsRegistered()` is called at module level to ensure built-in bot mixins (like `StructuredOutput`) are registered before any BotML parsing occurs.

### DSL file reader

```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const DSL_DIR = join(__dirname, "..", "src", "dsl");

function readDSL(filename: string): string {
  return readFileSync(join(DSL_DIR, filename), "utf-8");
}
```

A helper that resolves DSL files relative to the project's `src/dsl/` directory. The path computation accounts for the compiled output being in `dist/` while the XML source files remain in `src/dsl/`.

### Constructor mapping

```typescript
const XMLE2EConstructors: Record<string, any> = {
  AnalysisWorkflow: XMLRunnableEntity,
};
```

Maps entity type names to their constructor classes. `XMLRunnableEntity` is the SDK class that bridges AgentML programs to the entity framework. When the entity factory creates an entity of type `"AnalysisWorkflow"`, it uses `XMLRunnableEntity` as the constructor, and the entity looks up the corresponding AgentML program from the `ComponentRegistry`.

### Bundle class and init

```typescript
export class XMLE2EAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "1fdad957-4be7-4b23-b61e-cf72089522bf",
        application_id: APP_ID,
        name: "XMLE2ETestBundle",
        type: "agent_bundle",
        description: "End-to-end test bundle exercising all four XML DSLs",
      },
      XMLE2EConstructors,
      provider as any
    );
  }
```

The bundle class extends `FFAgentBundle` and passes the bundle metadata, constructor mapping, and entity client to the superclass.

### The init() method -- four-stage DSL loading

The `init()` method is where all four DSLs are loaded, parsed, and registered. It follows a consistent four-stage pattern:

**Stage 1: Parse and validate BundleML**

```typescript
const bundleXml = readDSL("bundle.bundleml");
const bundleDef = parseBundleML(bundleXml);
const bundleValidation = validateBundleML(bundleXml, join(DSL_DIR, "bundle.bundleml"));
```

Reads the BundleML file, parses it into a `BundleNode` AST, and validates its structure. The validation result is logged. If validation fails, the bundle can still start (BundleML is currently a validation/documentation layer), but the failure is logged as a warning.

**Stage 2: Parse and register AgentML**

```typescript
const agentXml = readDSL("analysis-workflow.agentml");
const program = parseAgentML(agentXml, join(DSL_DIR, "analysis-workflow.agentml"));
bindInterpreter(program);

registry.register({
  kind: "agentml-program",
  name: "AnalysisWorkflow",
  source: "xml",
  program,
});
```

Reads the AgentML file, parses it into an `AgentMLProgram`, binds an interpreter to make it executable, and registers it in the `ComponentRegistry` under the name `"AnalysisWorkflow"`. The `kind: "agentml-program"` registration type allows `XMLRunnableEntity` to look it up by name.

**Stage 3: Parse BotML and register bot**

```typescript
const botXml = readDSL("analyzer-bot.botml");
const botSpec = parseBotMLToSpec(botXml, join(DSL_DIR, "analyzer-bot.botml"));
const semanticLabel = botSpec.semantic_label ?? botSpec.name;
const bot = new Bot({
  name: botSpec.name,
  model_pool_name: botSpec.model_pool_name,
  max_tries: botSpec.max_tries,
  base_prompt_group: botSpec.prompt_group as any,
  static_args: {},
});
(bot as any).get_semantic_label_impl = (_request: any) => semanticLabel;

registry.register({ kind: "bot", name: "AnalyzerBot", source: "xml", instance: bot });
FFAgentBundle.registerBot("AnalyzerBot", bot);
```

Parses the BotML into a spec, constructs a `Bot` instance from the spec, overrides the semantic label getter, and registers the bot in both the `ComponentRegistry` and the legacy `FFAgentBundle` bot registry. The dual registration ensures compatibility with both the new registry-based lookup and older code paths.

**Stage 4: Parse PromptML and register prompt**

```typescript
const promptXml = readDSL("analyzer-prompt.promptml");
const promptAST = PromptML.parsePromptML(promptXml);
const promptGroup = PromptML.renderPromptGroup(promptAST);
registry.register({
  kind: "prompt",
  name: "analyzer-prompt",
  source: "xml",
  instance: promptGroup,
  type: "prompt-group",
});
```

Parses the standalone PromptML file into an AST, renders it into an SDK `PromptGroup` instance, and registers it. This prompt is registered separately from the bot's inline prompts, demonstrating that PromptML files can be used independently of BotML.

### API endpoints

The TypeScript class defines two API endpoints using the `@ApiEndpoint` decorator:

```typescript
@ApiEndpoint({ method: "POST", route: "run-analysis" })
async runAnalysis(body: any = {}): Promise<any> { ... }

@ApiEndpoint({ method: "GET", route: "dsl-info" })
async getDSLInfo(): Promise<any> { ... }
```

The `runAnalysis` method creates an entity, starts it, and collects progress envelopes via the async generator. The `getDSLInfo` method queries the `ComponentRegistry` to report which components are loaded.

Note that these TypeScript endpoints mirror the endpoints declared in the BundleML file. The TypeScript versions are the ones that actually run -- the BundleML endpoints serve as documentation and validation targets.

## Running the Example

### Prerequisites

- Node.js 20+
- pnpm package manager
- Access to the `@firebrandanalytics` npm registry
- PostgreSQL connection (for entity persistence)
- LLM Broker service connection (for bot execution)

### Build

From the `ff-agent-sdk` repository root:

```bash
pnpm install
pnpm run build
# or build only the E2E bundle:
cd apps/xml-e2e-bundle && pnpm run build
```

### Run locally

```bash
cd apps/xml-e2e-bundle
# Ensure environment variables are set (PG_SERVER, PG_DATABASE, LLM_BROKER_HOST, etc.)
pnpm run start
```

The server starts on port 3000 (configurable via the `PORT` environment variable).

### Test the endpoints

Check DSL component status:

```bash
curl http://localhost:3000/dsl-info
```

Expected response:

```json
{
  "bundle": "xml-e2e-bundle",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "components": {
    "entities": ["AnalysisWorkflow"],
    "bots": ["AnalyzerBot"],
    "prompts": ["analyzer-prompt"],
    "agentml_programs": ["AnalysisWorkflow"],
    "has_program": true,
    "has_prompt": true,
    "has_bot": true
  },
  "all_dsls_active": true
}
```

Run an analysis:

```bash
curl -X POST http://localhost:3000/run-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "quarterly revenue trends",
    "analysis_type": "financial",
    "requested_by": "demo-user"
  }'
```

Expected response (LLM output varies):

```json
{
  "success": true,
  "entity_id": "...",
  "progress_count": 5,
  "result": {
    "summary": "Analysis of quarterly revenue trends...",
    "findings": ["...", "..."],
    "confidence": 0.85
  },
  "message": "Analysis workflow completed via XML DSL pipeline"
}
```

### Run via dev mode

For development with live TypeScript compilation:

```bash
cd apps/xml-e2e-bundle
pnpm run dev
```

### Type checking

```bash
cd apps/xml-e2e-bundle
pnpm run typecheck
```

## Key Patterns Demonstrated

- **Four-DSL integration** -- all four DSLs (PromptML, BotML, AgentML, BundleML) are used together in a single bundle, demonstrating the full DSL stack
- **Dual prompt registration** -- the same prompt logic exists both as a standalone `.promptml` file and inline within the `.botml` file, showing both approaches side by side
- **Structured prompt groups** -- the BotML bot uses `<base>` and `<input>` sections to separate stable system instructions from per-request user content
- **Bot result capture** -- `<call-bot result="analysis_result">` stores the LLM's output in a workflow variable for subsequent use
- **Working memory persistence** -- `<wm-set key="analysis/latest-result">` persists the analysis result for later retrieval via the `getAnalysisHistory` method
- **Entity graph edges** -- `<graph-append edge-type="ProducedAnalysis">` creates a relationship edge with dynamic data fields, including an expression-computed timestamp
- **Progress envelopes** -- five `<yield-status>` instructions emit real-time progress through the async generator, enabling progress tracking
- **BundleML validation** -- the TypeScript init method parses and validates BundleML, logging the result as part of the startup sequence
- **ComponentRegistry convergence** -- all components (programs, bots, prompts) are registered in the shared singleton and verified at startup
- **Expression evaluation** -- conditions (`args.mode === 'detailed'`), interpolation (`{{input.topic}}`), and inline expressions (`new Date().toISOString()`) all use the shared `ExpressionEvaluator`
- **Eject-ready architecture** -- the XML files could be replaced with TypeScript implementations one at a time without affecting the rest of the bundle

## Extending the Example

Here are some modifications you can make to explore the DSL system further:

**Add a conditional branch to the workflow.** Insert an `<if>` block in the AgentML file that checks the analysis type and calls different bots depending on the value:

```xml
<if condition="args.analysis_type === 'financial'">
  <call-bot name="FinancialBot" result="analysis_result">
    <arg name="topic" value="args.topic"/>
  </call-bot>
  <else>
    <call-bot name="AnalyzerBot" result="analysis_result">
      <arg name="topic" value="args.topic"/>
    </call-bot>
  </else>
</if>
```

**Add a loop over multiple topics.** Modify the workflow to accept an array of topics and analyze each one:

```xml
<static-args>
  <arg name="topics" type="array"/>
</static-args>
<run-impl>
  <let name="results" value="[]"/>
  <loop items="args.topics" as="topic" index="i">
    <yield-status message="Analyzing topic {{i + 1}} of {{args.topics.length}}"/>
    <call-bot name="AnalyzerBot" result="result">
      <arg name="topic" value="topic"/>
    </call-bot>
    <wm-set key="analysis/results/{{i}}" value="result"/>
  </loop>
  <return value="results"/>
</run-impl>
```

**Add a second bot with a mixin.** Create a new `.botml` file with a `<mixins>` section:

```xml
<bot id="SummaryBot" name="SummaryBot" max-tries="3">
  <llm-options temperature="0.5">
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
  </llm-options>
  <mixins>
    <mixin type="StructuredOutputBotMixin">
      <config>
        <format>json</format>
      </config>
    </mixin>
  </mixins>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>Summarize the provided analysis results.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Summarize: {{input.data}}</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

**Add a human-in-the-loop approval step.** Insert a `<yield-waiting>` instruction before saving results:

```xml
<yield-waiting prompt="Analysis complete. Approve to save results?"/>
<wm-set key="analysis/latest-result" value="analysis_result"/>
```

**Add an endpoint for analysis history.** Add a GET endpoint to the BundleML file and a corresponding `@ApiEndpoint` in the TypeScript class to retrieve stored analysis results from working memory.

## See Also

- [DSL Overview](../) -- architecture and design rationale
- [Reference Guides](../reference/) -- complete element and attribute reference
- [Examples Index](../examples/) -- other available examples
