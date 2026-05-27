# Data Discovery Agent

## Overview

The Data Discovery Agent is a FireFoundry system agent that auto-populates Data Access Service (DAS) metadata by inspecting a database connection with an LLM. Given the name of a DAS connection, the agent reads the live schema and a representative sample of rows, then proposes business-friendly table and column annotations, suggested entity types, and detected relationships — optionally writing the suggestions back into DAS as annotations. It turns what is otherwise hours of manual metadata work into a single API call with a human-reviewable report.

## Purpose and Role

The Data Access Service supports rich metadata layers — a data dictionary of annotations, an ontology of entity types and relationships, business process models, and reusable variables and patterns. These layers are what make DAS more than a SQL pass-through: they let the platform map natural-language questions onto the right tables and joins, classify sensitive data, and generate explainable queries. The catch is that metadata has to come from somewhere. For a database with dozens of tables and hundreds of columns, annotating every table and column by hand is a significant barrier to adoption.

The Data Discovery Agent removes that barrier. Application developers and platform operators can run discovery against any DAS connection and receive a structured report that they can review, edit, and apply. The default mode is dry-run: the agent proposes, a human reviews, and applying suggestions is an explicit action.

Typical use cases:

- Bootstrapping DAS metadata for a newly-onboarded database
- Detecting PII, financial, or otherwise sensitive columns across a database
- Generating an initial ontology of entity types and relationships for a domain
- Producing review-ready documentation of an unfamiliar schema

## Key Features

- **Schema and sample analysis** — Reads DAS schema context, sample rows, and per-column statistics; combines them into a prompt the LLM can reason over
- **Table annotation suggestions** — Proposes a business name, description, tags, and grain (what one row means) for each table
- **Column annotation suggestions** — Proposes a business name, description, semantic type, data classification (public, internal, confidential, PII, PHI, financial), and tags for each column
- **Entity type suggestions** — Proposes ontology entity types with descriptions and structural clues
- **Relationship suggestions** — Detects likely relationships between tables with a verb, cardinality (`1:1`, `1:N`, `N:M`), confidence score, and SQL join hint
- **Dry-run by default** — Returns suggestions for human review; `apply=true` writes annotations back to DAS in one step
- **Scoped runs** — Restrict discovery to a specific list of tables or a maximum-table cap to keep runs targeted

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/discover` | Run discovery against a DAS connection and return a structured report. Optionally apply the suggestions to DAS. |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### Request: `POST /api/discover`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `connection` | string | yes | — | DAS connection name to discover |
| `tables` | string[] | no | — | Optional list of tables to scope discovery to |
| `maxTables` | int (1–100) | no | `20` | Maximum number of tables to process in one run |
| `apply` | boolean | no | `false` | When `true`, write annotations back to DAS. When `false`, return suggestions only. |
| `ontologyDomain` | string | no | — | Ontology domain to anchor entity-type suggestions in |
| `domainContext` | string | no | — | Free-form context about the database or business domain to steer the LLM |

### Response

A discovery report with separate sections for table annotations, column annotations, entity types, and relationships:

```json
{
  "connection": "warehouse-prod",
  "discoveredAt": "2026-05-27T15:24:11Z",
  "tablesAnalyzed": 18,
  "tableAnnotations": [
    {
      "table": "customer_orders",
      "businessName": "Customer Orders",
      "description": "One row per submitted order. Joins to customers and order_lines.",
      "tags": ["sales", "transactional"],
      "grain": "One row per order",
      "usageNotes": "status = 3 indicates fulfilled"
    }
  ],
  "columnAnnotations": [
    {
      "table": "customer_orders",
      "column": "customer_email",
      "businessName": "Customer Email",
      "description": "Email address captured at checkout",
      "semanticType": "email",
      "dataClassification": "pii",
      "tags": ["contact"]
    }
  ],
  "entityTypeSuggestions": [
    {
      "name": "Order",
      "description": "A purchase made by a customer",
      "table": "customer_orders",
      "connection": "warehouse-prod",
      "clues": ["surrogate primary key", "foreign key to customers", "timestamp column"],
      "hierarchyLevel": 2
    }
  ],
  "relationshipSuggestions": [
    {
      "fromEntity": "Order",
      "toEntity": "Customer",
      "verb": "placed_by",
      "cardinality": "1:1",
      "confidence": 0.95,
      "joinHint": "customer_orders.customer_id = customers.id"
    }
  ],
  "summary": "Discovered 18 tables across sales, fulfillment, and customer domains..."
}
```

### Example

Dry-run discovery on a connection, restricted to a handful of tables:

```bash
curl -X POST "https://<gateway-host>/api/discover" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "warehouse-prod",
    "tables": ["customer_orders", "customers", "order_lines"],
    "ontologyDomain": "sales",
    "domainContext": "Direct-to-consumer e-commerce platform; status codes follow internal coding sheet."
  }'
```

To apply the suggestions after reviewing them, re-run with `"apply": true`.

### Recommended Pattern

The discovery agent is designed for an "agent proposes, human reviews" loop:

1. Run discovery in dry-run mode against a new connection
2. Review the report — edit, drop, or accept individual suggestions
3. Re-run targeted discovery for any tables that need a second pass
4. Apply the final set of accepted suggestions to DAS
5. Use DAS metadata-aware features (semantic search, NL-to-SQL, ACL) with the populated catalog

## Dependencies

The Data Discovery Agent calls:

- **FF Broker** — LLM analysis of schema and sample data
- **Data Access Service** — Schema context, sampling, statistics, and (when `apply=true`) annotation writes

## Configuration

The agent is configured via environment variables (see the bundle's `.env.template` for the full list). The main groups are:

- **Service endpoints** — URLs for the broker and Data Access Service
- **Service settings** — HTTP port, environment name

## Repository

Source code: [ff-app-system / data-discovery-bundle](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/data-discovery-bundle)

## Related Documentation

- [System Agents Catalog](./README.md)
- [Data Access Service](../services/data-access/README.md) — Target of discovery; consumes the annotations the agent produces
- [FF Broker](../services/ff-broker/README.md) — Routes the agent's LLM calls
