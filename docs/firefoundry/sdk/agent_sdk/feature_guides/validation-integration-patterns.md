# Validation Library Integration Patterns

This guide shows how to integrate the FireFoundry Data Validation Library with Agent SDK bots and entities. For comprehensive validation library documentation, see the [Validation Library Reference](../../utils/validation-library-reference.md).

## Quick Links

- **[Validation Library - Getting Started](../../utils/validation-library-getting-started.md)** - Core concepts and basic usage
- **[Validation Library - Intermediate](../../utils/validation-library-intermediate.md)** - Advanced patterns and AI transformations
- **[Validation Library - Complete Reference](../../utils/validation-library-reference.md)** - Full API reference for all decorators

---

## Overview

The Data Validation Library (`@firebrandanalytics/shared-utils`) is a standalone library that can be used with or without the Agent SDK. This guide focuses specifically on **integration patterns** when using validation with bots and entities.

### Why Integrate?

- **Post-process bot outputs** - Validate and transform LLM responses
- **Pre-process entity inputs** - Clean and normalize data before processing
- **AI-powered correction** - Use validation decorators with LLM fallback
- **Type safety** - Ensure bot outputs match expected schemas

---

## Pattern 1: Validating Bot Output

Use the validation library to post-process bot responses:

```typescript
import { ValidationFactory, CoerceType, ValidateRequired } from '@firebrandanalytics/shared-utils';
import { ComposeMixins, MixinBot, StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

// Define validated output class
class OrderOutput {
  @ValidateRequired()
  order_id: string;

  @CoerceType('number')
  @ValidateRange(0, Infinity)
  total_amount: number;

  @ValidateRequired()
  customer_name: string;
}

// Create factory once at module level - reuse across all validations
const validationFactory = new ValidationFactory();

// Bot that produces structured output
class OrderBot extends ComposeMixins(MixinBot, StructuredOutputBotMixin) {
  constructor() {
    super({
      name: "OrderBot",
      schema: OrderSchema,  // Zod schema for initial validation
      base_prompt_group: promptGroup,
      model_pool_name: "default"
    });
  }
}

// Entity that runs bot and validates output
class OrderProcessingEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
) {
  protected async *run_impl() {
    // Run bot
    const botResponse = yield* this.run_bot();

    // Additional validation with the shared factory
    const validated = await validationFactory.create(OrderOutput, botResponse);

    return validated;
  }
}
```

---

## Pattern 2: Pre-Processing Entity Input

Clean and normalize data before entity processing:

```typescript
import { ValidationFactory, Copy, CoerceTrim, NormalizeText } from '@firebrandanalytics/shared-utils';

// Define input normalization class
class CustomerInput {
  @Copy()
  @CoerceTrim()
  name: string;

  @Copy()
  @NormalizeText('email')
  email: string;

  @Copy()
  @NormalizeText('phone-formatted')
  phone: string;
}

// Create factory once at module level
const validationFactory = new ValidationFactory();

class CustomerEntity extends RunnableEntity<CustomerRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Normalize input using the shared factory
    const cleanInput = await validationFactory.create(CustomerInput, dto.data);

    // Now process with clean data
    const result = await processCustomer(cleanInput);

    return result;
  }
}
```

---

## Pattern 3: DataValidationBotMixin

The `DataValidationBotMixin` combines bot execution with validation library capabilities:

```typescript
import { ComposeMixins, MixinBot, StructuredOutputBotMixin, DataValidationBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

class ValidatingBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    super({
      name: "ValidatingBot",
      schema: OutputSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default",
      // DataValidationBotMixin config
      maxValidationRetries: 3,
      customValidators: {
        email: async (value) => {
          const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
          return isValid || 'Invalid email format';
        }
      }
    });
  }
}
```

The mixin automatically:
- Validates bot output against custom validators
- Re-prompts the LLM if validation fails
- Retries up to `maxValidationRetries` times

---

## Pattern 4: Registering AI Validation Handlers

The validation library provides two decorator types for AI-powered processing:
- **`@AITransform`** - Transforms values using an LLM (returns the transformed value)
- **`@AIValidate`** - Validates values using an LLM (returns true/false/error)

Both require a registered handler to execute the AI calls.

### Handler Types

```typescript
import { AIHandler, AIValidationHandler, AIHandlerParams } from '@firebrandanalytics/shared-utils';

// AIHandler: For @AITransform - returns transformed value
type AIHandler = (
  params: AIHandlerParams,
  prompt: string | object
) => Promise<any>;

// AIValidationHandler: For @AIValidate - returns true if valid, or error message
type AIValidationHandler = (
  params: AIHandlerParams,
  prompt: string | object
) => Promise<boolean | string | Error>;
```

### AIHandlerParams Interface

The handler receives detailed context about the validation:

```typescript
interface AIHandlerParams {
  value: any;              // Current value of the property
  instance: object;        // The entire object being validated
  context: any;            // Validation context passed to factory.create()
  propertyKey: string;     // Property name being validated
  className: string;       // Class name for debugging
  previousError?: Error;   // Error from previous attempt (if retry)
  attemptNumber: number;   // Current attempt (1-indexed)
  maxRetries: number;      // Max retries configured in decorator
  metadata: any;           // Arbitrary metadata from decorator options
  schema?: any;            // Auto-generated Zod schema (if available)
}
```

### Registering Handlers Globally

Register handlers when creating the `ValidationFactory`:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils';

const factory = new ValidationFactory({
  // Handler for @AITransform decorators
  aiHandler: async (params, prompt) => {
    console.log(`Transforming ${params.propertyKey} (attempt ${params.attemptNumber})`);

    // Call your LLM
    const response = await myLLM.complete({
      prompt: typeof prompt === 'string' ? prompt : prompt.toString(),
      temperature: 0.1
    });

    return response.text;
  },

  // Handler for @AIValidate decorators
  aiValidationHandler: async (params, prompt) => {
    const response = await myLLM.complete({
      prompt: typeof prompt === 'string' ? prompt : prompt.toString(),
      temperature: 0
    });

    // Return true if valid, or error message if not
    if (response.text.toLowerCase().includes('valid')) {
      return true;
    }
    return `Validation failed: ${response.text}`;
  }
});
```

### Registering Handlers Per-Request

Override handlers for specific validation calls:

```typescript
// Global factory with default handlers
const factory = new ValidationFactory({
  aiHandler: defaultHandler,
  aiValidationHandler: defaultValidationHandler
});

// Override for a specific call
const result = await factory.create(MyClass, data, {
  context: { userId: '123' },

  // Use a different handler for this call
  aiHandler: async (params, prompt) => {
    // Custom logic for this specific validation
    return await specializedLLM.complete(prompt);
  }
});
```

---

## Pattern 5: AI Validation via Broker Request

Send AI validations through the FF Broker for centralized model routing:

```typescript
import { ValidationFactory, AITransform, AIValidate } from '@firebrandanalytics/shared-utils';
import { BrokerClient } from '@firebrandanalytics/ff-agent-sdk/client';

// Create broker client
const brokerClient = new BrokerClient({
  endpoint: 'http://ff-broker:50061'
});

// Define class with AI decorators
class ContentAnalysis {
  @Copy()
  rawText: string;

  @AITransform(
    (params) => `Summarize this text in 2-3 sentences:\n\n${params.value}`,
    { metadata: { model: 'gpt-4o', temperature: 0.3 } }
  )
  summary: string;

  @AIValidate(
    (params) => `Is this summary accurate and factual? Answer YES or NO with explanation:\n\nOriginal: ${params.instance.rawText}\n\nSummary: ${params.value}`,
    { metadata: { model: 'gpt-4o-mini' } }
  )
  summaryValidated: boolean;
}

// Create factory with broker-based handlers
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // Use metadata to select model
    const model = params.metadata?.model ?? 'gpt-4o-mini';
    const temperature = params.metadata?.temperature ?? 0.1;

    const response = await brokerClient.complete({
      model_pool_name: model,
      messages: [
        { role: 'user', content: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) }
      ],
      temperature,
      max_tokens: 500
    });

    return response.choices[0].message.content;
  },

  aiValidationHandler: async (params, prompt) => {
    const model = params.metadata?.model ?? 'gpt-4o-mini';

    const response = await brokerClient.complete({
      model_pool_name: model,
      messages: [
        { role: 'user', content: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) }
      ],
      temperature: 0,
      max_tokens: 100
    });

    const answer = response.choices[0].message.content.trim().toUpperCase();
    if (answer.startsWith('YES')) {
      return true;
    }
    return `Validation failed: ${response.choices[0].message.content}`;
  }
});

// Use in an entity
class AnalysisEntity extends RunnableEntity {
  protected async *run_impl() {
    const dto = await this.get_dto();

    const analyzed = await factory.create(ContentAnalysis, {
      rawText: dto.data.text
    });

    return analyzed;
  }
}
```

---

## Pattern 6: AI Validation via Bot

Use a dedicated bot for AI validation processing:

```typescript
import { ValidationFactory, AITransform } from '@firebrandanalytics/shared-utils';
import { Bot, BotRequest } from '@firebrandanalytics/ff-agent-sdk/bot';

// Create a simple transformation bot
class TransformationBot extends Bot<TransformBTH> {
  constructor() {
    super({
      name: 'TransformationBot',
      base_prompt_group: new PromptGroup([
        {
          name: 'transform',
          prompt: new TransformPrompt()
        }
      ]),
      model_pool_name: 'azure_completion_4o'
    });
  }
}

const transformBot = new TransformationBot();

// Create factory that uses the bot for AI operations
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    const request = new BotRequest({
      id: `transform-${params.propertyKey}-${Date.now()}`,
      args: {
        instruction: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
        value: params.value
      },
      input: {}
    });

    const response = await transformBot.run(request);
    return response.output.result;
  }
});
```

---

## Pattern 7: DataValidationBotMixin with AI Handlers

The `DataValidationBotMixin` integrates validation directly into bot execution:

```typescript
import {
  ComposeMixins,
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
} from '@firebrandanalytics/ff-agent-sdk/bot';
import {
  ValidationFactory,
  CoerceTrim,
  AITransform,
  ValidateRequired
} from '@firebrandanalytics/shared-utils';

// Define validated output class with AI decorators
class OrderOutput {
  @CoerceTrim()
  @ValidateRequired()
  customer_name: string;

  @AITransform(
    (params) => `Normalize this product name to our catalog format: ${params.value}`,
    { maxRetries: 2 }
  )
  product_name: string;

  @ValidateRange(1, 1000)
  quantity: number;
}

// Create a factory with AI handlers
const validationFactory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // This handler will be called when @AITransform is processed
    const response = await brokerClient.complete({
      model_pool_name: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt as string }],
      temperature: 0.1
    });
    return response.choices[0].message.content;
  }
});

// Bot with integrated validation
class OrderBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) {
  constructor() {
    super(
      // MixinBot config
      [{
        name: 'OrderBot',
        base_prompt_group: orderPromptGroup,
        model_pool_name: 'azure_completion_4o'
      }],
      // StructuredOutputBotMixin config
      [{
        schema: OrderSchema,
        struct_data_language: 'json'
      }],
      // DataValidationBotMixin config
      [{
        validatedClass: OrderOutput,
        validationFactory,  // Factory with AI handlers
        validationOptions: {
          engine: 'convergent',
          maxIterations: 10
        }
      }]
    );
  }
}
```

### How It Works

1. **LLM produces output** → Zod schema validates structure
2. **DataValidationBotMixin** → Transforms output using `ValidationFactory`
3. **@AITransform decorators** → Call the registered `aiHandler`
4. **Validation errors** → Bot retries with error feedback
5. **Success** → Returns validated class instance

---

## Pattern 8: Dynamic Prompts with Context

Use lambda prompts that access validation context and other properties:

```typescript
import { AITransform, Copy } from '@firebrandanalytics/shared-utils';

interface TranslationContext {
  targetLanguage: string;
  glossary: Record<string, string>;
}

class TranslatedContent {
  @Copy()
  originalText: string;

  @AITransform(
    (params) => {
      const ctx = params.context as TranslationContext;
      const glossaryHint = Object.entries(ctx.glossary)
        .map(([term, translation]) => `${term} → ${translation}`)
        .join('\n');

      return `Translate to ${ctx.targetLanguage}. Use this glossary:\n${glossaryHint}\n\nText: ${params.value}`;
    },
    {
      dependsOn: ['originalText'],  // Re-run if originalText changes
      metadata: { model: 'gpt-4o' }
    }
  )
  translatedText: string;
}

// Usage with context
const factory = new ValidationFactory({ aiHandler: myHandler });

const result = await factory.create(TranslatedContent,
  { originalText: 'Hello world', translatedText: 'Hello world' },
  {
    context: {
      targetLanguage: 'Spanish',
      glossary: { 'Hello': 'Hola', 'world': 'mundo' }
    }
  }
);
```

---

## Pattern 9: Retry Logic with Previous Error

AI handlers receive previous error context for intelligent retries:

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    let enhancedPrompt = prompt as string;

    // If this is a retry, include the previous error
    if (params.previousError && params.attemptNumber > 1) {
      enhancedPrompt = `${prompt}\n\nPrevious attempt failed with: ${params.previousError.message}\n\nPlease fix the issue and try again.`;
    }

    console.log(`Attempt ${params.attemptNumber}/${params.maxRetries} for ${params.propertyKey}`);

    const response = await llm.complete(enhancedPrompt);
    return response;
  }
});

// Class with retry configuration
class RobustOutput {
  @AITransform(
    'Format as valid JSON: {{value}}',
    { maxRetries: 3 }  // Will retry up to 3 times
  )
  @ValidateJSON()  // Must pass JSON validation after transform
  data: object;
}
```

---

## Pattern 10: Conditional Validation in Workflows

Use validation conditionally based on entity state:

```typescript
import { ValidationFactory, If, Else, EndIf, ValidateRequired } from '@firebrandanalytics/shared-utils';

class ConditionalOutput {
  @Copy()
  status: 'draft' | 'final';

  @Copy()
  content: string;

  // Only require approval_notes if status is 'final'
  @If('status', 'final')
    @ValidateRequired()
  @Else()
    @Set(null)
  @EndIf()
  approval_notes: string | null;
}

// Create factory once at module level
const validationFactory = new ValidationFactory();

class WorkflowEntity extends RunnableEntity<WorkflowRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const status = dto.data.is_approved ? 'final' : 'draft';

    const validated = await validationFactory.create(ConditionalOutput, {
      status,
      content: dto.data.content,
      approval_notes: dto.data.approval_notes
    });

    return validated;
  }
}
```

---

## Pattern 11: Batch Validation in Parallel Workflows

Validate multiple items efficiently:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils';

// Create factory once at module level
const validationFactory = new ValidationFactory();

class BatchProcessingEntity extends RunnableEntity<BatchRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const items = dto.data.items as any[];

    // Validate all items in parallel using the shared factory
    const validatedItems = await Promise.all(
      items.map(item => validationFactory.create(ItemOutput, item))
    );

    // Filter out any that failed validation
    const successfulItems = validatedItems.filter(item => item !== null);

    return {
      processed: successfulItems.length,
      failed: items.length - successfulItems.length,
      results: successfulItems
    };
  }
}
```

---

## Best Practices

### 1. Create Factory Once, Reuse Everywhere

The `ValidationFactory` is designed to be instantiated once and reused across all validation calls. Creating a new factory per request adds unnecessary overhead.

```typescript
// ✅ CORRECT: Create factory once at module level
const validationFactory = new ValidationFactory({
  aiHandler: myAIHandler,
  aiValidationHandler: myValidationHandler
});

class MyEntity extends RunnableEntity {
  protected async *run_impl() {
    // Reuse the shared factory
    const result = await validationFactory.create(MyClass, data);
    return result;
  }
}

// ❌ AVOID: Creating factory per request
class BadEntity extends RunnableEntity {
  protected async *run_impl() {
    // Don't do this - unnecessary overhead
    const factory = new ValidationFactory();
    const result = await factory.create(MyClass, data);
    return result;
  }
}
```

For applications with multiple validation configurations, create named factory instances:

```typescript
// Multiple factories for different use cases
export const basicFactory = new ValidationFactory();

export const aiFactory = new ValidationFactory({
  aiHandler: brokerBasedHandler,
  aiValidationHandler: brokerBasedValidator
});

export const strictFactory = new ValidationFactory({
  throwOnError: true,
  collectAllErrors: true
});
```

### 2. Use Zod for Structure, Validation Library for Transformation

```typescript
// Zod: Define structure and basic constraints
const OutputSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0)
});

// Validation Library: Transform and normalize
class NormalizedOutput {
  @CoerceTrim()
  name: string;

  @NormalizeText('email')
  email: string;

  @CoerceType('number')
  age: number;
}

// Use both together
class MyBot extends ComposeMixins(MixinBot, StructuredOutputBotMixin) {
  // Zod validates structure
}

class MyEntity extends RunnableEntity {
  protected async *run_impl() {
    const botOutput = yield* this.run_bot();  // Zod-validated
    const normalized = await factory.create(NormalizedOutput, botOutput);  // Transformed
    return normalized;
  }
}
```

### 3. Create Reusable Validation Classes

```typescript
// Define once, reuse across entities
class StandardContactInfo {
  @NormalizeText('email')
  email: string;

  @NormalizeText('phone-formatted')
  phone: string;

  @CoerceTrim()
  name: string;
}

// Use in multiple entities
class Entity1 extends RunnableEntity {
  // Uses StandardContactInfo
}

class Entity2 extends RunnableEntity {
  // Also uses StandardContactInfo
}
```

### 4. Handle Validation Errors Gracefully

```typescript
// Create factory once at module level
const validationFactory = new ValidationFactory();

class RobustEntity extends RunnableEntity {
  protected async *run_impl() {
    try {
      const validated = await validationFactory.create(MyOutput, rawData);
      return { status: 'success', data: validated };
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          status: 'validation_failed',
          errors: error.errors,
          original_data: rawData
        };
      }
      throw error;
    }
  }
}
```

---

## Summary

The validation library integrates with Agent SDK through:

1. **Post-processing bot outputs** - Validate and transform LLM responses
2. **Pre-processing inputs** - Normalize data before entity processing
3. **DataValidationBotMixin** - Built-in validation with retry
4. **AI validation handlers** - Register handlers for `@AITransform` and `@AIValidate` decorators
5. **Broker integration** - Route AI validations through FF Broker for model routing
6. **Bot-based AI handlers** - Use dedicated bots for AI validation processing
7. **Dynamic prompts** - Access full validation context in prompts
8. **Retry with error context** - Intelligent retries using previous error information
9. **Conditional validation** - Based on entity state
10. **Batch validation** - Parallel processing

For complete decorator reference and advanced patterns, see:
- **[Validation Library - Getting Started](../../utils/validation-library-getting-started.md)**
- **[Validation Library - Intermediate](../../utils/validation-library-intermediate.md)**
- **[Validation Library - Complete Reference](../../utils/validation-library-reference.md)**
