# FireFoundry SDK v2.x → v3.0 Migration Guide

This guide helps you migrate code from FireFoundry Agent SDK v2.x to v3.0.0-beta.0, which introduces a **mixin-based composition architecture** in place of the previous inheritance-based approach.

## Overview of Changes

The fundamental shift in v3.0 is from **rigid class hierarchies** to **flexible mixin composition**:

| Aspect | v2.x (Inheritance) | v3.0 (Mixins) |
|--------|-------------------|---------------|
| **Bot Architecture** | Class hierarchy (`StructuredDataBot`, `BotChat`, etc.) | Mixin composition (`MixinBot` + mixins) |
| **Entity Capabilities** | Specific classes (`RunnableEntityClass`, `WaitableRunnableEntityClass`) | Pre-composed classes + `AddMixins()`/`ComposeMixins()` |
| **Composition** | Limited to predefined classes | Unlimited custom combinations |
| **Type Safety** | Type helpers provided | Enhanced type helpers with full generics |
| **Pattern** | "One class, one set of capabilities" | "Mix and match capabilities as needed" |

---

## Entity Pattern Migration

### v2.x: Class-Based Entities

```typescript
// v2.x - Using specific predefined classes
class MyEntity extends RunnableEntityClass<RETH> {
  // ...
}

class MyWaitableEntity extends WaitableRunnableEntityClass<RETH> {
  // ...
}
```

### v3.0: Mixin-Based Entities

```typescript
// v3.0 - Using pre-composed convenience classes
class MyEntity extends RunnableEntity<RETH> {
  // Equivalent to AddMixins(EntityNode, RunnableEntityMixin)
  // ...
}

class MyWaitableEntity extends WaitableRunnableEntity<RETH> {
  // Equivalent to AddMixins(RunnableEntity, WaitableRunnableEntityMixin)
  // ...
}

// Or compose your own combinations
class MyCustomEntity extends AddMixins(
  EntityNode,
  RunnableEntityMixin,
  WaitableRunnableEntityMixin,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[
  EntityNode,
  RunnableEntityMixin<RETH>,
  WaitableRunnableEntityMixin<RETH>,
  BotRunnableEntityMixin<RETH>,
  FeedbackRunnableEntityMixin<RETH>
]> {
  // Custom combination of capabilities
}
```

### Class Mapping

| v2.x | v3.0 | Notes |
|------|------|-------|
| `RunnableEntityClass<RETH>` | `RunnableEntity<RETH>` | Pre-composed; use `AddMixins(EntityNode, RunnableEntityMixin)` for custom |
| `WaitableRunnableEntityClass<RETH>` | `WaitableRunnableEntity<RETH>` | Pre-composed; or `AddMixins(..., WaitableRunnableEntityMixin)` |
| `@RunnableEntityDecorator` | `@RunnableEntity` OR `AddMixins(..., RunnableEntityMixin)` | Use decorator or composition |
| `@RunnableEntityBotWrapperDecorator` | `@RunnableEntity` + `BotRunnableEntityMixin` | Combine decorators and mixins |
| (N/A) | `ReviewableEntity<FeedbackType>` | **NEW**: Human-in-the-loop review workflows |

---

## Bot Pattern Migration

### v2.x: Inheritance-Based Bot Classes

```typescript
// v2.x - Using specific predefined bot classes
class MyBot extends StructuredDataBot<BTH> {
  // Includes: structured output, schema validation, error handling
  constructor() {
    super({
      schema: MySchema,
      // ...
    });
  }
}

// Different class for different capabilities
class ChatBot extends BotChat<BTH> {
  // Different architecture, different capabilities
}
```

### v3.0: Mixin-Based Bot Composition

```typescript
// v3.0 - Compose only the capabilities you need
class MyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) {
  constructor() {
    super({
      name: "MyBot",
      schema: MySchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default"
    });
  }
}

// Add more capabilities by composing more mixins
class SmartBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin,
  FeedbackBotMixin
) {
  // Now includes: structured output, data validation, feedback handling
}

// No separate classes needed - just different mixin combinations
```

### Class Mapping

| v2.x | v3.0 | Replacement Pattern |
|------|------|-------------------|
| `StructuredDataBot<BTH>` | (Removed) | `ComposeMixins(MixinBot, StructuredOutputBotMixin)` |
| `BotChat<BTH>` | (Removed) | `ComposeMixins(MixinBot, ...) + custom prompting` |
| `Bot<BTH>` | `MixinBot<BTH>` | Base bot class (no mixins) |

### Bot Mixin Reference

The following mixins provide specific capabilities:

```typescript
// Structured output with Zod schema validation
class MyStructuredBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) { }

// Data validation with AI-powered correction
class MyValidatingBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
) { }

// Feedback processing for iterative refinement
class MyFeedbackBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) { }

// Working memory integration
class MyMemoryBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  WorkingMemoryBotMixin
) { }

// Combine multiple capabilities
class MyCompleteBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin,
  FeedbackBotMixin
) { }
```

---

## Common Migration Patterns

### Pattern 1: Simple Runnable Entity

**v2.x**
```typescript
class AnalysisStep extends RunnableEntityClass<AnalysisRETH> {
  protected async run_impl(request: EntityRequest<any>) {
    // Logic here
  }
}
```

**v3.0**
```typescript
class AnalysisStep extends RunnableEntity<AnalysisRETH> {
  protected async run_impl(request: EntityRequest<any>) {
    // Same logic
  }
}
```

### Pattern 2: Entity with Bot

**v2.x**
```typescript
class AnalysisBotStep extends RunnableEntityClass<RETH>
  implements IBotWrapper<MyBot> {
  protected async run_impl(request: EntityRequest<any>) {
    const bot = new MyBot();
    const response = await bot.run(botRequest);
    return response;
  }
}
```

**v3.0**
```typescript
class AnalysisBotStep extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[AnalysisRETH, BotRunnableEntityMixin<AnalysisRETH>]> {
  protected async get_bot_request_args_impl(): Promise<BotRequestArgs<MyBTH>> {
    return { input: "...", args: {} };
  }
}
```

### Pattern 3: Waitable Entity (Human Input)

**v2.x**
```typescript
class ReviewStep extends WaitableRunnableEntityClass<RETH> {
  protected async run_impl(request: EntityRequest<any>) {
    yield await createWaitingEnvelope("waiting for review");
    // Process message
  }
}
```

**v3.0**
```typescript
class ReviewStep extends AddMixins(
  RunnableEntity,
  WaitableRunnableEntityMixin
)<[RETH, WaitableRunnableEntityMixin<RETH>]> {
  protected async run_impl(request: EntityRequest<any>) {
    yield await createWaitingEnvelope("waiting for review");
    // Process message
  }
}

// Or use the pre-composed convenience class
class ReviewStep extends WaitableRunnableEntity<RETH> {
  // Same implementation
}
```

### Pattern 4: Structured Output Bot

**v2.x**
```typescript
import { StructuredDataBot, StructuredDataBotConfig } from '@firebrandanalytics/ff-agent-sdk/bot';

class SummaryBot extends StructuredDataBot<SummaryBTH> {
  constructor() {
    super({
      schema: SummarySchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default"
    });
  }
}
```

**v3.0**
```typescript
import { ComposeMixins, MixinBot, StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

class SummaryBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) {
  constructor() {
    super({
      name: "SummaryBot",
      schema: SummarySchema,
      base_prompt_group: promptGroup,
      model_pool_name: "default"
    });
  }
}
```

### Pattern 5: Entity with Feedback (NEW in v3.0)

**v2.x**
```typescript
// Not directly supported - would require custom implementation
```

**v3.0**
```typescript
// Automatic feedback injection
class FeedbackAwareEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[RETH, BotRunnableEntityMixin<RETH>, FeedbackRunnableEntityMixin<RETH, MyFeedback>]> {
  protected async get_bot_request_args_impl(preArgs: any) {
    // preArgs.args automatically contains: _ff_feedback, _ff_previous_result, _ff_version
    return { input: "...", args: preArgs.args };
  }
}

// Use with ReviewableEntity for full feedback loops
class ReviewWorkflow extends ReviewableEntity<MyFeedback> {
  constructor(factory, idOrDto) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'FeedbackAwareEntity',
      reviewPrompt: 'Please review...'
    });
  }
}
```

---

## Type Helper Migration

### Entity Type Helpers

**v2.x**
```typescript
type MyRETH = RunnableEntityTypeHelper<
  InputType,
  OutputType,
  AdditionalType1,
  AdditionalType2
>;
```

**v3.0** - No changes, same usage:
```typescript
type MyRETH = RunnableEntityTypeHelper<
  InputType,
  OutputType,
  AdditionalType1,
  AdditionalType2
>;
```

### Bot Type Helpers

**v2.x**
```typescript
type MyBTH = BotTypeHelper<PromptTypeHelper>;
```

**v3.0** - No changes, same usage:
```typescript
type MyBTH = BotTypeHelper<PromptTypeHelper>;
```

---

## Imports Migration

### Entity Imports

**v2.x**
```typescript
import {
  RunnableEntityClass,
  WaitableRunnableEntityClass,
  EntityNode
} from '@firebrandanalytics/ff-agent-sdk/entity';
```

**v3.0**
```typescript
import {
  EntityNode,
  RunnableEntity,                      // Pre-composed convenience class
  WaitableRunnableEntity,              // Pre-composed convenience class
  AddMixins,
  ComposeMixins,
  RunnableEntityMixin,                 // For custom composition
  WaitableRunnableEntityMixin,         // For custom composition
  BotRunnableEntityMixin,              // For bot integration
  FeedbackRunnableEntityMixin          // For feedback workflows (NEW)
} from '@firebrandanalytics/ff-agent-sdk/entity';
```

### Bot Imports

**v2.x**
```typescript
import {
  Bot,
  StructuredDataBot,
  BotChat,
  BotRequest,
  BotTypeHelper
} from '@firebrandanalytics/ff-agent-sdk/bot';
```

**v3.0**
```typescript
import {
  MixinBot,
  ComposeMixins,
  StructuredOutputBotMixin,            // For structured output
  DataValidationBotMixin,              // For validation (NEW)
  FeedbackBotMixin,                    // For feedback processing (NEW)
  WorkingMemoryBotMixin,               // For memory integration (NEW)
  BotRequest,
  BotTypeHelper
} from '@firebrandanalytics/ff-agent-sdk/bot';
```

---

## New v3.0 Features

### 1. Review Workflows (NEW)

```typescript
// Complete human-in-the-loop system not available in v2.x
interface ReviewerFeedback {
  approved: boolean;
  notes: string;
}

class MyReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  constructor(factory, idOrDto) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'AnalysisStep',
      reviewPrompt: 'Please review the analysis',
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedAnalysis'
    });
  }
}
```

See: [Review Workflows Guide](feature_guides/review-workflows.md)

### 2. Bot/Prompt Registration (NEW)

```typescript
import { registerBot, registerPrompt } from '@firebrandanalytics/ff-agent-sdk/registry';

@registerBot({
  name: 'MyBot',
  version: '1.0.0',
  category: 'analysis'
})
export class MyBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) { }

@registerPrompt({
  name: 'MyPrompt',
  version: '1.0.0',
  category: 'analysis'
})
export class MyPrompt extends Prompt<PTH> { }
```

See: [Bot & Prompt Registration Guide](feature_guides/bot-prompt-registration.md)

### 3. Data Validation Framework (Enhanced)

```typescript
// More powerful decorator system for data transformation
class ContactInfo {
  @JSONPath('$.personal.email')
  @NormalizeText('email')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  email: string;

  @CoerceType('number')
  @ValidateRange(0, 150)
  age: number;

  @If((val) => this.email.endsWith('.com'))
    @AITransform('Convert to formal tone')
  @EndIf()
  message: string;
}

const validated = await new ValidationFactory().create(ContactInfo, rawData);
```

See: [Data Validation Framework Guide](feature_guides/data-validation-framework.md)

---

## Breaking Changes Checklist

When migrating from v2.x to v3.0:

- [ ] Replace `RunnableEntityClass` with `RunnableEntity` or custom `AddMixins(...)`
- [ ] Replace `WaitableRunnableEntityClass` with `WaitableRunnableEntity` or custom `AddMixins(...)`
- [ ] Replace `StructuredDataBot` with `ComposeMixins(MixinBot, StructuredOutputBotMixin)`
- [ ] Remove any imports of `BotChat` - compose capabilities instead
- [ ] Update decorators: `@RunnableEntityBotWrapperDecorator` → `@RunnableEntity` + `BotRunnableEntityMixin`
- [ ] Update imports to use new mixin names
- [ ] Update type parameter syntax if using custom compositions
- [ ] Test entity composition patterns work with new AddMixins/ComposeMixins utilities
- [ ] Review any custom bot classes - consider if mixin composition is more flexible
- [ ] Check for any interfaces that may have changed

---

## Gradual Migration Strategy

You don't need to migrate everything at once. Consider this approach:

1. **Phase 1**: Understand mixin patterns (read this guide + [Mixins & Composition](../utils/mixins.md))
2. **Phase 2**: Migrate new code to v3.0 patterns
3. **Phase 3**: Incrementally update existing entities and bots as you touch them
4. **Phase 4**: Review workflow integration - add feedback loops where appropriate
5. **Phase 5**: Take advantage of new features (registration, enhanced validation)

---

## Troubleshooting

### "Cannot find module or its corresponding type declarations"

**Issue**: Old imports don't work

**Solution**:
```typescript
// v2.x (OLD)
import { RunnableEntityClass } from '@firebrandanalytics/ff-agent-sdk/entity';

// v3.0 (NEW)
import { RunnableEntity, AddMixins } from '@firebrandanalytics/ff-agent-sdk/entity';
```

### "Type '[...] has no matching constructor signature"

**Issue**: Mixin composition type parameters are incorrect

**Solution**: Ensure the type parameter tuple matches the mixins passed:
```typescript
class MyEntity extends AddMixins(
  EntityNode,           // [0]
  RunnableEntityMixin,  // [1]
  BotRunnableEntityMixin // [2]
)<[
  EntityNode,
  RunnableEntityMixin<RETH>,
  BotRunnableEntityMixin<RETH>
]> {
  // Now type-safe
}
```

### "Feedback context not appearing in bot requests"

**Issue**: FeedbackRunnableEntityMixin not injecting fields

**Solution**: Ensure order is correct (FeedbackRunnableEntityMixin after BotRunnableEntityMixin):
```typescript
// CORRECT ORDER
class MyEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,        // First
  FeedbackRunnableEntityMixin    // After - its pre-phase runs after bot phase
) { }
```

---

## Additional Resources

- **[Mixins & Composition](../utils/mixins.md)** - Deep dive into `AddMixins` and `ComposeMixins`
- **[Bot Tutorial](core/bot_tutorial.md)** - Updated for v3.0 with mixin patterns
- **[Entities Guide](core/entities.md)** - Updated entity patterns and architecture
- **[Review Workflows](feature_guides/review-workflows.md)** - New v3.0 feature for feedback loops
- **[Bot & Prompt Registration](feature_guides/bot-prompt-registration.md)** - New v3.0 feature for metadata

---

## Summary

| Component | v2.x Approach | v3.0 Approach | Benefit |
|-----------|--------------|---------------|---------|
| Entities | Specific classes | Mixin composition | Unlimited custom combinations |
| Bots | Class hierarchy | Mixin composition | Only pay for capabilities you use |
| Feedback | Custom implementation | ReviewableEntity + FeedbackRunnableEntityMixin | Built-in iterative loops |
| Registration | Manual | @registerBot/@registerPrompt decorators | Automatic metadata management |
| Validation | Limited | 50+ decorators + AI-powered | Powerful data transformation |
| Type Safety | Good | Enhanced | Better compile-time checking |

The core paradigm remains the same - **entities are persistent structures, bots are stateless behavior** - but v3.0 makes composition more flexible and powerful.
