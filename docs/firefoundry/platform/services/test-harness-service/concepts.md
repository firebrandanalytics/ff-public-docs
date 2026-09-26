# Test Harness Service — Concepts

This page explains the mental model behind the Test Harness Service: the objects it stores, how a test run moves through its lifecycle, how assertions are evaluated, and how the service relates to agent bundles and the Test Evaluation Agent.

## The Mental Model

A test in FireFoundry is a question you ask an agent together with a description of what a good answer looks like. The Test Harness Service turns that idea into data:

```
Test Suite  ──(1:n)──>  Test Case  ──(1:n, inline)──>  Assertion
    │
    ├──(1:n)──>  Test Run  ──(1:n)──>  Test Result  ──(1:n, inline)──>  Assertion Result
    │
    └──(1:n)──>  Scheduled Run
```

- You define **what** to test once (suite, cases, assertions).
- Every time you execute the suite you get a new **run** with one **result** per case.
- A **schedule** describes **when** a suite should run automatically.

Because definitions and history are stored by the service, the same suite can be run by a developer from the command line, by a CI pipeline, or by a schedule, and all of those runs are comparable.

## Core Domain Objects

### Test Suite

A suite is a named collection of test cases aimed at one target bot.

| Field | Description |
|-------|-------------|
| `id` | UUID assigned by the service |
| `name` | Human-readable name (required) |
| `description` | Optional free text |
| `target_bot_id` | Identifier of the bot or bundle under test (required) |
| `target_bot_name` | Optional display name for the target |
| `tags` | Array of strings for grouping and filtering (default `[]`) |
| `created_at` / `updated_at` | ISO 8601 timestamps; `updated_at` also changes when a case is added |

When you list suites, each suite is enriched with statistics: `case_count`, and — if the suite has been run — `last_run_status`, `last_run_at`, `last_run_passed`, and `last_run_failed`. The list is sorted by most recently updated first.

### Test Case

A case is one input and the checks applied to the response.

| Field | Description |
|-------|-------------|
| `id` / `suite_id` | Case UUID and owning suite |
| `name` | Case name (required); copied onto results so history survives renames |
| `description` | Optional free text |
| `input_message` | The message sent to the target (required) |
| `assertions` | Array of assertions (default `[]`) |
| `timeout_ms` | Per-case timeout budget (default `10000`) |
| `sort_order` | Execution order within the suite; defaults to one more than the current highest value |

Cases execute in ascending `sort_order`. A case with no assertions always passes.

### Assertion

Assertions are stored inline on the case as JSON objects:

```json
{ "type": "matches_regex", "expected": "ORD-\\d+", "label": "Returns order ID" }
```

| Field | Description |
|-------|-------------|
| `type` | The assertion type (see below) |
| `expected` | The value or pattern to compare with — always a string |
| `path` | For `json_path` only: a dot-separated path such as `$.order.status` |
| `label` | Optional human-readable label shown in results |

A case **passes only when every assertion passes**. Each evaluated assertion produces an **assertion result** containing the original assertion, `passed`, the `actual_value` it was compared against, and a `message` explaining the verdict.

### Test Run

A run is one execution of a suite.

| Field | Description |
|-------|-------------|
| `status` | `pending`, `running`, `completed`, `cancelled`, or `failed` |
| `environment` | Optional free-text label, e.g. `staging` or `dev` |
| `triggered_by` | Optional free-text label for who or what started the run, e.g. `ci-pipeline` |
| `total_cases` | Number of cases in the suite when the run was created |
| `passed` / `failed` / `skipped` | Roll-up counts, filled in when the run completes |
| `started_at` / `completed_at` / `duration_ms` | Timing information |

### Test Result

A result is the outcome of one case within one run: `status` (`passed`, `failed`, `skipped`, or `error`), the `actual_response` that was evaluated, `duration_ms`, an optional `error_message`, and the array of `assertion_results`.

### Scheduled Run

A schedule ties a suite to a frequency: `hourly`, `daily`, `weekly`, `monthly`, or `cron` (which requires a `cron_expression`). Schedules can carry an `environment` label and can be switched on and off with `enabled`. The fields `last_run_at` and `next_run_at` are reserved for the scheduler.

## Run Lifecycle

```
            POST /api/runs                 POST /api/runs/{id}/execute
  (none) ──────────────────> pending ─────────────────────────> running ──> completed
                               │                                  │
                               │ POST /api/runs/{id}/cancel       │ cancel
                               v                                  v
                           cancelled <─────────────────────────────
```

1. **Create** — `POST /api/runs` records a `pending` run and snapshots `total_cases`. Nothing executes yet, so a CI job can create the run, store its ID, and execute it as a separate step.
2. **Execute** — `POST /api/runs/{id}/execute` moves the run to `running`, evaluates each case in `sort_order`, stores one result per case, and marks the run `completed` with pass/fail counts and duration. Only a `pending` run can be executed; executing any other status returns `409 Conflict`.
3. **Cancel** — `POST /api/runs/{id}/cancel` is allowed while a run is `pending` or `running`; any other status returns `409 Conflict`.
4. **Shortcut** — `POST /api/suites/{suiteId}/run` performs create and execute in one call and returns the finished run.

Execution is synchronous: the execute call returns once every case has been evaluated. `completed` means the run finished, not that every case passed — check the `passed` and `failed` counts, or list results with `?status=failed`.

The `failed` run status and the `skipped` / `error` result statuses are part of the data model for the live execution engine; the 0.1.0 executor produces only `completed` runs with `passed` or `failed` results.

## Assertion Evaluation

In 0.1.0 the engine evaluates these assertion types against the response text:

| Type | Behavior |
|------|----------|
| `contains` | Passes if the response contains `expected` (case-sensitive substring) |
| `not_contains` | Passes if the response does **not** contain `expected` |
| `equals` | Passes if the response is exactly `expected` |
| `matches_regex` | Passes if `expected`, compiled as a JavaScript regular expression without flags, matches anywhere in the response. An invalid pattern fails the assertion with an `Invalid regex` message |
| `json_path` | Parses the response as JSON, follows the dot path in `path` (default `$`, the whole document), and compares the value — strings as-is, everything else as JSON text — with `expected`. A non-JSON response fails |

Three further types are accepted and stored but are placeholders until the live execution engine lands:

| Type | 0.1.0 behavior |
|------|----------------|
| `status_code` | Always passes (message: "Status code assertion evaluated at HTTP level") |
| `latency_under` | Always passes (message: "Latency assertion evaluated at run level") |
| `skill_called` | Case-insensitive check that the response text mentions `expected`; does not inspect traces |

Any other `type` fails with `Unknown assertion type`. Assertion types are not validated when a case is saved, so a typo surfaces as a failed assertion at run time.

## Current Release vs. In Development

Version 0.1.0 ships the full REST surface described in the [Reference](./reference.md), with two important limitations:

1. **In-memory storage.** Suites, cases, runs, results, and schedules live in the service process. They are lost when the pod restarts, and they are not shared between replicas. The repository includes PostgreSQL migrations for the same tables (`test_suites`, `test_cases`, `test_runs`, `test_results`, `test_assertions`, `scheduled_runs`), but 0.1.0 does not connect to a database.
2. **Simulated execution.** The executor does not call the target bot. Each case is evaluated against the string `Simulated response for: <input_message>`. This is useful for exercising the API, building UI and CI integrations, and validating that assertions are well-formed, but results do not reflect real bundle behavior.

Additionally, **schedules are stored but not triggered** — 0.1.0 has no scheduler process, so a schedule never creates runs on its own.

The following capabilities are in development. They are described here so you can see where the service is heading; names and shapes may change before release.

- **Live bundle invocation.** Each case will declare an `invocation_type` — `api_endpoint` (call a bundle's custom API route), `entity_invoke` (call a method on a specific entity), or `bot_run` (run a named bot) — plus the fields that type needs (`route` and `method`, `entity_id` and `entity_method`, or `bot_name`).
- **Bundle routing.** Cases will reference a `target_bundle` by name; the service will resolve the name to a host and port through an environment-scoped routing file, so the same suite can run against dev, staging, or production bundles by changing configuration rather than cases.
- **Real `status_code` and latency checks** measured on the actual HTTP call.
- **Extended assertion library.** `string_match` (optionally case-insensitive), `levenshtein` (similarity threshold), `number_match` (numeric tolerance), and `json_match` (deep JSON comparison, optionally allowing extra fields).
- **`result_bot` semantic assertions.** The harness will send the case's input, the expected answer, and the actual response to the [Test Evaluation Agent](../../system-agents/test-evaluation.md) and use its `is_correct` verdict and reasoning as the assertion result. This is the recommended way to test free-text, numeric-with-reasoning, and multi-step answers where exact matching is too brittle.
- **PostgreSQL persistence** using the shipped migrations.

## How It Interacts with Other Services

| Component | Relationship |
|-----------|--------------|
| **Agent bundles** | The systems under test. A suite's `target_bot_id` identifies the target; live invocation is in development |
| **[Test Evaluation Agent](../../system-agents/test-evaluation.md)** | LLM judge for `result_bot` assertions (in development). Can also be called directly by custom test runners |
| **[FF Broker](../ff-broker/README.md)** | Routes LLM calls made by the bundles under test and by the Test Evaluation Agent. The harness itself makes no LLM calls |
| **Console / CI pipelines** | Clients of the REST API; `environment` and `triggered_by` labels let them tag runs |

## Design Guidance

- **One suite per behavior area of one target.** Suites carry a single `target_bot_id` and are the unit of execution and scheduling.
- **Label your assertions.** `label` is echoed back in every assertion result and makes failure reports readable.
- **Prefer several narrow assertions over one broad one.** Two `contains` checks produce two independent verdicts; a single regex that tries to cover both does not.
- **Use `duplicate` to fork.** Copy a suite before making sweeping changes so you can compare old and new definitions side by side.
- **Tag runs.** Set `environment` and `triggered_by` on every run so history can be filtered and attributed.

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
- [Test Evaluation Agent](../../system-agents/test-evaluation.md)
