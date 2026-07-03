# Part 4: Configuring LLM Behavior with BotML

By the end of this part, you will understand how `analyzer-bot.botml` configures the LLM, how `<structured-prompt-group>` separates system instructions from per-request user content, and why prompt interpolation uses `input.*` instead of `args.*`. You will also see the standalone `analyzer-prompt.promptml` file and understand its role — and why it does not participate in the runtime execution path.

**What you'll learn:**
- How BotML attributes (`max-tries`, `temperature`, `model-pool`) shape LLM behavior
- How `<structured-prompt-group>` with `<base>` and `<input>` separates stable instructions from dynamic content
- Why BotML interpolation uses `{{input.*}}` and under what circumstances `{{args.*}}` is valid
- How `<if condition="...">` inside BotML works identically to PromptML conditionals
- How `analyzer-prompt.promptml` relates to the runtime-active prompt and why it is not auto-loaded

---

## The Bot Configuration

Here is the complete `analyzer-bot.botml`:

```xml
<bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">
  <llm-options temperature="0.3">
    <model-pool>firebrand_completion_default</model-pool>
    <semantic-label>xml-dsl-analyzer</semantic-label>
  </llm-options>
  <structured-prompt-group>
    <base>
      <prompt role="system">
        <text>You are a content analysis assistant for the FireFoundry platform.</text>
        <text>Respond ONLY with a valid JSON object.</text>
        <text>The JSON object must have exactly these keys: summary (string), topic (string), sentiment (one of "positive", "negative", or "neutral"), findings (array of strings), confidence (number between 0 and 1).</text>
        <if condition="args.mode === 'detailed'">
          <text>Provide detailed analysis with explanations for each finding.</text>
        </if>
      </prompt>
    </base>
    <input>
      <prompt role="user">
        <text>Analyze the following content: {{input.topic}}</text>
        <section name="context">
          <text>Analysis type: {{input.analysis_type}}</text>
          <text>Requested by: {{input.requested_by}}</text>
        </section>
      </prompt>
    </input>
  </structured-prompt-group>
</bot>
```

## The `<bot>` Root Element

The `id` and `name` attributes both equal `AnalyzerBot`. The `id` is the registry key used internally; the `name` is the label used in `<call-bot name="AnalyzerBot">` from AgentML. Both must match the corresponding `<call-bot name="...">` instruction in `analysis-workflow.agentml`.

`max-tries="2"` tells the interpreter to retry the LLM call up to 2 times if it fails. This is the standard retry setting for structured JSON output bots — one initial attempt plus one retry if the response is malformed or the request errors.

## `<llm-options>` — Model Configuration

```xml
<llm-options temperature="0.3">
  <model-pool>firebrand_completion_default</model-pool>
  <semantic-label>xml-dsl-analyzer</semantic-label>
</llm-options>
```

**`temperature="0.3"`**: Low temperature reduces output variance, which is appropriate for structured JSON output. Higher temperatures (0.7–1.0) are used for creative tasks; lower temperatures (0.1–0.3) are used when the output must follow a strict schema.

**`<model-pool>firebrand_completion_default</model-pool>`**: The model pool name used for routing LLM requests through FireFoundry's broker. The broker resolves the pool name to a specific model and endpoint. Using a named pool rather than a hardcoded model name means the pool's backing model can be updated without touching the DSL file.

**`<semantic-label>xml-dsl-analyzer</semantic-label>`**: A telemetry label attached to every LLM request from this bot. Visible in traces and logs; used to filter and group bot calls in the monitoring dashboard.

## `<structured-prompt-group>` — The Two-Section Prompt

BotML separates prompts into two sections:

- **`<base>`**: Contains the system prompt — stable instructions that do not change between requests. These are rendered once and cached per bot registration.
- **`<input>`**: Contains the user prompt — per-request content that includes dynamic values from the caller. Re-rendered on every bot call with the current context.

This separation is a deliberate design choice. It allows the system prompt to be optimized for prompt caching at the LLM layer: stable `<base>` content is a strong cache hit candidate, while `<input>` content changes with every request.

## PromptML Elements Inside BotML

The elements inside `<base>` and `<input>` are standard PromptML elements. They work identically here as they would in a standalone `.promptml` file. BotML simply embeds them rather than loading them from an external file.

### `<prompt role="system">` and `<text>`

Each `<text>` element is a static instruction node. Multiple `<text>` elements within a `<prompt>` are concatenated with newlines during rendering. The LLM receives them as a single system message.

```xml
<prompt role="system">
  <text>You are a content analysis assistant for the FireFoundry platform.</text>
  <text>Respond ONLY with a valid JSON object.</text>
  <text>The JSON object must have exactly these keys: ...</text>
</prompt>
```

Breaking instructions into separate `<text>` elements makes it easier to add, remove, or reorder individual instructions without disturbing surrounding content.

### `<if condition="...">` — PromptML Conditionals

```xml
<if condition="args.mode === 'detailed'">
  <text>Provide detailed analysis with explanations for each finding.</text>
</if>
```

The `condition` attribute is evaluated as a JavaScript expression using the `ExpressionEvaluator`. In the BotML context, `args` refers to the arguments passed to the bot via `<call-bot>`. This is the `args.mode === 'detailed'` check — the `mode` arg is passed as `"detailed"` in the AgentML workflow, so this condition always evaluates to `true` in this bundle, and the detailed instruction is always included.

You could make this conditional meaningful by changing the AgentML arg to pass a user-supplied value. The `<if>` syntax is identical whether you use it in a standalone `.promptml` file or embedded inside BotML — the same parser and evaluator handles both.

### `<section name="context">` — Semantic Grouping

```xml
<section name="context">
  <text>Analysis type: {{input.analysis_type}}</text>
  <text>Requested by: {{input.requested_by}}</text>
</section>
```

`<section>` groups related content under a semantic label. The renderer converts this into a labeled block in the rendered prompt, making it visually distinct for the LLM. It does not change the semantics of the content — it is a presentation aid.

## `{{input.*}}` vs `{{args.*}}` — The Key Distinction

The double-brace interpolation `{{input.topic}}` and `{{input.analysis_type}}` uses `input.*` rather than `args.*`. This is not an error — it is a consequence of how `<call-bot>` passes arguments to the bot.

In `analysis-workflow.agentml`, the `<call-bot>` block passes:

```xml
<arg name="input" value="args"/>
```

This maps the **entire `args` object** from the AgentML context to an argument named `input` in the bot's context. Inside BotML, `<call-bot>` arguments are available under their argument names. So:

- `args.topic` in AgentML → `input.topic` in BotML (because `input = args`)
- `args.analysis_type` in AgentML → `input.analysis_type` in BotML
- `args.requested_by` in AgentML → `input.requested_by` in BotML
- `args.mode` is passed separately and available as `args.mode` directly in the BotML `<if condition="args.mode === 'detailed'">` check

A simpler way to state this: in BotML's `<input>` prompt, use `{{input.*}}` for values that came from `<call-bot>` arguments. Use `{{args.*}}` for direct arg values (like `mode`) that were passed without the `input` wrapper.

## The Standalone PromptML File

The `analyzer-prompt.promptml` file in the same directory contains a standalone version of the prompt:

```xml
<prompt-group>
  <prompt role="system">
    <text>You are a content analysis assistant for the FireFoundry platform.</text>
    <text>Your job is to analyze the provided text and return a structured JSON response.</text>
    <if condition="args.mode === 'detailed'">
      <text>Provide detailed analysis with explanations for each finding.</text>
    </if>
  </prompt>
  <prompt role="user">
    <text>Analyze the following content: {{input.topic}}</text>
    <section name="context">
      <text>Analysis type: {{args.analysis_type}}</text>
      <text>Requested by: {{args.requested_by}}</text>
    </section>
    <text>Return your analysis as a JSON object with keys: summary, topic, sentiment, findings (array), and confidence (number 0-1).</text>
  </prompt>
</prompt-group>
```

**This file is NOT loaded at runtime.** `bootstrapFromBundleML()` only processes `<entity>` and `<bot>` constructors from the `<constructors>` block. There is no `<prompt>` constructor type — standalone `.promptml` files must be explicitly registered by TypeScript code, which does not exist in this zero-TypeScript bundle.

The file is included for two purposes:
1. **Documentation**: It shows the prompt logic in standalone PromptML syntax, which is useful for readers learning the DSL system.
2. **TypeScript-wiring compatibility**: If this bundle were adapted to TypeScript-wiring mode (with a hand-written `agent-bundle.ts`), the standalone file could be registered manually and linked to the bot.

The runtime-active prompt is the one embedded in `<structured-prompt-group>` inside `analyzer-bot.botml`.

## Run and Verify

Open the demo GUI at `http://localhost:4000`. Submit the following text with analysis type **impact**:

```
Global chip shortage impacts automotive production lines.
```

When the result appears, check the `findings` array in the result panel. You should see **two or more** findings — for example:
- "Automotive production reduced due to chip supply constraints"
- "Lead times for chip components have extended significantly"
- "Multiple OEMs announced output reductions"

A `findings` array with 2 or more entries confirms the `<if condition="args.mode === 'detailed'">` branch was taken. The AgentML workflow always passes `mode: "detailed"`, so the detailed-analysis instruction is always active. The `sentiment` should be `"negative"` and `confidence` between 0.7 and 0.95.

---

**Next**: [Part 5: Ship It: xml-bundle-server and the Fleet Model](./part-05.md) — package the DSL files into a Kubernetes ConfigMap and deploy the bundle with Helm.
