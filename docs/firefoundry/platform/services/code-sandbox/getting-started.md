# Code Sandbox — Getting Started

This guide checks that the sandbox is reachable, runs code with `curl` so you can see the raw contract, and then runs LLM-generated code from an agent bundle with `GeneralCoderBot`. For a complete app, follow the [Code Sandbox tutorial](../../../sdk/agent_sdk/tutorials/code-sandbox/README.md).

## Prerequisites

- Code Sandbox v2 enabled in your environment (see [Operations](./operations.md#enabling-the-code-sandbox))
- At least one profile you can use. Ask your environment administrator which profiles exist, or create one (see [Operations](./operations.md#setting-up-profiles)). The examples use `finance-typescript` (TypeScript) and `firekicks-datascience` (Python with a DAS connection named `firekicks`), the profile names the tutorial uses.
- `kubectl` access to the environment's namespace, for the `curl` steps

Inside the cluster, the sandbox is at `http://firefoundry-core-code-sandbox-v2:8080` (for the default `firefoundry-core` release name). To try it from your workstation, port-forward it:

```bash
kubectl port-forward svc/firefoundry-core-code-sandbox-v2 -n <namespace> 8080:8080
```

The examples below use `http://localhost:8080`.

## Step 1: Check the Service

```bash
curl http://localhost:8080/health
# {"status":"healthy"}

curl http://localhost:8080/ready
# {"ready":true,"database":true,"kubernetes":true}
```

Then confirm your profile exists and see what it provides:

```bash
curl http://localhost:8080/profiles/finance-typescript/metadata
# {"language":"typescript","harness":"finance","runScriptPrompt":null,"dasConnections":[]}
```

A `404` means the profile doesn't exist in this environment.

## Step 2: Run TypeScript

```bash
curl -X POST http://localhost:8080/v2/execute \
  -H "Content-Type: application/json" \
  -H "X-App-Id: my-app" \
  -d '{
    "profile": "finance-typescript",
    "source": {
      "type": "inline",
      "code": "export async function run() { const fib = [0, 1]; while (fib.length < 10) fib.push(fib[fib.length - 1] + fib[fib.length - 2]); return { description: \"First 10 Fibonacci numbers\", result: fib }; }"
    }
  }'
```

Response (abridged):

```json
{
  "executionId": "6f1c…",
  "compilation": { "success": true },
  "execution": {
    "success": true,
    "result": { "description": "First 10 Fibonacci numbers", "result": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34] },
    "stdout": "",
    "stderr": ""
  },
  "totalDurationMs": 4210
}
```

Most of `totalDurationMs` is starting the run's container. The code itself ran in milliseconds.

Now break the code (for example, `throw new Error("boom")` inside `run`). The HTTP status is still `200`, and `execution.success` is `false` with the error in `execution.errors`. Your bot feeds that back to the LLM.

## Step 3: Query Data from Python

With a profile that enables a DAS connection, the code gets a `das` client for it:

```bash
curl -X POST http://localhost:8080/v2/execute \
  -H "Content-Type: application/json" \
  -H "X-App-Id: my-app" \
  -d '{
    "profile": "firekicks-datascience",
    "source": {
      "type": "inline",
      "code": "import pandas as pd\n\ndef run():\n    df = das[\"firekicks\"].query_df(\"SELECT COUNT(*) AS n FROM orders\")\n    return {\"description\": \"Order count\", \"result\": int(df[\"n\"].iloc[0])}\n"
    }
  }'
```

The code never sees a database credential. DAS runs the query under the connection's permissions.

## Step 4: Stream Progress

Add `"stream": true` to get Server-Sent Events instead of a single response:

```bash
curl -N -X POST http://localhost:8080/v2/execute \
  -H "Content-Type: application/json" \
  -d '{"profile": "finance-typescript", "stream": true,
       "source": {"type": "inline", "code": "export function run() { console.log(\"working\"); return 42; }"}}'
```

```
event: started
data: {"executionId":"…"}

event: compilation_started
…
event: output
data: {"stream":"stdout","text":"working"}

event: execution_complete
data: {"success":true,"result":42}

event: done
data: {"totalDurationMs":3890}
```

Console output arrives as one `output` event per stream after the code finishes, not line by line. The stream ends after the final `done` (or an `error`) event.

## Step 5: Run LLM-Generated Code from a Bundle

In a bundle, use `GeneralCoderBot` from the Agent SDK. It fetches the profile's metadata at startup, prompts the LLM for code with a `run()` entry point, stores the code in working memory, runs it through the sandbox, and retries on errors:

```typescript
import { GeneralCoderBot, RegisterBot } from "@firebrandanalytics/ff-agent-sdk";

@RegisterBot("AnalyticsCoderBot")
export class AnalyticsCoderBot extends GeneralCoderBot {
  constructor() {
    super({
      name: "AnalyticsCoderBot",
      modelPoolName: "firebrand-gpt-5.2-failover",
      profile: process.env.CODE_SANDBOX_TS_PROFILE || "finance-typescript",
    });
  }
}
```

Give the bundle the sandbox's address:

| Variable | Value |
|----------|-------|
| `CODE_SANDBOX_URL` | `http://firefoundry-core-code-sandbox-v2:8080` |

Always set `CODE_SANDBOX_URL`: the SDK's built-in default address does not match a standard FireFoundry deployment. See [Operations](./operations.md#configuring-your-bundle) for the full list.

To wire the bot to an entity and an API endpoint, add a domain prompt, and query data, follow the tutorial from [Part 1: Your First Code Execution](../../../sdk/agent_sdk/tutorials/code-sandbox/part-01-first-code-execution.md).

## Next Steps

- [Concepts](./concepts.md): profiles, entry points, DAS access, and design patterns
- [Reference](./reference.md): the full request and response shapes
- [Operations](./operations.md): profiles, limits, and troubleshooting
