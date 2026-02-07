# Getting Started with FireFoundry XML DSLs

Welcome to the hands-on tutorial for the FireFoundry XML DSL system. Over the next six chapters you will build a complete **Sentiment Analyzer** agent bundle from scratch, touching every layer of the stack -- from a single prompt all the way up to a running HTTP server.

### The Goal

You will build a Sentiment Analyzer bundle that accepts a topic over HTTP, sends it to an LLM for analysis, stores the results in working memory, records the event in the entity graph, and returns a structured JSON response to the caller. Every piece of behavior will be declared in XML; a thin TypeScript layer will wire the XML artifacts into the SDK at startup.

### The Philosophy

XML is the entry point, not a prison. The four DSLs let you express the most common patterns -- prompts, bot configurations, agent workflows, and bundle manifests -- without writing any imperative code. When you hit a complexity wall, you eject to TypeScript, keeping the declarative parts you already wrote. Think of the DSLs as a high-level authoring format that compiles down to the same SDK primitives you would use by hand.

### The Scope

This tutorial covers all four DSLs end-to-end: **PromptML**, **BotML**, **AgentML**, and **BundleML**. It does NOT cover deploying the finished bundle to Kubernetes -- that topic is handled in the Deployment Guide. By the end you will have a working local server you can test with `curl`.

### Prerequisites

- Node.js 20 or later
- `pnpm` package manager
- A working FireFoundry Agent SDK project (see the SDK quickstart guide)
- Basic familiarity with XML syntax

---

## Chapter 1: Your First Prompt with PromptML

PromptML is a declarative XML vocabulary for defining LLM prompts. Instead of building prompt strings by hand, you describe the structure of each prompt in a `.promptml` file. The SDK parses it into a `PromptGroup` object at startup, giving you type-safe, inspectable, and testable prompts without any imperative code.

A PromptML file maps closely to the way LLM APIs think about messages: you define a group of prompts, each with a **role** (`system` or `user`), and fill them with **text**, **sections**, and **conditionals**. The SDK renders the tree into the final message array at call time, resolving interpolation expressions against the runtime context.

### Step 1: Create the File

Create a new file at `src/dsl/analyzer-prompt.promptml`. Start with the root element:

```xml
<prompt-group>

</prompt-group>
```

Every PromptML file has either a `<prompt-group>` root (containing one or more `<prompt>` children) or a bare `<prompt>` root (which the SDK wraps automatically). Since our analyzer needs both a system prompt and a user prompt, we use `<prompt-group>`.

### Step 2: Add the System Prompt

Inside the group, add a system-role prompt with two `<text>` nodes:

```xml
<prompt role="system">
  <text>You are a sentiment analysis assistant for the FireFoundry platform.</text>
  <text>Your job is to analyze the provided topic and return a structured JSON response.</text>
</prompt>
```

Why two `<text>` nodes instead of one long string? Splitting instructions into separate nodes makes them individually addressable -- you can wrap any node in an `<if>` later, or reorder nodes without editing a wall of text.

### Step 3: Add a Conditional Instruction

PromptML supports `<if>` elements that evaluate a JavaScript expression at render time. When the condition is truthy the child nodes are included; otherwise they are skipped entirely. Add a conditional block after the two `<text>` nodes:

```xml
<if condition="args.mode === 'detailed'">
  <text>Provide detailed analysis with explanations for each finding.</text>
</if>
```

The expression `args.mode === 'detailed'` is evaluated in a sandboxed context. The `args` object is populated from the bot or entity that invokes this prompt. See the [Expressions Reference](reference/expressions-reference.md) for the full list of available variables.

### Step 4: Add the User Prompt

Add a second `<prompt>` with role `user`. This prompt uses **interpolation** (`{{expression}}`) to inject runtime values, and a `<section>` to group related context lines under a named heading.

```xml
<prompt role="user">
  <text>Analyze the following input: {{input.topic}}</text>
  <section name="context">
    <text>Analysis type: {{args.analysis_type}}</text>
    <text>Requested by: {{args.requested_by}}</text>
  </section>
  <text>Return your analysis as a JSON object with keys: summary, findings (array), and confidence (number 0-1).</text>
</prompt>
```

A few things to notice:

- `{{input.topic}}` reads from the `input` object, which is the primary data payload passed at call time.
- `{{args.analysis_type}}` and `{{args.requested_by}}` read from `args`, which carries the static and request arguments.
- The `<section name="context">` wrapper renders a labeled block, helping the LLM distinguish context metadata from the core instruction.

### The Complete File

Here is `src/dsl/analyzer-prompt.promptml` with all four steps assembled:

```xml
<prompt-group>
  <prompt role="system">
    <text>You are a sentiment analysis assistant for the FireFoundry platform.</text>
    <text>Your job is to analyze the provided topic and return a structured JSON response.</text>
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

### What This Produces

When the SDK parses this file it creates a `PromptGroup` containing two `Prompt` objects. At render time, given `{ topic: "remote work trends" }` and args `{ analysis_type: "sentiment", requested_by: "tutorial-user", mode: "detailed" }`, the system prompt renders to:

```
You are a sentiment analysis assistant for the FireFoundry platform.
Your job is to analyze the provided topic and return a structured JSON response.
Provide detailed analysis with explanations for each finding.
```

If `mode` were omitted, the third line would not appear at all.

For the full element and attribute catalog, see the [PromptML Reference](reference/promptml-reference.md).

---

## Chapter 2: Wrapping the Prompt in a Bot with BotML

A prompt by itself is just text. To actually call an LLM, you need a **bot**. In the FireFoundry SDK a bot combines a prompt with LLM configuration (model selection, temperature, retries) and runtime behavior (telemetry labels, mixins). BotML lets you declare all of this in a single XML file.

BotML reuses the PromptML parser internally, so every PromptML element you learned in Chapter 1 -- `<text>`, `<section>`, `<if>`, interpolation -- works identically inside a BotML file. The key difference is that prompts are nested inside a `<structured-prompt-group>`, which divides them into a **base** section (always included) and an **input** section (provided per request).

### Step 1: Create the File and Root Element

Create `src/dsl/analyzer-bot.botml`. The root element is `<bot>`:

```xml
<bot id="SentimentBot" name="SentimentBot" max-tries="2">

</bot>
```

- `id` and `name` identify this bot for AgentML references and the SDK registry.
- `max-tries="2"` means the SDK will retry the LLM call once if the first attempt fails.

### Step 2: Configure LLM Options

Add an `<llm-options>` block for temperature, model pool, and telemetry:

```xml
<llm-options temperature="0.3">
  <model-pool>firebrand-gpt-5.2-failover</model-pool>
  <semantic-label>sentiment-analyzer</semantic-label>
</llm-options>
```

- `temperature="0.3"` keeps output focused -- good for structured JSON.
- `<model-pool>` selects the server-side LLM pool the broker routes to.
- `<semantic-label>` tags every call in the telemetry system for filtering.

### Step 3: Add the Structured Prompt Group

The `<structured-prompt-group>` has two children: `<base>` (system prompt, always sent) and `<input>` (user prompt, varies per request). Here we embed prompts inline rather than referencing the external `.promptml`:

```xml
<structured-prompt-group>
  <base>
    <prompt role="system">
      <text>You are a sentiment analysis assistant for the FireFoundry platform.</text>
      <text>Your job is to analyze the provided topic and return a structured JSON response.</text>
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
```

Notice the user prompt references `input.analysis_type` (not `args.analysis_type`). When a bot is called from an AgentML workflow, the caller passes all values through the `input` object. The standalone `.promptml` from Chapter 1 remains valid for other use cases.

### The Complete File

```xml
<bot id="SentimentBot" name="SentimentBot" max-tries="2">
  <llm-options temperature="0.3">
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
    <semantic-label>sentiment-analyzer</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a sentiment analysis assistant for the FireFoundry platform.</text>
        <text>Your job is to analyze the provided topic and return a structured JSON response.</text>
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

### What This Produces

At parse time `parseBotMLToSpec()` returns a `BotMLSpec`:

| Field               | Value                                |
|---------------------|--------------------------------------|
| `name`              | `"SentimentBot"`                     |
| `model_pool_name`   | `"firebrand-gpt-5.2-failover"`      |
| `max_tries`         | `2`                                  |
| `semantic_label`    | `"sentiment-analyzer"`               |
| `prompt_group`      | Compiled `PromptGroup` from the inline prompts |

The spec is used to construct a `Bot` instance registered in the `ComponentRegistry`. When invoked, the SDK renders the prompts, sends them to the LLM broker, and returns the response.

For the full element catalog, see the [BotML Reference](reference/botml-reference.md).

---

## Chapter 3: Orchestrating a Workflow with AgentML

You have a prompt and a bot. Now you need something to drive the process: accept inputs, call the bot, store results, and report progress. That something is an **agent**, defined in AgentML.

AgentML is a procedural XML language for writing asynchronous workflows. Each `.agentml` file declares a single agent with typed arguments and an execution body. At runtime the SDK compiles it into a program and runs it through an interpreter that behaves as an **async generator** -- yielding progress envelopes (status updates, bot progress events) and returning a final result value.

Think of AgentML as a lightweight scripting language embedded in XML. It supports variable declarations, conditionals, loops, bot calls, working-memory operations, graph mutations, and status reporting.

### Step 1: Create the File and Define Arguments

Create `src/dsl/analysis-workflow.agentml`. Declare the inputs using `<static-args>`:

```xml
<agent id="SentimentWorkflow">
  <static-args>
    <arg name="topic" type="string"/>
    <arg name="analysis_type" type="string"/>
    <arg name="requested_by" type="string"/>
  </static-args>
</agent>
```

Each `<arg>` becomes available as `args.topic`, `args.analysis_type`, etc. throughout the execution body.

### Step 2: Add the Execution Body

All executable instructions live inside `<run-impl>`. Start with a status message:

```xml
<run-impl>
  <yield-status message="Starting sentiment analysis workflow"/>
</run-impl>
```

`<yield-status>` emits a `STATUS` envelope to the async generator. The calling code receives these in a loop and can use them for progress bars, logs, or real-time UI streaming.

### Step 3: Call the Bot

Use `<call-bot>` to invoke SentimentBot. The `result` attribute names the variable that stores the response:

```xml
<yield-status message="Calling SentimentBot"/>

<call-bot name="SentimentBot" result="analysis_result">
  <arg name="topic" value="args.topic"/>
  <arg name="analysis_type" value="args.analysis_type"/>
  <arg name="requested_by" value="args.requested_by"/>
  <arg name="mode">"detailed"</arg>
</call-bot>
```

Each `<arg>` maps a named parameter to a value. Two forms are available:

- **Attribute form**: `<arg name="topic" value="args.topic"/>` -- `value` is evaluated as an expression.
- **Text-content form**: `<arg name="mode">"detailed"</arg>` -- the body is evaluated as an expression (quotes make it a string literal).

### Step 4: Save Results to Working Memory

Working memory is a key-value store scoped to the entity. Use `<wm-set>` to persist data:

```xml
<yield-status message="Saving results to working memory"/>

<wm-set key="analysis/latest-result" value="analysis_result"/>
<wm-set key="analysis/latest-topic" value="args.topic"/>
```

The `key` is a literal string; the `value` is an expression. Retrieve these later with `<wm-get>` or programmatically via the entity client.

### Step 5: Record the Analysis in the Entity Graph

Use `<graph-append>` to create a relationship edge:

```xml
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
```

- `edge-type` is the relationship label.
- `target="self"` points the edge at the current entity.
- `<field>` elements carry data, using either a `value` attribute or a child `<expr>` for complex expressions.

### Step 6: Return the Final Result

```xml
<yield-status message="Sentiment analysis workflow complete"/>

<return value="analysis_result"/>
```

`<return>` terminates the generator and delivers its value as the final result.

### The Complete File

```xml
<agent id="SentimentWorkflow">
  <static-args>
    <arg name="topic" type="string"/>
    <arg name="analysis_type" type="string"/>
    <arg name="requested_by" type="string"/>
  </static-args>
  <run-impl>
    <yield-status message="Starting sentiment analysis workflow"/>

    <yield-status message="Calling SentimentBot"/>

    <call-bot name="SentimentBot" result="analysis_result">
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

    <yield-status message="Sentiment analysis workflow complete"/>

    <return value="analysis_result"/>
  </run-impl>
</agent>
```

### Understanding the Execution Flow

When the interpreter runs this program it produces this sequence:

1. **Yield** STATUS: "Starting sentiment analysis workflow"
2. **Yield** STATUS: "Calling SentimentBot"
3. **Execute** `call-bot`: Look up SentimentBot, render prompts, call the LLM broker, store response in `analysis_result`
4. **Yield** STATUS: "Saving results to working memory"
5. **Execute** `wm-set` twice
6. **Yield** STATUS: "Updating entity graph"
7. **Execute** `graph-append`: Create a ProducedAnalysis edge
8. **Yield** STATUS: "Sentiment analysis workflow complete"
9. **Return** `analysis_result`

The calling TypeScript code consumes these envelopes in a `while` loop over the generator (shown in Chapter 5).

For the full element catalog, see the [AgentML Reference](reference/agentml-reference.md).

---

## Chapter 4: Bundling Everything Together with BundleML

You now have three XML artifacts: a prompt, a bot, and a workflow. To turn them into a running service you need the **bundle manifest**. BundleML declares what the bundle contains, what HTTP endpoints it exposes, and what custom methods it provides.

Think of BundleML as the `package.json` of your agent bundle -- the single file that ties AgentML entities, BotML bots, and PromptML prompts into a deployable unit.

### Step 1: Create the Root Element

Create `src/dsl/bundle.bundleml`:

```xml
<bundle id="sentiment-analyzer-bundle"
        name="Sentiment Analyzer Bundle"
        description="Analyzes sentiment for a given topic using XML DSLs">
</bundle>
```

### Step 2: Add Configuration and Constructors

The `<config>` block sets server options. The `<constructors>` section registers entity and bot types with references to their source files:

```xml
<config>
  <port>3000</port>
</config>
<constructors>
  <entity type="SentimentWorkflow" ref="analysis-workflow.agentml"/>
  <bot type="SentimentBot" ref="analyzer-bot.botml"/>
</constructors>
```

The `ref` paths are informational for the parser (it records them in the AST). Actual file loading happens in the TypeScript wiring layer. The paths give tooling and developers a single place to see what files belong to the bundle.

### Step 3: Define HTTP Endpoints

Handlers are inline JavaScript inside `<![CDATA[...]]>` blocks to avoid XML escaping headaches. Two variables are available: `request` (HTTP request) and `bundle` (the agent bundle instance).

```xml
<endpoints>
  <endpoint route="/run-analysis" method="POST" response-type="json">
    <handler><![CDATA[
      const { topic, analysis_type, requested_by } = request.body;
      const entity = await bundle.createEntity('SentimentWorkflow', {
        topic, analysis_type, requested_by
      });
      const result = await entity.start();
      return result;
    ]]></handler>
  </endpoint>
  <endpoint route="/dsl-info" method="GET" response-type="json">
    <handler><![CDATA[
      return {
        bundle: 'sentiment-analyzer-bundle',
        dsls_loaded: ['PromptML', 'BotML', 'AgentML', 'BundleML']
      };
    ]]></handler>
  </endpoint>
</endpoints>
```

### Step 4: Add a Custom Method

Methods are callable programmatically on the bundle instance, outside the HTTP layer:

```xml
<methods>
  <method name="getAnalysisHistory"><![CDATA[
    return await bundle.getWorkingMemory('analysis/latest-result');
  ]]></method>
</methods>
```

### The Complete File

```xml
<bundle id="sentiment-analyzer-bundle"
        name="Sentiment Analyzer Bundle"
        description="Analyzes sentiment for a given topic using XML DSLs">
  <config>
    <port>3000</port>
  </config>
  <constructors>
    <entity type="SentimentWorkflow" ref="analysis-workflow.agentml"/>
    <bot type="SentimentBot" ref="analyzer-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="/run-analysis" method="POST" response-type="json">
      <handler><![CDATA[
        const { topic, analysis_type, requested_by } = request.body;
        const entity = await bundle.createEntity('SentimentWorkflow', {
          topic, analysis_type, requested_by
        });
        const result = await entity.start();
        return result;
      ]]></handler>
    </endpoint>
    <endpoint route="/dsl-info" method="GET" response-type="json">
      <handler><![CDATA[
        return {
          bundle: 'sentiment-analyzer-bundle',
          dsls_loaded: ['PromptML', 'BotML', 'AgentML', 'BundleML']
        };
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

The SDK parses this with `parseBundleML()` and validates it with `validateBundleML()`, checking well-formedness, required attributes, and handler syntax.

For the full element catalog, see the [BundleML Reference](reference/bundleml-reference.md).

---

## Chapter 5: Wiring It Up in TypeScript

The four XML files define the *what*. Now you need a thin TypeScript layer that tells the SDK *how* to load and connect them. You will create two files:

1. `src/agent-bundle.ts` -- the bundle class that parses and registers all DSL artifacts.
2. `src/index.ts` -- the server entry point.

### The Bundle Class: agent-bundle.ts

Start with imports. Each one corresponds to a DSL operation:

```typescript
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FFAgentBundle,          // Base class for agent bundles
  ApiEndpoint,            // Decorator for HTTP endpoints
  logger,                 // SDK structured logger
  createEntityClient,     // Creates entity client / component provider
  ComponentRegistry,      // Singleton registry for bots, prompts, programs
  XMLRunnableEntity,      // Entity class that runs AgentML programs
  Bot,                    // SDK bot class
  parseAgentML,           // Parses AgentML XML into AST
  bindInterpreter,        // Attaches interpreter to parsed program
  parseBotMLToSpec,       // Parses BotML XML into BotMLSpec
  parseBundleML,          // Parses BundleML XML into BundleMLDef
  validateBundleML,       // Schema validation for BundleML
  PromptML,               // parsePromptML + renderPromptGroup
  ensureMixinsRegistered, // Registers built-in bot mixins
} from "@firebrandanalytics/ff-agent-sdk";
```

Set up the DSL file reader and constructors map:

```typescript
ensureMixinsRegistered();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DSL_DIR = join(__dirname, "..", "src", "dsl");

function readDSL(filename: string): string {
  return readFileSync(join(DSL_DIR, filename), "utf-8");
}

const SentimentConstructors: Record<string, any> = {
  SentimentWorkflow: XMLRunnableEntity,
};

const APP_ID = "your-application-uuid-here";
const provider = createEntityClient(APP_ID);
```

Now define the bundle class. The `init()` method loads and registers all four DSLs:

```typescript
export class SentimentAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "your-bundle-uuid-here",
        application_id: APP_ID,
        name: "SentimentAnalyzerBundle",
        type: "agent_bundle",
        description: "Sentiment analysis bundle using all four XML DSLs",
      },
      SentimentConstructors,
      provider as any
    );
  }

  override async init() {
    await super.init();
    const registry = ComponentRegistry.getInstance();

    // 1. Parse and validate BundleML
    const bundleXml = readDSL("bundle.bundleml");
    const bundleDef = parseBundleML(bundleXml);
    const validation = validateBundleML(bundleXml, join(DSL_DIR, "bundle.bundleml"));
    logger.info(`BundleML: ${bundleDef.name} -- ${validation.valid ? "PASS" : "FAIL"}`);

    // 2. Parse AgentML and register the program
    const agentXml = readDSL("analysis-workflow.agentml");
    const program = parseAgentML(agentXml, join(DSL_DIR, "analysis-workflow.agentml"));
    bindInterpreter(program);
    registry.register({
      kind: "agentml-program", name: "SentimentWorkflow", source: "xml", program,
    });

    // 3. Parse BotML and register a Bot instance
    const botXml = readDSL("analyzer-bot.botml");
    const botSpec = parseBotMLToSpec(botXml, join(DSL_DIR, "analyzer-bot.botml"));
    const bot = new Bot({
      name: botSpec.name,
      model_pool_name: botSpec.model_pool_name,
      max_tries: botSpec.max_tries,
      base_prompt_group: botSpec.prompt_group as any,
      static_args: {},
    });
    const semanticLabel = botSpec.semantic_label ?? botSpec.name;
    (bot as any).get_semantic_label_impl = () => semanticLabel;
    registry.register({ kind: "bot", name: "SentimentBot", source: "xml", instance: bot });
    FFAgentBundle.registerBot("SentimentBot", bot);

    // 4. Parse standalone PromptML (optional -- for testing / reuse)
    const promptXml = readDSL("analyzer-prompt.promptml");
    const promptAST = PromptML.parsePromptML(promptXml);
    const promptGroup = PromptML.renderPromptGroup(promptAST);
    registry.register({
      kind: "prompt", name: "analyzer-prompt", source: "xml",
      instance: promptGroup, type: "prompt-group",
    });

    logger.info("All four DSLs loaded and registered successfully");
  }
```

Walk through each numbered section:

1. **BundleML**: Parse the manifest and validate its schema. This gives you the parsed definition for logging and tooling.
2. **AgentML**: Parse the workflow into an AST, bind the interpreter, and register it. When an `XMLRunnableEntity` of type `SentimentWorkflow` is created, the SDK looks up this program.
3. **BotML**: Parse into a `BotMLSpec`, construct a `Bot` from the spec, override the semantic label for telemetry, and register it.
4. **PromptML**: Parse the standalone prompt and register it. Optional -- the bot already has inline prompts -- but useful for testing or reuse.

#### The HTTP Endpoints

Add the analysis endpoint using the `@ApiEndpoint` decorator:

```typescript
  @ApiEndpoint({ method: "POST", route: "run-analysis" })
  async runAnalysis(body: any = {}): Promise<any> {
    const { topic, analysis_type, requested_by } = body;
    if (!topic) throw new Error("topic is required");

    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `analysis-${Date.now()}`,
      specific_type_name: "SentimentWorkflow",
      general_type_name: "SentimentWorkflow",
      data: { topic, analysis_type, requested_by },
    });

    const runnable = await this.entity_factory.get_entity(entity.id);
    const progress: any[] = [];
    let finalResult: any = null;

    // Consume the async generator from the AgentML interpreter
    const generator = await (runnable as any).start();
    while (true) {
      const { value, done } = await generator.next();
      if (done) { finalResult = value; break; }
      progress.push(value);
    }

    return {
      success: true,
      entity_id: entity.id,
      progress_count: progress.length,
      result: finalResult,
    };
  }

  @ApiEndpoint({ method: "GET", route: "dsl-info" })
  async getDSLInfo(): Promise<any> {
    const registry = ComponentRegistry.getInstance();
    return {
      bundle: "sentiment-analyzer-bundle",
      dsls_loaded: ["PromptML", "BotML", "AgentML", "BundleML"],
      components: {
        bots: registry.getBotNames(),
        has_program: registry.hasAgentMLProgram("SentimentWorkflow"),
        has_bot: registry.hasBot("SentimentBot"),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
```

The `while (true)` loop is the standard pattern for consuming AgentML workflow output. Each iteration receives either a progress envelope or the final result (when `done` is `true`).

### The Server Entry Point: index.ts

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { SentimentAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    logger.info(`Starting Sentiment Analyzer Bundle on port ${port}`);

    await createStandaloneAgentBundle(SentimentAgentBundle, { port });

    logger.info(`Bundle running on port ${port}`);
    logger.info(`  POST http://localhost:${port}/run-analysis`);
    logger.info(`  GET  http://localhost:${port}/dsl-info`);
    logger.info(`  GET  http://localhost:${port}/health`);

    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

`createStandaloneAgentBundle` instantiates your class, calls `init()` (triggering all DSL parsing), and starts an Express server with built-in `/health` and `/ready` endpoints.

---

## Chapter 6: Running and Testing Your Bundle

### Directory Structure

```
sentiment-analyzer/
  src/
    dsl/
      analyzer-prompt.promptml    (Chapter 1)
      analyzer-bot.botml          (Chapter 2)
      analysis-workflow.agentml   (Chapter 3)
      bundle.bundleml             (Chapter 4)
    agent-bundle.ts               (Chapter 5)
    index.ts                      (Chapter 5)
  package.json
  tsconfig.json
```

### Build and Run

```bash
pnpm install
pnpm run build      # or: turbo build
```

Set the required environment variables:

```bash
export PG_SERVER="your-postgres-host"
export PG_DATABASE="your-database-name"
export PG_PASSWORD="your-password"
export LLM_BROKER_HOST="your-broker-host"
export LLM_BROKER_PORT="your-broker-port"
```

Start the server:

```bash
node dist/index.js
```

Expected startup log output:

```
info: Starting Sentiment Analyzer Bundle on port 3000
info: BundleML: Sentiment Analyzer Bundle -- PASS
info: All four DSLs loaded and registered successfully
info: Bundle running on port 3000
info:   POST http://localhost:3000/run-analysis
info:   GET  http://localhost:3000/dsl-info
info:   GET  http://localhost:3000/health
```

### Test with curl

**Health check:**

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok" }
```

**DSL info:**

```bash
curl http://localhost:3000/dsl-info
```

```json
{
  "bundle": "sentiment-analyzer-bundle",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "components": {
    "bots": ["SentimentBot"],
    "has_program": true,
    "has_bot": true
  },
  "timestamp": "2026-02-07T12:00:00.000Z"
}
```

**Run an analysis:**

```bash
curl -X POST http://localhost:3000/run-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "remote work trends in 2026",
    "analysis_type": "sentiment",
    "requested_by": "tutorial-user"
  }'
```

```json
{
  "success": true,
  "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "progress_count": 5,
  "result": "{\"summary\":\"Overall positive sentiment...\",\"findings\":[\"Increasing adoption\",\"Employee satisfaction correlates with flexibility\"],\"confidence\":0.85}"
}
```

The `progress_count` of 5 corresponds to the five `<yield-status>` elements in the AgentML workflow.

### Common Errors and How to Fix Them

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module '@firebrandanalytics/ff-agent-sdk'` | Dependencies not installed | Run `pnpm install` |
| `Bot 'SentimentBot' not found in registry` | Bot registration failed or name mismatch | Verify `name` in `registry.register()` matches `<call-bot name="...">` |
| `AgentML program 'SentimentWorkflow' not registered` | Program registration failed | Check file path in `readDSL()` and `name` in `registry.register()` |
| `topic is required` | POST body missing `topic` | Send JSON with `Content-Type: application/json` |
| XML parse error (e.g., "Unexpected closing tag") | Malformed XML | Check for unclosed tags, unescaped `<` or `&`. Use `<![CDATA[...]]>` for inline JS |
| `Validation: FAIL` in BundleML | Missing attributes or invalid structure | Check `id`/`name` on `<bundle>`, `<handler>` children on `<endpoint>` |

---

## Recap: The Four DSLs at a Glance

| DSL       | Extension    | Root Element     | Defines                                | SDK Entry Point                        |
|-----------|-------------|------------------|----------------------------------------|----------------------------------------|
| PromptML  | `.promptml` | `<prompt-group>` | Structured LLM prompts                 | `PromptML.parsePromptML()`             |
| BotML     | `.botml`    | `<bot>`          | Bot config (LLM + prompts + behavior)  | `parseBotMLToSpec()`                   |
| AgentML   | `.agentml`  | `<agent>`        | Async workflow with progress tracking  | `parseAgentML()` + `bindInterpreter()` |
| BundleML  | `.bundleml` | `<bundle>`       | Bundle manifest (constructors + routes)| `parseBundleML()`                      |

Data flows left to right: PromptML defines prompts, BotML wraps prompts in bot configuration, AgentML orchestrates bots into workflows, and BundleML packages everything into a deployable service. TypeScript is the glue that loads, parses, and registers each artifact at startup.

---

## What's Next

You have built a complete agent bundle using all four FireFoundry XML DSLs. Here are the recommended next steps.

**Deepen your understanding of each DSL.** The reference guides cover every element, attribute, and validation rule:

- [PromptML Reference](reference/promptml-reference.md) -- all prompt elements, conditionals, loops, schema nodes
- [BotML Reference](reference/botml-reference.md) -- LLM options, mixins, tool bindings, structured prompts
- [AgentML Reference](reference/agentml-reference.md) -- control flow, entity calls, working memory, graph operations
- [BundleML Reference](reference/bundleml-reference.md) -- config options, constructor types, endpoint patterns, methods
- [Expressions Reference](reference/expressions-reference.md) -- interpolation syntax, sandboxed evaluation, built-in functions

**Explore advanced patterns.** Once you are comfortable with the basics, look into:

- Conditional branching and loops in AgentML (`<if>`, `<loop>`)
- Bot mixins for structured output (StructuredOutput mixin in BotML)
- Multi-bot orchestration with `<call-bot>` chains and variable passing
- Entity-to-entity delegation with `<call-entity>` and `<run-entity>`
- Working memory patterns for multi-step workflows

**Study the E2E example bundle.** The SDK repository includes a complete end-to-end test bundle that exercises all four DSLs together. It is a working reference implementation you can run locally and study.

**Learn about deployment.** The Deployment Guide covers building Docker images, configuring Kubernetes manifests, and deploying bundles to a cluster.
