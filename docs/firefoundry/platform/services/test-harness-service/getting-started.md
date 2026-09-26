# Test Harness Service — Getting Started

This guide walks you through running the Test Harness Service, creating a test suite, adding cases with assertions, running the suite, and reading the results.

> **Remember:** in version 0.1.0 the service evaluates assertions against a simulated response (`Simulated response for: <input_message>`) instead of calling your bundle, and keeps data in memory. The walkthrough below uses that behavior deliberately so the outcomes are predictable. See [Concepts — Current Release vs. In Development](./concepts.md#current-release-vs-in-development).

## Prerequisites

- **Node.js 20+** and npm, if you run the service from source
- Read access to the private `@firebrandanalytics` npm packages on GitHub Packages (a GitHub token exported as `GITHUB_TOKEN`), which the service depends on
- `curl` and, optionally, `jq` for pretty-printing responses
- Or: a Test Harness Service instance already running in your cluster, reachable through `kubectl port-forward` (see [Operations](./operations.md#deployment))

The examples use `http://localhost:3004`, the service's default port. If you are port-forwarding to a container started from the published image, use the port you forwarded (the image expects `PORT=8080`).

## Step 1: Start the Service

From a checkout of the service repository:

```bash
npm install
npm run dev          # tsx watch mode, listens on PORT (default 3004)
```

`NODE_ENV` defaults to `development`, and in development mode the service **seeds sample data** on startup: four suites, their cases, and three completed runs. That is handy for exploring the API. To start with an empty store, run with `NODE_ENV=production`:

```bash
NODE_ENV=production npm run dev
```

## Step 2: Verify the Service is Running

```bash
curl -s http://localhost:3004/health
```

```json
{
  "status": "healthy",
  "timestamp": "2026-02-20T15:04:12.381Z"
}
```

```bash
curl -s http://localhost:3004/status
```

```json
{
  "service": "test-harness-service",
  "version": "0.1.0",
  "uptime": 12.84,
  "environment": "development"
}
```

## Step 3: Create a Test Suite

A suite needs a `name` and the `target_bot_id` of the bot or bundle it tests.

```bash
curl -s -X POST http://localhost:3004/api/suites \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Geography Bot - Smoke",
    "description": "Basic questions the geography bot must answer.",
    "target_bot_id": "geography-bot",
    "target_bot_name": "Geography Bot",
    "tags": ["smoke", "geography"]
  }'
```

Response (`201 Created`):

```json
{
  "id": "5b0f2a7e-3c1d-4f5e-9a8b-0c6d7e8f9a01",
  "name": "Geography Bot - Smoke",
  "description": "Basic questions the geography bot must answer.",
  "target_bot_id": "geography-bot",
  "target_bot_name": "Geography Bot",
  "tags": ["smoke", "geography"],
  "created_at": "2026-02-20T15:05:00.120Z",
  "updated_at": "2026-02-20T15:05:00.120Z"
}
```

Save the ID:

```bash
SUITE_ID=5b0f2a7e-3c1d-4f5e-9a8b-0c6d7e8f9a01
```

## Step 4: Add Test Cases

Each case needs a `name` and an `input_message`. Attach assertions to describe a correct answer.

```bash
curl -s -X POST http://localhost:3004/api/suites/$SUITE_ID/cases \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Capital of France",
    "input_message": "What is the capital of France?",
    "timeout_ms": 15000,
    "assertions": [
      { "type": "contains", "expected": "capital", "label": "Talks about the capital" },
      { "type": "matches_regex", "expected": "Paris", "label": "Names Paris" },
      { "type": "not_contains", "expected": "error", "label": "No error" }
    ]
  }'
```

Add a second case that returns structured data:

```bash
curl -s -X POST http://localhost:3004/api/suites/$SUITE_ID/cases \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Population lookup",
    "input_message": "Population of Canada as JSON",
    "assertions": [
      { "type": "json_path", "path": "$.country", "expected": "Canada", "label": "Country field" }
    ]
  }'
```

Cases run in `sort_order`; when you do not set it, each new case is placed after the existing ones. List them to confirm:

```bash
curl -s "http://localhost:3004/api/suites/$SUITE_ID/cases" | jq '.data[] | {id, name, sort_order}'
```

## Step 5: Run the Suite

The shortcut endpoint creates a run and executes it in one call. Tag the run with an environment and a trigger so it is easy to find later.

```bash
curl -s -X POST http://localhost:3004/api/suites/$SUITE_ID/run \
  -H 'Content-Type: application/json' \
  -d '{ "environment": "dev", "triggered_by": "getting-started" }'
```

```json
{
  "id": "a3c9e1d2-7b64-4c0f-8e15-2f9d4b6a7c80",
  "suite_id": "5b0f2a7e-3c1d-4f5e-9a8b-0c6d7e8f9a01",
  "status": "completed",
  "environment": "dev",
  "triggered_by": "getting-started",
  "total_cases": 2,
  "passed": 0,
  "failed": 2,
  "skipped": 0,
  "created_at": "2026-02-20T15:07:30.004Z",
  "started_at": "2026-02-20T15:07:30.005Z",
  "completed_at": "2026-02-20T15:07:30.006Z",
  "duration_ms": 1
}
```

`completed` means the run finished; the `passed` and `failed` counts tell you how the cases fared. Both cases fail here because the simulated response does not mention Paris and is not JSON.

If you prefer two steps — for example, a CI job that records the run ID before executing — create the run and then execute it:

```bash
RUN_ID=$(curl -s -X POST http://localhost:3004/api/runs \
  -H 'Content-Type: application/json' \
  -d "{\"suite_id\": \"$SUITE_ID\", \"environment\": \"dev\", \"triggered_by\": \"ci\"}" | jq -r .id)

curl -s -X POST http://localhost:3004/api/runs/$RUN_ID/execute
```

## Step 6: Inspect Results

List the failed results of a run (either run from Step 5 works; the example output shows one result):

```bash
curl -s "http://localhost:3004/api/runs/$RUN_ID/results?status=failed" | jq .
```

```json
{
  "data": [
    {
      "id": "e7d1c3b5-0a2f-4e68-9d7c-1b3a5c7e9f02",
      "run_id": "a3c9e1d2-7b64-4c0f-8e15-2f9d4b6a7c80",
      "test_case_id": "0f4e2d6c-8a1b-4c3d-9e5f-7a6b8c9d0e13",
      "test_case_name": "Capital of France",
      "status": "failed",
      "actual_response": "Simulated response for: What is the capital of France?",
      "duration_ms": 0,
      "assertion_results": [
        {
          "assertion": { "type": "contains", "expected": "capital", "label": "Talks about the capital" },
          "passed": true,
          "actual_value": "Simulated response for: What is the capital of France?",
          "message": "Response contains expected text"
        },
        {
          "assertion": { "type": "matches_regex", "expected": "Paris", "label": "Names Paris" },
          "passed": false,
          "actual_value": "Simulated response for: What is the capital of France?",
          "message": "Response does not match regex: \"Paris\""
        },
        {
          "assertion": { "type": "not_contains", "expected": "error", "label": "No error" },
          "passed": true,
          "actual_value": "Simulated response for: What is the capital of France?",
          "message": "Response does not contain excluded text"
        }
      ],
      "created_at": "2026-02-20T15:07:30.006Z"
    }
  ],
  "total": 2,
  "page": 1,
  "page_size": 25,
  "total_pages": 1
}
```

Each assertion result tells you what was checked, what value it was compared with, and why it passed or failed. Fetch a single result with `GET /api/results/{id}`.

## Step 7: Review Suite History

The suite list shows the latest run for every suite:

```bash
curl -s http://localhost:3004/api/suites | jq '.data[] | {name, case_count, last_run_status, last_run_passed, last_run_failed}'
```

List every run of one suite, newest first:

```bash
curl -s "http://localhost:3004/api/runs?suite_id=$SUITE_ID" | jq '.data[] | {id, status, environment, passed, failed}'
```

## Step 8: Define a Schedule (Optional)

Store a nightly schedule for the suite. A `cron` frequency requires `cron_expression`.

```bash
curl -s -X POST http://localhost:3004/api/schedules \
  -H 'Content-Type: application/json' \
  -d "{
    \"suite_id\": \"$SUITE_ID\",
    \"frequency\": \"cron\",
    \"cron_expression\": \"0 2 * * *\",
    \"environment\": \"staging\"
  }"
```

In 0.1.0 schedules are stored but **not executed automatically**; drive runs from your CI system in the meantime. While a suite has an enabled schedule it cannot be deleted — disable the schedule first:

```bash
curl -s -X PATCH http://localhost:3004/api/schedules/$SCHEDULE_ID \
  -H 'Content-Type: application/json' \
  -d '{ "enabled": false }'
```

## Next Steps

- [Concepts](./concepts.md) — Run lifecycle, assertion semantics, and what is coming in the live execution engine
- [Reference](./reference.md) — Every endpoint, field, and error response
- [Operations](./operations.md) — Deploying and configuring the service
- [Test Evaluation Agent](../../system-agents/test-evaluation.md) — Try LLM-judged evaluation directly while `result_bot` assertions are in development
