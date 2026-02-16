# ff-eg-read Configuration

Configuration reference for the ff-eg-read CLI tool. **Load this file only when troubleshooting connection issues.**

Under normal operation, the tool auto-configures from environment variables or a `.env` file in the current working directory. The AI should not need to set these values.

## Environment Variables

### Shared Variables (Used by all FF tools)

| Variable | Description | Required |
|----------|-------------|----------|
| `FF_GATEWAY` | Kong gateway URL (e.g., `http://localhost`) | Yes |
| `FF_API_KEY` | Kong API key for authentication | Yes |
| `FF_NAMESPACE` | Kubernetes namespace | Yes |
| `FF_PORT` | Gateway port (default: 30080) | No |

### Entity Graph Specific

| Variable | Description | Required |
|----------|-------------|----------|
| `FF_EG_AGENT_BUNDLE_ID` | Agent bundle UUID | Yes |
| `FF_EG_GRAPH_NAME` | Graph name (optional) | No |

## Configuration Sources

The tool loads configuration in this order (later sources override earlier):

1. **Default values** (port 30080)
2. **`.env` file** in current working directory
3. **Environment variables**
4. **Command-line flags** (highest priority)

## .env File Format

```bash
# .env file in project root

# Shared across all FF tools
FF_GATEWAY=http://localhost
FF_API_KEY=your-api-key-here
FF_NAMESPACE=ff-dev
FF_PORT=30080

# Entity graph specific
FF_EG_AGENT_BUNDLE_ID=12345678-1234-1234-1234-123456789abc
FF_EG_GRAPH_NAME=default
```

## Command-Line Flags

These override environment variables:

| Flag | Equivalent Env Var |
|------|-------------------|
| `--gateway <url>` | `FF_GATEWAY` |
| `--api-key <key>` | `FF_API_KEY` |
| `--namespace <ns>` | `FF_NAMESPACE` |
| `--port <port>` | `FF_PORT` |
| `--agent-bundle-id <uuid>` | `FF_EG_AGENT_BUNDLE_ID` |
| `--graph-name <name>` | `FF_EG_GRAPH_NAME` |

## Troubleshooting

### Check Current Configuration

```bash
# See shared FF env vars
env | grep ^FF_

# See entity graph specific vars
env | grep FF_EG

# Check if .env file exists
cat .env | grep FF_
```

### Test Connectivity

```bash
# Test gateway health
curl -I ${FF_GATEWAY}:${FF_PORT:-30080}/health

# Test with a simple query
ff-eg-read node get --help
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Gateway URL required" | `FF_GATEWAY` not set | Check .env file or export variable |
| "Unauthorized" / 401 | Invalid or missing API key | Verify `FF_API_KEY` |
| "Namespace not found" | Wrong namespace | Check `FF_NAMESPACE` matches cluster |
| "Connection refused" | Gateway not reachable | Check URL, port, and network |
| "Agent bundle not found" | Wrong bundle ID | Verify `FF_EG_AGENT_BUNDLE_ID` UUID |

### Gateway URL Formats

```bash
# Local development (port-forwarded)
FF_GATEWAY=http://localhost

# Direct cluster access
FF_GATEWAY=http://entity-service.ff-control-plane.svc.cluster.local

# Via Kong gateway
FF_GATEWAY=https://api.example.com
```

## See Also

- [Main ff-eg-read skill](../SKILL.md) - Command reference
- [ff-eg-write configuration](../../ff-eg-write/modes/configuration.md) - Write tool configuration
- [ff-wm-read configuration](../../ff-wm-read/modes/configuration.md) - Working memory read tool
