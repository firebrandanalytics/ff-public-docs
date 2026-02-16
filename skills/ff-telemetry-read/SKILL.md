---
name: ff-telemetry-read
description: Read FireFoundry telemetry data including broker requests, LLM calls, and tool invocations. Use for debugging request flows, analyzing LLM interactions, and tracing failures.
version: 1.0.0
tags: [cli-tool, firefoundry, telemetry, diagnostics]
---

# FireFoundry Telemetry Read Skill

CLI tool for reading FireFoundry telemetry data, designed for diagnostics and debugging.

## Overview

The `ff-telemetry-read` tool provides access to request telemetry:
- **Broker requests** - High-level requests to the FireFoundry broker
- **LLM API requests** - Calls to LLM providers (Anthropic, OpenAI, etc.)
- **Tool calls** - Tool invocations within LLM conversations
- **Completion streams** - Streaming response data
- **Full traces** - Complete request hierarchy for debugging

**Command format:**
```bash
ff-telemetry-read <command> <subcommand> [options]
```

## Prerequisites

The tool auto-configures from environment variables or a `.env` file in the current working directory.

**Installation:**
```bash
npm install -g @firebrandanalytics/ff-telemetry-read
```

**Verify it's working:**
```bash
ff-telemetry-read broker recent --limit 1
```

For connection troubleshooting, load [modes/configuration.md](./modes/configuration.md).

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

## Quick Reference

### Broker Request Commands

| Command | Purpose |
|---------|---------|
| `broker get <id>` | Get a broker request by ID |
| `broker search` | Search broker requests |
| `broker recent` | Get recent requests |
| `broker failed` | Get failed requests |

### LLM Request Commands

| Command | Purpose |
|---------|---------|
| `llm get <id>` | Get an LLM request by ID |
| `llm search` | Search LLM requests |
| `llm by-broker <broker-id>` | Get LLM requests for a broker request |

### Tool Call Commands

| Command | Purpose |
|---------|---------|
| `tool get <id>` | Get a tool call by ID |
| `tool search` | Search tool calls |
| `tool by-llm <llm-id>` | Get tool calls for an LLM request |

### Trace Commands (Full Diagnostic View)

| Command | Purpose |
|---------|---------|
| `trace get <broker-id>` | Full request trace (broker + LLM + tools) |
| `trace by-breadcrumb <type> [id]` | Find requests by entity |

## Common Patterns

### Find Recent Failures

```bash
# Get recent failed broker requests
ff-telemetry-read broker failed --limit 10 | jq '.items[] | {id, error_message}'

# Get failures in a time window
ff-telemetry-read broker failed \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z
```

### Investigate a Failure

```bash
# 1. Get the full trace for a failed request
ff-telemetry-read trace get <broker-request-id> | jq .

# 2. See which LLM calls were made
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[] | {provider: .provider_name, status: .status}'

# 3. Check for tool call failures
ff-telemetry-read trace get <broker-request-id> | jq '.llm_requests[].tool_calls[] | select(.status == "failed")'
```

### Find Requests by Entity (Breadcrumb)

```bash
# Find all requests for a specific entity
ff-telemetry-read trace by-breadcrumb ReportReviewWorkflowEntity <entity-id>

# Find all requests for an entity type
ff-telemetry-read trace by-breadcrumb agent

# Search broker requests by breadcrumb
ff-telemetry-read broker search --breadcrumb-type "agent" --breadcrumb-id "<agent-id>"
```

### Analyze LLM Calls

```bash
# Find LLM requests by provider
ff-telemetry-read llm search --provider-name anthropic --size 50

# Find failed LLM requests
ff-telemetry-read llm search --status failed

# Get LLM calls for a specific broker request
ff-telemetry-read llm by-broker <broker-request-id> | jq '.[] | {model: .model_name, tokens: .total_tokens}'
```

### Analyze Tool Usage

```bash
# Find tool calls by name
ff-telemetry-read tool search --tool-name "read_file" --size 100

# Find failed tool calls
ff-telemetry-read tool search --status failed

# Get tool calls for an LLM request
ff-telemetry-read tool by-llm <llm-request-id>
```

### Time-Based Searches

```bash
# Recent requests (last hour)
ff-telemetry-read broker search --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)

# Specific time window
ff-telemetry-read broker search \
  --start-time 2024-01-01T10:00:00Z \
  --end-time 2024-01-01T11:00:00Z

# Note: On Linux, use: date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ
```

## Output Processing with jq

```bash
# Pretty print
ff-telemetry-read broker get <id> | jq .

# Extract status and error
ff-telemetry-read broker get <id> | jq '{status, error_message}'

# Get all failed request IDs
ff-telemetry-read broker failed | jq '.items[].id'

# Analyze LLM providers in a trace
ff-telemetry-read trace get <id> | jq '.llm_requests[].provider_name' | sort | uniq -c

# Sum tokens across LLM requests
ff-telemetry-read trace get <id> | jq '[.llm_requests[].total_tokens] | add'
```

## Pagination

Search commands support pagination:

```bash
# First page
ff-telemetry-read broker search --page 0 --size 50

# Next page
ff-telemetry-read broker search --page 1 --size 50
```

Results include pagination info:
```json
{
  "items": [...],
  "total": 150,
  "page": 0,
  "size": 50
}
```

## Diagnostic Workflows

### Workflow 1: Entity Request History

When you know an entity ID and want to see all requests:

```bash
# 1. Find all broker requests for this entity
ff-telemetry-read trace by-breadcrumb <EntityType> <entity-id>

# 2. Filter to failures
ff-telemetry-read broker search --breadcrumb-type "<EntityType>" --breadcrumb-id "<entity-id>" --has-error

# 3. Get full trace of a specific failure
ff-telemetry-read trace get <broker-request-id>
```

### Workflow 2: LLM Error Analysis

When LLM calls are failing:

```bash
# 1. Find recent LLM failures
ff-telemetry-read llm search --status failed --size 20

# 2. Check which providers are affected
ff-telemetry-read llm search --status failed | jq '.items[].provider_name' | sort | uniq -c

# 3. Get details on a specific failure
ff-telemetry-read llm get <llm-request-id> | jq '{error: .error_message, request: .request_data}'
```

### Workflow 3: Tool Call Debugging

When tool calls are failing:

```bash
# 1. Find failed tool calls
ff-telemetry-read tool search --status failed --size 20

# 2. See which tools are failing
ff-telemetry-read tool search --status failed | jq '.items[].tool_name' | sort | uniq -c

# 3. Get the full context (LLM request that invoked the tool)
ff-telemetry-read tool get <tool-call-id> | jq '.llm_request_id'
ff-telemetry-read llm get <llm-request-id>
```

## Correlating with Logs

The breadcrumb structure links telemetry to logs:

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

Use these values to search local logs:
```bash
# Search logs by entity_id
grep "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1" logs/*.log

# Search logs by correlation_id
grep "279f4ee6-4cc4-4880-9736-4c64c5ab39be" logs/*.log
```

## Error Handling

If commands fail, the tool auto-configures from `.env` files so configuration issues are rare.

For connection troubleshooting, load [modes/configuration.md](./modes/configuration.md).

## See Also

- [ff-diagnostics](../ff-diagnostics/SKILL.md) - Full diagnostic workflow orchestration
- [ff-eg-read](../ff-eg-read/SKILL.md) - Entity graph inspection
- [ff-cli](../ff-cli/SKILL.md) - Cluster operations
