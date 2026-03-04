# CLI Tools

FireFoundry provides a set of CLI tools for interacting with the platform during development, debugging, and testing. These are standalone npm packages that connect to running FireFoundry services.

## Tools

### Agent Bundle Testing

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-sdk-cli](ff-sdk-cli.md) | Invoke entity methods, run bots, call API endpoints, stream iterators | High priority |

### Entity Graph

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-eg-read](ff-eg-read.md) | Query entities, traverse relationships, search nodes, vector similarity | Read-only |
| [ff-eg-write](ff-eg-write.md) | Create entities, update properties, manage edges, recovery operations | Write access |

### Working Memory

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-wm-read](ff-wm-read.md) | Retrieve records, blobs, manifests, and chat history | Read-only |
| [ff-wm-write](ff-wm-write.md) | Create records and upload blobs to working memory | Write access |

### Broker & LLM

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-brk](ff-brk.md) | Send chat completion requests to the broker service, test model pools | CLI reference |

### Data Access

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-da](ff-da.md) | Query databases, inspect schemas, access dictionary/ontology/process metadata | CLI reference |

### Telemetry & Observability

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-telemetry-read](ff-telemetry-read.md) | Query broker requests, LLM calls, tool invocations, and request traces | Read-only |

### Admin

| Tool | Purpose | Docs |
|------|---------|------|
| [ff-eg-admin](ff-eg-admin.md) | Hard-delete nodes/edges and graph diagnostics (requires admin API key) | Admin access |

## Installation

All tools are published as npm packages under the `@firebrandanalytics` scope:

```bash
npm install -g @firebrandanalytics/ff-sdk-cli
npm install -g @firebrandanalytics/ff-eg-read
npm install -g @firebrandanalytics/ff-eg-write
npm install -g @firebrandanalytics/ff-eg-admin
npm install -g @firebrandanalytics/ff-wm-read
npm install -g @firebrandanalytics/ff-wm-write
npm install -g @firebrandanalytics/ff-brk
npm install -g @firebrandanalytics/ff-da
npm install -g @firebrandanalytics/ff-telemetry-read
```

## Configuration

All tools auto-configure from environment variables or a `.env` file in the current working directory. The most common variables:

| Variable | Purpose | Used By |
|----------|---------|---------|
| `FF_EG_URL` | Entity Graph service URL | ff-eg-read, ff-eg-write |
| `FF_WM_URL` | Working Memory service URL | ff-wm-read |
| `FF_GATEWAY` | Kong gateway URL | ff-wm-write |
| `FF_API_KEY` | Kong API key for authentication | ff-wm-write |
| `FF_NAMESPACE` | Kubernetes namespace | ff-wm-write |
| `FF_SDK_URL` | Agent Bundle server URL | ff-sdk-cli |
| `FF_SDK_API_KEY` | API key for agent bundle auth | ff-sdk-cli |
| `FF_AGENT_BUNDLE_ID` | Agent bundle ID for scoped queries | ff-eg-read |
| `FF_BROKER_HOST` | Broker service host | ff-brk |
| `FF_BROKER_PORT` | Broker service gRPC port | ff-brk |
| `FF_DATA_SERVICE_URL` | Data Access Service URL | ff-da |
| `FF_EG_ADMIN_API_KEY` | Admin API key for entity graph | ff-eg-admin |
| `PG_HOST` / `PG_SERVER` | PostgreSQL host for telemetry database | ff-telemetry-read |
| `PG_PASSWORD` | PostgreSQL password | ff-telemetry-read |
| `PG_DATABASE` | PostgreSQL database name | ff-telemetry-read |

For local development with `ff-cli`, these variables are typically set in the `.env` file created by `ff-cli ops deploy`.

## Output Format

All tools output JSON to stdout, making them composable with `jq`:

```bash
# Pretty-print any command
ff-eg-read node get <id> | jq .

# Extract specific fields
ff-eg-read node get <id> | jq '{name, status}'

# Filter results
ff-eg-read search nodes-scoped --condition '...' | jq '.result[] | select(.status == "Failed")'

# Count results
ff-eg-read search nodes-scoped --condition '...' | jq '.result | length'
```

Errors are output as JSON to stderr:

```json
{"error": "Error message here"}
```

## Related Documentation

- [ff-cli](../../../ff-cli/README.md) — Main CLI for project scaffolding, builds, and deployments
- [Agent SDK](../agent_sdk/README.md) — SDK for building agent bundles
- [Platform Services](../../platform/services/README.md) — Service architecture and APIs
