# Test Harness Service

## Overview

The Test Harness Service is a FireFoundry platform service for defining, running, and analyzing automated tests against agent bundles. Application developers organize tests into **suites**, add **cases** that pair an input message with a set of **assertions** describing what a correct response looks like, and then ask the service to **run** the suite — on demand today, and on a recurring **schedule** once scheduled execution ships. Every run records per-case **results** together with the verdict of each assertion, so test history lives alongside the platform it targets instead of in scattered scripts.

> **Preview release.** Version 0.1.0 provides the complete suite / case / run / result / schedule REST API, but keeps its data in memory and evaluates assertions against a *simulated* response rather than calling a live agent bundle. Live bundle invocation, PostgreSQL persistence, the extended assertion library, and the `result_bot` integration with the [Test Evaluation Agent](../../system-agents/test-evaluation.md) are in development. See [Concepts — Current Release vs. In Development](./concepts.md#current-release-vs-in-development) before relying on the service.

## Purpose and Role in Platform

Testing AI applications is harder than testing deterministic software: a correct answer might be phrased many ways, and the line between a regression and acceptable drift is often a judgment call. The Test Harness Service is the place where application developers codify those judgment calls — once — and then re-run them as their bundles evolve.

The service:

- Stores test suites, cases, runs, results, and schedules as first-class platform data with a stable REST API
- Evaluates each response against the case's assertions and records pass/fail with the actual value and a human-readable message for every assertion
- Tracks run history per suite (last run status, pass/fail counts) so dashboards and CI pipelines can show trends
- Defines schedules (hourly, daily, weekly, monthly, or a cron expression) for continuous evaluation
- Is the intended front door to the [Test Evaluation Agent](../../system-agents/test-evaluation.md): semantic, LLM-judged `result_bot` assertions will be delegated to that agent so exact-match checks are not the only option (in development)

Application developers can call the Test Evaluation Agent directly from a custom test runner, but the recommended flow is to drive test execution through this service — test definitions live alongside the platform they target, history is preserved, and scheduled runs do not require additional infrastructure.

## Key Features

- **Test suites and cases** — Organize tests into named, tagged suites tied to a target bot; each case carries an input message, a timeout, an ordering key, and a list of assertions
- **Suite duplication** — Clone a suite and all of its cases in one call to fork a baseline or create an environment-specific variant
- **Assertion engine** — `contains`, `not_contains`, `equals`, `matches_regex`, and `json_path` checks evaluated per case; a case passes only when every assertion passes
- **Test runs and results** — Create a run, execute it, cancel it, or use the one-call "run suite" shortcut; retrieve per-case results filtered by status
- **Run statistics** — Suite listings include case count and the status and pass/fail counts of the most recent run
- **Schedule definitions** — Store hourly / daily / weekly / monthly / cron schedules per suite and enable or disable them
- **Pagination everywhere** — All list endpoints return a uniform `{ data, total, page, page_size, total_pages }` envelope
- **Admin statistics** — An API-key-protected `/admin/stats` endpoint for totals across suites, runs, and schedules

## Architecture Overview

```
+-----------------------------------------------------+
|        Application / Console / CI Pipeline          |
+-----------------------+-----------------------------+
                        | HTTP (REST, JSON)
                        v
+-----------------------------------------------------+
|              Test Harness Service                   |
|                                                     |
|  RouteManager (Express 5)                           |
|   /api/suites  /api/cases  /api/runs                |
|   /api/results /api/schedules  /admin/stats         |
|                        |                            |
|  TestHarnessProvider   v                            |
|  +------------------+    +-----------------------+  |
|  | Suite / Case /   |    | Run Executor          |  |
|  | Schedule CRUD    |    | + Assertion Engine    |  |
|  +--------+---------+    +-----------+-----------+  |
|           |                          |              |
|  +--------v--------------------------v-----------+  |
|  |   Suite, Case, Run, Result, Schedule store    |  |
|  |   (in-memory in 0.1.0; PostgreSQL planned)    |  |
|  +-----------------------------------------------+  |
+--------------------------+--------------------------+
                           : invokes target bundles
                           : (in development)
                           v
   +---------------------------------------------+
   |   Agent Bundles (any bundle in the env)     |
   +---------------------------------------------+
                           :
                           v
              +---------------------------+
              | Test Evaluation Agent     |
              | (result_bot assertions,   |
              |  in development)          |
              +---------------------------+
```

Dotted connections are part of the execution engine that is in development; solid connections are implemented in 0.1.0.

**Core Components:**

- **RouteManager** — REST endpoints for suites, cases, runs, results, schedules, health, and admin statistics
- **TestHarnessProvider** — Business logic: CRUD, pagination, suite statistics, run lifecycle, and assertion evaluation
- **Run Executor** — Walks a suite's cases in `sort_order`, obtains a response for each case, evaluates its assertions, records a result, and rolls up pass/fail counts onto the run
- **Assertion Engine** — Applies each assertion to the response and produces an `AssertionResult` with `passed`, `actual_value`, and `message`
- **Admin middleware** — Protects `/admin/*` with an API key (`X-API-Key` or `Authorization: Bearer`)

## Documentation

- **[Concepts](./concepts.md)** — Suites, cases, assertions, runs, results, schedules; run lifecycle; what is implemented today vs. in development
- **[Getting Started](./getting-started.md)** — Run the service locally and walk through creating a suite, adding cases, running it, and reading results
- **[Reference](./reference.md)** — Every REST endpoint with request/response shapes, assertion types, error responses, and environment variables
- **[Operations](./operations.md)** — Deployment, configuration, health checks, scaling constraints, security, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Preview. The REST API surface is stable enough to build tooling against; storage is in-memory and test execution is simulated. There is no Helm chart for the service in the FireFoundry chart repository yet — see [Operations](./operations.md#deployment).

## Repository

Source code: [ff-services-test-harness](https://github.com/firebrandanalytics/ff-services-test-harness) (private)

## Related

- [Test Evaluation Agent](../../system-agents/test-evaluation.md) — The LLM judge that will power `result_bot` semantic assertions
- [System Agents](../../system-agents/README.md) — Pre-built agent bundles you may want to write tests against
- [FF Broker](../ff-broker/README.md) — Routes LLM calls made by the bundles under test (and by the Test Evaluation Agent)
- [Platform Services Overview](../README.md) — Catalog of all FireFoundry platform services
