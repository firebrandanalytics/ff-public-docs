# Prompt Patterns Cookbook

Practical recipes for building prompts with the FireFoundry SDK prompting system. Each pattern shows a complete, working example you can adapt for your use case.

For foundational concepts, see the [Prompting Guide](../core/prompting.md) and [Prompting Tutorial](../core/prompting_tutorial.md).

---

## Table of Contents

- [Core Building Blocks](#core-building-blocks)
- [StructuredPromptGroup Sections](#structuredpromptgroup-sections)
- [Pattern 1: Basic System + User Prompt](#pattern-1-basic-system--user-prompt)
- [Pattern 2: Dynamic Content with Template Functions](#pattern-2-dynamic-content-with-template-functions)
- [Pattern 3: Structured Data in Prompts](#pattern-3-structured-data-in-prompts)
- [Pattern 4: Conditional Prompting](#pattern-4-conditional-prompting)
- [Pattern 5: Switch/Case Branching](#pattern-5-switchcase-branching)
- [Pattern 6: ForEach Iteration](#pattern-6-foreach-iteration)
- [Pattern 7: Schema-Driven Output](#pattern-7-schema-driven-output)
- [Pattern 8: Working Memory Integration](#pattern-8-working-memory-integration)
- [Pattern 9: Multi-Turn Chat History](#pattern-9-multi-turn-chat-history)
- [Pattern 10: Feedback Iteration](#pattern-10-feedback-iteration)
- [Pattern 11: Composing Prompt Groups](#pattern-11-composing-prompt-groups)
- [Pattern 12: Conditional Prompt Inclusion](#pattern-12-conditional-prompt-inclusion)

---

## Core Building Blocks

### Prompt

A single message (system, user, or assistant) containing one or more template nodes:

```typescript
import { Prompt, PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk/prompts';

type MyPTH = PromptTypeHelper<
  { text: string },                              // Input type
  { static: { domain: string }; request: {} },   // Args (static + request)
  {},                                            // Options
  string                                         // Semantic type
>;

const systemPrompt = new Prompt<MyPTH>('system', { domain: 'analysis' });
systemPrompt.add_section('You are an expert analyst.');
```

### PromptGroup

A named collection of prompts that render together:

```typescript
import { PromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';

const base = new PromptGroup<MyPTH>([
  { name: 'system', prompt: systemPrompt },
  { name: 'rules', prompt: rulesPrompt },
]);
```

### StructuredPromptGroup

Organizes prompts into lifecycle sections with defined ordering:

```typescript
import { StructuredPromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';

const structured = new StructuredPromptGroup<MyPTH>({
  base: baseGroup,        // Core identity and rules
  input: inputGroup,      // Current user input
  extensions: extGroup,   // Mixin-injected context (optional)
  data: dataGroup,        // Static reference data (optional)
  chat_history: chatGroup, // Previous conversation (optional)
  followup: followupGroup, // Error/retry messages (optional)
});
```

---

## StructuredPromptGroup Sections

The `StructuredPromptGroup` renders sections in a fixed order that produces effective LLM interactions:

| Section | Purpose | Typical Content |
|---------|---------|-----------------|
| `base` | Bot identity and rules | System prompt, behavioral rules, output format |
| `extensions` | Mixin-injected context | Working memory files, skill definitions |
| `data` | Reference data | Domain knowledge, lookup tables, examples |
| `chat_history` | Conversation history | Previous user/assistant turns |
| `input` | Current request | User's input for this turn |
| `followup` | Error recovery | Retry instructions, validation error messages |

This ordering ensures the LLM receives identity first, then context, then the actual request — matching best practices for prompt engineering.

---

## Pattern 1: Basic System + User Prompt

The simplest pattern: a system prompt defining behavior and a user prompt with dynamic input.

```typescript
const systemPrompt = new Prompt<MyPTH>('system', { domain: 'general' });
systemPrompt.add_section('You are a helpful assistant. Respond concisely.');

const userPrompt = new Prompt<MyPTH>('user', {});
userPrompt.add_section(new PromptTemplateTextNode({
  content: (request) => request.input.text,
}));

const promptGroup = new StructuredPromptGroup<MyPTH>({
  base: new PromptGroup([{ name: 'system', prompt: systemPrompt }]),
  input: new PromptGroup([{ name: 'user', prompt: userPrompt }]),
});
```

**Renders as:**
```
[system] You are a helpful assistant. Respond concisely.
[user]   <whatever the user typed>
```

---

## Pattern 2: Dynamic Content with Template Functions

Use render functions to inject dynamic content based on request context:

```typescript
const systemPrompt = new Prompt<MyPTH>('system', { domain: 'analysis' });

// Static text section
systemPrompt.add_section('You are a domain expert.');

// Dynamic section using a render function
systemPrompt.add_section(new PromptTemplateTextNode({
  content: (request) => {
    const domain = request.args.domain ?? 'general';
    return `You specialize in ${domain} analysis. Apply domain-specific terminology.`;
  },
}));

// Dynamic section with footer
systemPrompt.add_section(new PromptTemplateSectionNode({
  children: [
    new PromptTemplateTextNode({
      content: (request) => `Analysis target: ${request.input.target}`,
    }),
    new PromptTemplateTextNode({
      content: 'Provide your analysis in the requested format.',
    }),
  ],
  seperator: '\n\n',  // Double newline between children
}));
```

---

## Pattern 3: Structured Data in Prompts

Inject JSON, YAML, or CSV data into prompts:

```typescript
// JSON data
systemPrompt.add_section(new PromptTemplateStructDataNode({
  content: 'Here are the current inventory records:',
  data: (request) => request.args.inventory_items,
  options: {
    struct_data_language: 'json',
    formatting: { space: 2 },
  },
}));

// CSV data (useful for tabular data — more token-efficient than JSON)
systemPrompt.add_section(new PromptTemplateStructDataNode({
  content: 'Sales data:',
  data: (request) => request.args.sales_records,
  options: {
    struct_data_language: 'csv',
    csv_headers: ['date', 'product', 'quantity', 'revenue'],
    csv_include_headers: true,
  },
}));

// YAML data
systemPrompt.add_section(new PromptTemplateStructDataNode({
  content: 'Configuration:',
  data: { max_retries: 3, timeout_ms: 5000, model: 'gpt-4' },
  options: { struct_data_language: 'yaml' },
}));
```

### Code Blocks

Wrap content in markdown code fences:

```typescript
systemPrompt.add_section(new PromptTemplateCodeBoxNode({
  content: 'Example output format:',
  children: [
    new PromptTemplateStructDataNode({
      data: { summary: '...', score: 0.95, tags: ['example'] },
    }),
  ],
  options: { struct_data_language: 'json' },
}));
```

---

## Pattern 4: Conditional Prompting

Include prompt sections only when certain conditions are met:

```typescript
import { PromptTemplateIfElseNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

const systemPrompt = new Prompt<MyPTH>('system', {});
systemPrompt.add_section('You are an analysis assistant.');

// Conditional: add extra rules for sensitive domains
systemPrompt.add_section(new PromptTemplateIfElseNode({
  condition_func: (request) => request.args.domain === 'medical',
  true_case: new PromptTemplateTextNode({
    content: 'IMPORTANT: Do not provide medical diagnoses. Always recommend consulting a healthcare professional.',
  }),
  false_case: new PromptTemplateTextNode({
    content: 'Provide thorough analysis with supporting evidence.',
  }),
}));

// Conditional: only include examples if requested
systemPrompt.add_section(new PromptTemplateIfElseNode({
  condition_func: (request) => request.args.include_examples === true,
  true_case: new PromptTemplateSectionNode({
    children: [
      new PromptTemplateTextNode({ content: '## Examples' }),
      new PromptTemplateStructDataNode({
        data: (request) => request.args.examples,
      }),
    ],
  }),
  // No false_case — section is simply omitted when condition is false
}));
```

---

## Pattern 5: Switch/Case Branching

Select different prompt content based on a value:

```typescript
import { PromptTemplateSwitchNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

systemPrompt.add_section(new PromptTemplateSwitchNode({
  expression_func: (request) => request.args.output_format,
  cases: {
    'json': new PromptTemplateTextNode({
      content: 'Respond with valid JSON. Do not include markdown code fences.',
    }),
    'markdown': new PromptTemplateTextNode({
      content: 'Format your response as clean Markdown with headers and bullet points.',
    }),
    'csv': new PromptTemplateTextNode({
      content: 'Respond with CSV data. First row is headers. Use commas as delimiters.',
    }),
  },
  default_case: new PromptTemplateTextNode({
    content: 'Respond in plain text.',
  }),
  strict: false,  // false = use default_case if no match; true = throw error
}));
```

---

## Pattern 6: ForEach Iteration

Dynamically generate prompt sections from arrays:

```typescript
import { PromptTemplateForEachNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Generate a section for each document in the input
systemPrompt.add_section(new PromptTemplateTextNode({
  content: 'Analyze the following documents:',
}));

systemPrompt.add_section(new PromptTemplateForEachNode({
  array_property: (request) => request.args.documents,
  iteration_variable_name: 'doc',
  index_variable_name: 'idx',
  children: [
    new PromptTemplateTextNode({
      content: (request) => {
        const doc = request.local_scope['doc'];
        const idx = request.local_scope['idx'];
        return `### Document ${idx + 1}: ${doc.title}\n${doc.content}`;
      },
    }),
  ],
}));
```

### Labeled Lists

Generate numbered or custom-labeled lists:

```typescript
import { PromptTemplateListNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

systemPrompt.add_section(new PromptTemplateListNode({
  children: [
    new PromptTemplateTextNode({ content: 'Be concise' }),
    new PromptTemplateTextNode({ content: 'Use evidence' }),
    new PromptTemplateTextNode({ content: 'Cite sources' }),
  ],
  list_label_function: (request, child, index) => `Rule ${index + 1}:`,
}));

// Renders as:
// Rule 1: Be concise
// Rule 2: Use evidence
// Rule 3: Cite sources
```

---

## Pattern 7: Schema-Driven Output

Define output structure using Zod schemas and include them in prompts:

```typescript
import { z } from 'zod';
import {
  PromptTemplateSchemaNode,
  PromptTemplateSchemaSetNode,
  SchemaRegistry,
  withSchemaMetadata,
} from '@firebrandanalytics/ff-agent-sdk/prompts';

// Define schemas with metadata
const FindingSchema = withSchemaMetadata(
  z.object({
    category: z.enum(['bug', 'style', 'performance', 'security']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    description: z.string(),
    line_number: z.number().optional(),
    suggestion: z.string(),
  }),
  'Finding',
  'A single code review finding'
);

const ReviewOutputSchema = withSchemaMetadata(
  z.object({
    summary: z.string().describe('Overall assessment'),
    findings: z.array(FindingSchema).describe('List of findings'),
    score: z.number().min(0).max(100).describe('Quality score'),
  }),
  'ReviewOutput',
  'Complete code review output'
);

// Register schemas
const registry = new SchemaRegistry();
registry.register(FindingSchema);
registry.register(ReviewOutputSchema);

// Add schema to prompt — auto-renders with dependency ordering
systemPrompt.add_section(new PromptTemplateSchemaSetNode({
  schema: [ReviewOutputSchema, FindingSchema],
  semantic_type: 'schema',
}));
```

The schema set node automatically:
1. Discovers dependencies between schemas (e.g., `ReviewOutput` references `Finding`)
2. Orders them using topological sort (dependencies first)
3. Renders JSON Schema representations in the prompt

---

## Pattern 8: Working Memory Integration

Include files and documents from working memory in prompts:

```typescript
import { WMPromptGroup, ImageMemoryPrompt } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Create a working memory prompt group
const wmGroup = new WMPromptGroup([
  { name: 'documents', prompt: new Prompt('user', {}) },
], {
  // Filter which working memory paths to include
  filterPaths: (paths) => paths.filter(p =>
    p.endsWith('.ts') || p.endsWith('.md') || p.endsWith('.json')
  ),

  // Custom description for each file
  getDescription: (path) => {
    const fileName = path.split('/').pop() ?? path;
    return `Source file: ${fileName}`;
  },

  // Transform content before including (e.g., strip imports)
  contentTransformers: {
    ts: (content) => content.replace(/^import\s+.*;\n/gm, ''),
  },
});

// Use in StructuredPromptGroup
const structured = new StructuredPromptGroup<MyPTH>({
  base: basePrompts,
  extensions: wmGroup,  // Working memory goes in extensions
  input: inputPrompts,
});
```

For image content in working memory:

```typescript
const imagePrompt = new ImageMemoryPrompt({
  memoryId: 'uploaded-photo-123',
  description: 'User-uploaded photograph',
  metadata: { width: 1024, height: 768, format: 'png' },
});
```

---

## Pattern 9: Multi-Turn Chat History

Include previous conversation turns for context continuity:

```typescript
import { ChatHistoryBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

// ChatHistoryBotMixin automatically populates the chat_history section
// of StructuredPromptGroup with previous user/assistant turns.

class ConversationalBot extends ComposeMixins(
  MixinBot,
  ChatHistoryBotMixin
)<[MixinBot<BTH, [ChatHistoryBotMixin<BTH>]>, [ChatHistoryBotMixin<BTH>]]> {
  constructor() {
    const structured = new StructuredPromptGroup<PTH>({
      base: new PromptGroup([
        { name: 'system', prompt: systemPrompt },
      ]),
      chat_history: new PromptGroup([]),  // Populated automatically by mixin
      input: new PromptGroup([
        { name: 'user', prompt: userPrompt },
      ]),
    });

    super(
      [{ name: 'ConversationalBot', base_prompt_group: structured, model_pool_name: 'default', static_args: {} }],
      [undefined]  // ChatHistoryBotMixin — use defaults
    );
  }
}
```

---

## Pattern 10: Feedback Iteration

Build prompts that incorporate feedback from previous attempts:

```typescript
import { FeedbackBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

// FeedbackBotMixin injects feedback into the followup section automatically.
// When _ff_feedback is present in the request args, the mixin adds a message like:
//   "Previous attempt feedback: <serialized feedback>"
//   "Previous result: <serialized previous result>"
//   "This is attempt 3. Please address the feedback."

class IterativeBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
)<[...]> {
  constructor() {
    const structured = new StructuredPromptGroup<PTH>({
      base: new PromptGroup([
        { name: 'system', prompt: systemPrompt },
      ]),
      input: new PromptGroup([
        { name: 'user', prompt: userPrompt },
      ]),
      followup: new PromptGroup([]),  // Populated by FeedbackBotMixin
    });

    super(
      [{ name: 'IterativeBot', base_prompt_group: structured, model_pool_name: 'default', static_args: {} }],
      [OutputSchema],        // StructuredOutputBotMixin
      [{ role: 'system' }]   // FeedbackBotMixin — feedback injected as system message
    );
  }
}

// Usage: first attempt
const result1 = await bot.main({ input: { text: 'Draft a report' }, args: {} });

// Usage: with feedback
const result2 = await bot.main({
  input: { text: 'Draft a report' },
  args: {
    _ff_feedback: { issues: ['Too verbose', 'Missing conclusion'] },
    _ff_previous_result: result1,
    _ff_version: 2,
  },
});
```

---

## Pattern 11: Composing Prompt Groups

Nest prompt groups for modular prompt construction:

```typescript
// Reusable rules module
const safetyRules = new PromptGroup<MyPTH>([
  { name: 'content-policy', prompt: contentPolicyPrompt },
  { name: 'pii-handling', prompt: piiPrompt },
]);

// Reusable format module
const outputFormat = new PromptGroup<MyPTH>([
  { name: 'schema', prompt: schemaPrompt },
  { name: 'examples', prompt: examplesPrompt },
]);

// Compose into base
const base = new PromptGroup<MyPTH>([
  { name: 'identity', prompt: identityPrompt },
  { name: 'safety', prompt: safetyRules },     // Nested group
  { name: 'format', prompt: outputFormat },     // Nested group
]);

const structured = new StructuredPromptGroup<MyPTH>({
  base,
  input: inputGroup,
});
```

---

## Pattern 12: Conditional Prompt Inclusion

Include or exclude entire prompts based on conditions:

```typescript
// Prompts and groups accept a condition function
const debugPrompt = new Prompt<MyPTH>('system', {},
  /* options */ undefined,
  /* condition */ (request) => request.args.debug === true
);
debugPrompt.add_section('DEBUG MODE: Show your reasoning step by step.');

// PromptGroups also support conditions
const advancedRules = new PromptGroup<MyPTH>([
  { name: 'advanced', prompt: advancedPrompt },
], /* options */ undefined,
   /* condition */ (request) => request.args.expert_mode === true
);
```

When the condition returns `false`, the prompt or group is silently omitted from the rendered output.

---

## Rendering and Validation

### Rendering Prompts

```typescript
const request = new PromptNodeRequest<MyPTH>(
  { text: 'Analyze this document' },       // input
  { domain: 'finance' },                    // request args
  contextProvider                            // context provider
);

const rendered = await structured.render(request);
const messages = rendered.render();
// messages: FF_LLM_Message_Plus[] ready for the broker
```

### Prompt Validators

Attach validators to prompts or groups to validate LLM output:

```typescript
const validatedPrompt = new Prompt<MyPTH>('system', {},
  /* options */ undefined,
  /* condition */ undefined,
  /* validator */ (llmOutput, partial, request) => {
    try {
      const parsed = OutputSchema.parse(JSON.parse(llmOutput));
      return { valid: true, partial: parsed };
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid output: ${e.message}`],
        partial,
      };
    }
  }
);
```

Validators are collected during rendering and executed by the bot after each LLM response. Failed validation triggers a retry with the error message injected into the `followup` section.

---

## See Also

- [Prompting Guide](../core/prompting.md) — Core prompting concepts
- [Prompting Tutorial](../core/prompting_tutorial.md) — Hands-on tutorial
- [Bot Tutorial](../core/bot_tutorial.md) — Building bots with prompts
- [Advanced Bot Mixin Patterns](../feature_guides/advanced-bot-mixin-patterns.md) — Bot composition patterns
- [Data Validation Overview](../feature_guides/data-validation-overview.md) — Validation library integration
