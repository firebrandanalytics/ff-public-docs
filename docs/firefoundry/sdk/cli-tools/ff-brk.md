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
ff-brk complete \
  -m gpt-4o \
  -l "scripted-request" \
  --msg "Summarize this in one sentence" \
  --json | jq '.content'
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
ff-brk complete \
  -m gpt-4o \
  -l "creative-request" \
  --msg "Write a haiku about code" \
  -t 1.5 \
  --max-tokens 100
```

### Test Different Model Pools

```bash
# Test GPT-4o
ff-brk complete -m gpt-4o -l "model-test" --msg "Hello"

# Test Claude
ff-brk complete -m claude-sonnet -l "model-test" --msg "Hello"

# Test Gemini
ff-brk complete -m gemini-pro -l "model-test" --msg "Hello"
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

Returns the full broker response object including content, model, finish_reason, and usage metrics. Suitable for piping to `jq`:

```bash
ff-brk complete -m gpt-4o -l "json-test" --msg "Hello" --json | jq '{model, content, usage}'
```

## Diagnostic Workflows

### Verify Broker Connectivity

```bash
# Simple smoke test — if this returns a response, broker is healthy
ff-brk complete -m gpt-4o -l "health-check" --msg "ping"
```

### Verify a Model Pool Configuration

```bash
# Send a request and check which model was actually used
ff-brk complete -m my-custom-pool -l "pool-test" --msg "Hello" --json | jq '.model'
```

### Test Failover Behavior

```bash
# Send multiple requests and compare which model is selected each time
for i in 1 2 3 4 5; do
  ff-brk complete -m gpt-4o -l "failover-test-$i" --msg "Hello" --json | jq -r '.model'
done
```

### Debug Token Usage

```bash
ff-brk complete \
  -m gpt-4o \
  -l "usage-test" \
  -s "Be very concise." \
  --msg "Explain quantum computing" \
  --json | jq '.usage'
```

## See Also

- [ff-telemetry-read](ff-telemetry-read.md) — Trace broker requests in telemetry data
- [FF Broker Service](../../platform/services/ff-broker/README.md) — Platform service documentation
- [ff-sdk-cli](ff-sdk-cli.md) — Invoke entity methods on running agent bundles
