# Part 7: Structured Output & Validation

In this part, you'll look inside the `ReportGenerationBot` to understand how FireFoundry gets reliable, validated structured output from an LLM. You'll learn how `StructuredOutputBotMixin` automatically injects schema documentation into the prompt, how `withSchemaMetadata` adds natural language descriptions that improve LLM compliance, and how Zod validation catches and handles non-conforming output.

**What you'll learn:**
- Designing Zod schemas with `.describe()` annotations that guide LLM output
- Using `withSchemaMetadata` to add top-level names and descriptions to schemas
- How `StructuredOutputBotMixin` converts your schema into prompt instructions
- How the mixin validates LLM output and handles failures
- Adding domain-specific validation rules through prompt engineering
- Testing structured output with different document types

**What you'll build:** A refined `ReportGenerationBot` with a well-annotated output schema and HTML-specific validation rules, plus an understanding of the internals that make structured output work.

**Starting point:** Completed code from [Part 6: Workflow Orchestration](./part-06-orchestration.md). You should have a working `ReportGenerationBot` with basic structured output.

---

## How Structured Output Works in FireFoundry

Before modifying any code, let's trace the full path from schema definition to validated output. Understanding these internals will help you design better schemas and debug output issues.

### The Full Pipeline

```
1. You define a Zod schema with .describe() annotations
         |
         v
2. withSchemaMetadata adds a top-level name and description
         |
         v
3. StructuredOutputBotMixin reads the schema at construction time
         |
         v
4. At prompt assembly time, the mixin generates a schema documentation
   prompt and appends it to the bot's prompt group
         |
         v
5. The LLM receives: [system prompt] + [schema docs] + [user input]
         |
         v
6. The LLM returns text containing JSON (possibly wrapped in markdown)
         |
         v
7. The mixin extracts JSON from the response text
         |
         v
8. The mixin validates extracted JSON against the Zod schema
         |
         v
9. If valid: returns typed result. If invalid: returns validation errors.
```

Each of these steps is important. Let's look at them in detail.

---

## Step 1: Design the Output Schema

The schema defines what the LLM must produce. Every property's `.describe()` annotation becomes part of the prompt the LLM sees, so write descriptions as instructions, not documentation.

**`apps/report-bundle/src/schemas.ts`**:

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

/**
 * Output schema for the Report Generation Bot.
 *
 * Design principles:
 * 1. Use .describe() on every field -- the LLM sees these as instructions
 * 2. Put "reasoning" before "html_content" -- the LLM thinks in order,
 *    so having it reason first produces better HTML
 * 3. Be specific in descriptions -- "Complete HTML document" is better
 *    than just "HTML"
 */
export const ReportOutputSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string()
      .describe('Your thought process for structuring this report. Explain what sections you chose, why you organized them this way, and how you addressed the user instructions. Think step by step.'),
    html_content: z.string()
      .describe('Complete HTML document with embedded CSS styling. Must include DOCTYPE, html, head with style tag, and body. Do not include JavaScript or interactive elements. Optimize CSS for print rendering.')
  }),
  'Your final output',                              // Schema name (appears in prompt)
  'AI-generated HTML report with reasoning'          // Schema description (appears in prompt)
);

export type REPORT_OUTPUT = z.infer<typeof ReportOutputSchema>;
```

### Why Field Order Matters

LLMs generate tokens sequentially. When `reasoning` comes before `html_content`, the model:
1. First articulates its plan (what sections, what emphasis, what structure)
2. Then generates HTML informed by that plan

If you reversed the order, the model would generate HTML first and then try to rationalize it after the fact. The "reasoning first" pattern consistently produces higher quality output.

### Writing Effective `.describe()` Annotations

Think of `.describe()` as writing instructions for a contractor:

```typescript
// BAD: Vague documentation-style description
z.string().describe('The HTML content')

// GOOD: Specific instruction-style description
z.string().describe('Complete HTML document with embedded CSS styling. Must include DOCTYPE, html, head with style tag, and body. Do not include JavaScript or interactive elements.')
```

The `.describe()` text appears directly in the prompt. Write it as if you're telling someone what to produce, not documenting what a field contains.

---

## Step 2: Understand `withSchemaMetadata`

The `withSchemaMetadata` function attaches a name and description to the schema object itself (not to individual fields). These appear as the header of the schema documentation in the prompt.

```typescript
export function withSchemaMetadata<T extends z.ZodType<any>>(
  schema: T,
  name: string,
  description?: string
): T
```

| Argument | Purpose | Example |
|----------|---------|---------|
| `schema` | The Zod schema to annotate | `z.object({ ... })` |
| `name` | Top-level label shown in the prompt | `'Your final output'` |
| `description` | Optional elaboration | `'AI-generated HTML report with reasoning'` |

The metadata is stored as properties on the schema object using special keys (`__schemaName` and `__schemaDescription`). The `StructuredOutputBotMixin` reads these when building the prompt.

### What the LLM Sees

When the mixin renders the schema into the prompt, it produces text like this:

```
Output your response using the following schema in json format:
Your final output. AI-generated HTML report with reasoning
reasoning: string. Your thought process for structuring this report. Explain what sections you chose, why you organized them this way, and how you addressed the user instructions. Think step by step.
html_content: string. Complete HTML document with embedded CSS styling. Must include DOCTYPE, html, head with style tag, and body. Do not include JavaScript or interactive elements. Optimize CSS for print rendering.
```

This is a natural-language representation of the schema, not a JSON Schema document. The format is designed to be easy for LLMs to understand and follow. Each property is listed with its type and description on a single line.

---

## Step 3: Understand StructuredOutputBotMixin Internals

The `StructuredOutputBotMixin` is a bot mixin that adds two capabilities:

1. **Schema prompt injection** -- automatically adds schema documentation to the bot's prompt
2. **Output validation** -- validates the LLM's response against the Zod schema

### How the Mixin is Composed

In `ReportGenerationBot`, the mixin is composed using the `ComposeMixins` pattern:

```typescript
import {
  MixinBot,
  MixinBotConfig,
  StructuredOutputBotMixin,
  FeedbackBotMixin
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';

export class ReportGenerationBot extends ComposeMixins(
  MixinBot,                      // Base bot with prompt and LLM calling
  StructuredOutputBotMixin,      // Adds schema docs + validation
  FeedbackBotMixin               // Adds feedback/revision support
)<[
  MixinBot<REPORT_BTH, [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>, FeedbackBotMixin<REPORT_BTH>]>,
  [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>, FeedbackBotMixin<REPORT_BTH>]
]> {
  constructor() {
    const promptGroup = new StructuredPromptGroup<REPORT_PTH>({
      base: new PromptGroup([
        {
          name: "report_generation_system",
          prompt: new ReportGenerationPrompt('system', {}) as any
        }
      ]),
      input: new PromptGroup([
        {
          name: "user_input",
          prompt: new PromptInputText({})
        }
      ]),
    });

    const config: MixinBotConfig<REPORT_BTH> = {
      name: "ReportGenerationBot",
      base_prompt_group: promptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {}
    };

    super(
      [config],                            // MixinBot config
      [{ schema: ReportOutputSchema }],    // StructuredOutputBotMixin config
      [{}]                                 // FeedbackBotMixin config
    );
  }
}
```

### Prompt Assembly Order

When the bot assembles its prompt for the LLM, the sections appear in this order:

1. **Base prompts** -- your `ReportGenerationPrompt` (context, task, document content, layout, rules)
2. **Extension prompts** -- the `StructuredOutputBotMixin` schema documentation (injected automatically)
3. **Input prompts** -- the user's instructions via `PromptInputText`

The schema documentation is injected as a system-role message. The LLM sees your domain instructions first, then the output format requirements, then the user's request.

### Validation Flow

After the LLM responds, the mixin validates the output:

```typescript
// Inside StructuredOutputBotMixin (simplified)
const validator = (llmOutput, partial) => {
  // Step 1: Extract JSON from the response text.
  // The LLM might wrap JSON in markdown code fences or
  // include explanatory text around it.
  let candidate = partial;
  if (candidate === undefined) {
    if (llmOutput.type !== 'text') {
      return { valid: false, errors: ['Expected text content'] };
    }
    const extracted = extractJSON(llmOutput.content);
    candidate = JSON.parse(extracted);
  }

  // Step 2: Validate against the Zod schema
  const result = this.outputSchema.safeParse(candidate);
  if (!result.success) {
    return {
      valid: false,
      errors: [`Schema validation failed: ${result.error.message}`]
    };
  }

  // Step 3: Return the validated, typed data
  return { valid: true, partial: result.data };
};
```

Key details:
- **JSON extraction** uses `extractJSON`, which handles markdown code fences, leading/trailing text, and other common LLM response patterns
- **`safeParse`** (not `parse`) is used so validation errors don't throw exceptions
- The validated `result.data` is the properly typed `REPORT_OUTPUT` object

---

## Step 4: Enhance the Schema for Better Output

Now that you understand the internals, let's improve the schema to get better HTML from the LLM. The key insight is that Zod `.describe()` annotations are your primary tool for prompt engineering the output format.

**`apps/report-bundle/src/schemas.ts`** (enhanced version):

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

/**
 * Enhanced output schema with detailed field descriptions.
 *
 * Each .describe() is a direct instruction to the LLM about what
 * to produce for that field. Be specific and actionable.
 */
export const ReportOutputSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string()
      .describe(
        'Your step-by-step thought process for structuring this report. ' +
        'Include: (1) what key information you identified in the source document, ' +
        '(2) how you decided to organize the report sections, ' +
        '(3) what formatting choices you made for the target orientation, ' +
        '(4) how you addressed the user\'s specific instructions. ' +
        'Be thorough -- this reasoning improves the quality of the HTML you generate next.'
      ),
    html_content: z.string()
      .describe(
        'A complete, self-contained HTML document ready for PDF conversion. ' +
        'Requirements: ' +
        '(1) Start with <!DOCTYPE html> and include <html>, <head>, and <body> tags. ' +
        '(2) Include all CSS in a single <style> tag within <head> -- no external stylesheets. ' +
        '(3) Use semantic HTML5 elements: <header>, <main>, <section>, <article>, <footer>. ' +
        '(4) Style for print: avoid fixed/absolute positioning, use @page CSS rules for margins. ' +
        '(5) Use professional fonts (Georgia, Arial, Helvetica) and business-appropriate colors. ' +
        '(6) Add CSS page-break-before or page-break-after where sections should start on new pages. ' +
        '(7) Do NOT include <script> tags, forms, buttons, or any interactive elements. ' +
        '(8) Ensure tables have proper borders and alternating row colors for readability.'
      )
  }),
  'Your final output',
  'A JSON object containing your reasoning and the complete HTML report'
);

export type REPORT_OUTPUT = z.infer<typeof ReportOutputSchema>;
```

### Why This Works

The enhanced descriptions act as a mini-specification embedded in the schema. When the `StructuredOutputBotMixin` renders this into the prompt, the LLM receives explicit requirements for each field. This is more reliable than putting all requirements in the system prompt because:

1. **Proximity** -- the requirements appear right next to the field they apply to
2. **Enforceability** -- if the LLM doesn't produce valid JSON with both fields, Zod rejects it
3. **Composability** -- you can use the same schema with different system prompts and still get consistent output structure

---

## Step 5: Add HTML-Specific Validation in the Prompt

While Zod validates the JSON structure, it cannot validate the HTML content itself (Zod only knows it's a string). For HTML-specific rules, you add validation guidance in the prompt.

Update the Rules section of `ReportGenerationPrompt` to reinforce the schema's requirements:

**`apps/report-bundle/src/prompts/ReportGenerationPrompt.ts`** (updated rules section):

```typescript
/**
 * Rules section -- HTML generation rules.
 * These reinforce the schema's .describe() annotations with
 * additional context and examples.
 */
protected get_Rules_Section(): PromptTemplateNode<REPORT_PTH> {
  return new PromptTemplateSectionNode<REPORT_PTH>({
    semantic_type: 'rule',
    content: 'HTML Generation Rules:',
    children: [
      new PromptTemplateListNode<REPORT_PTH>({
        semantic_type: 'rule',
        children: [
          'Include complete HTML structure: DOCTYPE, html, head, body',
          'Add CSS in a <style> tag within <head> -- no external resources',
          'Use semantic HTML5 elements (header, main, section, footer)',
          'Style for print -- avoid fixed positioning, use @page rules',
          'Use professional fonts and business-appropriate colors',
          'Ensure good contrast and readability (dark text on light background)',
          'Add CSS page breaks where appropriate (page-break-before: always)',
          'Tables must have borders, headers, and alternating row colors',
          'Do NOT include script tags, forms, or interactive elements',
          'Escape special characters in text content (& < > " \')'
        ],
        list_label_function: (_req, _child, idx) => `${idx + 1}. `
      }),

      // Reinforce the output format
      'IMPORTANT: Your response must be valid JSON matching the output schema exactly.',
      'The html_content field must contain the COMPLETE HTML document as a single string.',
      'Do not truncate or abbreviate the HTML -- include the full document.'
    ]
  });
}
```

### The Schema-Prompt Relationship

Notice the overlap between the schema's `.describe()` and the prompt's rules. This is intentional:

| Layer | Role | Enforcement |
|-------|------|-------------|
| Schema `.describe()` | Defines the output contract | Structural (Zod validates JSON shape) |
| Prompt rules | Provides context and emphasis | Behavioral (guides LLM generation) |
| `StructuredOutputBotMixin` | Bridges schema to prompt | Automatic (injects schema docs) |

The schema is the source of truth for structure. The prompt provides domain context that helps the LLM produce better content within that structure. Both layers work together.

---

## Step 6: Handle Non-Conforming Output

Sometimes the LLM produces output that doesn't match the schema. Understanding how the `StructuredOutputBotMixin` handles these cases will help you debug issues.

### Common Failure Modes

**1. No JSON in response** -- The LLM writes a conversational response without JSON:
```
"Sure! Here's a great report for you..."
```
The `extractJSON` function fails to find JSON, and the validator returns an error.

**2. Partial JSON** -- The LLM's response was truncated (hit token limit):
```json
{"reasoning": "I analyzed the document...", "html_content": "<!DOCTYPE html><html><head>
```
JSON parsing fails because the string is incomplete.

**3. Wrong field names** -- The LLM uses slightly different keys:
```json
{"thought_process": "...", "html": "..."}
```
Zod validation fails because the expected fields `reasoning` and `html_content` are missing.

**4. Extra fields** -- The LLM adds fields not in the schema:
```json
{"reasoning": "...", "html_content": "...", "summary": "..."}
```
By default, Zod strips extra fields during parsing. This succeeds silently.

### What Happens on Validation Failure

When validation fails, the mixin returns the validation errors to the bot framework. The framework can then:
- Retry the LLM call (if retry logic is configured)
- Return the error to the caller
- Log the failure for debugging

You can inspect validation failures via `ff-telemetry-read`:

```bash
ff-telemetry-read calls list --entity-id <entity-id> \
  --gateway=http://localhost --internal-port=8180
```

Look for calls with `status: "error"` and check the error details for Zod validation messages.

### Making Schemas More Resilient

If you find the LLM frequently fails validation, consider these strategies:

```typescript
// Strategy 1: Make fields optional with defaults
const ResilientSchema = z.object({
  reasoning: z.string().default('No reasoning provided'),
  html_content: z.string()
});

// Strategy 2: Use .transform() to fix common issues
const TransformingSchema = z.object({
  reasoning: z.string(),
  html_content: z.string().transform(html => {
    // Ensure DOCTYPE is present
    if (!html.startsWith('<!DOCTYPE')) {
      return '<!DOCTYPE html>\n' + html;
    }
    return html;
  })
});

// Strategy 3: Use .refine() for custom validation
const StrictSchema = z.object({
  reasoning: z.string().min(50, 'Reasoning must be at least 50 characters'),
  html_content: z.string().refine(
    html => html.includes('<!DOCTYPE html>'),
    'HTML must include DOCTYPE declaration'
  )
});
```

However, be cautious with `.transform()` and `.refine()` in the context of `StructuredOutputBotMixin`. The mixin renders the schema using `.describe()` annotations and Zod type introspection. Custom transforms and refinements add runtime behavior that the LLM cannot see in the prompt. Use them for post-processing, not for communicating requirements.

---

## Step 7: Advanced Schema Patterns

### Nested Objects

For more complex output, you can nest objects. Each nested object's fields get their own `.describe()` annotations:

```typescript
const DetailedReportSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string()
      .describe('Your analysis of the document and plan for the report'),
    metadata: z.object({
      title: z.string()
        .describe('A concise, professional title for the report'),
      section_count: z.number()
        .describe('Number of major sections in the report'),
      estimated_pages: z.number()
        .describe('Estimated number of pages when printed')
    }).describe('Report metadata extracted during generation'),
    html_content: z.string()
      .describe('Complete HTML document with embedded CSS')
  }),
  'Detailed report output',
  'Report with metadata and HTML content'
);
```

### Enum Fields

Use `z.enum()` to constrain values to a known set:

```typescript
const CategorizedReportSchema = withSchemaMetadata(
  z.object({
    category: z.enum(['financial', 'technical', 'executive', 'operational'])
      .describe('The category that best describes this report based on its content'),
    confidence: z.number()
      .describe('Your confidence in the category assignment, from 0.0 to 1.0'),
    html_content: z.string()
      .describe('Complete HTML document styled appropriately for the category')
  }),
  'Categorized report',
  'Report with automatic category classification'
);
```

Enum values are rendered in the prompt as `enum of financial, technical, executive, operational`, which the LLM understands as a constraint.

### Array Fields

Use `z.array()` for list-type output:

```typescript
const MultiSectionSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string()
      .describe('Your plan for the report sections'),
    sections: z.array(z.object({
      title: z.string().describe('Section heading'),
      html_content: z.string().describe('HTML content for this section only'),
      page_break_before: z.boolean().describe('Whether to start this section on a new page')
    })).describe('Individual report sections in order'),
  }),
  'Multi-section report',
  'Report broken into individually styled sections'
);
```

---

## Step 8: Build and Test

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

### 8.1 Test with Different Document Types

Upload documents of various types and verify the output structure is consistent:

```bash
# Test with a text-heavy document
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportEntity",
    "data": {
      "prompt": "Create a detailed analysis report with sections for key findings, methodology, and recommendations",
      "orientation": "portrait",
      "original_document_wm_id": "<text-document-wm-id>",
      "original_filename": "research-paper.pdf"
    }
  }' \
  --url http://localhost:3001
```

```bash
# Test with a data-heavy document (landscape for tables)
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportEntity",
    "data": {
      "prompt": "Create a data summary report with tables and charts description",
      "orientation": "landscape",
      "original_document_wm_id": "<spreadsheet-wm-id>",
      "original_filename": "quarterly-data.xlsx"
    }
  }' \
  --url http://localhost:3001
```

### 8.2 Verify Output Structure

After running each entity, inspect the result to verify it matches the schema:

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

The `VALUE` event at the end should contain a JSON object with exactly two fields: `reasoning` (a non-empty string) and `html_content` (a string starting with `<!DOCTYPE html>`).

### 8.3 Inspect the Rendered Schema Prompt

To see exactly what schema documentation the LLM received, use `ff-telemetry-read` to view the full prompt:

```bash
ff-telemetry-read calls list --entity-id <report-generation-entity-id> \
  --gateway=http://localhost --internal-port=8180
```

Look for the system message that contains the schema documentation. It should read something like:

```
Output your response using the following schema in json format:
Your final output. A JSON object containing your reasoning and the complete HTML report
reasoning: string. Your step-by-step thought process for structuring this report...
html_content: string. A complete, self-contained HTML document ready for PDF conversion...
```

This is the text that `StructuredOutputBotMixin` generated from your schema. If the LLM is not following the schema, check that this text is clear and unambiguous.

### 8.4 Test Schema Validation

To test that validation is working, you can temporarily make the schema stricter and observe failures:

```typescript
// Temporary test: require reasoning to be at least 100 characters
const StrictTestSchema = withSchemaMetadata(
  z.object({
    reasoning: z.string().min(100, 'Reasoning too short'),
    html_content: z.string().min(50, 'HTML too short')
  }),
  'Strict test output',
  'Testing validation'
);
```

If the LLM produces short reasoning, you'll see a validation error in the telemetry. Remember to revert this after testing.

---

## What You've Built

You now have:
- A well-designed output schema with `.describe()` annotations that guide LLM output quality
- `withSchemaMetadata` providing top-level naming and description for the prompt
- Understanding of how `StructuredOutputBotMixin` converts schemas to prompt text and validates output
- HTML-specific validation rules reinforced through both schema descriptions and prompt sections
- The ability to debug structured output issues using telemetry

The schema-to-output pipeline:

```
ReportOutputSchema (Zod + withSchemaMetadata)
    |
    +-- .describe() annotations --> Natural language prompt text
    |
    +-- Zod types (string, number) --> Type labels in prompt
    |
    +-- withSchemaMetadata name/desc --> Header in prompt
    |
    v
StructuredOutputBotMixin
    |
    +-- getExtensionPrompts() --> Schema prompt injected into bot
    |
    +-- validator() --> JSON extraction + Zod safeParse
    |
    v
LLM receives: [your prompts] + [schema docs] + [user input]
    |
    v
LLM output --> extractJSON --> JSON.parse --> safeParse --> typed REPORT_OUTPUT
```

---

## Key Takeaways

1. **`.describe()` is your primary schema-prompting tool** -- every Zod field description becomes a direct instruction in the LLM prompt. Write descriptions as instructions ("Include X, avoid Y") not documentation ("This field contains X").

2. **`withSchemaMetadata` adds the schema header** -- the `name` and `description` arguments appear at the top of the schema documentation in the prompt. Use them to frame the overall output expectation.

3. **`StructuredOutputBotMixin` automates the schema-to-prompt pipeline** -- you define a schema once and the mixin handles prompt injection, JSON extraction, and Zod validation. You do not need to manually format the schema in your prompts.

4. **Field order matters for LLM output quality** -- place "reasoning" or "thinking" fields before content fields. The LLM generates tokens sequentially, so reasoning first produces better downstream content.

5. **Schema and prompt work together** -- the schema defines structure (enforced by Zod), while the prompt provides domain context (behavioral guidance). Overlap is intentional and beneficial.

6. **Use telemetry to debug output issues** -- `ff-telemetry-read` shows the exact prompt the LLM received and the raw response. This is the fastest way to diagnose why the LLM is not following the schema.

7. **Be cautious with `.transform()` and `.refine()`** -- these add runtime behavior that the LLM cannot see. Use `.describe()` for LLM-facing requirements and `.transform()`/`.refine()` for post-processing only.

---

## Next Steps

In [Part 8: Human-in-the-Loop Review](./part-08-review-workflow.md), you'll wrap the entire pipeline in a `ReviewableEntity` that supports approve/reject/revise cycles. You'll learn how `FeedbackBotMixin` passes reviewer feedback back to the bot for iterative improvement, creating a complete human-in-the-loop workflow.
