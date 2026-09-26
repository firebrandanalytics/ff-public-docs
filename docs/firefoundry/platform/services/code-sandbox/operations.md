# Code Sandbox — Operations

How to enable Code Sandbox v2 in your environment, set up profiles, configure your bundle, and handle the limits and failures your app will see.

## Enabling the Code Sandbox

Code Sandbox v2 is the `code-sandbox-v2` service of the `firefoundry-core` chart.

**Environments managed with ff-cli**: include `code-sandbox-v2` in the environment's enabled services. The standard ff-cli environment templates already include it.

```json
"enabledServices": ["ff-broker", "context-service", "entity-service", "code-sandbox-v2"]
```

See [Environment Management](../../../../ff-cli/environment-management.md) for creating and updating environments.

**Helm directly**: turn it on in your `firefoundry-core` values:

```yaml
code-sandbox-v2:
  enabled: true
```

Installing it this way also requires the environment's database admin credential for the service's one-time setup, which your environment administrator provides.

Enable `code-sandbox-v2`, not `code-sandbox`: `code-sandbox` is the deprecated legacy service, with a different API.

Once enabled, the sandbox is reachable inside the cluster at:

```
http://firefoundry-core-code-sandbox-v2:8080
```

(If your core release has a different name, the service is `<release>-code-sandbox-v2`.) It has no external ingress by default.

### What Your Administrator Provisions vs. What You Do

| Administrator | You (app team) |
|---------------|----------------|
| Enables the service and registers runtimes (TypeScript, Python) | Chooses or creates profiles for your app |
| Gives the sandbox access to the Data Access Service | Makes sure the DAS connections your profiles name exist (see [DAS Operations](../data-access/operations.md)) |
| Sets environment-wide rate limits if the defaults don't fit | Sets `CODE_SANDBOX_URL` and profile names in your bundle |

## Setting Up Profiles

Your bots need a profile to exist before they start. A bot whose profile is missing fails at `init()`.

1. **Check what exists**: `GET /admin/profiles`, or `GET /profiles/<name>/metadata` for one name.
2. **Find a runtime**: `GET /admin/runtimes` and note the `id` of the runtime with the language you need.
3. **Create the profile**: `POST /admin/profiles` with the runtime ID, DAS connections, and limits (see [Reference](./reference.md#create-a-profile)).

Guidelines:

- **Prefix names with your app** (`orders-app-analytics`). Profile names are shared across the environment.
- **One profile per purpose**, so you can change one bot's data access or limits without affecting others.
- **Set `clientConfig.das.onBehalfOf`** to an identity for your app (for example `app:orders-app`), so DAS access rules and audit logs attribute queries correctly.
- **Scope data access at the DAS connection.** A read-only database account and DAS table and column restrictions are what limit generated code. Some profile access-control fields are not yet enforced (see [Reference](./reference.md#profile-fields)).
- **Keep profile changes deliberate.** Every bot using a profile picks up changes on its next run, without a redeploy.

The admin endpoints are reachable only from inside the cluster. If your team doesn't manage profiles itself, ask your environment administrator to create them.

## Configuring Your Bundle

Set these in your bundle's Helm values (for example under `configMap.data` in `values.local.yaml`):

| Variable | Value |
|----------|-------|
| `CODE_SANDBOX_URL` | `http://firefoundry-core-code-sandbox-v2:8080` |
| Your profile variables | e.g. `CODE_SANDBOX_TS_PROFILE: "orders-app-ts"`, `CODE_SANDBOX_DS_PROFILE: "orders-app-analytics"` |

Always set `CODE_SANDBOX_URL`: the SDK's fallback address doesn't match a standard deployment. `CODE_SANDBOX_API_KEY` is not needed for in-cluster calls. A data-science bot that loads schema at startup also needs the Data Access Service address, as in the [tutorial's deployment step](../../../sdk/agent_sdk/tutorials/code-sandbox/part-05-deployment-and-testing.md).

## Verifying

1. `GET /health` returns `{"status":"healthy"}` and `GET /ready` returns `ready: true`. A `503` from `/ready` means the sandbox can't reach its database or Kubernetes; tell your administrator.
2. `GET /profiles/<your-profile>/metadata` returns the expected language and `dasConnections`.
3. Run a trivial program with your profile (see [Getting Started](./getting-started.md#step-2-run-typescript)) and check `execution.success`.
4. For a DAS profile, run a one-line query such as `SELECT 1` through `das['<connection>']`.
5. Start your bundle and look for the bot's `loaded profile metadata` log line.

## Limits to Design Around

| Limit | Value | Design implication |
|-------|-------|--------------------|
| Inline code size | 1 MB | Generated code is far smaller; store large inputs in DAS, not in code |
| Run timeout | Default 2 minutes; maximum 5 minutes | Aggregate in SQL; split long jobs into steps |
| Start-up time | A fresh container per run (typically a few seconds) | Prefer one larger run over many tiny ones; show progress |
| Rate limits (defaults) | 100 execute requests per minute for the environment; 30 per minute per app ID | Queue and back off on `429`; send your app ID so you get your own quota |
| Concurrent runs | 50 in progress per sandbox instance | Extra requests get `429`; retry with backoff |
| DAS query timeout | 30 seconds per query by default (`options.timeout_ms`) | Keep queries selective; watch `truncated` for row limits |
| Execution history | About 30 days | Keep anything you need longer in your own entities |
| Output delivery | Console output arrives after the run, not live | Use stream events for progress, not `console.log` |

Resource limits (CPU and memory) per run come from the profile, or from the runtime's defaults when the profile sets none.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Bot fails at startup: `Failed to fetch profile metadata … 404` | Profile doesn't exist in this environment | Create it, or fix the profile name variable |
| Bot fails at startup: `fetch failed` / `ECONNREFUSED` | `CODE_SANDBOX_URL` unset or wrong, or service not enabled | Set `CODE_SANDBOX_URL=http://firefoundry-core-code-sandbox-v2:8080`; confirm `code-sandbox-v2` is enabled |
| `404` `Runtime not found` | The profile's runtime was removed | Point the profile at an existing runtime |
| `execution.errors`: `Code must define a run() function` (or `run(), main(), or default()`) | Generated code has no entry point | Make sure the prompt asks for `run()`; `GeneralCoderBot` does this by default |
| `das is not defined` / `KeyError` on `das[...]` | Profile doesn't enable DAS, doesn't list that connection, or the sandbox has no DAS access configured | Check `dasConnections` in the profile metadata; if it's listed but still missing, ask your administrator to check the sandbox's DAS access |
| `DAS query failed (403)` / `(404)` | Connection permissions, or the connection doesn't exist in DAS | Check the connection and its access rules in DAS for the profile's `onBehalfOf` identity |
| Wrong table or column names | LLM is guessing the schema | Put the real schema in the domain prompt ([tutorial Part 3](../../../sdk/agent_sdk/tutorials/code-sandbox/part-03-dynamic-schema.md)) |
| `Object of type Decimal is not JSON serializable` or similar | Python result contains non-JSON types | Tell the LLM to convert to plain types and round numbers before returning |
| `429 Too many requests` | Rate or concurrency limit | Back off and retry; reduce parallel runs; send your app ID |
| `504 Gateway timeout`, or an execution error saying it timed out | Run exceeded its timeout | Aggregate in SQL, return less data, or raise the profile's `resourceLimits.timeout` (maximum 5 minutes) |
| `503 Service unavailable` | Sandbox restarting or out of capacity | Retry with backoff |
| `/ready` returns `503` | Sandbox can't reach its database or Kubernetes | Environment issue; contact your administrator |

To see what the LLM wrote and why a run failed, use the tutorial's diagnostic workflow: read the generated code from working memory and the full prompt from telemetry ([Part 5](../../../sdk/agent_sdk/tutorials/code-sandbox/part-05-deployment-and-testing.md)).
