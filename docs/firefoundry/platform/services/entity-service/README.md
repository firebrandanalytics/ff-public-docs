# Entity Service

## Overview

The Entity Service is the REST API behind the FireFoundry Entity Graph. It stores your application's entities (nodes) and the relationships between them (edges), records the input, output, and progress of runnable entities, and offers property, JSON, and vector-similarity search over them.

## Purpose and Role in Platform

The Entity Service is the persistent memory for your agent bundles. When your bundle creates an entity, runs a workflow or bot, or links two entities together, that state lands in the entity graph through this service. As an app builder you use it to:

- Model your application's domain as typed entities and relationships
- Persist workflow and bot inputs, outputs, and progress so runs can be monitored and resumed
- Query and traverse related data (for example, "all documents under this case")
- Find semantically similar entities using embeddings

Most bundles never call the REST API directly: the Agent SDK's entity client (`createEntityClient(APP_ID)`) and entity classes call it for you. The REST API and the `ff-eg-*` CLIs are useful for debugging, scripts, and non-SDK clients.

## Key Features

- **Entity Graph CRUD**: Create, read, and update nodes and edges; soft-delete (archive) nodes
- **Relationship Traversal**: Follow incoming/outgoing edges, filter by edge type, or filter connected nodes with JSONPath
- **Search**: Condition-based node search (scoped to your agent bundle or global), JSON containment and JSONPath queries on entity data
- **Vector Similarity Search**: Store embeddings for nodes and find similar entities by node or by raw vector
- **Node I/O and Progress**: Store runnable-entity input/output and an append-only timeline of progress envelopes
- **Graph Partitions and Bundle Scoping**: Keep each application's data logically separate

## Architecture Overview

```
┌──────────────────────────────┐   ┌──────────────────────────┐
│  Your Agent Bundle           │   │  CLIs / scripts          │
│  (Agent SDK entity client,   │   │  ff-eg-read, ff-eg-write │
│   entity classes, workflows) │   │  ff-eg-admin, curl       │
└──────────────┬───────────────┘   └────────────┬─────────────┘
               │ REST (HTTP/JSON)               │
               ▼                                ▼
        ┌─────────────────────────────────────────────┐
        │               Entity Service                 │
        │  nodes · edges · search · vectors · node I/O │
        └─────────────────────────────────────────────┘
               ▲                                ▲
               │                                │
┌──────────────┴───────────────┐   ┌────────────┴─────────────┐
│ Other platform services that │   │ Console / diagnostics    │
│ build on the graph (e.g.     │   │ tools that read entity   │
│ Knowledge, Context services) │   │ state and progress       │
└──────────────────────────────┘   └──────────────────────────┘
```

Your bundle is the primary writer of its own entities. Other platform services, the console, and the diagnostic CLIs read (and in some cases write) the same graph, which is why entity state is the main thing you inspect when debugging a bundle.

## Documentation

- **[Concepts](./concepts.md)** — Entity graph model, nodes, edges, partitions, progress envelopes, vector search, and design guidance
- **[Getting Started](./getting-started.md)** — Create, link, query, and search entities from the SDK, CLI, and REST API
- **[Reference](./reference.md)** — REST API reference: headers, endpoints, request/response shapes, errors
- **[Operations](./operations.md)** — Enabling the service, connecting a bundle, verifying, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.3.0
- **Deployment**: Enabled by default in `firefoundry-core`

## Repository

Source code: [ff-services-entity](https://github.com/firebrandanalytics/ff-services-entity)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Agent SDK: Entities](../../../sdk/agent_sdk/core/entities.md)
- [Agent SDK: Entity Graph](../../../sdk/agent_sdk/entity_graph/README.md)
- [ff-eg-read CLI](../../../sdk/cli-tools/ff-eg-read.md) — Read-only CLI for querying the entity graph
- [ff-eg-write CLI](../../../sdk/cli-tools/ff-eg-write.md) — CLI for modifying the entity graph
- [ff-eg-admin CLI](../../../sdk/cli-tools/ff-eg-admin.md) — Admin operations (hard deletes, stats)
