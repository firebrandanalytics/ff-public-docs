# Testing Guide

This guide covers strategies and patterns for testing FireFoundry agent bundles. It walks through unit testing bots and prompts, integration testing entities and workflows, and best practices for test organization.

**Prerequisites:** Familiarity with the [SDK Quick-Start](sdk-quickstart.md) and [Core Decorators Reference](core-decorators-reference.md).

---

## Table of Contents

- [Test Setup](#test-setup)
- [Testing Prompts](#testing-prompts)
- [Testing Bots](#testing-bots)
- [Testing Entities](#testing-entities)
- [Testing Workflows](#testing-workflows)
- [Testing API Endpoints](#testing-api-endpoints)
- [Mocking Infrastructure](#mocking-infrastructure)
- [Test Organization](#test-organization)
- [Best Practices](#best-practices)

---

## Test Setup

FireFoundry projects use [Vitest](https://vitest.dev/) as the test runner. The SDK scaffold includes a ready-to-use configuration.

### Vitest Configuration

Create or verify `vitest.config.ts` at your bundle root:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    testTimeout: 30_000,  // LLM calls can be slow
    hookTimeout: 15_000,
  },
});
```

Add test scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### Essential Imports

Most tests use this common set of imports:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

---

## Testing Prompts

Prompts are pure data structures, making them the easiest component to test. Focus on verifying that prompts produce the correct message structure for given inputs.

### Rendering Prompt Output

```typescript
import { describe, it, expect } from 'vitest';
import { GreetingPrompt } from '../prompts/GreetingPrompt.js';

describe('GreetingPrompt', () => {
  it('renders the task section', () => {
    const prompt = new GreetingPrompt();
    const rendered = prompt.render({});

    // Verify the system message contains expected instructions
    expect(rendered).toBeDefined();
    expect(rendered.length).toBeGreaterThan(0);

    const systemMessage = rendered.find(m => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('greeting');
  });

  it('includes schema instructions for structured output', () => {
    const prompt = new GreetingPrompt();
    const rendered = prompt.render({});

    const content = rendered
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    // StructuredDataPrompt injects schema and sample output
    expect(content).toContain('greeting');
    expect(content).toContain('fun_fact');
    expect(content).toContain('mood');
  });
});
```

### Snapshot Testing for Prompts

Snapshot tests catch unintended prompt changes — important because even small prompt changes can alter LLM behavior:

```typescript
describe('GreetingPrompt snapshots', () => {
  it('matches the expected prompt structure', () => {
    const prompt = new GreetingPrompt();
    const rendered = prompt.render({});
    expect(rendered).toMatchSnapshot();
  });
});
```

> **Tip:** Review snapshot diffs carefully during code review. A changed prompt is a changed contract with the LLM.

### Testing Dynamic Prompts

For prompts with conditional sections or dynamic content:

```typescript
import { AnalysisPrompt } from '../prompts/AnalysisPrompt.js';

describe('AnalysisPrompt', () => {
  it('includes detail section when verbose mode is enabled', () => {
    const prompt = new AnalysisPrompt();
    const rendered = prompt.render({ verbose: true });

    const content = rendered.map(m => m.content).join('\n');
    expect(content).toContain('detailed analysis');
  });

  it('omits detail section in compact mode', () => {
    const prompt = new AnalysisPrompt();
    const rendered = prompt.render({ verbose: false });

    const content = rendered.map(m => m.content).join('\n');
    expect(content).not.toContain('detailed analysis');
  });
});
```

---

## Testing Bots

Bots combine prompts with LLM execution. Test at two levels: **unit tests** (mock the LLM) and **integration tests** (call a real LLM).

### Unit Testing with Mocked LLM

Mock the broker to test bot logic without making LLM calls:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GreetingBot } from '../bots/GreetingBot.js';

describe('GreetingBot', () => {
  let bot: GreetingBot;

  beforeEach(() => {
    bot = new GreetingBot();
  });

  it('has the correct semantic label', () => {
    expect(bot.get_semantic_label_impl()).toBe('GreetingBot');
  });

  it('is registered with the correct name', () => {
    // @RegisterBot('GreetingBot') should register it
    expect(bot.constructor.name).toBe('GreetingBot');
  });
});
```

### Testing Bot Output Validation

Verify that your Zod schema correctly validates expected and unexpected outputs:

```typescript
import { GreetingSchema } from '../schemas.js';

describe('GreetingSchema validation', () => {
  it('accepts valid output', () => {
    const valid = {
      greeting: 'Hello Alice!',
      fun_fact: 'Alice means noble.',
      mood: 'cheerful' as const,
    };
    expect(GreetingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid mood values', () => {
    const invalid = {
      greeting: 'Hello',
      fun_fact: 'A fact',
      mood: 'angry',  // Not in the enum
    };
    expect(GreetingSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing fields', () => {
    const partial = { greeting: 'Hello' };
    expect(GreetingSchema.safeParse(partial).success).toBe(false);
  });
});
```

### Integration Testing with Real LLM

For integration tests that call the actual broker, use a longer timeout and guard with an environment check:

```typescript
import { describe, it, expect } from 'vitest';
import { Context } from '@firebrandanalytics/ff-agent-sdk';
import { GreetingBot } from '../bots/GreetingBot.js';
import { GreetingSchema } from '../schemas.js';

describe('GreetingBot integration', () => {
  // Skip if not running integration tests
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';

  it.skipIf(!runIntegration)('produces valid structured output', async () => {
    const bot = new GreetingBot();

    const response = await bot.execute({
      args: {},
      input: 'Generate a greeting for: Alice',
      context: new Context({}),
    });

    // Validate the output matches the schema
    const parsed = GreetingSchema.safeParse(response.output);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.greeting).toBeTruthy();
      expect(parsed.data.fun_fact).toBeTruthy();
      expect(['cheerful', 'formal', 'playful', 'inspiring']).toContain(
        parsed.data.mood
      );
    }
  }, 60_000); // 60s timeout for LLM calls
});
```

---

## Testing Entities

Entities interact with the entity graph (a persistent store), so testing them requires either mocking the graph client or running against a real graph.

### Unit Testing Entity Logic

Test the entity's `get_bot_request_args_impl` method to verify it correctly bridges data to bot input:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GreetingEntity } from '../entities/GreetingEntity.js';

describe('GreetingEntity', () => {
  it('constructs bot request args from DTO data', async () => {
    // Create a mock entity with a known DTO
    const mockDto = {
      id: 'test-id',
      data: { name: 'Alice' },
      specific_type_name: 'GreetingEntity',
      general_type_name: 'GreetingEntity',
      status: 'Pending',
    };

    const mockFactory = {
      create_entity_node: vi.fn(),
      get_entity_node: vi.fn().mockResolvedValue(mockDto),
    };

    const entity = new GreetingEntity(mockFactory as any, mockDto as any);

    // Spy on get_dto to return our mock
    vi.spyOn(entity as any, 'get_dto').mockResolvedValue(mockDto);

    const args = await (entity as any).get_bot_request_args_impl({});

    expect(args.input).toContain('Alice');
  });
});
```

### Testing Entity Creation

Verify entities are created with the correct type and data shape:

```typescript
describe('GreetingEntity creation', () => {
  it('uses correct specific type', () => {
    const mockFactory = { create_entity_node: vi.fn() } as any;
    const mockDto = {
      id: 'test-id',
      data: { name: 'Test' },
      specific_type_name: 'GreetingEntity',
    };

    const entity = new GreetingEntity(mockFactory, mockDto as any);
    expect(entity).toBeDefined();
  });
});
```

### Integration Testing with Entity Graph

For full integration tests that exercise the entity graph:

```typescript
describe('GreetingEntity integration', () => {
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';

  it.skipIf(!runIntegration)('creates and runs end-to-end', async () => {
    // Use a real entity client connected to a test environment
    const bundle = await createTestBundle();

    const entity = await bundle.entity_factory.create_entity_node({
      app_id: bundle.get_app_id(),
      name: `test-greeting-${Date.now()}`,
      specific_type_name: 'GreetingEntity',
      general_type_name: 'GreetingEntity',
      status: 'Pending',
      data: { name: 'TestUser' },
    });

    const result = await (entity as GreetingEntity).run();
    expect(result).toBeDefined();
    expect(result.greeting).toBeTruthy();
  }, 120_000);
});
```

---

## Testing Workflows

Workflows combine multiple entities with control flow helpers (`forEach`, `loop`, `condition`, `parallel`). Test each step independently, then test the orchestration.

### Testing Control Flow Logic

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('AnalysisWorkflow', () => {
  it('dispatches to correct child entities based on type', async () => {
    const createChildSpy = vi.fn();

    // Simulate dispatcher logic
    const documentTypes = ['pdf', 'csv', 'image'];
    const expectedEntities = {
      pdf: 'PdfAnalysisEntity',
      csv: 'CsvAnalysisEntity',
      image: 'ImageAnalysisEntity',
    };

    for (const docType of documentTypes) {
      const entityType = expectedEntities[docType as keyof typeof expectedEntities];
      createChildSpy(entityType, docType);
    }

    expect(createChildSpy).toHaveBeenCalledTimes(3);
    expect(createChildSpy).toHaveBeenCalledWith('PdfAnalysisEntity', 'pdf');
    expect(createChildSpy).toHaveBeenCalledWith('CsvAnalysisEntity', 'csv');
    expect(createChildSpy).toHaveBeenCalledWith('ImageAnalysisEntity', 'image');
  });
});
```

### Testing Parallel Execution

```typescript
describe('Parallel processing', () => {
  it('processes all items and aggregates results', async () => {
    const items = ['item1', 'item2', 'item3'];
    const processItem = vi.fn().mockImplementation(async (item: string) => ({
      item,
      processed: true,
    }));

    const results = await Promise.all(items.map(processItem));

    expect(results).toHaveLength(3);
    expect(results.every(r => r.processed)).toBe(true);
    expect(processItem).toHaveBeenCalledTimes(3);
  });
});
```

---

## Testing API Endpoints

Test `@ApiEndpoint` methods as regular async functions. The decorator only affects HTTP routing, not the method logic:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GreetingServiceBundle } from '../agent-bundle.js';

describe('GreetingServiceBundle API', () => {
  it('greet endpoint creates entity and returns result', async () => {
    const bundle = new GreetingServiceBundle();

    // Mock the entity factory
    const mockEntity = {
      run: vi.fn().mockResolvedValue({
        greeting: 'Hello!',
        fun_fact: 'A fun fact.',
        mood: 'cheerful',
      }),
    };

    vi.spyOn(bundle.entity_factory, 'create_entity_node')
      .mockResolvedValue(mockEntity as any);

    const result = await bundle.greet({ name: 'Alice' });

    expect(result.success).toBe(true);
    expect(result.greeting).toBeDefined();
    expect(bundle.entity_factory.create_entity_node).toHaveBeenCalledWith(
      expect.objectContaining({
        specific_type_name: 'GreetingEntity',
        data: { name: 'Alice' },
      })
    );
  });
});
```

---

## Mocking Infrastructure

### Mock Entity Client

Create a reusable mock for the entity graph client:

```typescript
// test/mocks/entity-client.mock.ts
import { vi } from 'vitest';

export function createMockEntityClient() {
  return {
    create_entity_node: vi.fn(),
    get_entity_node: vi.fn(),
    update_entity_node: vi.fn(),
    delete_entity_node: vi.fn(),
    get_entity_edges: vi.fn().mockResolvedValue([]),
    create_entity_edge: vi.fn(),
    query_entity_nodes: vi.fn().mockResolvedValue([]),
  };
}
```

### Mock Entity Factory

```typescript
// test/mocks/entity-factory.mock.ts
import { vi } from 'vitest';

export function createMockEntityFactory(overrides: Record<string, any> = {}) {
  return {
    create_entity_node: vi.fn().mockImplementation(async (dto) => ({
      id: `mock-${Date.now()}`,
      ...dto,
      run: vi.fn().mockResolvedValue({}),
      get_dto: vi.fn().mockResolvedValue(dto),
    })),
    ...overrides,
  };
}
```

### Mock Broker Response

For testing bot behavior with controlled LLM responses:

```typescript
// test/mocks/broker.mock.ts
import { vi } from 'vitest';

export function createMockBrokerResponse(content: string) {
  return {
    choices: [{
      message: {
        role: 'assistant' as const,
        content,
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
}
```

---

## Test Organization

### Recommended Directory Structure

```
apps/my-bundle/
├── src/
│   ├── entities/
│   │   ├── MyEntity.ts
│   │   └── MyEntity.test.ts        # Co-located unit tests
│   ├── bots/
│   │   ├── MyBot.ts
│   │   └── MyBot.test.ts
│   ├── prompts/
│   │   ├── MyPrompt.ts
│   │   └── MyPrompt.test.ts
│   └── schemas/
│       ├── my-schema.ts
│       └── my-schema.test.ts
├── test/
│   ├── mocks/                       # Shared mock factories
│   │   ├── entity-client.mock.ts
│   │   ├── entity-factory.mock.ts
│   │   └── broker.mock.ts
│   ├── integration/                 # Integration tests (need running services)
│   │   ├── entity.integration.test.ts
│   │   └── workflow.integration.test.ts
│   └── setup.ts                     # Global test setup
├── vitest.config.ts
└── package.json
```

### Test Categories

| Category | Location | Requires Services | Timeout |
|----------|----------|-------------------|---------|
| **Unit** | `src/**/*.test.ts` | No | 5–10s |
| **Schema** | `src/schemas/*.test.ts` | No | 5s |
| **Integration** | `test/integration/` | Entity graph, Broker | 60–120s |
| **Snapshot** | `src/prompts/*.test.ts` | No | 5s |

### Running Tests by Category

```bash
# Unit tests only (fast, no services needed)
pnpm test

# Integration tests (requires running FireFoundry)
RUN_INTEGRATION_TESTS=true pnpm test -- --dir test/integration

# Update snapshots after intentional prompt changes
pnpm test -- --update
```

---

## Best Practices

### 1. Test Schemas Independently

Schemas are your contract with the LLM. Test them thoroughly — every valid shape, every edge case:

```typescript
// Test that the schema handles edge cases the LLM might produce
it('handles empty strings gracefully', () => {
  const result = MySchema.safeParse({ title: '', body: '' });
  // Decide: should empty strings pass or fail?
});
```

### 2. Use Snapshot Tests for Prompts

Prompt changes are high-impact. Snapshots make unintended changes visible in code review.

### 3. Separate Unit and Integration Tests

Unit tests should run in under 10 seconds with no external dependencies. Integration tests should be opt-in via environment variable.

### 4. Test Bot Retry Behavior

Verify that bots handle `max_tries` correctly:

```typescript
it('retries on validation failure up to max_tries', async () => {
  // Mock broker to return invalid output first, then valid output
  const responses = [
    '{"invalid": "response"}',        // Try 1: fails validation
    '{"greeting": "Hi", "fun_fact": "Fact", "mood": "cheerful"}',  // Try 2: succeeds
  ];
  let callCount = 0;

  // Bot should succeed on second try
  // Verify via bot telemetry or output
});
```

### 5. Test Error Paths

Don't just test the happy path. Verify behavior when:
- The LLM returns malformed JSON
- The entity graph is unavailable
- A workflow step fails mid-execution
- Input validation rejects the request

### 6. Use Deterministic Test Data

Avoid randomized inputs in unit tests. Use fixed, descriptive test data:

```typescript
// Good: deterministic, descriptive
const testInput = { name: 'Alice Johnson', department: 'Engineering' };

// Avoid: random data makes failures hard to reproduce
const testInput = { name: `user-${Math.random()}` };
```

### 7. Clean Up Test Entities

If integration tests create entities in a real graph, clean them up:

```typescript
afterEach(async () => {
  if (testEntityId) {
    await entityClient.delete_entity_node(testEntityId);
  }
});
```

---

## Related Guides

- **[SDK Quick-Start](sdk-quickstart.md)** — build your first bundle (the code we test here)
- **[Core Decorators Reference](core-decorators-reference.md)** — decorator behavior to verify in tests
- **[Entity Lifecycle & Patterns](entity-lifecycle-patterns.md)** — entity patterns that need testing
- **[Error Handling & Resilience](error-handling-resilience.md)** — testing error recovery paths
- **[Prompt Patterns Cookbook](prompt-patterns-cookbook.md)** — prompt patterns to snapshot-test
