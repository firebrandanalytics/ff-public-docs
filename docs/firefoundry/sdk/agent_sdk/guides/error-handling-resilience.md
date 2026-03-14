# Error Handling & Resilience Patterns

This guide covers how errors propagate through FireFoundry agent bundles and the patterns available for handling failures gracefully. It spans bot retries, custom error handlers, workflow recovery, and defensive coding practices.

**Prerequisites:** Familiarity with the [SDK Quick-Start](sdk-quickstart.md), [Core Decorators Reference](core-decorators-reference.md), and [Entity Lifecycle & Patterns](entity-lifecycle-patterns.md).

---

## Table of Contents

- [Error Model Overview](#error-model-overview)
- [Bot-Level Error Handling](#bot-level-error-handling)
- [Custom Error Handlers](#custom-error-handlers)
- [Entity-Level Error Handling](#entity-level-error-handling)
- [Workflow Error Handling](#workflow-error-handling)
- [Validation Errors](#validation-errors)
- [External Service Failures](#external-service-failures)
- [Defensive Patterns](#defensive-patterns)
- [Observability](#observability)
- [Anti-Patterns](#anti-patterns)

---

## Error Model Overview

Errors in FireFoundry flow through three layers, each with its own handling mechanisms:

```
┌─────────────────────────────────────────────┐
│  API Endpoint Layer                         │
│  Catches unhandled errors, returns HTTP 500 │
├─────────────────────────────────────────────┤
│  Entity Layer                               │
│  Sets entity status to Error on failure     │
│  Supports resumable recovery                │
├─────────────────────────────────────────────┤
│  Bot Layer                                  │
│  Retries via max_tries                      │
│  Custom error handling via BotCustomError    │
│  Validation retry via StructuredOutputMixin │
└─────────────────────────────────────────────┘
```

**Key principle:** Errors bubble up unless caught. The bot layer handles LLM-related failures. The entity layer handles orchestration failures. The API layer is the final catch-all.

---

## Bot-Level Error Handling

### Automatic Retries with `max_tries`

Every bot accepts a `max_tries` parameter that controls how many times the bot will re-attempt the LLM call on failure:

```typescript
class MyBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[...]> {
  constructor() {
    super(
      [{
        name: 'MyBot',
        model_pool_name: 'firebrand_completion_default',
        base_prompt_group: promptGroup,
        static_args: {},
        max_tries: 3,  // Retry up to 3 times on failure
      }],
      [{ schema: MySchema }]
    );
  }
}
```

**What triggers a retry:**
- LLM returns malformed JSON (when using `StructuredOutputBotMixin`)
- Zod schema validation fails on the parsed output
- The broker returns a transient error (network timeout, rate limit)

**What does NOT trigger a retry:**
- Application logic errors in your entity code
- Entity graph failures (connection errors, constraint violations)
- Errors thrown in `get_bot_request_args_impl()`

### BotTry Lifecycle

Each attempt is tracked as a `BotTry`. After all tries are exhausted, the bot throws with the last error:

```
Bot.execute()
  ├─ Try 1: LLM call → invalid JSON → retry
  ├─ Try 2: LLM call → schema validation fails → retry
  └─ Try 3: LLM call → valid output → return result
```

If all tries fail:

```
Bot.execute()
  ├─ Try 1: fails
  ├─ Try 2: fails
  └─ Try 3: fails → throws BotError with last failure details
```

### Structured Output Retry

The `StructuredOutputBotMixin` adds intelligent retry behavior. When the LLM produces output that fails Zod validation, the mixin can feed the validation error back to the LLM as context for the next try:

```typescript
// The mixin handles this automatically:
// Try 1: LLM returns { "greeting": "Hi" }  → missing fun_fact, mood → retry
// Try 2: LLM sees validation error + original prompt → returns complete object
```

This is why `max_tries: 3` is the recommended default — it gives the LLM two chances to self-correct after seeing its validation errors.

---

## Custom Error Handlers

For more sophisticated error recovery, use `BotCustomErrorHandling` to dispatch errors to a specialized "error handler" bot:

```typescript
import {
  MixinBot,
  StructuredOutputBotMixin,
  BotCustomErrorHandling,
  RegisterBot,
} from '@firebrandanalytics/ff-agent-sdk';

@RegisterBot('ResilientAnalysisBot')
export class ResilientAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  BotCustomErrorHandling
)<[...]> {
  constructor() {
    super(
      [{
        name: 'ResilientAnalysisBot',
        model_pool_name: 'firebrand_completion_default',
        base_prompt_group: analysisPromptGroup,
        static_args: {},
        max_tries: 3,
      }],
      [{ schema: AnalysisSchema }],
      [{
        // Error handler bot configuration
        error_bot_name: 'AnalysisErrorRecoveryBot',
        max_error_tries: 2,
      }]
    );
  }
}
```

The error handler bot receives the original request plus the error context, allowing it to attempt a different strategy:

```typescript
@RegisterBot('AnalysisErrorRecoveryBot')
export class AnalysisErrorRecoveryBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[...]> {
  constructor() {
    super(
      [{
        name: 'AnalysisErrorRecoveryBot',
        model_pool_name: 'firebrand_completion_default',
        base_prompt_group: errorRecoveryPromptGroup,
        static_args: {},
        max_tries: 2,
      }],
      [{ schema: AnalysisSchema }]
    );
  }
}
```

**When to use custom error handlers:**
- The primary bot uses a specialized model that sometimes fails on certain input types
- You want to fall back to a simpler analysis strategy on failure
- The error context provides useful signal for recovery (e.g., "JSON was truncated" → retry with a shorter output request)

---

## Entity-Level Error Handling

### Entity Status on Failure

When a `RunnableEntity`'s `run()` method throws, the entity's status is automatically set to `Error`:

```typescript
// Before run(): entity.status = 'Pending' or 'InProgress'
// After successful run(): entity.status = 'Completed'
// After failed run(): entity.status = 'Error'
```

### Try-Catch in Entity Run Logic

Wrap risky operations in try-catch within your entity's run implementation:

```typescript
@EntityMixin({
  specificType: 'SafeAnalysisEntity',
  generalType: 'AnalysisEntity',
  allowedConnections: {},
})
export class SafeAnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[...]> {
  protected async run_impl(): Promise<AnalysisResult> {
    try {
      // Primary bot execution
      const result = await this.run_bot();
      return result;
    } catch (error) {
      // Log the failure
      logger.error('Analysis failed, attempting fallback', {
        entityId: this.id,
        error: error instanceof Error ? error.message : String(error),
      });

      // Attempt fallback strategy
      return this.runFallback();
    }
  }

  private async runFallback(): Promise<AnalysisResult> {
    // Return a safe default or run a simpler bot
    return {
      summary: 'Analysis could not be completed.',
      confidence: 0,
      needs_review: true,
    };
  }
}
```

### Resumable Entities

`RunnableEntity` supports resumability by default. If an entity fails mid-workflow, re-calling `run()` resumes from the last checkpoint rather than starting over:

```typescript
// First call: processes steps 1-3, fails at step 4
await entity.run();  // throws at step 4

// Second call: resumes from step 4 (steps 1-3 are already persisted)
await entity.run();  // completes steps 4-6
```

This works because each step's output is persisted to the entity graph. The `forEach`, `loop`, and `parallel` helpers all support resumability.

---

## Workflow Error Handling

### Error Propagation in Control Flow Helpers

The SDK's control flow helpers (`forEach`, `loop`, `condition`, `parallel`) handle errors differently:

#### `forEach` — Fails Fast by Default

```typescript
// If any item fails, the entire forEach stops
await this.forEach(items, async (item) => {
  await this.processItem(item);  // Throws on item 3 → items 4+ are skipped
});
```

To continue processing despite individual failures, catch within the callback:

```typescript
const results: Array<{ item: string; success: boolean; error?: string }> = [];

await this.forEach(items, async (item) => {
  try {
    await this.processItem(item);
    results.push({ item, success: true });
  } catch (error) {
    results.push({
      item,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Check for partial failures
const failures = results.filter(r => !r.success);
if (failures.length > 0) {
  logger.warn(`${failures.length}/${results.length} items failed`, { failures });
}
```

#### `parallel` — All-or-Nothing by Default

```typescript
// If any parallel task fails, the entire parallel block fails
await this.parallel([
  () => this.processA(),
  () => this.processB(),
  () => this.processC(),
]);
```

For partial-failure tolerance:

```typescript
const results = await Promise.allSettled([
  this.processA(),
  this.processB(),
  this.processC(),
]);

const succeeded = results.filter(r => r.status === 'fulfilled');
const failed = results.filter(r => r.status === 'rejected');

if (failed.length > 0) {
  logger.warn(`${failed.length} parallel tasks failed`);
}
```

#### `condition` — Short-Circuits

```typescript
// If the condition check itself throws, the entire block fails
await this.condition(
  async () => {
    const dto = await this.get_dto();
    return dto.data.requiresReview;  // If get_dto() throws, condition fails
  },
  async () => this.runReview(),     // True branch
  async () => this.skipReview(),    // False branch
);
```

---

## Validation Errors

### Schema Validation Failures

When using `StructuredOutputBotMixin`, Zod validation errors are automatically caught and retried. But for data validation at the entity level, handle explicitly:

```typescript
import { z } from 'zod';

const InputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
});

@ApiEndpoint({ method: 'POST', route: 'process' })
async processRequest(data: unknown) {
  const parsed = InputSchema.safeParse(data);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    };
  }

  // Proceed with validated data
  return this.process(parsed.data);
}
```

### Data Validation Mixin

The `DataValidationBotMixin` integrates the validation library with bot execution for iterative refinement:

```typescript
class ValidatingBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  DataValidationBotMixin
)<[...]> {
  // DataValidationBotMixin runs validators on bot output
  // and feeds validation errors back as context for retry
}
```

See the [Validation Integration Patterns](../feature_guides/validation-integration-patterns.md) guide for full details.

---

## External Service Failures

### Timeout Patterns

When calling external services from tool calls or entity logic, always set timeouts:

```typescript
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Retry with Backoff

For transient failures to external services:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10_000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unreachable');
}

// Usage in an entity
const data = await retryWithBackoff(
  () => fetchExternalApi('/analysis'),
  { maxRetries: 3, baseDelayMs: 2000 }
);
```

---

## Defensive Patterns

### Guard Clauses in API Endpoints

Validate inputs at the boundary before they reach entity/bot logic:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze' })
async analyze(data: { document_id: string; options?: AnalysisOptions }) {
  // Guard: required fields
  if (!data.document_id) {
    return { success: false, error: 'document_id is required' };
  }

  // Guard: entity exists
  const entity = await this.entity_factory.get_entity_node(data.document_id)
    .catch(() => null);

  if (!entity) {
    return { success: false, error: 'Document not found' };
  }

  // Safe to proceed
  return this.runAnalysis(entity, data.options);
}
```

### Idempotent Entity Creation

Use deterministic entity names to prevent duplicates:

```typescript
// Good: deterministic name prevents duplicates on retry
const entityName = `analysis-${documentId}-${stepName}`;
const existing = await this.findEntityByName(entityName);
if (existing) return existing;

const entity = await this.entity_factory.create_entity_node({
  name: entityName,
  // ...
});
```

### Safe DTO Access

Always handle potentially missing data fields:

```typescript
protected async get_bot_request_args_impl(preArgs: Partial<BotRequestArgs>) {
  const dto = await this.get_dto();

  // Defensive access with defaults
  const title = dto.data.title ?? 'Untitled';
  const items = Array.isArray(dto.data.items) ? dto.data.items : [];
  const config = dto.data.config ?? {};

  return {
    args: {},
    input: `Analyze "${title}" with ${items.length} items`,
    context: new Context(dto),
  };
}
```

---

## Observability

### Structured Logging

Use the SDK's `logger` for consistent, structured log output:

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';

// Log at appropriate levels
logger.info('Processing started', { entityId, itemCount: items.length });
logger.warn('Partial failure', { failed: 2, total: 10 });
logger.error('Unrecoverable error', { entityId, error: err.message, stack: err.stack });
```

### Entity Status as Observability Signal

Use entity status transitions as a monitoring signal:

| Status | Meaning | Action |
|--------|---------|--------|
| `Pending` | Created, not yet started | Normal |
| `InProgress` | Currently executing | Normal |
| `Completed` | Finished successfully | Normal |
| `Error` | Failed during execution | Investigate |
| `Waiting` | Paused for external input | Normal (waitable) |

Query for error entities to find failures:

```bash
# Via ff-cli or entity graph API
ff-sdk-cli query --app-id $APP_ID --status Error
```

### Telemetry Integration

FireFoundry automatically records telemetry for every LLM call through the Broker service. Use the [Telemetry Read](../../telemetry/) tools to trace failures:

```bash
# Find failed broker requests for a specific entity
ff-telemetry-read --entity-id $ENTITY_ID --status error
```

---

## Anti-Patterns

### 1. Swallowing Errors Silently

```typescript
// BAD: Error disappears, entity looks successful
try {
  await this.run_bot();
} catch (e) {
  // Silent catch — no logging, no status update
}

// GOOD: Log, update status, or re-throw
try {
  await this.run_bot();
} catch (e) {
  logger.error('Bot execution failed', { error: e });
  throw e;  // Let the entity framework set Error status
}
```

### 2. Infinite Retry Loops

```typescript
// BAD: Retries forever, wastes LLM tokens
while (true) {
  try {
    return await bot.execute(request);
  } catch (e) {
    continue;  // Never stops
  }
}

// GOOD: Use max_tries in bot config or bounded retry helper
// The bot's built-in max_tries handles this automatically
```

### 3. Catching Too Broadly

```typescript
// BAD: Catches programming errors along with expected failures
try {
  const result = await this.complexWorkflow();
  return reslt;  // Typo — but caught by the catch block!
} catch (e) {
  return { success: false };
}

// GOOD: Catch specific error types
try {
  const result = await this.complexWorkflow();
  return result;
} catch (e) {
  if (e instanceof BotExecutionError) {
    return { success: false, error: 'Analysis failed' };
  }
  throw e;  // Re-throw unexpected errors
}
```

### 4. Not Using Resumability

```typescript
// BAD: Restarts entire workflow on failure
async run_impl() {
  const step1 = await this.step1();  // 5 minutes
  const step2 = await this.step2();  // 5 minutes — fails here
  const step3 = await this.step3();
  // On retry: step1 runs again unnecessarily
}

// GOOD: Use control flow helpers that support resumability
async run_impl() {
  await this.forEach(['step1', 'step2', 'step3'], async (step) => {
    await this[step]();
    // Each step is checkpointed — resume skips completed steps
  });
}
```

---

## Related Guides

- **[Testing Guide](testing-guide.md)** — testing error recovery paths
- **[Entity Lifecycle & Patterns](entity-lifecycle-patterns.md)** — entity status transitions and control flow
- **[Workflow Orchestration](../feature_guides/workflow_orchestration_guide.md)** — multi-step workflow patterns
- **[Advanced Bot Mixin Patterns](../feature_guides/advanced-bot-mixin-patterns.md)** — `DataValidationBotMixin` and custom error mixins
- **[Validation Integration Patterns](../feature_guides/validation-integration-patterns.md)** — validation with retry
- **[Prompt Patterns Cookbook](prompt-patterns-cookbook.md)** — prompt design for reliable LLM output
