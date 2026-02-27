# Part 5: Deployment, Testing & Troubleshooting

You've built a complete AI code execution agent: two bots (TypeScript and Python), entities that wire them to API endpoints, dynamic schema injection from DAS, and a web GUI. In this final part, we'll deploy the full stack, test it systematically, and learn to diagnose problems when things go wrong.

**What you'll learn:**
- Environment configuration for deployment
- The full build and deploy workflow
- Systematic testing with `ff-sdk-cli`
- Diagnostic tools: `ff-eg-read`, `ff-wm-read`, `ff-telemetry-read`
- Common failure modes and how to debug them

**What you'll build:** A fully deployed application with verified endpoints and the knowledge to troubleshoot issues independently.

---

## Architecture Recap

Before deploying, let's review what we've built across Parts 1-4:

```
User enters prompt (natural language)
       |
       v
  Web GUI (coder-gui)
       |
       v
  Next.js API route (thin proxy)
       |
       +--------------------------+
       |                          |
       v                          v
  POST /api/execute          POST /api/analyze
       |                          |
       v                          v
  CodeTaskEntity          DataScienceTaskEntity
       |                          |
       v                          v
  DemoCoderBot            DemoDataScienceBot
  (TypeScript)               (Python)
       |                          |
       |                     At init():
       |                     fetch schema from DAS
       |                     build domain prompt
       |                          |
       v                          v
  GeneralCoderBot pipeline:
  profile metadata → intrinsic prompt → (+ domain prompt) → LLM → parse → sandbox
       |                          |
       v                          v
  Code Sandbox Service     Code Sandbox Service
  (TypeScript runtime)     (Python runtime + DAS)
       |                          |
       v                          v
  Structured result        Structured result
```

Two independent paths through the same agent bundle, sharing the same deployment infrastructure.

## Step 1: Environment Configuration

The agent bundle needs several environment variables to connect to platform services. These are typically set in the bundle's `firefoundry.json` or via Helm values during deployment.

| Variable | Purpose | Example |
|----------|---------|---------|
| `LLM_BROKER_HOST` | LLM broker service hostname | `ff-llm-broker` |
| `LLM_BROKER_PORT` | LLM broker service port | `8080` |
| `CODE_SANDBOX_URL` | Code Sandbox Service URL | `http://ff-code-sandbox:8080` |
| `DATA_ACCESS_URL` | Data Access Service URL | `http://ff-data-access:8080` |
| `CODE_SANDBOX_TS_PROFILE` | TypeScript profile name (optional) | `finance-typescript` |
| `CODE_SANDBOX_DS_PROFILE` | Python profile name (optional) | `firekicks-datascience` |
| `PG_SERVER` | PostgreSQL host for entity graph | `ff-postgresql` |
| `PG_DATABASE` | Database name | `firefoundry` |
| `PG_PASSWORD` | Database password | (from secret) |
| `PG_INSERT_PASSWORD` | Write access password | (from secret) |

The profile variables are optional -- the code defaults to `finance-typescript` and `firekicks-datascience` if not set.

For the GUI, the only required variable is:

| Variable | Purpose | Example |
|----------|---------|---------|
| `BUNDLE_URL` | Agent bundle internal URL | `http://coder-bundle:3001` |

## Step 2: Build and Deploy

Build everything from the monorepo root:

```bash
pnpm run build
```

Build and deploy the container images:

```bash
# Build container images
ff-cli ops build coder-bundle
ff-cli ops build coder-gui

# Deploy to cluster
ff-cli ops install coder-bundle
ff-cli ops install coder-gui
```

Verify both services are running:

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }
```

## Step 3: Test the TypeScript Endpoint

Start with the simpler endpoint. Run a series of prompts that exercise different capabilities:

**Basic computation:**

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Calculate the first 10 Fibonacci numbers and return them as an array"}' \
  --url http://localhost:3001
```

Expected: `{ "result": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34] }`

**Algorithm implementation:**

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Sort the array [42, 7, 13, 99, 1, 55] using quicksort and return both the sorted array and the number of comparisons"}' \
  --url http://localhost:3001
```

Expected: a result with `sorted` array and `comparisons` count.

**Data transformation:**

```bash
ff-sdk-cli api call execute \
  --method POST \
  --body '{"prompt": "Generate a multiplication table for numbers 1-5 and return it as a 2D array"}' \
  --url http://localhost:3001
```

Each test should return `success: true` with a structured result. If any fails, check the troubleshooting section below.

## Step 4: Test the Data Science Endpoint

These tests exercise the domain prompt and DAS integration:

**Simple aggregation:**

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "What is the total revenue by product category?"}' \
  --url http://localhost:3001
```

Expected: an array of objects with category and revenue columns.

**Top-N query:**

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "Which customers have placed the most orders? Show the top 10."}' \
  --url http://localhost:3001
```

**Time series:**

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "Calculate the month-over-month revenue growth for the last 12 months"}' \
  --url http://localhost:3001
```

**Statistical analysis:**

```bash
ff-sdk-cli api call analyze \
  --method POST \
  --body '{"prompt": "Is there a correlation between order size and customer segment? Run a statistical test."}' \
  --url http://localhost:3001
```

The data science endpoint should use correct table and column names (thanks to dynamic schema injection from Part 3) and follow the data handling rules (JSON-serializable results, rounded numbers, no plots).

## Step 5: Diagnostic Tools

When something goes wrong -- or when you want to understand what happened under the hood -- FireFoundry provides diagnostic CLI tools.

### Inspect the Entity Graph

Every execution creates an entity in the entity graph. You can inspect it:

```bash
# List recent entities
ff-eg-read list-nodes \
  --type CodeTaskEntity \
  --limit 5 \
  --url http://localhost:3001

# Get a specific entity by ID (from the execute response)
ff-eg-read get-node \
  --id <entity-id> \
  --url http://localhost:3001
```

The entity shows:
- **Status**: `Pending` → `Running` → `Complete` (or `Failed`)
- **Data**: the original prompt
- **Timestamps**: when the entity was created and when it finished

### Inspect Working Memory

The generated code is stored in working memory. You can read it:

```bash
ff-wm-read get \
  --entity-id <entity-id> \
  --path "code/analysis.ts" \
  --url http://localhost:3001
```

This returns the actual TypeScript or Python code that the LLM generated and the sandbox executed. Useful for debugging when the result isn't what you expected.

### Inspect Telemetry

The telemetry system records every LLM call, including the full prompt and response:

```bash
ff-telemetry-read list-requests \
  --bot DemoDataScienceBot \
  --limit 5 \
  --url http://localhost:3001
```

This shows:
- **Full prompt**: intrinsic + domain + user prompt as sent to the LLM
- **LLM response**: the raw two-block output (JSON metadata + code)
- **Timing**: how long the LLM call took
- **Model**: which model was used

This is your most powerful debugging tool. If the AI generates bad code, read the full prompt to see what it was working with.

## Troubleshooting

### Symptom: `execute` returns 500 error

**Check the bundle logs:**

```bash
ff-cli ops logs coder-bundle
```

**Common causes:**
- **LLM broker unreachable** -- verify `LLM_BROKER_HOST` and `LLM_BROKER_PORT` are correct and the broker is running
- **Code Sandbox unreachable** -- verify `CODE_SANDBOX_URL` is correct and the sandbox service is running
- **Profile not found** -- verify the profile name (`finance-typescript` or `firekicks-datascience`) exists on the Code Sandbox Service

### Symptom: `analyze` returns 500 during initialization

**Look for schema fetch errors in logs:**

```bash
ff-cli ops logs coder-bundle | grep "Failed to fetch DAS schema"
```

**Common causes:**
- **DAS unreachable** -- verify `DATA_ACCESS_URL` is correct
- **Connection not configured** -- the `firekicks` connection must exist in DAS. Check with `ff-da connections list`
- **DNS resolution** -- if running locally, ensure you have the right port forward active

### Symptom: Data science queries use wrong table/column names

**Check the schema was loaded:**

```bash
ff-cli ops logs coder-bundle | grep "loaded schema"
```

If you see `loaded schema with 0 tables`, the DAS connection exists but returned an empty schema. Verify the database has tables.

**Check the full prompt via telemetry:**

```bash
ff-telemetry-read list-requests --bot DemoDataScienceBot --limit 1 --url http://localhost:3001
```

Look for the "Database Schema" section in the system prompt. If it's missing, the schema wasn't loaded correctly.

### Symptom: Results contain `Decimal` or non-serializable types

The data handling rules in the domain prompt should prevent this, but if the LLM ignores them:

1. Check if the rules are present in the prompt (via telemetry)
2. Try making the rules more explicit in `buildFireKicksDomainSections()`
3. Add a post-processing step in the entity if needed

### Symptom: GUI shows "Error" but `ff-sdk-cli` works fine

The GUI talks to the bundle through Next.js API routes. Check:

1. **`BUNDLE_URL` is correct** -- the GUI's `.env.local` or deployment config must point to the bundle's internal URL
2. **API route errors** -- check the GUI's logs for fetch failures
3. **CORS** -- not an issue with the proxy pattern (server-to-server calls), but if you're calling the bundle directly from the browser, you'll hit CORS

## What You've Built

Let's step back and look at the complete picture:

| Component | What It Does | Part |
|-----------|-------------|------|
| `DemoCoderBot` | Generates and executes TypeScript from natural language | Part 1 |
| `CodeTaskEntity` | Wires user prompts to the TypeScript bot | Part 1 |
| `POST /api/execute` | API endpoint for TypeScript execution | Part 1 |
| `DemoDataScienceBot` | Generates Python with domain prompt and schema | Parts 2-3 |
| `DataScienceTaskEntity` | Wires user prompts to the data science bot | Part 2 |
| `POST /api/analyze` | API endpoint for data science queries | Part 2 |
| Dynamic schema injection | Fetches schema from DAS at startup | Part 3 |
| Web GUI | Browser interface with mode switching and result formatting | Part 4 |

The key architectural ideas:

1. **Profile-driven bots** -- tell the bot which profile to use, it handles the rest
2. **Domain prompts separate concerns** -- intrinsic prompts handle the framework, domain prompts handle your business
3. **Dynamic over static** -- fetch schema at startup instead of hardcoding it
4. **Entity-bot separation** -- entities store state and orchestrate, bots do work
5. **Thin-proxy GUI** -- the web layer is a consumer of the agent bundle's API, not an extension of it

## Where to Go from Here

- **Add authentication** -- protect the API endpoints and GUI with your auth provider
- **Add more profiles** -- create profiles for different languages or execution environments
- **Add more domain prompts** -- teach the bot about business rules, data quality issues, or analysis patterns
- **Add streaming** -- use the SDK's progress tracking to stream results as they're generated
- **Explore the reference tutorials** -- the [Report Generator](../report-generator/README.md) tutorial covers entities, working memory, and structured output in depth. The [Illustrated Story](../illustrated-story/README.md) tutorial covers multi-bot pipelines and parallel execution.
