# Test Harness Service — Reference

REST API reference for the Test Harness Service 0.1.0: endpoints, request and response shapes, assertion types, and errors.

## Conventions

- **Base URL**: The URL of the Test Harness Service in your environment (see [Operations — Getting Access](./operations.md#getting-access-in-your-environment)). Examples use `$HARNESS_URL`.
- **Content type**: JSON request and response bodies (`Content-Type: application/json`). Request bodies are limited to 5 MB.
- **IDs**: All resource IDs are UUIDs.
- **Timestamps**: ISO 8601 strings in UTC.
- **Authentication**: The `/api/*` endpoints require no credentials in 0.1.0; access is controlled by who can reach the service on the network (see [Operations — Access and Data Handling](./operations.md#access-and-data-handling)).
- **Partial updates**: `PATCH` endpoints apply only the fields present in the body.

### Pagination

All list endpoints accept `page` (default `1`) and `page_size` (default `25`) query parameters and return:

```json
{
  "data": [ ... ],
  "total": 42,
  "page": 1,
  "page_size": 25,
  "total_pages": 2
}
```

`total_pages` is at least `1`, even when `total` is `0`.

## Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/suites` | List suites with run statistics |
| POST | `/api/suites` | Create a suite |
| GET | `/api/suites/{id}` | Get a suite |
| PATCH | `/api/suites/{id}` | Update a suite |
| DELETE | `/api/suites/{id}` | Delete a suite and its cases and schedules |
| POST | `/api/suites/{id}/duplicate` | Duplicate a suite and its cases |
| GET | `/api/suites/{suiteId}/cases` | List a suite's cases |
| POST | `/api/suites/{suiteId}/cases` | Add a case to a suite |
| GET | `/api/cases/{id}` | Get a case |
| PATCH | `/api/cases/{id}` | Update a case |
| DELETE | `/api/cases/{id}` | Delete a case |
| GET | `/api/runs` | List runs |
| POST | `/api/runs` | Create a run (does not execute) |
| GET | `/api/runs/{id}` | Get a run |
| POST | `/api/runs/{id}/execute` | Execute a pending run |
| POST | `/api/runs/{id}/cancel` | Cancel a pending or running run |
| POST | `/api/suites/{suiteId}/run` | Create and execute a run in one call |
| GET | `/api/runs/{runId}/results` | List a run's results |
| GET | `/api/results/{id}` | Get a result |
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create a schedule |
| GET | `/api/schedules/{id}` | Get a schedule |
| PATCH | `/api/schedules/{id}` | Update a schedule |
| DELETE | `/api/schedules/{id}` | Delete a schedule |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

## Test Suites

### GET /api/suites

List suites, most recently updated first. Query: `page`, `page_size`.

Each item is a [TestSuite](#testsuite) plus:

| Field | Type | Description |
|-------|------|-------------|
| `case_count` | number | Number of cases in the suite |
| `last_run_status` | string | Status of the most recent run (absent if never run) |
| `last_run_at` | string | Completion time of the most recent run, or its creation time if not completed |
| `last_run_passed` | number | Passed count of the most recent run |
| `last_run_failed` | number | Failed count of the most recent run |

### POST /api/suites

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Suite name |
| `target_bot_id` | string | yes | Identifier of the target bot or bundle |
| `target_bot_name` | string | no | Display name of the target |
| `description` | string | no | Free text |
| `tags` | string[] | no | Tags (default `[]`) |

Returns `201` with the [TestSuite](#testsuite). `400` with `"name and target_bot_id are required"` if either is missing.

### GET /api/suites/{id}

Returns the [TestSuite](#testsuite) (without statistics) or `404` `"Test suite not found"`.

### PATCH /api/suites/{id}

Body: any of `name`, `description`, `target_bot_id`, `target_bot_name`, `tags`. Returns the updated suite or `404`.

### DELETE /api/suites/{id}

Deletes the suite, its cases, and its schedules. Returns `204`, `404` if the suite does not exist, or `409` `"Cannot delete suite with active scheduled runs"` if any of its schedules has `enabled: true`.

### POST /api/suites/{id}/duplicate

Body (optional): `{ "name": "New name" }`. Default name is `"<original name> (copy)"`. Copies description, target, tags, and every case (with assertions, timeout, and sort order). Runs and schedules are not copied. Returns `201` with the new suite, or `404`.

## Test Cases

### GET /api/suites/{suiteId}/cases

List a suite's cases in ascending `sort_order`. Query: `page`, `page_size`. An unknown suite returns an empty list.

### POST /api/suites/{suiteId}/cases

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Case name |
| `input_message` | string | yes | Message sent to the target |
| `assertions` | [Assertion](#assertion)[] | no | Default `[]` |
| `description` | string | no | Free text |
| `timeout_ms` | number | no | Default `10000` |
| `sort_order` | number | no | Default: current highest `sort_order` in the suite + 1 |

Returns `201` with the [TestCase](#testcase). `400` `"name and input_message are required"`; `404` `"Test suite not found"`.

### GET /api/cases/{id}

Returns the [TestCase](#testcase) or `404` `"Test case not found"`.

### PATCH /api/cases/{id}

Body: any of `name`, `description`, `input_message`, `assertions` (replaces the whole array), `timeout_ms`, `sort_order`. Returns the updated case or `404`.

### DELETE /api/cases/{id}

Returns `204` or `404`.

## Test Runs

### GET /api/runs

List runs, newest first. Query: `suite_id` (optional filter), `page`, `page_size`.

### POST /api/runs

Create a `pending` run. Does not execute it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `suite_id` | string | yes | Suite to run |
| `environment` | string | no | Free-text label, e.g. `staging` |
| `triggered_by` | string | no | Free-text label, e.g. `ci-pipeline` |

Returns `201` with the [TestRun](#testrun). `400` `"suite_id is required"`; `404` `"Test suite not found"`.

### GET /api/runs/{id}

Returns the [TestRun](#testrun) or `404` `"Test run not found"`.

### POST /api/runs/{id}/execute

Executes a `pending` run synchronously and returns the finished run. `404` if the run does not exist; `409` `"Cannot execute run in status: <status>"` if the run is not `pending`.

### POST /api/runs/{id}/cancel

Cancels a `pending` or `running` run and returns it with `status: "cancelled"`. `404` if not found; `409` `"Cannot cancel run in status: <status>"` otherwise.

### POST /api/suites/{suiteId}/run

Shortcut for create + execute. Body (optional): `environment`, `triggered_by`. Returns `200` with the executed [TestRun](#testrun), or `404` `"Test suite not found"`.

## Test Results

### GET /api/runs/{runId}/results

List a run's results. Query: `status` (`passed`, `failed`, `skipped`, `error`), `page`, `page_size`. An unknown run returns an empty list.

### GET /api/results/{id}

Returns the [TestResult](#testresult) or `404` `"Test result not found"`.

## Scheduled Runs

### GET /api/schedules

List schedules, newest first. Query: `suite_id`, `page`, `page_size`.

### POST /api/schedules

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `suite_id` | string | yes | Suite to schedule |
| `frequency` | string | yes | `hourly`, `daily`, `weekly`, `monthly`, or `cron` |
| `cron_expression` | string | when `frequency` is `cron` | Standard cron expression |
| `environment` | string | no | Environment label for runs |
| `enabled` | boolean | no | Default `true` |

Returns `201` with the [ScheduledRun](#scheduledrun). `400` `"suite_id and frequency are required"` or `"cron_expression is required when frequency is 'cron'"`; `404` `"Test suite not found"`.

> Schedules are stored but not executed automatically in 0.1.0.

### GET /api/schedules/{id}

Returns the [ScheduledRun](#scheduledrun) or `404` `"Scheduled run not found"`.

### PATCH /api/schedules/{id}

Body: any of `frequency`, `cron_expression`, `environment`, `enabled`. Switching to `cron` without a cron expression (in the body or already stored) returns `400`. Returns the updated schedule or `404`.

### DELETE /api/schedules/{id}

Returns `204` or `404`.

## Health Endpoints

| Path | Response |
|------|----------|
| `GET /health` | `{ "status": "healthy", "timestamp": "<iso>" }` |
| `GET /ready` | `{ "ready": true }` |

Use `/health` to check that the service is reachable from your workstation, CI runner, or bundle.

## Response Schemas

### TestSuite

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string (optional)",
  "target_bot_id": "string",
  "target_bot_name": "string (optional)",
  "tags": ["string"],
  "created_at": "iso-8601",
  "updated_at": "iso-8601"
}
```

### TestCase

```json
{
  "id": "uuid",
  "suite_id": "uuid",
  "name": "string",
  "description": "string (optional)",
  "input_message": "string",
  "assertions": [ { "type": "contains", "expected": "string", "path": "string (optional)", "label": "string (optional)" } ],
  "timeout_ms": 10000,
  "sort_order": 1,
  "created_at": "iso-8601",
  "updated_at": "iso-8601"
}
```

### Assertion

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | One of the [assertion types](#assertion-types) |
| `expected` | string | Expected value or pattern |
| `path` | string | Dot path for `json_path` (e.g. `$.data.status`); default `$` |
| `label` | string | Optional display label |

### TestRun

```json
{
  "id": "uuid",
  "suite_id": "uuid",
  "status": "pending | running | completed | cancelled | failed",
  "environment": "string (optional)",
  "triggered_by": "string (optional)",
  "started_at": "iso-8601 (optional)",
  "completed_at": "iso-8601 (optional)",
  "total_cases": 3,
  "passed": 2,
  "failed": 1,
  "skipped": 0,
  "duration_ms": 12,
  "created_at": "iso-8601"
}
```

### TestResult

```json
{
  "id": "uuid",
  "run_id": "uuid",
  "test_case_id": "uuid",
  "test_case_name": "string",
  "status": "passed | failed | skipped | error",
  "actual_response": "string",
  "duration_ms": 0,
  "error_message": "string (optional)",
  "assertion_results": [
    { "assertion": { "type": "...", "expected": "..." }, "passed": true, "actual_value": "string", "message": "string" }
  ],
  "created_at": "iso-8601"
}
```

### ScheduledRun

```json
{
  "id": "uuid",
  "suite_id": "uuid",
  "frequency": "hourly | daily | weekly | monthly | cron",
  "cron_expression": "string (optional)",
  "environment": "string (optional)",
  "enabled": true,
  "last_run_at": "iso-8601 (optional, reserved)",
  "next_run_at": "iso-8601 (optional, reserved)",
  "created_at": "iso-8601",
  "updated_at": "iso-8601"
}
```

## Assertion Types

| Type | Status in 0.1.0 | Check |
|------|-----------------|-------|
| `contains` | Implemented | Response contains `expected` (case-sensitive) |
| `not_contains` | Implemented | Response does not contain `expected` |
| `equals` | Implemented | Response equals `expected` exactly |
| `matches_regex` | Implemented | JavaScript regex `expected` matches the response; invalid regex fails |
| `json_path` | Implemented | Value at `path` (string, or JSON text for other types) equals `expected`; non-JSON response fails |
| `status_code` | Placeholder | Always passes until live bundle invocation ships |
| `latency_under` | Placeholder | Always passes until live bundle invocation ships |
| `skill_called` | Placeholder | Case-insensitive text match of `expected` in the response |
| `string_match`, `levenshtein`, `number_match`, `json_match`, `result_bot` | In development | Not evaluated yet; currently fail with `Unknown assertion type` |

See [Concepts — Assertion Types](./concepts.md#assertion-types) for details and [Concepts — Current Release vs. In Development](./concepts.md#current-release-vs-in-development) for the planned types, including `result_bot`, which delegates to the [Test Evaluation Agent](../../system-agents/test-evaluation.md).

## Error Responses

Errors use a simple JSON body:

```json
{ "error": "Test suite not found" }
```

| Status | When |
|--------|------|
| `400` | Missing required fields; `cron` schedule without `cron_expression` |
| `404` | Resource not found (message names the resource), or unknown route (`"Not Found"`) |
| `409` | Deleting a suite with enabled schedules; executing a non-pending run; cancelling a finished run |
| `500` | Unexpected error, including a malformed JSON request body: `{ "error": "Internal Server Error" }` |

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
