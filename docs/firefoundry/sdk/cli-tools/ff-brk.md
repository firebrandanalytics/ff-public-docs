# ff-brk — Broker CLI for LLM Completions

CLI tool for sending chat completion requests to the FireFoundry Broker service via gRPC. Use it to test broker routing, verify model pool configurations, and debug LLM connectivity.

## Installation

```bash
npm install -g @firebrandanalytics/ff-brk
```

Verify:

```bash
ff-brk complete --help
```

## Configuration

The tool connects to the FF Broker gRPC service. Auto-configures from environment variables or a `.env` file in the current working directory.

| Variable | Purpose | Default |
|----------|---------|---------|
| `FF_BROKER_HOST` | Broker service host | `localhost` |
| `FF_BROKER_PORT` | Broker service gRPC port | `50099` |

### Port-Forward Setup

For local development, port-forward the broker service:

```bash
kubectl port-forward -n firefoundry-home svc/ff-broker 50099:50099
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `complete` | Send a chat completion request to the broker |

## Command Reference

### complete

Send a chat completion request to the broker.

```bash
ff-brk complete --model-pool <pool> --semantic-label <label> --message <msg> [options]
```

**Required Options:**

| Option | Alias | Purpose |
|--------|-------|---------|
| `--model-pool` | `-m` | Model pool to route the request to (e.g., `gpt-4o`, `claude-sonnet`) |
| `--semantic-label` | `-l` | Semantic label for tracking and mock cache lookup |
| `--message` | `--msg` | User message to send |

**Optional:**

| Option | Alias | Purpose |
|--------|-------|---------|
| `--system` | `-s` | System prompt |
| `--temperature` | `-t` | Temperature for generation (0.0–2.0) |
| `--max-tokens` | | Maximum tokens to generate |
| `--mock-cache-id` | `-c` | Mock cache ID for deterministic testing |
| `--json` | `-j` | Output response as JSON |

**Global Options:**

| Option | Purpose |
|--------|---------|
| `--host` | Override `FF_BROKER_HOST` |
| `--port` | Override `FF_BROKER_PORT` |

### Understanding Key Concepts

**Model pools** are named groups of LLM providers configured in the broker. A pool like `gpt-4o` may route to different providers or models depending on load, cost, or failover rules. The broker handles provider selection transparently.

**Semantic labels** identify the purpose of a request for telemetry tracking and mock cache lookup. Use descriptive labels like `"invoice-extraction"` or `"summary-generation"` rather than generic labels. Labels appear in telemetry data (queryable via `ff-telemetry-read`).

**Mock cache IDs** enable deterministic testing. When a mock cache ID is provided, the broker returns a cached response instead of calling the LLM provider. This is useful for integration tests that need repeatable results.

## Common Workflows

### Basic Completion

```bash
ff-brk complete \
  -m gpt-4o \
  -l "test-request" \
  --msg "What is the capital of France?"
```

### With System Prompt

```bash
ff-brk complete \
  -m gpt-4o \
  -l "test-with-system" \
  -s "You are a helpful geography expert. Be concise." \
  --msg "What is the capital of France?"
```

### JSON Output for Scripting

```bash
# Get just the content
ff-brk complete \
  -m gpt-4o \
  -l "scripted-request" \
  --msg "Summarize this in one sentence" \
  --json | jq -r '.content'

# Get content, model, and usage
ff-brk complete \
  -m gpt-4o \
  -l "json-test" \
  --msg "Hello" \
  --json | jq '{model, content, usage}'
```

### Deterministic Testing with Mock Cache

Mock cache IDs return the same response every time, useful for repeatable integration tests:

```bash
ff-brk complete \
  -m gpt-4o \
  -l "cached-test" \
  -c "my-test-cache-id" \
  --msg "Test message"
```

### Control Generation Parameters

```bash
# Creative, longer output
ff-brk complete \
  -m gpt-4o \
  -l "creative-request" \
  --msg "Write a haiku about code" \
  -t 1.5 \
  --max-tokens 100

# Precise, deterministic output
ff-brk complete \
  -m gpt-4o \
  -l "precise-request" \
  --msg "Convert 72°F to Celsius" \
  -t 0.0 \
  --max-tokens 50
```

### Test Different Model Pools

```bash
# Compare responses across model pools
for pool in gpt-4o claude-sonnet gemini-pro; do
  echo "=== $pool ==="
  ff-brk complete -m "$pool" -l "model-comparison" --msg "Explain recursion in one sentence" --json | jq -r '.content'
  echo
done
```

## Response Format

**Human-readable output (default):**

```
Sending completion request to localhost:50099
  Model pool: gpt-4o
  Semantic label: test-request
  Message: "What is the capital of France?"

Response:
────────────────────────────────────────────────────────────────
The capital of France is Paris.
────────────────────────────────────────────────────────────────

Model: gpt-4o-2024-08-06
Finish reason: stop
Usage: 15 prompt + 8 completion = 23 total tokens
```

**JSON output (`--json`):**

Returns the full broker response object including `content`, `model`, `finish_reason`, and `usage` metrics.

## Diagnostic Workflows

### Verify Broker Connectivity

```bash
# Simple smoke test — if this returns a response, broker is healthy
ff-brk complete -m gpt-4o -l "health-check" --msg "ping"
```

### Verify a Model Pool Configuration

```bash
# Send a request and check which underlying model was actually used
ff-brk complete -m my-custom-pool -l "pool-test" --msg "Hello" --json | jq '.model'
```

### Test Failover Behavior

```bash
# Send multiple requests and see which model handles each one
for i in 1 2 3 4 5; do
  ff-brk complete -m gpt-4o -l "failover-test-$i" --msg "Hello" --json | jq -r '.model'
done
```

### Debug Token Usage

```bash
# Compare token usage with and without a system prompt
echo "Without system prompt:"
ff-brk complete -m gpt-4o -l "usage-baseline" \
  --msg "Explain quantum computing" --json | jq '.usage'

echo "With system prompt:"
ff-brk complete -m gpt-4o -l "usage-with-system" \
  -s "Be very concise. One sentence only." \
  --msg "Explain quantum computing" --json | jq '.usage'
```

### Benchmark Response Latency

```bash
# Time a completion request
time ff-brk complete -m gpt-4o -l "latency-test" --msg "Hello" --json > /dev/null
```

### Trace a Request in Telemetry

After sending a request, use `ff-telemetry-read` to find it in the telemetry database:

```bash
# Send a request with a unique label
ff-brk complete -m gpt-4o -l "trace-test-$(date +%s)" --msg "Hello"

# Then query telemetry for that request
ff-telemetry-read broker-requests --semantic-label "trace-test-*" --limit 1
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection refused | Broker not running or wrong port | Check `kubectl get pods -n firefoundry-home` and port-forward |
| "model pool not found" | Invalid pool name | Check broker configuration for available pool names |
| Timeout | Network issue or slow provider | Increase timeout, check provider health |
| Empty response | Max tokens too low | Increase `--max-tokens` |

## See Also

- [ff-telemetry-read](ff-telemetry-read.md) — Trace broker requests in telemetry data
- [FF Broker Service](../../platform/services/ff-broker/README.md) — Platform service documentation
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
