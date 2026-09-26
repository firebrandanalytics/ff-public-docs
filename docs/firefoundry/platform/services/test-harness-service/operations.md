# Test Harness Service — Operations

How to get access to the Test Harness Service in your environment, verify it is reachable, design around its current limits, and troubleshoot from the caller side.

## Getting Access in Your Environment

The Test Harness Service is an optional Preview service. It is not yet a toggle in the `firefoundry-core` Helm chart, so there is no `enabled` value for you to set. Your environment administrator deploys it and gives you:

- The **in-cluster URL** your bundles and in-cluster jobs use, typically `http://<service-name>.<namespace>.svc.cluster.local:<port>`
- How to reach it from your workstation or CI runner (usually `kubectl port-forward`, or a CI runner that runs inside the cluster)

There are no app-level settings to configure: suites, cases, and schedules are all created through the [REST API](./reference.md).

## Verifying Reachability

From a workstation, using a port-forward (adjust namespace, service name, and ports to what your administrator provided):

```bash
kubectl port-forward -n <namespace> svc/<test-harness-service> 8080:<service-port>
export HARNESS_URL=http://localhost:8080
curl -s $HARNESS_URL/health     # {"status":"healthy",...}
curl -s $HARNESS_URL/ready      # {"ready":true}
curl -s "$HARNESS_URL/api/suites?page_size=1"
```

From inside the cluster (for example, a CI job pod or a debug shell in your bundle's namespace):

```bash
curl -s http://<service-name>.<namespace>.svc.cluster.local:<port>/health
```

If `/health` responds but `/api/suites` returns an empty list you did not expect, see [Troubleshooting](#troubleshooting).

## Limits and Behavior to Design Around

| Behavior | What it means for your app |
|----------|----------------------------|
| **Runs use simulated responses** | Every case is evaluated against `Simulated response for: <input_message>`, not your bundle's answer. Use runs now to validate suites and CI wiring, not bundle quality |
| **No persistence across service restarts** | Suites, cases, runs, results, and schedules can disappear after a restart or redeploy. Keep definitions in source control and have scripts re-create them; export results you need to keep |
| **Schedules do not trigger runs** | Use your CI system's scheduler (or a Kubernetes CronJob your administrator sets up) calling `POST /api/suites/{id}/run` |
| **Synchronous execution** | `execute` and `run` calls return only after every case is evaluated. This is fast today; allow generous client timeouts once live bundle invocation ships |
| **Request body limit** | Request bodies are limited to 5 MB |
| **Pagination** | List endpoints default to 25 items per page; pass `page_size` and iterate `page` for large suites or result sets |
| **Runs execute once** | A run can be executed only while `pending`. To re-run, create a new run or use `POST /api/suites/{id}/run` |
| **Assertion types are checked at run time** | A misspelled or not-yet-available type fails the assertion with `Unknown assertion type` rather than being rejected on save |

## Access and Data Handling

- **No per-caller authentication in Preview.** The `/api/*` endpoints do not take credentials; anyone who can reach the service can create, modify, and delete suites. Ask your administrator to keep it reachable only from the namespaces and CI runners that need it.
- **Shared data.** Everyone using the same instance sees the same suites and runs. Use clear suite names and `tags` (for example, your app or team name) and set `triggered_by` on every run so history is attributable.
- **Use synthetic test data.** Inputs and responses are stored verbatim. Do not put real customer data, credentials, or secrets in `input_message`, `expected`, or labels.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Suites and run history disappeared | The service restarted; data does not persist yet | Re-create suites from your source-controlled definitions |
| Results do not reflect what your bundle actually answers | Runs use simulated responses in Preview | Expected; see [Concepts](./concepts.md#current-release-vs-in-development) |
| `status_code` / `latency_under` assertions always pass | These are not enforced until live bundle invocation ships | Expected; don't rely on them yet |
| Assertion fails with `Unknown assertion type` | Misspelled type, or a type still in development (e.g. `result_bot`, `levenshtein`) | Use a type listed as implemented in the [Reference](./reference.md#assertion-types) |
| `matches_regex` fails with `Invalid regex` | `expected` is not a valid JavaScript regular expression (remember to escape backslashes in JSON, e.g. `"\\d+"`) | Fix the pattern |
| `json_path` always fails | The response is not valid JSON, or `path` does not match | Check `actual_response` in the result; the path uses dots, e.g. `$.order.status` |
| Run shows `completed` but CI should have failed | `completed` means the run finished, not that it passed | Gate on the run's `failed` count |
| `409 Cannot execute run in status: completed` | Runs can execute only once | Create a new run, or use `POST /api/suites/{id}/run` |
| `409` when deleting a suite | The suite has an enabled schedule | `PATCH /api/schedules/{id}` with `{"enabled": false}` or delete the schedule, then retry |
| Scheduled suite never runs | Schedules don't trigger runs yet | Trigger runs from CI |
| `500` on a POST or PATCH | Malformed JSON body | Validate the JSON and send `Content-Type: application/json` |
| `404` for a suite or run ID you saved earlier | The ID is wrong, or the data was lost in a restart | List suites/runs to confirm; re-create if needed |
| Connection refused / timeout | Port-forward not running, wrong URL, or network access not granted from your namespace | Re-check the URL with your administrator and test `/health` |

## Related

- [Test Harness Service Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Platform Services Overview](../README.md)
