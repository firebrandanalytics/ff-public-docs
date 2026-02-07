# BotML Reference

BotML is an XML domain-specific language for declaring AI bot configurations in the
FireFoundry Agent SDK. A `.botml` file defines a single bot with its model settings,
mixin behaviors, prompt structure, and tool bindings. At runtime the SDK parses the
XML into a `BotMLSpec` object that `BotFactory` consumes to create a fully configured
bot instance.

BotML reuses the PromptML parser for inline prompt content, so every PromptML element
(`<section>`, `<text>`, `<if>`, `<for-each>`, `<schema-node>`) is available inside
`<prompt>` elements. See [promptml-reference.md](promptml-reference.md) for the
complete PromptML element catalog.

**File extension**: `.botml`

---

## Document Structure Overview

A BotML document has exactly one root `<bot>` element. Inside the bot, four singleton
child elements are available. Only `<structured-prompt-group>` is required; the others
are optional.

```
<bot>
  <llm-options/>          (0..1)
  <mixins/>               (0..1)
  <structured-prompt-group>   (exactly 1, required)
    <base/>
    <input/>
  </structured-prompt-group>
  <tools/>                (0..1)
</bot>
```

---

## Element Reference

### `<bot>`

**Purpose**: Root element that defines a single bot configuration.

| Attribute    | Required | Type   | Default  | Description                                      |
|-------------|----------|--------|----------|--------------------------------------------------|
| `id`        | Yes      | string | --       | Unique identifier for the bot within a bundle.   |
| `name`      | Yes      | string | --       | Display name passed to the SDK `Bot` constructor.|
| `model-pool`| No       | string | `"gpt-4"`| LLM model pool name. Overrides any value set inside `<llm-options>`. |
| `max-tries` | No       | string (positive integer) | -- | Maximum LLM retry attempts. Must be a positive integer (1 or greater). |

**Children**: `llm-options` (0..1), `mixins` (0..1), `structured-prompt-group` (exactly 1), `tools` (0..1).

**Text Content**: Not allowed.

**Example**:

```xml
<bot id="my-bot" name="MyBot" model-pool="gpt-4o" max-tries="5">
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a helpful assistant.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>{{input.question}}</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

**Validation Rules**:
- The root element tag must be `bot`. Any other root tag causes a parse error.
- Both `id` and `name` are required. Omitting either produces a schema violation error.
- `<bot>` must contain at least one child element (enforced by `requireChildren: true`).
- `<structured-prompt-group>` is required. A `<bot>` without one throws `DSL_PARSE_SCHEMA_VIOLATION`.
- Each singleton child (`llm-options`, `mixins`, `structured-prompt-group`, `tools`) may appear at most once. Duplicates throw `DSL_PARSE_SCHEMA_VIOLATION`.
- `max-tries`, when present, must parse to a positive integer (>= 1). Values like `"0"`, `"-1"`, `"3.5"`, or `"abc"` are rejected.

---

### `<llm-options>`

**Purpose**: Configures LLM inference parameters such as temperature, top-p, and token limits.

| Attribute    | Required | Type   | Default | Description                                        |
|-------------|----------|--------|---------|----------------------------------------------------|
| `temperature`| No      | string (numeric) | -- | Sampling temperature (e.g., `"0.2"`, `"1.0"`). |
| `top-p`     | No       | string (numeric) | -- | Nucleus sampling probability threshold.          |
| `max-tokens`| No       | string (numeric) | -- | Maximum tokens in the LLM response.             |
| `stop`      | No       | string | --      | Stop sequence(s) for the LLM.                    |

**Children**: `model-pool` (0..1), `semantic-label` (0..1).

**Text Content**: Not allowed.

**Example**:

```xml
<llm-options temperature="0.3" top-p="0.95" max-tokens="4096">
  <model-pool>firebrand-gpt-5.2-failover</model-pool>
  <semantic-label>analytics-bot</semantic-label>
</llm-options>
```

**Validation Rules**:
- Numeric attribute values are automatically parsed from strings. `"0.2"` becomes the number `0.2` in the resulting spec.
- Attributes and child elements can be combined freely. For example, `temperature` as an attribute alongside `<model-pool>` as a child element is valid.
- Child elements inside `<llm-options>` must have non-empty text content. An empty `<model-pool></model-pool>` or self-closing `<semantic-label/>` throws an error.

---

### `<model-pool>`

**Purpose**: Specifies the LLM model pool name as a child of `<llm-options>`.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: None.

**Text Content**: Required. The model pool name string (e.g., `"gpt-4o"`, `"firebrand-gpt-5.2-failover"`). Must not be empty or whitespace-only.

**Example**:

```xml
<model-pool>firebrand-gpt-5.2-failover</model-pool>
```

**Validation Rules**:
- Text content must be a non-empty string after trimming. Empty content throws `DSL_PARSE_SCHEMA_VIOLATION`.
- This element is only valid as a child of `<llm-options>`.
- The `<bot>` attribute `model-pool` takes precedence over this child element value. See the model pool resolution order section below.

---

### `<semantic-label>`

**Purpose**: Assigns a semantic label for LLM telemetry and routing as a child of `<llm-options>`.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: None.

**Text Content**: Required. The label string (e.g., `"xml-e2e-analyzer"`). Must not be empty or whitespace-only.

**Example**:

```xml
<semantic-label>xml-e2e-analyzer</semantic-label>
```

**Validation Rules**:
- Text content must be a non-empty string after trimming. Empty content or self-closing tags throw `DSL_PARSE_SCHEMA_VIOLATION`.
- The semantic label value is extracted and placed into the `semantic_label` field of the resulting `BotMLSpec`.

---

### `<mixins>`

**Purpose**: Container element that holds one or more `<mixin>` declarations.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: `mixin` (0..n).

**Text Content**: Not allowed.

**Example**:

```xml
<mixins>
  <mixin type="WorkingMemoryBotMixin"/>
  <mixin type="StructuredOutputBotMixin"/>
  <mixin type="FeedbackBotMixin">
    <config role="system"/>
  </mixin>
</mixins>
```

**Validation Rules**:
- Only `<mixin>` children are allowed. Any other child element produces a validation error.
- At most one `<mixins>` element may appear inside `<bot>`.
- Mixin order matters. At runtime, `BotFactory` validates that mixin dependencies are satisfied in declaration order. For example, if `DataValidationBotMixin` depends on `StructuredOutputBotMixin`, the structured output mixin must appear first.

---

### `<mixin>`

**Purpose**: Declares a single bot mixin behavior to compose into the bot.

| Attribute | Required | Type   | Default | Description                                              |
|-----------|----------|--------|---------|----------------------------------------------------------|
| `type`    | Yes      | string | --      | Mixin class name registered in the `ComponentRegistry` (e.g., `"StructuredOutputBotMixin"`). |

**Children**: `config` (0..1).

**Text Content**: Not allowed.

**Example**:

```xml
<mixin type="StructuredOutputBotMixin">
  <config>
    <schema>OrderSchema</schema>
    <struct_data_language>json</struct_data_language>
  </config>
</mixin>
```

**Validation Rules**:
- The `type` attribute is required. Omitting it produces a schema violation error.
- At runtime, the `type` value must match a mixin name in the `ComponentRegistry`. An unregistered name throws `DSL_REGISTRY_NOT_FOUND`.
- If a `<config>` child is present, its values are validated against the mixin's `configSchema` (if one is registered).

---

### `<config>`

**Purpose**: Provides freeform configuration key-value pairs for a parent `<mixin>`.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (any)     | No       | string | --    | Arbitrary attributes are allowed. Each becomes a key-value pair in the mixin config object. |

**Children**: Any element names are allowed. Child elements become nested config keys.

**Text Content**: Allowed as a fallback value when no attributes or children are present.

**Example -- attribute-based config**:

```xml
<config role="system" format="json" strict="true"/>
```

**Example -- child element config**:

```xml
<config>
  <retries>3</retries>
  <enabled>true</enabled>
  <output format="json" strict="true"/>
</config>
```

**Example -- nested config with grandchildren**:

```xml
<config>
  <validation>
    <mode>strict</mode>
    <max-errors>5</max-errors>
  </validation>
</config>
```

**Validation Rules**:
- `<config>` is intentionally not validated against the BotML schema. The validator treats it as an unknown element and emits a warning (not an error). This allows mixin-specific configuration shapes.
- **Type coercion**: String values are automatically converted:
  - `"true"` and `"false"` become boolean `true` / `false`.
  - Numeric strings (e.g., `"3"`, `"0.5"`) become numbers.
  - All other strings remain strings.
- Attribute-based values: `<config role="system"/>` produces `{ role: "system" }`.
- Child element values: `<retries>3</retries>` produces `{ retries: 3 }`.
- Child elements with attributes or sub-children become sub-objects. `<output format="json"/>` produces `{ output: { format: "json" } }`.
- Child elements without text or attributes produce a boolean `true` value.
- If the `<config>` element has only text content and no attributes or children, the text is stored under a `"value"` key.

---

### `<structured-prompt-group>`

**Purpose**: Defines the two-part prompt structure (base prompts and input prompts) that the bot sends to the LLM.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: `base` (0..1), `input` (0..1). At least one child must be present.

**Text Content**: Not allowed.

**Example**:

```xml
<structured-prompt-group>
  <base>
    <prompt role="system">
      <text>You are an expert data analyst.</text>
    </prompt>
  </base>
  <input>
    <prompt role="user">
      <text>Analyze: {{input.topic}}</text>
    </prompt>
  </input>
</structured-prompt-group>
```

**Validation Rules**:
- Exactly one `<structured-prompt-group>` is required inside `<bot>`.
- Must have at least one child element (`requireChildren: true`).
- Only `<base>` and `<input>` children are allowed.
- The resulting `StructuredPromptGroup` SDK object has a `base` section (typically system prompts) and an `input` section (typically user prompts).

---

### `<base>`

**Purpose**: Contains the base (system-level) prompts that establish the bot's behavior and identity.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: `prompt` (0..n), `prompt-group` (0..n). Both types can be mixed.

**Text Content**: Not allowed.

**Example**:

```xml
<base>
  <prompt role="system">
    <section name="identity">
      <text>You are an expert financial analyst.</text>
    </section>
    <section name="rules">
      <text>Always cite your sources.</text>
      <text>Never provide investment advice.</text>
    </section>
  </prompt>
</base>
```

**Validation Rules**:
- Only `<prompt>` and `<prompt-group>` children are allowed.
- Multiple `<prompt>` elements are permitted. They are merged into a single `PromptGroup` at render time.
- An empty `<base>` (no children) results in an empty `PromptGroup`.

---

### `<input>`

**Purpose**: Contains the input (user-level) prompts that carry per-request data to the LLM.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: `prompt` (0..n), `prompt-group` (0..n). Both types can be mixed.

**Text Content**: Not allowed.

**Example**:

```xml
<input>
  <prompt role="user">
    <text>Summarize the following document:</text>
    <section name="document">
      <text>{{input.document_text}}</text>
    </section>
  </prompt>
</input>
```

**Validation Rules**:
- Same rules as `<base>`: only `<prompt>` and `<prompt-group>` children are allowed.
- Multiple `<prompt>` elements are merged into a single `PromptGroup`.

---

### `<prompt-group>`

**Purpose**: Groups multiple prompts together, either inline or by referencing an external `.promptml` file.

| Attribute       | Required | Type   | Default | Description                                            |
|----------------|----------|--------|---------|--------------------------------------------------------|
| `ref`          | No       | string | --      | Path to an external `.promptml` file. When present, the element is treated as a file reference. |
| `id`           | No       | string | --      | Identifier for the prompt group.                       |
| `cache-strategy`| No      | string | --      | Caching strategy for prompt rendering.                 |

**Children**: `prompt` (0..n) -- only when `ref` is not used.

**Text Content**: Not allowed.

**Example -- inline prompt group**:

```xml
<prompt-group id="system-prompts">
  <prompt role="system">
    <text>You are a coding assistant.</text>
  </prompt>
  <prompt role="system" name="constraints">
    <text>Respond only in Python.</text>
  </prompt>
</prompt-group>
```

**Example -- file reference**:

```xml
<prompt-group ref="./prompts/system.promptml"/>
```

**Validation Rules**:
- When `ref` is present, the element is parsed as a `PromptRefNode`. No inline children are expected.
- When `ref` is absent, inline `<prompt>` children are parsed using the PromptML parser.
- File references require a BundleML context or file resolver. Calling `parseBotMLToSpec()` with a file reference (and no resolver) throws an error: `"File references (ref=...) require a file resolver."`.

---

### `<prompt>`

**Purpose**: Defines a single LLM message with a role, optional name, and PromptML content body.

| Attribute   | Required | Type   | Default | Description                                               |
|------------|----------|--------|---------|-----------------------------------------------------------|
| `role`     | Yes      | string | --      | Message role. Must be `"system"`, `"user"`, or `"assistant"`. |
| `name`     | No       | string | --      | Optional name for the prompt (used in SDK `NamedPrompt`). |
| `condition`| No       | string | --      | Expression that controls whether this prompt is included. See [expressions-reference.md](expressions-reference.md). |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node` -- the full set of PromptML content elements.

**Text Content**: Not directly. Content is provided via child elements.

**Example**:

```xml
<prompt role="system" name="identity">
  <section>
    <text>You are a data analysis assistant.</text>
  </section>
  <if condition="input.verbose">
    <text>Provide detailed explanations for each finding.</text>
  </if>
</prompt>
```

**Example -- conditional prompt**:

```xml
<prompt role="system" condition="input.include_safety_rules">
  <text>Always follow safety guidelines when responding.</text>
</prompt>
```

**Validation Rules**:
- `role` is required and must be one of: `system`, `user`, `assistant`. Any other value produces a custom validation error: `"Invalid role '<value>'. Must be 'system', 'user', or 'assistant'"`.
- Inline PromptML content is rebuilt to XML and parsed by the PromptML loader. All PromptML validation rules apply within the prompt body.
- The `condition` attribute uses the expression syntax documented in [expressions-reference.md](expressions-reference.md).

---

### `<tools>`

**Purpose**: Container element that holds one or more `<tool>` declarations.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | This element has no attributes. |

**Children**: `tool` (0..n).

**Text Content**: Not allowed.

**Example**:

```xml
<tools>
  <tool name="search" handler="registry:SearchHandler" description="Search the knowledge base"/>
  <tool name="calculate" handler="registry:CalcHandler" description="Perform calculations"/>
</tools>
```

**Validation Rules**:
- Only `<tool>` children are allowed.
- At most one `<tools>` element may appear inside `<bot>`.

---

### `<tool>`

**Purpose**: Declares a single tool that the bot can invoke during LLM interactions.

| Attribute    | Required | Type   | Default | Description                                             |
|-------------|----------|--------|---------|---------------------------------------------------------|
| `name`      | Yes      | string | --      | Tool name exposed to the LLM.                          |
| `handler`   | Yes      | string | --      | Handler reference. Use `"registry:HandlerName"` to reference a handler registered in the `ComponentRegistry`. |
| `description`| No      | string | --      | Human-readable description of what the tool does. Sent to the LLM as part of the tool specification. |

**Children**: None.

**Text Content**: Not allowed.

**Example**:

```xml
<tool
  name="search-jobs"
  handler="registry:SearchJobsHandler"
  description="Search job listings by title, location, or skills"/>
```

**Validation Rules**:
- Both `name` and `handler` are required. Omitting either produces a schema violation error.
- The `handler` value must follow the `"registry:HandlerName"` format at runtime. An unrecognized format throws `DSL_REGISTRY_NOT_FOUND`.
- Tool parameters (Zod schemas) are defined in the registry, not in BotML. The XML declaration binds the tool name to its registry handler.
- When `description` is omitted, it defaults to an empty string in the resulting `BotToolSpec`.

---

## PromptML Content Elements (Inline)

BotML embeds PromptML content inside `<prompt>` elements. The following PromptML
elements are available inline. For complete documentation of each element, see
[promptml-reference.md](promptml-reference.md).

### `<section>`

| Attribute       | Required | Type   | Default | Description                       |
|----------------|----------|--------|---------|-----------------------------------|
| `semantic-type`| No       | string | --      | Semantic annotation for the section. |
| `separator`    | No       | string | --      | Text separator between child elements. |
| `name`         | No       | string | --      | Named section identifier.         |

**Children**: `text`, `if`, `for-each`, `schema-node`.

### `<text>`

| Attribute       | Required | Type   | Default | Description                       |
|----------------|----------|--------|---------|-----------------------------------|
| `semantic-type`| No       | string | --      | Semantic annotation.              |
| `condition`    | No       | string | --      | Expression controlling inclusion. |

**Text Content**: Required. The literal text content for the prompt.

### `<if>`

| Attribute   | Required | Type   | Default | Description                           |
|------------|----------|--------|---------|---------------------------------------|
| `condition`| Yes      | string | --      | Expression that evaluates to truthy/falsy. |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`, `else`.

### `<else>`

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| (none)    | --       | --   | --      | No attributes. |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`.

### `<for-each>`

| Attribute | Required | Type   | Default  | Description                             |
|-----------|----------|--------|----------|-----------------------------------------|
| `items`   | Yes      | string | --       | Expression resolving to an iterable.    |
| `as`      | No       | string | --       | Variable name for the current item.     |
| `index`   | No       | string | --       | Variable name for the current index.    |

**Children**: `section`, `text`, `if`, `for-each`, `schema-node`.

### `<schema-node>`

| Attribute    | Required | Type   | Default | Description                          |
|-------------|----------|--------|---------|--------------------------------------|
| `name`      | Yes      | string | --      | Schema name.                         |
| `type`      | No       | string | --      | Schema type annotation.              |
| `description`| No      | string | --      | Human-readable schema description.   |
| `condition` | No       | string | --      | Expression controlling inclusion.    |

**Children**: `field`.

### `<field>`

| Attribute    | Required | Type   | Default | Description                          |
|-------------|----------|--------|---------|--------------------------------------|
| `name`      | Yes      | string | --      | Field name.                          |
| `type`      | Yes      | string | --      | Field type (e.g., `"string"`, `"number"`). |
| `description`| No      | string | --      | Human-readable field description.    |
| `condition` | No       | string | --      | Expression controlling inclusion.    |

**Children**: None.

---

## Model Pool Resolution Order

The model pool name used at runtime follows a three-level fallback:

1. **`<bot model-pool="...">`** -- The `model-pool` attribute on the root `<bot>` element has the highest priority.
2. **`<llm-options><model-pool>...</model-pool></llm-options>`** -- The `<model-pool>` child element inside `<llm-options>` is used if the bot attribute is not set.
3. **Default `"gpt-4"`** -- If neither is specified, the model pool defaults to `"gpt-4"`.

```xml
<!-- Priority 1: bot attribute wins -->
<bot id="ex" name="Ex" model-pool="gpt-4o">
  <llm-options>
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
  </llm-options>
  ...
</bot>
<!-- Result: model pool is "gpt-4o" -->

<!-- Priority 2: llm-options child used when bot attribute absent -->
<bot id="ex" name="Ex">
  <llm-options>
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
  </llm-options>
  ...
</bot>
<!-- Result: model pool is "firebrand-gpt-5.2-failover" -->

<!-- Priority 3: default -->
<bot id="ex" name="Ex">
  ...
</bot>
<!-- Result: model pool is "gpt-4" -->
```

---

## Inline PromptML Embedding

BotML reuses the PromptML parser for all prompt content. When the loader encounters
a `<prompt>` or `<prompt-group>` element inside `<base>` or `<input>`, it:

1. Rebuilds the XML subtree back into an XML string using `rebuildXML()`.
2. Passes the XML string to `parsePromptML()` from the PromptML loader.
3. Renders the resulting AST into a `PromptGroup` via `renderPromptGroup()`.
4. Extracts the `NamedPrompt` entries and merges them into the parent section's prompt group.

This means the full PromptML feature set is available inside BotML prompts, including
conditional blocks (`<if>`/`<else>`), iteration (`<for-each>`), template expressions
(`{{input.field}}`), and structured output schemas (`<schema-node>`).

Multiple `<prompt>` elements within the same `<base>` or `<input>` section are merged
into a single flattened `PromptGroup`. They are not nested.

---

## File References via `ref=`

The `<prompt-group>` element supports a `ref` attribute pointing to an external
`.promptml` file:

```xml
<base>
  <prompt-group ref="./prompts/system-prompts.promptml"/>
</base>
```

File references produce a `PromptRefNode` in the AST. These references are resolved
at a higher level by BundleML or a custom file resolver. When using the standalone
`parseBotMLToSpec()` function without a resolver, file references throw:

```
File references (ref="./prompts/system-prompts.promptml") require a file resolver.
Use inline prompts or provide a BundleML context.
```

The `parseBotML()` function (which returns the AST only) accepts file references
without error. Resolution is deferred until rendering.

---

## Duplicate Singleton Detection

The loader enforces that `<llm-options>`, `<mixins>`, `<structured-prompt-group>`, and
`<tools>` each appear at most once inside `<bot>`. If a duplicate is found, the loader
throws a `DSL_PARSE_SCHEMA_VIOLATION` error with the message:

```
<bot> must contain at most one <llm-options> element, found 2
```

This check runs before any content parsing, so it fails fast on malformed documents.

---

## `max-tries` Validation

The `max-tries` attribute on `<bot>` must be a positive integer when present. The
loader performs the following checks:

- The value must parse to a JavaScript `Number` that satisfies `Number.isInteger()`.
- The value must be >= 1.

Invalid values and their errors:

| Value   | Error                                                        |
|---------|--------------------------------------------------------------|
| `"0"`   | `Invalid max-tries value '0': must be a positive integer`    |
| `"-1"`  | `Invalid max-tries value '-1': must be a positive integer`   |
| `"3.5"` | `Invalid max-tries value '3.5': must be a positive integer`  |
| `"abc"` | `Invalid max-tries value 'abc': must be a positive integer`  |

---

## Public API

The BotML loader exports three functions from `dsl/botml/BotMLLoader.ts`:

### `parseBotML(xml, filePath?)`

Parses a BotML XML string into a `BotNode` AST. This is the low-level parse step that
validates structure but does not render prompts or resolve references.

```typescript
import { parseBotML } from '@firebrandanalytics/ff-agent-sdk';

const botNode = parseBotML('<bot id="my-bot" name="MyBot">...</bot>');
console.log(botNode.id);        // "my-bot"
console.log(botNode.modelPool); // "gpt-4" (default)
console.log(botNode.mixins);    // MixinNode[]
```

**Parameters**:
- `xml` (string) -- The BotML XML document as a string.
- `filePath` (string, optional) -- Source file path for error location reporting.

**Returns**: `BotNode` -- The parsed AST.

**Throws**: `DSLError` on parse failures or schema violations.

### `parseBotMLToSpec(xml, filePath?)`

Combines parsing and rendering in one step. Parses the XML, renders inline prompts
via PromptML, and returns a `BotMLSpec` ready for `BotFactory.createBot()`.

```typescript
import { parseBotMLToSpec } from '@firebrandanalytics/ff-agent-sdk';

const spec = parseBotMLToSpec(xml);
console.log(spec.name);            // "MyBot"
console.log(spec.model_pool_name); // "gpt-4"
console.log(spec.prompt_group);    // StructuredPromptGroup instance
```

**Parameters**: Same as `parseBotML()`.

**Returns**: `BotMLSpec` -- Ready for `BotFactory` consumption.

**Throws**: `DSLError` on parse failures, schema violations, or unresolved file references.

### `renderBotMLSpec(botNode)`

Converts an existing `BotNode` AST into a `BotMLSpec`. Useful when you need to
inspect or modify the AST before rendering.

```typescript
import { parseBotML, renderBotMLSpec } from '@firebrandanalytics/ff-agent-sdk';

const botNode = parseBotML(xml);
// ... inspect or modify botNode ...
const spec = renderBotMLSpec(botNode);
```

**Parameters**:
- `botNode` (BotNode) -- A parsed BotML AST node.

**Returns**: `BotMLSpec`.

**Throws**: `DSLError` if inline prompt rendering fails or file references are unresolved.

---

## BotMLSpec Interface

The `BotMLSpec` interface is the contract between BotML and `BotFactory`. It uses
snake_case to match SDK conventions.

```typescript
interface BotMLSpec {
  name: string;                            // Bot display name
  model_pool_name: string;                 // Resolved model pool
  max_tries?: number;                      // LLM retry limit
  llm_options?: Record<string, unknown>;   // Temperature, top-p, etc.
  semantic_label?: string;                 // Telemetry/routing label
  static_args?: Record<string, unknown>;   // Static arguments
  options?: Record<string, unknown>;       // Additional options
  prompt_group: StructuredPromptGroup;     // Rendered prompt structure
  mixins: BotMixinSpec[];                  // Mixin declarations
  tools?: BotToolSpec[];                   // Tool declarations
  postprocess?: BotPostprocessGeneratorFunction; // Post-processing hook
}
```

---

## Complete Examples

### Example 1: Minimal Bot

The simplest valid BotML document. Uses default model pool (`gpt-4`) and no
mixins or tools.

```xml
<bot id="greeter" name="GreeterBot">
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <section>
          <text>You are a friendly greeting bot.</text>
        </section>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <section>
          <text>Say hello to {{input.user_name}}.</text>
        </section>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

### Example 2: Bot with Mixins, Tools, and LLM Options

A production-style bot with structured output, working memory, feedback behavior,
custom model pool, and tool bindings.

```xml
<bot id="job-bot" name="JobDescriptionBot" model-pool="gpt-4o" max-tries="6">
  <llm-options temperature="0.2" top-p="1.0">
    <semantic-label>job-description-writer</semantic-label>
  </llm-options>

  <mixins>
    <mixin type="WorkingMemoryBotMixin"/>
    <mixin type="StructuredOutputBotMixin">
      <config>
        <schema>JobDescriptionSchema</schema>
        <struct_data_language>json</struct_data_language>
      </config>
    </mixin>
    <mixin type="FeedbackBotMixin">
      <config role="system"/>
    </mixin>
  </mixins>

  <structured-prompt-group>
    <base>
      <prompt role="system">
        <section name="identity">
          <text>You are an expert job description writer.</text>
          <text>Follow best practices for inclusive language.</text>
        </section>
        <section name="output-format">
          <text>Return a structured JSON object with the following fields:</text>
          <schema-node name="JobDescription" type="object">
            <field name="title" type="string" description="Job title"/>
            <field name="summary" type="string" description="Brief role summary"/>
            <field name="responsibilities" type="array" description="Key responsibilities"/>
            <field name="qualifications" type="array" description="Required qualifications"/>
          </schema-node>
        </section>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <section>
          <text>Create a job description for: {{input.job_title}}</text>
          <text>Department: {{input.department}}</text>
          <text>Level: {{input.seniority_level}}</text>
        </section>
      </prompt>
    </input>
  </structured-prompt-group>

  <tools>
    <tool
      name="search-jobs"
      handler="registry:SearchJobsHandler"
      description="Search existing job listings for reference"/>
    <tool
      name="check-compliance"
      handler="registry:ComplianceCheckHandler"
      description="Verify job description meets legal requirements"/>
  </tools>
</bot>
```

### Example 3: Bot with Inline Conditional Prompts

Demonstrates PromptML control flow elements (`<if>`, `<else>`, `<for-each>`)
embedded inside BotML prompts. See [expressions-reference.md](expressions-reference.md)
for the expression syntax used in `condition` and `items` attributes.

```xml
<bot id="analyzer" name="AnalyzerBot" max-tries="3">
  <llm-options temperature="0.3">
    <model-pool>firebrand-gpt-5.2-failover</model-pool>
    <semantic-label>data-analyzer</semantic-label>
  </llm-options>

  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a data analysis assistant for the FireFoundry platform.</text>
        <text>Your job is to analyze the provided input and return a structured JSON response.</text>

        <if condition="input.strict_mode">
          <text>STRICT MODE: Only include findings supported by direct evidence.</text>
          <text>Do not speculate or extrapolate beyond the provided data.</text>
          <else>
            <text>You may include reasonable inferences alongside direct findings.</text>
          </else>
        </if>

        <text>Always respond with valid JSON containing keys: summary, findings, and confidence.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Analyze the following topic: {{input.topic}}</text>

        <section name="context">
          <text>Analysis type: {{input.analysis_type}}</text>
          <text>Requested by: {{input.requested_by}}</text>
        </section>

        <if condition="input.reference_data">
          <section name="reference-data">
            <text>Use the following reference data points:</text>
            <for-each items="input.reference_data" as="datapoint" index="i">
              <text>{{i}}. {{datapoint.label}}: {{datapoint.value}}</text>
            </for-each>
          </section>
        </if>

        <text>Return your analysis as a JSON object with keys: summary, findings (array), and confidence (number 0-1).</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

---

## Cross-References

- **[promptml-reference.md](promptml-reference.md)** -- Complete reference for all PromptML content elements (`<prompt>`, `<section>`, `<text>`, `<if>`, `<for-each>`, `<schema-node>`, `<field>`).
- **[expressions-reference.md](expressions-reference.md)** -- Expression syntax for `condition` attributes and `{{...}}` template interpolation.
