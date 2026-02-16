# Azure App Insights Log Searching

Guide for searching FireFoundry platform logs in Azure Application Insights using the Azure MCP server.

## Important: Ingestion Delay

**App Insights has a 5-10 minute ingestion delay.** Logs from the last few minutes may not be available yet.

For real-time debugging:
- Use [local logs](./logs-local.md) first
- Use App Insights for historical analysis and platform-level correlation

## Prerequisites

### Azure MCP Server

This feature requires the Azure MCP server to be installed and configured. If it's not available, you'll need to use the Azure Portal or Azure CLI directly.

**Check if available:**
Look for Azure-related MCP tools in your available tools list. The relevant tools are:
- `azure_monitor_query_workspace_logs` - Query Log Analytics
- `azure_monitor_query_resource_logs` - Query resource-specific logs
- `azure_monitor_list_workspaces` - Find available workspaces
- `azure_monitor_list_tables` - Discover available tables

### Required Information

You'll need:
- **Resource Group** - Azure resource group name
- **Workspace Name** - Log Analytics workspace name (where App Insights data is stored)
- Or **Resource ID** - For resource-specific queries

## Relevant App Insights Tables

| Table | Contains |
|-------|----------|
| `AppTraces` | Custom log messages (Winston logs forwarded to App Insights) |
| `AppExceptions` | Exceptions and stack traces |
| `AppRequests` | HTTP requests to your services |
| `AppDependencies` | Outbound calls (DB, HTTP, etc.) |
| `AppEvents` | Custom events |
| `AppMetrics` | Performance metrics |

## Using the Azure MCP Tools

### List Available Workspaces

```
Use the azure_monitor_list_workspaces tool to find available workspaces
```

### List Tables in a Workspace

```
Use the azure_monitor_list_tables tool with:
- resource_group: "your-resource-group"
- workspace: "your-workspace-name"
```

### Query Logs

The primary tool is `azure_monitor_query_workspace_logs`. You can use natural language prompts:

**Find recent errors:**
```
"Query errors from last hour in workspace 'ff-logs-workspace' in resource group 'firefoundry-prod'"
```

**Find logs for a specific entity:**
```
"Find AppTraces containing 'entity-id-here' from the last 24 hours in workspace 'ff-logs-workspace' in resource group 'firefoundry-prod'"
```

**Find exceptions:**
```
"Show AppExceptions from the last 4 hours in workspace 'ff-logs-workspace' in resource group 'firefoundry-prod'"
```

## Common Query Patterns

### Find Errors by Entity ID

```
Query AppTraces in the last 24 hours where message contains 'entity-id' and severityLevel >= 3
```

The Azure MCP will translate this to KQL like:
```kusto
AppTraces
| where TimeGenerated > ago(24h)
| where Message contains "entity-id"
| where SeverityLevel >= 3
| order by TimeGenerated desc
```

### Find Exceptions with Stack Traces

```
Show AppExceptions from the last hour, include the stack trace and problem ID
```

### Correlate by Operation ID

App Insights uses `operation_Id` for correlation across requests:

```
Find all logs with operation_Id 'abc123' from the last hour
```

### Find Slow Requests

```
Query AppRequests from the last 24 hours where duration > 5000 (5 seconds)
```

### Search Across Services

```
Find AppTraces from the last 4 hours where cloud_RoleName contains 'agent-bundle-name'
```

## KQL Reference (Manual Queries)

If you need to construct KQL directly (or the MCP isn't available):

### Basic Trace Query
```kusto
AppTraces
| where TimeGenerated > ago(1h)
| where Message contains "entity-id"
| order by TimeGenerated desc
| take 100
```

### Error Query
```kusto
AppTraces
| where TimeGenerated > ago(4h)
| where SeverityLevel >= 3
| summarize count() by Message
| order by count_ desc
```

### Exception Query
```kusto
AppExceptions
| where TimeGenerated > ago(1h)
| project TimeGenerated, ProblemId, ExceptionType, OuterMessage, InnermostMessage
| order by TimeGenerated desc
```

### Cross-Table Correlation
```kusto
// Find trace and exception for same operation
let opId = "operation-id-here";
union AppTraces, AppExceptions
| where operation_Id == opId
| order by TimeGenerated asc
```

## Mapping Local Logs to App Insights

Local Winston logs map to App Insights as follows:

| Winston Field | App Insights Field |
|---------------|-------------------|
| `message` | `Message` |
| `level` | `SeverityLevel` (0=Verbose, 1=Info, 2=Warning, 3=Error, 4=Critical) |
| `timestamp` | `TimeGenerated` |
| `properties.*` | `CustomDimensions` |

### Level Mapping
| Winston | Value | App Insights SeverityLevel |
|---------|-------|---------------------------|
| detail | 5 | 0 (Verbose) |
| debug | 4 | 0 (Verbose) |
| info | 3 | 1 (Information) |
| warn | 2 | 2 (Warning) |
| error | 1 | 3 (Error) |
| critical | 0 | 4 (Critical) |

### Searching Custom Properties

Custom properties from Winston are in `customDimensions`:

```kusto
AppTraces
| where customDimensions.entity_id == "abc-123"
| order by TimeGenerated desc
```

Or:
```kusto
AppTraces
| where customDimensions contains "entity-id"
```

## Diagnostic Workflows

### Workflow 1: Investigate Production Error

```
1. Find recent errors:
   "Query AppTraces with SeverityLevel >= 3 from the last hour in workspace 'ff-prod-logs'"

2. Get error details:
   "Find AppExceptions from the last hour, show ExceptionType and OuterMessage"

3. Correlate with entity:
   "Find all AppTraces containing 'entity-id' from the last 2 hours"

4. Check if request failed:
   "Query AppRequests with success == false from the last hour"
```

### Workflow 2: Track Request Flow

```
1. Find the operation ID from an error
2. Query all logs for that operation:
   "Find all logs with operation_Id 'xyz' from AppTraces, AppExceptions, and AppRequests"

3. Analyze the timeline
```

### Workflow 3: Compare Local and Remote Logs

```
1. Find timestamp of issue in local logs
2. Query App Insights for that time window (add 5-10 min for ingestion delay):
   "Query AppTraces between '2025-10-15T02:40:00Z' and '2025-10-15T02:50:00Z'"

3. Look for platform-level context not in local logs
```

## Without MCP Server

If the Azure MCP server is not available:

### Azure CLI
```bash
# Query via Azure CLI
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "AppTraces | where TimeGenerated > ago(1h) | take 100"
```

### Azure Portal
1. Go to your Application Insights resource
2. Navigate to Logs (under Monitoring)
3. Use the KQL queries above

## Tips

### Time Zone Awareness
App Insights uses UTC. When comparing with local logs, ensure timestamps align:
```bash
# Local time to UTC
date -u
```

### Use Sampling with Care
For high-volume applications, App Insights may sample data. Not all logs may be present.

### Check Ingestion Status
If logs seem missing, verify ingestion is working:
```kusto
AppTraces
| where TimeGenerated > ago(5m)
| summarize count()
```

Zero or very low count may indicate ingestion issues.

### Cost Awareness
Large queries can be expensive. Use time filters and limits:
```kusto
AppTraces
| where TimeGenerated > ago(1h)  -- Time filter first
| where Message contains "error"  -- Then filter by content
| take 100                        -- Limit results
```
