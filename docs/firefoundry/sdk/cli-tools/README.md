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

### Additional Tools (documentation coming soon)

| Tool | Purpose |
|------|---------|
| ff-wm-write | Write records and upload blobs to working memory |
| ff-telemetry-read | Query broker requests, LLM calls, and request traces |
| ff-brk | Send chat completion requests to the broker service |
| ff-da | Query databases and inspect schemas through the Data Access Service |
| ff-eg-admin | Admin operations for hard deletes and graph diagnostics |

## Installation

All tools are published as npm packages under the `@firebrandanalytics` scope:

```bash
npm install -g @firebrandanalytics/ff-eg-read
npm install -g @firebrandanalytics/ff-eg-write
npm install -g @firebrandanalytics/ff-wm-read
npm install -g @firebrandanalytics/ff-sdk-cli
```

## Configuration

All tools auto-configure from environment variables or a `.env` file in the current working directory. The most common variables:

| Variable | Purpose | Used By |
|----------|---------|---------|
| `FF_EG_URL` | Entity Graph service URL | ff-eg-read, ff-eg-write |
| `FF_WM_URL` | Working Memory service URL | ff-wm-read |
| `FF_SDK_URL` | Agent Bundle server URL | ff-sdk-cli |
| `FF_SDK_API_KEY` | API key for agent bundle auth | ff-sdk-cli |
| `FF_AGENT_BUNDLE_ID` | Agent bundle ID for scoped queries | ff-eg-read |

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
