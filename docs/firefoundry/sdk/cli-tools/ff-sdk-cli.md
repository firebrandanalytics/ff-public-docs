# ff-sdk-cli — Agent Bundle Testing Client

CLI client for interacting with running FireFoundry Agent Bundle servers. Invoke entity methods, run bots, call custom API endpoints, and manage streaming iterators.

## Installation

The `ff-sdk-cli` tool is part of the [ff-agent-sdk](https://github.com/firebrandanalytics/ff-agent-sdk) monorepo at `apps/ff-sdk-cli`. It uses the `@firebrandanalytics/ff-sdk` client package.

```bash
npm install -g @firebrandanalytics/ff-sdk-cli
```

## Configuration

The tool requires a running agent bundle server. For local development, the server typically runs on a port like 3001 or is accessed through Kong.

### Global Options

| Option | Env Var | Purpose | Default |
|--------|---------|---------|---------|
| `--url` | `FF_SDK_URL` | Agent bundle server URL | *(required)* |
| `--api-key` | `FF_SDK_API_KEY` | API key for authentication | *(none)* |
| `--timeout` | `FF_SDK_TIMEOUT` | Request timeout in ms | `200000` |
| `--external` | `FF_SDK_EXTERNAL` | Use external mode (Kong gateway) | `false` |

## Command Reference

### Health & Info

Check server status and capabilities.

#### health

Check if the server is healthy (basic liveness check).

```bash
ff-sdk-cli health --url http://localhost:3001
```

#### ready

Check if the server is fully initialized and ready to accept requests.

```bash
ff-sdk-cli ready --url http://localhost:3001
```

#### info

Get server information including app name, version, and capabilities.

```bash
ff-sdk-cli info --url http://localhost:3001
ff-sdk-cli info --url http://localhost:3001 | jq .
```

### Entity Invocation

Invoke methods on entities by UUID.

#### invoke

Invoke a method with JSON arguments.

```bash
ff-sdk-cli invoke <entity-id> <method> [args-json] --url <url>
```

Arguments are passed as a JSON array.

```bash
# Invoke a method with no args
ff-sdk-cli invoke <entity-id> get_summary --url <url>

# Invoke with arguments
ff-sdk-cli invoke <entity-id> update_status '["completed", {"reason": "done"}]' --url <url>

# Extract a field from the result
ff-sdk-cli invoke <id> get_summary --url <url> | jq '.summary'
```

#### invoke-blob

Invoke a method with file upload. Uses `{"$blob": N}` placeholders to reference uploaded files (0-indexed).

```bash
ff-sdk-cli invoke-blob <entity-id> <method> [args-json] --file <path> --url <url>
```

When no explicit args are provided, `invoke-blob` auto-generates blob placeholders with filenames.

```bash
# Upload and process a document (auto-generated args)
ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./report.pdf \
  --url http://localhost:3001

# Explicit blob reference in args
ff-sdk-cli invoke-blob <entity-id> process_document \
  '[{"$blob": 0}, "document.pdf"]' \
  --file ./document.pdf --url <url>
```

#### invoke-binary

Invoke a method expecting a binary response (e.g., PDF export).

```bash
ff-sdk-cli invoke-binary <entity-id> <method> [options] --url <url>
```

| Option | Purpose |
|--------|---------|
| `-o <path>` | Save binary response to file |

```bash
# Save binary response to file
ff-sdk-cli invoke-binary <entity-id> export_pdf -o ./output.pdf --url <url>

# Get base64-encoded response to stdout
ff-sdk-cli invoke-binary <entity-id> export_pdf --url <url>
```

### Bot Operations

Run bots registered in the agent bundle.

#### bot run

Run a bot synchronously and get the final result.

```bash
ff-sdk-cli bot run <bot-name> [input-json] --url <url>
```

```bash
ff-sdk-cli bot run my-analysis-bot '{"input": "analyze this data"}' --url <url>
```

#### bot run-blob

Run a bot with file upload.

```bash
ff-sdk-cli bot run-blob <bot-name> [args-json] --file <path> --url <url>
```

```bash
ff-sdk-cli bot run-blob my-doc-bot '{"input": {"$blob": 0}}' \
  --file ./data.csv --url <url>
```

#### bot start

Start a bot with streaming — receive values as they are produced.

```bash
ff-sdk-cli bot start <bot-name> [input-json] [options] --url <url>
```

| Option | Purpose |
|--------|---------|
| `--limit <N>` | Maximum number of streamed values |

```bash
# Stream all values
ff-sdk-cli bot start my-analysis-bot '{"input": "..."}' --url <url>

# Limit to 10 values
ff-sdk-cli bot start my-analysis-bot '{"input": "..."}' --limit 10 --url <url>

# Process streamed values
ff-sdk-cli bot start my-analysis-bot \
  '{"input": "Analyze Q4 revenue trends"}' \
  --url http://localhost:3001 | jq '.values[]'
```

#### bot start-blob

Start a bot with streaming and file upload.

```bash
ff-sdk-cli bot start-blob <bot-name> [args-json] --file <path> --url <url>
```

#### bot list

List bots available in the agent bundle (retrieved via server info).

```bash
ff-sdk-cli bot list --url <url>
```

### Custom API Endpoints

Call custom API routes registered by the agent bundle.

#### api call

Make an HTTP request to a custom route.

```bash
ff-sdk-cli api call <route> [options] --url <url>
```

| Option | Purpose |
|--------|---------|
| `--method <METHOD>` | HTTP method (default: GET) |
| `--body '<json>'` | Request body for POST/PUT |
| `--query '<json>'` | Query parameters |

```bash
# GET request
ff-sdk-cli api call /custom-route --url <url>

# POST with body
ff-sdk-cli api call /custom-route --method POST --body '{"key": "value"}' --url <url>

# With query parameters
ff-sdk-cli api call /custom-route --query '{"page": 1, "limit": 10}' --url <url>
```

#### api call-blob

API call with file upload.

```bash
ff-sdk-cli api call-blob <route> --file <path> --url <url>
```

#### api call-binary

API call expecting a binary response.

```bash
ff-sdk-cli api call-binary <route> -o <path> --url <url>
```

```bash
ff-sdk-cli api call-binary /export -o ./download.pdf --url <url>
```

### Iterator Operations

Manage long-running streaming operations. Start an iterator, then consume values step by step or all at once.

#### iterator run

Start an iterator and consume all values automatically.

```bash
ff-sdk-cli iterator run <entity-id> [method] [args] --url <url>
```

| Option | Purpose |
|--------|---------|
| `--limit <N>` | Maximum number of values to consume |

```bash
# Consume all values
ff-sdk-cli iterator run <entity-id> start --url <url>

# Limit to 5 values
ff-sdk-cli iterator run <entity-id> start --limit 5 --url <url>
```

#### iterator start

Start an iterator and return an iterator ID for manual control.

```bash
ff-sdk-cli iterator start <entity-id> [method] [args] --url <url>
```

Returns an `iterator_id` for use with `next`, `status`, and `cleanup`.

#### iterator start-blob

Start an iterator with file upload.

```bash
ff-sdk-cli iterator start-blob <entity-id> --file <path> --url <url>
```

#### iterator next

Get the next value from an active iterator.

```bash
ff-sdk-cli iterator next <iterator-id> --url <url>
```

#### iterator status

Check the status of an active iterator.

```bash
ff-sdk-cli iterator status <iterator-id> --url <url>
```

#### iterator cleanup

Clean up an iterator and release its resources.

```bash
ff-sdk-cli iterator cleanup <iterator-id> --url <url>
```

#### iterator stats

Get statistics about active iterators on the server.

```bash
ff-sdk-cli iterator stats --url <url>
```

### Manual Iterator Workflow

```bash
# 1. Start the iterator
ff-sdk-cli iterator start <entity-id> start --url <url>
# Returns: {"iterator_id": "abc-123"}

# 2. Consume values one at a time
ff-sdk-cli iterator next abc-123 --url <url>
ff-sdk-cli iterator next abc-123 --url <url>

# 3. Check status
ff-sdk-cli iterator status abc-123 --url <url>

# 4. Clean up when done
ff-sdk-cli iterator cleanup abc-123 --url <url>
```

## Common Workflows

### Quick Health Check

```bash
ff-sdk-cli health --url http://localhost:3001 | jq .
ff-sdk-cli info --url http://localhost:3001 | jq .
```

### Test an Entity Method

```bash
# 1. Check the server is ready
ff-sdk-cli ready --url http://localhost:3001

# 2. Invoke the method
ff-sdk-cli invoke <entity-id> get_data --url http://localhost:3001 | jq .
```

### Upload and Process a File

```bash
ff-sdk-cli invoke-blob <entity-id> process_document \
  --file ./report.pdf \
  --url http://localhost:3001
```

### Test a Bot End-to-End

```bash
# List available bots
ff-sdk-cli bot list --url http://localhost:3001

# Run synchronously
ff-sdk-cli bot run my-bot '{"input": "test input"}' --url http://localhost:3001

# Run with streaming to see intermediate values
ff-sdk-cli bot start my-bot '{"input": "test input"}' --url http://localhost:3001
```

## See Also

- [ff-eg-read](ff-eg-read.md) — Query the entity graph
- [ff-eg-write](ff-eg-write.md) — Modify the entity graph
- [ff-wm-read](ff-wm-read.md) — Read working memory (files, records)
- [Agent SDK](../agent_sdk/README.md) — Building agent bundles
- [ff-cli Operations](../../../ff-cli/ops.md) — Build and deploy agent bundles
