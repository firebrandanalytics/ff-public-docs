# Test Evaluation Agent

## Overview

The Test Evaluation Agent is a FireFoundry system agent that uses an LLM to judge whether the output of another AI agent or endpoint matches an expected answer. Given the original question, an expected answer, and the actual response, it returns a structured verdict — was the answer correct, what answer was actually given, how confident is the judgment, and what was the reasoning.

The agent is primarily intended to be used through the [Test Harness Service](../services/test-harness-service.md), which drives test execution and uses this agent's verdict for the `result_bot` semantic assertion type. Application developers building their own test runners can also call the agent directly; this page documents both paths.

## Purpose and Role

Evaluating AI output is fundamentally different from evaluating deterministic code. A correct answer may be phrased many ways, may include extra prose around the right number, may use synonyms, or may format a list differently. Exact-match assertions miss legitimate correctness; loose substring checks let regressions through. The Test Evaluation Agent acts as an LLM judge that grades AI responses against a known-good answer with the kind of semantic flexibility a human reviewer would apply.

The recommended path for most testing workflows is to define test suites in the [Test Harness Service](../services/test-harness-service.md), attach `result_bot` assertions to cases that need semantic judgment, and let the harness call this agent for each evaluation. Direct usage of this endpoint is appropriate when:

- You are building a custom test runner outside the Test Harness Service
- You want to score live production responses against a curated answer key from your own application code
- You are tuning prompts or models and want to compare evaluated correctness rates from a script

Typical use cases for `result_bot` assertions in the Test Harness:

- Regression tests for AI applications: feed each test case's expected answer and the live response into the agent, gate the build on the verdict
- Mixed-format answers: numeric, free-text, and list answers all use the same evaluation logic

## Key Features

- **Single endpoint, structured verdict** — One HTTP call returns correctness, extracted answer, variance analysis, confidence, and reasoning
- **Answer-type aware** — Distinguishes between number, text, list, and structured answers and adjusts comparison accordingly
- **Variance reporting** — When the actual answer is close but not identical, the agent describes the difference and rules on whether the variance is acceptable
- **Confidence rating** — Each verdict is tagged `high`, `medium`, or `low` so callers can flag uncertain judgments for manual review
- **Reasoning text** — Every response includes the LLM's chain of reasoning so test failures are explainable
- **Flexible expected answer** — `expected_output` accepts any JSON value (string, number, list, object), so the agent can compare against structured ground truth as well as free text

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/validate-result` | Judge whether an actual response answers the original question correctly relative to an expected answer |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### Request: `POST /api/validate-result`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `original_question` | string | yes | The question or prompt that was asked |
| `expected_output` | any JSON | yes | The known-good answer (string, number, list, or structured value) |
| `actual_output` | string | yes | The actual response from the agent or endpoint under test |

### Response

```json
{
  "is_correct": true,
  "extracted_answer": "42",
  "known_good_answer": "42",
  "answer_type": "number",
  "variance": null,
  "variance_acceptable": true,
  "confidence": "high",
  "reasoning": "The response states 'The answer is 42.' which matches the expected numeric answer exactly."
}
```

Field reference:

- `is_correct` — Boolean verdict
- `extracted_answer` — The answer the agent identified inside `actual_output` (string, array of strings, or `null`)
- `known_good_answer` — The expected answer, normalized to a string for display
- `answer_type` — `number` / `text` / `list` / `structured`
- `variance` — Description of the difference between expected and actual, or `null` when they match
- `variance_acceptable` — Whether the agent considers any variance close enough to count as correct
- `confidence` — `high` / `medium` / `low`
- `reasoning` — Free-text explanation of the judgment

### Example

```bash
curl -X POST "https://<gateway-host>/api/validate-result" \
  -H "Content-Type: application/json" \
  -d '{
    "original_question": "How many customers placed orders in Q1 2026?",
    "expected_output": 12847,
    "actual_output": "In Q1 2026, there were approximately 12,847 customers who placed at least one order."
  }'
```

### Recommended Pattern

Most teams should reach this agent through the [Test Harness Service](../services/test-harness-service.md): define test suites, mark the cases that need semantic judgment with a `result_bot` assertion, and the harness handles execution, the call to this agent, and result aggregation. The harness preserves run history, supports scheduled runs, and stores assertion verdicts alongside the input/output that produced them.

For custom test runners that call this agent directly, the basic loop is:

1. Run the agent or endpoint under test against a fixed set of cases, capturing each `actual_output`
2. For each case, call `/api/validate-result` with the case's `original_question`, `expected_output`, and the captured `actual_output`
3. Aggregate the verdicts — pass rate, low-confidence count, distribution of variance reasons
4. Surface low-confidence judgments to a human reviewer; treat the rest as authoritative

## Dependencies

The Test Evaluation Agent calls only the FF Broker for its LLM judgment.

## Configuration

The agent is configured via environment variables (see the bundle's `.env.template` for the full list). The main groups are:

- **Broker connection** — Host and port for the FF Broker
- **Service settings** — HTTP port, environment name

## Repository

Source code: [ff-app-system / test-evaluation-agent](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/test-evaluation-agent)

## Related Documentation

- [Test Harness Service](../services/test-harness-service.md) — The recommended path for using this agent; manages test suites, runs, and results
- [System Agents Catalog](./README.md)
- [FF Broker](../services/ff-broker/README.md) — Routes the agent's LLM calls
