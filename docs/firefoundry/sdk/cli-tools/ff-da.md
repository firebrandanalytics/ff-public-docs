# ff-da — Data Access Service CLI

Read-only CLI for querying databases, inspecting schemas, and accessing business metadata through the Data Access Service (DAS). Execute SQL queries, explore table structures, look up data dictionary annotations, and query ontology and process context.

## Installation

```bash
npm install -g @firebrandanalytics/ff-da
```

Verify:

```bash
ff-da --help
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_DATA_SERVICE_URL` | DAS base URL | `http://localhost:8080` |

### Port-Forward Setup

For remote DAS in Kubernetes:

```bash
kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080
```

### Global Options

| Option | Alias | Purpose | Default |
|--------|-------|---------|---------|
| `--serviceUrl` | `-u` | DAS URL (overrides env var) | `FF_DATA_SERVICE_URL` or `http://localhost:8080` |
| `--timeout` | `-t` | Request timeout in milliseconds | `30000` |

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ff-da connections` | List available database connections |
| `ff-da query <conn> --sql "..."` | Execute a SELECT query |
| `ff-da execute <conn> --sql "..."` | Execute an INSERT/UPDATE/DELETE statement |
| `ff-da schema <conn>` | List tables in a connection |
| `ff-da schema <conn> --table <t>` | Show columns for a table |
| `ff-da explain <conn> --sql "..."` | Explain a query execution plan |
| `ff-da dictionary tables` | List annotated tables |
| `ff-da dictionary columns --table <t>` | Get column business metadata |
| `ff-da ontology context <domain>` | Get domain ontology context |
| `ff-da ontology resolve <term>` | Resolve a business term to entities |
| `ff-da ontology relationships <type>` | Get entity relationships |
| `ff-da ontology columns <type>` | Get entity column mappings |
| `ff-da process context <domain>` | Get domain process context |
| `ff-da process rules <domain>` | Get business rules |
| `ff-da process annotations <domain>` | Get process annotations |
| `ff-da process calendar <domain>` | Get fiscal calendar context |
| `ff-da process get <domain> <name>` | Get a single process with steps |

## Command Reference

### connections

List available database connections visible to your identity.

```bash
# Table format (default)
ff-da connections

# JSON format
ff-da connections --format json
```

Output columns: Name, Type, Allowed Operations, Description.

### query

Execute a SELECT query and return rows.

```bash
ff-da query <connection> --sql "<sql>" [options]
```

| Option | Alias | Purpose |
|--------|-------|---------|
| `--sql` | `-s` | SQL query string |
| `--file` | `-f` | Path to SQL file (mutually exclusive with `--sql`) |
| `--params` | `-p` | Query parameters (repeat for multiple: `-p val1 -p val2`) |
| `--max-rows` | `-m` | Maximum rows to return |
| `--format` | | Output format: `table` (default), `json`, `csv` |

```bash
# Inline SQL
ff-da query mydb --sql "SELECT id, name FROM customers LIMIT 10"

# From file
ff-da query mydb --file ./report.sql

# With parameters
ff-da query mydb --sql "SELECT * FROM orders WHERE status = $1" -p "shipped"

# JSON output
ff-da query mydb --sql "SELECT * FROM products" --format json

# CSV output
ff-da query mydb --sql "SELECT * FROM products" --format csv

# Limit rows
ff-da query mydb --sql "SELECT * FROM large_table" --max-rows 100
```

### execute

Execute an INSERT, UPDATE, or DELETE statement.

```bash
ff-da execute <connection> --sql "<sql>" [options]
```

Same flags as `query` except no `--max-rows` or `--format`. Returns rows affected, duration, and query ID.

```bash
ff-da execute mydb --sql "UPDATE orders SET status = 'shipped' WHERE id = $1" -p "12345"

ff-da execute mydb --file ./migration.sql
```

### schema

Inspect database schema: tables and columns.

```bash
# List all tables
ff-da schema mydb

# Show columns for a specific table
ff-da schema mydb --table orders

# JSON output
ff-da schema mydb --format json
ff-da schema mydb --table orders --format json
```

Table listing shows: name, type (table/view), row count.
Column listing shows: name, type, normalized type, nullable, primary key.

### explain

Explain a SQL query's execution plan.

```bash
ff-da explain <connection> --sql "<sql>" [options]
```

| Option | Alias | Purpose | Default |
|--------|-------|---------|---------|
| `--sql` | `-s` | SQL query to explain | |
| `--file` | `-f` | Path to SQL file | |
| `--params` | `-p` | Query parameters | |
| `--analyze` | `-a` | Run EXPLAIN ANALYZE (executes the query) | `true` |
| `--verbose` | `-v` | Verbose EXPLAIN output | `false` |
| `--format` | | Output format: `table` (default), `json` | |

```bash
# EXPLAIN ANALYZE (default — actually runs the query)
ff-da explain mydb --sql "SELECT * FROM orders WHERE customer_id = 123"

# EXPLAIN only (no execution)
ff-da explain mydb --sql "SELECT * FROM orders" --no-analyze

# Verbose output
ff-da explain mydb --sql "SELECT * FROM orders" --verbose

# From file
ff-da explain mydb --file ./complex-query.sql
```

### dictionary

Query the data dictionary for business metadata about tables and columns.

#### dictionary tables

List annotated tables with business names and descriptions.

```bash
# All annotated tables
ff-da dictionary tables

# Filter by connection
ff-da dictionary tables --connection mydb

# Filter by tags
ff-da dictionary tables --tags finance --tags reporting

# Exclude tags
ff-da dictionary tables --exclude-tags deprecated

# JSON output
ff-da dictionary tables --format json
```

#### dictionary columns

List annotated columns with semantic types and descriptions.

```bash
# Get column annotations for a table
ff-da dictionary columns --table orders

# Filter by semantic type
ff-da dictionary columns --table orders --semantic-type "currency"

# Filter by data classification
ff-da dictionary columns --table customers --data-classification "pii"

# JSON output
ff-da dictionary columns --table orders --format json
```

### ontology

Query ontology context: entity types, term resolution, relationships, and column mappings.

#### ontology context

Get full domain ontology context.

```bash
ff-da ontology context sales-domain

# Filter by connection
ff-da ontology context sales-domain --connection mydb
```

#### ontology resolve

Resolve a business term to database entities.

```bash
ff-da ontology resolve "customer"

ff-da ontology resolve "revenue" --domain sales-domain --connection mydb --context "quarterly report"
```

#### ontology relationships

Get relationships for an entity type.

```bash
ff-da ontology relationships Customer

ff-da ontology relationships Customer --domain sales-domain
```

#### ontology columns

Get column mappings for an entity type.

```bash
ff-da ontology columns Customer

ff-da ontology columns Customer --domain sales-domain --connection mydb --role "identifier"
```

All ontology subcommands support `--format table` (default) or `--format json`.

### process

Query business process context: processes, rules, annotations, calendars.

#### process context

Get full domain process context.

```bash
ff-da process context sales-domain
```

#### process rules

Get business rules for a domain.

```bash
ff-da process rules sales-domain

# Filter by view name
ff-da process rules sales-domain --view-name "order_summary"
```

#### process annotations

Get process annotations (tribal knowledge).

```bash
ff-da process annotations sales-domain

# Filter by context trigger
ff-da process annotations sales-domain --context-trigger "quarter_end"
```

#### process calendar

Get fiscal calendar context.

```bash
ff-da process calendar sales-domain
```

#### process get

Get a specific process with its steps.

```bash
ff-da process get sales-domain "order-fulfillment"
```

All process subcommands support `--format table` or `--format json` (default: json).

## Common Workflows

### Explore a New Database

```bash
# 1. List available connections
ff-da connections

# 2. See what tables exist
ff-da schema mydb

# 3. Check business metadata
ff-da dictionary tables --connection mydb

# 4. Inspect a specific table
ff-da schema mydb --table orders
ff-da dictionary columns --table orders

# 5. Sample some data
ff-da query mydb --sql "SELECT * FROM orders LIMIT 5" --format json
```

### Understand Business Context Before Querying

```bash
# 1. Check ontology for the domain
ff-da ontology context sales-domain

# 2. Resolve a business term
ff-da ontology resolve "revenue"

# 3. Check business rules
ff-da process rules sales-domain

# 4. Check fiscal calendar for date handling
ff-da process calendar sales-domain
```

### Debug a Slow Query

```bash
# 1. Explain the query
ff-da explain mydb --sql "SELECT * FROM orders JOIN customers ON ..." --verbose

# 2. Check table sizes
ff-da schema mydb --table orders --format json
ff-da schema mydb --table customers --format json
```

## Output Processing with jq

All commands support JSON output for composability:

```bash
# Get just table names
ff-da schema mydb --format json | jq '.tables[].name'

# Get column names and types
ff-da schema mydb --table orders --format json | jq '.[] | {name, type}'

# Filter connections by type
ff-da connections --format json | jq '.[] | select(.type == "postgresql")'

# Count rows in query results
ff-da query mydb --sql "SELECT * FROM orders" --format json | jq '.rows | length'
```

## See Also

- [Data Access Service](../../platform/services/data-access/README.md) — Platform service documentation
- [ff-eg-read](ff-eg-read.md) — Query the entity graph
- [ff-telemetry-read](ff-telemetry-read.md) — Query telemetry data
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
