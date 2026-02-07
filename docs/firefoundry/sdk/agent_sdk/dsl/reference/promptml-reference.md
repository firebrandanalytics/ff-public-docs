# PromptML Reference

PromptML is an XML-based domain-specific language for defining LLM prompts within
FireFoundry agent bundles. It provides a declarative way to author structured,
conditional, and data-driven prompts that the SDK compiles into `Prompt` and
`PromptGroup` objects at runtime.

**File extension**: `.promptml`

## Document Structure

Every PromptML file contains either a `<prompt-group>` root element holding one or
more `<prompt>` children, or a standalone `<prompt>` element (which the loader
automatically wraps in a single-prompt group).

```xml
<prompt-group id="my-prompts">
  <prompt role="system">
    <!-- content elements -->
  </prompt>
  <prompt role="user">
    <!-- content elements -->
  </prompt>
</prompt-group>
```

Standalone form:

```xml
<prompt role="system">
  <text>You are a helpful assistant.</text>
</prompt>
```

## Element Hierarchy

```
prompt-group
  prompt
    section
      text
      if / else
      for-each
      schema-node
        field
    text
    if / else
    for-each
    schema-node
      field
```

---

## Elements

### prompt-group

**Purpose**: Root container that holds one or more prompt definitions as a named group.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `id` | No | `string` | -- | Unique identifier for the prompt group. |
| `cache-strategy` | No | `"init_once"` \| `"always_refresh"` | -- | Controls how rendered prompts are cached between invocations. |

**Children**: `prompt` (one or more required)

**Text Content**: Not allowed.

**Example**:

```xml
<prompt-group id="customer-support" cache-strategy="init_once">
  <prompt role="system">
    <text>You are a customer support agent.</text>
  </prompt>
  <prompt role="user">
    <text>{{input.question}}</text>
  </prompt>
</prompt-group>
```

**Validation Rules**:

- Must contain at least one `<prompt>` child element.
- `cache-strategy`, when present, must be exactly `"init_once"` or `"always_refresh"`.
- Only `<prompt>` elements are permitted as direct children.

---

### prompt

**Purpose**: Defines a single message in the conversation, bound to a role (system, user, or assistant).

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `role` | **Yes** | `"system"` \| `"user"` \| `"assistant"` | -- | The conversation role for this message. |
| `name` | No | `string` | Value of `role` | A lookup name for referencing this prompt within the group. |
| `condition` | No | `string` (expression) | -- | Expression that must evaluate to truthy for the prompt to be included. |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`

**Text Content**: Not allowed (use `<text>` children instead).

**Example**:

```xml
<prompt role="system" name="system-instructions">
  <text>You are a data analyst.</text>
</prompt>

<prompt role="assistant" condition="args.include_example">
  <text>Here is an example response: {"score": 0.95}</text>
</prompt>
```

**Validation Rules**:

- The `role` attribute is required and must be one of: `system`, `user`, `assistant`.
- When `name` is omitted, the prompt is named after its `role` value.
- The `condition` expression is evaluated at render time; if it returns a falsy value, the entire prompt is excluded from the rendered group.

---

### section

**Purpose**: Groups related content nodes together with an optional semantic type and configurable separator.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `semantic-type` | No | `string` | -- | Semantic classification (e.g., `"context"`, `"schema"`, `"rule"`, `"sample_output"`, `"followup"`). |
| `separator` | No | `string` | `"\n"` | String inserted between rendered children. |
| `name` | No | `string` | -- | A label for the section. |

**Children**: `text`, `if`, `for-each`, `schema-node`

**Text Content**: Not allowed (use `<text>` children).

**Example**:

```xml
<prompt role="system">
  <section semantic-type="context" name="background">
    <text>The user is a premium subscriber.</text>
    <text>Their account was created on {{args.created_date}}.</text>
  </section>
  <section semantic-type="rule" separator="\n- ">
    <text>Always be polite</text>
    <text>Never share internal data</text>
    <text>Escalate billing issues to a human</text>
  </section>
</prompt>
```

**Validation Rules**:

- Can appear as a direct child of `<prompt>`, `<if>`, `<else>`, or `<for-each>`.
- The `separator` value is used verbatim; the default newline is applied when the attribute is absent.
- No required attributes.

---

### text

**Purpose**: Holds literal or interpolated text content that becomes part of the rendered prompt string.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `semantic-type` | No | `string` | -- | Semantic classification for this text fragment. |
| `condition` | No | `string` (expression) | -- | Expression that must evaluate to truthy for this text to be included. |

**Children**: None.

**Text Content**: **Yes** -- the element body is the text content. Supports `{{expression}}` interpolation.

**Example**:

```xml
<text>You are an assistant that speaks {{args.language}}.</text>

<text semantic-type="context">
  Current date: {{Date.now()}}
</text>

<text condition="args.verbose">
  Include detailed explanations in every response.
</text>
```

**Validation Rules**:

- `<text>` is a leaf element; it must not contain child elements.
- When the text body contains `{{...}}` markers, those expressions are evaluated at render time using the expression evaluator.
- An empty `<text></text>` element produces an empty string.
- When `condition` is present and evaluates to falsy, the text node is omitted entirely from the output.

---

### if

**Purpose**: Conditionally includes child content when an expression evaluates to truthy.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `condition` | **Yes** | `string` (expression) | -- | JavaScript expression evaluated in the sandboxed context. |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`, `else`

**Text Content**: Not allowed.

**Example**:

```xml
<if condition="args.mode === 'detailed'">
  <text>Provide a detailed, step-by-step analysis.</text>
  <text>Include confidence scores for each finding.</text>
</if>
```

**Validation Rules**:

- The `condition` attribute is required.
- At most one `<else>` child is permitted.
- The `<else>` element, if present, must be a direct child of the `<if>`.
- All non-`<else>` children form the "then" branch; the `<else>` children form the "else" branch.
- Conditions are evaluated at render time with the full expression context.

---

### else

**Purpose**: Defines the alternative branch of an `<if>` element, rendered when the condition is falsy.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|

*No attributes.*

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`

**Text Content**: Not allowed.

**Example**:

```xml
<if condition="args.format === 'json'">
  <text>Return your response as valid JSON.</text>
  <else>
    <text>Return your response as plain text.</text>
  </else>
</if>
```

**Validation Rules**:

- Must be a direct child of an `<if>` element.
- Cannot appear outside of an `<if>`.
- Cannot contain another `<else>` (no `else-if` chaining at this level; nest a new `<if>` inside `<else>` instead).

---

### for-each

**Purpose**: Iterates over an array expression, rendering its child content once per item.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `items` | **Yes** | `string` (expression) | -- | Expression that must evaluate to an array. |
| `as` | No | `string` | `"item"` | Variable name bound to the current element in each iteration. |
| `index` | No | `string` | -- | Variable name bound to the zero-based index of the current iteration. |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`

**Text Content**: Not allowed.

**Example**:

```xml
<for-each items="args.rules" as="rule" index="i">
  <text>{{i + 1}}. {{rule}}</text>
</for-each>
```

**Validation Rules**:

- The `items` attribute is required and must evaluate to an array at render time. If it evaluates to a non-array value, the loop produces no output.
- When `as` is omitted, each element is available as `item`.
- When `index` is omitted, no index variable is injected into the loop context.
- Loop variables (`as` and `index`) are scoped to the loop body and do not leak into the outer context.

---

### schema-node

**Purpose**: Declares a structured output schema that is rendered as a human-readable specification in the prompt text.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | **Yes** | `string` | -- | Name of the schema (rendered as the heading). |
| `type` | No | `string` | `"object"` | Top-level type of the schema. |
| `description` | No | `string` | -- | A description rendered below the schema name. |
| `condition` | No | `string` (expression) | -- | Expression that must evaluate to truthy for the schema to be included. |

**Children**: `field` (zero or more)

**Text Content**: Not allowed.

**Example**:

```xml
<schema-node name="AnalysisResult" type="object" description="The structured analysis output">
  <field name="summary" type="string" description="Brief summary of findings" />
  <field name="findings" type="array" description="List of individual findings" />
  <field name="confidence" type="number" description="Confidence score from 0 to 1" />
</schema-node>
```

**Rendered output** (inserted into the prompt text):

```
AnalysisResult: object
  Description: The structured analysis output
  - summary: string (Brief summary of findings)
  - findings: array (List of individual findings)
  - confidence: number (Confidence score from 0 to 1)
```

**Validation Rules**:

- The `name` attribute is required.
- When `type` is omitted, defaults to `"object"` in the rendered output.
- The schema is rendered with `semantic_type: "schema"` on the underlying text node.
- Only `<field>` children are recognized; other child elements are ignored.

---

### field

**Purpose**: Defines a single field within a `<schema-node>`.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `name` | **Yes** | `string` | -- | Field name. |
| `type` | **Yes** | `string` | -- | Field type (e.g., `"string"`, `"number"`, `"boolean"`, `"array"`, `"object"`). |
| `description` | No | `string` | -- | Human-readable description, rendered in parentheses after the type. |
| `condition` | No | `string` (expression) | -- | Expression that must evaluate to truthy for this field to appear. |

**Children**: None.

**Text Content**: Not allowed.

**Example**:

```xml
<schema-node name="Report">
  <field name="title" type="string" description="Report title" />
  <field name="pages" type="number" description="Page count" />
  <field name="metadata" type="object" condition="args.include_metadata" />
</schema-node>
```

**Validation Rules**:

- Both `name` and `type` are required.
- Must be a direct child of `<schema-node>`.
- When `condition` is present and evaluates to falsy at render time, the field is omitted from the schema output.

---

## Interpolation Syntax

PromptML supports expression interpolation inside `<text>` element content using
double-brace delimiters: `{{expression}}`.

### Basic Syntax

```
{{expression}}
```

The expression inside the braces is evaluated as a sandboxed JavaScript expression
at render time. The result is converted to a string and inserted in place of the
`{{...}}` marker. If the result is `null` or `undefined`, an empty string is
substituted.

### Examples

```xml
<!-- Simple variable access -->
<text>Hello, {{input.name}}!</text>

<!-- Nested property access -->
<text>Account type: {{args.account.type}}</text>

<!-- Arithmetic -->
<text>Total: {{args.price * args.quantity}}</text>

<!-- Ternary operator -->
<text>Status: {{args.active ? 'Active' : 'Inactive'}}</text>

<!-- String methods -->
<text>Name: {{input.name.toUpperCase()}}</text>

<!-- Array access -->
<text>First item: {{args.items[0]}}</text>

<!-- Multiple expressions in one text node -->
<text>{{input.greeting}}, {{input.name}}! You have {{args.count}} messages.</text>
```

### Unclosed Braces

If `{{` appears without a matching `}}`, the text from the opening braces onward is
treated as a literal string. This means typos fail visibly rather than silently.

### Available Built-in Objects

The expression sandbox exposes a limited set of safe JavaScript built-ins:

| Object | Description |
|--------|-------------|
| `Math` | Mathematical functions (`Math.round()`, `Math.max()`, etc.) |
| `Number` | Number constructor and utilities |
| `String` | String constructor and utilities |
| `Boolean` | Boolean constructor |
| `Array` | Array constructor |
| `Object` | Object utilities (`Object.keys()`, etc.) |
| `Date` | Date constructor (`Date.now()`, etc.) |
| `RegExp` | Regular expression constructor |
| `Map` | Map constructor |
| `Set` | Set constructor |
| `JSON` | `JSON.stringify()`, `JSON.parse()` |
| `parseInt` | Parse integer from string |
| `parseFloat` | Parse float from string |
| `isNaN` | Test for NaN |
| `isFinite` | Test for finite number |
| `encodeURIComponent` | URL-encode a string |
| `decodeURIComponent` | URL-decode a string |

### Forbidden Patterns

For security, expressions must not contain any of the following. Violations cause a
parse-time error:

- `process`, `global`, `globalThis`, `window`, `document`
- `eval`, `Function`
- `__proto__`, `constructor`, `prototype`
- `require`, `import`
- `fetch`, `XMLHttpRequest`, `WebSocket`

### Expression Limits

- Maximum expression length: 10,000 characters.
- Execution timeout: 1 second per expression.

---

## Context Variables

When a PromptML template is rendered, the expression evaluator receives a context
object built from the `PromptNodeRequest`. The following variables are available:

| Variable | Type | Description |
|----------|------|-------------|
| `input` | `any` | The input payload passed to the prompt request. |
| `args` | `Record<string, any>` | Static and dynamic arguments configured on the prompt. |
| `options` | `Record<string, any>` | Additional options from the request. |

In addition, if `input` is an object, its properties are **spread** into the
top-level context. The same applies to `args`. This means you can reference
`input.topic` or simply `topic` if `input` is `{ topic: "sales" }`.

**Inside `<for-each>` loops**, two additional variables are available:

| Variable | Source | Description |
|----------|--------|-------------|
| *(value of `as` attribute)* | Current array element | Defaults to `item` when `as` is omitted. |
| *(value of `index` attribute)* | Current zero-based index | Only available when `index` is specified. |

### Context Example

Given this invocation context:

```json
{
  "input": { "topic": "quarterly revenue", "department": "sales" },
  "args": { "mode": "detailed", "language": "English" }
}
```

All of these expressions are valid:

```xml
<text>{{input.topic}}</text>          <!-- "quarterly revenue" -->
<text>{{topic}}</text>                <!-- "quarterly revenue" (spread) -->
<text>{{args.mode}}</text>            <!-- "detailed" -->
<text>{{mode}}</text>                 <!-- "detailed" (spread) -->
<text>{{language}}</text>             <!-- "English" (spread from args) -->
```

---

## Public API

PromptML processing is split into two phases: **parsing** (XML to AST) and
**rendering** (AST to SDK objects). All functions are exported from the
`@firebrandanalytics/ff-agent-sdk` package.

### parsePromptML

```typescript
function parsePromptML(xml: string, filePath?: string): PromptGroupNode
```

Parses a PromptML XML string into an AST (`PromptGroupNode`). Accepts either a
`<prompt-group>` or a standalone `<prompt>` as the root element. A standalone prompt
is automatically wrapped in a single-prompt group.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `xml` | `string` | Yes | The PromptML XML source string. |
| `filePath` | `string` | No | File path for error reporting. |

**Returns**: `PromptGroupNode` -- the parsed AST.

**Throws**: `DSLError` if the XML is malformed or fails schema validation.

```typescript
import { parsePromptML } from '@firebrandanalytics/ff-agent-sdk';

const ast = parsePromptML(`
  <prompt-group id="demo">
    <prompt role="system">
      <text>You are a helpful assistant.</text>
    </prompt>
  </prompt-group>
`);
// ast.type === 'prompt-group'
// ast.id === 'demo'
// ast.prompts.length === 1
```

### renderPromptGroup

```typescript
function renderPromptGroup(
  groupNode: PromptGroupNode,
  options?: PromptMLRendererOptions
): PromptGroup
```

Converts a `PromptGroupNode` AST into an SDK `PromptGroup` object ready for use in
an agent bundle.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `groupNode` | `PromptGroupNode` | Yes | The AST from `parsePromptML()`. |
| `options` | `PromptMLRendererOptions` | No | Renderer configuration (custom expression evaluator, etc.). |

**Returns**: `PromptGroup` -- an SDK prompt group instance.

```typescript
import { parsePromptML, renderPromptGroup } from '@firebrandanalytics/ff-agent-sdk';

const ast = parsePromptML(xmlSource);
const promptGroup = renderPromptGroup(ast);
```

### renderPrompt

```typescript
function renderPrompt(
  promptNode: PromptNode,
  evaluatorOrOptions?: ExpressionEvaluator | PromptMLRendererOptions
): Prompt
```

Converts a single `PromptNode` AST into an SDK `Prompt` object. Useful when you
need to render an individual prompt from a parsed group.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `promptNode` | `PromptNode` | Yes | A single prompt AST node. |
| `evaluatorOrOptions` | `ExpressionEvaluator \| PromptMLRendererOptions` | No | Expression evaluator or renderer options. |

**Returns**: `Prompt` -- an SDK prompt instance.

```typescript
import { parsePromptML, renderPrompt } from '@firebrandanalytics/ff-agent-sdk';

const ast = parsePromptML(xmlSource);
const systemPrompt = renderPrompt(ast.prompts[0]);
```

### PromptMLRendererOptions

```typescript
interface PromptMLRendererOptions {
  evaluator?: ExpressionEvaluator;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `evaluator` | `ExpressionEvaluator` | Custom expression evaluator. When omitted, a default evaluator is created. |

---

## Complete Examples

### Example 1: Simple Prompt

A minimal two-message prompt group with static text and one interpolation.

```xml
<prompt-group id="greeter">
  <prompt role="system">
    <text>You are a friendly greeter. Always respond in one sentence.</text>
  </prompt>
  <prompt role="user">
    <text>Say hello to {{input.name}} who works in the {{args.department}} department.</text>
  </prompt>
</prompt-group>
```

### Example 2: Conditional Prompt

Uses `<if>` and `<else>` to vary instructions based on a runtime argument, and a
conditional `<prompt>` that only appears when needed.

```xml
<prompt-group id="code-reviewer">
  <prompt role="system">
    <text>You are an expert code reviewer.</text>

    <if condition="args.mode === 'strict'">
      <text>Apply strict review criteria. Flag all style violations, potential bugs, and performance issues.</text>
      <text>Fail the review if any critical issue is found.</text>
      <else>
        <text>Apply standard review criteria. Focus on correctness and readability.</text>
      </else>
    </if>

    <if condition="args.language">
      <text>The code is written in {{args.language}}.</text>
    </if>
  </prompt>

  <prompt role="user">
    <text>Please review the following code:</text>
    <section name="code-block">
      <text>{{input.code}}</text>
    </section>
  </prompt>

  <prompt role="assistant" condition="args.include_example">
    <text>Here is an example of the expected review format:</text>
    <text>- Line 12: Potential null pointer dereference (Critical)</text>
    <text>- Line 45: Variable name could be more descriptive (Style)</text>
  </prompt>
</prompt-group>
```

### Example 3: Looping Prompt

Uses `<for-each>` to iterate over a dynamic list of items, with nested conditionals
inside the loop body.

```xml
<prompt-group id="multi-document-analyzer">
  <prompt role="system">
    <text>You are a document analysis assistant. Analyze each document and provide a summary.</text>
  </prompt>
  <prompt role="user">
    <text>Analyze the following {{args.documents.length}} documents:</text>

    <for-each items="args.documents" as="doc" index="idx">
      <section name="document" separator="\n">
        <text>--- Document {{idx + 1}}: {{doc.title}} ---</text>
        <text>Content: {{doc.content}}</text>
        <if condition="doc.metadata">
          <text>Metadata: {{JSON.stringify(doc.metadata)}}</text>
        </if>
      </section>
    </for-each>

    <text>For each document, return a JSON object with "title", "summary", and "key_points" fields.</text>
  </prompt>
</prompt-group>
```

### Example 4: Schema-Driven Prompt

Uses `<schema-node>` and `<field>` to embed a structured output specification
directly in the prompt, including conditional fields.

```xml
<prompt-group id="data-extractor" cache-strategy="always_refresh">
  <prompt role="system">
    <text>You are a structured data extraction engine.</text>
    <text>Extract information from the provided text and return it as JSON matching the schema below.</text>

    <section semantic-type="schema" name="output-schema">
      <schema-node name="ExtractionResult" type="object" description="Extracted data from the input text">
        <field name="entities" type="array" description="Named entities found in the text" />
        <field name="relationships" type="array" description="Relationships between entities" />
        <field name="sentiment" type="string" description="Overall sentiment: positive, negative, or neutral" />
        <field name="confidence" type="number" description="Extraction confidence from 0.0 to 1.0" />
        <field name="language" type="string" description="Detected language code" condition="args.detect_language" />
        <field name="topics" type="array" description="Key topics identified" condition="args.extract_topics" />
      </schema-node>
    </section>

    <section semantic-type="rule">
      <text>Always return valid JSON.</text>
      <text>If a field cannot be determined, use null.</text>
      <if condition="args.strict_schema">
        <text>Do not include any fields not listed in the schema.</text>
        <else>
          <text>You may include additional fields if they are relevant.</text>
        </else>
      </if>
    </section>
  </prompt>

  <prompt role="user">
    <text>Extract structured data from the following text:</text>
    <text>{{input.text}}</text>
  </prompt>
</prompt-group>
```

---

## Standalone Prompt Shorthand

For simple use cases that require only a single prompt, you can omit the
`<prompt-group>` wrapper. The loader detects a `<prompt>` root element and
automatically wraps it in a group.

```xml
<prompt role="user">
  <text>Summarize the following article: {{input.article}}</text>
</prompt>
```

This is functionally identical to:

```xml
<prompt-group>
  <prompt role="user">
    <text>Summarize the following article: {{input.article}}</text>
  </prompt>
</prompt-group>
```

The standalone form is useful for single-turn prompts or when embedding a prompt
inline via BotML (see [BotML Reference](botml-reference.md)).

---

## Nesting and Composition

### Nested Conditionals

`<if>` elements can be nested to arbitrary depth:

```xml
<if condition="args.tier === 'enterprise'">
  <text>Enterprise features are enabled.</text>
  <if condition="args.region === 'eu'">
    <text>GDPR compliance mode is active.</text>
  </if>
</if>
```

### Nested Loops

`<for-each>` elements can be nested. Inner loops have access to both their own
iteration variables and those of outer loops:

```xml
<for-each items="args.categories" as="category" index="catIdx">
  <text>Category {{catIdx + 1}}: {{category.name}}</text>
  <for-each items="category.items" as="item" index="itemIdx">
    <text>  {{catIdx + 1}}.{{itemIdx + 1}} {{item}}</text>
  </for-each>
</for-each>
```

### Conditionals Inside Loops

`<if>` and `<for-each>` compose freely. Loop variables are available in condition
expressions:

```xml
<for-each items="args.tasks" as="task">
  <text>Task: {{task.name}}</text>
  <if condition="task.priority === 'high'">
    <text>  ** HIGH PRIORITY **</text>
  </if>
</for-each>
```

---

## Semantic Types

The `semantic-type` attribute on `<section>` and `<text>` elements is metadata that
classifies content for downstream tooling. It does not affect rendering directly but
is preserved on the underlying SDK node objects.

Common semantic type values:

| Value | Typical Use |
|-------|-------------|
| `context` | Background information and situational context. |
| `schema` | Output schema definitions (set automatically by `<schema-node>`). |
| `rule` | Behavioral rules and constraints. |
| `sample_output` | Example outputs for few-shot prompting. |
| `followup` | Follow-up instructions or clarification prompts. |

These values are conventions, not enforced enums. You may use any string value.

---

## Error Handling

The PromptML loader and validator produce `DSLError` exceptions with specific error
codes:

| Error Code | Cause |
|------------|-------|
| `DSL_PARSE_INVALID_XML` | Root element is neither `<prompt-group>` nor `<prompt>`. |
| `DSL_PARSE_SCHEMA_VIOLATION` | The document structure violates the PromptML schema (e.g., missing required attributes, invalid children). |
| `DSL_INTERP_EXPRESSION_ERROR` | An expression failed to evaluate (syntax error, runtime error, or timeout). |
| `DSL_INTERP_FORBIDDEN_PATTERN` | An expression contains a forbidden pattern (e.g., `process`, `eval`). |

All errors include source location information (file path, line, column) when
available.

---

## Cross-References

- **Expression syntax**: See [Expressions Reference](expressions-reference.md) for
  the full expression evaluator specification, including operator support and sandbox
  details.
- **BotML inline prompts**: PromptML prompts can be embedded inline within BotML
  step definitions. See [BotML Reference](botml-reference.md) for the `<prompt>`
  embedding syntax.
