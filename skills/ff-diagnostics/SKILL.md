---
name: ff-diagnostics
description: Diagnose and debug FireFoundry issues by coordinating entity graph inspection, telemetry analysis, log searching, and source code correlation. Use when investigating failures, tracing requests, or debugging agent bundle behavior.
version: 1.1.0
tags: [firefoundry, diagnostics, debugging, orchestration]
skills: ff-eg-read, ff-telemetry-read, ff-cli
---

# FireFoundry Diagnostics Skill

Orchestrate diagnostics across the FireFoundry platform. This skill routes you to the appropriate mode file based on your starting point.

## Prerequisites

### Required
- `ff-eg-read` CLI installed (auto-configures from `.env`)
- `ff-telemetry-read` CLI installed (auto-configures from `.env`)
- Access to local log files (`./logs/`)

### Optional
- Azure MCP server for App Insights queries
- `ff-cli` for cluster operations
- `kubectl` / `helm` for direct cluster access

Tools auto-configure from environment variables or `.env` files. For connection issues, see the tool-specific configuration modes:
- [ff-eg-read configuration](../ff-eg-read/modes/configuration.md)
- [ff-telemetry-read configuration](../ff-telemetry-read/modes/configuration.md)

---

## Decision Flowchart

**Route to the correct mode file based on what you have:**

```
What do you have?
│
├─► Entity ID (failed, stuck, or misbehaving)
│   └─► Load: modes/entity-graph.md
│       Start: ff-eg-read node get <entity-id>
│
├─► Error message from logs
│   └─► Load: modes/logs-local.md
│       Start: grep "<error-pattern>" logs/*.log
│       Then: Extract entity_id from breadcrumbs, continue with entity path
│
├─► Broker request ID or telemetry trace
│   └─► Load: modes/telemetry.md
│       Start: ff-telemetry-read trace get <broker-request-id>
│
├─► LLM or bot failure
│   └─► Load: modes/telemetry.md (for LLM request details)
│       Then: modes/agent-bundle-source.md (for bot/prompt correlation)
│
├─► Pod not starting, OOMKilled, cluster issues
│   └─► Load: modes/cluster.md
│       Start: kubectl get pods -n <namespace>
│
├─► Mysterious behavior (works sometimes, logs missing, impossible values)
│   └─► Load: modes/mysterious-failures.md
│       Covers: async issues, race conditions, memory leaks, FFError patterns
│
├─► Need to find where a log message originates in code
│   ├─► Agent bundle code → Load: modes/agent-bundle-source.md
│   └─► Platform service code → Load: modes/platform-service-source.md
│
└─► Azure App Insights queries (platform-level, 5-10 min delay)
    └─► Load: modes/logs-azure.md
```

### IF/THEN Quick Reference

```
IF you have entity_id:
  → ff-eg-read node get <id> | jq '{status, error}'
  → ff-eg-read node progress <id>  # for runnable entities
  → Extract breadcrumbs for cross-system correlation

ELSE IF you have error message:
  → grep "<pattern>" logs/*.log | jq '.properties.breadcrumbs[0].entity_id'
  → Continue with entity_id path

ELSE IF you have broker_request_id:
  → ff-telemetry-read trace get <id>
  → Extract entity from breadcrumbs

ELSE IF entity stuck in "Waiting":
  → ff-eg-read node progress <id> | jq '.[] | select(.type == "WAITING")'
  → Check expected input type, verify external trigger

ELSE IF no logs appearing:
  → Load modes/mysterious-failures.md (infinite loop, process exit, async issues)
```

---

## Correlation Matrix

**How to search across systems using the same identifier:**

| Identifier | Entity Graph | Telemetry | Logs |
|------------|--------------|-----------|------|
| `entity_id` | `ff-eg-read node get <id>` | `ff-telemetry-read trace by-breadcrumb <type> <id>` | `grep "<id>" logs/*.log` |
| `entity_type` | `ff-eg-read search nodes-scoped --condition '{"entity_type":{"$eq":"<type>"}}'` | `ff-telemetry-read trace by-breadcrumb <type> <id>` | `grep "<type>" logs/*.log` |
| `correlation_id` | - | - | `grep "<corr_id>" logs/*.log` |
| `broker_request_id` | - | `ff-telemetry-read trace get <id>` | - |
| `llm_request_id` | - | `ff-telemetry-read llm get <id>` | - |

### Field Paths in Each System

| Concept | Entity Graph Field | Telemetry Field | Log Field |
|---------|-------------------|-----------------|-----------|
| Entity ID | `id` | `breadcrumbs[].entity_id` | `properties.breadcrumbs[].entity_id` |
| Entity Type | `entity_type` | `breadcrumbs[].entity_type` | `properties.breadcrumbs[].entity_type` |
| Correlation ID | - | `breadcrumbs[].correlation_id` | `properties.breadcrumbs[].correlation_id` |
| Status | `status` | `status` | `level` (error/warn/info) |
| Timestamp | `created_at`, `updated_at` | `started_at`, `completed_at` | `timestamp` |
| Error | `error` | `error_message` | `message` (when level=error) |

---

## Key Concepts

### Breadcrumbs

Breadcrumbs are the correlation thread linking entities, telemetry, and logs. They are automatically injected by the SDK via `AsyncLocalStorage`.

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

- **entity_type** - The class name of the entity
- **entity_id** - Unique identifier (UUID) for the entity instance
- **correlation_id** - Links related operations across a single execution flow

Multiple breadcrumbs indicate nested entity calls (parent → child).

### Entity Types

| Type | Description | Key Diagnostic |
|------|-------------|----------------|
| **Workflow** | Orchestrates multi-step processes | Check child entity statuses |
| **Runnable** | Single execution, ID = idempotency key | Check progress envelopes |
| **Waitable** | Runnable that pauses for external input | Check WAITING envelope, input delivery |
| **Bot** | Stateless AI processor | Check telemetry for LLM/tool calls |

### Diagnostic Flow (Overview)

```
1. ENTITY GRAPH → Identify entity, get state and breadcrumbs
2. TELEMETRY → Trace requests (broker → LLM → tool calls)
3. LOGS → Search by entity_id or correlation_id
4. SOURCE CODE → Correlate logs to code location
5. CLUSTER (if needed) → Pod status, resource issues
```

---

## Mode Files

| Mode | When to Load | Content |
|------|--------------|---------|
| [entity-graph.md](./modes/entity-graph.md) | Have entity ID, investigating entity state | Entity queries, progress envelopes, relationships |
| [telemetry.md](./modes/telemetry.md) | Tracing requests, LLM failures, tool calls | Broker/LLM/tool queries, trace hierarchy |
| [logs-local.md](./modes/logs-local.md) | Searching local Winston JSON logs | grep/jq patterns, log structure, filtering |
| [logs-azure.md](./modes/logs-azure.md) | Platform-level logs (5-10 min delay) | KQL queries, App Insights via MCP |
| [cluster.md](./modes/cluster.md) | Pod issues, deployments, Kong gateway | kubectl patterns, namespace structure |
| [agent-bundle-source.md](./modes/agent-bundle-source.md) | Correlating diagnostics to agent bundle code | run_impl, progress envelopes, bot patterns |
| [platform-service-source.md](./modes/platform-service-source.md) | Internal platform service debugging | Provider patterns, route mapping |
| [source-correlation.md](./modes/source-correlation.md) | General log-to-source correlation | Finding log origins in code |
| [mysterious-failures.md](./modes/mysterious-failures.md) | Edge cases, async issues, "works sometimes" | FFError, race conditions, memory, event loop |

---

## See Also

- [ff-eg-read](../ff-eg-read/SKILL.md) - Entity graph CLI reference
- [ff-telemetry-read](../ff-telemetry-read/SKILL.md) - Telemetry CLI reference
- [ff-wm-read](../ff-wm-read/SKILL.md) - Working memory (files/documents) CLI reference
- [ff-cli](../ff-cli/SKILL.md) - Cluster operations CLI
