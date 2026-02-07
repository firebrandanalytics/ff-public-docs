# FireFoundry Agent Bundle SDK Guide

## Introduction

The **Agent Bundle SDK** is the core framework for building sophisticated AI applications on FireFoundry. It provides a unique architecture that separates structure (entities) from behavior (bots), enabling complex multi-step AI workflows while maintaining clear organization and type safety.

### Core Philosophy

FireFoundry treats **entities** as persistent business objects in a graph, **bots** as stateless reusable units of AI behavior, and **prompts** as first-class code with typing and composition patterns. This separation of concerns makes applications easier to understand, test, and maintain.

### Why FireFoundry?

- **Zero-Code Persistence**: The entity graph automatically persists state without ORM boilerplate
- **Resumable Workflows**: Long-running computations can pause and resume deterministically
- **AI-First Design**: Built from the ground up for non-deterministic AI outputs
- **Type Safety**: Full TypeScript support with compile-time checking
- **Production Ready**: Built-in observability, streaming, error handling, and scaling

---

## Getting Started

### For Beginners

**1. Understand the Concepts** (15 minutes)
- **[Core Concepts & Glossary](fire_foundry_core_concepts_glossary_agent_sdk.md)** - Mental models and terminology

**2. Build Your First Application** (2-3 hours)
- **[Getting Started Tutorial](agent_sdk_getting_started.md)** - Complete walkthrough building a News Article Impact Analyzer

**3. Learn the Fundamentals** (4-6 hours)
- **[Prompting Tutorial](core/prompting_tutorial.md)** - Learn the prompting framework
- **[Bot Tutorial](core/bot_tutorial.md)** - Learn to build AI-powered bots
- **[Agent Bundle Tutorial](core/agent_bundle_tutorial.md)** - Learn to structure and deploy applications

### For Experienced Developers

1. **[Core Concepts & Glossary](fire_foundry_core_concepts_glossary_agent_sdk.md)** - Quick reference
2. Jump directly to relevant guides below
3. Use feature guides for specific capabilities

---

## Core Concepts

Learn the four primary concepts that power FireFoundry applications:

### **Entities** - Persistent Business Objects
*Represent your application's data with automatic persistence and relationships*

- Unique identity and relationships to other entities
- Hierarchical structure with graph-based connections
- Runnable entities for resumable computations
- Job scheduling for background tasks
- [Full Guide →](core/entities.md)

### **Bots** - Reusable AI Behavior
*Stateless units of LLM-powered computation with built-in error handling and retries*

- Structured prompts + validation + error handling
- Tool calls for external integrations
- Direct execution without entity context
- Composable for complex workflows
- [Full Guide →](core/bots.md)

### **Prompts** - First-Class Code
*Structured prompting system with typing, templating, and composition patterns*

- Template nodes for dynamic content
- Working memory integration
- Schema-driven outputs
- Conditional prompting
- [Full Guide →](core/prompting.md)

### **Agent Bundles** - Deployment Containers
*Containerized collections of agents, bots, and workflows that run on FireFoundry*

- REST API exposure with `@ApiEndpoint`
- Internal service orchestration
- Helm-based deployment
- Cross-bundle communication
- [Full Guide →](core/agent_bundles.md)

---

## Entity Graph Modeling

Before diving into code, understand the paradigm:

- **[Entity Graph Concepts](entity_graph/README.md)** - Why graph-based modeling matters
- **[Entity Modeling Tutorial](entity_graph/entity_modeling_tutorial.md)** - Think in graphs before coding
- **[Entity Modeling with AI](entity_graph/entity_modeling_prompt_guide.md)** - Use LLMs to help design entity structures
- **[Complete Example: Job-Resume Matching](entity_graph/intermediate_entity_graph_example.md)** - Full implementation walkthrough

---

## Feature Guides

Learn specific capabilities and patterns for advanced use cases:

### Data & Knowledge Management
- **[File Upload Patterns](feature_guides/file-upload-patterns.md)** - Handle binary files and blob storage
- **[Vector Similarity Search](feature_guides/vector-similarity-quickstart.md)** - Semantic search with embeddings
- **[Document Processing Client](feature_guides/doc-proc-client.md)** - Integration with doc processing services

### AI Workflows & Orchestration
- **[Tool Calls (Function Calling)](feature_guides/ad_hoc_tool_calls.md)** - Enable LLMs to call external functions
- **[Graph Traversal](feature_guides/graph_traversal.md)** - Navigate entity relationships
- **[Workflow Orchestration](feature_guides/workflow_orchestration_guide.md)** - Build multi-step AI workflows
- **[Advanced Parallelism](feature_guides/advanced_parallelism.md)** - Parallel execution patterns

### Async Orchestration & Scheduling
- **[Job Scheduling & Work Queues](feature_guides/job-scheduling-work-queues.md)** - Cron-based scheduling, distributed job execution, background tasks
- **[Entity Dispatcher Pattern](feature_guides/entity-dispatcher-pattern.md)** - Dynamic routing, conditional logic, multi-tenant workflows

### Human-in-the-Loop
- **[Waitable Entities](feature_guides/waitable_guide.md)** - Pause workflows for human input
- **[Review Workflows](feature_guides/review-workflows.md)** - Human-in-the-loop feedback iteration and approval

### Bot & Prompt Registration
- **[Bot & Prompt Registration](feature_guides/bot-prompt-registration.md)** - Persistent metadata, data-driven selection, component system
- **[Validation Integration Patterns](feature_guides/validation-integration-patterns.md)** - Using the validation library with bots and entities

### Advanced Bot Patterns
- **[Advanced Bot Mixin Patterns](feature_guides/advanced-bot-mixin-patterns.md)** - DataValidationBotMixin, WorkingMemoryBotMixin, custom composition, building custom mixins

---

## Utilities & Helpers

Discover shared utility libraries and patterns used throughout FireFoundry:

### Validation & Type Safety
- **[Validation Library - Getting Started](../utils/validation-library-getting-started.md)** - Core concepts and basic usage of the powerful data validation framework
- **[Validation Library - Intermediate](../utils/validation-library-intermediate.md)** - Advanced patterns, conditional logic, AI-powered transformations
- **[Validation Library - Complete Reference](../utils/validation-library-reference.md)** - Full API reference for all validators, coercers, and decorators

### Async & Streaming
- **[Async Streams Library](../utils/async-streams/README.md)** - Composable async streaming, fluent pipeline chains, and task scheduling with dependency graphs and multi-resource capacity
- **[Mixins & Composition](../utils/mixins.md)** - Type-safe mixin utilities (`AddMixins`, `ComposeMixins`) for flexible inheritance and composition

### General Utilities
- **[General Utilities](../utils/general-utilities.md)** - Object helpers, type guards, prototype extensions

---

## When to Use FireFoundry

FireFoundry excels at:

- **Multi-step AI reasoning** - Breaking complex problems into coordinated steps
- **Stateful workflows** - Applications that maintain context across interactions
- **Data extraction** - Structured data extraction from unstructured sources
- **Autonomous agents** - Long-running agents with persistence and resumability
- **Complex queries** - Graph traversal and entity relationship exploration

FireFoundry may not be the best fit for:

- Simple API wrappers around a single LLM call
- Stateless microservices
- Real-time streaming with minimal state

---

## Documentation Structure

### Core Concepts
Essential building blocks required for all applications. Start here.
- **[core/README.md](core/README.md)** - Learning path and overview

### Entity Graph Modeling
Understanding the paradigm before coding. Conceptual foundations for entity-oriented applications.
- **[entity_graph/README.md](entity_graph/README.md)** - Introduction to graph thinking

### Feature Guides
Practical how-to guides for specific capabilities. Use as needed for your use case.
- **[feature_guides/README.md](feature_guides/README.md)** - Index of all features

---

## Quick Decision Tree

**I'm completely new to FireFoundry**
→ Start with [Getting Started Tutorial](agent_sdk_getting_started.md)

**I want quick reference material**
→ Check [Core Concepts & Glossary](fire_foundry_core_concepts_glossary_agent_sdk.md)

**I want to learn about a specific topic**
→ Browse [Core Concepts](#core-concepts) or [Feature Guides](#feature-guides)

**I need a complete working example**
→ See [Job-Resume Matching Example](entity_graph/intermediate_entity_graph_example.md)

**I want to understand the paradigm first**
→ Read [Entity Graph Concepts](entity_graph/README.md)

**I'm migrating from v2.x**
→ Check [v2.x → v3.0 Migration Guide](MIGRATION_v2_to_v3.md)

---

## Key Patterns to Remember

**Separation of Concerns**
- Entities = structure + state
- Bots = behavior (stateless)
- Prompts = LLM interaction (reusable)
- Bundles = deployment container

**Resumability First**
- Entity ID = idempotency key
- Re-running resumes from last checkpoint or returns cached result
- Build workflows to be safely restartable

**Type Safety**
- Leverage TypeScript for compile-time checking
- Use Zod schemas for runtime validation
- Entity relationships are first-class and type-checked

**Progressive Enhancement**
- Start simple (entity + single bot)
- Add complexity (relationships, multiple steps)
- Scale to multi-bundle systems

---

## SDK Exports

Reference the main SDK modules (mixin-based composition):

```typescript
// Entity system - base classes and mixins
import {
  EntityNode,                        // Base entity class
  RunnableEntity,                    // Pre-composed: EntityNode + RunnableEntityMixin
  WaitableRunnableEntity,            // Pre-composed: extends RunnableEntity with waiting capabilities
  RunnableEntityMixin,               // Core mixin for resumable computations
  EntityDispatcherMixin,             // Dynamic routing to sub-entities
  BotRunnableEntityMixin,            // Integrates bot execution into entities
  FeedbackRunnableEntityMixin,       // Injects feedback context into entities
  EntityDispatcherDecorator,         // Decorator for dispatcher configuration
} from '@firebrandanalytics/ff-agent-sdk/entity';

// Bot system - mixin-based composition
import {
  Bot,                               // Base bot class
  MixinBot,                          // Base class for composing bot capabilities
  BotMixin,                          // Base mixin with section hooks
  StructuredOutputBotMixin,          // For structured JSON output with validation
  DataValidationBotMixin,            // For validation with retry
  FeedbackBotMixin,                  // For processing feedback in iterative workflows
  WorkingMemoryBotMixin,             // For working memory integration
  BotRequest,
  BotResponse,
  BotTypeHelper
} from '@firebrandanalytics/ff-agent-sdk/bot';

// Prompting system
import {
  Prompt,
  PromptGroup,
  PromptTemplateNode,
  PromptTypeHelper,
  StructuredPromptGroup,             // For structured output prompts
} from '@firebrandanalytics/ff-agent-sdk/prompts';

// Review workflows
import {
  ReviewableEntity,                  // Human-in-the-loop review with iteration
  ReviewStep,                        // Individual review step entity
} from '@firebrandanalytics/ff-agent-sdk/entity/workflow';

// Application
import {
  FFAgentBundle,                     // Main application class (alias: FFAppRunner)
  ComponentProvider,                 // Dependency injection provider
  CronJobManager,                    // Distributed job scheduling
} from '@firebrandanalytics/ff-agent-sdk/app';

// Server
import {
  FFAgentBundleServer,               // Server class (alias: FFAppRunnerServer)
  ApiEndpoint,                       // Decorator for custom REST endpoints
  createStandaloneServer,            // Create standalone server
} from '@firebrandanalytics/ff-agent-sdk/server';

// Client for consuming bundles
import {
  AppClient,                         // Client for remote bundle communication
  IteratorProxy,                     // Async iterator proxy for streaming
} from '@firebrandanalytics/ff-agent-sdk/client';

// Utilities and mixin composition (from shared-utils)
import {
  AddMixins,                         // Add mixins to a base class
  ComposeMixins,                     // Compose multiple mixins
  ValidationFactory,                 // Data validation factory
} from '@firebrandanalytics/shared-utils';
```

---

## Next Steps

1. **Understand** the concepts with the glossary and tutorials
2. **Build** your first application with the getting started tutorial
3. **Learn** core concepts through their reference guides
4. **Explore** feature guides for advanced capabilities
5. **Deploy** your agent bundle to FireFoundry

---

## Support & Resources

- **GitHub**: [ff-agent-sdk](https://github.com/firebrandanalytics/ff-agent-sdk)
- **Examples**: Check the [examples directory](https://github.com/firebrandanalytics/ff-agent-sdk/tree/main/examples) in the source repo
- **Community**: [FireFoundry Community Forum](https://community.firefoundry.ai)

---

## Contributing

Found an issue or want to improve the documentation?
- **Report bugs**: [GitHub Issues](https://github.com/firebrandanalytics/ff-agent-sdk/issues)
- **Improve docs**: [Documentation contributions welcome](https://github.com/firebrandanalytics/ff-public-docs)
