# Part 6: Deploy & Test

In this part you'll configure environment variables, start the bundle locally, and test the full analysis pipeline using the FireFoundry CLI tools.

**What you'll learn:**
- Required environment variables for entity service, broker, and DAS connectivity
- Starting the bundle with `tsx` for development
- Testing the submit-then-poll API flow with `ff-sdk-cli`
- Inspecting entities with `ff-eg-read`
- Tracing tool calls with `ff-telemetry-read`
- Common startup and runtime errors and how to fix them

**What you'll build:** A running query analyzer that you can submit SQL to and inspect results.

## Step 1: Environment Variables

The bundle needs connections to three services:

| Variable | Purpose | Example |
|----------|---------|---------|
| `REMOTE_ENTITY_SERVICE_URL` | Entity service base URL (no port) | `http://localhost` |
| `REMOTE_ENTITY_SERVICE_PORT` | Entity service port | `8180` |
| `USE_REMOTE_ENTITY_CLIENT` | Enable remote entity client | `true` |
| `BROKER_URL` | Broker gRPC endpoint | `localhost:50052` |
| `MODEL_POOL_NAME` | LLM model pool | `firebrand-gpt-5.2-failover` |
| `FF_DATA_SERVICE_URL` | Data Access Service URL | `http://localhost:8080` |
| `PORT` | Bundle HTTP server port | `3001` |

> **Important:** Without `REMOTE_ENTITY_SERVICE_URL`, `REMOTE_ENTITY_SERVICE_PORT`, and `USE_REMOTE_ENTITY_CLIENT`, the SDK crashes with `Unsupported protocol undefined:`. These three variables are required for any agent bundle.

Create a `.env` file in the bundle directory:

**`apps/query-bundle/.env`**:

```bash
# Entity service (required)
REMOTE_ENTITY_SERVICE_URL=http://localhost
REMOTE_ENTITY_SERVICE_PORT=8180
USE_REMOTE_ENTITY_CLIENT=true

# Broker
BROKER_URL=localhost:50052
MODEL_POOL_NAME=firebrand-gpt-5.2-failover

# Data Access Service
FF_DATA_SERVICE_URL=http://localhost:8080

# Bundle server
PORT=3001
```

## Step 2: Port-Forward Cluster Services

If you're running locally against a remote FireFoundry cluster, port-forward the required services:

```bash
# Entity service — manages entity storage
kubectl port-forward -n ff-dev svc/firefoundry-core-entity-service 8180:8080

# Broker — routes LLM requests to model pools
kubectl port-forward -n ff-dev svc/ff-broker 50052:50052

# Data Access Service — database schema, dictionary, EXPLAIN
kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080
```

Each command blocks a terminal. Run them in separate terminals or use a process manager like `procman`.

### Verify DAS with ff-da

Before starting the bundle, use the `ff-da` CLI to verify DAS connectivity and the FireKicks dataset:

```bash
# Verify the firekicks connection exists
ff-da connections

# Check schema is accessible (should list ~20 tables)
ff-da schema --connection firekicks

# Test EXPLAIN — this is what the explain_query tool calls
ff-da query --connection firekicks \
  --sql "EXPLAIN SELECT * FROM customers LIMIT 1"
```

If any of these fail, fix DAS connectivity before starting the bundle — the bot's tools call these same endpoints.

## Step 3: Build and Start the Bundle

Build all workspace packages, then start the bundle in development mode:

```bash
# From the monorepo root
pnpm build

# Start the bundle with hot reload
cd apps/query-bundle
pnpm dev
```

You should see output like:

```
[INFO] Starting QueryExplainer server on port 3001
[INFO] QueryExplainer bundle initialized!
[INFO] API endpoints:
[INFO]    POST /api/analyze-query — Submit SQL for analysis
[INFO]    GET  /api/query-status  — Get analysis results
[INFO] QueryExplainer server running on port 3001
```

Verify the bundle is healthy:

```bash
ff-sdk-cli health --url http://localhost:3001
```

## Step 4: Submit a Query

Use `ff-sdk-cli` to submit a SQL query to the analyze endpoint:

```bash
ff-sdk-cli api call analyze-query \
  --method POST \
  --body '{"sql": "SELECT c.first_name, c.last_name, SUM(o.total_amount) as total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.status = '\''completed'\'' GROUP BY c.first_name, c.last_name ORDER BY total_spent DESC LIMIT 10", "connection": "firekicks"}' \
  --url http://localhost:3001
```

Response:

```json
{
  "entity_id": "a1b2c3d4-..."
}
```

Save the entity ID:

```bash
ENTITY_ID="a1b2c3d4-..."
```

## Step 5: Inspect the Entity

The analysis takes 15-45 seconds as the LLM calls tools (EXPLAIN, dictionary, schema) before producing the structured output. Use `ff-eg-read` to check the entity status and data:

```bash
# Check entity status and data
ff-eg-read node get $ENTITY_ID
```

While the bot is running, the entity's `status` will be `Running` and `data.result` will be `null`. When complete, `data.result` contains the Zod-validated analysis:

```json
{
  "id": "a1b2c3d4-...",
  "status": "Running",
  "data": {
    "sql": "SELECT ...",
    "connection": "firekicks",
    "result": {
      "performance": {
        "summary": "The query performs a hash join between customers and orders...",
        "bottlenecks": [
          "Sequential scan on orders table (131K rows)"
        ],
        "optimization_suggestions": [
          "Create index on orders(customer_id, status) to support the join and filter"
        ],
        "estimated_cost": "1234.56",
        "execution_time_ms": 45.2
      },
      "semantics": {
        "business_question": "Who are the top 10 customers by total completed order value?",
        "domain_context": "Customer purchasing behavior analysis in an e-commerce...",
        "tables_used": [
          {
            "table_name": "customers",
            "business_name": "Customer Directory",
            "role_in_query": "Source of customer name information"
          },
          {
            "table_name": "orders",
            "business_name": "Sales Orders",
            "role_in_query": "Source of purchase amounts filtered to completed status"
          }
        ],
        "entities_involved": ["Customer", "Order"],
        "relationships": ["Customer places Orders (1:many via customer_id)"]
      }
    },
    "error": null
  }
}
```

If the analysis fails, `data.error` contains the error message instead.

You can also use the bundle's own status endpoint:

```bash
ff-sdk-cli api call query-status \
  --query "{\"entity_id\": \"$ENTITY_ID\"}" \
  --url http://localhost:3001
```

## Step 6: Trace Tool Calls with Telemetry

Use `ff-telemetry-read` to see exactly what the LLM did — which tools it called, in what order, and what arguments it used:

```bash
# See the most recent broker request (the bot's LLM interaction)
ff-telemetry-read broker recent --limit 1

# Get the full trace including tool calls
ff-telemetry-read broker trace <request-id>
```

The trace shows the complete tool call sequence:

```bash
# List all tool calls for the most recent request
ff-telemetry-read tool-call recent --limit 10
```

You should see tool invocations for `explain_query`, `get_dictionary_tables`, `get_dictionary_columns`, and `get_schema`. If you see fewer tool calls than expected, the LLM may be skipping steps — review the system prompt ordering in Part 4.

## Step 7: Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unsupported protocol undefined:` | Missing entity service env vars | Set `REMOTE_ENTITY_SERVICE_URL`, `REMOTE_ENTITY_SERVICE_PORT`, `USE_REMOTE_ENTITY_CLIENT=true` |
| `Error: get_semantic_label not implemented` | `ComposeMixins` prototype chain issue | Add the `thread_try.semantic_label_function` workaround in the bot constructor (see Part 4) |
| `ECONNREFUSED localhost:50052` | Broker not port-forwarded | Run `kubectl port-forward -n ff-dev svc/ff-broker 50052:50052` |
| `ECONNREFUSED localhost:8080` | DAS not port-forwarded | Run `kubectl port-forward -n ff-dev svc/ff-data-access 8080:8080` |
| `ECONNREFUSED localhost:8180` | Entity service not port-forwarded | Run `kubectl port-forward -n ff-dev svc/firefoundry-core-entity-service 8180:8080` |
| Bot completes but `data.result` is null | `entity.run()` returned null | Check that the bot produces structured output (Zod schema match) |
| Zod validation fails repeatedly | LLM uses wrong field names | Add explicit field name instructions to the system prompt (see Part 4) |
| `MockBrokerClient` in logs | SDK created mock client (no broker URL) | Set `BROKER_URL=localhost:50052` in environment |
| `AxiosError: Request failed with status 403` | DAS permission denied | Check `FF_FUNCTION_NAME` and `FF_FUNCTION_NAMESPACE` env vars, or DAS ACL configuration |
| Tool returns empty tables/columns | FireKicks not configured in DAS | Run `ff-da connections` to check; see [FireKicks Tutorial](../../../platform/services/data-access/firekicks/README.md) |
| Port 3001 already in use | Another process using the port | Change `PORT` env var or stop the other process |

### Debugging DAS Issues with ff-da

If tool calls fail or return unexpected results, test the same operations directly with `ff-da`:

```bash
# Does the connection exist?
ff-da connections

# Can DAS read the schema?
ff-da schema --connection firekicks

# Can DAS run EXPLAIN? (what explain_query calls)
ff-da query --connection firekicks \
  --sql "EXPLAIN ANALYZE SELECT COUNT(*) FROM orders"

# Can DAS run a regular query?
ff-da query --connection firekicks \
  --sql "SELECT * FROM customers LIMIT 3"
```

If `ff-da` commands work but the bundle's tools fail, the issue is in how the tool function calls the published client — check the `das-client.ts` configuration and `FF_DATA_SERVICE_URL` env var.

### Debugging with ff-eg-read

Use `ff-eg-read` to inspect entity state at any point:

```bash
# Full entity details
ff-eg-read node get $ENTITY_ID

# Search for recent query analysis entities
ff-eg-read search nodes-scoped --type QueryExplainerEntity --limit 5

# Check the entity's input/output (runnable entity data)
ff-eg-read node io $ENTITY_ID
```

---

**Next:** [Part 7: Web UI](./part-07-web-ui.md)
