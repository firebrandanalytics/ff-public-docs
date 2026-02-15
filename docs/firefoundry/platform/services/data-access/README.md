# Data Access Service

## Overview

The Data Access Service is a gRPC/REST API that provides secure, multi-database SQL access for AI agents and applications. It supports raw SQL queries, structured AST (Abstract Syntax Tree) queries, staged cross-database federation, and per-identity scratch pads for conversational data analysis.

## Purpose and Role in Platform

### An AI-Friendly Data Layer You Don't Have to Rebuild

Enterprise data lives in databases you can't change — production warehouses, regulated systems, vendor-managed platforms, legacy schemas with decades of organic growth. The Data Access Service sits between AI agents and these existing databases, providing a **semantic mediation layer** that makes any data source AI-ready without modifying the underlying infrastructure.

This is the key value proposition: **you don't change your data layer to fit the AI — the service adapts the AI's access to fit your data layer.** The service handles access control, credential isolation, query governance, and semantic enrichment so that AI agents can work with enterprise data safely and effectively.

### What This Enables

- **Unified multi-database access**: 7 database backends (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, Databricks) through a single API with consistent authentication, ACL, and query structure
- **Structured queries for AI**: The AST Query API lets AI agents express intent as structured JSON rather than generating raw SQL, eliminating SQL injection risks and enabling validation before execution
- **Cross-database federation**: Staged queries pull data from different databases and combine results, letting agents work across data silos without ETL
- **Conversational data analysis**: Per-identity scratch pads persist intermediate results across requests, enabling multi-step analytical workflows
- **AI-curated data objects**: Stored definitions (views, UDFs, TVFs) present curated, AI-friendly abstractions over raw schemas — the AI sees meaningful business objects, not implementation details
- **Fine-grained governance**: Table/column ACL, function blacklisting, and audit logging ensure AI agents only access what they're authorized to see

### Five-Layer Knowledge Architecture

The service provides a layered knowledge architecture that goes beyond query execution into **data governance and discovery**:

| Layer | Name | Description |
|-------|------|-------------|
| 1 | **Catalog** | Schema discovery — tables, columns, types |
| 2 | **Dictionary** | Semantic annotations, tags, statistics, constraints, relationships |
| 3 | **Ontology** | Formal domain models, entity relationships, hierarchies |
| 4 | **Process Models** | Business process flows, decision points, step sequences |
| 5 | **Scratch Pad** | Per-identity conversational state for multi-step analysis |

The data dictionary (Layer 2) is particularly important for AI: it provides descriptions, business names, semantic types, data classifications, statistics, constraints, relationships, quality notes, and usage guidance — all queryable with tag-based filtering so AI agents see only the curated data they need.

## Key Features

- **Multi-Database Support**: PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, and Databricks — 7 backends (see [Database Support](#database-support) below)
- **AST Query API**: Submit structured JSON queries — validated, access-controlled, and serialized with correct identifier quoting and parameter placeholders for the target database
- **SQL-to-AST Pipeline**: Parse PostgreSQL-dialect SQL into AST, then process through the full validation/ACL/expansion pipeline
- **EXPLAIN Plans**: Get database execution plans from AST or SQL queries, with optional ANALYZE mode
- **Staged Queries**: Execute federated pre-queries across different connections, with results injected as CTEs
- **Scratch Pad**: Per-identity SQLite databases for persisting intermediate results across requests
- **Unopinionated SQL Gateway**: SQL constructs are passed through to the upstream database. The service handles identifier quoting, parameter placeholder styles, and boolean literal formatting per backend, but does not translate SQL syntax between databases — agents use the SQL constructs their target database supports
- **Function Pass-Through + Blacklisting**: Any database-native function works; dangerous functions are blocked
- **Table/Column ACL**: Fine-grained access control enforced by AST inspection
- **Data Dictionary**: Semantic annotations on tables and columns — descriptions, business names, statistics, constraints, relationships, quality notes, and tag-based filtering for AI routing
- **Stored Definitions**: Virtual views, scalar UDFs, and table-valued functions that expand at query time
- **Variables & Row-Level Security**: Named variables resolved at query time from request context, with security predicates that automatically filter data per caller identity
- **Identity Mapping Tables**: DAS-managed key-value lookups that translate between identity systems (e.g., email → customer_id)
- **Ontology Service**: Maps business concepts to database structures — entity types, relationships, column mappings, and concept hierarchies for AI entity resolution
- **Process Model Service**: Encodes business rules, calendar contexts, tribal knowledge, and process steps that inform query generation
- **Credential Management**: Environment-variable-based credentials with zero-downtime rotation
- **Admin API**: REST endpoints for connection CRUD, credential rotation, view management, annotation management, variable/mapping management, ontology management, and process management
- **Dictionary Query API**: Non-admin read-only access to data dictionary with tag inclusion/exclusion, semantic type, and classification filters
- **Named Entity Resolution (NER)**: Value stores with fuzzy matching engine — resolves user terms ("Microsoft") to database values ("MICROSOFT CORP") with ranked candidates, personalized scopes, and a learning loop
- **CSV Upload & Export**: Upload CSV files into scratch pads for ad-hoc analysis; export any query result or scratch pad table as CSV
- **Audit API**: Query execution history with filtering by connection, identity, time range, slow queries, and error status
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
│   Table/Column ACL → Serialize to SQL                        │
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

## Database Support

The service architecture is designed for broad database support. Each database requires an adapter (connection/pooling/metadata) and a serializer (identifier quoting, parameter placeholders, boolean literals).

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

> **Note:** Tier 2 adapters are fully implemented with real drivers. E2E tests require live database instances; unit tests cover DSN building, parameter placeholders, type normalization, and SQL serialization for all 4 backends.

### Tier 3: Extended (Planned)

Wire-compatible databases that can reuse existing adapters with minor adjustments:
- **MariaDB**, **SingleStore** (MySQL-compatible)
- **CockroachDB**, **Greenplum**, **Amazon Redshift** (PostgreSQL-compatible)

Specialized databases with their own adapters:
- **ClickHouse**, **Trino**, **Vertica**, **DuckDB**, **Teradata**, **Google BigQuery**

## Documentation

- **[Concepts](./concepts.md)** — Core concepts: AST queries, staged queries, scratch pad, ACL model, stored definitions, data dictionary
- **[Getting Started](./getting-started.md)** — Step-by-step tutorial from first connection to cross-database federation and building a data dictionary
- **[FireKicks Tutorial](./firekicks/)** — Multi-part walkthrough using the FireKicks retail dataset: connection setup, data dictionary, stored definitions, ontology, process models, context-aware querying, NER value resolution, and CSV upload
- **[Reference](./reference.md)** — API reference: gRPC/REST endpoints, dictionary query API, admin API, proto messages, config, env vars, error codes

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
