# A Step-by-Step Guide to the FireFoundry Prompting Framework

Welcome! This tutorial is your hands-on guide to building powerful, structured, and dynamic prompts using the FireFoundry Prompting Framework.

### The Goal
We will build a complete prompt for an automated **"Code Review Assistant."** By the end, you will understand how to construct sophisticated prompts from simple, reusable components.

### The Philosophy: Prompts as Code
In FireFoundry, we treat prompts as first-class citizens of your application—they are structured, testable, and reusable code, not just simple strings. This approach allows you to build highly complex and reliable AI behaviors while maintaining clarity and organization.

### The Scope
This tutorial focuses exclusively on creating and rendering prompts. We will not be integrating them into Bots or Entities, which are covered in their respective guides. Our goal is to master the art of prompt construction first.

---

## Chapter 1: Your First Prompt - The Bare Minimum

Let's start with the simplest possible prompt: a static set of instructions.

### Step 1: The `PromptTypeHelper` (PTH)
Every prompt is strongly typed using the `PromptTypeHelper`. It defines the shape of your prompt's inputs and arguments. For now, our prompt will take a `string` (the code to be reviewed) and have no special arguments.

```typescript
import type { PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk/prompts';

// I: The main input type. For us, this is the code to be reviewed.
// ARGS: The arguments for customizing the prompt. We'll start with none.
// ARGS must have a `{ static, request }` shape (PromptArgsType).
type CodeReviewPTH = PromptTypeHelper<
  string, // Input type
  { static: {}; request: {} } // Arguments type
>;
```

### Step 2: The `Prompt` Class
Next, we'll create our prompt class. It extends the base `Prompt` and uses our PTH for type safety.

```typescript
import { Prompt, PromptTemplateNode, PromptTemplateSectionNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

export class CodeReviewAssistantPrompt extends Prompt<CodeReviewPTH> {
  constructor() {
    // The Prompt constructor takes a config object with `role` and `static_args`.
    super({ role: 'system', static_args: {} });
    this.add_section(this.get_Context_Section());
  }

  get_Context_Section(): PromptTemplateNode<CodeReviewPTH> {
    // A SectionNode is a container for organizing prompt content.
    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'context',
      content: 'Context:', // This becomes the section header
      children: [
        'You are a senior software engineer acting as an expert code reviewer.',
        'Your goal is to provide a clear, constructive, and actionable review.'
      ]
    });
  }
}
```

### Step 3: Rendering the Prompt
Let's see what our prompt looks like! We can write a simple function to instantiate and render it.

```typescript
async function renderPrompt() {
  const prompt = new CodeReviewAssistantPrompt();
  
  // The .render() method processes the nodes and returns the final string.
  // We pass a dummy input string for now.
  const renderedOutput = await prompt.render({ input: 'const x = 1;' });

  console.log(renderedOutput.content);
}

renderPrompt();
```

**Output:**
```
Context:
You are a senior software engineer acting as an expert code reviewer.
Your goal is to provide a clear, constructive, and actionable review.
```
Success! We've created and rendered our first structured prompt.

---

## Chapter 2: Making it Dynamic with Arguments

Static text is limiting. Let's make our prompt dynamic by passing in arguments.

### Step 1: Updating the PTH
We'll update our `PromptTypeHelper` to accept arguments.
*   `static` args are provided when the prompt class is instantiated and are the same for every render.
*   `request` args are provided at render time and can change with each call.

```typescript
type CodeReviewPTH = PromptTypeHelper<
  string,
  {
    static: {
      programming_language: string; // e.g., 'TypeScript'
    };
    request: {
      user_name: string; // e.g., 'Alex'
    };
  }
>;
```

### Step 2: Using Arguments in Nodes
Now we can use these arguments within our nodes. We do this by passing a function that receives the `request` object.

```typescript
export class CodeReviewAssistantPrompt extends Prompt<CodeReviewPTH> {
  constructor(staticArgs: CodeReviewPTH['args']['static']) {
    // Pass static args to the super constructor via the config object.
    super({ role: 'system', static_args: staticArgs });
    this.add_section(this.get_Context_Section());
  }

  get_Context_Section(): PromptTemplateNode<CodeReviewPTH> {
    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        // Access static args via `this.static_args`
        `You are a senior software engineer specializing in ${this.static_args.programming_language}.`,
        // Access request args via the request object in a function
        (request) => `You are providing a code review for a developer named ${request.args.user_name}.`,
        'Your goal is to provide a clear, constructive, and actionable review.'
      ]
    });
  }
}
```

### Step 3: Rendering with Arguments
Our rendering logic now needs to provide these arguments.

```typescript
async function renderPrompt() {
  // Static args are passed to the constructor.
  const prompt = new CodeReviewAssistantPrompt({ programming_language: 'TypeScript' });
  
  // Request args are passed to the render method.
  const renderedOutput = await prompt.render({
    input: 'const x = 1;',
    args: { user_name: 'Alex' }
  });

  console.log(renderedOutput.content);
}

renderPrompt();
```

**Output:**
```
Context:
You are a senior software engineer specializing in TypeScript.
You are providing a code review for a developer named Alex.
Your goal is to provide a clear, constructive, and actionable review.
```
Our prompt is now personalized and context-aware!

---

## Chapter 3: Adding Structure with Different Node Types

Let's make our prompt richer and easier for the LLM to understand by using more specialized node types.

### Step 1: Adding Rules with `PromptTemplateListNode`
A numbered list is a great way to provide clear, distinct rules.

```typescript
// Inside the CodeReviewAssistantPrompt class...
  constructor(staticArgs: CodeReviewPTH['args']['static']) {
    super({ role: 'system', static_args: staticArgs });
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Rules_Section()); // Add the new section
  }
  
  // ... get_Context_Section() remains the same ...

  get_Rules_Section(): PromptTemplateNode<CodeReviewPTH> {
    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'rule',
      content: 'Rules:',
      children: [
        // This node automatically formats its children as a list.
        new PromptTemplateListNode<CodeReviewPTH>({
          semantic_type: 'rule',
          children: [
            'Be specific and provide code examples where possible.',
            'Maintain a positive and encouraging tone.',
            'Explain the "why" behind your suggestions, not just the "what".'
          ],
          // This function defines the label for each list item.
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }
```

### Step 2: Adding Examples with `PromptTemplateCodeBoxNode`
Showing examples is one of the most effective ways to guide an LLM. The `CodeBoxNode` is perfect for this.

```typescript
// Inside the CodeReviewAssistantPrompt class...
  constructor(staticArgs: CodeReviewPTH['args']['static']) {
    super({ role: 'system', static_args: staticArgs });
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Rules_Section());
    this.add_section(this.get_Examples_Section()); // Add the new section
  }

  // ... other sections ...

  get_Examples_Section(): PromptTemplateNode<CodeReviewPTH> {
    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'sample_code',
      content: 'Example Review:',
      children: [
        new PromptTemplateCodeBoxNode<CodeReviewPTH>({
          content: 'Bad Code:',
          options: { struct_data_language: 'typescript' },
          children: [`function add(a, b) { return a+b; }`]
        }),
        new PromptTemplateCodeBoxNode<CodeReviewPTH>({
          content: 'Good Review Comment:',
          children: [`"This function works, but we can improve its readability and type safety. Consider adding explicit types for the parameters and return value, like this: \`function add(a: number, b: number): number { return a + b; }\`. This helps prevent bugs and makes the code easier to maintain."`]
        })
      ]
    });
  }
```

Now our prompt provides clear context, rules, and examples, dramatically improving the quality of the expected output.

---

## Chapter 4: Defining a Structured Output with Schemas

To get reliable, parsable JSON from an LLM, we must clearly define the output schema.

### Step 1: Creating Schemas with Zod
We use the popular Zod library to define our schemas. The `withSchemaMetadata` function adds descriptions that help the LLM understand our intent.

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk/prompts';

const ReviewCommentSchema = withSchemaMetadata(
  z.object({
    line_number: z.number().describe('The specific line number the comment refers to.'),
    comment: z.string().describe('The detailed review comment.'),
    suggestion: z.string().optional().describe('An optional code snippet suggestion.')
  }),
  'ReviewComment', // Name of the schema
  'A single, actionable comment about a specific line of code.' // Description
);

const CodeReviewOutputSchema = withSchemaMetadata(
  z.object({
    overall_feedback: z.string().describe('A high-level summary of the code quality.'),
    comments: z.array(ReviewCommentSchema).describe('A list of specific comments.')
  }),
  'CodeReviewOutput',
  'The complete code review, including a summary and detailed comments.'
);
```

### Step 2: Using `PromptTemplateSchemaSetNode`
This special node automatically translates our Zod schemas into a human-readable format for the LLM.

```typescript
// Inside the CodeReviewAssistantPrompt class...
  constructor(staticArgs: CodeReviewPTH['args']['static']) {
    // ...
    this.add_section(this.get_Output_Schema_Section()); // Add the new section
  }

  // ... other sections ...

  get_Output_Schema_Section(): PromptTemplateNode<CodeReviewPTH> {
    const schemaSetNode = new PromptTemplateSchemaSetNode<CodeReviewPTH>({
      semantic_type: 'schema',
      children: []
    });

    // Add our defined schemas to the set.
    schemaSetNode.addSchemas([CodeReviewOutputSchema, ReviewCommentSchema]);

    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'schema',
      content: 'Output Schema:',
      children: [
        'You must respond with a single JSON object that conforms to the following structure. Do not add any other text or formatting.',
        schemaSetNode
      ]
    });
  }
```

When rendered, this section will look something like this to the LLM, clearly defining its task:
```
Output Schema:
You must respond with a single JSON object that conforms to the following structure...

CodeReviewOutput: The complete code review, including a summary and detailed comments.
- overall_feedback (string): A high-level summary of the code quality.
- comments (Array<ReviewComment>): A list of specific comments.

ReviewComment: A single, actionable comment about a specific line of code.
- line_number (number): The specific line number the comment refers to.
...
```

---

## Chapter 5: Adding Logic with Programmatic Nodes

Prompts aren't just static templates; they can contain logic, just like regular code.

### Step 1: Conditional Logic with `PromptTemplateIfElseNode`
Let's add a special rule that only appears for urgent reviews.

```typescript
// 1. Update the PTH to accept a new request argument
type CodeReviewPTH = PromptTypeHelper<
  string,
  {
    static: { /* ... */ };
    request: {
      user_name: string;
      is_urgent_review?: boolean; // New argument
    };
  }
>;

// 2. Use the IfElseNode in the "Rules" section
import { PromptTemplateIfElseNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Inside get_Rules_Section, add this to the children of the PromptTemplateListNode
// ...
children: [
  // ... other rules
  new PromptTemplateIfElseNode<CodeReviewPTH>({
    condition_func: (request) => request.args.is_urgent_review === true,
    true_case: 'For this URGENT review, focus only on critical bugs and security flaws. Ignore stylistic issues.',
    false_case: 'Provide a comprehensive review covering correctness, style, and best practices.'
  })
]
// ...
```
Now, when we render with `args: { is_urgent_review: true }`, the urgent rule will appear. Otherwise, the standard rule will be used.

### Step 2: Iteration with `PromptTemplateForEachNode`
We can also generate content dynamically from a list. Let's add a section for common pitfalls to look for.

```typescript
// 1. Update the PTH again
type CodeReviewPTH = PromptTypeHelper<
  string,
  {
    static: { /* ... */ };
    request: {
      user_name: string;
      is_urgent_review?: boolean;
      common_pitfalls?: string[]; // New argument
    };
  }
>;

// 2. Add a new section using ForEachNode
import { PromptTemplateForEachNode } from '@firebrandanalytics/ff-agent-sdk/prompts';

// Inside the CodeReviewAssistantPrompt class...
  get_Pitfalls_Section(): PromptTemplateNode<CodeReviewPTH> {
    return new PromptTemplateSectionNode<CodeReviewPTH>({
      semantic_type: 'rule',
      content: 'Specific things to check for:',
      // This section will only render if `common_pitfalls` is provided.
      condition: (request) => (request.args.common_pitfalls?.length ?? 0) > 0,
      children: [
        new PromptTemplateForEachNode<CodeReviewPTH>({
          // The array to iterate over.
          array_property: (request) => request.args.common_pitfalls ?? [],
          // The name of the variable inside the loop.
          iteration_variable_name: 'pitfall',
          children: [
            // Access the variable via `request.local_scope`.
            (request) => `- Pay special attention to potential issues with: ${request.local_scope.pitfall}`
          ]
        })
      ]
    });
  }
```
If we render with `args: { common_pitfalls: ['Magic numbers', 'Lack of comments'] }`, our prompt will now include a dynamically generated list of these points.

---

## Chapter 6: Putting It All Together with `PromptGroup` and `StructuredPromptGroup`

A complete LLM interaction requires both our detailed system prompt and the actual user input (the code to be reviewed). A `PromptGroup` assembles these pieces in the correct order.

### Using `PromptGroup` Directly

```typescript
import {
  Prompt,
  PromptGroup,
  PromptTemplateTextNode,
} from '@firebrandanalytics/ff-agent-sdk/prompts';

function assemblePromptGroup() {
  const systemPrompt = new CodeReviewAssistantPrompt({ programming_language: 'TypeScript' });

  // Build a user-input prompt that forwards the request's input text.
  const userInputPrompt = new Prompt<CodeReviewPTH>({
    role: 'user',
    static_args: {} as CodeReviewPTH['args']['static'],
  });
  userInputPrompt.add_section(
    new PromptTemplateTextNode<CodeReviewPTH>({
      content: (request) => request.input as string,
    })
  );

  const promptGroup = new PromptGroup<CodeReviewPTH>([
    { name: 'system_instructions', prompt: systemPrompt },
    { name: 'user_input', prompt: userInputPrompt }
  ]);

  return promptGroup;
}

// And our final render function for the group:
async function renderFullPrompt() {
  const promptGroup = assemblePromptGroup();
  const codeToReview = `function calculate(data) { /* ... */ }`;

  const rendered = await promptGroup.render({
    input: codeToReview,
    args: {
      user_name: 'Alex',
      is_urgent_review: false,
      common_pitfalls: ['Error handling']
    }
  });

  // The output is an array of messages, ready to be sent to an LLM.
  console.log(JSON.stringify(rendered, null, 2));
}

renderFullPrompt();
```

**Output:**
```json
[
  {
    "role": "system",
    "content": "Context:\nYou are a senior software engineer...\n\nRules:\n1. Be specific...\n..."
  },
  {
    "role": "user",
    "content": "function calculate(data) { /* ... */ }"
  }
]
```
We now have a complete, multi-part prompt, structured perfectly for an API call to a large language model.

### Using `StructuredPromptGroup` (Recommended for Bots)

When building prompts for use with `MixinBot`, use `StructuredPromptGroup` instead of a bare `PromptGroup`. It organizes prompts into named phases (`base`, `input`, `extensions`, etc.) that the bot framework understands:

```typescript
import {
  Prompt,
  PromptGroup,
  PromptTemplateTextNode,
  StructuredPromptGroup,
} from '@firebrandanalytics/ff-agent-sdk/prompts';

function assembleStructuredPromptGroup() {
  const systemPrompt = new CodeReviewAssistantPrompt({ programming_language: 'TypeScript' });

  const userInputPrompt = new Prompt<CodeReviewPTH>({
    role: 'user',
    static_args: {} as CodeReviewPTH['args']['static'],
  });
  userInputPrompt.add_section(
    new PromptTemplateTextNode<CodeReviewPTH>({
      content: (request) => request.input as string,
    })
  );

  // StructuredPromptGroup separates base (system) and input (user) phases.
  return new StructuredPromptGroup<CodeReviewPTH>({
    base: new PromptGroup<CodeReviewPTH>([
      { name: 'system_instructions', prompt: systemPrompt },
    ]),
    input: new PromptGroup<CodeReviewPTH>([
      { name: 'user_input', prompt: userInputPrompt },
    ]),
  });
}
```

This `StructuredPromptGroup` is what you pass to `MixinBotConfig.base_prompt_group` when building a bot — see the **[Writing Bots Guide]** for the full pattern.

---

## Chapter 7: Conclusion and Next Steps

Congratulations! You have successfully built a sophisticated, dynamic, and structured prompt template.

**We journeyed from:**
*   A simple, static string...
*   To a dynamic prompt with arguments...
*   To a richly structured prompt with lists and code boxes...
*   To a prompt that demands a specific, parsable JSON output...
*   To a prompt with conditional logic and loops...
*   And finally, to a complete, multi-part `PromptGroup`.

You now understand the core philosophy of "Prompts as Code" and have the foundational skills to build prompts for any task.

**The Path Forward:**
Now that you can build powerful prompts, the next step is to use them. To learn how to integrate this prompt into a reusable AI behavior, read the **[Writing Bots Guide]**.