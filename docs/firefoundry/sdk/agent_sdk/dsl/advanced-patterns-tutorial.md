# Advanced XML DSL Patterns

### The Goal

Master complex patterns that unlock the full power of the FireFoundry DSL system:
conditionals, loops, composition, orchestration, error handling, and schema generation.

### Prerequisites

Familiarity with the basics of PromptML, BotML, and AgentML. Start with the
[Agent SDK Getting Started guide](../agent_sdk_getting_started.md) and the reference
pages for each DSL if you have not already.

### The Scope

Patterns that are not obvious from the reference alone. Each chapter concludes with a
complete, working XML example.

---

## Chapter 1: Dynamic Prompts with Conditionals

PromptML provides `<if>`, `<else>`, and the `condition` attribute on `<text>` for
conditional prompt content.

### `<if>` and `<else>`

`<if>` takes a required `condition` attribute holding a JavaScript expression. When
truthy, its children render; when falsy, they are skipped. Pair with `<else>`:

```xml
<prompt role="system">
  <text>You are an analysis assistant.</text>
  <if condition="args.mode === 'detailed'">
    <text>Provide detailed analysis with explanations for each finding.</text>
    <else>
      <text>Provide a concise, one-paragraph summary.</text>
    </else>
  </if>
</prompt>
```

Expressions have access to `args` and `input`. See the
[Expressions Reference](reference/expressions-reference.md) for the full language.

### Nested Conditionals

Conditionals nest freely:

```xml
<if condition="args.mode === 'detailed'">
  <text>Provide detailed analysis.</text>
  <if condition="args.include_citations">
    <text>Cite sources using [Author, Year] format.</text>
  </if>
  <else>
    <text>Keep it brief -- two sentences maximum.</text>
  </else>
</if>
```

### Conditional Text vs. Conditional Sections

For a single `<text>`, use the `condition` attribute directly. For a group, use `<if>`:

```xml
<text condition="args.verbose">Think step by step before answering.</text>

<if condition="args.output_format === 'json'">
  <section name="json-instructions" semantic-type="instruction">
    <text>Return your response as a single JSON object.</text>
    <text>Do not include any text outside the JSON block.</text>
  </section>
</if>
```

### Complete Example: Multi-Mode Analyzer

```xml
<prompt-group id="analyzer-prompts">
  <prompt role="system">
    <text>You are a data analysis assistant.</text>
    <if condition="args.mode === 'brief'">
      <text>Keep your response under 100 words. Return JSON: summary, confidence.</text>
    </if>
    <if condition="args.mode === 'detailed'">
      <text>Provide thorough analysis. Return JSON: summary, findings, reasoning, confidence.</text>
      <text condition="args.include_citations">Cite sources using [Author, Year].</text>
    </if>
    <if condition="args.mode === 'tabular'">
      <text>Return a Markdown table: Finding, Evidence, Confidence.</text>
    </if>
  </prompt>
  <prompt role="user">
    <text>Analyze the following: {{input.topic}}</text>
    <text>Analysis type: {{args.analysis_type}}</text>
    <text condition="args.requested_by">Requested by: {{args.requested_by}}</text>
  </prompt>
</prompt-group>
```

---

## Chapter 2: Loops and Iteration

### `<for-each>` in PromptML

Iterates over an array and renders children once per item.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `items`   | yes      | Expression evaluating to an array |
| `as`      | no       | Variable for current item (default: `item`) |
| `index`   | no       | Variable for zero-based index |

```xml
<for-each items="args.topics" as="topic" index="i">
  <section name="topic-{{i}}">
    <text>Topic {{i + 1}}: {{topic.name}}</text>
    <text>Focus area: {{topic.focus}}</text>
  </section>
</for-each>
```

Loops nest -- use distinct variable names to avoid shadowing:

```xml
<for-each items="args.departments" as="dept" index="d">
  <text>Department: {{dept.name}}</text>
  <for-each items="dept.members" as="member" index="m">
    <text>  {{m + 1}}. {{member.name}} ({{member.role}})</text>
  </for-each>
</for-each>
```

### `<loop>` in AgentML

Same purpose but in a procedural context. Takes the same attributes as `<for-each>`.
The body accepts all `<run-impl>` children: `<let>`, `<if>`, `<call-bot>`,
`<call-entity>`, `<run-entity>`, `<yield-status>`, `<yield-waiting>`, `<wm-get>`,
`<wm-set>`, `<graph-append>`, `<return>`, and `<expr>`.

### Accumulating Results

Build up a collection across iterations using spread syntax in `<let>`:

```xml
<let name="all_results" value="[]"/>
<loop items="args.topics" as="topic" index="i">
  <call-bot name="TopicAnalyzerBot" result="topic_result">
    <arg name="topic" value="topic"/>
  </call-bot>
  <let name="all_results" value="[...all_results, { topic: topic, result: topic_result }]"/>
</loop>
<return value="all_results"/>
```

The inner `<let>` shadows the outer variable within loop scope. The spread reads the
outer value before the new declaration takes effect.

### Complete Example: Batch Processor (AgentML)

```xml
<agent id="BatchProcessor" display-name="Batch Processor">
  <static-args>
    <arg name="items" type="array" required="true"/>
  </static-args>
  <run-impl>
    <yield-status message="Processing {{args.items.length}} items"/>
    <let name="results" value="[]"/>
    <loop items="args.items" as="item" index="idx">
      <yield-status message="Item {{idx + 1}} of {{args.items.length}}"/>
      <call-bot name="ProcessorBot" result="processed">
        <arg name="content" value="item.content"/>
      </call-bot>
      <let name="results" value="[...results, { index: idx, output: processed }]"/>
    </loop>
    <return value="results"/>
  </run-impl>
</agent>
```

---

## Chapter 3: Bot Mixin Composition

Mixins compose reusable bot behaviors declaratively in BotML.

### What Mixins Do

A mixin augments a bot's prompt construction and output validation. Each can inject
prompts, register validators, and add preprocessors. Order matters -- later mixins
build on earlier ones.

### Built-in Mixins

| Mixin | Purpose |
|-------|---------|
| `StructuredOutputBotMixin` | Zod-schema prompt + JSON/YAML output validation |
| `DataValidationBotMixin` | Transforms JSON to validated class instances. Must follow `StructuredOutputBotMixin`. |
| `WorkingMemoryBotMixin` | Injects working memory items into the data section |
| `FeedbackBotMixin` | Conditional feedback prompt for human corrections |

### BotML Syntax

Declare under `<mixins>`. Each `<mixin>` needs `type`. Config goes in `<config>`:

```xml
<mixins>
  <mixin type="WorkingMemoryBotMixin"/>
  <mixin type="StructuredOutputBotMixin">
    <config struct_data_language="json"/>
  </mixin>
  <mixin type="FeedbackBotMixin">
    <config role="user"/>
  </mixin>
</mixins>
```

### Config Type Coercion

The BotML loader coerces config values: `"true"`/`"false"` become booleans, numeric
strings become numbers, everything else stays as strings.

### Nested Config

Use child elements for object-valued properties:

```xml
<mixin type="DataValidationBotMixin">
  <config>
    <validationOptions engine="convergent" maxIterations="5"/>
    <section>followup</section>
  </config>
</mixin>
```

Produces: `{ validationOptions: { engine: "convergent", maxIterations: 5 }, section: "followup" }`.

### Complete Example: Validation Bot with Three Mixins

```xml
<bot id="OrderValidatorBot" name="OrderValidatorBot" model-pool="gpt-4" max-tries="3">
  <llm-options temperature="0.1">
    <semantic-label>order-validator</semantic-label>
  </llm-options>
  <mixins>
    <mixin type="WorkingMemoryBotMixin"/>
    <mixin type="StructuredOutputBotMixin">
      <config struct_data_language="json"/>
    </mixin>
    <mixin type="FeedbackBotMixin">
      <config role="system"/>
    </mixin>
  </mixins>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are an order validation specialist.</text>
        <text>Validate orders against product catalog and business rules.</text>
        <text>Return validation result as JSON following the provided schema.</text>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Validate the following order: {{input.order_json}}</text>
        <text>- Maximum quantity per line item: 1000</text>
        <text>- Minimum order total: $10.00</text>
        <text condition="input.region === 'EU'">- EU orders require VAT ID</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

The `max-tries="3"` retries LLM calls on validation failure, feeding the error back
for self-correction.

---

## Chapter 4: Entity Orchestration Patterns

Complex bundles orchestrate multiple stages where each is its own entity.

### `<call-entity>`: Creating Child Entities

| Attribute    | Required | Description |
|--------------|----------|-------------|
| `type`       | yes      | Entity type name |
| `name`       | yes      | Instance name for idempotent creation |
| `result`     | no       | Variable to store entity reference |
| `idempotent` | no       | Idempotent creation (default: `"true"`) |

Pass data via `<data>` with `<field>` children or a single `<expr>`:

```xml
<call-entity type="ResearchEntity" name="research-phase" result="researcher">
  <data>
    <field name="topic" value="args.topic"/>
    <field name="deadline">
      <expr>new Date(Date.now() + 3600000).toISOString()</expr>
    </field>
  </data>
</call-entity>
```

### `<run-entity>`: Executing Child Workflows

| Attribute | Required | Description |
|-----------|----------|-------------|
| `ref`     | yes      | Variable holding entity reference |
| `result`  | no       | Variable to store return value |

Progress envelopes from children are forwarded to the parent.

### Complete Example: Multi-Stage Pipeline

```xml
<agent id="AnalysisPipeline" display-name="Multi-Stage Analysis Pipeline">
  <static-args>
    <arg name="topic" type="string" required="true"/>
    <arg name="analysis_type" type="string" default="general"/>
  </static-args>
  <run-impl>
    <yield-status message="Stage 1/3: Research"/>
    <call-entity type="ResearchEntity" name="research-{{args.topic}}" result="researcher">
      <data><field name="topic" value="args.topic"/></data>
    </call-entity>
    <run-entity ref="researcher" result="research_data"/>

    <yield-status message="Stage 2/3: Analysis"/>
    <call-entity type="AnalysisEntity" name="analysis-{{args.topic}}" result="analyzer">
      <data>
        <field name="research" value="research_data"/>
        <field name="analysis_type" value="args.analysis_type"/>
      </data>
    </call-entity>
    <run-entity ref="analyzer" result="analysis_result"/>

    <yield-status message="Stage 3/3: Summarization"/>
    <call-bot name="SummarizerBot" result="final_summary">
      <arg name="research" value="research_data"/>
      <arg name="analysis" value="analysis_result"/>
    </call-bot>

    <graph-append edge-type="ProducedAnalysis" target="self">
      <data>
        <field name="topic" value="args.topic"/>
        <field name="timestamp"><expr>new Date().toISOString()</expr></field>
      </data>
    </graph-append>
    <return value="final_summary"/>
  </run-impl>
</agent>
```

The `name` attribute supports `{{expression}}` interpolation for deterministic,
idempotent entity naming.

---

## Chapter 5: Working Memory Patterns

Working memory is a key-value store that persists across bot calls, workflow restarts,
and entity boundaries.

### `<wm-set>` and `<wm-get>`

| Element    | Key Attributes |
|------------|---------------|
| `<wm-set>` | `key` (required, supports `{{interpolation}}`), `value` (expression) or `<expr>` child |
| `<wm-get>` | `key` (required, supports `{{interpolation}}`), `as` (required, variable name) |

```xml
<wm-set key="analysis/latest-result" value="analysis_result"/>

<wm-set key="analysis/metadata">
  <expr>({ timestamp: new Date().toISOString(), topic: args.topic })</expr>
</wm-set>

<wm-get key="analysis/latest-result" as="previous_result"/>
```

If a key does not exist, `<wm-get>` binds the variable to `undefined`.

### Key Namespacing

Use slash-separated paths: `analysis/latest-result`, `orders/order-123/status`,
`audit/2024-01-15T10:30:00Z`.

### Cross-Workflow State Sharing

Entities in the same graph share working memory:

```xml
<!-- ResearchEntity writes -->
<wm-set key="shared/research-findings" value="research_result"/>
<!-- AnalysisEntity reads -->
<wm-get key="shared/research-findings" as="findings"/>
```

### Complete Example: Incremental Analysis with History

```xml
<agent id="IncrementalAnalyzer" display-name="Incremental Analyzer">
  <static-args>
    <arg name="topic" type="string" required="true"/>
    <arg name="iteration" type="number" default="1"/>
  </static-args>
  <run-impl>
    <wm-get key="analysis/{{args.topic}}/latest" as="previous"/>

    <if condition="previous !== null">
      <yield-status message="Refining (iteration {{args.iteration}})"/>
      <call-bot name="RefineAnalysisBot" result="current_result">
        <arg name="previous_analysis" value="previous"/>
        <arg name="topic" value="args.topic"/>
      </call-bot>
      <else>
        <yield-status message="Starting fresh analysis"/>
        <call-bot name="InitialAnalysisBot" result="current_result">
          <arg name="topic" value="args.topic"/>
        </call-bot>
      </else>
    </if>

    <wm-set key="analysis/{{args.topic}}/latest" value="current_result"/>
    <let name="ts" value="new Date().toISOString()"/>
    <wm-set key="analysis/{{args.topic}}/history/{{ts}}">
      <expr>({ iteration: args.iteration, summary: current_result.summary, timestamp: ts })</expr>
    </wm-set>
    <return value="current_result"/>
  </run-impl>
</agent>
```

---

## Chapter 6: Error Handling and Resilience

### Bot Retry via `max-tries`

The `max-tries` attribute on `<bot>` controls retry count. Each retry includes the
previous validation error for self-correction. Combined with `StructuredOutputBotMixin`,
most format errors resolve within two or three attempts:

```xml
<bot id="StrictParserBot" name="StrictParserBot" max-tries="5">
  <!-- ... -->
</bot>
```

### Conditional Fallback

Check results after `<call-bot>` and branch:

```xml
<call-bot name="PrimaryAnalyzerBot" result="analysis_result">
  <arg name="topic" value="args.topic"/>
</call-bot>

<if condition="analysis_result === null || analysis_result.confidence &lt; 0.3">
  <yield-status message="Primary analysis inconclusive, trying fallback"/>
  <call-bot name="FallbackAnalyzerBot" result="analysis_result">
    <arg name="topic" value="args.topic"/>
  </call-bot>
</if>
```

Multi-tier fallback with `<else-if>` and `<else>`:

```xml
<if condition="analysis_result.confidence >= 0.8">
  <yield-status message="High confidence result"/>
  <else-if condition="analysis_result.confidence >= 0.5">
    <call-bot name="ReviewBot" result="analysis_result">
      <arg name="analysis" value="analysis_result"/>
    </call-bot>
  </else-if>
  <else>
    <yield-waiting prompt="Confidence is {{analysis_result.confidence}}. Please review."/>
  </else>
</if>
```

### `<yield-waiting>`: Human-in-the-Loop

Pauses execution and emits a WAITING envelope for human intervention.

| Attribute    | Required | Description |
|--------------|----------|-------------|
| `prompt`     | no       | Message for the reviewer (supports `{{interpolation}}`) |
| `timeout-ms` | no      | Maximum wait in milliseconds |

### Complete Example: Reviewable Analysis

```xml
<agent id="ReviewableAnalysis" display-name="Reviewable Analysis">
  <static-args>
    <arg name="topic" type="string" required="true"/>
    <arg name="require_approval" type="boolean" default="true"/>
    <arg name="confidence_threshold" type="number" default="0.7"/>
  </static-args>
  <run-impl>
    <call-bot name="AnalyzerBot" result="analysis">
      <arg name="topic" value="args.topic"/>
      <arg name="mode" value="'detailed'"/>
    </call-bot>

    <if condition="analysis === null">
      <call-bot name="AnalyzerBot" result="analysis">
        <arg name="topic" value="args.topic"/>
        <arg name="mode" value="'brief'"/>
      </call-bot>
    </if>

    <if condition="analysis !== null &amp;&amp; analysis.confidence &lt; args.confidence_threshold">
      <call-bot name="EnrichmentBot" result="analysis">
        <arg name="original" value="analysis"/>
        <arg name="topic" value="args.topic"/>
      </call-bot>
    </if>

    <if condition="args.require_approval">
      <wm-set key="review/pending/{{args.topic}}" value="analysis"/>
      <yield-waiting
        prompt="Analysis for '{{args.topic}}' ready. Confidence: {{analysis.confidence}}."
        timeout-ms="7200000"/>
    </if>

    <wm-set key="analysis/approved/{{args.topic}}" value="analysis"/>
    <return value="analysis"/>
  </run-impl>
</agent>
```

Note `&amp;&amp;` and `&lt;` in conditions -- XML attributes require escaping `&` and
`<`. Alternatively, move complex logic into a `<let>` with `<expr>`.

---

## Chapter 7: Schema Generation in Prompts

PromptML's `<schema-node>` and `<field>` embed human-readable schema descriptions in
prompts.

### Attributes

| Element | Attribute | Required | Description |
|---------|-----------|----------|-------------|
| `<schema-node>` | `name` | yes | Schema object name |
| `<schema-node>` | `type` | no | Type (e.g., `"object"`) |
| `<schema-node>` | `description` | no | Human-readable description |
| `<schema-node>` | `condition` | no | Conditional rendering expression |
| `<field>` | `name` | yes | Field name |
| `<field>` | `type` | yes | e.g., `"string"`, `"number"`, `"array"` |
| `<field>` | `description` | no | Human-readable description |
| `<field>` | `condition` | no | Conditional rendering expression |

### Conditional Fields

Toggle fields so the LLM only sees relevant ones:

```xml
<schema-node name="ExtractionResult" type="object">
  <field name="title" type="string" description="Document title"/>
  <field name="author" type="string" description="Primary author"/>
  <field name="abstract" type="string" description="Document abstract"
         condition="args.include_abstract"/>
  <field name="citations" type="array" description="Referenced works"
         condition="args.extract_citations"/>
</schema-node>
```

### Dynamic Schema with `<for-each>`

```xml
<schema-node name="Survey" type="object">
  <field name="respondent_id" type="string" description="Respondent ID"/>
  <for-each items="args.questions" as="question" index="q">
    <field name="answer_{{q}}" type="{{question.type}}"
           description="Answer to: {{question.text}}"/>
  </for-each>
</schema-node>
```

### Complete Example: Adaptive Extraction by Document Type

```xml
<prompt-group id="adaptive-extraction">
  <prompt role="system">
    <text>Extract structured data according to the schema below.</text>

    <if condition="args.doc_type === 'research_paper'">
      <schema-node name="PaperExtraction" type="object">
        <field name="title" type="string" description="Paper title"/>
        <field name="authors" type="array" description="Author names"/>
        <field name="abstract" type="string" description="Abstract"/>
        <field name="key_findings" type="array" description="Key findings"/>
        <field name="doi" type="string" description="DOI if available"
               condition="args.extract_doi"/>
      </schema-node>
    </if>

    <if condition="args.doc_type === 'invoice'">
      <schema-node name="InvoiceExtraction" type="object">
        <field name="invoice_number" type="string" description="Invoice number"/>
        <field name="vendor_name" type="string" description="Vendor name"/>
        <field name="total_amount" type="number" description="Total amount"/>
        <field name="currency" type="string" description="ISO currency code"/>
        <field name="line_items" type="array" description="Line items"/>
        <field name="due_date" type="string" description="Due date (ISO 8601)"/>
      </schema-node>
    </if>

    <if condition="args.doc_type === 'general'">
      <schema-node name="GeneralExtraction" type="object">
        <field name="title" type="string" description="Title"/>
        <field name="summary" type="string" description="Summary"/>
        <for-each items="args.custom_fields" as="cf">
          <field name="{{cf.name}}" type="{{cf.type}}" description="{{cf.description}}"/>
        </for-each>
      </schema-node>
    </if>

    <text>Return only the JSON object with no surrounding text.</text>
  </prompt>
  <prompt role="user">
    <text>Document type: {{args.doc_type}}</text>
    <text>Content: {{input.document_text}}</text>
  </prompt>
</prompt-group>
```

### How This Works with `StructuredOutputBotMixin`

`<schema-node>` describes the shape to the LLM in natural language.
`StructuredOutputBotMixin` validates actual output with a Zod schema. Keep both in sync
for best results: PromptML guides the model, the mixin validates the result.

---

## Combining Patterns

### Scenario 1: Conditional Batch Processing

Loop, branch by type, persist:

```xml
<loop items="args.documents" as="doc" index="i">
  <yield-status message="Processing {{i + 1}}: {{doc.title}}"/>
  <if condition="doc.type === 'research_paper'">
    <call-bot name="PaperExtractorBot" result="extraction">
      <arg name="document" value="doc"/>
    </call-bot>
    <else-if condition="doc.type === 'invoice'">
      <call-bot name="InvoiceExtractorBot" result="extraction">
        <arg name="document" value="doc"/>
      </call-bot>
    </else-if>
    <else>
      <call-bot name="GeneralExtractorBot" result="extraction">
        <arg name="document" value="doc"/>
      </call-bot>
    </else>
  </if>
  <wm-set key="extractions/{{doc.id}}" value="extraction"/>
</loop>
```

### Scenario 2: Entity Pipeline with Approval Gate

```xml
<call-entity type="ResearchEntity" name="research" result="researcher">
  <data><field name="topic" value="args.topic"/></data>
</call-entity>
<run-entity ref="researcher" result="research_data"/>

<call-bot name="AnalyzerBot" result="analysis">
  <arg name="research" value="research_data"/>
</call-bot>

<wm-set key="pipeline/analysis" value="analysis"/>
<if condition="analysis.confidence &lt; 0.9">
  <yield-waiting prompt="Confidence is {{analysis.confidence}}. Review before publishing."/>
</if>
<call-bot name="PublisherBot" result="published">
  <arg name="analysis" value="analysis"/>
</call-bot>
```

### Scenario 3: Adaptive Bot with Feedback

Conditional schema + feedback mixin in one BotML file:

```xml
<bot id="AdaptiveExtractor" name="AdaptiveExtractor" max-tries="3">
  <mixins>
    <mixin type="StructuredOutputBotMixin">
      <config struct_data_language="json"/>
    </mixin>
    <mixin type="FeedbackBotMixin">
      <config role="system"/>
    </mixin>
  </mixins>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a document extraction specialist.</text>
        <if condition="args.doc_type === 'research_paper'">
          <schema-node name="PaperExtraction" type="object">
            <field name="title" type="string" description="Paper title"/>
            <field name="authors" type="array" description="Author names"/>
          </schema-node>
        </if>
        <if condition="args.doc_type === 'invoice'">
          <schema-node name="InvoiceExtraction" type="object">
            <field name="invoice_number" type="string" description="Invoice number"/>
            <field name="total_amount" type="number" description="Total amount"/>
          </schema-node>
        </if>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Extract data from: {{input.document_text}}</text>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

The prompt adapts to document type, the structured output mixin validates JSON, and the
feedback mixin allows human corrections -- all declarative XML.

---

## What's Next

- [PromptML Reference](reference/promptml-reference.md) -- complete element and attribute details
- [AgentML Reference](reference/agentml-reference.md) -- every procedural element and its behavior
- [BotML Reference](reference/botml-reference.md) -- bot definition, mixins, and tools
- [BundleML Reference](reference/bundleml-reference.md) -- wiring prompts, bots, and agents
- [Expressions Reference](reference/expressions-reference.md) -- operators, functions, interpolation
- [Agent SDK Getting Started](../agent_sdk_getting_started.md) -- revisit the fundamentals

When you outgrow what the XML DSL can express, the TypeScript SDK gives full
programmatic control. Every XML construct has a TypeScript equivalent, and you can mix
XML-defined components with code-defined entities. See the
[Agent SDK core documentation](../core/README.md) for the TypeScript API.
