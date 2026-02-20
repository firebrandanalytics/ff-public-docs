# Part 5: Deploy & Test

In this part, you'll deploy the code sandbox agent bundle to your FireFoundry cluster and test both the TypeScript and data science endpoints.

## Prerequisites

Before deploying, ensure you have:

- A FireFoundry cluster running (local or remote)
- `ff-cli` configured with your license
- Code Sandbox Service deployed with profiles configured

If you haven't set up your local environment yet, see the [Local Development Guide](../../guides/local_dev_setup.md).

## Environment Configuration

The agent bundle needs environment variables to connect to the Code Sandbox Service and LLM broker. These are configured through `ff-cli` during deployment:

| Variable | Description |
|----------|-------------|
| `CODE_SANDBOX_URL` | URL of the Code Sandbox Manager service |
| `CODE_SANDBOX_TS_PROFILE` | Profile name for TypeScript execution (e.g., `finance-typescript`) |
| `CODE_SANDBOX_DS_PROFILE` | Profile name for Python data science execution (e.g., `firekicks-datascience`) |
| `DATA_ACCESS_URL` | URL of the Data Access Service (for schema fetching) |
| `LLM_BROKER_HOST` | LLM broker service host |
| `LLM_BROKER_PORT` | LLM broker service port |

These profiles must be created in the Code Sandbox Manager before the bots can use them. See the [Code Sandbox Service documentation](../../platform/services/code-sandbox.md) for profile creation.

## Build and Deploy

Build the Docker image and deploy to your cluster:

```bash
ff-cli ops build coder-bundle
ff-cli ops install coder-bundle
```

### Verify the Deployment

Check that the bundle is running:

```bash
ff-sdk-cli health --url http://localhost:3001
```

You should see:
```json
{ "healthy": true }
```

## Test with ff-sdk-cli

### TypeScript Code Generation (POST /api/execute)

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Calculate the first 10 Fibonacci numbers and return them as an array"}' \
  --url http://localhost:3001
```

Expected response:
```json
{
  "success": true,
  "output": {
    "description": "First 10 Fibonacci numbers",
    "result": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34],
    "stdout": ""
  },
  "entity_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### Data Science Analysis (POST /api/analyze)

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "How many customers are in each customer segment?"}' \
  --url http://localhost:3001
```

Expected response:
```json
{
  "success": true,
  "output": {
    "description": "Customer count by segment",
    "result": [
      { "customer_segment": "regular", "count": 4030 },
      { "customer_segment": "bargain-hunter", "count": 2909 },
      { "customer_segment": "athlete", "count": 2082 },
      { "customer_segment": "premium", "count": 979 }
    ],
    "stdout": ""
  },
  "entity_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### Try More Prompts

**TypeScript (execute):**

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Generate all prime numbers less than 100"}' \
  --url http://localhost:3001
```

**Data Science (analyze):**

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "What is the average order value by customer segment? Which segment spends the most?"}' \
  --url http://localhost:3001
```

## Troubleshooting

### "Bot not found: DemoCoderBot" (or DemoDataScienceBot)

The bot module wasn't loaded before the entity tried to look it up. Ensure the entity file has the side-effect import:
```typescript
// In CodeTaskEntity.ts:
import "../bots/DemoCoderBot.js";

// In DataScienceTaskEntity.ts:
import "../bots/DemoDataScienceBot.js";
```

### "Code block not found"

The LLM didn't produce the expected two-block format. Check:
- The model pool name matches a configured LLM broker pool
- The profile metadata was fetched successfully at init (check logs for errors)
- If using a domain prompt, ensure it doesn't conflict with the intrinsic output format instructions

### "Profile not found: firekicks-datascience"

The sandbox profile hasn't been created on the Code Sandbox Manager. See the [Code Sandbox Service documentation](../../platform/services/code-sandbox.md) for profile creation.

### Sandbox connection timeout

The Code Sandbox Manager might not be running or reachable. Check the service status and verify the `CODE_SANDBOX_URL` environment variable is correct.

### DAS connection errors in data science execution

If the Python code executes but DAS queries fail:
1. Verify the DAS service is running in your cluster
2. Check the profile's DAS connection config points to the correct host/port
3. Ensure the DAS service has a connection configured for the target database

### Upgrading After Changes

After making code changes:

```bash
ff-cli ops build coder-bundle
ff-cli ops upgrade coder-bundle
```

## Diagnostic Tools

Use these tools to inspect the running system:

| Tool | Command | Purpose |
|------|---------|---------|
| Entity Graph | `ff-eg-read` | Inspect CodeTaskEntity and DataScienceTaskEntity nodes |
| Working Memory | `ff-wm-read` | View generated code stored in working memory |
| Telemetry | `ff-telemetry-read` | Trace LLM broker requests and bot execution |

## What You've Built

In this tutorial, you've created a complete agent bundle that:

1. **Accepts natural language prompts** via two REST API endpoints (`/api/execute` and `/api/analyze`)
2. **Generates TypeScript code** for general computation tasks
3. **Generates Python+pandas code** for data science analysis, querying databases through DAS
4. **Executes code safely** in the Code Sandbox Service using named profiles
5. **Returns structured results** with execution output
6. **Persists everything** in the entity graph with working memory attachments

### Architecture Recap

```
DemoCoderBot               -> GeneralCoderBot with finance-typescript profile (no domain prompt)
DemoDataScienceBot         -> GeneralCoderBot with firekicks-datascience profile + DAS schema fetch
CodeTaskEntity             -> Entity + BotRunnableEntityMixin -> DemoCoderBot
DataScienceTaskEntity      -> Entity + BotRunnableEntityMixin -> DemoDataScienceBot
CoderBundleAgentBundle     -> API endpoints (/execute, /analyze) + entity factory
```

### Key Patterns Learned

- **Profile-driven bots** -- Profile is the single source of truth for language, harness, DAS connections, and run script contract
- **Dynamic schema from DAS** -- Bot fetches database schema from the Data Access Service at init and builds the domain prompt dynamically
- **Prompt framework for domain prompts** -- Use `PromptTemplateSectionNode` and `PromptTemplateListNode` with semantic types
- **GeneralCoderBot** -- Minimal constructor (`name`, `modelPoolName`, `profile`) with domain prompt added during init
- **BotRunnableEntityMixin** -- Decoupled entity-bot wiring via registry
- **@ApiEndpoint** -- REST endpoints for external consumers

---

**Next:** [Part 6: Web GUI](./part-06-gui.md) -- Build a web interface for interacting with the code sandbox.
