# Agent Bundle Source Correlation

Correlating diagnostic data (progress envelopes, logs, telemetry) with your agent bundle source code. This is the most common debugging scenario for FireFoundry developers.

## Agent Bundle Structure

A typical agent bundle has this structure:

```
apps/<bundle-name>/
├── src/
│   ├── entities/           # Entity classes with run_impl
│   │   ├── MyWorkflowEntity.ts
│   │   └── MyRunnableEntity.ts
│   ├── bots/               # Bot definitions
│   │   └── MyBot.ts
│   ├── prompts/            # Prompt templates
│   │   └── MyPrompt.ts
│   ├── schemas.ts          # Zod schemas for structured output
│   ├── constructors.ts     # Entity/bot registration
│   ├── agent-bundle.ts     # Bundle class with API endpoints
│   └── index.ts            # Entry point
├── logs/                   # Local log files (when running locally)
└── firefoundry.json        # Bundle configuration
```

## Understanding run_impl

The `run_impl` method is the heart of runnable entities. It's a generator that:
- **Yields progress envelopes** that appear in `ff-eg-read node progress <id>`
- **Returns a value** that appears in `ff-eg-read node io <id>`
- **Logs messages** that appear in local logs and telemetry

**SDK automation:** The SDK automatically:
- Wraps your yields with entity context (entity_id, entity_type)
- Generates STATUS envelopes (STARTED, COMPLETED, FAILED)
- Propagates progress up the call stack when using `yield*`
- Adds breadcrumbs to all log calls via `AsyncLocalStorage`

### Example run_impl Pattern

```typescript
protected override async *run_impl(): AsyncGenerator<any, OutputType, never> {
  // This yield creates an INTERNAL_UPDATE progress envelope
  yield {
    type: "INTERNAL_UPDATE",
    message: "Starting workflow",
    metadata: { stage: "start", entity_id: this.id }
  };

  try {
    // Do work...
    logger.info('[MyEntity] Processing started', { entity_id: this.id });

    // Yield progress updates
    yield {
      type: "INTERNAL_UPDATE",
      message: "Stage 1 complete",
      metadata: { stage: "stage_1" }
    };

    // Call child entity - its progress will also appear
    const childResult = yield* await this.childEntity.start();

    // Final return becomes the "output" in node io
    return {
      result: childResult,
      completed_at: new Date().toISOString()
    };

  } catch (error) {
    logger.error('[MyEntity] Failed', { entity_id: this.id, error });

    yield {
      type: "INTERNAL_UPDATE",
      message: `Failed: ${error.message}`,
      metadata: { stage: "failed", error: error.message }
    };

    throw error;
  }
}
```

## Correlating Progress Envelopes to Source

### Step 1: Get Progress from Entity Graph

```bash
ff-eg-read node progress <entity-id> | jq '.[] | {type, message, metadata}'
```

Example output:
```json
{"type": "STATUS", "message": "Entity execution started", "metadata": null}
{"type": "INTERNAL_UPDATE", "message": "Stage 1/3: Extracting text", "metadata": {"stage": "text_extraction"}}
{"type": "INTERNAL_UPDATE", "message": "Stage 2/3: Generating HTML", "metadata": {"stage": "ai_generation"}}
{"type": "BOT_PROGRESS", "message": null, "metadata": {...}}
{"type": "INTERNAL_UPDATE", "message": "Stage 3/3: Converting to PDF", "metadata": {"stage": "pdf_conversion"}}
{"type": "STATUS", "message": "Entity execution completed", "metadata": null}
{"type": "VALUE", "message": null, "metadata": null}
```

### Step 2: Find the yield Statement

Search for the message text in your source code:

```bash
# Search for the message
grep -r "Stage 1/3: Extracting text" apps/<bundle>/src/

# Or search for the metadata stage
grep -r '"stage": "text_extraction"' apps/<bundle>/src/
grep -r "text_extraction" apps/<bundle>/src/
```

### Step 3: Understand What Happened

Once you find the yield statement, you know:
- What the code was doing at that point
- What should have happened next
- What conditions might have caused a failure

## Progress Envelope Sources

| Type | Source | How to Find |
|------|--------|-------------|
| `STATUS` | SDK automatically generates | Check if STARTED but no COMPLETED = crash |
| `INTERNAL_UPDATE` | Your `yield` statements | Search for the message string |
| `BOT_PROGRESS` | Bot wrapper (automatic) | Look at your bot class |
| `VALUE` | Your `return` statement | End of `run_impl` |
| `ERROR` | Exception thrown | Search for `throw` statements |
| `WAITING` | Waitable entities paused | `waitForInput()` calls |

## Correlating Logs to Source

### Log Entry Structure

Logs include breadcrumbs and entity context:

```json
{
  "message": "[ReportEntity] Workflow complete",
  "level": "info",
  "timestamp": "2025-11-12T04:07:50.602Z",
  "properties": {
    "breadcrumbs": [
      {
        "entity_type": "ReportReviewWorkflowEntity",
        "entity_id": "15ac4e7a-c32c-4939-81bd-d932f93b6839",
        "correlation_id": "bf150825-0543-40a4-8437-3bc2c8e7b847"
      },
      {
        "entity_type": "ReportEntity",
        "entity_id": "c725b47b-08dd-428e-977a-b6a2dd5ff668",
        "correlation_id": "bf150825-0543-40a4-8437-3bc2c8e7b847"
      }
    ],
    "entity_id": "c725b47b-08dd-428e-977a-b6a2dd5ff668",
    "pdf_working_memory_id": "356d9d95-ea2e-4e59-8768-096717a6d2f5",
    "processing_time_ms": 31284
  }
}
```

**Note:** Breadcrumbs are automatically added by the SDK via `AsyncLocalStorage`. You don't need to pass them explicitly—any `logger.*` call within a runnable entity's execution context automatically includes the breadcrumb trail showing the entity call stack.

**Warning:** The `filename`, `functionName`, and `lineNumber` properties in logs are extracted from the call stack and may be unreliable or missing. Always use the `[ClassName]` prefix convention in log messages as the primary way to locate log origins in source code.

### Finding Log Origins

```bash
# Search by log message prefix (convention: [ClassName])
grep -r '\[ReportEntity\] Workflow complete' apps/<bundle>/src/

# Search by custom property
grep -r 'processing_time_ms' apps/<bundle>/src/
```

### Logging Conventions

FireFoundry uses a prefix convention for easy searching:

```typescript
// Good - searchable prefix
logger.info('[ReportEntity] Workflow complete', { entity_id: this.id });
logger.error('[ReportEntity] Workflow failed', { entity_id: this.id, error });

// Pattern: [ClassName] action description
```

To find all logs in an entity:

```bash
grep -r "logger\." apps/<bundle>/src/entities/ReportEntity.ts
```

## Bot Progress (Automatic)

Bots automatically generate progress envelopes. You don't write these yields—the SDK bot wrapper handles it.

### What the Bot Wrapper Generates

```
BOT_PROGRESS (STARTED, sub_type: "THREAD")
  → BOT_PROGRESS (STARTED, sub_type: "TRY")
  → BOT_PROGRESS (COMPLETED, sub_type: "TRY")
  → BOT_PROGRESS (COMPLETED, sub_type: "THREAD")
```

### Finding Bot Issues

If you see failed bot progress:

```bash
# Find the bot class
grep -r "class.*Bot.*extends" apps/<bundle>/src/bots/

# Check the bot's get_bot_request_args_impl (prepares bot input)
grep -r "get_bot_request_args_impl" apps/<bundle>/src/entities/

# Check the bot's prompt
grep -r "PromptGroup\|StructuredPromptGroup" apps/<bundle>/src/bots/
```

### Bot-Entity Relationship

Entities that use bots typically:
1. Extend `BotRunnableEntityMixin`
2. Implement `get_bot_request_args_impl()` to prepare bot input
3. The SDK handles calling the bot and yielding its progress

```typescript
// In the entity constructor
super(
  [factory, idOrDto],           // RunnableEntity args
  [new ReportGenerationBot()],  // Bot instance
  []                            // Other mixins
);
```

To trace a bot issue, check:
1. `get_bot_request_args_impl()` - Is input prepared correctly?
2. The bot's prompt class - Is the prompt well-formed?
3. The bot's schema - Does the LLM output match the schema?

## Common Debugging Patterns

### Pattern 1: Entity Failed But No Error Details

```bash
# 1. Get progress to see where it stopped
ff-eg-read node progress <entity-id> | jq '.[] | {type, message, status}'

# 2. Look for ERROR envelope
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "ERROR")'

# 3. Check logs around that time
grep "<entity-id>" logs/*.log | jq -s 'sort_by(.timestamp) | .[-10:]'

# 4. Find the run_impl and look for throw statements
grep -A5 -B5 "throw" apps/<bundle>/src/entities/<EntityName>.ts
```

### Pattern 2: Bot Failed

```bash
# 1. Find BOT_PROGRESS with FAILED status
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "BOT_PROGRESS" and .progress.status == "FAILED")'

# 2. Check telemetry for LLM errors
ff-telemetry-read llm search --status failed --size 5

# 3. Get the LLM request details
ff-telemetry-read llm get <llm-request-id> | jq '{error, model, tokens}'

# 4. Check if it's a schema validation issue
# Look for the bot's schema
grep -A20 "const.*Schema.*z\." apps/<bundle>/src/schemas.ts
```

### Pattern 3: Entity Stuck (No Completion)

```bash
# 1. Check current status
ff-eg-read node get <entity-id> | jq '{status, updated_at}'

# 2. See last progress
ff-eg-read node progress <entity-id> | jq '.[-3:]'

# 3. If waiting, check for WAITING envelope
ff-eg-read node progress <entity-id> | jq '.[] | select(.type == "WAITING")'

# 4. Check if calling a child entity that's stuck
ff-eg-read node connected <entity-id> Calls | jq '.[] | {id, name, status}'
```

### Pattern 4: Wrong Output

```bash
# 1. Get the actual output
ff-eg-read node io <entity-id> | jq '.output'

# 2. Find the return statement in run_impl
grep -B10 "return {" apps/<bundle>/src/entities/<EntityName>.ts

# 3. Check if it matches the expected type
grep "type.*OUTPUT\|interface.*Output" apps/<bundle>/src/entities/<EntityName>.ts
```

## Entity Call Hierarchy

When entities call other entities via `appendOrRetrieveCall` or `yield*`, progress percolates up:

```typescript
// Parent entity
const childEntity = await this.appendOrRetrieveCall(ChildEntity, 'key', data);
const result = yield* await childEntity.start();  // Child's progress appears in parent
```

### Tracing the Call Stack

```bash
# Find what this entity calls
ff-eg-read node connected <entity-id> Calls | jq '.[] | {id, name, status}'

# Find what called this entity
ff-eg-read node edges-to <entity-id> | jq '.[] | select(.edge_type == "Calls")'

# Get the parent's progress (includes this entity's progress)
ff-eg-read node progress <parent-id>
```

### In Source Code

Look for call patterns:

```bash
# Find appendOrRetrieveCall usage
grep -r "appendOrRetrieveCall" apps/<bundle>/src/entities/

# Find yield* delegation
grep -r "yield\* await" apps/<bundle>/src/entities/
```

## Quick Reference

### Find All Entities

```bash
ls apps/<bundle>/src/entities/
```

### Find All Bots

```bash
ls apps/<bundle>/src/bots/
```

### Find All Log Statements in an Entity

```bash
grep "logger\." apps/<bundle>/src/entities/<EntityName>.ts
```

### Find All Yield Statements in run_impl

```bash
grep -A2 "yield {" apps/<bundle>/src/entities/<EntityName>.ts
```

### Find the Return Type

```bash
grep "run_impl\|AsyncGenerator\|OUTPUT" apps/<bundle>/src/entities/<EntityName>.ts
```

### Map Breadcrumb to Entity Class

From a breadcrumb `entity_type: "ReportEntity"`:

```bash
# Find the entity class file
find apps/<bundle>/src -name "*ReportEntity*"

# Or search by EntityMixin decorator
grep -r "specificType: 'ReportEntity'" apps/<bundle>/src/
```
