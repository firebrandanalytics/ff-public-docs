# Part 2: The DAS Client

In this part you'll build an HTTP client wrapper for the Data Access Service. This client handles authentication, URL construction, and response normalization for the DAS endpoints your tools will call.

**What you'll learn:**
- DAS API patterns (EXPLAIN, dictionary, schema endpoints)
- Authentication with `X-API-Key` and `X-On-Behalf-Of` headers
- Configuring the client for different deployment environments
- Response field normalization (camelCase to snake_case)

**What you'll build:** A `DASClient` class that wraps four DAS endpoints: `explainSQL`, `getSchema`, `getDictionaryTables`, and `getDictionaryColumns`.

## Concepts: The Data Access Service

The **Data Access Service (DAS)** provides semantic mediation between databases and AI applications. For our query analyzer, we'll use three of its knowledge layers:

| Layer | What It Provides | Endpoint Pattern |
|-------|-----------------|------------------|
| **Catalog** | Schema information (tables, columns, types, keys) | `GET /v1/connections/{conn}/schema` |
| **Catalog** | Query execution plans | `POST /v1/connections/{conn}/explain-sql` |
| **Dictionary** | Business names, descriptions, tags for tables and columns | `GET /v1/dictionary/tables`, `GET /v1/dictionary/columns` |

### Access Patterns

Users access DAS differently depending on their environment:

| Environment | `DAS_URL` | When to use |
|-------------|-----------|-------------|
| Port-forward | `http://localhost:8080` | Local development with `kubectl port-forward` |
| Kong gateway | `https://home.40.75.137.31.nip.io/das` | Remote access through the API gateway |
| In-cluster | `http://ff-data-access.ff-dev.svc.cluster.local:8080` | Agent bundle running in the same Kubernetes cluster |

## Step 1: Define the Client Interfaces

**`apps/query-bundle/src/das-client.ts`**:

```typescript
import axios, { type AxiosInstance } from 'axios';
import { logger } from '@firebrandanalytics/ff-agent-sdk';

export interface DASClientOptions {
  /** Base URL for the DAS HTTP API (e.g. http://localhost:8080) */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Identity header (X-On-Behalf-Of) */
  identity?: string;
  /** Timeout in ms */
  timeout?: number;
}

export interface ExplainResult {
  plan_lines: string[];
  sql: string;
  duration_ms?: number;
}

export interface DictionaryTable {
  connection: string;
  table_name: string;
  business_name: string;
  description: string;
  tags: string[];
  semantic_type: string;
  data_classification: string;
  row_count_estimate?: number;
}

export interface DictionaryColumn {
  connection: string;
  table_name: string;
  column_name: string;
  business_name: string;
  description: string;
  tags: string[];
  semantic_type: string;
  usage_notes?: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key?: boolean;
}
```

**Key points:**
- All interfaces use `snake_case` field names — we normalize the DAS response in each method.
- The `DASClientOptions` defaults make local development work out of the box.

## Step 2: Implement the Client Class

Add the class implementation to the same file:

```typescript
export class DASClient {
  private http: AxiosInstance;

  constructor(options: DASClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': options.apiKey ?? 'dev-api-key',
        'X-On-Behalf-Of': options.identity ?? 'user:admin',
      },
    });
  }
```

The `X-API-Key` header authenticates with the DAS. The `X-On-Behalf-Of` header identifies who the request is being made for (used for access control).

## Step 3: Implement explainSQL

The EXPLAIN endpoint runs `EXPLAIN` or `EXPLAIN ANALYZE` on a SQL query and returns the execution plan:

```typescript
  /**
   * Run EXPLAIN [ANALYZE] on a SQL query.
   */
  async explainSQL(
    connection: string,
    sql: string,
    options?: { analyze?: boolean; verbose?: boolean }
  ): Promise<ExplainResult> {
    const response = await this.http.post(
      `/v1/connections/${encodeURIComponent(connection)}/explain-sql`,
      {
        sql,
        analyze: options?.analyze ?? false,
        verbose: options?.verbose ?? false,
      }
    );
    const data = response.data;
    return {
      plan_lines: data.planLines ?? data.plan_lines ?? [],
      sql: data.sql,
      duration_ms: data.durationMs ?? data.duration_ms,
    };
  }
```

**Key points:**
- The URL path includes the connection name: `/v1/connections/{connection}/explain-sql`
- The DAS returns camelCase fields (`planLines`, `durationMs`), so we normalize with `??` fallbacks
- `encodeURIComponent` protects against connection names with special characters

## Step 4: Implement getSchema

The schema endpoint returns table and column metadata:

```typescript
  /**
   * Get schema for a connection (tables + columns).
   */
  async getSchema(
    connection: string,
    table?: string
  ): Promise<{ tables: SchemaTable[] }> {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    const qs = params.toString();
    const response = await this.http.get(
      `/v1/connections/${encodeURIComponent(connection)}/schema${qs ? '?' + qs : ''}`
    );
    return response.data;
  }
```

If you pass a `table` parameter, only that table's schema is returned. Otherwise you get all tables.

## Step 5: Implement Dictionary Methods

The dictionary endpoints return business annotations for tables and columns:

```typescript
  /**
   * Get dictionary table annotations.
   */
  async getDictionaryTables(
    connection: string,
    options?: { tags?: string; excludeTags?: string }
  ): Promise<DictionaryTable[]> {
    const params = new URLSearchParams();
    params.set('connection', connection);
    if (options?.tags) params.set('tags', options.tags);
    if (options?.excludeTags) params.set('excludeTags', options.excludeTags);
    const response = await this.http.get(
      `/v1/dictionary/tables?${params.toString()}`
    );
    return response.data.tables ?? response.data;
  }

  /**
   * Get dictionary column annotations for specific tables.
   */
  async getDictionaryColumns(
    connection: string,
    tables?: string[]
  ): Promise<DictionaryColumn[]> {
    const params = new URLSearchParams();
    params.set('connection', connection);
    if (tables?.length) {
      for (const t of tables) params.append('table', t);
    }
    const response = await this.http.get(
      `/v1/dictionary/columns?${params.toString()}`
    );
    return response.data.columns ?? response.data;
  }
}
```

**Key points:**
- Dictionary endpoints use query parameters rather than path parameters
- `getDictionaryColumns` accepts multiple table names via repeated `table` query params
- Response unwrapping handles both `{ tables: [...] }` and direct array formats

## Step 6: Create the Client Singleton

In your bot (which we'll build in Part 4), you'll create a single DASClient instance using environment variables:

```typescript
const DAS_URL = process.env.DAS_URL || 'http://localhost:8080';
const DAS_API_KEY = process.env.DAS_API_KEY || 'dev-api-key';
const DAS_IDENTITY = process.env.DAS_IDENTITY || 'user:admin';

const dasClient = new DASClient({
  baseUrl: DAS_URL,
  apiKey: DAS_API_KEY,
  identity: DAS_IDENTITY,
});
```

## Step 7: Test the Client (Optional)

If you have DAS running and accessible, you can test the client directly:

```bash
# Port-forward DAS if needed
kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080
```

Create a quick test script:

```typescript
// test-das.ts (temporary, for verification)
import { DASClient } from './das-client.js';

const client = new DASClient({ baseUrl: 'http://localhost:8080' });

const tables = await client.getDictionaryTables('firekicks');
console.log('Dictionary tables:', tables.length);

const schema = await client.getSchema('firekicks', 'customers');
console.log('Customers columns:', schema.tables[0]?.columns.length);
```

---

**Next:** [Part 3: Defining Tools](./part-03-tools.md)
