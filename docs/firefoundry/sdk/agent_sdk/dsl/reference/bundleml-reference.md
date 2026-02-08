# BundleML Reference

BundleML is the top-level orchestration DSL in the FireFoundry Agent SDK. It defines the
structure of an agent bundle: which entities and bots it contains, what HTTP endpoints it
exposes, what custom methods it provides, and how the server is configured. BundleML files
use the `.bundleml` extension and are loaded by the `BundleMLLoader`.

A bundle file is the single entry point that ties together AgentML entities, BotML bots,
and PromptML prompts into a deployable unit.

BundleML can be used in two modes:

- **Automatic bootstrap** (xml-bundle-server): The bootstrap loader reads the BundleML
  and automatically parses all referenced DSL files, registers components, compiles CDATA
  handlers, and starts the HTTP server. No TypeScript code is required.
- **TypeScript wiring**: A TypeScript class extends `FFAgentBundle`, reads the BundleML
  for structural validation, and handles component registration programmatically.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [File Format](#file-format)
3. [Element Reference](#element-reference)
   - [bundle (root)](#bundle)
   - [config](#config)
   - [port](#port)
   - [file-size-limit](#file-size-limit)
   - [max-files](#max-files)
   - [constructors](#constructors)
   - [entity](#entity)
   - [bot](#bot)
   - [endpoints](#endpoints)
   - [endpoint](#endpoint)
   - [handler](#handler)
   - [methods](#methods)
   - [method](#method)
4. [CDATA Usage Patterns](#cdata-usage-patterns)
5. [Validation Rules](#validation-rules)
6. [Public API](#public-api)
7. [AST Types](#ast-types)
8. [Complete Examples](#complete-examples)
9. [Error Reference](#error-reference)

---

## Quick Start

A minimal BundleML file that registers one entity and exposes a single endpoint:

```xml
<bundle id="my-bundle" name="My First Bundle">
  <constructors>
    <entity type="TaskProcessor" ref="task-processor.agentml"/>
  </constructors>
  <endpoints>
    <endpoint route="/process" method="POST" response-type="json">
      <handler><![CDATA[
        const entity = await bundle.createEntity('TaskProcessor', request.body);
        const result = await entity.start();
        return result;
      ]]></handler>
    </endpoint>
  </endpoints>
</bundle>
```

Save this as `bundle.bundleml` alongside the referenced `.agentml` file, then load it
with `parseBundleML()`.

---

## File Format

- **Extension**: `.bundleml`
- **Encoding**: UTF-8 XML
- **Root element**: `<bundle>`
- **CDATA blocks**: Required for `<handler>` and `<method>` JavaScript code

BundleML documents are standard XML. The parser accepts optional XML declarations and
namespace attributes but does not require them.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bundle id="example" name="Example Bundle" xmlns="https://firefoundry.ai/bundleml">
  <!-- content -->
</bundle>
```

---

## Element Reference

### `<bundle>`

The root element. Defines the bundle identity and contains all other sections.

**Attributes**

| Attribute     | Required | Description                                      |
|---------------|----------|--------------------------------------------------|
| `id`          | Yes      | Unique bundle identifier. Used as the bundle key. |
| `name`        | Yes      | Human-readable display name.                     |
| `description` | No       | Free-text description of the bundle.             |
| `xmlns`       | No       | XML namespace URI (informational only).          |

**Allowed Children**

| Child          | Required | Multiplicity |
|----------------|----------|--------------|
| `<config>`     | No       | 0..1         |
| `<constructors>` | Yes   | Exactly 1    |
| `<endpoints>`  | No       | 0..1         |
| `<methods>`    | No       | 0..1         |

The `<bundle>` element must contain at least one child element (`requireChildren: true`).
If any of the four section elements appears more than once, parsing fails with a
schema violation error.

**Example**

```xml
<bundle id="analytics-bundle"
        name="Analytics Bundle"
        description="Processes analytics requests via AI agents">
  <constructors>
    <!-- at least one entity or bot -->
  </constructors>
</bundle>
```

---

### `<config>`

Optional server and runtime configuration for the bundle. Contains numeric configuration
values as child elements.

**Attributes**: None.

**Allowed Children**

| Child              | Description                       |
|--------------------|-----------------------------------|
| `<port>`           | Server listen port.               |
| `<file-size-limit>`| Maximum upload file size in bytes. |
| `<max-files>`      | Maximum files per upload.         |

All children are optional. When `<config>` is omitted entirely, the runtime uses its
defaults (port 3000, etc.).

**Example**

```xml
<config>
  <port>8080</port>
  <file-size-limit>52428800</file-size-limit>
  <max-files>5</max-files>
</config>
```

---

### `<port>`

Specifies the HTTP server port.

**Content**: Text node containing an integer between 1 and 65535 inclusive.

**Validation**: The text is parsed as a number. If it is not a valid integer or falls
outside the range 1--65535, a `DSL_PARSE_SCHEMA_VIOLATION` error is thrown.

**Default**: When omitted, the runtime defaults to port 3000.

| Constraint    | Value           |
|---------------|-----------------|
| Type          | Integer         |
| Minimum       | 1               |
| Maximum       | 65535           |

**Examples**

```xml
<!-- Valid -->
<port>3000</port>
<port>8080</port>
<port>443</port>

<!-- Invalid: out of range -->
<port>0</port>
<port>70000</port>

<!-- Invalid: not an integer -->
<port>3000.5</port>
<port>auto</port>
```

---

### `<file-size-limit>`

Specifies the maximum file upload size in bytes.

**Content**: Text node containing a non-negative integer.

**Validation**: Must be a non-negative integer (zero is allowed). Non-integer values
or negative numbers produce a `DSL_PARSE_SCHEMA_VIOLATION` error.

| Constraint    | Value                       |
|---------------|-----------------------------|
| Type          | Non-negative integer        |
| Unit          | Bytes                       |
| Default       | 50 MB (runtime default)     |

**Examples**

```xml
<!-- 10 MB limit -->
<file-size-limit>10485760</file-size-limit>

<!-- No file uploads (zero bytes) -->
<file-size-limit>0</file-size-limit>

<!-- 1 GB limit -->
<file-size-limit>1073741824</file-size-limit>
```

---

### `<max-files>`

Specifies the maximum number of files allowed per upload request.

**Content**: Text node containing a non-negative integer.

**Validation**: Must be a non-negative integer. The same rules as `<file-size-limit>`
apply.

| Constraint    | Value                    |
|---------------|--------------------------|
| Type          | Non-negative integer     |
| Default       | 10 (runtime default)     |

**Examples**

```xml
<!-- Allow up to 20 files -->
<max-files>20</max-files>

<!-- Single file only -->
<max-files>1</max-files>
```

---

### `<constructors>`

Declares the entity and bot components that the bundle provides. This is the only
required section in a bundle. At least one `<entity>` or `<bot>` child must be present.

**Attributes**: None.

**Allowed Children**

| Child      | Description                         |
|------------|-------------------------------------|
| `<entity>` | AgentML entity constructor.         |
| `<bot>`    | BotML bot constructor.              |

**Validation**: `requireChildren: true` -- the parser rejects an empty `<constructors>`
element.

**Example**

```xml
<constructors>
  <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
  <entity type="DataIngestion"    ref="data-ingestion.agentml"/>
  <bot    type="AnalyzerBot"      ref="analyzer-bot.botml"/>
  <bot    type="SummaryBot"       ref="summary-bot.botml"/>
</constructors>
```

---

### `<entity>`

Registers an AgentML entity constructor. Each entity maps a type name to a `.agentml`
definition file.

**Attributes**

| Attribute | Required | Description                                               |
|-----------|----------|-----------------------------------------------------------|
| `type`    | Yes      | Type name used to create instances (e.g., `"TaskProcessor"`). Must be unique across all constructors. |
| `ref`     | Yes      | Path to the `.agentml` definition file. Must end with `.agentml`. |

**Validation**:
- `ref` must end with `.agentml`. If it does not, a `DSL_PARSE_SCHEMA_VIOLATION` error is thrown with the message `Entity ref '<path>' must end with .agentml`.
- `type` must be unique. Duplicate type names across any combination of `<entity>` and `<bot>` elements produce a `Duplicate constructor type '<name>'` error.

**Example**

```xml
<entity type="DocumentProcessor" ref="./agents/doc-processor.agentml"/>
<entity type="ReviewWorkflow"    ref="review-workflow.agentml"/>
```

---

### `<bot>`

Registers a BotML bot constructor. Each bot maps a type name to a `.botml` definition
file.

**Attributes**

| Attribute | Required | Description                                               |
|-----------|----------|-----------------------------------------------------------|
| `type`    | Yes      | Type name used to look up the bot. Must be unique across all constructors. |
| `ref`     | Yes      | Path to the `.botml` definition file. Must end with `.botml`. |

**Validation**:
- `ref` must end with `.botml`. If it does not, a `DSL_PARSE_SCHEMA_VIOLATION` error is thrown with the message `Bot ref '<path>' must end with .botml`.
- `type` must be unique (same rule as `<entity>`).

**Example**

```xml
<bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
<bot type="SummaryBot"  ref="./bots/summary-bot.botml"/>
```

---

### `<endpoints>`

Contains HTTP endpoint definitions. Optional -- a bundle can run without exposing any
HTTP routes (for example, a library bundle used only by other bundles).

**Attributes**: None.

**Allowed Children**: `<endpoint>` (zero or more).

**Example**

```xml
<endpoints>
  <endpoint route="/health" method="GET" response-type="json">
    <handler><![CDATA[ return { status: "ok" }; ]]></handler>
  </endpoint>
</endpoints>
```

---

### `<endpoint>`

Defines a single HTTP endpoint with its route, method, response type, and handler code.

**Attributes**

| Attribute        | Required | Values                          | Description                                              |
|------------------|----------|---------------------------------|----------------------------------------------------------|
| `route`          | Yes      | String                          | URL path (e.g., `"/run-analysis"`). Used in the URL.    |
| `method`         | Yes      | `GET` or `POST`                 | HTTP method. Case-insensitive during parsing, stored as uppercase. |
| `response-type`  | Yes      | `json`, `binary`, or `iterator` | Determines response serialization.                       |
| `accepts-blobs`  | No       | `true` or `false`               | Whether this endpoint accepts file uploads (multipart).  |
| `content-type`   | No       | String                          | Content-Type header for `binary` responses (e.g., `"application/pdf"`). |
| `filename`       | No       | String                          | Suggested filename for `binary` downloads.               |

**Allowed Children**: Exactly one `<handler>` element.

**Response Types Explained**

| Type       | Description                                                    |
|------------|----------------------------------------------------------------|
| `json`     | Handler return value is serialized as JSON.                    |
| `binary`   | Handler returns binary data. Use `content-type` and `filename`.|
| `iterator` | Handler returns an async iterator; response is streamed.       |

**Validation Rules**:
- `method` must be `GET` or `POST` (case-insensitive). Other HTTP methods produce an error.
- `response-type` must be one of the three allowed values.
- `accepts-blobs` must be exactly `"true"` or `"false"` if specified. Any other value (including `"yes"`, `"1"`, etc.) is rejected.
- Exactly one `<handler>` child is required. Zero or more than one produces an error.
- Duplicate routes: Two endpoints with the same `route` AND `method` produce a `Duplicate endpoint: <METHOD> <route>` error. The same route with different methods (one GET, one POST) is allowed.

**Examples**

```xml
<!-- JSON POST endpoint with blob support -->
<endpoint route="/upload" method="POST" response-type="json" accepts-blobs="true">
  <handler><![CDATA[
    const file = request.blobs[0];
    const entity = await bundle.createEntity('DocumentProcessor', {
      filename: file.name,
      buffer: file.data
    });
    return await entity.start();
  ]]></handler>
</endpoint>

<!-- Binary GET endpoint for file downloads -->
<endpoint route="/export" method="GET" response-type="binary"
          content-type="application/pdf" filename="report.pdf">
  <handler><![CDATA[
    const report = await bundle.getWorkingMemory('reports/latest');
    return report.buffer;
  ]]></handler>
</endpoint>

<!-- Streaming iterator endpoint -->
<endpoint route="/stream" method="POST" response-type="iterator">
  <handler><![CDATA[
    const entity = await bundle.createEntity('StreamProcessor', request.body);
    return entity.start();
  ]]></handler>
</endpoint>
```

---

### `<handler>`

Contains the JavaScript code that implements an endpoint. The code is written inside a
CDATA section to avoid XML escaping issues.

**Content**: Text (JavaScript code). Must not be empty after trimming whitespace.

**Attributes**: None.

**Allowed Children**: None (text-only element).

The handler code executes in the context of the bundle server. Two implicit variables
are available:

| Variable   | Description                                    |
|------------|------------------------------------------------|
| `request`  | The incoming HTTP request object.              |
| `bundle`   | The `FFAgentBundle` instance.                  |

The return value of the handler code becomes the endpoint response, serialized according
to the `response-type` attribute of the parent `<endpoint>`.

**Example**

```xml
<handler><![CDATA[
  const { topic, analysis_type, requested_by } = request.body;
  const entity = await bundle.createEntity('AnalysisWorkflow', {
    topic, analysis_type, requested_by
  });
  const result = await entity.start();
  return result;
]]></handler>
```

---

### `<methods>`

Contains custom method definitions that are added to the bundle class. Optional.

**Attributes**: None.

**Allowed Children**: `<method>` (zero or more).

**Example**

```xml
<methods>
  <method name="getAnalysisHistory"><![CDATA[
    return await bundle.getWorkingMemory('analysis/latest-result');
  ]]></method>
  <method name="clearHistory"><![CDATA[
    await bundle.setWorkingMemory('analysis/latest-result', null);
  ]]></method>
</methods>
```

---

### `<method>`

Defines a single custom method on the bundle class. The method can be called from
handler code or from other bundle methods.

**Attributes**

| Attribute | Required | Description                                              |
|-----------|----------|----------------------------------------------------------|
| `name`    | Yes      | Method name. Must be unique across all methods.          |

**Content**: Text (JavaScript code inside CDATA). Must not be empty after trimming.

**Allowed Children**: None (the schema sets `allowedChildren: []`).

**Validation**:
- The `name` attribute is required. The schema enforces this.
- Method code must not be empty. An empty `<method>` body produces a
  `<method name="X"> must contain code` error.
- Duplicate names produce a `Duplicate method name '<name>'` error.

**Example**

```xml
<method name="getAnalysisHistory"><![CDATA[
  return await bundle.getWorkingMemory('analysis/latest-result');
]]></method>
```

---

## CDATA Usage Patterns

BundleML uses XML CDATA sections to embed JavaScript code inside `<handler>` and
`<method>` elements. CDATA prevents the XML parser from interpreting special characters
(`<`, `>`, `&`) as XML markup.

### Basic Pattern

```xml
<handler><![CDATA[
  // JavaScript code goes here
  const result = items.filter(i => i.value > 10);
  return result;
]]></handler>
```

### Why CDATA is Necessary

Without CDATA, the `>` in `i.value > 10` would be interpreted as a closing tag
delimiter:

```xml
<!-- BROKEN: parser sees "i.value >" as a tag close -->
<handler>
  const result = items.filter(i => i.value > 10);
</handler>
```

### Single-Line CDATA

For simple handlers, a single line works:

```xml
<handler><![CDATA[ return { status: "ok" }; ]]></handler>
```

### Multi-Line CDATA

For complex handlers, use multiple lines with consistent indentation:

```xml
<handler><![CDATA[
  const { topic } = request.body;

  const entity = await bundle.createEntity('Processor', { topic });
  const result = await entity.start();

  return {
    success: true,
    data: result
  };
]]></handler>
```

### Nested Quotes

Both single and double quotes work inside CDATA:

```xml
<handler><![CDATA[
  const msg = "Hello, 'world'";
  const obj = { key: "value", name: 'test' };
  return obj;
]]></handler>
```

### Async/Await

Handler and method code runs in an async context. You can use `await` directly:

```xml
<method name="fetchData"><![CDATA[
  const memory = await bundle.getWorkingMemory('data/cache');
  if (!memory) {
    const entity = await bundle.createEntity('DataFetcher', {});
    return await entity.start();
  }
  return memory;
]]></method>
```

---

## Validation Rules

The BundleML loader applies both schema validation (structural correctness) and
semantic validation (logical correctness). All validation runs during `parseBundleML()`.

### Structural Validation

| Rule                                  | Error                                            |
|---------------------------------------|--------------------------------------------------|
| Root element must be `<bundle>`       | `Expected root element <bundle>, got <X>`        |
| `<bundle>` requires `id` and `name`  | Schema violation for missing required attributes |
| `<bundle>` must have children         | Schema violation (requireChildren)               |
| `<constructors>` is mandatory         | `<bundle> must contain a <constructors> element` |
| `<constructors>` must have children   | Schema violation (requireChildren)               |
| `<entity>` requires `type` and `ref` | Schema violation for missing required attributes |
| `<bot>` requires `type` and `ref`    | Schema violation for missing required attributes |
| `<endpoint>` requires `route`, `method`, `response-type` | Schema violation         |
| `<endpoint>` must contain `<handler>` | `must contain a <handler> with code`             |
| `<method>` requires `name`           | Schema violation for missing required attributes |

### Singleton Sections

Each of the four section elements can appear at most once inside `<bundle>`:

```
<bundle> must contain at most one <config> element, found N
<bundle> must contain at most one <constructors> element, found N
<bundle> must contain at most one <endpoints> element, found N
<bundle> must contain at most one <methods> element, found N
```

### Value Domain Validation

| Element / Attribute         | Valid Values                           | Error Message                              |
|-----------------------------|----------------------------------------|--------------------------------------------|
| `<port>`                    | Integer 1--65535                       | `Invalid port 'X': must be an integer between 1 and 65535` |
| `<file-size-limit>`         | Non-negative integer                   | `Invalid file-size-limit 'X': must be a non-negative integer` |
| `<max-files>`               | Non-negative integer                   | `Invalid max-files 'X': must be a non-negative integer` |
| `endpoint.method`           | `GET`, `POST` (case-insensitive)       | `has invalid method 'X'. Must be 'GET' or 'POST'` |
| `endpoint.response-type`    | `json`, `binary`, `iterator`           | `has invalid response-type 'X'. Must be 'json', 'binary', or 'iterator'` |
| `endpoint.accepts-blobs`    | `true`, `false`                        | `has invalid accepts-blobs 'X'. Must be 'true' or 'false'` |

### Uniqueness Constraints

| Scope            | Rule                                                   | Error Message                              |
|------------------|--------------------------------------------------------|--------------------------------------------|
| Constructors     | No two constructors may share a `type` name            | `Duplicate constructor type 'X'`           |
| Endpoints        | No two endpoints may share the same `route` + `method` | `Duplicate endpoint: METHOD route`         |
| Methods          | No two methods may share a `name`                      | `Duplicate method name 'X'`               |

### File Extension Constraints

| Constructor | Required Extension | Error Message                                  |
|-------------|--------------------|------------------------------------------------|
| `<entity>`  | `.agentml`         | `Entity ref 'X' must end with .agentml`        |
| `<bot>`     | `.botml`           | `Bot ref 'X' must end with .botml`             |

### Handler Constraints

- Each `<endpoint>` must contain exactly one `<handler>`.
- Zero handlers: `must contain a <handler> with code`.
- Multiple handlers: `must contain exactly one <handler>, found N`.
- Empty handler (whitespace only): `must contain a <handler> with code`.
- Empty method body: `<method name="X"> must contain code`.

---

## Public API

The BundleML module exports two public functions from the loader.

### `parseBundleML(xml, filePath?)`

Parses a BundleML XML string into a `BundleNode` AST.

```typescript
import { parseBundleML } from '@firebrandanalytics/ff-agent-sdk';

const xml = `
  <bundle id="my-bundle" name="My Bundle">
    <constructors>
      <entity type="Worker" ref="worker.agentml"/>
    </constructors>
  </bundle>
`;

const bundleNode = parseBundleML(xml, 'bundle.bundleml');
console.log(bundleNode.id);           // "my-bundle"
console.log(bundleNode.name);         // "My Bundle"
console.log(bundleNode.constructors); // [{ kind: "entity", type: "Worker", ref: "worker.agentml", ... }]
```

**Parameters**

| Parameter  | Type     | Required | Description                        |
|------------|----------|----------|------------------------------------|
| `xml`      | `string` | Yes      | The BundleML XML content.          |
| `filePath` | `string` | No       | File path for error messages.      |

**Returns**: `BundleNode` -- the parsed AST.

**Throws**: `DSLError` with code `DSL_PARSE_INVALID_XML` or `DSL_PARSE_SCHEMA_VIOLATION`.

### `validateBundleML(xml, filePath?)`

Validates a BundleML XML string without returning the AST. Returns a structured result
object instead of throwing.

```typescript
import { validateBundleML } from '@firebrandanalytics/ff-agent-sdk';

const result = validateBundleML(xml, 'bundle.bundleml');

if (result.valid) {
  console.log('Bundle is valid');
} else {
  for (const error of result.errors) {
    console.error(`Line ${error.line}: ${error.message}`);
  }
}
```

**Parameters**: Same as `parseBundleML`.

**Returns**:

```typescript
{
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number }>;
  warnings: Array<{ message: string; line?: number; column?: number }>;
}
```

The `warnings` array is reserved for future use and is currently always empty.

---

## AST Types

After parsing, the BundleML loader produces typed AST nodes. These types are defined in
`bundleml/types.ts`.

### BundleNode (root)

```typescript
interface BundleNode {
  id: string;                       // Bundle identifier
  name: string;                     // Bundle display name
  description?: string;             // Bundle description
  config?: BundleConfigNode;        // Server configuration
  constructors: ConstructorNode[];  // Entity and bot registrations
  endpoints: EndpointNode[];        // HTTP endpoints
  methods: MethodNode[];            // Custom methods
  location?: XMLSourceLocation;     // Source location
}
```

### BundleConfigNode

```typescript
interface BundleConfigNode {
  port?: number;           // Server port (default: 3000)
  fileSizeLimit?: number;  // Max file size in bytes
  maxFiles?: number;       // Max files per upload
  location?: XMLSourceLocation;
}
```

### ConstructorNode

```typescript
type ConstructorKind = 'entity' | 'bot';

interface ConstructorNode {
  kind: ConstructorKind;           // "entity" or "bot"
  type: string;                    // Type name (e.g., "DocumentProcessorEntity")
  ref: string;                     // File path (e.g., "./agents/processor.agentml")
  location?: XMLSourceLocation;
}
```

### EndpointNode

```typescript
type HttpMethod = 'GET' | 'POST';
type ResponseType = 'json' | 'binary' | 'iterator';

interface EndpointNode {
  route: string;                   // URL path
  method: HttpMethod;              // HTTP method
  responseType: ResponseType;      // Response serialization
  acceptsBlobs?: boolean;          // File upload support
  contentType?: string;            // Content-Type for binary
  filename?: string;               // Download filename
  handlerCode: string;             // JavaScript code from CDATA
  location?: XMLSourceLocation;
}
```

### MethodNode

```typescript
interface MethodNode {
  name: string;                    // Method name
  code: string;                    // JavaScript code from CDATA
  location?: XMLSourceLocation;
}
```

### XMLSourceLocation

All nodes carry an optional `location` field for error reporting:

```typescript
interface XMLSourceLocation {
  file?: string;   // File path
  line?: number;   // Line number (1-indexed)
  column?: number; // Column number (1-indexed)
}
```

---

## Complete Examples

### E2E Test Bundle

This is the full example from the `xml-e2e-bundle` test application. It demonstrates
all four sections working together:

```xml
<bundle id="xml-e2e-bundle"
        name="XML E2E Test Bundle"
        description="End-to-end test bundle using all four XML DSLs">
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
        return {
          bundle: 'xml-e2e-bundle',
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

### File Upload Bundle

A bundle configured for document processing with file uploads:

```xml
<bundle id="doc-processor" name="Document Processor">
  <config>
    <port>8080</port>
    <file-size-limit>104857600</file-size-limit>
    <max-files>5</max-files>
  </config>
  <constructors>
    <entity type="DocumentProcessor" ref="doc-processor.agentml"/>
    <bot type="ExtractorBot" ref="extractor-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="/upload"
              method="POST"
              response-type="json"
              accepts-blobs="true">
      <handler><![CDATA[
        const file = request.blobs[0];
        const entity = await bundle.createEntity('DocumentProcessor', {
          filename: file.name,
          buffer: file.data,
          mime_type: file.type
        });
        return await entity.start();
      ]]></handler>
    </endpoint>
    <endpoint route="/status" method="GET" response-type="json">
      <handler><![CDATA[
        return {
          status: "ready",
          max_file_size: 104857600,
          max_files: 5
        };
      ]]></handler>
    </endpoint>
  </endpoints>
</bundle>
```

### Streaming Bundle

A bundle that uses iterator response type for streaming results:

```xml
<bundle id="stream-bundle" name="Streaming Analysis">
  <constructors>
    <entity type="StreamProcessor" ref="stream-processor.agentml"/>
    <bot type="AnalysisBot" ref="analysis-bot.botml"/>
  </constructors>
  <endpoints>
    <endpoint route="/analyze" method="POST" response-type="iterator">
      <handler><![CDATA[
        const entity = await bundle.createEntity('StreamProcessor', {
          query: request.body.query
        });
        return entity.start();
      ]]></handler>
    </endpoint>
  </endpoints>
  <methods>
    <method name="getLastQuery"><![CDATA[
      return await bundle.getWorkingMemory('stream/last-query');
    ]]></method>
    <method name="getStats"><![CDATA[
      const history = await bundle.getWorkingMemory('stream/history');
      return {
        total_queries: history ? history.length : 0,
        last_updated: new Date().toISOString()
      };
    ]]></method>
  </methods>
</bundle>
```

### Minimal Bundle (Constructors Only)

A bundle used as a component library with no endpoints or methods:

```xml
<bundle id="shared-agents" name="Shared Agent Library">
  <constructors>
    <entity type="DataCleaner"    ref="agents/data-cleaner.agentml"/>
    <entity type="Validator"      ref="agents/validator.agentml"/>
    <entity type="Transformer"    ref="agents/transformer.agentml"/>
    <bot    type="ClassifierBot"  ref="bots/classifier.botml"/>
    <bot    type="SummarizerBot"  ref="bots/summarizer.botml"/>
  </constructors>
</bundle>
```

---

## Error Reference

All errors thrown by the BundleML loader are `DSLError` instances with source location
information when available.

### Parse Errors (DSL_100 -- DSL_104)

| Code      | Constant                      | When                                        |
|-----------|-------------------------------|---------------------------------------------|
| `DSL_100` | `DSL_PARSE_INVALID_XML`       | Malformed XML or wrong root element.        |
| `DSL_101` | `DSL_PARSE_SCHEMA_VIOLATION`  | Structural or semantic validation failure.  |
| `DSL_102` | `DSL_PARSE_MISSING_ATTRIBUTE` | Required attribute not present.             |
| `DSL_103` | `DSL_PARSE_INVALID_REFERENCE` | File reference does not resolve.            |
| `DSL_104` | `DSL_PARSE_DUPLICATE_ID`      | Duplicate identifier detected.              |

### Error Message Format

All DSL errors follow this format:

```
[DSL_101] BundleML validation failed: <details> at <file>:<line>:<column>
```

For example:

```
[DSL_101] Duplicate endpoint: POST /run-analysis at bundle.bundleml:18:5
[DSL_101] Invalid port '99999': must be an integer between 1 and 65535 at bundle.bundleml:3:5
[DSL_101] Entity ref 'processor.xml' must end with .agentml at bundle.bundleml:7:5
```

### Handling Errors Programmatically

```typescript
import { parseBundleML } from '@firebrandanalytics/ff-agent-sdk';
import { DSLError, DSLErrorCode } from '@firebrandanalytics/ff-agent-sdk';

try {
  const node = parseBundleML(xml, 'bundle.bundleml');
} catch (err) {
  if (err instanceof DSLError) {
    console.error(`Code: ${err.code}`);
    console.error(`Message: ${err.message}`);
    if (err.location) {
      console.error(`File: ${err.location.file}`);
      console.error(`Line: ${err.location.line}`);
      console.error(`Column: ${err.location.column}`);
    }
  }
}
```

Or use the non-throwing `validateBundleML()`:

```typescript
import { validateBundleML } from '@firebrandanalytics/ff-agent-sdk';

const result = validateBundleML(xml, 'bundle.bundleml');
if (!result.valid) {
  result.errors.forEach(e => {
    console.error(`[${e.line}:${e.column}] ${e.message}`);
  });
}
```
