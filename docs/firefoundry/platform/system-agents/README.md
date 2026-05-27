# FireFoundry System Agents

System agents are pre-built agent bundles that ship as part of the FireFoundry platform. Where the [platform services](../services/README.md) provide raw capabilities — model routing, entity storage, code execution, document processing — system agents stitch those capabilities together into ready-to-use, opinionated AI workflows: web research, document extraction, knowledge-base retrieval, database metadata discovery, and more.

Application developers can call a system agent directly from their own application or workflow, the same way they would call any other HTTP API. There is nothing to build — the bundle runs on the platform and exposes its endpoints over the standard gateway. The `xml-bundle-server` is the exception: it ships as a runtime framework for declarative agents written in the [FireFoundry XML DSL](../../sdk/agent_sdk/dsl/README.md), so you supply the bundle definition and the server hosts it.

## Available System Agents

- **[Web Search Agent](./web-search.md)** — Iterative, LLM-driven web research that searches, evaluates results, refines queries, and returns a cited summary.
- **[RAG Agent](./rag-agent.md)** — Knowledge-base ingestion and semantic retrieval over the entity graph. One bundle, separate ingestion and query endpoints.
- **[Structured Extraction Agent](./structured-extraction.md)** — Multi-modal document extraction. Turns PDFs, Word, and Excel files into structured HTML plus per-page metadata.
- **[Data Discovery Agent](./data-discovery.md)** — AI-powered metadata discovery for the Data Access Service. Inspects a database connection and proposes table and column annotations, entity types, and relationships.
- **[Test Evaluation Agent](./test-evaluation.md)** — LLM-based judge for comparing actual AI outputs against expected answers in test suites.
- **[XML Bundle Server](./xml-bundle-server.md)** — A framework, not a fixed agent. Bootstraps any agent bundle defined in the FireFoundry XML DSL at runtime.

## System Agent Matrix

| Agent | Primary Endpoint | What It Returns |
|-------|------------------|-----------------|
| [Web Search Agent](./web-search.md) | `POST /api/web-search` | Cited summary with structured sources |
| [RAG Agent](./rag-agent.md) | `POST /api/kb-ingest`, `POST /api/rag-query` | Ingestion job handle, retrieval context with citations |
| [Structured Extraction Agent](./structured-extraction.md) | `POST /api/extract-document` | Per-page HTML and structural metadata |
| [Data Discovery Agent](./data-discovery.md) | `POST /api/discover` | Suggested annotations, entity types, and relationships |
| [Test Evaluation Agent](./test-evaluation.md) | `POST /api/validate-result` | Correctness verdict, extracted answer, reasoning |
| [XML Bundle Server](./xml-bundle-server.md) | (framework — endpoints defined by the hosted bundle) | (depends on the bundle) |

## How to Use a System Agent

System agents are reachable over the platform's standard HTTP gateway. To call one from your application:

1. Confirm with your platform administrator which environment the agent is deployed in and what hostname / base URL the gateway exposes for that environment.
2. `POST` a JSON request body to the agent's endpoint (see the agent's page for the request schema).
3. Receive the structured JSON response. For long-running operations (such as RAG ingestion), the agent returns a handle immediately and the workflow continues in the background.

A minimal call looks the same shape for any system agent — only the route and request body change:

```bash
curl -X POST "https://<gateway-host>/api/<agent-route>" \
  -H "Content-Type: application/json" \
  -d '{ ... agent-specific request ... }'
```

Each agent's documentation page includes a concrete example for its main endpoint.

## Related Documentation

- [Platform Services](../services/README.md) — Catalog of underlying platform services that system agents call
- [Agent SDK](../../sdk/agent_sdk/README.md) — Build your own agent bundles in TypeScript
- [FireFoundry XML DSL](../../sdk/agent_sdk/dsl/README.md) — Declarative bundle definitions for use with the XML Bundle Server
- [Platform Architecture](../architecture.md) — How services and agent bundles are deployed and networked
