# Test Evaluation Agent

## Overview

The Test Evaluation Agent is a FireFoundry system agent that uses an LLM to judge whether the output of another AI agent or endpoint matches an expected answer. Given the original question, an expected answer, and the actual response, it returns a structured verdict — was the answer correct, what answer was actually given, how confident is the judgment, and what was the reasoning. It is designed to power evaluation suites for AI applications where exact-string matching is too brittle but human review for every test case is too slow.

## Purpose and Role

Evaluating AI output is fundamentally different from evaluating deterministic code. A correct answer may be phrased many ways, may include extra prose around the right number, may use synonyms, or may format a list differently. Exact-match assertions miss legitimate correctness; loose substring checks let regressions through. The Test Evaluation Agent acts as an LLM judge that callers can drop into a test suite to grade AI responses against a known-good answer with the kind of semantic flexibility a human reviewer would apply.

Typical use cases:

- Regression tests for AI applications: feed each test case's expected answer and the live response into the agent, gate the build on the verdict
- Continuous evaluation in production: spot-check live responses against a curated answer key
- Tuning workflows: compare model and prompt variants by their evaluated correctness rate
- Mixed-format answers: numeric, free-text, and list answers all use the same evaluation endpoint

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

The Test Evaluation Agent fits naturally into an automated test loop:

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

- [System Agents Catalog](./README.md)
- [FF Broker](../services/ff-broker/README.md) — Routes the agent's LLM calls
