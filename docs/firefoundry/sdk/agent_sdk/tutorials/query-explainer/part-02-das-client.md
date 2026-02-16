# Part 2: The DAS Client

In this part you'll configure the published `@firebrandanalytics/data-access-client` package to communicate with the Data Access Service. This client handles authentication, URL construction, error translation, and typed responses for every DAS endpoint.

**What you'll learn:**
- DAS API patterns (EXPLAIN, dictionary, schema endpoints)
- How the published client handles authentication automatically
- Configuring the client for different deployment environments
- Key methods and types you'll use in your tools

**What you'll build:** A configured `DataAccessClient` instance that your tools will call in Part 3.

## Concepts: The Data Access Service

The **Data Access Service (DAS)** provides semantic mediation between databases and AI applications. For our query analyzer, we'll use three of its knowledge layers:

| Layer | What It Provides | Client Method |
|-------|-----------------|---------------|
| **Catalog** | Schema information (tables, columns, types, keys) | `getSchema(connection)` |
| **Catalog** | Query execution plans | `explainSQL(connection, request)` |
| **Dictionary** | Business names, descriptions, tags for tables and columns | `dictionaryTables(options)`, `dictionaryColumns(options)` |

### Access Patterns

Users access DAS differently depending on their environment:

| Environment | `FF_DATA_SERVICE_URL` | When to use |
|-------------|----------------------|-------------|
| Port-forward | `http://localhost:8080` | Local development with `kubectl port-forward` |
| Kong gateway | `https://home.40.75.137.31.nip.io/das` | Remote access through the API gateway |
| In-cluster | `http://ff-data-access.ff-dev.svc.cluster.local:8080` | Agent bundle running in the same Kubernetes cluster |

## Step 1: Understand the Published Client

The `@firebrandanalytics/data-access-client` package (installed in Part 1) provides a `DataAccessClient` class with typed methods for every DAS endpoint. You don't need to build an HTTP client from scratch.

**`apps/query-bundle/src/das-client.ts`**:

```typescript
import { DataAccessClient } from '@firebrandanalytics/data-access-client';

const FF_DATA_SERVICE_URL = process.env.FF_DATA_SERVICE_URL || 'http://localhost:8080';

export const dasClient = new DataAccessClient({
  serviceUrl: FF_DATA_SERVICE_URL,
});
```

That's it. The client handles:
- **Authentication** — Automatically sends `X-Function-Name` and `X-Function-Namespace` headers (auto-detected from `FF_FUNCTION_NAME` and `FF_FUNCTION_NAMESPACE` environment variables, set by Fission/Kong)
- **Request ID propagation** — Forwards `FF_REQUEST_ID` for distributed tracing
- **Error translation** — Converts HTTP errors to typed exceptions (`PermissionDeniedError`, `QueryError`, `TimeoutError`, etc.)

**Key points:**
- The constructor takes `serviceUrl` (not `baseUrl`)
- No API key or identity parameters needed — authentication is handled by the platform's function identity headers
- The default timeout is 30 seconds, configurable via `timeout` option

## Step 2: Explore the Methods You'll Use

Here are the four methods we'll wrap as tools in Part 3:

### explainSQL

Runs `EXPLAIN` or `EXPLAIN ANALYZE` on a SQL query:

```typescript
import type { ExplainSQLRequest, ExplainResponse } from '@firebrandanalytics/data-access-client';

const result: ExplainResponse = await dasClient.explainSQL('firekicks', {
  sql: 'SELECT * FROM customers WHERE state = $1',
  params: ['CA'],
  analyze: true,
  verbose: false,
});

// result.planLines — string[] of EXPLAIN output lines
// result.sql       — the SQL that was explained
// result.durationMs — time to run EXPLAIN (ms)
// result.queryId   — audit correlation ID
```

### dictionaryTables

Returns business annotations for tables — names, descriptions, tags:

```typescript
import type { DictionaryTablesResult } from '@firebrandanalytics/data-access-client';

const result: DictionaryTablesResult = await dasClient.dictionaryTables({
  connection: 'firekicks',
});

// result.tables — DictionaryTable[] with:
//   .table        — database table name (e.g., "customers")
//   .businessName — human-friendly name (e.g., "Customer Directory")
//   .description  — what the table contains
//   .tags         — classification tags
//   .connection   — which connection this belongs to
```

### dictionaryColumns

Returns column-level annotations for a specific table:

```typescript
import type { DictionaryColumnsResult } from '@firebrandanalytics/data-access-client';

const result: DictionaryColumnsResult = await dasClient.dictionaryColumns({
  connection: 'firekicks',
  table: 'customers',
});

// result.columns — DictionaryColumn[] with:
//   .column        — database column name
//   .businessName  — human-friendly name
//   .description   — what the column contains
//   .semanticType  — semantic classification
//   .usageNotes    — additional context
```

### getSchema

Returns the database schema — tables and columns with types:

```typescript
import type { SchemaInfo } from '@firebrandanalytics/data-access-client';

const schema: SchemaInfo = await dasClient.getSchema('firekicks');

// schema.tables — TableInfo[] with:
//   .name     — table name
//   .type     — 'table' | 'view' | 'stored_view'
//   .rowCount — approximate row count
```

To get columns for a specific table:

```typescript
const columns = await dasClient.getColumns('firekicks', 'customers');

// columns — ColumnInfo[] with:
//   .name          — column name
//   .type          — database-specific type (e.g., "varchar(100)")
//   .normalizedType — cross-DB type (e.g., "string")
//   .nullable      — allows NULL?
//   .primaryKey    — part of primary key?
```

## Step 3: Understand Error Handling

The published client throws typed errors instead of raw Axios errors:

```typescript
import {
  DataAccessError,
  ConnectionError,
  PermissionDeniedError,
  QueryError,
  TimeoutError,
} from '@firebrandanalytics/data-access-client';

try {
  const result = await dasClient.explainSQL('firekicks', { sql: 'SELECT ...' });
} catch (error) {
  if (error instanceof ConnectionError) {
    // DAS can't reach the database — check connection config
  } else if (error instanceof PermissionDeniedError) {
    // 403 — no access to this connection
  } else if (error instanceof QueryError) {
    // 400/422 — invalid SQL or query error
  } else if (error instanceof TimeoutError) {
    // 408 — query took too long
  } else if (error instanceof DataAccessError) {
    // Other DAS errors — error.message, error.code, error.queryId
  }
}
```

In our tools (Part 3), we'll catch these errors and return them as data rather than re-throwing — this lets the LLM see the error and adapt.

## Step 4: Verify DAS Connectivity with ff-da

Before writing any code, verify that DAS is reachable and the FireKicks dataset is configured. The `ff-da` CLI tool lets you test DAS operations directly from the command line:

```bash
# Port-forward DAS if needed
kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080
```

```bash
# Check DAS health
ff-da health

# List available connections — "firekicks" should appear
ff-da connections

# Inspect the FireKicks schema — should show ~20 tables
ff-da schema --connection firekicks

# Test a query to verify database connectivity
ff-da query --connection firekicks --sql "SELECT COUNT(*) FROM orders"
```

If `ff-da` is not installed, you can use `curl` directly:

```bash
# Health check
curl -s http://localhost:8080/health | python3 -m json.tool

# List connections
curl -s http://localhost:8080/admin/connections | python3 -m json.tool

# Get schema
curl -s http://localhost:8080/v1/connections/firekicks/schema \
  -H "X-On-Behalf-Of: user:admin" | python3 -m json.tool
```

> **Tip:** If `ff-da connections` doesn't show `firekicks`, the DAS hasn't been configured with the FireKicks database. See the [FireKicks Tutorial](../../../platform/services/data-access/firekicks/README.md) for setup instructions.

## Step 5: Test the Published Client (Optional)

You can also verify the client programmatically:

```typescript
// test-das.ts (temporary, for verification)
import { DataAccessClient } from '@firebrandanalytics/data-access-client';

const client = new DataAccessClient({ serviceUrl: 'http://localhost:8080' });

const tables = await client.dictionaryTables({ connection: 'firekicks' });
console.log('Dictionary tables:', tables.tables.length);

const schema = await client.getSchema('firekicks');
console.log('Schema tables:', schema.tables.length);

const columns = await client.getColumns('firekicks', 'customers');
console.log('Customer columns:', columns.length);
```

---

**Next:** [Part 3: Defining Tools](./part-03-tools.md)
