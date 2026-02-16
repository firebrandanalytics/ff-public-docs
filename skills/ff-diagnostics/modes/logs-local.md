# Local Log Searching

Detailed guide for searching and analyzing FireFoundry local log files.

## Log File Basics

### Location
Logs are stored in `./logs/` relative to the agent bundle project:
```
<project>/logs/
├── LogFile-2025-10-15T02-01-00-284Z.log
├── LogFile-2025-10-15T02-04-36-729Z.log
└── LogFile-2025-10-15T02-43-08-832Z.log
```

### Naming Convention
```
LogFile-<ISO-timestamp>.log
```
Each service restart creates a new file. Most recent file = current/last run.

### Find Recent Logs
```bash
# Most recent log file
ls -t logs/*.log | head -1

# Last 5 log files
ls -t logs/*.log | head -5

# Logs from today
ls -la logs/*.log | grep $(date +%Y-%m-%d)
```

## Log Structure

Each line is a JSON object:

```json
{
  "message": "Processing document",
  "level": "info",
  "timestamp": "2025-10-15T02:43:09.802Z",
  "properties": {
    "slot": "ff_sdk",
    "version": "0.0.1",
    "filename": "DocumentProcessor.ts",
    "functionName": "processDocument",
    "lineNumber": "142",
    "breadcrumbs": [
      {
        "entity_type": "DocumentEntity",
        "entity_id": "abc-123",
        "correlation_id": "xyz-789"
      }
    ],
    "documentId": "doc-456",
    "customField": "value"
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `message` | Log message text |
| `level` | critical, error, warn, info, debug, detail |
| `timestamp` | ISO 8601 timestamp |
| `properties.filename` | Source file name |
| `properties.functionName` | Function that logged |
| `properties.lineNumber` | Line number in source |
| `properties.breadcrumbs` | Entity context array |

## Searching with grep

### Basic Pattern Search
```bash
# Search for text pattern
grep "error" logs/*.log

# Case insensitive
grep -i "failed" logs/*.log

# In specific log file
grep "pattern" logs/LogFile-2025-10-15T02-43-08-832Z.log
```

### Search by Entity ID
```bash
# Find all logs for an entity
grep "5f3c35ef-e28b-4d1a-b9d5-2e8148d54ec1" logs/*.log

# With context (5 lines before/after)
grep -B5 -A5 "entity-id" logs/*.log
```

### Search by Correlation ID
```bash
grep "279f4ee6-4cc4-4880-9736-4c64c5ab39be" logs/*.log
```

### Search by Log Level
```bash
# Find errors
grep '"level":"error"' logs/*.log

# Find errors and warnings
grep -E '"level":"(error|warn)"' logs/*.log

# Find critical issues
grep '"level":"critical"' logs/*.log
```

### Search by Source File
```bash
# Logs from a specific file
grep '"filename":"DocumentProcessor.ts"' logs/*.log

# Logs from any file matching pattern
grep -E '"filename":".*Processor.*"' logs/*.log
```

### Combine Patterns
```bash
# Errors in a specific file
grep '"level":"error"' logs/*.log | grep '"filename":"AuthService.ts"'

# Errors for a specific entity
grep '"level":"error"' logs/*.log | grep "entity-id"
```

## Searching with jq

jq provides powerful JSON filtering. Since log files contain one JSON object per line, use `-s` to slurp or process line by line.

### Basic Queries
```bash
# Pretty print all logs (careful with large files)
cat logs/latest.log | jq -s '.'

# Get just messages
cat logs/latest.log | jq '.message'

# Get message and level
cat logs/latest.log | jq '{message, level}'
```

### Filter by Level
```bash
# Only errors
cat logs/latest.log | jq 'select(.level == "error")'

# Errors and warnings
cat logs/latest.log | jq 'select(.level == "error" or .level == "warn")'

# Everything except debug/detail
cat logs/latest.log | jq 'select(.level != "debug" and .level != "detail")'
```

### Filter by Entity
```bash
# Find logs for a specific entity
cat logs/latest.log | jq 'select(.properties.breadcrumbs[]?.entity_id == "abc-123")'

# Find logs for an entity type
cat logs/latest.log | jq 'select(.properties.breadcrumbs[]?.entity_type == "WorkflowEntity")'
```

### Filter by Time
```bash
# Logs after a timestamp
cat logs/latest.log | jq 'select(.timestamp > "2025-10-15T02:30:00Z")'

# Logs in a time range
cat logs/latest.log | jq 'select(.timestamp > "2025-10-15T02:30:00Z" and .timestamp < "2025-10-15T02:45:00Z")'
```

### Filter by Source
```bash
# From a specific file
cat logs/latest.log | jq 'select(.properties.filename == "BotService.ts")'

# From a specific function
cat logs/latest.log | jq 'select(.properties.functionName | contains("process"))'
```

### Extract Specific Data
```bash
# Get unique entity IDs mentioned
cat logs/latest.log | jq -r '.properties.breadcrumbs[]?.entity_id' | sort | uniq

# Get error messages only
cat logs/latest.log | jq 'select(.level == "error") | .message'

# Get filename:line for errors
cat logs/latest.log | jq -r 'select(.level == "error") | "\(.properties.filename):\(.properties.lineNumber)"' | sort | uniq -c
```

### Sort and Limit
```bash
# Sort by timestamp (slurp first)
cat logs/latest.log | jq -s 'sort_by(.timestamp)'

# Last 10 entries
cat logs/latest.log | jq -s '.[-10:][]'

# First 10 errors
cat logs/latest.log | jq -s '[.[] | select(.level == "error")][:10][]'
```

### Aggregate and Count
```bash
# Count by level
cat logs/latest.log | jq -s 'group_by(.level) | map({level: .[0].level, count: length})'

# Count by source file
cat logs/latest.log | jq -s 'group_by(.properties.filename) | map({file: .[0].properties.filename, count: length}) | sort_by(.count) | reverse[:10]'

# Count error messages
cat logs/latest.log | jq -s '[.[] | select(.level == "error")] | group_by(.message) | map({message: .[0].message, count: length}) | sort_by(.count) | reverse'
```

## Combining grep and jq

For large files, use grep to filter first, then jq to parse:

```bash
# Find errors, then format nicely
grep '"level":"error"' logs/*.log | jq '{time: .timestamp, file: .properties.filename, msg: .message}'

# Find entity logs, extract timeline
grep "entity-id" logs/*.log | jq -s 'sort_by(.timestamp) | .[] | {time: .timestamp, level, message}'
```

## Common Diagnostic Patterns

### Timeline for an Entity
```bash
# Get chronological view of entity activity
grep "entity-id" logs/*.log | jq -s 'sort_by(.timestamp) | .[] | "\(.timestamp) [\(.level)] \(.message)"' -r
```

### Error Summary
```bash
# Unique errors with counts
grep '"level":"error"' logs/*.log | jq '.message' | sort | uniq -c | sort -rn | head -20
```

### Find What Happened Before an Error
```bash
# Get 20 lines before each error
grep -B20 '"level":"error"' logs/latest.log
```

### Trace a Request Flow
```bash
# All logs with a correlation ID, sorted
grep "correlation-id" logs/*.log | jq -s 'sort_by(.timestamp) | .[] | {time: .timestamp, func: .properties.functionName, msg: .message}'
```

### Find Slow Operations
```bash
# If you log durations, find slow ones
cat logs/latest.log | jq 'select(.properties.duration_ms > 1000) | {msg: .message, duration: .properties.duration_ms}'
```

## Log Level Configuration

### Check Current Levels
```bash
echo "Console: ${CONSOLE_LOG_LEVEL:-debug}"
echo "File: ${FILE_LOG_LEVEL:-debug}"
echo "App Insights: ${AIS_LOG_LEVEL:-debug}"
```

### Available Levels
| Level | Verbosity | Use |
|-------|-----------|-----|
| critical | Lowest | System failures only |
| error | Low | Operation failures |
| warn | Medium | Potential issues |
| info | Medium | Key events |
| debug | High | Detailed flow |
| detail | Highest | Verbose debugging |

### Increase Verbosity
```bash
# Set for maximum detail
export FILE_LOG_LEVEL=detail
export CONSOLE_LOG_LEVEL=detail

# Restart service to apply
```

### Reduce Noise in Production
```bash
export FILE_LOG_LEVEL=info
export CONSOLE_LOG_LEVEL=warn
```

## Tips

### Use the Grep Tool
Claude's built-in Grep tool uses ripgrep and is efficient for large files:
```
Use Grep to search for "entity-id" in logs/*.log
```

### Read Specific Sections
For very large logs, use Read with offset/limit:
```
Read logs/large.log starting at line 1000, limit 100 lines
```

### Process Multiple Log Files
```bash
# Combine and sort across files
cat logs/*.log | jq -s 'sort_by(.timestamp)' > /tmp/combined.json

# Then query the combined file
cat /tmp/combined.json | jq '.[] | select(.level == "error")'
```

### Save Filtered Results
```bash
# Save errors to separate file
grep '"level":"error"' logs/*.log > /tmp/errors.log

# Save entity timeline
grep "entity-id" logs/*.log | jq -s 'sort_by(.timestamp)' > /tmp/entity-timeline.json
```
