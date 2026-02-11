# Part 3: Prompt Engineering

In this part, you'll replace the bot's simple string prompt with a structured `Prompt` class. This gives you organized sections, conditional rendering based on request arguments, and numbered rule lists -- all type-safe and composable.

**What you'll learn:**
- Creating a `Prompt` subclass with organized sections
- Using `PromptTemplateSectionNode` to group related instructions
- Using `PromptTemplateListNode` for numbered rule lists
- Adding conditional logic with lambda functions that access request args
- Wiring a custom prompt into the bot's `StructuredPromptGroup`

**What you'll build:** A `ReportGenerationPrompt` class with five sections (Context, Task, Document Content, Layout, Rules) where layout instructions change dynamically based on the requested orientation.

## Why Structured Prompts?

In Part 2, the bot's system prompt was a plain string. That works, but it has limitations:

| Plain string prompt | Structured `Prompt` class |
|---|---|
| All instructions in one block | Organized into semantic sections |
| Static content only | Dynamic content from request args via lambdas |
| Hard to reuse across bots | Composable and extensible via inheritance |
| Changes require string editing | Each section is an independent method |

The `Prompt` class gives you a template system where sections are rendered at request time, with access to the full request arguments.

## Step 1: Create the Prompt Class

**`apps/report-bundle/src/prompts/ReportGenerationPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode
} from '@firebrandanalytics/ff-agent-sdk';

/**
 * Type helper for this prompt - must match the bot's REPORT_PTH.
 * This ensures the prompt has access to the same request args
 * that the entity provides.
 */
type REPORT_PTH = PromptTypeHelper<
  string,
  {
    static: {};
    request: {
      plain_text: string;
      orientation: 'portrait' | 'landscape';
    };
  }
>;

/**
 * Structured prompt for report generation.
 * 
 * Each section is a separate method, making the prompt easy to
 * read, modify, and extend via subclassing.
 * 
 * Note: Schema injection (telling the LLM about the output format)
 * is handled automatically by StructuredOutputBotMixin. You do NOT
 * need to describe the output format here.
 */
export class ReportGenerationPrompt extends Prompt<REPORT_PTH> {
  constructor(
    role: 'system' | 'user' | 'assistant',
    options?: REPORT_PTH['options']
  ) {
    super(role, options ?? {});

    // Add sections in order - this is the order they appear in the rendered prompt
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Task_Section());
    this.add_section(this.get_Document_Content_Section());
    this.add_section(this.get_Layout_Section());
    this.add_section(this.get_Rules_Section());
  }

  /**
   * Context section - establishes who the LLM is
   */
  protected get_Context_Section(): PromptTemplateNode<REPORT_PTH> {
    return new PromptTemplateSectionNode<REPORT_PTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        'You are a professional report generator',
        'You receive extracted text from documents and user instructions',
        'Your job is to create well-formatted HTML reports suitable for PDF conversion'
      ]
    });
  }

  /**
   * Task section - what the LLM should do
   */
  protected get_Task_Section(): PromptTemplateNode<REPORT_PTH> {
    return new PromptTemplateSectionNode<REPORT_PTH>({
      semantic_type: 'rule',
      content: 'Task:',
      children: [
        'Generate a professional HTML report based on the provided document content',
        "Follow the user's specific instructions provided in their message",
        'Include proper CSS for print formatting',
        'Do not use interactive elements (JavaScript, forms, buttons, etc.)',
        'Ensure the report is well-structured with clear sections',
        'Use appropriate headings, tables, and formatting for readability'
      ]
    });
  }

  /**
   * Document Content section - injects the actual document text
   * 
   * This is where lambda functions shine. Instead of a static string,
   * the child is a function that receives the request and returns
   * the content dynamically.
   */
  protected get_Document_Content_Section(): PromptTemplateNode<REPORT_PTH> {
    return new PromptTemplateSectionNode<REPORT_PTH>({
      semantic_type: 'context',
      content: 'Extracted Document Content:',
      children: [
        (request) => {
          return request.args.plain_text || '';
        }
      ]
    });
  }

  /**
   * Layout section - conditional instructions based on orientation
   * 
   * Lambda functions can contain any logic. Here we return different
   * instructions depending on whether the orientation is portrait
   * or landscape. The LLM sees only the relevant instructions.
   */
  protected get_Layout_Section(): PromptTemplateNode<REPORT_PTH> {
    return new PromptTemplateSectionNode<REPORT_PTH>({
      semantic_type: 'rule',
      content: 'Layout Guidelines:',
      children: [
        (request) => {
          return request.args.orientation === 'portrait'
            ? 'Optimize for standard 8.5" x 11" portrait page format'
            : 'Optimize for 11" x 8.5" landscape page format';
        },
        'Use appropriate margins (recommend 1 inch on all sides)',
        'Ensure content fits within page boundaries',
        (request) => {
          return request.args.orientation === 'landscape'
            ? 'Take advantage of horizontal space with wider tables and side-by-side content'
            : 'Stack content vertically with appropriate spacing for portrait layout';
        }
      ]
    });
  }

  /**
   * Rules section - numbered HTML generation rules
   * 
   * PromptTemplateListNode renders children as a numbered list.
   * The list_label_function controls the numbering format.
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
            'Add CSS in a <style> tag within <head>',
            'Use semantic HTML5 elements',
            'Style for print - avoid fixed positioning',
            'Use professional fonts and business-appropriate colors',
            'Ensure good contrast and readability',
            'Add page breaks where appropriate using CSS'
          ],
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }
}
```

**Key concepts in this file:**

### PromptTemplateSectionNode

A section groups related instructions under a heading. The `content` field is the section heading, and `children` are the items within it.

```typescript
new PromptTemplateSectionNode<REPORT_PTH>({
  semantic_type: 'context',   // Semantic classification (context, rule, etc.)
  content: 'Context:',        // Section heading
  children: [                 // Section items (strings or lambdas)
    'You are a professional report generator',
    'You receive extracted text from documents'
  ]
});
```

The `semantic_type` classifies the section's purpose. Common values:
- `'context'` -- background information, data, reference material
- `'rule'` -- instructions, constraints, requirements

### Lambda Functions in Children

Any child can be a function instead of a string. The function receives the full request object (with `args`, `input`, etc.) and returns a string:

```typescript
children: [
  // Static string - always the same
  'Use appropriate margins',

  // Lambda - dynamic based on request args
  (request) => {
    return request.args.orientation === 'portrait'
      ? 'Optimize for 8.5" x 11" portrait format'
      : 'Optimize for 11" x 8.5" landscape format';
  }
]
```

The `request.args` object contains the same values returned by `get_bot_request_args_impl` in the entity. The type system ensures these match.

### PromptTemplateListNode

Renders children as a formatted list with customizable labels:

```typescript
new PromptTemplateListNode<REPORT_PTH>({
  semantic_type: 'rule',
  children: [
    'Include complete HTML structure',
    'Add CSS in a <style> tag',
    'Use semantic HTML5 elements'
  ],
  list_label_function: (_req, _child, idx) => `${idx + 1}. `
})
```

This renders as:
```
1. Include complete HTML structure
2. Add CSS in a <style> tag
3. Use semantic HTML5 elements
```

The `list_label_function` receives three arguments: the request, the child content, and the zero-based index. You can use any format -- bullets, letters, custom numbering.

## Step 2: Wire the Prompt into the Bot

Replace the `PromptInputText` in the bot's constructor with your new `ReportGenerationPrompt` class.

**`apps/report-bundle/src/bots/ReportGenerationBot.ts`** (updated constructor):

```typescript
import { ReportGenerationPrompt } from '../prompts/ReportGenerationPrompt.js';

// ... (type definitions unchanged from Part 2) ...

export class ReportGenerationBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
)<[
  MixinBot<REPORT_BTH, [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>]>,
  [StructuredOutputBotMixin<REPORT_BTH, typeof ReportOutputSchema>]
]> {
  constructor() {
    // Replace the simple PromptInputText with our structured prompt
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
      [config],
      [{ schema: ReportOutputSchema }],
    );
  }

  override get_semantic_label_impl(_request: BotTryRequest<REPORT_BTH>): string {
    return "ReportGenerationBotSemanticLabel";
  }
}
```

The change is in the `base` prompt group: `ReportGenerationPrompt` replaces the plain `PromptInputText`. The prompt is created with `role: 'system'` because it provides system-level instructions to the LLM.

**How the StructuredPromptGroup works:**

```
StructuredPromptGroup
  |
  |-- base: PromptGroup (system prompts)
  |     |-- ReportGenerationPrompt (role: 'system')
  |           |-- Context section
  |           |-- Task section
  |           |-- Document Content section (dynamic)
  |           |-- Layout section (conditional)
  |           |-- Rules section (numbered list)
  |
  |-- input: PromptGroup (user prompts)
        |-- PromptInputText (the user's instruction)
```

The `base` group renders as the system message. The `input` group renders as the user message. The `StructuredOutputBotMixin` also injects schema information into the prompt automatically -- you do not need to describe the output format in your prompt.

## Step 3: Build and Deploy

```bash
pnpm run build
ff ops build --app-name report-bundle
ff ops deploy --app-name report-bundle
```

## Step 4: Test with ff-sdk-cli

### Test Portrait Orientation

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportGenerationEntity",
    "data": {
      "plain_text": "Q3 Revenue: $2.4M (up 15% YoY). Operating costs reduced by 8%. New customer acquisition increased 22% driven by product launch in EMEA region. Employee headcount grew from 45 to 52.",
      "orientation": "portrait",
      "user_prompt": "Create an executive summary with key metrics highlighted."
    }
  }' \
  --url http://localhost:3001
```

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

### Test Landscape Orientation

```bash
ff-sdk-cli api call create-entity \
  --method POST \
  --body '{
    "type": "ReportGenerationEntity",
    "data": {
      "plain_text": "Q3 Revenue: $2.4M (up 15% YoY). Operating costs reduced by 8%. New customer acquisition increased 22% driven by product launch in EMEA region. Employee headcount grew from 45 to 52.",
      "orientation": "landscape",
      "user_prompt": "Create a dashboard-style report with side-by-side comparisons."
    }
  }' \
  --url http://localhost:3001
```

```bash
ff-sdk-cli iterator run <entity-id> start --url http://localhost:3001
```

### Compare the Results

The two runs should produce different HTML layouts. The portrait version will have vertically stacked content, while the landscape version will take advantage of horizontal space with wider tables and side-by-side elements. The conditional lambda functions in the Layout section are what drive this difference.

### Inspect the Rendered Prompt

Use `ff-telemetry-read` to see exactly what prompt the LLM received:

```bash
ff-telemetry-read broker-requests --entity-id <entity-id> --gateway=http://localhost --internal-port=8180
```

In the system message, you should see the five sections rendered in order, with the Layout section showing instructions specific to the orientation you chose. You should also see the Zod schema information that `StructuredOutputBotMixin` injected.

## Prompt Architecture Reference

Here is the full rendering pipeline from prompt class to LLM message:

```
ReportGenerationPrompt (Prompt subclass)
    |
    |-- add_section(get_Context_Section())    --> PromptTemplateSectionNode
    |-- add_section(get_Task_Section())       --> PromptTemplateSectionNode
    |-- add_section(get_Document_Section())   --> PromptTemplateSectionNode (with lambda)
    |-- add_section(get_Layout_Section())     --> PromptTemplateSectionNode (with conditionals)
    |-- add_section(get_Rules_Section())      --> PromptTemplateSectionNode
    |                                               |-- PromptTemplateListNode (numbered)
    v
render(request) called by bot
    |
    v
Each section renders its children:
  - Strings render as-is
  - Lambdas are called with request, return strings
  - PromptTemplateListNode numbers its children
    |
    v
Final rendered text becomes the system message to the LLM
```

## Extending the Prompt

Because each section is a separate protected method, you can subclass and override individual sections:

```typescript
/**
 * Example: A stricter prompt for financial reports
 */
class FinancialReportPrompt extends ReportGenerationPrompt {
  // Override just the rules section with stricter requirements
  protected override get_Rules_Section(): PromptTemplateNode<REPORT_PTH> {
    return new PromptTemplateSectionNode<REPORT_PTH>({
      semantic_type: 'rule',
      content: 'Financial Report Rules:',
      children: [
        new PromptTemplateListNode<REPORT_PTH>({
          semantic_type: 'rule',
          children: [
            'All monetary values must include currency symbols',
            'Percentages must be to two decimal places',
            'Include a disclaimer footer on every page',
            'Use tables for all numerical comparisons',
            'Never round figures without noting the original value'
          ],
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }
}
```

## What You've Built

You now have:
- A `ReportGenerationPrompt` class with five organized sections
- Conditional rendering that adapts layout instructions to the requested orientation
- A numbered rule list using `PromptTemplateListNode`
- Dynamic document content injection via lambda functions
- A prompt architecture that is extensible through subclassing

## Key Takeaways

1. **Prompts are classes, not strings** -- the `Prompt` base class provides `add_section` and a rendering pipeline that turns sections into a final message.
2. **PromptTemplateSectionNode groups related instructions** -- use `semantic_type` to classify sections as context, rules, or other categories.
3. **Lambda functions make prompts dynamic** -- `(request) => request.args.plain_text` injects request-time data. The type system ensures `request.args` matches what the entity provides.
4. **PromptTemplateListNode handles formatted lists** -- `list_label_function` gives you control over numbering, bullets, or any custom format.
5. **Conditional logic lives in lambdas** -- instead of building separate prompts for portrait and landscape, one prompt adapts at render time.
6. **Schema injection is automatic** -- `StructuredOutputBotMixin` adds output format instructions. Do not duplicate this in your prompt.
7. **Subclassing enables prompt variants** -- override individual section methods to create specialized prompts without rewriting everything.

## Next Steps

The entity currently receives plain text directly. In [Part 4: File Storage with Working Memory](./part-04-working-memory.md), you'll add the ability to upload documents as binary files, store them in FireFoundry's working memory system, and reference them by ID throughout the processing pipeline.
