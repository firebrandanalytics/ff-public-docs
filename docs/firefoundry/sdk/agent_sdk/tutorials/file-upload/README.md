# File Upload Tutorial

Build a file upload agent bundle with a web UI. You'll create an entity that accepts file uploads via FireFoundry's Working Memory system, then wire up a Next.js frontend with drag-and-drop support.

## What You'll Learn

- Scaffolding an application with an agent bundle and a GUI component
- Creating a custom entity that extends `DocumentProcessorEntity` for file handling
- Storing and retrieving files through Working Memory
- Using `RemoteAgentBundleClient` to connect a web UI to an agent bundle
- Testing file uploads with `ff-sdk-cli`

## What You'll Build

An agent bundle with a `FileUploadTestEntity` that handles file uploads and stores them in Working Memory, plus a Next.js web UI with drag-and-drop file uploading and file listing.

## Prerequisites

- `ff-cli` installed and configured
- Access to a FireFoundry cluster (or local dev environment)
- Node.js 20+
- `pnpm` package manager

## Parts

| Part | Title | Topics |
|------|-------|--------|
| [Part 1](./part-01-bundle.md) | Agent Bundle | Scaffolding, entity creation, bundle wiring, deploy, test with ff-sdk-cli |
| [Part 2](./part-02-gui.md) | Web UI | RemoteAgentBundleClient, API routes, drag-and-drop upload page |

## Related

- [DocumentProcessorEntity Reference](../../reference/document-processor-entity.md) -- API reference for the file upload base class used in this tutorial
- [Working Memory Guide](../../guides/working-memory.md) -- concepts and SDK integration for Working Memory
- [File Upload Patterns](../../feature_guides/file-upload-patterns.md) -- comprehensive patterns including retrieval, pipelines, and error handling
- [Report Generator Tutorial](../report-generator/README.md) -- multi-part tutorial covering entities, bots, prompts, and LLM integration
