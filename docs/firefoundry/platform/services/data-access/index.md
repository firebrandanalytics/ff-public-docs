# Data Access Service

## Overview

The Data Access Service is a gRPC/REST API that provides secure, multi-database SQL access for AI agents and applications. It supports raw SQL queries, structured AST (Abstract Syntax Tree) queries, staged cross-database federation, and per-identity scratch pads for conversational data analysis.

## Purpose and Role in Platform

The Data Access Service enables FireFoundry agents and applications to:
- Query data across PostgreSQL, MySQL, and SQLite databases through a single unified API
- Construct structured queries as JSON ASTs that are validated, dialect-translated, and access-controlled
- Execute cross-database federated queries using staged query pipelines
- Persist intermediate results in per-identity scratch pads for multi-step analysis
- Leverage stored definitions (views, UDFs, TVFs) that appear as real database objects
- Preview generated SQL before execution for debugging and validation

This service acts as the secure data layer for AI agents, abstracting away database-specific SQL syntax and enforcing access controls that prevent unauthorized data access.

## Key Features

- **Multi-Database Support**: PostgreSQL, MySQL, and SQLite today; SQL Server, Oracle, Snowflake, and Databricks planned next (see [Database Support](#database-support) below)
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
│   PostgreSQL | MySQL | SQLite | Scratch Pad (SQLite)         │
│   (Connection pooling, type normalization, timeouts)         │
└─────────────────────────────────────────────────────────────┘
```

## What's New

### Staged Queries (Phase 3A)
Execute pre-queries against different database connections, with results automatically injected as VALUES CTEs into downstream queries. Enables cross-database federation patterns like querying PostgreSQL and MySQL results together in SQLite.

### Scratch Pad (Phase 3A)
Per-identity SQLite databases for persisting intermediate results. Use `save_as` on any QueryAST request to save results, then query them in subsequent requests using the `scratch:<identity>` connection.

## Database Support

The service architecture is designed for broad database support. Each database requires an adapter (connection/pooling/metadata) and a dialect serializer (SQL generation).

### Tier 1: Foundation (Current)

| Database | Status |
|----------|--------|
| PostgreSQL 13+ | **Supported** |
| MySQL 8+ | **Supported** |
| SQLite 3.35+ | **Supported** |

### Tier 2: Enterprise (Planned)

| Database | Driver | Status |
|----------|--------|--------|
| SQL Server | `microsoft/go-mssqldb` | Planned |
| Oracle | `sijms/go-ora` | Planned |
| Snowflake | `snowflakedb/gosnowflake` | Planned |
| Databricks | `databricks/databricks-sql-go` | Planned |

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
