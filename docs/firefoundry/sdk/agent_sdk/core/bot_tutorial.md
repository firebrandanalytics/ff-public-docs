# A Guide to Writing Bots: From Simple Data to Interactive Behavior

Welcome! In the previous tutorial, we crafted a powerful and dynamic `CodeReviewAssistantPrompt`. Now, it's time to bring that prompt to life by building a Bot that uses it.

### The Goal
We will create a **`CodeReviewBot`** that takes our prompt and turns it into a fully functional AI behavior. We'll start with the simplest implementation and incrementally add advanced capabilities like tool usage and automatic error recovery.

### The Role of a Bot
If a Prompt is the "blueprint" for an AI task, the Bot is the "engine" or "brain" that executes it. A Bot is responsible for:
-   Interacting with the LLM.
-   Parsing and validating the LLM's response.
-   Calling external tools (like linters or APIs).
-   Handling errors and retrying automatically.

### The Scope
We will build and run the Bot in isolation. The final step of connecting it to your application's state via an Entity is covered in other guides, like the main **[Getting Started Guide]**.

### The Mixin Architecture
FireFoundry SDK v4 uses a **mixin-based composition pattern** for flexible bot capabilities. Rather than rigid class hierarchies, you compose capabilities together using `MixinBot` and specific mixins like `StructuredOutputBotMixin`. This allows you to start simple and add capabilities as needed.

---

## Chapter 1: The Simplest Bot for a Structured Task

Our first goal is simple: create a bot that takes code as input and reliably returns the structured JSON data defined by our prompt's schema. We'll use mixin composition to make this incredibly easy.

### Step 1: Type Helpers (`BotTypeHelper`)
Just as our prompt had a PTH, our bot needs a `BotTypeHelper` (BTH). The BTH connects the prompt's types to the bot's final, expected output type—in our case, the TypeScript type inferred from our `CodeReviewOutputSchema`.

```typescript
import type { BotTypeHelper } from '@firebrandanalytics/ff-agent-sdk/bot';
import { z } from 'zod';
import type { CodeReviewPTH } from '../prompts/CodeReviewAssistantPrompt.js'; // From previous tutorial
import { CodeReviewOutputSchema } from '../prompts/schemas.js'; // From previous tutorial

// The final output type is inferred directly from our Zod schema.
type CodeReviewOutput = z.infer<typeof CodeReviewOutputSchema>;

// The BTH links the Prompt's types (PTH) with the final Output type.
// BotTypeHelper accepts additional optional params (Partial, Metadata, BrokerContent, DispatchTable)
// but the first two are sufficient for most bots.
type CodeReviewBTH = BotTypeHelper<CodeReviewPTH, CodeReviewOutput>;
```

### Step 2: Structured Output with Mixin Composition
For any task that should return validated JSON, use `MixinBot` with the `StructuredOutputBotMixin`. The mixin automatically handles prompting the LLM, parsing the JSON response, and validating it against your Zod schema.

```typescript
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import {
  MixinBot,
  StructuredOutputBotMixin,
  type MixinBotConfig,
} from '@firebrandanalytics/ff-agent-sdk/bot';
import {
  Prompt,
  PromptGroup,
  PromptTemplateTextNode,
  StructuredPromptGroup,
} from '@firebrandanalytics/ff-agent-sdk/prompts';
import { CodeReviewAssistantPrompt } from '../prompts/CodeReviewAssistantPrompt.js';

export class CodeReviewBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<CodeReviewBTH, [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]>,
  [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]
]> {
  constructor() {
    // Build a user-input prompt that forwards the request's input text.
    const inputPrompt = new Prompt<CodeReviewPTH>({
      role: 'user',
      static_args: {} as CodeReviewPTH['args']['static'],
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<CodeReviewPTH>({
        content: (request) => request.input as string,
      })
    );

    // Assemble a StructuredPromptGroup — the v4 replacement for bare PromptGroup.
    // It organizes prompts into phases: base (system), input (user), and more.
    const structuredPromptGroup = new StructuredPromptGroup<CodeReviewPTH>({
      base: new PromptGroup<CodeReviewPTH>([
        {
          name: 'system_instructions',
          prompt: new CodeReviewAssistantPrompt({ programming_language: 'TypeScript' }),
        },
      ]),
      input: new PromptGroup<CodeReviewPTH>([
        { name: 'user_input', prompt: inputPrompt },
      ]),
    });

    // MixinBotConfig holds the bot's core settings.
    const config: MixinBotConfig<CodeReviewBTH> = {
      name: "CodeReviewBot",
      base_prompt_group: structuredPromptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {} as CodeReviewPTH['args']['static'],
    };

    // super() takes an array per mixin: [MixinBot config], [StructuredOutput config]
    super([config], [{ schema: CodeReviewOutputSchema }]);
  }

  get_semantic_label_impl(): string {
    return 'CodeReviewBot';
  }
}
```

**Key Points**:
- `ComposeMixins` is imported from `@firebrandanalytics/shared-utils`
- `MixinBot` and `StructuredOutputBotMixin` come from `@firebrandanalytics/ff-agent-sdk/bot`
- `StructuredPromptGroup` organizes prompts into phases (`base`, `input`, `extensions`, etc.)
- `super()` uses the array-per-mixin pattern: `super([botConfig], [mixinConfig])`
- Every bot must implement `get_semantic_label_impl()` for observability

### Step 3: Running the Bot
Let's see it in action! A simple function can instantiate and run our bot.

```typescript
import { BotRequest } from '@firebrandanalytics/ff-agent-sdk/bot';
import { Context } from '@firebrandanalytics/ff-agent-sdk';

async function runSimpleBot() {
  const bot = new CodeReviewBot();
  const sampleCode = `function add(a, b) { return a+b; }`;

  const request = new BotRequest<CodeReviewBTH>({
    id: 'review-request-1',
    input: sampleCode,            // Forwarded to the input prompt
    args: { user_name: 'Alex' },  // Request args passed to system prompt
    context: new Context(),       // Required — provides entity/memory context
  });

  console.log('Running CodeReviewBot...');
  const response = await bot.run(request);

  console.log('Review Complete! Output:');
  console.log(response.output);
}

runSimpleBot();
```

Just like that, you have a working bot that reliably returns a clean, typed, and validated JavaScript object!

---

## Chapter 2: Adding Custom Business Logic Validation

Schema validation is great for structure, but what about logic? An AI can produce a schema-correct response that is still logically flawed. For example, it could comment on a line number that doesn't exist. Let's add a custom check for this.

### Step 1: Override `postprocess_generator`
We can add our own validation logic by overriding the `postprocess_generator` method. The mixin automatically handles JSON parsing and schema validation, so we add our logic on top.

```typescript
// Inside the CodeReviewBot class...
import { BotTryRequest, FFError } from '@firebrandanalytics/ff-agent-sdk/bot';
import { BotPostprocessGenerator } from '@firebrandanalytics/ff-agent-sdk/bot';

export class CodeReviewBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<CodeReviewBTH, [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]>,
  [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]
]> {
  // ... constructor from before ...

  protected override async *postprocess_generator(
    broker_content: any,
    request: BotTryRequest<CodeReviewBTH>
  ): BotPostprocessGenerator<CodeReviewBTH> {
    // 1. Get the schema-validated data from the StructuredOutputBotMixin.
    //    This is guaranteed to be a valid object that matches our Zod schema.
    const validatedData: CodeReviewOutput = yield* super.postprocess_generator(broker_content, request);

    // 2. Add our own custom business logic validation.
    const lineCount = request.input.split('\n').length;
    for (const comment of validatedData.comments) {
      if (comment.line_number > lineCount) {
        // 3. If the logic fails, throw an error. The bot framework will
        //    catch this and trigger an automatic retry with this error message.
        throw new FFError(
          `The review contains a comment for line ${comment.line_number}, but the code is only ${lineCount} lines long. Please correct the line numbers.`
        );
      }
    }

    // 4. If all checks pass, return the data.
    return validatedData;
  }
}
```

This pattern is incredibly powerful. It lets you leverage the framework's helpers for the heavy lifting (JSON parsing, schema validation) while easily layering on your own domain-specific rules. If our custom check fails, the bot will automatically retry and "tell" the LLM about its mistake, guiding it toward a logically correct answer.

---

## Chapter 3: Agentic Behavior with Dynamic Tool Calls

Our bot is getting smarter, but we can make it truly agentic. What if, after generating a code suggestion, the AI could validate its *own* suggestion to ensure it's correct before showing it to the user? This is a perfect use case for a dynamic **Tool Call**.

To get this power, we add the `DispatchTable` with tool definitions to our existing mixin composition.

### Step 1: Define and Register a Validation Tool

Our tool will check if a suggested code snippet is valid. For this tutorial, our mock "validator" will check for TypeScript type annotations.

```typescript
import { DispatchTable } from '@firebrandanalytics/ff-agent-sdk/bot';

// This is our mock validation tool.
async function validateSuggestion(request: any, args: { suggestion: string }): Promise<string[]> {
  console.log('Validating AI suggestion...');
  if (args.suggestion.includes(': number')) {
    return []; // No errors, suggestion is valid!
  }
  return ['Suggestion is missing explicit type annotations (e.g., `: number`).'];
}

const reviewDispatchTable: DispatchTable<CodeReviewPTH, CodeReviewOutput> = {
  validateSuggestion: {
    func: validateSuggestion,
    spec: { // The schema tells the LLM how to use the tool
      name: 'validateSuggestion',
      description: 'Validates a TypeScript code suggestion to ensure it follows best practices like including type annotations.',
      parameters: {
        type: 'object',
        properties: {
          suggestion: { type: 'string', description: 'The suggested code snippet to validate.' }
        },
        required: ['suggestion']
      }
    }
  }
};

// Update the bot's constructor to include the dispatch table
export class CodeReviewBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<CodeReviewBTH, [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]>,
  [StructuredOutputBotMixin<CodeReviewBTH, typeof CodeReviewOutputSchema>]
]> {
  constructor() {
    // ... same StructuredPromptGroup setup as before ...

    const config: MixinBotConfig<CodeReviewBTH> = {
      name: "CodeReviewBot",
      base_prompt_group: structuredPromptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {} as CodeReviewPTH['args']['static'],
      dispatch_table: reviewDispatchTable, // Register the tool
    };

    // super() takes an array per mixin: [MixinBot config], [StructuredOutput config]
    super([config], [{ schema: CodeReviewOutputSchema }]);
  }

  // ... postprocess_generator from Chapter 2 ...
}
```

### Step 2: Update the Prompt to Use the Tool

The LLM won't use the tool unless we tell it to! This is the most critical step: we instruct the AI on its new agentic workflow.

```typescript
// In CodeReviewAssistantPrompt, add a new section:
get_Validation_Workflow_Section(): PromptTemplateNode<CodeReviewPTH> {
  return new PromptTemplateSectionNode<CodeReviewPTH>({
    semantic_type: 'rule',
    content: 'Validation Workflow:',
    children: [
      'IMPORTANT: When you decide to provide a code suggestion, you MUST first validate it using the `validateSuggestion` tool.',
      'If the tool returns any errors, you MUST modify your suggestion to fix the errors and then call the tool again.',
      'Do NOT include a suggestion in your final JSON output unless it has been successfully validated by the tool (i.e., the tool returned an empty array).',
    ]
  });
}
```

### Step 3: The Generate-Then-Validate Lifecycle

By adding this tool and prompt, we've created a sophisticated, agentic loop that happens between our Bot and the LLM:

1.  **SDK -> LLM:** "Review this code: `function add(a,b){return a+b}`."
2.  **LLM (reasoning):** "This code lacks types. I will suggest `function add(a: number, b: number): number { return a + b; }`. My instructions say I must validate this suggestion before I can finish."
3.  **LLM -> SDK:** "Please call the `validateSuggestion` tool for me on this code snippet: `function add(a: number, b: number): number { return a + b; }`."
4.  **SDK:** The framework executes your `validateSuggestion` function. It passes validation.
5.  **SDK -> LLM:** "The `validateSuggestion` tool returned `[]` (no errors)."
6.  **LLM (reasoning):** "Excellent. My suggestion is valid. Now I can confidently construct the final JSON output."
7.  **LLM -> SDK:** (Sends the final, complete JSON object with the validated suggestion).

This is the power of dynamic tool calls: the AI uses tools as part of its own internal reasoning process to improve the quality of its final answer.

### Step 4: Implement Enhanced `postprocess_generator` with Tool Validation

Since we're using mixins, the `StructuredOutputBotMixin` handles JSON parsing and schema validation automatically. We add our enhancement to check that the workflow was followed:

```typescript
// Inside the CodeReviewBot class
import { extractJSON } from '@firebrandanalytics/ff-agent-sdk/utils';

protected override async *postprocess_generator(
  broker_content: any,
  request: BotTryRequest<CodeReviewBTH>
): BotPostprocessGenerator<CodeReviewBTH> {
  // 1. Get the schema-validated data from the StructuredOutputBotMixin.
  const validatedData: CodeReviewOutput = yield* super.postprocess_generator(broker_content, request);

  // 2. Add custom business logic validation (from Chapter 2).
  const lineCount = request.input.split('\n').length;
  for (const comment of validatedData.comments) {
    if (comment.line_number > lineCount) {
      throw new FFError(
        `The review contains a comment for line ${comment.line_number}, but the code is only ${lineCount} lines long.`
      );
    }
  }

  // 3. ADVANCED VALIDATION: Check if the tool workflow was followed.
  // The BotRequest object tracks all tools that were called during this try.
  const toolCallResults = request.get_tool_call_results();
  const validatorWasCalled = Object.values(toolCallResults).some(
    (call) => call.func_name === 'validateSuggestion'
  );

  const hasSuggestion = validatedData.comments.some(c => !!c.suggestion);

  // If the LLM provided a suggestion but skipped our mandatory validation step,
  // we reject the output and force a retry.
  if (hasSuggestion && !validatorWasCalled) {
    throw new FFError("The review contains a code suggestion, but the `validateSuggestion` tool was not called. You must validate all suggestions.");
  }

  return validatedData;
}
```

---

## Chapter 4: Conclusion and Next Steps

Congratulations! You've built a truly robust and powerful bot.

**Our bot evolved from:**
*   A simple, schema-validated data-fetcher using `MixinBot` + `StructuredOutputBotMixin`.
*   To a more intelligent agent with custom business logic validation.
*   To a powerful, tool-using bot that can orchestrate a dynamic, agentic workflow.
*   And finally, to a resilient, self-correcting system that validates both the structure and the *process* of the AI's output.

You now understand the core patterns of the Bot framework:
1. **Start simple** with pre-composed mixins (`MixinBot` + `StructuredOutputBotMixin`)
2. **Add complexity** by overriding `postprocess_generator` for custom validation
3. **Enable agentic behavior** by adding tools via `dispatch_table`
4. **Orchestrate workflows** by guiding the AI with prompts and validating results

### The Mixin Composition Pattern

Remember that you can always add more capabilities by composing additional mixins:

```typescript
// Base structured output bot (Chapters 1-3)
// Note: In practice, each class needs type parameters on the ComposeMixins generic —
// see the full CodeReviewBot example above for the pattern.
export class SimpleBot extends ComposeMixins(MixinBot, StructuredOutputBotMixin)<[...]> { }

// Add working memory access
export class SmartBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  WorkingMemoryBotMixin
)<[...]> { }

// Add feedback collection
export class FeedbackBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
)<[...]> { }
```

**The Path Forward:**
You now have a complete, self-contained AI behavior. The final step is to connect it to your application's data and state. To learn how to wrap this Bot in a stateful, resumable Entity, see the **[Getting Started Guide]**.
