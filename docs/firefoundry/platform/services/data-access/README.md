# Data Access Service

## Overview

The Data Access Service is a gRPC/REST API that provides secure, multi-database SQL access for AI agents and applications. It supports raw SQL queries, structured AST (Abstract Syntax Tree) queries, staged cross-database federation, and per-identity scratch pads for conversational data analysis.

## Purpose and Role in Platform

### An AI-Friendly Data Layer You Don't Have to Rebuild

Enterprise data lives in databases you can't change — production warehouses, regulated systems, vendor-managed platforms, legacy schemas with decades of organic growth. The Data Access Service sits between AI agents and these existing databases, providing a **semantic mediation layer** that makes any data source AI-ready without modifying the underlying infrastructure.

This is the key value proposition: **you don't change your data layer to fit the AI — the service adapts the AI's access to fit your data layer.** The service handles dialect translation, access control, credential isolation, and query governance so that AI agents can work with enterprise data safely and effectively.

### What This Enables

- **Unified multi-database access**: 7 database backends (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, Databricks) through a single API — agents don't need to know which database they're talking to
- **Structured queries for AI**: The AST Query API lets AI agents express intent as structured JSON rather than generating raw SQL, eliminating SQL injection risks and enabling validation before execution
- **Cross-database federation**: Staged queries pull data from different databases and combine results, letting agents work across data silos without ETL
- **Conversational data analysis**: Per-identity scratch pads persist intermediate results across requests, enabling multi-step analytical workflows
- **AI-curated data objects**: Stored definitions (views, UDFs, TVFs) present curated, AI-friendly abstractions over raw schemas — the AI sees meaningful business objects, not implementation details
- **Fine-grained governance**: Table/column ACL, function blacklisting, and audit logging ensure AI agents only access what they're authorized to see

### Toward a Data Catalog and Governance Platform

The service is evolving beyond query execution into **data governance and discovery**:

- **Data Catalog**: Machine-readable metadata about available connections, tables, columns, types, relationships, and business context — enabling AI agents to autonomously discover and understand data assets
- **Data Dictionary**: Semantic annotations on tables and columns (descriptions, business meaning, sensitivity classifications, data quality indicators) that help AI agents make informed decisions about which data to use and how to interpret results
- **Ontologies**: Formal domain models that describe entity relationships, hierarchies, and business rules — giving AI agents a structured understanding of how data concepts relate to each other across databases
- **AI Navigation Skills**: Rather than hard-coding data knowledge into each agent, the service can host and serve **data navigation skills** — reusable knowledge packages that teach AI agents how to explore, query, and interpret specific data domains

These capabilities complement the existing stored definitions (views/UDFs) by adding the **discovery and understanding layer** that precedes query construction: before an AI writes a query, it needs to know what data exists, what it means, and how to navigate it.

## Key Features

- **Multi-Database Support**: PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, and Databricks — 7 backends with dialect-specific SQL generation (see [Database Support](#database-support) below)
- **AST Query API**: Submit structured JSON queries — validated, access-controlled, and dialect-translated
- **Staged Queries**: Execute federated pre-queries across different connections, with results injected as CTEs
- **Scratch Pad**: Per-identity SQLite databases for persisting intermediate results across requests
- **Dialect Translation**: Automatic SQL generation handling quoting, functions, and type casting per backend
- **Function Pass-Through + Blacklisting**: Any database-native function works; dangerous functions are blocked
- **Table/Column ACL**: Fine-grained access control enforced by AST inspection
- **Stored Definitions**: Virtual views, scalar UDFs, and table-valued functions that expand at query time
- **Credential Management**: Environment-variable-based credentials with zero-downtime rotation
- **Admin API**: REST endpoints for connection CRUD, credential rotation, and view management
- **Audit Logging**: All operations logged with identity, connection, SQL hash, and duration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                                │
│            gRPC (:50051) + REST Gateway (:8080)             │
│   Query | Execute | QueryAST | TranslateAST | GetSchema    │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  Auth & ACL Layer                             │
│   API Key Auth → Identity Extraction → Connection ACL        │
│                                      → Table/Column ACL      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              AST Processing Pipeline                         │
│   Validate → Blacklist Check → View/UDF Expansion →          │
│   Table/Column ACL → Serialize to Dialect SQL                │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│            Staged Execution Engine                            │
│   Dependency Graph → Topological Sort → Tier-by-Tier         │
│   Parallel Execution → VALUES CTE Injection                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              Database Adapter Layer                           │
│   PostgreSQL | MySQL | SQLite | SQL Server | Oracle          │
│   Snowflake | Databricks | Scratch Pad (SQLite)              │
│   (Connection pooling, type normalization, timeouts)         │
└─────────────────────────────────────────────────────────────┘
```

## What's New

### Staged Queries (Phase 3A)
Execute pre-queries against different database connections, with results automatically injected as VALUES CTEs into downstream queries. Enables cross-database federation patterns like querying PostgreSQL and MySQL results together in SQLite.

### Scratch Pad (Phase 3A)
Per-identity SQLite databases for persisting intermediate results. Use `save_as` on any QueryAST request to save results, then query them in subsequent requests using the `scratch:<identity>` connection.

### Dictionary Integration (Phase 3)
Stored view definitions now appear as first-class entries in `GetSchema` responses alongside real database tables (type `stored_view`). When views are created or updated via the Admin API, a probe query (LIMIT 1) automatically infers output column types if no explicit schema is provided. Namespace visibility filtering ensures agent-scoped views are only visible to the owning agent.

### Enterprise Database Support (Phase 3D)
Full adapter and serializer implementations for SQL Server, Oracle, Snowflake, and Databricks. Each includes dialect-specific SQL generation (quoting, parameter styles, LIMIT/OFFSET syntax, boolean literals, function translation), VALUES CTE renderers for staged queries, and type normalization.

## Database Support

The service architecture is designed for broad database support. Each database requires an adapter (connection/pooling/metadata) and a dialect serializer (SQL generation).

### Tier 1: Foundation (Current)

| Database | Status |
|----------|--------|
| PostgreSQL 13+ | **Supported** |
| MySQL 8+ | **Supported** |
| SQLite 3.35+ | **Supported** |

### Tier 2: Enterprise

| Database | Driver | Status |
|----------|--------|--------|
| SQL Server | `microsoft/go-mssqldb` | **Supported** (adapter + serializer) |
| Oracle | `sijms/go-ora/v2` | **Supported** (adapter + serializer) |
| Snowflake | `snowflakedb/gosnowflake` | **Supported** (adapter + serializer) |
| Databricks | `databricks/databricks-sql-go` | **Supported** (adapter + serializer) |

> **Note:** Tier 2 adapters are fully implemented with real drivers but E2E tests require live database instances. Unit tests cover DSN building, parameter translation, type normalization, and SQL generation for all 4 backends.

### Tier 3: Extended (Planned)

Wire-compatible databases that can reuse existing adapters with dialect adjustments:
- **MariaDB**, **SingleStore** (MySQL-compatible)
- **CockroachDB**, **Greenplum**, **Amazon Redshift** (PostgreSQL-compatible)

Specialized databases with their own adapters:
- **ClickHouse**, **Trino**, **Vertica**, **DuckDB**, **Teradata**, **Google BigQuery**

## Documentation

- **[Concepts](./concepts.md)** — Core concepts: AST queries, staged queries, scratch pad, ACL model, stored definitions
- **[Getting Started](./getting-started.md)** — Step-by-step tutorial from first connection to cross-database federation
- **[Reference](./reference.md)** — API reference: gRPC/REST endpoints, proto messages, config files, env vars, error codes

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
