# Web Search Agent

## Overview

The Web Search Agent is a FireFoundry system agent that performs iterative, LLM-driven web research on behalf of an application. Given a natural-language question, it searches the web, evaluates the results, refines its queries across multiple rounds, and returns a single human-readable summary with inline citations and a structured list of source pages. Applications get research-grade answers from one HTTP call — they do not need to manage search providers, scrape pages, or stitch results together.

## Purpose and Role

Web search is one of the most common building blocks for AI applications: question-answering assistants, market and competitive research, current-events summaries, fact-checking, due diligence, and any task where the model needs information beyond its training data. The Web Search Agent makes that capability a first-class platform primitive. Application developers call a single endpoint with a question, and the agent handles the entire research loop — query formulation, source evaluation, follow-up searches, and synthesis — and returns a citation-rich answer their application can show to end users or feed into downstream prompts.

The agent is intended to be called both directly from end-user-facing applications and from inside other agents that need fresh information mid-workflow.

## Key Features

- **Single-call research**: One HTTP request kicks off the full multi-round search loop and returns a synthesized answer
- **Iterative refinement**: The agent issues multiple searches, evaluates intermediate results, and refines its query strategy across rounds
- **Inline citations**: The returned summary includes `[1]`, `[2]` style markers tied to a structured source list with titles, URLs, snippets, and per-source relevance notes
- **Self-assessed confidence**: Each response includes a `high`, `medium`, or `low` confidence rating so callers can decide how much to trust an answer
- **Tunable scope**: Callers can cap the number of iterations and sources, supply optional context, and pass focus-area hints to steer the search
- **No application-side state**: The agent is stateless — each request is independent, with no API keys or session state to manage on the caller side

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/web-search` | Run a full iterative web research query and return a cited summary |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### Request

`POST /api/web-search`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `question` | string | yes | — | The research question to answer |
| `context` | string | no | — | Optional background context to share with the agent |
| `maxIterations` | int (1–20) | no | 5 | Suggested cap on the number of search rounds |
| `maxSources` | int (1–100) | no | 20 | Suggested cap on the number of sources to cite |
| `focusAreas` | string[] | no | — | Optional topic hints to steer search strategy (e.g. `["academic papers", "industry announcements"]`) |

### Response

A JSON object containing:

- `summary` — Human-readable answer with inline `[N]` citations
- `confidence` — `high` / `medium` / `low`
- `sources` — Array of source objects (`index`, `title`, `url`, `snippet`, `relevance`)
- `iterations` — How many search rounds were performed
- `query_history` — The actual queries issued across iterations

### Example

```bash
curl -X POST "https://<gateway-host>/api/web-search" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the latest developments in quantum computing error correction?",
    "context": "Focus on 2025-2026 results",
    "maxIterations": 5,
    "maxSources": 20,
    "focusAreas": ["academic papers", "industry announcements"]
  }'
```

Response shape:

```json
{
  "summary": "Recent developments in quantum error correction have focused on... [1] ... confirmed by [2]...",
  "confidence": "high",
  "sources": [
    {
      "index": 1,
      "title": "Breakthrough in Quantum Error Correction",
      "url": "https://example.com/quantum-ec",
      "snippet": "Researchers demonstrated a 10x improvement...",
      "relevance": "Directly addresses error correction advances in 2026"
    }
  ],
  "iterations": 3,
  "query_history": [
    "quantum computing error correction 2025 2026",
    "surface code logical qubit error rates 2026"
  ]
}
```

## Dependencies

The Web Search Agent calls only the FF Broker. The broker handles model selection and the connection to the underlying web search provider; the agent does not talk to search APIs directly.

## Configuration

The agent is configured via environment variables (see the bundle's `.env.template` for the full list). The main groups are:

- **Broker connection** — host and port for the FF Broker
- **Service settings** — HTTP port, environment name, log level
- **Broker timeout** — Web research loops can take longer than typical LLM calls; the broker timeout is set higher than the platform default so multi-iteration searches complete cleanly

## Repository

Source code: [ff-app-system / web-search-bundle](https://github.com/firebrandanalytics/ff-app-system/tree/main/apps/web-search-bundle)

## Related Documentation

- [System Agents Catalog](./README.md)
- [Web Search Service](../services/web-search/README.md) — The underlying provider-agnostic search service the agent uses through the broker
- [FF Broker](../services/ff-broker/README.md) — Routes the agent's model and tool calls
