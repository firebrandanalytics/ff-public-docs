# Virtual Worker SDK: Session-First Architecture

This guide covers the Virtual Worker (VW) SDK, which provides a session-first API for interacting with Virtual Worker Manager (VWM) instances. The SDK supports both standalone (non-entity) usage and full entity framework integration for production agent bundles.

## Table of Contents

1. [Overview and Concepts](#overview-and-concepts)
2. [Architecture](#architecture)
3. [Non-Entity Usage (Standalone)](#non-entity-usage-standalone)
4. [Entity Integration](#entity-integration)
5. [Streaming and Progress Envelopes](#streaming-and-progress-envelopes)
6. [File Operations](#file-operations)
7. [Working Memory Bridge](#working-memory-bridge)
8. [Crash Recovery and Idempotency](#crash-recovery-and-idempotency)
9. [Complete Examples](#complete-examples)
10. [API Reference](#api-reference)
11. [Troubleshooting](#troubleshooting)

---

## Overview and Concepts

### What Is a Virtual Worker?

A Virtual Worker is a VWM-managed AI coding agent (Claude Code, Codex, Gemini, etc.) running in an isolated container with its own filesystem workspace. The VW SDK provides a TypeScript API for creating sessions, executing prompts, and managing files on these workers.

### Session-First Model

The SDK enforces a session-first model: **you cannot make requests to a virtual worker without an active session**. This ensures:

- Clean workspace isolation between tasks
- Proper resource cleanup (containers, PVCs)
- Multi-turn conversation context preservation
- Crash recovery via session reconnection

### Core Flow

```
VirtualWorker (factory)
  |
  +-- resolveWorker() --> Worker metadata
  |
  +-- startSession(options?) --> VWSession
                                   |
                                   +-- prompt(args) -----> streams envelopes, returns VWTurnResult
                                   +-- executePrompt(args) -> returns VWTurnResult directly
                                   +-- uploadFile / readFile / writeFile / downloadFile / deleteFile
                                   +-- end()
```

### Key Types

| Type | Purpose |
|------|---------|
| `VirtualWorker` | Factory that resolves workers and creates sessions |
| `VWSession` | Active session with prompt execution and file ops |
| `VWTurnArgs` | Arguments for a single prompt (prompt text, files, timeout) |
| `VWTurnResult` | Result of a single prompt (response, session ID, turn index) |
| `VWSessionOptions` | Options for session creation (repos, initial files, breadcrumbs) |
| `VWProgressEnvelope` | Progress events during streaming (status, stream events, errors) |

---

## Architecture

### Two-Layer Design

The SDK has two layers:

1. **Non-entity layer** (`VirtualWorker` + `VWSession`): Standalone classes that work without the entity framework. Use these for scripts, tests, CLI tools, or any context where entity persistence isn't needed.

2. **Entity layer** (`VWSessionEntity` + `VWTurnEntity`): Entity framework integration that provides idempotency, crash recovery, and progress envelope streaming. Use these for production agent bundles.

```
Non-entity layer            Entity layer
-----------------           --------------------------------
VirtualWorker (factory)     VWSessionEntity (developer extends this)
VWSession (active session)    +-- VWTurnEntity (built-in, per prompt)
                              +-- uses VirtualWorker + VWSession internally
```

### Relationship to Bot Pattern

The VW SDK follows the same architectural patterns as the Bot framework:

| Bot Pattern | VW SDK Equivalent |
|-------------|-------------------|
| Bot (stateless blueprint) | VirtualWorker (factory) |
| BotRequest (single execution) | VWSession.prompt() / executePrompt() |
| BotRunnableEntityMixin | VWSessionEntity |
| Bot three-phase args | VWSessionEntity.get_next_prompt() |

---

## Non-Entity Usage (Standalone)

### Basic Single-Turn Prompt

```typescript
import { VirtualWorker } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

const vw = new VirtualWorker({ name: 'my-coder' });
const session = await vw.startSession();

try {
  const result = await session.executePrompt({
    prompt: 'Write a function to validate email addresses',
  });
  console.log(result.promptResponse.response);
} finally {
  await session.end();
}
```

### Multi-Turn Session

```typescript
const vw = new VirtualWorker({ name: 'my-coder' });
const session = await vw.startSession();

try {
  // Turn 0: Create the module
  await session.executePrompt({
    prompt: 'Create a utils.ts file with string helper functions',
  });

  // Turn 1: Add tests
  const result = await session.executePrompt({
    prompt: 'Write tests for utils.ts using vitest',
  });

  console.log(`Completed ${session.getTurnCount()} turns`);

  // Read generated files
  const code = await session.readFile('utils.ts');
  const tests = await session.readFile('utils.test.ts');
} finally {
  await session.end();
}
```

### Streaming with Progress Envelopes

```typescript
const session = await vw.startSession();

try {
  const gen = session.prompt({
    prompt: 'Analyze the codebase and create a detailed report',
  });

  let turnResult;
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      turnResult = value; // VWTurnResult
      break;
    }

    // value is a VWProgressEnvelope
    switch (value.type) {
      case 'VW_STATUS':
        console.log(`[${value.status}] ${value.message}`);
        break;
      case 'VW_STREAM_EVENT':
        if (value.event.type === 'text') {
          process.stdout.write(value.event.data as string);
        }
        break;
      case 'VW_ERROR':
        console.error(`Error: ${value.message}`);
        break;
    }
  }

  console.log('\nFinal response:', turnResult.promptResponse.response);
} finally {
  await session.end();
}
```

### Configuration Options

```typescript
import { VWMClient } from '@firebrandanalytics/vwm-client';

// With a custom VWM client
const client = new VWMClient({
  baseUrl: 'http://vwm.internal:8080',
  apiKey: 'my-api-key',
});

const vw = new VirtualWorker({
  name: 'my-coder',
  client,
  defaultSessionOptions: {
    workerName: 'task-runner',
    autoDeleteBranch: true,
  },
});

// Session-level options
const session = await vw.startSession({
  createSessionOptions: {
    sessionRepository: { url: 'https://github.com/org/repo.git', branch: 'main' },
  },
  initialFiles: [
    { path: 'context.md', content: Buffer.from('Project context...') },
  ],
  breadcrumbs: ['my-agent', 'task-123'],
});
```

---

## Entity Integration

### VWSessionEntity (Developer Base Class)

`VWSessionEntity` is the entity framework equivalent of `ReviewableEntity` for virtual workers. Developers extend it and override `get_next_prompt()` to drive a multi-turn conversation.

Each turn is executed by a child `VWTurnEntity`, providing idempotency: if the session entity re-runs after a crash, completed turns return cached results.

#### Simple Single-Turn Entity

```typescript
import VWSessionEntity from '@firebrandanalytics/ff-agent-sdk/virtual-worker/VWSessionEntity';
import type { VWPromptContext, VWNextPrompt } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

class CodeAnalysisEntity extends VWSessionEntity {
  protected async get_next_prompt(ctx: VWPromptContext): Promise<VWNextPrompt> {
    if (ctx.turnIndex === 0) {
      return { prompt: 'Analyze the codebase and create a summary report' };
    }
    return null; // End session after one turn
  }
}
```

#### Multi-Turn Entity with Feedback Loop

```typescript
class IterativeCoderEntity extends VWSessionEntity {
  protected async get_next_prompt(ctx: VWPromptContext): Promise<VWNextPrompt> {
    // First turn: initial task
    if (ctx.turnIndex === 0) {
      return { prompt: 'Write a CSV parser module with error handling' };
    }

    // Check previous response
    const lastResponse = ctx.previousTurns[ctx.turnIndex - 1].promptResponse.response;

    // End condition: task complete or max turns reached
    if (lastResponse.includes('All tests passing') || ctx.turnIndex >= 5) {
      return null;
    }

    // Continue with refinement
    return { prompt: 'Run the tests and fix any failures' };
  }
}
```

#### Entity with Lifecycle Hooks

```typescript
class FileProcessingEntity extends VWSessionEntity {
  // Customize session options from entity data
  protected async get_session_options() {
    const dto = await this.get_dto();
    return {
      createSessionOptions: {
        sessionRepository: {
          url: dto.data.repoUrl,
          branch: dto.data.branch,
        },
      },
    };
  }

  // Hook: runs after session created, before first turn
  protected async on_session_started(session) {
    // Upload input files to the session workspace
    const dto = await this.get_dto();
    await session.uploadFile('input.json', Buffer.from(JSON.stringify(dto.data.input)));
  }

  // Hook: runs after all turns complete, before session ends
  protected async on_session_ending(session, results) {
    // Download generated artifacts
    const report = await session.readFile('report.md');
    await this.update_data_path(['output_report'], report);
  }

  protected async get_next_prompt(ctx) {
    if (ctx.turnIndex === 0) {
      return { prompt: 'Process input.json and generate report.md' };
    }
    return null;
  }
}
```

#### Entity Data Structure

VWSessionEntity requires specific fields in its DTO data:

```typescript
interface VWSessionEntityData {
  _vw_worker_name: string;         // Required: worker name
  _vw_worker_id?: string;          // Optional: skip name resolution
  _vw_session_options?: VWSessionOptions;  // Optional: session config
  _vw_current_turn?: number;       // Internal: crash recovery state
  _vw_session_id?: string;         // Internal: crash recovery state
  [key: string]: any;              // Your custom data
}
```

### VWTurnEntity (Built-in)

`VWTurnEntity` is an internal entity that executes a single prompt. You don't extend or create it directly - it's automatically created by `VWSessionEntity` for each turn via `appendOrRetrieveCall()`.

Each turn entity:
- Gets its `_vw_session_id` and `_vw_turn_args` from its DTO data
- Streams the prompt via VWMClient
- Yields `VW_PROGRESS` envelopes (entity-wrapped)
- Returns a `VWTurnResult`

---

## Streaming and Progress Envelopes

### Envelope Types

The VW SDK uses a layered envelope system:

**VW-level envelopes** (from `VWSession.prompt()`):

| Type | Description |
|------|-------------|
| `VW_STATUS` | Session/prompt lifecycle (STARTED, COMPLETED, FAILED) |
| `VW_STREAM_EVENT` | SSE events from VWM (text, tool_call, tool_result, thinking, complete) |
| `VW_ERROR` | Error information during prompt execution |

**Entity-wrapped envelopes** (from `VWTurnEntity`):

```typescript
{
  type: 'VW_PROGRESS',
  entity_id: string,
  entity_name: string,
  entity_type: string,
  progress: VWProgressEnvelope  // The VW-level envelope
}
```

### Stream Event Types

Events from VWM's SSE stream:

| Event Type | Description |
|------------|-------------|
| `start` | Stream started |
| `text` | Incremental text output |
| `tool_call` | Agent is calling a tool |
| `tool_result` | Tool call result |
| `thinking` | Agent's internal reasoning |
| `complete` | Stream complete, contains final `ExecutePromptResponse` |
| `error` | Stream error |

---

## File Operations

VWSession provides file operations on the session's workspace:

```typescript
// Upload a file (binary)
await session.uploadFile('data.csv', Buffer.from(csvContent));

// Write a text file
await session.writeFile('config.json', JSON.stringify(config));

// Read a text file
const content = await session.readFile('output.txt');

// Download a file (binary)
const buffer = await session.downloadFile('report.pdf');

// Delete a file
await session.deleteFile('temp.txt');
```

### File Transfer with Prompts

Files can be uploaded before and downloaded after each prompt:

```typescript
const result = await session.executePrompt({
  prompt: 'Process the input CSV and generate a summary report',
  inputFiles: [
    { path: 'input.csv', content: Buffer.from(csvData) },
  ],
  outputFilePaths: ['summary.md', 'stats.json'],
});

// result.downloadedFiles contains the requested files
for (const file of result.downloadedFiles ?? []) {
  console.log(`${file.path}: ${file.content.length} bytes`);
}
```

---

## Working Memory Bridge

The SDK includes utilities for bridging between the entity framework's Working Memory system and VW session files. This is useful when your entity pipeline stores data in Working Memories that need to be available to the virtual worker.

```typescript
import {
  bridgeWorkingMemoriesToFiles,
  bridgeFilesToWorkingMemories,
} from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

// Convert working memories to files for upload
const files = await bridgeWorkingMemoriesToFiles(
  entityNodeId,
  wmProvider,
  (wm) => wm.memory_type === 'document',  // optional filter
);

// Upload to session
for (const file of files) {
  await session.uploadFile(file.path, file.content);
}

// After processing, bridge files back to working memories
await bridgeFilesToWorkingMemories(
  entityNodeId,
  session.sessionId,
  ['output.md', 'analysis.json'],
  vwmClient,
  wmProvider,
);
```

---

## Crash Recovery and Idempotency

### How It Works

VWSessionEntity persists two key values in entity data for crash recovery:

1. **`_vw_session_id`**: Set after session creation. On restart, `reconnectSession()` attaches to the existing VWM session instead of creating a new one.

2. **`_vw_current_turn`**: Incremented after each turn. On restart, `appendOrRetrieveCall()` with name `turn_N` returns the already-completed turn entity with its cached result.

### Recovery Flow

```
Normal execution:
  Create session -> set _vw_session_id -> turn_0 -> turn_1 -> turn_2 -> end session

Crash after turn_1:
  _vw_session_id = "abc-123"
  _vw_current_turn = 2

Restart:
  Reconnect to "abc-123" -> turn_0 (cached) -> turn_1 (cached) -> turn_2 (new) -> end session
```

### Reconnecting to Sessions (Non-Entity)

For non-entity code, use `reconnectSession()`:

```typescript
const vw = new VirtualWorker({ name: 'my-coder' });
const session = vw.reconnectSession('existing-session-id');

// Execute more prompts on the existing session
const result = await session.executePrompt({
  prompt: 'Continue the previous work',
});
```

---

## Complete Examples

### Example 1: Automated Code Review Agent

```typescript
class CodeReviewEntity extends VWSessionEntity {
  protected async get_next_prompt(ctx: VWPromptContext): Promise<VWNextPrompt> {
    const dto = await this.get_dto();

    if (ctx.turnIndex === 0) {
      return {
        prompt: `Review the code changes in this PR and identify:
1. Security vulnerabilities
2. Performance issues
3. Code style violations

Repository: ${dto.data.repoUrl}
Branch: ${dto.data.prBranch}`,
        breadcrumbs: ['code-review', dto.data.prNumber],
      };
    }

    return null; // Single-turn review
  }

  protected async on_session_started(session: VWSession) {
    const dto = await this.get_dto();
    // Upload review guidelines
    await session.writeFile('REVIEW_GUIDELINES.md', dto.data.guidelines);
  }

  protected async on_session_ending(session: VWSession, results: VWTurnResult[]) {
    // Store the review result
    if (results.length > 0) {
      await this.update_data_path(
        ['review_result'],
        results[0].promptResponse.response,
      );
    }
  }
}
```

### Example 2: Multi-Turn Test Generator

```typescript
class TestGeneratorEntity extends VWSessionEntity {
  protected async get_next_prompt(ctx: VWPromptContext): Promise<VWNextPrompt> {
    const dto = await this.get_dto();
    const sourceFiles: string[] = dto.data.sourceFiles;

    // One turn per source file
    if (ctx.turnIndex < sourceFiles.length) {
      return {
        prompt: `Write comprehensive tests for ${sourceFiles[ctx.turnIndex]}.
Use vitest. Aim for >90% coverage.`,
        outputFilePaths: [`${sourceFiles[ctx.turnIndex].replace('.ts', '.test.ts')}`],
      };
    }

    // Final turn: run all tests
    if (ctx.turnIndex === sourceFiles.length) {
      return { prompt: 'Run all tests and report the results' };
    }

    return null;
  }
}
```

### Example 3: Standalone Script (No Entity Framework)

```typescript
import { VirtualWorker } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';
import { VWMClient } from '@firebrandanalytics/vwm-client';

async function main() {
  const client = new VWMClient({ baseUrl: 'http://localhost:8095' });
  const vw = new VirtualWorker({ name: 'codex-coder', client });

  const session = await vw.startSession();

  try {
    // Multi-turn conversation
    const result1 = await session.executePrompt({
      prompt: 'Create a REST API with Express and TypeScript',
    });
    console.log('Turn 0:', result1.promptResponse.response.substring(0, 100));

    const result2 = await session.executePrompt({
      prompt: 'Add authentication middleware using JWT',
    });
    console.log('Turn 1:', result2.promptResponse.response.substring(0, 100));

    // Download the generated code
    const indexTs = await session.readFile('src/index.ts');
    console.log('Generated code:', indexTs);

    console.log(`Session completed: ${session.getTurnCount()} turns`);
  } finally {
    await session.end();
  }
}

main().catch(console.error);
```

---

## API Reference

### VirtualWorker

```typescript
class VirtualWorker {
  readonly name: string;

  constructor(config: VirtualWorkerConfig);

  /** Resolve worker by name (cached after first call) */
  async resolveWorker(): Promise<Worker>;

  /** Get the underlying VWM client */
  getClient(): VWMClient;

  /** Start a new session */
  async startSession(options?: VWSessionOptions): Promise<VWSession>;

  /** Reconnect to an existing session (crash recovery) */
  reconnectSession(sessionId: string): VWSession;
}
```

### VWSession

```typescript
class VWSession {
  readonly sessionId: string;
  readonly workerName: string;
  readonly workerId: string;

  /** Streaming prompt execution */
  async *prompt(args: VWTurnArgs): AsyncGenerator<VWProgressEnvelope, VWTurnResult>;

  /** Non-streaming prompt execution */
  async executePrompt(args: VWTurnArgs): Promise<VWTurnResult>;

  /** Abort in-flight request */
  async abort(subsessionId?: string): Promise<void>;

  /** File operations */
  async uploadFile(path: string, content: Buffer): Promise<void>;
  async downloadFile(path: string): Promise<Buffer>;
  async readFile(path: string): Promise<string>;
  async writeFile(path: string, content: string): Promise<void>;
  async deleteFile(path: string): Promise<void>;

  /** End the session (idempotent) */
  async end(): Promise<void>;

  /** Accessors */
  getTurnResults(): VWTurnResult[];
  getTurnCount(): number;
  isEnded(): boolean;
}
```

### VWSessionEntity

```typescript
class VWSessionEntity extends RunnableEntity {
  constructor(factory: EntityFactory, idOrDto: string | DTO, vwOrName?: VirtualWorker | string);

  /** REQUIRED OVERRIDE: Return next prompt or null to end */
  protected async get_next_prompt(context: VWPromptContext): Promise<VWNextPrompt>;

  /** Optional: customize session options */
  protected async get_session_options(): Promise<VWSessionOptions>;

  /** Optional: hook after session created */
  protected async on_session_started(session: VWSession): Promise<void>;

  /** Optional: hook before session ends */
  protected async on_session_ending(session: VWSession, results: VWTurnResult[]): Promise<void>;
}
```

---

## Troubleshooting

### Issue 1: "Worker not found" Error

**Problem**: `VirtualWorker.resolveWorker()` fails with worker not found.

**Solution**: Verify the worker exists in VWM:
```bash
curl http://localhost:8095/admin/workers | jq '.[] | .name'
```
Ensure the worker name matches exactly (case-sensitive).

### Issue 2: Streaming Returns "[No response received]"

**Problem**: `prompt()` completes but response is `[No response received]`.

**Solution**: This means VWM's SSE stream ended without a `complete` event. Check:
- VWM logs for errors during prompt execution
- The `StreamEventTypeEnum` in `@firebrandanalytics/vwm-client` includes all event types your VWM version sends
- Network connectivity between the SDK and VWM

### Issue 3: Session Operations Throw "already been ended"

**Problem**: Operations fail after calling `end()`.

**Solution**: VWSession guards all operations after `end()` is called. Use `session.isEnded()` to check before operations, and structure code with try/finally:
```typescript
try {
  // All prompt and file operations here
} finally {
  await session.end();
}
// Don't use session after this point
```

### Issue 4: Entity Crash Recovery Not Working

**Problem**: After restart, VWSessionEntity creates a new session instead of reconnecting.

**Solution**: Ensure `_vw_session_id` is persisted in entity data. The entity calls `update_data_path(['_vw_session_id'], ...)` after session creation. If entity data isn't being persisted (e.g., in-memory-only factory), crash recovery won't work.

### Issue 5: Turn Entities Not Being Reused on Restart

**Problem**: After restart, turn entities re-execute instead of returning cached results.

**Solution**: `appendOrRetrieveCall()` requires the entity factory to have persistence enabled. Verify:
- The factory is connected to a database
- Turn entities are being created with consistent names (`turn_0`, `turn_1`, etc.)
- `_vw_current_turn` is being persisted in entity data
