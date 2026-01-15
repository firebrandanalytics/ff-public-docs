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

    // Additional validation with the validation library
    const factory = new ValidationFactory();
    const validated = await factory.create(OrderOutput, botResponse);

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

class CustomerEntity extends RunnableEntity<CustomerRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Normalize input before processing
    const factory = new ValidationFactory();
    const cleanInput = await factory.create(CustomerInput, dto.data);

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

## Pattern 4: AI-Powered Validation with Bots

Combine AI decorators from the validation library with bot processing:

```typescript
import { ValidationFactory, AITransform, AIValidate } from '@firebrandanalytics/shared-utils';

// Define class with AI-powered transformations
class EnhancedOutput {
  @Copy()
  summary: string;

  @AITransform('Improve the writing quality and clarity of this text')
  improved_summary: string;

  @AIValidate('Verify this contains no factual errors')
  fact_checked: boolean;
}

class EnhancingEntity extends AddMixins(RunnableEntity, BotRunnableEntityMixin) {
  protected async *run_impl() {
    // Get initial bot output
    const botResponse = yield* this.run_bot();

    // Enhance with AI validation decorators
    const factory = new ValidationFactory({
      aiHandler: async (prompt, value) => {
        // Use your LLM to process AI decorators
        return await this.callLLM(prompt, value);
      }
    });

    const enhanced = await factory.create(EnhancedOutput, {
      summary: botResponse.summary
    });

    return enhanced;
  }
}
```

---

## Pattern 5: Conditional Validation in Workflows

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

class WorkflowEntity extends RunnableEntity<WorkflowRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const status = dto.data.is_approved ? 'final' : 'draft';

    const factory = new ValidationFactory();
    const validated = await factory.create(ConditionalOutput, {
      status,
      content: dto.data.content,
      approval_notes: dto.data.approval_notes
    });

    return validated;
  }
}
```

---

## Pattern 6: Batch Validation in Parallel Workflows

Validate multiple items efficiently:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils';

class BatchProcessingEntity extends RunnableEntity<BatchRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const items = dto.data.items as any[];

    const factory = new ValidationFactory();

    // Validate all items in parallel
    const validatedItems = await Promise.all(
      items.map(item => factory.create(ItemOutput, item))
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

### 1. Use Zod for Structure, Validation Library for Transformation

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

### 2. Create Reusable Validation Classes

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

### 3. Handle Validation Errors Gracefully

```typescript
class RobustEntity extends RunnableEntity {
  protected async *run_impl() {
    const factory = new ValidationFactory();

    try {
      const validated = await factory.create(MyOutput, rawData);
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
4. **AI decorators** - Combine with bot LLM calls
5. **Conditional validation** - Based on entity state
6. **Batch validation** - Parallel processing

For complete decorator reference and advanced patterns, see:
- **[Validation Library - Getting Started](../../utils/validation-library-getting-started.md)**
- **[Validation Library - Intermediate](../../utils/validation-library-intermediate.md)**
- **[Validation Library - Complete Reference](../../utils/validation-library-reference.md)**
