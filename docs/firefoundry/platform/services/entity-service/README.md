# Entity Service

## Overview

The Entity Service is a high-performance REST API that manages the FireFoundry Entity Graph, providing CRUD operations for nodes and edges with vector-based semantic search capabilities powered by PostgreSQL and pgvector.

## Purpose and Role in Platform

The Entity Service serves as the central knowledge store for FireFoundry agents, enabling them to:
- Store and retrieve structured entity data (nodes) and relationships (edges)
- Perform semantic similarity searches using vector embeddings
- Track execution state and progress through node I/O envelopes
- Query and traverse complex graph relationships
- Manage entity types, schemas, and metadata

This service acts as the persistent memory layer for agents, allowing them to build and query knowledge graphs over time.

## Key Features

- **Entity Graph CRUD**: Full create, read, update operations for nodes and edges with relationship traversal
- **Vector Semantic Search**: pgvector-powered similarity search for finding semantically related entities
- **Batch Insert Optimization**: Automatic batching of writes with configurable thresholds for high-throughput scenarios
- **Node I/O Tracking**: Store and append execution progress envelopes for workflow state management
- **Type-Safe Database Access**: Kysely query builder with full TypeScript type safety
- **Graph Traversal**: Recursive relationship queries with configurable depth and edge type filtering
- **API Response Caching**: Built-in apicache middleware for optimized read performance
- **Partitioned Storage**: Graph partitions allow logical separation of entity data across agent bundles

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 REST API Layer                      │
│              (Express 5 + Router)                   │
│         RouteManager: CRUD, Search, Vector          │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Business Logic Layer                   │
│              EntityProvider Class                   │
│  - Graph operations  - Vector search                │
│  - Batch management  - Relationship traversal       │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Data Access Layer                      │
│     Kysely Query Builder + PostgreSQL Pools         │
│    (Separate read/write connection pools)           │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│             PostgreSQL Database                     │
│          with pgvector Extension                    │
│  - entity.node (partitioned)                        │
│  - entity.edge (partitioned)                        │
│  - entity.vector_similarity (embeddings)            │
└─────────────────────────────────────────────────────┘
```

**Core Components:**
- **Service Class**: Express application lifecycle management with graceful shutdown
- **RouteManager**: RESTful endpoint definitions organized by capability (CRUD, search, vector, traversal)
- **EntityProvider**: Business logic for all entity graph operations
- **BatchInsertManager**: Configurable write batching with automatic flush on count or duration thresholds
- **PostgreSQL Connection Pools**: Separate read (fireread) and write (fireinsert) connection pools for scalability

## Documentation

- **[Concepts](./concepts.md)** — Entity graph model, nodes, edges, partitions, and data layout
- **[Getting Started](./getting-started.md)** — First steps: creating nodes, edges, and running queries
- **[Reference](./reference.md)** — Complete REST API reference, headers, request/response schemas
- **[Operations](./operations.md)** — Configuration, deployment, performance tuning, and monitoring

## Version and Maturity

- **Current Version**: 0.3.0-beta.0
- **Status**: Beta — Active development, API may change
- **Node.js Version**: 20+ required

## Repository

Source code: [ff-services-entity](https://github.com/firebrandanalytics/ff-services-entity)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [ff-eg-read CLI](../../../sdk/cli-tools/ff-eg-read.md) — Read-only CLI for querying the entity graph
- [ff-eg-write CLI](../../../sdk/cli-tools/ff-eg-write.md) — CLI for modifying the entity graph
- [ff-eg-admin CLI](../../../sdk/cli-tools/ff-eg-admin.md) — Admin operations (hard deletes, stats)
