# XML Bundle Server

## Overview

The XML Bundle Server is a FireFoundry framework for running agent bundles defined entirely in the [FireFoundry XML DSL](../../sdk/agent_sdk/dsl/README.md). Unlike the other system agents, it has no fixed functionality — what it does is determined by the bundle definition you supply at startup. A single deployed instance reads a `BundleML` manifest and its referenced `AgentML` and `BotML` files, registers the entities, bots, endpoints, and methods declared inside, and exposes them over HTTP. Application developers can stand up new agent bundles without writing or deploying any TypeScript, and one image can serve many different bundles across many deployments.

## Purpose and Role

The XML Bundle Server addresses two related goals. First, it lets developers express agent bundles declaratively: prompts, bots, workflows, and HTTP endpoints all live in version-controlled XML files that are readable both to humans and to AI systems that generate or refactor bundle definitions. Second, it lets platform operators run those bundles as a fleet — one image, many configurations — instead of building, publishing, and deploying a custom container per bundle.

Typical use cases:

- Building a new agent bundle from scratch in XML without setting up a TypeScript build pipeline
- Standing up many small, focused agent bundles that share a single runtime image
- Letting LLM-driven bundle generators produce deployable units without round-tripping through code generation
- Iterating on bundle definitions in production by updating the mounted bundle configuration

## How It Works

A bundle is a set of XML DSL files anchored by a `BundleML` manifest:

- A **BundleML** file (`.bundleml`) is the root manifest. It declares which entity and bot types the bundle provides, which `.agentml` and `.botml` files define each one, what HTTP endpoints the bundle exposes (with inline JavaScript handlers), and any custom methods on the bundle itself.
- **AgentML** files (`.agentml`) define runnable entity workflows — declarative programs with progress yields, working-memory reads and writes, bot calls, entity creation, conditionals, and loops.
- **BotML** files (`.botml`) define bot configurations — model options, prompt groups, and tool wiring.
- **PromptML** files (`.promptml`) define reusable prompt-group components, either standalone or embedded inline in BotML.

At startup, the XML Bundle Server bootstrap loader reads the `BundleML` from a configured path, parses every referenced file, registers all the declared components, compiles the endpoint handlers, and starts the HTTP server. From that point on, the server behaves like any other FireFoundry agent bundle — only its behavior was defined in XML rather than TypeScript.

## Building and Running a Bundle

The end-to-end flow for an application developer:

### 1. Write the BundleML

A minimal `bundle.bundleml`:

```xml
<bundle id="my-bundle" name="My Bundle" description="Example bundle">
  <config>
    <port>3000</port>
  </config>
  <constructors>
    <entity type="GreetingWorkflow" ref="greeting-workflow.agentml"/>
    <bot type="GreetingBot" ref="greeting-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="greet" method="POST" response-type="json">
      <handler><![CDATA[
        return { greeting: "Hello, " + (body.name || "world") };
      ]]></handler>
    </endpoint>
  </endpoints>
</bundle>
```

### 2. Write the workflow and bot

`greeting-workflow.agentml`:

```xml
<agent id="GreetingWorkflow">
  <static-args>
    <arg name="name" type="string"/>
  </static-args>
  <run-impl>
    <yield-status message="Greeting started"/>
    <let name="message"><expr>"Hello, " + args.name</expr></let>
    <wm-set key="greeting/latest" value="message"/>
    <return value="message"/>
  </run-impl>
</agent>
```

`greeting-bot.botml`:

```xml
<bot id="GreetingBot" name="GreetingBot" max-tries="1">
  <llm-options temperature="0.2">
    <model-pool>your-default-model-pool</model-pool>
    <semantic-label>greeting-bot</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a friendly greeter.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Greet {{input.name}} warmly.</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

### 3. Deploy the bundle

Mount the bundle directory into a deployment of the XML Bundle Server image and point the `BUNDLE_PATH` environment variable at the `BundleML` file. The standard production pattern is the **fleet model**: package the bundle as a configuration object (a Kubernetes ConfigMap, a mounted volume, or equivalent in your environment), then deploy one instance of the XML Bundle Server per bundle, each instance mounted onto a different configuration. All instances share the same image.

Repeating the deploy with a different bundle configuration stands up another bundle from the same image. There is no per-bundle build step.

## API Endpoints

Once running, the server exposes a fixed set of standard endpoints plus whatever endpoints the hosted bundle declares.

### Standard (always available)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/health/ready` | Readiness probe |
| GET | `/health/live` | Liveness probe |
| GET | `/api/dsl-info` | Inventory of registered components (entities, bots, endpoints) |
| POST | `/invoke/:entityType` | Create and run an entity of the given declared type |
| POST | `/bot/:botName` | Invoke a registered bot directly |

### Custom (declared in BundleML)

Each `<endpoint>` in the BundleML becomes a route under `/api/`. An endpoint declared with `route="greet"` is reachable at `POST /api/greet`. The CDATA body of the `<handler>` runs as the endpoint implementation, with `body`, `query`, and the bundle context available to it.

## Configuration

The server is configured via environment variables. The main groups are:

- **Bundle source** — `BUNDLE_PATH` points at the BundleML file to load at startup (typically mounted from a configuration object or volume)
- **Service settings** — HTTP port, environment name
- **Platform connections** — Broker host and port, database connection, and other service URLs the hosted bundle's components need (entity persistence, working memory, document processing, etc., depending on what the bundle uses)

See the bundle's `.env.template` for the full list.

## Repository

Source code: [ff-app-system / xml-bundle-server](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/xml-bundle-server)

## Related Documentation

- [System Agents Catalog](./README.md)
- [FireFoundry XML DSL](../../sdk/agent_sdk/dsl/README.md) — The DSL system the server hosts
- [DSL Getting Started Tutorial](../../sdk/agent_sdk/dsl/getting-started-tutorial.md)
- [DSL Reference](../../sdk/agent_sdk/dsl/reference/README.md) — Full DSL reference
- [Agent SDK](../../sdk/agent_sdk/README.md) — The underlying agent framework for the components the server hosts
