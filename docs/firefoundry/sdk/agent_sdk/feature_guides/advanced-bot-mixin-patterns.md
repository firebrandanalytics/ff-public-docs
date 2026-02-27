# Advanced Bot Mixin Patterns: Building Powerful AI Behavior

This guide explores the advanced mixin system for bots, showing how to combine multiple mixins for sophisticated AI behavior and how to build custom mixins.

## Table of Contents

1. [Overview](#overview)
2. [DataValidationBotMixin](#datavalidationbotmixin)
3. [FeedbackBotMixin Deep-Dive](#feedbackbotmixin-deep-dive)
4. [WorkingMemoryBotMixin](#workingmemorybotmixin)
5. [Advanced Composition](#advanced-composition)
6. [Building Custom Mixins](#building-custom-mixins)
7. [Real-World Examples](#real-world-examples)
8. [Performance & Optimization](#performance--optimization)

---

## Overview

### The Bot Mixin System

v3.0.0-beta.0 introduces a powerful mixin system where bot capabilities are composed rather than inherited:

```typescript
// Instead of rigid class hierarchies:
class MyBot extends StructuredDataBot { }

// You compose capabilities:
class MyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,      // For structured output
  DataValidationBotMixin,        // For AI-powered validation
  FeedbackBotMixin,              // For processing feedback
  WorkingMemoryBotMixin          // For memory access
) { }
```

### Available Mixins

| Mixin | Purpose | When to Use |
|-------|---------|-----------|
| **StructuredOutputBotMixin** | Zod schema validation | When you need guaranteed structured output |
| **DataValidationBotMixin** | AI-powered data correction | When data needs intelligent fixing |
| **FeedbackBotMixin** | Process feedback iterations | When implementing feedback loops |
| **WorkingMemoryBotMixin** | Access working memory files | When you need file/blob context in prompts |
| **ChatHistoryBotMixin** | Inject conversation history | When building multi-turn conversational bots |

For a dedicated guide to `ChatHistoryBotMixin` — including custom entity models, token budget management, and `ChatHistoryPromptGroup` — see [Chat History](../guides/chat-history.md).

### Composition Order

Order matters for mixin pre-phase execution:

```typescript
class MyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,      // Pre-phase 1: Validates structure
  DataValidationBotMixin,        // Pre-phase 2: Validates/corrects data
  FeedbackBotMixin,              // Pre-phase 3: Adds feedback context
  WorkingMemoryBotMixin          // Pre-phase 4: Adds memory access
) { }
```

---

## DataValidationBotMixin

The `DataValidationBotMixin` uses AI to validate and intelligently correct data when it doesn't match schema constraints.

### When to Use

- **Complex validation logic** - Conditions beyond simple type/length checks
- **Intelligent correction** - Let AI fix problems instead of rejecting
- **Business rule validation** - "Revenue can't be less than cost"
- **Domain-specific rules** - Industry-specific constraints

### Setup

```typescript
import { ComposeMixins, MixinBot, StructuredOutputBotMixin, DataValidationBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';
import { z } from 'zod';

const OrderSchema = z.object({
  order_id: z.string(),
  items: z.array(z.object({
    product_id: z.string(),
    quantity: z.number().min(1),
    unit_price: z.number().positive()
  })),
  total_amount: z.number().positive(),
  customer_name: z.string().min(2)
});

type OrderOutput = z.infer<typeof OrderSchema>;

class ValidatingOrderBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    const promptGroup = new PromptGroup([
      {
        name: 'system',
        prompt: new PromptTemplateStringOrStructNode({
          semantic_type: 'system',
          content: 'You are an order processing AI. Extract order information accurately.'
        })
      }
    ]);

    super({
      name: "OrderBot",
      schema: OrderSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default"
    });
  }
}
```

### How It Works

The `DataValidationBotMixin` uses the **validation library** (`@firebrandanalytics/shared-utils`) to transform LLM output into validated class instances. Validation rules are defined using **decorators** on the class:

```typescript
import { CoerceTrim, ValidateRange, CoerceFromSet } from '@firebrandanalytics/shared-utils';

// Context type for dynamic validation
interface OrderContext {
  availableProducts: string[];
}

// Validated class with decorator-based rules
class Order {
  @CoerceTrim()
  @CoerceFromSet<OrderContext>(ctx => ctx.availableProducts)
  productName: string;

  @ValidateRange({ min: 1, max: 1000 })
  quantity: number;

  @CoerceTrim()
  customerName: string;
}
```

### Configuration

The actual configuration interface:

```typescript
interface DataValidationMixinConfig<BTH, ValidatedClass, Context = any> {
  // Required: The class to instantiate and validate
  validatedClass: new () => ValidatedClass;

  // Optional: Extract context from bot request for dynamic validations
  contextExtractor?: (request: BotTryRequest<BTH>) => Context | Promise<Context>;

  // Optional: Validation options for the factory
  validationOptions?: Partial<ValidationOptions<Context>>;

  // Optional: Section name in prompt group where validator is added (default: 'followup')
  section?: string;

  // Optional: Custom validation factory instance
  validationFactory?: ValidationFactory;
}
```

### Example: Order Validation with Context

```typescript
import { ComposeMixins, MixinBot, StructuredOutputBotMixin, DataValidationBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

class OrderBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    const promptGroup = new PromptGroup([
      {
        name: 'system',
        prompt: new PromptTemplateStringOrStructNode({
          semantic_type: 'system',
          content: 'You are an order processing AI. Extract order information.'
        })
      }
    ]);

    super(
      // MixinBot config
      {
        name: "OrderBot",
        base_prompt_group: promptGroup,
        model_pool_name: "default"
      },
      // StructuredOutputBotMixin config
      { schema: OrderSchema },
      // DataValidationBotMixin config
      {
        validatedClass: Order,
        contextExtractor: async (request) => ({
          availableProducts: request.args.availableProducts
        })
      }
    );
  }
}
```

### Workflow

1. **LLM produces output** → Raw JSON
2. **StructuredOutputBotMixin validates** → Zod schema validation
3. **DataValidationBotMixin transforms** → Creates validated class instance
4. **Final output** → Validated class instance with applied decorators

---

## FeedbackBotMixin Deep-Dive

### Overview

The `FeedbackBotMixin` adds support for processing feedback from human reviewers or automated systems, enabling iterative refinement.

### Core Concepts

1. **Feedback Context**: Injected via entity request args as `_ff_feedback`
2. **Previous Result**: Previous bot output available as `_ff_previous_result`
3. **Version Tracking**: Current iteration number as `_ff_version`
4. **Automatic Prompting**: Mixin adds feedback handling prompts

### Setup

```typescript
import { ComposeMixins, MixinBot, StructuredOutputBotMixin, FeedbackBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

const AnalysisSchema = z.object({
  summary: z.string(),
  key_insights: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

interface AnalysisFeedback {
  clarity_score: 1 | 2 | 3 | 4 | 5;
  missing_insights: string[];
  too_verbose: boolean;
  general_feedback: string;
}

class IterativeAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
)<
  [typeof MixinBot, typeof StructuredOutputBotMixin, typeof FeedbackBotMixin]
> {
  constructor() {
    const feedbackPrompt = new PromptTemplateSectionNode({
      semantic_type: 'guidance',
      content: 'If you are revising based on feedback:',
      children: [
        'Previous attempt: {_ff_previous_result}',
        'Reviewer feedback: {_ff_feedback}',
        'Current attempt number: {_ff_version}',
        'Address all feedback points and improve your analysis.'
      ]
    });

    super({
      name: "IterativeAnalysisBot",
      schema: AnalysisSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default",
      feedbackPrompt: feedbackPrompt,
      role: 'system'
    });
  }
}
```

### Custom Feedback Handling

Override feedback processing for custom logic:

```typescript
class CustomFeedbackBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {

  protected async processFeedback(
    feedback: AnalysisFeedback,
    previousResult: AnalysisOutput,
    version: number
  ): Promise<string> {
    // Create detailed feedback message for the LLM
    const feedbackSummary = [
      `Clarity Score: ${feedback.clarity_score}/5`,
      feedback.too_verbose ? 'Feedback: Output is too verbose - be more concise' : '',
      feedback.missing_insights.length > 0
        ? `Missing insights: ${feedback.missing_insights.join(', ')}`
        : '',
      feedback.general_feedback ? `Comments: ${feedback.general_feedback}` : ''
    ]
      .filter(line => line.length > 0)
      .join('\n');

    return `
Your previous analysis (attempt ${version}) received the following feedback:

${feedbackSummary}

Please provide a revised analysis that addresses this feedback.
    `;
  }
}
```

### Conditional Feedback Display

Show feedback only when present:

```typescript
class ConditionalFeedbackBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    super({
      name: "ConditionalBot",
      schema: MySchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default",
      // Show feedback prompt only on revisions
      condition: (request: PromptNodeRequest<PTH>) => {
        return (request.args?._ff_version ?? 1) > 1;
      }
    });
  }
}
```

### Integration with ReviewableEntity

```typescript
// Entity that uses the bot
class FeedbackAwareEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
) {
  protected async get_bot_request_args_impl(preArgs: any) {
    // preArgs.args contains: _ff_feedback, _ff_previous_result, _ff_version
    return {
      input: this.dto.data.text,
      args: preArgs.args,  // Automatically includes feedback
      context: {}
    };
  }
}

// Workflow that orchestrates review loop
class ReviewWorkflow extends ReviewableEntity<AnalysisFeedback> {
  constructor(factory, idOrDto) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'FeedbackAwareEntity',
      reviewPrompt: 'Review the analysis and provide feedback',
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedAnalysis'
    });
  }
}
```

---

## WorkingMemoryBotMixin

The `WorkingMemoryBotMixin` enables bots to include context from the **Context Service** working memory. It automatically renders working memory items (files, images, data) as part of the prompt.

### How It Works

1. Caller provides `input_working_memory_paths` in request args
2. Mixin fetches content from Context Service
3. Content is rendered in the `data` section of the prompt
4. Supports images, code files, and structured data

### Configuration

```typescript
interface WMConfig {
  // Filter which paths to include
  filterPaths?: (paths: string[]) => string[];

  // Customize description for each path
  getDescription?: (path: string) => string;

  // Transform content by file extension
  contentTransformers?: {
    [extension: string]: (content: string) => string;
  };
}
```

### Basic Usage

```typescript
import { ComposeMixins, MixinBot, WorkingMemoryBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

class ContextAwareBot extends ComposeMixins(
  MixinBot,
  WorkingMemoryBotMixin
) {
  constructor() {
    const promptGroup = new PromptGroup([
      {
        name: 'system',
        prompt: new PromptTemplateStringOrStructNode({
          semantic_type: 'system',
          content: 'Analyze the provided files.'
        })
      }
    ]);

    super(
      // MixinBot config
      {
        name: "ContextAwareBot",
        base_prompt_group: promptGroup,
        model_pool_name: "default"
      },
      // WorkingMemoryBotMixin config
      {
        filterPaths: (paths) => paths.filter(p => p.endsWith('.ts')),
        getDescription: (path) => `File: ${path}`,
        contentTransformers: {
          ts: (content) => content.replace(/\/\*[\s\S]*?\*\//g, '')  // Strip comments
        }
      }
    );
  }
}
```

### Using in Bot Requests

```typescript
// When calling the bot, provide working memory paths
const result = await bot.main({
  input: { query: 'Analyze these source files' },
  args: {
    input_working_memory_paths: [
      'src/utils/helpers.ts',
      'src/components/Button.tsx',
      'docs/architecture.md'
    ]
  },
  context: {}
});
```

### With Entity Integration

```typescript
class FileAnalyzerEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
) {
  // Define bot with working memory
  protected get bot() {
    return new ContextAwareBot();  // Uses WorkingMemoryBotMixin
  }

  protected async get_bot_request_args_impl(preArgs: any) {
    const dto = await this.get_dto();

    return {
      input: { query: dto.data.query },
      args: {
        // Pass working memory paths from entity data
        input_working_memory_paths: dto.data.filePaths
      },
      context: {}
    };
  }
}
```

---

## Advanced Composition

### Combining All Mixins

```typescript
type ComprehensiveBotBTH = BotTypeHelper<ComprehensivePromptPTH>;

type FeedbackType = {
  clarity: 1 | 2 | 3 | 4 | 5;
  accuracy: 1 | 2 | 3 | 4 | 5;
  suggestions: string[];
};

class ComprehensiveBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin,
  FeedbackBotMixin,
  WorkingMemoryBotMixin
)<[
  typeof MixinBot,
  typeof StructuredOutputBotMixin,
  typeof DataValidationBotMixin,
  typeof FeedbackBotMixin,
  typeof WorkingMemoryBotMixin
]> {

  constructor() {
    // 1. System prompt
    const systemPrompt = new PromptTemplateStringOrStructNode({
      semantic_type: 'system',
      content: 'You are a comprehensive analysis bot with memory and feedback support.'
    });

    // 2. Memory context
    const memoryPrompt = new PromptTemplateSectionNode({
      semantic_type: 'context',
      content: 'Available Context: {memory}',
      children: [
        'Previous analyses: {memory.previous_analyses}',
        'User preferences: {memory.user_preferences}'
      ]
    });

    // 3. Feedback handling
    const feedbackPrompt = new PromptTemplateSectionNode({
      semantic_type: 'guidance',
      content: 'If revising ({_ff_version > 1}):',
      children: [
        'Previous result: {_ff_previous_result}',
        'Feedback: {_ff_feedback}',
        'Address all feedback points.'
      ]
    });

    // 4. Validation prompts (automatic from DataValidationBotMixin)

    const promptGroup = new PromptGroup([
      { name: 'system', prompt: systemPrompt },
      { name: 'memory', prompt: memoryPrompt },
      { name: 'feedback', prompt: feedbackPrompt },
      { name: 'input', prompt: new PromptInputText({}) }
    ]);

    super({
      name: "ComprehensiveBot",
      schema: MySchema,
      base_prompt_group: promptGroup,
      model_pool_name: "azure_completion_4o",
      // Feedback config
      feedbackPrompt: feedbackPrompt,
      // Validation config
      maxValidationRetries: 3
    });
  }
}
```

### Custom Mixin Composition Order

Order affects pre-phase execution:

```typescript
// Order 1: Validation first, then feedback
class ValidationFirstBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin,    // Pre-phase 2: Validates
  FeedbackBotMixin           // Pre-phase 3: Adds feedback after validation context
) { }

// Order 2: Feedback first, then validation
class FeedbackFirstBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin,          // Pre-phase 2: Adds feedback
  DataValidationBotMixin     // Pre-phase 3: Validates with feedback context
) { }
```

---

## Building Custom Mixins

### Mixin Structure

```typescript
// A mixin follows this pattern:
export class MyCustomMixin<
  ENH extends RunnableEntityTypeHelper<...>
> extends SomeBaseMixin<ENH> {

  // Constructor (usually no additional args needed)
  constructor() {
    super();
  }

  // Override pre-phase to inject capabilities
  protected override async get_pre_phase_args(): Promise<BotRequestArgs<...>> {
    const preArgs = await super.get_pre_phase_args();

    // Add your custom fields/logic
    preArgs.args = {
      ...preArgs.args,
      my_custom_field: 'value'
    };

    return preArgs;
  }

  // Optional: Override getCurrentInteractionPrompts to add prompts
  protected override getCurrentInteractionPrompts(): NamedPrompt[] {
    const parentPrompts = super.getCurrentInteractionPrompts();

    return [
      ...parentPrompts,
      {
        name: 'my_custom_prompt',
        prompt: new PromptTemplateStringOrStructNode({
          semantic_type: 'guidance',
          content: 'Custom prompt content'
        })
      }
    ];
  }
}
```

### Example: Rate Limiting Mixin

```typescript
interface RateLimitMixinConfig {
  maxCallsPerMinute: number;
  maxTokensPerHour: number;
}

export class RateLimitingMixin<
  BTH extends BotTypeHelper<...>
> extends MixinBot<BTH> {

  private callTimestamps: number[] = [];
  private tokenCount = 0;
  private config: RateLimitMixinConfig;

  constructor(config: RateLimitMixinConfig) {
    super();
    this.config = config;
  }

  protected override async get_pre_phase_args(): Promise<BotRequestArgs<BTH>> {
    const preArgs = await super.get_pre_phase_args();

    // Check rate limits
    this.enforceCallRateLimit();
    this.enforceTokenLimit();

    return preArgs;
  }

  private enforceCallRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old timestamps
    this.callTimestamps = this.callTimestamps.filter(t => t > oneMinuteAgo);

    if (this.callTimestamps.length >= this.config.maxCallsPerMinute) {
      throw new Error(`Rate limit exceeded: ${this.config.maxCallsPerMinute} calls per minute`);
    }

    this.callTimestamps.push(now);
  }

  private enforceTokenLimit() {
    if (this.tokenCount >= this.config.maxTokensPerHour) {
      throw new Error(`Token limit exceeded: ${this.config.maxTokensPerHour} tokens per hour`);
    }
  }
}
```

---

## Real-World Examples

### Example 1: Customer Service Bot with Full Stack

```typescript
interface CustomerQuery {
  customer_id: string;
  question: string;
}

interface ServiceResponse {
  answer: string;
  confidence: number;
  requires_escalation: boolean;
  suggested_actions: string[];
}

interface ServiceFeedback {
  helpful: boolean;
  accuracy_score: 1 | 2 | 3 | 4 | 5;
  missing_information: string[];
}

const serviceSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  requires_escalation: z.boolean(),
  suggested_actions: z.array(z.string())
});

// Full-featured bot
class CustomerServiceBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin,
  FeedbackBotMixin,
  WorkingMemoryBotMixin
) {
  constructor() {
    super({
      name: "CustomerServiceBot",
      schema: serviceSchema,
      base_prompt_group: buildServicePrompts(),
      model_pool_name: "azure_completion_4o",
      maxValidationRetries: 3
    });
  }
}

// Entity with full capabilities
class CustomerServiceEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin,
  WorkingMemoryBotMixin
) {

  protected async run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as CustomerQuery;

    // Load customer history from memory
    const memory = await this.getWorkingMemory();
    const customerHistory = await memory.getSlot(`customer:${data.customer_id}`);

    // Run bot with all capabilities
    const response = yield* this.run_bot_with_feedback_and_memory();

    // Update memory with this interaction
    await memory.updateSlot(`customer:${data.customer_id}`, {
      last_query: data.question,
      last_response: response,
      timestamp: new Date().toISOString()
    });

    return response;
  }
}

// Review workflow
class CustomerServiceReviewWorkflow extends ReviewableEntity<ServiceFeedback> {
  constructor(factory, idOrDto) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'CustomerServiceEntity',
      reviewPrompt: 'Review the customer service response for accuracy and helpfulness',
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedResponse',
      feedbackTransform: (raw: any) => ({
        helpful: raw.helpful ?? true,
        accuracy_score: raw.accuracy_score ?? 4,
        missing_information: raw.missing_information ?? []
      })
    });
  }
}
```

### Example 2: Data Quality Bot with Cascading Validation

```typescript
// Validates data with multiple levels of rigor
class DataQualityBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    super({
      name: "DataQualityBot",
      schema: QualityReportSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default",
      customValidators: {
        data_completeness: async (value) => {
          return value >= 0.8 || 'Data must be at least 80% complete';
        },
        anomaly_score: async (value) => {
          return value <= 0.3 || 'Anomaly score too high (max 0.3)';
        },
        format_compliance: async (value) => {
          const isCompliant = await checkFormatCompliance(value);
          return isCompliant || 'Format does not comply with standards';
        }
      },
      maxValidationRetries: 5
    });
  }
}
```

---

## Performance & Optimization

### Mixin Overhead

Each mixin adds a pre-phase cost:

```
MixinBot: ~50ms
+ StructuredOutputBotMixin: +75ms (JSON validation)
+ DataValidationBotMixin: +200ms (AI validation)
+ FeedbackBotMixin: +50ms (prompt addition)
+ WorkingMemoryBotMixin: +100ms (memory I/O)
────────────────────────────────
Total: ~475ms overhead before LLM call
```

### Optimization Strategies

1. **Selective Composition** - Only use mixins you need
   ```typescript
   // ❌ Don't: Use all mixins when you only need structured output
   class OverloadedBot extends ComposeMixins(
     MixinBot,
     StructuredOutputBotMixin,
     DataValidationBotMixin,
     FeedbackBotMixin,
     WorkingMemoryBotMixin
   ) { }

   // ✅ Do: Use only what you need
   class FocusedBot extends ComposeMixins(
     MixinBot,
     StructuredOutputBotMixin
   ) { }
   ```

2. **Cache Working Memory** - Don't re-fetch if unchanged
   ```typescript
   private memoryCache: any = null;
   private memoryCacheTime = 0;

   protected async getWorkingMemoryOptimized() {
     const now = Date.now();
     if (this.memoryCache && now - this.memoryCacheTime < 5000) {
       return this.memoryCache;  // Use cache if < 5 seconds old
     }

     this.memoryCache = await this.getWorkingMemory();
     this.memoryCacheTime = now;
     return this.memoryCache;
   }
   ```

3. **Batch Validation** - Validate multiple items at once
   ```typescript
   // ❌ Inefficient: Validate items individually
   for (const item of items) {
     const result = yield* this._dispatch('validate', { item });
   }

   // ✅ Efficient: Batch validate
   const result = yield* this._dispatch('validate_batch', { items });
   ```

4. **Conditional Mixin Usage** - Enable mixins based on configuration
   ```typescript
   function createBot(config: { useValidation: boolean; useMemory: boolean }) {
     const mixins = [MixinBot, StructuredOutputBotMixin];

     if (config.useValidation) {
       mixins.push(DataValidationBotMixin);
     }

     if (config.useMemory) {
       mixins.push(WorkingMemoryBotMixin);
     }

     return ComposeMixins(...mixins);
   }
   ```

---

## Summary

Advanced bot mixin patterns enable:

- **DataValidationBotMixin**: AI-powered validation and correction
- **FeedbackBotMixin**: Iterative feedback processing
- **WorkingMemoryBotMixin**: Persistent context sharing
- **Advanced Composition**: Combine multiple capabilities
- **Custom Mixins**: Build domain-specific functionality

Key takeaways:
1. Compose only the mixins you need (performance)
2. Order matters - mixins execute pre-phases in sequence
3. Use with ReviewableEntity for full feedback loops
4. Leverage WorkingMemoryBotMixin for multi-turn conversations
5. Build custom mixins for specialized needs

For more information on bot fundamentals, see [Bot Guide](../core/bots.md) and [Bot Tutorial](../core/bot_tutorial.md).
