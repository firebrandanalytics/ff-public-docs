# Telemetry Diagnostics

Using `ff-telemetry-read` for diagnostic investigations. This guide focuses on diagnostic patterns; see [ff-telemetry-read skill](../../ff-telemetry-read/SKILL.md) for full command reference.

## Understanding the Telemetry Hierarchy

```
BrokerRequest (top level)
├── id, status, timestamps
├── request_data, response_data
├── breadcrumbs (links to entities)
└── LlmApiRequest[] (LLM calls made)
    ├── provider_name, model
    ├── request_data, response_data
    └── ToolCallRequest[] (tools invoked)
        ├── tool_name, tool_args
        └── response_data
```

## Diagnostic Starting Points

### Starting from a Known Entity

When you have an entity from the entity graph:

```bash
# 1. Find all requests for this entity
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# 2. Find failed requests for this entity
ff-telemetry-read broker search --breadcrumb-type "<EntityType>" --breadcrumb-id "<entity-id>" --has-error

# 3. Get full trace of a specific request
ff-telemetry-read trace get <broker-request-id>
```

### Starting from Recent Failures

When investigating recent issues:

```bash
# Get recent failures
ff-telemetry-read broker failed --limit 10

# See error messages
ff-telemetry-read broker failed --limit 10 | jq '.items[] | {id, error_message, timestamp: .created_at}'

# Get breadcrumbs to identify affected entities
ff-telemetry-read broker failed --limit 10 | jq '.items[] | {id, breadcrumbs}'
```

### Starting from a Time Window

When you know approximately when an issue occurred:

```bash
# Search within time window
ff-telemetry-read broker search \
  --start-time 2025-10-15T02:00:00Z \
  --end-time 2025-10-15T03:00:00Z

# With error filter
ff-telemetry-read broker search \
  --start-time 2025-10-15T02:00:00Z \
  --end-time 2025-10-15T03:00:00Z \
  --has-error
```

## Full Request Traces

### Get Complete Picture

The `trace get` command shows the full hierarchy:

```bash
# Get full trace
ff-telemetry-read trace get <broker-request-id> | jq .

# Summary view
ff-telemetry-read trace get <broker-request-id> | jq '{
  broker: {status, error: .error_message},
  llm_calls: [.llm_requests[] | {provider: .provider_name, model: .model_name, status}],
  tool_calls: [.llm_requests[].tool_calls[]? | {tool: .tool_name, status}]
}'
```

### Analyze LLM Calls

```bash
# See which LLMs were called
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | {provider: .provider_name, model: .model_name, status, tokens: .total_tokens}'

# Find failed LLM calls
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | select(.status == "failed") | {provider: .provider_name, error: .error_message}'

# See the actual prompt/response (may be large)
ff-telemetry-read llm get <llm-request-id> | jq '.request_data, .response_data'
```

### Analyze Tool Calls

```bash
# See which tools were called
ff-telemetry-read trace get <broker-request-id> | jq '[.llm_requests[].tool_calls[]? | .tool_name]'

# Find failed tool calls
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[].tool_calls[]? | select(.status == "failed") | {tool: .tool_name, error: .error_message}'

# Get tool call details
ff-telemetry-read tool get <tool-call-id> | jq '{tool: .tool_name, args: .tool_args, response: .response_data}'
```

## LLM-Focused Diagnostics

### Provider Issues

```bash
# Find failures by provider
ff-telemetry-read llm search --provider-name anthropic --status failed --size 20

# Compare providers
ff-telemetry-read llm search --status failed | jq '.items[].provider_name' | sort | uniq -c

# Check specific model issues
ff-telemetry-read llm search --status failed | jq '.items[] | select(.model_name | contains("claude")) | {model: .model_name, error: .error_message}'
```

### Token Usage Analysis

```bash
# Get token usage for a request
ff-telemetry-read trace get <broker-request-id> | jq '[.llm_requests[] | .total_tokens] | add'

# Find high-token requests
ff-telemetry-read llm search --size 100 | jq '.items | sort_by(.total_tokens) | reverse[:10] | .[] | {id, tokens: .total_tokens, model: .model_name}'
```

### Rate Limiting / Errors

```bash
# Find rate limit errors
ff-telemetry-read llm search --status failed | jq '.items[] | select(.error_message | test("rate|limit|429"; "i"))'

# Find timeout errors
ff-telemetry-read llm search --status failed | jq '.items[] | select(.error_message | test("timeout|timed out"; "i"))'
```

## Tool Call Diagnostics

### Tool Usage Patterns

```bash
# Most used tools
ff-telemetry-read tool search --size 500 | jq '.items[].tool_name' | sort | uniq -c | sort -rn

# Failed tool calls by tool name
ff-telemetry-read tool search --status failed | jq '.items[].tool_name' | sort | uniq -c | sort -rn
```

### Specific Tool Issues

```bash
# Find failures for a specific tool
ff-telemetry-read tool search --tool-name "execute_code" --status failed

# Get details on a failed tool call
ff-telemetry-read tool get <tool-call-id> | jq '{tool: .tool_name, args: .tool_args, error: .error_message}'
```

### MCP Tool Calls

```bash
# Find MCP-related tool calls
ff-telemetry-read tool search | jq '.items[] | select(.mcp_server_url != null) | {tool: .tool_name, server: .mcp_server_url}'
```

## Breadcrumb-Based Correlation

### From Telemetry to Entity Graph

```bash
# Get breadcrumbs from a failed request
ff-telemetry-read broker get <broker-request-id> | jq '.breadcrumbs'

# Use the breadcrumb to find the entity
ff-eg-read node get <entity-id-from-breadcrumb>
```

### From Telemetry to Logs

```bash
# Get entity_id and correlation_id from breadcrumb
ff-telemetry-read broker get <broker-request-id> | jq '.breadcrumbs[0] | {entity_id, correlation_id}'

# Search logs with these IDs
grep "<entity-id>" logs/*.log
grep "<correlation-id>" logs/*.log
```

### Find All Activity for an Entity

```bash
# All broker requests for an entity
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# With time filter
ff-telemetry-read broker search \
  --breadcrumb-type "<EntityType>" \
  --breadcrumb-id "<entity-id>" \
  --start-time 2025-10-15T00:00:00Z
```

## Error Analysis Patterns

### Error Message Summary

```bash
# Unique error messages with counts
ff-telemetry-read broker failed --size 100 | jq '.items[].error_message' | sort | uniq -c | sort -rn

# LLM error messages
ff-telemetry-read llm search --status failed --size 100 | jq '.items[].error_message' | sort | uniq -c | sort -rn
```

### Error Timeline

```bash
# Errors over time
ff-telemetry-read broker failed --size 100 | jq '.items[] | {time: .created_at, error: .error_message}'
```

### Error-Entity Correlation

```bash
# Which entities are failing most?
ff-telemetry-read broker failed --size 100 | jq '.items[].breadcrumbs[0].entity_type' | sort | uniq -c | sort -rn

# Get entity IDs for failed requests
ff-telemetry-read broker failed --size 100 | jq '.items[] | {entity: .breadcrumbs[0].entity_id, error: .error_message}'
```

## Performance Analysis

### Request Duration

```bash
# Get request durations (if tracked)
ff-telemetry-read broker search --size 50 | jq '.items[] | {id, duration: (.completed_at | fromdateiso8601) - (.created_at | fromdateiso8601)}'

# Or if there's a duration field
ff-telemetry-read broker search --size 50 | jq '.items[] | select(.duration_ms > 5000) | {id, duration_ms}'
```

### LLM Latency

```bash
# Check LLM response times
ff-telemetry-read llm search --size 50 | jq '.items[] | {provider: .provider_name, duration: .duration_ms}'
```

## Pagination for Large Queries

```bash
# First page
ff-telemetry-read broker search --page 0 --size 50

# Next pages
ff-telemetry-read broker search --page 1 --size 50
ff-telemetry-read broker search --page 2 --size 50

# Check total
ff-telemetry-read broker search --page 0 --size 50 | jq '.total'
```

## Troubleshooting ff-telemetry-read

### Check Configuration

```bash
# Connection string (show first 20 chars only for security)
echo "${FF_TELEMETRY_CONNECTION_STRING:0:20}..."

# Schema
echo "Schema: ${FF_TELEMETRY_SCHEMA:-brk_tracking}"
```

### Test Connectivity

```bash
# Quick test
ff-telemetry-read broker recent --limit 1
```

### Common Issues

| Error | Likely Cause | Fix |
|-------|--------------|-----|
| Connection refused | Database not reachable | Check connection string |
| Authentication failed | Bad credentials | Verify user/password |
| Schema not found | Wrong schema name | Check FF_TELEMETRY_SCHEMA |
| Empty results | Time range issue | Adjust --start-time/--end-time |
