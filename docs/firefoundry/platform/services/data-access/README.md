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
- **Credential Management**: Connections reference provisioned credentials by name (never inline passwords), with zero-downtime rotation
- **Admin API**: REST endpoints for connection CRUD, credential rotation, view management, annotation management, variable/mapping management, ontology management, and process management
- **Dictionary Query API**: Non-admin read-only access to data dictionary with tag inclusion/exclusion, semantic type, and classification filters
- **Named Entity Resolution (NER)**: Value stores with fuzzy matching engine — resolves user terms ("Microsoft") to database values ("MICROSOFT CORP") with ranked candidates, personalized scopes, and a learning loop
- **Data Wrangling**: Validation and transformation pipeline — WrangleSpec JSON definitions, column-level rules (type coercion, trim, case, currency parsing, fuzzy matching, pattern validation), built-in templates, spec storage, and CSV upload+wrangle in one step
- **CSV Upload & Export**: Upload CSV files into scratch pads for ad-hoc analysis; export any query result or scratch pad table as CSV
- **Audit API**: Query execution history with filtering by connection, identity, time range, slow queries, and error status
- **Audit Logging**: All operations logged with identity, connection, status, and duration

## Architecture Overview

The Data Access Service sits between your agent bundle (or other client) and the databases your app needs. Your code sends SQL or structured AST queries plus a caller identity; the service applies access control, stored definitions, and row-level security, runs the query against the right database, and returns rows. The knowledge layers (dictionary, ontology, process models, value stores) are read through the same service to give your agents business context.

```
┌──────────────────────────────┐      ┌──────────────────────────┐
│ Agent bundle / app backend   │      │ Admin tooling (ff-da,    │
│ @firebrandanalytics/         │      │ scripts, data stewards)  │
│   data-access-client         │      │ connections, dictionary, │
│ ff-da CLI / REST / gRPC      │      │ views, ontology, NER ... │
└──────────────┬───────────────┘      └────────────┬─────────────┘
   query / schema / dictionary /                   │ /admin/*
   ontology / process / resolve-values             │
               ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Data Access Service                          │
│  auth + caller identity → ACL → stored views / RLS → execution   │
│  knowledge layers · scratch pads · wrangling · CSV import/export │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┘
       ▼              ▼              ▼              ▼
  PostgreSQL       MySQL /       Snowflake /     Per-identity
  warehouse        SQL Server    Databricks /    scratch pads
                   / Oracle      SQLite          (SQLite)
```

Query activity is recorded for auditing and can be read back through the [Audit API](./reference.md#audit-api).

## Database Support

### Supported

| Database | Status |
|----------|--------|
| PostgreSQL 13+ | **Supported** |
| MySQL 8+ | **Supported** |
| SQLite 3.35+ | **Supported** |
| SQL Server | **Supported** — less field-tested; validate against your own instance |
| Oracle | **Supported** — less field-tested; validate against your own instance |
| Snowflake | **Supported** — less field-tested; validate against your own instance |
| Databricks | **Supported** — less field-tested; validate against your own instance |

### Planned

- **MariaDB**, **SingleStore** (MySQL-compatible)
- **CockroachDB**, **Greenplum**, **Amazon Redshift** (PostgreSQL-compatible)
- **ClickHouse**, **Trino**, **Vertica**, **DuckDB**, **Teradata**, **Google BigQuery**

## Documentation

- **[Concepts](./concepts.md)** — Core concepts: AST queries, staged queries, scratch pad, ACL model, stored definitions, data dictionary
- **[Getting Started](./getting-started.md)** — Step-by-step tutorial from first connection to cross-database federation and building a data dictionary
- **[FireKicks Tutorial](./firekicks/)** — Multi-part walkthrough using the FireKicks retail dataset: connection setup, data dictionary, stored definitions, ontology, process models, context-aware querying, NER value resolution, and CSV upload
- **[Reference](./reference.md)** — API reference: gRPC/REST endpoints, dictionary query API, admin API, proto messages, connection/ACL configuration, client libraries, error codes
- **[Operations](./operations.md)** — Enabling the service for your app, connecting from a bundle, verifying, limits, and troubleshooting

## Guides & References

- **[Data Wrangling](./wrangling.md)** — WrangleSpec format, column rules, built-in templates, API endpoints, scratch pad integration, and pipeline patterns
- **[Regex Pattern Library](./regex-patterns.md)** — Curated, cross-database regex patterns for use with the AST `regex_match` expression: email, phone, financial, date/time, identifiers, URLs, and data quality checks

## Version and Maturity

- **Helm chart**: `data-access` 0.1.0, packaged as an optional sub-chart of `firefoundry-core` (disabled by default)
- **Status**: Optional service. PostgreSQL, MySQL, and SQLite are the most exercised backends; see [Database Support](#database-support) for the others
- **Client libraries**: TypeScript (`@firebrandanalytics/data-access-client`), Python (`ff-data-access`), and the `ff-da` CLI

## Repository

Source code: ff-services-data-access (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [ff-da CLI](../../../sdk/cli-tools/ff-da.md)
- [Query Explainer tutorial](../../../sdk/agent_sdk/tutorials/query-explainer/README.md) — building an agent bundle on the Data Access Service
