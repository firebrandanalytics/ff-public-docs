# ff-telemetry-read — Telemetry & Request Tracing

Read-only CLI tool for querying FireFoundry telemetry data. Inspect broker requests, LLM API calls, tool invocations, and full request traces for debugging and analysis.

## Installation

```bash
npm install -g @firebrandanalytics/ff-telemetry-read
```

Verify:

```bash
ff-telemetry-read broker recent --limit 1
```

## Configuration

The tool auto-configures from environment variables or a `.env` file in the current working directory. It connects directly to the PostgreSQL database where telemetry is stored.

| Variable | Purpose |
|----------|---------|
| `PG_SERVER` | Azure Postgres server name (constructs host as `<server>.postgres.database.azure.com`) |
| `PG_HOST` | Direct PostgreSQL host (alternative to `PG_SERVER`) |
| `PG_PORT` | PostgreSQL port (default: 5432) |
| `PG_PASSWORD` | Password for the fireread user |
| `PG_DATABASE` | Database name |
| `FF_TELEMETRY_DATABASE` | Override database name for telemetry |
| `FF_TELEMETRY_SCHEMA` | Schema name (default: `brk_tracking`) |
| `PG_SSL_DISABLED` | Set to disable SSL (local dev only) |

Either `PG_SERVER` or `PG_HOST` is required. Azure Postgres requires SSL by default — only set `PG_SSL_DISABLED=true` for local development databases.

## Data Model

Telemetry follows a hierarchical structure:

```
BrokerRequest
├── id, request_id, status, timestamps
├── request_data, response_data
├── breadcrumbs (entity_type, entity_id, correlation_id)
├── metrics
└── LlmApiRequest[]
    ├── id, provider_name, model info
    ├── request_data, response_data
    └── ToolCallRequest[]
        ├── id, tool_name, tool_type
        ├── tool_args, response_data
        └── mcp_server_url
```

**Breadcrumbs** link telemetry to entities. Each broker request carries breadcrumbs containing the `entity_type`, `entity_id`, and `correlation_id`, allowing you to trace requests back to the entity that triggered them.

## Command Reference

### Broker Commands

Query high-level broker requests — the top of the telemetry hierarchy.

#### broker get

Get a single broker request by ID.

```bash
ff-telemetry-read broker get <id>
```

```bash
ff-telemetry-read broker get <broker-request-id> | jq .

# Extract status and error info
ff-telemetry-read broker get <broker-request-id> | jq '{status, error_message}'
```

#### broker search

Search broker requests with filters.

```bash
ff-telemetry-read broker search [options]
```

| Option | Purpose |
|--------|---------|
| `--start-time <iso>` | Start of time range (ISO 8601) |
| `--end-time <iso>` | End of time range (ISO 8601) |
| `--breadcrumb-type <type>` | Filter by entity type breadcrumb |
| `--breadcrumb-id <id>` | Filter by entity ID breadcrumb |
| `--has-error` | Only requests with errors |
| `--page <N>` | Page number (0-indexed) |
| `--size <N>` | Results per page |

```bash
# Search by entity breadcrumb
ff-telemetry-read broker search \
  --breadcrumb-type "agent" \
  --breadcrumb-id "<agent-id>"

# Search by time window
ff-telemetry-read broker search \
  --start-time 2024-01-01T10:00:00Z \
  --end-time 2024-01-01T11:00:00Z

# Failed requests in a time range
ff-telemetry-read broker search \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --has-error

# Paginate results
ff-telemetry-read broker search --page 0 --size 50
```

#### broker recent

Get the most recent broker requests.

```bash
ff-telemetry-read broker recent [options]
```

| Option | Purpose |
|--------|---------|
| `--limit <N>` | Number of results |

```bash
ff-telemetry-read broker recent --limit 10

# Recent requests with status
ff-telemetry-read broker recent --limit 10 | jq '.items[] | {id, status}'
```

#### broker failed

Get recent failed broker requests.

```bash
ff-telemetry-read broker failed [options]
```

| Option | Purpose |
|--------|---------|
| `--limit <N>` | Number of results |
| `--start-time <iso>` | Start of time range |
| `--end-time <iso>` | End of time range |

```bash
# Recent failures
ff-telemetry-read broker failed --limit 10 | jq '.items[] | {id, error_message}'

# Failures in a time window
ff-telemetry-read broker failed \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z
```

### LLM Commands

Query LLM API requests — calls to providers like Anthropic, OpenAI, etc.

#### llm get

Get a single LLM request by ID.

```bash
ff-telemetry-read llm get <id>
```

```bash
ff-telemetry-read llm get <llm-request-id> | jq .

# Extract error details
ff-telemetry-read llm get <llm-request-id> | jq '{error: .error_message, request: .request_data}'
```

#### llm search

Search LLM requests with filters.

```bash
ff-telemetry-read llm search [options]
```

| Option | Purpose |
|--------|---------|
| `--provider-name <name>` | Filter by provider (e.g., `anthropic`, `openai`) |
| `--status <status>` | Filter by status (e.g., `failed`) |
| `--page <N>` | Page number (0-indexed) |
| `--size <N>` | Results per page |

```bash
# Find LLM requests by provider
ff-telemetry-read llm search --provider-name anthropic --size 50

# Find failed LLM requests
ff-telemetry-read llm search --status failed
```

#### llm by-broker

Get all LLM requests associated with a broker request.

```bash
ff-telemetry-read llm by-broker <broker-request-id>
```

```bash
# See models and token usage for a broker request
ff-telemetry-read llm by-broker <broker-request-id> | jq '.[] | {model: .model_name, tokens: .total_tokens}'
```

### Tool Commands

Query tool call requests — tool invocations made within LLM conversations.

#### tool get

Get a single tool call by ID.

```bash
ff-telemetry-read tool get <id>
```

```bash
ff-telemetry-read tool get <tool-call-id> | jq .
```

#### tool search

Search tool calls with filters.

```bash
ff-telemetry-read tool search [options]
```

| Option | Purpose |
|--------|---------|
| `--tool-name <name>` | Filter by tool name |
| `--status <status>` | Filter by status (e.g., `failed`) |
| `--page <N>` | Page number (0-indexed) |
| `--size <N>` | Results per page |

```bash
# Find calls to a specific tool
ff-telemetry-read tool search --tool-name "read_file" --size 100

# Find failed tool calls
ff-telemetry-read tool search --status failed
```

#### tool by-llm

Get all tool calls for a given LLM request.

```bash
ff-telemetry-read tool by-llm <llm-request-id>
```

```bash
ff-telemetry-read tool by-llm <llm-request-id> | jq '.[] | {tool_name, status}'
```

### Trace Commands

Full diagnostic views that combine broker requests, LLM calls, and tool invocations into a single hierarchy.

#### trace get

Get the full request trace for a broker request — includes all nested LLM requests and tool calls.

```bash
ff-telemetry-read trace get <broker-request-id>
```

```bash
# Full trace
ff-telemetry-read trace get <broker-request-id> | jq .

# See which LLM calls were made
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | {provider: .provider_name, status: .status}'

# Check for tool call failures
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[].tool_calls[] | select(.status == "failed")'

# Count tokens across all LLM requests
ff-telemetry-read trace get <broker-request-id> | jq '[.llm_requests[].total_tokens] | add'

# Analyze providers used
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[].provider_name' | sort | uniq -c
```

#### trace by-breadcrumb

Find all request traces for an entity, using breadcrumb data.

```bash
ff-telemetry-read trace by-breadcrumb <entity-type> [entity-id]
```

```bash
# Find all traces for a specific entity
ff-telemetry-read trace by-breadcrumb ReportReviewWorkflowEntity <entity-id>

# Find all traces for an entity type
ff-telemetry-read trace by-breadcrumb agent
```

## Pagination

Search commands return paginated results:

```json
{
  "items": [],
  "total": 150,
  "page": 0,
  "size": 50
}
```

```bash
# First page
ff-telemetry-read broker search --page 0 --size 50

# Next page
ff-telemetry-read broker search --page 1 --size 50
```

## Diagnostic Workflows

### Investigating a Failed Request

```bash
# 1. Find recent failures
ff-telemetry-read broker failed --limit 10 | jq '.items[] | {id, error_message}'

# 2. Get the full trace for a failure
ff-telemetry-read trace get <broker-request-id> | jq .

# 3. Check which LLM calls were made and their status
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | {provider: .provider_name, status: .status}'

# 4. Look for tool call failures
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[].tool_calls[] | select(.status == "failed")'
```

### Entity Request History

When you know an entity ID and want to see all requests it triggered:

```bash
# 1. Find all broker requests for this entity
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# 2. Filter to failures only
ff-telemetry-read broker search \
  --breadcrumb-type "<EntityType>" \
  --breadcrumb-id "<entity-id>" \
  --has-error

# 3. Get full trace of a specific failure
ff-telemetry-read trace get <broker-request-id>
```

### LLM Error Analysis

When LLM calls are failing across the system:

```bash
# 1. Find recent LLM failures
ff-telemetry-read llm search --status failed --size 20

# 2. Check which providers are affected
ff-telemetry-read llm search --status failed | jq '.items[].provider_name' | sort | uniq -c

# 3. Get details on a specific failure
ff-telemetry-read llm get <llm-request-id> | jq '{error: .error_message, request: .request_data}'
```

### Tool Call Debugging

When tool calls are failing:

```bash
# 1. Find failed tool calls
ff-telemetry-read tool search --status failed --size 20

# 2. See which tools are failing most
ff-telemetry-read tool search --status failed | jq '.items[].tool_name' | sort | uniq -c

# 3. Get the full context — find the parent LLM request
ff-telemetry-read tool get <tool-call-id> | jq '.llm_request_id'
ff-telemetry-read llm get <llm-request-id>
```

### Model Usage Analysis

```bash
# See which models were used in a trace
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | {model: .model_name, tokens: .total_tokens}'

# Total tokens for a trace
ff-telemetry-read trace get <broker-request-id> | jq '[.llm_requests[].total_tokens] | add'

# Find requests by provider
ff-telemetry-read llm search --provider-name anthropic --size 50
```

### Correlating with Logs

Breadcrumbs link telemetry to application logs:

```json
{
  "breadcrumbs": [
    {
      "entity_type": "ReportReviewWorkflowEntity",
      "entity_id": "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1",
      "correlation_id": "279f4ee6-4cc4-4880-9736-4c64c5ab39be"
    }
  ]
}
```

Use these values to cross-reference with other tools:

```bash
# Search logs by entity_id or correlation_id
grep "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1" logs/*.log

# Look up the entity in the graph
ff-eg-read node get "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1" | jq '{name, status}'

# Check working memory for the entity
ff-wm-read record list "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1"
```

### End-to-End Request Tracing

Combine telemetry with entity graph data for a complete picture:

```bash
# 1. Get the entity
ff-eg-read node get <entity-id> | jq '{name, status, entity_type}'

# 2. Find all broker requests for it
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# 3. Get the full trace for a specific request
ff-telemetry-read trace get <broker-request-id> | jq .

# 4. Check progress envelopes for the entity
ff-eg-read node progress <entity-id> | jq '.[] | {type, status: .status}'
```

## See Also

- [ff-eg-read](ff-eg-read.md) — Query entities and their relationships
- [ff-eg-write](ff-eg-write.md) — Modify entities in the graph
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
- [ff-wm-read](ff-wm-read.md) — Read working memory (files, records)
