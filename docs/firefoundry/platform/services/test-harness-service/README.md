# Test Harness Service

## Overview

The Test Harness Service lets you define, run, and review automated tests for your agent bundles. You organize tests into **suites**, add **cases** that pair an input message with **assertions** describing a correct response, and **run** the suite from a terminal, a CI pipeline, or (later) a schedule. Every run records a per-case **result** with the verdict of each assertion, so you can see what changed between runs of your bundle.

> **Preview.** The suite / case / run / result / schedule REST API is available now, with these limits that you should design around:
> - **Runs use simulated responses.** The harness does not yet call your bundle; each case is evaluated against a placeholder response. Use it today to build your suites and CI wiring, not to judge real bundle behavior.
> - **Data does not persist across service restarts.** Keep your suite definitions in source control and re-create them as needed.
> - **Schedules are stored but do not trigger runs yet.** Trigger runs from CI.
> - **Semantic (`result_bot`) assertions via the [Test Evaluation Agent](../../system-agents/test-evaluation.md) are in development.**
>
> See [Concepts — Current Release vs. In Development](./concepts.md#current-release-vs-in-development).

## Purpose and Role in Platform

AI responses are hard to test with ordinary unit tests: a correct answer can be phrased many ways, and the line between a regression and acceptable drift is a judgment call. The Test Harness Service is where you codify those judgment calls once and re-run them as your bundle's prompts, models, and code change.

As an app builder you use it to:

- Keep a regression suite for each behavior area of your bundle (for example, "order lookup", "refund policy answers")
- Gate CI on a suite run: run it after deploying to a dev or staging environment and fail the build if any case fails
- Compare run history across environments and over time using the `environment` and `triggered_by` labels you attach to runs
- (In development) Use `result_bot` assertions to have an LLM judge free-text answers when exact matching is too brittle

You can call the [Test Evaluation Agent](../../system-agents/test-evaluation.md) directly from your own test runner, but the intended path is to define tests here so definitions and history live next to the platform they target.

## Key Features

- **Suites and cases** — Named, tagged suites tied to a target bot or bundle; each case carries an input message, a timeout, an ordering key, and a list of assertions
- **Assertions** — `contains`, `not_contains`, `equals`, `matches_regex`, and `json_path` today; a case passes only when every assertion passes
- **Runs and results** — Run a suite in one call, or create and execute a run as separate steps; filter results by status
- **Run history** — Suite listings include case count and the status and pass/fail counts of the latest run; runs can be listed per suite
- **Suite duplication** — Clone a suite and its cases to fork a baseline or create an environment-specific variant
- **Schedules** — Store hourly / daily / weekly / monthly / cron schedules per suite (automatic triggering in development)
- **Uniform pagination** — Every list endpoint returns `{ data, total, page, page_size, total_pages }`

## Architecture Overview

```
+----------------------------------------------+
|  Your tooling: CI pipeline, scripts, Console |
+----------------------+-----------------------+
                       | REST (JSON)
                       v
+----------------------------------------------+
|           Test Harness Service               |
|  suites, cases, runs, results, schedules     |
+----------+-----------------------+-----------+
           :                       :
           : invokes (in dev)      : result_bot assertions (in dev)
           v                       v
+---------------------+   +----------------------------+
| Your agent bundle   |   | Test Evaluation Agent      |
| (system under test) |   | (LLM judge, via FF Broker) |
+---------------------+   +----------------------------+
```

Solid lines are available now. Dotted lines are in development: today runs are evaluated against a simulated response instead of calling your bundle.

## Documentation

- **[Concepts](./concepts.md)** — Suites, cases, assertions, runs, results, schedules; designing a test suite for your bundle; current release vs. in development
- **[Getting Started](./getting-started.md)** — Create a suite, add cases, run it, read results, and wire it into CI
- **[Reference](./reference.md)** — Every REST endpoint with request/response shapes, assertion types, and errors
- **[Operations](./operations.md)** — Getting access in your environment, verifying reachability, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Preview. The REST API is stable enough to build suites and CI integrations against. Live bundle invocation, persistence, the extended assertion library, `result_bot` assertions, and automatic scheduling are in development.

## Repository

Source code: [ff-services-test-harness](https://github.com/firebrandanalytics/ff-services-test-harness) (private)

## Related

- [Test Evaluation Agent](../../system-agents/test-evaluation.md) — The LLM judge behind `result_bot` semantic assertions
- [System Agents](../../system-agents/README.md) — Pre-built agent bundles
- [FF Broker](../ff-broker/README.md) — Routes LLM calls made by your bundle and by the Test Evaluation Agent
- [Platform Services Overview](../README.md) — Catalog of all FireFoundry platform services
