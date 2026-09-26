# Code Sandbox — Concepts

This page covers what you need to design an app around the Code Sandbox: how a request runs, what harnesses are, how database access works, and the security and retry behavior your bundle has to account for.

## How a Request Runs

Each `/process` request goes through two phases:

1. **Compile**: the TypeScript is compiled. Syntax and type errors stop the request and come back in `errors`.
2. **Execute**: the harness opens the databases the request names, calls the function your code exports, and collects the return value and console output.

```
Your bundle → POST /process → compile → open requested databases
    → call harness entry point → return { success, returnData, stdout, stderr, errors }
```

With streaming enabled, the sandbox sends a progress event after each phase (see [Streaming Progress](#streaming-progress)).

Each request is independent. Nothing your code creates in memory survives to the next request, so pass everything the code needs in the request itself or have it re-query the database.

## Harnesses

A **harness** is the execution context for a request. It decides which function your code must export and how that function is called.

| Harness | Use it for | Required export |
|---------|------------|-----------------|
| `finance` | Analytical code: queries plus computation, statistics, charts | `analyze(dbs)`; optional `sanityCheck()` |
| `sql` | Running SQL and returning rows | `run(dbs)` |

When you prompt an LLM to write sandbox code, tell it which harness it is targeting and which function to export. A missing or misnamed export is the most common cause of failed runs.

## Database Injection

The request lists the databases the code needs by name. The harness connects to each one and passes the connections to your function as a `dbs` object, keyed by name:

```typescript
export const analyze = async (dbs: Record<string, DatabaseAdapter>) => {
  // dbs.analytics was listed in the request's `databases` array
  const result = await dbs.analytics.executeQuery(
    'SELECT COUNT(*) AS total FROM users'
  );
  return result.rows[0];
};
```

Which database names are available is set per environment (see [Operations](./operations.md#making-databases-available)). A request can only use names that exist in the environment.

## Security Model

**Generated code never receives secrets.** The sandbox holds the database credentials, opens the connections, and gives your code connection objects, not connection strings or passwords. This makes it reasonable to run LLM-generated code against production data sources, within the permissions of the database account the environment is configured with.

What this means for your app design:

- **Scope data access with the database account.** The sandbox does not filter queries. If generated code should only read certain tables, give the configured database user only those permissions. Prefer read-only accounts for analytical use.
- **Authenticate your calls.** If your environment configures a sandbox API key, every `/process` call must send it in the `x-api-key` header.
- **Don't put secrets in code or prompts.** Anything in `code` or `runScript` is visible to the LLM that wrote it and may appear in logs.

## Retries and Idempotency

The Code Sandbox does **not** guarantee idempotent execution. If your bundle retries a request, the code runs again.

- Read-only analysis is naturally safe to retry.
- Code that writes to a database may apply its writes more than once. Design such code to be idempotent (upserts, natural keys), wrap the work in a transaction, or don't retry automatically.

## Available Libraries

Executed code can use these libraries. Other imports are not available.

| Library | Purpose |
|---------|---------|
| `dataframe-js` | DataFrame operations on tabular data |
| `simple-statistics` | Statistical functions |
| `chart.js` | Chart generation |
| `canvas` | Low-level graphics and image rendering |

## Streaming Progress

For long-running code, ask for streamed progress. The sandbox sends newline-delimited JSON events:

```json
{"type": "compilation_complete", "success": true, "data": {...}}
{"type": "execution_started"}
{"type": "execution_complete", "success": true, "result": {...}}
```

Use these to show status in a UI, or to fail fast on a compile error without waiting for a full response.

## App Design Patterns

**Generate, run, repair.** A bot writes code for the harness. The bundle runs it. If `success` is false, the bundle sends the compile or runtime errors back to the bot and asks for a fix, up to a small retry limit. The sandbox's structured `errors` make this loop straightforward.

**Keep the LLM out of the numbers.** Have the LLM write the query and the computation, then let it explain `returnData`. It should not do the arithmetic itself. This gives exact figures and an auditable artifact (the code) for every answer.

**Store the code with the result.** Save generated code (for example in working memory, and reference it with `codeWorkingMemoryId`) so a user or reviewer can see exactly what produced an answer, and so it can be re-run later.

**Bound the result size.** Tell the generated code to aggregate or `LIMIT` its queries and return summaries rather than whole tables. Large results are slow to return and expensive to put back into a prompt.
