# Building an Illustrated Children's Storybook Generator

A tutorial that builds a complete AI-powered illustrated storybook pipeline. You'll create bots for content safety and story writing, generate images via the broker service, assemble illustrated HTML, and convert to PDF.

## What You'll Learn

- Multi-bot pipelines with distinct responsibilities (content safety, story writing)
- Structured output validation using `StructuredOutputBotMixin` and Zod schemas
- Complex prompt engineering with HTML output and image placeholders
- Image generation through the broker client's `generateImage()` API
- Blob storage retrieval and base64 encoding for inline images
- HTML assembly by replacing template placeholders with generated content
- PDF generation using the doc-proc service
- Multi-stage pipeline orchestration in a `RunnableEntity` with `appendCall()` and `yield*`
- Parallel image generation with `HierarchicalTaskPoolRunner` and hierarchical `CapacitySource`
- Custom API endpoints for triggering pipelines and consuming progress via iterators

## What You'll Build

By the end of this series, you'll have a complete **Illustrated Children's Storybook Generator** that:

- Accepts a topic from the user and validates it for child-appropriateness
- Generates an illustrated story with rich HTML formatting and image prompts
- Produces images via the broker's image generation service
- Retrieves generated images from blob storage and encodes them inline
- Assembles a fully illustrated HTML document with embedded images
- Converts the final HTML to a downloadable PDF
- Stores the result in working memory for retrieval
- Exposes REST endpoints for creating stories and polling progress

## Prerequisites

- Completion of (or familiarity with) the [report-generator tutorial](../report-generator/README.md) -- this tutorial assumes you understand entities, bots, prompts, working memory, and deployment basics
- [FireFoundry local development environment](../../../local-development/README.md) or access to a deployed FireFoundry cluster
- [ff-cli installed and configured](../../../local-development/ff-cli-setup.md)
- Node.js 20+
- TypeScript knowledge
- Familiarity with [FireFoundry core concepts](../fire_foundry_core_concepts_glossary_agent_sdk.md)

## Tutorial Parts

| Part | Title | What You Build | Key Concepts |
|------|-------|---------------|--------------|
| [1](./part-01-setup-and-safety.md) | Project Setup & Content Safety Bot | Scaffolded project with a content safety bot that validates topics | Project scaffolding, `StructuredOutputBotMixin`, Zod schema validation |
| [2](./part-02-story-writer.md) | Story Writer Bot & Prompts | Bot that generates an illustrated HTML story with image prompts | Complex prompt engineering, HTML output with `{{IMAGE_N}}` placeholders, prompt composition |
| [3](./part-03-image-generation.md) | Image Generation Service | Service that generates images and embeds them into HTML | Broker client `generateImage()`, blob storage retrieval, base64 encoding, HTML assembly |
| [4](./part-04-pipeline-and-api.md) | Pipeline Orchestration & API Endpoints | `StoryPipelineEntity` orchestrator with REST endpoints | `RunnableEntity` with custom `run_impl()`, `appendCall()` + `yield*`, `@ApiEndpoint` decorator |
| [5](./part-05-parallel-image-generation.md) | Parallel Image Generation | Concurrent image generation with capacity management | `HierarchicalTaskPoolRunner`, hierarchical `CapacitySource`, `SourceBufferObj`, `TaskProgressEnvelope` |

## Architecture Overview

Here's how the final application is structured:

```
User sends topic
       |
       v
POST /api/create-story
       |
       v
IllustratedStoryAgentBundle creates StoryPipelineEntity
       |
       v
StoryPipelineEntity.run_impl() — yields progress via iterator
       |
       |-- Stage 1: Content Safety Check
       |     appendCall(ContentSafetyCheckEntity) -> yield* start()
       |
       |-- Stage 2: Story Writing
       |     appendCall(StoryWriterEntity) -> yield* start()
       |
       |-- Stage 3: Parallel Image Generation
       |     HierarchicalTaskPoolRunner + CapacitySource
       |     (global: 10, per-story: 3)
       |
       |-- Stage 4: HTML Assembly
       |     Replace {{IMAGE_N}} with <img src="data:...">
       |
       |-- Stage 5: PDF Generation
       |     doc-proc service htmlToPdf()
       |
       |-- Stage 6: Store in Working Memory
       |
       v
ff-sdk-cli iterator run <entity_id> — consume progress
GET /api/story-status — poll for progress
```

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `illustrated-story/`.

---

**Ready to start?** Head to [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md).
