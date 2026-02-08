# Expressions Reference

Expressions are the shared evaluation mechanism across all four FireFoundry DSLs --
PromptML, BotML, AgentML, and BundleML. They allow dynamic values, conditional logic,
and data transformations to be embedded directly in XML markup. The expression engine
is implemented in `ExpressionEvaluator.ts` and uses Node.js `vm.runInNewContext()` for
sandboxed evaluation.

---

## Table of Contents

1. [Overview](#overview)
2. [Interpolation Syntax](#interpolation-syntax)
3. [Direct Expressions](#direct-expressions)
4. [Security Model](#security-model)
5. [Forbidden Patterns](#forbidden-patterns)
6. [Available Built-ins](#available-built-ins)
7. [Context Variables by DSL](#context-variables-by-dsl)
8. [Variable Scoping](#variable-scoping)
9. [Practical Examples](#practical-examples)
10. [Common Errors](#common-errors)
11. [Debugging Tips](#debugging-tips)
12. [ExpressionEvaluator API](#expressionevaluator-api)

---

## Overview

Expressions serve two purposes in the DSL system:

1. **Interpolation** -- embed computed values inside text content using `{{expression}}`
   syntax.
2. **Direct evaluation** -- compute values for attributes (`value="expression"`) and
   standalone `<expr>` elements.

Every expression is a JavaScript expression (not a statement). It is evaluated in a
sandboxed V8 context with a curated set of built-in functions and the current variable
context. Expressions cannot perform I/O, access the host process, or mutate shared
state.

The same `ExpressionEvaluator` class powers all four DSLs. This means the syntax,
security model, and available built-ins are identical regardless of whether you are
writing a PromptML template, an AgentML workflow, a BotML definition, or a BundleML
configuration.

---

## Interpolation Syntax

Interpolation embeds expression results inside text content. Delimiters are double
curly braces: `{{` and `}}`.

### Basic Interpolation

```xml
<text>Hello, {{user.name}}! You have {{items.length}} items.</text>
```

At render time, `{{user.name}}` is replaced with the string value of `user.name` from
the current context, and `{{items.length}}` is replaced with the array length.

### Mixed Content

Literal text and expressions can be freely mixed:

```xml
<text>Analysis of "{{args.topic}}" requested by {{args.requested_by}} on {{new Date().toLocaleDateString()}}</text>
```

### Multiple Expressions in One String

A single text node can contain any number of interpolation markers:

```xml
<text>{{firstName}} {{lastName}} ({{email}})</text>
```

### Expression Complexity

Any valid JavaScript expression can appear inside `{{...}}`, including ternary
operators, method calls, and computed values:

```xml
<text>Status: {{score >= 80 ? "pass" : "fail"}}</text>
<text>Total: {{items.reduce((sum, i) => sum + i.price, 0).toFixed(2)}}</text>
```

### Null and Undefined Handling

When an expression evaluates to `null` or `undefined`, the interpolation produces an
empty string (no literal "null" or "undefined" text):

```xml
<!-- If user.nickname is undefined, this renders as "Name: " -->
<text>Name: {{user.nickname}}</text>
```

### Unclosed Braces

If `{{` appears without a matching `}}`, the text from that point onward is treated as
a literal string. No error is thrown.

```xml
<!-- Renders literally as "Price: {{not closed" -->
<text>Price: {{not closed</text>
```

### Fast Path

If a template string contains no `{{` characters at all, the evaluator returns it
immediately without any parsing overhead.

---

## Direct Expressions

Direct expressions are evaluated as standalone values rather than interpolated into
text.

### In `value=` Attributes

Many DSL elements accept a `value` attribute containing an expression:

```xml
<!-- AgentML: pass an expression result as an argument -->
<arg name="topic" value="args.topic"/>

<!-- AgentML: store a computed value -->
<wm-set key="analysis/latest-topic" value="args.topic"/>

<!-- AgentML: return a variable -->
<return value="analysis_result"/>
```

The `value` attribute content is evaluated as a direct expression -- no `{{...}}`
delimiters are needed.

### In `<expr>` Elements

The `<expr>` element evaluates a JavaScript expression and returns the result:

```xml
<!-- Compute a timestamp -->
<field name="timestamp">
  <expr>new Date().toISOString()</expr>
</field>

<!-- Build an object -->
<let name="config">
  <expr>({ retries: 3, timeout: 5000 })</expr>
</let>

<!-- Compute a derived value -->
<wm-set key="stats/total">
  <expr>results.filter(r => r.success).length</expr>
</wm-set>
```

### In `condition=` Attributes

Conditional elements evaluate their condition as a direct expression, then coerce the
result to boolean:

```xml
<!-- PromptML: conditional text -->
<if condition="args.mode === 'detailed'">
  <text>Provide detailed analysis with explanations.</text>
</if>

<!-- AgentML: conditional branching -->
<if condition="results.length > 0">
  <yield-status message="Processing results"/>
</if>

<!-- PromptML: conditional prompt rendering -->
<prompt role="system" condition="args.include_context">
  <text>Additional context is available.</text>
</prompt>
```

Boolean coercion follows standard JavaScript truthiness rules: `0`, `""`, `null`,
`undefined`, `NaN`, and `false` are falsy; everything else is truthy.

---

## Security Model

The expression evaluator implements a defense-in-depth security model with two layers.

### Layer 1: Static Pattern Checking

Before any code executes, the expression string is scanned against a list of forbidden
regular expression patterns. If any pattern matches, evaluation is immediately rejected
with a `DSL_INTERP_FORBIDDEN_PATTERN` error. This provides a fast first-pass filter.

### Layer 2: V8 Context Isolation

Expressions run inside `vm.runInNewContext()` with a purpose-built sandbox object. This
provides true V8 context isolation:

- The expression runs in a **separate V8 context** with no access to the host process,
  global scope, `require`, or any Node.js APIs.
- Only the explicitly provided sandbox properties are accessible.
- All context variables are **deep-frozen** before being passed to the sandbox,
  preventing mutation of the caller's objects.

### Execution Constraints

| Constraint         | Value                | Effect                                     |
|--------------------|----------------------|--------------------------------------------|
| Timeout            | 1 second (1000 ms)   | Prevents infinite loops and DoS.           |
| Max expression length | 10,000 characters | Prevents memory abuse from huge expressions.|
| Strict mode        | Always enabled        | `"use strict"` is prepended to all expressions. |
| Context freezing   | Deep freeze           | All context values are recursively frozen.  |

### Wrapping

Every expression is evaluated as:

```javascript
"use strict"; (expression)
```

The parentheses ensure the expression is parsed as an expression, not a statement.
Strict mode prevents accidental global variable creation and other unsafe patterns.

---

## Forbidden Patterns

The following identifiers and patterns are blocked by the static checker. Any expression
containing these (as whole words, detected by `\b` word boundaries) is rejected before
execution.

### Global Object Access

| Pattern       | Description                                   |
|---------------|-----------------------------------------------|
| `process`     | Node.js process object.                       |
| `global`      | Node.js global scope.                         |
| `globalThis`  | ECMAScript global scope reference.            |
| `window`      | Browser global scope.                         |
| `document`    | Browser DOM reference.                        |

### Code Execution

| Pattern       | Description                                   |
|---------------|-----------------------------------------------|
| `eval`        | Dynamic code evaluation.                      |
| `Function`    | Function constructor for dynamic code.        |

### Prototype Pollution

| Pattern       | Description                                   |
|---------------|-----------------------------------------------|
| `__proto__`   | Legacy prototype chain accessor.              |
| `constructor` | Access to constructor functions.              |
| `prototype`   | Access to prototype objects.                  |

### Module System

| Pattern       | Description                                   |
|---------------|-----------------------------------------------|
| `require`     | CommonJS module loading.                      |
| `import`      | ES module loading.                            |

### Network Access

| Pattern       | Description                                   |
|---------------|-----------------------------------------------|
| `fetch`       | HTTP fetch API.                               |
| `XMLHttpRequest` | Legacy HTTP request API.                   |
| `WebSocket`   | WebSocket connection API.                     |

### Pattern Matching Details

All patterns use word boundary matching (`\b`), except `__proto__` which matches as a
literal substring. This means:

- `process` is blocked, but `processing` or `data_process` would also be blocked
  because `\bprocess\b` matches the word "process" within them if they contain it as a
  standalone word segment.
- `constructor` is blocked, which means you cannot access `.constructor` on any object.
- `import` is blocked, preventing both `import(...)` dynamic imports and any identifier
  containing the word `import` as a standalone word.

### Custom Forbidden Patterns

The `ExpressionEvaluator` accepts additional forbidden patterns via configuration:

```typescript
const evaluator = new ExpressionEvaluator({
  additionalForbidden: [
    { pattern: /\bexec\b/, description: 'exec() calls' },
    { pattern: /\bspawn\b/, description: 'spawn() calls' },
  ],
});
```

---

## Available Built-ins

The sandbox includes a curated set of JavaScript built-in objects and functions. These
are the **only** globals available inside expressions.

### Type Constructors and Utilities

| Built-in    | Description                                          | Example                             |
|-------------|------------------------------------------------------|-------------------------------------|
| `Math`      | Mathematical constants and functions.                | `Math.max(a, b)`                    |
| `Number`    | Number type utilities.                               | `Number.isInteger(x)`              |
| `String`    | String type utilities.                               | `String(value)`                     |
| `Boolean`   | Boolean type coercion.                               | `Boolean(value)`                    |
| `Array`     | Array type utilities.                                | `Array.isArray(items)`             |
| `Object`    | Object utilities.                                    | `Object.keys(data)`               |
| `Date`      | Date construction and formatting.                    | `new Date().toISOString()`         |
| `RegExp`    | Regular expression construction.                     | `new RegExp('^test').test(s)`      |
| `Map`       | Map collection type.                                 | `new Map([['a', 1]])`             |
| `Set`       | Set collection type.                                 | `new Set([1, 2, 3]).size`         |
| `JSON`      | JSON serialization/deserialization.                  | `JSON.stringify(obj)`              |

### Parsing Functions

| Built-in             | Description                               | Example                       |
|----------------------|-------------------------------------------|-------------------------------|
| `parseInt`           | Parse string to integer.                  | `parseInt("42", 10)`          |
| `parseFloat`         | Parse string to float.                    | `parseFloat("3.14")`          |
| `isNaN`              | Check if value is NaN.                    | `isNaN(value)`                |
| `isFinite`           | Check if value is finite.                 | `isFinite(value)`             |

### Encoding Functions

| Built-in                | Description                            | Example                             |
|-------------------------|----------------------------------------|-------------------------------------|
| `encodeURIComponent`    | Encode a URI component.               | `encodeURIComponent(query)`         |
| `decodeURIComponent`    | Decode a URI component.               | `decodeURIComponent(encoded)`       |

### Special Values

| Built-in    | Description                |
|-------------|----------------------------|
| `undefined` | The undefined value.       |
| `NaN`       | The Not-a-Number value.    |
| `Infinity`  | The Infinity value.        |

### What is NOT Available

The following are explicitly absent from the sandbox:

- `console` (no logging from expressions)
- `setTimeout`, `setInterval`, `setImmediate` (no timers)
- `Promise` (no async operations -- expressions are synchronous)
- `Buffer` (no binary data manipulation)
- `require`, `import` (no module access)
- `process`, `global`, `globalThis` (no host access)
- `fetch`, `XMLHttpRequest`, `WebSocket` (no network access)

---

## Context Variables by DSL

Each DSL populates the expression context differently. The context is the set of
variables available to expressions at evaluation time.

### PromptML Context

PromptML expressions are evaluated at prompt render time. The context is built from the
`PromptNodeRequest` object.

| Variable   | Type                    | Description                                      |
|------------|-------------------------|--------------------------------------------------|
| `input`    | `object`                | The prompt input data. Top-level keys are spread into the context. |
| `args`     | `object`                | Static arguments passed to the prompt. Top-level keys are spread into the context. |
| `options`  | `object`                | Render options.                                  |

Because `input` and `args` are spread into the root context, their properties are
accessible directly:

```xml
<!-- These are equivalent in PromptML -->
<text>Topic: {{input.topic}}</text>
<text>Topic: {{topic}}</text>

<!-- These are equivalent -->
<text>Mode: {{args.analysis_type}}</text>
<text>Mode: {{analysis_type}}</text>
```

When a property exists in both `input` and `args`, the `args` value takes precedence
(it is spread second). The original `input` and `args` objects remain accessible for
disambiguation:

```xml
<if condition="args.mode === 'detailed'">
  <text>Provide detailed analysis.</text>
</if>
```

**PromptML for-each loops** introduce additional loop variables:

```xml
<for-each items="items" as="item" index="i">
  <text>{{i}}: {{item.name}} - {{item.value}}</text>
</for-each>
```

Inside the loop body, `item` and `i` are added to the context for each iteration.

### AgentML Context

AgentML expressions operate within a `RuntimeContext` that provides lexical scoping.
Variables are declared with `<let>`. To update a variable, use a new `<let>` in a child scope (variable shadowing).

| Variable   | Type            | Description                                      |
|------------|-----------------|--------------------------------------------------|
| `args`     | `object`        | Static arguments declared in `<static-args>`.    |
| `input`    | `object`        | Input data passed to the program at execution time. |
| User-declared variables | Any | Variables created with `<let>`.             |
| Bot results | Any            | Results stored via `result="varName"` on `<call-bot>`. |
| Working memory values | Any  | Values loaded via `<wm-get>`.                |

AgentML example showing context variables:

```xml
<agent id="Processor">
  <static-args>
    <arg name="topic" type="string"/>
    <arg name="count" type="number" default="5"/>
  </static-args>
  <run-impl>
    <!-- args.topic and args.count are available -->
    <let name="processed" value="0"/>

    <call-bot name="AnalyzerBot" result="analysis">
      <arg name="topic" value="args.topic"/>
    </call-bot>

    <!-- analysis is now in scope -->
    <wm-get key="history/count" as="historyCount"/>

    <!-- historyCount is now in scope -->
    <yield-status message="Processed {{args.topic}}, history: {{historyCount}}"/>
  </run-impl>
</agent>
```

### BotML Context

BotML does not directly evaluate expressions in its own elements. Instead, BotML
embeds PromptML content (either inline or via file references), and those embedded
prompts use the PromptML expression context. The bot passes its request arguments
through to the prompt rendering context.

### BundleML Context

BundleML `<handler>` and `<method>` elements contain raw JavaScript code (in CDATA
sections), not DSL expressions. This code runs in the bundle server context with
`request` and `bundle` as implicit variables. The expression evaluator is not used for
BundleML handler code.

---

## Variable Scoping

The `RuntimeContext` class provides lexical scoping for AgentML programs. It maintains a
stack of scopes, with variable lookup proceeding from innermost to outermost.

### Scope Stack

When an AgentML program begins, a single **global scope** exists:

```
Scope Stack:
  [0] global  { args: {...}, input: {...} }
```

### Pushing and Popping Scopes

Control-flow elements (`<loop>`, `<if>`) push new scopes. When the element completes,
its scope is popped:

```xml
<let name="total" value="0"/>

<loop items="tasks" as="task" index="i">
  <!-- New scope pushed: { task: ..., i: ... } -->
  <let name="subtotal" value="task.value * task.quantity"/>
  <!-- subtotal exists only in this loop iteration -->
</loop>
<!-- Scope popped: task, i, subtotal are no longer accessible -->
```

During loop iteration, the scope stack looks like:

```
Scope Stack:
  [0] global    { args: {...}, total: 0 }
  [1] loop      { task: {...}, i: 0, subtotal: 150 }
```

### Variable Shadowing

A variable declared in an inner scope shadows a variable with the same name in an outer
scope:

```xml
<let name="x" value="'outer'"/>
<!-- x is "outer" -->

<loop items="items" as="item">
  <let name="x" value="'inner'"/>
  <!-- x is "inner" in this scope -->
  <yield-status message="x = {{x}}"/>  <!-- prints "inner" -->
</loop>

<!-- x is "outer" again after the loop scope is popped -->
```

### Declaration Rules

- `declare(name, value)` -- Creates a variable in the **current** (innermost) scope.
  Throws `DSL_INTERP_DUPLICATE_DECLARATION` if the name already exists in the current
  scope.
- `get(name)` -- Searches from innermost to outermost scope. Throws
  `DSL_INTERP_VARIABLE_NOT_DECLARED` if not found in any scope.
- `has(name)` -- Returns `true` if the variable exists in any scope.

### The Global Scope Cannot Be Popped

Attempting to pop the global scope throws `DSL_INTERP_RUNTIME_ERROR` with the message
`Cannot pop the global scope`. This prevents scope stack corruption.

### `getAllVariables()`

The `getAllVariables()` method flattens the scope stack into a single record for passing
to the `ExpressionEvaluator`. Inner scopes shadow outer scopes:

```typescript
const context = new RuntimeContext();
context.declare('x', 1);
context.pushScope('loop');
context.declare('x', 2);
context.declare('y', 3);

const vars = context.getAllVariables();
// { x: 2, y: 3 }  -- inner x shadows outer x
```

---

## Practical Examples

### Property Access

```xml
<!-- Simple property -->
<text>{{user.name}}</text>

<!-- Nested property -->
<text>{{response.data.results[0].title}}</text>

<!-- Optional chaining is not available (strict mode JS expression),
     use a ternary instead -->
<text>{{user.address ? user.address.city : "unknown"}}</text>

<!-- Dynamic property access -->
<text>{{data[fieldName]}}</text>
```

### Type Checking

```xml
<!-- Check if a value is an array -->
<if condition="Array.isArray(items)">
  <text>Found {{items.length}} items.</text>
</if>

<!-- Check for undefined -->
<if condition="typeof result !== 'undefined'">
  <text>Result: {{result}}</text>
</if>

<!-- Number validation -->
<if condition="Number.isFinite(score) && score >= 0">
  <text>Score: {{score}}</text>
</if>

<!-- Check if string -->
<if condition="typeof name === 'string' && name.length > 0">
  <text>Name: {{name}}</text>
</if>
```

### Array Operations

```xml
<!-- Array length -->
<text>Total items: {{items.length}}</text>

<!-- Filter and count -->
<text>Active: {{items.filter(i => i.active).length}}</text>

<!-- Map to extract values -->
<text>Names: {{items.map(i => i.name).join(', ')}}</text>

<!-- Reduce to sum -->
<text>Total: {{items.reduce((sum, i) => sum + i.price, 0)}}</text>

<!-- Find first match -->
<let name="found" value="items.find(i => i.id === targetId)"/>

<!-- Check if any match -->
<if condition="items.some(i => i.status === 'error')">
  <text>Errors detected in processing.</text>
</if>

<!-- Check if all pass -->
<if condition="items.every(i => i.valid)">
  <text>All items validated successfully.</text>
</if>

<!-- Slice for pagination -->
<text>{{items.slice(0, 10).map(i => i.name).join('\n')}}</text>

<!-- Sort (note: context is frozen, so sort on a copy) -->
<let name="sorted" value="[...items].sort((a, b) => a.score - b.score)"/>
```

### String Manipulation

```xml
<!-- Uppercase -->
<text>{{title.toUpperCase()}}</text>

<!-- Trim and normalize whitespace -->
<text>{{input.trim()}}</text>

<!-- Substring -->
<text>{{description.substring(0, 100)}}...</text>

<!-- Split and rejoin -->
<text>{{tags.split(',').map(t => t.trim()).join(', ')}}</text>

<!-- Template-style formatting inside an expression -->
<text>{{name.padEnd(20, '.')}}: {{score}}</text>

<!-- Replace -->
<text>{{text.replace(/\n/g, ' ')}}</text>

<!-- String includes -->
<if condition="query.toLowerCase().includes('urgent')">
  <text>Priority: HIGH</text>
</if>

<!-- startsWith / endsWith -->
<if condition="filename.endsWith('.pdf')">
  <text>Processing PDF document.</text>
</if>
```

### Conditional Expressions

```xml
<!-- Ternary operator -->
<text>{{score >= 80 ? "Pass" : "Fail"}}</text>

<!-- Nested ternary -->
<text>{{score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "F"}}</text>

<!-- Nullish coalescing (logical OR as fallback) -->
<text>{{name || "Anonymous"}}</text>

<!-- Default with type check -->
<text>{{typeof count === 'number' ? count : 0}}</text>

<!-- Complex conditional -->
<if condition="results.length > 0 && results[0].confidence > 0.8">
  <text>High-confidence result: {{results[0].summary}}</text>
</if>
```

### Math Operations

```xml
<!-- Basic arithmetic -->
<text>Average: {{total / count}}</text>

<!-- Rounding -->
<text>Score: {{Math.round(score * 100) / 100}}</text>

<!-- Fixed decimal places -->
<text>Price: ${{price.toFixed(2)}}</text>

<!-- Min/Max -->
<text>Best: {{Math.max(...scores)}}, Worst: {{Math.min(...scores)}}</text>

<!-- Percentage -->
<text>{{Math.round((completed / total) * 100)}}% complete</text>

<!-- Clamp a value -->
<text>{{Math.max(0, Math.min(100, value))}}</text>

<!-- Random (available but non-deterministic) -->
<let name="sample" value="items[Math.floor(Math.random() * items.length)]"/>
```

### Object Construction

```xml
<!-- Build a plain object -->
<let name="metadata">
  <expr>({
    timestamp: new Date().toISOString(),
    source: args.topic,
    version: 1
  })</expr>
</let>

<!-- Merge objects with spread -->
<let name="combined">
  <expr>({...defaults, ...overrides})</expr>
</let>

<!-- Extract keys -->
<text>Fields: {{Object.keys(data).join(', ')}}</text>

<!-- Extract values -->
<text>Values: {{Object.values(config).join(', ')}}</text>

<!-- Entries iteration -->
<text>{{Object.entries(scores).map(([k, v]) => k + ': ' + v).join('\n')}}</text>
```

### Template Expressions

```xml
<!-- Build a formatted string -->
<text>{{['Summary:', summary, '', 'Findings:', ...findings.map((f, i) => (i+1) + '. ' + f)].join('\n')}}</text>

<!-- JSON formatting -->
<text>{{JSON.stringify(result, null, 2)}}</text>

<!-- Date formatting -->
<text>Generated: {{new Date().toISOString().split('T')[0]}}</text>

<!-- Number formatting -->
<text>{{Number(value).toLocaleString()}}</text>
```

### Set and Map Operations

```xml
<!-- Deduplicate with Set -->
<let name="uniqueTags" value="[...new Set(items.map(i => i.tag))]"/>

<!-- Set size for count of unique values -->
<text>Unique categories: {{new Set(items.map(i => i.category)).size}}</text>

<!-- Map for lookups -->
<let name="lookup" value="new Map(items.map(i => [i.id, i]))"/>
```

### Regular Expressions

```xml
<!-- Test a pattern -->
<if condition="new RegExp('^[A-Z]{2,4}-\\d+$').test(code)">
  <text>Valid project code: {{code}}</text>
</if>

<!-- Match and extract -->
<let name="digits" value="input.match(/\\d+/g) || []"/>
<text>Found {{digits.length}} numbers.</text>
```

---

## Common Errors

### Variable Not Declared (DSL_300)

Thrown when an expression references a variable that does not exist in any scope.

**Error code**: `DSL_INTERP_VARIABLE_NOT_DECLARED`

**Example trigger**:

```xml
<!-- "result" was never declared with <let> or assigned via result="" -->
<text>{{result.summary}}</text>
```

**Error message**:

```
[DSL_300] Variable 'result' is not declared at workflow.agentml:15:5
```

**Fix**: Declare the variable before using it, or check if it exists first.

### Forbidden Pattern Detected (DSL_303)

Thrown when an expression contains a blocked identifier.

**Error code**: `DSL_INTERP_FORBIDDEN_PATTERN`

**Example triggers**:

```xml
<!-- Blocked: "process" -->
<expr>process.env.API_KEY</expr>

<!-- Blocked: "eval" -->
<expr>eval("1 + 2")</expr>

<!-- Blocked: "require" -->
<expr>require('fs').readFileSync('/etc/passwd')</expr>

<!-- Blocked: "constructor" -- even for legitimate uses -->
<expr>obj.constructor.name</expr>

<!-- Blocked: "import" -->
<expr>import('module')</expr>
```

**Error message**:

```
[DSL_303] Forbidden pattern detected: process access at workflow.agentml:8:5
```

**Fix**: Restructure the expression to avoid the forbidden pattern. For example, to
get a type name, pass it as a context variable instead of accessing `.constructor`.

### Expression Execution Timeout (DSL_302)

Thrown when an expression takes longer than 1 second to execute.

**Error code**: `DSL_INTERP_EXPRESSION_ERROR`

**Example trigger**:

```xml
<!-- Infinite loop (will time out) -->
<expr>(() => { while(true) {} })()</expr>

<!-- Extremely expensive computation -->
<expr>Array(1e8).fill(0).reduce((a, b) => a + b, 0)</expr>
```

**Error message**:

```
[DSL_302] Expression execution timed out (1 second limit): <expression> at workflow.agentml:12:5
```

**Fix**: Simplify the expression or move the computation into handler code.

### Expression Evaluation Failed (DSL_302)

A general evaluation error for runtime exceptions (TypeError, ReferenceError, etc.).

**Error code**: `DSL_INTERP_EXPRESSION_ERROR`

**Example triggers**:

```xml
<!-- TypeError: cannot read property of undefined -->
<text>{{undefined_var.name}}</text>

<!-- TypeError: not a function -->
<text>{{42()}}</text>

<!-- RangeError: invalid array length -->
<expr>new Array(-1)</expr>

<!-- SyntaxError: malformed expression -->
<expr>if (true) { }</expr>
```

**Error message**:

```
[DSL_302] Expression evaluation failed: Cannot read properties of undefined
(reading 'name') (expression: undefined_var.name) at prompt.promptml:5:3
```

### Expression Exceeds Maximum Length (DSL_302)

Thrown when an expression exceeds the 10,000-character limit.

**Error code**: `DSL_INTERP_EXPRESSION_ERROR`

**Error message**:

```
[DSL_302] Expression exceeds maximum length of 10000 characters at template.promptml:8:5
```

**Fix**: Break the expression into smaller parts using `<let>` variables.

### Duplicate Declaration (DSL_306)

Thrown when a variable is declared twice in the same scope.

**Error code**: `DSL_INTERP_DUPLICATE_DECLARATION`

**Example trigger**:

```xml
<let name="count" value="0"/>
<let name="count" value="1"/>  <!-- Error: already declared in this scope -->
```

**Error message**:

```
[DSL_306] Variable 'count' is already declared in the current scope at workflow.agentml:4:5
```

**Fix**: Use a different variable name, or declare the variable in a child scope (e.g., inside `<loop>` or `<if>`) where shadowing is allowed.

---

## Debugging Tips

### Error Messages Include Source Location

Every DSL error includes file path, line number, and column number when source location
tracking is available. The format is:

```
[CODE] Message at file:line:column
```

For example:

```
[DSL_302] Expression evaluation failed: items is not defined
(expression: items.length) at analysis-workflow.agentml:22:7
```

This tells you exactly which file and line to check.

### Pass `filePath` to Parsers

Always pass the `filePath` parameter when calling `parseBundleML()`, `parseAgentML()`,
and similar functions. Without it, error locations show `<expression>` instead of the
actual filename:

```typescript
// Good: errors will reference "bundle.bundleml"
const node = parseBundleML(xml, 'bundle.bundleml');

// Bad: errors will show "<expression>"
const node = parseBundleML(xml);
```

### Trace Mode for Expression Debugging

Enable trace logging on the `ExpressionEvaluator` to see every expression as it is
evaluated:

```typescript
const evaluator = new ExpressionEvaluator({ trace: true });
```

This logs to `console.log`:

```
[ExpressionEvaluator] Evaluating: args.topic
[ExpressionEvaluator] Evaluating: items.length > 0
[ExpressionEvaluator] Evaluating: score >= 80 ? "pass" : "fail"
```

### Context Is Frozen

Remember that all context values are deep-frozen before evaluation. You cannot mutate
objects or arrays passed into expressions:

```xml
<!-- This will throw: Cannot assign to read only property -->
<expr>items.push("new item")</expr>

<!-- Instead, create a new array -->
<expr>[...items, "new item"]</expr>
```

### Expressions Are Not Statements

The evaluator wraps your expression as `("use strict"; (expression))`. This means you
cannot use statements like `if`, `for`, `while`, or `var`/`let`/`const`. You must use
expression-level equivalents:

```xml
<!-- WRONG: statement syntax -->
<expr>if (x > 0) { return x; } else { return 0; }</expr>

<!-- RIGHT: ternary expression -->
<expr>x > 0 ? x : 0</expr>

<!-- WRONG: variable declaration statement -->
<expr>const y = x + 1; y * 2</expr>

<!-- RIGHT: IIFE if you need intermediate computation -->
<expr>(() => { const y = x + 1; return y * 2; })()</expr>

<!-- Or better: use separate <let> elements in AgentML -->
```

### Watch for Word Boundary Matches in Forbidden Patterns

The forbidden pattern `\bprocess\b` matches the word "process" anywhere it appears as
a complete word. This can produce unexpected blocks:

```xml
<!-- Blocked: contains the word "process" -->
<text>{{data.process_step}}</text>

<!-- Workaround: rename the property or pass it under a different name -->
```

If you encounter unexpected forbidden-pattern errors, check whether your variable names
or property names contain any of the 15 forbidden words as substrings that match word
boundaries.

### Validate Before Runtime

Use `validateBundleML()` or try-catch around parse functions during development to catch
errors early, before the bundle is deployed:

```typescript
const result = validateBundleML(xml, 'bundle.bundleml');
if (!result.valid) {
  console.error('Validation errors:');
  result.errors.forEach(e => console.error(`  Line ${e.line}: ${e.message}`));
}
```

---

## ExpressionEvaluator API

The `ExpressionEvaluator` class is the programmatic interface for expression evaluation.

### Constructor

```typescript
const evaluator = new ExpressionEvaluator({
  maxLength: 10000,           // Maximum expression length (default: 10000)
  additionalForbidden: [],    // Extra forbidden patterns
  trace: false,               // Enable trace logging
});
```

### `evaluate(expression, context?, location?)`

Evaluate a JavaScript expression in a sandboxed context.

```typescript
const result = evaluator.evaluate('x + y', { x: 10, y: 20 });
// result: 30
```

**Parameters**:

| Parameter    | Type                      | Required | Description                      |
|--------------|---------------------------|----------|----------------------------------|
| `expression` | `string`                  | Yes      | JavaScript expression.           |
| `context`    | `Record<string, unknown>` | No       | Variables available to the expression. |
| `location`   | `DSLSourceLocation`       | No       | Source location for errors.      |

**Returns**: `unknown` -- the evaluation result.

### `evaluateBoolean(expression, context?, location?)`

Evaluate an expression and coerce the result to `boolean`.

```typescript
const result = evaluator.evaluateBoolean('items.length > 0', { items: [1, 2, 3] });
// result: true
```

### `validate(expression, location?)`

Validate an expression against forbidden patterns and length limits without evaluating
it. Throws `DSLError` if invalid.

```typescript
evaluator.validate('Math.max(a, b)');         // OK, no error thrown
evaluator.validate('process.env.SECRET');      // Throws: forbidden pattern
```

### `parseInterpolation(template)`

Parse a template string into an array of literal strings and expression objects.

```typescript
const segments = evaluator.parseInterpolation('Hello, {{name}}! Score: {{score}}');
// [
//   "Hello, ",
//   { expr: "name" },
//   "! Score: ",
//   { expr: "score" }
// ]
```

**Returns**: `InterpolationSegment[]` where each segment is either a `string` or
`{ expr: string }`.

### `renderInterpolation(template, context?, location?)`

Parse and evaluate a template string, replacing all `{{expression}}` markers with their
evaluated values.

```typescript
const result = evaluator.renderInterpolation(
  'Hello, {{name}}! You have {{items.length}} items.',
  { name: 'Alice', items: [1, 2, 3] }
);
// result: "Hello, Alice! You have 3 items."
```

**Returns**: `string` -- the fully rendered template.

### Default Instance

A pre-configured default evaluator is exported for convenience:

```typescript
import { expressionEvaluator } from '@firebrandanalytics/ff-agent-sdk';

const result = expressionEvaluator.evaluate('1 + 2');
// result: 3
```
