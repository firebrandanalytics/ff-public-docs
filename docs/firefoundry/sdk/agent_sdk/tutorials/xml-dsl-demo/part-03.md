# Part 3: Orchestrating AI with AgentML

By the end of this part, you will be able to read `analysis-workflow.agentml` instruction by instruction, understand what each step does at runtime, and explain how the AgentML interpreter bridges the gap between XML declarations and live LLM calls.

**What you'll learn:**
- How AgentML executes as an async generator — each instruction runs in sequence and can yield progress envelopes
- The difference between attribute-form expressions (`value="args.topic"`) and text-content expressions (`"detailed"`) and nested `<expr>` elements
- How `<wm-set>` and `<graph-append>` persist results beyond the HTTP response
- How the `<arg name="input" value="args"/>` mapping makes `input.*` available in BotML

---

## The Full AgentML Workflow

Here is the complete `analysis-workflow.agentml`:

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
      <arg name="input" value="args"/>
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

## Execution Diagram

The workflow executes as an async generator. Each step runs in sequence; the caller receives progress envelopes as they are emitted and the final result at the end.

```
Step 1  <yield-status message="Starting content analysis workflow"/>
          ↓ emits STATUS envelope to progress stream
Step 2  <yield-status message="Calling AnalyzerBot"/>
          ↓ emits STATUS envelope
Step 3  <call-bot name="AnalyzerBot" result="analysis_result">
          ↓ invokes AnalyzerBot; awaits LLM response (blocking — typically 1–5 seconds)
          ↓ stores return value in variable 'analysis_result'
Step 4  <yield-status message="Saving results to working memory"/>
          ↓ emits STATUS envelope
Step 5  <wm-set key="analysis/latest-result" value="analysis_result"/>
          ↓ writes analysis_result to entity working memory at path 'analysis/latest-result'
Step 6  <wm-set key="analysis/latest-topic" value="args.topic"/>
          ↓ writes args.topic to entity working memory at path 'analysis/latest-topic'
Step 7  <yield-status message="Updating entity graph"/>
          ↓ emits STATUS envelope
Step 8  <graph-append edge-type="ProducedAnalysis" target="self">
          ↓ creates a graph edge from this entity to itself with metadata fields
Step 9  <yield-status message="Content analysis workflow complete"/>
          ↓ emits STATUS envelope (5th and final status)
Step 10 <return value="analysis_result"/>
          ↓ terminates the generator; value becomes the entity's output
```

Total: 5 `<yield-status>` emissions, 1 `<call-bot>` (blocking), 2 `<wm-set>`, 1 `<graph-append>`, 1 `<return>`.

## Understanding the Key Elements

### `<agent>` and `<static-args>`

The `id` attribute (`AnalysisWorkflow`) must match the `type` attribute in BundleML's `<entity type="AnalysisWorkflow">`. This is how the bootstrap loader knows which AgentML program to use when an entity of type `AnalysisWorkflow` runs.

The `<static-args>` block declares typed inputs. These are the fields from `entity_factory.create_entity_node()`'s `data` object that become available as `args.*` expressions inside `<run-impl>`. The three declared args — `topic`, `analysis_type`, `requested_by` — map to the three fields passed by the `run-analysis` endpoint handler.

### `<yield-status>`

`<yield-status message="...">` emits a STATUS progress envelope to the entity's output stream. The polling endpoint (`entity-status`) collects these envelopes and returns them in the `progress` array. The caller can render progress feedback to the user as each status arrives.

The `message` attribute supports `{{interpolation}}`. For example, you could write `message="Analyzing: {{args.topic}}"` to include the input value in the status message. In this bundle the messages are fixed strings for clarity.

### `<call-bot>` and the `input.*` Mapping

The `<call-bot>` instruction invokes `AnalyzerBot` and stores the return value in a variable named `analysis_result` (via the `result` attribute). The bot is looked up by name in the `ComponentRegistry`.

The argument list is worth examining closely:

```xml
<call-bot name="AnalyzerBot" result="analysis_result">
  <arg name="input" value="args"/>
  <arg name="topic" value="args.topic"/>
  <arg name="analysis_type" value="args.analysis_type"/>
  <arg name="requested_by" value="args.requested_by"/>
  <arg name="mode">"detailed"</arg>
</call-bot>
```

The first `<arg name="input" value="args"/>` passes the **entire `args` object** as the `input` argument. Inside BotML's `<structured-prompt-group>`, `<call-bot>` arguments arrive under `input.*`. So `{{input.topic}}` in the bot's prompt resolves to `args.topic` from the AgentML context.

The remaining named args (`topic`, `analysis_type`, `requested_by`) are passed for completeness and are accessible under `input.topic`, `input.analysis_type`, and `input.requested_by` in the bot's prompt because they are also part of the `input` object. The `mode` arg uses the text-content expression form: the `<arg>` body is evaluated as a JavaScript expression, so `"detailed"` (with quotes) produces the string literal `detailed`.

### Expression Forms

AgentML supports three expression forms:

**Attribute form**: `value="args.topic"` — the attribute value is evaluated as a JavaScript expression. Property access, comparison, and most JS operators work here. The context object provides `args` (static args), any variables declared by `<let>`, and any variables captured by previous `<call-bot result="...">` instructions.

**Text-content form**: the body of a `<arg>` element is evaluated as a JS expression when there is no `value` attribute. Used for literal values like `"detailed"` (string literal with quotes) or `42` (number).

**Nested `<expr>`**: used inside `<field>` elements within `<graph-append>` or `<data>` blocks when the expression is too complex for an attribute value. In this workflow:

```xml
<field name="timestamp">
  <expr>new Date().toISOString()</expr>
</field>
```

The `<expr>` body evaluates `new Date().toISOString()` and assigns the result to the `timestamp` field.

### `<wm-set>` — Working Memory

Working memory is a key-value store scoped to the entity instance. Keys use path notation (`analysis/latest-result`). The `value` attribute is evaluated as a JS expression — here, `analysis_result` refers to the variable captured by `<call-bot result="analysis_result">`.

Working memory persists for the lifetime of the entity and can be read by other parts of the system. The `entity-status` endpoint's handler demonstrates reading entity I/O via the entity service API.

### `<graph-append>` — Entity Graph

`<graph-append edge-type="ProducedAnalysis" target="self">` creates a directed edge in the entity graph. `target="self"` means the edge points from this entity to itself (a self-reference marking what it produced). The `<data>` block attaches structured metadata to the edge: `topic`, `analysis_type`, and the ISO timestamp.

This pattern makes workflow results queryable via graph traversal, supporting downstream analytics and audit trails without any additional code.

### `<return>`

`<return value="analysis_result"/>` terminates the generator. The AgentML interpreter emits one final OUTPUT envelope with the value, which becomes the entity's output stored by the entity service. The `entity-status` handler checks `io.output` to determine whether the workflow is complete.

## Run and Verify

Confirm the progress array has exactly 5 entries and the result contains the expected keys:

```bash
# Submit and capture entity ID
ENTITY_ID=$(curl -s -X POST http://localhost:3000/api/run-analysis \
  -H "Content-Type: application/json" \
  -d '{"text":"Scientists discovered a new species of deep-sea fish.","analysis_type":"general","requested_by":"demo-user"}' \
  | jq -r .entity_id)

echo "Entity ID: $ENTITY_ID"

# Wait for LLM response
sleep 6

# Check progress count and result structure
curl -s "http://localhost:3000/api/entity-status?id=$ENTITY_ID" | jq '{
  status: .status,
  progress_count: (.progress | length),
  result_keys: (.result | keys)
}'
```

Expected output:
```json
{
  "status": "complete",
  "progress_count": 5,
  "result_keys": ["confidence", "findings", "sentiment", "summary", "topic"]
}
```

Five progress messages confirm all five `<yield-status>` instructions executed. The result keys confirm the LLM returned a well-formed JSON object matching the schema requested in the bot's prompt.

---

**Next**: [Part 4: Configuring LLM Behavior with BotML](./part-04.md) — read `analyzer-bot.botml` and understand how BotML configures the LLM, separates system from user prompts, and embeds PromptML elements inline.
