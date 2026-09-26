# Code Sandbox — Concepts

What you need to design an app around the Code Sandbox: profiles, how a run executes, the entry-point contract, data access through DAS, results and errors, the security model, and common app patterns.

## Profiles and Runtimes

A **runtime** is an execution image for one language: for example a TypeScript runtime, or a Python runtime with pandas, NumPy, and SciPy installed. Runtimes are registered for the environment by your administrator.

A **profile** is a named configuration built on a runtime. It is what your app refers to:

| A profile sets | Effect for your app |
|----------------|---------------------|
| Runtime | Language (`typescript` or `python`) and harness (`finance` or `datascience`), and so which packages the code can import |
| DAS connections | Which `das.<name>` clients the code receives, and the identity DAS sees for its queries |
| Run script | The entry-point rules for generated code (the harness default unless the profile supplies its own), plus an optional human-readable description of them (`runScriptPrompt`) |
| Resource limits | Default timeout, CPU, and memory for each run |

Your bot or request names a profile, for example `profile: "finance-typescript"`, and the sandbox takes everything else from it. Changing a profile changes the behavior of every bot that uses it, with no bundle redeploy.

Profile names are unique across the environment, not per app. Prefix yours with your app's name (`orders-app-analytics`) so apps sharing an environment don't collide. See [Operations](./operations.md#setting-up-profiles) for creating profiles.

## How a Run Executes

```
POST /execute { source, profile }
  → resolve profile and runtime
  → load code (inline, or from working memory)
  → start a fresh container for this run
  → compile (TypeScript) → call your entry point → capture return value, stdout, stderr
  → return { executionId, compilation, execution, totalDurationMs }
  → container is removed
```

Consequences for your app:

- **Every run starts clean.** Files, globals, and in-memory state don't survive to the next run. Pass everything the code needs in the code itself or have it query DAS.
- **Expect container start-up time on every run** (typically a few seconds on top of the code's own run time). Batch work into one run rather than many tiny runs, and show progress in your UI.
- **Runs are bounded by a timeout**: the profile's timeout, overridable per request, up to 5 minutes. The default is 2 minutes.

## Entry Points

Generated code must define a function the sandbox calls. Its return value becomes `execution.result`.

**TypeScript** (harness `finance`): export `run`, `main`, or a default function. It may be `async`.

```typescript
export async function run() {
  const rows = await das.warehouse.queryRows(
    "SELECT region, SUM(amount) AS total FROM orders GROUP BY region"
  );
  return { description: "Revenue by region", result: rows };
}
```

**Python** (harness `datascience`): define `run()`. Packages are installed but not pre-imported, so the code imports what it uses.

```python
import pandas as pd

def run():
    df = das['warehouse'].query_df("SELECT region, amount FROM orders")
    summary = df.groupby("region")["amount"].sum().round(2)
    return {"description": "Revenue by region", "result": summary.to_dict()}
```

Return JSON-serializable values. In Python, convert DataFrames, NumPy types, and `Decimal` values to plain lists, dicts, and numbers before returning.

The `{ description, result }` shape is the convention `GeneralCoderBot` asks the LLM for; the sandbox itself returns whatever `run()` returns. `GeneralCoderBot` always tells the LLM to write a `run()` function, which works with both default harnesses. If a profile replaces the default entry-point rules with its own run script, describe that contract in your bot's domain prompt.

## Data Access Through DAS

When a profile enables DAS, the sandbox injects one client per configured connection into the executing code as `das`:

| Language | Access | Methods |
|----------|--------|---------|
| TypeScript | `das.warehouse` or `das["warehouse"]` | `query(sql, params?, options?)`, `queryRows(sql, params?, options?)`, `getSchema(table?)` |
| Python | `das['warehouse']` | `query(...)`, `query_rows(...)`, `query_df(...)` (pandas DataFrame), `get_schema(table=None)` |

Queries go to the [Data Access Service](../data-access/README.md), which applies that connection's access controls, row limits, and audit logging. The identity DAS sees for these queries is set in the profile. Method details are in the [Reference](./reference.md#in-sandbox-das-api).

Tell the LLM which connections exist, how to call them, and what the tables look like, in the bot's domain prompt. [Part 2 of the tutorial](../../../sdk/agent_sdk/tutorials/code-sandbox/part-02-data-science-and-domain-prompts.md) adds the connection and method instructions; [Part 3](../../../sdk/agent_sdk/tutorials/code-sandbox/part-03-dynamic-schema.md) fetches the live schema from DAS at startup and adds it too. A profile's connection names are available from its [metadata endpoint](./reference.md#get-profilesnamemetadata).

## Code Sources

A request supplies code in one of two ways:

- **Inline**: `{ "type": "inline", "code": "..." }`, up to 1 MB.
- **Working memory**: `{ "type": "context-service", "id": "<working-memory-id>" }`. The sandbox loads the code from the [Context Service](../context-service/README.md).

`GeneralCoderBot` stores each generated script in working memory before running it, then sends the working-memory ID. The exact code behind every result is therefore kept with the entity and can be re-run later.

## Results and Errors

A completed request has two parts:

- **`compilation`**: `success`, plus structured `errors` (message, line, column) when TypeScript fails to compile.
- **`execution`**: `success`, `result` (your entry point's return value), `stdout`, `stderr`, `durationMs`, and `errors` (type `runtime`, message, line, stack) when the code throws.

A request that is *accepted* returns HTTP 200 even when the code fails. Check `compilation.success` and `execution.success`. HTTP errors (400, 404, 429, 503, 504) mean the run didn't happen or didn't finish (see [Reference](./reference.md#errors)).

`GeneralCoderBot` classifies failures for you:

| Failure | What the bot does |
|---------|-------------------|
| Compile error, runtime error, SQL error | Sends the error back to the LLM and asks for a fix, up to `maxTries` attempts (default 8) |
| Transient infrastructure error (connection reset, fetch failed) | Re-runs the same code, up to `maxSandboxRetries` (default 3) |

## Streaming Progress

With `stream: true` the sandbox responds with Server-Sent Events instead of one JSON body: `started` (with the `executionId`), `compilation_started`, `compilation_complete`, `execution_started`, `output`, `execution_complete`, and `done`, or `error` on failure. `GeneralCoderBot` always streams and turns these events into bot progress updates, which your UI can show. Closing the stream cancels the run.

## Security Model

- **Isolation**: each run gets its own container, running as a non-root user, and the container is removed afterward. One run cannot see another run's files or memory.
- **No credentials in code or prompts**: generated code calls `das.<name>` and never sees a connection string or password. What code *can* do with data is whatever the DAS connection allows. Scope access at the connection: give it a read-only database account and restrict tables and columns with DAS access controls.
- **Treat generated code as untrusted.** The sandbox runs whatever it is given, within the runtime's limits. Don't put secrets in prompts or code, and review generated code for any workflow that writes data.
- **In-cluster only**: the service is not exposed outside the cluster by default. Call it from your bundle's backend, never from a browser.

## Retries and Idempotency

A retried request runs the code again. Read-only analysis is safe to retry. Code that writes (through a DAS connection that permits writes) can apply its changes twice, so make writes idempotent (upserts, natural keys) or turn off automatic retries for those bots.

## App Design Patterns

**Profile per purpose.** Create one profile per kind of task (`orders-app-ts`, `orders-app-analytics`) rather than one profile for everything. Each bot names its profile, and you can tighten data access for one task without affecting the others.

**Generate, run, repair.** Let the LLM write code, run it, and feed failures back to it. `GeneralCoderBot` implements this loop. If you build your own, send the structured `compilation.errors` or `execution.errors`, not just "it failed".

**Keep the LLM out of the numbers.** Have the LLM write the query and the computation, and only explain `result`. You get exact figures and an auditable script for every answer.

**Ground the prompt in the real schema.** Give the bot the actual tables and columns from DAS at startup. Guessed column names are the most common cause of failed data runs.

**Bound the result size.** Tell the code to aggregate, `LIMIT` queries, round numbers, and return summaries rather than whole tables. Large results are slow to return and expensive to put back into a prompt.

**Thin UI, smart bundle.** Put a bundle API endpoint in front of the sandbox and have your web app call that endpoint. Browsers never talk to the sandbox (see [Part 4 of the tutorial](../../../sdk/agent_sdk/tutorials/code-sandbox/part-04-web-gui.md)).
