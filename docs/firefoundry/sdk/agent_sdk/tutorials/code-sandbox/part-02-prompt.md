# Part 2: The Prompt

In this part, you'll learn what output format CoderBot expects from the LLM and create a prompt that instructs the LLM to produce it.

## How CoderBot Processes LLM Output

Unlike `StructuredDataBot` (which expects pure JSON), `CoderBot` expects the LLM to produce **two blocks** in its response:

1. **A JSON metadata block** -- describes what the code does
2. **A code block** -- the actual executable code

The LLM response should look like this:

````
```json
{
  "description": "Calculates the first 10 Fibonacci numbers",
  "reasoning": "Using iterative approach for efficiency"
}
```

```typescript
export async function run() {
  const fib: number[] = [0, 1];
  for (let i = 2; i < 10; i++) {
    fib.push(fib[i - 1] + fib[i - 2]);
  }
  return {
    description: "First 10 Fibonacci numbers",
    result: fib
  };
}
```
````

CoderBot's `postprocess_generator` parses both blocks:
- The JSON metadata is stored alongside the code in working memory
- The code is validated, prepended with module imports, stored in working memory, and executed in the Code Sandbox

### The `run()` Function Contract

For TypeScript, GeneralCoderBot's run script expects the generated code to export an async `run()` function:

```typescript
// GeneralCoderBot's run script:
import { run } from './ai-code.js';

export default (async () => {
  const result = await run();
  return result;
})();
```

The `run()` function should return an object with at least a `description` and `result` field. The sandbox captures the return value and sends it back through the pipeline.

## Creating the Prompt

Our prompt needs to tell the LLM:
1. What role it plays (code generator)
2. The two-block output format it must follow
3. Rules for the generated code (must export `run()`, must be self-contained, etc.)

Create the file `apps/coder-bundle/src/prompts/CoderPrompt.ts`:

```typescript
import {
  Prompt,
  PromptTypeHelper,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  RegisterPrompt,
} from "@firebrandanalytics/ff-agent-sdk";

type CODER_PROMPT_PTH = PromptTypeHelper<string, { static: {}; request: {} }>;

@RegisterPrompt("CoderPrompt")
export class CoderPrompt extends Prompt<CODER_PROMPT_PTH> {
  constructor(
    role: "system" | "user" | "assistant",
    options?: CODER_PROMPT_PTH["options"]
  ) {
    super(role, options ?? {});
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_OutputFormat_Section());
    this.add_section(this.get_CodeRules_Section());
  }

  protected get_Context_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "context",
      content: "Context:",
      children: [
        "You are a TypeScript code generation assistant.",
        "You receive natural language requests and produce executable TypeScript code.",
        "Your code will be executed in a sandboxed environment with Node.js.",
      ],
    });
  }

  protected get_OutputFormat_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Output Format:",
      children: [
        "You MUST produce exactly two fenced code blocks in your response:",
        "1. A ```json block containing metadata about the code you will generate.",
        '   It must include "description" (string) and "reasoning" (string) fields.',
        "2. A ```typescript block containing the executable TypeScript code.",
        "Do not include any other fenced code blocks in your response.",
      ],
    });
  }

  protected get_CodeRules_Section(): PromptTemplateNode<CODER_PROMPT_PTH> {
    return new PromptTemplateSectionNode<CODER_PROMPT_PTH>({
      semantic_type: "rule",
      content: "Code Rules:",
      children: [
        new PromptTemplateListNode<CODER_PROMPT_PTH>({
          semantic_type: "rule",
          children: [
            'Your code MUST export an async function named "run" as the entry point.',
            "The run() function must return an object with at least { description: string, result: any }.",
            "The code must be self-contained. Do not import external packages.",
            "Use only built-in Node.js APIs and standard TypeScript features.",
            "Handle errors gracefully inside the run() function.",
            "Do not use console.log for output -- return all data from run().",
          ],
          list_label_function: (_req: any, _child: any, idx: number) =>
            `${idx + 1}. `,
        }),
      ],
    });
  }
}
```

### Understanding the Prompt Components

**`Prompt<PTH>`** is the base class for all prompts. It manages a tree of template nodes that are rendered into the final LLM message.

**`PromptTypeHelper<Input, Args>`** defines the type signature:
- `Input` (`string`) -- the user's natural language request
- `Args` (`{ static: {}; request: {} }`) -- no extra arguments needed for this prompt

**`@RegisterPrompt("CoderPrompt")`** registers the prompt class in the global registry so it can be looked up by name.

**`PromptTemplateSectionNode`** creates a section with a heading and child content items. The `semantic_type` field helps the rendering engine understand the section's purpose:
- `"context"` -- background information
- `"rule"` -- instructions the LLM must follow

**`PromptTemplateListNode`** renders its children as a numbered or bulleted list. The `list_label_function` controls the prefix format.

### How Sections Render

When the prompt is rendered for the LLM, the tree of nodes becomes a flat text block:

```
Context:
You are a TypeScript code generation assistant.
You receive natural language requests and produce executable TypeScript code.
Your code will be executed in a sandboxed environment with Node.js.

Output Format:
You MUST produce exactly two fenced code blocks in your response:
1. A ```json block containing metadata about the code you will generate.
   It must include "description" (string) and "reasoning" (string) fields.
2. A ```typescript block containing the executable TypeScript code.
Do not include any other fenced code blocks in your response.

Code Rules:
1. Your code MUST export an async function named "run" as the entry point.
2. The run() function must return an object with at least { description: string, result: any }.
3. The code must be self-contained. Do not import external packages.
4. Use only built-in Node.js APIs and standard TypeScript features.
5. Handle errors gracefully inside the run() function.
6. Do not use console.log for output -- return all data from run().
```

## Building and Verifying

After creating the prompt file, verify the project still builds:

```bash
pnpm run build
```

The prompt file compiles as a standalone module. It doesn't connect to anything yet -- we'll wire it into the bot in Part 3.

## Key Points

> **Two-block format** -- CoderBot expects `\`\`\`json` metadata followed by a language-specific code block (e.g., `\`\`\`typescript`). Both must be present or the postprocessor will throw an error.

> **The `run()` contract** -- For TypeScript, GeneralCoderBot's run script imports `{ run }` from the generated code file. The function must be async and return the result.

> **Prompt architecture** -- FireFoundry prompts are composable trees of template nodes. Each section can be conditionally included, dynamically generated, or data-driven. This is more powerful than raw string templates.

---

**Next:** [Part 3: The Bot](./part-03-bot.md) -- Create DemoCoderBot using GeneralCoderBot with the Code Sandbox client.
