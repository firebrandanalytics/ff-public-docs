# Test Harness Service — Getting Started

This guide walks you through creating a test suite for your agent bundle, adding cases with assertions, running the suite, reading results and history, and wiring a run into CI.

> **Preview behavior.** Runs currently use a simulated response (`Simulated response for: <input_message>`) instead of calling your bundle, and data does not persist across service restarts. The walkthrough uses that behavior deliberately so outcomes are predictable. See [Concepts — Current Release vs. In Development](./concepts.md#current-release-vs-in-development).

## Prerequisites

- Access to a Test Harness Service instance in your environment and its base URL (see [Operations — Getting Access](./operations.md#getting-access-in-your-environment))
- `curl`, and optionally `jq`

Set the base URL once. For example, if you port-forward the service to your workstation:

```bash
export HARNESS_URL=http://localhost:8080
curl -s $HARNESS_URL/health
# {"status":"healthy","timestamp":"..."}
```

## Step 1: Create a Test Suite

A suite needs a `name` and the `target_bot_id` of the bot or bundle it tests.

```bash
curl -s -X POST $HARNESS_URL/api/suites \
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

```bash
SUITE_ID=5b0f2a7e-3c1d-4f5e-9a8b-0c6d7e8f9a01
```

## Step 2: Add Test Cases

Each case needs a `name` and an `input_message`. Attach labelled assertions that describe a correct answer.

```bash
curl -s -X POST $HARNESS_URL/api/suites/$SUITE_ID/cases \
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

A second case that expects structured output:

```bash
curl -s -X POST $HARNESS_URL/api/suites/$SUITE_ID/cases \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Population lookup",
    "input_message": "Population of Canada as JSON",
    "assertions": [
      { "type": "json_path", "path": "$.country", "expected": "Canada", "label": "Country field" }
    ]
  }'
```

Cases run in `sort_order`; new cases go after existing ones unless you set it. Confirm:

```bash
curl -s "$HARNESS_URL/api/suites/$SUITE_ID/cases" | jq '.data[] | {id, name, sort_order}'
```

## Step 3: Run the Suite

The shortcut endpoint creates and executes a run in one call. Tag it so it is easy to find later.

```bash
curl -s -X POST $HARNESS_URL/api/suites/$SUITE_ID/run \
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

`completed` means the run finished; `passed` and `failed` tell you how the cases fared. Both cases fail here because the simulated response does not mention Paris and is not JSON.

To create and execute as two steps (for example, so a CI job can record the run ID first):

```bash
RUN_ID=$(curl -s -X POST $HARNESS_URL/api/runs \
  -H 'Content-Type: application/json' \
  -d "{\"suite_id\": \"$SUITE_ID\", \"environment\": \"dev\", \"triggered_by\": \"ci\"}" | jq -r .id)

curl -s -X POST $HARNESS_URL/api/runs/$RUN_ID/execute
```

## Step 4: Read the Results

List only the failed results of a run:

```bash
curl -s "$HARNESS_URL/api/runs/$RUN_ID/results?status=failed" | jq .
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

Each assertion result shows what was checked, the value it was compared with, and why it passed or failed. A compact failure report:

```bash
curl -s "$HARNESS_URL/api/runs/$RUN_ID/results?status=failed" \
  | jq -r '.data[] | .test_case_name as $c | .assertion_results[] | select(.passed == false)
           | "\($c): \(.assertion.label // .assertion.type) - \(.message)"'
```

## Step 5: Review Run History

The suite list shows the latest run for every suite:

```bash
curl -s $HARNESS_URL/api/suites | jq '.data[] | {name, case_count, last_run_status, last_run_passed, last_run_failed}'
```

All runs of one suite, newest first:

```bash
curl -s "$HARNESS_URL/api/runs?suite_id=$SUITE_ID" | jq '.data[] | {id, status, environment, triggered_by, passed, failed}'
```

## Step 6: Iterate on Cases

Update a case's assertions (the array is replaced as a whole):

```bash
curl -s -X PATCH $HARNESS_URL/api/cases/$CASE_ID \
  -H 'Content-Type: application/json' \
  -d '{ "assertions": [ { "type": "contains", "expected": "Paris", "label": "Names Paris" } ] }'
```

Fork a suite before a major prompt or model change:

```bash
curl -s -X POST $HARNESS_URL/api/suites/$SUITE_ID/duplicate \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Geography Bot - Smoke (v2 prompt)" }'
```

## Step 7: Use It in CI

Run a suite after deploying your bundle to a test environment and fail the job if any case fails:

```bash
#!/usr/bin/env bash
set -euo pipefail

RUN=$(curl -sf -X POST "$HARNESS_URL/api/suites/$SUITE_ID/run" \
  -H 'Content-Type: application/json' \
  -d "{\"environment\": \"staging\", \"triggered_by\": \"ci-${BUILD_ID:-local}\"}")

FAILED=$(echo "$RUN" | jq '.failed')
RUN_ID=$(echo "$RUN" | jq -r '.id')
echo "Run $RUN_ID: $(echo "$RUN" | jq '.passed') passed, $FAILED failed"

if [ "$FAILED" -gt 0 ]; then
  curl -s "$HARNESS_URL/api/runs/$RUN_ID/results?status=failed&page_size=100" \
    | jq -r '.data[] | "FAILED: \(.test_case_name)"'
  exit 1
fi
```

Because data does not persist across service restarts, keep suite definitions in your repository and have CI (re)create the suite before running it if it is missing. While runs use simulated responses, treat this as validating your pipeline wiring rather than your bundle's answers.

## Optional: Define a Schedule

Store a nightly schedule. A `cron` frequency requires `cron_expression`.

```bash
curl -s -X POST $HARNESS_URL/api/schedules \
  -H 'Content-Type: application/json' \
  -d "{
    \"suite_id\": \"$SUITE_ID\",
    \"frequency\": \"cron\",
    \"cron_expression\": \"0 2 * * *\",
    \"environment\": \"staging\"
  }"
```

Schedules do **not** trigger runs automatically yet; use your CI system's scheduler in the meantime. A suite with an enabled schedule cannot be deleted; disable the schedule first:

```bash
curl -s -X PATCH $HARNESS_URL/api/schedules/$SCHEDULE_ID \
  -H 'Content-Type: application/json' \
  -d '{ "enabled": false }'
```

## Next Steps

- [Concepts](./concepts.md) — Suite design guidance, assertion semantics, and what is coming (live invocation, `result_bot`)
- [Reference](./reference.md) — Every endpoint, field, and error response
- [Operations](./operations.md) — Access, limits, and troubleshooting
- [Test Evaluation Agent](../../system-agents/test-evaluation.md) — Try LLM-judged evaluation directly while `result_bot` assertions are in development
