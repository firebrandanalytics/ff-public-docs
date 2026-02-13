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
- Customizable illustration styles, quality, aspect ratio, and illustration count
- Reference character images for visual consistency across scenes
- Input validation, XSS prevention, and graceful error handling
- Next.js web UI with SSE progress streaming and PDF download

## What You'll Build

By the end of this series, you'll have a complete **Illustrated Children's Storybook Generator** that:

- Accepts a topic from the user and validates it for child-appropriateness
- Lets users customize illustration style, quality, aspect ratio, and scene count
- Generates an illustrated story with rich HTML formatting and image prompts
- Produces character reference images for visual consistency across scenes
- Generates scene images in parallel via the broker's image generation service
- Retrieves generated images from blob storage and encodes them inline
- Assembles a fully illustrated HTML document with embedded images
- Converts the final HTML to a downloadable PDF
- Stores the result in working memory for retrieval
- Exposes REST endpoints for creating stories and polling progress
- Provides a Next.js web UI with real-time SSE progress streaming and PDF download

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
| [5](./part-05-parallel-image-generation.md) | Parallel Image Generation | Entity-based concurrent image generation with capacity management | `ImageGenerationEntity`, `appendOrRetrieveCall()`, `parallelCalls()`, `SourceFromIterable`, `HierarchicalTaskPoolRunner`, hierarchical `CapacitySource` |
| [6](./part-06-customization-and-styles.md) | Customization Types & Style Selection | Configurable illustration styles, quality, and layout options | Union types for constrained options, `STYLE_DESCRIPTIONS` map, dynamic prompt sections from request args |
| [7](./part-07-reference-images.md) | Reference Images & Character Consistency | Character reference sheet generation for visual consistency | Conditional prompt sections, LLM-driven reference decisions, text-based character consistency |
| [8](./part-08-input-validation.md) | Input Validation & Error Handling | Defensive coding layer with validation, XSS prevention, failed image tracking | API boundary validation, HTML escaping, `condition()` branching, partial completion (`completed_with_errors`) |
| [9](./part-09-web-ui.md) | Building the Web UI | Next.js 15 frontend with customization form and API proxies | `RemoteAgentBundleClient`, `serverExternalPackages`, Tailwind theme, route proxy pattern |
| [10](./part-10-streaming-and-downloads.md) | SSE Progress Streaming & Downloads | Real-time progress via SSE, result display, PDF download | `start_iterator()`, SSE with `ReadableStream`, `useStoryGeneration` hook, state machine pattern |

## Architecture Overview

Here's how the final application is structured:

```
User enters topic + customization (style, quality, ratio, count)
       |
       v
Next.js GUI (story-gui)
       |-- POST /api/create → bundle POST /api/create-story
       |-- GET /api/progress → SSE via bundle start_iterator()
       |-- GET /api/download → bundle GET /api/download (binary)
       |
       v
IllustratedStoryAgentBundle creates StoryPipelineEntity
       |
       v
StoryPipelineEntity.run_impl() — yields progress via iterator
       |
       |-- Stage 1: Content Safety Check
       |     appendOrRetrieveCall(ContentSafetyCheckEntity) -> yield* start()
       |     condition('safety-gate', safe/rejected)
       |
       |-- Stage 2: Story Writing (with customization)
       |     appendOrRetrieveCall(StoryWriterEntity) -> yield* start()
       |     Dynamic prompt sections based on style, age range, illustration count
       |
       |-- Stage 2b: Reference Image (conditional)
       |     appendOrRetrieveCall(ImageGenerationEntity, 'reference-image')
       |     Only if needs_reference_image && no user-provided reference
       |
       |-- Stage 3: Parallel Image Generation (entity-based)
       |     parallelCalls(ImageGenerationEntity) + CapacitySource
       |     Character consistency suffix appended to each prompt
       |     (global: 10, per-story: 3)
       |
       |-- Stage 4: HTML Assembly (with XSS-safe alt text)
       |     Replace {{IMAGE_N}} with <img src="data:...">
       |
       |-- Stage 5: PDF Generation
       |     doc-proc service htmlToPdf()
       |
       |-- Stage 6: Store in Working Memory
       |
       v
GUI: SSE progress → ProgressPanel → ResultPanel → PDF download
CLI: ff-sdk-cli iterator run <entity_id> — consume progress
```

## Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `illustrated-story/`.

---

**Ready to start?** Head to [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md).
