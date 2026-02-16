---
name: ff-agent-sdk
description: FireFoundry Agent SDK for building AI agent bundles with entities, bots, and workflows. Use when users ask about writing agent TypeScript code, entity modeling, bot behavior, prompting patterns, workflow orchestration, or FireFoundry SDK APIs.
version: 1.0.0
tags: [firefoundry, sdk, agent-development, typescript, ai-agents]
---

# FireFoundry Agent SDK

Build AI agent applications using FireFoundry's entity-bot architecture with automatic persistence, workflow orchestration, and enterprise-grade infrastructure.

## When to Use This Skill

**Use this skill for:**
- Writing TypeScript code for agent bundles
- Entity modeling and graph design
- Bot behavior and prompting patterns
- Workflow orchestration and parallelism
- SDK API questions (entities, bots, tools, waitables)
- Understanding FireFoundry architecture concepts

**Do NOT use this skill for:**
- Project scaffolding, building, or deployment → Use the `ff-cli` skill instead
- CLI commands and operations → Use the `ff-cli` skill instead
- Kubernetes or infrastructure issues → Use the `ff-cli` skill instead

## Related Skills

| Skill | Use For |
|-------|---------|
| `ff-cli` | Project creation, building Docker images, deploying to Kubernetes, profiles, environments |
| `ff-agent-sdk` (this) | Writing TypeScript code, SDK patterns, entity/bot design, workflows |

---

## Essential Concepts (Always Available)

### The Entity-Bot Pattern

FireFoundry separates **structure** (entities) from **behavior** (bots):

```
Entity (What)              Bot (How)
─────────────────          ─────────────────
- Data structure           - Behavior/logic
- Persisted state          - Prompts & tools
- Graph relationships      - Stateless execution
- Queryable                - Operates on entities
```

**Entities** = Persistent data nodes in a graph (like database records with relationships)
**Bots** = Stateless processors that read/write entities (like controllers with AI capabilities)

### Core Imports

```typescript
// Agent Bundle setup
import { AgentBundle } from "@anthropic/agent-sdk";

// Entity system
import {
  Entity,
  EntityConstructor,
  EntityGraph,
  Relationship
} from "@anthropic/agent-sdk/entities";

// Bot system
import {
  Bot,
  BotConstructor,
  Prompt,
  Tool
} from "@anthropic/agent-sdk/bots";

// Workflow utilities
import {
  Waitable,
  parallel,
  sequential
} from "@anthropic/agent-sdk/workflow";
```

### Basic Agent Bundle Structure

```typescript
import { AgentBundle } from "@anthropic/agent-sdk";

export class MyAgentBundle extends AgentBundle {
  // Register entity types
  entities = {
    Task: TaskEntity,
    Result: ResultEntity,
  };

  // Register bot types
  bots = {
    Processor: ProcessorBot,
    Reviewer: ReviewerBot,
  };

  // Entry point
  async handleRequest(input: RequestInput) {
    // 1. Create/load entities
    const task = await this.entities.Task.create({ ... });

    // 2. Run bots on entities
    const result = await this.bots.Processor.run(task);

    // 3. Return response
    return result;
  }
}
```

### Entity Definition Pattern

```typescript
@EntityConstructor("Task")
export class TaskEntity extends Entity {
  // Persisted fields
  @Field() title: string;
  @Field() status: "pending" | "complete";
  @Field() createdAt: Date;

  // Relationships to other entities
  @Relationship("Result") results: ResultEntity[];
  @Relationship("Task") parentTask?: TaskEntity;
}
```

### Bot Definition Pattern

```typescript
@BotConstructor("Processor")
export class ProcessorBot extends Bot<TaskEntity> {
  // System prompt
  prompt = `You are a task processor. Analyze the task and produce results.`;

  // Available tools
  tools = [
    this.createResultTool,
    this.updateStatusTool,
  ];

  @Tool("Create a result for this task")
  async createResultTool(content: string) {
    return await this.context.entities.Result.create({
      content,
      task: this.entity,
    });
  }
}
```

---

## Progressive Documentation Loading

Fetch documentation from GitHub based on the user's question. Use `WebFetch` with these URLs:

### Base URL
```
https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/
```

### Documentation Map

| Topic | File Path | When to Load |
|-------|-----------|--------------|
| **Platform Overview** | `README.md` | User is new to FireFoundry or asks "what is FireFoundry" |
| **Getting Started** | `sdk/agent_sdk/agent_sdk_getting_started.md` | User starting a new agent, first-time setup |
| **Glossary/Concepts** | `sdk/agent_sdk/fire_foundry_core_concepts_glossary_agent_sdk.md` | Terminology questions, concept clarification |

#### Core Concepts (`sdk/agent_sdk/core/`)

| Topic | Reference | Tutorial | When to Load |
|-------|-----------|----------|--------------|
| Agent Bundles | `agent_bundles.md` | `agent_bundle_tutorial.md` | Questions about bundle structure, lifecycle, registration |
| Bots | `bots.md` | `bot_tutorial.md` | Bot behavior, prompts, tools, bot-entity interaction |
| Entities | `entities.md` | — | Entity fields, relationships, persistence, querying |
| Prompting | `prompting.md` | `prompting_tutorial.md` | Prompt engineering, context injection, few-shot patterns |

#### Entity Graph (`sdk/agent_sdk/entity_graph/`)

| Topic | File | When to Load |
|-------|------|--------------|
| Overview | `README.md` | Introduction to entity graph concepts |
| Modeling Guide | `entity_modeling_prompt_guide.md` | Designing entity schemas, relationship patterns |
| Modeling Tutorial | `entity_modeling_tutorial.md` | Step-by-step entity modeling walkthrough |
| Intermediate Example | `intermediate_entity_graph_example.md` | Complex entity graph patterns, real-world examples |

#### Feature Guides (`sdk/agent_sdk/feature_guides/`)

| Topic | File | When to Load |
|-------|------|--------------|
| Overview | `README.md` | What advanced features are available |
| Ad-hoc Tool Calls | `ad_hoc_tool_calls.md` | Dynamic tool invocation, runtime tool creation |
| Parallelism | `advanced_parallelism.md` | Concurrent bot execution, parallel entity processing |
| Document Processing | `doc-proc-client.md` | Processing documents, PDFs, file content |
| File Uploads | `file-upload-patterns.md` | Binary file handling, upload workflows |
| Graph Traversal | `graph_traversal.md` | Querying entity relationships, navigation patterns |
| Vector Similarity | `vector-similarity-quickstart.md` | Embeddings, semantic search, vector storage |
| Waitables | `waitable_guide.md` | Async operations, background jobs, progress tracking |
| Workflow Orchestration | `workflow_orchestration_guide.md` | Multi-step workflows, state machines, error recovery |

---

## Loading Strategy

### For New Users / Bootstrapping
1. Fetch `agent_sdk_getting_started.md`
2. Fetch relevant tutorial (e.g., `agent_bundle_tutorial.md`)
3. Provide code examples with explanations

### For Existing Codebases / Specific Questions
1. Fetch the relevant reference doc (e.g., `bots.md`)
2. Only fetch tutorial if user needs a walkthrough
3. Focus on API details and patterns

### Decision Flow

```
User Question
     │
     ├─► "What is..." / "Explain..." → Reference doc
     │
     ├─► "How do I..." / "Show me..." → Tutorial first, then reference
     │
     ├─► "Why isn't... working" → Reference doc + check ff-cli for deployment issues
     │
     ├─► "Deploy" / "Build" / "CLI" → Redirect to ff-cli skill
     │
     └─► Terminology confusion → Glossary
```

### Fetching Example

When user asks about workflows:

```
1. WebFetch: https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/sdk/agent_sdk/feature_guides/workflow_orchestration_guide.md

2. If they need async patterns, also fetch:
   WebFetch: https://raw.githubusercontent.com/firebrandanalytics/ff-public-docs/main/docs/firefoundry/sdk/agent_sdk/feature_guides/waitable_guide.md
```

---

## Common Patterns Quick Reference

### Creating and Linking Entities

```typescript
// Create parent entity
const project = await this.entities.Project.create({
  name: "My Project",
  status: "active",
});

// Create child with relationship
const task = await this.entities.Task.create({
  title: "First Task",
  project: project,  // Automatic relationship
});

// Query relationships
const projectTasks = await project.tasks.getAll();
```

### Running Bots on Entities

```typescript
// Run bot and get result
const analysis = await this.bots.Analyzer.run(document);

// Run with options
const result = await this.bots.Processor.run(task, {
  maxTokens: 4000,
  temperature: 0.7,
});
```

### Parallel Execution

```typescript
import { parallel } from "@anthropic/agent-sdk/workflow";

// Process multiple entities concurrently
const results = await parallel(
  tasks.map(task => () => this.bots.Processor.run(task))
);
```

### Waitables for Background Work

```typescript
// Start background job
const waitable = await this.bots.LongRunningBot.runAsync(entity);

// Check status later
const status = await waitable.getStatus();

// Wait for completion
const result = await waitable.wait();
```

---

## Troubleshooting

### "Entity not found" errors
- Check entity is registered in `AgentBundle.entities`
- Verify entity constructor decorator: `@EntityConstructor("Name")`
- Ensure entity was created before querying

### "Bot has no tools" warnings
- Tools must be decorated with `@Tool("description")`
- Tool methods must be async
- Check tool is in bot's `tools` array

### Type errors with relationships
- Ensure both entity types are registered
- Use `@Relationship("EntityName")` decorator
- Check circular dependency issues

### For deployment/runtime issues
→ Use the `ff-cli` skill and check:
- `ff-cli ops doctor` for prerequisites
- Pod logs via `kubectl logs`
- Environment configuration

---

## Additional Resources

When documentation isn't enough:

1. **Examples**: Ask about `ff-cli examples list` to see working agent bundles
2. **Project Structure**: Use `ff-cli` skill for scaffolding questions
3. **Deployment**: Use `ff-cli` skill for build/deploy workflows
