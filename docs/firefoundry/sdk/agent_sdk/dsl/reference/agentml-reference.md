# AgentML Reference

AgentML is an XML-based domain-specific language for defining executable agent programs
within the FireFoundry Agent SDK. Each `.agentml` file declares a single agent with
static argument definitions and a procedural execution body. The interpreter runs the
program as an async generator, yielding progress envelopes (STATUS, BOT_PROGRESS,
WAITING) and returning a final result value.

This reference covers every element, attribute, and runtime behaviour defined by the
AgentML schema, loader, and interpreter.

---

## Table of Contents

1. [File Format](#file-format)
2. [Element Reference](#element-reference)
   - [agent](#agent)
   - [static-args](#static-args)
   - [arg](#arg)
   - [run-impl](#run-impl)
   - [let](#let)
   - [if](#if)
   - [else-if](#else-if)
   - [else](#else)
   - [loop](#loop)
   - [call-bot](#call-bot)
   - [call-entity](#call-entity)
   - [run-entity](#run-entity)
   - [yield-status](#yield-status)
   - [yield-waiting](#yield-waiting)
   - [wm-get](#wm-get)
   - [wm-set](#wm-set)
   - [graph-append](#graph-append)
   - [return](#return)
   - [expr](#expr)
   - [data](#data)
   - [field](#field)
3. [Execution Model](#execution-model)
4. [Variable Scoping](#variable-scoping)
5. [Return Mechanism](#return-mechanism)
6. [Progress Forwarding](#progress-forwarding)
7. [Expression Evaluation Context](#expression-evaluation-context)
8. [Validation and Error Handling](#validation-and-error-handling)
9. [Public API](#public-api)
10. [Complete Examples](#complete-examples)
11. [Cross-References](#cross-references)

---

## File Format

- **Extension**: `.agentml`
- **Root element**: `<agent>`
- **Encoding**: UTF-8
- **Schema validation**: Performed at parse time by `DSLValidator` using `agentMLSchema`

A minimal valid file:

```xml
<agent id="my-agent">
  <run-impl>
    <return value="'done'"/>
  </run-impl>
</agent>
```

---

## Element Reference

The elements below are grouped into three categories: structural (agent, static-args,
arg, run-impl), procedural (let, if, else-if, else, loop, call-bot, call-entity,
run-entity, yield-status, yield-waiting, wm-get, wm-set, graph-append, return, expr),
and data-carrying (data, field).

All procedural elements may appear inside `<run-impl>`, `<if>`, `<else-if>`, `<else>`,
and `<loop>`. The full set of procedural children is:

```
let, if, loop, call-bot, call-entity, run-entity,
yield-status, yield-waiting, wm-get, wm-set,
graph-append, return, expr
```

---

### agent

**Purpose**: Root element that declares a single AgentML program.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `id` | Yes | string | -- | Unique program identifier. Maps to `specific_type_name` in the entity system so `XMLRunnableEntity` can locate the program for execution. |
| `entity-type` | No | string | -- | Optional entity type name for the executing entity. |
| `display-name` | No | string | -- | Human-readable name shown in progress envelopes and UIs. |
| `description` | No | string | -- | Free-text description of what the agent does. |

**Children**: `<static-args>` (0 or 1), `<run-impl>` (exactly 1).

**Text Content**: Not allowed.

**Example**:

```xml
<agent id="InvoiceProcessor"
       display-name="Invoice Processor"
       description="Extracts and validates invoice line items">
  <static-args>
    <arg name="vendor_id" type="string" required="true"/>
  </static-args>
  <run-impl>
    <!-- procedural body -->
    <return value="'processed'"/>
  </run-impl>
</agent>
```

**Validation Rules**:

- `id` is required; the parser throws `DSL_PARSE_SCHEMA_VIOLATION` if missing.
- Must contain at least one child element (`requireChildren: true`).
- `<run-impl>` is mandatory; the loader throws if absent.
- At most one `<static-args>` block is permitted.

---

### static-args

**Purpose**: Container element that groups zero or more argument declarations for the agent program.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

No attributes.

**Children**: `<arg>` (0 or more).

**Text Content**: Not allowed.

**Example**:

```xml
<static-args>
  <arg name="topic" type="string" required="true"/>
  <arg name="max_results" type="number" default="10"/>
</static-args>
```

**Validation Rules**:

- Only `<arg>` children are allowed; any other child tag is rejected.
- The element is optional on `<agent>`. When absent, the program accepts no declared static arguments.

---

### arg

**Purpose**: Declares a single named argument for the agent program, or passes a named argument to a `<call-bot>` invocation.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | Yes | string | -- | Argument name. Used as the key in the `args` object at runtime. |
| `type` | No | `"string"` `"number"` `"boolean"` `"object"` `"array"` | -- | Type hint for documentation and optional validation. |
| `value` | No | string (expression) | -- | Expression that provides the argument value. Inside `<static-args>`, this sets a fixed default. Inside `<call-bot>`, the expression is evaluated at call time. |
| `required` | No | `"true"` / `"false"` | `"false"` | Whether the caller must supply this argument. Parsed as boolean string. |
| `default` | No | string | -- | Default value when the caller does not supply the argument. |
| `description` | No | string | -- | Human-readable description of the argument. |

**Children**: `<expr>` (0 or 1) -- alternative to the `value` attribute.

**Text Content**: Allowed. Interpreted as an expression when no `value` attribute and no `<expr>` child is present.

**Example** (inside `<static-args>`):

```xml
<arg name="analysis_type"
     type="string"
     required="true"
     description="Type of analysis to perform"/>
```

**Example** (inside `<call-bot>`):

```xml
<call-bot name="SummarizerBot" result="summary">
  <arg name="input" value="rawText"/>
  <arg name="max_tokens">500</arg>
</call-bot>
```

**Validation Rules**:

- `name` is required.
- Inside `<static-args>`, the `required` attribute is parsed with `=== 'true'`.
- When used as a child of `<call-bot>`, the value resolution order is: `value` attribute, then `<expr>` child, then text content.

---

### run-impl

**Purpose**: Execution body of the agent program containing all procedural logic.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

No attributes.

**Children**: All procedural tags (`let`, `if`, `loop`, `call-bot`, `call-entity`, `run-entity`, `yield-status`, `yield-waiting`, `wm-get`, `wm-set`, `graph-append`, `return`, `expr`).

**Text Content**: Not allowed.

**Example**:

```xml
<run-impl>
  <yield-status message="Starting work"/>
  <let name="data" value="input.payload"/>
  <call-bot name="Processor" result="output">
    <arg name="data" value="data"/>
  </call-bot>
  <return value="output"/>
</run-impl>
```

**Validation Rules**:

- Must contain at least one child element (`requireChildren: true`).
- Only procedural tags are allowed as children.
- Exactly one `<run-impl>` must exist inside `<agent>`.

---

### let

**Purpose**: Declares a new variable in the current scope and assigns it a value from an expression, a child tag result, or text content.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | Yes | string | -- | Variable name. Added to the current scope via `context.declare()`. |
| `value` | No | string (expression) | -- | Expression to evaluate and assign. |
| `type` | No | string | -- | Optional type hint (not enforced at runtime). |

**Children**: `<expr>`, `<call-bot>`, `<call-entity>`, `<wm-get>` -- the result of the last child becomes the variable value.

**Text Content**: Allowed. Used as an expression when no `value` attribute and no `<expr>` child is present.

**Example** (value attribute):

```xml
<let name="count" value="items.length"/>
```

**Example** (expr child):

```xml
<let name="timestamp">
  <expr>new Date().toISOString()</expr>
</let>
```

**Example** (child tag producing a value):

```xml
<let name="analysis">
  <call-bot name="AnalyzerBot">
    <arg name="input" value="rawData"/>
  </call-bot>
</let>
```

**Validation Rules**:

- `name` is required.
- The value resolution order is: `value` attribute, then `<expr>` child, then text content, then other child tags.
- If the variable name is already declared in the **current** scope, `RuntimeContext.declare()` throws `DSL_INTERP_DUPLICATE_DECLARATION`. A variable with the same name in a parent scope is shadowed (not an error).
- If a child node returns a `ReturnSignal`, the signal is propagated upward without assigning the variable.

---

### if

**Purpose**: Conditional branching with optional `<else-if>` and `<else>` blocks.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `condition` | Yes | string (expression) | -- | JavaScript expression evaluated as a boolean via `evaluateBoolean()`. Truthy values enter the then-branch. |

**Children**: All procedural tags, plus `<else-if>` and `<else>`.

**Text Content**: Not allowed.

**Example**:

```xml
<if condition="items.length > 0">
  <yield-status message="Processing {{items.length}} items"/>
  <loop items="items" as="item">
    <call-bot name="ItemProcessor">
      <arg name="item" value="item"/>
    </call-bot>
  </loop>
  <else-if condition="fallbackEnabled">
    <yield-status message="Using fallback path"/>
    <call-bot name="FallbackBot"/>
  </else-if>
  <else>
    <yield-status message="No items to process"/>
    <return value="'empty'"/>
  </else>
</if>
```

**Validation Rules**:

- `condition` is required.
- `<else-if>` and `<else>` must appear as direct children of `<if>`. The loader rejects stray `<else-if>` or `<else>` found outside of `<if>` with `DSL_PARSE_SCHEMA_VIOLATION`.
- During conversion, all children that are not `<else-if>` or `<else>` go into the then-branch.
- The interpreter pushes a new scope for each branch (`if:then`, `if:else-if`, `if:else`) and pops it after execution.
- Only the first branch whose condition evaluates to truthy is executed; remaining branches are skipped.

---

### else-if

**Purpose**: Alternative branch tested when all preceding `<if>` and `<else-if>` conditions are false.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `condition` | Yes | string (expression) | -- | JavaScript expression evaluated as a boolean. |

**Children**: All procedural tags.

**Text Content**: Not allowed.

**Example**:

```xml
<if condition="status === 'approved'">
  <return value="'proceed'"/>
  <else-if condition="status === 'pending'">
    <yield-waiting prompt="Awaiting approval"/>
  </else-if>
  <else-if condition="status === 'rejected'">
    <return value="'cancelled'"/>
  </else-if>
</if>
```

**Validation Rules**:

- Must be a direct child of `<if>`. If encountered at any other position, the loader throws `DSL_PARSE_SCHEMA_VIOLATION` with the message `<else-if> can only appear inside <if>`.
- `condition` is required.
- Multiple `<else-if>` blocks are permitted; they are evaluated in document order.

---

### else

**Purpose**: Default branch executed when the `<if>` condition and all `<else-if>` conditions are false.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

No attributes.

**Children**: All procedural tags.

**Text Content**: Not allowed.

**Example**:

```xml
<if condition="results.length > 0">
  <return value="results"/>
  <else>
    <yield-status message="No results found"/>
    <return value="null"/>
  </else>
</if>
```

**Validation Rules**:

- Must be a direct child of `<if>`. The loader throws if encountered elsewhere.
- At most one `<else>` per `<if>` block.
- Cannot have attributes.

---

### loop

**Purpose**: Iterates over an array, executing its body once per element with a dedicated scope for each iteration.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `items` | Yes | string (expression) | -- | Expression that must evaluate to an array. A non-array value causes `DSL_INTERP_TYPE_ERROR`. |
| `as` | No | string | `"item"` | Variable name bound to the current element in each iteration. |
| `index` | No | string | -- | Variable name bound to the zero-based iteration index. Only declared when this attribute is present. |

**Children**: All procedural tags.

**Text Content**: Not allowed.

**Example**:

```xml
<let name="tasks" value="input.taskList"/>
<loop items="tasks" as="task" index="i">
  <yield-status message="Processing task {{i + 1}} of {{tasks.length}}"/>
  <call-entity type="TaskRunner" name="task.id" result="runner">
    <data>
      <field name="payload" value="task.payload"/>
    </data>
  </call-entity>
  <run-entity ref="runner"/>
</loop>
```

**Validation Rules**:

- `items` is required.
- When `as` is omitted, the loader defaults it to `"item"`.
- The interpreter pushes a new scope per iteration (`loop:<as>:<index>`) and pops it afterward.
- If the `items` expression does not evaluate to an array, the interpreter throws `DSL_INTERP_TYPE_ERROR`.
- A `<return>` inside the loop body causes the `ReturnSignal` to propagate out of the loop immediately.

---

### call-bot

**Purpose**: Invokes a registered bot by name, passes arguments, forwards bot progress envelopes, and optionally stores the result.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | Yes | string | -- | Registered bot name, resolved via `ComponentRegistry.getBotOrThrow()`. |
| `result` | No | string | -- | Variable name to declare in the current scope, assigned the bot's return value. |

**Children**: `<arg>` (0 or more) -- each supplies a named argument to the bot.

**Text Content**: Not allowed.

**Example**:

```xml
<call-bot name="AnalyzerBot" result="analysis_result">
  <arg name="topic" value="args.topic"/>
  <arg name="analysis_type" value="args.analysis_type"/>
  <arg name="mode">"detailed"</arg>
</call-bot>
```

**Validation Rules**:

- `name` is required.
- Argument expressions are evaluated before the call. Each `<arg>` child resolves its value using the standard resolution order (value attribute, then `<expr>` child, then text content).
- The host calls `bot.start(request)` (not `bot.run()`), which returns an `AsyncGenerator`. Progress envelopes from the bot are forwarded (yielded) to the caller wrapped as `BOT_PROGRESS` envelopes.
- When `result` is specified, `context.declare(result, botResult)` is called after the bot completes.

---

### call-entity

**Purpose**: Creates or retrieves a child entity by type and instance name, with optional initialization data.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `type` | Yes | string | -- | Entity type name (maps to a registered entity class). |
| `name` | Yes | string | -- | Instance name used for idempotent creation. Prevents duplicate children on replay. |
| `result` | No | string | -- | Variable name to store the entity reference. |
| `idempotent` | No | `"true"` / `"false"` | `"true"` | Whether to use idempotent creation via `appendOrRetrieveCall`. Set to `"false"` only when duplicates are intentional. Currently, non-idempotent creation throws a runtime error. |

**Children**: `<data>` (0 or 1).

**Text Content**: Not allowed.

**Example**:

```xml
<call-entity type="AnalysisTask"
             name="analysis-main"
             result="task">
  <data>
    <field name="input_text" value="args.text"/>
    <field name="priority">"high"</field>
  </data>
</call-entity>
```

**Validation Rules**:

- Both `type` and `name` are required.
- The `idempotent` attribute defaults to `true` (parsed as `!== 'false'`).
- Data resolution: when `<data>` contains a single `<expr>`, the expression must evaluate to an object; otherwise individual `<field>` children are resolved as key-value pairs.
- The host's `callEntity()` method handles the actual entity lifecycle.

---

### run-entity

**Purpose**: Executes a previously created child entity and optionally stores its result.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `ref` | Yes | string | -- | Variable name referencing an entity object (typically set by a prior `<call-entity>` with `result`). |
| `result` | No | string | -- | Variable name to store the entity's final output. |

**Children**: None.

**Text Content**: Not allowed.

**Example**:

```xml
<call-entity type="DataFetcher" name="fetcher-1" result="fetcher"/>
<run-entity ref="fetcher" result="fetchedData"/>
<if condition="fetchedData.success">
  <return value="fetchedData.payload"/>
</if>
```

**Validation Rules**:

- `ref` is required.
- The referenced variable must exist in scope and hold a valid entity object. If it is not an object, the interpreter throws `DSL_INTERP_TYPE_ERROR`.
- The entity must have a `run()` method; otherwise a `DSL_INTERP_RUNTIME_ERROR` is thrown.
- Progress envelopes from the child entity are forwarded to the caller.

---

### yield-status

**Purpose**: Emits a STATUS progress envelope to the caller, reporting the agent's current activity.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `message` | No | string | `""` | Status message. Supports `{{expression}}` interpolation. |

**Children**: None.

**Text Content**: Not allowed (use the `message` attribute).

**Example**:

```xml
<yield-status message="Starting analysis workflow"/>
<yield-status message="Processing item {{i + 1}} of {{items.length}}"/>
```

**Validation Rules**:

- The `message` attribute is optional; when absent, the loader falls back to the element's text content, then to an empty string.
- Interpolation markers (`{{...}}`) inside the message are evaluated against the current variable context. Null or undefined expression results render as empty strings.
- The host creates the STATUS envelope with full entity metadata: `entity_id`, `entity_type`, `entity_name`, `status: "RUNNING"`, `sub_type: "ENTITY"`.

---

### yield-waiting

**Purpose**: Emits a WAITING progress envelope to pause execution and request human input (human-in-the-loop).

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `prompt` | No | string | `""` | Prompt message displayed to the human operator. Supports `{{expression}}` interpolation. |
| `timeout-ms` | No | string (integer) | -- | Optional timeout in milliseconds. Parsed to an integer via `parseInt()`. |

**Children**: None.

**Text Content**: Not allowed (use the `prompt` attribute).

**Example**:

```xml
<yield-waiting prompt="Please review the analysis and approve to continue"
               timeout-ms="300000"/>
```

**Validation Rules**:

- Both attributes are optional. When `prompt` is absent, the loader falls back to text content, then to an empty string.
- `timeout-ms` is parsed as a base-10 integer; non-numeric strings produce `NaN` (which becomes `undefined`).
- The host creates a WAITING envelope with entity metadata. The runtime handles message resumption.

---

### wm-get

**Purpose**: Reads a value from the entity's working memory and declares it as a variable in the current scope.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `key` | Yes | string | -- | Working memory path. Supports `{{expression}}` interpolation for dynamic keys. |
| `as` | Yes | string | -- | Variable name to declare with the retrieved value. |

**Children**: None.

**Text Content**: Not allowed.

**Example**:

```xml
<wm-get key="analysis/latest-result" as="previousResult"/>
<if condition="previousResult !== undefined">
  <yield-status message="Found previous result, skipping re-analysis"/>
  <return value="previousResult"/>
</if>
```

**Validation Rules**:

- Both `key` and `as` are required.
- The key is interpolated at runtime, so dynamic keys such as `"user/{{userId}}/prefs"` are valid.
- The value is declared in the current scope via `context.declare()`.
- If the working memory key does not exist, the host returns `undefined`.

---

### wm-set

**Purpose**: Writes a value to the entity's working memory.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `key` | Yes | string | -- | Working memory path. Supports `{{expression}}` interpolation. |
| `value` | No | string (expression) | -- | Expression to evaluate and store. |

**Children**: `<expr>` (0 or 1) -- alternative to the `value` attribute.

**Text Content**: Allowed. Used as an expression when no `value` attribute and no `<expr>` child is present.

**Example** (value attribute):

```xml
<wm-set key="analysis/latest-result" value="analysis_result"/>
<wm-set key="analysis/latest-topic" value="args.topic"/>
```

**Example** (expr child):

```xml
<wm-set key="analysis/timestamp">
  <expr>new Date().toISOString()</expr>
</wm-set>
```

**Validation Rules**:

- `key` is required.
- Value resolution order: `value` attribute, then `<expr>` child, then text content.
- The key is interpolated before the write.
- The operation is asynchronous; it awaits `host.setWorkingMemory()`.

---

### graph-append

**Purpose**: Appends a typed edge to the entity graph, connecting the current entity to a target.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `edge-type` | Yes | string | -- | The relationship type label (e.g., `"ProducedAnalysis"`, `"HasTask"`). |
| `target` | Yes | string | -- | Target entity identifier. Supports `{{expression}}` interpolation. |

**Children**: `<data>` (0 or 1) -- optional metadata payload attached to the edge.

**Text Content**: Not allowed.

**Example**:

```xml
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

**Validation Rules**:

- Both `edge-type` and `target` are required.
- The `target` attribute is interpolated at runtime.
- Data resolution follows the same rules as `<call-entity>`: a single `<expr>` inside `<data>` must evaluate to an object, or individual `<field>` children are resolved as key-value pairs.
- The operation is asynchronous; it awaits `host.appendEdge()`.
- If data is empty after resolution, `undefined` is passed to the host.

---

### return

**Purpose**: Terminates execution of the current program (or control-flow block) and propagates a return value.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `value` | No | string (expression) | -- | Expression to evaluate as the return value. |

**Children**: `<expr>` (0 or 1) -- alternative to the `value` attribute.

**Text Content**: Allowed. Used as an expression when no `value` attribute and no `<expr>` child is present.

**Example**:

```xml
<return value="analysis_result"/>
```

```xml
<return>
  <expr>{ status: 'done', count: items.length }</expr>
</return>
```

**Validation Rules**:

- All forms are optional; `<return/>` with no value returns `undefined`.
- Value resolution order: `value` attribute, then `<expr>` child, then text content.
- Internally, `<return>` creates a `ReturnSignal` object that propagates through nested `<if>`, `<loop>`, and `<let>` blocks without executing further nodes. See [Return Mechanism](#return-mechanism).

---

### expr

**Purpose**: Evaluates a JavaScript expression and returns the result. Standalone `<expr>` tags can appear as procedural statements; their result becomes the value of the enclosing context.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

No attributes.

**Children**: None.

**Text Content**: Required. The JavaScript expression to evaluate.

**Example**:

```xml
<expr>items.map(i => i.name).join(', ')</expr>
```

```xml
<let name="total">
  <expr>prices.reduce((sum, p) => sum + p, 0)</expr>
</let>
```

**Validation Rules**:

- Only text content is accepted; no attributes or children.
- The expression is evaluated in the sandboxed `ExpressionEvaluator` with a 1-second timeout.
- Forbidden patterns (e.g., `process`, `require`, `eval`, `__proto__`) are rejected at validation time.
- Maximum expression length: 10,000 characters.
- See [Expression Evaluation Context](#expression-evaluation-context) for the full list of available built-ins.

---

### data

**Purpose**: Container element for structured data, used as a child of `<call-entity>` and `<graph-append>`.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

No attributes.

**Children**: `<field>` (0 or more), `<expr>` (0 or 1).

**Text Content**: Allowed. When no `<field>` children are present, text content is treated as an expression that must evaluate to an object.

**Example** (field-based):

```xml
<data>
  <field name="topic" value="args.topic"/>
  <field name="priority">"high"</field>
</data>
```

**Example** (expression-based):

```xml
<data>
  <expr>({ topic: args.topic, priority: 'high' })</expr>
</data>
```

**Validation Rules**:

- When a single `<expr>` child is present, its result is used as the entire data payload and must evaluate to an object. A non-object result triggers `DSL_INTERP_TYPE_ERROR` (for `<call-entity>`) or is silently ignored (for `<graph-append>`).
- When `<field>` children are present, they are resolved as key-value pairs.
- Text content without `<field>` children is treated as an expression (stored under the internal `__expr__` key).

---

### field

**Purpose**: Declares a single key-value pair within a `<data>` block.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | Yes | string | -- | Field key in the resulting data object. |
| `value` | No | string (expression) | -- | Expression to evaluate for the field value. |

**Children**: `<expr>` (0 or 1) -- alternative to the `value` attribute.

**Text Content**: Allowed. Used as an expression when no `value` attribute and no `<expr>` child is present.

**Example**:

```xml
<field name="topic" value="args.topic"/>
<field name="timestamp">
  <expr>new Date().toISOString()</expr>
</field>
<field name="mode">"batch"</field>
```

**Validation Rules**:

- `name` is required.
- Value resolution order: `value` attribute, then `<expr>` child, then text content.
- All values are evaluated as expressions in the current context.

---

## Execution Model

The AgentML interpreter is an **async generator** (`AsyncGenerator<any, unknown, undefined>`). When a program executes, it yields zero or more progress envelopes and returns a final value.

### Progress Envelope Types

| Envelope Type | Source Tag | Description |
|---------------|-----------|-------------|
| `STATUS` | `<yield-status>` | Reports current activity. Contains `entity_id`, `entity_type`, `entity_name`, `status: "RUNNING"`, `sub_type: "ENTITY"`, and `message`. |
| `BOT_PROGRESS` | `<call-bot>` | Wraps progress from a bot invocation. Contains `entity_id`, `entity_type`, `entity_name`, and the bot's `progress` payload. |
| `WAITING` | `<yield-waiting>` | Requests human input. Contains `entity_id`, `entity_type`, `entity_name`, `sub_type: "ENTITY"`, `message` (prompt), and optionally `timeout_ms`. |
| `VALUE` | (child entity) | Progress forwarded from `<run-entity>`. The envelope type depends on the child entity's implementation. |
| `COMPLETED` | (framework) | Emitted by the framework after `execute()` returns. Not produced directly by AgentML tags. |

### Execution Flow

1. The `Interpreter.execute()` method creates a fresh `RuntimeContext` with a global scope.
2. If `input` is provided, it is declared as the variable `input` in the global scope.
3. If `args` is provided, it is declared as the variable `args` in the global scope.
4. Nodes from `<run-impl>` are executed sequentially via `executeNodes()`.
5. Each node may yield envelopes (forwarded to the caller) and/or produce a value.
6. If a `ReturnSignal` is encountered at the top level, it is unwrapped and returned as the program's final value.
7. If no `<return>` is executed, the result of the last node becomes the program's return value.

---

## Variable Scoping

AgentML uses **lexical scoping** implemented via `RuntimeContext`, which maintains a stack of `Scope` objects.

### Scope Lifecycle

| Event | Effect |
|-------|--------|
| Program start | Global scope created. `input` and `args` declared. |
| `<let>` | Declares variable in the current (innermost) scope. |
| `<if>` then-branch | Pushes scope `if:then`, pops after execution. |
| `<else-if>` branch | Pushes scope `if:else-if`, pops after execution. |
| `<else>` branch | Pushes scope `if:else`, pops after execution. |
| `<loop>` iteration | Pushes scope `loop:<as>:<index>`, declares `as` and `index` variables, pops after iteration. |
| `<call-bot>` with `result` | Declares result variable in the current scope. |
| `<call-entity>` with `result` | Declares result variable in the current scope. |
| `<run-entity>` with `result` | Declares result variable in the current scope. |
| `<wm-get>` | Declares the `as` variable in the current scope. |

### Variable Resolution

Variables are resolved by searching from the innermost scope outward to the global scope. The first match wins. This means inner scopes **shadow** outer scopes:

```xml
<let name="x" value="1"/>
<if condition="true">
  <!-- This shadows the outer 'x' within this scope -->
  <let name="x" value="2"/>
  <!-- x is 2 here -->
</if>
<!-- x is 1 here (the if-scope was popped) -->
```

### Duplicate Declaration

Declaring a variable that already exists in the **same** scope throws `DSL_INTERP_DUPLICATE_DECLARATION`. Shadowing a variable from a parent scope is permitted.

---

## Return Mechanism

The `<return>` tag creates a `ReturnSignal` object that propagates through all nested control-flow structures until it reaches the top-level `execute()` method.

### Propagation Rules

1. `executeNodes()` checks each node's result. When a `ReturnSignal` is detected, it is returned immediately -- no further nodes in the sequence execute.
2. `executeLoop()` checks for `ReturnSignal` after each iteration body. On detection, it returns the signal without continuing the loop.
3. `executeLet()` checks if a child node produced a `ReturnSignal`. If so, the signal is propagated **without** declaring the variable.
4. `executeIf()` propagates the signal from whichever branch executed.
5. At the top level, `execute()` unwraps the `ReturnSignal` and returns its `.value` as the program result.

```xml
<loop items="items" as="item">
  <if condition="item.type === 'stop'">
    <!-- This return exits the loop AND the entire program -->
    <return value="'stopped early'"/>
  </if>
</loop>
<!-- This line never executes if a 'stop' item was found -->
<return value="'completed all'"/>
```

---

## Progress Forwarding

When the interpreter encounters a `<call-bot>` or `<run-entity>`, it iterates the async generator returned by the host and **yields** each progress envelope to its own caller. This creates a transparent progress pipeline:

```
AgentML program
  -> <call-bot> yields BOT_PROGRESS envelopes
  -> <run-entity> yields whatever the child entity yields
  -> <yield-status> yields STATUS envelopes
  -> <yield-waiting> yields WAITING envelopes
```

All envelopes are forwarded without transformation (except `<call-bot>`, which wraps bot progress in a `BOT_PROGRESS` envelope containing entity metadata).

---

## Expression Evaluation Context

All expressions (in `value` attributes, `<expr>` tags, `condition` attributes, and `{{interpolation}}`) are evaluated by the `ExpressionEvaluator` using Node.js `vm.runInNewContext()`.

### Available Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `input` | Program invocation | The input data record passed to `Interpreter.execute()`. |
| `args` | Program invocation | The static arguments record passed to `Interpreter.execute()`. |
| Any `<let>` variable | `<let>` declaration | Variables declared in the current or any parent scope. |
| Loop `as` variable | `<loop>` | Current iteration element (default name: `item`). |
| Loop `index` variable | `<loop>` | Current zero-based iteration index (only when `index` attribute is set). |
| `result` variables | `<call-bot>`, `<call-entity>`, `<run-entity>`, `<wm-get>` | Variables declared by the `result` or `as` attributes. |

### Available Built-ins

The sandbox exposes a restricted set of JavaScript built-in objects:

| Built-in | Available |
|----------|-----------|
| `Math` | Yes |
| `Number` | Yes |
| `String` | Yes |
| `Boolean` | Yes |
| `Array` | Yes |
| `Object` | Yes |
| `Date` | Yes |
| `RegExp` | Yes |
| `Map` | Yes |
| `Set` | Yes |
| `JSON` | Yes |
| `parseInt`, `parseFloat` | Yes |
| `isNaN`, `isFinite` | Yes |
| `encodeURIComponent`, `decodeURIComponent` | Yes |
| `undefined`, `NaN`, `Infinity` | Yes |
| `process`, `global`, `require`, `eval`, `fetch` | **Blocked** |

### Forbidden Patterns

The following patterns are rejected **before** evaluation via static regex checks:

- `process`, `global`, `globalThis`, `window`, `document`
- `eval`, `Function`
- `__proto__`, `constructor`, `prototype`
- `require`, `import`
- `fetch`, `XMLHttpRequest`, `WebSocket`

### Expression Timeout

Each expression has a 1-second execution timeout. Expressions that exceed this limit throw `DSL_INTERP_EXPRESSION_ERROR`.

### Context Variable Immutability

All context variables passed to the sandbox are deep-frozen via `Object.freeze()` (recursive). Expressions cannot mutate variables; attempting to do so throws a `TypeError` in strict mode.

### Interpolation Syntax

Attributes that support interpolation use `{{expression}}` markers:

```xml
<yield-status message="Processing item {{i + 1}} of {{items.length}}"/>
```

Interpolation is supported in:
- `<yield-status>` `message` attribute
- `<yield-waiting>` `prompt` attribute
- `<wm-get>` `key` attribute
- `<wm-set>` `key` attribute
- `<graph-append>` `target` attribute

Unclosed `{{` markers are treated as literal text. Expressions that evaluate to `null` or `undefined` render as empty strings.

---

## Validation and Error Handling

### Parse-Time Validation

The `parseAgentML()` function performs two validation passes:

1. **XML parsing** via `parseXML()` -- produces a structured `XMLElement` tree. Malformed XML throws `DSL_PARSE_INVALID_XML`.
2. **Schema validation** via `validateDocument()` against `agentMLSchema` -- checks required attributes, allowed children, and structural constraints. Failures throw `DSL_PARSE_SCHEMA_VIOLATION`.

### Schema Enforcement Rules

- **Unknown tags**: Any tag not in `agentMLSchema.elements` is rejected at parse time.
- **Stray else-if / else**: `<else-if>` and `<else>` outside of `<if>` throw `DSL_PARSE_SCHEMA_VIOLATION`.
- **Required attributes**: Missing required attributes (e.g., `id` on `<agent>`, `condition` on `<if>`) throw `DSL_PARSE_SCHEMA_VIOLATION`.
- **Invalid children**: Children not listed in `allowedChildren` for a given element are rejected.
- **Empty containers**: Elements with `requireChildren: true` (`<agent>`, `<run-impl>`) must have at least one child.

### Runtime Error Codes

| Code | Cause |
|------|-------|
| `DSL_INTERP_UNKNOWN_TAG` | Interpreter encounters an unrecognized node type. |
| `DSL_INTERP_TYPE_ERROR` | Type mismatch: `<loop>` items not an array, `<run-entity>` ref not an entity, `<call-entity>` data expression not an object. |
| `DSL_INTERP_DUPLICATE_DECLARATION` | Variable already declared in the current scope. |
| `DSL_INTERP_VARIABLE_NOT_DECLARED` | Variable not found in any scope (read or write). |
| `DSL_INTERP_EXPRESSION_ERROR` | Expression evaluation failed (syntax error, timeout, runtime error). |
| `DSL_INTERP_FORBIDDEN_PATTERN` | Expression contains a forbidden pattern (security check). |
| `DSL_INTERP_RUNTIME_ERROR` | General runtime error (non-runnable entity, non-idempotent creation, scope underflow). |

### Source Location Tracking

All AST nodes include an optional `location` property (`{ file, line, column }`), attached during parsing. Error messages include this location for precise debugging.

---

## Public API

The AgentML module exports the following from `@firebrandanalytics/ff-agent-sdk`:

### parseAgentML

```typescript
function parseAgentML(xml: string, filePath?: string): AgentMLProgram;
```

Parses an AgentML XML string into an `AgentMLProgram` AST. The optional `filePath` is attached to source locations for error reporting.

### bindInterpreter

```typescript
function bindInterpreter(
  program: AgentMLProgram,
  interpreter?: Interpreter
): AgentMLProgram;
```

Binds an interpreter to a parsed program, filling in the `execute` method. If no interpreter is provided, a new default instance is created. After binding, the program can be executed:

```typescript
const gen = program.execute(host, input, args);
```

### Interpreter

```typescript
class Interpreter {
  constructor(config?: InterpreterConfig);
  execute(
    program: AgentMLProgram,
    host: AgentMLHost,
    input?: Record<string, unknown>,
    args?: Record<string, unknown>
  ): AsyncGenerator<any, unknown, undefined>;
}
```

The interpreter executes an `AgentMLProgram` against a host. The `InterpreterConfig` accepts an optional `evaluator` (shared `ExpressionEvaluator` instance).

### AgentMLHost

```typescript
class AgentMLHost {
  constructor(config: AgentMLHostConfig);
  callBot(name: string, requestArgs: Record<string, unknown>):
    AsyncGenerator<RunnableEntityBotProgressEnvelope, unknown, undefined>;
  callEntity(typeName: string, instanceName: string,
    data: Record<string, unknown>, options?: { idempotent?: boolean }):
    Promise<IEntityNode>;
  runEntity(entity: IEntityNode): AsyncGenerator<any, unknown, undefined>;
  getWorkingMemory(key: string): Promise<unknown>;
  setWorkingMemory(key: string, value: unknown): Promise<void>;
  appendEdge(edgeType: string, targetId: string,
    data?: Record<string, unknown>): Promise<void>;
  createStatusEnvelope(message: string): Promise<RunnableEntityProgressStatusEnvelope>;
  createWaitingEnvelope(prompt: string, options?: { timeout_ms?: number }):
    Promise<RunnableEntityProgressWaitingEnvelope>;
}
```

`AgentMLHostConfig` requires:
- `entity` -- the `IEntityNode` executing the program
- `factory` -- an `EntityFactory` for creating child entities
- `registry` (optional) -- a `ComponentRegistry`; defaults to the singleton instance

### Type Exports

All AST node types are exported from the module:

- `AgentMLProgram`, `AgentMLNode`, `StaticArgDefinition`
- `LetNode`, `IfNode`, `LoopNode`, `CallBotNode`, `CallEntityNode`
- `RunEntityNode`, `YieldStatusNode`, `YieldWaitingNode`
- `WMGetNode`, `WMSetNode`, `ReturnNode`, `GraphAppendNode`, `ExprNode`

---

## Complete Examples

### Example 1: Simple Analysis Workflow

A straightforward workflow that calls a bot, saves results to working memory, updates the entity graph, and returns.

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

### Example 2: Conditional Branching with Validation

An agent that validates input, branches on analysis type, and handles error cases.

```xml
<agent id="SmartRouter"
       display-name="Smart Router"
       description="Routes requests based on type with validation">
  <static-args>
    <arg name="request_type" type="string" required="true"
         description="Type of request: 'financial', 'technical', or 'general'"/>
    <arg name="payload" type="object" required="true"/>
    <arg name="require_approval" type="boolean" default="false"/>
  </static-args>
  <run-impl>
    <yield-status message="Validating request"/>

    <!-- Check for required fields -->
    <if condition="!args.request_type">
      <return>
        <expr>({ error: 'request_type is required', code: 'INVALID_INPUT' })</expr>
      </return>
    </if>

    <!-- Route based on type -->
    <if condition="args.request_type === 'financial'">
      <yield-status message="Routing to financial analysis"/>

      <call-bot name="FinancialAnalyzerBot" result="result">
        <arg name="data" value="args.payload"/>
        <arg name="depth">"comprehensive"</arg>
      </call-bot>

      <else-if condition="args.request_type === 'technical'">
        <yield-status message="Routing to technical analysis"/>

        <call-bot name="TechnicalReviewBot" result="result">
          <arg name="data" value="args.payload"/>
        </call-bot>

      </else-if>
      <else>
        <yield-status message="Routing to general-purpose bot"/>

        <call-bot name="GeneralBot" result="result">
          <arg name="data" value="args.payload"/>
        </call-bot>
      </else>
    </if>

    <!-- Optional human approval gate -->
    <if condition="args.require_approval">
      <yield-waiting prompt="Review the result and approve to continue"
                     timeout-ms="600000"/>
    </if>

    <!-- Save result -->
    <wm-set key="routing/last-result" value="result"/>
    <wm-set key="routing/last-type" value="args.request_type"/>

    <return value="result"/>
  </run-impl>
</agent>
```

### Example 3: Multi-Entity Orchestration with Loops

An agent that creates multiple child entities, runs them in sequence, aggregates results, and records graph relationships.

```xml
<agent id="BatchProcessor"
       display-name="Batch Processor"
       description="Processes a batch of items using child entities">
  <static-args>
    <arg name="items" type="array" required="true"
         description="Array of items to process"/>
    <arg name="concurrency_label" type="string" default="sequential"/>
  </static-args>
  <run-impl>
    <yield-status message="Starting batch processing of {{args.items.length}} items"/>

    <!-- Initialize results collector -->
    <let name="results">
      <expr>[]</expr>
    </let>

    <!-- Create and run an entity for each item -->
    <loop items="args.items" as="item" index="idx">
      <yield-status message="Processing item {{idx + 1}} of {{args.items.length}}: {{item.name}}"/>

      <!-- Create child entity idempotently -->
      <call-entity type="ItemProcessor"
                   name="item.id"
                   result="processor">
        <data>
          <field name="payload" value="item.payload"/>
          <field name="priority" value="item.priority"/>
          <field name="index" value="idx"/>
        </data>
      </call-entity>

      <!-- Run the child entity and capture output -->
      <run-entity ref="processor" result="itemResult"/>

      <!-- Record graph relationship -->
      <graph-append edge-type="ProcessedItem" target="item.id">
        <data>
          <field name="status">"completed"</field>
          <field name="processed_at">
            <expr>new Date().toISOString()</expr>
          </field>
        </data>
      </graph-append>

      <!-- Check for failure and short-circuit -->
      <if condition="itemResult && itemResult.error">
        <yield-status message="Item {{item.name}} failed: {{itemResult.error}}"/>
        <wm-set key="batch/last-error" value="itemResult.error"/>
        <return>
          <expr>({
            status: 'partial_failure',
            completed: idx,
            total: args.items.length,
            error: itemResult.error
          })</expr>
        </return>
      </if>
    </loop>

    <!-- Store final summary -->
    <wm-set key="batch/last-run">
      <expr>({
        completed: args.items.length,
        timestamp: new Date().toISOString(),
        label: args.concurrency_label
      })</expr>
    </wm-set>

    <yield-status message="Batch processing complete"/>

    <return>
      <expr>({
        status: 'success',
        completed: args.items.length,
        total: args.items.length
      })</expr>
    </return>
  </run-impl>
</agent>
```

---

## Cross-References

- **[Expressions Reference](expressions-reference.md)** -- Detailed coverage of the `ExpressionEvaluator`, sandbox security model, interpolation syntax, and available built-in objects.
- **[BotML Reference](botml-reference.md)** -- Reference for the BotML DSL used to define bot definitions invoked by `<call-bot>`.
- **[PromptML Reference](promptml-reference.md)** -- Reference for the PromptML DSL used to define dynamic prompts within bots.
- **[BundleML Reference](bundleml-reference.md)** -- Reference for the BundleML DSL that declares agent bundle composition including AgentML programs.
