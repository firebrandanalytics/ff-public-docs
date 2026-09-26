# Test Harness Service — Concepts

This page explains how to think about tests in the Test Harness Service, how to design a suite for your agent bundle, how runs and assertions behave, and what is available today versus in development.

## The Mental Model

A test is a question you ask your agent plus a description of what a good answer looks like. The service stores that as data:

```
Test Suite ──(1:n)──> Test Case ──(inline)──> Assertions
    │
    ├──(1:n)──> Test Run ──(1:n)──> Test Result ──(inline)──> Assertion Results
    │
    └──(1:n)──> Schedule
```

- You define **what** to test once (suite, cases, assertions).
- Each execution of the suite is a new **run** with one **result** per case.
- A **schedule** says **when** a suite should run automatically (automatic triggering is in development).

Because the same suite can be run by you from a terminal, by CI, or by a schedule, those runs are directly comparable.

## Core Objects

### Test Suite

A named collection of cases aimed at one target.

| Field | Description |
|-------|-------------|
| `name` | Human-readable name (required) |
| `target_bot_id` | Identifier of the bot or bundle under test (required) |
| `target_bot_name` | Optional display name |
| `description` | Optional free text |
| `tags` | Strings for grouping and filtering, e.g. `["smoke", "orders"]` |

Suite listings add `case_count` and, once the suite has been run, `last_run_status`, `last_run_at`, `last_run_passed`, and `last_run_failed`.

### Test Case

One input and the checks applied to the response.

| Field | Description |
|-------|-------------|
| `name` | Case name (required); copied onto each result so history stays readable after renames |
| `input_message` | The message sent to the target (required) |
| `assertions` | Array of assertions (default `[]`) |
| `timeout_ms` | Per-case timeout budget (default `10000`) |
| `sort_order` | Execution order within the suite; new cases go after existing ones by default |
| `description` | Optional free text |

Cases run in ascending `sort_order`. A case with no assertions always passes.

### Assertion

Assertions are stored inline on the case:

```json
{ "type": "matches_regex", "expected": "ORD-\\d+", "label": "Returns order ID" }
```

| Field | Description |
|-------|-------------|
| `type` | Assertion type (see [Assertion Types](#assertion-types)) |
| `expected` | Value or pattern to compare with; always a string |
| `path` | For `json_path` only: dot path such as `$.order.status` (default `$`) |
| `label` | Optional label echoed in results |

A case **passes only when every assertion passes**. Each evaluated assertion yields an **assertion result**: the original assertion, `passed`, the `actual_value` it was compared with, and a `message` explaining the verdict.

### Test Run

One execution of a suite.

| Field | Description |
|-------|-------------|
| `status` | `pending`, `running`, `completed`, `cancelled`, or `failed` |
| `environment` | Your free-text label, e.g. `dev`, `staging` |
| `triggered_by` | Your free-text label, e.g. `ci-pipeline`, `alice` |
| `total_cases` | Cases in the suite when the run was created |
| `passed` / `failed` / `skipped` | Roll-up counts |
| `started_at` / `completed_at` / `duration_ms` | Timing |

### Test Result

The outcome of one case in one run: `status` (`passed`, `failed`, `skipped`, `error`), the `actual_response` that was evaluated, `duration_ms`, an optional `error_message`, and the `assertion_results` array.

### Schedule

Ties a suite to a frequency — `hourly`, `daily`, `weekly`, `monthly`, or `cron` (requires `cron_expression`) — with an optional `environment` label and an `enabled` switch. A suite with an enabled schedule cannot be deleted until the schedule is disabled or removed.

## Run Lifecycle

```
          POST /api/runs              POST /api/runs/{id}/execute
 (none) ─────────────────> pending ─────────────────────────────> running ──> completed
                              │                                      │
                              │ POST /api/runs/{id}/cancel           │ cancel
                              v                                      v
                          cancelled <─────────────────────────────────
```

1. **Create** — `POST /api/runs` records a `pending` run. Nothing executes yet, so a CI job can record the run ID first.
2. **Execute** — `POST /api/runs/{id}/execute` evaluates each case in order and returns the finished run. Only a `pending` run can be executed (otherwise `409`).
3. **Cancel** — Allowed while `pending` or `running` (otherwise `409`).
4. **Shortcut** — `POST /api/suites/{suiteId}/run` creates and executes in one call.

Execution is synchronous: the call returns when every case has been evaluated. **`completed` means the run finished, not that every case passed** — check `failed`, or list results with `?status=failed`.

Today runs finish as `completed` with `passed` or `failed` results. The `failed` run status and the `skipped` / `error` result statuses will be produced once live bundle invocation ships (for example, when a call to your bundle times out), so handle them in your tooling now.

## Assertion Types

Available now, evaluated against the response text:

| Type | Behavior |
|------|----------|
| `contains` | Passes if the response contains `expected` (case-sensitive) |
| `not_contains` | Passes if the response does **not** contain `expected` |
| `equals` | Passes if the response is exactly `expected` |
| `matches_regex` | Passes if `expected`, as a JavaScript regular expression without flags, matches anywhere in the response. An invalid pattern fails with `Invalid regex` |
| `json_path` | Parses the response as JSON, follows `path`, and compares the value (strings as-is, other values as JSON text) with `expected`. A non-JSON response fails |

Accepted but not yet enforced:

| Type | Current behavior |
|------|------------------|
| `status_code` | Always passes |
| `latency_under` | Always passes |
| `skill_called` | Case-insensitive check that the response text mentions `expected`; does not inspect traces |

Any other `type` fails at run time with `Unknown assertion type`. Types are not validated when you save a case, so a typo shows up as a failed assertion when the suite runs.

### Semantic assertions with `result_bot` (in development)

For free-text, numeric-with-explanation, and multi-step answers, exact matching is brittle. The planned `result_bot` assertion sends the case's input, your expected answer, and the actual response to the [Test Evaluation Agent](../../system-agents/test-evaluation.md), and uses its `is_correct` verdict and reasoning as the assertion result. Until it ships, a `result_bot` assertion fails with `Unknown assertion type`. If you need semantic judgment today, call the Test Evaluation Agent directly from your own runner.

## Designing a Test Suite for Your Bundle

- **One suite per behavior area of one target.** A suite has a single `target_bot_id` and is the unit you run and schedule. Split "order lookup" from "refund answers" so a failure points at one area.
- **Use tags for tiers.** Tag suites `smoke`, `regression`, or `nightly` and choose which to run at each stage of your pipeline.
- **Prefer several narrow assertions over one broad one.** Two `contains` checks give two independent verdicts; one regex covering both does not tell you which part failed.
- **Label every assertion.** The `label` is echoed back in results and makes failure reports readable.
- **Assert on structure where you can.** If your bundle returns JSON, `json_path` checks on specific fields are far more stable than text matching on prose.
- **Use `not_contains` for guardrails.** For example, check that responses never include `error`, internal IDs, or phrases your prompt forbids.
- **Plan for `result_bot`.** For cases where only an LLM judge will do, write the expected answer now so you can add a `result_bot` assertion when it ships.
- **Fork with `duplicate`.** Copy a suite before a sweeping prompt or model change so you can compare old and new definitions.
- **Keep test data synthetic.** Inputs and responses are stored verbatim; avoid real customer data or credentials in `input_message` or `expected`.

## Fitting Testing into Your Workflow

1. **Keep suites as code.** Store suite and case definitions as JSON in your bundle's repository, with a small script that creates them through the API. This makes suites reviewable and lets you re-create them after a service restart.
2. **Run during development.** After [deploying your bundle locally](../../../local-development/agent-development.md), run the relevant suite and inspect failed results.
3. **Gate CI.** After deploying to a dev or staging environment, call `POST /api/suites/{id}/run` with `environment` and `triggered_by` set, and fail the job if `failed > 0`. See [Getting Started — Use It in CI](./getting-started.md#step-7-use-it-in-ci).
4. **Review history.** List runs per suite to spot trends across environments and releases.

Remember that while runs use simulated responses, CI gating verifies your wiring and assertion definitions, not your bundle's actual answers.

## Current Release vs. In Development

**Available now (0.1.0):** the full REST API described in the [Reference](./reference.md), the assertion types above, run history, and schedule definitions.

**Current limitations:**

1. **Simulated responses.** Runs do not call your bundle. Each case is evaluated against the placeholder text `Simulated response for: <input_message>`. Results are useful for exercising the API and validating assertions, not for judging bundle behavior.
2. **No persistence across restarts.** Suites, cases, runs, results, and schedules are lost when the service restarts.
3. **Schedules do not trigger runs.** Drive runs from CI or another scheduler.

**In development** (names and shapes may change before release):

- **Live bundle invocation.** Cases will declare how to call your bundle — `api_endpoint` (a bundle's custom API route, with `route` and `method`), `entity_invoke` (a method on an entity, with `entity_id` and `entity_method`), or `bot_run` (a named bot, with `bot_name`).
- **Environment routing.** Cases will reference a `target_bundle` by name, resolved per environment, so the same suite can run against dev, staging, or production by configuration rather than by editing cases.
- **Real `status_code` and `latency_under` checks** measured on the actual call.
- **Extended assertions:** `string_match` (optionally case-insensitive), `levenshtein` (similarity threshold), `number_match` (numeric tolerance), `json_match` (deep JSON comparison, optionally allowing extra fields).
- **`result_bot` semantic assertions** via the Test Evaluation Agent.
- **Persistent storage** of suites and run history.
- **Automatic scheduled runs.**

## How It Relates to Other Parts of the Platform

| Component | Relationship |
|-----------|--------------|
| **Your agent bundles** | The systems under test, identified by the suite's `target_bot_id`. Live invocation is in development |
| **[Test Evaluation Agent](../../system-agents/test-evaluation.md)** | LLM judge for `result_bot` assertions (in development); can also be called directly |
| **[FF Broker](../ff-broker/README.md)** | Routes LLM calls made by your bundle and by the Test Evaluation Agent; the harness makes no LLM calls itself |
| **CI pipelines / Console** | Clients of the REST API; `environment` and `triggered_by` labels attribute each run |

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
- [Test Evaluation Agent](../../system-agents/test-evaluation.md)
