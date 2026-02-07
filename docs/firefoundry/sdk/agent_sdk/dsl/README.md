# FireFoundry XML DSL System

The FireFoundry XML DSL system provides a declarative, XML-based alternative to the TypeScript Agent SDK for building AI agent bundles. Instead of writing TypeScript classes and method implementations, you define prompts, bots, workflows, and bundle manifests in structured XML files that the SDK parses, validates, and executes at runtime.

The DSL system is designed around a key principle: **define behavior in XML, wire it together in TypeScript**. XML files declare *what* your agent bundle does, while a thin TypeScript layer handles registration and infrastructure. This separation makes agent definitions readable, versionable, and accessible to both developers and AI systems that generate bundle configurations.

## What Are the XML DSLs?

The FireFoundry XML DSL system consists of four domain-specific languages, each targeting a distinct layer of the agent bundle architecture. Together, they cover the full lifecycle of an agent bundle -- from prompt construction through bot configuration, workflow orchestration, and bundle-level deployment manifests.

Each DSL has its own file extension, XML root element, parser, and validation schema. All four DSLs are optional; you can use one, some, or all of them in a single bundle. They interoperate cleanly with each other and with hand-written TypeScript.

## The Four DSLs

### PromptML (.promptml)

PromptML defines dynamic prompt groups using a component-based model. A `.promptml` file contains a `<prompt-group>` root element with one or more `<prompt>` children, each assigned a role (`system`, `user`, or `assistant`). Inside prompts, you compose content using `<text>`, `<section>`, `<if>`, `<for-each>`, and `<schema-node>` elements. Text content supports `{{interpolation}}` for runtime variable substitution. Conditional blocks (`<if condition="...">`) and iteration (`<for-each items="..." as="...">`) allow prompts to adapt to runtime context without any procedural code.

PromptML files can be used standalone (registered directly in the `ComponentRegistry`) or embedded inline within BotML files. The parser produces an AST of typed nodes (`PromptGroupNode`, `PromptNode`, `TextNode`, etc.) that the renderer converts into SDK `PromptGroup` instances.

**Key elements:** `<prompt-group>`, `<prompt>`, `<text>`, `<section>`, `<if>`, `<else>`, `<for-each>`, `<schema-node>`, `<field>`

### BotML (.botml)

BotML defines bot configurations -- stateless LLM orchestration blueprints that pair a prompt group with model settings and optional mixins. A `.botml` file uses a `<bot>` root element with attributes for `id`, `name`, and `max-tries`. Inside the bot, `<llm-options>` sets temperature, model pool, and semantic labels. The `<structured-prompt-group>` element organizes prompts into `<base>` (system prompts) and `<input>` (user prompts) sections, with inline PromptML content or file references to external `.promptml` files. Optional `<mixins>` and `<tools>` sections extend bot capabilities.

The BotML parser produces a `BotNode` AST, which `parseBotMLToSpec` converts into a `BotMLSpec` suitable for constructing SDK `Bot` instances. The semantic label, model pool, retry settings, and prompt group are all extracted and wired automatically.

**Key elements:** `<bot>`, `<llm-options>`, `<model-pool>`, `<semantic-label>`, `<mixins>`, `<mixin>`, `<structured-prompt-group>`, `<base>`, `<input>`, `<tools>`, `<tool>`

### AgentML (.agentml)

AgentML defines runnable entity workflows as declarative programs. An `.agentml` file uses an `<agent>` root element containing `<static-args>` (typed input declarations) and a `<run-impl>` block (the program body). The body is a sequence of instructions executed by the AgentML interpreter as an async generator, yielding progress envelopes along the way.

Available instructions include:

- **`<call-bot>`** -- invoke a registered bot and capture its result
- **`<yield-status>`** -- emit a status progress envelope to the caller
- **`<yield-waiting>`** -- emit a human-in-the-loop waiting envelope
- **`<wm-get>` / `<wm-set>`** -- read from and write to working memory
- **`<graph-append>`** -- add edges to the entity graph
- **`<call-entity>` / `<run-entity>`** -- create and execute child entities
- **`<let>` / `<if>` / `<loop>`** -- variables, conditionals, and iteration
- **`<return>`** -- return a value from the workflow
- **`<expr>`** -- evaluate arbitrary expressions

The parser produces an `AgentMLProgram` containing typed AST nodes. `bindInterpreter` attaches an `Interpreter` instance that walks the AST at runtime, evaluating expressions in a sandboxed context and delegating host operations (bot calls, working memory, graph mutations) through the `AgentMLHost` interface.

**Key elements:** `<agent>`, `<static-args>`, `<arg>`, `<run-impl>`, `<let>`, `<if>`, `<else-if>`, `<else>`, `<loop>`, `<call-bot>`, `<call-entity>`, `<run-entity>`, `<yield-status>`, `<yield-waiting>`, `<wm-get>`, `<wm-set>`, `<graph-append>`, `<return>`, `<expr>`

### BundleML (.bundleml)

BundleML defines the top-level manifest for an agent bundle. A `.bundleml` file uses a `<bundle>` root element with `id`, `name`, and optional `description` attributes. Inside the bundle, `<config>` sets runtime parameters (port, file size limits). `<constructors>` maps entity types and bot types to their XML definition files. `<endpoints>` defines HTTP routes with inline JavaScript handlers (in CDATA sections). `<methods>` defines custom methods on the bundle class, also with inline JavaScript.

BundleML serves primarily as a validation and documentation layer. The `parseBundleML` function extracts a `BundleNode` AST, and `validateBundleML` checks structural correctness (valid methods, required attributes, endpoint configuration). In the current implementation, the TypeScript wiring class reads the BundleML for validation but handles actual component registration programmatically.

**Key elements:** `<bundle>`, `<config>`, `<port>`, `<file-size-limit>`, `<max-files>`, `<constructors>`, `<entity>`, `<bot>`, `<endpoints>`, `<endpoint>`, `<handler>`, `<methods>`, `<method>`

## Why XML?

The choice of XML as the DSL surface is deliberate and driven by several practical considerations:

**Declarative by nature.** XML enforces a tree structure that maps naturally to the hierarchical relationships in agent bundles: bundles contain entities, entities contain workflows, workflows contain bot calls, bot calls contain prompts. The nesting makes these relationships explicit without requiring the reader to trace class hierarchies or method calls.

**AI-friendly authoring.** Large language models generate well-formed XML more reliably than they generate correct TypeScript class hierarchies. This matters because a core use case for the DSL system is AI-generated agent bundles, where an LLM produces the XML definitions based on high-level requirements.

**No compilation step.** XML files are parsed at runtime. You can edit a `.promptml` file and restart the bundle without running `tsc`. This shortens the iteration loop during development and simplifies deployment pipelines.

**Version-control friendly.** XML diffs are readable. When a prompt changes, the diff shows exactly which `<text>` element changed and in which `<section>`. This is harder to achieve with TypeScript prompt builders that use chained method calls.

**Clear separation of concerns.** The XML files contain only declarations and expressions. Infrastructure code (HTTP server setup, database connections, component registration) stays in TypeScript. This separation means domain experts can modify prompts and workflows without touching infrastructure code.

**Eject to TypeScript.** The DSL system is not a lock-in. Every XML-defined component maps to a concrete SDK class (`PromptGroup`, `Bot`, `XMLRunnableEntity`). If you outgrow the DSL, you can replace any XML file with a TypeScript implementation of the same component. The rest of the bundle continues working unchanged.

## When to Use DSLs vs TypeScript

| Scenario | Recommended Approach | Rationale |
|---|---|---|
| Simple prompt definitions | PromptML | Concise, readable, supports conditionals and interpolation |
| Bot with standard LLM settings | BotML | Declarative config avoids boilerplate `Bot` constructor code |
| Linear or branching workflows | AgentML | Workflow logic reads top-to-bottom; progress tracking is built in |
| Rapid prototyping | All four DSLs | Minimal code; focus on behavior, not infrastructure |
| AI-generated bundles | All four DSLs | LLMs produce well-formed XML reliably |
| Config-driven applications | DSLs + thin TypeScript | XML files become the "config" layer, TypeScript handles wiring |
| Complex custom business logic | TypeScript | Full language power for loops, error handling, external APIs |
| Advanced type safety requirements | TypeScript | Generic types, discriminated unions, compile-time checks |
| Existing TypeScript codebase | TypeScript (or mix) | No need to rewrite working code |
| Custom entity classes with state | TypeScript | `EntityNode` subclasses need TypeScript class definitions |
| Prompts in TypeScript, workflows in XML | Mix both | Use each DSL where it adds the most value |
| TypeScript entities, XML bots/prompts | Mix both | Common pattern: complex entities, declarative bots |

## Quick Example

Here is a minimal four-file bundle that demonstrates all four DSLs working together. This bundle defines a greeting agent that takes a user's name and returns a personalized greeting.

**`greeting-prompt.promptml`** -- the prompt definition:

```xml
<prompt-group>
  <prompt role="system">
    <text>You are a friendly greeting assistant.</text>
    <if condition="args.formal">
      <text>Use formal language and honorifics.</text>
    </if>
  </prompt>
  <prompt role="user">
    <text>Generate a greeting for: {{input.name}}</text>
  </prompt>
</prompt-group>
```

**`greeting-bot.botml`** -- the bot configuration:

```xml
<bot id="GreetingBot" name="GreetingBot" max-tries="2">
  <llm-options temperature="0.7">
    <model-pool>default-model-pool</model-pool>
    <semantic-label>greeting-generator</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a friendly greeting assistant.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Generate a greeting for: {{input.name}}</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

**`greeting-workflow.agentml`** -- the workflow orchestration:

```xml
<agent id="GreetingWorkflow">
  <static-args>
    <arg name="name" type="string"/>
  </static-args>
  <run-impl>
    <yield-status message="Generating greeting"/>
    <call-bot name="GreetingBot" result="greeting">
      <arg name="name" value="args.name"/>
    </call-bot>
    <wm-set key="greetings/latest" value="greeting"/>
    <return value="greeting"/>
  </run-impl>
</agent>
```

**`bundle.bundleml`** -- the bundle manifest:

```xml
<bundle id="greeting-bundle" name="Greeting Bundle">
  <config>
    <port>3000</port>
  </config>
  <constructors>
    <entity type="GreetingWorkflow" ref="greeting-workflow.agentml"/>
    <bot type="GreetingBot" ref="greeting-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="/greet" method="POST" response-type="json">
      <handler><![CDATA[
        const entity = await bundle.createEntity('GreetingWorkflow', request.body);
        return await entity.start();
      ]]></handler>
    </endpoint>
  </endpoints>
</bundle>
```

## Getting Started

- **[Reference Guides](reference/)** -- complete element and attribute reference for each DSL
- **[Examples](examples/)** -- annotated example bundles and walkthroughs
- **[E2E Bundle Walkthrough](examples/xml-e2e-bundle.md)** -- step-by-step analysis of a real deployed bundle using all four DSLs

## Architecture

Understanding how the DSLs map to SDK objects clarifies the runtime behavior. Each DSL file goes through a parse-validate-register pipeline during bundle initialization, and the resulting components are used at request time to execute workflows.

### PromptML to PromptGroup

The PromptML parser (`parsePromptML`) reads XML into a `PromptGroupNode` AST -- a tree of `PromptNode`, `TextNode`, `SectionNode`, `IfNode`, and `ForEachNode` objects. The renderer (`renderPromptGroup`) walks this AST and produces SDK `PromptGroup` instances. Interpolation markers (`{{expr}}`) are evaluated at render time using the `ExpressionEvaluator`.

The renderer handles conditional nodes by evaluating the condition expression against the current context and including or excluding child nodes accordingly. `<for-each>` nodes iterate over arrays, rendering their children once per item. This means the rendered `PromptGroup` is a flat, resolved prompt with no remaining control-flow nodes.

```
.promptml file --> parsePromptML() --> PromptGroupNode AST --> renderPromptGroup() --> PromptGroup
```

### BotML to Bot

The BotML parser (`parseBotMLToSpec`) reads XML into a `BotNode` AST, then converts it to a `BotMLSpec` object containing the model pool name, max tries, semantic label, prompt group, mixin definitions, and tool definitions. The TypeScript wiring layer uses this spec to construct an SDK `Bot` instance and register it in the `ComponentRegistry`.

The `BotMLSpec` is a plain data object that can be inspected and modified before constructing the `Bot`. This allows the TypeScript wiring layer to override or augment settings if needed (for example, changing the model pool based on environment variables).

```
.botml file --> parseBotMLToSpec() --> BotMLSpec --> new Bot({...}) --> ComponentRegistry
```

### AgentML to XMLRunnableEntity

The AgentML parser (`parseAgentML`) reads XML into an `AgentMLProgram` -- a typed AST of instruction nodes (`CallBotNode`, `YieldStatusNode`, `WMSetNode`, `GraphAppendNode`, etc.). `bindInterpreter` attaches an `Interpreter` instance to the program, making it executable. At runtime, `XMLRunnableEntity` looks up the program by `specific_type_name` from the `ComponentRegistry` and runs it through the interpreter, which yields progress envelopes via an async generator.

The interpreter maintains a `RuntimeContext` with scoped variable declarations. Each `<if>`, `<loop>`, and `<let>` creates a new scope. Variables declared in inner scopes are not visible in outer scopes after the block completes. The `<return>` instruction uses a `ReturnSignal` that propagates through all active scopes to terminate execution.

```
.agentml file --> parseAgentML() --> AgentMLProgram --> bindInterpreter() --> ComponentRegistry
                                                                                    |
                                                            XMLRunnableEntity.start() calls program.execute(host)
                                                                                    |
                                                            Interpreter walks AST, yields progress, returns result
```

### BundleML to Validation and Manifest

The BundleML parser (`parseBundleML`) reads XML into a `BundleNode` AST describing constructors, endpoints, methods, and config. `validateBundleML` checks structural correctness -- verifying that required attributes are present, HTTP methods are valid (`GET` or `POST`), response types are valid (`json`, `binary`, or `iterator`), and that constructor references point to recognized file extensions. In the current architecture, BundleML serves as a validated manifest -- the TypeScript wiring class reads it for validation and logging, while actual component registration is handled programmatically via `ComponentRegistry` and `FFAgentBundle`.

```
.bundleml file --> parseBundleML() --> BundleNode --> validateBundleML() --> validation result
                                           |
                                     used for logging, documentation, and structural validation
```

### The ComponentRegistry

All four DSLs converge at the `ComponentRegistry`, a singleton that holds registered bots, prompts, and AgentML programs. The TypeScript wiring class (which extends `FFAgentBundle`) reads DSL files during `init()`, parses them, and registers the resulting components:

1. Parse and validate BundleML (structural validation)
2. Parse AgentML and bind interpreter (register as `agentml-program`)
3. Parse BotML and construct Bot instance (register as `bot`)
4. Parse PromptML and render prompt group (register as `prompt`)

At request time, the entity factory creates `XMLRunnableEntity` instances that look up their AgentML program from the registry, and the interpreter resolves bot names through the registry during `<call-bot>` execution.

The registry provides query methods (`getBotNames()`, `hasAgentMLProgram()`, `hasPrompt()`, `hasBot()`) that are useful for diagnostics and health checks. The E2E bundle's `/dsl-info` endpoint demonstrates querying the registry to report loaded components.

### Expression Evaluation

All four DSLs share a common `ExpressionEvaluator` that handles:

- **Interpolation**: `{{expr}}` markers in text content and attribute values
- **Conditions**: Boolean expressions in `<if condition="...">` elements
- **Value expressions**: Arbitrary expressions in `<expr>`, `<let>`, `<wm-set>`, and argument values

Expressions run in a sandboxed VM context with access to declared variables (`input`, `args`, and any variables created by `<let>` or `<wm-get>`). The evaluator is shared across PromptML rendering and AgentML interpretation.

Expression syntax follows JavaScript conventions. You can use property access (`args.topic`), comparison operators (`args.mode === 'detailed'`), ternary expressions (`args.count > 0 ? 'yes' : 'no'`), array literals (`[1, 2, 3]`), object literals (`{ key: value }`), and method calls on built-in types (`new Date().toISOString()`).

### Validation and Error Reporting

Each DSL has a validation schema (defined in its `schema.ts` file) that specifies:

- Which attributes are required and optional for each element
- Which child elements are allowed within each parent
- Whether text content is permitted
- Custom validation functions for attribute values (e.g., checking that `role` is one of `system`, `user`, `assistant`)

Validation errors include source location information (file path, line number, column number) to help developers locate issues in their XML files. The `DSLError` class provides structured error codes (`DSL_PARSE_ERROR`, `DSL_VALIDATION_ERROR`, `DSL_INTERP_UNKNOWN_TAG`, etc.) for programmatic error handling.

### Trust Boundary

AgentML programs are authored by internal developers and deployed as part of agent bundles. The expression evaluator uses VM sandbox isolation, but runtime objects (entities, bot results) are exposed to expressions by design. Do not use AgentML to execute untrusted user-provided XML.
