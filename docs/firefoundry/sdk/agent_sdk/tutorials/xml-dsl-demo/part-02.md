# Part 2: Wiring It All Together with BundleML

By the end of this part, you will be able to read `bundle.bundleml` from top to bottom and explain what every element does. BundleML is the manifest layer — it declares what exists, what's reachable via HTTP, and how the bundle behaves at startup. Think of it as the `package.json` of an agent bundle: no business logic, just declarations.

**What you'll learn:**
- The role of `<constructors>`, `<endpoints>`, and `<methods>` in a bundle manifest
- How CDATA handlers work and what variables are available inside them in xml-bundle-server mode
- Why xml-bundle-server mode exposes different handler variables than TypeScript-wiring mode
- How to verify the endpoint structure with a live `dsl-info` call

---

## The Full Bundle Manifest

Here is the complete `bundle.bundleml` from the Content Analyzer demo:

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
    <endpoint route="run-analysis" method="POST" response-type="json">
      <handler><![CDATA[
        const { text, analysis_type, requested_by } = body;
        if (!text) throw new Error('text is required');
        const app_id = (typeof get_agent_bundle_id !== 'undefined') ? get_agent_bundle_id() : '558707ed-d548-4a68-a384-1bf18f6da676';
        const node = await entity_factory.create_entity_node({
          app_id,
          specific_type_name: 'AnalysisWorkflow',
          general_type_name: 'AnalysisWorkflow',
          name: `AnalysisWorkflow:${(text || '').substring(0, 40)}`,
          data: { topic: text, analysis_type: analysis_type || 'general', requested_by: requested_by || 'demo-user' }
        });
        const entity = await entity_factory.get_entity(node.id);
        entity.runBackground();
        return { entity_id: node.id, status: 'pending' };
      ]]></handler>
    </endpoint>
    <endpoint route="entity-status" method="GET" response-type="json">
      <handler><![CDATA[
        const entity_id = query.id;
        if (!entity_id) throw new Error('id is required');
        const esUrl = (process.env.REMOTE_ENTITY_SERVICE_URL || 'http://firefoundry-core-entity-service') + ':' + (process.env.REMOTE_ENTITY_SERVICE_PORT || '8080');
        const nodeRes = await fetch(`${esUrl}/api/node/${entity_id}`);
        if (!nodeRes.ok) return { entity_id, status: 'not_found' };
        const node = await nodeRes.json();
        const ioRes = await fetch(`${esUrl}/api/node/${entity_id}/io`);
        const io = ioRes.ok ? await ioRes.json() : {};
        const edgesRes = await fetch(`${esUrl}/api/node/${entity_id}/edges`);
        const edges = edgesRes.ok ? await edgesRes.json() : {};
        const hasOutput = io.output && typeof io.output === 'object' && Object.keys(io.output).length > 0;
        if (hasOutput) {
          if (!global._xmlDslState) global._xmlDslState = {};
          global._xmlDslState.latestResult = io.output;
        }
        return {
          entity_id,
          status: hasOutput ? 'complete' : (node.status === 'Failed' || node.status === 'Error' ? 'error' : 'pending'),
          result: io.output || null,
          edges,
          progress: io.progress || []
        };
      ]]></handler>
    </endpoint>
    <endpoint route="latest-result" method="GET" response-type="json">
      <handler><![CDATA[
        return (global._xmlDslState || {}).latestResult || null;
      ]]></handler>
    </endpoint>
    <endpoint route="dsl-info" method="GET" response-type="json">
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
      return (global._xmlDslState || {}).latestResult || null;
    ]]></method>
  </methods>
</bundle>
```

## Walking Through Each Section

### `<bundle>` Root Element

The `id` attribute is a UUID that uniquely identifies this bundle in the FireFoundry registry. The `name` and `description` are metadata shown in tooling and log output. These attributes are required by `validateBundleML` and included in the parsed `BundleNode` AST.

### `<config>`

The `<port>3000</port>` element tells the xml-bundle-server which port to bind. This is the only required configuration key for a minimal bundle. Other `<config>` elements include `<file-size-limit>` (for binary endpoints) and `<max-files>`.

### `<constructors>`

This is where BundleML declares its components. Each `<entity>` and `<bot>` element names a type and points to a sibling DSL file via the `ref` attribute.

```xml
<entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
<bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
```

During `bootstrapFromBundleML()`, the server resolves each `ref` relative to the directory containing `bundle.bundleml`. It parses the AgentML file, binds an interpreter, and registers the program in the `ComponentRegistry` under the type name `AnalysisWorkflow`. It parses the BotML file, constructs a `Bot` instance, and registers it under `AnalyzerBot`. After this, HTTP endpoint handlers can refer to `AnalysisWorkflow` and `AnalyzerBot` by name.

Note: `bootstrapFromBundleML()` only processes `<entity>` and `<bot>` constructors. Standalone `.promptml` files are **not** automatically loaded. Prompts used at runtime must be embedded inline within BotML's `<structured-prompt-group>`.

### `<endpoints>`

Each `<endpoint>` declares an HTTP route. The `route` attribute is the path suffix appended to the server's base URL (e.g., `run-analysis` → `POST /api/run-analysis`). The `method` attribute is `GET` or `POST`. The `response-type` attribute is `json`, `binary`, or `iterator`.

The `<handler>` element contains a CDATA section with plain JavaScript (not TypeScript). The `<![CDATA[...]]>` wrapper allows JavaScript to contain characters like `<` and `>` without breaking the XML.

### CDATA Handler Context in xml-bundle-server Mode

This is one of the most important distinctions between xml-bundle-server mode and TypeScript-wiring mode. The variables available inside a CDATA handler differ between the two modes:

| Variable | xml-bundle-server mode | TypeScript-wiring mode |
|----------|------------------------|------------------------|
| `body` | Parsed request body (object) | Not available |
| `query` | Query string params (object) | Not available |
| `registry` | ComponentRegistry | Not available |
| `logger` | Logger instance | Not available |
| `entity_factory` | Entity factory | Not available |
| `request` | **NOT available** | Express request object |
| `bundle` | **NOT available** | Bundle class instance |

If you have seen examples from TypeScript-wiring bundles that use `request.body` or `bundle.registry`, those patterns will not work in xml-bundle-server mode. Use `body` and `registry` directly.

### The `run-analysis` Handler Pattern

The `run-analysis` handler demonstrates the async entity pattern:

```xml
<endpoint route="run-analysis" method="POST" response-type="json">
  <handler><![CDATA[
    const node = await entity_factory.create_entity_node({ ... });
    const entity = await entity_factory.get_entity(node.id);
    entity.runBackground();
    return { entity_id: node.id, status: 'pending' };
  ]]></handler>
</endpoint>
```

The handler creates an entity node, gets an entity instance, calls `runBackground()` (which starts the AgentML program asynchronously), and returns immediately with `{ entity_id, status: 'pending' }`. The caller is responsible for polling `entity-status` to learn when the workflow completes. This pattern allows the HTTP response to return in milliseconds while the LLM call proceeds in the background.

### `<methods>`

The `<methods>` section defines custom methods on the bundle class. These are callable internally by the server infrastructure. In this bundle, `getLatestResult` reads from `global._xmlDslState` — the same state that the `entity-status` handler populates when it detects a completed output.

## Run and Verify

Confirm that all four endpoints are accessible:

**1. Verify dsl-info (static metadata handler)**
Open `http://localhost:3000/api/dsl-info` in your browser. Expected:
```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

**2. Confirm run-analysis returns pending immediately**
Open the demo GUI at `http://localhost:4000`. Paste "Markets rose sharply on positive earnings data." into the **Text** field, select **general**, and click **Analyze**. The entity ID and `"status": "pending"` should appear in the GUI within milliseconds — before any LLM call has been made. This confirms the `run-analysis` handler's async pattern: `entity_factory.create_entity_node()` + `runBackground()` + immediate return.

If `run-analysis` returns an error, check that `BUNDLE_PATH` points to the correct directory and that the `AnalysisWorkflow` and `AnalyzerBot` types were registered at startup (look for registration log lines).

---

**Next**: [Part 3: Orchestrating AI with AgentML](./part-03.md) — trace the full execution path of `analysis-workflow.agentml` step by step.
