# DSL Reference Guides

This section contains the complete element and attribute reference for each of the four FireFoundry XML DSLs. Each guide documents every valid XML element, its required and optional attributes, allowed child elements, and usage examples.

## Quick Reference

| DSL | File Extension | Root Element | Purpose |
|---|---|---|---|
| [PromptML](#promptml) | `.promptml` | `<prompt-group>` | Dynamic prompt generation with conditionals, loops, and interpolation |
| [BotML](#botml) | `.botml` | `<bot>` | Bot configuration with LLM settings, mixins, and structured prompts |
| [AgentML](#agentml) | `.agentml` | `<agent>` | Workflow orchestration with bot calls, working memory, and graph ops |
| [BundleML](#bundleml) | `.bundleml` | `<bundle>` | Bundle manifest with constructors, endpoints, and methods |

## File Extension Summary

```
src/dsl/
  my-prompt.promptml       # PromptML  - prompt definitions
  my-bot.botml             # BotML     - bot configurations
  my-workflow.agentml      # AgentML   - workflow programs
  bundle.bundleml          # BundleML  - bundle manifest
```

## PromptML

**File extension:** `.promptml`
**Root element:** `<prompt-group>`
**Parser:** `PromptML.parsePromptML(xml)`
**Renderer:** `PromptML.renderPromptGroup(ast)`

PromptML defines prompt groups with role-based prompts, conditional content, iteration, interpolation, and schema definitions. Prompts can be used standalone or embedded inline within BotML files.

**Key elements:** `<prompt-group>`, `<prompt>`, `<text>`, `<section>`, `<if>`, `<else>`, `<for-each>`, `<schema-node>`, `<field>`

For the complete element reference, see the [PromptML Reference](promptml-reference.md).

## BotML

**File extension:** `.botml`
**Root element:** `<bot>`
**Parser:** `parseBotMLToSpec(xml, filePath)`

BotML defines bot specifications including LLM options (temperature, model pool, semantic label), mixin configurations, structured prompt groups with base and input sections, and tool definitions.

**Key elements:** `<bot>`, `<llm-options>`, `<model-pool>`, `<semantic-label>`, `<mixins>`, `<mixin>`, `<structured-prompt-group>`, `<base>`, `<input>`, `<tools>`, `<tool>`

For the complete element reference, see the [BotML Reference](botml-reference.md).

## AgentML

**File extension:** `.agentml`
**Root element:** `<agent>`
**Parser:** `parseAgentML(xml, filePath)`
**Interpreter binding:** `bindInterpreter(program)`

AgentML defines runnable entity programs with typed arguments, control flow, bot invocation, working memory operations, entity graph mutations, and progress envelope emission.

**Key elements:** `<agent>`, `<static-args>`, `<arg>`, `<run-impl>`, `<let>`, `<if>`, `<else-if>`, `<else>`, `<loop>`, `<call-bot>`, `<call-entity>`, `<run-entity>`, `<yield-status>`, `<yield-waiting>`, `<wm-get>`, `<wm-set>`, `<graph-append>`, `<return>`, `<expr>`, `<data>`, `<field>`

For the complete element reference, see the [AgentML Reference](agentml-reference.md).

## BundleML

**File extension:** `.bundleml`
**Root element:** `<bundle>`
**Parser:** `parseBundleML(xml)`
**Validator:** `validateBundleML(xml, filePath)`

BundleML defines the top-level bundle manifest including server configuration, component constructors (entities and bots), HTTP endpoint definitions with inline handlers, and custom bundle methods.

**Key elements:** `<bundle>`, `<config>`, `<port>`, `<file-size-limit>`, `<max-files>`, `<constructors>`, `<entity>`, `<bot>`, `<endpoints>`, `<endpoint>`, `<handler>`, `<methods>`, `<method>`

For the complete element reference, see the [BundleML Reference](bundleml-reference.md).

## Expression Language

**Used by:** All four DSLs
**Evaluator:** `ExpressionEvaluator`

The shared expression language handles interpolation (`{{expr}}`), boolean conditions, and value expressions. It follows JavaScript syntax and runs in a sandboxed VM context.

For the complete expression syntax reference, see the [Expression Language Reference](expressions-reference.md).

## Shared Concepts

All four DSLs share common infrastructure documented in the [DSL Overview](../):

- **Expression evaluation** -- `{{interpolation}}` and condition expressions
- **Validation schemas** -- structural validation with typed error/warning reporting
- **Source location tracking** -- file, line, and column in error messages
- **ComponentRegistry integration** -- all parsed components register in a shared singleton

## See Also

- [DSL Overview](../) -- architecture, design rationale, and getting started
- [Examples](../examples/) -- annotated example bundles
- [E2E Bundle Walkthrough](../examples/xml-e2e-bundle.md) -- complete real-world bundle analysis
