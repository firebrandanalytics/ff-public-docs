# Test Harness Service

## Overview

The Test Harness Service is a FireFoundry platform service for defining, running, and analyzing automated tests against agent bundles. Application developers organize tests into suites, define cases that invoke a target bundle with a particular input, attach assertions that describe what a correct response looks like, and ask the service to run the suite — either on demand or on a recurring schedule.

## Purpose and Role in Platform

Testing AI applications is harder than testing deterministic software: a correct answer might be phrased many ways, and the line between regression and acceptable drift is often a judgment call. The Test Harness Service is the place where application developers codify those judgment calls — once — and then re-run them continuously as their bundles evolve.

The service:

- Stores test suites, cases, runs, results, and schedules so that test definitions are first-class platform data, not scattered scripts
- Invokes target agent bundles using the same calling conventions a real client would use
- Evaluates each response against the case's assertions and records pass/fail with full context
- Integrates with the [Test Evaluation Agent](../system-agents/test-evaluation.md) for semantic assertions where exact-string matching is too brittle
- Supports scheduled runs for continuous evaluation in addition to one-off runs

Application developers can call the Test Evaluation Agent directly from a custom test runner, but the recommended flow is to drive test execution through this service — test definitions live alongside the platform they target, history is preserved, and scheduled runs do not require additional infrastructure.

## Key Features

- **Test suites and cases** — Organize tests into named suites; each case defines an input, a target invocation, and a set of assertions
- **Three invocation types** — A test case can call an agent bundle's HTTP API endpoint, invoke a specific entity method, or run a named bot
- **Rich assertion library** — Substring match, regex, JSON-path equality, JSON deep match, numeric tolerance, latency budget, Levenshtein similarity, status code, skill-called checks, and LLM-judged semantic correctness via the Test Evaluation Agent
- **Bundle routing** — Each environment maps target bundle names to the actual host and port of the bundle, so test cases reference bundles by name rather than wiring URLs into every case
- **Test runs and results** — Trigger a run, monitor its progress, cancel it if needed, and retrieve per-case results with the assertion verdicts that produced them
- **Scheduled runs** — Schedule suites to run on a cron expression for continuous evaluation; results are recorded the same way as on-demand runs

## Architecture Overview

```
+-----------------------------------------------------+
|        Application / Console / CI Pipeline          |
+-----------------------+-----------------------------+
                        | HTTP (REST)
                        v
+-----------------------------------------------------+
|              Test Harness Service                   |
|  +------------------+    +-----------------------+  |
|  | Suite / Case     |    | Run Executor          |  |
|  | CRUD             |    | + Assertion Engine    |  |
|  +--------+---------+    +-----------+-----------+  |
|           |                          |              |
|  +--------v--------------------------v-----------+  |
|  |           Suite, Case, Run, Result Store      |  |
|  +-----------------------+-----------------------+  |
+--------------------------|--------------------------+
                           | invokes target bundles
                           v
   +---------------------------------------------+
   |   Agent Bundles (any bundle in the env)     |
   |   - Custom application bundles              |
   |   - System agents (RAG, web search, etc.)   |
   +---------------------------------------------+
                           |
                           v
              +---------------------------+
              | Test Evaluation Agent     |
              | (for semantic assertions) |
              +---------------------------+
```

**Core Components:**

- **Suite / Case CRUD** — REST endpoints for managing suites, cases, and the assertions attached to each case
- **Run Executor** — Drives a single test run: resolves the case's invocation target, makes the call, evaluates each assertion, and records the result
- **Assertion Engine** — Applies the chosen assertion types to actual responses; delegates `result_bot` assertions to the Test Evaluation Agent for LLM-based judgment
- **Schedule Worker** — Runs scheduled suites on their configured cron expressions

## API and Interfaces

All endpoints are under `/api` and use JSON request and response bodies.

### Test Suites

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/suites` | Create a test suite |
| GET | `/api/suites` | List test suites |
| GET | `/api/suites/:id` | Get a suite by ID |
| PATCH | `/api/suites/:id` | Update suite metadata |
| DELETE | `/api/suites/:id` | Delete a suite |
| POST | `/api/suites/:id/duplicate` | Duplicate a suite (and its cases) |

### Test Cases

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/suites/:id/cases` | Add a case to a suite |
| GET | `/api/suites/:id/cases` | List cases in a suite |
| GET | `/api/cases/:id` | Get a case by ID |
| PATCH | `/api/cases/:id` | Update a case |
| DELETE | `/api/cases/:id` | Delete a case |

A test case carries:

- An `input_message` that will be sent to the target
- An `invocation_type` (`api_endpoint`, `entity_invoke`, or `bot_run`) describing how to invoke the bundle
- Fields specific to that invocation type (`route` and `method` for API calls, `entity_id` and `entity_method` for entity invokes, `bot_name` for bot runs)
- A `target_bundle` name, resolved through the environment's bundle-routing configuration
- A list of `assertions` (see below)

### Test Runs and Results

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Create a test run (for a given suite) |
| GET | `/api/runs` | List runs |
| GET | `/api/runs/:id` | Get a run's overall status |
| POST | `/api/runs/:id/execute` | Start execution of a created run |
| POST | `/api/runs/:id/cancel` | Cancel an in-progress run |
| GET | `/api/runs/:id/results` | List per-case results for a run |
| GET | `/api/results/:id` | Get a single result, including the assertion verdicts |

### Scheduled Runs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/schedules` | Create a scheduled run (cron expression + target suite) |
| GET | `/api/schedules` | List schedules |
| GET | `/api/schedules/:id` | Get a schedule |
| PATCH | `/api/schedules/:id` | Update a schedule (e.g. change its cron or pause it) |
| DELETE | `/api/schedules/:id` | Delete a schedule |

### Assertion Types

Each test case attaches one or more assertions; a case passes only when every assertion passes.

| Type | What it checks |
|------|----------------|
| `contains` / `not_contains` | The response contains (or does not contain) a substring |
| `equals` / `string_match` | The response equals an expected string (with optional case-insensitivity) |
| `matches_regex` | The response matches a regular expression |
| `levenshtein` | The response is within a similarity threshold of the expected string |
| `json_path` | A JSONPath expression against the response equals an expected value |
| `json_match` | The response JSON deep-matches an expected JSON object (optionally allowing extra fields) |
| `number_match` | A numeric value in the response is within a tolerance of an expected number |
| `status_code` | The HTTP status code matches an expected value |
| `latency_under` | The call completed within a latency budget |
| `skill_called` | The bundle exercised a specific skill during the run |
| `result_bot` | The response is semantically correct, judged by the [Test Evaluation Agent](../system-agents/test-evaluation.md) |

The `result_bot` assertion is the integration point with the Test Evaluation Agent. Use it for cases where exact-match assertions are too brittle (free-text answers, numeric answers with reasoning, multi-step responses).

### Standard Service Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |
| GET | `/status` | Service status summary |

## Bundle Routing

Test cases reference target bundles by name (`target_bundle`). The service resolves names to live URLs using an environment-scoped bundle-routing configuration. This keeps test definitions portable across environments — the same suite can run against a dev, staging, or production bundle by changing the routing config rather than the cases.

## Dependencies

- **Target agent bundles** — The bundles you write tests against (custom application bundles, [system agents](../system-agents/README.md), or both)
- **[Test Evaluation Agent](../system-agents/test-evaluation.md)** — Used for `result_bot` semantic assertions; not required for other assertion types
- **[FF Broker](./ff-broker/README.md)** — Routes LLM calls made by the bundles under test (and by the Test Evaluation Agent)

## Configuration

The service is configured via environment variables (see `.env.example` in the service repository for the complete list). The main groups are:

- **Service settings** — HTTP port and log level
- **Database connection** — host, database, credentials
- **Bundle routing** — path to (or inline JSON for) the bundle-name-to-host map
- **Test Evaluation Agent connection** — base URL of the agent for `result_bot` assertions

## Version

- **Current Version**: 0.1.0

## Repository

Source code: [ff-services-test-harness](https://github.com/firebrandanalytics/ff-services-test-harness)

## Related Documentation

- [Test Evaluation Agent](../system-agents/test-evaluation.md) — The LLM judge that powers `result_bot` assertions
- [System Agents](../system-agents/README.md) — Pre-built agent bundles you may want to write tests against
- [Platform Services Overview](./README.md) — Catalog of all FireFoundry platform services
